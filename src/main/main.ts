import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/api';
import { setupEnv } from './env';
import { setupFace } from './face';
import { listCommits, listRepos, listRuns, lookupUser } from './github';
import { setupUpdater } from './updater';

// Fixed location shared with the installer, so it can pre-configure the account, code and face.
// DEVPANEL_USER_DATA lets automated tests run against a throwaway profile.
app.setPath('userData', process.env.DEVPANEL_USER_DATA ?? join(app.getPath('appData'), 'DevPanel'));

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const defaults: Settings = { githubUser: '', onboarded: false };

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
    backgroundColor: '#070d18',
    title: 'DevPanel',
    icon: join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // vscode:// lets the "Abrir en VS Code" action clone a repo straight into the editor
    if (url.startsWith('https://') || url.startsWith('vscode://')) void shell.openExternal(url);
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
  ipcMain.handle('github:lookup', (_e, input: string) => lookupUser(input));
  ipcMain.handle('github:repos', () => listRepos(loadSettings().githubUser));
  ipcMain.handle('github:commits', (_e, repo: string) =>
    listCommits(loadSettings().githubUser, repo),
  );
  ipcMain.handle('github:runs', (_e, repo: string) =>
    listRuns(loadSettings().githubUser, repo),
  );

  setupFace();
  setupEnv();
  const win = createWindow();
  setupUpdater(win, () => loadSettings().githubUser);
});

app.on('window-all-closed', () => app.quit());
