import type { InspectResult, LocalProject } from '../shared/api';
import { el } from './dom.js';
import { icon } from './icons.js';

type Ok = Extract<InspectResult, { ok: true }>;

/** Everything the diagnosis panel needs from the Local view. */
export interface DiagHooks {
  /** Runs an action id (install, script:<name>, flutter-run:<device>...) in the terminal. */
  run: (label: string, actionId: string) => void;
  /** Asks Python again, this time with Flutter devices and emulators. */
  deep: () => void;
}

const SEV_ICON = { error: 'xcircle', warn: 'alert', info: 'info' } as const;

function actionBtn(text: string, tip: string, onClick: () => void, name = 'play'): HTMLButtonElement {
  const b = el('button', 'btn small diag-act') as HTMLButtonElement;
  b.type = 'button';
  b.title = tip;
  b.append(icon(name), document.createTextNode(text));
  b.onclick = onClick;
  return b;
}

function section(title: string): HTMLElement {
  const s = el('div', 'diag-sec');
  s.append(el('h4', undefined, title));
  return s;
}

const toolChip = (name: string, version: string | null): HTMLElement => {
  const c = el('span', `chip lc ${version ? '' : 'bad'}`.trim());
  c.title = version ? `${name} ${version}` : `${name} no está instalado`;
  c.append(document.createTextNode(version ? `${name} ${version}` : `${name} ✗`));
  return c;
};

/** Problems count for the card chip: [errors, warnings]. */
export const problemCounts = (r: Ok): [number, number] => [
  r.problems.filter((p) => p.severity === 'error').length,
  r.problems.filter((p) => p.severity === 'warn').length,
];

export function renderDiag(p: LocalProject, r: Ok, hooks: DiagHooks): HTMLElement {
  const box = el('div', 'diag');

  // runtime + tools
  const top = el('div', 'chips');
  if (r.manager) top.append(el('span', 'chip branch', r.manager));
  for (const [name, v] of Object.entries(r.tools)) if (name !== 'git') top.append(toolChip(name, v));
  if (r.node?.required) {
    const ok = r.node.ok;
    const c = el('span', `chip ${ok === false ? 'warn' : ok ? 'ok' : ''}`.trim(), `Node pedido: ${r.node.required}`);
    c.title = ok === false ? `Tienes ${r.node.installed}` : 'Versión de Node compatible';
    top.append(c);
  }
  box.append(top);

  // problems found before they hurt
  const probs = section('Problemas detectados');
  if (!r.problems.length) probs.append(el('p', 'diag-ok', 'Nada que arreglar: dependencias, versiones y archivos clave en orden.'));
  for (const pr of r.problems) {
    const row = el('div', `diag-row sev-${pr.severity}`);
    row.append(icon(SEV_ICON[pr.severity]), el('span', 'diag-msg', pr.message));
    if (pr.fix && pr.label) row.append(actionBtn(pr.label, `Ejecutar: ${pr.label}`, () => hooks.run(pr.label!, pr.fix!), 'tools'));
    probs.append(row);
  }
  box.append(probs);

  // scripts and tasks, with whichever manager the project really uses
  const names = r.manager === 'deno' ? r.tasks : r.scripts;
  if (names.length) {
    const sec = section(r.manager === 'deno' ? 'Tareas de Deno' : `Scripts (${r.manager})`);
    const list = el('div', 'diag-btns');
    for (const n of names) {
      const id = r.manager === 'deno' ? `task:${n}` : `script:${n}`;
      list.append(actionBtn(n, r.manager === 'deno' ? `deno task ${n}` : `${r.manager} run ${n}`, () => hooks.run(`${r.manager} ${n}`, id)));
    }
    sec.append(list);
    box.append(sec);
  }

  // Flutter: SDK, devices, emulators
  if (r.flutter) {
    const f = r.flutter;
    const sec = section('Flutter');
    const info = el('div', 'chips');
    if (f.installed) info.append(el('span', 'chip', `Flutter ${f.installed}${f.channel ? ` · ${f.channel}` : ''}`));
    if (f.constraint) info.append(el('span', 'chip', `Dart ${f.constraint}`));
    sec.append(info);
    const probed = f.installed !== null || f.devices.length > 0 || f.emulators.length > 0;
    if (!probed) sec.append(actionBtn('Buscar dispositivos y versiones', 'Pregunta a Flutter por dispositivos y emuladores (tarda unos segundos)', hooks.deep, 'search'));
    if (f.devices.length) {
      sec.append(el('h5', undefined, 'Dispositivos conectados'));
      const l = el('div', 'diag-btns');
      for (const d of f.devices) l.append(actionBtn(d.name, `flutter run -d ${d.id}`, () => hooks.run(`flutter run -d ${d.id}`, `flutter-run:${d.id}`)));
      sec.append(l);
    }
    if (f.emulators.length) {
      sec.append(el('h5', undefined, 'Emuladores'));
      const l = el('div', 'diag-btns');
      for (const e of f.emulators) l.append(actionBtn(e.name, `flutter emulators --launch ${e.id}`, () => hooks.run(`Iniciar ${e.name}`, `flutter-emulator:${e.id}`), 'phone'));
      sec.append(l);
    }
    box.append(sec);
  }

  // general actions
  const general = r.actions.filter((a) => !a.id.startsWith('script:'));
  if (general.length) {
    const sec = section('Acciones');
    const l = el('div', 'diag-btns');
    for (const a of general) l.append(actionBtn(a.label, a.label, () => hooks.run(a.label, a.id)));
    sec.append(l);
    box.append(sec);
  }
  void p;
  return box;
}
