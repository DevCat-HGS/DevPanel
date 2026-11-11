// E2E of re-locking: once DevPanel is hidden and shown again, nothing from the unlocked session (command
// palette, open dialogs) may be visible or usable over the lock screen. No network needed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'devpanel-lock-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat', localProjects: [process.cwd()] }));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: 'http://127.0.0.1:9' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.GITHUB_TOKEN;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  let page = await app.firstWindow();
  assert.deepEqual(await page.evaluate(() => window.devpanel.face.setPin('1234')), { ok: true });
  await app.close();

  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await page.waitForSelector('#lock:not(.hidden)');
  // the renderer is not trusted with the lock: while locked, the main process refuses to change the code or the token
  const whileLocked = await page.evaluate(async () => ({
    pin: await window.devpanel.face.setPin('0000'),
    token: await window.devpanel.token.set('ghp_' + 'x'.repeat(36)),
    enroll: await window.devpanel.face.enroll('0000'),
  }));
  assert.deepEqual(whileLocked.pin, { ok: false, error: 'Desbloquea DevPanel primero' });
  assert.equal(whileLocked.token.ok, false);
  assert.equal(whileLocked.enroll.ok, false);
  log('while locked, changing the code, the token or the face is refused by the main process');
  await page.keyboard.press('Control+k');
  assert.ok(await page.locator('#palette').isHidden(), 'no palette before the first unlock');
  for (const d of '1234') await page.keyboard.press(d);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#palette:not(.hidden)');
  log('the code unlocks the app and Ctrl+K opens the palette');

  // leave the palette open, hide to the tray and come back
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.hide();
    setTimeout(() => w.show(), 600);
  });
  await page.waitForSelector('#lock:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(800);
  assert.ok(await page.locator('#palette').isHidden(), 'the palette left open is gone');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#palette').isHidden(), 'Ctrl+K does nothing while locked');
  await page.evaluate(() => document.getElementById('repo-modal').classList.remove('hidden')); // a dialog left open
  assert.ok(await page.locator('#repo-modal').isHidden(), 'dialogs never show over the lock screen');
  await page.evaluate(() => document.getElementById('repo-modal').classList.add('hidden'));
  await page.screenshot({ path: join(shots, 'l1-relocked.png') });
  log('after re-locking neither the palette nor an open dialog shows or opens over the lock screen');

  for (const d of '1234') await page.keyboard.press(d);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#palette:not(.hidden)');
  log('unlocking again brings Ctrl+K back');

  // re-locked by hiding: the main process forgets the unlock as well
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.hide();
    setTimeout(() => w.show(), 600);
  });
  await page.waitForSelector('#lock:not(.hidden)', { timeout: 10000 });
  assert.equal((await page.evaluate(() => window.devpanel.face.setPin('0000'))).ok, false, 'hiding locks the main process too');

  // wrong codes: the first ones are just wrong, then even the right code has to wait
  // all at once: a tampered renderer would fire them in parallel, and every one must still count against the limit
  const tries = await page.evaluate(async () => {
    const calls = [...Array(6).fill('9999'), '1234'].map((pin) => window.devpanel.face.unlockWithPin(pin));
    return (await Promise.all(calls)).map((r) => r.error ?? 'ok');
  });
  assert.deepEqual(tries.slice(0, 4), Array(4).fill('PIN incorrecto'));
  assert.equal(tries[4], 'Demasiados intentos. Espera 30 s.', 'the fifth wrong code starts the wait');
  assert.match(tries[5], /^Demasiados intentos/);
  assert.match(tries[6], /^Demasiados intentos/, 'during the wait not even the right code is checked');
  for (const d of '1234') await page.keyboard.press(d);
  await page.waitForFunction(() => /Demasiados intentos/.test(document.getElementById('lock-msg').textContent));
  await page.waitForTimeout(900);
  assert.ok(await page.locator('#app').isHidden(), 'still locked');
  await page.keyboard.press('1');
  assert.equal(await page.locator('#lock-pad .dots i.on').count(), 1, 'the pad takes digits again after the refusal');
  log('after five wrong codes the lock asks to wait (30 s, then longer), even for the right code, and the pad keeps working');

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Lock test failed:', e.message);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
