export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function toast(message: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
  const t = el('div', `toast ${kind}`, message);
  $('toasts').append(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 250);
  }, 3750);
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'ok');
  } catch {
    toast('No se pudo copiar', 'bad');
  }
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'justo ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function friendlyError(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  const known = knownGithubError(m);
  if (known) return known;
  if (m.includes('403')) return 'Límite de la API de GitHub alcanzado (60/hora sin token). Intenta más tarde.';
  if (m.includes('404')) return 'Usuario o repositorio no encontrado.';
  return `No se pudo cargar GitHub: ${m}`;
}

/** Rate limit and timeout are already worded by the main process; IPC prefixes "Error invoking remote method ...: Error: ". */
function knownGithubError(m: string): string | null {
  return m.match(/GitHub limitó las consultas hasta las \d{2}:\d{2}|GitHub no respondió a tiempo/)?.[0] ?? null;
}

/** Short reason for a Home widget that could not load. */
export function homeError(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  return knownGithubError(m) ?? (m.includes('403') ? 'Límite de la API de GitHub alcanzado (60/hora sin token). Intenta más tarde.' : 'No se pudo cargar GitHub');
}
