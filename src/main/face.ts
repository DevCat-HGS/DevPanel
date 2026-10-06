import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaceResult, FaceStatus } from '../shared/api';
import { loadSettings } from './settings';

const faceFile = () => join(app.getPath('userData'), 'face.bin');
const pinFile = () => join(app.getPath('userData'), 'pin.json');
const modelsDir = () => join(app.getPath('userData'), 'models');

const scriptPath = () =>
  process.env.DEVPANEL_FACE_SCRIPT ??
  (app.isPackaged
    ? join(process.resourcesPath, 'python', 'face_auth.py')
    : join(app.getAppPath(), 'python', 'face_auth.py'));

interface PyResult {
  ok: boolean;
  error?: string;
  score?: number;
  embeddings?: number[][];
}

/** The packaged app ships face_auth.exe (PyInstaller): no Python needed. Dev falls back to python + the script. */
const packagedExe = () => (app.isPackaged ? join(process.resourcesPath, 'python', 'face_auth.exe') : '');

// ---------- warm worker ----------
// Starting Python, OpenCV and the models takes seconds, and the packaged .exe unpacks itself each time. So one
// `serve` process is kept alive with the models loaded; a login only pays for the camera and the match.
const IDLE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90_000;

interface Worker {
  child: ChildProcess;
  ready: Promise<boolean>;
  pending: { id: number; resolve: (r: PyResult) => void; onLine?: (line: string) => void } | null;
}
let worker: Worker | null = null;
let nextReq = 1;
let idleTimer: NodeJS.Timeout | undefined;

const pyCommand = (args: string[]): { cmd: string; args: string[] } => {
  const exe = packagedExe();
  const useExe = !!exe && existsSync(exe);
  return { cmd: useExe ? exe : (process.env.DEVPANEL_PYTHON ?? 'python'), args: [...(useExe ? [] : [scriptPath()]), ...args] };
};

function stopWorker(): void {
  clearTimeout(idleTimer);
  const w = worker;
  worker = null;
  if (!w) return;
  w.pending?.resolve({ ok: false, error: 'El módulo facial se detuvo' });
  w.child.kill();
}

function startWorker(): Worker {
  if (worker) return worker;
  mkdirSync(modelsDir(), { recursive: true });
  const { cmd, args } = pyCommand(['serve', '--models-dir', modelsDir()]);
  let child: ChildProcess;
  try {
    child = spawn(cmd, args, { windowsHide: true });
  } catch {
    // e.g. EINVAL for a .cmd shim: report "not ready" so the caller falls back to the one-shot process
    const dead: Worker = { child: null as unknown as ChildProcess, ready: Promise.resolve(false), pending: null };
    return dead;
  }
  let markReady: (ok: boolean) => void = () => {};
  const w: Worker = { child, ready: new Promise<boolean>((r) => (markReady = r)), pending: null };
  worker = w;
  let buf = '';
  child.stdout?.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.ready) markReady(true);
      else if (m.result && w.pending && m.id === w.pending.id) {
        const p = w.pending;
        w.pending = null;
        p.resolve(m.result as PyResult);
      } else w.pending?.onLine?.(line);
    }
  });
  const gone = () => {
    markReady(false);
    if (worker === w) worker = null;
    w.pending?.resolve({ ok: false, error: 'El módulo facial se detuvo' });
    w.pending = null;
  };
  child.on('error', gone);
  child.on('close', gone);
  child.stdin?.on('error', () => {});
  return w;
}

/** Warms the worker up in the background so the first login is already fast. */
export function prewarmFace(): void {
  if (process.env.DEVPANEL_NO_FACE_WORKER) return;
  startWorker();
}

/** Asks the warm worker; null means "not available, use the one-shot process". */
async function viaWorker(payload: object, onLine?: (line: string) => void): Promise<PyResult | null> {
  if (process.env.DEVPANEL_NO_FACE_WORKER) return null;
  const w = startWorker();
  if (!(await w.ready)) return null;
  if (w.pending) return null; // one camera, one request at a time
  clearTimeout(idleTimer);
  const id = nextReq++;
  const result = await new Promise<PyResult>((resolve) => {
    const timer = setTimeout(() => {
      stopWorker(); // a stuck camera must not block every later login
      resolve({ ok: false, error: 'El módulo facial tardó demasiado' });
    }, REQUEST_TIMEOUT_MS);
    w.pending = { id, resolve: (r) => (clearTimeout(timer), resolve(r)), onLine };
    w.child.stdin?.write(JSON.stringify({ id, ...payload }) + '\n');
  });
  idleTimer = setTimeout(stopWorker, IDLE_MS);
  return result;
}

/** Runs the face module; the last JSON line on stdout is the result, earlier lines are live prompts. */
function runPython(mode: 'enroll' | 'verify', stdin?: string, onLine?: (line: string) => void): Promise<PyResult> {
  mkdirSync(modelsDir(), { recursive: true });
  const extra = mode === 'verify' && loadSettings().faceLiveness ? ['--liveness'] : [];
  const { cmd, args } = pyCommand([mode, '--models-dir', modelsDir(), ...extra]);

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
  app.on('will-quit', stopWorker);
  // the lock screen is the first thing a returning user sees: have the models loaded by then
  if (existsSync(faceFile())) prewarmFace();

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

    const r = (await viaWorker({ cmd: 'enroll' })) ?? (await runPython('enroll'));
    if (!r.ok || !r.embeddings) return { ok: false, error: r.error ?? 'No se pudo registrar el rostro' };

    // Only embeddings (no images) are stored, encrypted with the OS keychain (DPAPI on Windows).
    writeFileSync(faceFile(), safeStorage.encryptString(JSON.stringify(r.embeddings)));
    return { ok: true };
  });

  ipcMain.handle('face:verify', async (): Promise<FaceResult> => {
    if (!existsSync(faceFile())) return { ok: false, error: 'No hay rostro registrado' };
    const embeddings = safeStorage.decryptString(readFileSync(faceFile()));
    const onLine = (line: string) => {
      try {
        const m = JSON.parse(line);
        if (m.challenge || m.prompt) BrowserWindow.getAllWindows()[0]?.webContents.send('face:prompt', m);
      } catch {
        /* not a prompt line */
      }
    };
    const r =
      (await viaWorker({ cmd: 'verify', embeddings: JSON.parse(embeddings), liveness: loadSettings().faceLiveness }, onLine)) ??
      (await runPython('verify', embeddings, onLine));
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
