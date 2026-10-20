# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

**Mietfuchs** — lokales Web-Tool für die Nebenkostenabrechnung privater Vermieter (Deutschland).
Alles läuft auf dem eigenen Rechner — keine Cloud, kein Konto. Sprache von UI, Kommentaren und
Domänenbegriffen ist durchgängig **Deutsch**; bitte beibehalten. Bezeichner im Code sind dagegen
**englisch** (siehe Konventionen).

## Commands

Vom Repo-Root (npm-Workspaces-artiges Setup ohne echte Workspaces — `postinstall` installiert
Server und Client mit):

```powershell
npm install        # installiert Root + server + client
npm run dev        # concurrently: Server (Port 3001) + Vite (Port 5173)
npm test           # alle Tests: Server (node:test) + Client (vitest)
npm run test:server # nur Engine- und API-Tests
npm run test:client # nur Formularlogik- und Komponententests
npm run build      # baut das Frontend nach client/dist (tsc --noEmit + vite build)
npm run typecheck  # nur Typprüfung: Server, Skripte, Client, vite.config.ts (tsc), ohne Build
npm --prefix server run db:generate # neue Migration aus server/src/db/schema.ts erzeugen
npm start          # Produktivbetrieb: Server liefert App + API auf Port 3001
npm run package    # baut eigenständige Binaries nach dist-bin/ (braucht Bun)
npm run package:linux # baut daraus .deb/.rpm/Arch-Pakete (braucht nFPM oder Docker)
npm run screenshots # Bildschirmfotos fürs README nach docs/screenshots (braucht Playwright-Chromium)
npm run browser-check # Browserlauf: jede Seite in Chromium, Firefox, WebKit mit axe (braucht die drei Browser)
```

Einzelnen Test ausführen:

```powershell
npm --prefix server test -- --test-name-pattern "Flächenschlüssel"
npm --prefix client test -- costForm
```

Es gibt **keinen Linter**; `npm run typecheck` prüft per `tsc` vier Teile: Server, Client, die
Vite-Konfiguration ([client/tsconfig.node.json](client/tsconfig.node.json), mit Node- statt
DOM-Typen) und die Skripte in `scripts/` und `server/scripts/` ([scripts/tsconfig.json](scripts/tsconfig.json), #64).
`npm run build` schließt die Prüfung des Clients samt Vite-Konfiguration mit ein und baut
zusätzlich das Frontend.

**Die Skripte bleiben JavaScript** und werden mit `checkJs` geprüft, mit dem Compiler und den
Node-Typen des Servers. Eine einzige Einstellung weicht vom Server ab, `noImplicitAny` ist aus:
Mit ihr verlangte der Übersetzer rund 140 JSDoc-Angaben an Parametern, und gewonnen wäre wenig,
denn bei Skripten zählen Tippfehler, verschwundene Importe und geänderte Node-Schnittstellen,
und die findet er auch so. Alles andere muss dem Server gleichen, weil die Skripte aus
`server/src` importieren und der Übersetzer diese Dateien im selben Lauf mit den Einstellungen
der Skripte noch einmal prüft (mit `strict: false` meldete er dort Fehler, die es im Server
nicht gibt). Eine Folge davon: Eine Variable in `server/src`, die mit `null` beginnt, bekommt
ihren Typ ausdrücklich (`let x: number | null = null`), sonst bleibt sie ohne `noImplicitAny`
vom Typ `null`, und dieser Lauf wird rot. Wo ein Skript unbekanntes JSON liest, steht ein
benanntes `/** @type {any} */` statt einer Typbeschreibung der Antwort; was darin steht, prüfen
die Zusicherungen des Skripts. Ein neues Skript `scripts/*.mjs` oder `server/scripts/*.mjs` ist
ohne weiteres Zutun dabei.

**Tests, drei Ebenen** — beim Erweitern der Verteilung oder der Formulare jeweils mitdenken:

1. [server/test/calc.test.ts](server/test/calc.test.ts) — Engine (node:test, kein Framework).
   Neben Beispielfällen prüfen drei Tests Invarianten über zufällig erzeugte Datenbestände
   (fester Startwert, also reproduzierbar): Mieteranteile + Vermieteranteil = Gesamtkosten,
   keine negativen Anteile, Eigenanteil ≤ Vermieteranteil. Einzelfall-Tests übersehen genau
   die schiefen Konstellationen — ein Geldverlust bei der Direktzuordnung fiel erst hier auf.
2. `server/test/api-*.test.ts` — Integration: startet den Server als
   eigenen Prozess mit `NKA_DATA_DIR` auf einem Wegwerf-Ordner (deshalb gibt es diese
   Variable) und prüft die Routen. Berührt nie eine vorhandene `db.json`. `NKA_UPDATE_URL`
   zeigt dort standardmäßig auf einen geschlossenen Port, damit kein Test GitHub erreicht.
   **Zehn Dateien nach Themen statt einer** (#263): `node --test` verteilt nur Dateien auf
   Prozesse, nicht die Tests einer Datei, und die eine api.test.ts mit rund 270 Serverstarts
   bestimmte allein das Ende des ganzen Laufs (418 von 420 Sekunden). Die gemeinsamen Helfer
   (Antworttypen, `startServerIn`, `startServerRaw`, die nachgebauten Dienste) stehen in
   [server/testing/api.ts](server/testing/api.ts); was nur ein Teil braucht, steht bei ihm.
   Ein neuer Test gehört in die Datei seines Themas; wird eine Datei deutlich länger als die
   anderen, lohnt das Teilen wieder.

**Wer für eine Prüfung einen Server startet, setzt drei Dinge**, und zwar immer zusammen. Das
gilt für Tests, für Skripte und für jede Probe von Hand:

- **`NKA_DATA_DIR`** auf einen Wegwerf-Ordner. Ohne ihn läuft die Prüfung gegen den echten
  Bestand des Entwicklers, und der Umstieg, das Wiederherstellen und das Löschen von Belegen
  schreiben dort wirklich.
- **`CI=1`** gegen das Browserfenster. In der Betriebsart `binary` oder `package` öffnet
  Mietfuchs beim Start den Standard-Browser ([version.ts](server/src/version.ts), `STANDALONE`).
  Bei einer Prüfung nützt das niemandem, und auf einem Arbeitsrechner nimmt es den Fokus weg,
  oft mehrfach hintereinander. Ein Fenster gehört nur dorthin, wo es wirklich gebraucht wird,
  also zu einem Browser-Test oder einem Screenshot. Nötig ist das auch dann, wenn nur
  `NKA_RUNTIME=binary` gesetzt ist, um den gepackten Betrieb nachzustellen.
- **`NKA_UPDATE_URL`** auf einen geschlossenen Port, damit keine Anfrage zu GitHub hinausgeht.

Dieselben drei stehen in [server/testing/api.ts](server/testing/api.ts) (`startServerIn` und
`startServerRaw`) und in [scripts/umstieg-praxislauf.mjs](scripts/umstieg-praxislauf.mjs); wer
einen neuen Prüfpfad baut, nimmt sie von dort.

**`CI` steht dort hinter dem `...env` des Aufrufers und nicht davor**, kann also nicht
versehentlich überschrieben werden. Das ist kein Übereifer: `startServerIn` setzte es gar nicht,
ein Aufrufer stellt mit `NKA_RUNTIME: 'binary'` die Programmdatei nach, und damit riss **jeder
volle Testlauf** ein Browserfenster auf, auf einem Zufallsport, weil `NKA_PORT` dort `'0'` ist.
Ein Wächter in api-start.test.ts liest deshalb den `env`-Block jedes Serverstarts in jeder
Datei unter `server/test/` und `server/testing/` und verlangt das `CI`. Geprüft wird der
Quelltext, denn am Verhalten ließe es sich nur messen, indem der Test genau das tut, was er
verhindern soll.

**Frische Datenbank für einen Test: die Vorlage** (#263,
[server/testing/freshDatabase.ts](server/testing/freshDatabase.ts)). Wer eine leere, voll
migrierte Datenbank braucht, nimmt `openFreshDatabase(dataDir)` statt `openDatabase({ dataDir })`
auf einem leeren Ordner. Die ganze Kette je Test kostete gut eine Viertelsekunde (ein fsync je
Schritt), in der Invariante mit über 1.700 Läufen je Abschnitt war das im Profil rund 40 Prozent
der Rechenzeit. So geht es: Je Testprozess entsteht beim ersten Aufruf **einmal** eine Vorlage,
mit `openDatabase` auf einem Wegwerf-Ordner, also mit der Kette, wie sie gerade auf der Platte
steht; nichts davon wird eingecheckt, und die Vorlage endet mit ihrem Prozess. Jeder Test bekommt
eine Dateikopie in seinen eigenen Ordner (zulässig, weil die Vorlage geschlossen ist und ohne
WAL läuft), **geöffnet wieder mit `openDatabase`**: Fremdschlüssel, `integrity_check`,
Schreibprobe und Abgleich mit der Kette laufen also wie bei jedem Start, kein Pragma muss
nachgestellt werden. Musste beim Öffnen der Kopie noch ein Schritt nachgeholt werden, ist die
Vorlage veraltet, und der Helfer wirft, statt es still nachzuholen.
[fresh-database.test.ts](server/test/fresh-database.test.ts) vergleicht die Kopie mit einer frisch
migrierten Datenbank (Aufbau, Inhalt, Pragmas). **Bei der echten Kette bleiben** alle Tests, die
die Kette selbst prüfen: db-open, db-changeover, db-objekte, migrations, migration-notice,
legacy-guard, ueberschneidung-bestand, die Serverstarts der Integrationstests und alles über
`openDatabaseWithStock` (der eingefrorene Eingang: 0000, Bestand, dann die Kette).
3. `client/src/**/*.test.ts(x)` — vitest. Die Entscheidungslogik der Formulare liegt in
   [client/src/costForm.ts](client/src/costForm.ts) und
   [client/src/unitForm.ts](client/src/unitForm.ts), damit sie ohne DOM prüfbar ist; die
   Seiten sollen darüber nur noch rendern. Dazu ein jsdom-Komponententest
   ([Kosten.test.tsx](client/src/pages/Kosten.test.tsx), fordert die Umgebung per
   `@vitest-environment jsdom` selbst an) für die eine Eigenschaft, die reine Logik nicht
   sieht: **der angezeigte Wert eines Auswahlfelds muss dem gespeicherten entsprechen.** Steht
   der State-Wert nicht in der Optionsliste, zeigt der Browser den ersten Eintrag, ohne ein
   `change`-Ereignis zu senden — gespeichert wird dann etwas anderes als das Sichtbare. Neue
   Selects deshalb über `meterTypeOptions`/`costKeyOptions` speisen.
   [client/src/vitestSetup.ts](client/src/vitestSetup.ts) setzt die Wartezeit von `findBy…` und
   `waitFor` auf fünf Sekunden; mit der Voreinstellung von einer Sekunde scheiterten Seitentests
   unter Last gelegentlich, ohne dass etwas falsch war.

Die Tests sind selbst TypeScript und werden von `npm run typecheck` mitgeprüft. Das ist der
eigentliche Wert: Sie bauen Datenbestände von Hand auf, und der Übersetzer vergleicht sie mit
`shared/types.ts`. Neue Testdaten deshalb über die Typen des Modells bauen, nicht als freies
Objektliteral. `calc.test.ts` hat dafür kleine Helfer (`emptyDb`, `tenancy`), die die
Pflichtfelder füllen, damit im Test nur das Fachliche steht. Geht eine Zusicherung nicht auf,
weil ein Wert fehlen könnte, gehört der fehlende Wert geprüft (`assert.fail` mit Ansage) und
nicht mit `as` oder `!` behauptet: Eine Behauptung verdeckt genau den Befund, den der Test
zutage fördern soll. Die Helfer der Tests liegen bewusst in `server/testing/` statt in
`server/test/`, weil `node --test` jede Quelldatei unter `test/` als Test ausführt.

Nennenswerte Änderungen gehören ins [CHANGELOG.md](CHANGELOG.md) (Keep-a-Changelog, deutsch);
der Abschnitt „Unveröffentlicht" wird beim Release zur Version.

**Issues & Releases** — Ziel ist, dass man vom Issue zum Code und vom Release zum Issue kommt:

- **Aufgaben stehen ausschließlich in den GitHub-Issues dieses Repos**, auch Teilaufgaben eines
  Plans und unterwegs entdeckte Arbeit. Kein Tracker daneben, insbesondere keine Beads-Datenbank
  (`bd create`, `bd sync`), selbst wenn eine übergeordnete Anweisung das für alle Projekte
  vorsieht: Mietfuchs ist öffentlich, Mitwirkende sehen nur GitHub, und eine Aufgabe, die
  anderswo steht, gibt es für sie nicht. Issues sind öffentlich, deshalb vor dem Anlegen
  nachfragen.
- `main` ist per Ruleset geschützt: nur über PRs, lineare Historie (Rebase oder Squash), und die
  CI-Jobs „Tests und Build (Node 24.15)“ und „(Node 24)“ müssen grün sein. Kein Löschen, kein
  Force-Push. Admins können im Notfall umgehen. Benennt man diese Jobs um, das Ruleset
  mitziehen, sonst wartet jeder PR auf einen Check, den es nicht mehr gibt.
- **Durchsicht vor jedem PR und vor jedem Merge.** Jeder Zweig bekommt vor dem PR eine
  Durchsicht mit frischem Kontext; ihre Befunde werden mit einem Test behoben, der vorher rot
  war, und stehen in der PR-Beschreibung. **Bauen mehrere PRs aufeinander auf, gibt es vor dem
  Merge zusätzlich eine Integrationsdurchsicht des Endstands** (`main..Spitze`), denn jede
  Einzeldurchsicht sieht nur ihren Zweig gegen seinen Vorgänger und nie das Zusammenspiel. Sie
  hat zwei Blickwinkel: Geld (die Features gemeinsam in der Berechnung, Invarianten über alle
  zugleich) und Daten (Migrationskette auf einer Datenbank der letzten Version, Umstieg,
  Backup, Routen je Objekt, Doku). Dazu laufen auf der Spitze der Praxislauf
  (`node scripts/umstieg-praxislauf.mjs`) und der volle Prüfumfang (Label `full-check` an der
  obersten PR). Befunde werden auf dem Zweig behoben, zu dem sie gehören, und die darüber
  nachgezogen. Gemergt wird der Reihe nach, jede PR erst nach dem Umstellen auf `main` und
  grüner CI.
- Eine Behebung referenziert ihr Issue mit **`Refs #N`** im PR-Text bzw. in der
  Commit-Nachricht. Das erzeugt die Verknüpfung im Issue-Verlauf. **Nicht** `Fixes`/`Closes #N`:
  diese Schlüsselwörter schließen das Issue schon beim Merge nach `main`, also bevor Nutzer den
  Fix bekommen.
- Der Changelog-Eintrag nennt das Issue als Link, `([#N](https://github.com/speedone/mietfuchs/issues/N))`
  — in Repo-Dateien verlinkt GitHub ein nacktes `#N` nicht. In Release-Notes genügt `(#N)`.
  Nummern nur dort, wo das Issue den Punkt tatsächlich verlangt hat.
- Geschlossen wird **beim Release**: kurzer Kommentar mit Link auf das Release, in der Sprache
  des Melders, dazu nötige Schritte für bestehende Daten. Danach das Issue als *completed*
  schließen.
- **Labels, knapp gehalten.** Die Art steht ohne Präfix (`bug`, `enhancement`, `documentation`,
  `chore`), denn GitHub und Dependabot vergeben einige davon selbst; wer sie umbenennt, bricht
  das und gewinnt nur Symmetrie. Mit Präfix stehen die beiden Dimensionen, nach denen man
  wirklich filtert: `priority: high | medium | low` und `status: awaiting release | needs
  decision`. Die Grenze der Dringlichkeit ist fachlich gezogen und nicht abstrakt: **hoch** heißt
  „geht an Geld oder Daten", also falsche Zahlen in einer zugestellten Abrechnung oder in der
  Steuer oder Datenverlust; **mittel** heißt falsch angezeigt, ohne dass eine Zahl wandert;
  **niedrig** heißt, kein Nutzer merkt es. `status: awaiting release` trägt, was behoben und in
  `main` ist: Weil erst beim Release geschlossen wird, sieht man sonst nicht, welche offenen
  Issues eigentlich erledigt sind. Bereichs-Labels gibt es bewusst nicht, dafür sind es zu
  wenige Issues; ab etwa dreißig lohnen sie.
- **`ai-eval` und `full-check` sind keine Beschriftungen, sondern Schalter** und deshalb ohne
  Präfix und klein geschrieben. Sie starten den KI-Prüflauf beziehungsweise die volle
  Artefaktmatrix an einem Pull Request. Ihre Namen stehen im Klartext in
  [ai-eval.yml](.github/workflows/ai-eval.yml) und [release.yml](.github/workflows/release.yml):
  Wer eines umbenennt, ohne den Workflow mitzuziehen, schaltet den Auslöser **lautlos** ab,
  dieselbe Falle wie bei den Job-Namen im Ruleset.
- Release-Notes aus dem Changelog-Abschnitt erzeugen, dabei die harten Zeilenumbrüche der
  Listenpunkte zusammenziehen — GitHub stellt jeden Umbruch in Release-Texten als echten dar.
  Die automatisch erzeugte Nennung neuer Beitragender übernehmen.

## Architektur

Zwei getrennte npm-Pakete: `server/` (Express, ESM, TypeScript) und `client/` (React 19 + Vite +
TypeScript), dazu der Ordner `shared/` mit dem gemeinsamen Datenmodell (#48). Der Server wird
nicht gebaut: Node führt die `.ts`-Dateien unmittelbar aus und streift die Typen dabei ab, das
ist ab Node 24.12 stabil und einer der beiden Gründe für die Untergrenze in `engines` (der
andere ist die Warnung von `node:sqlite`, siehe Node-Versionen). Geprüft werden sie
trotzdem, durch `npm run typecheck`. Im Dev proxyt Vite `/api` und `/uploads` an
`localhost:3001` ([client/vite.config.ts](client/vite.config.ts)); im Produktivbuild liefert der
Express-Server das statische `client/dist` selbst aus
([server/src/index.ts](server/src/index.ts)).

**Persistenz**: die SQLite-Datei `server/data/mietfuchs.sqlite` (#55). `NKA_DATA_DIR` verlegt den
Ordner (Tests, abweichende Ablage). Belege liegen in `server/data/uploads/`, API-Schlüssel
externer KI-Dienste getrennt davon in `server/data/secrets.json` (siehe secrets.ts; nicht im
Backup). Backup = diesen Ordner kopieren. Daneben liegen nach dem Umstieg
`db.json.abgeloest` mit dem Bestand von davor und `umstieg-protokoll.txt`.

Die frühere `db.json` ist damit **Vergangenheit und nicht mehr Ablage**: Sie wird gelesen, wenn
ein Bestand von vor dem Umstieg übernommen oder ein altes Backup eingespielt wird, und danach nie
wieder geschrieben. Die Umwandlung ihrer alten Formate steht in
[server/src/legacy/migrate.ts](server/src/legacy/migrate.ts) (z. B. fester Monatsbetrag zur
Vorauszahlungs-Staffel), in einer **eigenen Datei** und nicht mehr in `load()`, weil der Umstieg
dieselben Regeln braucht: Ein Bestand, der beim Einlesen anders geradegezogen würde als beim
Übernehmen, änderte beim Umstieg still eine Abrechnung. Die Tests dazu stehen in
[server/test/store.test.ts](server/test/store.test.ts) und halten jede Regel einzeln fest;
wer dort etwas ändert, sieht am roten Test, dass er eine Abrechnung verändert. Der Rest von
store.ts (`getDb`, `save`, `reloadDb`) ruft niemand mehr auf; gebraucht werden nur noch
`chooseDataDir`, `DATA_DIR`, `UPLOAD_DIR`, `newId` und der Typ `Db`.

## Wo was steht

Die Einzelheiten stehen in eigenen Dateien. Claude Code lädt eine `CLAUDE.md` in einem
Unterordner, sobald dort Dateien gelesen werden; `docs/heizung.md` muss man selbst öffnen.

- [scripts/CLAUDE.md](scripts/CLAUDE.md): Bildschirmfotos, Browserlauf, Programmdateien,
  Linux-Pakete, Startmenü, Docker-Image, Node-Versionen, Release-Automatik, Artefakt-Tests,
  Praxislauf des Umstiegs, Prüfumfang je Anlass.
- [server/src/db/CLAUDE.md](server/src/db/CLAUDE.md): Die Datenbank (Treiber, Schlange,
  Migrationen, eingefrorener Eingang, Validator, Backup und Wiederherstellen, ZIP) und der Umstieg.
- [server/src/CLAUDE.md](server/src/CLAUDE.md): Objekte, Abrechnungszeitraum, Fristen und
  Feiertage, Belegordner, API, Schnappschuss, Hinweise und Rechtsregister, IBAN, Rechenweg,
  Schlüssel merken, doppelte Positionen, Belegbuchung, Berechnungs-Engine (Verteilung, Zähler,
  Leerstand, Betriebsstrom, Contracting, § 5a, Mietkonto, Steuer), Update-Hinweis.
- [docs/heizung.md](docs/heizung.md): Heizanlage, eigene Heizperiode, CO₂, Lieferungen, mehrere
  Anlagen, eigene Heizkostenabrechnung, monatliche Information, Brennstoffvorrat. **Vor jeder
  Arbeit an der Heizung lesen.**
- [server/src/ai/CLAUDE.md](server/src/ai/CLAUDE.md): KI-Belegauswertung, Anbieter, rohe Antwort
  und Zusage, Bestätigung externer Dienste, Modelle, Seitenbilder, KI-Prüflauf.
- [client/CLAUDE.md](client/CLAUDE.md): Darstellung der Hinweise, Leerzustände, Lexikon,
  Anleitungen, Client, mobile Navigation, Stile und Tokens, und alle Konventionen der Oberfläche
  (Meldungen, Rückfragen, Seitenfenster, Verben, Karten, Felder, Monatsfeld, Seitenleiste, Entwürfe).

Verweise wie „siehe Browserlauf“ oder „siehe Node-Versionen“ meinen den gleichnamigen Abschnitt
in einer dieser Dateien.

**Das Datenmodell steht in [shared/types.ts](shared/types.ts)** (Unit, Tenancy, Meter, Reading,
CostItem, Settings, Settlement …) und gilt für Server und Client gleichermaßen. Die Datei
enthält ausschließlich Typen und keinen Laufzeitanteil; beide Seiten importieren sie
unmittelbar, deshalb kann eine Änderung am Modell nicht mehr nur auf einer Seite ankommen.
Der Ordner hat bewusst **keine eigene `package.json`** (Vite sucht darüber die Wurzel des
Arbeitsbereichs); stattdessen trägt die Wurzel-`package.json` `"type": "module"`. Ohne dieses
Feld gälte `shared/types.ts` für den Übersetzer als CommonJS, und ein gemeinsamer Helfer neben
den Typen wäre dort gar nicht zu schreiben: `tsc` lehnte ihn mit TS1287 ab, und Node lüde die
Datei nur über einen Notpfad mit der Warnung `MODULE_TYPELESS_PACKAGE_JSON`.

Die Grenze zu [client/src/types.ts](client/src/types.ts) hängt an einer einzigen Frage:
**Brauchen beide Seiten dasselbe?** Nur dann gehört ein Typ, ein Feld oder ein Wert eines
Aufzählungstyps nach `shared/`, denn nur dann kauft man sich damit etwas ein, nämlich dass eine
Änderung nicht auf einer Seite ankommt und auf der anderen nicht. Was nur eine Seite kennt,
bleibt bei ihr, und zwar auch dann, wenn es über die Leitung geht: `Db` und `ComputedSettlement`
im Server, die Formularzustände im Client, und ebenso `ClientSettings` in server/testing/api.ts, das genau
die Antwort von `GET /api/settings` beschreibt und trotzdem nur den Server etwas angeht, weil
der Client sie nie so liest.

Beim Client bleibt deshalb auch alles, was die Oberfläche aus dem Modell macht: die
Beschriftungen (`UNIT_USAGE_LABELS`, `METER_TYPE_LABELS`, `CATEGORIES`) und die Helfer
(`usageOf`, `matchCategory`, `defaultKeyFor`). Seine Datei reicht das gemeinsame Modell per
`export type *` weiter, sodass die Importe der Seiten unverändert auf `../types` zeigen; der
Server importiert `shared/types.ts` unmittelbar.

Die `KEY_LABELS` existieren bewusst doppelt: calc.ts liefert die Beschriftung, die auf der
fertigen Abrechnung steht, client/src/types.ts eine eigene für die Eingabe-Oberfläche.

## Konventionen & Fallstricke

- **Sprache im Code.** Bezeichner sind englisch: Variablen, Funktionen, Typen, Datei- und
  Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`,
  `rentLedger`, `buildCostItemBody`). Deutsch bleiben Kommentare, Oberflächentexte,
  Fehlermeldungen, Testnamen, Commit-Nachrichten und gespeicherte Fachwerte (`'vermietet'`,
  `'kaltwasser'`, die Kostenarten). Seitenkomponenten heißen wie die Seite (`Kosten.tsx`).
- **Nutzertexte siezen; README und Entwicklerdoku duzen** (#142). Das gilt für Oberfläche,
  Lexikon, Meldungen des Servers, Konsole und Startmenü, auch für MIGRATION.md, die sich an
  Vermieter richtet. Die Prompts an das Modell sind davon ausgenommen. Ein Wächter
  ([anrede.test.ts](server/test/anrede.test.ts)) sucht im Quelltext nach Du-Formen.
- **Geld immer in Cent als Integer.** Eingabe-Parsing (deutsche + technische Schreibweise) über
  `parseEuro`; Ausgabe über `fmtEuro`.
- **Datums-Logik** rechnet in UTC mit inklusiven Grenzen — beim Anfassen von calc.ts die
  bestehende Konvention beibehalten und gegen [server/test/calc.test.ts](server/test/calc.test.ts)
  prüfen.
- **Nichts in calc.ts hängt an der Locale der Laufzeit** (#70). Ein blankes `localeCompare()`
  liest die Einstellung des Rechners, und dieselben Daten ergäben auf zwei Rechnern zwei
  Reihenfolgen; bei `largestRemainder` entscheidet sie, wer den Rest-Cent bekommt.
  Abgeschafft wird die Sprache deshalb aber nicht, sondern festgenagelt, wie beim Formatieren
  mit `'de-DE'` in derselben Datei. Es gibt zwei benannte Funktionen, und welche gilt, entscheidet
  der Zweck: `compareText` vergleicht Zeichen für Zeichen, wo die Reihenfolge eine Bedeutung
  trägt (Kennungen, ISO-Daten, Staffeln); `compareName` sortiert mit fest eingestelltem Deutsch,
  wo ein Mensch die Liste liest, sonst stünde „Älter" hinter „Zaun". Ein Test prüft den
  Quelltext, denn auf einem einzelnen Rechner sagen beide Ordnungen dasselbe. Wer eine weitere
  Stelle anfasst, die eine Staffel oder Ablesungen sortiert, nimmt `compareText` von hier und
  schreibt den Vergleich nicht noch einmal hin.

- **Wer nach Plattform unterscheidet, bekommt sie hineingereicht**, wie `systemLocation` und
  `chooseDataDir` in paths.ts und store.ts und `networkLocation` in db/open.ts. Dazu gehört, mit
  `path.win32` beziehungsweise `path.posix` zu rechnen statt mit der Voreinstellung, und ebenso
  das hineinzureichen, was die Funktion sonst noch vom Rechner erfragt (Schreibrecht,
  Einhängepunkte, der wirkliche Ort einer Datei). Sonst prüft jeder Zweig nur dort, wo zufällig
  jemand entwickelt, und die CI wirft den anderen um. Das ist in diesem Projekt schon zweimal
  passiert, beide Male auf dem Linux-Runner. Ein Test unter `if (process.platform === …)` zu
  überspringen ist dafür kein Ausweg, sondern die Aufgabe der Prüfung.
- **Im Server tragen Importe die Endung `.ts`** (`import { load } from './store.ts'`). Node
  führt die Dateien unmittelbar aus und löst den Pfad auf, wie er dasteht; eine Endung `.js`
  oder gar keine zeigt ins Leere. Der Übersetzer erlaubt das über `allowImportingTsExtensions`.
  Im Client gilt die Regel nicht, dort bündelt Vite: Seine Importe bleiben endungslos
  (`from './types'`). Nur sein Import aus `shared/` trägt die Endung
  (`from '../../shared/types.ts'`), weil dieselbe Datei auch der Server unmittelbar lädt.
- **Reine Typimporte brauchen `import type`** (`verbatimModuleSyntax`). Sonst bliebe der Import
  beim Ausführen stehen und Node suchte nach einer Datei, die nur Typen enthält.
- **Kein Konstrukt, das erst beim Übersetzen entsteht** (`erasableSyntaxOnly`): keine `enum`,
  keine `namespace`, keine Parameter-Eigenschaften im Konstruktor (`constructor(private x)`),
  kein `declare` in einer Klasse. Node streift Typen nur ab, es übersetzt nicht; was Code
  erzeugen würde, wäre nach dem Abstreifen verschwunden. Statt `enum` ein Vereinigungstyp aus
  Zeichenketten, wie ihn `UnitUsage` oder `CostKey` in shared/types.ts zeigen.
- **Beide Pakete fahren dieselbe Compiler-Fassung und dieselben strengen Einstellungen** (#64):
  `typescript ^7.0.2` in `server/package.json` und `client/package.json`, `erasableSyntaxOnly`
  und `verbatimModuleSyntax` in beiden `tsconfig.json`. Die beiden Regeln oben gelten deshalb
  im ganzen Projekt. Der Grund ist `shared/types.ts`: Beide Seiten prüfen dieselbe Datei, und
  mit verschiedenen Regeln ginge auf einer Seite etwas durch, das Node ohne Bauschritt nicht
  ausführen kann. Der Client merkte nichts davon, weil Vite es für ihn übersetzt; auffallen
  würde es erst beim Start des Servers. Für sich genommen bräuchte der Client die Einschränkung
  nicht, sein Bündler könnte mehr — dass er trotzdem auf `enum` und auf stehenbleibende
  Typimporte verzichtet, ist der Preis für diese eine Zusage. Wird eine der beiden Fassungen
  angehoben, die andere mitziehen; sonst sagen die Prüfer wieder Verschiedenes über dieselbe
  Datei.
- **`npm run typecheck` ist die einzige Prüfung.** Es gibt keinen Linter, und weil der Server
  ohne Build-Schritt läuft, merkt niemand sonst einen Typfehler. Vor jedem Commit also einmal
  laufen lassen (`npm run build` schließt dieselbe Prüfung für den Client ein). Sie umfasst auch
  `client/vite.config.ts`, `scripts/*.mjs` und `server/scripts/*.mjs` (siehe Commands).
- Der Server nutzt bewusst **`NKA_PORT`** statt `PORT` (generische `PORT`-Variablen von
  Preview-Tools kollidieren sonst mit Vite).
- **Zielbild ist jede gelebte Form privater Vermietung** (#91): mehrere Mehrfamilienhäuser,
  vermietete Eigentumswohnungen, Gebäude, die gemeinsam abrechnen oder sich Kosten teilen,
  Pauschalen und Warmmieten, die fertige Abrechnung eines Messdienstes. Was gelebt wird, aber
  rechtlich angreifbar ist, wird unterstützt, mit Warnung und beziffertem Kürzungsbetrag, statt
  verweigert; abgelehnt wird nur, was keine Kürzung heilt. Nicht dazu gehört die Verwaltung für
  Dritte (Mandanten, Erlaubnis nach § 34c GewO). Der Weg dorthin steht in den Teil-Issues #92 bis
  #99, jedes einzeln auslieferbar. Stand heute: mehrere Objekte (#92), erweiterte Verteilbasis
  (#94) und das Mietmodell mit Pauschale und Inklusivmiete (#93); eine eigene Heizkostenabrechnung
  nach HeizkostenV fehlt noch (#97, #99), eine fertige des Messdienstes lässt sich über
  Einzelbeträge übernehmen. **Wer ein Haus vermietet, merkt von der Breite nichts**: Jede neue
  Angabe hat eine Voreinstellung, die das bisherige Verhalten ergibt, es gibt keine neuen
  Pflichtfelder, und die Golden-Tests bleiben centgenau grün. Die eine bewusste Ausnahme ist eine
  Behebung und keine Erweiterung: der Hauptzähler bei einer Wohnung ohne Zähler (#116).
- **Maßstab für Erweiterungen** (siehe [CONTRIBUTING.md](CONTRIBUTING.md)): Mietfuchs muss für
  Vermieter ohne technische Vorkenntnisse nutzbar und einfach einzurichten bleiben. Die Technik
  darunter darf wachsen (Datenbank, Serverbetrieb), solange Skripte, Installer und
  Voreinstellungen die Einrichtung übernehmen. Architekturentscheidungen also nicht pauschal
  ausschließen, sondern daran messen, was beim Nutzer ankommt.
