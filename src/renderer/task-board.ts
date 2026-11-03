import type { Task, TaskStatus } from '../shared/api';

// Pure Task Pro logic (no DOM), shared by ui-tasks.ts and the unit tests.

export const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const RANK = { high: 0, normal: 1, low: 2 } as const;

/** Local calendar day as YYYY-MM-DD (the date input works in local time, not UTC). */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueState = 'late' | 'today' | 'soon' | null;

/** How urgent a due date is: past, today, within 3 days, or nothing to flag. Done tasks are never urgent. */
export function dueState(t: Pick<Task, 'due' | 'status'>, now = today()): DueState {
  if (!t.due || t.status === 'done') return null;
  if (t.due < now) return 'late';
  if (t.due === now) return 'today';
  const days = (Date.parse(`${t.due}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000;
  return days <= 3 ? 'soon' : null;
}

/** Open work: priority, then the closest due date (none last), then oldest first. Done: latest first. */
export function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    if (a.status === 'done' && b.status === 'done') return b.updated.localeCompare(a.updated);
    return RANK[a.priority] - RANK[b.priority]
      || (a.due ?? '9999').localeCompare(b.due ?? '9999')
      || a.created.localeCompare(b.created);
  });
}

export const nextStatus = (s: TaskStatus): TaskStatus => (s === 'todo' ? 'doing' : 'done');
export const prevStatus = (s: TaskStatus): TaskStatus => (s === 'done' ? 'doing' : 'todo');

/** Projects that have tasks, with how many are still open, busiest first. '' (no project) is left out. */
export function projectCounts(list: Task[]): [string, number][] {
  const m = new Map<string, number>();
  for (const t of list) if (t.project) m.set(t.project, (m.get(t.project) ?? 0) + (t.status === 'done' ? 0 : 1));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function newTaskId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
