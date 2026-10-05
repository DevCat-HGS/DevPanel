import type { Repo, UpdateStatus, WorkflowRun } from '../shared/api';
import { $, copyText, el, toast } from './dom.js';
import { hydrateIcons, icon } from './icons.js';
import { runOnboarding } from './onboarding.js';
import { initPalette } from './palette.js';
import { analyzeRepos } from './recs.js';
import { initLocal } from './ui-local.js';
import { initEnvCheck, initTools, TOOLS } from './ui-tools.js';

// Inside Electron the preload exposes window.devpanel; on the web we use the browser implementation.
if (!window.devpanel) {
  const { createWebApi } = await import('./web-api.js');
  window.devpanel = createWebApi();
}
const api = window.devpanel;

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

// ---------- Lock screen (desktop): face + code ----------
async function initLock(): Promise<void> {
  const st = await api.face.status();
  if (!st.pinSet && !st.enrolled) return showApp();

  const s = await api.settings.get();
  const avatar = $<HTMLImageElement>('lock-avatar');
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = 'icon.png';
  };
  if (s.githubUser) avatar.src = `https://github.com/${encodeURIComponent(s.githubUser)}.png?size=240`;
  $('lock-title').textContent = s.githubUser ? `Hola, ${s.githubUser}` : 'Bienvenido';

  const lock = $('lock');
  const card = lock.querySelector('.lock-card') as HTMLElement;
  const ring = $('face-ring');
  const msg = $('lock-msg');
  const faceBtn = $<HTMLButtonElement>('lock-face');
  const pinInput = $<HTMLInputElement>('lock-pin');

  lock.classList.remove('hidden', 'leaving');
  ring.classList.remove('success', 'fail', 'scanning');
  pinInput.value = '';
  $('app').classList.add('hidden');
  faceBtn.classList.toggle('hidden', !st.enrolled);
  msg.textContent = st.enrolled ? 'Mira a la cámara para entrar' : 'Ingresa tu código para entrar';
  lock.querySelector('.divider')?.classList.toggle('hidden', !st.enrolled);
  if (!st.enrolled) msg.textContent = 'Ingresa tu código para entrar';

  const unlock = () => {
    ring.classList.remove('scanning');
    ring.classList.add('success');
    msg.textContent = '¡Bienvenido!';
    setTimeout(() => {
      lock.classList.add('leaving');
      setTimeout(() => {
        lock.classList.add('hidden');
        void showApp();
      }, 450);
    }, 750);
  };

  const fail = (text: string) => {
    ring.classList.remove('scanning');
    ring.classList.add('fail');
    setTimeout(() => ring.classList.remove('fail'), 500);
    msg.textContent = text;
  };

  const tryFace = async () => {
    faceBtn.disabled = true;
    ring.classList.add('scanning');
    msg.textContent = 'Mirando… quédate frente a la cámara';
    const r = await api.face.verify();
    faceBtn.disabled = false;
    if (r.ok) return unlock();
    fail(r.error ?? 'No te reconocí, intenta de nuevo o usa tu código');
  };

  const tryPin = async () => {
    const r = await api.face.unlockWithPin(pinInput.value);
    if (r.ok) return unlock();
    card.classList.remove('shake');
    void card.offsetWidth; // restart the animation
    card.classList.add('shake');
    pinInput.value = '';
    msg.textContent = r.error ?? 'Código incorrecto';
  };

  faceBtn.onclick = tryFace;
  $('lock-pin-btn').onclick = tryPin;
  pinInput.onkeydown = (e) => e.key === 'Enter' && void tryPin();
  if (!st.enrolled) pinInput.focus();
  else if (document.visibilityState === 'visible') void tryFace();
  else {
    // locked while hidden in the tray: never turn the camera on until the window is actually shown
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && !lock.classList.contains('hidden') && void tryFace(), { once: true });
  }
}

// ---------- App ----------
let appShown = false;
let allRepos: Repo[] = [];

async function showApp(): Promise<void> {
  $('app').classList.remove('hidden');
  if (appShown) return;
  appShown = true;

  const web = api.platform === 'web';
  $('platform-badge').textContent = web ? 'Versión web' : 'App de escritorio';
  $('version').textContent = web ? '' : `v${await api.version()}`;
  $('face-card').classList.toggle('hidden', web);
  $('update-check').classList.toggle('hidden', web);
  if (web) $('update-msg').textContent = 'La versión web siempre está en la última versión.';

  const s = await api.settings.get();
  $<HTMLInputElement>('gh-user').value = s.githubUser;
  initTools();
  initEnvCheck();
  initLocal();
  $('nav-local').classList.toggle('hidden', web);
  initPalette(paletteItems);
  void showChannel();
  void initPrefs();
  await Promise.all([loadRepos(), refreshFaceStatus()]);
}

// ---------- Preferences, token and alerts (desktop) ----------
async function refreshTokenStatus(): Promise<void> {
  const t = await api.token.status();
  $('token-status').textContent = t.has
    ? `Token guardado${t.login ? ` (cuenta @${t.login})` : ''}. Se usan tus repos privados y el límite alto de la API.`
    : 'Sin token: se usa el límite público de GitHub.';
}

async function initPrefs(): Promise<void> {
  const web = api.platform === 'web';
  $('token-card').classList.toggle('hidden', web);
  $('prefs-card').classList.toggle('hidden', web);
  if (web) return;

  const s = await api.settings.get();
  $<HTMLInputElement>('pref-alerts').checked = s.alertsEnabled;
  $('pref-alerts').onchange = async (e) => {
    await api.settings.set({ alertsEnabled: (e.target as HTMLInputElement).checked });
    toast((e.target as HTMLInputElement).checked ? 'Alertas de build activadas' : 'Alertas de build desactivadas', 'info');
  };

  $<HTMLInputElement>('pref-tray').checked = s.closeToTray;
  $<HTMLInputElement>('pref-login').checked = s.openAtLogin;
  $('pref-tray').onchange = (e) => void api.settings.set({ closeToTray: (e.target as HTMLInputElement).checked });
  $('pref-login').onchange = async (e) => {
    await api.settings.set({ openAtLogin: (e.target as HTMLInputElement).checked });
    toast((e.target as HTMLInputElement).checked ? 'DevPanel se abrirá con Windows' : 'Ya no se abrirá con Windows', 'info');
  };
  api.app.onSettingsChanged(async () => {
    $<HTMLInputElement>('pref-alerts').checked = (await api.settings.get()).alertsEnabled;
  });
  api.app.onCheckUpdates(() => void api.update.check());

  await refreshTokenStatus();
  $('token-save').onclick = async () => {
    const r = await api.token.set($<HTMLInputElement>('token-input').value);
    toast(r.ok ? `Token guardado para @${r.login}` : (r.error ?? 'No se pudo guardar'), r.ok ? 'ok' : 'bad');
    if (r.ok) {
      $<HTMLInputElement>('token-input').value = '';
      void refreshTokenStatus();
      void loadRepos();
    }
  };
  $('token-clear').onclick = async () => {
    await api.token.clear();
    toast('Token eliminado', 'info');
    void refreshTokenStatus();
    void loadRepos();
  };

  api.alerts.onFailure((f) => toast(`Build fallido en ${f.repo}`, 'bad'));
}

async function showChannel(): Promise<void> {
  if (api.platform === 'web') return;
  const c = await api.update.channel();
  $('channel-info').textContent =
    c.channel === 'dev'
      ? c.allowed
        ? 'Canal: Desarrollo (cambios adelantados, solo para tu cuenta).'
        : 'Canal: Desarrollo, reservado para DevCat-HGS. Esta cuenta recibirá solo versiones estables.'
      : 'Canal: Estable.';
}

function goView(name: string): void {
  document.querySelector<HTMLButtonElement>(`.nav[data-view="${name}"]`)?.click();
}

function paletteItems() {
  return [
    { label: 'Ir a Projects', hint: 'vista', run: () => goView('projects') },
    { label: 'Ir a Herramientas', hint: 'vista', run: () => goView('tools') },
    ...(api.platform === 'web' ? [] : [{ label: 'Ir a Proyectos locales', hint: 'vista', run: () => goView('local') }]),
    { label: 'Ir a Settings', hint: 'vista', run: () => goView('settings') },
    { label: 'Cambiar tema claro / oscuro', hint: 'acción', run: () => $('theme-toggle').click() },
    { label: 'Recargar proyectos', hint: 'acción', run: () => void loadRepos() },
    ...TOOLS.map((t) => ({
      label: `Herramienta: ${t.label}`,
      hint: t.hint,
      run: () => {
        goView('tools');
        document.querySelector<HTMLButtonElement>(`.tool-btn[data-id="${t.id}"]`)?.click();
      },
    })),
    ...allRepos.map((r) => ({
      label: r.name,
      hint: 'proyecto',
      run: () => {
        goView('projects');
        void showDetail(r);
      },
    })),
  ];
}

function renderRecs(): void {
  const box = $('recs');
  const recs = analyzeRepos(allRepos);
  if (!recs.length) return box.classList.add('hidden');
  box.classList.remove('hidden');
  const summary = el('summary', undefined, `Recomendaciones (${recs.length})`);
  const ul = el('ul');
  ul.append(
    ...recs.map((x) => {
      const li = el('li');
      li.append(el('span', `lvl ${x.level}`), el('b', undefined, x.repo), el('span', 'muted', x.text));
      li.onclick = () => {
        const repo = allRepos.find((r) => r.name === x.repo);
        if (repo) void showDetail(repo);
      };
      return li;
    }),
  );
  box.replaceChildren(summary, ul);
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
      if (r.private) top.append(el('span', 'chip priv', 'privado'));
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
    renderRecs();
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
  try {
    const p = await api.github.lookup($<HTMLInputElement>('gh-user').value);
    await api.settings.set({ githubUser: p.login });
    $<HTMLInputElement>('gh-user').value = p.login;
    $('detail').classList.add('hidden');
    toast(`Vinculado a @${p.login}`, 'ok');
    await loadRepos();
    void showChannel();
  } catch (e) {
    toast((e as Error).message, 'bad');
  }
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
  const r = await api.face.enroll($<HTMLInputElement>('face-pin').value || undefined);
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
async function boot(): Promise<void> {
  const s = await api.settings.get();
  if (!s.onboarded) {
    await runOnboarding();
    return showApp(); // just configured: no need to lock in this session
  }
  await initLock();
}

// Hidden to the tray / by the global shortcut: lock again so the panel is never left open.
api.app.onHidden(async () => {
  if (!appShown) return;
  const st = await api.face.status();
  if (st.pinSet || st.enrolled) void initLock();
});

void boot();
