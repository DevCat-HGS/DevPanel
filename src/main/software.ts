import { BrowserWindow, ipcMain, shell } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { Catalog, CatalogItem, SoftwareProgress, SoftwareStatus } from '../shared/api';
import catalogJson from '../shared/catalog.json';
import { extractVersion, findExisting, parseUpgradeList, parseWingetChunk, WINGET_OK_CODES } from './software-core';

const catalog = catalogJson as Catalog;
const find = (id: string): CatalogItem | undefined => catalog.items.find((i) => i.id === id);

// DEVPANEL_FAKE_SOFTWARE='{"git":"2.47.0"}' pretends only those are installed and fakes installs/upgrades,
// DEVPANEL_FAKE_SOFTWARE_UPDATES='["git"]' pretends those have a newer version: tests never touch the machine.
const fake: Record<string, string> | null = process.env.DEVPANEL_FAKE_SOFTWARE
  ? JSON.parse(process.env.DEVPANEL_FAKE_SOFTWARE)
  : null;
const fakeUpdates: string[] = process.env.DEVPANEL_FAKE_SOFTWARE_UPDATES ? JSON.parse(process.env.DEVPANEL_FAKE_SOFTWARE_UPDATES) : [];

/** Installed during this session: a fresh PATH is not visible to this process until it restarts. */
const installedNow = new Set<string>();
const upgradedNow = new Set<string>();
const running = new Map<string, ChildProcess>();

const lookupCmd = process.platform === 'win32' ? 'where' : 'which';

const onPath = (cmd: string): Promise<boolean> =>
  new Promise((res) => execFile(lookupCmd, [cmd], { windowsHide: true, timeout: 5000 }, (err) => res(!err)));

const versionOf = (cmd: string, args: string[]): Promise<string | undefined> =>
  new Promise((res) =>
    execFile(cmd, args, { windowsHide: true, timeout: 8000, shell: process.platform === 'win32' }, (err, stdout, stderr) =>
      res(err ? undefined : extractVersion(String(stdout) + String(stderr))),
    ),
  );

async function detectOne(item: CatalogItem, emit: (s: SoftwareStatus) => void): Promise<SoftwareStatus> {
  if (item.kind !== 'app') return { id: item.id, installed: false };

  if (fake) {
    const v = fake[item.id];
    const s = { id: item.id, installed: v !== undefined || installedNow.has(item.id), version: v };
    emit(s);
    return s;
  }

  const file = findExisting(item.detect?.paths, process.env);
  const found = !!file || installedNow.has(item.id) || (!!item.detect?.cmd && (await onPath(item.detect.cmd)));
  const first: SoftwareStatus = { id: item.id, installed: found };
  emit(first); // the card turns green right away; the version arrives afterwards (it can be slow)
  if (!found || !item.detect?.cmd || !item.detect.versionArgs) return first;

  const version = await versionOf(item.detect.cmd, item.detect.versionArgs);
  const full = { ...first, version };
  if (version) emit(full);
  return full;
}

/** Ids (from the catalog) with a newer version, according to `winget upgrade`. */
function wingetUpgradable(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'winget',
      ['upgrade', '--accept-source-agreements', '--disable-interactivity'],
      { windowsHide: true, timeout: 90_000, maxBuffer: 4_000_000 },
      (_err, stdout) => {
        const wanted = catalog.items.filter((i) => i.winget).map((i) => i.winget!);
        const hits = new Set(parseUpgradeList(String(stdout), wanted));
        resolve(catalog.items.filter((i) => i.winget && hits.has(i.winget)).map((i) => i.id));
      },
    );
  });
}

export function setupSoftware(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload);
  const progress = (p: SoftwareProgress) => send('software:progress', p);

  /** Looks for newer versions in the background; the card shows an "update" icon when one exists. */
  const checkUpdates = async (installed: Set<string>) => {
    let ids: string[] = [];
    if (fake) ids = fakeUpdates;
    else if (process.platform === 'win32') ids = await wingetUpgradable();
    for (const id of ids) {
      if (installed.has(id) && !upgradedNow.has(id)) send('software:update', { id, available: true });
    }
  };

  ipcMain.handle('software:detect', async () => {
    const results = await Promise.all(catalog.items.map((i) => detectOne(i, (s) => send('software:status', s))));
    const apps = results.filter((r) => catalog.items.find((i) => i.id === r.id)?.kind === 'app');
    void checkUpdates(new Set(apps.filter((a) => a.installed).map((a) => a.id)));
    return apps;
  });

  ipcMain.handle('software:open', async (_e, id: string) => {
    const item = find(String(id));
    if (item && item.url.startsWith('https://')) await shell.openExternal(item.url);
  });

  ipcMain.handle('software:cancel', (_e, id: string) => {
    const child = running.get(String(id));
    if (!child?.pid) return;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  });

  const runWinget = async (rawId: string, mode: 'install' | 'upgrade'): Promise<{ ok: boolean; error?: string }> => {
    // only catalog entries can be installed: the renderer sends an id, never a package name or a command
    const item = find(String(rawId));
    if (!item || item.kind !== 'app' || !item.winget) return { ok: false, error: 'Este programa no se puede instalar desde aquí' };
    if (running.has(item.id)) return { ok: false, error: 'Ya se está instalando' };

    progress({ id: item.id, phase: 'start', percent: 0 });
    const succeeded = () => {
      installedNow.add(item.id);
      if (mode === 'upgrade') upgradedNow.add(item.id);
      progress({ id: item.id, phase: 'done', percent: 100 });
    };

    if (fake) {
      for (let p = 0; p <= 100; p += 20) {
        progress({ id: item.id, phase: 'progress', percent: p });
        await new Promise((r) => setTimeout(r, 250));
      }
      progress({ id: item.id, phase: 'installing' });
      await new Promise((r) => setTimeout(r, 500));
      succeeded();
      return { ok: true };
    }

    if (process.platform !== 'win32') return { ok: false, error: 'La instalación automática solo está disponible en Windows' };

    return new Promise((resolve) => {
      const child = spawn(
        'winget',
        [mode, '--id', item.winget!, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
        { windowsHide: true },
      );
      running.set(item.id, child);
      let last = 0;

      const onData = (d: Buffer) => {
        const p = parseWingetChunk(d.toString('utf8'));
        const now = Date.now();
        if (p.installing) progress({ id: item.id, phase: 'installing' });
        else if (p.percent !== undefined && now - last > 150) {
          last = now;
          progress({ id: item.id, phase: 'progress', percent: p.percent });
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', () => {
        running.delete(item.id);
        progress({ id: item.id, phase: 'error', message: 'winget no está disponible en este equipo' });
        resolve({ ok: false, error: 'winget no está disponible en este equipo' });
      });
      child.on('close', (code) => {
        running.delete(item.id);
        if (code !== null && WINGET_OK_CODES.has(code)) {
          succeeded();
          return resolve({ ok: true });
        }
        const error = code === null ? 'Instalación cancelada' : `La instalación terminó con errores (código ${code})`;
        progress({ id: item.id, phase: 'error', message: error });
        resolve({ ok: false, error });
      });
    });
  };

  ipcMain.handle('software:install', (_e, id: string) => runWinget(id, 'install'));
  ipcMain.handle('software:upgrade', (_e, id: string) => runWinget(id, 'upgrade'));
}

export function stopAllInstalls(): void {
  for (const child of running.values()) {
    if (child.pid && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill();
  }
}
