// E2E for the Claude Code panel. A fake `claude` on PATH echoes its arguments and stdin, so no real session is started.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const root = mkdtempSync(join(tmpdir(), 'devpanel-cc-'));
const proj = join(root, 'migozz-app');
const bin = join(root, 'bin');
mkdirSync(proj);
mkdirSync(bin);
if (process.platform === 'win32') {
  writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\necho ARGS %*\r\nmore\r\n');
} else {
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "ARGS $*"\ncat\n');
  chmodSync(join(bin, 'claude'), 0o755);
}

const userData = mkdtempSync(join(tmpdir(), 'devpanel-cc-data-'));
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat', localProjects: [proj] }));
const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: 'http://127.0.0.1:9' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.GITHUB_TOKEN;
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.waitForSelector('#nav-claude');

  // ---------- the space sits right under Tools ----------
  const labels = await page.locator('nav .nav').evaluateAll((n) => n.map((b) => b.dataset.view));
  assert.deepEqual(labels.slice(-2), ['tools', 'claude']);
  await page.click('#nav-claude');
  await page.waitForFunction(() => document.querySelectorAll('#cc-project option').length === 1);
  assert.equal(await page.locator('#cc-project option').first().textContent(), 'migozz-app');
  await shot(page, 'c1-claude-empty');
  log('Claude Code has its own space under Tools and lists the registered local projects');

  // ---------- read-only by default; the prompt travels through stdin ----------
  await page.fill('#cc-prompt', 'explica el módulo wallet; echo "no se ejecuta" & dir');
  await page.click('#cc-send');
  await page.waitForFunction(() => document.getElementById('cc-out').textContent.includes('ARGS'));
  await page.waitForFunction(() => !document.getElementById('cc-send').disabled);
  const out = await page.textContent('#cc-out');
  assert.match(out, /ARGS -p --permission-mode plan/);
  assert.match(out.split('ARGS')[1], /explica el módulo wallet; echo "no se ejecuta" & dir/); // came back through stdin, unparsed
  await shot(page, 'c2-claude-answer');
  log('a prompt runs `claude -p` in plan (read-only) mode and shell characters in it stay plain text');

  // ---------- edit mode ----------
  await page.click('#cc-mode button[data-m="edit"]');
  await page.fill('#cc-prompt', 'arregla el login');
  await page.click('#cc-clear');
  await page.click('#cc-send');
  await page.waitForFunction(() => document.getElementById('cc-out').textContent.includes('ARGS'));
  assert.match(await page.textContent('#cc-out'), /ARGS -p --permission-mode acceptEdits/);
  log('edit mode switches to acceptEdits, never to a bypass of all permissions');
} catch (e) {
  console.error('\n✘ Claude panel test failed:', e.message);
  try {
    const w = (await app?.windows())?.[0];
    if (w) await w.screenshot({ path: join(shots, 'c-failure.png') });
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
