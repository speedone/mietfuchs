# Die Datenbank

Aus der CLAUDE.md im Wurzelordner hierher verschoben: Datenbank, Migrationen, eingefrorener
Eingang, Validator, Backup und Wiederherstellen, ZIP, der Umstieg aus der `db.json`.

**Die Datenbank** (#55): Die JSON-Datei ist durch SQLite abgelöst, später soll auch PostgreSQL
möglich sein. Die Grenze dafür zog der Schnappschuss (siehe unten); das Schema dahinter steht in
[server/src/db/schema.ts](schema.ts). Geöffnet wird sie beim Start
([server/src/db/open.ts](open.ts)), die vorhandenen Bestände wandern beim ersten
Start hinein (siehe Umstieg unten), und **die Routen lesen und schreiben sie**
([server/src/db/repository.ts](repository.ts)).

- **Der Treiber ist `drizzle-orm/sqlite-proxy`**, und das ist eine bewusste Wahl gegen zwei
  naheliegendere. `drizzle-orm/better-sqlite3` importiert ein natives Modul fest beim Laden, und
  native Module lassen sich nicht für alle Ziele in die Bun-Programmdatei einbetten (#21).
  `drizzle-orm/node-sqlite` gibt es nur in der 1.0.0-Vorabreihe, und die scheidet an zwei
  nachgemessenen Stellen aus: Ihr Treiber wartet den Rumpf einer Transaktion nicht ab, wodurch
  eine gescheiterte Transaktion festgeschrieben statt zurückgerollt wird, und ihr drizzle-kit
  lässt bei einem Primärschlüssel aus Text das `NOT NULL` weg, was SQLite als Erlaubnis für
  NULL-Kennungen liest. Der Proxy ist eigentlich für einen entfernten Dienst gedacht; wir nutzen
  ihn für eine Verbindung im selben Prozess. Kommt die stabile 1.0, tauscht man ihn gegen den
  eigenen Treiber — betroffen ist dann nur
  [server/src/db/client.ts](client.ts), denn Schema und Migrationen liegen schon
  in der Form der stabilen Reihe.
- **Node und Bun unterscheidet allein client.ts**, erkannt an `globalThis.Bun`. Betroffen sind
  das eingebaute SQLite (`node:sqlite` mit `setReturnArrays(true)` gegen `bun:sqlite` mit
  `values()`) und die Herkunft der Migrationen.
- **`PRAGMA foreign_keys = ON` beim Öffnen**, je Verbindung. Die Voreinstellung von SQLite ist
  aus; ohne diese Zeile sind alle Fremdschlüssel Dekoration. Damit die Zeile wirklich die Arbeit
  tut, öffnet `openNode` mit **`enableForeignKeyConstraints: false`**: `node:sqlite` schaltet die
  Prüfung sonst von sich aus ein, `bun:sqlite` nicht, und dann bliebe unter Node jeder Test grün,
  während in der Programmdatei alle Verweise still Zierde wären. open.ts sieht nach dem Öffnen
  zusätzlich nach, dass der Wert wirklich 1 ist.
- **Beim Start wird geprüft, bevor geschrieben wird** ([server/src/db/open.ts](open.ts)):
  ob der Datenordner beschreibbar ist (mit `writable` aus paths.ts, wie chooseDataDir), ob die
  Fremdschlüsselprüfung gilt, ob `PRAGMA integrity_check` die Datei für unversehrt hält, ob sich
  in die Datei überhaupt schreiben lässt und ob sie aus einer **neueren** Mietfuchs-Version stammt.
  Der Schreibschutz wird zweistufig erkannt: Die Rechteprüfung des Dateisystems ist billig, lügt
  aber auf Netzlaufwerken, darf also nur den Verdacht wecken; bestätigt wird er mit einem
  Schreibvorgang, der nichts ändert (`PRAGMA user_version` auf den Wert, der schon dasteht).
  `BEGIN IMMEDIATE` taugt dafür nicht, nachgemessen: SQLite holt die Sperre erst beim ersten
  wirklichen Schreiben. Das Letzte steht in ihrer eigenen
  Buchführung: Führt `__drizzle_migrations` eine Marke, die dieses Programm nicht kennt, hat eine
  neuere Fassung darauf gearbeitet. Dann wird nicht migriert, sondern erklärt; unsere Schritte
  auf einen unbekannten Aufbau anzuwenden ergäbe einen Bestand, den danach keine der beiden
  Versionen mehr liest. **Eine beschädigte oder neuere Datei wird nie angefasst**, auch nicht
  beiseitegelegt: Ob nichts darin steht, ist genau das, was man in diesem Augenblick nicht weiß.
  Jede Meldung sagt, was los ist und was zu tun ist; die Meldung von SQLite steht höchstens
  benannt am Ende („Technischer Befund“) und nie allein.
- **Ein Netzlaufwerk ergibt eine Warnung, keinen Abbruch.** SQLite verlässt sich auf
  Dateisperren, die Netzwerk-Dateisysteme oft nur vortäuschen. Gefragt wird nach dem **wirklichen**
  Ort der Datei (Symlinks und Abzweigungen werden aufgelöst, sonst wäre ein Ordner im
  Heimatverzeichnis, der aufs NAS zeigt, unsichtbar); erkannt wird er unter Linux über
  `/proc/self/mounts` und unter Windows am UNC-Pfad. Die Plattform **kommt in `networkLocation`
  hinein** und stammt nicht aus der Laufzeit, wie bei `systemLocation` in paths.ts und aus
  demselben Grund: Sonst prüft jeder Zweig nur dort, wo zufällig jemand entwickelt. Gerechnet
  wird entsprechend mit `path.win32` beziehungsweise `path.posix`, nicht mit der Voreinstellung.
  Dieselbe Falle hat hier schon einmal einen Prüflauf umgeworfen:
  `path.posix.dirname` eines UNC-Pfads ergibt „.“, das Arbeitsverzeichnis lässt sich auflösen,
  und danach beginnt der Pfad nicht mehr mit zwei Gegenschrägstrichen. Es gewinnt der längste passende
  Einhängepunkt, bei gleicher Länge der spätere: Gleich lang und beide im Pfad heißt derselbe
  Einhängepunkt, also ein Dateisystem über einem anderen, und wirksam ist dann das obere. Nicht
  erkannt werden ein verbundenes Netzlaufwerk unter Windows (Z:), alles unter macOS und die
  Freigaben einer virtuellen Maschine; gewarnt wird dann nicht, falsch gewarnt aber auch niemand.
- **Scheitert das Öffnen, startet der Server trotzdem, aber ohne Daten.** Die angekündigte Umkehr
  ist mit dem Umstellen der Routen eingetreten: Ein Start ohne Datenbank ist jetzt ein Start ohne
  Daten. Die Datenrouten antworten mit **503** statt mit einer leeren Liste, und der Eintrag
  steht unter `checks`, damit ein Container den Fehler sieht. Der Server selbst muss dennoch
  hochkommen, sonst gäbe es auch keine Oberfläche, in der die Meldung stünde, und keine Route zum
  Wiederherstellen eines Backups. **Dasselbe gilt für einen gescheiterten Umstieg**, und das ist
  der schwerer zu sehende Fall: Die Datenbank ist dann offen, aber leer, und die Daten stehen noch
  in der `db.json`. Eine leere Antwort wäre keine Auskunft über einen leeren Bestand, sondern eine
  falsche über einen vorhandenen; und was der Vermieter in das leere Haus hineinschriebe, stünde
  danach als zweiter Bestand da, während seine `db.json` für immer abgehängt wäre, denn der
  nächste Umstieg unterbleibt, sobald in der Datenbank etwas steht. Von den beiden Zusagen aus
  changeover.ts gewinnt deshalb die zweite: nie Daten verlieren, notfalls auf Kosten des
  Weiterarbeitens. Die Frage „trägt die Datenbank den Bestand?" und ihre beiden Begründungen
  stehen einmal in [server/src/health.ts](../health.ts) (`databaseUnavailable`), denn ein
  `/healthz` mit „ok", während jede Datenroute 503 antwortet, wäre die unbrauchbarste Auskunft von
  beiden. Der Umstiegsstand in index.ts ist veränderlich, weil das Wiederherstellen eines Backups
  ihn ändert: Sonst sperrte ein einmal gescheiterter Umstieg auch dann noch, wenn der Nutzer das
  Problem gerade mit genau dem Mittel behoben hat, das ihm dafür angeboten wird.
- **Alle Zugriffe laufen nacheinander**, durch die Schlange in open.ts
  (`createLane`, benutzt als `opened.write(...)` und `opened.read(...)`). Express bedient nebenläufig, und alle
  Anfragen teilen sich **eine** Verbindung. Eine Transaktion mit asynchronem Rumpf gibt zwischen
  ihren Anweisungen die Kontrolle ab; eine zweite Anfrage beginnt dann mitten hinein ihre eigene,
  die SQLite mit „cannot start a transaction within a transaction“ ablehnt. Schlimmer ist der
  zweite Ausgang, und deshalb läuft **jeder** Schreibvorgang durch die Schlange und nicht nur die
  Transaktionen: Ein gewöhnliches Einfügen, das währenddessen hereinkommt, landet unbemerkt
  innerhalb der fremden Transaktion und verschwindet mit ihr, nachdem seine Anfrage längst mit
  „gespeichert“ geantwortet hat. Beides ist nachgemessen. Ein Schreibvorgang **im**
  Schreibvorgang meldet sich mit einem Fehler, statt auf sich selbst zu warten. Zwei Feinheiten
  stecken darin, und beide waren Fehler, bevor sie es nicht mehr waren: Im Speicher von
  `AsyncLocalStorage` liegt ein **veränderliches Kärtchen**, das am Ende des Vorgangs ungültig
  gestempelt wird, denn der Speicher überlebt den Vorgang in jedem Zeitgeber, den er angelegt hat,
  und ein Zeitgeber, der später aufräumt, gälte sonst für immer als verschachtelt. Und die
  Ablehnung wird **geworfen** statt als abgelehntes Versprechen zurückgegeben: Wer sein Ergebnis
  wegwirft, hätte sonst niemanden, der sie entgegennimmt, und Node beendet den Prozess bei einer
  unbehandelten Ablehnung. Geworfen landet sie im Rumpf des äußeren Vorgangs und von dort bei
  dessen Aufrufer. Dauert ein Schreibvorgang länger als 30 Sekunden, gibt es eine Meldung;
  abgebrochen wird nichts, denn eine halb geschriebene Transaktion abzuräumen wäre schlimmer als
  zu warten. **Lesevorgänge gehen durch dieselbe Schlange**, seit die Routen aus der Datenbank
  lesen: Alle Anfragen teilen sich eine Verbindung, und ein Lesevorgang neben einer offenen
  Transaktion sähe deren noch nicht festgeschriebenen Stand. Ein Lesevorgang **innerhalb** eines
  Schreibvorgangs läuft dagegen einfach durch, sonst wartete er auf die Schlange, die sein
  eigener Aufrufer gerade hält. In index.ts sind `readData` und `writeData` der einzige Weg
  dorthin; eine Route, die `database.db` unmittelbar benutzte, ginge daran vorbei.
- **Verschachtelte Listen wurden Tabellen**: die drei Staffeln (`person_history`, `prepayments`,
  `base_rents`), die Jahreskorrektur (`prepayment_overrides`, nach Jahr geschlüsselt statt nach
  Datum) und die vereinbarten Anteile (`cost_item_shares`). In einer Spalte mit JSON ließe sich
  nichts zusichern: kein negativer Betrag, kein zweiter Eintrag zum selben Stichtag, kein
  Eintrag ohne Mietverhältnis. Bei `cost_item_shares` am deutlichsten, weil seine Schlüssel
  Wohnungs-Kennungen sind — index.ts ging sie beim Löschen einer Wohnung von Hand durch, und
  genau das erledigt jetzt `ON DELETE CASCADE`.
- **Die Einstellungen haben echte Spalten** (#60). Ein JSON-Klumpen hätte den Befund unverändert
  mitgenommen: `PUT /api/settings` übernahm jeden Schlüssel des Rumpfes, auch einen erfundenen.
  Mit Spalten gibt es für ein unbekanntes Feld keinen Ort mehr, und damit ist #60 erledigt. Die
  beiden Plätze der KI sind Zeilen in `ai_slots` und keine Spalten mit Präfix, weil `text` und
  `images` dieselbe Gestalt haben; die Bestätigung steht in derselben Zeile wie die Adresse, für
  die sie gilt. **Kein Feld für den API-Schlüssel**, der bleibt in `data/secrets.json`.
- **Was mit einem Datensatz geschieht, steht in
  [server/src/db/repository.ts](repository.ts)**, nicht mehr in index.ts. Drei
  Entscheidungen stehen dort begründet. `PUT` **ergänzt und ersetzt nicht**, weil die Oberfläche
  Teilrümpfe schickt (Stammdaten.tsx sendet beim Auszug nur `{ end }`); zusammengeführt wird nach
  **Anwesenheit eines Schlüssels** und nicht nach seinem Wert, sonst ließe sich ein Feld nie
  leeren. Die Hauptzeile wird **geändert und nicht gelöscht und neu eingefügt**, damit ihr
  `rowid` und damit die Reihenfolge erhalten bleibt. Und ein unbekanntes Feld hat schlicht keine
  Spalte. Die Sammlungen hängen an einem Beschreiber (`withCollection`) statt an Abfragen auf
  Feldnamen: Wer eine Sammlung ergänzt, bekommt vom Übersetzer gesagt, was fehlt.
- **Was krumm hereinkommt, wird geradegerückt und nicht abgelehnt.** Zwei Staffeleinträge zum
  selben Stichtag sind über die Oberfläche erzeugbar: Stammdaten.tsx setzt für eine Zeile ohne
  Monat den Einzugsmonat ein und prüft nie auf Doppelung. In der Datenbank ist der Stichtag Teil
  des Primärschlüssels, ungeprüft hineingeschrieben gäbe das also einen Fehler statt eines
  gespeicherten Mietverhältnisses, wo die db.json es klaglos annahm. Es gilt deshalb der letzte
  Eintrag, wie in calc.ts und beim Umstieg; die Regel steht einmal in
  [server/src/schedule.ts](../schedule.ts), und legacy/migrate.ts wie repository.ts holen sie von
  dort. Dieselbe Haltung bei der Jahreskorrektur: Ihr Schlüssel muss eine **vierstellige**
  Jahreszahl sein, sonst führten „2024" und „2024.0" auf dieselbe Spalte und ließen den ganzen
  Vorgang am Primärschlüssel scheitern.
- **Die Personen-Staffel ist dabei die Ausnahme, und das ist nachgemessen.** „Es gilt der
  letzte" verschiebt dort Personentage, denn `personDaysInPeriod` in calc.ts baut seine Stufen
  aus allen Einträgen, und **die erste gilt ab Einzug** und nicht erst ab ihrem eigenen Stichtag
  (der Kommentar steht an der Zeile, `personsAt` nimmt davor ebenfalls den ersten Eintrag). Wirft
  man den ersten von zwei Einträgen zum selben Stichtag weg, übernimmt der zweite rückwirkend die
  ganze Zeit davor: an einem Mietverhältnis ab 01.01.2024 mit [1 Person, 4 Personen], beide ab
  01.07.2024, sind das 918 Personentage gegen 1464. Beim Personenschlüssel ist das unmittelbar
  Geld. `straightenPersonHistory` schreibt deshalb eine vorhandene Regel aus, statt eine neue zu
  erfinden: Weil die erste Stufe ohnehin ab Einzug gilt, darf ihr Stichtag dorthin vorgezogen
  werden, und danach greift „es gilt der letzte" wieder gefahrlos. Geprüft wird das **rechnend**
  und nicht am Ergebnis der Funktion
  ([server/test/schedule.test.ts](../../test/schedule.test.ts)).
- **Fehler der Datenbank werden übersetzt**
  ([server/src/db/errors.ts](errors.ts)). Drizzles äußere Meldung enthält das SQL
  **samt der eingesetzten Werte des Nutzers** und gehört damit nicht in eine Oberfläche;
  `databaseProblem` geht deshalb die `cause`-Kette bis zur **innersten** Meldung von SQLite
  hinunter. Aus FOREIGN KEY, UNIQUE, CHECK und NOT NULL wird ein deutscher Satz, die Meldung von
  SQLite steht höchstens am Ende als „Technischer Befund" und nie allein. **Der Status gehört zur
  Einordnung und kommt von dort mit**: Eine verletzte Zusicherung kommt aus der Anfrage und ist
  eine 400, Schreibschutz und volle Platte sind eine 503. Angeschlossen ist es in der
  Fehlerbehandlung von index.ts, und das war es einmal nicht: Die Datei war importiert und
  niemals aufgerufen, 182 Zeilen mit zehn grünen Tests, die nur sich selbst prüften. Ein Test
  über eine echte Route hält das jetzt fest.
- **Löschverhalten ist aus index.ts abgelesen.** Eine Wohnung kaskadiert auf Mietverhältnisse,
  Zähler, Ablesungen, Zahlungen (über das Mietverhältnis) und die vereinbarten Anteile. Bei
  `cost_items.direct_unit_id` steht dagegen **`SET NULL`**: Die Rechnung ist bezahlt worden und
  gehört weiter in die Abrechnung des Jahres. `CASCADE` löschte sie und veränderte damit die
  Summe einer bereits abgerechneten Vergangenheit. Später hinzugekommen und ebenfalls kaskadierend: die Pauschale
  (`flat_rates`), Teilnehmer, Einzel- und Eigenbeträge (`cost_item_participants`,
  `cost_item_amounts`, `cost_item_self_amounts`) und `unit_no_connection`; auf das Objekt verweisen
  Wohnungen, Zähler, Kosten, Abschlüsse und frühere Abschlüsse mit `RESTRICT`.
  Ausnahme an der Route: Die Rechnungen einer Etagenheizung (`fuel_deliveries.unit_id`) stehen zwar auf
  `CASCADE`, eine Wohnung mit Rechnungen löscht `DELETE /api/units/:id` aber nicht (409, `dependents` zählt sie
  als `fuelDeliveries`): Die Rechnung ist Beleg der CO₂-Aufteilung, und hing eine Position daran, scheiterte das
  Löschen vorher an deren `RESTRICT` mit einer irreführenden Meldung. Gesperrt statt `SET NULL`, weil eine
  Rechnung einer Etagenheizung ohne Wohnung keiner Wohnung mehr zuzuordnen wäre.
- **Prüfbedingungen je Feld entschieden.** Ohne Bedingung bleiben bewusst
  `cost_items.amount_cents` (eine Gutschrift ist negativ), `labor_35a_cents` (calc.ts meldet
  einen ungültigen Lohnanteil als Warnung und rechnet weiter; eine Bedingung nähme dem Nutzer
  genau diese Erklärung) und `payments.amount_cents` (Rücklastschrift). Dazu Bedingungen auf die
  Aufzählungen, denn `text({ enum })` bindet nur den Übersetzer und hinterlässt im SQL nichts.
- **Zwei Indizes, beide aus snapshot.ts abgelesen**: `cost_items(property_id, year)` ist der
  einzige Filter, den der Schnappschuss wirklich setzt, und `closed_settlements(property_id,
  year)` ist eindeutig und damit zugleich die Zusicherung, dass es je Objekt und Jahr höchstens
  eine abgeschlossene Abrechnung gibt (seit #92, vorher je Jahr). Dazu kommt
  `closed_settlement_history(property_id, year)` für die früheren Abschlüsse (#56). Alle
  übrigen Sammlungen gehen vollständig in den Schnappschuss; dort wäre ein Index auf Verdacht.
- **Der eingefrorene Berechnungsstand bleibt JSON.** Er ist ein Archivstück, das wortgleich
  erhalten bleiben soll, auch wenn spätere Versionen anders rechnen. In Spalten zerlegt hinge er
  am heutigen Ergebnisformat, und eine Programmänderung veränderte rückwirkend, was dem Mieter
  zugestellt wurde.
- **Migrationen**: erzeugt mit `npm --prefix server run db:generate`, nie von Hand geschrieben.
  **Ausnahme Datenanweisungen** (#92, Muster 0001/0002): Braucht eine neue Pflichtspalte Werte,
  wird sie zuerst ohne Pflicht erzeugt, die Daten werden an diesen Schritt angehängt, und ein
  zweiter erzeugter Schritt zieht die Pflicht per Neubau nach; nur vor der Veröffentlichung, und
  näher in [server/drizzle/README.md](../../drizzle/README.md). **Vor dem Anwenden ausstehender
  Schritte** legt der Server eine Sicherung `mietfuchs.sqlite.vor-<Schritt>` daneben
  (`backupBeforeMigrating` in open.ts); scheitert sie, wird nicht migriert.
  Es gilt die Regel aus [server/drizzle/README.md](../../drizzle/README.md): **Ein Schritt wird
  nie gelöscht und nie geändert**, sonst hält die Zusage nicht mehr, dass man von jeder alten
  Version auf die neueste kommt. Ein Fehler wird mit einem neuen Schritt geradegerückt. Ein Test
  hält die Marke jedes veröffentlichten Schrittes fest. Für die Programmdatei bettet
  [scripts/embed-migrations.mjs](../../../scripts/embed-migrations.mjs) sie in ein gitignoriertes Modul
  ein, nach demselben Muster wie `embed-client.mjs` (erzeugte `.js`, gepflegte `.d.ts` daneben);
  ein Test hält beide Wege gegeneinander. Zeilenenden werden dabei vereinheitlicht, weil Git
  Textdateien unter Windows auf CRLF umstellt und die Marke sonst vom Rechner abhinge.
- **Der eingefrorene Eingang** ([server/src/legacy/](../legacy), Aufgabe 6b, mit eigenem
  [README.md](../legacy/README.md)): der Weg einer alten `db.json` in die Datenbank, und
  zwar **auf den Stand nach Migration 0000 und nicht auf den neuesten**. Der Umstieg legt deshalb
  nur den ersten Schritt an, importiert, rechnet nach, und **erst danach** läuft die übrige
  Migrationskette darüber (`changeover.ts`, Schritt 8b). Möglich ist das, weil `applyMigrations`
  an Prüfsummen hängt, ein zweiter Aufruf also nur das Fehlende nachholt. Dasselbe Muster wie
  Djangos „historical models" und Flyways „baseline".
  **Der Gewinn ist, dass eine Datenregel nur noch einmal dasteht.** Vorher hätte jede Änderung am
  Wortschatz an zwei Stellen gepflegt werden müssen, im Migrationsschritt und im Importpfad, und
  wer die zweite vergaß, bekam keinen Fehler, sondern einen Bestand, der still anders dasteht.
  Jetzt trägt die Migrationskette die Regel allein.
  **Drei Dateien hängen an einer Prüfsumme** (`schema.ts`, `write.ts`, `migrate.ts`, siehe
  [legacy-schema.test.ts](../../test/legacy-schema.test.ts)), dazu zwei Quelltext-Wächter: kein
  Import aus `db/schema.ts`, und der Umstieg liest mit `legacy/read.ts`. Geprüft wird der
  Quelltext, weil es kein Verhalten gibt, solange Ausgangsstand und neuester Stand derselbe sind.
  `read.ts` steht bewusst **nicht** unter der Marke: Es erfüllt `SnapshotSource` und wächst
  deshalb mit dem mit, was die Berechnung aus einem Bestand liest.
  **Eingefroren ist der Aufbau der Tabellen, nicht jeder Helfer** — die Dateien importieren
  `ai/settings.ts`, `schedule.ts` und `calc.ts`. Die enge Ausnahme für eine Änderung steht im
  README daneben, samt der Regel, dass die neue Marke in denselben Commit gehört; sonst ist der
  Zweig dazwischen rot und `git bisect` bricht dort ab.
  **Die Grenze zieht, was die Daten brauchen**: Fachliches wird eingefroren, weil es
  reproduzierbar sein muss; die Einstellungen bleiben am lebenden Stand, weil sie heute benutzbar
  sein müssen, und an der Grenze klemmt `legacy/write.ts` vier Aufzählungen auf erlaubte Werte.
- **Schema und Datenmodell hält [server/test/schema.test.ts](../../test/schema.test.ts)
  zusammen**, zur Übersetzungszeit. `shared/types.ts` bleibt von Hand geschrieben, weil der
  Browser es benutzt und von Drizzle nichts wissen darf; der Test schlägt fehl, sobald jemand
  nur eine Seite ändert.
- **Der Validator** ([server/src/legacy/validate.ts](../legacy/validate.ts), #59) prüft einen
  Datenbestand, bevor er übernommen wird: beim Wiederherstellen eines Backups und beim
  Umstieg der vorhandenen Bestände. Geprüft wird der **rohe** Inhalt der Datei
  und nicht der schon eingelesene Bestand, denn `migrateLegacy` verträgt keinen beliebigen
  Inhalt und genau davor soll die Prüfung schützen. Das Ergebnis ist eine **Liste von Befunden
  mit Ort und Grund**, kein Wahrheitswert: „Die Datei enthält keine gültigen Daten" ist keine
  Antwort, mit der ein Vermieter etwas anfangen kann. Die Listen erlaubter Werte kommen aus
  schema.ts und stehen nicht noch einmal daneben.
- **Die Grenze zwischen kaputt und krumm** ist der Entwurfspunkt des Validators, und an ihr
  hängt der Umstieg. Zu streng heißt, dass ein Bestand, mit dem jemand seit Jahren arbeitet, nie
  in die Datenbank käme; zu lasch heißt, dass ein beschädigter erst beim Einfügen auffällt,
  mitten im Umstieg. **Abgelehnt** wird, was sich nicht übernehmen lässt, ohne eine Zahl der
  Abrechnung zu verändern oder Erfasstes zu verlieren. **Hingenommen** wird, was beides
  erfüllt: Es entsteht durch gewöhnliche Bedienung oder in einem älteren Bestand, und es lässt
  sich so geraderücken, dass die Abrechnung dieselben Zahlen ergibt. Das Geraderücken folgt
  dabei immer einer Regel, die schon in calc.ts oder legacy/migrate.ts steht, und erfindet nie eine
  neue. Hingenommen sind heute: die alten Formate, eine fehlende Sammlung oder Einstellung, eine
  Direktzuordnung auf eine gelöschte Wohnung (wird `null`, wie `ON DELETE SET NULL`), ein
  vereinbarter Anteil auf eine gelöschte Wohnung (entfällt, verteilt wurde er ohnehin nicht),
  zwei Staffeleinträge zum selben Stichtag (der letzte gilt, wie in calc.ts), eine fehlende
  Wohnfläche (0 m², wie `u.areaM2 || 0`), eine fehlende Beteiligung, eine fehlende Personenzahl,
  ein Zähler mit leerer Wohnungs-Kennung (Hauptzähler, wie `m.unitId && …` ihn schon liest) und
  ein fehlendes Feld, das nur angezeigt wird. Was hingenommen wird, steht als `adjustments` im
  Ergebnis und ist zugleich die **Vorschrift für den Umstieg**.
- **Geprüft wird das Geraderücken rechnend, und zwar über alle vier Rechnungen**
  ([validate.test.ts](../../test/validate.test.ts)): Abrechnung, Mietkonto, Steuerübersicht und
  Verbrauchsübersicht, je einmal vor und einmal nach dem Geraderücken. Die Abrechnung allein
  genügt nicht, und das ist nicht theoretisch: **Ein Fall bewegt eine Zahl**, nämlich der feste
  Monatsbetrag neben einer *leeren* Staffel. Die Abrechnung liest ihn (`computePrepaymentCents`),
  das Mietkonto nicht (`rentLedger` liest nur `prepayments`), und die Steuerübersicht nimmt ihre
  Einnahmen vom Mietkonto. Nach dem Geraderücken sagen alle drei dasselbe: Das Soll steigt um
  die Vorauszahlung, dieselbe Zahlung deckt weniger Monate, und ein Monat kann von „bezahlt" auf
  „teilweise" wechseln. Die Richtung ist gutartig, das Mietkonto forderte bisher zu wenig, aber
  es ist eine Änderung und steht deshalb überall ausdrücklich dabei. Es ist eine gemessene
  Ausprägung von #70. Ein weiterer Test lässt den ganzen Prüfkatalog durch den Validator laufen,
  damit niemand ihn unbemerkt verschärft; seine Fangkraft hängt allerdings daran, dass zwei
  Fixtures Felder auslassen (siehe die Warnung im Test).
- **Backup und Wiederherstellen sprechen die Datenbank**
  ([server/src/db/backup.ts](backup.ts), Aufgabe 7a). Das steht **vor** dem
  Umstellen der Routen, und zwar wegen des Ausgangs, den es zu vermeiden gilt: Sobald die Routen
  aus der Datenbank lesen, spielt jemand ein Backup ein, sieht eine Bestätigung und arbeitet
  danach mit den alten Daten weiter. Ein zweiter Umstieg holt das nicht nach, denn er
  unterbleibt, sobald in der Datenbank etwas steht. Das Archiv enthält deshalb
  `mietfuchs.sqlite` und `mietfuchs-backup.json` (Version und Zeitpunkt, eine **Auskunft und
  keine Prüfung**; Archive aus älteren Versionen haben sie nicht). Der Schnappschuss entsteht
  mit **`VACUUM INTO` und nicht als Dateikopie**: Der Server hält die Datei die ganze Laufzeit
  offen, und eine laufende SQLite-Datei zu kopieren liefert im schlechtesten Fall einen Stand,
  den es nie gab. `VACUUM INTO` liefert eine Datei, die für sich steht, ohne Beidateien und mit
  der Buchführung über den Aufbau. Geprüft wird sie **vor** dem Austausch, mit derselben Frage
  wie beim Öffnen (`unknownSteps` in open.ts steht dafür nur einmal da, die Empfehlung an den
  Nutzer formuliert jeder Aufrufer selbst): Über den Umweg Backup käme ein neueres Schema sonst
  herein, und die Prüfung beim Start käme zu spät, weil die Datei dann schon an ihrem Platz
  läge. Ersetzt wird nach demselben Muster wie beim Umstieg, also die Schlange leerlaufen lassen,
  schließen, ersetzen, neu öffnen; die bisherige Datei wandert als `mietfuchs.sqlite.vor-restore`
  beiseite. Bewegt wird mit `replaceFile` und damit mit Wiederholungen, wie beim Umstieg: Ein
  Virenscanner unter Windows hält die eben geschlossene Datei kurz fest, und ein nacktes `rename`
  scheiterte dann ausgerechnet, während die einzige Kopie der wiederhergestellten Daten noch
  unter ihrem Zwischennamen liegt.
- **Genau eine der beiden Ablagen kommt ins Archiv, nämlich die, die den Bestand trägt.** Diese
  Regel und ihr Gegenstück beim Wiederherstellen sind aus einer Durchsicht hervorgegangen, und
  ohne sie verliert der Aktualisierungsweg Daten. Ein Archiv konnte beides führen, und beim
  Wiederherstellen gewann die mitgebrachte Datenbank ohne Prüfung. Wer eine Version vor dem
  Umstellen der Routen fährt, hat aber eine lebende `db.json` und eine Datenbank, die auf dem
  Stand des Umstiegstags stehengeblieben ist; und wer ein Backup zieht, während der Umstieg
  gescheitert ist, hat eine **leere** Datenbank neben einer vollen `db.json`. In beiden Fällen
  sah der Vermieter nach der Bestätigung „ok" ein veraltetes oder leeres Haus, schrieb hinein,
  und ab dem Augenblick fand der Umstieg eine gefüllte Datenbank vor und lief nie wieder. Genau
  der Ausgang, den die Sperre in health.ts verhindern soll; das Backup führte daran vorbei.
  Deshalb: Das Backup packt die Datenbank nur ein, wenn `databaseUnavailable` `null` sagt, sonst
  die `db.json`. **Und beim Wiederherstellen gilt eine `db.json` im Archiv vor der Datenbank**,
  denn jede bisher veröffentlichte Version hat sie als lebenden Bestand geschrieben. Geraten wird
  dabei nichts: Ab dieser Version kann gar kein Archiv mehr entstehen, das beides führt.
- **Ein Archiv ohne Datenbank** ist kein Randfall, sondern jedes, das vor dieser Version
  entstanden ist: Dann wird die Datenbank aus der wiederhergestellten `db.json` neu aufgebaut,
  mit `runChangeover` und damit mit derselben centgenauen Regression. Sie wandert dafür ganz
  beiseite statt gelöscht zu werden, damit der Umstieg sie leer vorfindet und seine Regel „steht
  schon etwas darin, passiert nichts" nicht weich wird. **Danach werden die Einstellungen neu
  eingelesen**: Sie liegen als Kopie im Arbeitsspeicher, und ohne das Auffrischen zeigte die
  Oberfläche bis zum nächsten Start den Stand von vorher. Die gedruckte Abrechnung nimmt von dort
  Vermietername und IBAN, und weil `PUT /api/settings` vom Zwischenspeicher ausgeht, schriebe die
  nächste beliebige Änderung den veralteten Stand vollständig zurück.
- **ZIP lesen und schreiben**: Backup und „Belege für die Steuer“ schreibt yazl als Strom an den
  Browser, statt das Archiv im Speicher zusammenzusetzen; jeder Name steht als UTF-8 mit dem
  Kennzeichen dafür da, wie vorher bei adm-zip, und ein Test liest ein neues Backup mit adm-zip
  Byte für Byte zurück, weil der Rückweg in eine ältere Version es so lesen muss. Gelesen wird
  das hochgeladene Archiv mit yauzl über [server/src/zipRead.ts](../zipRead.ts): Es
  prüft zuerst nur das Verzeichnis (Zahl der Einträge aus dem Ende des Archivs, Größe je Eintrag
  und zusammen, Packdichte, Namen) und packt dann als Strom aus, zählt dabei nach und rechnet die
  Prüfsumme nach, die yauzl nicht prüft. Die Grenzen fürs Wiederherstellen stehen mit Begründung
  an `RESTORE_LIMITS` in index.ts (50.000 Einträge, 2 GB je Eintrag, 20 GB zusammen und nicht mehr
  als frei ist, höchstens hundertfach gepackt ab 64 MB). Das hochgeladene Archiv liegt dabei auf
  der Platte, ausgepackt wird in eine Zwischenablage `restore-…` im Datenordner, und erst wenn
  alles gelesen und geprüft ist, wandern die Belege per `rename` in den Belegordner, vor der
  db.json. Reste eines abgebrochenen Vorgangs (`restore-upload-<id>.zip`, `restore-<id>/`) räumt der
  Start weg, `mietfuchs.sqlite.restore-*` bleibt. Die Dateiarbeit samt Platzbedarf (Belege plus
  doppelte Datenbank, doppelte db.json und 64 MB Reserve) steht in
  [server/src/restoreFiles.ts](../restoreFiles.ts); `NKA_TEST_FREE_BYTES` gibt den freien
  Platz für Tests vor. **Namen liest zipRead.ts wie adm-zip**: ohne UTF-8-Kennzeichen als UTF-8,
  wenn die Bytes gültig sind, sonst CP437, danach NFC; yauzl allein läse nach der Norm CP437, und
  ein neu gepacktes Backup bekäme „M├╝ll.pdf“ statt „Müll.pdf“. Beim Schreiben hängt der
  `error`-Horcher von yazl ab `createZip` (sonst beendet eine verschwundene Datei den Server).
  **Datendeskriptor**: yazl schreibt Dateien von der Platte immer mit Bit 3, und einen
  gespeicherten Eintrag damit können Stromleser (funzip, Java ZipInputStream) nicht abgrenzen.
  Das Backup packt deshalb alles (schon Gepacktes mit Stufe 1), das Steuer-ZIP entsteht aus dem
  Speicher (`addBuffer`, ohne Bit 3, PDF und Fotos nur gespeichert), weil ein Steuerberater es mit
  beliebigen Werkzeugen öffnet. Das Aufräumen beim Start nimmt nur die Namen, die die Route
  vergibt (`restore-<16 Hexziffern>`), nie einen Ordner des Nutzers. Der Kontoauszugsleser
  (server/src/bank/read.ts) liest noch mit adm-zip und eigenen Grenzen.

**Der Umstieg** ([server/src/db/changeover.ts](changeover.ts)): Beim ersten Start
der neuen Version wandern die Daten der `db.json` in die Datenbank, ohne dass jemand einen Befehl
eingibt. Die Reihenfolge steht dort ausführlich; kurz: erkennen, prüfen (mit dem Validator,
**bevor irgendetwas geschrieben wird**), in eine eigene Datei `mietfuchs.sqlite.umstieg`
schreiben, importieren, nachrechnen und erst dann mit einem `rename` aktivieren. Zuletzt heißt
die `db.json` **`db.json.abgeloest`**: Ihr Inhalt bleibt unverändert der Rückweg, aber unter
einem Namen, den niemand für den laufenden Stand hält. Seit die Routen die Datenbank schreiben,
läge sie sonst tot im Ordner und sähe doch aus wie vorher. Eine gesonderte Sicherungskopie gibt
es aus demselben Grund nicht mehr: Sie sollte den vorgefundenen Stand einfrieren, *während* die
`db.json` weiterbenutzt wurde, und zwei byteweise gleiche Dateien nebeneinander erklären
niemandem etwas. `umstieg-protokoll.txt` nennt, was übernommen wurde.

- **Die centgenaue Regression ist die Bedingung, unter der überhaupt aktiviert wird**
  ([server/src/db/regression.ts](regression.ts)). Für jedes Jahr, in dem der
  Bestand etwas enthält, **und jedes Jahr dazwischen**, werden Abrechnung,
  Verbrauchsübersicht, Mietkonto und Steuerübersicht aus beiden Beständen gerechnet und
  verglichen. Die Jahre dazwischen gehören dazu, weil ein Mietverhältnis durch sie hindurchläuft
  und der Verbrauch zwischen zwei Ablesungen interpoliert wird; ein unbefristetes
  Mietverhältnis reicht bis ins laufende Jahr, sonst bliebe gerade das Jahr ungeprüft, in dem
  der Vermieter arbeitet. Weicht ein Cent ab, wird nicht aktiviert, und die Meldung nennt Jahr
  und Zahl. **Ausgenommen sind genau sieben Angaben** (`unitName`, `tenantName`, `description`,
  `basisText`, `warnings`, `notices`, dieselben Meldungen in fester Gestalt, und `steps`, der
  Rechenweg aus denselben Beschriftungen), jede eine, die das Geraderücken ausdrücklich verändern darf; sie
  stehen benannt in regression.ts. Verglichen wird gegen den Bestand, wie Mietfuchs ihn **heute**
  rechnet, und nicht gegen den schon geradegerückten: Sonst prüfte die Regression das
  Geraderücken gegen sich selbst. Die eine Ausnahme davon ist der feste Monatsbetrag neben einer
  leeren Staffel, und sie steht als `standToCompare` sichtbar da.
- **Das Geraderücken steht als Funktion in legacy/migrate.ts** (`straightenForDatabase`), nicht im
  Umstieg. Dieselbe Datei hält die Regeln des Einlesens, und validate.test.ts rechnet mit
  **dieser** Funktion nach, dass keine Zahl wandert. Solange das nur in den Tests von Hand
  geschah, waren die Hinweise des Validators eine Beschreibung ohne Gegenstück im Code.
- **Scheitert ein Schritt, ist der alte Zustand unberührt**, Mietfuchs arbeitet mit der `db.json`
  weiter, und beim nächsten Start wird es erneut versucht. Jeder Abbruch hat seinen eigenen Test
  ([db-changeover.test.ts](../../test/db-changeover.test.ts)); zwei davon lassen sich von außen
  nicht herbeiführen (das Einfügen und die Regression), dafür gibt es benannte Griffe in den
  Optionen. `runChangeover` **wirft nie**: Auch das Aufräumen im Fehlerfall schluckt, was es
  nicht schafft, sonst käme aus dem Umstieg eine Ausnahme statt einer Meldung.
- **Ohne WAL, und vor dem `rename` wird nachgesehen.** Ein `rename` bewegt nur die Hauptdatei;
  eine liegengebliebene `-wal` oder `-journal` gehörte danach zu keiner Datenbank mehr. Die
  Verbindungen werden vorher geschlossen, denn unter Windows lässt sich eine geöffnete Datei
  nicht ersetzen, und der `rename` hat ein paar Wiederholungen, weil ein Virenscanner sie
  kurzzeitig offen halten kann.
- **Gelesen und geschrieben wird über [read.ts](read.ts) und
  [write.ts](write.ts)**, und beide sind mechanisch: eine Spalte je Feld, keine
  fachliche Regel. `read.ts` liest **in der Reihenfolge, in der die Zeilen angelegt wurden**
  (`ORDER BY rowid`). Das ist keine Kosmetik: Zwei Ablesungen mit demselben Datum sortiert die
  Berechnung stabil, es gilt also die Reihenfolge der Datei, und welcher der beiden Stände der
  spätere ist, entscheidet über den Verbrauch. Fehlt die Zeile der Einstellungen, gelten die
  Vorgabewerte einer neuen Einrichtung ([server/src/defaults.ts](../defaults.ts)) — das
  ist jeder erste Start, denn die Zeile entsteht erst beim ersten Speichern. Entschieden wird das
  an der **Zeile** und nie an einem Wert: Ein Feld, das der Nutzer geleert hat, bleibt leer.
- **Der Nutzer erfährt es in der Oberfläche**, nicht nur auf der Konsole: Beim Start aus einem
  Linux-Paket gibt es keine. Der Weg dafür ist `database.changeover` in `/healthz`
  ([client/src/components/Database.tsx](../../../client/src/components/Database.tsx), Logik in
  [client/src/database.ts](../../../client/src/database.ts)). Gelungen ist ein Satz mit einem Knopf,
  gescheitert eine Erklärung samt der Zusage, dass unverändert weitergearbeitet wird. Unterbleibt der Umstieg, weil die Datenbank schon Daten trägt und
  daneben eine `db.json` liegt, ist das der Zustand `stale` (#89): kein Fehler, sondern ein
  Hinweis mit dem Weg über das Backup. `none` bleibt der stumme Normalfall.
  Nach einem Update nennt `database.migrated` die Sicherung, die `backupBeforeMigrating` vor dem
  Nachholen angelegt hat (`{ steps, backup, at }`, nur der Dateiname, denn sie liegt immer im
  Datenordner), und die Oberfläche zeigt einmal einen Hinweis mit dem Rückweg aus MIGRATION.md
  (#154). `null` ist es bei einer frisch angelegten Datenbank, nach dem Umstieg aus der
  `db.json` (Rückweg ist dort `db.json.abgeloest`) und nach dem Wiederherstellen eines Backups
  (dort `mietfuchs.sqlite.vor-restore`); eine Meldung nennte sonst eine Datei, die es nicht gibt.
  Liegt eine Sicherung gleichen Namens schon da (ein früher gescheitertes Update), wird sie als
  `….vom-JJJJ-MM-TT-HHMM` beiseitegelegt und neu gesichert, nie wiederverwendet: Sie hielte einen
  Stand fest, hinter dem seitdem gearbeitet wurde. Das Wegklicken merkt sich die Oberfläche je
  Name und Zeitpunkt. **Der Hinweis übersteht einen Neustart** (#180): Wer in Docker oder mit npm
  neu startet, bevor er die Oberfläche öffnet, verlor ihn sonst. Gemerkt wird er in der kleinen
  Datei `sicherung-vor-update.json` im Datenordner ([server/src/db/migrationNotice.ts](migrationNotice.ts)),
  bewusst nicht in der Datenbank: Er gehört zum Update, nicht zum Bestand, und braucht so keine
  Migration und kommt nicht ins Backup. Weg ist er, wenn „Verstanden“ ihn mit
  `POST /api/database/migrated/seen` meldet (nur mit passendem Schlüssel `Name@Zeitpunkt`), wenn
  ein Backup eingespielt wird oder wenn die genannte Sicherung fehlt. Die Konsole nennt die
  Sicherung mit vollem Pfad, aber nur beim Start, der sie angelegt hat. **Entschieden wird erst
  nach dem Umstieg** (`noteAfterChangeover` in index.ts): Lag eine leere Datenbank eines früher
  gescheiterten Umstiegs neben der `db.json`, sichert das Nachholen der Schritte einen leeren
  Stand; nach `done` gibt es deshalb weder Hinweis noch Merkdatei noch Konsolenzeile, nach
  `failed` in diesem Lauf keinen Hinweis.
