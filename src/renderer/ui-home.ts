import type { FailingRun, LocalProject, PullSummary, Repo } from '../shared/api';
import { $, ago, el } from './dom.js';
import { icon } from './icons.js';

const api = () => window.devpanel;

export interface HomeContext {
  repos: () => Repo[];
  openRepo: (repo: Repo) => void;
  goLocal: () => void;
}

type Tone = 'bad' | 'accent' | 'warn' | 'muted';

const WIDGETS: { id: string; icon: string; title: string; tone: Tone }[] = [
  { id: 'failing', icon: 'xcircle', title: 'Builds fallando', tone: 'bad' },
  { id: 'pulls', icon: 'branch', title: 'Pull requests', tone: 'accent' },
  { id: 'local', icon: 'folder', title: 'Cambios locales', tone: 'warn' },
  { id: 'recent', icon: 'clock', title: 'Actividad reciente', tone: 'muted' },
];

let ctx: HomeContext;
let ticket = 0;

function widget(w: (typeof WIDGETS)[number]): HTMLElement {
  const box = el('section', `hw hw-${w.tone}`);
  box.dataset.id = w.id;
  const head = el('div', 'hw-head');
  head.append(icon(w.icon), el('h3', undefined, w.title), el('span', 'chip hw-count'));
  box.append(head, el('div', 'hw-body'));
  return box;
}

function body(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.hw[data-id="${id}"] .hw-body`)!;
}

function setCount(id: string, n: number | null): void {
  const c = document.querySelector<HTMLElement>(`.hw[data-id="${id}"] .hw-count`)!;
  c.textContent = n === null ? '' : String(n);
  c.classList.toggle('hidden', !n); // no chip when there is nothing to show
  document.querySelector(`.hw[data-id="${id}"]`)!.classList.toggle('has-items', !!n);
}

function loading(id: string): void {
  setCount(id, null);
  body(id).replaceChildren(el('div', 'skeleton row'), el('div', 'skeleton row'));
}

/** Everything fine / nothing to show: just a green check, the tooltip says what it means. */
function allGood(id: string, tip = 'Todo en orden'): void {
  const ok = el('div', 'hw-ok');
  ok.title = tip;
  ok.setAttribute('role', 'img');
  ok.setAttribute('aria-label', tip);
  ok.append(icon('checkcircle'));
  setCount(id, 0);
  body(id).replaceChildren(ok);
}

function failed(id: string, tip: string): void {
  const bad = el('div', 'hw-ok hw-err');
  bad.title = tip;
  bad.setAttribute('role', 'img');
  bad.setAttribute('aria-label', tip);
  bad.append(icon('xcircle'));
  setCount(id, null);
  body(id).replaceChildren(bad);
}

function row(lead: string, main: string, sub: string, action: { href?: string; click?: () => void }): HTMLElement {
  const r = el(action.href ? 'a' : 'button', 'hw-row') as HTMLElement;
  if (action.href) {
    const a = r as HTMLAnchorElement;
    a.href = action.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else (r as HTMLButtonElement).type = 'button';
  if (action.click) r.onclick = action.click;
  r.append(icon(lead), el('span', 'hw-main', main), el('span', 'hw-sub muted', sub));
  return r;
}

const chipIcon = (name: string, n: number, tip: string): HTMLElement => {
  const c = el('span', 'chip hw-chip');
  c.title = tip;
  c.append(icon(name), document.createTextNode(String(n)));
  return c;
};

function renderFailing(list: FailingRun[]): void {
  if (!list.length) return allGood('failing');
  setCount('failing', list.length);
  body('failing').replaceChildren(
    ...list.map((f) =>
      row('xcircle', f.repo, f.branch ?? '', {
        click: () => {
          const repo = ctx.repos().find((r) => r.name === f.repo);
          if (repo) ctx.openRepo(repo);
        },
      }),
    ),
  );
}

function renderPulls(list: PullSummary[]): void {
  if (!list.length) return allGood('pulls');
  setCount('pulls', list.length);
  body('pulls').replaceChildren(
    ...list.map((p) => {
      const r = row(p.draft ? 'edit' : 'branch', p.title, `${p.repo} · ${ago(p.updated)}`, { href: p.url });
      return r;
    }),
  );
}

function renderLocal(list: LocalProject[]): void {
  const need = list.filter((p) => p.isGit && p.git && (p.git.dirty || p.git.ahead || p.git.behind));
  if (!need.length) return allGood('local', list.length ? 'Todo en orden' : 'Aún no agregaste carpetas.');
  setCount('local', need.length);
  body('local').replaceChildren(
    ...need.map((p) => {
      const r = el('button', 'hw-row') as HTMLButtonElement;
      r.type = 'button';
      r.onclick = ctx.goLocal;
      const chips = el('span', 'hw-chips');
      if (p.git!.dirty) chips.append(chipIcon('edit', p.git!.dirty, 'Cambios sin commitear'));
      if (p.git!.ahead) chips.append(chipIcon('arrowup', p.git!.ahead, 'Commits por subir'));
      if (p.git!.behind) chips.append(chipIcon('arrowdown', p.git!.behind, 'Commits por bajar'));
      r.append(icon('folder'), el('span', 'hw-main', p.name), chips);
      return r;
    }),
  );
}

function renderRecent(): void {
  const repos = ctx.repos().slice(0, 5);
  if (!repos.length) return allGood('recent', 'Sin actividad');
  setCount('recent', null);
  body('recent').replaceChildren(
    ...repos.map((r) => row('commit', r.name, ago(r.pushed_at), { click: () => ctx.openRepo(r) })),
  );
}

export async function refreshHome(): Promise<void> {
  const mine = ++ticket;
  const web = api().platform === 'web';
  for (const w of WIDGETS) if (w.id !== 'recent') loading(w.id);
  renderRecent();

  const settle = async <T,>(id: string, run: () => Promise<T>, render: (v: T) => void) => {
    try {
      const v = await run();
      if (mine === ticket) render(v);
    } catch (e) {
      if (mine === ticket) failed(id, (e as Error).message.includes('403') ? 'Límite de la API de GitHub alcanzado (60/hora sin token). Intenta más tarde.' : 'No se pudo cargar GitHub');
    }
  };
  await Promise.all([
    settle('failing', () => api().github.failing(), renderFailing),
    settle('pulls', () => api().github.pulls(), renderPulls),
    web ? Promise.resolve(failedLocal()) : settle('local', () => api().local.list(), renderLocal),
  ]);
}

function failedLocal(): void {
  document.querySelector('.hw[data-id="local"]')?.classList.add('hidden');
}

export function initHome(context: HomeContext): void {
  ctx = context;
  $('home-grid').replaceChildren(...WIDGETS.map(widget));
  $('home-refresh').onclick = () => void refreshHome();
}
