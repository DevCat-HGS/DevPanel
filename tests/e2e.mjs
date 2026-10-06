// End-to-end smoke test: drives the real Electron app with Playwright against a throwaway profile.
//   npm run test:e2e            (needs network: it queries the public GitHub API)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'devpanel-e2e-'));
// The suite asserts Spanish texts; without this the app would follow the (English) CI runner's language.
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es' }));
const GH_USER = process.env.E2E_GH_USER ?? 'octocat';
let PIN = '1234';

// a throwaway git project for the "Local" view
const proj = mkdtempSync(join(tmpdir(), 'devpanel-proj-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...a], { cwd: proj });
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'demo', scripts: { hello: "node -e \"console.log('hola-desde-script')\"" } }));
git('init', '-q', '-b', 'trabajo');
git('add', '.');
git('commit', '-q', '-m', 'primer commit');
writeFileSync(join(proj, 'nuevo.txt'), 'sin commitear');

// VS Code-like hosts export ELECTRON_RUN_AS_NODE=1, which makes Electron start as plain Node.
// the catalog test pretends these are installed and fakes installs, so the real machine is never touched
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_TEST_PICK_DIR: proj,
  DEVPANEL_FAKE_SOFTWARE: JSON.stringify({ git: '2.47.0', node: '22.1.0', python: '3.13.1' }),
  DEVPANEL_FAKE_SOFTWARE_UPDATES: JSON.stringify(['node']) };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: ['.'], env });

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });

let app;
try {
  // ---------- first run: wizard ----------
  app = await launch();
  let page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForSelector('#wizard:not(.hidden)');
  log('first run shows the onboarding wizard');

  await page.fill('#wz-user', `https://github.com/${GH_USER}`);
  await page.click('#wz-user-btn');
  await page.waitForSelector('#wz-profile:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('wz-avatar').complete);
  assert.equal(await page.textContent('#wz-login'), `@${GH_USER}`);
  await shot(page, '1-wizard-github');
  log(`GitHub link resolves to @${GH_USER}`);

  await page.click('#wz-1-next');
  await page.waitForSelector('#wz-2.active .keypad');
  await page.keyboard.type('12');
  assert.equal(await page.locator('#wz-2 .dots i.on').count(), 2, 'incomplete codes do nothing yet');
  await page.keyboard.type('34'); // the 4th digit confirms by itself and asks to repeat
  await page.waitForFunction(() => document.querySelector('#wz-2 .cs-title').textContent.includes('Repite'));
  await page.keyboard.type('4321'); // mismatch
  await page.waitForFunction(() => document.querySelector('#wz-2 .cs-err').textContent.includes('coinciden'));
  await page.waitForFunction(() => document.querySelector('#wz-2 .cs-title').textContent.includes('Crea'));
  await page.keyboard.type(PIN);
  await page.waitForFunction(() => document.querySelector('#wz-2 .cs-title').textContent.includes('Repite'));
  await page.keyboard.type(PIN);
  await page.waitForSelector('#wz-3.active');
  await shot(page, '2-wizard-face');
  log('code validation works and the face step is reached');

  await page.click('#wz-skip');
  await page.waitForSelector('#wz-4.active');
  await page.click('#wz-enter');
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('.nav[data-view="projects"]');
  await page.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });
  assert.ok((await page.locator('.repo:not(.skeleton)').count()) > 0, 'repos rendered');
  await shot(page, '3-dashboard');
  log('dashboard loads the repositories of the linked account');

  assert.equal(await page.getAttribute('#recs', 'open'), null, 'recommendations start collapsed');
  await page.click('#recs summary');
  assert.ok(await page.locator('#recs li').first().isVisible());
  log('recommendations panel is collapsed by default and expands');

  // ---------- software catalog ----------
  await page.click('.nav[data-view="tools"]');
  await page.waitForSelector('.sw-card[data-id="git"][data-state="installed"]');
  assert.equal(await page.textContent('.sw-card[data-id="git"] .sw-ver'), '2.47.0');
  assert.equal(await page.getAttribute('.sw-card[data-id="docker"]', 'data-state'), 'missing');
  assert.equal(await page.getAttribute('.sw-card[data-id="github"]', 'data-state'), 'web');
  for (const id of ['python', 'claudecode', 'flutter', 'postman', 'vscode', 'cursor']) assert.equal(await page.locator(`.sw-card[data-id="${id}"]`).count(), 1, id);
  assert.ok((await page.locator('.sw-section').count()) >= 11, 'categories');
  assert.equal((await page.textContent('.sw-card[data-id="docker"] .sw-action')).trim(), '', 'actions are icons, not words');
  assert.ok((await page.locator('.sw-card[data-id="git"] img.sw-logo').count()) === 1, 'brand icon');
  await shot(page, '4a-software');
  log('the catalog lists categories, detects installed apps with their version and uses icon-only actions');

  await page.click('.sw-card[data-id="docker"] .sw-action');
  await page.waitForSelector('.sw-card[data-id="docker"][data-state="installing"]');
  await page.waitForFunction(() => {
    const w = parseFloat(document.querySelector('.sw-card[data-id="docker"] .sw-bar i').style.width);
    return w > 0 && w < 100;
  });
  await shot(page, '4b-installing');
  await page.waitForSelector('.sw-card[data-id="docker"][data-state="installed"]', { timeout: 15000 });
  assert.match(await page.textContent('#sw-summary'), /4\/\d+/, 'git, node, python and the app installed just now');
  log('clicking download animates the card with live progress and ends installed');

  await page.click('#sw-filter [data-f="missing"]');
  assert.ok(await page.locator('.sw-card[data-id="git"]').isHidden());
  assert.ok(await page.locator('.sw-card[data-id="postman"]').isVisible());
  await page.click('#sw-filter [data-f="installed"]');
  assert.ok(await page.locator('.sw-card[data-id="postman"]').isHidden());
  assert.ok(await page.locator('.sw-card[data-id="docker"]').isVisible());
  await page.click('#sw-filter [data-f="all"]');
  await page.click('#sw-refresh');
  await page.waitForSelector('.sw-card[data-id="docker"][data-state="installed"]');
  log('filters and re-detect work, and an app installed in this session stays installed');

  // ---------- updates and one-click profiles ----------
  await page.waitForSelector('.sw-card[data-id="node"][data-state="outdated"]');
  assert.ok(await page.locator('#sw-summary .chip[title="Actualizaciones disponibles"]').isVisible(), 'the summary counts the updates');
  assert.equal((await page.textContent('.sw-card[data-id="node"] .sw-action')).trim(), '', 'the update action is an icon');
  assert.equal(await page.getAttribute('.sw-card[data-id="node"] .sw-action', 'title'), 'Actualizar');
  await page.click('.sw-card[data-id="node"] .sw-action');
  await page.waitForSelector('.sw-card[data-id="node"][data-state="installing"]');
  await page.waitForSelector('.sw-card[data-id="node"][data-state="installed"]', { timeout: 15000 });
  assert.equal(await page.locator('#sw-summary .chip[title="Actualizaciones disponibles"]').count(), 0, 'no updates left');
  log('an installed app with a newer version shows an update icon, upgrades with progress and clears the counter');

  assert.equal(await page.locator('#sw-presets .preset-btn').count(), 3);
  assert.match(await page.getAttribute('#sw-presets [data-preset="ai"]', 'title'), /Claude Code/);
  await page.click('#sw-presets [data-preset="ai"]');
  await page.waitForSelector('.sw-card[data-id="claudecode"][data-state="installed"]', { timeout: 20000 });
  await page.waitForSelector('.sw-card[data-id="cursor"][data-state="installed"]', { timeout: 20000 });
  await page.waitForSelector('.toast.ok:has-text("listo")');
  log('a one-click profile installs what is missing, one after another');

  const refused = await page.evaluate(async () => window.devpanel.software.install('github'));
  assert.equal(refused.ok, false, 'web services cannot be "installed"');
  const unknown = await page.evaluate(async () => window.devpanel.software.install('calc && del *'));
  assert.equal(unknown.ok, false, 'only catalog ids are accepted');
  log('install refuses web services and anything that is not a catalog id');

  // ---------- utilities tab ----------
  await page.click('.tab[data-tab="utils"]');
  await page.fill('#tool-input', '{"a":1,"b":[true]}');
  await page.click('#tool-actions >> text=Formatear');
  assert.match(await page.textContent('#tool-output'), /"a": 1/);
  await page.click('.tool-btn[data-id="hash"]');
  await page.fill('#tool-input', 'abc');
  await page.click('#tool-actions >> text=SHA-256');
  assert.match(await page.textContent('#tool-output'), /^ba7816bf/);
  await shot(page, '4-tools');
  log('developer utilities run (JSON, SHA-256)');

  // ---------- local projects + terminal ----------
  await page.click('.nav[data-view="local"]');
  await page.click('#local-add');
  await page.waitForSelector('.local-card');
  assert.equal(await page.locator('.local-card .branch-select').inputValue(), 'trabajo');
  assert.equal((await page.textContent('.local-card .chip.dirty')).trim(), '1');
  assert.match(await page.textContent('.local-card .chips'), /primer commit/);
  await page.click('.script-btn:has-text("hello")');
  await page.waitForFunction(() => document.getElementById('term-out').textContent.includes('hola-desde-script'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('term-out').textContent.includes('código 0'), null, { timeout: 30000 });
  await shot(page, '4b-local');
  log('local project shows branch, changes and last commit, and runs an npm script in the terminal');

  const blocked = await page.evaluate(async (p) => window.devpanel.local.run(p, 'build && calc'), proj);
  assert.ok('error' in blocked, 'unsafe script names are refused');
  const foreign = await page.evaluate(async () => window.devpanel.local.run('C:/Windows', 'hello'));
  assert.ok('error' in foreign, 'unregistered folders are refused');
  log('the terminal refuses unsafe script names and folders that were never added');

  // ---------- settings: token + alerts ----------
  await page.click('.nav[data-view="settings"]');
  await page.fill('#token-input', 'short');
  await page.click('#token-save');
  await page.waitForFunction(() => document.getElementById('token-msg').textContent.includes('formato válido'));
  assert.ok(await page.locator('#token-msg.err').isVisible(), 'the error stays on screen (not a vanishing toast)');
  assert.equal(await page.getAttribute('#token-state', 'data-state'), 'err');
  assert.ok(await page.locator('#pref-alerts').isChecked(), 'build alerts default to on');
  await page.click('.tile:has(#pref-alerts)');
  const saved = await page.evaluate(() => window.devpanel.settings.get());
  assert.equal(saved.alertsEnabled, false);
  log('invalid tokens are rejected and the alerts preference persists');

  // ---------- release notes dialog ----------
  await page.click('#whatsnew-btn');
  await page.waitForSelector('#notes-modal:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('notes-body').textContent.includes('notas'));
  assert.match(await page.textContent('#notes-ver'), /^v\d/);
  await page.click('#notes-close');
  await page.waitForSelector('#notes-modal.hidden', { state: 'attached' });
  log('the release notes dialog (opened from the ! icon next to Settings) opens and closes');

  // ---------- settings are icon-first ----------
  await page.click('.nav[data-view="settings"]');
  assert.equal(await page.locator('#update-check').count(), 0, 'no manual "check for updates" button: it is automatic');
  assert.equal(await page.locator('#notes-btn').count(), 0, 'no news button inside Settings (it lives next to the Settings icon)');
  assert.equal(await page.locator('.tile').count(), 4, 'preferences are icon tiles');
  assert.equal(await page.getAttribute('#face-chip', 'data-on'), 'false', 'no face registered yet');
  assert.equal(await page.getAttribute('#code-chip', 'data-on'), 'true', 'a code was created in the wizard');
  for (const sel of ['#face-enroll', '#pin-change', '#face-remove', '#gh-save', '#token-save']) {
    assert.equal((await page.textContent(sel)).trim(), '', `${sel} is an icon`);
    assert.ok(await page.getAttribute(sel, 'title'), `${sel} has a tooltip`);
  }
  await shot(page, '5b-settings');
  log('Settings use icon tiles, icon buttons and state chips instead of paragraphs');

  // ---------- update box sits right above Settings and is made of icons ----------
  const send = (s) => app.evaluate(({ BrowserWindow }, st) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', st), s);
  await send({ state: 'available', version: '9.9.9', notes: '' });
  await page.waitForSelector('#update-box:not(.hidden)');
  assert.match(await page.textContent('#update-box .upd-ver'), /9\.9\.9/);
  const gap = await page.evaluate(() => {
    const b = document.getElementById('update-box').getBoundingClientRect();
    const f = document.querySelector('.side-foot').getBoundingClientRect();
    return { gap: f.top - b.bottom, boxBottomAboveFoot: b.bottom <= f.top + 1 };
  });
  assert.ok(gap.boxBottomAboveFoot && gap.gap < 24, `the update box is directly above Settings (gap ${gap.gap}px)`);
  for (const btn of await page.locator('#update-box .icon-btn').all()) assert.equal((await btn.textContent()).trim(), '');
  assert.equal(await page.getAttribute('#upd-status', 'data-state'), 'available');
  await shot(page, '5c-update-available');
  await send({ state: 'downloading', percent: 40 });
  await page.waitForFunction(() => document.querySelector('#update-box .upd-ver')?.textContent === '40%');
  assert.equal(await page.locator('#update-box .upd-bar i').evaluate((n) => n.style.width), '40%');
  await send({ state: 'ready', version: '9.9.9' });
  await page.waitForSelector('#update-box [title="Reiniciar y actualizar"]');
  await send({ state: 'none' });
  await page.waitForSelector('#update-box.hidden', { state: 'attached' });
  assert.equal(await page.getAttribute('#upd-status', 'data-state'), 'none');
  log('the update box (icons only) appears above Settings, shows progress, then the restart icon, then hides');

  // ---------- language ----------
  await page.click('#lang-seg [data-lang="en"]');
  await page.waitForFunction(() => document.getElementById('greeting').textContent === 'Your projects');
  assert.equal(await page.textContent('.set-card:has(#lang-seg) h3'), 'Language');
  assert.ok(await page.locator('#lang-seg [data-lang="en"].active').isVisible());
  assert.equal(await page.locator('#view-settings h3', { hasText: 'Language' }).count(), 1, 'static headings are translated');
  await page.click('.nav[data-view="projects"]');
  assert.ok((await page.locator('.stat .label').allTextContents()).includes('Languages'), 'strings built from code are translated too');
  await shot(page, '5a-english');
  await page.click('.nav[data-view="settings"]');
  await page.click('#lang-seg [data-lang="es"]');
  await page.waitForFunction(() => document.getElementById('greeting').textContent === 'Tus proyectos');
  assert.equal(await page.textContent('.set-card:has(#lang-seg) h3'), 'Idioma');
  log('the language can be switched to English and back, including text built from code');

  // ---------- code dialog (same pad as the installer) ----------
  await page.click('#pin-change');
  await page.waitForSelector('#pin-modal:not(.hidden) .keypad');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pin-modal.hidden', { state: 'attached' });
  await page.click('#pin-change');
  await page.waitForSelector('#pin-modal:not(.hidden) .keypad');
  await page.keyboard.type('5678');
  await page.waitForFunction(() => document.querySelector('#pin-modal .cs-title').textContent.includes('Repite'));
  await page.keyboard.type('5678');
  await page.waitForSelector('.toast.ok:has-text("Código actualizado")');
  PIN = '5678';
  log('the code can be changed with the pad dialog (and cancelled with Escape)');

  // ---------- palette ----------
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#palette:not(.hidden)');
  await page.fill('#pal-input', 'herramienta: uuid');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tool-title:has-text("UUID")');
  log('command palette navigates to a tool');

  // ---------- theme ----------
  await page.click('#theme-toggle');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await shot(page, '5-light-theme');
  await page.click('#theme-toggle');
  log('theme toggles');
  await app.close();

  // ---------- second run: lock screen ----------
  app = await launch();
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForSelector('#lock:not(.hidden)');
  assert.ok(await page.locator('#lock-face').isHidden(), 'face button hidden when no face is enrolled');
  assert.match(await page.textContent('#lock-title'), new RegExp(GH_USER));
  await shot(page, '6-lock');
  log('second run shows the lock screen (code only, since face was skipped)');

  // anti-photo challenge prompts (sent by the main process while the face module runs)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('face:prompt', { challenge: 'left' }));
  await page.waitForFunction(() => document.getElementById('lock-msg').textContent === 'Gira la cabeza hacia tu izquierda');
  assert.equal(await page.getAttribute('#face-ring', 'data-turn'), 'left');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('face:prompt', { prompt: 'return' }));
  await page.waitForFunction(() => document.getElementById('lock-msg').textContent.includes('vuelve a mirar al frente'));
  assert.equal(await page.getAttribute('#face-ring', 'data-turn'), null);
  log('the anti-photo challenge prompts show on the lock screen');

  await page.keyboard.type('0000');
  await page.waitForSelector('.lock-card.shake');
  assert.ok(await page.locator('#app').isHidden());
  // the pad clears itself after the shake; typing earlier is ignored on purpose
  await page.waitForFunction(() => document.querySelectorAll('#lock-pad .dots i.on').length === 0);
  log('wrong code is rejected with the shake animation');

  await page.keyboard.type(PIN);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  log('correct code unlocks the dashboard');

  // ---------- tray: close keeps the app alive, hiding re-locks ----------
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  // close() is asynchronous: wait until the window is hidden (and still alive)
  let closed;
  for (let i = 0; i < 40; i++) {
    closed = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { destroyed: w.isDestroyed(), visible: !w.isDestroyed() && w.isVisible() };
    });
    if (!closed.visible) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(closed.destroyed, false, 'closing the window keeps it alive (tray)');
  assert.equal(closed.visible, false, 'the window is hidden, not shown');
  await page.waitForSelector('#lock:not(.hidden)');
  assert.ok(await page.locator('#app').isHidden(), 'the panel is hidden while re-locked');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await page.keyboard.type(PIN);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  log('closing goes to the tray, the panel re-locks when hidden and unlocks with the code');

  console.log(`\nAll ${step} checks passed. Screenshots: ${shots}`);
} catch (e) {
  console.error('\n✘ E2E failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'failure.png') });
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
}
