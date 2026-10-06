import { $, ago, el } from './dom.js';
import { icon } from './icons.js';

/** The notification centre: a short, persistent history (failed builds, updates, leaked secrets...). */
export type NoticeKind = 'bad' | 'info' | 'ok';

export interface Notice {
  key: string;
  kind: NoticeKind;
  icon: string;
  text: string;
  href?: string;
  at: number;
  read: boolean;
}

const KEY = 'devpanel.notices';
const MAX = 50;

function load(): Notice[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let items: Notice[] = load();

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable: the history just won't survive a restart */
  }
};

export const unreadCount = () => items.filter((n) => !n.read).length;
export const allNotices = (): readonly Notice[] => items;

function renderBell(): void {
  const badge = $('bell-badge');
  const n = unreadCount();
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.classList.toggle('hidden', n === 0);
  $('bell-btn').classList.toggle('has-new', n > 0);
}

/** Adds a notice unless one with the same key is already in the list (so repeats never pile up). */
export function pushNotice(n: Omit<Notice, 'at' | 'read'>): void {
  if (items.some((i) => i.key === n.key)) return;
  items = [{ ...n, at: Date.now(), read: false }, ...items].slice(0, MAX);
  save();
  renderBell();
  if (!$('notif-modal').classList.contains('hidden')) renderList();
}

function renderList(): void {
  const list = $('notif-list');
  if (!items.length) {
    const empty = el('div', 'notif-empty');
    empty.title = 'Sin notificaciones';
    empty.append(icon('bell'));
    return list.replaceChildren(empty);
  }
  list.replaceChildren(
    ...items.map((n, i) => {
      const row = el(n.href ? 'a' : 'div', `notif-row nk-${n.kind}`) as HTMLElement;
      row.style.setProperty('--i', String(Math.min(i, 10)));
      if (n.href) {
        const a = row as HTMLAnchorElement;
        a.href = n.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      const lead = el('span', 'notif-ico');
      lead.append(icon(n.icon));
      row.append(lead, el('span', 'notif-text', n.text), el('span', 'muted notif-when', ago(new Date(n.at).toISOString())));
      if (n.href) row.append(icon('external'));
      return row;
    }),
  );
}

function open(): void {
  renderList();
  $('notif-modal').classList.remove('hidden');
  // opening the panel counts as reading everything
  items = items.map((n) => ({ ...n, read: true }));
  save();
  renderBell();
  $('notif-close').focus();
}

const close = () => $('notif-modal').classList.add('hidden');

export function initNotices(): void {
  renderBell();
  $('bell-btn').onclick = open;
  $('notif-close').onclick = close;
  $('notif-clear').onclick = () => {
    items = [];
    save();
    renderBell();
    renderList();
  };
  $('notif-modal').addEventListener('mousedown', (e) => e.target === $('notif-modal') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}
