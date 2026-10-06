// E2E of the Home screen against a LOCAL mock of the GitHub API: failing builds, open pull requests,
// local changes, recent activity, the all-good / error states and ETag (304) caching.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const day = 86_400_000;
const repo = (name, ageDays) => ({
  name, private: false, description: `repo ${name}`, language: 'TypeScript', html_url: `https://github.com/octocat/${name}`,
  default_branch: 'main', license: { spdx_id: 'MIT' }, topics: ['x'], open_issues_count: 0, pushed_at: new Date(Date.now() - ageDays * day).toISOString(),
});
const repos = [repo('api-service', 0.1), repo('web-app', 1), repo('old-lib', 90)];

const mode = { failing: true, pulls: 'ok' };
let notModified = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/users/octocat/repos') {
    if (req.headers['if-none-match'] === '"repos-v1"') {
      notModified++;
      res.writeHead(304);
      return res.end();
    }
    return send(200, repos, { ETag: '"repos-v1"' });
  }
  const run = url.pathname.match(/^\/repos\/octocat\/([^/]+)\/actions\/runs$/);
  if (run) {
    const failing = mode.failing && run[1] === 'api-service';
    return send(200, { workflow_runs: [{ id: 5, status: 'completed', conclusion: failing ? 'failure' : 'success', head_branch: 'main', html_url: `https://github.com/octocat/${run[1]}/actions/runs/5`, updated_at: new Date().toISOString() }] });
  }
  if (url.pathname === '/search/issues') {
    if (mode.pulls === '403') return send(403, { message: 'rate limit' });
    return send(200, { items: [
      { title: 'Fix login redirect', repository_url: 'https://api.github.com/repos/octocat/web-app', html_url: 'https://github.com/octocat/web-app/pull/7', updated_at: new Date().toISOString(), draft: false, user: { login: 'mona' } },
      { title: 'WIP: new dashboard', repository_url: 'https://api.github.com/repos/octocat/api-service', html_url: 'https://github.com/octocat/api-service/pull/9', updated_at: new Date().toISOString(), draft: true, user: { login: 'octocat' } },
    ] });
  }
  return send(404, {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// a local project with an uncommitted file
const proj = mkdtempSync(join(tmpdir(), 'devpanel-home-proj-'));
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...a], { cwd: proj });
git('init', '-q', '-b', 'main');
writeFileSync(join(proj, 'a.txt'), '1');
git('add', '.');
git('commit', '-q', '-m', 'init');
writeFileSync(join(proj, 'sucio.txt'), 'sin commit');

const userData = mkdtempSync(join(tmpdir(), 'devpanel-home-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat', localProjects: [proj] }));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: base };
delete env.ELECTRON_RUN_AS_NODE;

const widget = (page, id) => page.locator(`.hw[data-id="${id}"]`);
let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  let page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForSelector('#view-home:not(.hidden)');
  assert.equal(await page.locator('.hw').count(), 4);
  await page.waitForFunction(() => document.querySelector('.hw[data-id="failing"] .hw-count')?.textContent === '1', null, { timeout: 20000 });
  log('Home is the landing view with four widgets');

  assert.equal(await widget(page, 'failing').locator('.hw-row .hw-main').textContent(), 'api-service');
  assert.equal(await widget(page, 'failing').locator('.hw-row .hw-sub').textContent(), 'main');
  assert.equal(await widget(page, 'failing').locator('.hw-row').count(), 1, 'only repos pushed recently are checked');
  await page.waitForFunction(() => document.querySelector('.hw[data-id="pulls"] .hw-count')?.textContent === '2');
  const pulls = widget(page, 'pulls').locator('a.hw-row');
  assert.equal(await pulls.count(), 2);
  assert.equal(await pulls.first().getAttribute('href'), 'https://github.com/octocat/web-app/pull/7');
  assert.match(await pulls.first().locator('.hw-sub').textContent(), /web-app/);
  await page.waitForFunction(() => document.querySelector('.hw[data-id="local"] .hw-count')?.textContent === '1');
  assert.match(await widget(page, 'local').locator('.hw-chip').first().getAttribute('title'), /sin commitear/);
  assert.equal(await widget(page, 'recent').locator('.hw-row').count(), 3);
  await shot(page, 'h1-home');
  log('failing builds, open pull requests, local changes and recent activity are listed with icons and counts');

  await widget(page, 'failing').locator('.hw-row').click();
  await page.waitForSelector('#repo-modal:not(.hidden)');
  assert.equal(await page.textContent('#rm-name'), 'api-service');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#repo-modal.hidden', { state: 'attached' });
  await widget(page, 'local').locator('.hw-row').click();
  await page.waitForSelector('#view-local:not(.hidden)');
  await page.click('.nav[data-view="home"]');
  log('clicking a failing build opens its folder and a local change jumps to the Local view');

  await page.click('#home-refresh');
  await page.waitForTimeout(800);
  assert.ok(notModified >= 1, `the repo list is requested with If-None-Match and answered 304 (${notModified})`);
  log('refreshing reuses cached answers (HTTP 304 does not count against the GitHub rate limit)');
  await app.close();

  // ---------- all good + API error states (new process = empty caches) ----------
  mode.failing = false;
  mode.pulls = '403';
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForSelector('#view-home:not(.hidden)');
  await page.waitForSelector('.hw[data-id="failing"] .hw-ok:not(.hw-err)', { timeout: 20000 });
  assert.ok(await widget(page, 'failing').locator('.hw-count').isHidden(), 'no count when there is nothing to fix');
  await page.waitForSelector('.hw[data-id="pulls"] .hw-ok.hw-err');
  assert.match(await widget(page, 'pulls').locator('.hw-ok').getAttribute('title'), /Límite de la API/);
  await shot(page, 'h2-home-states');
  log('an all-good widget is a green check and a rate-limited one is a red cross with the reason as tooltip');

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Home test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'h-failure.png') });
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  server.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${name}.png`) });
}
