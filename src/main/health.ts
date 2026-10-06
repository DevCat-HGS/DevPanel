import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import type { HealthResult } from '../shared/api';
import { latestRun, listRepos } from './github';
import { loadSettings } from './settings';

const scriptPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'python', 'project_health.py') : join(app.getAppPath(), 'python', 'project_health.py');

/** The packaged app ships project_health.exe (PyInstaller): no Python needed. Dev falls back to python + the script. */
const packagedExe = () => (app.isPackaged ? join(process.resourcesPath, 'python', 'project_health.exe') : '');

/** Runs the Python scorer; its single JSON line on stdout is the result. */
function runPython(args: string[], stdin?: string): Promise<HealthResult> {
  const exe = packagedExe();
  const useExe = !!exe && existsSync(exe);
  const cmd = useExe ? exe : (process.env.DEVPANEL_PYTHON ?? 'python');
  return new Promise((done) => {
    const py = spawn(cmd, [...(useExe ? [] : [scriptPath()]), ...args], { windowsHide: true });
    let out = '';
    py.stdout.on('data', (d) => (out += d));
    py.on('error', () => done({ ok: false, error: 'No se pudo ejecutar Python. Instálalo o usa la versión empaquetada.' }));
    py.on('close', () => {
      try {
        done(JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? ''));
      } catch {
        done({ ok: false, error: 'Respuesta inválida del módulo de salud' });
      }
    });
    py.stdin.end(stdin ?? '');
  });
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
