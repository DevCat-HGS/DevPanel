import type { Task, TaskPriority, TaskStatus } from '../shared/api';

export const MAX_TASKS = 500;
const STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done'];
const PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high'];

const oneLine = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A real calendar day as YYYY-MM-DD, or null. */
export function cleanDue(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) ? v : null;
}

const cleanIso = (v: unknown, fallback: string): string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback;

/**
 * Whatever the renderer (or a hand-edited tasks.json) sends becomes a valid list: unknown fields dropped,
 * titles one line of at most 200 characters, enums defaulted, duplicate ids and empty titles skipped.
 */
export function cleanTasks(raw: unknown, now = new Date().toISOString()): Task[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of raw) {
    if (out.length >= MAX_TASKS) break;
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : '';
    const title = oneLine(o.title, 200);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const created = cleanIso(o.created, now);
    out.push({
      id,
      title,
      project: oneLine(o.project, 60),
      status: STATUSES.includes(o.status as TaskStatus) ? (o.status as TaskStatus) : 'todo',
      priority: PRIORITIES.includes(o.priority as TaskPriority) ? (o.priority as TaskPriority) : 'normal',
      due: cleanDue(o.due),
      created,
      updated: cleanIso(o.updated, created),
    });
  }
  return out;
}
