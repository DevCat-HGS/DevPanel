import type { CatalogItem, SoftwareProgress, SoftwareStatus } from '../shared/api';
import { CATALOG } from './catalog.js';
import { $, el, toast } from './dom.js';
import { icon } from './icons.js';
import { pushNotice } from './notifications.js';

type State = 'checking' | 'installed' | 'outdated' | 'missing' | 'installing' | 'error' | 'web' | 'unknown';
type Filter = 'all' | 'installed' | 'missing';

const api = () => window.devpanel;
const cards = new Map<string, HTMLElement>();
const items = new Map<string, CatalogItem>(CATALOG.items.map((i) => [i.id, i]));
let filter: Filter = 'all';
/** installed entries that have a newer version (reported a few seconds after detection) */
const outdated = new Set<string>();
/** set when the user cancels an install: the rest of a profile's queue is dropped */
let queueAbort = false;
const isInstalled = (st?: string) => st === 'installed' || st === 'outdated';

// Icon + tooltip for each state. The card itself carries (almost) no text: icons say it.
const ACTION: Record<State, { icon: string; tip: string }> = {
  checking: { icon: '', tip: 'Detectando…' },
  installed: { icon: 'checkcircle', tip: 'Instalado' },
  outdated: { icon: 'arrowup', tip: 'Actualizar' },
  missing: { icon: 'download', tip: 'Instalar' },
  installing: { icon: 'stop', tip: 'Cancelar instalación' },
  error: { icon: 'refresh', tip: 'Reintentar' },
  web: { icon: 'external', tip: 'Abrir sitio web' },
  unknown: { icon: 'external', tip: 'Abrir página de descarga' },
};

function logo(item: CatalogItem, categoryIcon: string): HTMLElement {
  const fallback = () => {
    const f = el('span', 'sw-logo sw-fallback');
    f.append(icon(categoryIcon));
    return f;
  };
  if (!item.brand) return fallback();
  const img = new Image();
  img.className = 'sw-logo';
  img.alt = '';
  img.src = `brands/${item.brand}.svg`;
  img.onerror = () => img.replaceWith(fallback());
  return img;
}

function setState(id: string, state: State, o: { percent?: number | null; version?: string; tip?: string } = {}): void {
  const card = cards.get(id);
  if (!card) return;
  card.dataset.state = state;
  card.classList.toggle('indeterminate', state === 'installing' && o.percent == null);

  const act = card.querySelector<HTMLButtonElement>('.sw-action')!;
  const a = ACTION[state];
  const hasWinget = !!items.get(id)?.winget;
  act.replaceChildren(a.icon ? icon(a.icon) : el('span', 'spinner'));
  // a missing app without a winget package opens its download page instead of installing
  const tip = o.tip ?? (state === 'missing' && !hasWinget ? 'Abrir página de descarga' : a.tip);
  act.title = tip;
  act.setAttribute('aria-label', tip);
  act.disabled = state === 'checking';

  const pct = Math.max(0, Math.min(100, o.percent ?? 0));
  act.style.setProperty('--p', `${pct}%`);
  card.querySelector<HTMLElement>('.sw-bar i')!.style.width = state === 'installing' ? `${pct}%` : '0%';

  const ver = card.querySelector<HTMLElement>('.sw-ver')!;
  if (o.version !== undefined) ver.textContent = o.version;
  ver.classList.toggle('hidden', !ver.textContent);
  applyFilter();
  updateSummary();
}

function flash(id: string, cls: 'pop' | 'shake' | 'ping'): void {
  const card = cards.get(id);
  if (!card) return;
  card.classList.remove(cls);
  void card.offsetWidth; // restart the animation
  card.classList.add(cls);
  setTimeout(() => card.classList.remove(cls), 1100);
}

function applyStatus(s: SoftwareStatus): void {
  if (cards.get(s.id)?.dataset.state === 'installing') return; // an install in flight wins over a re-detect
  setState(s.id, s.installed ? (outdated.has(s.id) ? 'outdated' : 'installed') : 'missing', { version: s.version });
}

async function install(item: CatalogItem, mode: 'install' | 'upgrade' = 'install'): Promise<void> {
  setState(item.id, 'installing', { percent: null });
  flash(item.id, 'ping');
  const r = await (mode === 'upgrade' ? api().software.upgrade(item.id) : api().software.install(item.id));
  if (r.ok) {
    outdated.delete(item.id);
    setState(item.id, 'installed');
    flash(item.id, 'pop');
    toast(`${item.name} ${mode === 'upgrade' ? 'actualizado' : 'instalado'}`, 'ok');
  } else {
    const was = mode === 'upgrade' ? 'outdated' : 'missing';
    if (r.error === 'Instalación cancelada') setState(item.id, was);
    else {
      setState(item.id, mode === 'upgrade' ? 'outdated' : 'error');
      flash(item.id, 'shake');
      toast(`No se pudo instalar ${item.name}. ${r.error ?? ''}`.trim(), 'bad');
    }
  }
}

/** One-click profile: installs what is missing, one program after another (cancelling one stops the queue). */
async function runPreset(id: string): Promise<void> {
  const preset = CATALOG.presets.find((p) => p.id === id);
  if (!preset || cards.get(preset.items[0]) === undefined) return;
  const missing = preset.items
    .map((i) => items.get(i))
    .filter((i): i is CatalogItem => !!i && ['missing', 'error'].includes(cards.get(i.id)?.dataset.state ?? ''));
  const auto = missing.filter((i) => i.winget);
  const manual = missing.filter((i) => !i.winget);
  if (!missing.length) return void toast('Ya tienes todo el perfil', 'ok');
  queueAbort = false;
  toast(`Perfil ${preset.name}: ${auto.length} por instalar`, 'info');
  for (const it of auto) {
    if (queueAbort) return;
    await install(it);
  }
  if (manual.length) toast(`Falta instalar a mano: ${manual.map((m) => m.name).join(', ')}`, 'info');
  else if (!queueAbort) toast(`Perfil ${preset.name} listo`, 'ok');
}

function onAction(item: CatalogItem): void {
  const state = cards.get(item.id)?.dataset.state as State | undefined;
  if (state === 'installing') {
    queueAbort = true;
    return void api().software.cancel(item.id);
  }
  if (state === 'installed' || state === 'checking') return;
  if (state === 'outdated') return void install(item, 'upgrade');
  if (item.kind === 'web' || state === 'unknown' || !item.winget) {
    flash(item.id, 'ping');
    return void api().software.open(item.id);
  }
  void install(item);
}

function buildCard(item: CatalogItem, categoryIcon: string): HTMLElement {
  const card = el('div', 'sw-card');
  card.dataset.id = item.id;
  const info = el('div', 'sw-info');
  info.append(el('span', 'sw-name', item.name), el('span', 'sw-ver hidden'));
  const act = el('button', 'sw-action icon-btn') as HTMLButtonElement;
  act.onclick = () => onAction(item);
  const bar = el('div', 'sw-bar');
  bar.append(document.createElement('i'));
  card.append(logo(item, categoryIcon), info, act, bar);
  cards.set(item.id, card);
  return card;
}

function applyFilter(): void {
  for (const [id, card] of cards) {
    const item = items.get(id)!;
    const st = card.dataset.state as State;
    const show =
      filter === 'all' ||
      (filter === 'installed' && isInstalled(st)) ||
      (filter === 'missing' && item.kind === 'app' && (st === 'missing' || st === 'error' || st === 'installing'));
    card.classList.toggle('hidden', !show);
  }
  document.querySelectorAll<HTMLElement>('.sw-section').forEach((s) => {
    s.classList.toggle('hidden', !s.querySelector('.sw-card:not(.hidden)'));
  });
}

function chip(iconName: string, text: string, tip: string): HTMLElement {
  const c = el('span', 'chip sw-chip');
  c.title = tip;
  c.append(icon(iconName), document.createTextNode(text));
  return c;
}

function updateSummary(): void {
  const apps = CATALOG.items.filter((i) => i.kind === 'app');
  const installed = apps.filter((i) => isInstalled(cards.get(i.id)?.dataset.state)).length;
  const old = apps.filter((i) => cards.get(i.id)?.dataset.state === 'outdated').length;
  $('sw-summary').replaceChildren(
    chip('checkcircle', `${installed}/${apps.length}`, 'Instalados'),
    ...(old ? [chip('arrowup', String(old), 'Actualizaciones disponibles')] : []),
  );

  for (const cat of CATALOG.categories) {
    const total = CATALOG.items.filter((i) => i.category === cat.id && i.kind === 'app');
    const count = document.querySelector<HTMLElement>(`.sw-section[data-cat="${cat.id}"] .sw-count`);
    if (count && total.length) {
      const done = total.filter((i) => isInstalled(cards.get(i.id)?.dataset.state)).length;
      count.textContent = `${done}/${total.length}`;
    }
  }
}

function render(): void {
  $('sw-list').replaceChildren(
    ...CATALOG.categories.map((cat) => {
      const section = el('section', 'sw-section');
      section.dataset.cat = cat.id;
      const head = el('h3', 'sw-head');
      head.append(icon(cat.icon), el('span', undefined, cat.name), el('span', 'sw-count muted'));
      const grid = el('div', 'sw-grid');
      grid.append(...CATALOG.items.filter((i) => i.category === cat.id).map((i) => buildCard(i, cat.icon)));
      section.append(head, grid);
      return section;
    }),
  );
}

async function detect(): Promise<void> {
  const web = api().platform === 'web';
  for (const item of CATALOG.items) {
    if (cards.get(item.id)?.dataset.state === 'installing') continue;
    // web services are plain links; on the web build nothing can be detected, so apps are links too
    setState(item.id, item.kind === 'web' ? 'web' : web ? 'unknown' : 'checking');
  }
  if (web) return;
  const results = await api().software.detect();
  results.forEach(applyStatus); // anything the progressive events did not already cover
}

export function initSoftware(): void {
  // ---- Software / Utilities tabs (icons only)
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((n) => n.classList.toggle('active', n === t));
      $('tab-software').classList.toggle('hidden', t.dataset.tab !== 'software');
      $('tab-utils').classList.toggle('hidden', t.dataset.tab !== 'utils');
    };
  });

  render();
  document.querySelectorAll<HTMLButtonElement>('#sw-filter button').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.f as Filter;
      document.querySelectorAll('#sw-filter button').forEach((n) => n.classList.toggle('active', n === b));
      applyFilter();
    };
  });
  $('sw-refresh').onclick = () => void detect();

  api().software.onStatus(applyStatus);
  api().software.onUpdate(({ id, available }) => {
    if (available) {
      outdated.add(id);
      pushNotice({ key: `sw:${id}`, kind: 'info', icon: 'arrowup', text: `Actualización disponible: ${items.get(id)?.name ?? id}` });
    } else outdated.delete(id);
    if (available && cards.get(id)?.dataset.state === 'installed') setState(id, 'outdated');
  });
  // one-click profiles (icons; the tooltip lists what each one installs)
  $('sw-presets').replaceChildren(
    ...CATALOG.presets.map((p) => {
      const b = el('button', 'preset-btn') as HTMLButtonElement;
      b.type = 'button';
      b.dataset.preset = p.id;
      b.title = `Perfil ${p.name}: ${p.items.map((i) => items.get(i)?.name ?? i).join(', ')}`;
      b.setAttribute('aria-label', b.title);
      b.append(icon(p.icon));
      b.onclick = () => void runPreset(p.id);
      return b;
    }),
  );
  api().software.onProgress((p: SoftwareProgress) => {
    if (p.phase === 'progress') setState(p.id, 'installing', { percent: p.percent ?? 0 });
    else if (p.phase === 'installing') setState(p.id, 'installing', { percent: null }); // the installer runs: no percentage
  });
  void detect();
}

/** Programs the profile/palette could still install (missing and installable through winget). */
export const installable = (): CatalogItem[] =>
  CATALOG.items.filter((i) => i.kind === 'app' && i.winget && ['missing', 'error'].includes(cards.get(i.id)?.dataset.state ?? ''));

/** Starts the same action as clicking the card's icon (used by the command palette). */
export function requestInstall(id: string): void {
  const item = items.get(id);
  if (item) onAction(item);
}
