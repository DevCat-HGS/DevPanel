import type { Repo, Task, TaskPriority, TaskStatus } from '../shared/api';
import { $, el, toast } from './dom.js';
import { icon } from './icons.js';
import { dueState, newTaskId, nextStatus, prevStatus, projectCounts, sortTasks, STATUSES, today } from './task-board.js';

const api = () => window.devpanel;

export interface TasksContext {
  repos: () => Repo[];
  openRepo: (repo: Repo) => void;
  goLocal: () => void;
}

const COLUMNS: Record<TaskStatus, { title: string; icon: string }> = {
  todo: { title: 'Por hacer', icon: 'clock' },
  doing: { title: 'En curso', icon: 'play' },
  done: { title: 'Hecho', icon: 'checkcircle' },
};
const FORWARD: Record<TaskStatus, string> = { todo: 'Pasar a En curso', doing: 'Marcar como hecha', done: '' };
const BACK: Record<TaskStatus, string> = { todo: '', doing: 'Volver a Por hacer', done: 'Volver a En curso' };
const PRIORITY: Record<TaskPriority, string> = { high: 'Prioridad alta', normal: 'Prioridad normal', low: 'Prioridad baja' };
const DUE: Record<string, string> = { late: 'Vencida', today: 'Vence hoy', soon: 'Vence pronto' };

let ctx: TasksContext;
let tasks: Task[] = [];
let filter: string | null = null; // null = every project
let localNames: string[] = [];

let saving: Promise<unknown> = Promise.resolve();
let version = 0; // bumps on every change, so an older answer never overwrites a newer list

/** Saves the whole list (one save at a time); the main process answers with what it actually stored. */
async function commit(next: Task[]): Promise<void> {
  const before = tasks;
  const mine = ++version;
  tasks = next;
  render();
  const run = saving.then(() => api().tasks.save(next));
  saving = run.catch(() => {});
  try {
    const stored = await run;
    if (mine === version) tasks = stored;
  } catch {
    if (mine === version) tasks = before;
    toast('No se pudo guardar la tarea', 'bad');
  }
  render();
}

function update(id: string, patch: Partial<Task>): void {
  const now = new Date().toISOString();
  void commit(tasks.map((t) => (t.id === id ? { ...t, ...patch, updated: now } : t)));
}

function iconBtn(name: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `tp-btn ${cls}`.trim()) as HTMLButtonElement;
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.onclick = onClick;
  return b;
}

/** The project chip jumps to the repo or the Local view when the name matches one, so nothing needs a browser. */
function projectChip(name: string): HTMLElement {
  const repo = ctx.repos().find((r) => r.name === name);
  const local = localNames.includes(name);
  const chip = el(repo || local ? 'button' : 'span', 'chip tp-proj');
  const label = el('span', undefined, name); // the user's text is never translated
  label.dataset.noI18n = '';
  chip.append(label);
  if (repo || local) {
    (chip as HTMLButtonElement).type = 'button';
    chip.title = repo ? 'Abrir repositorio' : 'Ir a Local';
    chip.onclick = () => (repo ? ctx.openRepo(repo) : ctx.goLocal());
  }
  return chip;
}

function editTitle(t: Task, span: HTMLElement): void {
  const input = el('input', 'tp-edit') as HTMLInputElement;
  input.value = t.title;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Editar tarea');
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const title = input.value.replace(/\s+/g, ' ').trim();
    if (save && title && title !== t.title) update(t.id, { title });
    else render();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') {
      e.stopPropagation(); // keep other Escape handlers (modals) out of it
      finish(false);
    }
  };
  input.onblur = () => finish(true);
  span.replaceWith(input);
  input.focus();
  input.select();
}

function card(t: Task, now: string): HTMLElement {
  const due = dueState(t, now);
  const li = el('li', `tp-card tp-p-${t.priority}${due ? ` tp-${due}` : ''}`);
  li.dataset.id = t.id;

  const lead = t.status === 'done'
    ? iconBtn('checkcircle', BACK.done, () => update(t.id, { status: prevStatus(t.status) }), 'tp-lead on')
    : iconBtn(t.status === 'doing' ? 'check' : 'play', FORWARD[t.status], () => update(t.id, { status: nextStatus(t.status) }), 'tp-lead');

  const main = el('div', 'tp-main');
  const title = el('span', 'tp-title', t.title);
  title.dataset.noI18n = '';
  title.ondblclick = () => editTitle(t, title);
  const meta = el('div', 'tp-meta');
  const dot = el('span', `tp-dot tp-dot-${t.priority}`);
  dot.title = PRIORITY[t.priority];
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', PRIORITY[t.priority]);
  meta.append(dot);
  if (t.project) meta.append(projectChip(t.project));
  if (t.due) {
    const d = el('span', `chip tp-due${due ? ` tp-due-${due}` : ''}`);
    d.append(icon('clock'), el('span', undefined, t.due));
    d.title = due ? DUE[due] : 'Fecha límite';
    meta.append(d);
  }
  main.append(title, meta);

  const acts = el('div', 'tp-acts');
  if (t.status === 'doing') acts.append(iconBtn('chevl', BACK.doing, () => update(t.id, { status: prevStatus(t.status) })));
  acts.append(
    iconBtn('edit', 'Editar tarea', () => editTitle(t, title)),
    iconBtn('trash', 'Borrar tarea', () => void commit(tasks.filter((x) => x.id !== t.id)), 'danger'),
  );
  li.append(lead, main, acts);
  return li;
}

function renderFilters(): void {
  const box = $('tp-filters');
  const counts = projectCounts(tasks);
  if (filter !== null && !counts.some(([n]) => n === filter)) filter = null; // its last task is gone
  const chip = (label: string, value: string | null, n: number) => {
    const b = el('button', `tp-filter${filter === value ? ' active' : ''}`) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filter === value));
    const name = el('span', undefined, label);
    if (value !== null) name.dataset.noI18n = '';
    b.append(name, el('span', 'tp-n', String(n)));
    b.onclick = () => {
      filter = value;
      render();
    };
    return b;
  };
  const open = tasks.filter((t) => t.status !== 'done').length;
  box.replaceChildren(chip('Todos', null, open), ...counts.map(([n, c]) => chip(n, n, c)));
  box.classList.toggle('hidden', !counts.length);
}

function renderSummary(now: string): void {
  const open = tasks.filter((t) => t.status !== 'done');
  const late = open.filter((t) => dueState(t, now) === 'late').length;
  const parts = [open.length === 0 ? 'Sin pendientes' : open.length === 1 ? '1 pendiente' : `${open.length} pendientes`];
  if (late) parts.push(late === 1 ? '1 vencida' : `${late} vencidas`);
  $('tp-summary').textContent = parts.join(' · ');
  $('tp-summary').classList.toggle('bad', late > 0);
}

function render(): void {
  const now = today();
  renderFilters();
  renderSummary(now);
  const shown = sortTasks(filter === null ? tasks : tasks.filter((t) => t.project === filter));
  $('tp-board').replaceChildren(
    ...STATUSES.map((s) => {
      const items = shown.filter((t) => t.status === s);
      const col = el('section', `tp-col tp-col-${s}`);
      col.setAttribute('aria-label', COLUMNS[s].title);
      const head = el('header', 'tp-col-head');
      head.append(icon(COLUMNS[s].icon), el('h4', undefined, COLUMNS[s].title), el('span', 'chip', String(items.length)));
      if (s === 'done' && items.length) {
        const ids = new Set(items.map((t) => t.id));
        head.append(iconBtn('trash', 'Borrar las hechas', () => {
          void commit(tasks.filter((t) => !ids.has(t.id)));
          toast(ids.size === 1 ? '1 tarea hecha borrada' : `${ids.size} tareas hechas borradas`, 'ok');
        }, 'danger'));
      }
      const list = el('ul', 'tp-list');
      if (items.length) list.append(...items.map((t) => card(t, now)));
      else list.append(el('li', 'tp-empty muted', s === 'todo' ? 'Nada pendiente. Agrega una tarea arriba.' : 'Vacío'));
      col.append(head, list);
      return col;
    }),
  );
}

/** Project suggestions for the form: registered folders and GitHub repos, without duplicates. */
function fillSuggestions(): void {
  const names = [...new Set([...tasks.map((t) => t.project).filter(Boolean), ...localNames, ...ctx.repos().map((r) => r.name)])];
  const list = $('tp-projects');
  list.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n })));
}

export async function refreshTasks(): Promise<void> {
  await saving; // reading while a save is in flight would bring back the old list
  const mine = version;
  try {
    const list = await api().tasks.list();
    if (mine === version) tasks = list;
  } catch {
    /* keep what is on screen */
  }
  try {
    localNames = (await api().local.list()).map((p) => p.name);
  } catch {
    localNames = [];
  }
  fillSuggestions();
  render();
}

export function initTasks(context: TasksContext): void {
  ctx = context;
  const form = $('tp-form') as HTMLFormElement;
  const title = $<HTMLInputElement>('tp-new');
  const project = $<HTMLInputElement>('tp-project');
  const priority = $<HTMLSelectElement>('tp-priority');
  const due = $<HTMLInputElement>('tp-due');
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = title.value.replace(/\s+/g, ' ').trim();
    if (!text) return title.focus();
    const now = new Date().toISOString();
    const task: Task = {
      id: newTaskId(),
      title: text,
      project: project.value.trim() || filter || '',
      status: 'todo',
      priority: priority.value as TaskPriority,
      due: due.value || null,
      created: now,
      updated: now,
    };
    title.value = '';
    due.value = '';
    priority.value = 'normal';
    void commit([...tasks, task]).then(fillSuggestions);
    title.focus();
  };
  void refreshTasks();
}
