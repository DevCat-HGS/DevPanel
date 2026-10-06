import type { LocalProject } from '../shared/api';
import { $, el, toast } from './dom.js';

const api = () => window.devpanel;
let activeRun: number | null = null;
let mode: 'read' | 'edit' = 'read';
let hasProjects = false;

function out(text: string, cls = ''): void {
  const box = $('cc-out');
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  box.append(span);
  while (box.childNodes.length > 600) box.firstChild?.remove();
  box.scrollTop = box.scrollHeight;
}

function setRunning(id: number | null): void {
  activeRun = id;
  $('cc-title').textContent = id ? 'Claude está trabajando…' : 'Respuesta';
  $<HTMLButtonElement>('cc-stop').disabled = !id || id < 0;
  $<HTMLButtonElement>('cc-send').disabled = id !== null || !hasProjects;
}

export function setClaudeProjects(list: readonly LocalProject[]): void {
  const sel = $<HTMLSelectElement>('cc-project');
  const keep = sel.value;
  sel.replaceChildren(...list.map((p) => Object.assign(el('option'), { value: p.path, textContent: p.name })));
  if (list.some((p) => p.path === keep)) sel.value = keep;
  hasProjects = list.length > 0;
  $('cc-hint').textContent = hasProjects ? '' : 'Agrega una carpeta en Local para usar Claude Code.';
  $<HTMLButtonElement>('cc-send').disabled = !hasProjects || activeRun !== null;
}

async function send(): Promise<void> {
  const prompt = $<HTMLTextAreaElement>('cc-prompt').value.trim();
  const path = $<HTMLSelectElement>('cc-project').value;
  if (!prompt || !path) return;
  out(`\n› ${prompt}\n\n`, 'cmd');
  setRunning(-1); // placeholder until the main process answers with the real id
  const r = await api().claude.run(path, prompt, mode);
  if ('error' in r) {
    out(`${r.error}\n`, 'err');
    toast(r.error, 'bad');
    return setRunning(null);
  }
  setRunning(r.id);
}

export function initClaude(): void {
  if (api().platform === 'web') return;
  document.querySelectorAll<HTMLButtonElement>('#cc-mode button').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.m === 'edit' ? 'edit' : 'read';
      document.querySelectorAll('#cc-mode button').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('cc-send').onclick = () => void send();
  $('cc-prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (activeRun === null) void send();
    }
  });
  $('cc-stop').onclick = () => activeRun !== null && activeRun > 0 && void api().claude.stop(activeRun);
  $('cc-clear').onclick = () => $('cc-out').replaceChildren();
  api().claude.onOutput((m) => m.id === activeRun && out(m.text, m.stream === 'err' ? 'err' : ''));
  api().claude.onExit((m) => {
    if (m.id !== activeRun) return;
    out(m.code === 0 ? '\n' : `\n[terminó con código ${m.code}. ¿Está instalado Claude Code? Prueba "claude" en una terminal.]\n`, m.code === 0 ? '' : 'err');
    setRunning(null);
  });
  setRunning(null);
}
