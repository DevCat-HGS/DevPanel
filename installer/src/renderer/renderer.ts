import type { GithubProfile, InstallOptions, Progress } from '../shared/api';

const api = window.installer;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Screen routing ----------
type Screen = 'welcome' | 'options' | 'account' | 'progress' | 'face' | 'done' | 'error';
function show(name: Screen): void {
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
    channel: $<HTMLSelectElement>('channel').value === 'dev' ? 'dev' : 'stable',
    account: existing || !linked ? undefined : { github: linked.login, pin: $<HTMLInputElement>('pin').value },
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
      $('face-msg').textContent =
        p.state === 'preparing'
          ? 'Preparando el reconocimiento facial (puede tardar un minuto la primera vez)…'
          : 'Mira a la cámara y mueve un poco la cabeza…';
      break;
    case 'done':
      installedDir = p.dir;
      show('done');
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


// ---------- Account step ----------
function validAccount(): boolean {
  if (existing) return true;
  const pin = $<HTMLInputElement>('pin').value;
  return !!linked && /^\d{4,8}$/.test(pin) && pin === $<HTMLInputElement>('pin2').value;
}

function refreshAccountButton(): void {
  const btn = $<HTMLButtonElement>('acc-next');
  btn.disabled = !validAccount();
  const pin = $<HTMLInputElement>('pin').value;
  const err = $('acc-err');
  if (existing || !linked) return;
  if (pin && !/^\d{4,8}$/.test(pin)) err.textContent = 'El código debe tener de 4 a 8 dígitos';
  else if ($<HTMLInputElement>('pin2').value && pin !== $<HTMLInputElement>('pin2').value) err.textContent = 'Los códigos no coinciden';
  else err.textContent = '';
}

function updateChannelRow(login: string): void {
  const owner = !!login && login.toLowerCase() === devOwner.toLowerCase();
  $('channel-row').classList.toggle('hidden', !owner);
  if (!owner) $<HTMLSelectElement>('channel').value = 'stable';
}

function openAccount(): void {
  $('acc-existing').classList.toggle('hidden', !existing);
  $('acc-new').classList.toggle('hidden', !!existing);
  $('acc-err').textContent = '';
  if (existing) {
    $('acc-ex-name').textContent = `@${existing.githubUser}`;
    $<HTMLImageElement>('acc-ex-avatar').src = `https://github.com/${encodeURIComponent(existing.githubUser)}.png?size=88`;
    updateChannelRow(existing.githubUser);
  }
  refreshAccountButton();
  show('account');
}

async function linkGithub(): Promise<void> {
  const btn = $<HTMLButtonElement>('gh-btn');
  btn.disabled = true;
  $('acc-err').textContent = '';
  try {
    linked = await api.lookup($<HTMLInputElement>('gh').value);
    $<HTMLImageElement>('avatar').src = linked.avatar;
    $('p-name').textContent = linked.name ?? linked.login;
    $('p-login').textContent = `@${linked.login}`;
    $('profile').classList.remove('hidden');
    updateChannelRow(linked.login);
  } catch (e) {
    linked = null;
    $('profile').classList.add('hidden');
    updateChannelRow('');
    $('acc-err').textContent = (e as Error).message;
  }
  btn.disabled = false;
  refreshAccountButton();
}

$('gh-btn').onclick = () => void linkGithub();
$('gh').addEventListener('keydown', (e) => e.key === 'Enter' && void linkGithub());
$('gh').addEventListener('input', () => {
  linked = null;
  $('profile').classList.add('hidden');
  updateChannelRow('');
  refreshAccountButton();
});
$('pin').addEventListener('input', refreshAccountButton);
$('pin2').addEventListener('input', refreshAccountButton);
$('gen').onclick = () => {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  $<HTMLInputElement>('pin').value = $<HTMLInputElement>('pin2').value = String(n).padStart(6, '0');
  $<HTMLInputElement>('pin').type = $<HTMLInputElement>('pin2').type = 'text';
  refreshAccountButton();
  $('acc-err').textContent = 'Este es tu código: anótalo, no se puede recuperar.';
};
$('show').onclick = () => {
  const t = $<HTMLInputElement>('pin').type === 'password' ? 'text' : 'password';
  $<HTMLInputElement>('pin').type = $<HTMLInputElement>('pin2').type = t;
};
$('acc-back').onclick = () => show('welcome');
$('acc-next').onclick = () => validAccount() && startInstall();

// ---------- Face step ----------
function resetFace(): void {
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
