// Pure helpers for local projects (no Electron imports, unit-testable).
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

/** Paths from `git status --porcelain=v1 -uall` ("XY path" or "XY old -> new"). */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.length > 3 && !l.startsWith('## '))
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
