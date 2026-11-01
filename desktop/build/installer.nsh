; Eigene Teile des Windows-Installers (#517), eingebunden über `nsis.include` in desktop/package.json. electron-builder
; setzt diese Datei in den Kopf des Skripts, vor seine Vorlagen (app-builder-lib/templates/nsis); die Haken
; (customInit, customCheckAppRunning …) fügen die Vorlagen an ihrer Stelle ein. Der Kopf ist für beide Durchläufe
; derselbe: einmal mit BUILD_UNINSTALLER für das Deinstallationsprogramm (nur un.-Code), einmal für den Installer.
;
; 1. Zeitprotokoll: Jeder Lauf von Installer und Deinstallationsprogramm schreibt Zeitstempel (Ortszeit mit
;    Millisekunden und Sekunden seit dem Start) nach %TEMP%\mietfuchs-installation.log. Ein paar Zeilen je Lauf,
;    angehängt; daran lässt sich auf dem Rechner eines Nutzers ablesen, welcher Schritt dauert.
; 2. Prüfung auf ein laufendes Mietfuchs ohne PowerShell (customCheckAppRunning), siehe unten.

!include LogicLib.nsh
!include x64.nsh

!define MF_LOG "$TEMP\mietfuchs-installation.log"
; Ordner dieser Datei, für Dateien, die ein Haken erst beim Einfügen einbindet
!define MF_DIR "${__FILEDIR__}"

; Funktionen gibt es je Durchlauf nur einmal: im Deinstallationsprogramm mit dem Vorsatz un., sonst ohne. Eine
; Funktion, die im Durchlauf niemand aufruft, wäre eine Warnung und bräche den Bau ab (warningsAsErrors).
!ifdef BUILD_UNINSTALLER
  !define MF_UN "un."
  !define MF_RUN "Deinstallation"
!else
  !define MF_UN ""
  !define MF_RUN "Installation"
!endif

; GetTickCount beim ersten Eintrag dieses Prozesses
Var mfTick

; SYSTEMTIME an der Adresse oben auf dem Stapel → "JJJJ-MM-TT hh:mm:ss.mmm" oben auf dem Stapel
Function ${MF_UN}mfSysTime
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  System::Call '*$0(&i2.r1, &i2.r2, &i2, &i2.r3, &i2.r4, &i2.r5, &i2.r6, &i2.r7)'
  IntFmt $2 "%02u" $2
  IntFmt $3 "%02u" $3
  IntFmt $4 "%02u" $4
  IntFmt $5 "%02u" $5
  IntFmt $6 "%02u" $6
  IntFmt $7 "%03u" $7
  StrCpy $0 "$1-$2-$3 $4:$5:$6.$7"
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; Hängt die Zeile oben auf dem Stapel ans Protokoll: Ortszeit, Sekunden seit dem ersten Eintrag, Lauf, Text.
; UTF-16 mit BOM, damit der Editor die Umlaute richtig zeigt. Ein Fehler beim Schreiben bleibt folgenlos.
Function ${MF_UN}mfWriteLine
  Exch $9
  Push $0
  Push $1
  Push $2
  Push $3
  System::Call 'kernel32::GetTickCount() i.r0'
  ${If} $mfTick == ""
    StrCpy $mfTick $0
  ${EndIf}
  IntOp $0 $0 - $mfTick
  IntOp $1 $0 % 1000
  IntOp $1 $1 / 100
  IntOp $0 $0 / 1000
  StrCpy $2 "+$0.$1 s"
  System::Alloc 16
  Pop $0
  System::Call 'kernel32::GetLocalTime(p r0)'
  Push $0
  Call ${MF_UN}mfSysTime
  Pop $1
  System::Free $0
  ClearErrors
  FileOpen $0 "${MF_LOG}" a
  ${IfNot} ${Errors}
    FileSeek $0 0 END $3
    ${If} $3 == 0
      FileWriteWord $0 0xFEFF
    ${EndIf}
    FileWriteUTF16LE $0 "$1  $2  ${MF_RUN}  $9$\r$\n"
    FileClose $0
  ${EndIf}
  ClearErrors
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $9
FunctionEnd

!macro mfLog TEXT
  Push "${TEXT}"
  Call ${MF_UN}mfWriteLine
!macroend

!ifndef BUILD_UNINSTALLER
  ; Schreibt, wann eine Datei (oder ein Ordner) angelegt und zuletzt geschrieben wurde, und ihre Größe. So lässt sich
  ; ein Schritt der Vorlage zerlegen, für den es keinen Haken gibt, etwa das Schreiben des Pakets nach $PLUGINSDIR.
  ; Aufruf: Push "Bezeichnung", Push "Pfad", Call mfFileStamp
  Function mfFileStamp
    Exch $1
    Exch
    Exch $2
    Push $0
    Push $3
    Push $4
    Push $5
    Push $6
    ; WIN32_FILE_ATTRIBUTE_DATA: Attribute, Anlage (ab 4), letzter Zugriff (ab 12), letzter Schreibzugriff (ab 20),
    ; Größe hoch und niedrig (ab 28)
    System::Alloc 36
    Pop $0
    System::Call 'kernel32::GetFileAttributesExW(w r1, i 0, p r0) i.r3'
    ${If} $3 == 0
      Push "[datei] $2: nicht vorhanden ($1)"
    ${Else}
      System::Alloc 8
      Pop $4
      System::Alloc 16
      Pop $5
      IntOp $3 $0 + 4
      System::Call 'kernel32::FileTimeToLocalFileTime(p r3, p r4)'
      System::Call 'kernel32::FileTimeToSystemTime(p r4, p r5)'
      Push $5
      Call mfSysTime
      Pop $6
      IntOp $3 $0 + 20
      System::Call 'kernel32::FileTimeToLocalFileTime(p r3, p r4)'
      System::Call 'kernel32::FileTimeToSystemTime(p r4, p r5)'
      Push $5
      Call mfSysTime
      Pop $3
      System::Free $4
      System::Free $5
      System::Call '*$0(i, i, i, i, i, i, i, i, i.r4)'
      IntOp $4 $4 / 1048576
      Push "[datei] $2: angelegt $6, zuletzt geschrieben $3, $4 MB ($1)"
    ${EndIf}
    System::Free $0
    Call mfWriteLine
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $0
    Pop $2
    Pop $1
  FunctionEnd

  !macro mfLogFile LABEL PATH
    Push "${LABEL}"
    Push "${PATH}"
    Call mfFileStamp
  !macroend

  ; .onInit, nach der Sperre gegen einen zweiten Installer
  !macro customInit
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" DisplayVersion
    ReadRegStr $1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" CurrentBuild
    ${If} ${IsNativeARM64}
      StrCpy $2 "ARM64"
    ${Else}
      StrCpy $2 "x64"
    ${EndIf}
    !insertmacro mfLog "[start] Mietfuchs ${VERSION}, Windows $0 (Build $1, $2), Aufruf: $CMDLINE"
    Pop $2
    Pop $1
    Pop $0
  !macroend

  ; Nach dem Aufruf des Deinstallationsprogramms der vorigen Fassung (uninstallOldVersion), vor dem Auspacken. Ersetzt
  ; die Auswertung der Vorlage (handleUninstallResult), deshalb steht sie hier gleichlautend.
  !macro customUnInstallCheck
    ${If} ${Errors}
      !insertmacro mfLog "[alte-fassung] Deinstallationsprogramm der vorigen Fassung nicht startbar"
      DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    ${ElseIf} $R0 != 0
      !insertmacro mfLog "[alte-fassung] Deinstallation der vorigen Fassung fehlgeschlagen (Code $R0)"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      SetErrorLevel 2
      Quit
    ${Else}
      !insertmacro mfLog "[alte-fassung] Vorige Fassung entfernt (falls vorhanden)"
    ${EndIf}
    !ifndef MF_CHECK_TEMPLATE
      !insertmacro mfSkipInstallerCopy
    !endif
  !macroend

  ; Keine Kopie des Installers nach %LOCALAPPDATA%\mietfuchs-updater\installer.exe. installApplicationFiles (Vorlage
  ; include/installer.nsh) kopiert nach dem Auspacken den ganzen Installer dorthin (rund 230 MB, eine neue .exe, die
  ; der Echtzeitschutz vollständig prüft), als Grundlage für Teil-Downloads von electron-updater. Das Fenster hat
  ; keinen electron-updater, und das Deinstallationsprogramm räumt die Kopie nie weg. Deshalb fasst
  ; installer-copyfile.nsh copyFile neu. Das geht nur zwischen dem Einbinden von installUtil.nsh (dort steht copyFile)
  ; und dem Einfügen von installApplicationFiles; dieser Haken liegt dazwischen. Ein Makro kann kein Makro
  ; definieren, deshalb die eigene Datei.
  !macro mfSkipInstallerCopy
    !include "${MF_DIR}\installer-copyfile.nsh"
  !macroend

  ; Nach dem Auspacken (extractEmbeddedAppPackage: Paket nach $PLUGINSDIR schreiben, mit 7-Zip nach
  ; $PLUGINSDIR\7z-out auspacken, nach $INSTDIR kopieren). electron-builder legt diese Haken selbst nur für
  ; vorkomprimierte Dateien an (Videos u. Ä.), die das Fenster nicht hat; käme eine dazu, bräche der Bau laut ab.
  !macro mfAfterExtract ARCH
    !insertmacro mfLogFile "Paket" "$PLUGINSDIR\app-${ARCH}.7z"
    !insertmacro mfLogFile "Ausgepackt" "$PLUGINSDIR\7z-out"
    !insertmacro mfLogFile "Programm" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro mfLog "[ausgepackt] Programmdateien ausgepackt und kopiert"
  !macroend
  !macro customFiles_x64
    !insertmacro mfAfterExtract 64
  !macroend
  !macro customFiles_arm64
    !insertmacro mfAfterExtract arm64
  !macroend

  ; Am Ende der Installation: danach startet der Installer nur noch das Programm (nicht bei /S)
  !macro customInstall
    !insertmacro mfLogFile "Kopie des Installers" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !insertmacro mfLogFile "Deinstallationsprogramm" "$INSTDIR\${UNINSTALL_FILENAME}"
    !insertmacro mfLog "[ende] Installation abgeschlossen"
  !macroend
!else
  ; un.onInit, nach der Prüfung auf ein laufendes Programm
  !macro customUnInit
    !insertmacro mfLog "[init] Aufruf: $CMDLINE"
  !macroend

  ; Abschnitt der Deinstallation, vor dem Entfernen der Dateien
  !macro customUnInstall
    !insertmacro mfLog "[entfernen] Entfernen der Dateien beginnt"
    ; Die Kopie des Installers, die Fassungen bis 0.14 dort hinterlassen haben (siehe mfSkipInstallerCopy); beim
    ; Aktualisieren räumt sie der neue Installer weg
    !ifndef MF_CHECK_TEMPLATE
      ${IfNot} ${isUpdated}
        Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
        RMDir "$LOCALAPPDATA\mietfuchs-updater"
      ${EndIf}
    !endif
  !macroend

  ; Nach dem Entfernen der Dateien und Verknüpfungen, vor den Registry-Einträgen. electron-builder legt diesen Haken
  ; nur für Dateizuordnungen an (fileAssociations), die das Fenster nicht hat; käme eine dazu, bräche der Bau laut ab.
  !macro unregisterFileAssociations
    ; RMDir /r der Vorlage übergeht eine Datei, die gerade jemand offen hält, still: Gleich nach einer Installation
    ; liest oft noch ein Dienst die neue Mietfuchs.exe (in der CI blieb sie so liegen). Einige Male nachfassen.
    !ifndef MF_CHECK_TEMPLATE
      StrCpy $R1 0
      ${DoWhile} ${FileExists} "$INSTDIR\*.*"
        ${If} $R1 >= 10
          !insertmacro mfLog "[entfernen] $INSTDIR ließ sich nicht vollständig entfernen"
          ${Break}
        ${EndIf}
        IntOp $R1 $R1 + 1
        Sleep 1000
        RMDir /r $INSTDIR
      ${Loop}
      ${If} $R1 > 0
      ${AndIfNot} ${FileExists} "$INSTDIR\*.*"
        !insertmacro mfLog "[entfernen] $INSTDIR nach $R1 weiteren Versuchen entfernt"
      ${EndIf}
    !endif
    !insertmacro mfLog "[ende] Dateien und Verknüpfungen entfernt"
  !macroend
!endif

; Prüfung auf ein laufendes Mietfuchs, vor dem Installieren und beim Deinstallieren (CHECK_APP_RUNNING in
; allowOnlyOneInstallerInstance.nsh). Die Vorlage startet dafür bis zu dreimal PowerShell (Get-CimInstance); ein
; kalter Start von PowerShell kostet mit dem Echtzeitschutz von Windows Defender Sekunden. Hier stattdessen tasklist,
; gefiltert auf Mietfuchs.exe und den angemeldeten Benutzer, wie der Ausweichweg der Vorlage; Ablauf wie dort: läuft
; Mietfuchs, fragen (still: ohne Frage), freundlich beenden, notfalls hart, und wenn auch das nicht geht, bitten, es
; selbst zu schließen.
;
; MF_CHECK_TEMPLATE (nur für die Messung in release.yml, installer-vorlage.nsh) behält den Weg der Vorlage und
; misst ihn nur.
!ifdef MF_CHECK_TEMPLATE
  !include "getProcessInfo.nsh"
  Var pid

  !macro customCheckAppRunning
    !insertmacro mfLog "[pruefung-beginn] Prüfung auf laufendes Mietfuchs beginnt (PowerShell, Vorlage)"
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
    !insertmacro mfLog "[pruefung-ende] Prüfung auf laufendes Mietfuchs beendet"
  !macroend
!else
  ; $R0 = 0, wenn Mietfuchs.exe für diesen Benutzer läuft (Rückgabe von findstr)
  !macro mfFindApp
    nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0
  !macroend

  ; FORCE: "" oder "/F"
  !macro mfKillApp FORCE
    nsExec::Exec `"$CmdPath" /C taskkill ${FORCE} /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $R0
  !macroend

  !macro customCheckAppRunning
    !insertmacro mfLog "[pruefung-beginn] Prüfung auf laufendes Mietfuchs beginnt"
    ; Heißt der Installer selbst wie das Programm (Aktualisierung aus dem Programm heraus), prüft die Vorlage nicht
    ${If} $EXEFILE != "${APP_EXECUTABLE_FILENAME}"
      ${If} ${isUpdated}
        ; dem Programm Zeit geben, sich selbst zu beenden
        Sleep 300
      ${EndIf}
      !insertmacro mfFindApp
      ${If} $R0 == 0
        !insertmacro mfLog "[pruefung] Mietfuchs läuft noch"
        ${If} ${isUpdated}
          Sleep 1000
        ${ElseIf} $LANGUAGE == 1031
          MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Mietfuchs ist noch geöffnet.$\nKlicken Sie auf »OK«, um es zu schließen und fortzufahren." /SD IDOK IDOK mfStopApp
          Quit
        ${Else}
          MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK mfStopApp
          Quit
        ${EndIf}
        mfStopApp:
        DetailPrint "$(appClosing)"
        ; freundlich: schließt die Fenster, Mietfuchs beendet dabei seinen Server
        !insertmacro mfKillApp ""
        Sleep 300
        StrCpy $R1 0
        mfCheckAgain:
          IntOp $R1 $R1 + 1
          !insertmacro mfFindApp
          ${If} $R0 == 0
            Sleep 1000
            !insertmacro mfKillApp "/F"
            !insertmacro mfFindApp
            ${If} $R0 == 0
              DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
              Sleep 2000
              ${If} $R1 > 1
                ${If} $LANGUAGE == 1031
                  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Mietfuchs lässt sich nicht schließen.$\nBitte schließen Sie es selbst und klicken Sie dann auf »Wiederholen«." /SD IDCANCEL IDRETRY mfCheckAgain
                ${Else}
                  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY mfCheckAgain
                ${EndIf}
                !insertmacro mfLog "[pruefung-ende] Mietfuchs ließ sich nicht schließen, abgebrochen"
                Quit
              ${EndIf}
              Goto mfCheckAgain
            ${EndIf}
          ${EndIf}
        !insertmacro mfLog "[pruefung] Mietfuchs geschlossen"
      ${EndIf}
    ${EndIf}
    !insertmacro mfLog "[pruefung-ende] Prüfung auf laufendes Mietfuchs beendet"
  !macroend
!endif
