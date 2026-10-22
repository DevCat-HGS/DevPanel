// The face module runs as one warm worker (`serve`): Python, OpenCV and the models load once, and every later
// enroll/verify only pays for the camera. A fake Python stands in for the real one (no camera, no models).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = mkdtempSync(join(tmpdir(), 'devpanel-fw-'));
const userData = join(root, 'data');
const bin = join(root, 'bin');
const starts = join(root, 'starts.log');
mkdirSync(userData);
mkdirSync(bin);
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ language: 'es', onboarded: true, githubUser: 'octocat', faceLiveness: true }));

// fake "python": records each start, then speaks the serve protocol on stdin/stdout
writeFileSync(join(bin, 'fake.mjs'), `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(starts)}, args.includes('serve') ? 'serve\\n' : 'oneshot\\n');
if (!args.includes('serve')) { console.log(JSON.stringify({ ok: false, error: 'one-shot should not be used' })); process.exit(0); }
console.log(JSON.stringify({ ready: true }));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.cmd === 'enroll') console.log(JSON.stringify({ id: req.id, result: { ok: true, embeddings: [[0.1, 0.2], [0.3, 0.4]] } }));
  if (req.cmd === 'verify') {
    console.log(JSON.stringify({ challenge: 'left' }));
    const same = Array.isArray(req.embeddings) && req.embeddings.length === 2 && req.liveness === true;
    console.log(JSON.stringify({ id: req.id, result: same ? { ok: true, score: 0.77 } : { ok: false, error: 'bad request' } }));
  }
});
`);

const env = { ...process.env, DEVPANEL_USER_DATA: userData, DEVPANEL_GITHUB_API: 'http://127.0.0.1:9', DEVPANEL_PYTHON: 'node', DEVPANEL_FACE_SCRIPT: join(bin, 'fake.mjs') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.GITHUB_TOKEN;

let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.nav[data-view="local"]');

  const enroll = await page.evaluate(() => window.devpanel.face.enroll('4829'));
  assert.equal(enroll.ok, true, JSON.stringify(enroll));
  const prompts = await page.evaluate(() => {
    window.__prompts = [];
    window.devpanel.face.onPrompt((p) => window.__prompts.push(p));
  });
  void prompts;
  const v1 = await page.evaluate(() => window.devpanel.face.verify());
  const v2 = await page.evaluate(() => window.devpanel.face.verify());
  assert.equal(v1.ok, true, JSON.stringify(v1));
  assert.equal(v1.score, 0.77);
  assert.equal(v2.ok, true);
  log('enroll and two logins all go through the warm worker');

  const started = readFileSync(starts, 'utf8').trim().split('\n');
  assert.deepEqual(started, ['serve'], `Python started once, not once per login (${started})`);
  log('Python, OpenCV and the models are loaded once, not on every login');

  assert.ok((await page.evaluate(() => window.__prompts.length)) >= 2, 'the head-turn prompt still reaches the window');
  log('the live head-turn prompt is still forwarded to the window');

  console.log(`\nAll ${step} checks passed.`);
} catch (e) {
  console.error('\n✘ Face worker test failed:', e.message);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
