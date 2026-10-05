import type { Repo, UpdateStatus, WorkflowRun } from '../shared/api';

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
  setTimeout(() => t.remove(), 4000);
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
    msg.textContent = 'Mirando… quédate frente a la cámara';
    const r = await api.face.verify();
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
  const list = allRepos.filter((r) =>
    `${r.name} ${r.description ?? ''} ${r.language ?? ''}`.toLowerCase().includes(q),
  );
  const box = $('repos');
  if (list.length === 0) {
    box.replaceChildren(el('p', 'empty', q ? 'Ningún proyecto coincide con tu búsqueda.' : 'No hay repositorios públicos para mostrar.'));
    return;
  }
  box.replaceChildren(
    ...list.map((r) => {
      const card = el('button', 'repo');
      const lang = el('span', 'lang');
      const dot = el('span', 'dot');
      dot.style.background = LANG_COLORS[r.language ?? ''] ?? '#6b7280';
      lang.append(dot, r.language ?? '—');
      card.append(
        el('div', 'name', r.name),
        el('div', 'desc', r.description ?? 'Sin descripción'),
        (() => {
          const meta = el('div', 'meta');
          meta.append(lang, ` · ${r.default_branch} · ${ago(r.pushed_at)}`);
          return meta;
        })(),
      );
      card.onclick = () => void showDetail(r);
      return card;
    }),
  );
}

async function loadRepos(): Promise<void> {
  $('repos').replaceChildren(...skeletons());
  try {
    allRepos = await api.github.repos();
    renderRepos();
  } catch (e) {
    $('repos').replaceChildren(el('p', 'empty', friendlyError(e)));
  }
}

$('repo-search').addEventListener('input', renderRepos);

function runBadge(run?: WorkflowRun): HTMLElement {
  if (!run) return el('span', 'badge warn', 'Sin Actions');
  if (run.status !== 'completed') return el('span', 'badge warn', 'En curso');
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
    head.append(el('h3', undefined, repo.name), runBadge(runs[0]), link(repo.html_url, 'Abrir en GitHub ↗'));
    if (runs[0]) head.append(link(runs[0].html_url, 'Ver Actions ↗'));
    d.replaceChildren(
      head,
      ...(commits.length
        ? commits.map((c) => {
            const row = el('div', 'commit');
            row.append(link(c.url, c.sha), c.message, el('span', 'muted', ` — ${c.author}, ${ago(c.date)}`));
            row.firstElementChild!.className = 'sha';
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

void initLock();
