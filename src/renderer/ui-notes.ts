import { $, el } from './dom.js';
import { tr } from './i18n.js';
import { icon } from './icons.js';
import { parseNotes } from './notes-md.js';

const api = () => window.devpanel;

type Kind = 'feat' | 'fix' | 'other';
interface Item { scope?: string; text: string }
interface Group { kind: Kind; items: Item[] }

const META: Record<Kind, { icon: string; title: string }> = {
  feat: { icon: 'sparkles', title: 'Novedades' },
  fix: { icon: 'tools', title: 'Correcciones' },
  other: { icon: 'cpu', title: 'Mejoras internas' },
};

const kindOf = (heading: string): Kind =>
  /correcciones|fixes/i.test(heading) ? 'fix' : /mejoras internas|under the hood/i.test(heading) ? 'other' : 'feat';

/** Groups the flat blocks (## headings + list items) into coloured cards. */
export function groupNotes(raw: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const b of parseNotes(raw)) {
    if (b.type === 'h') groups.push((cur = { kind: kindOf(b.text), items: [] }));
    else {
      cur ??= (groups[groups.push({ kind: 'feat', items: [] }) - 1]);
      cur.items.push({ scope: b.scope, text: b.text });
    }
  }
  return groups.filter((g) => g.items.length);
}

/** Shows the release notes of a version (DOM nodes only, never innerHTML). */
export async function showNotes(version: string): Promise<void> {
  const modal = $('notes-modal');
  $('notes-ver').textContent = `v${version}`;
  const body = $('notes-body');
  body.replaceChildren(el('div', 'skeleton block'));
  modal.classList.remove('hidden');

  const raw = await api().notes.get(version);
  const groups = raw ? groupNotes(raw) : [];
  if (!groups.length) {
    const empty = el('div', 'empty-note');
    empty.append(icon('sparkles'), el('span', undefined, tr('Aún no hay notas para esta versión.')));
    return body.replaceChildren(empty);
  }

  body.replaceChildren(
    ...groups.map((g, i) => {
      const card = el('section', `ng ng-${g.kind}`);
      card.style.setProperty('--i', String(i));
      const head = el('div', 'ng-head');
      head.append(icon(META[g.kind].icon), el('span', undefined, tr(META[g.kind].title)), el('span', 'chip', String(g.items.length)));
      const ul = el('ul');
      g.items.forEach((it, j) => {
        const li = el('li');
        li.style.setProperty('--j', String(j));
        if (it.scope) li.append(el('span', 'scope', it.scope));
        li.append(el('span', undefined, it.text));
        ul.append(li);
      });
      card.append(head, ul);
      return card;
    }),
  );
}

export function initNotes(): void {
  const close = () => $('notes-modal').classList.add('hidden');
  $('notes-close').onclick = close;
  $('notes-modal').addEventListener('mousedown', (e) => e.target === $('notes-modal') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  $('whatsnew-btn').onclick = async () => showNotes(await api().version());
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
