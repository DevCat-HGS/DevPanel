// Builds release notes from commit subjects (conventional commits) and prints them as markdown.
//   node scripts/release-notes.mjs --tag v0.1.30        (used by the release workflow)
import { execFileSync } from 'node:child_process';

const GROUPS = [
  { key: 'feat', title: '✨ Novedades · What\'s new' },
  { key: 'fix', title: '🐛 Correcciones · Fixes' },
  { key: 'other', title: '🔧 Mejoras internas · Under the hood' },
];

/** "feat(app): add x" -> { type: 'feat', scope: 'app', text: 'add x' } */
export function parseSubject(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!m) return { type: 'other', scope: '', text: subject.trim() };
  const type = m[1].toLowerCase();
  return { type: type === 'feat' || type === 'fix' ? type : 'other', scope: m[2] ?? '', text: m[3].trim() };
}

export function buildNotes(subjects) {
  const buckets = { feat: [], fix: [], other: [] };
  for (const s of subjects) {
    const line = s.trim();
    if (!line || /^Merge /.test(line)) continue;
    const { type, scope, text } = parseSubject(line);
    buckets[type].push(scope ? `**${scope}:** ${text}` : text);
  }
  const out = [];
  for (const g of GROUPS) {
    if (!buckets[g.key].length) continue;
    out.push(`## ${g.title}`, ...buckets[g.key].map((l) => `- ${l}`), '');
  }
  return out.length ? out.join('\n').trimEnd() + '\n' : 'Sin cambios destacados · No notable changes\n';
}

// ---------- CLI ----------
function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function previousTag(current) {
  try {
    const list = JSON.parse(sh('gh', ['release', 'list', '--limit', '50', '--json', 'tagName,isPrerelease']));
    const dev = current.endsWith('-dev');
    // a stable release summarises everything since the previous STABLE one; a dev one since the last release
    return list.find((r) => r.tagName !== current && (dev || !r.isPrerelease))?.tagName ?? null;
  } catch {
    return null;
  }
}

if (process.argv[1] && process.argv[1].endsWith('release-notes.mjs')) {
  const tag = process.argv[process.argv.indexOf('--tag') + 1];
  if (!tag) throw new Error('usage: release-notes.mjs --tag vX.Y.Z');
  let subjects = [];
  try {
    try {
      sh('git', ['fetch', '--tags', '--force']);
    } catch {
      /* offline: use what we have */
    }
    const prev = previousTag(tag);
    let range = prev ? `${prev}..HEAD` : '-n20';
    try {
      if (prev) sh('git', ['rev-parse', '--verify', `${prev}^{commit}`]);
    } catch {
      range = '-n20';
    }
    subjects = sh('git', ['log', range, '--no-merges', '--pretty=%s']).split('\n');
  } catch {
    subjects = [];
  }
  process.stdout.write(buildNotes(subjects));
}
