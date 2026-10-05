// UI test for the custom installer. It walks the screens but NEVER clicks the final install button.
//   npm run test:installer      (needs network: it queries the public GitHub API)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'devpanel-inst-'));
const env = { ...process.env, DEVPANEL_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['installer'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#s-welcome.active');
  await page.waitForFunction(() => !document.getElementById('go-install').disabled, null, { timeout: 20000 });
  assert.match(await page.textContent('#ver-chip'), /Versión/);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'i1-welcome.png') });
  log('welcome loads the latest stable version');

  await page.click('#go-install');
  await page.waitForSelector('#s-account.active');
  assert.ok(await page.locator('#acc-next').isDisabled());
  log('account step opens with Install disabled');

  await page.fill('#gh', 'nombre-que-no-existe-zzzzzz-12345');
  await page.click('#gh-btn');
  await page.waitForFunction(() => document.getElementById('acc-err').textContent.length > 0);
  assert.match(await page.textContent('#acc-err'), /No existe/);
  log('unknown GitHub user is rejected');

  await page.fill('#gh', 'https://github.com/octocat');
  await page.click('#gh-btn');
  await page.waitForSelector('#profile:not(.hidden)');
  assert.equal(await page.textContent('#p-login'), '@octocat');
  assert.ok(await page.locator('#channel-row').isHidden(), 'dev channel hidden for other accounts');
  log('profile link resolves and the dev channel stays hidden for other accounts');

  await page.fill('#pin', '12ab');
  await page.fill('#pin2', '12ab');
  assert.ok(await page.locator('#acc-next').isDisabled());
  await page.fill('#pin', '482913');
  await page.fill('#pin2', '000000');
  assert.match(await page.textContent('#acc-err'), /no coinciden/);
  assert.ok(await page.locator('#acc-next').isDisabled());
  await page.fill('#pin2', '482913');
  assert.ok(await page.locator('#acc-next').isEnabled());
  await page.waitForFunction(() => document.getElementById('avatar').complete);
  await page.screenshot({ path: join(shots, 'i2-account.png') });
  log('code validation gates the Install button');

  await page.fill('#gh', 'DevCat-HGS');
  await page.click('#gh-btn');
  await page.waitForSelector('#channel-row:not(.hidden)');
  await page.selectOption('#channel', 'dev');
  await page.screenshot({ path: join(shots, 'i3-owner-channel.png') });
  log('the owner account unlocks the development channel');

  await page.click('#acc-back');
  await page.waitForSelector('#s-welcome.active');
  await page.click('#go-options');
  await page.waitForSelector('#s-options.active');
  assert.ok((await page.inputValue('#dir')).endsWith('DevPanel'));
  log('options screen shows the default install folder');
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
