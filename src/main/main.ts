import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/api';
import { setupFace } from './face';
import { listCommits, listRepos, listRuns } from './github';
import { setupUpdater } from './updater';

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const defaults: Settings = { githubUser: 'DevCat-HGS' };

function loadSettings(): Settings {
  try {
    if (existsSync(settingsFile()))
      return { ...defaults, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) };
  } catch {
    /* fall back to defaults */
  }
  return { ...defaults };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0d0d0d',
    title: 'DevPanel',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = { ...loadSettings(), ...patch };
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
    return next;
  });
  ipcMain.handle('github:repos', () => listRepos(loadSettings().githubUser));
  ipcMain.handle('github:commits', (_e, repo: string) =>
    listCommits(loadSettings().githubUser, repo),
  );
  ipcMain.handle('github:runs', (_e, repo: string) =>
    listRuns(loadSettings().githubUser, repo),
  );

  setupFace();
  const win = createWindow();
  setupUpdater(win);
});

app.on('window-all-closed', () => app.quit());
