// E2E for the Local view tools: branches, commit (with the secret guard), push, translation comparison,
// secret scan and the fixed recipes. Everything runs on throwaway repos; no real flutter/firebase is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const root = mkdtempSync(join(tmpdir(), 'devpanel-lt-'));
const proj = join(root, 'migozz-app');
const remote = join(root, 'remote.git');
mkdirSync(join(proj, 'assets', 'translations'), { recursive: true });
const run = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...a], { cwd }).toString();

run(root, 'init', '-q', '--bare', remote);
run(root, 'init', '-q', '-b', 'main', proj);
writeFileSync(join(proj, 'pubspec.yaml'), 'name: migozz_app\n');
writeFileSync(join(proj, 'firebase.json'), '{}');
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'echo ok' } }));
writeFileSync(join(proj, 'assets', 'translations', 'en.json'), JSON.stringify({ hello: 'Hi', menu: { home: 'Home', chat: 'Chat' } }));
writeFileSync(join(proj, 'assets', 'translations', 'es.json'), JSON.stringify({ hello: 'Hola', menu: { home: 'Inicio' } }));
run(proj, 'add', '.');
run(proj, 'commit', '-q', '-m', 'primer commit');
run(proj, 'branch', 'feature');
run(proj, 'remote', 'add', 'origin', remote);
run(proj, 'push', '-q', '-u', 'origin', 'main');

const userData = mkdtempSync(join(tmpdir(), 'devpanel-lt-data-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat' }));
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.t', DEVPANEL_USER_DATA: userData, DEVPANEL_TEST_PICK_DIR: proj, DEVPANEL_GITHUB_API: 'http://127.0.0.1:9' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.GITHUB_TOKEN; // CI exports one: these tests control the token themselves
// Some machines already set this globally, which would hide a planted npm.cmd: the app has to set it itself.
for (const k of Object.keys(env)) if (/^NoDefaultCurrentDirectoryInExePath$/i.test(k)) delete env[k];

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
const card = (page) => page.locator('.local-card');
const term = (page) => page.textContent('#term-out');
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.waitForSelector('.nav[data-view="local"]');
  await page.click('.nav[data-view="local"]');
  await page.click('#local-add');
  await page.waitForSelector('.local-card');

  // ---------- the card is icon-first and knows the project type ----------
  assert.equal(await card(page).locator('.branch-select').inputValue(), 'main');
  await page.waitForFunction(() => document.querySelector('.branch-select').options.length === 2);
  assert.deepEqual(await card(page).locator('.recipe-btn').evaluateAll((n) => n.map((b) => b.title)), [
    'flutter pub get', 'flutter analyze', 'flutter test', 'flutter doctor -v', 'firebase emulators:start',
  ]);
  assert.ok(await card(page).locator('button[title="Comparar idiomas"]').isVisible(), 'translation files were detected');
  for (const b of await card(page).locator('.actions .icon-btn').all()) {
    assert.equal((await b.textContent()).trim(), '', 'icon-only');
    assert.ok(await b.getAttribute('title'));
  }
  await shot(page, 'l1-local-card');
  log('the card detects Flutter + Firebase, offers their fixed recipes and translations as icon buttons');

  // ---------- translations ----------
  await card(page).locator('button[title="Comparar idiomas"]').click();
  await page.waitForSelector('.chip.l10n.warn');
  assert.equal((await page.textContent('.chip.l10n')).trim(), '1');
  const t1 = await term(page);
  assert.match(t1, /es: faltan 1/);
  assert.match(t1, /menu\.chat/);
  log('comparing languages lists exactly the key missing from es.json');

  // ---------- branches ----------
  await card(page).locator('.branch-select').selectOption('feature');
  await page.waitForSelector('.toast.ok:has-text("git checkout feature listo")');
  await page.waitForFunction(() => document.querySelector('.branch-select').value === 'feature');
  assert.equal(run(proj, 'branch', '--show-current').trim(), 'feature');
  log('the branch picker checks out another branch');

  // ---------- commit + push ----------
  writeFileSync(join(proj, 'nuevo.txt'), 'hola');
  await card(page).locator('button[title="Fetch"]').click(); // refresh the status
  await page.waitForSelector('.chip.dirty');
  await card(page).locator('button[title="Hacer commit"]').click();
  await page.click('.commit-row input');
  await page.keyboard.type('añade nuevo.txt'); // real keystrokes: fill() bypasses keydown handlers
  await page.press('.commit-row input', 'Enter');
  await page.waitForSelector('.toast.ok:has-text("Commit hecho")');
  assert.equal(run(proj, 'log', '-1', '--format=%s').trim(), 'añade nuevo.txt');
  await page.waitForSelector('.chip.clean');
  log('commit stages the changes and records the message; the dirty chip turns into a green check');

  // keyboard users keep their place: the redraw after a git action gives the focus back to the same button
  await card(page).locator('button[title="Fetch"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast.ok:has-text("git fetch listo")');
  await page.waitForFunction(() => document.activeElement?.getAttribute('title') === 'Fetch', null, { timeout: 5000 });
  log('after a git action run from the keyboard the focus is back on the same button of the redrawn card');

  await card(page).locator('button[title="Push"]').click();
  await page.waitForSelector('.toast.ok:has-text("git push listo")');
  assert.equal(run(remote, 'log', '-1', '--format=%s', 'feature').trim(), 'añade nuevo.txt');
  log('push works even without an upstream (it sets origin/feature) and the remote receives the commit');

  // ---------- secret guard ----------
  const fakeKey = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'; // built at run time so no scanner flags this repo
  writeFileSync(join(proj, 'config.txt'), `aws = ${fakeKey}\n`);
  writeFileSync(join(proj, '.env'), 'TOKEN=1\n');
  await card(page).locator('button[title="Fetch"]').click();
  await page.waitForSelector('.chip.dirty');
  const before = run(proj, 'log', '-1', '--format=%H');
  await card(page).locator('button[title="Hacer commit"]').click();
  await page.fill('.commit-row input', 'no debería entrar');
  await page.press('.commit-row input', 'Enter');
  await page.waitForSelector('.toast.bad:has-text("secretos")'); // an older toast may still be on screen
  assert.match(await page.textContent('.toast.bad:has-text("secretos")'), /secretos/);
  assert.equal(run(proj, 'log', '-1', '--format=%H'), before, 'nothing was committed');
  const t2 = await term(page);
  assert.match(t2, /config\.txt:1\s+\[aws-access-key\]/);
  assert.match(t2, /\.env\s+\[env-file\]/);
  assert.ok(!t2.includes(fakeKey), 'the secret itself is never printed');
  log('a commit with an access key and a .env is refused, lists the files and never prints the secret');

  // ---------- scan of what is already tracked ----------
  rmSync(join(proj, '.env'));
  writeFileSync(join(proj, 'leak.txt'), `key=${fakeKey}\n`);
  run(proj, 'add', 'leak.txt');
  run(proj, 'commit', '-q', '-m', 'leak');
  await card(page).locator('button[title="Buscar secretos"]').click();
  await page.waitForFunction(() => document.getElementById('term-out').textContent.includes('leak.txt'));
  await page.waitForSelector('.chip.secrets.bad');
  assert.match(await term(page), /leak\.txt:1\s+\[aws-access-key\]/);
  assert.ok(!(await term(page)).includes(fakeKey));
  await shot(page, 'l2-secrets');
  log('scanning the tracked files finds the leaked key and shows a red shield with the count');

  // ---------- un-tracking a secret is the fix the scan asks for, so it has to be committable ----------
  rmSync(join(proj, 'config.txt'));
  writeFileSync(join(proj, '.env'), 'TOKEN=1\n');
  run(proj, 'add', '-f', '.env');
  run(proj, 'commit', '-q', '-m', 'sube el .env por error');
  run(proj, 'rm', '-q', '--cached', '.env');
  const stillThere = await page.evaluate((p) => window.devpanel.local.commit(p, 'sigue en disco y sin ignorar'), proj);
  assert.equal(stillThere.ok, false, 'un-tracked but not ignored: add -A would bring it straight back');
  assert.deepEqual(stillThere.findings.map((f) => f.rule), ['env-file']);
  writeFileSync(join(proj, '.gitignore'), '.env\n');
  const untrack = await page.evaluate((p) => window.devpanel.local.commit(p, 'deja de versionar .env'), proj);
  assert.equal(untrack.ok, true, untrack.output);
  assert.equal(run(proj, 'log', '-1', '--format=%s').trim(), 'deja de versionar .env');
  assert.deepEqual(run(proj, 'ls-files').split('\n').filter((f) => f.startsWith('.')), ['.gitignore']);
  assert.ok(existsSync(join(proj, '.env')), 'the file itself stays on disk');
  assert.equal(run(proj, 'status', '--porcelain').trim(), '');
  log('a .env that stops being tracked (git rm --cached + .gitignore) can be committed; without the ignore rule it is still refused');

  // ---------- the renderer cannot run anything outside the fixed lists ----------
  const bad = await page.evaluate(async (p) => ({
    recipe: await window.devpanel.local.recipe(p, 'rm-rf'),
    otherRecipe: await window.devpanel.local.recipe('C:/Windows', 'flutter-doctor'),
    branch: await window.devpanel.local.checkout(p, 'feature && calc'),
    msg: await window.devpanel.local.commit(p, 'a\nb'),
    outside: await window.devpanel.local.push('C:/Windows'),
  }), proj);
  assert.ok('error' in bad.recipe && 'error' in bad.otherRecipe);
  assert.equal(bad.branch.ok, false);
  assert.equal(bad.msg.ok, false);
  assert.equal(bad.outside.ok, false);
  log('unknown recipes, unregistered folders, shell-looking branch names and multi-line messages are refused');

  // ---------- Python diagnosis: manager, problems before they hurt, fixes ----------
  assert.equal((await card(page).locator('.chip.branch').allTextContents()).includes('npm'), true, 'the manager is shown on the card');
  await card(page).locator('button[title^="Diagnóstico"]').click();
  await page.waitForFunction(() => /Faltan las dependencias/.test(document.querySelector('.diag')?.textContent ?? ''));
  const diagText = await page.textContent('.diag');
  assert.match(diagText, /Faltan las dependencias/, 'no node_modules is reported');
  assert.ok(await page.locator('.diag .diag-act', { hasText: 'Instalar con npm' }).isVisible(), 'and a one-click fix is offered');
  assert.ok(await page.locator('.diag .diag-act', { hasText: 'build' }).isVisible(), 'scripts run through the detected manager');
  assert.match(diagText, /Flutter/, 'the Flutter block is there');
  await shot(page, 'l2-diagnosis');
  const refused = await page.evaluate(async (p) => ({
    bad: await window.devpanel.local.action(p, 'rm -rf /'),
    other: await window.devpanel.local.action('C:/Windows', 'install'),
    device: await window.devpanel.local.action(p, 'flutter-run:x & calc'),
  }), proj);
  assert.ok('error' in refused.bad && 'error' in refused.other && 'error' in refused.device);
  log('Python diagnosis shows the manager, the missing dependencies with a fix and the scripts; unknown actions are refused');

  // ---------- one process at a time ----------
  const termCount = (re) => page.evaluate((src) => (document.getElementById('term-out').textContent.match(new RegExp(src, 'g')) ?? []).length, re);
  const cmdsBefore = await page.locator('#term-out .cmd').count();
  const exitsBefore = await termCount('proceso terminó');
  // a diagnosis action inspects the project before it starts: the script button is clicked twice during that wait
  const whileStarting = await page.evaluate(() => {
    [...document.querySelectorAll('.diag .diag-run')].find((b) => b.textContent.includes('build')).click();
    const script = document.querySelector('.script-btn');
    const disabled = script.disabled;
    script.click();
    script.click();
    return disabled;
  });
  assert.equal(whileStarting, true, 'the run buttons are disabled as soon as something is starting');
  await page.waitForFunction((n) => (document.getElementById('term-out').textContent.match(/proceso terminó/g) ?? []).length > n, exitsBefore, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.script-btn').disabled);
  await page.waitForTimeout(1500); // a second process would announce itself by now
  assert.equal(await page.locator('#term-out .cmd').count(), cmdsBefore + 1, 'only one command was launched');
  assert.equal(await termCount('proceso terminó'), exitsBefore + 1, 'and only one process ran');
  assert.ok(await page.locator('#term-stop').isDisabled(), 'nothing is left running out of reach of Stop');
  log('while a process is starting, a second script (or a double click) starts nothing and the run buttons stay disabled until it ends');

  // ---------- read-only explorer ----------
  await card(page).locator('button[title="Explorar archivos"]').click();
  await page.waitForSelector('#files-modal:not(.hidden) .ft-row');
  assert.ok(await page.locator('.ft-row', { hasText: 'pubspec.yaml' }).isVisible());
  await page.locator('.ft-row', { hasText: 'pubspec.yaml' }).click();
  await page.waitForSelector('.code-line');
  assert.match(await page.textContent('#files-view'), /name: migozz_app/);
  await page.click('#files-search');
  await page.keyboard.type('Hola');
  await page.press('#files-search', 'Enter');
  await page.waitForSelector('.hit-row');
  assert.match(await page.textContent('.hit-row'), /es\.json:1/);
  await page.locator('.hit-row').first().click();
  await page.waitForSelector('.code-line.hit');
  await page.click('#files-copy');
  await page.waitForSelector('.toast:has-text("Copiado al portapapeles")');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.toast:has-text("Ruta copiada")').count(), 0, 'no second, unconditional "copied" toast');
  assert.equal(await page.locator('.toast:has-text("Copiado")').count(), 1, 'copying the path shows exactly one toast');
  const outside = await page.evaluate(async (p) => ({
    up: await window.devpanel.local.read(p, '../remote.git/HEAD'),
    abs: await window.devpanel.local.read(p, 'C:/Windows/win.ini'),
    tree: await window.devpanel.local.tree(p, '..'),
    other: await window.devpanel.local.read('C:/Windows', 'win.ini'),
    top: (await window.devpanel.local.tree(p, '')).map((e) => e.name),
  }), proj);
  assert.equal(outside.up.ok, false);
  assert.equal(outside.abs.ok, false);
  assert.deepEqual(outside.tree, []);
  assert.equal(outside.other.ok, false);
  assert.ok(!outside.top.includes('.git'), '.git is not listed');
  await shot(page, 'l3-explorer');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#files-modal').isHidden());
  log('the explorer lists files, shows code with line numbers, finds text and jumps to the line; paths outside the project are refused');

  // ---------- the renderer cannot register folders behind the dialog's back ----------
  const tampered = await page.evaluate((r) => window.devpanel.settings.set({ localProjects: [r], language: 'klingon', githubUser: 'octocat' }), root);
  assert.equal(tampered.localProjects.length, 1, 'settings.set cannot add a folder');
  assert.ok(!tampered.localProjects.includes(root));
  assert.equal(tampered.language, 'es', 'an invalid value is dropped');
  const outsideRead = await page.evaluate((r) => window.devpanel.local.read(r, 'remote.git/HEAD'), root);
  assert.equal(outsideRead.ok, false, 'so files outside the registered project stay unreadable');
  log('settings.set from the renderer cannot register a folder nor store invalid values');

  // ---------- programs planted in the project folder never run ----------
  if (process.platform === 'win32') {
    writeFileSync(join(proj, 'npm.cmd'), '@echo PLANTADO-NPM\r\n');
    copyFileSync(process.execPath, join(proj, 'git.exe')); // node.exe: if it ran instead of git, every git call would fail
    const exits = await page.evaluate(() => (document.getElementById('term-out').textContent.match(/proceso terminó/g) ?? []).length);
    await card(page).locator('.script-btn', { hasText: 'build' }).click();
    await page.waitForFunction((n) => (document.getElementById('term-out').textContent.match(/proceso terminó/g) ?? []).length > n, exits, { timeout: 60000 });
    const out = await term(page);
    assert.ok(!out.includes('PLANTADO-NPM'), 'the npm.cmd in the project folder did not run');
    assert.match(out, /código 0/, 'the real npm ran the script');
    const branches = await page.evaluate((p) => window.devpanel.local.branches(p), proj);
    assert.equal(branches.current, 'feature', 'git calls still reach the real git');
    rmSync(join(proj, 'npm.cmd'));
    rmSync(join(proj, 'git.exe'));
    log('an npm.cmd or git.exe dropped in the project root is ignored: scripts and git use the real programs');
  }

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Local tools test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'l-failure.png') });
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${name}.png`) });
}
