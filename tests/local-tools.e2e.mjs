// E2E for the Local view tools: branches, commit (with the secret guard), push, translation comparison,
// secret scan and the fixed recipes. Everything runs on throwaway repos; no real flutter/firebase is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_TEST_PICK_DIR: proj, DEVPANEL_GITHUB_API: 'http://127.0.0.1:9' };
delete env.ELECTRON_RUN_AS_NODE;

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
  await page.fill('.commit-row input', 'añade nuevo.txt');
  await page.press('.commit-row input', 'Enter');
  await page.waitForSelector('.toast.ok:has-text("Commit hecho")');
  assert.equal(run(proj, 'log', '-1', '--format=%s').trim(), 'añade nuevo.txt');
  await page.waitForSelector('.chip.clean');
  log('commit stages the changes and records the message; the dirty chip turns into a green check');

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
  await page.waitForSelector('.toast.bad');
  assert.match(await page.textContent('.toast.bad'), /secretos/);
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
