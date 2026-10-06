// Pure helpers for the Claude Code panel: they turn the `claude -p --output-format stream-json` lines into chat events.
import type { ChatEvent } from '../shared/api';

export type { ChatEvent };

/** A session id as `claude --resume` accepts it; anything else is never put on a command line. */
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);

const clip = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The most telling field of a tool call (file, command, pattern...), so the chat can say "Read src/main.ts". */
export function toolDetail(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description']) {
    if (typeof o[k] === 'string' && o[k]) return clip(String(o[k]).replace(/\s+/g, ' '));
  }
  return '';
}

export function parseStreamLine(line: string): ChatEvent[] {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return [];
  }
  if (!m || typeof m !== 'object') return [];
  if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
    return [{ kind: 'init', session: m.session_id, model: typeof m.model === 'string' ? m.model : undefined }];
  }
  if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
    const out: ChatEvent[] = [];
    for (const c of m.message.content) {
      if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) out.push({ kind: 'text', text: c.text });
      else if (c?.type === 'tool_use' && typeof c.name === 'string') out.push({ kind: 'tool', name: c.name, detail: toolDetail(c.input) });
    }
    return out;
  }
  if (m.type === 'result') {
    return [{
      kind: 'result',
      ok: !m.is_error && m.subtype === 'success',
      text: typeof m.result === 'string' ? m.result : '',
      session: typeof m.session_id === 'string' ? m.session_id : undefined,
      ms: typeof m.duration_ms === 'number' ? m.duration_ms : undefined,
      cost: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined,
    }];
  }
  return [];
}

/** Splits a stream into complete lines, keeping the unfinished tail for the next chunk. */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split(/\r?\n/);
  const rest = parts.pop() ?? '';
  return { lines: parts.filter((l) => l.trim()), rest };
}
