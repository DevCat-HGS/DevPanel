import type { Repo, RepoItem, WorkflowRun } from '../shared/api';
import { $, ago, copyText, el, friendlyError, toast } from './dom.js';
import { icon } from './icons.js';
import { renderPrevNext } from './pager.js';
import { healthChip, runHealth } from './ui-health.js';

const api = () => window.devpanel;

type Tab = 'commits' | 'pulls' | 'issues' | 'runs';
const EMPTY: Record<Tab, string> = {
  commits: 'Sin commits.',
  pulls: 'Sin pull requests abiertos.',
  issues: 'Sin issues abiertos.',
  runs: 'Sin ejecuciones.',
};

let ticket = 0; // a newer page/tab change invalidates answers still in flight
let openId = 0; // identifies which repo is open (build status answers arrive separately)
let returnFocus: HTMLElement | null = null;
let current: Repo | null = null;
let tab: Tab = 'commits';

function iconLink(name: string, href: string, tip: string): HTMLAnchorElement {
  const a = el('a', 'icon-btn') as HTMLAnchorElement;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = tip;
  a.setAttribute('aria-label', tip);
  a.append(icon(name));
  return a;
}

function iconButton(name: string, tip: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'icon-btn') as HTMLButtonElement;
  b.type = 'button';
  b.title = tip;
  b.setAttribute('aria-label', tip);
  b.append(icon(name));
  b.onclick = onClick;
  return b;
}

/** Build status as an icon (tooltip says what it means), not a sentence. */
function statusBadge(run?: WorkflowRun): HTMLElement {
  const make = (cls: string, name: string | null, tip: string) => {
    const b = el('span', `status-i ${cls}`);
    b.title = tip;
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', tip);
    b.append(name ? icon(name) : el('span', 'spinner'));
    return b;
  };
  if (!run) return make('none', 'xcircle', 'Sin Actions');
  if (run.status !== 'completed') return make('busy', null, 'Build en curso');
  return run.conclusion === 'success' ? make('ok', 'checkcircle', 'Build correcto') : make('bad', 'xcircle', 'Build con errores');
}

function link(cls: string, href: string, text: string): HTMLAnchorElement {
  const a = el('a', cls, text) as HTMLAnchorElement;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function commitRow(c: { sha: string; message: string; author: string; date: string; url: string }, i: number): HTMLElement {
  const row = el('div', 'commit');
  row.style.setProperty('--i', String(i));
  row.append(icon('commit'), link('sha', c.url, c.sha), el('span', 'msg', c.message), el('span', 'muted', `${c.author} · ${ago(c.date)}`));
  return row;
}

type RunState = 'ok' | 'bad' | 'busy' | 'muted';
const runState = (it: RepoItem): RunState =>
  it.status !== 'completed' ? 'busy' : it.conclusion === 'success' ? 'ok' : it.conclusion === 'cancelled' || it.conclusion === 'skipped' ? 'muted' : 'bad';

const RUN_TIP: Record<RunState, string> = { ok: 'Build correcto', bad: 'Build con errores', busy: 'Build en curso', muted: 'Cancelado' };

async function rerun(repo: Repo, it: RepoItem, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const r = await api().github.rerun(repo.name, it.id);
  btn.disabled = false;
  if (!r.ok) return toast(r.error ?? 'No se pudo reintentar', 'bad');
  toast('Reintentando jobs fallidos…', 'ok');
  setTimeout(() => current === repo && tab === 'runs' && void loadTab(repo, 'runs', 1), 2500);
}

function itemRow(kind: Exclude<Tab, 'commits'>, it: RepoItem, i: number, repo: Repo): HTMLElement {
  const row = el('div', 'commit item');
  row.style.setProperty('--i', String(i));

  if (kind === 'runs') {
    const st = runState(it);
    const lead = el('span', `run-i st-${st}`);
    lead.title = RUN_TIP[st];
    lead.setAttribute('role', 'img');
    lead.setAttribute('aria-label', RUN_TIP[st]);
    lead.append(st === 'busy' ? el('span', 'spinner') : icon(st === 'ok' ? 'checkcircle' : st === 'bad' ? 'xcircle' : 'stop'));
    row.append(lead, link('msg', it.url, it.title));
    if (it.branch) row.append(el('span', 'chip', it.branch));
    row.append(el('span', 'muted', ago(it.date)));
    if (st === 'bad') row.append(iconButton('refresh', 'Reintentar jobs fallidos', () => void rerun(repo, it, row.querySelector('.rerun')!)));
    row.querySelector('.icon-btn')?.classList.add('rerun', 'mini');
    return row;
  }

  row.append(
    icon(kind === 'issues' ? 'alert' : it.draft ? 'edit' : 'branch'),
    link('sha', it.url, `#${it.number}`),
    link('msg', it.url, it.title),
    el('span', 'muted', `${it.author ?? ''} · ${ago(it.date)}`),
  );
  return row;
}

async function loadTab(repo: Repo, which: Tab, page: number): Promise<void> {
  const mine = ++ticket;
  const list = $('rm-commits');
  list.replaceChildren(...Array.from({ length: 4 }, () => el('div', 'skeleton row')));
  try {
    let rows: HTMLElement[];
    let hasMore: boolean;
    if (which === 'commits') {
      const r = await api().github.commits(repo.name, page);
      rows = r.commits.map(commitRow);
      hasMore = r.hasMore;
    } else {
      const r = await api().github.items(repo.name, which, page);
      rows = r.items.map((it, i) => itemRow(which, it, i, repo));
      hasMore = r.hasMore;
    }
    if (mine !== ticket) return;
    list.replaceChildren(...(rows.length ? rows : [el('p', 'empty', EMPTY[which])]));
    renderPrevNext($('rm-pager'), page, hasMore, (p) => void loadTab(repo, which, p));
  } catch (e) {
    if (mine !== ticket) return;
    list.replaceChildren(el('p', 'empty', friendlyError(e)));
    $('rm-pager').replaceChildren();
  }
}

function selectTab(which: Tab): void {
  tab = which;
  document.querySelectorAll<HTMLButtonElement>('.rm-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === which);
    b.setAttribute('aria-selected', String(b.dataset.tab === which));
  });
}

export function closeRepo(): void {
  const modal = $('repo-modal');
  if (modal.classList.contains('hidden')) return;
  ticket++; // drop anything still loading
  openId++;
  current = null;
  modal.classList.add('hidden');
  document.documentElement.classList.remove('modal-open');
  returnFocus?.focus?.();
}

/** Opens the repository in a folder-styled dialog (X, Escape or a click outside closes it). */
export function openRepo(repo: Repo): void {
  const modal = $('repo-modal');
  returnFocus = document.activeElement as HTMLElement | null;
  current = repo;

  $('rm-name').textContent = repo.name;
  $('rm-desc').textContent = repo.description ?? '';
  $('rm-desc').classList.toggle('hidden', !repo.description);

  const cloneUrl = `${repo.html_url}.git`;
  const actions = $('rm-actions');
  actions.replaceChildren(
    iconLink('external', repo.html_url, 'Abrir en GitHub'),
    iconLink('code', `vscode://vscode.git/clone?url=${encodeURIComponent(cloneUrl)}`, 'Abrir en VS Code'),
    iconButton('terminal', 'Copiar git clone', () => void copyText(`git clone ${cloneUrl}`)),
    iconButton('link', 'Copiar enlace', () => void copyText(repo.html_url)),
  );
  const healthBtn = iconButton('gauge', 'Salud del proyecto', () =>
    void runHealth(() => api().health.repo(repo.name), healthBtn).then((r) => {
      if (!r || current !== repo) return;
      actions.querySelector('.health')?.remove();
      actions.prepend(healthChip(r));
    }),
  );
  actions.append(healthBtn);

  // build status arrives separately so the list is never held back by it
  const badge = $('rm-badge');
  badge.replaceChildren(el('span', 'spinner'));
  const myId = ++openId;
  api()
    .github.runs(repo.name)
    .then((runs) => {
      if (myId !== openId) return;
      badge.replaceChildren(statusBadge(runs[0]));
      if (runs[0]) actions.prepend(iconLink('play', runs[0].html_url, 'Ver Actions'));
    })
    .catch(() => badge.replaceChildren(statusBadge(undefined)));

  modal.classList.remove('hidden');
  document.documentElement.classList.add('modal-open');
  $('rm-close').focus();
  $('rm-body').scrollTop = 0;
  selectTab('commits');
  void loadTab(repo, 'commits', 1);
}

export function initRepoModal(): void {
  $('rm-close').onclick = closeRepo;
  $('repo-modal').addEventListener('mousedown', (e) => e.target === $('repo-modal') && closeRepo());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('repo-modal').classList.contains('hidden')) closeRepo();
  });
  document.querySelectorAll<HTMLButtonElement>('.rm-tab').forEach((b) => {
    b.onclick = () => {
      if (!current) return;
      selectTab(b.dataset.tab as Tab);
      void loadTab(current, tab, 1);
    };
  });
}
