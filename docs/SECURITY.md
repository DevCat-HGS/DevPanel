# Seguridad

## Cómo se protege lo que ejecuta DevPanel

- **Aislamiento de la interfaz:** la ventana corre con `sandbox`, `contextIsolation` y sin `nodeIntegration`. Solo habla con el sistema a través de una API pequeña y fija.
- **Solo carpetas registradas:** toda acción sobre un proyecto local exige que lo hayas agregado tú. La interfaz nunca elige rutas arbitrarias.
- **Comandos de una lista cerrada:** DevPanel solo ejecuta `git`, el gestor del proyecto (`npm`, `pnpm`, `yarn`, `bun`, `deno`) con scripts que existen en el proyecto, y recetas fijas de Flutter y Firebase. Los nombres se validan y el texto del usuario nunca se convierte en sintaxis de shell.
- **Explorador de solo lectura:** rechaza rutas absolutas, `..` y enlaces que salgan de la carpeta del proyecto, y no muestra archivos binarios.
- **Protección contra fugas:** un commit con claves o archivos `.env` se rechaza antes de ejecutarse.
- **Secretos cifrados:** el token y los datos faciales se cifran con el sistema operativo.
- **Chat de Claude:** por defecto solo lectura; el modo edición aprueba cambios de archivos pero **nunca** omite todos los permisos.

## Cadena de suministro

El repositorio pasa por CodeQL, escaneo de secretos (gitleaks), Dependabot y pruebas automáticas (unitarias y de extremo a extremo) en cada cambio.

## Ejecutables sin firmar

Mientras no haya certificado de firma, Windows SmartScreen puede mostrar "Editor desconocido". Descarga DevPanel solo desde [GitHub Releases](https://github.com/DevCat-HGS/DevPanel/releases). Ver [SIGNING.md](SIGNING.md).

## Buenas prácticas para ti

- Usa un token de GitHub de **permisos mínimos** (solo lectura) y con vencimiento.
- No registres carpetas que no reconoces: sus scripts los ejecutas tú.
- Mantén DevPanel actualizado.

## Reportar una vulnerabilidad

Abre un aviso privado en la pestaña **Security → Report a vulnerability** del repositorio, o contacta a `DevCat-HGS` en GitHub. Por favor no publiques los detalles hasta que haya una corrección.
