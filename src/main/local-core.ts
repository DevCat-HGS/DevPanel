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
