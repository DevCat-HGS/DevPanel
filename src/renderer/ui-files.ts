import type { FileEntry, SearchHit } from '../shared/api';
import { $, el, toast } from './dom.js';
import { icon } from './icons.js';

const api = () => window.devpanel;

let project = '';
let openFile = '';
let returnFocus: HTMLElement | null = null;
let searchTicket = 0;

const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

function treeNode(entry: FileEntry, dir: string, depth: number): HTMLElement {
  const rel = join(dir, entry.name);
  const wrap = el('div', 'ft-node');
  const row = el('button', `ft-row${entry.dir ? ' is-dir' : ''}`) as HTMLButtonElement;
  row.type = 'button';
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.dataset.rel = rel;
  row.append(icon(entry.dir ? 'chevr' : 'file'), el('span', 'ft-name', entry.name));
  if (entry.dir) row.firstElementChild!.classList.add('ft-chev');
  wrap.append(row);

  if (entry.dir) {
    const kids = el('div', 'ft-kids hidden');
    wrap.append(kids);
    let loaded = false;
    row.onclick = async () => {
      const open = kids.classList.toggle('hidden') === false;
      row.classList.toggle('open', open);
      if (open && !loaded) {
        loaded = true;
        kids.replaceChildren(...(await api().local.tree(project, rel)).map((e) => treeNode(e, rel, depth + 1)));
      }
    };
  } else row.onclick = () => void showFile(rel);
  return wrap;
}

async function loadRoot(): Promise<void> {
  const tree = $('files-tree');
  tree.replaceChildren(el('div', 'skeleton row'), el('div', 'skeleton row'));
  const entries = await api().local.tree(project, '');
  tree.replaceChildren(...(entries.length ? entries.map((e) => treeNode(e, '', 0)) : [el('p', 'empty', 'Carpeta vacía.')]));
}

/** Plain text with line numbers; `line` scrolls to and highlights a search hit. */
async function showFile(rel: string, line?: number): Promise<void> {
  openFile = rel;
  $('files-path').textContent = rel;
  document.querySelectorAll('.ft-row.sel').forEach((r) => r.classList.remove('sel'));
  document.querySelectorAll<HTMLElement>('.ft-row').forEach((r) => r.dataset.rel === rel && r.classList.add('sel'));
  const view = $('files-view');
  view.replaceChildren(el('div', 'skeleton block'));
  const r = await api().local.read(project, rel);
  if (rel !== openFile) return; // a newer click won
  if (!r.ok) return view.replaceChildren(el('p', 'empty', r.error));
  const lines = r.text.split('\n');
  const code = el('div', 'code');
  const frag = document.createDocumentFragment();
  lines.forEach((text, i) => {
    const row = el('div', `code-line${line === i + 1 ? ' hit' : ''}`);
    row.append(el('span', 'ln', String(i + 1)), el('span', 'lt', text || ' '));
    frag.append(row);
  });
  code.append(frag);
  const note = r.truncated ? [el('p', 'muted files-note', `Se muestran los primeros ${Math.round(r.text.length / 1024)} KB de ${Math.round(r.size / 1024)} KB.`)] : [];
  view.replaceChildren(...note, code);
  const hit = code.querySelector('.hit');
  if (hit) hit.scrollIntoView({ block: 'center' });
  else view.scrollTop = 0;
}

function renderHits(hits: SearchHit[], query: string): void {
  const box = $('files-results');
  box.classList.remove('hidden');
  if (!hits.length) return box.replaceChildren(el('p', 'empty', `Sin resultados para “${query}”.`));
  box.replaceChildren(
    ...hits.map((h) => {
      const b = el('button', 'hit-row') as HTMLButtonElement;
      b.type = 'button';
      b.append(el('span', 'hit-file', `${h.file}:${h.line}`), el('span', 'hit-text', h.text));
      b.onclick = () => void showFile(h.file, h.line);
      return b;
    }),
  );
}

async function search(): Promise<void> {
  const q = $<HTMLInputElement>('files-search').value.trim();
  const box = $('files-results');
  if (q.length < 2) return box.classList.add('hidden');
  const mine = ++searchTicket;
  box.classList.remove('hidden');
  box.replaceChildren(el('div', 'skeleton row'));
  const hits = await api().local.search(project, q);
  if (mine === searchTicket) renderHits(hits, q);
}

export function closeFiles(): void {
  const m = $('files-modal');
  if (m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  document.documentElement.classList.remove('modal-open');
  returnFocus?.focus?.();
}

/** Opens the read-only explorer for a registered project. */
export function openFiles(path: string, name: string): void {
  project = path;
  openFile = '';
  returnFocus = document.activeElement as HTMLElement | null;
  $('files-title').textContent = name;
  $('files-path').textContent = '';
  $('files-view').replaceChildren(el('p', 'empty', 'Elige un archivo del árbol, o busca texto en el proyecto.'));
  $('files-results').classList.add('hidden');
  $<HTMLInputElement>('files-search').value = '';
  $('files-modal').classList.remove('hidden');
  document.documentElement.classList.add('modal-open');
  $('files-search').focus();
  void loadRoot();
}

export function initFiles(): void {
  $('files-close').onclick = closeFiles;
  $('files-modal').addEventListener('mousedown', (e) => e.target === $('files-modal') && closeFiles());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeFiles());
  $<HTMLInputElement>('files-search').onkeydown = (e) => e.key === 'Enter' && void search();
  $('files-search-go').onclick = () => void search();
  $('files-code').onclick = () => openFile && void api().local.open(project, 'code');
  $('files-copy').onclick = async () => {
    if (!openFile) return;
    await navigator.clipboard?.writeText(openFile).catch(() => {});
    toast('Ruta copiada', 'ok');
  };
}
