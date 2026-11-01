; Eingebunden von mfSkipInstallerCopy in installer.nsh (#517), siehe dort. copyFile wie in der Vorlage
; (app-builder-lib/templates/nsis/include/installUtil.nsh), nur für die Kopie des Installers nach
; %LOCALAPPDATA%\mietfuchs-updater: Statt zu kopieren, wird eine Kopie früherer Installationen gelöscht. Benennt die
; Vorlage copyFile um, bricht der Bau an !macroundef laut ab.
!macroundef copyFile
!macro copyFile FROM TO
  !if "${TO}" == "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    Delete `${TO}`
    ${StdUtils.GetParentPath} $R5 `${TO}`
    RMDir `$R5`
  !else
    ${StdUtils.GetParentPath} $R5 `${TO}`
    CreateDirectory `$R5`
    ClearErrors
    CopyFiles /SILENT `${FROM}` `${TO}`
  !endif
!macroend
