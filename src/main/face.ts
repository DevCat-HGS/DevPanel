import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaceResult, FaceStatus } from '../shared/api';
import { loadSettings } from './settings';

const faceFile = () => join(app.getPath('userData'), 'face.bin');
const pinFile = () => join(app.getPath('userData'), 'pin.json');
const modelsDir = () => join(app.getPath('userData'), 'models');

const scriptPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'python', 'face_auth.py')
    : join(app.getAppPath(), 'python', 'face_auth.py');

interface PyResult {
  ok: boolean;
  error?: string;
  score?: number;
  embeddings?: number[][];
}

/** The packaged app ships face_auth.exe (PyInstaller): no Python needed. Dev falls back to python + the script. */
const packagedExe = () => (app.isPackaged ? join(process.resourcesPath, 'python', 'face_auth.exe') : '');

/** Runs the face module; the last JSON line on stdout is the result, earlier lines are live prompts. */
function runPython(mode: 'enroll' | 'verify', stdin?: string, onLine?: (line: string) => void): Promise<PyResult> {
  mkdirSync(modelsDir(), { recursive: true });
  const extra = mode === 'verify' && loadSettings().faceLiveness ? ['--liveness'] : [];
  const exe = packagedExe();
  const useExe = !!exe && existsSync(exe);
  const cmd = useExe ? exe : (process.env.DEVPANEL_PYTHON ?? 'python');
  const args = [...(useExe ? [] : [scriptPath()]), mode, '--models-dir', modelsDir(), ...extra];

  return new Promise((resolve) => {
    const py = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let buf = '';
    py.stdout.on('data', (d) => {
      out += d;
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines.filter(Boolean)) onLine?.(l);
    });
    py.on('error', () =>
      resolve({ ok: false, error: 'No se pudo ejecutar Python. Instálalo y corre: pip install -r python/requirements.txt' }),
    );
    py.on('close', () => {
      const last = out.trim().split('\n').filter(Boolean).pop();
      try {
        resolve(JSON.parse(last ?? ''));
      } catch {
        resolve({ ok: false, error: 'Respuesta inválida del módulo facial' });
      }
    });
    if (stdin) py.stdin.write(stdin);
    py.stdin.end();
  });
}

function hashPin(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32);
}

function savePin(pin: string): FaceResult {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin))
    return { ok: false, error: 'El código debe tener 4 dígitos' };
  const salt = randomBytes(16);
  writeFileSync(
    pinFile(),
    JSON.stringify({ salt: salt.toString('hex'), hash: hashPin(pin, salt).toString('hex') }),
  );
  return { ok: true };
}

export function setupFace(): void {
  ipcMain.handle('face:status', (): FaceStatus => ({
    enrolled: existsSync(faceFile()),
    pinSet: existsSync(pinFile()),
  }));

  ipcMain.handle('pin:set', (_e, pin: string): FaceResult => savePin(pin));

  ipcMain.handle('face:enroll', async (_e, pin?: string): Promise<FaceResult> => {
    if (pin) {
      const saved = savePin(pin);
      if (!saved.ok) return saved;
    } else if (!existsSync(pinFile())) {
      return { ok: false, error: 'Primero define tu código de verificación' };
    }
    if (!safeStorage.isEncryptionAvailable())
      return { ok: false, error: 'El cifrado del sistema no está disponible' };

    const r = await runPython('enroll');
    if (!r.ok || !r.embeddings) return { ok: false, error: r.error ?? 'No se pudo registrar el rostro' };

    // Only embeddings (no images) are stored, encrypted with the OS keychain (DPAPI on Windows).
    writeFileSync(faceFile(), safeStorage.encryptString(JSON.stringify(r.embeddings)));
    return { ok: true };
  });

  ipcMain.handle('face:verify', async (): Promise<FaceResult> => {
    if (!existsSync(faceFile())) return { ok: false, error: 'No hay rostro registrado' };
    const embeddings = safeStorage.decryptString(readFileSync(faceFile()));
    const r = await runPython('verify', embeddings, (line) => {
      try {
        const m = JSON.parse(line);
        if (m.challenge || m.prompt) BrowserWindow.getAllWindows()[0]?.webContents.send('face:prompt', m);
      } catch {
        /* not a prompt line */
      }
    });
    return { ok: r.ok, score: r.score, error: r.error };
  });

  ipcMain.handle('face:pin', (_e, pin: string): FaceResult => {
    if (!existsSync(pinFile())) return { ok: false, error: 'No hay PIN configurado' };
    const { salt, hash } = JSON.parse(readFileSync(pinFile(), 'utf8'));
    const given = hashPin(String(pin), Buffer.from(salt, 'hex'));
    return timingSafeEqual(given, Buffer.from(hash, 'hex'))
      ? { ok: true }
      : { ok: false, error: 'PIN incorrecto' };
  });

  ipcMain.handle('face:remove', () => {
    rmSync(faceFile(), { force: true });
    rmSync(pinFile(), { force: true });
  });
}
