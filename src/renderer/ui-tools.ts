import { $, copyText, el } from './dom.js';
import * as T from './tools.js';

interface Tool {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  actions: { label: string; run: (input: string) => string | Promise<string> }[];
}

export const TOOLS: Tool[] = [
  {
    id: 'json', label: 'JSON', hint: 'Formatea, minifica y valida JSON.', placeholder: '{"nombre":"DevPanel","version":1}',
    actions: [
      { label: 'Formatear', run: (i) => T.formatJson(i) },
      { label: 'Minificar', run: (i) => T.minifyJson(i) },
      { label: 'Validar', run: (i) => T.validateJson(i) },
    ],
  },
  {
    id: 'base64', label: 'Base64', hint: 'Codifica o decodifica texto (UTF-8 y URL-safe).', placeholder: 'Texto o Base64…',
    actions: [
      { label: 'Codificar', run: (i) => T.base64Encode(i) },
      { label: 'Decodificar', run: (i) => T.base64Decode(i) },
    ],
  },
  {
    id: 'url', label: 'URL', hint: 'Codifica o decodifica componentes de URL.', placeholder: 'https://ejemplo.com/?q=hola mundo',
    actions: [
      { label: 'Codificar', run: (i) => T.urlEncode(i) },
      { label: 'Decodificar', run: (i) => T.urlDecode(i) },
    ],
  },
  {
    id: 'hash', label: 'Hash', hint: 'Calcula SHA-1, SHA-256 o SHA-512 de un texto.', placeholder: 'Texto a hashear…',
    actions: (['SHA-1', 'SHA-256', 'SHA-512'] as const).map((a) => ({ label: a, run: (i: string) => T.hashHex(a, i) })),
  },
  {
    id: 'uuid', label: 'UUID', hint: 'Genera UUID v4. Escribe cuántos quieres (1-50).', placeholder: '5',
    actions: [{ label: 'Generar', run: (i) => T.uuids(Number(i)) }],
  },
  {
    id: 'jwt', label: 'JWT', hint: 'Decodifica un token (no verifica la firma).', placeholder: 'eyJhbGciOi…',
    actions: [{ label: 'Decodificar', run: (i) => T.decodeJwt(i) }],
  },
  {
    id: 'time', label: 'Fecha / Unix', hint: 'Convierte timestamps y fechas. Escribe "now" para la hora actual.', placeholder: '1700000000  ó  2024-01-01T00:00:00Z',
    actions: [{ label: 'Convertir', run: (i) => T.convertTime(i) }],
  },
  {
    id: 'regex', label: 'Regex', hint: 'Primera línea /patrón/flags; el resto es el texto a probar.', placeholder: '/(\\d+)-(\\w+)/g\nabc 12-foo 7-bar',
    actions: [{ label: 'Probar', run: (i) => T.testRegex(i) }],
  },
];

export function initTools(): void {
  const list = $('tool-list');
  const input = $<HTMLTextAreaElement>('tool-input');
  const output = $('tool-output');
  const actions = $('tool-actions');
  let current = TOOLS[0];

  const select = (tool: Tool) => {
    current = tool;
    list.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === tool.id));
    $('tool-title').textContent = tool.label;
    $('tool-hint').textContent = tool.hint;
    input.placeholder = tool.placeholder;
    output.textContent = '';
    output.classList.remove('err');
    actions.replaceChildren(
      ...tool.actions.map((a) => {
        const b = el('button', 'btn small', a.label);
        b.onclick = async () => {
          try {
            output.textContent = await a.run(input.value);
            output.classList.remove('err');
          } catch (e) {
            output.textContent = (e as Error).message;
            output.classList.add('err');
          }
        };
        return b;
      }),
    );
  };

  list.replaceChildren(
    ...TOOLS.map((t) => {
      const b = el('button', 'tool-btn', t.label);
      b.dataset.id = t.id;
      b.onclick = () => select(t);
      return b;
    }),
  );
  $('tool-copy').onclick = () => void copyText(output.textContent ?? '');
  select(current);
}

export function initEnvCheck(): void {
  const card = $('env-card');
  if (window.devpanel.platform === 'web') return card.classList.add('hidden');

  $('env-check').onclick = async () => {
    const btn = $<HTMLButtonElement>('env-check');
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    const tools = await window.devpanel.env.check();
    $('env-list').replaceChildren(
      ...tools.map((t) => {
        const li = el('li', t.version ? 'ok' : 'miss');
        li.append(el('b', undefined, t.name), el('span', 'muted', t.version ?? `No encontrado · ${t.hint}`));
        return li;
      }),
    );
    btn.disabled = false;
    btn.textContent = 'Verificar de nuevo';
  };
}
