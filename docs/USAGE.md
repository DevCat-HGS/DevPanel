# Guía de uso

DevPanel es un panel para que los desarrolladores trabajen y automaticen tareas **sin salir de la app** (ver [VISION.md](VISION.md)).

| Sección | Para qué sirve |
| --- | --- |
| **Inicio** | **Task Pro** (tareas por proyecto con prioridad y fecha límite) y paneles plegables: builds fallando (abre Actions), pull requests (abre la pestaña del repo), cambios locales, salud de proyectos y actividad reciente |
| **Projects** | Tus repos de GitHub: commits, PRs, issues y Actions (con reintento de builds fallidos) y su puntaje de salud |
| **Local** | Carpetas de tu equipo: git (fetch, pull, push, commit, ramas), diagnóstico, scripts, salud, búsqueda de secretos y explorador de archivos |
| **Tools** | Catálogo de software, utilidades de desarrollo, notas y el chat de Claude Code |
| **Ajustes** | Usuario de GitHub, token, PIN, rostro, idioma, tema y actualizaciones |

## Proyectos locales

1. **Agregar carpeta** registra el proyecto (solo se tocan carpetas registradas).
2. **Diagnóstico** detecta el gestor (npm, pnpm, yarn, bun, deno), versiones, dependencias faltantes, desajustes de Node, y en Flutter el SDK, dispositivos y emuladores. Cada problema trae su arreglo de un clic.
3. **Salud** calcula un puntaje de 0 a 100 con git, README, licencia, tests, CI y más.
4. **Explorar archivos** abre un visor de solo lectura con árbol, números de línea y búsqueda de texto.
5. **Buscar secretos** revisa los archivos versionados sin mostrar nunca el valor.

## Canales de versión

`main` publica la versión estable; `developer` publica versiones `-dev` solo para cuentas autorizadas. Nadie elige el canal: lo decide la cuenta vinculada. Ver el [README](../README.md).

## Desinstalar

Al desinstalar eliges entre la desinstalación **normal**, que conserva tus datos para cuando reinstales, y la **completa**, que también borra tu configuración, PIN, rostro y token. Ver el [README](../README.md#desinstalar).

Privacidad: [PRIVACY.md](PRIVACY.md) · Seguridad: [SECURITY.md](SECURITY.md) · Términos: [TERMS.md](TERMS.md)
