import type { CommitPage, FailingRun, GithubProfile, PullSummary, Repo, WorkflowRun } from '../shared/api';

import type { RunInfo } from './alerts-core';
import { getToken, tokenOwns } from './token';

const API = process.env.DEVPANEL_GITHUB_API ?? 'https://api.github.com';

// Conditional requests: GitHub answers 304 (which does not count against the rate limit) when nothing changed.
const etags = new Map<string, { etag: string; body: string; link: string | null }>();

async function ghFetch(path: string): Promise<Response> {
  const token = getToken();
  const key = `${token ? 't' : 'p'}:${path}`; // a token can change what the same URL returns
  const cached = etags.get(key);
  const res = await fetch(`${API}${path}`, {
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
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
  const etag = res.headers.get('etag');
  if (etag) etags.set(key, { etag, body: await res.clone().text(), link: res.headers.get('link') });
  return res;
}

async function gh<T>(path: string): Promise<T> {
  return (await (await ghFetch(path)).json()) as T;
}

export function listRepos(user: string): Promise<Repo[]> {
  if (!user) return Promise.reject(new Error('Vincula tu usuario de GitHub en Settings'));
  // with the owner's token the private repos are included too
  if (tokenOwns(user)) return gh<Repo[]>('/user/repos?sort=pushed&per_page=100&affiliation=owner');
  return gh<Repo[]>(`/users/${encodeURIComponent(user)}/repos?sort=pushed&per_page=100`);
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
  const repos = (await listRepos(user))
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
