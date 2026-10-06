import type { ChatEvent, LocalProject } from '../shared/api';
import { parseInline, parseMarkdown } from './chat-md.js';
import { $, copyText, el, toast } from './dom.js';
import { icon } from './icons.js';
import { tr } from './i18n.js';

const api = () => window.devpanel;

interface Thread {
  box: HTMLElement;
  session?: string;
}

const threads = new Map<string, Thread>(); // one conversation per project
let current = '';
let mode: 'read' | 'edit' = 'read';
let hasProjects = false;
let run: { id: number; thread: Thread; reply: HTMLElement; typing: HTMLElement; wrote: boolean } | null = null;

const STARTERS = ['Explícame cómo está organizado este proyecto', 'Busca posibles bugs en los últimos cambios', 'Sugiere pruebas que faltan'];

const TOOL_ICONS: Record<string, string> = { Read: 'code', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', Bash: 'terminal', Grep: 'search', Glob: 'search', WebFetch: 'globe', WebSearch: 'globe' };

function threadFor(path: string): Thread {
  let t = threads.get(path);
  if (!t) {
    t = { box: el('div', 'cc-msgs') };
    threads.set(path, t);
  }
  return t;
}

function scrollDown(): void {
  const th = $('cc-thread');
  th.scrollTop = th.scrollHeight;
}

/** Renders Claude's markdown answer as DOM: paragraphs, lists, headings and copyable code blocks. */
function renderMarkdown(into: HTMLElement, src: string): void {
  let list: HTMLElement | null = null;
  for (const b of parseMarkdown(src)) {
    if (b.type !== 'li') list = null;
    if (b.type === 'code') {
      const pre = el('div', 'cc-code');
      const bar = el('div', 'cc-code-bar');
      const copy = el('button', 'icon-btn mini') as HTMLButtonElement;
      copy.type = 'button';
      copy.title = 'Copiar';
      copy.append(icon('copy'));
      copy.onclick = () => void copyText(b.text).then(() => toast('Copiado', 'ok'));
      bar.append(el('span', 'muted', b.lang || 'código'), copy);
      pre.append(bar, el('pre', undefined, b.text));
      into.append(pre);
      continue;
    }
    let node: HTMLElement;
    if (b.type === 'li') {
      if (!list) {
        list = el('ul', 'cc-list');
        into.append(list);
      }
      node = el('li');
      list.append(node);
    } else {
      node = el(b.type === 'h' ? 'h4' : 'p');
      into.append(node);
    }
    for (const s of parseInline(b.text)) {
      node.append(s.t === 'txt' ? document.createTextNode(s.text) : el(s.t === 'code' ? 'code' : 'strong', undefined, s.text));
    }
  }
}

function bubble(role: 'user' | 'assistant'): { row: HTMLElement; body: HTMLElement } {
  const row = el('div', `cc-msg cc-${role}`);
  const body = el('div', 'cc-body');
  body.dataset.noI18n = '';
  if (role === 'assistant') {
    const avatar = el('span', 'cc-avatar');
    avatar.append(icon('claude'));
    row.append(avatar);
  }
  row.append(body);
  return { row, body };
}

function emptyState(): HTMLElement {
  const box = el('div', 'cc-empty');
  const logo = el('span', 'cc-empty-logo');
  logo.append(icon('claude'));
  const name = $<HTMLSelectElement>('cc-project').selectedOptions[0]?.textContent ?? '';
  box.append(logo, el('h3', undefined, '¿Qué quieres hacer?'), el('p', 'muted', name ? `${tr('Claude trabajará dentro de')} ${name}.` : 'Agrega una carpeta en Local para empezar.'));
  if (name) {
    const chips = el('div', 'cc-starters');
    for (const s of STARTERS) {
      const b = el('button', 'cc-starter', s) as HTMLButtonElement;
      b.type = 'button';
      b.onclick = () => {
        const ta = $<HTMLTextAreaElement>('cc-prompt');
        ta.value = tr(s);
        autoGrow();
        ta.focus();
      };
      chips.append(b);
    }
    box.append(chips);
  }
  return box;
}

function showThread(): void {
  if (!current) return $('cc-thread').replaceChildren(emptyState());
  const t = threadFor(current);
  $('cc-thread').replaceChildren(t.box.childElementCount ? t.box : emptyState());
  scrollDown();
}

function setRunning(on: boolean): void {
  $('cc-send').classList.toggle('hidden', on);
  $('cc-stop').classList.toggle('hidden', !on);
  $<HTMLSelectElement>('cc-project').disabled = on;
  $<HTMLButtonElement>('cc-send').disabled = !hasProjects;
  $<HTMLButtonElement>('cc-new').disabled = on;
}

function autoGrow(): void {
  const ta = $<HTMLTextAreaElement>('cc-prompt');
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
}

export function setClaudeProjects(list: readonly LocalProject[]): void {
  const sel = $<HTMLSelectElement>('cc-project');
  const keep = sel.value;
  sel.replaceChildren(...list.map((p) => Object.assign(el('option'), { value: p.path, textContent: p.name })));
  if (list.some((p) => p.path === keep)) sel.value = keep;
  hasProjects = list.length > 0;
  const changed = current !== sel.value;
  current = sel.value;
  $('cc-hint').textContent = hasProjects ? '' : 'Agrega una carpeta en Local para usar Claude Code.';
  $<HTMLButtonElement>('cc-send').disabled = !hasProjects;
  if (changed || !$('cc-thread').childElementCount) showThread();
}

function addTool(name: string, detail: string): void {
  if (!run) return;
  const chip = el('div', 'cc-tool');
  chip.append(icon(TOOL_ICONS[name] ?? 'tools'), el('strong', undefined, name), el('span', 'cc-tool-detail', detail));
  chip.dataset.noI18n = '';
  run.reply.append(chip);
}

function handle(ev: ChatEvent): void {
  if (!run) return;
  if (ev.kind === 'init') run.thread.session = ev.session;
  else if (ev.kind === 'text') {
    const block = el('div', 'cc-text');
    renderMarkdown(block, ev.text);
    run.reply.append(block);
    run.wrote = true;
  } else if (ev.kind === 'tool') addTool(ev.name, ev.detail);
  else if (ev.kind === 'result') {
    if (ev.session) run.thread.session = ev.session;
    if (!run.wrote && ev.text) {
      const block = el('div', 'cc-text');
      renderMarkdown(block, ev.text);
      run.reply.append(block);
    }
    if (!ev.ok) run.reply.append(el('div', 'cc-note err', 'Claude terminó con un error.'));
    const secs = ev.ms ? `${(ev.ms / 1000).toFixed(1)} s` : '';
    const cost = ev.cost ? `$${ev.cost.toFixed(3)}` : '';
    const meta = [secs, cost].filter(Boolean).join(' · ');
    if (meta) run.reply.append(el('div', 'cc-meta muted', meta));
  }
  scrollDown();
}

function finish(note?: string): void {
  if (!run) return;
  run.typing.remove();
  if (note) run.reply.append(el('div', 'cc-note err', note));
  run = null;
  setRunning(false);
  scrollDown();
  $('cc-prompt').focus();
}

async function send(): Promise<void> {
  if (run) return;
  const ta = $<HTMLTextAreaElement>('cc-prompt');
  const prompt = ta.value.trim();
  if (!prompt || !current) return;
  const thread = threadFor(current);
  if (!thread.box.childElementCount) $('cc-thread').replaceChildren(thread.box);
  const you = bubble('user');
  you.body.textContent = prompt;
  const reply = bubble('assistant');
  const typing = el('div', 'cc-typing');
  typing.append(el('span'), el('span'), el('span'));
  reply.body.append(typing);
  thread.box.append(you.row, reply.row);
  ta.value = '';
  autoGrow();
  scrollDown();
  // Events can reach the window before the invoke answers, so the run exists first with id 0 and adopts the real id on the first event.
  run = { id: 0, thread, reply: reply.body, typing, wrote: false };
  setRunning(true);
  const r = await api().claude.run(current, prompt, mode, thread.session);
  if ('error' in r) {
    toast(r.error, 'bad');
    finish(r.error);
  } else if (run && run.id === 0) run.id = r.id;
}

export function initClaude(): void {
  if (api().platform === 'web') return;
  const ta = $<HTMLTextAreaElement>('cc-prompt');
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });
  $('cc-send').onclick = () => void send();
  $('cc-stop').onclick = () => {
    if (run && run.id > 0) void api().claude.stop(run.id);
  };
  const mine = (id: number): boolean => {
    if (!run) return false;
    if (run.id === 0) run.id = id;
    return run.id === id;
  };
  $('cc-mode').onclick = () => {
    mode = mode === 'read' ? 'edit' : 'read';
    const b = $('cc-mode');
    b.dataset.m = mode;
    b.replaceChildren(icon(mode === 'edit' ? 'edit' : 'eye'), el('span', 'cc-mode-label', mode === 'edit' ? 'Editar' : 'Preguntar'));
    b.title = mode === 'edit' ? 'Claude puede modificar archivos del proyecto' : 'Solo lectura: Claude analiza y propone, no modifica archivos';
  };
  $('cc-project').onchange = () => {
    current = $<HTMLSelectElement>('cc-project').value;
    showThread();
  };
  $('cc-new').onclick = () => {
    if (!current || run) return;
    threads.delete(current);
    showThread();
  };
  api().claude.onEvent((m) => mine(m.id) && handle(m.event));
  api().claude.onOutput((m) => {
    if (!mine(m.id)) return;
    if (m.stream === 'err') run?.reply.append(el('pre', 'cc-note err', m.text.trim()));
  });
  api().claude.onExit((m) => {
    if (!mine(m.id)) return;
    finish(m.code === 0 ? undefined : `Claude terminó con código ${m.code}. ¿Está instalado Claude Code? Prueba "claude" en una terminal.`);
  });
  setRunning(false);
}
