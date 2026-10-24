# Änderungsjournal und Verlauf (#318, Schritte 2 und 3)

Schritt 1 (Vorversionen) ist mit #416 in `main`. Dieser Entwurf legt fest, wie Mietfuchs jede Änderung am
Bestand festhält (Schritt 2) und wie man sie liest (Schritt 3). Rückgängig (Schritt 4) und der Papierkorb für
Belege (Schritt 5) kommen später; das Journal muss sie tragen, deshalb steht bei jeder Entscheidung, was sie
für Schritt 4 bedeutet.

## Leitsatz

Der Bestand bleibt die Quelle, das Journal steht daneben. Keine Berechnung liest es, keine Zahl hängt daran;
Goldens und Invarianten bleiben unverändert.

## Tabellen

Zwei echte Tabellen im Schema (Schritt 0069, erzeugt mit `db:generate`, ohne Datenanweisung):

- **`change_groups`**: `id` (INTEGER, aufsteigend, damit die Reihenfolge ohne Uhr feststeht), `at` (ISO-Zeit),
  `method`, `route` (Muster der Route, etwa `DELETE /api/units/:id`), `description` (ein Satz je Route, siehe
  unten), `subject_table` (die Tabelle, um die es der Route geht, für die Überschrift beim Lesen),
  ~~`property_id`~~ (entfallen, siehe „Nach der Durchsicht“), `schema_steps` (Zahl der angewendeten Migrationsschritte zur
  Zeit der Gruppe).
- **`change_log`**: `id`, `group_id` (Fremdschlüssel, `ON DELETE CASCADE`), `table_name`, `row_key` (JSON der
  Primärschlüsselspalten, ohne Primärschlüssel die `rowid`), `op` (`insert`, `update`, `delete`), `before`,
  `after` (JSON über **alle** Spalten, `json_object`).

`property_id` hat keinen Fremdschlüssel: Ein gelöschtes Objekt soll im Verlauf stehen bleiben, und `SET NULL`
nähme der Gruppe genau die Angabe, nach der man sie sucht. `schema_steps` ist die Naht für die Grenze aus dem
Issue „Rückgängig nur seit der letzten Migration“: Schritt 4 vergleicht die Zahl mit der heutigen.

## Trigger: TEMP, beim Öffnen angelegt

Die Trigger stehen **nicht in der Datei**, sondern entstehen bei jedem Öffnen als `TEMP TRIGGER` auf den
Tabellen von `main` (`ensureJournal` in server/src/db/journal.ts, nach `applyMigrations`). Je Tabelle drei
(AFTER INSERT, UPDATE, DELETE), die Spaltenliste aus `PRAGMA table_info`, also aus dem Aufbau, den die Datei
gerade hat. Ausgenommen sind nur die Journaltabellen selbst, `__drizzle_migrations` und `sqlite_*`.

Abgewogen gegen Trigger per Migration:

- **Ein Neubau verliert keine Trigger.** drizzle-kit baut eine Tabelle neu (CREATE `__new_x`, kopieren, DROP,
  RENAME), sobald sich eine Bedingung ändert. Ein Trigger in der Datei fiele dabei weg, und jeder solche Schritt
  bräuchte eine Datenanweisung, die ihn neu anlegt, samt neuer Spaltenliste. Vergessen hieße: still keine
  Erfassung mehr für diese Tabelle. TEMP-Trigger entstehen nach der Kette neu, mit den Spalten von heute.
- **Die Migrationsschritte selbst und ihre Datenanweisungen werden nicht erfasst**, denn beim Anwenden gibt es
  die Trigger noch nicht. Das ist gewollt: Ein Migrationsschritt ist keine Handlung des Vermieters, und
  rückgängig machen ließe er sich ohnehin nicht (Grenze aus dem Issue).
- **Backup, Vorversion und `VACUUM INTO` tragen keine Trigger**, nur die Daten. Der eingefrorene Eingang
  (legacy) und der Umstieg schreiben in eine eigene Verbindung ohne Trigger; dort ändert sich nichts.
- **Der Wächter** (journal.test.ts) liest nach dem Öffnen `sqlite_master` und `sqlite_temp_master` und verlangt
  für jede Tabelle des Schemas außer den Ausnahmen drei Trigger, deren Spaltenliste alle Spalten nennt. Eine
  künftige Tabelle ist ohne Zutun dabei; ein Test nach einem nachgestellten Neubau hält fest, dass die Trigger
  beim nächsten Öffnen wieder da sind.

## Die Gruppe kommt aus der Schlange

Eine TEMP-Tabelle `journal_current` mit genau einer Zeile hält die Kennung der laufenden Gruppe. Die Trigger
erfassen nur, wenn sie nicht `NULL` ist (`WHEN`), und schreiben sie in `change_log.group_id`.

- `opened.write(work, journal)` nimmt eine optionale Angabe zur Gruppe. Mit ihr legt die Schlange vor dem Rumpf
  die Gruppe an und setzt `journal_current`, danach (im `finally`) leert sie `journal_current`, bestimmt das
  Objekt und löscht die Gruppe, wenn keine Zeile erfasst wurde. Eine zurückgerollte Transaktion nimmt ihre
  Zeilen mit, die leere Gruppe fällt dann weg.
- **Ohne Angabe wird nichts erfasst.** Entschieden gegen eine Gruppe „ohne Zuordnung“: Was ohne Anfrage
  schreibt, ist Systemarbeit (Prüfsummen der Belege nachtragen, Vorversion, Schnappschuss fürs Backup), keine
  Handlung, die jemand zurücknehmen wollte, und eine solche Gruppe stünde im Verlauf als Rauschen.
- `writeData` in index.ts reicht die Angabe aus der laufenden Anfrage (AsyncLocalStorage, gesetzt nach
  `express.json()` und erneut nach multer, denn beide rufen `next` aus einem fremden Kontext). **Eine Anfrage ist
  eine Gruppe**: Ruft eine Route `writeData` zweimal, landen beide Teile in derselben Gruppe.
- Die Beschreibung ist ein Satz je Route (`journalRoutes.ts`, „Wohnung gelöscht“, „Mieterwechsel“), für die
  allgemeinen Routen aus dem Namen der Sammlung gebildet. Eine Route ohne Satz bekommt „Änderung (Methode
  Pfad)“; ein Test verlangt für jede schreibende Route einen Satz.
- **Das Objekt** bestimmt `propertyOfGroup` aus den erfassten Zeilen: `property_id` der Zeile, sonst über die
  Fremdschlüssel zum Elternteil (aus derselben Gruppe, etwa der eben gelöschten Wohnung, sonst aus dem Bestand).
  Ein Objekt: dessen Kennung; keines oder mehrere: `NULL` (installationsweit, etwa die Einstellungen).

## Größe

- Belege sind Dateien und keine Zeilen; erfasst wird nur ihre Beschreibung in `uploads`.
- **Der eingefrorene Stand einer Abrechnung** (`settlement` in `closed_settlements`,
  `closed_settlement_history`, `closed_heating_settlements`, `closed_heating_settlement_history`) wird nicht
  kopiert, sondern als `{"$omitted": true, "length": N}` vermerkt. Er ist das größte Feld des Bestands und
  ändert sich nie: Abschließen legt ihn an, Wieder öffnen verschiebt ihn in den Verlauf, wo er erhalten bleibt.
  Für Schritt 4 heißt das: Das Abschließen lässt sich zurücknehmen (die Zeile löschen), das Wiederöffnen nicht
  über das Journal, wohl aber über den Verlauf der Abschlüsse; so sagt es auch das Issue.
- Alle übrigen Spalten stehen vollständig im Vorher-Stand, damit Schritt 4 jede Zeile wiederherstellen kann.

## Aufbewahrung und Datenschutz

- **12 Monate** (`JOURNAL_KEEP_MONTHS`): Beim Start löscht der Server ältere Gruppen samt Zeilen.
- **Das Journal enthält Namen, Anschriften und IBANs**, auch von gelöschten Mietverhältnissen, bis zu 12 Monate
  lang. Ein endgültiges Löschen eines ehemaligen Mieters, das auch das Journal bereinigt, gibt es in Mietfuchs
  noch nicht; das ist eine **Grenze** und gehört zu einer eigenen Funktion.
- **Backup**: Das Journal kommt nur ins Archiv, wenn der Vermieter es wählt („Verlauf der Änderungen
  mitsichern“, `GET /api/backup?journal=1`). Ohne die Wahl leert der Server die beiden Tabellen im Schnappschuss,
  bevor er gepackt wird. Begründung: Ein Backup wird weitergegeben (Steuerberater, neuer Rechner, Cloud-Ordner),
  und der Verlauf trägt gelöschte Personendaten, die dort niemand erwartet. Ein Archiv ohne Journal ergibt beim
  Wiederherstellen ein leeres Journal; das Journal des laufenden Bestands liegt dann in
  `mietfuchs.sqlite.vor-restore`.
- **Vorversionen enthalten das Journal immer** (sie sind eine vollständige Kopie der Datei und bleiben im
  Datenordner). Folge: Gelöschte Personendaten liegen dort bis zu vier Wochen länger, als das Journal sie hält.

## Leistung

Wiederherstellen, Umstieg und Vorversion ersetzen oder kopieren die Datei, dort laufen keine Trigger. Ein
Schreibvorgang mit vielen Zeilen (Zeitraumwechsel, Belegbuchung) wird erfasst, denn gerade ihn will man
zurücknehmen können. Gemessen im PR: 5000 Ablesungen in einem Schreibvorgang mit und ohne Journal, und die
Laufzeit des vollen Server-Testlaufs vorher und nachher.

## Lesen

- `GET /api/journal?property=…&before=…&limit=…`: Gruppen des Objekts und installationsweite, neueste zuerst,
  je mit Zeit, Beschreibung, Überschrift (Satz plus Bezeichnung der betroffenen Zeile, etwa „Wohnung gelöscht:
  EG links“) und Zahl der Zeilen; `before` ist die Kennung, ab der weitergeblättert wird.
- `GET /api/journal/:id`: die Zeilen der Gruppe mit Tabelle, Art, Vorher und Nachher.
- Seite **„Verlauf“** unter „Einrichten“: Liste, Aufklappen zeigt je Zeile die geänderten Felder mit den
  Feldnamen der Oberfläche, wo es sie gibt (client/src/journalView.ts), sonst den Spaltennamen. Kein Rückgängig.

## Nach der Durchsicht von PR #430

Zwei Entscheidungen oben sind überholt; der Code und server/src/db/CLAUDE.md gelten.

- **Die Gruppe legt der erste Trigger an** (statt die Schlange vor der Arbeit): Anlegen und Objekt bestimmen kosteten
  zwei Festschreibungen je Anfrage und verdoppelten die Zeit von 300 `PUT`. Jetzt schreibt die Schlange nur in die
  TEMP-Tabelle; die Gruppe entsteht in der Transaktion der Arbeit, ohne Änderung gar nicht. Eingefügt wird mit
  `WHERE NOT EXISTS`, nicht mit `INSERT OR IGNORE`, denn im Rumpf eines Triggers gilt die Konfliktregel des äußeren
  Befehls (ein Upsert machte daraus ABORT). `change_groups` hat deshalb **keine Spalte für das Objekt** mehr.
- **Das Objekt bestimmt der Verlauf beim Lesen**: über Vorher- und Nachher-Bild (Objektwechsel: bei beiden), über die
  Fremdschlüssel bis in die jüngste Fassung im Journal; installationsweit ist auch eine Gruppe, die ein Objekt löscht
  oder deren Objekt nicht mehr besteht.
- Erfasst wird nur eine Route mit Satz; Hintergrundarbeit startet ohne den Kontext der Anfrage. Gruppen, die nach dem
  Zusammenfassen nichts ändern, entfallen. Aufgeräumt wird auch im täglichen Takt der Vorversion; `secure_delete = FAST`.

## Bewusst offen

- Schritt 4 (Rückgängig als Stapel) und Schritt 5 (Papierkorb für Belege).
- Endgültiges Löschen eines ehemaligen Mieters samt Journal.
- Zwei Anfragen, deren Schreibvorgänge sich abwechseln, haben verschränkte Gruppen; Schritt 4 muss vor dem
  Zurücknehmen prüfen, ob spätere Gruppen dieselben Zeilen berührt haben.
