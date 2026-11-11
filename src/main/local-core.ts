// Pure helpers for local projects (no Electron imports, unit-testable).
import { open } from 'node:fs/promises';

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

/** Parses `git status --porcelain=v1 -b` output. */
export function parseGitStatus(output: string): GitStatus {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const head = lines.find((l) => l.startsWith('## ')) ?? '';
  const dirty = lines.filter((l) => !l.startsWith('## ')).length;
  let branch = 'desconocida';
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  const text = head.slice(3);
  const noCommits = text.match(/^No commits yet on (.+)$/);
  if (noCommits) {
    branch = noCommits[1];
  } else if (text.startsWith('HEAD (no branch)')) {
    branch = 'HEAD suelto';
  } else if (text) {
    const m = text.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/);
    if (m) {
      branch = m[1];
      upstream = m[2] ?? null;
      const a = m[3]?.match(/ahead (\d+)/);
      const b = m[3]?.match(/behind (\d+)/);
      ahead = a ? Number(a[1]) : 0;
      behind = b ? Number(b[1]) : 0;
    }
  }
  return { branch, upstream, ahead, behind, dirty };
}

/**
 * Absolute path of a program found on PATH, never in the current folder. Windows (libuv included) looks in the
 * working directory first, and here the working directory is a project the user cloned: a `git.exe` planted in its
 * root would otherwise run just by registering the folder. Relative PATH entries are skipped for the same reason.
 */
export function findOnPath(
  name: string,
  pathEnv: string,
  opts: { win: boolean; pathExt?: string; exists: (p: string) => boolean },
): string | null {
  const sep = opts.win ? ';' : ':';
  const isAbs = opts.win ? (d: string) => /^[a-zA-Z]:[\\/]|^\\\\/.test(d) : (d: string) => d.startsWith('/');
  const exts = opts.win ? (opts.pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const raw of pathEnv.split(sep)) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !isAbs(dir)) continue;
    for (const ext of exts) {
      const full = `${dir.replace(/[\\/]+$/, '')}${opts.win ? '\\' : '/'}${name}${ext}`;
      if (opts.exists(full)) return full;
    }
  }
  return null;
}

/**
 * Environment for commands that go through cmd.exe inside a project folder: `NoDefaultCurrentDirectoryInExePath`
 * makes cmd skip the current folder when it looks up `npm`, `flutter` or `claude`, so a planted `npm.cmd` is ignored.
 */
export const projectShellEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...base, FORCE_COLOR: '0', NoDefaultCurrentDirectoryInExePath: '1' });

/** `vscode://file/...` link that opens a folder in VS Code without going through a shell. */
export const vscodeFolderUrl = (dir: string): string =>
  `vscode://file/${dir.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;

/** Script names we are willing to hand to `npm run`. */
export const isSafeScriptName = (name: string) => /^[A-Za-z0-9:_.-]{1,64}$/.test(name);

/** Removes ANSI colour/cursor escape sequences from terminal output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n');
}

// ---------- fixed "recipes": the only commands besides npm scripts that Local will ever run ----------
export interface Recipe {
  id: string;
  kind: 'flutter' | 'firebase';
  icon: string;
  cmd: string;
  args: string[];
}

export const RECIPES: Recipe[] = [
  { id: 'flutter-pub-get', kind: 'flutter', icon: 'download', cmd: 'flutter', args: ['pub', 'get'] },
  { id: 'flutter-analyze', kind: 'flutter', icon: 'search', cmd: 'flutter', args: ['analyze'] },
  { id: 'flutter-test', kind: 'flutter', icon: 'checkcircle', cmd: 'flutter', args: ['test'] },
  { id: 'flutter-doctor', kind: 'flutter', icon: 'info', cmd: 'flutter', args: ['doctor', '-v'] },
  { id: 'firebase-emulators', kind: 'firebase', icon: 'server', cmd: 'firebase', args: ['emulators:start'] },
];

export const recipesFor = (kinds: string[]): Recipe[] => RECIPES.filter((r) => kinds.includes(r.kind));
export const findRecipe = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id);
export const recipeCommand = (r: Recipe): string => [r.cmd, ...r.args].join(' ');

/** Branch names we are willing to pass to `git checkout`. */
export const isSafeBranch = (name: string): boolean => /^[A-Za-z0-9._/-]{1,100}$/.test(name) && !name.startsWith('-') && !name.includes('..');

/** One-line commit message without control characters, at most 200 characters. */
export const isSafeCommitMessage = (msg: string): boolean =>
  typeof msg === 'string' && msg.trim().length > 0 && msg.length <= 200 && !/[\u0000-\u001f\u007f]/.test(msg);

/**
 * True when `git add -A` will record this porcelain entry ("XY") as a deletion, so the commit gets no content from it.
 * Unmerged entries with a side still present (DU, UD) are not deletions: staging them adds the surviving file.
 */
const isDeletion = (xy: string): boolean => {
  const [x, y] = xy;
  return y === 'D' ? x !== 'U' : x === 'D' && y === ' ';
};

/**
 * Paths from `git status --porcelain=v1 -uall` ("XY path" or "XY old -> new") that bring content into the commit.
 * Deletions are left out: there is nothing of theirs to scan, and un-tracking a secret (`git rm --cached .env`)
 * must stay committable. If that file is still on disk and not ignored, git lists it again as "??" and it is scanned.
 */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.length > 3 && !l.startsWith('## ') && !isDeletion(l.slice(0, 2)))
    .map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"(.*)"$/, '$1'));
}

// ---------- actions offered by the Python inspection: only these shapes ever become a command ----------
export const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
const FLUTTER_ACTIONS: Record<string, string> = {
  'flutter-pub-get': 'flutter pub get', 'flutter-analyze': 'flutter analyze', 'flutter-test': 'flutter test',
  'flutter-doctor': 'flutter doctor -v', 'flutter-clean': 'flutter clean', 'flutter-upgrade': 'flutter upgrade',
};

export interface ActionFacts {
  manager: string | null;
  kinds: string[];
  scripts: string[];
  tasks: string[];
  devices: string[];
  emulators: string[];
}

/** Turns an action id into a command line, or null when it does not apply to this project. */
export function buildAction(id: string, f: ActionFacts): string | null {
  const m = f.manager;
  const js = (MANAGERS as readonly string[]).includes(m ?? '') ? m : null;
  if (id === 'install') return js ? `${js} install` : null;
  if (id === 'audit') return js && js !== 'bun' ? `${js} audit` : null;
  if (FLUTTER_ACTIONS[id]) return f.kinds.includes('flutter') ? FLUTTER_ACTIONS[id] : null;
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'script') return js && isSafeScriptName(arg) && f.scripts.includes(arg) ? `${js} run ${arg}` : null;
  if (kind === 'task') return m === 'deno' && isSafeScriptName(arg) && f.tasks.includes(arg) ? `deno task ${arg}` : null;
  if (kind === 'flutter-emulator') return f.kinds.includes('flutter') && f.emulators.includes(arg) ? `flutter emulators --launch ${arg}` : null;
  if (kind === 'flutter-run') return f.kinds.includes('flutter') && f.devices.includes(arg) ? `flutter run -d ${arg}` : null;
  return null;
}

// ---------- read-only file explorer ----------
export const MAX_READ_BYTES = 512 * 1024;

/**
 * The first `max` bytes of a file plus its real size. Only those bytes are read, so opening a 2 GB log
 * costs the same as a small file (reading it whole and slicing could freeze the app or run out of memory).
 */
export async function readHead(path: string, max: number): Promise<{ buf: Buffer; size: number; isFile: boolean }> {
  const fh = await open(path, 'r');
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { buf: Buffer.alloc(0), size: st.size, isFile: false };
    const buf = Buffer.alloc(Math.min(st.size, max));
    let got = 0;
    // read() may return fewer bytes than asked: loop until the buffer is full or the file ends
    while (got < buf.length) {
      const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return { buf: buf.subarray(0, got), size: st.size, isFile: true };
  } finally {
    await fh.close();
  }
}

/** Like Promise.all over `items`, but with at most `limit` calls running at once (keeps the disk and the event loop responsive). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.dart_tool', 'build', 'dist', '.gradle', 'Pods', '.next', '.idea', '__pycache__', '.venv', 'venv', 'release']);

/** A path relative to the project root: no absolute paths, no "..", no NUL. */
export function isSafeRel(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.includes('\u0000') || rel.length > 400) return false;
  if (/^([a-zA-Z]:|[\\/])/.test(rel)) return false;
  return !rel.split(/[\\/]/).includes('..');
}

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

/** Parses `git grep -n` output ("file:line:text"). */
export function parseGrep(output: string, limit = 200): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const l of output.split(/\r?\n/)) {
    const m = l.match(/^(.+?):(\d+):(.*)$/);
    if (m) hits.push({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) });
    if (hits.length >= limit) break;
  }
  return hits;
}
