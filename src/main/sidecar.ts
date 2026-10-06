import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The packaged app ships project_health.exe (PyInstaller): no Python needed. Dev falls back to python + the script. */
const exePath = () => (app.isPackaged ? join(process.resourcesPath, 'python', 'project_health.exe') : '');
const scriptPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'python', 'project_health.py') : join(app.getAppPath(), 'python', 'project_health.py');

/** Runs the Python module (health, inspect...); its single JSON line on stdout is the result. */
export function runSidecar<T extends { ok: boolean }>(args: string[], stdin?: string, timeoutMs = 120_000): Promise<T | { ok: false; error: string }> {
  const exe = exePath();
  const useExe = !!exe && existsSync(exe);
  const cmd = useExe ? exe : (process.env.DEVPANEL_PYTHON ?? 'python');
  return new Promise((done) => {
    const py = spawn(cmd, [...(useExe ? [] : [scriptPath()]), ...args], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => py.kill(), timeoutMs);
    py.stdout.on('data', (d) => (out += d));
    py.on('error', () => {
      clearTimeout(timer);
      done({ ok: false, error: 'No se pudo ejecutar Python. Instálalo o usa la versión empaquetada.' });
    });
    py.on('close', () => {
      clearTimeout(timer);
      try {
        done(JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? ''));
      } catch {
        done({ ok: false, error: 'Respuesta inválida del módulo de análisis' });
      }
    });
    py.stdin.end(stdin ?? '');
  });
}
