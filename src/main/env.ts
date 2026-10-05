import { ipcMain } from 'electron';
import { exec } from 'node:child_process';
import type { EnvTool } from '../shared/api';

interface Probe {
  name: string;
  cmd: string;
  hint: string;
}

const PROBES: Probe[] = [
  { name: 'Git', cmd: 'git --version', hint: 'Necesario para clonar y versionar tus proyectos.' },
  { name: 'Node.js', cmd: 'node --version', hint: 'Necesario para compilar DevPanel y proyectos web.' },
  { name: 'Python', cmd: 'python --version', hint: 'Necesario para el login facial de DevPanel.' },
  {
    name: 'OpenCV (Python)',
    cmd: 'python -c "import cv2; print(cv2.__version__)"',
    hint: 'Instálalo con: pip install -r python/requirements.txt (login facial).',
  },
  { name: 'Docker', cmd: 'docker --version', hint: 'Recomendado para ejecutar la versión web en contenedor.' },
  { name: 'VS Code', cmd: 'code --version', hint: 'Recomendado: habilita "Abrir en VS Code" desde los proyectos.' },
  { name: 'Flutter', cmd: 'flutter --version', hint: 'Solo si trabajas con apps Flutter.' },
];

function probe(p: Probe): Promise<EnvTool> {
  return new Promise((resolve) => {
    exec(p.cmd, { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      const first = String(stdout).trim().split(/\r?\n/)[0] ?? '';
      resolve({ name: p.name, hint: p.hint, version: err || !first ? null : first.replace(/^[A-Za-z .]*?(?=\d)/, '') });
    });
  });
}

export function setupEnv(): void {
  ipcMain.handle('env:check', () => Promise.all(PROBES.map(probe)));
}
