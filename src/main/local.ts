import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { L10nResult, LocalProject, SecretFinding } from '../shared/api';
import { arbKeys, compareLocales, flattenKeys, L10N_DIRS, langOf, type LocaleFile } from './l10n-core';
import {
  changedPaths, findRecipe, isSafeBranch, isSafeCommitMessage, isSafeScriptName, parseGitStatus,
  recipeCommand, recipesFor, stripAnsi,
} from './local-core';
import { isBinary, MAX_SCAN_BYTES, MAX_SCAN_FILES, scanName, scanText } from './secrets-core';
import { loadSettings, saveSettings } from './settings';

const git = (cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> =>
  new Promise((res) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 60_000, windowsHide: true, maxBuffer: 4_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => res({ ok: !err, out: String(stdout) + String(stderr) }),
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

/** What kind of project a folder is, from files that are hard to fake by accident. */
function detectKinds(dir: string): string[] {
  const kinds: string[] = [];
  if (existsSync(join(dir, 'pubspec.yaml'))) kinds.push('flutter');
  if (existsSync(join(dir, 'firebase.json'))) kinds.push('firebase');
  if (existsSync(join(dir, 'package.json'))) kinds.push('node');
  return kinds;
}

/** The first translations folder with at least two readable language files. */
function readL10n(dir: string): { rel: string; files: LocaleFile[] } | null {
  for (const rel of L10N_DIRS) {
    const full = join(dir, rel);
    if (!existsSync(full)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(full).filter((n) => /\.(json|arb)$/i.test(n));
    } catch {
      continue;
    }
    if (names.length < 2) continue;
    const files = names
      .map((n): LocaleFile | null => {
        try {
          const obj = JSON.parse(readFileSync(join(full, n), 'utf8'));
          return { lang: langOf(n), file: n, keys: n.toLowerCase().endsWith('.arb') ? arbKeys(obj) : flattenKeys(obj) };
        } catch {
          return null;
        }
      })
      .filter((f): f is LocaleFile => !!f);
    if (files.length >= 2) return { rel, files };
  }
  return null;
}

async function describe(dir: string): Promise<LocalProject> {
  const kinds = detectKinds(dir);
  const base: LocalProject = {
    path: dir, name: basename(dir), exists: existsSync(dir), isGit: false, scripts: [],
    kinds: [], recipes: [], hasL10n: false,
  };
  if (!base.exists) return base;
  base.scripts = readScripts(dir);
  base.kinds = kinds;
  base.recipes = recipesFor(kinds).map((r) => ({ id: r.id, icon: r.icon, tip: recipeCommand(r) }));
  base.hasL10n = !!readL10n(dir);
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

function scanFile(dir: string, rel: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const byName = scanName(rel);
  if (byName) out.push(byName);
  try {
    const full = join(dir, rel);
    if (!existsSync(full) || statSync(full).size > MAX_SCAN_BYTES) return out;
    const buf = readFileSync(full);
    if (!isBinary(buf)) out.push(...scanText(rel, buf.toString('utf8')));
  } catch {
    /* unreadable file: skip */
  }
  return out;
}

let nextId = 1;
const running = new Map<number, ChildProcess>();

export function setupLocal(getWindow: () => BrowserWindow | null): void {
  const list = () => Promise.all(loadSettings().localProjects.map(describe));
  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload);

  /** Runs a command line made only of constants and validated names, streaming its output to the terminal. */
  const runShell = (dir: string, commandLine: string): { id: number } => {
    const id = nextId++;
    const child = spawn(commandLine, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    running.set(id, child);
    const emit = (stream: 'out' | 'err') => (d: Buffer) =>
      send('local:output', { id, stream, text: stripAnsi(d.toString()).slice(0, 20_000) });
    child.stdout?.on('data', emit('out'));
    child.stderr?.on('data', emit('err'));
    child.on('error', (e) => send('local:output', { id, stream: 'err', text: String(e) }));
    child.on('close', (code) => {
      running.delete(id);
      send('local:exit', { id, code: code ?? 0 });
    });
    return { id };
  };

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

  // ---- branches, commit and push ----
  ipcMain.handle('local:branches', async (_e, path: string) => {
    const dir = known(path);
    if (!dir) return { current: '', all: [] };
    const r = await git(dir, ['branch', '--format=%(refname:short)|%(HEAD)']);
    const rows = r.ok ? r.out.split(/\r?\n/).filter(Boolean).map((l) => l.split('|')) : [];
    return { current: rows.find((x) => x[1] === '*')?.[0] ?? '', all: rows.map((x) => x[0]).filter((b) => !b.startsWith('(')) };
  });

  ipcMain.handle('local:checkout', async (_e, path: string, branch: string) => {
    const dir = known(path);
    if (!dir) return { ok: false, output: 'Proyecto no registrado' };
    const r = await git(dir, ['branch', '--format=%(refname:short)']);
    const existing = r.out.split(/\r?\n/).filter(Boolean);
    if (!isSafeBranch(String(branch)) || !existing.includes(String(branch))) return { ok: false, output: 'Esa rama no existe' };
    const co = await git(dir, ['checkout', String(branch)]);
    return { ok: co.ok, output: stripAnsi(co.out).trim() || (co.ok ? 'Listo' : 'Falló') };
  });

  ipcMain.handle('local:commit', async (_e, path: string, message: string) => {
    const dir = known(path);
    if (!dir) return { ok: false, output: 'Proyecto no registrado' };
    if (!isSafeCommitMessage(message)) return { ok: false, output: 'El mensaje del commit no es válido (1 a 200 caracteres, una línea)' };
    const st = await git(dir, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-uall']);
    const paths = changedPaths(st.out);
    if (!paths.length) return { ok: false, output: 'No hay cambios para guardar' };
    // never commit something that looks like a secret
    const findings = paths.flatMap((p) => scanFile(dir, p));
    if (findings.length) return { ok: false, output: 'Posibles secretos en los cambios: no se hizo el commit', findings };
    const add = await git(dir, ['add', '-A']);
    if (!add.ok) return { ok: false, output: stripAnsi(add.out).trim() };
    const c = await git(dir, ['commit', '-m', message]);
    return { ok: c.ok, output: stripAnsi(c.out).trim() || (c.ok ? 'Listo' : 'Falló') };
  });

  ipcMain.handle('local:push', async (_e, path: string) => {
    const dir = known(path);
    if (!dir) return { ok: false, output: 'Proyecto no registrado' };
    let r = await git(dir, ['push']);
    if (!r.ok && /no upstream|has no upstream/i.test(r.out)) r = await git(dir, ['push', '-u', 'origin', 'HEAD']);
    return { ok: r.ok, output: stripAnsi(r.out).trim() || (r.ok ? 'Listo' : 'Falló') };
  });

  // ---- translations and secrets ----
  ipcMain.handle('local:l10n', (_e, path: string): L10nResult | null => {
    const dir = known(path);
    const found = dir ? readL10n(dir) : null;
    return found ? { dir: found.rel, ...compareLocales(found.files) } : null;
  });

  ipcMain.handle('local:secrets', async (_e, path: string): Promise<SecretFinding[]> => {
    const dir = known(path);
    if (!dir) return [];
    const ls = await git(dir, ['-c', 'core.quotepath=off', 'ls-files']);
    if (!ls.ok) return [];
    const files = ls.out.split(/\r?\n/).filter(Boolean).slice(0, MAX_SCAN_FILES);
    return files.flatMap((f) => scanFile(dir, f));
  });

  // ---- running things ----
  ipcMain.handle('local:run', (_e, path: string, script: string) => {
    const dir = known(path);
    if (!dir) return { error: 'Proyecto no registrado' };
    if (!isSafeScriptName(script) || !readScripts(dir).includes(script)) return { error: 'Ese script no existe en package.json' };
    return runShell(dir, `npm run ${script}`); // shell is required for npm.cmd on Windows; the name was validated above
  });

  ipcMain.handle('local:recipe', (_e, path: string, id: string) => {
    const dir = known(path);
    if (!dir) return { error: 'Proyecto no registrado' };
    const recipe = findRecipe(String(id));
    if (!recipe || !detectKinds(dir).includes(recipe.kind)) return { error: 'Esa receta no aplica a este proyecto' };
    return runShell(dir, recipeCommand(recipe));
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
