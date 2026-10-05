import type { Repo, UpdateStatus, WorkflowRun } from '../shared/api';
import { hydrateIcons, icon } from './icons.js';

// Inside Electron the preload exposes window.devpanel; on the web we use the browser implementation.
if (!window.devpanel) {
  const { createWebApi } = await import('./web-api.js');
  window.devpanel = createWebApi();
}
const api = window.devpanel;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', undefined, text) as HTMLAnchorElement;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'justo ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

function toast(message: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
  const t = el('div', `toast ${kind}`, message);
  $('toasts').append(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 250);
  }, 3750);
}

// ---------- Theme ----------
function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  const btn = $('theme-toggle');
  btn.replaceChildren(icon(theme === 'dark' ? 'moon' : 'sun'));
  try {
    localStorage.setItem('devpanel.theme', theme);
  } catch {
    /* storage unavailable */
  }
}

function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('devpanel.theme');
  } catch {
    /* storage unavailable */
  }
  applyTheme(saved === 'light' ? 'light' : 'dark');
  $('theme-toggle').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

// ---------- Stats (animated counters) ----------
function countUp(node: HTMLElement, to: number): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) {
    node.textContent = String(to);
    return;
  }
  const start = performance.now();
  const dur = 700;
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    node.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderStats(repos: Repo[]): void {
  const week = Date.now() - 7 * 86_400_000;
  const items: [string, number][] = [
    ['Proyectos', repos.length],
    ['Activos esta semana', repos.filter((r) => new Date(r.pushed_at).getTime() > week).length],
    ['Lenguajes', new Set(repos.map((r) => r.language).filter(Boolean)).size],
  ];
  $('stats').replaceChildren(
    ...items.map(([label, value], i) => {
      const card = el('div', 'stat');
      card.style.setProperty('--i', String(i));
      const num = el('div', 'num', '0');
      card.append(num, el('div', 'label', label));
      countUp(num, value);
      return card;
    }),
  );
  $('subtitle').textContent = repos.length
    ? `Última actividad ${ago(repos[0].pushed_at)}`
    : '';
}

function friendlyError(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  if (m.includes('403')) return 'Límite de la API de GitHub alcanzado (60/hora sin token). Intenta más tarde.';
  if (m.includes('404')) return 'Usuario o repositorio no encontrado.';
  return `No se pudo cargar GitHub: ${m}`;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Dart: '#00b4ab', Python: '#3572a5',
  HTML: '#e34c26', CSS: '#563d7c', Java: '#b07219', Kotlin: '#a97bff', Swift: '#f05138',
};

// ---------- Lock screen (desktop) ----------
async function initLock(): Promise<void> {
  const st = await api.face.status();
  if (!st.enrolled) return showApp();

  $('lock').classList.remove('hidden');
  const msg = $('lock-msg');
  const faceBtn = $<HTMLButtonElement>('lock-face');

  const unlock = () => {
    $('lock').classList.add('hidden');
    void showApp();
  };

  const tryFace = async () => {
    faceBtn.disabled = true;
    $('face-ring').classList.add('scanning');
    msg.textContent = 'Mirando… quédate frente a la cámara';
    const r = await api.face.verify();
    $('face-ring').classList.remove('scanning');
    faceBtn.disabled = false;
    if (r.ok) return unlock();
    msg.textContent = r.error ?? 'No te reconocí, intenta de nuevo o usa el PIN';
  };

  const tryPin = async () => {
    const r = await api.face.unlockWithPin($<HTMLInputElement>('lock-pin').value);
    if (r.ok) unlock();
    else msg.textContent = r.error ?? 'PIN incorrecto';
  };

  faceBtn.onclick = tryFace;
  $('lock-pin-btn').onclick = tryPin;
  $('lock-pin').addEventListener('keydown', (e) => e.key === 'Enter' && void tryPin());
  void tryFace();
}

// ---------- App ----------
let appShown = false;
let allRepos: Repo[] = [];

async function showApp(): Promise<void> {
  if (appShown) return;
  appShown = true;
  $('app').classList.remove('hidden');

  const web = api.platform === 'web';
  $('platform-badge').textContent = web ? 'Versión web' : 'App de escritorio';
  $('version').textContent = web ? '' : `v${await api.version()}`;
  $('face-card').classList.toggle('hidden', web);
  $('update-check').classList.toggle('hidden', web);
  if (web) $('update-msg').textContent = 'La versión web siempre está en la última versión.';

  const s = await api.settings.get();
  $<HTMLInputElement>('gh-user').value = s.githubUser;
  await Promise.all([loadRepos(), refreshFaceStatus()]);
}

document.querySelectorAll<HTMLButtonElement>('.nav').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav').forEach((n) => n.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $(`view-${b.dataset.view}`).classList.remove('hidden');
  };
});

// "/" focuses the search box
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.key === '/' && tag !== 'INPUT') {
    e.preventDefault();
    $('repo-search').focus();
  }
});

function skeletons(n = 6): HTMLElement[] {
  return Array.from({ length: n }, () => el('div', 'repo skeleton'));
}

function renderRepos(): void {
  const q = $<HTMLInputElement>('repo-search').value.trim().toLowerCase();
  const sort = $<HTMLSelectElement>('repo-sort').value;
  const byFav = (a: Repo, b: Repo) => Number(favs.has(b.name)) - Number(favs.has(a.name));
  const sorted = [...allRepos].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'fav'
        ? byFav(a, b) || b.pushed_at.localeCompare(a.pushed_at)
        : b.pushed_at.localeCompare(a.pushed_at),
  );
  const list = sorted.filter((r) =>
    `${r.name} ${r.description ?? ''} ${r.language ?? ''}`.toLowerCase().includes(q),
  );
  const box = $('repos');
  if (list.length === 0) {
    box.replaceChildren(el('p', 'empty', q ? 'Ningún proyecto coincide con tu búsqueda.' : 'No hay repositorios públicos para mostrar.'));
    return;
  }
  box.replaceChildren(
    ...list.map((r, i) => {
      const card = el('div', 'repo');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), card.click());
      card.style.setProperty('--i', String(Math.min(i, 14)));

      const top = el('div', 'top');
      top.append(el('div', 'name', r.name));
      if (Date.now() - new Date(r.pushed_at).getTime() < 86_400_000) {
        const live = el('span', 'live');
        live.title = 'Actividad en las últimas 24 h';
        top.append(live);
      }

      const lang = el('span', 'lang');
      const dot = el('span', 'dot');
      dot.style.background = LANG_COLORS[r.language ?? ''] ?? '#6b7280';
      lang.append(dot, r.language ?? '—');
      const branch = el('span', 'branch');
      branch.append(icon('branch'), r.default_branch);
      branch.querySelector('svg')!.setAttribute('width', '13');
      const meta = el('div', 'meta');
      meta.append(lang, branch, el('span', undefined, ago(r.pushed_at)));

      const star = el('button', `star${favs.has(r.name) ? ' on' : ''}`, favs.has(r.name) ? '★' : '☆');
      star.setAttribute('aria-label', 'Marcar como favorito');
      star.onclick = (e) => {
        e.stopPropagation();
        toggleFav(r.name);
      };
      top.append(star);

      card.append(top, el('div', 'desc', r.description ?? 'Sin descripción'), meta);
      card.addEventListener('pointermove', (e) => {
        const b = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - b.left}px`);
        card.style.setProperty('--my', `${e.clientY - b.top}px`);
      });
      card.onclick = () => {
        document.querySelectorAll('.repo.selected').forEach((n) => n.classList.remove('selected'));
        card.classList.add('selected');
        void showDetail(r);
      };
      return card;
    }),
  );
}

async function loadRepos(): Promise<void> {
  $('repos').replaceChildren(...skeletons());
  try {
    allRepos = await api.github.repos();
    renderStats(allRepos);
    renderRepos();
  } catch (e) {
    $('repos').replaceChildren(el('p', 'empty', friendlyError(e)));
  }
}

$('repo-search').addEventListener('input', renderRepos);
$('repo-sort').addEventListener('change', renderRepos);

// ---------- Favorites (stored per device) ----------
const favs = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem('devpanel.favs') ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);

function toggleFav(name: string): void {
  if (!favs.delete(name)) favs.add(name);
  try {
    localStorage.setItem('devpanel.favs', JSON.stringify([...favs]));
  } catch {
    /* storage unavailable */
  }
  renderRepos();
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'ok');
  } catch {
    toast('No se pudo copiar', 'bad');
  }
}

function runBadge(run?: WorkflowRun): HTMLElement {
  if (!run) return el('span', 'badge warn', 'Sin Actions');
  if (run.status !== 'completed') {
    const b = el('span', 'badge warn');
    b.append(el('span', 'live'), 'En curso');
    return b;
  }
  return run.conclusion === 'success'
    ? el('span', 'badge ok', 'Build passing')
    : el('span', 'badge bad', `Build ${run.conclusion}`);
}

async function showDetail(repo: Repo): Promise<void> {
  const d = $('detail');
  d.classList.remove('hidden');
  d.replaceChildren(el('div', 'skeleton block'));
  d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const [commits, runs] = await Promise.all([
      api.github.commits(repo.name),
      api.github.runs(repo.name),
    ]);
    const head = el('div', 'detail-head');
    const ext = (href: string, text: string) => {
      const a = link(href, text);
      a.append(icon('external'));
      a.querySelector('svg')!.setAttribute('width', '13');
      return a;
    };
    head.append(el('h3', undefined, repo.name), runBadge(runs[0]), ext(repo.html_url, 'GitHub'));
    if (runs[0]) head.append(ext(runs[0].html_url, 'Actions'));

    const cloneUrl = `${repo.html_url}.git`;
    const actions = el('div', 'actions');
    const copyClone = el('button', 'btn small', 'Copiar git clone');
    copyClone.onclick = () => void copyText(`git clone ${cloneUrl}`);
    const vscode = link(`vscode://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}`, 'Abrir en VS Code');
    vscode.className = 'btn small';
    const copyLink = el('button', 'btn small', 'Copiar enlace');
    copyLink.onclick = () => void copyText(repo.html_url);
    actions.append(copyClone, vscode, copyLink);
    head.append(actions);
    d.replaceChildren(
      head,
      ...(commits.length
        ? commits.map((c, i) => {
            const row = el('div', 'commit');
            row.style.setProperty('--i', String(i));
            const sha = link(c.url, c.sha);
            sha.className = 'sha';
            row.append(sha, el('span', 'msg', c.message), el('span', 'muted', `${c.author} · ${ago(c.date)}`));
            return row;
          })
        : [el('p', 'empty', 'Sin commits.')]),
    );
  } catch (e) {
    d.replaceChildren(el('p', 'empty', friendlyError(e)));
  }
}

// ---------- Settings ----------
async function saveUser(): Promise<void> {
  await api.settings.set({ githubUser: $<HTMLInputElement>('gh-user').value.trim() });
  $('detail').classList.add('hidden');
  toast('Usuario de GitHub guardado', 'ok');
  await loadRepos();
}
$('gh-save').onclick = () => void saveUser();
$('gh-user').addEventListener('keydown', (e) => e.key === 'Enter' && void saveUser());

async function refreshFaceStatus(): Promise<void> {
  const st = await api.face.status();
  $('face-status').textContent = st.enrolled
    ? 'Rostro registrado. La app pedirá tu rostro al abrir.'
    : 'Sin rostro registrado. La app abre sin bloqueo.';
}

$('face-enroll').onclick = async () => {
  const msg = $('face-msg');
  const btn = $<HTMLButtonElement>('face-enroll');
  btn.disabled = true;
  msg.textContent = 'Mira a la cámara y mueve un poco la cabeza…';
  const r = await api.face.enroll($<HTMLInputElement>('face-pin').value);
  btn.disabled = false;
  msg.textContent = '';
  toast(r.ok ? 'Rostro registrado' : (r.error ?? 'Error'), r.ok ? 'ok' : 'bad');
  await refreshFaceStatus();
};

$('face-remove').onclick = async () => {
  await api.face.remove();
  toast('Datos faciales eliminados', 'info');
  await refreshFaceStatus();
};

// ---------- Updates (desktop) ----------
function renderUpdate(s: UpdateStatus): void {
  const box = $('update-box');
  const msg = $('update-msg');
  box.classList.add('hidden');
  box.replaceChildren();

  switch (s.state) {
    case 'dev': msg.textContent = 'Modo desarrollo: el actualizador solo funciona en la app instalada.'; break;
    case 'checking': msg.textContent = 'Buscando actualizaciones…'; break;
    case 'none': msg.textContent = 'Estás en la última versión.'; break;
    case 'error': msg.textContent = `Error al actualizar: ${s.message}`; break;
    case 'available': {
      msg.textContent = `Nueva versión ${s.version} disponible.`;
      box.classList.remove('hidden');
      const b = el('button', 'btn primary', 'Descargar');
      b.onclick = () => void api.update.download();
      box.append(el('div', undefined, `Nueva versión v${s.version}`), b);
      break;
    }
    case 'downloading':
      msg.textContent = `Descargando… ${s.percent}%`;
      box.classList.remove('hidden');
      box.append(el('div', undefined, `Descargando… ${s.percent}%`));
      break;
    case 'ready': {
      msg.textContent = `v${s.version} lista para instalar.`;
      box.classList.remove('hidden');
      const b = el('button', 'btn primary', 'Reiniciar y actualizar');
      b.onclick = () => void api.update.install();
      box.append(el('div', undefined, `v${s.version} descargada`), b);
      break;
    }
  }
}

api.update.onStatus(renderUpdate);
$('update-check').onclick = () => void api.update.check();

hydrateIcons();
initTheme();
void initLock();
