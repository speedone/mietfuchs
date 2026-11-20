# Mitmachen bei Mietfuchs

Danke fürs Interesse! Mietfuchs ist ein Freizeitprojekt - Antworten auf Issues und
Pull Requests können ein paar Tage dauern.

## Worum es geht

Mietfuchs hilft privaten Vermietern: Nebenkostenabrechnung, Mietkonto, Steuerübersicht. Das
Projekt darf wachsen - mit neuen Bereichen ebenso wie mit größeren technischen Umbauten.

## Der Maßstab

**Mietfuchs muss für Vermieter ohne technische Vorkenntnisse nutzbar und einfach
einzurichten bleiben.**

Dahinter darf die Technik ruhig aufwendiger werden, etwa mit einer Datenbank oder einem
Serverbetrieb. Dann nehmen Skripte, Installer und sinnvolle Voreinstellungen dem Nutzer die
Einrichtung ab. Dasselbe gilt für Backup, Updates und den Umzug der Daten auf einen neuen
Rechner: Sie sollen ohne Fachwissen gelingen.

## Willkommen - gern direkt als Pull Request

- Fehlerkorrekturen
- Tests, besonders für die Berechnung
- fachliche Verbesserungen, mit Begründung (Rechtsgrundlage oder Quelle)
- neue Funktionen
- Verbesserungen an Oberfläche, Einrichtung und Dokumentation

Bei größeren Vorhaben - neue Bereiche, Umbauten an der Architektur - hilft ein kurzes Issue
vorab: Dann sind Zuschnitt und Reihenfolge klar, bevor viel Arbeit hineinfließt. Große Umbauten
bitte in Schritte teilen, die sich einzeln prüfen und zusammenführen lassen.

## Ablauf

1. Fork anlegen, Branch von `main`, **eine Sache pro Pull Request**.
2. Bezug zum Issue mit `Refs #N` in der PR-Beschreibung oder Commit-Nachricht - nicht mit
   `Fixes #N`: Issues werden erst geschlossen, wenn die Änderung in einem Release erscheint.
3. Vor jedem Commit `npm run typecheck`: Der Server läuft ohne Build-Schritt, einen Typfehler
   merkt sonst niemand, und einen Linter gibt es nicht. `npm test` und `npm run build` müssen
   ebenfalls grün sein; die CI prüft alle drei.
4. Ein Eintrag im [CHANGELOG.md](CHANGELOG.md) unter „Unveröffentlicht“.
5. Sprache: Bezeichner im Code sind englisch, also Variablen, Funktionen, Typen, Datei- und
   Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`).
   Deutsch sind Kommentare, Oberflächentexte, Fehlermeldungen, Testnamen, Commit-Nachrichten
   und gespeicherte Fachwerte wie `'vermietet'` oder die Kostenarten. Seitenkomponenten heißen
   wie die Seite in der Oberfläche (`Kosten.tsx`).
6. Geldbeträge in Cent als Ganzzahl. Architektur und weitere Konventionen stehen in
   [CLAUDE.md](CLAUDE.md).

Beitragende werden im Changelog und in den Release-Notes genannt.

## Das Programmfenster (`desktop/`)

Das Programm für Windows und macOS (Electron) ist ein eigenes Paket in `desktop/` mit eigenem
Lockfile; `npm install` im Wurzelordner installiert es nicht mit. Wer daran arbeitet:

```powershell
npm --prefix desktop install   # einmalig
npm run build                  # die Oberfläche, die das Fenster zeigt
npm run desktop                # Fenster mit dem Server aus dem Quellcode, Daten in server/data
```

Der Code dort bleibt JavaScript und wird von `npm run typecheck` mitgeprüft; ohne
`npm --prefix desktop install` überspringt der Lauf das Fenster mit einem Hinweis, in der CI ist das
ein Fehler. Die Tests in `desktop/test` laufen mit `npm test` und brauchen keine Installation.
Bau, Installer und Updates beschreibt [scripts/CLAUDE.md](scripts/CLAUDE.md) unter „Programmfenster“.

## Änderungen an der Berechnung

Eine Nebenkostenabrechnung ist ein Dokument mit rechtlicher Wirkung. Deshalb gilt für die
Berechnung ([server/src/calc.ts](server/src/calc.ts)):

- Jede fachliche Änderung braucht einen Test, der ohne die Änderung fehlschlägt.
- Bestehende Abrechnungen dürfen sich nicht unbemerkt anders rechnen - weder durch eine neue
  Regel noch durch eine Migration.
- Die Invarianten-Tests in [server/test/calc.test.ts](server/test/calc.test.ts) bleiben grün:
  Mieteranteile und Vermieteranteil ergeben immer die Gesamtkosten, kein Anteil ist negativ.

## Änderungen am Datenbestand (Migrationen)

Ab 1.0 gilt die [Kompatibilitätszusage](MIGRATION.md#kompatibilität-bis-und-ab-10): Jeder Bestand und
jedes Backup aus 1.x lässt sich in jeder späteren 1.x ohne Handarbeit öffnen. Für eine Migration in 1.x
heißt das:

- Sie läuft beim Start von selbst, ohne Rückfrage und ohne dass der Nutzer etwas umwandeln muss, auf
  jedem Bestand, den eine veröffentlichte Version geschrieben hat, auch auf einem alten Backup.
- Sie verliert nichts Erfasstes und ändert keine Zahl einer abgeschlossenen Abrechnung: Deren
  eingefrorener Stand ist ein Archivstück und bleibt wortgleich.
- Ein veröffentlichter Schritt wird nie geändert und nie gelöscht (ein Test hält die Marke jedes
  veröffentlichten Schrittes fest). Ein Fehler darin wird mit einem neuen Schritt geradegerückt.
- Bevor Mietfuchs ausstehende Schritte anwendet, legt es selbst eine Sicherung an
  (`mietfuchs.sqlite.vor-…`); darauf verlässt sich der Weg zurück zur vorigen Version, also bleibt das so.
- Jeder Datenschritt bekommt einen Test, der einen Bestand auf dem Stand davor durch den Schritt
  schickt und Abrechnung, Mietkonto und Steuer centgenau vergleicht.

Dasselbe gilt für das, was nach außen sichtbar ist: Die Form der Exporte
([Daten & Backup](docs/daten-backup.md#exporte-und-ihre-form)) und die Umgebungsvariablen
([Installation](docs/installation.md#umgebungsvariablen)) sind per Test gebunden; wer sie ändert, kündigt
es im Changelog an. Was eine dieser Regeln brechen müsste, wartet auf 2.0. Die Technik (erzeugen mit
`db:generate`, Datenschritte, Sicherung, Wächter) steht in
[server/src/db/CLAUDE.md](server/src/db/CLAUDE.md).

## Fehler melden

Fehler meldest du mit dem [Formular](https://github.com/speedone/mietfuchs/issues/new/choose): Version,
Betriebsart (Microsoft Store, Installer, macOS, Linux-Paket, Programmdatei, Docker, Quellcode), Schritte
zum Nachstellen sowie erwartetes und tatsächliches Ergebnis. Fragen zur Bedienung gehören in die
[Diskussionen](https://github.com/speedone/mietfuchs/discussions/categories/q-a), Sicherheitslücken
meldest du vertraulich wie in [SECURITY.md](SECURITY.md) beschrieben.

**Keine echten Mieterdaten, Namen oder Belege in Issues und Diskussionen posten.** Namen, Adressen und
Beträge vorher durch Beispielwerte ersetzen - beides ist öffentlich und dauerhaft sichtbar.

## Lizenz

Beiträge stehen wie das Projekt unter der [AGPL-3.0](LICENSE). Was bis Version 0.11.3 unter
der MIT-Lizenz beigetragen wurde, steht zusätzlich weiter unter ihr ([LICENSE-MIT](LICENSE-MIT)).
