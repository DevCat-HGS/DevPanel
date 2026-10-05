import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { GithubProfile, InstallOptions, Progress, ReleaseInfo } from '../shared/api';

const REPO = 'DevCat-HGS/DevPanel';
/** The development channel (prereleases) is reserved for this account. */
const DEV_OWNER = 'DevCat-HGS';

// Same folder the app uses, so the account, code and face configured here are picked up on first launch.
app.setPath('userData', process.env.DEVPANEL_USER_DATA ?? join(app.getPath('appData'), 'DevPanel'));
const userData = () => app.getPath('userData');
const defaultDir = () => join(process.env.LOCALAPPDATA ?? app.getPath('home'), 'Programs', 'DevPanel');

let win: BrowserWindow;
let abort: AbortController | null = null;
let setupProc: ChildProcess | null = null;
let faceProc: ChildProcess | null = null;
let phase: 'idle' | 'download' | 'install' | 'face' = 'idle';
let installedDir = '';

interface Asset { url: string; size: number; sha256?: string }
interface Latest { info: ReleaseInfo; asset: Asset }
const latestCache: Partial<Record<'stable' | 'dev', Latest>> = {};

const send = (p: Progress) => {
  if (!win.isDestroyed()) win.webContents.send('progress', p);
};

const GH_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'DevPanel-Installer' };

function pickAsset(rel: any, channel: 'stable' | 'dev'): Latest | null {
  const a = (rel.assets as any[]).find((x) => /setup.*\.exe$/i.test(x.name));
  if (!a) return null;
  const digest = typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7) : undefined;
  return {
    info: { version: String(rel.tag_name).replace(/^v/, ''), sizeBytes: a.size, channel },
    asset: { url: a.browser_download_url, size: a.size, sha256: digest },
  };
}

const WEB = `https://github.com/${REPO}`;

/** Used when api.github.com is rate-limited (60 req/h per IP): same release, found via the public pages. */
async function fetchReleaseViaWeb(channel: 'stable' | 'dev'): Promise<Latest> {
  let tag: string | null = null;
  if (channel === 'stable') {
    // /releases/latest redirects to the newest non-prerelease tag
    const r = await fetch(`${WEB}/releases/latest`, { headers: { 'User-Agent': 'DevPanel-Installer' } });
    tag = r.url.match(/\/releases\/tag\/([^/?#]+)/)?.[1] ?? null;
  } else {
    const r = await fetch(`${WEB}/releases.atom`, { headers: { 'User-Agent': 'DevPanel-Installer' } });
    tag = (await r.text()).match(/\/releases\/tag\/(v[^"<]+-dev)/)?.[1] ?? null;
  }
  if (!tag) throw new Error('No se pudo encontrar la versión. Revisa tu conexión e inténtalo de nuevo.');
  const version = decodeURIComponent(tag).replace(/^v/, '');
  const url = `${WEB}/releases/download/${tag}/DevPanel-Setup-${version}.exe`;
  const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'DevPanel-Installer' } });
  if (!head.ok) throw new Error('Esa versión aún no tiene instalador publicado');
  const size = Number(head.headers.get('content-length')) || 0;
  // no checksum available through the web pages: the download still comes from github.com over HTTPS
  return { info: { version, sizeBytes: size, channel }, asset: { url, size } };
}

async function fetchRelease(channel: 'stable' | 'dev'): Promise<Latest> {
  if (latestCache[channel]) return latestCache[channel]!;
  try {
    return await fetchReleaseViaApi(channel);
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    return (latestCache[channel] = await fetchReleaseViaWeb(channel));
  }
}

class RateLimited extends Error {}

async function fetchReleaseViaApi(channel: 'stable' | 'dev'): Promise<Latest> {
  if (latestCache[channel]) return latestCache[channel]!;
  let found: Latest | null = null;
  if (channel === 'stable') {
    // GitHub's "latest" never points at a prerelease, so this is always a stable build.
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: GH_HEADERS });
    if (res.status === 403 || res.status === 429) throw new RateLimited();
    if (!res.ok) throw new Error(`No se pudo consultar la última versión estable (GitHub ${res.status})`);
    found = pickAsset(await res.json(), 'stable');
  } else {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: GH_HEADERS });
    if (res.status === 403 || res.status === 429) throw new RateLimited();
    if (!res.ok) throw new Error(`No se pudo consultar las versiones de desarrollo (GitHub ${res.status})`);
    const rel = ((await res.json()) as any[]).find((r) => r.prerelease && !r.draft && pickAsset(r, 'dev'));
    found = rel ? pickAsset(rel, 'dev') : null;
  }
  if (!found) throw new Error('Esa versión aún no tiene instalador publicado');
  return (latestCache[channel] = found);
}

const lookupCache = new Map<string, GithubProfile>();

async function lookup(input: string): Promise<GithubProfile> {
  const t = input.trim().replace(/^@/, '');
  const m = t.match(/github\.com\/([A-Za-z0-9-]{1,39})/i);
  const user = m ? m[1] : t;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user))
    throw new Error('Escribe un usuario o enlace de GitHub válido');
  const cached = lookupCache.get(user.toLowerCase());
  if (cached) return cached;
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}`, { headers: GH_HEADERS });
  if (res.status === 404) throw new Error(`No existe el usuario "${user}" en GitHub`);
  if (res.status === 403 || res.status === 429) {
    // rate limited: don't block the install, just continue with the name that was typed
    return { login: user, name: null, avatar: `https://github.com/${encodeURIComponent(user)}.png?size=120`, repos: 0, followers: 0, unverified: true };
  }
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}. Intenta de nuevo en unos minutos.`);
  const u = await res.json();
  const profile = { login: u.login, name: u.name, avatar: u.avatar_url, repos: u.public_repos ?? 0, followers: u.followers ?? 0 };
  lookupCache.set(user.toLowerCase(), profile);
  return profile;
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

/**
 * DevPanel keeps running in the system tray after its window is closed, and Windows cannot replace
 * an .exe that is in use. Since the user is installing/updating DevPanel, stop it first.
 */
async function closeRunningApp(): Promise<void> {
  if (process.platform !== 'win32') return;
  const r = spawnSync('taskkill', ['/F', '/T', '/IM', 'DevPanel.exe'], { windowsHide: true });
  if (r.status === 0) await new Promise((res) => setTimeout(res, 1200)); // let Windows release the files
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

// ---------- account (same files the app reads on first launch) ----------
function saveAccount(account: { github: string; pin: string }): void {
  if (!/^\d{4}$/.test(account.pin)) throw new Error('El código debe tener 4 dígitos');
  mkdirSync(userData(), { recursive: true });
  const salt = randomBytes(16);
  writeFileSync(
    join(userData(), 'pin.json'),
    JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(account.pin, salt, 32).toString('hex') }),
  );
  writeFileSync(
    join(userData(), 'settings.json'),
    JSON.stringify({ githubUser: account.github, onboarded: true }, null, 2),
  );
}

function existingAccount(): { githubUser: string } | null {
  try {
    const s = JSON.parse(readFileSync(join(userData(), 'settings.json'), 'utf8'));
    if (s.onboarded && s.githubUser && existsSync(join(userData(), 'pin.json'))) return { githubUser: s.githubUser };
  } catch {
    /* no previous setup */
  }
  return null;
}

// ---------- face enrollment (Python sidecar shipped inside the installed app) ----------
function findPython(): string | null {
  for (const c of [process.env.DEVPANEL_PYTHON, 'python', 'py'].filter(Boolean) as string[]) {
    if (spawnSync(c, ['--version'], { windowsHide: true }).status === 0) return c;
  }
  return null;
}

function runToEnd(cmd: string, args: string[], proc: (p: ChildProcess) => void): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    proc(p);
    let out = '';
    p.stdout?.on('data', (d) => (out += d));
    p.on('error', () => resolve({ code: 1, out }));
    p.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

function runLines(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
  proc: (p: ChildProcess) => void,
): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    proc(p);
    let buf = '';
    let last = '';
    p.stdout?.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines.filter(Boolean)) {
        last = l;
        onLine(l);
      }
    });
    p.on('error', () => resolve(last));
    p.on('close', () => {
      if (buf.trim()) last = buf.trim();
      resolve(last);
    });
  });
}

async function enrollFace(): Promise<{ ok: boolean; error?: string }> {
  const dir = join(installedDir, 'resources', 'python');
  const script = join(dir, 'face_auth.py');
  if (!existsSync(script)) return { ok: false, error: 'No se encontró el módulo facial en la instalación' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'El cifrado del sistema no está disponible' };

  const py = findPython();
  if (!py)
    return { ok: false, error: 'Falta Python. Instálalo desde python.org (marca "Add to PATH") y vuelve a intentarlo, o actívalo luego en Settings.' };

  send({ phase: 'face-state', state: 'preparing' });
  const hasCv = spawnSync(py, ['-c', 'import cv2; cv2.FaceDetectorYN'], { windowsHide: true }).status === 0;
  if (!hasCv) {
    const pip = await runToEnd(py, ['-m', 'pip', 'install', '-r', join(dir, 'requirements.txt')], (p) => (faceProc = p));
    faceProc = null;
    if (pip.code !== 0) return { ok: false, error: 'No se pudo instalar OpenCV con pip. Revisa tu conexión e inténtalo de nuevo.' };
  }

  send({ phase: 'face-state', state: 'scanning' });
  mkdirSync(join(userData(), 'models'), { recursive: true });
  const lastLine = await runLines(
    py,
    [script, 'enroll', '--models-dir', join(userData(), 'models')],
    (line) => {
      try {
        const m = JSON.parse(line);
        if (typeof m.progress === 'number')
          send({ phase: 'face-state', state: 'scanning', progress: m.progress, total: m.total });
      } catch {
        /* not a progress line */
      }
    },
    (p) => (faceProc = p),
  );
  faceProc = null;
  try {
    const result = JSON.parse(lastLine);
    if (!result.ok) return { ok: false, error: result.error ?? 'No se pudo registrar el rostro' };
    // Only embeddings are stored (never images), encrypted with the OS keychain.
    writeFileSync(join(userData(), 'face.bin'), safeStorage.encryptString(JSON.stringify(result.embeddings)));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Se canceló o falló el registro del rostro' };
  }
}

// ---------- install ----------
async function install(opts: InstallOptions): Promise<void> {
  if (phase !== 'idle') return;
  if (!isAbsolute(opts.dir) || /["<>|*?]/.test(opts.dir)) {
    return send({ phase: 'error', message: 'La carpeta de instalación no es válida' });
  }
  if (opts.channel === 'dev') {
    const who = opts.account?.github ?? existingAccount()?.githubUser ?? '';
    if (who.toLowerCase() !== DEV_OWNER.toLowerCase())
      return send({ phase: 'error', message: `El canal de desarrollo está reservado para ${DEV_OWNER}` });
  }
  if (opts.account && !/^\d{4}$/.test(opts.account.pin)) {
    return send({ phase: 'error', message: 'El código debe tener 4 dígitos' });
  }

  if (process.env.DEVPANEL_DRY_RUN) {
    // UI tests: never download or install anything. 'face' jumps straight to the face step.
    if (process.env.DEVPANEL_DRY_RUN === 'face') {
      phase = 'face';
      return send({ phase: 'face' });
    }
    return send({ phase: 'download', percent: 42, got: 33_000_000, total: 78_000_000, speed: 4_200_000 });
  }

  const tmp = join(app.getPath('temp'), 'devpanel-installer');
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, 'DevPanel-Setup.exe');
  abort = new AbortController();

  try {
    phase = 'download';
    send({ phase: 'download', percent: 0, got: 0, total: 0, speed: 0 });
    const latest = await fetchRelease(opts.channel);
    await download(latest.asset, file, abort.signal);

    phase = 'install';
    send({ phase: 'install' });
    await closeRunningApp();
    const code = await runSetup(file, opts.dir);
    if (code !== 0)
      throw new Error(`El instalador terminó con código ${code}. Cierra DevPanel si está abierto e inténtalo de nuevo.`);

    installedDir = opts.dir;
    if (!opts.desktopShortcut) rmSync(join(app.getPath('desktop'), 'DevPanel.lnk'), { force: true });

    if (opts.account) {
      saveAccount(opts.account);
      phase = 'face';
      send({ phase: 'face' });
    } else {
      phase = 'idle';
      send({ phase: 'done', dir: opts.dir });
    }
  } catch (e) {
    phase = 'idle';
    if (abort?.signal.aborted) send({ phase: 'cancelled' });
    else send({ phase: 'error', message: (e as Error).message });
  } finally {
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
    height: 620,
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
    const base = { defaultDir: defaultDir(), existing: existingAccount(), devOwner: DEV_OWNER };
    try {
      return { ...base, release: (await fetchRelease('stable')).info };
    } catch (e) {
      return { ...base, release: null, error: (e as Error).message };
    }
  });

  ipcMain.handle('lookup', (_e, input: string) => lookup(input));

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

  ipcMain.handle('face:enroll', async () => {
    if (phase !== 'face') return { ok: false, error: 'La instalación aún no terminó' };
    if (process.env.DEVPANEL_DRY_RUN === 'face') {
      // simulated enrollment (no camera, no Python) so the animation can be tested
      for (let i = 0; i <= 5; i++) {
        send({ phase: 'face-state', state: 'scanning', progress: i, total: 5 });
        await new Promise((r) => setTimeout(r, 450));
      }
      phase = 'idle';
      send({ phase: 'done', dir: installedDir });
      return { ok: true };
    }
    const r = await enrollFace();
    if (r.ok) {
      phase = 'idle';
      send({ phase: 'done', dir: installedDir });
    }
    return r;
  });
  ipcMain.handle('face:cancel', () => faceProc?.kill());
  ipcMain.handle('setup:finish', () => {
    faceProc?.kill();
    phase = 'idle';
    send({ phase: 'done', dir: installedDir });
  });

  ipcMain.handle('launch', (_e, dir: string) => launch(dir));
  ipcMain.handle('win:minimize', () => win.minimize());
  ipcMain.handle('win:close', () => {
    if (phase === 'install') return; // never kill the app mid-install
    abort?.abort();
    faceProc?.kill();
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
