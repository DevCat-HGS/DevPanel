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
