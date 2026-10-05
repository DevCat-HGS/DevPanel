import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/api';

export const defaults: Settings = {
  githubUser: '',
  onboarded: false,
  alertsEnabled: true,
  closeToTray: true,
  openAtLogin: false,
  localProjects: [],
  lastSeenVersion: '',
};

const file = () => join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    if (existsSync(file())) return { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) };
  } catch {
    /* fall back to defaults */
  }
  return { ...defaults };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  // only known keys are accepted from the renderer
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => k in defaults));
  const next = { ...loadSettings(), ...clean };
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
