// End-to-end smoke test: drives the real Electron app with Playwright against a throwaway profile.
//   npm run test:e2e            (needs network: it queries the public GitHub API)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'devpanel-e2e-'));
const GH_USER = process.env.E2E_GH_USER ?? 'octocat';
const PIN = '123456';

// VS Code-like hosts export ELECTRON_RUN_AS_NODE=1, which makes Electron start as plain Node.
const env = { ...process.env, DEVPANEL_USER_DATA: userData };
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
  await page.fill('#wz-pin', '12');
  await page.fill('#wz-pin2', '12');
  await page.click('#wz-2-next');
  assert.match(await page.textContent('#wz-pin-err'), /4 a 8 dígitos/);
  await page.fill('#wz-pin', PIN);
  await page.fill('#wz-pin2', '654321');
  await page.click('#wz-2-next');
  assert.match(await page.textContent('#wz-pin-err'), /no coinciden/);
  await page.fill('#wz-pin2', PIN);
  await page.click('#wz-2-next');
  await page.waitForSelector('#wz-3.active');
  await shot(page, '2-wizard-face');
  log('code validation works and the face step is reached');

  await page.click('#wz-skip');
  await page.waitForSelector('#wz-4.active');
  await page.click('#wz-enter');
  await page.waitForSelector('#app:not(.hidden)');
  await page.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });
  assert.ok((await page.locator('.repo:not(.skeleton)').count()) > 0, 'repos rendered');
  await shot(page, '3-dashboard');
  log('dashboard loads the repositories of the linked account');

  assert.equal(await page.getAttribute('#recs', 'open'), null, 'recommendations start collapsed');
  await page.click('#recs summary');
  assert.ok(await page.locator('#recs li').first().isVisible());
  log('recommendations panel is collapsed by default and expands');

  // ---------- tools ----------
  await page.click('.nav[data-view="tools"]');
  await page.fill('#tool-input', '{"a":1,"b":[true]}');
  await page.click('#tool-actions >> text=Formatear');
  assert.match(await page.textContent('#tool-output'), /"a": 1/);
  await page.click('.tool-btn[data-id="hash"]');
  await page.fill('#tool-input', 'abc');
  await page.click('#tool-actions >> text=SHA-256');
  assert.match(await page.textContent('#tool-output'), /^ba7816bf/);
  await shot(page, '4-tools');
  log('developer tools run (JSON, SHA-256)');

  await page.click('#env-check');
  await page.waitForSelector('#env-list li');
  assert.ok((await page.locator('#env-list li').count()) >= 5);
  log('environment check lists the dev tools');

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

  await page.fill('#lock-pin', '000000');
  await page.click('#lock-pin-btn');
  await page.waitForSelector('.lock-card.shake');
  assert.ok(await page.locator('#app').isHidden());
  log('wrong code is rejected with the shake animation');

  await page.fill('#lock-pin', PIN);
  await page.click('#lock-pin-btn');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  log('correct code unlocks the dashboard');

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
}
