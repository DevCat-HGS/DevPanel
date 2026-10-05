// Builds and launches the desktop app. Clears ELECTRON_RUN_AS_NODE, which VS Code-style terminals
// export and which would otherwise make Electron start as plain Node (no window).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.'], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 0));
