# Daten & Backup

Alles liegt in einem Datenordner (`mietfuchs.sqlite`, hochgeladene Belege in `uploads/`, Logo
und Briefpapier für den Druck in `briefpapier/`; Angaben zu den Belegen und gespeicherte
KI-Auswertungen stehen in der Datenbank und kommen mit ins Backup).
Der Verlauf der Änderungen (Seite „Verlauf“) kommt nur mit, wenn du beim Backup „Verlauf der
Änderungen mitsichern“ anhakst: Er enthält bis zu zwölf Monate lang auch gelöschte Angaben
früherer Mieter.

Wo der Datenordner liegt, hängt davon ab, wie du Mietfuchs nutzt:

- **Programm für Windows** (Store oder Installer): `%USERPROFILE%\Mietfuchs`, z. B.
  `C:\Users\Name\Mietfuchs`, außerhalb des Programms, damit er eine Deinstallation übersteht.
- **Programm für macOS**: `~/Library/Application Support/Mietfuchs`.
- **Bisherige Programmdatei**: **neben der Datei**. Liegt sie an einem Ort, an dem sie nicht
  schreiben darf (etwa `Program Files` oder `/Applications`), unter Windows in
  `%LOCALAPPDATA%\Mietfuchs`, unter macOS in `~/Library/Application Support/Mietfuchs`.
- **Linux-Paket**: `~/.local/share/mietfuchs`.
- **Aus dem Quellcode**: `server/data/`.

Im Programm für Windows und macOS öffnet das Menü *Mietfuchs → Datenordner zeigen* den Ordner.
Backup = diesen Ordner kopieren. `NKA_DATA_DIR` legt ihn frei fest.

Eingelesene Kontoauszüge (Seite „Kontoauszug“) stehen in der Datenbank und kommen mit ins Backup:
Konten, Importe, Tagessummen, die Umsätze der Vermietung, die Zuordnungen und gemerkte Zahler. Die Datei
der Bank selbst speichert Mietfuchs nicht; bewahre sie selbst auf.

Das Passwort der Anmeldung steht nur als Hash in `zugang.json` im Datenordner, daneben, solange kein
Passwort festgelegt ist, `einrichtungscode.txt`. Beides geht **nicht** ins Backup über die Oberfläche,
nicht in die automatischen Vorversionen und nicht in den Umzug ins Programmfenster: Ein Backup in einer
Cloud oder auf einem USB-Stick soll niemanden zum Raten einladen. Nach dem Wiederherstellen auf einem
anderen Rechner gilt dessen Anmeldung; auf demselben Rechner bleibt dein Passwort. Kopierst du den
ganzen Ordner von Hand, kommt `zugang.json` mit.

Ebenso draußen bleibt der Ordner `tls/` mit dem Zertifikat, über das Mietfuchs seit Version 0.17 auch
HTTPS spricht (für ein [gekoppeltes Programmfenster](installation.md#programmfenster-mit-mietfuchs-im-heimnetz-verbinden)):
nicht im Backup, nicht in den Vorversionen, nicht im Umzug. Nach dem Wiederherstellen auf einem
anderen Rechner legt Mietfuchs ein neues Zertifikat an; ein gekoppeltes Fenster meldet dann ein
anderes Zertifikat als beim Koppeln, und du koppelst es mit einem neuen Code neu. Mit dem ganzen
Ordner von Hand kommt auch `tls/` mit.

Daneben legt das Programm für Windows und macOS einen eigenen kleinen Ordner `mietfuchs-fenster` an
(unter Windows in `%LOCALAPPDATA%`, bei der Store-Fassung von Windows in deren Paketordner umgelenkt,
auf dem Mac in `~/Library/Application Support`): gemerkter Port,
der Schalter für den Zugriff aus dem Heimnetz, die Verbindung mit einem Mietfuchs im Heimnetz samt
Geräteschlüssel und Protokolle. Deine Abrechnungsdaten stehen dort nicht, fürs Backup brauchst du ihn
nicht.

Bis einschließlich Version 0.7.1 lag alles in einer Datei `db.json`. Kommst du von dort, ziehen
deine Daten beim ersten Start von selbst in
`mietfuchs.sqlite` um. Die bisherige Datei heißt danach `db.json.abgeloest` und bleibt als
Rückweg liegen, daneben ein Protokoll. **Sie ist der Stand zum Zeitpunkt des Umzugs und kein
mitlaufendes Abbild**: Was du danach erfasst, steht nur noch in der Datenbank. Der Weg zurück ist
also deine Sicherung, nicht diese Datei. Am Backup ändert sich nichts, es ist weiterhin dieser
Ordner; das Backup über die Oberfläche nimmt die Datenbank mit, und beim Wiederherstellen kommt
sie mit zurück.

**Vor jedem Update der Datenbank legt Mietfuchs selbst eine Sicherung an**
(`mietfuchs.sqlite.vor-…` im Datenordner) und sagt es nach dem Start in der Oberfläche. Wie du
damit zur vorigen Version zurückkommst, steht in [MIGRATION.md](../MIGRATION.md#zurück-zu-einer-älteren-version).

**Wiederherstellen erwartet das Backup-Archiv**, also die ZIP-Datei, und keine einzelne Datei.
Alte Archive ohne Datenbank gehen weiterhin: Mietfuchs baut sie dann aus den wiederhergestellten
Daten neu auf. Wer nur noch eine lose `db.json` von früher hat, packt sie in ein ZIP und stellt
dieses wieder her. Warum das der verlässlichere Weg ist als das Hineinlegen in den Datenordner,
und wo dieser Ordner liegt, steht in [MIGRATION.md](../MIGRATION.md).

**Ab Version 1.0 gilt eine Kompatibilitätszusage**: Jedes Backup aus 1.x lässt sich in jeder späteren
1.x einspielen, ohne Handarbeit, und Datenordner, Umgebungsvariablen, Docker-Image und Exportformate
(JSON, CSV) ändern sich in 1.x nicht ohne Vorwarnung. Der Wortlaut und was bis dahin gilt:
[MIGRATION.md](../MIGRATION.md#kompatibilität-bis-und-ab-10). Welche Exporte gemeint sind, steht im
nächsten Abschnitt, welche Umgebungsvariablen unter
[Installation](installation.md#umgebungsvariablen).

## Exporte und ihre Form

Mietfuchs gibt Daten an drei Stellen als Datei heraus, die du mit anderen Programmen weiterverarbeiten
kannst. Für sie gilt die Zusage „Exportformate ändern sich nicht ohne Vorwarnung“; alles andere, was
Mietfuchs speichert oder druckt (PDF, Belegmappe, die Dateien im Datenordner), ist kein Exportformat.
Das Backup-ZIP fällt unter die Zusage zu den Daten.

In allen CSV-Dateien gilt: UTF-8 mit Byte-Order-Mark, Semikolon als Trennzeichen, Zeilenende CRLF,
Beträge in Euro mit Komma und ohne Tausenderpunkt, die Kopfzeile ist Zeile 1. Ein Textfeld, das eine
Tabellenkalkulation als Formel läse (Beginn mit `=`, `+`, `-` oder `@`), beginnt mit einem Apostroph.

### Abrechnung als JSON (Seite Abrechnung, „Als JSON exportieren“)

Die Datei nennt ihre Form selbst: `"format": "mietfuchs-abrechnung"` und `"version": 1`; `format`
bleibt immer gleich. Beträge sind Cent als ganze Zahlen, Datumsangaben `JJJJ-MM-TT`. Für die Form gilt:

- **Vorhandene Felder behalten Namen, Art und Bedeutung.**
- **Neue Felder können dazukommen**, ohne dass `version` steigt; das
  [Changelog](../CHANGELOG.md) nennt sie. Wer die Datei einliest, prüft `format` und `version` und
  ignoriert Felder, die er nicht kennt.
- **Fällt ein Feld weg, heißt es anders oder bedeutet es etwas anderes, steigt `version`**, und das
  Changelog nennt die Änderung.
- **Texte in Feldern sind Anzeige** und nicht Teil der Zusage: etwa `basisText`, `keyLabel`,
  `prepaymentNote`, `title` eines Fehlers und die Sätze in `heating`. Ihr Wortlaut kann sich ändern;
  rechne mit den Zahlen, nicht mit den Sätzen.

| Feld | Inhalt |
| --- | --- |
| `format`, `version` | Kennung und Fassung der Form. |
| `property` | Objekt: `id`, `name`. |
| `period` | Abrechnungszeitraum: `key`, `from`, `to`, `short`, `label`. |
| `deadline` | Ende der Abrechnungsfrist. |
| `closed` | `null` bei einer offenen Abrechnung, sonst `closedAt` und `sentAt`. |
| `draft`, `errors` | Eine offene Abrechnung mit Fehlern ist ein Entwurf; `errors` nennt sie mit `code` und `title`. |
| `totalCostsCents` | Gesamtkosten des Zeitraums. |
| `statements` | Je Mietverhältnis: `tenancyId`, `unitId`, `unitName`, `tenantName`, `persons`, `days`, `periodStart`, `periodEnd`, `rows`, `totalShareCents`, `total35aCents`, `prepaymentCents`, `balanceCents` (positiv ist ein Guthaben, negativ eine Nachzahlung), `prepaymentOverridden`, `suggestedMonthlyCents`, `heatingPrepaymentCents`, `prepaymentNote`, `scope`, `heatingOnly`, `recommendedDeadline`, `adjustment`. |
| `rows` (je Zeile) | `costItemId`, `category`, `description`, `totalCents`, `kind`, `key`, `keyLabel`, `basisText`, `shareCents`, `labor35aCents`. |
| `landlord` | Anteil des Vermieters: `totalCents`, `rows`. |
| `heating` | Die Angaben der Heizkostenabrechnung je Heizanlage (§ 6a HeizkostenV, CO₂, Vorrat, Lieferungen); leer ohne Heizanlage. |

Ein vollständiges Beispiel der Fassung 1 liegt im Quellcode:
[abrechnung-v1.json](../server/test/fixtures/export/abrechnung-v1.json). Ein Test vergleicht den Export
Feld für Feld damit und unterscheidet, ob ein Feld fehlt oder seine Art geändert hat (neue Fassung),
ob eines dazugekommen ist (erlaubt) oder ob sich nur eine Zahl geändert hat.

### Abrechnung als CSV (Seite Abrechnung, „Als CSV exportieren“)

Eine Zeile je Position und Mieter, danach je Mieter die Summen. Die Spalten:

`Mieter;Wohnung;Zeitraum von;Zeitraum bis;Zeile;Kostenart;Beschreibung;Gesamtkosten;Schlüssel;Basis;Anteil;davon Lohnanteil § 35a`

Rechnet das Objekt Kosten einer Gemeinschaft ab, heißt die achte Spalte `Gesamtkosten bzw. Anteil an
der Gemeinschaft`. Die Spalte `Zeile` sagt, was die Zeile ist: `Position`, die Art einer Sonderzeile
(etwa `CO₂-Anteil des Vermieters`), `Summe Ihrer Kosten`, `Geleistete Vorauszahlungen` und zuletzt
`Nachzahlung`, `Guthaben` oder `Ausgeglichen`. Hinweise (Entwurf, Verweis auf das JSON bei
Heizungsangaben) stehen am Ende nach einer Leerzeile.

### Belege für die Steuer (Seite Belege, ZIP)

Das ZIP enthält die Belege in einem Ordner je Gruppe der Anlage V und zwei CSV-Dateien. **Ihre Form
kann sich mit Ankündigung im Changelog ändern**, etwa wenn ein neuer Vordruck der Anlage V eine weitere
Spalte verlangt; eine Fassungsnummer tragen sie nicht.

`Übersicht.csv`, eine Zeile je Position:

`Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung`

Nur wenn es so einen Teil gibt, stehen vor `abziehbar (EUR)` zusätzlich die Spalten
`unentgeltlich § 21 Abs. 2 EStG (EUR)` (verbilligte Vermietung) und `verteilt § 82b EStDV (EUR)`
(verteilter Erhaltungsaufwand), in dieser Reihenfolge.

`Einnahmen.csv`, eine Zeile je Mietverhältnis und eine Summenzeile (hier für 2025, das Jahr steht in
zwei Spaltennamen):

`Wohnung;Mieter;Beginn;Ende;an Angehörige vermietet;Miete ohne Umlagen (EUR);davon Inklusivmiete (EUR);davon ohne vereinbarte Miete (EUR);Umlagen laufend (EUR);davon Pauschale (EUR);Abrechnung Nachzahlung/Erstattung (EUR);Mieten für frühere Jahre (EUR);Einnahmen 2025, Summe der Zeilen (EUR);darin aus dem Vorjahr nach der Zehn-Tage-Regel (EUR);nicht darin, zählt im Folgejahr nach der Zehn-Tage-Regel (EUR);gezahlt 2025 laut Datum, zum Abgleich mit dem Kontoauszug (EUR)`
