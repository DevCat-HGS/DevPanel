import { $, el } from './dom.js';
import { parseNotes } from './notes-md.js';

const api = () => window.devpanel;

/** Shows the release notes of a version in the dialog (built with DOM nodes only, never innerHTML). */
export async function showNotes(version: string): Promise<void> {
  const modal = $('notes-modal');
  $('notes-title').textContent = `Novedades de la versión ${version}`;
  const body = $('notes-body');
  body.replaceChildren(el('p', 'muted', 'Cargando…'));
  modal.classList.remove('hidden');

  const raw = await api().notes.get(version);
  const blocks = raw ? parseNotes(raw) : [];
  if (!blocks.length) return body.replaceChildren(el('p', 'muted', 'Aún no hay notas para esta versión.'));

  let list: HTMLElement | null = null;
  const nodes: HTMLElement[] = [];
  for (const b of blocks) {
    if (b.type === 'li') {
      if (!list) nodes.push((list = el('ul')));
      list.append(el('li', undefined, b.text));
    } else {
      list = null;
      nodes.push(el(b.type === 'h' ? 'h4' : 'p', b.type === 'p' ? 'muted' : undefined, b.text));
    }
  }
  body.replaceChildren(...nodes);
}

export function initNotes(): void {
  const close = () => $('notes-modal').classList.add('hidden');
  $('notes-close').onclick = close;
  $('notes-modal').addEventListener('mousedown', (e) => e.target === $('notes-modal') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  $('notes-btn').onclick = async () => showNotes(await api().version());
}

/** After an update: show what changed once. A first install only records the version. */
export async function checkWhatsNew(): Promise<void> {
  if (api().platform === 'web') return;
  const version = await api().version();
  const s = await api().settings.get();
  if (s.lastSeenVersion === version) return;
  await api().settings.set({ lastSeenVersion: version });
  if (s.lastSeenVersion) void showNotes(version);
}
