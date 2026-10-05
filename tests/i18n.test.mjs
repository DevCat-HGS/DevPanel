import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EN } from '../dist/renderer/en.js';
import { setLangPref, tr } from '../dist/renderer/i18n.js';

test('English translations: static text, patterns, nesting and multi-line output', () => {
  setLangPref('en');
  assert.equal(tr('Tus proyectos'), 'Your projects');
  assert.equal(tr('hace 3 d'), '3 d ago');
  assert.equal(tr('Última actividad hace 5 min'), 'Last activity 5 min ago');
  assert.equal(tr('No existe el usuario "zzz" en GitHub'), 'User "zzz" does not exist on GitHub');
  assert.equal(tr('✔ JSON válido: objeto (2 claves)'), '✔ Valid JSON: object (2 keys)');
  assert.equal(tr('  Guardar  '), '  Save  ', 'surrounding whitespace is kept');
  assert.equal(tr('1 coincidencia(s):\nSin coincidencias'), '1 match(es):\nNo matches');
  assert.equal(tr('Texto que el usuario escribió'), 'Texto que el usuario escribió', 'unknown text is untouched');
  assert.equal(tr('Token guardado (cuenta @octo). Se usan tus repos privados y el límite alto de la API.'),
    'Token saved (account @octo). Your private repos and the high API limit are used.');
});

test('Spanish mode is the identity', () => {
  setLangPref('es');
  assert.equal(tr('Tus proyectos'), 'Tus proyectos');
  assert.equal(tr('hace 3 d'), 'hace 3 d');
});

test('every pattern keeps its placeholders in the translation', () => {
  for (const [es, en] of Object.entries(EN)) {
    const names = [...es.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const n of names) assert.ok(en.includes(`{${n}}`), `"${es}" -> missing {${n}} in "${en}"`);
  }
});

// Anything in the HTML that is not an English/brand label must have a translation, so a new Spanish
// string added to the page without an English version fails this test.
const NEUTRAL = new Set([
  'DevPanel', 'Projects', 'Local', 'Tools', 'Settings', 'Terminal', 'GitHub', 'Español', 'English', 'JSON', 'Base64',
  'URL', 'Hash', 'UUID', 'JWT', 'Regex', 'Ctrl', 'Alt', 'D', 'Fetch', 'Pull', 'VS Code', 'Actions', 'Git', 'npm',
  '▾', '✓', '⌫', '/', '◆',
]);

test('index.html has an English version for every Spanish text and attribute', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const found = new Set();
  for (const m of html.matchAll(/>([^<>]*[A-Za-zÁ-ú][^<>]*)</g)) found.add(m[1].replace(/\s+/g, ' ').trim());
  for (const m of html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) found.add(m[1]);
  const untranslated = [...found].filter((t) => t && !NEUTRAL.has(t) && !(t in EN));
  assert.deepEqual(untranslated, [], 'untranslated strings in index.html');
});

test('installer: every Spanish text in its HTML has an English version', async () => {
  const { EN: INST } = await import('../installer/dist/renderer/en.js');
  const html = readFileSync('installer/src/renderer/index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const found = new Set();
  for (const m of html.matchAll(/>([^<>]*[A-Za-zÁ-ú][^<>]*)</g)) found.add(m[1].replace(/\s+/g, ' ').trim());
  for (const m of html.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) found.add(m[1]);
  const neutral = new Set(['DevPanel', 'Dev', 'Panel', 'EN', 'Language / Idioma', 'ES']);
  const missing = [...found].filter((x) => x && !neutral.has(x) && !(x in INST));
  assert.deepEqual(missing, [], 'untranslated strings in the installer HTML');
});
