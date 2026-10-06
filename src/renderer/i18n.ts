import { EN } from './en.js';

// Spanish is the source language. In English mode every visible string (static HTML, strings set
// from code and messages coming from the main process) is translated by looking it up in EN.
// A MutationObserver does the work, so no call site needs to know about languages.

export type Lang = 'es' | 'en';
export type LangPref = 'auto' | Lang;

let lang: Lang = 'es';

interface Pattern {
  re: RegExp;
  names: string[];
  out: string;
  weight: number;
}

const patterns: Pattern[] = Object.entries(EN)
  .filter(([k]) => /\{\w+\}/.test(k))
  .map(([key, out]) => {
    const names: string[] = [];
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (m) {
          names.push(m[1]);
          return '(.+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { re: new RegExp(`^${src}$`, 's'), names, out, weight: key.replace(/\{\w+\}/g, '').length };
  })
  .sort((a, b) => b.weight - a.weight);

export function detectLang(): Lang {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const l = (nav?.languages?.[0] ?? nav?.language ?? 'es').toLowerCase();
  return l.startsWith('es') ? 'es' : 'en';
}

export const currentLang = () => lang;

function lookup(s: string): string | null {
  if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
  for (const p of patterns) {
    const m = s.match(p.re);
    if (!m) continue;
    // captured parts may themselves be translatable (e.g. "hace 3 d" inside "Última actividad ...")
    let out = p.out;
    p.names.forEach((n, i) => (out = out.replace(`{${n}}`, tr(m[i + 1]))));
    return out;
  }
  return null;
}

/** Translates one string to the current language (identity in Spanish or when unknown). */
export function tr(text: string): string {
  if (lang === 'es' || !text) return text;
  if (text.includes('\n')) return text.split('\n').map(tr).join('\n'); // multi-line tool output
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = text.trim().replace(/\s+/g, ' ');
  if (!core) return text;
  const out = lookup(core);
  return out === null ? text : lead + out + trail;
}

// ---------- DOM ----------
const SKIP = '[data-no-i18n], .name, .commit .msg, .path, textarea, script, style, #term-out';
const ATTRS = ['placeholder', 'aria-label', 'title'] as const;

const textOrig = new WeakMap<Node, string>();
const textShown = new WeakMap<Node, string>();
const attrOrig = new WeakMap<Element, Map<string, string>>();
const attrShown = new WeakMap<Element, Map<string, string>>();

const skipped = (n: Node) => !!(n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(SKIP);

function applyText(node: Text, forceFromOrig = false): void {
  if (skipped(node)) return;
  const cur = node.nodeValue ?? '';
  // ignore the mutation caused by our own write
  if (!forceFromOrig && textShown.get(node) === cur && textOrig.has(node)) return;
  const source = forceFromOrig ? (textOrig.get(node) ?? cur) : cur;
  textOrig.set(node, source);
  const out = tr(source);
  textShown.set(node, out);
  if (out !== cur) node.nodeValue = out;
}

function applyAttrs(el: Element, forceFromOrig = false): void {
  if (skipped(el)) return;
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    const o = attrOrig.get(el) ?? attrOrig.set(el, new Map()).get(el)!;
    const s = attrShown.get(el) ?? attrShown.set(el, new Map()).get(el)!;
    if (!forceFromOrig && s.get(a) === cur && o.has(a)) continue;
    const source = forceFromOrig ? (o.get(a) ?? cur) : cur;
    o.set(a, source);
    const out = tr(source);
    s.set(a, out);
    if (out !== cur) el.setAttribute(a, out);
  }
}

function walk(root: Node, force = false): void {
  if (root.nodeType === 3) return applyText(root as Text, force);
  if (root.nodeType !== 1) return;
  applyAttrs(root as Element, force);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) applyText(n as Text, force);
    else applyAttrs(n as Element, force);
  }
}

let observer: MutationObserver | null = null;

function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
      else if (m.type === 'characterData') applyText(m.target as Text);
      else if (m.type === 'attributes') applyAttrs(m.target as Element);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
}

/** Sets the language ('auto' follows the system) and re-translates everything on screen. */
export function setLangPref(pref: LangPref): Lang {
  lang = pref === 'auto' ? detectLang() : pref;
  if (typeof document === 'undefined') return lang; // unit tests run without a DOM
  document.documentElement.lang = lang;
  startObserver();
  walk(document.body, true);
  return lang;
}
