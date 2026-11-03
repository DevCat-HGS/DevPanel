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

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Lock test failed:', e.message);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
