# Datenschutzerklärung für Mietfuchs

Stand: 1. November 2026

Mietfuchs ist ein Programm für die Nebenkostenabrechnung, das vollständig auf Ihrem eigenen Rechner
läuft. Diese Erklärung gilt für alle Fassungen: die Programmdatei von GitHub, die Linux-Pakete, das
Docker-Image und die App aus dem Microsoft Store.

## Was der Herausgeber erhält

Nichts. Mietfuchs hat kein Konto, keine Anmeldung, keine Werbung, keine Nutzungsstatistik und keine
Fehlerberichte an den Herausgeber. Ihre Abrechnungsdaten, Belege und Einstellungen liegen nur in
einem Ordner auf Ihrem Rechner:

- App aus dem Microsoft Store: `%USERPROFILE%\Mietfuchs`
- Programmdatei: im Ordner `data` neben der Datei, oder im Benutzerordner, wenn Mietfuchs dort nicht
  schreiben darf
- Linux-Pakete: `~/.local/share/mietfuchs`

Die Programmdatei unter Windows und macOS vermerkt außerdem, wo dieser Ordner liegt, in einer kleinen
Datei auf Ihrem Rechner (Windows `%LOCALAPPDATA%\mietfuchs-standorte\standorte.json`, macOS
`~/Library/Application Support/mietfuchs-standorte/standorte.json`): Pfad des Ordners und der Programmdatei,
Versionsnummer und Zeitpunkt des letzten Starts. So kann eine spätere Fassung Ihre Daten finden und den
Umzug anbieten. Die Datei verlässt Ihren Rechner nicht. Sie bleibt liegen, wenn Sie den Datenordner
löschen; löschen Sie sie dann mit.

Beim Deinstallieren der App oder eines Pakets bleibt dieser Ordner erhalten. Löschen Sie ihn selbst,
wenn Sie die Daten nicht mehr brauchen.

## Verbindungen ins Internet

Mietfuchs stellt nur in drei Fällen eine Verbindung ins Internet her, und jeweils erst, nachdem Sie
zugestimmt haben:

1. **Nach neuen Versionen sehen** (nicht in der App aus dem Microsoft Store; dort aktualisiert der
   Store, und Mietfuchs fragt GitHub auch dann nicht, wenn ein eingespieltes Backup die Zustimmung
   mitbringt). Mit Ihrer Zustimmung fragt Mietfuchs höchstens einmal am Tag bei GitHub nach der neuesten
   Version und lädt die Liste empfohlener KI-Modelle. GitHub sieht dabei Ihre IP-Adresse und die
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
