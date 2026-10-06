// E2E for the Claude Code chat. A fake `claude` on PATH speaks the stream-json protocol, so no real session is started.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), 'devpanel-shots');
mkdirSync(shots, { recursive: true });

const SESSION = '3f2b8c1e-5a4d-4e7f-9b6a-0c1d2e3f4a5b';
const root = mkdtempSync(join(tmpdir(), 'devpanel-cc-'));
const proj = join(root, 'migozz-app');
const bin = join(root, 'bin');
mkdirSync(proj);
mkdirSync(bin);
writeFileSync(join(bin, 'fake.mjs'), `
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: '${SESSION}', model: 'fake' });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'lib/wallet.dart' } }] } });
  const text = 'ARGS ' + process.argv.slice(2).join(' ') + '\\n\\nCTX ' + input.includes('[Contexto de DevPanel') + '\\n\\nRecibí: **' + input.trim().split('\\n').pop() + '**\\n\\n- uno\\n- dos con \`codigo\`\\n\\n\`\`\`js\\nconsole.log(1)\\n\`\`\`';
  out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'listo', session_id: '${SESSION}', duration_ms: 1200, total_cost_usd: 0.0123 });
});
`);
if (process.platform === 'win32') {
  writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake.mjs" %*\r\n');
} else {
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexec node "$(dirname "$0")/fake.mjs" "$@"\n');
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
const idle = (page) => page.waitForFunction(() => !document.getElementById('cc-send').classList.contains('hidden'));
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.waitForSelector('#nav-claude');

  // ---------- own space under Tools, with the Claude mark and an empty state ----------
  const views = await page.locator('nav .nav').evaluateAll((n) => n.map((b) => b.dataset.view));
  assert.deepEqual(views.slice(-2), ['tools', 'claude']);
  const mark = await page.locator('#nav-claude .cc-mark').evaluate((n) => getComputedStyle(n).maskImage);
  assert.match(mark, /brands\/claude\.svg/, 'uses the Claude brand icon that Tools > Software already ships');
  await page.click('#nav-claude');
  await page.waitForFunction(() => document.querySelectorAll('#cc-project option').length === 1);
  await page.waitForSelector('.cc-empty');
  assert.equal(await page.locator('.cc-starter').count(), 3);
  await shot(page, 'c1-claude-empty');
  log('Claude Code sits under Tools with the Claude icon, a project picker and a welcome with starter prompts');

  // ---------- a message renders as a chat: bubble, tool chip, markdown, code block ----------
  await page.fill('#cc-prompt', 'explica el módulo wallet; echo "x" & dir');
  await page.press('#cc-prompt', 'Enter');
  await page.waitForSelector('.cc-user .cc-body');
  await page.waitForSelector('.cc-meta');
  assert.equal((await page.textContent('.cc-user .cc-body')).trim(), 'explica el módulo wallet; echo "x" & dir');
  assert.match(await page.textContent('.cc-tool'), /Read.*lib\/wallet\.dart/);
  const answer = await page.textContent('.cc-assistant .cc-text');
  assert.match(answer, /ARGS -p --output-format stream-json --verbose --permission-mode plan/);
  assert.ok(!/--resume/.test(answer), 'first message starts a fresh session');
  assert.match(answer, /Recibí: explica el módulo wallet; echo "x" & dir/, 'shell characters arrived as plain text through stdin');
  assert.match(answer, /CTX true/, 'a new conversation starts with the health and diagnosis brief');
  assert.equal(await page.locator('.cc-assistant .cc-text strong').count(), 1);
  assert.equal(await page.locator('.cc-assistant .cc-list li').count(), 2);
  assert.equal(await page.locator('.cc-assistant .cc-text li code').textContent(), 'codigo');
  assert.equal((await page.textContent('.cc-code pre')).trim(), 'console.log(1)');
  assert.match(await page.textContent('.cc-meta'), /1\.2 s · \$0\.012/);
  await idle(page);
  await shot(page, 'c2-claude-chat');
  log('the answer is a chat: user bubble, tool chip, markdown (bold, list, inline code), a code block and timing');

  // ---------- the conversation continues and edit mode is explicit ----------
  await page.click('#cc-mode');
  assert.equal(await page.getAttribute('#cc-mode', 'data-m'), 'edit');
  await page.fill('#cc-prompt', 'ahora arregla el login');
  await page.click('#cc-send');
  await page.waitForFunction(() => document.querySelectorAll('.cc-assistant .cc-meta').length === 2);
  const second = await page.locator('.cc-assistant .cc-text').nth(1).textContent();
  assert.match(second, new RegExp(`--permission-mode acceptEdits --resume ${SESSION}`));
  assert.equal(await page.locator('.cc-user').count(), 2);
  log('the second message resumes the same session, and edit mode maps to acceptEdits (never a bypass)');

  // ---------- new conversation ----------
  await page.click('#cc-new');
  await page.waitForSelector('.cc-empty');
  await page.fill('#cc-prompt', 'otra cosa');
  await page.press('#cc-prompt', 'Enter');
  await page.waitForSelector('.cc-meta');
  assert.ok(!/--resume/.test(await page.locator('.cc-assistant .cc-text').first().textContent()), 'new conversation drops the session');
  log('"new conversation" clears the thread and starts a fresh session');
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
