import { el } from './dom.js';
import { icon } from './icons.js';

/** Page numbers to show: always first and last, the current page and its neighbours, "…" in the gaps. */
export function pageWindow(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function arrow(name: 'chevl' | 'chevr', tip: string, disabled: boolean, go: () => void): HTMLButtonElement {
  const b = el('button', 'pg-btn') as HTMLButtonElement;
  b.type = 'button';
  b.append(icon(name));
  b.title = tip;
  b.setAttribute('aria-label', tip);
  b.disabled = disabled;
  b.onclick = go;
  return b;
}

/** Numbered pager for a list whose size is known (the projects grid). Hidden when there is one page. */
export function renderPager(host: HTMLElement, page: number, pages: number, go: (p: number) => void): void {
  host.classList.toggle('hidden', pages <= 1);
  if (pages <= 1) return host.replaceChildren();
  const nodes: HTMLElement[] = [arrow('chevl', 'Anterior', page <= 1, () => go(page - 1))];
  for (const n of pageWindow(page, pages)) {
    if (n === '…') {
      nodes.push(el('span', 'pg-gap', '…'));
      continue;
    }
    const b = el('button', `pg-btn pg-num${n === page ? ' cur' : ''}`, String(n)) as HTMLButtonElement;
    b.type = 'button';
    if (n === page) b.setAttribute('aria-current', 'page');
    b.onclick = () => n !== page && go(n);
    nodes.push(b);
  }
  nodes.push(arrow('chevr', 'Siguiente', page >= pages, () => go(page + 1)));
  host.replaceChildren(...nodes);
}

/** Previous / next with the current page in between, for lists of unknown length (commits). */
export function renderPrevNext(host: HTMLElement, page: number, hasMore: boolean, go: (p: number) => void): void {
  const single = page <= 1 && !hasMore;
  host.classList.toggle('hidden', single);
  if (single) return host.replaceChildren();
  host.replaceChildren(
    arrow('chevl', 'Anterior', page <= 1, () => go(page - 1)),
    el('span', 'pg-btn pg-num cur', String(page)),
    arrow('chevr', 'Siguiente', !hasMore, () => go(page + 1)),
  );
}
