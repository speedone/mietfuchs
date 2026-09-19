# Mitmachen bei Mietfuchs

Danke fürs Interesse! Mietfuchs ist ein Freizeitprojekt — Antworten auf Issues und
Pull Requests können ein paar Tage dauern.

## Worum es geht

Mietfuchs hilft privaten Vermietern: Nebenkostenabrechnung, Mietkonto, Steuerübersicht. Das
Projekt darf wachsen — mit neuen Bereichen ebenso wie mit größeren technischen Umbauten.

## Der Maßstab

**Mietfuchs muss für Vermieter ohne technische Vorkenntnisse nutzbar und einfach
einzurichten bleiben.**

Dahinter darf die Technik ruhig aufwendiger werden, etwa mit einer Datenbank oder einem
Serverbetrieb. Dann nehmen Skripte, Installer und sinnvolle Voreinstellungen dem Nutzer die
Einrichtung ab. Dasselbe gilt für Backup, Updates und den Umzug der Daten auf einen neuen
Rechner: Sie sollen ohne Fachwissen gelingen.

## Willkommen — gern direkt als Pull Request

- Fehlerkorrekturen
- Tests, besonders für die Berechnung
- fachliche Verbesserungen, mit Begründung (Rechtsgrundlage oder Quelle)
- neue Funktionen
- Verbesserungen an Oberfläche, Einrichtung und Dokumentation

Bei größeren Vorhaben — neue Bereiche, Umbauten an der Architektur — hilft ein kurzes Issue
vorab: Dann sind Zuschnitt und Reihenfolge klar, bevor viel Arbeit hineinfließt. Große Umbauten
bitte in Schritte teilen, die sich einzeln prüfen und zusammenführen lassen.

## Ablauf

1. Fork anlegen, Branch von `main`, **eine Sache pro Pull Request**.
2. Bezug zum Issue mit `Refs #N` in der PR-Beschreibung oder Commit-Nachricht — nicht mit
   `Fixes #N`: Issues werden erst geschlossen, wenn die Änderung in einem Release erscheint.
3. `npm test` und `npm run build` müssen grün sein; die CI prüft beides.
4. Ein Eintrag im [CHANGELOG.md](CHANGELOG.md) unter „Unveröffentlicht".
5. Sprache: Bezeichner im Code sind englisch, also Variablen, Funktionen, Typen, Datei- und
   Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`).
   Deutsch sind Kommentare, Oberflächentexte, Fehlermeldungen, Testnamen, Commit-Nachrichten
   und gespeicherte Fachwerte wie `'vermietet'` oder die Kostenarten. Seitenkomponenten heißen
   wie die Seite in der Oberfläche (`Kosten.tsx`).
6. Geldbeträge in Cent als Ganzzahl. Architektur und weitere Konventionen stehen in
   [CLAUDE.md](CLAUDE.md).

Beitragende werden im Changelog und in den Release-Notes genannt.

## Änderungen an der Berechnung

Eine Nebenkostenabrechnung ist ein Dokument mit rechtlicher Wirkung. Deshalb gilt für die
Berechnung ([server/src/calc.js](server/src/calc.js)):

- Jede fachliche Änderung braucht einen Test, der ohne die Änderung fehlschlägt.
- Bestehende Abrechnungen dürfen sich nicht unbemerkt anders rechnen — weder durch eine neue
  Regel noch durch eine Migration.
- Die Invarianten-Tests in [server/test/calc.test.js](server/test/calc.test.js) bleiben grün:
  Mieteranteile und Vermieteranteil ergeben immer die Gesamtkosten, kein Anteil ist negativ.

## Fehler melden

Bitte mit Version, Schritten zum Nachstellen sowie erwartetem und tatsächlichem Ergebnis.

**Keine echten Mieterdaten in Issues posten.** Namen, Adressen und Beträge vorher durch
Beispielwerte ersetzen — ein Issue ist öffentlich und dauerhaft sichtbar.

## Lizenz

Beiträge stehen wie das Projekt unter der [MIT-Lizenz](LICENSE).
