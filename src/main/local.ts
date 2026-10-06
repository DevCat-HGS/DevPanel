import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { LocalProject } from '../shared/api';
import { isSafeScriptName, parseGitStatus, stripAnsi } from './local-core';
import { loadSettings, saveSettings } from './settings';

const git = (cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> =>
  new Promise((res) => {
    execFile('git', args, { cwd, timeout: 60_000, windowsHide: true, maxBuffer: 2_000_000 }, (err, stdout, stderr) =>
      res({ ok: !err, out: String(stdout) + String(stderr) }),
    );
  });

function readScripts(dir: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return Object.keys(pkg.scripts ?? {}).filter(isSafeScriptName);
  } catch {
    return [];
  }
}

async function describe(dir: string): Promise<LocalProject> {
  const base: LocalProject = { path: dir, name: basename(dir), exists: existsSync(dir), isGit: false, scripts: [] };
  if (!base.exists) return base;
  base.scripts = readScripts(dir);
  const status = await git(dir, ['status', '--porcelain=v1', '-b']);
  if (!status.ok) return base;
  const log = await git(dir, ['log', '-1', '--format=%s%x1f%cr']);
  const [subject, when] = log.ok ? log.out.trim().split('\x1f') : ['', ''];
  return { ...base, isGit: true, git: parseGitStatus(status.out), lastCommit: subject ? { subject, when } : undefined };
}

/** Only folders the user added can be touched; the renderer never gets to pick arbitrary paths. */
function known(path: string): string | null {
  const wanted = resolve(path).toLowerCase();
  return loadSettings().localProjects.find((p) => resolve(p).toLowerCase() === wanted) ?? null;
}

let nextId = 1;
const running = new Map<number, ChildProcess>();

export function setupLocal(getWindow: () => BrowserWindow | null): void {
  const list = () => Promise.all(loadSettings().localProjects.map(describe));

  ipcMain.handle('local:list', list);

  ipcMain.handle('local:add', async () => {
    // DEVPANEL_TEST_PICK_DIR lets automated tests skip the native folder dialog
    let dir = process.env.DEVPANEL_TEST_PICK_DIR ?? null;
    if (!dir) {
      const r = await dialog.showOpenDialog({ title: 'Elige la carpeta de un proyecto', properties: ['openDirectory'] });
      dir = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const current = loadSettings().localProjects;
    if (!current.some((p) => resolve(p).toLowerCase() === resolve(dir!).toLowerCase())) {
      saveSettings({ localProjects: [...current, resolve(dir)] });
    }
    return list();
  });

  ipcMain.handle('local:remove', (_e, path: string) => {
    const p = known(path);
    if (p) saveSettings({ localProjects: loadSettings().localProjects.filter((x) => x !== p) });
  });

  ipcMain.handle('local:git', async (_e, path: string, action: string) => {
    const dir = known(path);
    if (!dir) return { ok: false, output: 'Proyecto no registrado' };
    const args = action === 'pull' ? ['pull', '--ff-only'] : action === 'fetch' ? ['fetch', '--all', '--prune'] : null;
    if (!args) return { ok: false, output: 'Acción no permitida' };
    const r = await git(dir, args);
    return { ok: r.ok, output: stripAnsi(r.out).trim() || (r.ok ? 'Listo' : 'Falló') };
  });

  ipcMain.handle('local:run', (_e, path: string, script: string) => {
    const dir = known(path);
    if (!dir) return { error: 'Proyecto no registrado' };
    if (!isSafeScriptName(script) || !readScripts(dir).includes(script)) return { error: 'Ese script no existe en package.json' };

    const id = nextId++;
    // shell is required for npm.cmd on Windows; the script name was validated above
    const child = spawn(`npm run ${script}`, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    running.set(id, child);
    const emit = (stream: 'out' | 'err') => (d: Buffer) =>
      getWindow()?.webContents.send('local:output', { id, stream, text: stripAnsi(d.toString()).slice(0, 20_000) });
    child.stdout?.on('data', emit('out'));
    child.stderr?.on('data', emit('err'));
    child.on('error', (e) => getWindow()?.webContents.send('local:output', { id, stream: 'err', text: String(e) }));
    child.on('close', (code) => {
      running.delete(id);
      getWindow()?.webContents.send('local:exit', { id, code: code ?? 0 });
    });
    return { id };
  });

  ipcMain.handle('local:stop', (_e, id: number) => {
    const child = running.get(id);
    if (!child?.pid) return;
    // kill the whole tree: `npm run` spawns children
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  });

  ipcMain.handle('local:open', async (_e, path: string, how: 'folder' | 'code') => {
    const dir = known(path);
    if (!dir) return;
    if (how === 'code') spawn('code', [dir], { shell: true, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else await shell.openPath(dir);
  });
}

export function stopAllLocal(): void {
  for (const id of running.keys()) {
    const child = running.get(id);
    if (child?.pid && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child?.kill();
  }
}
