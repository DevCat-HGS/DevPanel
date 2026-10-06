import type { HealthResult } from '../shared/api';
import { el, toast } from './dom.js';
import { icon } from './icons.js';

type Ok = Extract<HealthResult, { ok: true }>;

const LABEL: Record<string, string> = {
  git: 'Repositorio git', clean: 'Sin cambios pendientes', synced: 'Al día con el remoto', fresh: 'Actividad reciente',
  readme: 'README', license: 'Licencia', gitignore: '.gitignore', tests: 'Tests', ci: 'CI', lockfile: 'Lockfile',
  no_env: 'Sin secretos versionados', docs: 'Documentación', description: 'Descripción', topics: 'Topics',
  active: 'Actividad reciente', ci_pass: 'Último build correcto', issues: 'Issues bajo control', not_archived: 'No archivado',
};

export const checkLabel = (id: string): string => LABEL[id] ?? id;

const tone = (score: number): 'ok' | 'warn' | 'bad' => (score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'bad');

/** "B 86" chip; the tooltip lists what to improve. */
export function healthChip(r: Ok): HTMLElement {
  const failing = r.checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);
  const tip = failing.length
    ? `Salud ${r.score}/100. Por mejorar: ${failing.slice(0, 4).map((c) => `${checkLabel(c.id)} (${c.detail})`).join(', ')}`
    : `Salud ${r.score}/100. Todo en orden`;
  const c = el('span', `chip lc health ${tone(r.score)}`);
  c.title = tip;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', tip);
  c.append(icon('gauge'), document.createTextNode(`${r.grade} ${r.score}`));
  return c;
}

/** Runs a health call with a toast on failure; returns null if it failed. */
export async function runHealth(call: () => Promise<HealthResult>, btn?: HTMLButtonElement): Promise<Ok | null> {
  if (btn) btn.disabled = true;
  const r = await call();
  if (btn) btn.disabled = false;
  if (!r.ok) {
    toast(r.error, 'bad');
    return null;
  }
  toast(`Salud de ${r.name}: ${r.grade} (${r.score}/100)`, tone(r.score) === 'bad' ? 'bad' : 'ok');
  return r;
}
