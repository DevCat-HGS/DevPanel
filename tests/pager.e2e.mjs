// E2E for the folder dialog and pagination, against a LOCAL mock of the GitHub API with 23 repos
// and a paged commit history (so nothing depends on the network or on a real account).
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const N = 23;
const repos = Array.from({ length: N }, (_, i) => ({
  name: `repo-${String(i + 1).padStart(2, '0')}`, private: false, description: `descripción ${i + 1}`, language: 'TypeScript',
  html_url: `https://github.com/octocat/repo-${i + 1}`, default_branch: 'main', license: { spdx_id: 'MIT' }, topics: ['x'], open_issues_count: 0,
  pushed_at: new Date(Date.now() - i * 3_600_000).toISOString(),
}));
const COMMITS_TOTAL = 19; // pages of 8, 8 and 3

const rerunAuth = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/users/octocat/repos') return send(200, repos);
  const commits = url.pathname.match(/^\/repos\/octocat\/[^/]+\/commits$/);
  if (commits) {
    const page = Number(url.searchParams.get('page') ?? 1);
    const per = Number(url.searchParams.get('per_page') ?? 8);
    const from = (page - 1) * per;
    const items = Array.from({ length: Math.max(0, Math.min(per, COMMITS_TOTAL - from)) }, (_, i) => ({
      sha: String(from + i).padStart(40, 'a'), html_url: 'https://github.com/octocat/x/commit/abc',
      commit: { message: `p${page} commit ${from + i + 1}\n\nbody`, author: { name: 'Mona', date: new Date().toISOString() } },
    }));
    const next = from + per < COMMITS_TOTAL ? { Link: `<http://x/commits?page=${page + 1}>; rel="next"` } : {};
    return send(200, items, next);
  }
  if (url.pathname.startsWith('/repos/DevCat-HGS/DevPanel/releases/tags/')) {
    return send(200, { body: "## ✨ Novedades · What's new\n- **app:** diálogo de novedades con color\n- **installer:** instalador conversacional\n\n## 🐛 Correcciones · Fixes\n- **tray:** cerrar deja la app en la bandeja\n\n## 🔧 Mejoras internas · Under the hood\n- **ci:** pruebas end-to-end\n- **docs:** README" });
  }
  if (req.method === 'POST' && /^\/repos\/octocat\/[^/]+\/actions\/runs\/11\/rerun-failed-jobs$/.test(url.pathname)) {
    rerunAuth.push(req.headers.authorization ?? '');
    return send(201, {});
  }
  if (/^\/repos\/octocat\/[^/]+\/pulls$/.test(url.pathname)) {
    const pg = Number(url.searchParams.get('page') ?? 1);
    const from = (pg - 1) * 8;
    const items = Array.from({ length: Math.max(0, Math.min(8, 10 - from)) }, (_, i) => ({
      id: 1000 + from + i, number: from + i + 1, title: `PR ${from + i + 1}`, html_url: `https://github.com/octocat/x/pull/${from + i + 1}`,
      updated_at: new Date().toISOString(), draft: from + i === 1, user: { login: 'mona' },
    }));
    return send(200, items, from + 8 < 10 ? { Link: '<http://x/pulls?page=2>; rel="next"' } : {});
  }
  if (/^\/repos\/octocat\/[^/]+\/issues$/.test(url.pathname)) {
    const mk = (n, extra = {}) => ({ id: 2000 + n, number: n, title: `Issue ${n}`, html_url: `https://github.com/octocat/x/issues/${n}`, updated_at: new Date().toISOString(), user: { login: 'mona' }, ...extra });
    return send(200, [mk(1), mk(2), mk(3), mk(4, { title: 'esto es un PR', pull_request: {} })]);
  }
  if (/^\/repos\/octocat\/[^/]+\/actions\/runs$/.test(url.pathname)) {
    const now = new Date().toISOString();
    return send(200, { workflow_runs: [
      { id: 10, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', html_url: 'https://github.com/octocat/x/actions/runs/10', updated_at: now },
      { id: 11, name: 'Deploy', status: 'completed', conclusion: 'failure', head_branch: 'release', html_url: 'https://github.com/octocat/x/actions/runs/11', updated_at: now },
      { id: 12, name: 'Nightly', status: 'in_progress', conclusion: null, head_branch: 'main', html_url: 'https://github.com/octocat/x/actions/runs/12', updated_at: now },
    ] });
  }
  return send(404, {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const userData = mkdtempSync(join(tmpdir(), 'devpanel-pager-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat' }));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: base };
delete env.ELECTRON_RUN_AS_NODE;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.click('.nav[data-view="projects"]');
  await page.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });

  const cards = () => page.locator('.repo:not(.skeleton)').count();
  const names = () => page.locator('.repo .name').allTextContents();
  const curPage = () => page.textContent('#repo-pager .pg-num.cur');

  // ---------- projects pagination ----------
  assert.equal(await cards(), 9);
  assert.equal(await page.locator('#repo-pager .pg-num').count(), 3);
  assert.equal(await curPage(), '1');
  assert.ok(await page.locator('#repo-pager .pg-btn[aria-label="Anterior"]').isDisabled());
  assert.deepEqual((await names()).slice(0, 2), ['repo-01', 'repo-02']);
  assert.equal(await page.locator('.repo:not(.skeleton) .repo-tab').count(), 9, 'every project is a folder with a tab');
  assert.deepEqual(await page.locator('.repo-tab .name').allTextContents(), await names(), 'the tab carries the project name');
  assert.ok(await page.locator('.repo:not(.skeleton) .repo-body .star').first().isVisible(), 'the body keeps the star');
  assert.ok(await page.locator('.repo-tab svg').first().isVisible(), 'the tab has the folder icon');
  await page.hover('.repo:not(.skeleton) >> nth=1');
  await page.waitForTimeout(450);
  await shot(page, 'p0-folder-cards');
  log('the projects grid is paginated (9 per page), starts at the newest and every project is drawn as a folder');

  await page.click('#repo-pager .pg-num:has-text("2")');
  await page.waitForFunction(() => document.querySelector('#repo-pager .pg-num.cur')?.textContent === '2');
  assert.equal(await cards(), 9);
  assert.equal((await names())[0], 'repo-10');
  await page.click('#repo-pager .pg-btn[aria-label="Siguiente"]');
  await page.waitForFunction(() => document.querySelector('#repo-pager .pg-num.cur')?.textContent === '3');
  assert.equal(await cards(), 5);
  assert.ok(await page.locator('#repo-pager .pg-btn[aria-label="Siguiente"]').isDisabled());
  await shot(page, 'p1-projects-page3');
  log('numbers and arrows move between pages and the last page holds the remainder');

  await page.fill('#repo-search', 'repo-2');
  await page.waitForFunction(() => document.querySelectorAll('.repo:not(.skeleton)').length === 4);
  assert.ok(await page.locator('#repo-pager').isHidden(), 'a single page needs no pager');
  await page.fill('#repo-search', '');
  await page.waitForFunction(() => document.querySelectorAll('.repo:not(.skeleton)').length === 9);
  assert.equal(await curPage(), '1', 'a new search starts from page 1');
  log('searching resets to the first page and hides the pager when everything fits');

  // ---------- the folder dialog ----------
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.click('.repo:has(.name:text("repo-03"))');
  await page.waitForSelector('#repo-modal:not(.hidden)');
  assert.equal(await page.textContent('#rm-name'), 'repo-03');
  assert.ok(await page.locator('.folder-tab').isVisible(), 'folder tab');
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'opening a repo must not move the page');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('modal-open')), 'the page behind does not scroll');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit').length === 8);
  assert.ok(await page.locator('#rm-pager .pg-btn[aria-label="Anterior"]').isDisabled());
  assert.ok(await page.locator('#rm-pager .pg-btn[aria-label="Siguiente"]').isEnabled());
  await page.waitForSelector('#rm-badge .status-i.ok');
  assert.equal(await page.getAttribute('#rm-badge .status-i', 'title'), 'Build correcto');
  await shot(page, 'p2-folder');
  log('clicking a repo opens a folder dialog (no page jump) with its commits, 8 per page, and a green build icon');

  for (const el of await page.locator('#rm-actions .icon-btn, #rm-close').all()) {
    assert.equal((await el.textContent()).trim(), '', 'icon-only controls');
    assert.ok(await el.getAttribute('title'), 'with a tooltip');
  }
  log('every control in the dialog is an icon with a tooltip, not a word');

  await page.click('#rm-pager .pg-btn[aria-label="Siguiente"]');
  await page.waitForFunction(() => document.querySelector('#rm-commits .commit .msg')?.textContent.startsWith('p2 '));
  assert.equal(await page.locator('#rm-commits .commit').count(), 8);
  assert.equal(await page.textContent('#rm-pager .pg-num.cur'), '2');
  await page.click('#rm-pager .pg-btn[aria-label="Siguiente"]');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit').length === 3);
  assert.ok(await page.locator('#rm-pager .pg-btn[aria-label="Siguiente"]').isDisabled(), 'no next page after the last one');
  await page.click('#rm-pager .pg-btn[aria-label="Anterior"]');
  await page.waitForFunction(() => document.querySelector('#rm-commits .commit .msg')?.textContent.startsWith('p2 '));
  log('commits are paginated: next, last page without a next button, and back');

  await page.click('#rm-close');
  await page.waitForSelector('#repo-modal.hidden', { state: 'attached' });
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('modal-open'))));
  await page.click('.repo:has(.name:text("repo-04"))');
  await page.waitForSelector('#repo-modal:not(.hidden)');
  assert.equal(await page.textContent('#rm-name'), 'repo-04');
  assert.equal(await page.textContent('#rm-pager .pg-num.cur'), '1', 'each repo starts on its first commit page');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#repo-modal.hidden', { state: 'attached' });
  await page.click('.repo:has(.name:text("repo-05"))');
  await page.waitForSelector('#repo-modal:not(.hidden)');
  await page.mouse.click(10, 10); // the dim area outside the folder
  await page.waitForSelector('#repo-modal.hidden', { state: 'attached' });
  log('the X, Escape and a click outside all close the dialog, and the page stays where it was');

  // ---------- release notes dialog with real content ----------
  await page.click('#whatsnew-btn');
  await page.waitForSelector('#notes-body .ng');
  assert.equal(await page.locator('#notes-body .ng').count(), 3, 'three coloured groups');
  assert.equal(await page.locator('#notes-body .ng-feat li').count(), 2);
  assert.equal(await page.textContent('#notes-body .ng-feat li .scope'), 'app');
  assert.equal(await page.textContent('#notes-ver'), 'v0.1.0');
  const fix = await page.locator('#notes-body .ng-fix').evaluate((n) => getComputedStyle(n).borderLeftColor);
  const feat = await page.locator('#notes-body .ng-feat').evaluate((n) => getComputedStyle(n).borderLeftColor);
  assert.notEqual(fix, feat, 'each group has its own colour');
  await page.waitForTimeout(900);
  await shot(page, 'p3-notes');
  await page.click('#notes-close');
  await page.waitForSelector('#notes-modal.hidden', { state: 'attached' });
  log('the release notes dialog shows coloured groups (news, fixes, internal) with scope chips');

  // ---------- pull requests / issues / Actions tabs ----------
  await page.click('.repo:has(.name:text("repo-06"))');
  await page.waitForSelector('#repo-modal:not(.hidden)');
  for (const b of await page.locator('.rm-tab').all()) {
    assert.equal((await b.textContent()).trim(), '', 'tabs are icons');
    assert.ok(await b.getAttribute('title'));
  }
  await page.click('.rm-tab[data-tab="pulls"]');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit.item').length === 8);
  assert.equal(await page.textContent('#rm-commits .commit.item .sha'), '#1');
  await page.click('#rm-pager .pg-btn[aria-label="Siguiente"]');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit.item').length === 2);
  assert.ok(await page.locator('#rm-pager .pg-btn[aria-label="Siguiente"]').isDisabled());
  await page.click('.rm-tab[data-tab="issues"]');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit.item').length === 3);
  assert.ok(!(await page.textContent('#rm-commits')).includes('esto es un PR'), 'pull requests are filtered out of the issues tab');
  await page.click('.rm-tab[data-tab="runs"]');
  await page.waitForFunction(() => document.querySelectorAll('#rm-commits .commit.item').length === 3);
  assert.equal(await page.locator('#rm-commits .run-i.st-ok').count(), 1);
  assert.equal(await page.locator('#rm-commits .run-i.st-bad').count(), 1);
  assert.equal(await page.locator('#rm-commits .run-i.st-busy .spinner').count(), 1);
  assert.equal(await page.locator('#rm-commits .rerun').count(), 1, 'only the failed run offers a re-run');
  assert.equal(await page.textContent('#rm-commits .commit.item:nth-child(2) .chip'), 'release');
  await shot(page, 'p4-runs-tab');
  log('the folder has icon tabs: pull requests (paged), issues (without PRs) and Actions runs with their status');

  await page.click('#rm-commits .rerun');
  await page.waitForSelector('.toast.bad');
  assert.match(await page.textContent('.toast.bad'), /token/);
  assert.equal(rerunAuth.length, 0, 'nothing is sent to GitHub without a token');
  log('re-running a failed workflow without a token explains what is missing and sends nothing');
  await app.close();

  app = await electron.launch({ args: ['.'], env: { ...env, GITHUB_TOKEN: 'ghp_' + 'z'.repeat(36) } });
  const page2 = await app.firstWindow();
  await page2.setViewportSize({ width: 1100, height: 760 });
  await page2.click('.nav[data-view="projects"]');
  await page2.waitForSelector('.repo:not(.skeleton)', { timeout: 20000 });
  await page2.click('.repo:has(.name:text("repo-06"))');
  await page2.click('.rm-tab[data-tab="runs"]');
  await page2.waitForSelector('#rm-commits .rerun');
  await page2.click('#rm-commits .rerun');
  await page2.waitForSelector('.toast.ok');
  assert.deepEqual(rerunAuth, ['Bearer ghp_' + 'z'.repeat(36)], 'the re-run is sent with the token');
  log('with a token the failed jobs are re-run through the GitHub API');

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Pager test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'p-failure.png') });
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
