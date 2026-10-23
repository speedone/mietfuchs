# Die Datenbank

SQLite (#55), Schema in [schema.ts](schema.ts), geöffnet in [open.ts](open.ts), geschrieben über
[repository.ts](repository.ts). Die Grenze zur Berechnung zieht der Schnappschuss
(server/src/snapshot.ts); ein zweites Backend (PostgreSQL) wäre eine neue Datei, kein Umbau.

## Treiber und Verbindung

- **Treiber `drizzle-orm/sqlite-proxy`**, bewusst: `better-sqlite3` ist ein natives Modul (nicht für
  alle Ziele in die Bun-Programmdatei einbettbar, #21), und `drizzle-orm/node-sqlite` der
  1.0-Vorabreihe rollt gescheiterte Transaktionen nicht zurück und lässt `NOT NULL` an
  Text-Primärschlüsseln weg. Kommt die stabile 1.0, ist nur [client.ts](client.ts) betroffen.
- **Node und Bun unterscheidet allein client.ts** (`globalThis.Bun`): `node:sqlite` mit
  `setReturnArrays(true)` gegen `bun:sqlite` mit `values()`, dazu die Herkunft der Migrationen.
- **`PRAGMA foreign_keys = ON` je Verbindung**, und `openNode` öffnet mit
  `enableForeignKeyConstraints: false`, damit diese Zeile wirklich die Arbeit tut: Sonst wären die
  Fremdschlüssel unter Node an, unter Bun still aus. open.ts prüft danach, dass der Wert 1 ist.
- **Ohne WAL**, denn `rename` (Umstieg, Wiederherstellen) bewegt nur die Hauptdatei.

## Beim Start

- **Erst prüfen, dann schreiben**: Datenordner beschreibbar (`writable` aus paths.ts),
  Fremdschlüssel aktiv, `PRAGMA integrity_check`, Schreibprobe, und ob die Datei aus einer
  **neueren** Version stammt (eine unbekannte Marke in `__drizzle_migrations`; `unknownSteps`).
  Schreibschutz zweistufig: Die Rechteprüfung weckt nur den Verdacht (sie lügt auf
  Netzlaufwerken), bestätigt wird mit `PRAGMA user_version` auf denselben Wert (`BEGIN IMMEDIATE`
  taugt nicht, SQLite sperrt erst beim ersten Schreiben). **Eine beschädigte oder neuere Datei wird
  nie angefasst**, auch nicht beiseitegelegt. Jede Meldung sagt, was los ist und was zu tun ist; die
  Meldung von SQLite steht höchstens am Ende als „Technischer Befund“.
- **Netzlaufwerk = Warnung, kein Abbruch.** Gefragt wird nach dem **wirklichen** Ort (Symlinks
  aufgelöst), unter Linux über `/proc/self/mounts` (längster passender Einhängepunkt, bei gleicher
  Länge der spätere), unter Windows am UNC-Pfad. Die Plattform kommt in `networkLocation` hinein,
  gerechnet mit `path.win32`/`path.posix` (`path.posix.dirname` eines UNC-Pfads ergibt „.“). Nicht
  erkannt: verbundene Laufwerke (Z:), macOS, VM-Freigaben.
- **Scheitert das Öffnen oder der Umstieg, startet der Server trotzdem, aber ohne Daten**: Die
  Datenrouten antworten **503** statt mit einer leeren Liste, `/healthz` nennt es unter `checks`. Nach
  einem gescheiterten Umstieg ist die Datenbank offen, aber leer; eine leere Antwort wäre dann eine
  falsche Auskunft, und was der Vermieter hineinschriebe, hängte seine `db.json` für immer ab. Die
  Frage „trägt die Datenbank den Bestand?“ steht einmal in [../health.ts](../health.ts)
  (`databaseUnavailable`). Der Umstiegsstand in index.ts ist veränderlich, weil ein eingespieltes
  Backup das Problem beheben kann.
- **Vor dem Anwenden ausstehender Migrationen** legt der Server `mietfuchs.sqlite.vor-<Schritt>` an
  (`backupBeforeMigrating`); scheitert das, wird nicht migriert. Liegt eine gleichnamige schon da,
  wird sie als `….vom-JJJJ-MM-TT-HHMM` beiseitegelegt, nie wiederverwendet.

## Die Schlange

**Alle Zugriffe laufen nacheinander** durch `createLane` in open.ts (`opened.write(...)`,
`opened.read(...)`; in index.ts nur über `readData`/`writeData`, nie `database.db` direkt). Alle
Anfragen teilen **eine** Verbindung: Eine Transaktion mit asynchronem Rumpf gibt die Kontrolle ab,
und ein fremdes Einfügen landete sonst darin und verschwände mit ihr, nachdem es „gespeichert“
gemeldet hat. Deshalb geht **jeder** Schreibvorgang durch die Schlange, Lesevorgänge ebenso (sie
sähen sonst nicht festgeschriebene Stände); ein Lesevorgang **innerhalb** eines Schreibvorgangs läuft
durch. Ein Schreibvorgang im Schreibvorgang **wirft** sofort (nicht als abgelehntes Versprechen,
sonst beendete Node den Prozess). Das Kennzeichen in `AsyncLocalStorage` ist ein veränderliches
Kärtchen, das am Ende ungültig wird, weil Zeitgeber den Speicher überleben. Nach 30 Sekunden gibt
es eine Meldung, abgebrochen wird nie.

**Eine zweite Verbindung auf die Datei gibt es nur in Tests**, und die Schlange ordnet sie nicht.
Ohne WAL und ohne `busy_timeout` scheitert ein Schreiben dort sofort mit „database is locked“, wenn
der Server gerade liest. Öffne sie deshalb mit `besideServer` aus server/testing/api.ts (wartet bis
zu fünf Sekunden), wie `inDatabase` es tut. Die Hauptverbindung des Servers bekommt kein
`busy_timeout`: Im Betrieb gibt es keinen zweiten Schreiber, und ein Warten dort verdeckte genau den
Fehler, dass doch einer dazukam. Und die Startzeile „läuft auf …“ kommt erst nach der Vorversion
beim Start, denn wer auf sie wartet, hält den Server für fertig.

## Schema

- **Verschachtelte Listen sind Tabellen** (Staffeln, Jahreskorrektur, vereinbarte Anteile …), damit
  sich Zusicherungen schreiben lassen. **Einstellungen haben echte Spalten** (#60; ein unbekanntes
  Feld hat keinen Ort); die KI-Plätze sind Zeilen in `ai_slots`. **Kein Feld für API-Schlüssel**,
  die bleiben in `data/secrets.json`.
- **Löschverhalten**: Eine Wohnung kaskadiert auf Mietverhältnisse, Zähler, Ablesungen, Zahlungen,
  Anteile, Teilnehmer, Einzel- und Eigenbeträge, Pauschalen, `unit_no_connection`.
  `cost_item_contract` (#258) fällt mit der Kostenposition und mit dem Mietverhältnis weg.
  `cost_items.direct_unit_id` ist **`SET NULL`**: die Rechnung gehört weiter in ihre Abrechnung.
  Aufs Objekt verweisen Wurzeln mit `RESTRICT`. Eine Wohnung mit Rechnungen einer Etagenheizung
  löscht die Route nicht (409, `dependents.fuelDeliveries`).
- **Prüfbedingungen je Feld entschieden**: bewusst ohne Bedingung `cost_items.amount_cents`
  (Gutschrift), `labor_35a_cents` (calc.ts erklärt einen ungültigen Lohnanteil) und
  `payments.amount_cents` (Rücklastschrift). Aufzählungen bekommen Bedingungen, denn
  `text({ enum })` bindet nur den Übersetzer. Bedingungen an NULL-fähigen Spalten vergleichen mit
  `IS`, weil `NULL = …` kein Verstoß ist.
- **Indizes nur, wo der Schnappschuss filtert**: `cost_items(property_id, period)`; eindeutig
  `closed_settlements(property_id, period)` (je Objekt und Zeitraum höchstens ein Abschluss), dazu die
  Verläufe und Heizperioden.
- **Der eingefrorene Berechnungsstand bleibt JSON**: ein Archivstück, das wortgleich bleiben soll,
  auch wenn spätere Versionen anders rechnen. Seit #415 trägt er auch das Anschreiben (`letters`).
- **Texte des Anschreibens** (#415, [letters.ts](letters.ts)): eine Tabelle je Ebene, Zeilen je Baustein statt
  Spalten (alle Bausteine haben dieselbe Gestalt); die Datenbank sichert nur den Baustein, die Platzhalter prüft
  shared/letter.ts vor dem Schreiben. Der Schlüssel `doc` je Mieter nennt seit Schritt 0068 das Objekt
  (`<Objekt>:<Zeitraum>`, Datenanweisung im selben Schritt). Siehe server/src/CLAUDE.md.
- **[schema.test.ts](../../test/schema.test.ts)** hält Schema und `shared/types.ts` zur
  Übersetzungszeit zusammen (die Typen bleiben von Hand geschrieben, der Browser kennt kein Drizzle).

## Migrationen

- **Erzeugt mit `npm --prefix server run db:generate`, nie von Hand.** Ausnahme
  Datenanweisungen: Braucht eine neue Pflichtspalte Werte, wird sie zuerst ohne Pflicht erzeugt, die
  Daten werden an diesen Schritt angehängt, ein zweiter erzeugter Schritt zieht die Pflicht nach (nur
  vor der Veröffentlichung; [../../drizzle/README.md](../../drizzle/README.md)).
- **Ein Schritt wird nie gelöscht und nie geändert**, ein Fehler wird mit einem neuen Schritt
  geradegerückt; ein Test hält die Marke jedes veröffentlichten Schrittes fest.
- Für die Programmdatei bettet [scripts/embed-migrations.mjs](../../../scripts/embed-migrations.mjs)
  die Schritte in ein gitignoriertes Modul ein (Zeilenenden vereinheitlicht, sonst hinge die Marke
  am Rechner); ein Test hält beide Wege gegeneinander.

## Repository: was mit einem Datensatz geschieht

- **`PUT` ergänzt und ersetzt nicht** (die Oberfläche schickt Teilrümpfe); zusammengeführt nach
  **Anwesenheit eines Schlüssels**, nicht nach seinem Wert, sonst ließe sich nichts leeren. Die
  Hauptzeile wird geändert, nicht gelöscht und neu eingefügt (`rowid` und Reihenfolge bleiben). Ein
  unbekanntes Feld hat keine Spalte. Sammlungen hängen an `withCollection`, damit der Übersetzer
  sagt, was fehlt.
- **Was krumm hereinkommt, wird geradegerückt, nicht abgelehnt**: Bei zwei Staffeleinträgen zum
  selben Stichtag gilt der letzte (Regel einmal in [../schedule.ts](../schedule.ts)); die
  Jahreskorrektur eines Kalenderobjekts braucht eine vierstellige Jahreszahl. **Ausnahme
  Personenstaffel**: Die erste Stufe gilt ab Einzug, „es gilt der letzte“ verschöbe dort
  Personentage; `straightenPersonHistory` zieht deshalb den Stichtag der ersten Stufe auf den Einzug
  vor (rechnend geprüft in schedule.test.ts).
- **Fehler der Datenbank werden übersetzt** ([errors.ts](errors.ts)): Drizzles Meldung enthält SQL
  **samt Werten des Nutzers**; `databaseProblem` nimmt die innerste Meldung von SQLite und macht aus
  FOREIGN KEY, UNIQUE, CHECK, NOT NULL einen deutschen Satz. Verletzte Zusicherung = 400,
  Schreibschutz und volle Platte = 503. Angeschlossen in der Fehlerbehandlung von index.ts, ein Test
  über eine echte Route hält das fest.

## Eingefrorener Eingang und Validator

- **Der eingefrorene Eingang** ([../legacy/](../legacy), eigenes [README](../legacy/README.md)) bringt
  eine alte `db.json` **auf den Stand nach Migration 0000**, danach läuft die übrige Kette (Muster
  wie Djangos „historical models“). So steht jede Datenregel nur einmal da, in der Kette. **Drei
  Dateien hängen an einer Prüfsumme** (`schema.ts`, `write.ts`, `migrate.ts`,
  legacy-schema.test.ts), dazu Wächter: kein Import aus `db/schema.ts`, der Umstieg liest mit
  `legacy/read.ts` (das bewusst nicht eingefroren ist). Die enge Ausnahme für eine Änderung steht im
  README; die neue Marke gehört in denselben Commit. Fachliches ist eingefroren, Einstellungen
  bleiben am lebenden Stand (`legacy/write.ts` klemmt vier Aufzählungen).
- **Der Validator** ([../legacy/validate.ts](../legacy/validate.ts), #59) prüft den **rohen** Inhalt
  einer `db.json` vor jeder Übernahme (Wiederherstellen, Umstieg) und liefert **Befunde mit Ort und
  Grund**, keinen Wahrheitswert. Erlaubte Werte aus schema.ts.
- **Kaputt oder krumm**: **Abgelehnt** wird, was sich nicht übernehmen lässt, ohne eine Zahl zu
  ändern oder Erfasstes zu verlieren. **Hingenommen** wird, was durch gewöhnliche Bedienung oder in
  alten Beständen entsteht und sich nach einer **schon vorhandenen** Regel geraderücken lässt (alte
  Formate, fehlende Sammlungen, Verweise auf gelöschte Wohnungen, doppelte Stichtage, fehlende
  Fläche/Beteiligung/Personenzahl, Zähler mit leerer Wohnungs-Kennung, fehlende Anzeigefelder).
  Das steht als `adjustments` im Ergebnis und ist die **Vorschrift für den Umstieg**
  (`straightenForDatabase` in legacy/migrate.ts).
- **Geradegerückt wird rechnend geprüft, über alle vier Rechnungen** (Abrechnung, Mietkonto,
  Steuer, Verbrauch; validate.test.ts). Ein Fall bewegt eine Zahl, der feste Monatsbetrag neben einer
  leeren Staffel (danach sagen alle drei Rechnungen dasselbe), und steht überall ausdrücklich dabei.

## Backup und Wiederherstellen

[backup.ts](backup.ts), [../restoreFiles.ts](../restoreFiles.ts), [../zipRead.ts](../zipRead.ts).

- Das Archiv enthält `mietfuchs.sqlite` (über **`VACUUM INTO`**, nie als Dateikopie der offenen
  Datei) und `mietfuchs-backup.json` (Version, Zeitpunkt; nur Auskunft) samt Belegen.
- **Genau eine Ablage kommt ins Archiv, die, die den Bestand trägt**: die Datenbank nur, wenn
  `databaseUnavailable` `null` sagt, sonst die `db.json`. **Beim Wiederherstellen gilt eine `db.json`
  im Archiv vor der Datenbank.** Ohne diese Regeln sah der Vermieter nach „ok“ ein veraltetes oder
  leeres Haus und der Umstieg lief nie wieder.
- **Ein Archiv ohne Datenbank** (alles von vor der Datenbank): Die Datenbank wird mit
  `runChangeover` aus der `db.json` neu aufgebaut (dieselbe Regression); die alte wandert beiseite,
  damit der Umstieg sie leer vorfindet. **Danach die Einstellungen neu einlesen**, sonst schriebe das
  nächste `PUT /api/settings` den alten Stand aus dem Zwischenspeicher zurück.
- Eine mitgebrachte Datenbank wird **vor** dem Austausch geprüft (`unknownSteps`, wie beim Öffnen).
  Ersetzt wird wie beim Umstieg (Schlange leerlaufen, schließen, ersetzen, öffnen), die bisherige als
  `mietfuchs.sqlite.vor-restore` (eine schon vorhandene wird wie bei `backupBeforeMigrating` als
  `….vom-JJJJ-MM-TT-HHMM` beiseitegelegt, `setAsideName`, nie überschrieben), bewegt mit `replaceFile` samt Wiederholungen (Virenscanner unter
  Windows). Geprüft werden auch Verweise über Objekte, Zeiträume und Heizanlagen
  (`crossPropertyViolations`, `orphanPeriodKeys`, `heatingPlantViolations`).
- **ZIP schreiben** mit yazl als Strom, Namen als UTF-8 mit Kennzeichen (ein Test liest das Backup mit
  adm-zip zurück, wie ältere Versionen). Das Backup packt alles (Bit 3 bei gespeicherten Einträgen
  verträgt kein Stromleser), das Steuer-ZIP entsteht aus dem Speicher (`addBuffer`). Der
  `error`-Horcher von yazl hängt ab `createZip`.
- **ZIP lesen** mit yauzl über zipRead.ts: erst nur das Verzeichnis prüfen (Zahl, Größe, Packdichte,
  Namen; Grenzen begründet an `RESTORE_LIMITS` in index.ts), dann als Strom auspacken, nachzählen
  und die CRC prüfen. Namen wie adm-zip (ohne Kennzeichen UTF-8, wenn gültig, sonst CP437, dann NFC).
  Ausgepackt wird nach `restore-<id>/` im Datenordner, die Belege wandern erst nach vollständiger
  Prüfung. Platzbedarf in restoreFiles.ts (`NKA_TEST_FREE_BYTES` für Tests). Reste
  (`restore-upload-<id>.zip`, `restore-<16 Hex>/`, dazu der Schnappschuss eines abgebrochenen Backups
  `mietfuchs.sqlite.<16 Hex>.backup` samt `-journal`, `-wal`, `-shm`) räumt der Start weg, nie Ordner des Nutzers. Eine vorhandene
  `db.json.vor-restore` wird beim nächsten Einspielen wie die der Datenbank mit Datum beiseitegelegt (`setAsideName`).
  Der Kontoauszugsleser (`server/src/bank/read.ts`) liest noch mit adm-zip und eigenen Grenzen.
- Wiederherstellen setzt **keinen vorhandenen Stand voraus** (siehe server/src/CLAUDE.md, API).

## Automatische Vorversionen (#318, Schritt 1)

[priorVersions.ts](priorVersions.ts): Gegen einen Bedienfehler im laufenden Betrieb (eine gelöschte
Wohnung kaskadiert auf alles darunter) half bisher nichts von selbst. Deshalb legt der Server
`vorversionen/vorversion-JJJJ-MM-TT-HHMMSS.sqlite` (UTC, sortiert als Text) im Datenordner an.

- **Wann**: beim Start (vor `finishStartup`, also bevor wartende Anfragen laufen) und danach per
  `setInterval` einmal am Tag (`unref`). Neu nur, wenn die jüngste älter als 7 Tage ist oder es keine
  gibt, **und** die Datenbank einen Bestand trägt (`carriesStock`: Wohnungen, Mietverhältnisse, Zähler
  oder Kostenpositionen; eine frische hat nur Objekt und Einstellungen), **und** `databaseUnavailable`
  `null` sagt, **und** kein Wiederherstellen läuft (`mayCreatePriorVersion`, im Rumpf von
  `opened.write` vor dem VACUUM noch einmal gefragt). Behalten werden 4, die älteste fällt weg. Eine
  jüngste bis einen Tag „aus der Zukunft“ gilt als frisch, eine weiter voraus zählt nicht. Der Zeitpunkt kommt aus dem Namen,
  nicht aus der Dateizeit; die Auswahl sind reine Funktionen (prior-versions.test.ts), daher kein
  Testgriff für die Uhr: Die Integrationstests legen Dateien mit passend alten Namen hin.
- **Wie**: `VACUUM INTO` durch die Schlange (`opened.write`), wie der Schnappschuss fürs Backup, erst
  als `.entsteht-…`, dann `PRAGMA integrity_check` und `replaceFile`; scheitert die Prüfung, wird sie
  verworfen und **nichts rotiert**. Eine alte, die sich nicht löschen lässt, hält die übrigen nicht auf.
  Reste des Zwischennamens räumt der nächste Versuch weg. `checkPriorVersion` in
  index.ts **wirft nie**, ein Fehler steht nur auf der Konsole.
- **Nicht** im Backup-ZIP (es packt nur `uploads/` und den Schnappschuss) und nicht in den `checks`
  von `/healthz`.
- **Einspielen** (`POST /api/prior-versions/:name/restore`, Liste `GET /api/prior-versions`): 503 nur,
  wo die Daten noch in der `db.json` stehen (gescheiterter Umstieg, `stale` mit `pending`;
  `priorVersionsBlocked`). **Lässt sich die Datenbank nicht öffnen, gehen beide**, das ist der
  Rettungsfall, und `restoreDatabase` kommt ohne offene Datenbank aus. Weiter: nur ein Name nach dem eigenen Muster (`priorVersionTime`, prüft
  auch `path.basename`), sonst 400, fehlt die Datei 404. Dann derselbe Weg wie eine Datenbank aus dem
  Backup: Kopie nach `mietfuchs.sqlite.restore-<id>`, `archiveDatabaseProblem(…, 'priorVersion')`
  (die Meldungen sagen dann „Vorversion“ statt „Archiv“; ein Wächter liest den Rumpf; Integrität,
  `unknownSteps`, Migrationskette nachholen, Verweise), `restoreDatabase` (bisherige als
  `mietfuchs.sqlite.vor-restore`, Hinweis nach dem Update weg), `refreshSettings`; gesperrt über
  `restoreRunning` wie `/api/restore`. Die Vorversion selbst bleibt unverändert. Die `db.json` und die
  Belege werden nicht angefasst; Belege, auf die der Stand verweist und die fehlen, nennt die Antwort
  in `notes`. Die Oberfläche lädt danach **immer** neu (jede Seite hält sonst den alten Stand) und
  zeigt die Hinweise einmal nach dem Neuladen (sessionStorage, mit try/catch).

## Änderungsjournal und Verlauf (#318, Schritte 2 und 3)

[journal.ts](journal.ts), Entwurf in
[docs/superpowers/specs/2026-10-24-journal-design.md](../../../docs/superpowers/specs/2026-10-24-journal-design.md).
Neben dem Bestand steht, was jede schreibende Anfrage geändert hat: `change_groups` (eine Gruppe je Anfrage, mit Satz,
Route, Objekt, Zahl der Migrationsschritte) und `change_log` (je Zeile Tabelle, Schlüssel, Art, `before`/`after` als
JSON über **alle** Spalten). Keine Berechnung liest es.

- **Die Trigger stehen nicht in der Datei**: `ensureJournal` legt sie bei jedem Öffnen nach `applyMigrations` als
  TEMP TRIGGER an (je Tabelle AFTER INSERT/UPDATE/DELETE, Spalten aus `PRAGMA table_info`). Deshalb brauchst du für
  eine neue Tabelle und für einen Schritt, der eine Tabelle neu baut (CREATE `__new_x`, DROP, RENAME, wobei Trigger
  wegfallen), **nichts zu tun**; keine Datenanweisung. Der Wächter in journal.test.ts verlangt drei Trigger mit allen
  Spalten je Tabelle (außer Journal, `__drizzle_migrations`, `sqlite_*`). Migrationen, Umstieg, eingefrorener Eingang
  und Backup-Schnappschüsse laufen ohne Trigger und werden nicht erfasst.
- **Erfasst wird nur in einer Gruppe**: Die TEMP-Tabelle `journal_current` hält ihre Kennung, die Trigger fragen sie im
  `WHEN`. Gesetzt wird sie nur von `opened.write(work, journal)`; ohne `journal` (Systemarbeit) wird nichts erfasst.
  `writeData` in index.ts reicht `journal` aus der laufenden Anfrage (AsyncLocalStorage `requestScope`, gesetzt nach
  `express.json()` und **erneut nach multer**, sonst ist der Kontext dort weg; eine neue Route mit multer braucht
  `inRequest` dahinter). Eine Anfrage ist eine Gruppe, auch bei mehreren `writeData`. Eine leere Gruppe
  (zurückgerollt, nichts geändert) fällt weg; ein Update ohne Unterschied erzeugt keine Zeile.
- **Satz je Route** in [../journalRoutes.ts](../journalRoutes.ts); journal-routes.test.ts verlangt ihn für jede Route,
  deren Rumpf `writeData(` aufruft (Vorschauen ausgenommen, sie rollen zurück). Das Objekt der Gruppe bestimmt
  `propertyOfGroup` über `property_id` oder die Fremdschlüssel (zuerst die Zeilen derselben Gruppe); mehrere oder
  keines ergeben `NULL` (installationsweit). `property_id` hat bewusst keinen Fremdschlüssel.
- **Eingefrorene Abrechnungen** (`settlement` der vier Abschlusstabellen, `OMITTED_COLUMNS`) stehen nur als
  `{"$omitted":1,"length":N}` darin. Alles andere vollständig, damit Rückgängig (Schritt 4) jede Zeile wiederherstellen
  kann.
- **Aufbewahrung**: 12 Monate (`JOURNAL_KEEP_MONTHS`), aufgeräumt beim Öffnen. **Backup** ohne Journal, außer
  `GET /api/backup?journal=1` (`stripJournal` leert den Schnappschuss und macht VACUUM); Vorversionen enthalten es immer.
  Ein endgültiges Löschen eines ehemaligen Mieters, das das Journal bereinigt, gibt es noch nicht (Grenze).
- **Lesen**: `GET /api/journal?property=&before=&limit=` (Gruppen mit `title` und Zahl der Änderungen),
  `GET /api/journal/:id` (Änderungen, `collapse` fasst unverändert gelöscht-und-neu-eingefügte Zeilen der
  Unterlisten zusammen; gespeichert bleibt die wirkliche Folge). Seite „Verlauf“ (client/src/pages/Verlauf.tsx,
  Feldnamen in client/src/journalView.ts).
- **Leistung** (gemessen mit 5000 Ablesungen in einem Vorgang): Einfügen etwa 1,6-mal so lang, Löschen samt Kaskade
  rund 0,2 statt 0,02 Sekunden; für die Handgriffe eines Vermieters nicht spürbar.

## Der Umstieg aus der db.json

[changeover.ts](changeover.ts): Beim ersten Start wandert die `db.json` ohne Zutun in die Datenbank:
erkennen, **prüfen bevor irgendetwas geschrieben wird**, in `mietfuchs.sqlite.umstieg` schreiben,
importieren, nachrechnen, erst dann per `rename` aktivieren. Danach heißt die Datei
**`db.json.abgeloest`** (der Rückweg, unter einem unmissverständlichen Namen);
`umstieg-protokoll.txt` nennt, was übernommen wurde.

- **Die centgenaue Regression ist die Bedingung fürs Aktivieren** ([regression.ts](regression.ts)):
  Abrechnung, Verbrauch, Mietkonto und Steuer für jedes Jahr mit Bestand **und jedes Jahr
  dazwischen** (bei offenem Mietverhältnis bis heute), aus beiden Beständen. Ein Cent Abweichung,
  und es wird nicht aktiviert. Ausgenommen sind genau sieben Anzeigeangaben (`unitName`,
  `tenantName`, `description`, `basisText`, `warnings`, `notices`, `steps`). Verglichen wird mit dem
  Bestand, wie Mietfuchs ihn **heute** rechnet, nicht mit dem geradegerückten (einzige benannte
  Ausnahme: `standToCompare`).
- **Scheitert ein Schritt, bleibt alles unberührt**, Mietfuchs arbeitet mit der `db.json` weiter und
  versucht es beim nächsten Start erneut. Jeder Abbruch hat einen Test (db-changeover.test.ts, mit
  benannten Griffen für Einfügen und Regression). `runChangeover` **wirft nie**.
- Vor dem `rename` werden die Verbindungen geschlossen (Windows) und Beidateien geprüft; `rename`
  mit Wiederholungen.
- **[read.ts](read.ts) und [write.ts](write.ts) sind mechanisch**, eine Spalte je Feld. read.ts liest
  `ORDER BY rowid`: Bei zwei Ablesungen am selben Tag entscheidet die Reihenfolge über den Verbrauch.
  Fehlt die Zeile der Einstellungen, gelten die Vorgaben aus [../defaults.ts](../defaults.ts),
  entschieden an der **Zeile**, nie an einem Wert (ein geleertes Feld bleibt leer).
- **Der Nutzer erfährt es in der Oberfläche** (`database.changeover` in `/healthz`, Anzeige in
  client/src/components/Database.tsx): gelungen, gescheitert (mit der Zusage, dass weitergearbeitet
  wird) oder `stale` (#89: Datenbank hat Daten und daneben liegt eine `db.json`; Hinweis mit dem Weg
  übers Backup).
- **Hinweis nach einem Update** (`database.migrated`, `{ steps, backup, at }`): nennt die Sicherung
  von `backupBeforeMigrating` mit dem Rückweg aus MIGRATION.md. `null` bei neuer Datenbank, nach dem
  Umstieg und nach dem Wiederherstellen. Er übersteht einen Neustart über `sicherung-vor-update.json`
  im Datenordner ([migrationNotice.ts](migrationNotice.ts), bewusst nicht in der Datenbank) und
  verschwindet mit „Verstanden“ (`POST /api/database/migrated/seen`, Schlüssel `Name@Zeitpunkt`),
  einem eingespielten Backup oder fehlender Sicherung. Entschieden wird erst nach dem Umstieg
  (`noteAfterChangeover`).
