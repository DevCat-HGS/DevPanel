import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist/renderer', { recursive: true });
for (const f of ['index.html', 'styles.css', 'icon.png']) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}

// src/shared/catalog.json is the single source of truth (the main process imports it too).
// The renderer gets it as an ES module because fetch() of file:// URLs is blocked in Electron.
const catalog = JSON.parse(readFileSync('src/shared/catalog.json', 'utf8'));
writeFileSync('dist/renderer/catalog.js', `export const CATALOG = ${JSON.stringify(catalog)};\n`);

// Brand icons come from the CC0 "simple-icons" package and are copied next to the app, so the UI
// works offline. A brand without an icon simply falls back to its category icon.
mkdirSync('dist/renderer/brands', { recursive: true });
for (const item of catalog.items) {
  if (!item.brand) continue;
  const src = `node_modules/simple-icons/icons/${item.brand}.svg`;
  if (existsSync(src)) cpSync(src, `dist/renderer/brands/${item.brand}.svg`);
  else console.warn(`no brand icon for "${item.brand}" (${item.id}); the category icon is used`);
}

// The renderer is emitted as ES modules; this lets Node import them in unit tests too.
writeFileSync('dist/renderer/package.json', '{"type":"module"}\n');
