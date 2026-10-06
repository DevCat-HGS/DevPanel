// Pure helpers for the software catalog (no Electron imports, unit-testable).
import { existsSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';

export interface WingetProgress {
  /** 0-100 when a download percentage could be read from the output. */
  percent?: number;
  /** true once winget moved from downloading to running the installer (no percentage anymore). */
  installing?: boolean;
}

const UNIT: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/**
 * winget prints progress with carriage returns and block characters, in the user's language:
 *   "  ██████████░░░░░░░░░░  45%"   or   "  28.0 MB / 62.3 MB"
 * so only the numbers are parsed. Returns the LAST progress found in the chunk.
 */
export function parseWingetChunk(chunk: string): WingetProgress {
  let percent: number | undefined;
  for (const m of chunk.matchAll(/(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|B)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|B)/gi)) {
    const done = parseFloat(m[1].replace(',', '.')) * UNIT[m[2].toUpperCase()];
    const total = parseFloat(m[3].replace(',', '.')) * UNIT[m[4].toUpperCase()];
    if (total > 0) percent = Math.min(100, Math.round((done / total) * 100));
  }
  if (percent === undefined) {
    for (const m of chunk.matchAll(/(?:^|\s)(\d{1,3})\s*%/g)) percent = Math.min(100, Number(m[1]));
  }
  // winget never prints a percentage while the installer itself runs; these words appear in both
  // the English and Spanish builds ("Starting package install", "Iniciando instalación del paquete")
  const installing = /starting package install|iniciando instalaci[oó]n/i.test(chunk);
  return { ...(percent !== undefined ? { percent } : {}), ...(installing ? { installing } : {}) };
}

/** Expands %VAR% and a single-segment "*" wildcard (e.g. "C:\\Program Files\\MySQL\\MySQL Workbench *\\x.exe"). */
export function expandPath(pattern: string, env: NodeJS.ProcessEnv): string[] {
  let unresolved = false;
  const filled = pattern.replace(/%([^%]+)%/g, (_m, name: string) => {
    const v = env[name] ?? env[name.toUpperCase()];
    if (v === undefined) unresolved = true;
    return v ?? '';
  });
  if (!filled || unresolved) return []; // e.g. %ProgramFiles% on a machine that does not define it
  if (!filled.includes('*')) return [filled];

  // walk segment by segment, expanding each "*" against the directory listing
  const parts = filled.split(/[\\/]/);
  let bases = [parts[0] + sep];
  for (const part of parts.slice(1)) {
    const next: string[] = [];
    for (const base of bases) {
      if (!part.includes('*')) {
        next.push(base + part + sep);
        continue;
      }
      const re = new RegExp('^' + part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
      try {
        for (const name of readdirSync(base)) if (re.test(name)) next.push(base + name + sep);
      } catch {
        /* directory does not exist */
      }
    }
    bases = next;
  }
  return bases.map((b) => b.slice(0, -1)); // drop the trailing separator
}

/** First pattern that resolves to an existing file, or null. */
export function findExisting(patterns: string[] | undefined, env: NodeJS.ProcessEnv): string | null {
  for (const p of patterns ?? []) {
    for (const candidate of expandPath(p, env)) if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** "git version 2.47.0.windows.1" -> "2.47.0", "v22.14.0" -> "22.14.0". */
export function extractVersion(output: string): string | undefined {
  return output.match(/(\d+(?:\.\d+){1,3})/)?.[1];
}

/**
 * winget exit codes that mean "nothing left to do" rather than a failure. Windows reports HRESULT-style
 * codes as unsigned in some Node versions and signed in others, so both forms are accepted.
 */
export const WINGET_OK_CODES = new Set<number>([
  0,
  0x8a15002b, -0x75eaffd5, // no applicable upgrade (already up to date)
  0x8a150061, -0x75eaff9f, // package already installed
]);

/**
 * `winget upgrade` prints a table (headers are translated, ids are not). An id that appears as a whole
 * word on a row after the dashed separator has a newer version available.
 */
export function parseUpgradeList(output: string, ids: string[]): string[] {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((l) => /^-{10,}\s*$/.test(l.trim()));
  const rows = start === -1 ? [] : lines.slice(start + 1);
  return ids.filter((id) => {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|\\s)' + esc + '(\\s|$)', 'i');
    return rows.some((r) => re.test(r));
  });
}
