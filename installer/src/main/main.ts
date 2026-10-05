import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { InstallOptions, Progress, ReleaseInfo } from '../shared/api';

const REPO = 'DevCat-HGS/DevPanel';
const defaultDir = () => join(process.env.LOCALAPPDATA ?? app.getPath('home'), 'Programs', 'DevPanel');

let win: BrowserWindow;
let abort: AbortController | null = null;
let setupProc: ChildProcess | null = null;
let phase: 'idle' | 'download' | 'install' = 'idle';

interface Asset { url: string; size: number; sha256?: string }
let latest: { info: ReleaseInfo; asset: Asset } | null = null;

const send = (p: Progress) => {
  if (!win.isDestroyed()) win.webContents.send('progress', p);
};

async function fetchLatest(): Promise<NonNullable<typeof latest>> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DevPanel-Installer' },
  });
  if (!res.ok) throw new Error(`No se pudo consultar la última versión (GitHub ${res.status})`);
  const rel = await res.json();
  const a = (rel.assets as any[]).find((x) => /setup.*\.exe$/i.test(x.name));
  if (!a) throw new Error('La última versión aún no tiene instalador publicado');
  const digest = typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : undefined;
  return {
    info: { version: String(rel.tag_name).replace(/^v/, ''), sizeBytes: a.size },
    asset: { url: a.browser_download_url, size: a.size, sha256: digest },
  };
}

async function download(asset: Asset, file: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(asset.url, { signal, headers: { 'User-Agent': 'DevPanel-Installer' } });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status})`);
  const total = Number(res.headers.get('content-length')) || asset.size;
  const hash = createHash('sha256');
  const out = createWriteStream(file);
  let got = 0;
  let lastT = Date.now();
  let lastGot = 0;
  let speed = 0;

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    got += chunk.length;
    hash.update(chunk);
    if (!out.write(chunk)) await once(out, 'drain');
    const now = Date.now();
    if (now - lastT >= 250) {
      speed = ((got - lastGot) / (now - lastT)) * 1000;
      lastT = now;
      lastGot = got;
      send({ phase: 'download', percent: Math.round((got / total) * 100), got, total, speed });
    }
  }
  out.end();
  await once(out, 'finish');

  if (asset.sha256 && hash.digest('hex') !== asset.sha256)
    throw new Error('La descarga está corrupta (la suma de verificación no coincide)');
}

function runSetup(file: string, dir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // NSIS requires /D= last and unquoted, so arguments are passed verbatim.
    setupProc = spawn(file, ['/S', '/currentuser', `/D=${dir}`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    setupProc.on('error', reject);
    setupProc.on('close', (code) => {
      setupProc = null;
      resolve(code ?? 1);
    });
  });
}

async function install(opts: InstallOptions): Promise<void> {
  if (phase !== 'idle') return;
  if (!isAbsolute(opts.dir) || /["<>|*?]/.test(opts.dir)) {
    return send({ phase: 'error', message: 'La carpeta de instalación no es válida' });
  }

  const tmp = join(app.getPath('temp'), 'devpanel-installer');
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, 'DevPanel-Setup.exe');
  abort = new AbortController();

  try {
    phase = 'download';
    send({ phase: 'download', percent: 0, got: 0, total: 0, speed: 0 });
    latest ??= await fetchLatest();
    await download(latest.asset, file, abort.signal);

    phase = 'install';
    send({ phase: 'install' });
    const code = await runSetup(file, opts.dir);
    if (code !== 0)
      throw new Error(`El instalador terminó con código ${code}. Cierra DevPanel si está abierto e inténtalo de nuevo.`);

    if (!opts.desktopShortcut) {
      rmSync(join(app.getPath('desktop'), 'DevPanel.lnk'), { force: true });
    }
    send({ phase: 'done', dir: opts.dir });
    if (opts.launchAfter) launch(opts.dir);
  } catch (e) {
    if (abort?.signal.aborted) send({ phase: 'cancelled' });
    else send({ phase: 'error', message: (e as Error).message });
  } finally {
    phase = 'idle';
    abort = null;
    rmSync(file, { force: true });
  }
}

function launch(dir: string): void {
  const exe = join(dir, 'DevPanel.exe');
  if (!existsSync(exe)) return;
  spawn(exe, { detached: true, stdio: 'ignore' }).unref();
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 860,
    height: 540,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    title: 'Instalador de DevPanel',
    icon: join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

  ipcMain.handle('info', async () => {
    try {
      latest = await fetchLatest();
      return { defaultDir: defaultDir(), release: latest.info };
    } catch (e) {
      return { defaultDir: defaultDir(), release: null, error: (e as Error).message };
    }
  });

  ipcMain.handle('pick-dir', async (_e, current: string) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta de instalación',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    // keep the app in its own folder when the user picks a generic one
    return r.filePaths[0].toLowerCase().endsWith('devpanel') ? r.filePaths[0] : join(r.filePaths[0], 'DevPanel');
  });

  ipcMain.handle('install', (_e, opts: InstallOptions) => install(opts));
  ipcMain.handle('cancel', () => {
    if (phase === 'download') abort?.abort(); // the installer step itself can't be interrupted safely
  });
  ipcMain.handle('launch', (_e, dir: string) => launch(dir));
  ipcMain.handle('win:minimize', () => win.minimize());
  ipcMain.handle('win:close', () => {
    if (phase === 'install') return; // never kill the app mid-install
    abort?.abort();
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
