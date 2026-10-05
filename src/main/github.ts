import type { Commit, GithubProfile, Repo, WorkflowRun } from '../shared/api';

const API = 'https://api.github.com';

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DevPanel',
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
  return (await res.json()) as T;
}

export function listRepos(user: string): Promise<Repo[]> {
  if (!user) return Promise.reject(new Error('Vincula tu usuario de GitHub en Settings'));
  return gh<Repo[]>(
    `/users/${encodeURIComponent(user)}/repos?sort=pushed&per_page=30`,
  );
}

export async function listCommits(user: string, repo: string): Promise<Commit[]> {
  const raw = await gh<any[]>(
    `/repos/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/commits?per_page=10`,
  );
  return raw.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: String(c.commit.message).split('\n')[0],
    author: c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
  }));
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
