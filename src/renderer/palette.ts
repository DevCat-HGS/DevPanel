import { $, el } from './dom.js';

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
}

/** Ctrl/Cmd+K command palette: type to filter, arrows to move, Enter to run. */
export function initPalette(getItems: () => PaletteItem[]): void {
  const root = $('palette');
  const input = $<HTMLInputElement>('pal-input');
  const list = $('pal-list');
  let shown: PaletteItem[] = [];
  let index = 0;

  const render = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = getItems()
      .filter((i) => words.every((w) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(w)))
      .slice(0, 12);
    index = Math.min(index, Math.max(shown.length - 1, 0));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((item, i) => {
            const li = el('li', i === index ? 'sel' : '');
            li.append(el('span', undefined, item.label), el('span', 'muted', item.hint ?? ''));
            li.onclick = () => run(item);
            li.onmousemove = () => {
              if (index !== i) {
                index = i;
                render();
              }
            };
            return li;
          })
        : [el('li', 'muted', 'Sin resultados')]),
    );
  };

  const close = () => root.classList.add('hidden');
  const run = (item: PaletteItem) => {
    close();
    item.run();
  };
  const open = () => {
    input.value = '';
    index = 0;
    root.classList.remove('hidden');
    render();
    input.focus();
  };

  input.addEventListener('input', () => {
    index = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') index = Math.min(index + 1, shown.length - 1);
    else if (e.key === 'ArrowUp') index = Math.max(index - 1, 0);
    else if (e.key === 'Enter' && shown[index]) return run(shown[index]);
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    render();
  });
  root.addEventListener('mousedown', (e) => e.target === root && close());

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      root.classList.contains('hidden') ? open() : close();
    }
  });
}
