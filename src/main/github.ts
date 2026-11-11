import type { CommitPage, FailingRun, GithubProfile, ItemPage, PullSummary, Repo, RepoListKind, WorkflowRun } from '../shared/api';

import type { RunInfo } from './alerts-core';
import { ETAG_CACHE_MAX, GITHUB_TIMEOUT_MS, isTimeout, LruCache, MAX_CACHED_BODY, rateLimitMessage, rateLimitReset, TIMEOUT_MESSAGE } from './github-core';
import { getToken, onTokenChange, tokenOwns } from './token';

const API = process.env.DEVPANEL_GITHUB_API ?? 'https://api.github.com';

// Conditional requests: GitHub answers 304 (which does not count against the rate limit) when nothing changed.
// Bounded (LRU): the app lives for days in the tray and each entry holds a whole response body.
const etags = new LruCache<string, { etag: string; body: string; link: string | null }>(ETAG_CACHE_MAX);

/** fetch with the timeout every GitHub call gets; a timeout becomes a readable Spanish error. */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  } catch (e) {
    throw isTimeout(e) ? new Error(TIMEOUT_MESSAGE) : e;
  }
}

/** Throws "GitHub limitó las consultas hasta las HH:MM" when the response is a rate limit, not a permission error. */
async function throwIfRateLimited(res: Response): Promise<void> {
  if (res.status !== 403 && res.status !== 429) return;
  const body = await res.clone().text().catch(() => '');
  const reset = rateLimitReset(res.status, res.headers, body);
  if (reset !== null) throw new Error(rateLimitMessage(reset));
}

async function ghFetch(path: string): Promise<Response> {
  const token = getToken();
  const key = `${token ? 't' : 'p'}:${path}`; // a token can change what the same URL returns
  const cached = etags.get(key);
  const res = await timedFetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DevPanel',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cached ? { 'If-None-Match': cached.etag } : {}),
    },
  });
  if (res.status === 304 && cached) {
    return new Response(cached.body, { status: 200, headers: cached.link ? { link: cached.link } : {} });
  }
  await throwIfRateLimited(res);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
  const etag = res.headers.get('etag');
  if (etag) {
    const body = await res.clone().text();
    if (body.length <= MAX_CACHED_BODY) etags.set(key, { etag, body, link: res.headers.get('link') });
    else etags.delete(key);
  }
  return res;
}

async function gh<T>(path: string): Promise<T> {
  return (await (await ghFetch(path)).json()) as T;
}

const hasNext = (res: Response): boolean => /rel="next"/.test(res.headers.get('link') ?? '');

/** 100 repos per page: up to 1000 repos, which keeps a huge account from spending the whole rate limit. */
export const MAX_REPO_PAGES = 10;

/**
 * The user's repos, most recently pushed first. GitHub gives at most 100 per request, so the rest is read
 * by following `rel="next"`. `maxPages: 1` is enough for callers that only want the newest ones.
 */
export async function listRepos(user: string, maxPages = MAX_REPO_PAGES): Promise<Repo[]> {
  if (!user) throw new Error('Vincula tu usuario de GitHub en Settings');
  // with the owner's token the private repos are included too
  const base = tokenOwns(user)
    ? '/user/repos?sort=pushed&per_page=100&affiliation=owner'
    : `/users/${encodeURIComponent(user)}/repos?sort=pushed&per_page=100`;
  const first = await ghFetch(base);
  const repos = (await first.json()) as Repo[];
  let more = hasNext(first);
  for (let page = 2; more && page <= maxPages; page++) {
    try {
      const res = await ghFetch(`${base}&page=${page}`);
      repos.push(...((await res.json()) as Repo[]));
      more = hasNext(res);
    } catch {
      break; // a later page failed (rate limit, network): the repos already read are better than none
    }
  }
  return repos;
}

export const COMMITS_PER_PAGE = 8;

export async function listCommits(user: string, repo: string, page = 1): Promise<CommitPage> {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const res = await ghFetch(
    `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/commits?per_page=${COMMITS_PER_PAGE}&page=${p}`,
  );
  const raw = (await res.json()) as any[];
  return {
    commits: raw.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: String(c.commit.message).split('\n')[0],
      author: c.commit.author?.name ?? 'unknown',
      date: c.commit.author?.date ?? '',
      url: c.html_url,
    })),
    // GitHub announces the next page in the Link header
    hasMore: /rel="next"/.test(res.headers.get('link') ?? ''),
  };
}

export async function listRuns(user: string, repo: string): Promise<WorkflowRun[]> {
  const raw = await gh<{ workflow_runs: any[] }>(
    `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/actions/runs?per_page=5`,
  );
  return raw.workflow_runs.map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    updated_at: r.updated_at,
  }));
}

export function parseGithubUser(input: string): string | null {
  const t = input.trim().replace(/^@/, '');
  const fromUrl = t.match(/github\.com\/([A-Za-z0-9-]{1,39})/i);
  const user = fromUrl ? fromUrl[1] : t;
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user) ? user : null;
}

export async function lookupUser(input: string): Promise<GithubProfile> {
  const user = parseGithubUser(input);
  if (!user) throw new Error('Escribe un usuario o enlace de GitHub válido');
  try {
    const u = await gh<{ login: string; name: string | null; avatar_url: string }>(
      `/users/${encodeURIComponent(user)}`,
    );
    return { login: u.login, name: u.name, avatar: u.avatar_url };
  } catch (e) {
    if ((e as Error).message.includes('404')) throw new Error(`No existe el usuario "${user}" en GitHub`);
    throw e;
  }
}

// ---------- shared by the build alerts and the Home screen ----------
const RUN_TTL_MS = 5 * 60 * 1000;
const runCache = new Map<string, { at: number; value: RunInfo | null }>();

// A different token (or none) can see different repos and runs: nothing cached under the old one is reused.
onTokenChange(() => {
  etags.clear();
  runCache.clear();
});

/** Latest Actions run of a repo, cached for a few minutes so alerts + Home don't double the API usage. */
export async function latestRun(user: string, repo: string): Promise<RunInfo | null> {
  const key = `${user}/${repo}`;
  const hit = runCache.get(key);
  if (hit && Date.now() - hit.at < RUN_TTL_MS) return hit.value;
  let value: RunInfo | null = null;
  try {
    const raw = await gh<{ workflow_runs: any[] }>(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/actions/runs?per_page=1`,
    );
    const r = raw.workflow_runs?.[0];
    if (r) value = { repo, id: r.id, status: r.status, conclusion: r.conclusion, url: r.html_url, branch: r.head_branch };
  } catch {
    /* repo without Actions or rate-limited: treated as "no run" */
  }
  runCache.set(key, { at: Date.now(), value });
  return value;
}

const RECENT_DAYS = 30;
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Recently pushed repos whose latest run failed. */
export async function listFailing(user: string): Promise<FailingRun[]> {
  const since = Date.now() - RECENT_DAYS * 86_400_000;
  const repos = (await listRepos(user, 1)) // sorted by push date: the recent ones are all on the first page
    .filter((r) => !r.archived && new Date(r.pushed_at).getTime() > since)
    .slice(0, 8);
  const runs = await Promise.all(repos.map((r) => latestRun(user, r.name)));
  return runs
    .filter((r): r is RunInfo => !!r && r.status === 'completed' && FAILED.has(r.conclusion ?? ''))
    .map((r) => ({ repo: r.repo, url: r.url, branch: r.branch, updated: new Date().toISOString() }));
}

/** Open pull requests involving the user (author, assignee or mentioned) across their repos. */
export async function listOpenPulls(user: string): Promise<PullSummary[]> {
  const q = encodeURIComponent(`involves:${user} type:pr state:open`);
  const res = await gh<{ items: any[] }>(`/search/issues?q=${q}&sort=updated&per_page=8`);
  return (res.items ?? []).map((i) => ({
    repo: String(i.repository_url ?? '').split('/').slice(-1)[0],
    title: i.title,
    url: i.html_url,
    updated: i.updated_at,
    draft: !!i.draft,
    author: i.user?.login ?? '',
  }));
}

// ---------- per-repository lists (pull requests, issues, Actions runs) ----------
export const ITEMS_PER_PAGE = 8;

export async function listItems(user: string, repo: string, kind: RepoListKind, page = 1): Promise<ItemPage> {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const base = `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}`;
  const paging = `per_page=${ITEMS_PER_PAGE}&page=${p}`;

  if (kind === 'runs') {
    const res = await ghFetch(`${base}/actions/runs?${paging}`);
    const raw = ((await res.json()) as { workflow_runs: any[] }).workflow_runs ?? [];
    return {
      items: raw.map((r) => ({
        id: r.id, title: r.name ?? r.display_title ?? 'workflow', url: r.html_url, date: r.updated_at ?? r.created_at,
        status: r.status, conclusion: r.conclusion, branch: r.head_branch,
      })),
      hasMore: /rel="next"/.test(res.headers.get('link') ?? ''),
    };
  }

  const toItem = (i: any) => ({ id: i.id, number: i.number, title: i.title, url: i.html_url, author: i.user?.login, date: i.updated_at, draft: !!i.draft });

  if (kind === 'issues') {
    // `/repos/{u}/{r}/issues` mixes pull requests in, so a page of it can hold few issues or none at all.
    // The search pages over issues only, which keeps every page full and "no open issues" true.
    const res = await ghFetch(`/search/issues?q=${issuesQuery(user, repo)}&sort=created&order=desc&${paging}`);
    const raw = (await res.json()) as { total_count?: number; items?: any[] };
    return {
      items: (raw.items ?? []).filter((i) => !i.pull_request).map(toItem),
      hasMore: hasNext(res) || p * ITEMS_PER_PAGE < (raw.total_count ?? 0),
    };
  }

  const res = await ghFetch(`${base}/pulls?state=open&${paging}`);
  return { items: ((await res.json()) as any[]).map(toItem), hasMore: hasNext(res) };
}

/** Search query (already URL-encoded) for the open issues of one repo, pull requests excluded. */
export const issuesQuery = (user: string, repo: string): string => encodeURIComponent(`repo:${user}/${repo} type:issue state:open`);

/** Re-runs the failed jobs of a workflow run. Needs a token that can write Actions. */
export async function rerunFailed(user: string, repo: string, runId: number): Promise<{ ok: boolean; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Necesitas un token de GitHub con permiso de Actions: guárdalo en Settings.' };
  if (!Number.isInteger(runId) || runId <= 0) return { ok: false, error: 'Ejecución no válida' };
  try {
    const res = await timedFetch(`${API}/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/actions/runs/${runId}/rerun-failed-jobs`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DevPanel', Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true };
    // checked before the permission branch: a rate-limited 403 is not "your token lacks Actions: write"
    const reset = rateLimitReset(res.status, res.headers, await res.text().catch(() => ''));
    if (reset !== null) return { ok: false, error: rateLimitMessage(reset) };
    if (res.status === 403 || res.status === 401) return { ok: false, error: 'Tu token no tiene permiso para reintentar workflows (Actions: write).' };
    if (res.status === 404) return { ok: false, error: 'No se encontró esa ejecución.' };
    return { ok: false, error: `GitHub respondió ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message === TIMEOUT_MESSAGE ? TIMEOUT_MESSAGE : 'No se pudo contactar a GitHub' };
  }
}
