import { el } from './dom.js';

/** Animated 4-digit keypad (same look and behaviour as the installer's). Keyboard works too. */
export interface PadHandle {
  /** Clears the digits and accepts input again. */
  reset(): void;
  shake(): void;
  /** Green dots: the code was accepted. */
  good(): void;
  /** Shows a given code on the dots (used by "generate one for me"). */
  setDigits(code: string, reveal?: boolean): void;
}

const LEN = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

export function mountPad(host: HTMLElement, onComplete: (pin: string) => void): PadHandle {
  host.classList.add('pinpad');
  const dots = el('div', 'dots');
  dots.setAttribute('aria-label', 'Dígitos ingresados');
  for (let i = 0; i < LEN; i++) dots.append(document.createElement('i'));
  const keypad = el('div', 'keypad');
  for (const k of KEYS) {
    const b = el('button', k === 'ok' ? 'ok' : '', k === 'back' ? '⌫' : k === 'ok' ? '✓' : k) as HTMLButtonElement;
    b.type = 'button';
    b.dataset.k = k;
    if (k === 'back') b.setAttribute('aria-label', 'Borrar');
    if (k === 'ok') b.setAttribute('aria-label', 'Confirmar');
    keypad.append(b);
  }
  host.replaceChildren(dots, keypad);

  let buf = '';
  let locked = false;
  let timer: number | undefined;

  const render = () => {
    const reveal = dots.classList.contains('reveal');
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('on', i < buf.length);
      d.textContent = reveal && i < buf.length ? buf[i] : '';
    });
    keypad.querySelector<HTMLButtonElement>('.ok')!.disabled = buf.length < LEN;
  };

  const complete = () => {
    if (locked || buf.length !== LEN) return;
    locked = true;
    onComplete(buf);
  };

  const press = (k: string) => {
    if (locked) return;
    if (k === 'back') buf = buf.slice(0, -1);
    else if (k === 'ok') return complete();
    else if (/^\d$/.test(k) && buf.length < LEN) buf += k;
    render();
    clearTimeout(timer);
    // confirm by itself once the 4th dot has visibly filled
    if (buf.length === LEN && k !== 'back') timer = window.setTimeout(complete, 220);
  };

  keypad.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.k) press(b.dataset.k);
  });

  document.addEventListener('keydown', (e) => {
    // only the pad that is on screen listens, and never while typing in a field
    if (!host.isConnected || host.offsetParent === null) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
    const key = e.key === 'Backspace' ? 'back' : e.key === 'Enter' ? 'ok' : e.key;
    if (!/^(\d|back|ok)$/.test(key)) return;
    const btn = keypad.querySelector<HTMLButtonElement>(`[data-k="${key}"]`);
    btn?.classList.add('press');
    setTimeout(() => btn?.classList.remove('press'), 120);
    press(key);
  });

  render();
  return {
    reset() {
      clearTimeout(timer);
      buf = '';
      locked = false;
      dots.classList.remove('good', 'reveal', 'shake');
      render();
    },
    shake() {
      dots.classList.remove('shake');
      void dots.offsetWidth; // restart the animation
      dots.classList.add('shake');
    },
    good() {
      dots.classList.add('good');
    },
    setDigits(code, reveal = false) {
      buf = code.slice(0, LEN);
      locked = true;
      dots.classList.toggle('reveal', reveal);
      render();
    },
  };
}

/**
 * "Create your code" flow: type it, repeat it, or let the app generate one.
 * Calls onDone with the accepted code. Used by the first-run wizard and the settings dialog.
 */
export function mountCodeSetup(host: HTMLElement, onDone: (pin: string) => void): void {
  const title = el('h2', 'cs-title');
  const sub = el('p', 'muted cs-sub');
  const padHost = el('div');
  const err = el('p', 'error cs-err');
  err.setAttribute('role', 'alert');
  const gen = el('button', 'btn ghost small', 'Generar uno por mí') as HTMLButtonElement;
  const noted = el('button', 'btn primary small hidden', 'Lo anoté, continuar') as HTMLButtonElement;
  const actions = el('div', 'cs-actions');
  actions.append(gen, noted);
  host.replaceChildren(title, sub, padHost, err, actions);

  let phase: 'create' | 'confirm' | 'generated' = 'create';
  let first = '';

  const setPhase = (p: typeof phase) => {
    phase = p;
    title.textContent = p === 'confirm' ? 'Repite tu código' : 'Crea tu código secreto';
    sub.textContent = p === 'confirm' ? 'Escríbelo otra vez para asegurarnos de que lo recuerdas.' : 'Son 4 dígitos. Es tu llave si el rostro falla.';
    err.textContent = '';
    noted.classList.add('hidden');
    gen.classList.toggle('hidden', p === 'confirm');
  };

  const accept = (pin: string) => {
    pad.good();
    setTimeout(() => onDone(pin), 450);
  };

  const pad = mountPad(padHost, (pin) => {
    if (phase === 'create') {
      first = pin;
      setPhase('confirm');
      return pad.reset();
    }
    if (pin !== first) {
      pad.shake();
      err.textContent = 'No coinciden. Empecemos de nuevo.';
      return void setTimeout(() => {
        setPhase('create');
        pad.reset();
      }, 650);
    }
    accept(pin);
  });

  gen.onclick = () => {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(LEN, '0');
    phase = 'generated';
    pad.reset();
    pad.setDigits(code, true);
    title.textContent = 'Este es tu código';
    sub.textContent = 'Anótalo en un lugar seguro: no se puede recuperar.';
    noted.classList.remove('hidden');
    gen.classList.add('hidden');
    noted.onclick = () => accept(code);
  };

  setPhase('create');
}
