# Firmar los ejecutables (Windows)

Los `.exe` de DevPanel (la app y el instalador) no están firmados por defecto, así que Windows SmartScreen
muestra "Editor desconocido". Firmarlos lo elimina, o lo reduce hasta que el certificado gana reputación.

## Opciones

| Opción | Costo aproximado | Notas |
| --- | --- | --- |
| **SignPath Foundation** | Gratis para proyectos de código abierto | El repo es público, así que puede calificar. Solicitud en signpath.org |
| **Azure Trusted Signing** | ~10 USD/mes | Sin hardware; requiere verificar identidad |
| **Certificado OV/EV** (DigiCert, Sectigo…) | 100–400 USD/año | EV quita SmartScreen de inmediato; suele exigir token USB |

## Activarlo con un certificado `.pfx`

El workflow ya está preparado: **no hay que cambiar código**, solo agregar dos secretos.

1. Convierte el certificado a base64:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx")) | Set-Clipboard
   ```
2. En GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   - `CSC_LINK` = el base64 del `.pfx`
   - `CSC_KEY_PASSWORD` = la contraseña del certificado
3. Haz push a `developer` o `main`. [`scripts/sign.cjs`](../scripts/sign.cjs) firma con `signtool.exe` (SHA-256 y sello de tiempo) la app, el instalador y los ejecutables de Python, y verifica cada firma. Solo actúa si `CSC_LINK` existe.

También puedes firmar a mano: `CSC_LINK=<base64 o ruta .pfx> CSC_KEY_PASSWORD=... node scripts/sign.cjs archivo.exe`. Con `SIGN_REQUIRED=1` falla si no hay certificado, y `SIGN_TIMESTAMP_URL` cambia el servidor de sello de tiempo.

Mientras no haya certificado, cada release muestra una advertencia "Unsigned build" en el log del workflow.

## Después de firmar

Cuando el certificado exista, conviene fijar el nombre del editor en `package.json` (`build.win.publisherName`).
Así el auto-actualizador verifica que cada actualización descargada esté firmada por ese editor y rechaza el resto.
