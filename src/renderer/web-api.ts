import type { Commit, DevPanelApi, Repo, Settings, WorkflowRun } from '../shared/api';

/**
 * Browser implementation of the DevPanel API, used when the renderer runs on
 * the web (Netlify) instead of inside Electron. GitHub's public API allows CORS.
 */
const API = 'https://api.github.com';
const SETTINGS_KEY = 'devpanel.settings';
const defaults: Settings = {
  githubUser: '',
  onboarded: false,
  alertsEnabled: false,
  closeToTray: false,
  openAtLogin: false,
  localProjects: [],
  lastSeenVersion: '',
  language: 'auto',
};

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
      lookup: async (input) => {
        const t = input.trim().replace(/^@/, '');
        const m = t.match(/github\.com\/([A-Za-z0-9-]{1,39})/i);
        const user = m ? m[1] : t;
        if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user))
          throw new Error('Escribe un usuario o enlace de GitHub válido');
        try {
          const u = await gh<{ login: string; name: string | null; avatar_url: string }>(`/users/${encodeURIComponent(user)}`);
          return { login: u.login, name: u.name, avatar: u.avatar_url };
        } catch {
          throw new Error(`No existe el usuario "${user}" en GitHub`);
        }
      },
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
      setPin: async () => ({ ok: false, error: 'El código solo está en la app de escritorio' }),
      enroll: async () => ({ ok: false, error: 'El login facial solo está en la app de escritorio' }),
      verify: async () => ({ ok: false, error: 'No disponible en la web' }),
      unlockWithPin: async () => ({ ok: false, error: 'No disponible en la web' }),
      remove: noop,
    },
    app: { onHidden: () => {}, onCheckUpdates: () => {}, onSettingsChanged: () => {} },
    token: {
      status: async () => ({ has: false }),
      set: async () => ({ ok: false, error: 'El token solo está disponible en la app de escritorio' }),
      clear: async () => {},
    },
    alerts: { check: async () => {}, onFailure: () => {} },
    local: {
      list: async () => [],
      add: async () => null,
      remove: async () => {},
      git: async () => ({ ok: false, output: 'Solo disponible en la app de escritorio' }),
      run: async () => ({ error: 'Solo disponible en la app de escritorio' }),
      stop: async () => {},
      open: async () => {},
      onOutput: () => {},
      onExit: () => {},
    },
    env: { check: async () => [] },
    // The web build is always the latest deploy.
    update: {
      check: noop,
      download: noop,
      install: noop,
      channel: async () => ({ channel: 'stable' as const, allowed: true }),
      onStatus: () => {},
    },
  };
}
