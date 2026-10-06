import { BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { isSessionId, parseStreamLine, splitLines } from './claude-core';
import { stripAnsi } from './local-core';
import { loadSettings } from './settings';

export const MAX_PROMPT = 8000;
/** Read-only: Claude can look at the code but not change it. Edit: file edits are auto-approved (never a bypass of every permission). */
export const CLAUDE_MODES = { read: 'plan', edit: 'acceptEdits' } as const;
export type ClaudeMode = keyof typeof CLAUDE_MODES;

export const isValidPrompt = (p: unknown): p is string =>
  typeof p === 'string' && p.trim().length > 0 && p.length <= MAX_PROMPT && !p.includes('\u0000');

let nextId = 1;
const running = new Map<number, ChildProcess>();

const kill = (child: ChildProcess): void => {
  if (!child.pid) return;
  // `claude` may be a .cmd shim started through a shell: kill the whole tree
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
};

/** Only folders the user registered in Local can host a session. */
function known(path: string): string | null {
  const wanted = resolve(String(path)).toLowerCase();
  return loadSettings().localProjects.find((p) => resolve(p).toLowerCase() === wanted) ?? null;
}

export function setupClaude(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload);

  ipcMain.handle('claude:run', (_e, path: string, prompt: string, mode: ClaudeMode, session?: string) => {
    const dir = known(path);
    if (!dir) return { error: 'Proyecto no registrado' };
    if (!isValidPrompt(prompt)) return { error: 'Escribe una instrucción (máx. 8000 caracteres)' };
    const permission = CLAUDE_MODES[mode] ?? CLAUDE_MODES.read;
    if (session !== undefined && !isSessionId(session)) return { error: 'Sesión no válida' };
    const id = nextId++;
    // The command line is a constant; the user's text travels through stdin, so it can never become shell syntax.
    const child = spawn(`claude -p --output-format stream-json --verbose --permission-mode ${permission}${session ? ` --resume ${session}` : ''}`, [], { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    running.set(id, child);
    const emit = (stream: 'out' | 'err') => (d: Buffer) => send('claude:output', { id, stream, text: stripAnsi(d.toString()).slice(0, 20_000) });
    let pending = '';
    child.stdout?.on('data', (d: Buffer) => {
      const { lines, rest } = splitLines(pending, d.toString());
      pending = rest.length > 1_000_000 ? '' : rest; // one runaway line must not grow without bound
      for (const line of lines) {
        const events = parseStreamLine(line);
        if (events.length) for (const event of events) send('claude:event', { id, event });
        else send('claude:output', { id, stream: 'out', text: `${stripAnsi(line).slice(0, 2000)}\n` });
      }
    });
    child.stderr?.on('data', emit('err'));
    child.on('error', (e) => send('claude:output', { id, stream: 'err', text: String(e) }));
    child.on('close', (code) => {
      running.delete(id);
      send('claude:exit', { id, code: code ?? 0 });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
    return { id };
  });

  ipcMain.handle('claude:stop', (_e, id: number) => {
    const child = running.get(id);
    if (child) kill(child);
  });
}

export function stopAllClaude(): void {
  for (const child of running.values()) kill(child);
}
