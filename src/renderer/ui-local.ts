import type { LocalProject, SecretFinding } from '../shared/api';
import { $, el, toast } from './dom.js';
import { tr } from './i18n.js';
import { icon } from './icons.js';
import { pushNotice } from './notifications.js';

const api = () => window.devpanel;
let activeRun: number | null = null;

/** Results of the on-demand scans, kept per project so the chips survive a refresh. */
const l10nMissing = new Map<string, number>();
const secretCount = new Map<string, number>();
let lastProjects: LocalProject[] = [];

export const getLocalProjects = (): readonly LocalProject[] => lastProjects;


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
  document.querySelectorAll<HTMLButtonElement>('.script-btn, .recipe-btn').forEach((b) => (b.disabled = id !== null));
}

async function runWith(label: string, start: () => Promise<{ id: number } | { error: string }>): Promise<void> {
  if (activeRun !== null) return;
  term(`\n$ ${label}\n`, 'cmd');
  const r = await start();
  if ('error' in r) return term(`${r.error}\n`, 'err');
  setRunning(r.id, label);
}

/** git result -> terminal + toast + refresh */
async function gitStep(label: string, call: () => Promise<{ ok: boolean; output: string }>, btn?: HTMLButtonElement): Promise<boolean> {
  if (btn) btn.disabled = true;
  term(`\n$ git ${label}\n`, 'cmd');
  const r = await call();
  term(`${r.output}\n`, r.ok ? '' : 'err');
  toast(r.ok ? `git ${label} listo` : r.output.split('\n')[0] || `git ${label} falló`, r.ok ? 'ok' : 'bad');
  if (btn) btn.disabled = false;
  void refresh();
  return r.ok;
}

function ib(name: string, tip: string, onClick: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement {
  const b = el('button', `icon-btn mini ${cls}`.trim()) as HTMLButtonElement;
  b.type = 'button';
  b.title = tip;
  b.setAttribute('aria-label', tip);
  b.append(icon(name));
  b.onclick = () => onClick(b);
  return b;
}

function chip(name: string, text: string, tip: string, tone = ''): HTMLElement {
  const c = el('span', `chip lc ${tone}`.trim());
  c.title = tip;
  c.append(icon(name), document.createTextNode(text));
  return c;
}

function showFindings(name: string, findings: SecretFinding[]): void {
  if (!findings.length) return term(`${tr('Sin secretos a la vista')}\n`, 'ok');
  term(`${findings.length} ${tr('posibles secretos')} (${name}):\n`, 'err');
  pushNotice({ key: `sec:${name}:${findings.length}`, kind: 'bad', icon: 'shield', text: `${findings.length} posibles secretos en ${name}` });
  for (const f of findings) term(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}]\n`, 'err');
}

async function compareLanguages(p: LocalProject): Promise<void> {
  term(`\n$ ${tr('Comparar idiomas')}\n`, 'cmd');
  const r = await api().local.l10n(p.path);
  if (!r) return term(`${tr('No encontré archivos de idiomas')}\n`, 'err');
  l10nMissing.set(p.path, r.missingCount);
  term(`${r.dir}: ${r.languages.join(', ')} · ${r.total} ${tr('claves')}\n`);
  if (!r.missingCount) term(`${tr('Idiomas al día')}\n`, 'ok');
  for (const [lang, keys] of Object.entries(r.missing)) term(`  ${lang}: ${tr('faltan')} ${keys.length} → ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? '…' : ''}\n`, 'err');
  toast(r.missingCount ? `Idiomas: faltan ${r.missingCount} claves` : 'Idiomas al día', r.missingCount ? 'bad' : 'ok');
  void refresh();
}

async function scanSecrets(p: LocalProject): Promise<void> {
  term(`\n$ ${tr('Buscar secretos')}\n`, 'cmd');
  const found = await api().local.secrets(p.path);
  secretCount.set(p.path, found.length);
  showFindings(p.name, found);
  toast(found.length ? `${found.length} posibles secretos` : 'Sin secretos a la vista', found.length ? 'bad' : 'ok');
  void refresh();
}

function branchSelect(p: LocalProject): HTMLSelectElement {
  const sel = el('select', 'branch-select') as HTMLSelectElement;
  sel.title = 'Cambiar de rama';
  sel.setAttribute('aria-label', 'Cambiar de rama');
  const current = p.git?.branch ?? '';
  sel.append(new Option(current, current, true, true));
  void api()
    .local.branches(p.path)
    .then((b) => {
      if (!b.all.length) return;
      sel.replaceChildren(...b.all.map((n) => new Option(n, n, false, n === b.current)));
      sel.value = b.current;
    });
  sel.onchange = async () => {
    const ok = await gitStep(`checkout ${sel.value}`, () => api().local.checkout(p.path, sel.value));
    if (!ok) void refresh();
  };
  return sel;
}

function commitRow(p: LocalProject): HTMLElement {
  const row = el('div', 'commit-row hidden');
  const input = el('input') as HTMLInputElement;
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = 'Mensaje del commit';
  input.setAttribute('aria-label', 'Mensaje del commit');
  const send = async () => {
    const msg = input.value.trim();
    if (!msg) return;
    term(`\n$ git commit -m "${msg}"\n`, 'cmd');
    const r = await api().local.commit(p.path, msg);
    term(`${r.output}\n`, r.ok ? '' : 'err');
    if (r.findings?.length) {
      secretCount.set(p.path, r.findings.length);
      showFindings(p.name, r.findings);
      toast(`Posibles secretos en: ${[...new Set(r.findings.map((f) => f.file))].slice(0, 3).join(', ')}. No se hizo el commit.`, 'bad');
    } else toast(r.ok ? 'Commit hecho' : r.output.split('\n')[0], r.ok ? 'ok' : 'bad');
    if (r.ok) {
      input.value = '';
      row.classList.add('hidden');
    }
    void refresh();
  };
  const go = ib('check', 'Confirmar', () => void send(), 'primary');
  input.onkeydown = (e) => e.key === 'Enter' && void send();
  row.append(input, go);
  return row;
}

function card(p: LocalProject): HTMLElement {
  const c = el('div', 'local-card');
  c.dataset.path = p.path;
  const head = el('div', 'local-head');
  head.append(el('b', undefined, p.name), el('span', 'muted path', p.path));
  c.append(head);

  const chips = el('div', 'chips');
  if (!p.exists) chips.append(chip('xcircle', '', 'carpeta no encontrada', 'bad'));
  else if (!p.isGit) chips.append(chip('info', '', 'sin git'));
  else if (p.git) {
    chips.append(branchSelect(p));
    if (p.git.dirty) chips.append(chip('edit', String(p.git.dirty), 'Cambios sin commitear', 'warn dirty'));
    else chips.append(chip('checkcircle', '', 'limpio', 'ok clean'));
    if (p.git.ahead) chips.append(chip('arrowup', String(p.git.ahead), 'Commits por subir', 'ahead'));
    if (p.git.behind) chips.append(chip('arrowdown', String(p.git.behind), 'Commits por bajar', 'warn behind'));
    const miss = l10nMissing.get(p.path);
    if (miss !== undefined) chips.append(chip('globe', miss ? String(miss) : '', miss ? 'Claves de idioma que faltan' : 'Idiomas al día', miss ? 'warn l10n' : 'ok l10n'));
    const sec = secretCount.get(p.path);
    if (sec !== undefined) chips.append(chip(sec ? 'shield' : 'checkcircle', sec ? String(sec) : '', sec ? 'Posibles secretos' : 'Sin secretos a la vista', sec ? 'bad secrets' : 'ok secrets'));
    if (p.lastCommit) chips.append(el('span', 'muted', `${p.lastCommit.subject} · ${p.lastCommit.when}`));
  }
  c.append(chips);

  const row = el('div', 'actions');
  const commit = commitRow(p);
  if (p.isGit) {
    row.append(
      ib('refresh', 'Fetch', (b) => void gitStep('fetch', () => api().local.git(p.path, 'fetch'), b)),
      ib('arrowdown', 'Pull', (b) => void gitStep('pull', () => api().local.git(p.path, 'pull'), b)),
      ib('arrowup', 'Push', (b) => void gitStep('push', () => api().local.push(p.path), b)),
      ib('commit', 'Hacer commit', () => {
        commit.classList.toggle('hidden');
        if (!commit.classList.contains('hidden')) commit.querySelector('input')!.focus();
      }),
    );
  }
  for (const r of p.recipes) row.append(ib(r.icon, r.tip, () => void runWith(r.tip, () => api().local.recipe(p.path, r.id)), 'recipe-btn'));
  if (p.hasL10n) row.append(ib('globe', 'Comparar idiomas', () => void compareLanguages(p)));
  if (p.isGit) row.append(ib('shield', 'Buscar secretos', () => void scanSecrets(p)));
  row.append(
    ib('code', 'Abrir en VS Code', () => void api().local.open(p.path, 'code')),
    ib('folder', 'Carpeta', () => void api().local.open(p.path, 'folder')),
    ib('trash', 'Quitar', async () => {
      await api().local.remove(p.path);
      void refresh();
    }, 'danger'),
  );
  c.append(row, commit);

  if (p.scripts.length) {
    const scripts = el('div', 'scripts');
    const lead = el('span', 'muted');
    lead.title = 'Scripts de npm';
    lead.append(icon('terminal'));
    scripts.append(lead);
    for (const s of p.scripts) {
      const b = el('button', 'btn small script-btn', s) as HTMLButtonElement;
      b.onclick = () => void runWith(`npm run ${s}`, () => api().local.run(p.path, s));
      scripts.append(b);
    }
    c.append(scripts);
  }
  return c;
}

export async function refresh(): Promise<void> {
  const box = $('local-list');
  const projects = await api().local.list();
  lastProjects = projects;
  // keep a half-typed commit message when the list redraws
  const typed = new Map<string, string>();
  box.querySelectorAll<HTMLElement>('.local-card').forEach((c) => {
    const v = c.querySelector<HTMLInputElement>('.commit-row input')?.value;
    if (v) typed.set(c.dataset.path!, v);
  });
  box.replaceChildren(
    ...(projects.length
      ? projects.map(card)
      : [el('p', 'empty', 'Aún no agregaste carpetas. Usa “Agregar carpeta” para ver su estado de git y ejecutar sus scripts.')]),
  );
  box.querySelectorAll<HTMLElement>('.local-card').forEach((c) => {
    const v = typed.get(c.dataset.path!);
    if (v) {
      c.querySelector('.commit-row')!.classList.remove('hidden');
      c.querySelector<HTMLInputElement>('.commit-row input')!.value = v;
    }
  });
  document.querySelectorAll<HTMLButtonElement>('.script-btn, .recipe-btn').forEach((b) => (b.disabled = activeRun !== null));
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

/** Runs an npm script of a registered project (used by the command palette). */
export function runScriptFrom(path: string, script: string): void {
  void runWith(`npm run ${script}`, () => api().local.run(path, script));
}
