; Nur für die Messung in release.yml (#517): wie installer.nsh, aber mit der Prüfung auf ein laufendes Mietfuchs aus
; der Vorlage von electron-builder (PowerShell). Gebaut mit -c.nsis.include=build/installer-vorlage.nsh.
!define MF_CHECK_TEMPLATE
!include "${__FILEDIR__}\installer.nsh"
