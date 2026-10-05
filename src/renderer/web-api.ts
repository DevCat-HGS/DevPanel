import type { Commit, DevPanelApi, Repo, Settings, WorkflowRun } from '../shared/api';

/**
 * Browser implementation of the DevPanel API, used when the renderer runs on
 * the web (Netlify) instead of inside Electron. GitHub's public API allows CORS.
 */
const API = 'https://api.github.com';
const SETTINGS_KEY = 'devpanel.settings';
const defaults: Settings = { githubUser: 'DevCat-HGS' };

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as T;
}

function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}

export function createWebApi(): DevPanelApi {
  const user = () => encodeURIComponent(loadSettings().githubUser);
  const noop = async () => {};

  return {
    platform: 'web',
    version: async () => 'web',
    settings: {
      get: async () => loadSettings(),
      set: async (patch) => {
        const next = { ...loadSettings(), ...patch };
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch {
          /* storage blocked: keep going with in-memory value */
        }
        return next;
      },
    },
    github: {
      repos: () => gh<Repo[]>(`/users/${user()}/repos?sort=pushed&per_page=30`),
      commits: async (repo): Promise<Commit[]> => {
        const raw = await gh<any[]>(`/repos/${user()}/${encodeURIComponent(repo)}/commits?per_page=10`);
        return raw.map((c) => ({
          sha: c.sha.slice(0, 7),
          message: String(c.commit.message).split('\n')[0],
          author: c.commit.author?.name ?? 'unknown',
          date: c.commit.author?.date ?? '',
          url: c.html_url,
        }));
      },
      runs: async (repo): Promise<WorkflowRun[]> => {
        const raw = await gh<{ workflow_runs: any[] }>(
          `/repos/${user()}/${encodeURIComponent(repo)}/actions/runs?per_page=5`,
        );
        return raw.workflow_runs.map((r) => ({
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          html_url: r.html_url,
          updated_at: r.updated_at,
        }));
      },
    },
    // Face login relies on the desktop Python module; the web build has no lock screen.
    face: {
      status: async () => ({ enrolled: false, pinSet: false }),
      enroll: async () => ({ ok: false, error: 'El login facial solo está en la app de escritorio' }),
      verify: async () => ({ ok: false, error: 'No disponible en la web' }),
      unlockWithPin: async () => ({ ok: false, error: 'No disponible en la web' }),
      remove: noop,
    },
    // The web build is always the latest deploy.
    update: {
      check: noop,
      download: noop,
      install: noop,
      onStatus: () => {},
    },
  };
}
