# DevPanel

Escritorio (Windows) para tener tus proyectos de GitHub, herramientas de desarrollo y tu entorno en un solo panel.
Hecho con **Electron + TypeScript**, con un módulo en **Python** para el login facial.

La misma interfaz también corre en la **web** (solo para previsualizar durante el desarrollo).

---

## Ramas y releases (lo importante)

| Rama | Qué publica | Versión | Quién la recibe |
| --- | --- | --- | --- |
| `main` | **Release estable** | `v0.1.<n>` | Todos los usuarios |
| `developer` | **Release de desarrollo** (prerelease, cambios adelantados) | `v0.1.<n>-dev` | Solo `DevCat-HGS` |

Flujo de trabajo:

1. Se trabaja y se hace push en **`developer`** → GitHub Actions publica un prerelease `-dev`.
2. Cuando `developer` está probado, se hace merge a **`main`** → se publica la release estable.

Cómo se mantienen separados los canales:

- El sufijo `-dev` en la versión es lo que los separa. `electron-updater` solo ofrece prereleases a apps que ya son `-dev`.
- El instalador usa `releases/latest` de GitHub, que **nunca** apunta a un prerelease. Por eso instala siempre la estable.
- La app `-dev` solo sigue prereleases si la cuenta de GitHub vinculada es `DevCat-HGS`. Cualquier otra cuenta se queda en estables.
- El instalador solo muestra la opción de canal "Desarrollo" cuando la cuenta vinculada es `DevCat-HGS`.

> **Límite honesto:** el repo es público, así que cualquiera que sepa la URL puede descargar un prerelease a mano.
> Lo anterior controla qué **reciben y se actualizan** las apps, no quién puede descargar el archivo.
> Para un bloqueo real habría que pasar los prereleases a un repo privado (o usar la imagen Docker `:dev`, que en GHCR es privada por defecto).

## Instalar

Descarga **`DevPanel-Installer.exe`** desde la release [`installer`](../../releases/tag/installer).
Es un instalador propio que:

1. Descarga la última versión y verifica su suma SHA-256.
2. Te pide tu **usuario o enlace de GitHub**, y el **código de verificación** que tú eliges (4 dígitos).
3. Instala (con opción de carpeta y accesos directos; la descarga se puede cancelar).
4. Te deja **activar el reconocimiento facial** (opcional).

Al abrir la app, la primera vez no hay que repetir nada. Después, la app pide tu rostro o tu código y entras al panel.

**Requisitos del login facial:** Python 3 en el PATH (el instalador instala OpenCV con `pip` si falta).
La app guarda solo una huella numérica de tu rostro, cifrada con el sistema (DPAPI), nunca fotos.
No detecta si te muestran una foto, así que el código existe como respaldo y no como seguridad fuerte.

## Qué incluye

- **Proyectos:** repos, commits, estado de Actions, favoritos, orden y búsqueda.
- **Recomendaciones:** detecta repos sin descripción, licencia o topics, inactivos o con muchos issues.
- **Herramientas:** JSON, Base64, URL, hash (SHA), UUID, JWT, fecha/Unix y regex. Todo local.
- **Entorno:** detecta qué tienes instalado (Git, Node, Python, OpenCV, Docker, VS Code, Flutter).
- **Paleta de comandos:** `Ctrl + K` para ir a cualquier vista, herramienta o proyecto.
- Tema claro/oscuro y auto-update.

## Desarrollo

```bash
npm install
npm start              # compila y abre la app de escritorio
npm run serve:web      # vista previa web en el navegador
```

`npm start` ya limpia `ELECTRON_RUN_AS_NODE` (los terminales de VS Code lo exportan y sin eso Electron no abre ventana).

### Pruebas

```bash
npm test               # unit tests (herramientas y recomendaciones)
npm run test:e2e       # maneja la app real con Playwright (necesita red)
npm run test:installer # recorre las pantallas del instalador (no instala nada)
```

Las pruebas e2e usan un perfil temporal (`DEVPANEL_USER_DATA`), así que no tocan tus datos reales.
En GitHub, [`ci.yml`](.github/workflows/ci.yml) corre typecheck + unit tests y el e2e en Windows.

### Estructura

```text
src/main/        proceso principal (GitHub, updater, rostro, entorno)
src/preload/     puente seguro hacia la interfaz
src/renderer/    interfaz (HTML + TS, sin framework)
python/          módulo de reconocimiento facial (OpenCV YuNet + SFace)
installer/       instalador propio (Electron aparte)
tests/           unit + e2e
docker/          nginx para la imagen web
```

## Workflows

| Archivo | Cuándo | Qué hace |
| --- | --- | --- |
| `release.yml` | push a `main` / `developer` | Compila el instalador de la app y publica la release (estable o `-dev`) |
| `installer.yml` | cambios en `installer/` | Compila `DevPanel-Installer.exe` y lo sube a la release `installer` |
| `ci.yml` | PR y push a `developer` | Typecheck, unit tests y e2e |
| `docker.yml` | cambios en la interfaz | Publica la imagen web en GHCR (`:latest` desde `main`, `:dev` desde `developer`) |

## Web y Docker (solo desarrollo)

La versión web no tiene login facial ni auto-update. Sirve para previsualizar cambios rápido.

- **Netlify:** `main` es la rama de producción y `developer` genera un *branch deploy* de vista previa (ver [`netlify.toml`](netlify.toml)).
- **Docker:** `docker compose up --build` y abre `http://localhost:8080`.
  La imagen se publica en `ghcr.io/devcat-hgs/devpanel-web` (`:dev` desde `developer`, `:latest` desde `main`).

## Recomendaciones para seguir

- **Firma de código:** los `.exe` no están firmados, así que Windows SmartScreen avisará. Un certificado de firma lo elimina.
- **Protege `main`:** exige que pase el CI antes de hacer merge desde `developer`.
- **Repo privado para `-dev`:** si los prereleases deben ser realmente privados, muévelos a otro repo privado.
- **Python empaquetado:** hoy el login facial necesita Python instalado. Se puede empaquetar con PyInstaller para no depender de él.
- **Token de GitHub:** sin token, la API permite 60 peticiones por hora. Con muchos repos conviene un token (la app ya lo lee de `GITHUB_TOKEN`).
