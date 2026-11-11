import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/api';
import { sanitizeStored } from './settings-core';

export const defaults: Settings = {
  githubUser: '',
  onboarded: false,
  alertsEnabled: true,
  closeToTray: true,
  openAtLogin: false,
  localProjects: [],
  lastSeenVersion: '',
  language: 'auto',
  faceLiveness: true,
};

const file = () => join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    // a value of the wrong type (hand-edited file, older version) falls back to its default instead of breaking a view
    if (existsSync(file())) return sanitizeStored(JSON.parse(readFileSync(file(), 'utf8')), defaults);
  } catch {
    /* fall back to defaults */
  }
  return { ...defaults, localProjects: [] };
}

/** Main-process writes. Whatever comes from the renderer goes through `rendererPatch` first (see settings-core). */
export function saveSettings(patch: Partial<Settings>): Settings {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => Object.hasOwn(defaults, k)));
  const next = { ...loadSettings(), ...clean };
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
