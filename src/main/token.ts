import { app, ipcMain, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings } from './settings';

// DEVPANEL_GITHUB_API lets automated tests talk to a local mock instead of api.github.com.
export const apiBase = () => process.env.DEVPANEL_GITHUB_API ?? 'https://api.github.com';

// Optional GitHub token: raises the API limit (60 -> 5000 req/h) and unlocks private repos.
// Stored encrypted with the OS keychain; never sent anywhere except api.github.com.
const binFile = () => join(app.getPath('userData'), 'token.bin');
const metaFile = () => join(app.getPath('userData'), 'token.json');

export function getToken(): string | null {
  try {
    if (existsSync(binFile())) return safeStorage.decryptString(readFileSync(binFile()));
  } catch {
    /* unreadable: fall through */
  }
  return process.env.GITHUB_TOKEN ?? null;
}

export function tokenLogin(): string | null {
  try {
    return existsSync(metaFile()) ? (JSON.parse(readFileSync(metaFile(), 'utf8')).login as string) : null;
  } catch {
    return null;
  }
}

/** True when the saved token belongs to `user`, so /user/repos (incl. private) can be used. */
export function tokenOwns(user: string): boolean {
  const login = tokenLogin();
  return !!login && !!getToken() && login.toLowerCase() === user.toLowerCase();
}

export function setupToken(): void {
  ipcMain.handle('token:status', async () => {
    const has = existsSync(binFile());
    if (!has) return { has };
    // /rate_limit is free (it does not count against the limit) and proves the token is really in use
    try {
      const res = await fetch(`${apiBase()}/rate_limit`, {
        headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/vnd.github+json', 'User-Agent': 'DevPanel' },
      });
      const core = res.ok ? (await res.json()).resources?.core : null;
      return { has, login: tokenLogin() ?? undefined, limit: core?.limit, remaining: core?.remaining };
    } catch {
      return { has, login: tokenLogin() ?? undefined };
    }
  });

  ipcMain.handle('token:set', async (_e, token: string) => {
    const t = String(token ?? '').trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) return { ok: false, error: 'El token no tiene un formato válido' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'El cifrado del sistema no está disponible' };
    try {
      const res = await fetch(`${apiBase()}/user`, {
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'DevPanel' },
      });
      if (res.status === 401) return { ok: false, error: 'GitHub rechazó el token (inválido o vencido)' };
      if (!res.ok) return { ok: false, error: `GitHub respondió ${res.status}` };
      const login = (await res.json()).login as string;
      const linked = loadSettings().githubUser;
      if (linked && login.toLowerCase() !== linked.toLowerCase())
        return { ok: false, error: `Ese token es de @${login}, pero tu cuenta vinculada es @${linked}` };
      writeFileSync(binFile(), safeStorage.encryptString(t));
      writeFileSync(metaFile(), JSON.stringify({ login }));
      return { ok: true, login };
    } catch {
      return { ok: false, error: 'No se pudo contactar a GitHub' };
    }
  });

  ipcMain.handle('token:clear', () => {
    rmSync(binFile(), { force: true });
    rmSync(metaFile(), { force: true });
  });
}
