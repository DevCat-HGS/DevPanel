import { app, ipcMain } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../shared/api';
import { cleanTasks } from './tasks-core';

const file = () => join(app.getPath('userData'), 'tasks.json');

export function loadTasks(): Task[] {
  try {
    if (existsSync(file())) return cleanTasks(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    /* unreadable file: start empty rather than crash Home */
  }
  return [];
}

function saveTasks(raw: unknown): Task[] {
  const list = cleanTasks(raw);
  // write-then-rename so a crash mid-write never leaves a half file behind
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2));
  renameSync(tmp, file());
  return list;
}

export function setupTasks(): void {
  ipcMain.handle('tasks:list', () => loadTasks());
  ipcMain.handle('tasks:save', (_e, list: unknown) => saveTasks(list));
}
