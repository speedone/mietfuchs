# Datenschutzerklärung für Mietfuchs

Stand: 9. November 2026

Mietfuchs ist ein Programm für die Nebenkostenabrechnung, das vollständig auf Ihrem eigenen Rechner
läuft. Diese Erklärung gilt für alle Fassungen: das Programm für Windows und macOS (aus dem Microsoft
Store, mit dem Installer oder als `.dmg` für den Mac), die Programmdatei von GitHub, die Linux-Pakete
und das Docker-Image.

## Was der Herausgeber erhält

Nichts. Mietfuchs hat kein Konto beim Herausgeber, keine Werbung, keine Nutzungsstatistik und keine
Fehlerberichte an den Herausgeber. Das Passwort, mit dem Sie Mietfuchs im Heimnetz schützen, prüft
nur Mietfuchs auf Ihrem Rechner. Ihre Abrechnungsdaten, Belege und Einstellungen liegen nur in
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
Einstellungen (gemerkter Port, Zugriff aus dem Heimnetz) und Protokollen. Haben Sie das Fenster mit
einem Mietfuchs im Heimnetz verbunden, stehen in seiner Datei `fenster.json` zusätzlich dessen
Adresse, die Art der Prüfung (`trust`), bei einer Verbindung mit dem eigenen Zertifikat von
Mietfuchs dessen Fingerabdruck (über einen Proxy wie Caddy mit eigenem Zertifikat keiner), die
Kennung, unter der der Server das Fenster führt, die Version des Servers beim Koppeln und der
Geräteschlüssel, mit dem sich das Fenster dort anmeldet. Die Datei ist nur für Ihr Benutzerkonto lesbar, aber nicht eigens verschlüsselt, wie die
übrigen Daten in Ihrem Benutzerordner; einen Geräteschlüssel machen Sie am Server wirkungslos, indem
Sie das Fenster dort entfernen (unten). Der Installer für Windows
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
einem anderen Rechner im selben Netz öffnen. Beim Einschalten legen Sie ein Passwort fest, mit dem
sich andere Geräte anmelden; das Programmfenster selbst braucht keines. Verzichten Sie darauf, kann
jeder in diesem Netz Ihre Daten ansehen und ändern. Auch mit Passwort läuft die Verbindung im
Browser im Heimnetz über `http://`, also unverschlüsselt: Wer den Verkehr in Ihrem Netz mitschneidet, kann
Daten und Passwort mitlesen. Erlauben Sie den Zugriff deshalb nur in einem Netz, dem Sie vertrauen,
und lassen Sie unter Windows nur „Private Netzwerke“ zu. Eine Verbindung ins
Internet entsteht dadurch nicht. Beenden, die Schlüssel für KI-Dienste, die Bestätigung eines
KI-Dienstes im Internet und die Update-Prüfung lassen sich nur am Rechner selbst ändern.

Die Programmdatei, die Linux-Pakete und das Docker-Image sind dagegen von Anfang an auch aus dem
Heimnetz erreichbar und fragen deshalb beim ersten Start nach einem Passwort; den Einrichtungscode
dafür nennen Konsolenfenster bzw. Protokoll. Ein Bestand von vor Version 0.17 bleibt bis zur Version 1.0.0-rc.1, der ersten Testversion von 1.0, ohne Passwort erreichbar, mit einem Hinweis in der Oberfläche. Mit der Umgebungsvariablen
`NKA_HOST=127.0.0.1` sind Programmdatei und Pakete nur noch auf Ihrem eigenen Rechner erreichbar,
dann ohne Anmeldung. Beim Docker-Image entscheidet das die Freigabe des Ports, etwa
`-p 127.0.0.1:3001:3001` für nur diesen Rechner.

Für die Anmeldung legt Mietfuchs im Datenordner die Datei `zugang.json` an (der Passwort-Hash nach
scrypt, nie das Passwort selbst) und, solange kein Passwort festgelegt ist, `einrichtungscode.txt`.
Beide gehen nicht in Backups, Vorversionen und den Umzug ein. Angemeldete Geräte erkennt Mietfuchs
an einem Cookie, das nur für die Sitzung gilt; es endet nach 30 Minuten ohne Aktivität, spätestens
nach 8 Stunden und mit jedem Neustart von Mietfuchs. Fehlgeschlagene Anmeldungen schreibt Mietfuchs
mit der Adresse des Geräts in sein Protokoll auf Ihrem Rechner.

Seit Version 0.17 spricht Mietfuchs auf demselben Port auch HTTPS, mit einem eigenen Zertifikat, das
es im Datenordner unter `tls/` anlegt (der Schlüssel nur für Ihr Benutzerkonto lesbar). Darüber
verbindet sich ein Programmfenster auf einem anderen Rechner verschlüsselt mit einem Mietfuchs im
Heimnetz, etwa auf einem NAS. Beim Koppeln beweist ein Code aus den Einstellungen des Servers, dass
das Fenster mit dem richtigen Server spricht; der Code selbst geht nicht über das Netz. Je
gekoppeltem Fenster merkt sich der Server in `zugang.json` den Namen des Rechners, wann es gekoppelt
wurde und wann es sich zuletzt gemeldet hat (höchstens stündlich gespeichert), dazu einen Hash des
Geräteschlüssels, nie den Schlüssel selbst. Unter *Einstellungen → Anmeldung* sehen und entfernen Sie
gekoppelte Fenster; Zurücksetzen und Ausschalten der Anmeldung entfernen alle. Wie `zugang.json` geht
`tls/` nicht in Backups, Vorversionen und den Umzug ein: Nach dem Wiederherstellen auf einem anderen
Rechner entsteht ein neues Zertifikat, und gekoppelte Fenster koppeln Sie neu. Im Browser bleibt die
Verbindung über `http://`; die Adresse mit `https://` zeigt dort nur eine Warnung, weil kein Browser
dieses Zertifikat kennt.

## Kontoauszüge

Lesen Sie auf der Seite Kontoauszug den Auszug Ihrer Bank ein, verarbeitet Mietfuchs ihn nur auf Ihrem
Rechner. Die Datei selbst wird nicht gespeichert. Gespeichert werden je Auszug Zeitraum, Salden und
Dateiname, je Buchungstag Anzahl und Summen der Umsätze und die einzelnen Umsätze, die zur Vermietung
gehören, mit Name und IBAN der Gegenseite und Verwendungszweck. Auf einem Konto, das Sie nicht
ausdrücklich als Konto nur für die Vermietung bestätigt haben, speichert Mietfuchs private Umsätze nicht
einzeln, auch nicht im Verlauf oder in einer Sicherung; sie stehen nur in der Summe des Tages. Hat ein Tag nur
einen Umsatz, zeigt diese Summe seinen Betrag, ohne Gegenseite und Zweck. Stellen Sie ein Konto nur für die
Vermietung wieder auf Mischkonto zurück, bleiben die bis dahin einzeln gespeicherten Umsätze, auch in Verlauf und
Sicherungen; ein Rücksprung oder ein Backup stellt die Bestätigung nicht wieder her. Rückfragen
der Vorschau zu einzelnen Eingängen bleiben bis zu Ihrer Antwort im Arbeitsspeicher. Kontoauszüge gehen
nie an einen Dienst für die Belegauswertung, auch nicht an einen auf Ihrem Rechner: Der Eingang der Belege
weist sie ab. Bewahren Sie die Kontoauszüge Ihrer Bank selbst auf. Mietfuchs ersetzt sie nicht.

Für die Daten Ihrer Mieter, auch Name und IBAN aus dem Kontoauszug, sind Sie als Vermieter in der Regel
selbst Verantwortlicher im Sinne der DSGVO; die Ausnahme für rein persönliche oder familiäre Tätigkeiten
greift bei einer Vermietung meist nicht. Brauchen Sie die Umsätze eines Mietverhältnisses nach seinem Ende
nicht mehr, etwa weil Abrechnung, Kaution und Steuer erledigt sind, nehmen Sie den Import zurück oder löschen
Sie das Mietverhältnis.

## Verbindungen ins Internet

Mietfuchs stellt nur in drei Fällen eine Verbindung ins Internet her, und jeweils erst, nachdem Sie
zugestimmt haben:

1. **Nach neuen Versionen sehen** (nicht in der App aus dem Microsoft Store; dort aktualisiert der
   Store, und Mietfuchs fragt GitHub auch dann nicht, wenn ein eingespieltes Backup die Zustimmung
   mitbringt). Mit Ihrer Zustimmung fragt Mietfuchs höchstens einmal am Tag bei GitHub nach der neuesten
   Version und lädt die Liste empfohlener KI-Modelle. Im eigenen Programmfenster unter Windows lädt
   Mietfuchs eine neue Version dann auch gleich von GitHub herunter; installiert wird sie erst, wenn Sie
   das bestätigen („Jetzt neu starten“ oder „Beim nächsten Start“). Ein gekoppeltes Programmfenster übernimmt die
   Zustimmung aus den Einstellungen des Mietfuchs, mit dem es gekoppelt ist: Wer dort die Einstellungen ändern darf,
   entscheidet damit auch, ob das Fenster neue Versionen herunterlädt. GitHub sieht dabei Ihre IP-Adresse und die
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
