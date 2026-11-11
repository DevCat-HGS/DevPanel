// Pure helpers for settings (no Electron imports, unit-testable).
import type { Settings } from '../shared/api';

/**
 * What the renderer may change, and the shape each value must have. `localProjects` is deliberately missing:
 * folders are only added through the native folder dialog (local:add), because every Local, explorer and
 * Claude action trusts that list. Anything else sent by the renderer is dropped.
 */
const RENDERER_KEYS: { [K in keyof Settings]?: (v: unknown) => boolean } = {
  githubUser: (v) => typeof v === 'string' && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))?$/.test(v),
  onboarded: (v) => typeof v === 'boolean',
  alertsEnabled: (v) => typeof v === 'boolean',
  closeToTray: (v) => typeof v === 'boolean',
  openAtLogin: (v) => typeof v === 'boolean',
  lastSeenVersion: (v) => typeof v === 'string' && v.length <= 64,
  language: (v) => v === 'auto' || v === 'es' || v === 'en',
  faceLiveness: (v) => typeof v === 'boolean',
};

/** Keeps only the keys the renderer may write, with a valid value. */
export function rendererPatch(patch: unknown): Partial<Settings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const valid = Object.hasOwn(RENDERER_KEYS, k) ? RENDERER_KEYS[k as keyof Settings] : undefined;
    if (valid?.(v)) out[k] = v;
  }
  return out as Partial<Settings>;
}

/** Settings read from disk, with anything of the wrong type replaced by its default (a broken file must not break the app). */
export function sanitizeStored(raw: unknown, defaults: Settings): Settings {
  const s: Settings = { ...defaults };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(defaults) as (keyof Settings)[]) {
    const v = r[k];
    if (k === 'localProjects') {
      if (Array.isArray(v)) s.localProjects = v.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length < 1024);
    } else if (v !== undefined && RENDERER_KEYS[k]?.(v)) {
      (s as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return s;
}
