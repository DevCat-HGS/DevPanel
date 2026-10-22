; Custom steps for the NSIS uninstaller that electron-builder generates (package.json → build.nsis.include).
;
; Uninstalling asks whether to keep the user's data:
;   Normal (No):    removes the app and keeps %APPDATA%\DevPanel, so a reinstall keeps the PIN, face, token and settings.
;   Complete (Yes): also removes that folder, the update cache and the installer's temp files.
;
; electron-builder runs this same uninstaller silently, with --updated, every time the app updates. That run must
; never ask or delete data, so everything here is skipped when ${isUpdated}.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Start with Windows points at the .exe that is going away, so it goes in both modes. Electron writes the value
    ; under the app's AppUserModelID; the other two names cover older builds.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.devcat.devpanel"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.DevPanel"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DevPanel"

    ; A silent uninstall (/S) is always the normal one: deleting data needs a person saying yes.
    IfSilent devpanel_keep_data
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "¿Quieres una desinstalación completa?$\r$\n$\r$\n\
Sí: borra también tus datos de DevPanel (configuración, código PIN, huella del rostro, token de GitHub, notas y modelos). No se puede deshacer.$\r$\n$\r$\n\
No: desinstalación normal. Se quita la app y se conservan tus datos para cuando la vuelvas a instalar." \
      /SD IDNO IDNO devpanel_keep_data
      RMDir /r "$APPDATA\DevPanel"
      RMDir /r "$LOCALAPPDATA\devpanel-updater"
      RMDir /r "$TEMP\devpanel-installer"
    devpanel_keep_data:
  ${endIf}
!macroend
