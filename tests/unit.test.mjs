import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../dist/renderer/tools.js';
import { analyzeRepos } from '../dist/renderer/recs.js';
import { newFailures } from '../dist/main/alerts-core.js';
import { pageWindow } from '../dist/renderer/pager.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandPath, extractVersion, findExisting, parseWingetChunk, WINGET_OK_CODES } from '../dist/main/software-core.js';
import { buildNotes, parseSubject } from '../scripts/release-notes.mjs';
import { htmlToText, parseNotes } from '../dist/renderer/notes-md.js';
import { parseGitStatus, isSafeScriptName, stripAnsi } from '../dist/main/local-core.js';

test('json: format, minify, validate', () => {
  assert.equal(t.formatJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(t.minifyJson('{ "a" : [1, 2] }'), '{"a":[1,2]}');
  assert.match(t.validateJson('{"a":1}'), /válido/);
  assert.match(t.validateJson('{bad'), /✘/);
  assert.throws(() => t.formatJson('{bad'));
});

test('base64 round-trips unicode and url-safe input', () => {
  const s = 'Hola 🔥 ñandú';
  assert.equal(t.base64Decode(t.base64Encode(s)), s);
  assert.equal(t.base64Encode('hello'), 'aGVsbG8=');
  assert.equal(t.base64Decode('aGVsbG8'), 'hello');
});

test('url encode/decode', () => {
  assert.equal(t.urlEncode('a b&c'), 'a%20b%26c');
  assert.equal(t.urlDecode('a%20b%26c'), 'a b&c');
});

test('hash matches known digests', async () => {
  assert.equal(await t.hashHex('SHA-256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await t.hashHex('SHA-1', 'abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('uuids: count is clamped and values are unique v4', () => {
  const list = t.uuids(3).split('\n');
  assert.equal(list.length, 3);
  assert.equal(new Set(list).size, 3);
  assert.match(list[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(t.uuids(9999).split('\n').length, 50);
});

test('jwt decode shows payload and expiry', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: '1', exp: 1 })}.sig`;
  const out = t.decodeJwt(jwt);
  assert.match(out, /"sub": "1"/);
  assert.match(out, /EXPIRADO/);
  assert.throws(() => t.decodeJwt('nope'));
});

test('time converts unix seconds, ms and ISO', () => {
  assert.match(t.convertTime('0'), /1970-01-01T00:00:00.000Z/);
  assert.match(t.convertTime('1700000000000'), /2023-11-14T22:13:20.000Z/);
  assert.match(t.convertTime('2020-01-01T00:00:00Z'), /Unix \(s\):   1577836800/);
  assert.throws(() => t.convertTime('garbage'));
});

test('regex tester reports matches and groups', () => {
  const out = t.testRegex(String.raw`/(\d)(\w)/g` + '\nab 1x 2y');
  assert.match(out, /2 coincidencia/);
  assert.match(out, /"1x"/);
  assert.equal(t.testRegex('/zzz/\nabc'), 'Sin coincidencias');
  assert.throws(() => t.testRegex('no slashes'));
});

test('recommendations flag stale, undocumented and busy repos', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const repo = (o) => ({ name: 'r', description: 'd', language: 'TS', html_url: '', private: false, default_branch: 'main',
    pushed_at: '2026-09-30T00:00:00Z', license: { spdx_id: 'MIT' }, topics: ['x'], open_issues_count: 0, ...o });
  assert.equal(analyzeRepos([repo({})], now).length, 0);
  const recs = analyzeRepos([repo({ description: null, license: null, topics: [], pushed_at: '2025-01-01T00:00:00Z', open_issues_count: 12 })], now);
  assert.equal(recs.length, 5);
  assert.equal(recs[0].level, 'warn');
  assert.equal(analyzeRepos([repo({ archived: true, description: null })], now).length, 0);
});

test('alerts: first sight only records; later failures notify once', () => {
  const run = (id, conclusion, status = 'completed') => ({ repo: 'r', id, status, conclusion, url: 'u' });
  let state = newFailures({}, [run(1, 'failure')]);
  assert.equal(state.failures.length, 0, 'old failure at startup is not announced');
  assert.equal(state.seen.r, 1);

  state = newFailures(state.seen, [run(2, 'success')]);
  assert.equal(state.failures.length, 0);

  state = newFailures(state.seen, [run(3, 'failure')]);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].id, 3);

  state = newFailures(state.seen, [run(3, 'failure')]);
  assert.equal(state.failures.length, 0, 'the same run is never announced twice');

  state = newFailures(state.seen, [run(4, null, 'in_progress')]);
  assert.equal(state.failures.length, 0, 'runs still in progress are ignored');
  assert.equal(state.seen.r, 3);
});

test('git status parsing covers upstream, ahead/behind, dirty and edge cases', () => {
  assert.deepEqual(parseGitStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n'),
    { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, dirty: 2 });
  assert.deepEqual(parseGitStatus('## develop...origin/develop\n'),
    { branch: 'develop', upstream: 'origin/develop', ahead: 0, behind: 0, dirty: 0 });
  assert.equal(parseGitStatus('## feature/x\n M a\n').upstream, null);
  assert.equal(parseGitStatus('## No commits yet on main\n').branch, 'main');
  assert.equal(parseGitStatus('## HEAD (no branch)\n').branch, 'HEAD suelto');
  assert.equal(parseGitStatus('## main...origin/main [behind 3]\n').behind, 3);
});

test('only safe npm script names are accepted', () => {
  for (const ok of ['build', 'test:e2e', 'dev-server', 'lint_fix', 'a.b']) assert.ok(isSafeScriptName(ok), ok);
  for (const bad of ['', 'a b', 'build && calc', 'x;y', '$(id)', '../x', 'a'.repeat(65)]) assert.ok(!isSafeScriptName(bad), bad);
});

test('ansi escapes are stripped from terminal output', () => {
  assert.equal(stripAnsi('\u001b[31mroja\u001b[0m ok'), 'roja ok');
  assert.equal(stripAnsi('linea\r\nfin'), 'linea\r\nfin');
});

test('release notes group conventional commits and skip merges', () => {
  assert.deepEqual(parseSubject('feat(app): add x'), { type: 'feat', scope: 'app', text: 'add x' });
  assert.equal(parseSubject('ci!: break it').type, 'other');
  assert.equal(parseSubject('random message').type, 'other');
  const md = buildNotes(['feat(app): one', 'fix: two', 'docs: three', 'Merge branch x', 'ci(release): four', 'feat: five']);
  assert.match(md, /## ✨ Novedades/);
  assert.match(md, /- \*\*app:\*\* one/);
  assert.match(md, /- five/);
  assert.match(md, /## 🐛 Correcciones[\s\S]*- two/);
  assert.match(md, /## 🔧 Mejoras internas[\s\S]*- three[\s\S]*\*\*release:\*\* four/);
  assert.ok(!md.includes('Merge'));
  assert.ok(md.indexOf('Novedades') < md.indexOf('Correcciones') && md.indexOf('Correcciones') < md.indexOf('Mejoras'));
  assert.match(buildNotes([]), /Sin cambios destacados/);
});

test('release notes parser handles markdown and the HTML electron-updater returns', () => {
  const md = parseNotes('## Cambios\n- uno **importante**\n- dos\n\nTexto suelto');
  assert.deepEqual(md.map((b) => b.type), ['h', 'li', 'li', 'p']);
  assert.equal(md[1].text, 'uno importante');
  const html = parseNotes('<h2>Cambios</h2><ul><li>uno &amp; dos</li><li>tres</li></ul><script>alert(1)</script>');
  assert.equal(html[0].text, 'Cambios');
  assert.equal(html[1].text, 'uno & dos');
  assert.equal(html.length, 4, 'tags are stripped; scripts never become markup');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
});

test('winget progress is read from numbers only (any language)', () => {
  assert.equal(parseWingetChunk('  ██████░░░░░░░░░░░░░░  45%').percent, 45);
  assert.equal(parseWingetChunk('  28.0 MB / 62.3 MB').percent, 45);
  assert.equal(parseWingetChunk('  512 KB / 2.0 MB').percent, 25);
  assert.equal(parseWingetChunk('12,5 MB / 25,0 MB').percent, 50, 'decimal comma');
  assert.equal(parseWingetChunk('\r  10%\r  55%\r  90%').percent, 90, 'the last value in the chunk wins');
  assert.equal(parseWingetChunk('  400%').percent, 100, 'clamped');
  assert.equal(parseWingetChunk('Starting package install...').installing, true);
  assert.equal(parseWingetChunk('Iniciando instalación del paquete...').installing, true);
  assert.deepEqual(parseWingetChunk('Found Git [Git.Git] Version 2.47.0'), {});
});

test('versions are extracted from typical --version output', () => {
  assert.equal(extractVersion('git version 2.47.0.windows.1'), '2.47.0');
  assert.equal(extractVersion('v22.14.0'), '22.14.0');
  assert.equal(extractVersion('Python 3.13.1'), '3.13.1');
  assert.equal(extractVersion('no digits here'), undefined);
});

test('path patterns expand variables and wildcards, and never match when a variable is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'devpanel-sw-'));
  mkdirSync(join(root, 'MySQL Workbench 8.0 CE'), { recursive: true });
  writeFileSync(join(root, 'MySQL Workbench 8.0 CE', 'MySQLWorkbench.exe'), '');
  mkdirSync(join(root, 'Python313'), { recursive: true });
  writeFileSync(join(root, 'Python313', 'python.exe'), '');
  const env = { FAKE_ROOT: root };

  assert.equal(expandPath('%FAKE_ROOT%/plain.txt', env)[0], root + '/plain.txt');
  assert.equal(findExisting([join(root, 'MySQL Workbench *', 'MySQLWorkbench.exe')], env) !== null, true);
  assert.equal(findExisting(['%FAKE_ROOT%/Python3*/python.exe'], env) !== null, true);
  assert.equal(findExisting(['%FAKE_ROOT%/Nope*/x.exe'], env), null);
  assert.equal(findExisting(['%DOES_NOT_EXIST%/x.exe'], env), null);
  assert.deepEqual(expandPath('%DOES_NOT_EXIST%/x.exe', env), []);
  assert.equal(findExisting(undefined, env), null);
});

test('winget exit codes: already installed counts as success, other failures do not', () => {
  for (const ok of [0, -1978335189, -1978335135, 0x8a15002b, 0x8a150061]) assert.ok(WINGET_OK_CODES.has(ok), String(ok));
  for (const bad of [1, 2, -1, 0x8a150010]) assert.ok(!WINGET_OK_CODES.has(bad), String(bad));
});

test('the software catalog is consistent', () => {
  const cat = JSON.parse(readFileSync('src/shared/catalog.json', 'utf8'));
  const cats = new Set(cat.categories.map((c) => c.id));
  const ids = cat.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(cat.items.length >= 25);
  for (const must of ['python', 'claudecode', 'git', 'vscode', 'docker', 'postman', 'flutter', 'node']) assert.ok(ids.includes(must), must);
  for (const i of cat.items) {
    assert.ok(cats.has(i.category), `${i.id}: unknown category`);
    assert.ok(i.url.startsWith('https://'), `${i.id}: url must be https`);
    assert.ok(['app', 'web'].includes(i.kind), `${i.id}: kind`);
    if (i.kind === 'web') assert.ok(!i.winget && !i.detect, `${i.id}: web entries are only links`);
    if (i.winget) assert.match(i.winget, /^[A-Za-z0-9._-]+$/, `${i.id}: winget id`);
    if (i.winget) assert.ok(i.detect, `${i.id}: installable entries need a way to be detected`);
    if (i.brand) assert.ok(existsSync(`node_modules/simple-icons/icons/${i.brand}.svg`), `${i.id}: brand icon ${i.brand} missing`);
  }
  for (const c of cat.categories) assert.ok(cat.items.some((i) => i.category === c.id), `${c.id}: empty category`);
});

test('pager shows the first/last page, the neighbours of the current one and gaps as an ellipsis', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageWindow(5, 10), [1, '…', 4, 5, 6, '…', 10]);
  assert.deepEqual(pageWindow(1, 10), [1, 2, '…', 10]);
  assert.deepEqual(pageWindow(10, 10), [1, '…', 9, 10]);
  assert.deepEqual(pageWindow(2, 8), [1, 2, 3, '…', 8]);
  assert.deepEqual(pageWindow(3, 8), [1, 2, 3, 4, '…', 8]);
});
