import { ipcMain } from 'electron';
import { resolve } from 'node:path';
import type { HealthResult } from '../shared/api';
import { latestRun, listRepos } from './github';
import { loadSettings } from './settings';
import { runSidecar } from './sidecar';

const runPython = (args: string[], stdin?: string): Promise<HealthResult> => runSidecar<Extract<HealthResult, { ok: true }>>(args, stdin);

/** Short plain-text summary of a project's health and problems, for the AI assistant. Empty when Python is unavailable. */
export async function projectBrief(dir: string): Promise<string> {
  const [h, i] = await Promise.all([runPython(['local', dir]), runSidecar<{ ok: true; brief: string }>(['inspect', dir])]);
  return [h.ok ? h.brief : '', i.ok ? i.brief : ''].filter(Boolean).join('\n');
}

export function setupHealth(): void {
  // only folders the user registered can be inspected
  ipcMain.handle('health:local', (_e, path: string) => {
    const wanted = resolve(String(path)).toLowerCase();
    const dir = loadSettings().localProjects.find((p) => resolve(p).toLowerCase() === wanted);
    return dir ? runPython(['local', dir]) : Promise.resolve<HealthResult>({ ok: false, error: 'Proyecto no registrado' });
  });

  ipcMain.handle('health:repo', async (_e, name: string): Promise<HealthResult> => {
    const user = loadSettings().githubUser;
    try {
      const repo = (await listRepos(user)).find((r) => r.name === String(name));
      if (!repo) return { ok: false, error: 'Repositorio no encontrado' };
      const run = await latestRun(user, repo.name);
      return runPython(['repo'], JSON.stringify({ ...repo, last_run: run ? { conclusion: run.conclusion } : null }));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el repositorio' };
    }
  });
}
