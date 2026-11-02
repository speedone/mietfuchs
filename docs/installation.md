# Installation

Wie du Mietfuchs auf deinen Rechner bekommst, im Detail. Die Kurzfassung steht im [README](../README.md#herunterladen).

- [Windows: aus dem Microsoft Store](#windows-aus-dem-microsoft-store-empfohlen) oder [mit dem Installer](#windows-mit-dem-installer)
- [macOS](#macos)
- [Umzug von der bisherigen Programmdatei](#umzug-von-der-bisherigen-programmdatei)
- [Zugriff vom Handy oder einem zweiten Rechner](#zugriff-vom-handy-oder-einem-zweiten-rechner)
- [Download prüfen (für Fortgeschrittene)](#download-prüfen-für-fortgeschrittene)
- [Programmdatei ohne Installation](#bisherige-programmdatei-ohne-installation) (Windows, macOS, Linux)
- [Linux: Installationspaket mit Startmenü-Eintrag](#linux-installationspaket-mit-startmenü-eintrag)
- [Docker](docker.md)

## Installation unter Windows und macOS

Seit Version 0.15 ist Mietfuchs unter Windows und macOS ein eigenes Programm mit eigenem Fenster,
wie jedes andere auch: Symbol in Taskleiste bzw. Dock, Fenster schließen beendet Mietfuchs, und
die Abrechnung druckt überall gleich, mit Briefpapier und „Seite x von y“. Einen Browser brauchst
du dafür nicht.

| Dein Rechner | Was du lädst |
| --- | --- |
| Windows 10 oder 11 (auch ARM, z. B. Snapdragon) | [Microsoft Store](#windows-aus-dem-microsoft-store-empfohlen) (empfohlen) oder der [Installer](#windows-mit-dem-installer) `Mietfuchs-Setup-<Version>.exe` |
| Mac mit Apple-Chip (M1 und neuer) | [`Mietfuchs-<Version>-apple-silicon.dmg`](#macos) |
| Mac mit Intel-Prozessor | [`Mietfuchs-<Version>-intel.dmg`](#macos) |
| Linux, Raspberry Pi, Server ohne Bildschirm | [Programmdatei oder Paket](#bisherige-programmdatei-ohne-installation), [Docker](docker.md) |

Installer und Abbilder für den Mac liegen auf der
**[Release-Seite](https://github.com/speedone/mietfuchs/releases/latest)** unter *Assets*.
Welchen Mac du hast, steht im Apple-Menü unter *Über diesen Mac*: „Chip Apple M…“ oder
„Prozessor … Intel …“.

Hast du Mietfuchs schon als einzelne Programmdatei (`mietfuchs-win.exe` oder
`mietfuchs-macos-…`) benutzt, übernimmt das neue Programm deine Daten beim ersten Start, siehe
[Umzug von der bisherigen Programmdatei](#umzug-von-der-bisherigen-programmdatei).

### Windows: aus dem Microsoft Store (empfohlen)

[![Mietfuchs im Microsoft Store herunterladen](https://get.microsoft.com/images/de%20dark.svg)](https://apps.microsoft.com/detail/9PMHZ0ZJPZDZ?referrer=appbadge&mode=direct)

Unter Windows 10 (1809) und 11 ist der Microsoft Store der bequemste Weg, für Intel/AMD wie
für ARM-Rechner (z. B. Snapdragon), dort in einer eigenen ARM-Fassung:

- **Keine Sicherheitswarnung:** Microsoft prüft und signiert das Paket, der Hinweis „Der
  Computer wurde durch Windows geschützt“ entfällt.
- **Updates kommen von selbst:** Der Store installiert jede neue Version im Hintergrund, sobald
  Mietfuchs beendet ist (solange es läuft, ersetzt Windows es nicht). Sofort geht es im Store unter
  *Bibliothek* mit *Updates abrufen*. Eine neue Version erscheint im Store erst, wenn Microsoft
  sie geprüft hat, meist einige Tage nach dem Release hier. Zeigt der Store also noch eine Version
  vor 0.15, nimm bis dahin den Installer (dann aber nur ihn, siehe unten) oder arbeite mit der bisherigen
  Programmdatei weiter.
- **Wie jedes andere Programm:** Eintrag im Startmenü, eigenes Fenster, Start auch über
  `mietfuchs` in der Eingabeaufforderung. Fenster schließen beendet Mietfuchs.
- **Deine Daten liegen in `%USERPROFILE%\Mietfuchs`** (z. B. `C:\Users\Name\Mietfuchs`) und
  bleiben auch beim Deinstallieren erhalten. Backup = diesen Ordner kopieren.

### Windows: mit dem Installer

Ohne Store geht es mit dem Installer, einer Datei für Intel/AMD und ARM:

1. Auf der [Release-Seite](https://github.com/speedone/mietfuchs/releases/latest) unter *Assets*
   `Mietfuchs-Setup-<Version>.exe` laden.
   Hält dein Browser die Datei zurück, weil sie selten heruntergeladen wird, wähle in seiner
   Download-Liste, dass du sie behalten willst.
2. Die Datei per Doppelklick starten. Beim ersten Mal warnt Windows, weil die Datei nicht
   kostenpflichtig signiert ist: „Der Computer wurde durch Windows geschützt“ → *Weitere
   Informationen* → *Trotzdem ausführen*.
3. Der Installer fragt nichts weiter und braucht keine Administratorrechte. Er installiert
   Mietfuchs für dich, legt Einträge im Startmenü und auf dem Desktop an und startet es.

Deine Daten liegen wie bei der Store-Fassung in `%USERPROFILE%\Mietfuchs`. Nimm deshalb nur eine
der beiden Fassungen, Store oder Installer. Hast du beide installiert (etwa weil der Store noch eine
Version vor 0.15 zeigte), starte immer nur eine: Läuft die andere schon, startet Mietfuchs nicht und
sagt „Mietfuchs läuft bereits mit denselben Daten …“; beende dann zuerst die andere. Willst du
später zum Store wechseln, deinstalliere vorher die Fassung aus dem Installer; der Datenordner
bleibt dabei liegen.

**Updates:** Erlaubst du in den Einstellungen unter „Über Mietfuchs“ die Update-Prüfung, lädt
Mietfuchs eine neue Version selbst von GitHub (GitHub sieht dabei deine IP-Adresse und die
Versionsnummer). Ist sie geladen, meldet Mietfuchs „Version … ist bereit“, und du wählst *Beim
nächsten Start* oder *Jetzt neu starten*; ungefragt startet es nie neu. Vor dem Update sichert
Mietfuchs die Datenbank wie bei jedem Update. Ohne Update-Prüfung lädst du den neuen Installer
von der Release-Seite und startest ihn, er ersetzt die alte Version, deine Daten bleiben.

Ein Update lädt Mietfuchs nur, wenn dessen Beschreibung (`latest.yml` im Release) mit dem Schlüssel
von Mietfuchs unterschrieben ist (Ed25519); der passende Prüfschlüssel steckt im Programm. Fehlt die
Unterschrift oder passt sie nicht, lädt es nichts, und „Über Mietfuchs“ sagt, warum. Die Prüfsumme
der geladenen Datei prüft es danach zusätzlich. Damit bei einem Update nur die geänderten Teile
kommen, legt der Installer eine Kopie von sich unter `%LOCALAPPDATA%\mietfuchs-updater` ab (rund
230 MB); das Deinstallieren entfernt sie.

Deinstallieren geht wie bei jedem Programm unter *Einstellungen → Apps*. Der Datenordner bleibt
dabei liegen.

### macOS

Das neue Programm braucht **macOS 13 (Ventura) oder neuer**, so verlangt es Electron, auf dem es aufbaut. Die
[bisherige Programmdatei](#herunterladen--starten-ohne-installation) ist kein Ausweg für ältere Macs: Sie ist mit
Bun gebaut, und Bun läuft ebenfalls erst ab macOS 13. Auf einem älteren Mac lässt du Mietfuchs deshalb auf
einem anderen Gerät laufen und öffnest es im Browser des Macs, siehe
[Zugriff vom Handy oder einem zweiten Rechner](#zugriff-vom-handy-oder-einem-zweiten-rechner).

1. Auf der [Release-Seite](https://github.com/speedone/mietfuchs/releases/latest) unter *Assets*
   das Abbild für deinen Mac laden: `Mietfuchs-<Version>-apple-silicon.dmg` für Apple M1 und
   neuer, `Mietfuchs-<Version>-intel.dmg` für einen Mac mit Intel-Prozessor.
2. Das Abbild per Doppelklick öffnen und **Mietfuchs** auf den Ordner **Programme** ziehen.
3. Mietfuchs aus *Programme* starten. Beim ersten Mal blockiert macOS den Start, weil Mietfuchs
   nicht kostenpflichtig bei Apple signiert ist. So gibst du es einmalig frei:
   - Den Dialog mit *Fertig* schließen.
   - *Systemeinstellungen → Datenschutz & Sicherheit* öffnen, nach unten scrollen und bei der
     Meldung zu Mietfuchs auf *Dennoch öffnen* klicken, mit deinem Passwort bestätigen.
   - Fragt macOS danach noch einmal nach, auch dort *Dennoch öffnen* wählen.

   Seit macOS 15 geht das nur noch so; der frühere Weg mit Ctrl-Klick → *Öffnen* klappt dort
   nicht mehr. Wer das Terminal mag, nimmt stattdessen
   `xattr -dr com.apple.quarantine /Applications/Mietfuchs.app`.

   Startest du Mietfuchs direkt aus dem Abbild oder aus Downloads, bietet es einmal an, sich nach
   *Programme* zu verschieben.
4. Sucht Mietfuchs beim ersten Start deine bisherigen Daten, fragt macOS, ob es auf Downloads,
   Schreibtisch und Dokumente zugreifen darf. Erlaube es; die Daten verlassen deinen Mac nicht.

Deine Daten liegen in `~/Library/Application Support/Mietfuchs`. Backup = diesen Ordner kopieren;
im Menü *Mietfuchs → Datenordner zeigen* öffnet ihn der Finder.

**Updates:** Auf dem Mac aktualisiert sich Mietfuchs nicht von selbst, das ginge nur mit einer
kostenpflichtigen Signatur. Erlaubst du die Update-Prüfung, sagt Mietfuchs Bescheid, wenn es eine
neue Version gibt, und führt direkt zum passenden Abbild. Dann Mietfuchs beenden, das neue Abbild
laden, Mietfuchs wieder auf *Programme* ziehen und *Ersetzen* wählen. Den ersten Start gibst du wie oben noch einmal frei.
Deine Daten bleiben, wo sie sind.

### Umzug von der bisherigen Programmdatei

Bis Version 0.14 lief Mietfuchs unter Windows und macOS im Browser, als einzelne Programmdatei
oder aus dem Microsoft Store. Die Daten der Programmdatei liegen im Ordner `data/` neben der
Datei. Das neue Programm holt sie von selbst, auch das aus dem Microsoft Store:

1. Das neue Programm installieren, wie oben beschrieben.
2. Das alte Mietfuchs beenden, mit *Mietfuchs beenden* unten in der Seitenleiste oder indem du
   sein Konsolenfenster (auf dem Mac das Terminal) schließt. Vergisst du es, bietet das neue
   *Altes Mietfuchs beenden* an.
3. Das neue Mietfuchs starten. Findet es deine Daten, zeigt es „Wir haben Ihre bisherigen
   Mietfuchs-Daten gefunden“ mit Ort und letzter Änderung. Auf **Daten übernehmen** klicken.

Gesucht wird dort, wo die Programmdatei zuletzt lief (ab Version 0.14.1 merkt sie sich den Ort),
unter Windows auch in `%LOCALAPPDATA%\Mietfuchs` (dorthin legte die Programmdatei ihre Daten, wenn sie
neben sich nicht schreiben durfte), sonst in Downloads, Schreibtisch und Dokumente (auch in OneDrive). Findet Mietfuchs nichts, fragt es „Haben Sie
Mietfuchs schon einmal benutzt?“. Mit *Ja, Daten übernehmen* geht es auf einem von zwei Wegen
weiter:

- *Ordner der alten Programmdatei wählen …*, wenn du weißt, wo sie liegt.
- Über ein Backup: das alte Mietfuchs noch einmal starten, unter *Einstellungen* auf
  **Backup herunterladen (ZIP)** klicken (mit Haken bei „Verlauf der Änderungen mitsichern“,
  wenn du den Verlauf mitnehmen willst), dann im neuen auf **Backup einspielen** und die
  ZIP-Datei wählen. Schlüssel für einen KI-Dienst trägst du danach neu ein, und das alte
  Mietfuchs startest du nicht mehr, sonst entstehen zwei Bestände.

Übernommen wird als **Kopie**: Datenbank, Belege und Briefpapier. Mietfuchs vergleicht die Kopie
mit dem Original und schaltet erst dann um. Dein alter Ordner bleibt unverändert liegen. Beim Weg
über den Ordner zeigt die alte Programmdatei ihn danach nur noch zum Ansehen, damit es keine zwei
Bestände gibt. Später
geht die Übernahme jederzeit in den Einstellungen unter „Daten aus bisherigem Mietfuchs
übernehmen …“. Ändert jemand nach dem Umzug noch etwas im alten Mietfuchs, sagt das neue es dir
und bietet an, den neueren Stand zu übernehmen.

Automatische Vorversionen (`vorversionen/`) und die Sicherungen vor Updates
(`mietfuchs.sqlite.vor-…`) bleiben im alten Ordner; das neue Programm legt ab dann eigene an. Der
Papierkorb gelöschter Belege zieht mit, damit „Rückgängig“ im Verlauf weiter wirkt.

Lag deine alte Mac-Programmdatei im Ordner *Programme*, nutzt das neue Programm ihre Daten in
`~/Library/Application Support/Mietfuchs` direkt, ohne Umzug; starte die alte danach nicht mehr.
Startest du das neue, solange die alte läuft, startet es nicht, sondern sagt, dass Mietfuchs schon
mit denselben Daten läuft. Umgekehrt öffnet eine Programmdatei ab 0.15 dann das laufende im
Browser; ältere Programmdateien prüfen das nicht.

Läuft alles im neuen Programm, kannst du die alte Programmdatei löschen. Den alten Ordner `data/`
hebst du am besten noch eine Weile als Sicherung auf.

### Zugriff vom Handy oder einem zweiten Rechner

Es gibt zwei Wege:

| | Programm auf dem PC | Gerät, das immer läuft |
| --- | --- | --- |
| Was | Häkchen „Zugriff aus dem Heimnetz“ im Programm für Windows und macOS | [Docker](docker.md) auf einem NAS oder Heimserver, oder das [Linux-Paket](#linux-installationspaket-mit-startmenü-eintrag) auf einem Raspberry Pi |
| Erreichbar | nur, solange der PC läuft und Mietfuchs geöffnet ist | jederzeit im Heimnetz |
| Adresse | `http://<pc>:17517` | `http://<gerät>:3001`, mit [Caddy](docker.md#mit-https-im-heimnetz-composecaddyyml) auch über HTTPS |

Von unterwegs kommst du nur über ein VPN an Mietfuchs, nie über eine Portfreigabe am Router; siehe
[Von unterwegs und mit HTTPS: über ein VPN](docker.md#von-unterwegs-und-mit-https-über-ein-vpn).

**Im Programm auf dem PC:** Das neue Programm ist zunächst nur auf diesem Rechner erreichbar (Port
17517), deshalb fragt auch keine Firewall. Willst du Mietfuchs auf dem Handy, Tablet oder einem
zweiten Rechner im selben WLAN öffnen:

1. In den Einstellungen unter „Zugriff aus dem Heimnetz“ das Häkchen setzen und speichern.
   Mietfuchs startet dabei kurz neu.
2. Fragt Windows danach, ob Mietfuchs ins Netz darf, lass nur **Private Netzwerke** zu, nicht
   öffentliche. Kommt das Handy dann nicht durch, führt Windows dein WLAN vermutlich als
   öffentliches Netz: unter *Einstellungen → Netzwerk und Internet → WLAN →* dein Netz den
   *Netzwerkprofiltyp* auf *Privates Netzwerk* stellen.
3. Die Karte nennt die Adresse fürs Handy, etwa `http://192.168.178.23:17517`.

Die Adresse ist eine andere als bei der bisherigen Programmdatei und der Store-Fassung bis 0.14
(dort Port 3001); ein Lesezeichen auf dem Handy legst du also neu an. Mietfuchs hat kein Passwort: Solange der Zugriff
erlaubt ist, kann jeder in deinem Heimnetz deine Daten öffnen und ändern. Erlaube ihn nur in
einem Netz, dem du vertraust.

**Tipp: Mietfuchs auf den Startbildschirm legen.**

- **iPhone und iPad:** die Adresse in Safari öffnen, *Teilen* → *Zum Home-Bildschirm*. Ob Mietfuchs
  vom Symbol aus mit oder ohne die Leisten von Safari öffnet, hängt von der iOS-Version und davon ab,
  ob die Adresse HTTPS nutzt.
- **Android:** Über `http://` legt der Browser nur eine Verknüpfung an, Mietfuchs öffnet dann mit
  Browserleiste. Als App installieren lässt es sich erst über HTTPS, etwa mit dem
  [Caddy-Beispiel](docker.md#mit-https-im-heimnetz-composecaddyyml) oder
  [über ein VPN](docker.md#von-unterwegs-und-mit-https-über-ein-vpn).
- Das Symbol ist nur ein Weg zur Adresse: Ohne Verbindung zum Rechner oder Gerät mit Mietfuchs geht
  nichts.
- Das Programm ab Version 0.15 nutzt Port 17517, die bisherige Programmdatei und die Store-Fassung
  bis 0.14 nutzten 3001. Eine ältere Verknüpfung auf dem Startbildschirm legst du deshalb neu an.

### Download prüfen (für Fortgeschrittene)

Unter Windows bekommst du Mietfuchs am einfachsten und ohne Prüfen über den Microsoft Store. Lädst du von der
[Release-Seite](https://github.com/speedone/mietfuchs/releases/latest), kannst du nachsehen, ob die
Datei vollständig und unverändert angekommen ist und wirklich aus diesem Repo stammt:

**Prüfsumme.** Jedes Release hat eine Datei `SHA256SUMS.txt` mit der SHA-256-Prüfsumme jeder Datei;
GitHub zeigt sie außerdem bei jeder hochgeladenen Datei unter *Assets* an
(nicht bei den automatischen Einträgen „Source code“). Berechne die Prüfsumme deines Downloads
und vergleiche sie mit dem Eintrag:

```powershell
# Windows (PowerShell)
Get-FileHash "$env:USERPROFILE\Downloads\Mietfuchs-Setup-0.15.0.exe"
```

```bash
# macOS
shasum -a 256 ~/Downloads/Mietfuchs-0.15.0-apple-silicon.dmg
# Linux: alle geladenen Dateien im Ordner auf einmal
sha256sum -c SHA256SUMS.txt --ignore-missing
```

**Herkunftsnachweis.** Die Prüfsumme zeigt nur, dass die Datei so ankam, wie sie am Release liegt.
Dass sie auch in der Release-Automatik dieses Repos gebaut wurde, belegt ein signierter Nachweis
(Artifact Attestation), den du mit der [GitHub-CLI](https://cli.github.com/) prüfst (vorher einmal
`gh auth login`):

```bash
gh attestation verify Mietfuchs-Setup-0.15.0.exe -R speedone/mietfuchs
```

Die Prüfsummen gibt es ab Version 0.15.0, den Herkunftsnachweis ab 0.15.1. Updates unter Windows (Installer) prüft das Programmfenster selbst:
Es lädt nur eine Update-Beschreibung, die mit dem Schlüssel von Mietfuchs signiert ist.


<a id="herunterladen--starten-ohne-installation"></a>

## Bisherige Programmdatei (ohne Installation)

Die einzelne Programmdatei gibt es weiter. Unter Linux und auf dem Raspberry Pi ist sie neben dem
[Installationspaket](#linux-installationspaket-mit-startmenü-eintrag) der übliche Weg. Unter
Windows und macOS ist das [neue Programm](#installation-unter-windows-und-macos) einfacher; wer
dort die Programmdatei startet, sieht im Cockpit einen Hinweis zum Umstieg. Unter Windows und
macOS ist das neue Programm der empfohlene Weg; die Programmdatei gibt es dort vorerst weiter. Sie braucht **keine
Installation und kein Node** und öffnet Mietfuchs im Browser. Ein Klick lädt immer die neueste
Fassung:

[![Windows herunterladen](https://img.shields.io/badge/Windows-herunterladen-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-win.exe)
[![macOS herunterladen](https://img.shields.io/badge/macOS-herunterladen-111111?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-macos-apple-silicon.zip)
[![Linux herunterladen](https://img.shields.io/badge/Linux-herunterladen-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-linux.tar.gz)

Der macOS-Knopf gilt für Macs mit Apple-Chip (M1 und neuer). Für einen älteren Mac mit
Intel-Prozessor, für ARM-Rechner wie den Raspberry Pi oder für ein Linux-Installationspaket
steht alles in den beiden Tabellen. Jeder Dateiname führt direkt zur neuesten Fassung:

| System | Datei |
| --- | --- |
| Windows | [`mietfuchs-win.exe`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-win.exe) |
| Windows auf ARM (z. B. Snapdragon) | [`mietfuchs-win-arm64.exe`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-win-arm64.exe) |
| macOS (Apple Silicon, M1–M4) | [`mietfuchs-macos-apple-silicon.zip`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-macos-apple-silicon.zip) |
| macOS (Intel) | [`mietfuchs-macos-intel.zip`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-macos-intel.zip) |
| Linux | [`mietfuchs-linux.tar.gz`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-linux.tar.gz) |
| Linux auf ARM (z. B. Raspberry Pi 4/5 mit 64-Bit-System) | [`mietfuchs-linux-arm64.tar.gz`](https://github.com/speedone/mietfuchs/releases/latest/download/mietfuchs-linux-arm64.tar.gz) |

Voraussetzungen: Windows 10 (1809) oder neuer, macOS 13 oder neuer (wie beim neuen Programm; das
verlangt Bun, mit dem die Datei gebaut ist), Linux mit glibc 2.17 oder neuer. Das sind praktisch
alle gängigen Distributionen; vor jedem Release startet jede Datei testweise auf ihrem System und Linux zusätzlich auf Debian, Ubuntu, Fedora, AlmaLinux, Rocky,
openSUSE, Arch und CentOS 7. Für Alpine und andere musl-Systeme gibt es das Docker-Image.

Archiv entpacken (unter macOS genügt ein Doppelklick), dann die Programmdatei per
**Doppelklick** starten; es öffnet sich automatisch dein Browser mit Mietfuchs.
Daneben öffnet sich ein Konsolenfenster mit Text (unter Windows schwarz, auf dem Mac das
Terminal). Lass es offen, solange du arbeitest; zum Beenden einfach schließen oder in Mietfuchs
unten in der Seitenleiste auf *Mietfuchs beenden* klicken.

Beim ersten Start meldet sich das Betriebssystem, weil die Datei nicht kostenpflichtig
signiert ist:

- **Windows:** „Der Computer wurde durch Windows geschützt" → *Weitere Informationen* →
  *Trotzdem ausführen*. Ohne diese Warnung geht es über den
  [Microsoft Store](#windows-aus-dem-microsoft-store-empfohlen).
- **macOS:** der erste Start wird blockiert: Dialog schließen, dann in
  *Systemeinstellungen → Datenschutz & Sicherheit* unten bei der Mietfuchs-Meldung auf
  *Dennoch öffnen* klicken und den Start wiederholen. Das gilt genauso für das
  [neue Programm](#macos). Bis macOS 14 geht stattdessen Rechtsklick auf die Datei → *Öffnen* →
  im Dialog nochmals *Öffnen*. Wer das Terminal mag, nimmt im Ordner der Programmdatei den
  Einzeiler `xattr -d com.apple.quarantine mietfuchs-macos-*` (für das neue Programm steht der
  passende Befehl [dort](#macos)).
- **Linux:** im Terminal: `tar -xzf mietfuchs-linux.tar.gz && ./mietfuchs-linux`
  (das Archiv erhält die Ausführungsrechte, `chmod` ist nicht nötig).

Deine Daten liegen im Ordner **`data/` direkt neben der Programmdatei** (`mietfuchs.sqlite` +
Belege). Backup = diesen Ordner kopieren. Wechselst du unter Windows oder macOS zum neuen
Programm, nimmt es diesen Ordner mit, siehe
[Umzug von der bisherigen Programmdatei](#umzug-von-der-bisherigen-programmdatei). Kommst du von einer älteren Version und hast nur noch
ein Backup-Archiv oder eine lose `db.json`, steht der Weg dafür in
[MIGRATION.md](../MIGRATION.md). Die optionale [KI-Belegauswertung](ki-belegauswertung.md)
braucht zusätzlich ein separat installiertes [Ollama](https://ollama.com) oder den Zugang zu
einem KI-Dienst. Ohne beides funktioniert die Abrechnung trotzdem vollständig.

### Linux: Installationspaket mit Startmenü-Eintrag

Wer Mietfuchs lieber wie jedes andere Programm installiert, nimmt statt des Archivs das Paket
seiner Distribution. Es legt Mietfuchs nach `/usr/bin` und trägt ihn ins Startmenü ein, mit
Symbol und der Kategorie „Büro“.

| Distribution | Datei | Installieren |
| --- | --- | --- |
| Debian, Ubuntu, Mint | `mietfuchs_*_amd64.deb` | `sudo apt install ./mietfuchs_*_amd64.deb` |
| Fedora, RHEL, AlmaLinux, Rocky | `mietfuchs-*.x86_64.rpm` | `sudo dnf install ./mietfuchs-*.x86_64.rpm` |
| openSUSE | `mietfuchs-*.x86_64.rpm` | `sudo zypper install ./mietfuchs-*.x86_64.rpm` |
| Arch, Manjaro, EndeavourOS | `mietfuchs-*-x86_64.pkg.tar.zst` | `sudo pacman -U mietfuchs-*-x86_64.pkg.tar.zst` |

Für ARM-Rechner (Raspberry Pi 4/5 mit 64-Bit-System) heißen die Dateien `arm64` statt `amd64`
und `aarch64` statt `x86_64`.

Ein Klick im Startmenü startet Mietfuchs und öffnet den Browser; ein Konsolenfenster gibt es
dabei nicht. Zum Beenden dient der Knopf **„Mietfuchs beenden"** unten in der Seitenleiste. Ein
zweiter Klick im Menü holt einfach die laufende Oberfläche nach vorn.

Ohne grafische Oberfläche, etwa auf einem Server oder einem Raspberry Pi per SSH, funktioniert
das Paket genauso: `mietfuchs` im Terminal starten und die Oberfläche von einem anderen Rechner
unter `http://<ip-des-rechners>:3001` aufrufen. Dass sich dort kein Browser öffnet, ist normal;
Mietfuchs sagt es in der Ausgabe.

Mietfuchs antwortet dabei unter seiner IP-Adresse, unter `localhost` und unter Namen im Heimnetz
(ohne Punkt wie `raspberrypi`, oder mit Endungen wie `.local`, `.lan`, `.fritz.box`, `.home.arpa`,
`.ts.net`). Unter einem anderen Namen, etwa hinter einem Reverse-Proxy mit eigener Domain, trägst
du ihn in `NKA_ALLOWED_HOSTS` ein (mehrere mit Komma, `.example.org` für alle Namen darunter, `*`
schaltet die Prüfung ab). Das schützt davor, dass eine fremde Webseite in deinem Browser Mietfuchs
über einen eigenen Namen erreicht oder darin etwas ändert. Im Docker-Image ist die Prüfung aus,
solange `NKA_ALLOWED_HOSTS` nicht gesetzt ist. `NKA_HOST` legt fest, auf welcher Adresse
Mietfuchs lauscht, etwa `127.0.0.1` für nur diesen Rechner; ohne Angabe auf allen.

Aus einem Paket installiert, liegen die Daten in **`~/.local/share/mietfuchs`** statt neben der
Programmdatei; in `/usr/bin` darf niemand schreiben. Backup = diesen Ordner kopieren. Wer die
Archiv-Fassung schon nutzt, behält seinen Ordner `data/` neben der Programmdatei. Beim Umstieg
vom Archiv auf das Paket den alten Ordner also einmal mitnehmen:

```bash
mkdir -p ~/.local/share/mietfuchs && cp -r data/. ~/.local/share/mietfuchs/
```

Wo die Daten liegen, sagt Mietfuchs beim Start selbst: Die zweite Zeile der Ausgabe im
Terminal nennt den Ordner.

Ein Update holt sich das Paket nicht von selbst: Neue Fassung von der Releases-Seite laden und
denselben Befehl noch einmal ausführen, er ersetzt die installierte Fassung. Der Update-Hinweis
in Mietfuchs sagt Bescheid, wenn es eine neue Fassung gibt, sofern du die Prüfung erlaubst.
