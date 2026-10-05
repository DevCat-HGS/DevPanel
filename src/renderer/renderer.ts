import type { UpdateStatus, WorkflowRun } from '../shared/api';

const api = window.devpanel;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

// ---------- Lock screen ----------
async function initLock(): Promise<void> {
  const st = await api.face.status();
  if (!st.enrolled) return showApp();

  $('lock').classList.remove('hidden');
  const msg = $('lock-msg');
  const faceBtn = $<HTMLButtonElement>('lock-face');

  const tryFace = async () => {
    faceBtn.disabled = true;
    msg.textContent = 'Mirando… quédate frente a la cámara';
    const r = await api.face.verify();
    faceBtn.disabled = false;
    if (r.ok) return unlock();
    msg.textContent = r.error ?? 'No te reconocí, intenta de nuevo o usa el PIN';
  };

  const unlock = () => {
    $('lock').classList.add('hidden');
    showApp();
  };

  faceBtn.onclick = tryFace;
  $('lock-pin-btn').onclick = async () => {
    const r = await api.face.unlockWithPin($<HTMLInputElement>('lock-pin').value);
    if (r.ok) unlock();
    else msg.textContent = r.error ?? 'PIN incorrecto';
  };
  void tryFace();
}

// ---------- App ----------
let appShown = false;
async function showApp(): Promise<void> {
  if (appShown) return;
  appShown = true;
  $('app').classList.remove('hidden');
  $('version').textContent = `v${await api.version()}`;
  $('greeting').textContent = 'Tus proyectos';
  await loadRepos();
  await refreshFaceStatus();
  const s = await api.settings.get();
  $<HTMLInputElement>('gh-user').value = s.githubUser;
}

document.querySelectorAll<HTMLButtonElement>('.nav').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav').forEach((n) => n.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $(`view-${b.dataset.view}`).classList.remove('hidden');
  };
});

async function loadRepos(): Promise<void> {
  const box = $('repos');
  box.replaceChildren(el('p', 'muted', 'Cargando…'));
  try {
    const repos = await api.github.repos();
    box.replaceChildren(
      ...repos.map((r) => {
        const card = el('div', 'repo');
        card.append(
          el('div', 'name', r.name),
          el('div', 'muted', r.description ?? 'Sin descripción'),
          el('div', 'meta', `${r.language ?? '—'} · ${r.default_branch} · ${ago(r.pushed_at)}`),
        );
        card.onclick = () => void showDetail(r.name);
        return card;
      }),
    );
  } catch (e) {
    box.replaceChildren(el('p', 'muted', `No se pudo cargar GitHub: ${(e as Error).message}`));
  }
}

function runBadge(run?: WorkflowRun): HTMLElement {
  if (!run) return el('span', 'badge warn', 'Sin Actions');
  if (run.status !== 'completed') return el('span', 'badge warn', 'En curso');
  return run.conclusion === 'success'
    ? el('span', 'badge ok', 'Build passing')
    : el('span', 'badge bad', `Build ${run.conclusion}`);
}

async function showDetail(repo: string): Promise<void> {
  const d = $('detail');
  d.classList.remove('hidden');
  d.replaceChildren(el('p', 'muted', 'Cargando…'));
  try {
    const [commits, runs] = await Promise.all([api.github.commits(repo), api.github.runs(repo)]);
    const head = el('h3', undefined, repo);
    head.append(' ', runBadge(runs[0]));
    d.replaceChildren(
      head,
      ...commits.map((c) => {
        const row = el('div', 'commit');
        row.append(el('span', 'sha', c.sha), c.message);
        row.append(el('span', 'muted', ` — ${c.author}, ${ago(c.date)}`));
        return row;
      }),
    );
  } catch (e) {
    d.replaceChildren(el('p', 'muted', `Error: ${(e as Error).message}`));
  }
}

// ---------- Settings ----------
$('gh-save').onclick = async () => {
  await api.settings.set({ githubUser: $<HTMLInputElement>('gh-user').value.trim() });
  $('detail').classList.add('hidden');
  await loadRepos();
};

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
  msg.textContent = r.ok ? 'Rostro registrado ✔' : (r.error ?? 'Error');
  await refreshFaceStatus();
};

$('face-remove').onclick = async () => {
  await api.face.remove();
  $('face-msg').textContent = 'Datos faciales eliminados';
  await refreshFaceStatus();
};

// ---------- Updates ----------
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
