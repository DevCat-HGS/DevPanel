# Privacidad

DevPanel funciona en tu equipo. **No tiene servidores propios, no usa cuentas propias y no envía telemetría ni analíticas.**

## Qué guarda, y dónde

Todo se guarda en la carpeta de datos de la app en tu equipo (`%APPDATA%\DevPanel`). Nada de esto sale de tu máquina por iniciativa de DevPanel.

| Dato | Cómo se guarda |
| --- | --- |
| Tu usuario de GitHub (público) | Texto en los ajustes |
| Token de GitHub (opcional) | Cifrado con el sistema (DPAPI de Windows). Solo se envía a `api.github.com` |
| PIN de acceso | Solo un hash con sal (scrypt), nunca el PIN |
| Rostro (opcional) | Solo vectores numéricos (embeddings), **sin imágenes**, cifrados con el sistema. Se procesan localmente con Python |
| Notas, favoritos, idioma, tema | Texto local en los ajustes |
| Carpetas de proyectos locales que registras | Solo sus rutas, en los ajustes |

## Con quién se comunica

- **GitHub** (`api.github.com`): lista tus repositorios, commits, pull requests, issues y ejecuciones de Actions. Con un token también los privados. Es la única API a la que se conecta la app para tus datos.
- **GitHub Releases**: para actualizarse y para descargar el instalador.
- **winget** (Windows): cuando instalas software del catálogo, lo hace el propio winget con identificadores fijos del catálogo.
- **Claude Code (opcional)**: si usas el chat de Claude, DevPanel ejecuta el programa `claude` que tú instalaste, dentro de la carpeta del proyecto. Tu mensaje y, en el primer mensaje de una conversación, un resumen breve de salud y diagnóstico del proyecto (puntaje y problemas detectados, **sin contenido de archivos**) los recibe Claude Code, y se rigen por las condiciones de tu cuenta de Anthropic.

## Lo que DevPanel lee de tus proyectos locales

Solo carpetas que tú registras. Lee nombres de archivos, `package.json`, `pubspec.yaml`, el estado de git y, en el explorador, los archivos que tú abres o buscas (solo lectura). Busca posibles secretos y **muestra el archivo, la línea y el tipo de regla, nunca el valor**. Esa información se queda en tu equipo.

## Cámara

Solo se usa al registrar o verificar tu rostro. El acceso con rostro es opcional: también puedes entrar con tu PIN. No se guardan fotos ni video.

## Tu control

- Puedes borrar el token y los datos de acceso (PIN y rostro) desde la app.
- Desinstalar DevPanel y borrar su carpeta de datos elimina todo lo guardado.
- Puedes revocar el token de GitHub en tu cuenta de GitHub cuando quieras.

*Este documento es informativo y describe el funcionamiento técnico; no sustituye asesoría legal. Si distribuyes DevPanel en una organización, revísalo con tu responsable de cumplimiento.*
