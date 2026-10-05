import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/api';

const CHECK_EVERY_MS = 30 * 60 * 1000;

export function setupUpdater(win: BrowserWindow): void {
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

  const check = async () => {
    if (!app.isPackaged) return send({ state: 'dev' });
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* reported through the 'error' event */
    }
  };

  ipcMain.handle('update:check', check);
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

  win.webContents.once('did-finish-load', () => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  });
}
