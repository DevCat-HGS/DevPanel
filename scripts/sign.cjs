// Signs Windows executables with signtool.exe (the Windows SDK tool; see
// https://learn.microsoft.com/visualstudio/deployment/how-to-sign-setup-files-with-signtool-exe-clickonce).
//
// Used in two ways, with the same certificate:
//   - as electron-builder's custom `win.sign` hook (app, installer and uninstaller are signed when it packs them)
//   - from the command line for files electron-builder does not know about:
//       node scripts/sign.cjs python/face_auth.exe python/project_health.exe
//
// Env:  CSC_LINK          the .pfx as base64 (or a path to a .pfx file)
//       CSC_KEY_PASSWORD  its password
//       SIGN_TIMESTAMP_URL  RFC 3161 timestamp server (default: DigiCert)
//       SIGN_REQUIRED=1   fail instead of skipping when there is no certificate
// Without CSC_LINK it does nothing and exits 0, so unsigned builds (forks, PRs) keep working.
'use strict';
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const DEFAULT_TIMESTAMP = 'http://timestamp.digicert.com';

/** True when the value looks like a base64 blob rather than a path. */
const isBase64 = (v) => v.length > 260 || !/[\\/.]/.test(v.slice(0, 260));

/** Arguments for `signtool sign` (SHA-256 file digest and timestamp digest, as Microsoft recommends). */
function signArgs({ pfx, password, timestamp = DEFAULT_TIMESTAMP, description, file }) {
  const args = ['sign', '/fd', 'SHA256', '/f', pfx, '/p', password, '/tr', timestamp, '/td', 'SHA256'];
  if (description) args.push('/d', description);
  args.push(file);
  return args;
}

/** signtool.exe from PATH, else the newest one installed with the Windows SDK. */
function findSigntool() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['signtool'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.split(/\r?\n/)[0].trim();
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((r) => join(r, 'Windows Kits', '10', 'bin'));
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root)) {
      const exe = join(root, v, 'x64', 'signtool.exe');
      if (existsSync(exe)) found.push(exe);
    }
  }
  found.sort();
  return found.pop() ?? null;
}

/** Writes the certificate to a private temp folder; returns its path and a cleanup function. */
function materialize(csc) {
  const dir = mkdtempSync(join(tmpdir(), 'devpanel-sign-'));
  const pfx = join(dir, 'cert.pfx');
  if (existsSync(csc)) writeFileSync(pfx, readFileSync(csc));
  else writeFileSync(pfx, Buffer.from(csc, 'base64'));
  return { pfx, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Signs every file; returns how many were signed (0 when there is no certificate). */
function signFiles(files, env = process.env) {
  const csc = env.CSC_LINK;
  if (!csc) {
    const msg = 'No CSC_LINK certificate: the files stay unsigned (see docs/SIGNING.md).';
    if (env.SIGN_REQUIRED === '1') throw new Error(msg);
    console.warn(`::warning title=Unsigned build::${msg}`);
    return 0;
  }
  if (!isBase64(csc) && !existsSync(csc)) throw new Error('CSC_LINK points to a file that does not exist.');
  const signtool = findSigntool();
  if (!signtool) throw new Error('signtool.exe not found: install the Windows SDK (it is on the windows-latest runners).');
  if (env.GITHUB_ACTIONS && env.CSC_KEY_PASSWORD) console.log(`::add-mask::${env.CSC_KEY_PASSWORD}`);
  const { pfx, cleanup } = materialize(csc);
  try {
    for (const file of files) {
      const args = signArgs({ pfx, password: env.CSC_KEY_PASSWORD ?? '', timestamp: env.SIGN_TIMESTAMP_URL || DEFAULT_TIMESTAMP, description: 'DevPanel', file });
      // timestamp servers are flaky: retry a few times before giving up
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const r = spawnSync(signtool, args, { encoding: 'utf8' });
        ok = r.status === 0;
        if (!ok && attempt === 3) throw new Error(`signtool failed for ${file}:\n${(r.stdout ?? '') + (r.stderr ?? '')}`.replaceAll(env.CSC_KEY_PASSWORD || '\u0000', '***'));
      }
      execFileSync(signtool, ['verify', '/pa', file], { stdio: 'ignore' }); // fails the build if the signature does not verify
      console.log(`Signed ${file}`);
    }
  } finally {
    cleanup();
  }
  return files.length;
}

// electron-builder custom sign hook: receives { path, hash, isNest, ... } for each file it wants signed.
exports.default = async function sign(configuration) {
  signFiles([configuration.path]);
};
exports.signArgs = signArgs;
exports.signFiles = signFiles;
exports.isBase64 = isBase64;

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/sign.cjs <file.exe> [...]');
    process.exit(2);
  }
  try {
    signFiles(files);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
