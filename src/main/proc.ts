import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

/** taskkill by absolute path: never a `taskkill.exe` found in the current folder. A Windows path on any OS. */
export const taskkillPath = (env: NodeJS.ProcessEnv = process.env): string =>
  win32.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'taskkill.exe');

/**
 * Stops a process and everything it started. On Windows `child.kill()` only stops the process itself: a PyInstaller
 * `--onefile` exe, a `.cmd` shim or `npm run` leave their real worker running (with the camera open, say).
 */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const tk = spawn(taskkillPath(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    tk.on('error', () => child.kill()); // no taskkill: at least stop the direct child
  } else child.kill('SIGTERM');
}
