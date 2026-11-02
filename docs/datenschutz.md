# Datenschutzerklärung für Mietfuchs

Stand: 2. November 2026

Mietfuchs ist ein Programm für die Nebenkostenabrechnung, das vollständig auf Ihrem eigenen Rechner
läuft. Diese Erklärung gilt für alle Fassungen: das Programm für Windows und macOS (aus dem Microsoft
Store, mit dem Installer oder als `.dmg` für den Mac), die Programmdatei von GitHub, die Linux-Pakete
und das Docker-Image.

## Was der Herausgeber erhält

Nichts. Mietfuchs hat kein Konto, keine Anmeldung, keine Werbung, keine Nutzungsstatistik und keine
Fehlerberichte an den Herausgeber. Ihre Abrechnungsdaten, Belege und Einstellungen liegen nur in
einem Ordner auf Ihrem Rechner:

- Programm für Windows (Microsoft Store oder Installer): `%USERPROFILE%\Mietfuchs`
- Programm für macOS: `~/Library/Application Support/Mietfuchs`
- Programmdatei: im Ordner `data` neben der Datei, oder im Benutzerordner (Windows
  `%LOCALAPPDATA%\Mietfuchs`, macOS `~/Library/Application Support/Mietfuchs`), wenn sie an einem
  Systemort wie `Program Files` oder `/Applications` liegt oder Mietfuchs neben ihr nicht schreiben darf
- Linux-Pakete: `~/.local/share/mietfuchs`

Das Programm für Windows und macOS legt daneben einen Ordner `mietfuchs-fenster` an (Windows
`%LOCALAPPDATA%\mietfuchs-fenster`, aus dem Microsoft Store im Paketordner der App, macOS
`~/Library/Application Support/mietfuchs-fenster`) mit seinen
Einstellungen (gemerkter Port, Zugriff aus dem Heimnetz) und Protokollen. Der Installer für Windows
legt eine Kopie von sich unter `%LOCALAPPDATA%\mietfuchs-updater` ab, damit Updates nur die geänderten
Teile laden, und schreibt beim Installieren ein Zeitprotokoll nach `%TEMP%\mietfuchs-installation.log`.
Auch diese Dateien verlassen Ihren Rechner nicht.

Die Programmdatei unter Windows und macOS vermerkt außerdem, wo dieser Ordner liegt, in einer kleinen
Datei auf Ihrem Rechner (Windows `%LOCALAPPDATA%\mietfuchs-standorte\standorte.json`, macOS
`~/Library/Application Support/mietfuchs-standorte/standorte.json`): Pfad des Ordners und der Programmdatei,
Versionsnummer und Zeitpunkt des letzten Starts. So kann eine spätere Fassung Ihre Daten finden und den
Umzug anbieten. Nach einem Umzug trägt auch das Programm mit eigenem Fenster dort seinen neuen Ort ein,
außer aus dem Microsoft Store. Die Datei verlässt Ihren Rechner nicht. Sie bleibt liegen, wenn Sie den Datenordner
löschen; löschen Sie sie dann mit.

Das Programmfenster sucht beim ersten Start ohne Daten nach Ihren bisherigen Daten: zuerst an den Orten
aus dieser Datei und unter Windows in `%LOCALAPPDATA%\Mietfuchs`, sonst in Downloads, Schreibtisch und
Dokumente nach einem Ordner `data` neben einer Mietfuchs-Programmdatei. Von einem Fund liest es Ort, Datum der letzten Änderung und die Zahl der Objekte
und Mietverhältnisse; nichts davon verlässt Ihren Rechner. macOS fragt dafür beim ersten Mal je Ordner nach. Übernommen wird erst nach Ihrem Klick, und zwar als Kopie: Der alte Ordner bleibt liegen und
bekommt nur einen Vermerk (`umgezogen.json` und `UMGEZOGEN.txt`) mit dem neuen Ort.

Beim Deinstallieren der App oder eines Pakets bleibt dieser Ordner erhalten. Löschen Sie ihn selbst,
wenn Sie die Daten nicht mehr brauchen.

## Zugriff aus dem Heimnetz

Das Programm für Windows und macOS ist zunächst nur auf Ihrem eigenen Rechner erreichbar. Erlauben Sie
in den Einstellungen den „Zugriff aus dem Heimnetz“, lässt sich Mietfuchs auch von einem Handy oder
einem anderen Rechner im selben Netz öffnen. Mietfuchs hat kein Passwort: Solange der Zugriff erlaubt
ist, kann jeder in diesem Netz Ihre Daten ansehen und ändern. Erlauben Sie ihn deshalb nur in einem
Netz, dem Sie vertrauen, und lassen Sie unter Windows nur „Private Netzwerke“ zu. Eine Verbindung ins
Internet entsteht dadurch nicht. Beenden, die Schlüssel für KI-Dienste, die Bestätigung eines
KI-Dienstes im Internet und die Update-Prüfung lassen sich nur am Rechner selbst ändern.

Die Programmdatei und die Linux-Pakete sind dagegen von Anfang an auch aus dem Heimnetz erreichbar,
ebenfalls ohne Passwort. Mit der Umgebungsvariablen `NKA_HOST=127.0.0.1` sind sie nur noch auf Ihrem
eigenen Rechner erreichbar. Beim Docker-Image entscheidet das die Freigabe des Ports, etwa
`-p 127.0.0.1:3001:3001` für nur diesen Rechner.

## Verbindungen ins Internet

Mietfuchs stellt nur in drei Fällen eine Verbindung ins Internet her, und jeweils erst, nachdem Sie
zugestimmt haben:

1. **Nach neuen Versionen sehen** (nicht in der App aus dem Microsoft Store; dort aktualisiert der
   Store, und Mietfuchs fragt GitHub auch dann nicht, wenn ein eingespieltes Backup die Zustimmung
   mitbringt). Mit Ihrer Zustimmung fragt Mietfuchs höchstens einmal am Tag bei GitHub nach der neuesten
   Version und lädt die Liste empfohlener KI-Modelle. Im eigenen Programmfenster unter Windows lädt
   Mietfuchs eine neue Version dann auch gleich von GitHub herunter; installiert wird sie erst, wenn Sie
   das bestätigen („Jetzt neu starten“ oder „Beim nächsten Start“). GitHub sieht dabei Ihre IP-Adresse und die
   installierte Versionsnummer. Es gilt die
   [Datenschutzerklärung von GitHub](https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement).
2. **KI-Belegauswertung über einen Dienst im Internet.** Wenn Sie in den Einstellungen einen Dienst
   wie OpenAI, IONOS, Mistral oder Ollama Cloud eintragen und die Übermittlung ausdrücklich
   bestätigen, schickt Mietfuchs die Belege, die Sie auswerten lassen, an diesen Dienst. Belege
   enthalten oft personenbezogene Daten, etwa Namen und Anschriften von Mietern. Verantwortlich für
   diese Übermittlung sind Sie als Vermieter; dafür brauchen Sie in der Regel einen Vertrag zur
   Auftragsverarbeitung mit dem Anbieter. Es gelten die Bedingungen des gewählten Anbieters. Ohne
   diese Einstellung verlassen Belege Ihren Rechner nicht; mit Ollama oder LM Studio auf Ihrem
   eigenen Rechner ebenfalls nicht.
3. **Links, die Sie anklicken**, etwa zu dieser Erklärung oder zur Anleitung, öffnen Ihren Browser.
   Dann gelten die Bedingungen der jeweiligen Seite.

Die Schlüssel für KI-Dienste speichert Mietfuchs in `secrets.json` im Datenordner. Sie gehen nicht
in Backups ein.

## Ihre Rechte

Da der Herausgeber keine personenbezogenen Daten von Ihnen erhält, gibt es bei ihm nichts
auszukunften, zu berichtigen oder zu löschen. Für die Daten in Ihrem Datenordner sind Sie selbst
verantwortlich; Sie können sie jederzeit ansehen, sichern und löschen.

## Kontakt

Fragen zum Datenschutz stellen Sie bitte über die
[Issues im GitHub-Repository](https://github.com/speedone/mietfuchs/issues).
