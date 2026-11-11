// Pure rules of the lock screen (no Electron imports, unit-testable).

/** Wrong codes allowed before the first wait. */
export const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 15 * 60_000;

/** How long to refuse codes after `fails` consecutive wrong ones: nothing for the first few, then 30 s doubling up to 15 min. */
export function lockoutMs(fails: number): number {
  if (!Number.isFinite(fails) || fails < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (fails - FREE_ATTEMPTS), MAX_WAIT_MS);
}

export interface Attempts {
  fails: number;
  /** epoch ms until which codes are refused without being checked */
  until: number;
}

/** Attempts read from disk; anything malformed counts as a clean slate. */
export function parseAttempts(raw: unknown): Attempts {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fails = Number.isInteger(r.fails) && (r.fails as number) >= 0 ? (r.fails as number) : 0;
  const until = typeof r.until === 'number' && Number.isFinite(r.until) ? r.until : 0;
  return { fails, until };
}

/** The state after one checked code. */
export const afterAttempt = (a: Attempts, ok: boolean, now: number): Attempts =>
  ok ? { fails: 0, until: 0 } : { fails: a.fails + 1, until: now + lockoutMs(a.fails + 1) };

/** Seconds still to wait (rounded up), 0 when a code can be checked now. */
export const waitSeconds = (a: Attempts, now: number): number => Math.max(0, Math.ceil((a.until - now) / 1000));

/** A stored code is usable only with a hex salt and a 32-byte hex hash; anything else is "no code". */
export function parsePinFile(raw: unknown): { salt: string; hash: string } | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return typeof r.salt === 'string' && /^[0-9a-f]{32}$/i.test(r.salt) && typeof r.hash === 'string' && /^[0-9a-f]{64}$/i.test(r.hash)
    ? { salt: r.salt, hash: r.hash }
    : null;
}
