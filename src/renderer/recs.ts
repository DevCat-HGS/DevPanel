import type { Repo } from '../shared/api';

export interface Rec {
  repo: string;
  level: 'bad' | 'warn' | 'info';
  text: string;
}

const DAY = 86_400_000;

/** Health recommendations derived from public repository metadata. */
export function analyzeRepos(repos: Repo[], now = Date.now()): Rec[] {
  const out: Rec[] = [];
  for (const r of repos) {
    if (r.archived) continue;
    const idle = Math.floor((now - new Date(r.pushed_at).getTime()) / DAY);
    if (idle > 180)
      out.push({ repo: r.name, level: 'warn', text: `Sin actividad hace ${idle} días: retómalo o archívalo.` });
    if (!r.description) out.push({ repo: r.name, level: 'info', text: 'Añade una descripción para que se entienda de un vistazo.' });
    if (!r.license) out.push({ repo: r.name, level: 'info', text: 'Sin licencia: otros no saben si pueden usar el código.' });
    if (!r.topics?.length) out.push({ repo: r.name, level: 'info', text: 'Agrega topics para que sea más fácil de encontrar.' });
    if ((r.open_issues_count ?? 0) >= 10)
      out.push({ repo: r.name, level: 'warn', text: `${r.open_issues_count} issues abiertos: conviene priorizarlos.` });
  }
  const weight = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => weight[a.level] - weight[b.level]);
}
