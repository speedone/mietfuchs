# Teil 1: Objekte (#92)

Teil des Vorhabens #91 „Mehrere Objekte und alle gelebten Formen privater Vermietung“. Die
Recherche dahinter und die Gesamtrichtung stehen in #91. Hier steht, was Teil 1 baut und warum.

## Ziel

Eine Installation verwaltet mehrere **Objekte**: Mehrfamilienhäuser, vermietete
Eigentumswohnungen, Einfamilienhäuser, Sonstiges (Garagenhof). Jedes Objekt ist eine eigene
Abrechnungseinheit mit eigener Abrechnung, eigenem Mietkonto, eigener Verbrauchs- und
Steuerübersicht.

## Zwei Zusagen, die jede Entscheidung unten binden

1. **Wer ein Haus vermietet, merkt nichts.**
   - Nach dem Update steht der Bestand in „Objekt 1“, benannt wie bisher das Haus.
   - Der Objekt-Umschalter erscheint erst ab dem zweiten Objekt.
   - Es kommen keine Pflichtfelder hinzu.
   - Abrechnung, Mietkonto, Steuer und Verbrauch sind **centgenau** dieselben, und der
     Ausdruck ist derselbe.
2. **Der Umstieg läuft von selbst.** Der Drizzle-Schritt 0001 wird beim Start angewendet, wie
   jeder Schritt. Vorher legt Mietfuchs eine Sicherung daneben.

## Nicht in Teil 1

- Vorverteilung über Objekte (#95)
- besondere Verteilbasen (MEA, Messdienst; #94)
- Kopfangaben der Anlage V und Steuer-Gesamtsicht (#96)
- Nebenkostenmodell am Mietverhältnis (#93)
- Mieter als eigene Person über Objekte hinweg

Die Objektart wird in Teil 1 gespeichert und angezeigt, steuert aber noch nichts. Ihre Wirkung
kommt mit #94.

## Datenmodell

### Neue Tabelle `properties`

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | text PK | Kennung wie bei allen anderen Sammlungen (`newId`); Objekt 1 aus dem Umstieg heißt `objekt-1` |
| `name` | text, not null | Anzeigename, bisher `settings.house_name` |
| `kind` | text, not null, CHECK | `mfh` · `etw` · `efh` · `sonstiges`, Voreinstellung `mfh` |
| `address` | text, not null | bisher `settings.address` |
| `landlord_name` | text, null | abweichender Vermieter; `null` = Vorgabe aus den Einstellungen |
| `iban` | text, null | abweichende Bankverbindung; `null` = Vorgabe |
| `payment_deadline_days` | integer, null, ≥ 0 | abweichende Zahlungsfrist; `null` = Vorgabe |

Warum die drei Felder `landlord_name`, `iban` und `payment_deadline_days` abweichend sein dürfen
und nicht Pflicht sind: Wer ein Haus hat, pflegt sie weiter an einer Stelle, nämlich in den
Einstellungen. Nur wer ein Objekt mit anderem Eigentümer oder Konto hat, etwa das Haus der
Eltern oder eine Erbengemeinschaft, trägt dort etwas ein. `null` und die leere Zeichenkette
sind verschieden: `null` heißt „Vorgabe“, eine leere IBAN heißt „bewusst keine“. Das ist
dieselbe Regel wie beim Zusammenführen in repository.ts (Anwesenheit eines Schlüssels statt
seines Werts).

### Objektbezug

| Tabelle | Spalte | Löschverhalten | Grund |
|---|---|---|---|
| `units` | `property_id` not null → properties | `RESTRICT` | Ein Objekt mit Wohnungen darf nicht verschwinden, und schon gar nicht mitsamt Mietverhältnissen und Zahlungen. |
| `meters` | `property_id` not null → properties | `RESTRICT` | Hauptzähler haben keine Wohnung, sie brauchen das Objekt selbst. |
| `cost_items` | `property_id` not null → properties | `RESTRICT` | Eine bezahlte Rechnung gehört zur Vergangenheit eines Objekts, dieselbe Überlegung wie bei `direct_unit_id → SET NULL`. |
| `closed_settlements` | `property_id` not null → properties | `RESTRICT` | Das Archivstück einer versandten Abrechnung. |

Mietverhältnisse, Staffeln, Zahlungen, Ablesungen und vereinbarte Anteile **erben** das Objekt
über Wohnung, Zähler bzw. Kostenposition. Sie bekommen keine eigene Spalte, sonst gäbe es zwei
Wahrheiten, die auseinanderlaufen können.

Löschen eines Objekts geht also nur, solange es leer ist. Die Oberfläche sagt, was noch darin
steht. Das letzte Objekt lässt sich nie löschen: Es gibt immer mindestens eins, weil eine neue
Wohnung ein Objekt braucht.

### Eindeutigkeit

- `closed_settlements`: der eindeutige Index wandert von `(year)` auf `(property_id, year)`.
- Heute filtern `findClosedSettlement`, `setSentAt` und `reopenSettlement` nur nach dem Jahr.
  Mit zwei Objekten träfen sie die Abrechnung des falschen Hauses. Alle drei bekommen das
  Objekt als Pflichtparameter.
- Der Index `cost_items(year)` wird zu `(property_id, year)`, denn das ist die Abfrage des
  Schnappschusses.

### Kein Verweis über Objektgrenzen

Dürfen nicht auf eine Wohnung eines **anderen** Objekts zeigen:

- ein Zähler mit Wohnung,
- eine Direktzuordnung einer Kostenposition,
- ein vereinbarter Anteil,
- das Verschieben einer Wohnung durch Ändern ihres `property_id`, solange etwas an ihr hängt.

Zusammengesetzte Fremdschlüssel (`(property_id, unit_id) → units(property_id, id)`) scheiden
aus. `direct_unit_id` verlangt `ON DELETE SET NULL`, und SQLite setzt dabei **alle** Spalten des
Schlüssels auf NULL, also auch das Pflichtfeld `property_id`. Die Zusicherung steht deshalb an
zwei Stellen:

1. **In `repository.ts`, an einer Stelle** (`sameProperty`), aufgerufen von jedem
   Schreibvorgang, der einen Wohnungsverweis setzt. Verstöße werden eine 400 mit deutschem Satz.
2. **Als Prüfung nach jedem Migrationsschritt und beim Wiederherstellen:** eine Abfrage, die
   Verweise über Objektgrenzen zählt, analog zu `PRAGMA foreign_key_check`. Datenbank-Trigger
   wären die strengere Form, aber drizzle-kit erzeugt sie nicht. Sie gehörten in einen von Hand
   geschriebenen Schritt, und davon soll es so wenige wie möglich geben (siehe Migration).

Ein Wohnungswechsel des Mietverhältnisses (`tenancies.unit_id`) über Objektgrenzen ist
**erlaubt**: Das Mietverhältnis hängt dann ganz am neuen Objekt, einen zweiten Verweis gibt es
nicht.

### Einstellungen

- `settings.house_name` und `settings.address` **bleiben als Spalten stehen**, werden aber nach
  dem Umstieg nicht mehr gelesen.
  - Grund: Der eingefrorene Eingang (`server/src/legacy/`, Stand 0000) schreibt sie beim Import
    einer alten `db.json`, und Schritt 0001 liest sie von dort ab. Sie zu löschen bräuchte einen
    Neubau der Einstellungstabelle, um zwei Spalten zu sparen, und brächte keinen Gewinn.
  - Der Typ `Settings` in shared/types.ts behält die Felder, weil er auch das Format der
    `db.json` beschreibt.
  - `GET /api/settings` liefert sie nicht mehr aus, `PUT` nimmt sie nicht mehr an. Ein
    unbekanntes Feld hat damit wieder keinen Ort, wie nach #60.
- `landlordName`, `iban` und `paymentDeadlineDays` bleiben in den Einstellungen und sind die
  **Vorgabe** für jedes Objekt.
- Alles übrige (KI, Update, Druckoptionen) bleibt installationsweit.

## Migration 0001

Sie wird wie jeder Schritt mit `npm --prefix server run db:generate` aus schema.ts erzeugt.
Ein Aufbau-Schritt allein kann aber nicht wissen, **welches** Objekt die vorhandenen Zeilen
bekommen: drizzle-kit baut die Tabellen neu und kopiert die Spalten, die es kennt. Die neue
Pflichtspalte hätte keinen Wert.

Deshalb gilt für diesen Schritt:

1. **Der Aufbau wird erzeugt**, nie von Hand geschrieben.
2. **Die Daten kommen als Anweisungen in denselben Schritt**, vor die Kopien:
   - Objekt 1 anlegen, Name und Adresse aus der Zeile der Einstellungen. Fehlt die Zeile, was
     auf einem frischen Rechner die Regel ist, gelten die leeren Vorgaben.
   - Die Kopien bekommen `'objekt-1'` für `property_id`.

   Erlaubt ist das, weil ein Schritt geändert werden darf, solange er die Arbeitskopie nicht
   verlassen hat (server/drizzle/README.md). Das README bekommt dafür einen eigenen Absatz:
   **Aufbau immer erzeugt, Daten dürfen ergänzt werden, und zwar nur vor der Veröffentlichung.**
   Ein Test hält die Marke fest wie bei 0000.
3. Ein Schritt läuft in einer Transaktion mit abschließendem `PRAGMA foreign_key_check`
   (`applyMigrations`). Ein fehlender Verweis rollt also zurück, statt festgeschrieben zu werden.

**Eine frische Installation** läuft durch dieselbe Kette: 0000 legt leer an, 0001 legt Objekt 1
an. Es gibt also immer genau dann ein Objekt, wenn es eine Datenbank gibt.

**Der Umstieg aus einer `db.json` bleibt unberührt:** eingefrorener Eingang auf 0000, Import,
Regression, danach die übrige Kette, jetzt samt 0001. Die Regression rechnet weiter auf dem
Stand 0000, also ohne Objekte. `properties` kommt **nicht** in die Liste `COUNTED`, die
entscheidet, ob die Datenbank leer ist. Sonst verhinderte Objekt 1 aus 0001 jeden künftigen
Umstieg.

### Sicherung vor dem Anwenden

Vor dem Anwenden noch fehlender Schritte auf eine Datenbank, die schon Schritte hinter sich hat,
entsteht per `VACUUM INTO` eine Kopie `mietfuchs.sqlite.vor-<tag>`. Das gilt für jeden künftigen
Schritt, nicht nur für 0001.

- `tag` ist der Name des ersten fehlenden Schritts, z. B. `0001_…`.
- **Nicht** auf einer frischen Datenbank, weil dort nichts zu sichern ist, und **nicht** im
  Umstieg, der ohnehin eine eigene Datei baut.
- Ist die Kopie schon da, weil ein früherer Versuch gescheitert war, bleibt sie stehen. Sie
  ist der ältere, also sicherere Stand.
- Scheitert die Sicherung, zum Beispiel wegen voller Platte, wird **nicht** migriert. Die
  Meldung sagt das, wie beim Schreibschutz: Nichts anfassen, was man nicht zurückholen kann.

### Nachgerechnet

Ein Test baut Datenbanken mit gewachsenem Bestand auf Stand 0000, nämlich aus den
Golden-Fixtures, wendet die Kette an und vergleicht für jedes Jahr die vier Rechnungen
(Abrechnung, Mietkonto, Steuer, Verbrauch) **vor** und **nach** dem Schritt, centgenau, mit
`regression.ts`. Vor dem Schritt heißt: ganzer Bestand ohne Objekt. Nach dem Schritt heißt:
Objekt 1.

## Berechnung: der Schnappschuss

`calc.ts` ändert sich nicht. Es rechnet über das, was im Schnappschuss steht, und darf nur die
Daten **eines** Objekts sehen.

- Neu in `snapshot.ts`: **`narrowToProperty(source, propertyId)`**. Es ist die einzige Stelle,
  die eine `SnapshotSource` auf ein Objekt eingrenzt:
  - Wohnungen, Zähler und Kostenpositionen über ihr `propertyId`,
  - Mietverhältnisse über ihre Wohnung,
  - Zahlungen über ihr Mietverhältnis,
  - Ablesungen über ihren Zähler,
  - abgeschlossene Abrechnungen über ihr `propertyId`.
- `snapshotOf(source, year)` bleibt, wie es ist. Die Regel „nur Kosten und abgeschlossene
  Abrechnung nach Jahr“ steht weiter nur dort.
- Der `Snapshot` trägt `propertyId: string | null`. `null` ist ein Bestand ohne Objekte, also
  der Stand 0000 in Regression und Umstieg. Eine Route darf nur Schnappschüsse mit Objekt
  rechnen. `snapshotFor(stock, propertyId, year)` ist in index.ts der einzige Weg dorthin, wie
  heute `readData` für die Datenbank.
- **Eine Invariante ergänzt die drei aus calc.test.ts:** Für zufällige Bestände mit zwei
  Objekten ist jede Rechnung je Objekt gleich der Rechnung über einen Bestand, der **nur** aus
  diesem Objekt besteht. Das ist genau der Fehler, der sonst still bliebe: ein Filter, der
  fehlt, und Kosten, die über zwei Häuser verteilt werden.

## API

**Neue Routen:** `GET /api/properties`, `POST /api/properties`, `PUT /api/properties/:id`,
`DELETE /api/properties/:id`.

- `DELETE` antwortet mit 409 und einer Aufzählung, wenn noch etwas daran hängt, und ebenso beim
  letzten Objekt.

**Eingrenzen: ein Abfrageparameter `property`** an allen Datenrouten, also an
`GET /api/{units,tenancies,costItems,meters,readings,payments}`, an
`/api/settlement/:year` samt `close`, `/api/consumption/:year`, `/api/rentledger/:year` und
`/api/taxreport/:year`.

- **Fehlt er, und es gibt genau ein Objekt, gilt dieses.** Ein Tab von vor dem Update und jedes
  Skript (Smoke-Test, Praxislauf) arbeiten dadurch unverändert weiter.
- **Fehlt er bei mehr als einem Objekt, antwortet die Route mit 400** („Welches Objekt? …“),
  statt still alle zu liefern. Eine Liste über zwei Häuser sähe auf der Seite Kosten plausibel
  aus und wäre falsch.
- Ein unbekanntes Objekt ergibt 404.

**Beim Anlegen** von Wohnung, Zähler und Kostenposition gilt dieselbe Regel für
`propertyId` im Rumpf: fehlt es, gilt das einzige Objekt, sonst 400. Mietverhältnis, Zahlung und
Ablesung brauchen keins, sie erben.

**Ändern:** `PUT` einer Wohnung mit anderem `propertyId` ist nur erlaubt, solange weder Zähler
noch Direktzuordnungen noch vereinbarte Anteile an ihr hängen (siehe `sameProperty`).

**Unverändert installationsweit:** `/api/uploads` und `/api/backup` bzw. `/api/restore`.

## Oberfläche

- **`PropertyProvider`** nach dem Muster von `YearProvider`:
  - Er lädt `/api/properties`.
  - Er merkt sich das gewählte Objekt in `localStorage` (mit try/catch, eine Annehmlichkeit je
    Browser).
  - Voreinstellung ist das erste Objekt.
  - Wird das gewählte Objekt gelöscht, fällt die Wahl auf das erste zurück.
- **Umschalter** in der Seitenleiste über dem Jahr, **nur bei mehr als einem Objekt**. Die
  Seitenleiste zeigt den Namen des gewählten Objekts, wo heute `settings.houseName` steht.
- **Seiten** geben das gewählte Objekt als `property` an ihre Abrufe:
  - Cockpit, Schnellerfassung, Zähler, Kosten, Mietkonto, Abrechnung, Übersicht, Steuer und
    Stammdaten laden neu, wenn es wechselt.
  - Belege und Einstellungen bleiben installationsweit.
  - Eine kleine Hilfsfunktion baut die Adresse, damit der Parameter nicht an zwanzig Stellen
    von Hand angehängt wird.
- **Stammdaten:**
  - Die bisherige Karte „Haus“ wird zur Karte „Objekt“: Name, Adresse, Art, dazu aufklappbar
    „Abweichender Vermieter oder Bankverbindung“ mit Vermietername, IBAN und Zahlungsfrist.
  - Darunter unauffällig „Weiteres Objekt anlegen“, und, sobald es mehr als eins gibt,
    „Objekt löschen“, nur bei leerem Objekt.
- **Druck:** Kopf, IBAN und Zahlungsfrist in Abrechnung und Steuer kommen aus dem Objekt, bei
  `null` aus den Einstellungen. Die Regel steht einmal, als `effectiveLandlord(property,
  settings)` im Client. Die Druckausgabe wird für die Abrechnung serverseitig nicht erzeugt,
  also braucht es sie nur dort.
- **Einstellungen:** Vermietername, IBAN und Frist heißen dort jetzt „Vorgabe für alle
  Objekte“. Der Satz dazu erscheint nur bei mehr als einem Objekt.

## Backup und Wiederherstellen

Keine Änderung am Format: eine `mietfuchs.sqlite` im Archiv.

- Ein Archiv von vor 0001 wird beim Wiederherstellen durch dieselbe Kette gehoben. Die
  Sicherung `vor-<tag>` entsteht dabei nicht, denn die bisherige Datei wandert ohnehin als
  `.vor-restore` beiseite.
- Archive mit nur einer `db.json` laufen wie bisher über `runChangeover`.
- Nach dem Wiederherstellen läuft die Prüfung auf Verweise über Objektgrenzen mit. Ein Archiv,
  das sie verletzt, wird abgelehnt, bevor es die bisherige Datei ersetzt.

## Fehler und Meldungen

Jede neue Ablehnung ist ein deutscher Satz mit dem, was zu tun ist:

- 400 für ein fehlendes Objekt,
- 409 für ein Objekt, das nicht leer ist, mit der Aufzählung „3 Wohnungen, 1 Hauptzähler, 12
  Kostenpositionen“,
- 400 für einen Verweis über Objektgrenzen („Der Zähler gehört zu Objekt ‚Musterstraße 1‘,
  die Wohnung zu ‚Gartenweg 3‘.“).

Verletzte Zusicherungen der Datenbank laufen weiter durch `databaseProblem` in errors.ts.

## Tests (TDD, in dieser Reihenfolge)

1. **Schema und Migration** (`migrations.test.ts`, neuer Test `db-objekte.test.ts`):
   - Marke von 0001.
   - Eine Datenbank auf 0000 mit Bestand bekommt Objekt 1 mit Name und Adresse, alle Zeilen
     tragen es.
   - Ohne Einstellungszeile entsteht Objekt 1 mit leeren Feldern.
   - Eine frische Datenbank hat genau ein Objekt.
   - Die Sicherung `vor-<tag>` entsteht nur, wenn sie soll, und blockiert, wenn sie nicht
     geschrieben werden kann.
2. **Nachgerechnet:** Golden-Fixtures auf 0000, danach die Kette, centgenau gleich (regression.ts).
3. **Schnappschuss:**
   - `narrowToProperty` je Sammlung.
   - Neue Invariante in `calc.test.ts` mit zwei Objekten, zufällig erzeugt, fester Startwert.
   - `snapshotFor` lehnt `null` ab.
4. **Repository:**
   - Abgeschlossene Abrechnungen je (Objekt, Jahr): Das falsche Objekt wird nicht versandt und
     nicht wieder geöffnet.
   - `sameProperty` an jedem Schreibweg.
   - Löschen nur bei leerem Objekt.
   - Das letzte Objekt bleibt.
5. **API** (`api.test.ts`):
   - `/api/properties` CRUD.
   - `property` fehlt bei einem Objekt: geht. Bei zwei: 400. Unbekannt: 404.
   - Zwei Objekte, dieselbe Jahreszahl: getrennte Abrechnungen, getrennte Abschlüsse.
   - Settings ohne `houseName`.
6. **Client** (vitest):
   - `PropertyProvider` mit Rückfall bei gelöschtem Objekt.
   - Kein Umschalter bei einem Objekt, ein Umschalter bei zweien.
   - `effectiveLandlord` mit Vorrang Objekt vor Vorgabe und `''` gegen `null`.
   - Eine Seite (Kosten) gibt `property` weiter.
7. **Ganz außen:**
   - `smoke-test.mjs` unverändert grün, das beweist die Zusage „ein Objekt, kein Parameter“.
   - `umstieg-praxislauf.mjs` mit einem Fall „Datenbank von v0.8.0, Update auf diese Version“.
8. `npm run typecheck`, `npm test`, `npm run build`.

## Dokumentation

- **CLAUDE.md:** das Zielbild aus #91 statt „kleines Mehrfamilienhaus … Heizung derzeit nicht“;
  Abschnitte Datenbank (Objekte, Eingrenzen, `narrowToProperty`), Migrationen (Datenanteil)
  und API (`property`).
- **server/drizzle/README.md:** der Absatz über Datenanweisungen.
- **CHANGELOG.md, „Unveröffentlicht“:** mehrere Objekte, Sicherung vor Migrationen, Behebung
  der Abschlüsse je Jahr ([#92](https://github.com/speedone/mietfuchs/issues/92)).
