import type { InstallOptions, Progress } from '../shared/api';

const api = window.installer;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Screen routing ----------
type Screen = 'welcome' | 'options' | 'progress' | 'done' | 'error';
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
    case 'done':
      installedDir = p.dir;
      show('done');
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
$('go-install').onclick = startInstall;
$('install2').onclick = startInstall;
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
