import type { CommitPage, GithubProfile, Repo, WorkflowRun } from '../shared/api';

import { getToken, tokenOwns } from './token';

const API = process.env.DEVPANEL_GITHUB_API ?? 'https://api.github.com';

async function ghFetch(path: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DevPanel',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
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
