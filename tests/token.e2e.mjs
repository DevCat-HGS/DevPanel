// End-to-end test of the GitHub token flow against a LOCAL mock of the GitHub API
// (DEVPANEL_GITHUB_API), so the success path is covered without a real token and without network.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const GOOD = 'ghp_' + 'a'.repeat(36);
const OTHER = 'ghp_' + 'b'.repeat(36);
const BAD = 'ghp_' + 'c'.repeat(36);
const repo = (name, priv) => ({
  name, private: priv, description: priv ? 'solo yo lo veo' : 'público', language: 'TypeScript',
  html_url: `https://github.com/octocat/${name}`, pushed_at: new Date().toISOString(), default_branch: 'main',
  license: { spdx_id: 'MIT' }, topics: ['x'], open_issues_count: 0,
});

const seenAuth = [];
const server = http.createServer((req, res) => {
  const auth = req.headers.authorization ?? '';
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url.startsWith('/user/repos')) {
    seenAuth.push(auth);
    return auth === `Bearer ${GOOD}` ? send(200, [repo('secreto-privado', true), repo('publico', false)]) : send(401, {});
  }
  if (req.url === '/user') {
    if (auth === `Bearer ${GOOD}`) return send(200, { login: 'octocat' });
    if (auth === `Bearer ${OTHER}`) return send(200, { login: 'someoneelse' });
    return send(401, { message: 'Bad credentials' });
  }
  if (req.url === '/rate_limit') return send(200, { resources: { core: { limit: 5000, remaining: 4990 } } });
  if (req.url.startsWith('/users/octocat/repos')) return send(200, [repo('publico', false)]);
  return send(404, {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const userData = mkdtempSync(join(tmpdir(), 'devpanel-token-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat' }));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: base };
delete env.ELECTRON_RUN_AS_NODE;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.click('.nav[data-view="projects"]');
  await page.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });
  assert.deepEqual(await page.locator('.repo .name').allTextContents(), ['publico']);
  log('without a token only the public repos are listed');

  await page.click('.nav[data-view="settings"]');
  await page.waitForSelector('#token-state[data-state="none"]');
  assert.ok(await page.locator('#token-form').isVisible());
  const msg = () => page.textContent('#token-msg');
  const save = async (value) => {
    await page.fill('#token-input', value);
    await page.click('#token-save');
  };

  await save('');
  assert.match(await msg(), /Pega tu token/);
  await save('abc');
  await page.waitForFunction(() => document.getElementById('token-msg').textContent.includes('formato'));
  await save(BAD);
  await page.waitForFunction(() => document.getElementById('token-msg').textContent.includes('rechazó'));
  await save(OTHER);
  await page.waitForFunction(() => document.getElementById('token-msg').textContent.includes('@someoneelse'));
  assert.ok(await page.locator('#token-msg.err').isVisible());
  assert.equal(await page.getAttribute('#token-state', 'data-state'), 'err', 'the state icon turns red');
  log('empty, malformed, rejected and wrong-account tokens each show a red state and a message that stays on screen');

  await save(GOOD);
  await page.waitForSelector('#token-state[data-state="ok"]');
  assert.equal(await page.textContent('#ts-main'), '@octocat');
  assert.match(await page.textContent('#ts-chips'), /4990\/5000/);
  assert.ok(await page.locator('#ts-chips svg').count() >= 2, 'chips use icons');
  assert.ok(await page.locator('#token-form').isHidden(), 'the form hides once a token is saved');
  assert.ok(await page.locator('#ts-actions').isVisible());
  assert.equal(await page.inputValue('#token-input'), '', 'the token is cleared from the field after saving');
  await shot(page, 'k1-token-saved');
  log('a valid token turns the state green with the account and the real API usage');

  await page.click('.nav[data-view="projects"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.repo .name')].some((n) => n.textContent === 'secreto-privado'));
  assert.ok(await page.locator('.repo:has(.name:text("secreto-privado")) .chip.priv').isVisible(), 'private repos get the "privado" badge');
  assert.ok(seenAuth.includes(`Bearer ${GOOD}`), 'the token is sent to the GitHub API');
  log('private repos now appear (with a badge) because the token is used');

  // an already-saved token must show as connected the next time the app is opened
  await app.close();
  app = await electron.launch({ args: ['.'], env });
  const again = await app.firstWindow();
  await again.setViewportSize({ width: 1100, height: 720 });
  await again.click('.nav[data-view="projects"]');
  await again.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });
  await again.click('.nav[data-view="settings"]');
  await again.waitForSelector('#token-state[data-state="ok"]');
  assert.equal(await again.textContent('#ts-main'), '@octocat');
  log('after restarting, opening Settings shows the saved token as connected');

  await again.click('#token-edit');
  assert.ok(await again.locator('#token-form').isVisible(), 'the pencil icon reveals the form to replace the token');
  await again.click('#token-edit');
  assert.ok(await again.locator('#token-form').isHidden());
  await again.click('#token-refresh');
  await again.waitForSelector('#token-state[data-state="ok"]');
  log('replace and re-check icons work');

  await again.click('#token-clear');
  await again.waitForSelector('#token-state[data-state="none"]');
  assert.ok(await again.locator('#token-form').isVisible());
  await again.click('.nav[data-view="projects"]');
  await again.waitForFunction(() => ![...document.querySelectorAll('.repo .name')].some((n) => n.textContent === 'secreto-privado'));
  log('removing the token goes back to public repos only');

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Token test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'k-failure.png') });
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  server.close();
  rmSync(userData, { recursive: true, force: true });
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${name}.png`) });
}
