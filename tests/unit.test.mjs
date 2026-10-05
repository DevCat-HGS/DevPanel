import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../dist/renderer/tools.js';
import { analyzeRepos } from '../dist/renderer/recs.js';
import { newFailures } from '../dist/main/alerts-core.js';

test('json: format, minify, validate', () => {
  assert.equal(t.formatJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(t.minifyJson('{ "a" : [1, 2] }'), '{"a":[1,2]}');
  assert.match(t.validateJson('{"a":1}'), /válido/);
  assert.match(t.validateJson('{bad'), /✘/);
  assert.throws(() => t.formatJson('{bad'));
});

test('base64 round-trips unicode and url-safe input', () => {
  const s = 'Hola 🔥 ñandú';
  assert.equal(t.base64Decode(t.base64Encode(s)), s);
  assert.equal(t.base64Encode('hello'), 'aGVsbG8=');
  assert.equal(t.base64Decode('aGVsbG8'), 'hello');
});

test('url encode/decode', () => {
  assert.equal(t.urlEncode('a b&c'), 'a%20b%26c');
  assert.equal(t.urlDecode('a%20b%26c'), 'a b&c');
});

test('hash matches known digests', async () => {
  assert.equal(await t.hashHex('SHA-256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await t.hashHex('SHA-1', 'abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('uuids: count is clamped and values are unique v4', () => {
  const list = t.uuids(3).split('\n');
  assert.equal(list.length, 3);
  assert.equal(new Set(list).size, 3);
  assert.match(list[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(t.uuids(9999).split('\n').length, 50);
});

test('jwt decode shows payload and expiry', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: '1', exp: 1 })}.sig`;
  const out = t.decodeJwt(jwt);
  assert.match(out, /"sub": "1"/);
  assert.match(out, /EXPIRADO/);
  assert.throws(() => t.decodeJwt('nope'));
});

test('time converts unix seconds, ms and ISO', () => {
  assert.match(t.convertTime('0'), /1970-01-01T00:00:00.000Z/);
  assert.match(t.convertTime('1700000000000'), /2023-11-14T22:13:20.000Z/);
  assert.match(t.convertTime('2020-01-01T00:00:00Z'), /Unix \(s\):   1577836800/);
  assert.throws(() => t.convertTime('garbage'));
});

test('regex tester reports matches and groups', () => {
  const out = t.testRegex(String.raw`/(\d)(\w)/g` + '\nab 1x 2y');
  assert.match(out, /2 coincidencia/);
  assert.match(out, /"1x"/);
  assert.equal(t.testRegex('/zzz/\nabc'), 'Sin coincidencias');
  assert.throws(() => t.testRegex('no slashes'));
});

test('recommendations flag stale, undocumented and busy repos', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const repo = (o) => ({ name: 'r', description: 'd', language: 'TS', html_url: '', private: false, default_branch: 'main',
    pushed_at: '2026-09-30T00:00:00Z', license: { spdx_id: 'MIT' }, topics: ['x'], open_issues_count: 0, ...o });
  assert.equal(analyzeRepos([repo({})], now).length, 0);
  const recs = analyzeRepos([repo({ description: null, license: null, topics: [], pushed_at: '2025-01-01T00:00:00Z', open_issues_count: 12 })], now);
  assert.equal(recs.length, 5);
  assert.equal(recs[0].level, 'warn');
  assert.equal(analyzeRepos([repo({ archived: true, description: null })], now).length, 0);
});

test('alerts: first sight only records; later failures notify once', () => {
  const run = (id, conclusion, status = 'completed') => ({ repo: 'r', id, status, conclusion, url: 'u' });
  let state = newFailures({}, [run(1, 'failure')]);
  assert.equal(state.failures.length, 0, 'old failure at startup is not announced');
  assert.equal(state.seen.r, 1);

  state = newFailures(state.seen, [run(2, 'success')]);
  assert.equal(state.failures.length, 0);

  state = newFailures(state.seen, [run(3, 'failure')]);
  assert.equal(state.failures.length, 1);
  assert.equal(state.failures[0].id, 3);

  state = newFailures(state.seen, [run(3, 'failure')]);
  assert.equal(state.failures.length, 0, 'the same run is never announced twice');

  state = newFailures(state.seen, [run(4, null, 'in_progress')]);
  assert.equal(state.failures.length, 0, 'runs still in progress are ignored');
  assert.equal(state.seen.r, 3);
});
