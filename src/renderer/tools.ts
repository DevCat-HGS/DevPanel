// Pure developer utilities (no DOM) so they can be unit-tested in Node.

export function formatJson(text: string, indent = 2): string {
  return JSON.stringify(JSON.parse(text), null, indent);
}

export function minifyJson(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

export function validateJson(text: string): string {
  try {
    const v = JSON.parse(text);
    const kind = Array.isArray(v) ? `array (${v.length} elementos)` : typeof v === 'object' && v ? `objeto (${Object.keys(v).length} claves)` : typeof v;
    return `✔ JSON válido: ${kind}`;
  } catch (e) {
    return `✘ ${(e as Error).message}`;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64Encode(text: string): string {
  let bin = '';
  for (const b of enc.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64Decode(text: string): string {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const urlEncode = (t: string) => encodeURIComponent(t);
export const urlDecode = (t: string) => decodeURIComponent(t.trim());

export async function hashHex(algo: 'SHA-1' | 'SHA-256' | 'SHA-512', text: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuids(count: number): string {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 50);
  return Array.from({ length: n }, () => crypto.randomUUID()).join('\n');
}

export function decodeJwt(token: string): string {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('Un JWT tiene 3 partes separadas por puntos');
  const header = JSON.parse(base64Decode(parts[0]));
  const payload = JSON.parse(base64Decode(parts[1]));
  const lines = [`// header\n${JSON.stringify(header, null, 2)}`, `// payload\n${JSON.stringify(payload, null, 2)}`];
  if (typeof payload.exp === 'number') {
    const expired = payload.exp * 1000 < Date.now();
    lines.push(`// exp: ${new Date(payload.exp * 1000).toISOString()} (${expired ? 'EXPIRADO' : 'vigente'})`);
  }
  lines.push('// la firma NO se verifica aquí');
  return lines.join('\n\n');
}

/** Accepts a unix timestamp (s or ms), an ISO/date string, or "now". */
export function convertTime(input: string): string {
  const t = input.trim();
  let date: Date;
  if (!t || t.toLowerCase() === 'now') date = new Date();
  else if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
  } else date = new Date(t);
  if (Number.isNaN(date.getTime())) throw new Error('Formato de fecha no reconocido');
  return [
    `ISO:        ${date.toISOString()}`,
    `Local:      ${date.toLocaleString()}`,
    `Unix (s):   ${Math.floor(date.getTime() / 1000)}`,
    `Unix (ms):  ${date.getTime()}`,
  ].join('\n');
}

/** First line is /pattern/flags, the rest is the text to test. */
export function testRegex(input: string): string {
  const nl = input.indexOf('\n');
  const head = (nl === -1 ? input : input.slice(0, nl)).trim();
  const text = nl === -1 ? '' : input.slice(nl + 1);
  const m = head.match(/^\/(.*)\/([a-z]*)$/s);
  if (!m) throw new Error('La primera línea debe ser /patrón/flags, por ejemplo /\\d+/g');
  const flags = m[2].includes('g') ? m[2] : m[2] + 'g';
  const re = new RegExp(m[1], flags);
  const found = [...text.matchAll(re)];
  if (!found.length) return 'Sin coincidencias';
  return [
    `${found.length} coincidencia(s):`,
    ...found.slice(0, 100).map((x, i) => `${i + 1}. "${x[0]}" @${x.index}${x.length > 1 ? `  grupos: ${x.slice(1).map((g) => JSON.stringify(g)).join(', ')}` : ''}`),
  ].join('\n');
}
