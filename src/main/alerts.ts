import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newFailures, type RunInfo } from './alerts-core';
import { latestRun, listRepos } from './github';
import { mt } from './i18n-main';
import { loadSettings } from './settings';

const CHECK_EVERY_MS = 10 * 60 * 1000;
const RECENT_DAYS = 14;
const MAX_REPOS = 8;

const seenFile = () => join(app.getPath('userData'), 'alerts.json');
const readSeen = (): Record<string, number> => {
  try {
    return existsSync(seenFile()) ? JSON.parse(readFileSync(seenFile(), 'utf8')) : {};
  } catch {
    return {};
  }
};

export function setupAlerts(getWindow: () => BrowserWindow | null): void {
  const check = async () => {
    const s = loadSettings();
    if (!s.alertsEnabled || !s.githubUser || !app.isPackaged) return;
    try {
      const since = Date.now() - RECENT_DAYS * 86_400_000;
      const repos = (await listRepos(s.githubUser))
        .filter((r) => new Date(r.pushed_at).getTime() > since)
        .slice(0, MAX_REPOS);
      const runs = (await Promise.all(repos.map((r) => latestRun(s.githubUser, r.name)))).filter(
        (x): x is RunInfo => !!x,
      );
      const { failures, seen } = newFailures(readSeen(), runs);
      writeFileSync(seenFile(), JSON.stringify(seen));
      for (const f of failures) {
        const n = new Notification({
          title: `${mt('Build fallido')} · ${f.repo}`,
          body: `${mt('El último workflow terminó con errores')}${f.branch ? ` ${mt('en')} ${f.branch}` : ''}. ${mt('Haz clic para verlo.')}`,
        });
        n.on('click', () => void shell.openExternal(f.url));
        n.show();
        getWindow()?.webContents.send('alert:failure', { repo: f.repo, url: f.url });
      }
    } catch {
      /* offline or rate-limited: try again next cycle */
    }
  };

  ipcMain.handle('alerts:check', check);
  setTimeout(() => void check(), 20_000);
  setInterval(() => void check(), CHECK_EVERY_MS);
}
