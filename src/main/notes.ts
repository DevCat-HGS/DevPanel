import { app, ipcMain } from 'electron';
import { getToken } from './token';

/** Release notes (the GitHub release body) for a version; null when there is no release/notes. */
export async function fetchNotes(version: string): Promise<string | null> {
  const token = getToken();
  try {
    const res = await fetch(`${process.env.DEVPANEL_GITHUB_API ?? 'https://api.github.com'}/repos/DevCat-HGS/DevPanel/releases/tags/v${encodeURIComponent(version)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DevPanel',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    const body = ((await res.json()).body as string | null)?.trim();
    return body ? body : null;
  } catch {
    return null;
  }
}

export function setupNotes(): void {
  ipcMain.handle('notes:get', (_e, version?: string) => fetchNotes(String(version ?? app.getVersion())));
}
