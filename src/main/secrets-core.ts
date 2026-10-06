// Detection of secrets committed by mistake (pure: unit-testable). Findings never contain the secret itself.

export interface Finding {
  file: string;
  line?: number;
  rule: string;
}

const CONTENT_RULES: { id: string; re: RegExp }[] = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: 'stripe-live-key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'service-account', re: /"type"\s*:\s*"service_account"/ },
];

/** Tracked files that are secrets by their name alone. `.env.example` and friends are fine. */
const SAFE_ENV = /\.(?:example|sample|template|dist)$/i;
const NAME_RULES: { id: string; test: (base: string) => boolean }[] = [
  { id: 'env-file', test: (b) => /^\.env(?:\..+)?$/i.test(b) && !SAFE_ENV.test(b) },
  { id: 'key-file', test: (b) => /\.(?:pem|p12|pfx|keystore|jks)$/i.test(b) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(b) },
  { id: 'service-account-file', test: (b) => /firebase-adminsdk|^serviceaccount.*\.json$/i.test(b) },
];

export function scanName(file: string): Finding | null {
  const base = file.split(/[\\/]/).pop() ?? file;
  const rule = NAME_RULES.find((r) => r.test(base));
  return rule ? { file, rule: rule.id } : null;
}

export function scanText(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.length > 4000) return; // minified bundles are not worth scanning line by line
    for (const r of CONTENT_RULES) if (r.re.test(line)) out.push({ file, line: i + 1, rule: r.id });
  });
  return out;
}

/** A NUL byte in the first chunk means the file is binary. */
export const isBinary = (buf: Uint8Array): boolean => buf.subarray(0, 8000).includes(0);

export const MAX_SCAN_BYTES = 512 * 1024;
export const MAX_SCAN_FILES = 3000;
