import type { GithubProfile, InstallOptions, Progress } from '../shared/api';

const api = window.installer;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Screen routing ----------
type Screen = 'welcome' | 'options' | 'gh' | 'pin' | 'channel' | 'progress' | 'face' | 'done' | 'error';
const STEP_OF: Partial<Record<Screen, number>> = { gh: 0, pin: 1, channel: 2, progress: 2, face: 3 };

function show(name: Screen): void {
  updateStepper(name);
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `s-${name}`));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// ---------- Ember particles (forge glow) ----------
function startEmbers(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $<HTMLCanvasElement>('fx');
  const ctx = canvas.getContext('2d')!;
  const dpr = devicePixelRatio || 1;
  const fit = () => {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  fit();
  addEventListener('resize', fit);

  interface P { x: number; y: number; r: number; v: number; drift: number; hue: number; a: number }
  const spawn = (initial: boolean): P => ({
    x: Math.random() * canvas.width,
    y: initial ? Math.random() * canvas.height : canvas.height + 10,
    r: (Math.random() * 1.8 + 0.6) * dpr,
    v: (Math.random() * 0.5 + 0.2) * dpr,
    drift: (Math.random() - 0.5) * 0.3 * dpr,
    hue: Math.random() < 0.65 ? 28 : 188, // orange embers, cyan sparks
    a: Math.random() * 0.5 + 0.2,
  });
  const ps = Array.from({ length: 55 }, () => spawn(true));

  const frame = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.y -= p.v;
      p.x += p.drift + Math.sin(p.y / 40) * 0.2 * dpr;
      if (p.y < -10) ps[i] = spawn(false);
      const fade = Math.min(1, p.y / (canvas.height * 0.5));
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${p.a * fade})`;
      ctx.shadowColor = `hsl(${p.hue}, 95%, 60%)`;
      ctx.shadowBlur = 8 * dpr;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- State ----------
let installDir = '';
let installedDir = '';
let lastOpts: InstallOptions | null = null;
let existing: { githubUser: string } | null = null;
let devOwner = '';
let linked: GithubProfile | null = null;
let chosenPin = '';
let chosenChannel: 'stable' | 'dev' = 'stable';

function setProgress(percent: number | null): void {
  const ring = document.querySelector('.ring') as HTMLElement;
  const arc = $('arc') as unknown as SVGCircleElement;
  if (percent === null) {
    ring.classList.add('indeterminate');
    $('pct').textContent = '…';
    return;
  }
  ring.classList.remove('indeterminate');
  arc.style.strokeDashoffset = String(326.7 * (1 - percent / 100));
  $('pct').textContent = `${percent}%`;
}

function startInstall(): void {
  lastOpts = {
    dir: installDir,
    desktopShortcut: $<HTMLInputElement>('opt-desktop').checked,
    launchAfter: $<HTMLInputElement>('opt-launch').checked,
    channel: chosenChannel,
    account: existing || !linked || !chosenPin ? undefined : { github: linked.login, pin: chosenPin },
  };
  $('cancel-row').classList.remove('hidden');
  $('confirm-row').classList.add('hidden');
  setProgress(0);
  $('stage').textContent = 'Descargando DevPanel…';
  $('detail').textContent = 'Conectando…';
  show('progress');
  void api.install(lastOpts);
}

api.onProgress((p: Progress) => {
  switch (p.phase) {
    case 'download':
      setProgress(p.percent);
      $('stage').textContent = 'Descargando DevPanel…';
      $('detail').textContent = p.total
        ? `${mb(p.got)} de ${mb(p.total)}${p.speed ? ` · ${mb(p.speed)}/s` : ''}`
        : 'Conectando…';
      break;
    case 'install':
      setProgress(null);
      $('stage').textContent = 'Instalando…';
      $('detail').textContent = 'Esto toma unos segundos. No cierres esta ventana.';
      $('cancel-row').classList.add('hidden');
      $('confirm-row').classList.add('hidden');
      break;
    case 'face':
      resetFace();
      show('face');
      break;
    case 'face-state':
      $('fring').classList.add('scanning');
      if (p.state === 'preparing') {
        $('face-msg').textContent = 'Preparando el reconocimiento facial (puede tardar un minuto la primera vez)…';
        $('face-step').textContent = '';
      } else {
        setFaceProgress(p.progress ?? 0, p.total ?? 5);
      }
      break;
    case 'done':
      installedDir = p.dir;
      show('done');
      confetti();
      if ($<HTMLInputElement>('opt-launch').checked) {
        setTimeout(() => {
          void api.launch(installedDir);
          api.win.close();
        }, 1800);
      }
      break;
    case 'cancelled':
      $('err-title').textContent = 'Instalación cancelada';
      $('err-msg').textContent = 'No se hizo ningún cambio en tu equipo.';
      show('error');
      break;
    case 'error':
      $('err-title').textContent = 'No se pudo instalar';
      $('err-msg').textContent = p.message;
      show('error');
      break;
  }
});

// ---------- Wiring ----------
$('min').onclick = () => api.win.minimize();
$('close').onclick = () => api.win.close();
$('go-install').onclick = openAccount;
$('install2').onclick = openAccount;
$('go-options').onclick = () => show('options');
$('back').onclick = () => show('welcome');
$('pick').onclick = async () => {
  const dir = await api.pickDir(installDir);
  if (dir) {
    installDir = dir;
    $<HTMLInputElement>('dir').value = dir;
  }
};

$('cancel').onclick = () => {
  $('cancel-row').classList.add('hidden');
  $('confirm-row').classList.remove('hidden');
};
$('confirm-no').onclick = () => {
  $('confirm-row').classList.add('hidden');
  $('cancel-row').classList.remove('hidden');
};
$('confirm-yes').onclick = () => void api.cancel();

$('open').onclick = () => {
  void api.launch(installedDir);
  api.win.close();
};
$('finish').onclick = () => api.win.close();
$('err-close').onclick = () => api.win.close();
$('retry').onclick = () => show('welcome');

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('s-options').classList.contains('active')) show('welcome');
});

// ---------- Boot ----------
(async () => {
  startEmbers();
  const info = await api.info();
  installDir = info.defaultDir;
  existing = info.existing;
  devOwner = info.devOwner;
  $<HTMLInputElement>('dir').value = installDir;

  if (info.release) {
    $('ver-chip').textContent = `Versión ${info.release.version} · ${mb(info.release.sizeBytes)}`;
    $<HTMLButtonElement>('go-install').disabled = false;
  } else {
    $('ver-chip').textContent = 'Sin conexión con GitHub';
    const err = $('welcome-error');
    err.textContent = info.error ?? 'No se pudo obtener la última versión.';
    err.classList.remove('hidden');
  }
})();


// ---------- Stepper ----------
function updateStepper(name: Screen): void {
  const idx = STEP_OF[name];
  const bar = $('stepper');
  bar.classList.toggle('hidden', idx === undefined);
  if (idx === undefined) return;
  bar.querySelectorAll('span').forEach((n, i) => {
    n.classList.toggle('on', i === idx);
    n.classList.toggle('done', i < idx);
  });
}

// ---------- Conversational setup ----------
const isOwner = (login: string) => !!login && login.toLowerCase() === devOwner.toLowerCase();

/** Entry point from "Instalar ahora": a returning user skips the questions. */
function openAccount(): void {
  chosenChannel = 'stable';
  if (existing) return isOwner(existing.githubUser) ? show('channel') : startInstall();
  show('gh');
  setTimeout(() => $<HTMLInputElement>('gh').focus(), 350);
}

// -- step 1: GitHub, looked up live while typing
let lookupTimer: number | undefined;
let lookupSeq = 0;

function resetCard(): void {
  linked = null;
  $('id-card').classList.add('hidden');
  $<HTMLButtonElement>('gh-next').disabled = true;
}

async function runLookup(): Promise<void> {
  const value = $<HTMLInputElement>('gh').value.trim();
  const seq = ++lookupSeq;
  $('gh-err').textContent = '';
  if (!value) return resetCard();
  $('gh-spin').classList.remove('hidden');
  try {
    const p = await api.lookup(value);
    if (seq !== lookupSeq) return; // a newer keystroke superseded this one
    linked = p;
    const img = $<HTMLImageElement>('avatar');
    img.src = p.avatar;
    $('p-name').textContent = p.name ?? p.login;
    $('p-login').textContent = `@${p.login}`;
    $('p-meta').textContent = `${p.repos} repos públicos · ${p.followers} seguidores`;
    const card = $('id-card');
    card.classList.remove('hidden');
    card.style.animation = 'none';
    void card.offsetWidth; // replay the pop-in on every new match
    card.style.animation = '';
    $<HTMLButtonElement>('gh-next').disabled = false;
  } catch (e) {
    if (seq !== lookupSeq) return;
    resetCard();
    $('gh-err').textContent = (e as Error).message;
  } finally {
    if (seq === lookupSeq) $('gh-spin').classList.add('hidden');
  }
}

$('gh').addEventListener('input', () => {
  resetCard();
  clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => void runLookup(), 450);
});
$('gh').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  clearTimeout(lookupTimer);
  if (linked) $('gh-next').click();
  else void runLookup();
});
$('gh-back').onclick = () => show('welcome');
$('gh-next').onclick = () => {
  if (!linked) return;
  startPin();
};

// -- step 2: animated PIN pad (keyboard works too)
type PinPhase = 'create' | 'confirm' | 'generated';
let pinPhase: PinPhase = 'create';
let pinFirst = '';
let pinBuf = '';

function renderDots(): void {
  const dots = [...$('dots').children] as HTMLElement[];
  const reveal = $('dots').classList.contains('reveal');
  dots.forEach((d, i) => {
    d.classList.toggle('on', i < pinBuf.length);
    d.textContent = reveal && i < pinBuf.length ? pinBuf[i] : '';
  });
  $<HTMLButtonElement>('keypad').querySelector<HTMLButtonElement>('.ok')!.disabled = pinBuf.length < 4;
}

function setPinPhase(phase: PinPhase): void {
  pinPhase = phase;
  pinBuf = '';
  $('dots').classList.remove('reveal', 'good');
  $('pin-err').textContent = '';
  $('pin-noted').classList.add('hidden');
  $('pin-title').textContent = phase === 'confirm' ? 'Repite tu código' : 'Crea tu código secreto';
  $('pin-sub').textContent =
    phase === 'confirm' ? 'Escríbelo otra vez para asegurarnos de que lo recuerdas.' : 'Son 4 dígitos. Es tu llave si el rostro falla.';
  renderDots();
}

function startPin(): void {
  chosenPin = '';
  pinFirst = '';
  setPinPhase('create');
  show('pin');
}

function pressKey(k: string): void {
  if (!$('s-pin').classList.contains('active') || pinPhase === 'generated') return;
  if (k === 'back') pinBuf = pinBuf.slice(0, -1);
  else if (k === 'ok') return void submitPin();
  else if (/^\d$/.test(k) && pinBuf.length < 4) pinBuf += k;
  $('pin-err').textContent = '';
  renderDots();
  if (pinBuf.length === 4 && k !== 'back') setTimeout(submitPin, 220);
}

function submitPin(): void {
  if (pinBuf.length < 4) return;
  if (pinPhase === 'create') {
    pinFirst = pinBuf;
    return setPinPhase('confirm');
  }
  if (pinBuf !== pinFirst) {
    const dots = $('dots');
    dots.classList.remove('shake');
    void dots.offsetWidth;
    dots.classList.add('shake');
    $('pin-err').textContent = 'No coinciden. Empecemos de nuevo.';
    setTimeout(() => setPinPhase('create'), 650);
    return;
  }
  pinAccepted(pinBuf);
}

function pinAccepted(pin: string): void {
  chosenPin = pin;
  $('dots').classList.add('good');
  setTimeout(() => (linked && isOwner(linked.login) ? show('channel') : startInstall()), 550);
}

$('keypad').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.k) pressKey(b.dataset.k);
});
document.addEventListener('keydown', (e) => {
  if (!$('s-pin').classList.contains('active')) return;
  const key = e.key === 'Backspace' ? 'back' : e.key === 'Enter' ? 'ok' : e.key;
  if (!/^(\d|back|ok)$/.test(key)) return;
  const btn = $('keypad').querySelector<HTMLButtonElement>(`[data-k="${key}"]`);
  btn?.classList.add('press');
  setTimeout(() => btn?.classList.remove('press'), 120);
  pressKey(key);
});
$('pin-gen').onclick = () => {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10_000;
  pinBuf = String(n).padStart(4, '0');
  pinPhase = 'generated';
  $('dots').classList.add('reveal');
  $('pin-title').textContent = 'Este es tu código';
  $('pin-sub').textContent = 'Anótalo en un lugar seguro: no se puede recuperar.';
  $('pin-noted').classList.remove('hidden');
  renderDots();
};
$('pin-noted').onclick = () => pinAccepted(pinBuf);
$('pin-back').onclick = () => show('gh');

// -- step 3 (owner only): channel cards
document.querySelectorAll<HTMLButtonElement>('.choice').forEach((c) => {
  c.onclick = () => {
    document.querySelectorAll('.choice').forEach((n) => {
      n.classList.toggle('selected', n === c);
      n.setAttribute('aria-checked', String(n === c));
    });
    chosenChannel = c.dataset.channel === 'dev' ? 'dev' : 'stable';
  };
});
$('ch-back').onclick = () => (existing ? show('welcome') : show('pin'));
$('ch-next').onclick = () => startInstall();

// ---------- Face step ----------
const FACE_HINTS = [
  'Mira de frente a la cámara',
  'Gira un poco la cabeza a la izquierda',
  'Ahora un poco a la derecha',
  'Levanta ligeramente la barbilla',
  'Última: sonríe, ya casi está',
];

function setFaceProgress(done: number, total: number): void {
  ($('seg-arc') as unknown as SVGCircleElement).style.strokeDashoffset = String(402 * (1 - done / total));
  $('face-step').textContent = `Captura ${Math.min(done + 1, total)} de ${total}`;
  $('face-msg').textContent = done >= total ? '¡Listo!' : FACE_HINTS[Math.min(done, FACE_HINTS.length - 1)];
}

function confetti(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#22d3ee', '#3b82f6', '#fb923c', '#34d399', '#f1f5f9'];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 220;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(angle) * dist + 120}px`);
    p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    p.style.animationDelay = `${Math.random() * 0.15}s`;
    box.append(p);
  }
  document.querySelector('.window')!.append(box);
  setTimeout(() => box.remove(), 2200);
}
function resetFace(): void {
  $<HTMLImageElement>('face-avatar').src = linked?.avatar ?? 'icon.png';
  ($('seg-arc') as unknown as SVGCircleElement).style.strokeDashoffset = '402';
  $('face-step').textContent = '';
  $('fring').classList.remove('scanning', 'fail');
  $('face-msg').textContent = 'Se guarda solo una huella numérica cifrada en este equipo, nunca fotos.';
  $<HTMLButtonElement>('face-go').disabled = false;
}

$('face-go').onclick = async () => {
  const btn = $<HTMLButtonElement>('face-go');
  btn.disabled = true;
  const r = await api.enrollFace();
  $('fring').classList.remove('scanning');
  if (r.ok) return; // main sends the 'done' phase
  btn.disabled = false;
  $('fring').classList.add('fail');
  setTimeout(() => $('fring').classList.remove('fail'), 500);
  $('face-msg').textContent = r.error ?? 'No se pudo registrar el rostro';
};
$('face-skip').onclick = () => void api.finishSetup();
