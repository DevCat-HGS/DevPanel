// Pure logic for build-failure alerts (no Electron imports, so it is unit-testable).
export interface RunInfo {
  repo: string;
  id: number;
  status: string;
  conclusion: string | null;
  url: string;
  branch?: string;
}

/**
 * Compares the latest run of each repo with the last one we saw.
 * The first observation of a repo only records the run (no alert), so opening the app
 * never floods the user with old failures.
 */
export function newFailures(
  seen: Record<string, number>,
  runs: RunInfo[],
): { failures: RunInfo[]; seen: Record<string, number> } {
  const next = { ...seen };
  const failures: RunInfo[] = [];
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    const prev = next[r.repo];
    if (prev === undefined) {
      next[r.repo] = r.id;
    } else if (r.id > prev) {
      next[r.repo] = r.id;
      if (r.conclusion === 'failure') failures.push(r);
    }
  }
  return { failures, seen: next };
}
