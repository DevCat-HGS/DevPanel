import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { join } from 'node:path';
import type { Settings } from '../shared/api';
import { setupAlerts } from './alerts';
import { mt } from './i18n-main';
import { setupClaude, stopAllClaude } from './claude';
import { setupLocal, stopAllLocal } from './local';
import { setupFace } from './face';
import { listCommits, listFailing, listItems, listOpenPulls, listRepos, listRuns, lookupUser, rerunFailed } from './github';
import { setupNotes } from './notes';
import { setupSoftware, stopAllInstalls } from './software';
import { loadSettings, saveSettings } from './settings';
import { setupToken } from './token';
import { setupUpdater } from './updater';

// Fixed location shared with the installer, so it can pre-configure the account, code and face.
// DEVPANEL_USER_DATA lets automated tests run against a throwaway profile.
app.setPath('userData', process.env.DEVPANEL_USER_DATA ?? join(app.getPath('appData'), 'DevPanel'));

const ICON = join(__dirname, '..', 'renderer', 'icon.png');
const SHORTCUT = 'CommandOrControl+Alt+D';
const startHidden = process.argv.includes('--hidden');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// A second launch (e.g. login auto-start + manual open) just brings the first one forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: '#070d18',
    title: 'DevPanel',
    icon: ICON,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(({ url }) => {
    // vscode:// lets the "Abrir en VS Code" action clone a repo straight into the editor
    if (url.startsWith('https://') || url.startsWith('vscode://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  w.once('ready-to-show', () => {
    if (!startHidden) w.show();
  });

  // Closing keeps DevPanel alive in the tray (unless the user turned that off).
  w.on('close', (e) => {
    if (!quitting && loadSettings().closeToTray) {
      e.preventDefault();
      w.hide();
    }
  });
  // Whenever the window goes out of sight the renderer re-locks, so the panel is never left open.
  w.on('hide', () => w.webContents.send('app:hidden'));

  void w.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: mt('Abrir DevPanel'), click: showWindow },
    {
      label: mt('Buscar actualizaciones'),
      click: () => {
        showWindow();
        win?.webContents.send('app:check-updates');
      },
    },
    {
      label: mt('Avisarme si falla un build'),
      type: 'checkbox',
      checked: loadSettings().alertsEnabled,
      click: (item) => {
        saveSettings({ alertsEnabled: item.checked });
        win?.webContents.send('app:settings-changed');
      },
    },
    { type: 'separator' },
    { label: `${mt('Mostrar / ocultar')}  (${SHORTCUT.replace('CommandOrControl', 'Ctrl')})`, click: toggleWindow },
    { label: mt('Salir'), click: () => app.quit() },
  ]);
}

function setupTray(): void {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('DevPanel');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleWindow);
  // rebuild on right-click so the checkbox reflects changes made inside the app
  tray.on('right-click', () => tray?.setContextMenu(buildTrayMenu()));
}

function applyLoginItem(open: boolean): void {
  // Only for the installed app: in development this would register electron.exe itself.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: open, path: process.execPath, args: ['--hidden'] });
}

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = saveSettings(patch);
    if (typeof patch.openAtLogin === 'boolean') applyLoginItem(next.openAtLogin);
    if (patch.language) tray?.setContextMenu(buildTrayMenu());
    return next;
  });
  ipcMain.handle('github:lookup', (_e, input: string) => lookupUser(input));
  ipcMain.handle('github:repos', () => listRepos(loadSettings().githubUser));
  ipcMain.handle('github:commits', (_e, repo: string, page?: number) => listCommits(loadSettings().githubUser, repo, page));
  ipcMain.handle('github:items', (_e, repo: string, kind: 'pulls' | 'issues' | 'runs', page?: number) => {
    if (!['pulls', 'issues', 'runs'].includes(kind)) throw new Error('Lista no válida');
    return listItems(loadSettings().githubUser, repo, kind, page);
  });
  ipcMain.handle('github:rerun', (_e, repo: string, runId: number) => rerunFailed(loadSettings().githubUser, repo, Number(runId)));
  ipcMain.handle('github:failing', () => listFailing(loadSettings().githubUser));
  ipcMain.handle('github:pulls', () => listOpenPulls(loadSettings().githubUser));
  ipcMain.handle('github:runs', (_e, repo: string) => listRuns(loadSettings().githubUser, repo));

  setupFace();
  setupToken();
  setupNotes();
  win = createWindow();
  const getWin = () => (win && !win.isDestroyed() ? win : null);
  setupLocal(getWin);
  setupClaude(getWin);
  setupSoftware(getWin);
  setupAlerts(getWin);
  setupUpdater(win, () => loadSettings().githubUser);
  setupTray();
  globalShortcut.register(SHORTCUT, toggleWindow); // returns false if another app owns it; harmless
});

// With close-to-tray the app keeps running with no visible window.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  stopAllLocal();
  stopAllClaude();
  stopAllInstalls();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
