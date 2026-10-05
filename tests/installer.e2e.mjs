// UI test for the custom installer. DEVPANEL_DRY_RUN makes the installer stop at the progress
// screen, so this walks the whole question flow without downloading or installing anything.
//   npm run test:installer      (needs network: it queries the public GitHub API)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'devpanel-inst-'));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_DRY_RUN: '1' };
delete env.ELECTRON_RUN_AS_NODE;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
const launch = async () => {
  const app = await electron.launch({ args: ['installer'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#s-welcome.active');
  await page.waitForFunction(() => !document.getElementById('go-install').disabled, null, { timeout: 20000 });
  return { app, page };
};
const keypad = async (page, digits) => {
  // the 4th digit confirms by itself
  for (const d of digits) await page.click(`#keypad [data-k="${d}"]`);
};

let app;
try {
  // ---------- regular account ----------
  ({ app, page: globalThis.page } = await launch());
  const page = globalThis.page;
  assert.match(await page.textContent('#ver-chip'), /Versión/);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'i1-welcome.png') });
  log('welcome loads the latest stable version');

  await page.click('#go-install');
  await page.waitForSelector('#s-gh.active');
  assert.ok(await page.locator('#gh-next').isDisabled());
  assert.ok(await page.locator('#stepper').isVisible());
  log('first question opens with the step indicator');

  await page.fill('#gh', 'nombre-que-no-existe-zzzzzz-12345');
  await page.waitForFunction(() => document.getElementById('gh-err').textContent.length > 0, null, { timeout: 15000 });
  assert.match(await page.textContent('#gh-err'), /No existe/);
  log('an unknown user is reported while typing (live lookup)');

  await page.fill('#gh', 'https://github.com/octocat');
  await page.waitForSelector('#id-card:not(.hidden)', { timeout: 15000 });
  assert.equal(await page.textContent('#p-login'), '@octocat');
  assert.match(await page.textContent('#p-meta'), /repos públicos/);
  await page.waitForFunction(() => document.getElementById('avatar').complete);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shots, 'i2-github-live.png') });
  assert.ok(await page.locator('#gh-next').isEnabled());
  log('the profile card appears by itself with avatar and stats');

  await page.click('#gh-next');
  await page.waitForSelector('#s-pin.active');
  await page.click('#keypad [data-k="1"]');
  await page.click('#keypad [data-k="2"]');
  assert.ok(await page.locator('#keypad [data-k="ok"]').isDisabled(), 'needs at least 4 digits');
  await page.click('#keypad [data-k="3"]');
  await page.click('#keypad [data-k="back"]');
  assert.equal(await page.locator('#dots i.on').count(), 2);
  await page.click('#keypad [data-k="3"]');
  await page.screenshot({ path: join(shots, 'i3-pin.png') });
  await page.click('#keypad [data-k="4"]');
  await page.waitForFunction(() => document.getElementById('pin-title').textContent.includes('Repite'));
  assert.equal(await page.locator('#dots i').count(), 4);
  log('PIN pad has 4 dots and confirms by itself on the 4th digit');

  await keypad(page, '9999');
  await page.waitForSelector('#dots.shake');
  assert.match(await page.textContent('#pin-err'), /No coinciden/);
  await page.waitForFunction(() => document.getElementById('pin-title').textContent.includes('Crea'));
  log('a mismatch shakes and restarts');

  await page.keyboard.type('4829');
  await page.waitForFunction(() => document.getElementById('pin-title').textContent.includes('Repite'));
  await page.keyboard.type('4829');
  await page.waitForSelector('#s-progress.active');
  assert.equal(await page.textContent('#pct'), '42%');
  await page.screenshot({ path: join(shots, 'i4-progress.png') });
  log('the physical keyboard works and a non-owner goes straight to installing');
  await app.close();

  // ---------- owner account: channel choice ----------
  ({ app, page: globalThis.page } = await launch());
  const p2 = globalThis.page;
  await p2.click('#go-install');
  await p2.fill('#gh', 'DevCat-HGS');
  await p2.waitForSelector('#id-card:not(.hidden)', { timeout: 15000 });
  await p2.click('#gh-next');
  await p2.click('#pin-gen');
  assert.equal(await p2.locator('#dots i.on').count(), 4);
  assert.ok(await p2.locator('#pin-noted').isVisible());
  await p2.screenshot({ path: join(shots, 'i5-pin-generated.png') });
  await p2.click('#pin-noted');
  await p2.waitForSelector('#s-channel.active');
  await p2.click('.choice[data-channel="dev"]');
  assert.ok(await p2.locator('.choice[data-channel="dev"].selected').isVisible());
  await p2.screenshot({ path: join(shots, 'i6-channel.png') });
  await p2.click('#ch-next');
  await p2.waitForSelector('#s-progress.active');
  log('the owner generates a code and unlocks the development channel choice');

  await app.close();

  // ---------- face step (simulated enrollment, no camera) ----------
  env.DEVPANEL_DRY_RUN = 'face';
  ({ app, page: globalThis.page } = await launch());
  const p3 = globalThis.page;
  await p3.click('#go-install');
  await p3.fill('#gh', 'octocat');
  await p3.waitForSelector('#id-card:not(.hidden)', { timeout: 15000 });
  await p3.click('#gh-next');
  await p3.keyboard.type('4829');
  await p3.waitForFunction(() => document.getElementById('pin-title').textContent.includes('Repite'));
  await p3.keyboard.type('4829');
  await p3.waitForSelector('#s-face.active');
  assert.ok(await p3.locator('#face-avatar').getAttribute('src'), 'face step shows the GitHub avatar');
  await p3.click('#face-go');
  await p3.waitForFunction(() => document.getElementById('face-step').textContent.includes('3 de 5'));
  await p3.screenshot({ path: join(shots, 'i7-face-progress.png') });
  await p3.waitForSelector('#s-done.active', { timeout: 10000 });
  await p3.waitForTimeout(500);
  await p3.screenshot({ path: join(shots, 'i8-done.png') });
  log('the face step shows live progress and ends on the celebration screen');

  console.log(`\nAll ${step} checks passed. Screenshots: ${shots}`);
} catch (e) {
  console.error('\n✘ Installer test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'i-failure.png') });
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
