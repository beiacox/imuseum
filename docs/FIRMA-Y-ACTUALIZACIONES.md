# Firma de código y actualizaciones automáticas

## Actualizaciones automáticas

La app usa [electron-updater](https://www.electron.build/auto-update) con las Releases de
GitHub (`build.publish` en `package.json`).

- Al arrancar (si **Ajustes → Escaneo y actualizaciones → Buscar actualizaciones al iniciar**
  está activo) consulta la última versión publicada. En la pantalla de inicio también está
  el enlace «buscar actualizaciones».
- **AppImage, Windows y macOS**: «Descargar e instalar» baja la versión nueva y «Reiniciar e
  instalar» la aplica.
- **.deb**: la actualiza el sistema; la app solo avisa y abre la página de descargas.
- Para que una versión pueda actualizarse, su Release debe incluir los archivos que genera
  electron-builder: `latest-linux.yml`, `latest.yml` (Windows), `latest-mac.yml`, los
  instaladores y sus `.blockmap`. El flujo de trabajo de abajo los sube automáticamente.
  (La v0.2.0 no los tiene: quien la use debe instalar la 0.3.0 a mano una vez.)

## Publicar una versión

1. Sube la versión en `package.json` (`"version": "0.3.1"`) y añádela a `CHANGELOG.md`.
2. Crea y sube la etiqueta:
   ```bash
   git tag v0.3.1
   ```
   ```bash
   git push origin v0.3.1
   ```
3. El flujo **Release** (`.github/workflows/release.yml`) compila Linux, Windows y macOS
   en GitHub Actions y deja todo en un **borrador** de release.
4. Revisa el borrador en GitHub y pulsa **Publish release**. A partir de ese momento las
   apps instaladas verán la actualización.

## Firma de código

Sin firma las apps funcionan, pero el sistema avisa al instalarlas:

| Sistema | Sin firma | Qué hace falta para firmar |
|---|---|---|
| Windows | SmartScreen muestra «Windows protegió su PC» (Más información → Ejecutar de todas formas) | Certificado de firma de código Authenticode (OV o EV) de una autoridad certificadora |
| macOS | Gatekeeper bloquea la app (clic derecho → Abrir); las actualizaciones automáticas no funcionan sin firma | Cuenta de Apple Developer (99 USD/año), certificado «Developer ID Application» y notarización |
| Linux | Sin avisos | Nada (opcionalmente, firmar el AppImage con GPG) |

### Configurar los secretos en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.

| Secreto | Para | Contenido |
|---|---|---|
| `CSC_LINK` | Windows y macOS | Certificado `.pfx`/`.p12` codificado en base64 (`base64 -w0 certificado.p12`) |
| `CSC_KEY_PASSWORD` | Windows y macOS | Contraseña del certificado |
| `APPLE_ID` | macOS | Correo de la cuenta de Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | Contraseña específica de app (appleid.apple.com) |
| `APPLE_TEAM_ID` | macOS | Identificador del equipo de Apple Developer |

Si los secretos no existen, el flujo compila sin firmar. Con ellos, electron-builder firma
los instaladores de Windows y firma y notariza la app de macOS automáticamente.
