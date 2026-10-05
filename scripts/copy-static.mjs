import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist/renderer', { recursive: true });
for (const f of ['index.html', 'styles.css', 'icon.png']) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}
// The renderer is emitted as ES modules; this lets Node import them in unit tests too.
writeFileSync('dist/renderer/package.json', '{"type":"module"}\n');
