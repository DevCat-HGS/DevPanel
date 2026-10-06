import type { Repo, WorkflowRun } from '../shared/api';
import { $, ago, copyText, el, friendlyError } from './dom.js';
import { icon } from './icons.js';
import { renderPrevNext } from './pager.js';

const api = () => window.devpanel;
const PER_PAGE = 8;

let ticket = 0; // a newer page change invalidates commit answers still in flight
let openId = 0; // identifies which repo is open (build status answers arrive separately)
let returnFocus: HTMLElement | null = null;

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

function commitRow(c: { sha: string; message: string; author: string; date: string; url: string }, i: number): HTMLElement {
  const row = el('div', 'commit');
  row.style.setProperty('--i', String(i));
  const sha = el('a', 'sha', c.sha) as HTMLAnchorElement;
  sha.href = c.url;
  sha.target = '_blank';
  sha.rel = 'noopener noreferrer';
  row.append(icon('commit'), sha, el('span', 'msg', c.message), el('span', 'muted', `${c.author} · ${ago(c.date)}`));
  return row;
}

async function loadCommits(repo: Repo, page: number): Promise<void> {
  const mine = ++ticket;
  const list = $('rm-commits');
  list.replaceChildren(...Array.from({ length: 4 }, () => el('div', 'skeleton row')));
  try {
    const { commits, hasMore } = await api().github.commits(repo.name, page);
    if (mine !== ticket) return;
    list.replaceChildren(...(commits.length ? commits.map(commitRow) : [el('p', 'empty', 'Sin commits.')]));
    renderPrevNext($('rm-pager'), page, hasMore, (p) => void loadCommits(repo, p));
  } catch (e) {
    if (mine !== ticket) return;
    list.replaceChildren(el('p', 'empty', friendlyError(e)));
    $('rm-pager').replaceChildren();
  }
}

export function closeRepo(): void {
  const modal = $('repo-modal');
  if (modal.classList.contains('hidden')) return;
  ticket++; // drop anything still loading
  openId++;
  modal.classList.add('hidden');
  document.documentElement.classList.remove('modal-open');
  returnFocus?.focus?.();
}

/** Opens the repository in a folder-styled dialog (X, Escape or a click outside closes it). */
export function openRepo(repo: Repo): void {
  const modal = $('repo-modal');
  returnFocus = document.activeElement as HTMLElement | null;

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

  // build status arrives separately so the commits are never held back by it
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
  void loadCommits(repo, 1);
}

export function initRepoModal(): void {
  $('rm-close').onclick = closeRepo;
  $('repo-modal').addEventListener('mousedown', (e) => e.target === $('repo-modal') && closeRepo());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('repo-modal').classList.contains('hidden')) closeRepo();
  });
}
