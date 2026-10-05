import type { LocalProject } from '../shared/api';
import { $, el, toast } from './dom.js';

const api = () => window.devpanel;
let activeRun: number | null = null;

function term(text: string, cls = ''): void {
  const out = $('term-out');
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  out.append(span);
  // keep the buffer bounded
  while (out.childNodes.length > 400) out.firstChild?.remove();
  out.scrollTop = out.scrollHeight;
}

function setRunning(id: number | null, label = ''): void {
  activeRun = id;
  $('term-title').textContent = id ? `Ejecutando: ${label}` : 'Terminal';
  $<HTMLButtonElement>('term-stop').disabled = id === null;
  document.querySelectorAll<HTMLButtonElement>('.script-btn').forEach((b) => (b.disabled = id !== null));
}

async function run(path: string, script: string): Promise<void> {
  if (activeRun !== null) return;
  term(`\n$ npm run ${script}\n`, 'cmd');
  const r = await api().local.run(path, script);
  if ('error' in r) return term(`${r.error}\n`, 'err');
  setRunning(r.id, `npm run ${script}`);
}

async function git(path: string, action: 'fetch' | 'pull', btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  term(`\n$ git ${action}\n`, 'cmd');
  const r = await api().local.git(path, action);
  term(`${r.output}\n`, r.ok ? '' : 'err');
  toast(r.ok ? `git ${action} listo` : `git ${action} falló`, r.ok ? 'ok' : 'bad');
  btn.disabled = false;
  void refresh();
}

function card(p: LocalProject): HTMLElement {
  const c = el('div', 'local-card');
  const head = el('div', 'local-head');
  head.append(el('b', undefined, p.name), el('span', 'muted path', p.path));
  c.append(head);

  const chips = el('div', 'chips');
  if (!p.exists) chips.append(el('span', 'chip bad', 'carpeta no encontrada'));
  else if (!p.isGit) chips.append(el('span', 'chip', 'sin git'));
  else if (p.git) {
    chips.append(el('span', 'chip branch', `⎇ ${p.git.branch}`));
    chips.append(el('span', p.git.dirty ? 'chip warn' : 'chip ok', p.git.dirty ? `${p.git.dirty} cambios` : 'limpio'));
    if (p.git.ahead) chips.append(el('span', 'chip', `↑ ${p.git.ahead} por subir`));
    if (p.git.behind) chips.append(el('span', 'chip warn', `↓ ${p.git.behind} por bajar`));
    if (p.lastCommit) chips.append(el('span', 'muted', `${p.lastCommit.subject} · ${p.lastCommit.when}`));
  }
  c.append(chips);

  const row = el('div', 'actions');
  const mk = (label: string, fn: (b: HTMLButtonElement) => void, cls = 'btn small') => {
    const b = el('button', cls, label) as HTMLButtonElement;
    b.onclick = () => fn(b);
    row.append(b);
  };
  if (p.isGit) {
    mk('Fetch', (b) => void git(p.path, 'fetch', b));
    mk('Pull', (b) => void git(p.path, 'pull', b));
  }
  mk('VS Code', () => void api().local.open(p.path, 'code'));
  mk('Carpeta', () => void api().local.open(p.path, 'folder'));
  mk('Quitar', async () => {
    await api().local.remove(p.path);
    void refresh();
  }, 'btn small danger');
  c.append(row);

  if (p.scripts.length) {
    const scripts = el('div', 'scripts');
    scripts.append(el('span', 'muted', 'Scripts:'));
    for (const s of p.scripts) {
      const b = el('button', 'btn small script-btn', s) as HTMLButtonElement;
      b.onclick = () => void run(p.path, s);
      scripts.append(b);
    }
    c.append(scripts);
  }
  return c;
}

export async function refresh(): Promise<void> {
  const box = $('local-list');
  const projects = await api().local.list();
  box.replaceChildren(
    ...(projects.length
      ? projects.map(card)
      : [el('p', 'empty', 'Aún no agregaste carpetas. Usa “Agregar carpeta” para ver su estado de git y ejecutar sus scripts.')]),
  );
  document.querySelectorAll<HTMLButtonElement>('.script-btn').forEach((b) => (b.disabled = activeRun !== null));
}

export function initLocal(): void {
  if (api().platform === 'web') return;

  $('local-add').onclick = async () => {
    const r = await api().local.add();
    if (r) void refresh();
  };
  $('term-clear').onclick = () => $('term-out').replaceChildren();
  $('term-stop').onclick = () => activeRun !== null && void api().local.stop(activeRun);

  api().local.onOutput((m) => m.id === activeRun && term(m.text, m.stream === 'err' ? 'err' : ''));
  api().local.onExit((m) => {
    if (m.id !== activeRun) return;
    term(`\n[proceso terminó con código ${m.code}]\n`, m.code === 0 ? 'ok' : 'err');
    setRunning(null);
    void refresh();
  });

  setRunning(null);
  void refresh();
}
