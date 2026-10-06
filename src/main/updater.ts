import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/api';

const CHECK_EVERY_MS = 15 * 60 * 1000;
const MIN_GAP_ON_FOCUS_MS = 5 * 60 * 1000;

/** Only this GitHub account may run and update on the development ("-dev") channel. */
export const DEV_CHANNEL_OWNER = 'DevCat-HGS';

export const isDevBuild = () => app.getVersion().includes('-');

export function canUseDevChannel(githubUser: string): boolean {
  return githubUser.trim().toLowerCase() === DEV_CHANNEL_OWNER.toLowerCase();
}

export function setupUpdater(win: BrowserWindow, getGithubUser: () => string): void {
  const send = (s: UpdateStatus) => {
    if (!win.isDestroyed()) win.webContents.send('update:status', s);
  };

  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('update-available', (info) =>
    send({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    }),
  );
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'ready', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    send({ state: 'error', message: err?.message ?? String(err) }),
  );

  let lastCheck = 0;
  const check = async () => {
    lastCheck = Date.now();
    if (!app.isPackaged) return send({ state: 'dev' });
    // A "-dev" build follows prereleases only for the owner; anyone else is kept on stable releases.
    autoUpdater.allowPrerelease = isDevBuild() && canUseDevChannel(getGithubUser());
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* reported through the 'error' event */
    }
  };

  ipcMain.handle('update:check', check);
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true));
  ipcMain.handle('update:channel', () => ({
    channel: isDevBuild() ? 'dev' : 'stable',
    allowed: !isDevBuild() || canUseDevChannel(getGithubUser()),
  }));

  win.webContents.once('did-finish-load', () => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  });
  // coming back to the app also looks for updates (at most every few minutes)
  win.on('focus', () => {
    if (Date.now() - lastCheck > MIN_GAP_ON_FOCUS_MS) void check();
  });
}
