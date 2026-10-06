import { CATALOG } from './catalog.js';
import type { CommitPage, DevPanelApi, FailingRun, PullSummary, Repo, Settings, WorkflowRun } from '../shared/api';

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
  faceLiveness: false,
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
      repos: () => gh<Repo[]>(`/users/${user()}/repos?sort=pushed&per_page=100`),
      commits: async (repo, page = 1): Promise<CommitPage> => {
        const res = await fetch(`${API}/repos/${user()}/${encodeURIComponent(repo)}/commits?per_page=8&page=${Math.max(1, page)}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const raw = (await res.json()) as any[];
        return {
          commits: raw.map((c) => ({
            sha: c.sha.slice(0, 7),
            message: String(c.commit.message).split('\n')[0],
            author: c.commit.author?.name ?? 'unknown',
            date: c.commit.author?.date ?? '',
            url: c.html_url,
          })),
          hasMore: /rel="next"/.test(res.headers.get('link') ?? ''),
        };
      },
      items: async (repo, kind, page = 1) => {
        const base = `${API}/repos/${user()}/${encodeURIComponent(repo)}`;
        const paging = `per_page=8&page=${Math.max(1, page)}`;
        const res = await fetch(kind === 'runs' ? `${base}/actions/runs?${paging}` : `${base}/${kind === 'pulls' ? 'pulls' : 'issues'}?state=open&${paging}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const json = await res.json();
        const hasMore = /rel="next"/.test(res.headers.get('link') ?? '');
        if (kind === 'runs')
          return { hasMore, items: (json.workflow_runs as any[]).map((r) => ({ id: r.id, title: r.name, url: r.html_url, date: r.updated_at, status: r.status, conclusion: r.conclusion, branch: r.head_branch })) };
        return {
          hasMore,
          items: (json as any[]).filter((i) => kind === 'pulls' || !i.pull_request).map((i) => ({ id: i.id, number: i.number, title: i.title, url: i.html_url, author: i.user?.login, date: i.updated_at, draft: !!i.draft })),
        };
      },
      rerun: async () => ({ ok: false, error: 'Solo disponible en la app de escritorio' }),
      failing: async () => {
        const repos = (await gh<Repo[]>(`/users/${user()}/repos?sort=pushed&per_page=8`)).filter((r) => !r.archived);
        const out: FailingRun[] = [];
        for (const r of repos) {
          try {
            const runs = await gh<{ workflow_runs: any[] }>(`/repos/${user()}/${encodeURIComponent(r.name)}/actions/runs?per_page=1`);
            const run = runs.workflow_runs[0];
            if (run && run.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion))
              out.push({ repo: r.name, url: run.html_url, branch: run.head_branch, updated: run.updated_at });
          } catch {
            /* repo without Actions */
          }
        }
        return out;
      },
      pulls: async (): Promise<PullSummary[]> => {
        const q = encodeURIComponent(`involves:${loadSettings().githubUser} type:pr state:open`);
        const res = await gh<{ items: any[] }>(`/search/issues?q=${q}&sort=updated&per_page=8`);
        return res.items.map((i) => ({
          repo: String(i.repository_url).split('/').slice(-1)[0], title: i.title, url: i.html_url,
          updated: i.updated_at, draft: !!i.draft, author: i.user?.login ?? '',
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
      onPrompt: () => {},
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
    claude: {
      run: async () => ({ error: 'Solo disponible en la app de escritorio' }),
      stop: async () => {},
      onEvent: () => {},
      onOutput: () => {},
      onExit: () => {},
    },
    health: {
      local: async () => ({ ok: false as const, error: 'Solo disponible en la app de escritorio' }),
      repo: async () => ({ ok: false as const, error: 'Solo disponible en la app de escritorio' }),
    },
    local: {
      list: async () => [],
      add: async () => null,
      remove: async () => {},
      git: async () => ({ ok: false, output: 'Solo disponible en la app de escritorio' }),
      run: async () => ({ error: 'Solo disponible en la app de escritorio' }),
      recipe: async () => ({ error: 'Solo disponible en la app de escritorio' }),
      branches: async () => ({ current: '', all: [] }),
      checkout: async () => ({ ok: false, output: 'Solo disponible en la app de escritorio' }),
      commit: async () => ({ ok: false, output: 'Solo disponible en la app de escritorio' }),
      push: async () => ({ ok: false, output: 'Solo disponible en la app de escritorio' }),
      l10n: async () => null,
      secrets: async () => [],
      stop: async () => {},
      open: async () => {},
      onOutput: () => {},
      onExit: () => {},
    },
    notes: { get: async () => null },
    // The web build cannot detect or install anything: cards are plain links.
    software: {
      detect: async () => [],
      install: async () => ({ ok: false, error: 'Solo disponible en la app de escritorio' }),
      upgrade: async () => ({ ok: false, error: 'Solo disponible en la app de escritorio' }),
      cancel: async () => {},
      open: async (id) => {
        const item = CATALOG.items.find((i) => i.id === id);
        if (item) window.open(item.url, '_blank', 'noopener,noreferrer');
      },
      onStatus: () => {},
      onProgress: () => {},
      onUpdate: () => {},
    },
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
