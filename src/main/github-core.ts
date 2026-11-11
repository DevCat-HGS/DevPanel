// Pure GitHub helpers (no Electron imports, unit-testable): bounded response cache and rate-limit parsing.

/** Every GitHub request gives up after this long, so a hung network never leaves an IPC call pending for minutes. */
export const GITHUB_TIMEOUT_MS = 15_000;

/** Map with a size cap that drops the least recently used entry, so a long-lived tray app does not keep every response. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Map keeps insertion order: re-inserting moves the key to the "most recent" end
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export const ETAG_CACHE_MAX = 200;
/** Bigger bodies are not worth keeping in memory just to save one request. */
export const MAX_CACHED_BODY = 1_000_000;

interface HeaderSource {
  get(name: string): string | null;
}

/**
 * When a response means "rate limited", the time (ms since epoch) at which asking again makes sense; null otherwise.
 * GitHub signals it with 429, or with 403 plus `x-ratelimit-remaining: 0`, `retry-after` or a "rate limit" message
 * (secondary limits). A plain 403 is a permission problem and stays null.
 */
export function rateLimitReset(status: number, headers: HeaderSource, body = '', now = Date.now()): number | null {
  if (status !== 403 && status !== 429) return null;
  const retryAfter = Number(headers.get('retry-after'));
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = Number(headers.get('x-ratelimit-reset'));
  const limited = status === 429 || remaining === '0' || headers.get('retry-after') !== null || /rate limit/i.test(body);
  if (!limited) return null;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;
  if (remaining === '0' && Number.isFinite(reset) && reset > 0) return Math.max(now, reset * 1000);
  return now + 60_000; // GitHub's advice when it gives no time: wait at least a minute
}

/** "GitHub limitó las consultas hasta las 14:05" in local time (Spanish source; the renderer translates it). */
export function rateLimitMessage(resetMs: number): string {
  const d = new Date(resetMs);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `GitHub limitó las consultas hasta las ${hhmm}`;
}

export const TIMEOUT_MESSAGE = 'GitHub no respondió a tiempo';

/** True for the error fetch throws when `AbortSignal.timeout` fires. */
export const isTimeout = (e: unknown): boolean => (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
