// Generates the README artwork in readme/: the banner and the feature grid, each in a dark and a light version
// (README.md picks one with <picture> and prefers-color-scheme). Colors come from the app's own palette
// (src/renderer/styles.css, mirrored in site/style.css). Run: node readme/build.mjs
//
// GitHub shows these SVGs as images: no web fonts and no external files load, so the font is a system stack and
// the app icon is embedded as a data URI.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icon = `data:image/png;base64,${readFileSync(join(here, '../site/img/icon.png')).toString('base64')}`;

const themes = {
  dark: {
    bg: '#101216',
    bg2: '#0b0d11',
    panel: '#171a20',
    panel2: '#1d2128',
    border: 'rgba(255,255,255,0.09)',
    text: '#e8eaee',
    muted: '#98a1b0',
    accent: '#7aa7f7',
    warm: '#e8955f',
    ok: '#5fc59a',
    bad: '#ef6b6b',
    grid: 'rgba(122,167,247,0.07)',
    glow: 'rgba(122,167,247,0.22)',
  },
  light: {
    bg: '#f4f5f7',
    bg2: '#e9ecf1',
    panel: '#ffffff',
    panel2: '#f6f7f9',
    border: 'rgba(20,30,50,0.12)',
    text: '#1a2230',
    muted: '#5b6678',
    accent: '#2f6fe0',
    warm: '#c8642c',
    ok: '#059669',
    bad: '#d64545',
    grid: 'rgba(47,111,224,0.08)',
    glow: 'rgba(47,111,224,0.14)',
  },
};

const font = `'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif`;
const mono = `'Cascadia Code',Consolas,'SFMono-Regular',Menlo,monospace`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function banner(t) {
  const W = 1280;
  const H = 420;
  const chips = ['GitHub', 'Proyectos locales', 'Herramientas', 'Claude Code', 'Login facial'];
  let x = 96;
  const chipSvg = chips
    .map((c) => {
      const w = Math.round(c.length * 7.3 + 36);
      const out = `<g transform="translate(${x} 300)"><rect width="${w}" height="32" rx="16" fill="${t.panel}" stroke="${t.border}"/><text x="${w / 2}" y="21" text-anchor="middle" font-size="14" fill="${t.muted}">${esc(c)}</text></g>`;
      x += w + 10;
      return out;
    })
    .join('');

  // A small mock of the Home view: what the app actually shows, not a generic dashboard.
  const card = (y, dot, title, sub) =>
    `<g transform="translate(24 ${y})"><rect width="368" height="54" rx="10" fill="${t.panel2}" stroke="${t.border}"/><circle cx="22" cy="27" r="5" fill="${dot}"/><text x="40" y="23" font-size="14" font-weight="600" fill="${t.text}">${esc(title)}</text><text x="40" y="41" font-size="12" fill="${t.muted}">${esc(sub)}</text></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc" font-family="${font}">
  <title id="title">DevPanel</title>
  <desc id="desc">Lo que un desarrollador abre todos los días, en un solo panel. App de Windows con GitHub, proyectos locales, herramientas y Claude Code.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${t.grid}"/></pattern>
    <radialGradient id="glow" cx="0.78" cy="0.45" r="0.5"><stop offset="0" stop-color="${t.glow}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="warm" cx="0.12" cy="0.2" r="0.35"><stop offset="0" stop-color="${t.warm}" stop-opacity="0.16"/><stop offset="1" stop-color="${t.warm}" stop-opacity="0"/></radialGradient>
    <linearGradient id="word" x1="0" x2="1"><stop offset="0" stop-color="${t.text}"/><stop offset="1" stop-color="${t.accent}"/></linearGradient>
    <clipPath id="iconClip"><rect width="88" height="88" rx="20"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.28"/></filter>
  </defs>
  <style>
    .cursor { animation: blink 1.1s steps(1) infinite; }
    .pulse { animation: pulse 2.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes pulse { 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .cursor, .pulse { animation: none; } }
  </style>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>

  <g transform="translate(96 64)">
    <g clip-path="url(#iconClip)"><image href="${icon}" width="88" height="88"/></g>
    <text x="112" y="62" font-size="64" font-weight="700" letter-spacing="-1.5" fill="url(#word)">DevPanel</text>
  </g>
  <text x="96" y="208" font-size="26" font-weight="600" fill="${t.text}">Lo que un desarrollador abre todos los días,</text>
  <text x="96" y="242" font-size="26" font-weight="600" fill="${t.text}">en un solo panel.</text>
  <text x="96" y="276" font-size="15" fill="${t.muted}" font-family="${mono}"><tspan fill="${t.accent}">&gt;_</tspan> Electron · TypeScript · Python · Windows<tspan class="cursor" fill="${t.accent}"> ▍</tspan></text>
  ${chipSvg}

  <g transform="translate(800 58)" filter="url(#shadow)">
    <rect width="416" height="304" rx="16" fill="${t.panel}" stroke="${t.border}"/>
    <path d="M0 16a16 16 0 0 1 16-16h384a16 16 0 0 1 16 16v24H0z" fill="${t.panel2}"/>
    <circle cx="22" cy="20" r="5" fill="${t.bad}" opacity="0.8"/><circle cx="40" cy="20" r="5" fill="${t.warm}" opacity="0.8"/><circle cx="58" cy="20" r="5" fill="${t.ok}" opacity="0.8"/>
    <text x="208" y="25" text-anchor="middle" font-size="12" fill="${t.muted}">Inicio</text>
    <rect x="300" y="11" width="96" height="18" rx="5" fill="${t.bg}" stroke="${t.border}"/><text x="348" y="24" text-anchor="middle" font-size="10" fill="${t.muted}" font-family="${mono}">Ctrl + K</text>
    <g class="pulse">${card(52, t.bad, 'Build fallando · tienda-web', 'CI · hace 4 min · ver el log sin salir')}</g>
    ${card(114, t.accent, '3 pull requests esperan revisión', 'api-pagos · tienda-web · docs')}
    ${card(176, t.warm, 'Task Pro · 5 por hacer, 2 en curso', '1 vencida · filtrado por proyecto')}
    ${card(238, t.ok, 'Local · main al día', '2 archivos cambiados · npm run dev')}
  </g>
</svg>
`;
}

// Small line icons, 24×24, drawn with the current stroke.
const glyphs = {
  tasks: 'M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h6',
  repo: 'M6 3h11a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h4',
  local: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 13l2 2-2 2M13 17h3',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  palette: 'M4 5h16v14H4zM8 10l2 2-2 2M12 14h4',
  face: 'M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3M9 10v1M15 10v1M9.5 15.5a3.5 3.5 0 0 0 5 0',
};

function features(t) {
  const items = [
    ['tasks', 'Task Pro', 'Tablero de tareas por proyecto,', 'con prioridad y vencimientos.'],
    ['repo', 'Proyectos de GitHub', 'Repos, commits, Actions y PR,', 'con alertas cuando falla un build.'],
    ['local', 'Proyectos locales', 'Rama, cambios, fetch, pull y', 'scripts de npm en una terminal.'],
    ['tools', 'Herramientas', 'JSON, Base64, JWT, hash, UUID,', 'regex y fechas. Todo local.'],
    ['palette', 'Paleta de comandos', 'Ctrl + K para ir a cualquier', 'vista, herramienta o proyecto.'],
    ['face', 'Login facial', 'Huella cifrada con DPAPI, nunca', 'fotos. Código de 4 dígitos.'],
  ];
  const W = 1280;
  const cw = 384;
  const ch = 132;
  const gap = 24;
  const ox = (W - (cw * 3 + gap * 2)) / 2;
  const H = 32 + ch * 2 + gap + 32;
  const cells = items
    .map(([g, title, l1, l2], i) => {
      const x = ox + (i % 3) * (cw + gap);
      const y = 32 + Math.floor(i / 3) * (ch + gap);
      const tone = i % 2 ? t.warm : t.accent;
      return `<g transform="translate(${x} ${y})">
    <rect width="${cw}" height="${ch}" rx="14" fill="${t.panel}" stroke="${t.border}"/>
    <rect x="24" y="24" width="44" height="44" rx="11" fill="${tone}" fill-opacity="0.13"/>
    <g transform="translate(34 34)" fill="none" stroke="${tone}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${glyphs[g]}" transform="scale(1)"/></g>
    <text x="84" y="53" font-size="19" font-weight="650" fill="${t.text}">${esc(title)}</text>
    <text x="24" y="96" font-size="14.5" fill="${t.muted}">${esc(l1)}</text>
    <text x="24" y="116" font-size="14.5" fill="${t.muted}">${esc(l2)}</text>
  </g>`;
    })
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc" font-family="${font}">
  <title id="title">Qué incluye DevPanel</title>
  <desc id="desc">${items.map((i) => `${i[1]}: ${i[2]} ${i[3]}`).join(' ')}</desc>
  <rect width="${W}" height="${H}" rx="18" fill="${t.bg}"/>
  ${cells}
</svg>
`;
}

for (const [name, t] of Object.entries(themes)) {
  writeFileSync(join(here, `banner-${name}.svg`), banner(t));
  writeFileSync(join(here, `features-${name}.svg`), features(t));
}
console.log('readme/: banner and features, dark and light');
