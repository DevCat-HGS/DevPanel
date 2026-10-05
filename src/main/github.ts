import type { Commit, Repo, WorkflowRun } from '../shared/api';

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
