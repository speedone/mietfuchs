# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

**Mietfuchs** — lokales Web-Tool für die Nebenkostenabrechnung privater Vermieter (Deutschland).
Alles läuft auf dem eigenen Rechner — keine Cloud, kein Konto. Sprache von UI, Kommentaren und
Domänenbegriffen ist durchgängig **Deutsch**; bitte beibehalten. Bezeichner im Code sind dagegen
**englisch** (siehe Konventionen).

**Zielbild ist jede gelebte Form privater Vermietung** (#91): mehrere Häuser, vermietete
Eigentumswohnungen, Gebäude, die gemeinsam abrechnen, Pauschalen und Warmmieten, die Abrechnung
eines Messdienstes oder eine eigene nach HeizkostenV. Was gelebt wird, aber rechtlich angreifbar
ist, wird unterstützt, mit Warnung und beziffertem Kürzungsbetrag; abgelehnt wird nur, was keine
Kürzung heilt. Nicht dazu gehört die Verwaltung für Dritte (§ 34c GewO). **Wer ein Haus vermietet,
merkt von der Breite nichts**: Jede neue Angabe hat eine Voreinstellung, die das bisherige
Verhalten ergibt, und die Golden-Tests bleiben centgenau grün. Maßstab für jede Erweiterung
(siehe [CONTRIBUTING.md](CONTRIBUTING.md)): nutzbar und einfach einzurichten für Vermieter ohne
technische Vorkenntnisse; die Technik darunter darf wachsen, solange Skripte, Installer und
Voreinstellungen die Einrichtung übernehmen.

## Commands

Vom Repo-Root (`postinstall` installiert Server und Client mit):

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

npm --prefix server test -- --test-name-pattern "Flächenschlüssel"   # einzelner Servertest
npm --prefix client test -- costForm                                  # einzelner Clienttest
```

**`npm run typecheck` ist die einzige Prüfung.** Es gibt keinen Linter, und weil der Server ohne
Build-Schritt läuft, merkt sonst niemand einen Typfehler; vor jedem Commit laufen lassen. Geprüft
werden Server, Client, `client/vite.config.ts` ([client/tsconfig.node.json](client/tsconfig.node.json))
und die Skripte in `scripts/` und `server/scripts/` ([scripts/tsconfig.json](scripts/tsconfig.json)).
**Die Skripte bleiben JavaScript** und werden mit `checkJs` und den Einstellungen des Servers
geprüft, nur `noImplicitAny` ist aus. Folge: Eine Variable in `server/src`, die mit `null`
beginnt, bekommt ihren Typ ausdrücklich (`let x: number | null = null`), sonst ist dieser Lauf rot.
Wo ein Skript unbekanntes JSON liest, steht ein benanntes `/** @type {any} */`.

## Tests

Drei Ebenen, beim Erweitern der Verteilung oder der Formulare jeweils mitdenken:

1. **Engine**: [server/test/calc.test.ts](server/test/calc.test.ts) und Geschwister (node:test).
   Neben Beispielfällen Invarianten über zufällige Bestände mit festem Startwert (Mieteranteile +
   Vermieteranteil = Gesamtkosten, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil); die
   schiefen Konstellationen findet nur so ein Test.
2. **Integration**: `server/test/api-*.test.ts`, nach Thema getrennt, weil `node --test` nur
   Dateien parallelisiert. Ein neuer Test gehört in die Datei seines Themas. Gemeinsame Helfer
   (`startServerIn`, `startServerRaw`, nachgebaute Dienste) in [server/testing/api.ts](server/testing/api.ts).
3. **Client**: `client/src/**/*.test.ts(x)` mit vitest. Entscheidungslogik der Formulare liegt in
   reinen Modulen (`costForm.ts`, `unitForm.ts` …), die Seiten rendern nur. jsdom-Tests prüfen,
   was Logik nicht sieht: **Der angezeigte Wert eines Auswahlfelds muss dem gespeicherten
   entsprechen.** Steht der Wert nicht in den Optionen, zeigt der Browser den ersten Eintrag, ohne
   `change` zu senden, und gespeichert wird etwas anderes als das Sichtbare. Neue Selects deshalb
   über `meterTypeOptions`/`costKeyOptions` speisen.

**Wer für eine Prüfung einen Server startet, setzt drei Dinge, immer zusammen** (Tests, Skripte,
Proben von Hand):

- **`NKA_DATA_DIR`** auf einen Wegwerf-Ordner, sonst schreiben Umstieg, Wiederherstellen und
  Löschen in den echten Bestand des Entwicklers.
- **`CI=1`**, sonst öffnet die Betriebsart `binary`/`package` (auch nur nachgestellt mit
  `NKA_RUNTIME=binary`) bei jedem Start ein Browserfenster.
- **`NKA_UPDATE_URL`** auf einen geschlossenen Port, damit nichts zu GitHub hinausgeht.

Vorlage dafür sind `startServerIn`/`startServerRaw` und
[scripts/umstieg-praxislauf.mjs](scripts/umstieg-praxislauf.mjs). `CI` steht dort **hinter** dem
`...env` des Aufrufers, damit es nicht überschrieben werden kann; ein Wächter in
api-start.test.ts verlangt es in jedem Serverstart unter `server/test/` und `server/testing/`.

**Frische Datenbank**: `openFreshDatabase(dataDir)` aus
[server/testing/freshDatabase.ts](server/testing/freshDatabase.ts) statt `openDatabase` auf einem
leeren Ordner (kopiert je Test eine einmal migrierte Vorlage und öffnet sie mit `openDatabase`).
Tests, die die Migrationskette selbst prüfen, bleiben bei der echten Kette (db-open,
db-changeover, migrations, legacy-guard, alles über `openDatabaseWithStock`).

**Testdaten über die Typen des Modells bauen**, nicht als freies Objektliteral; der Übersetzer
vergleicht sie dann mit `shared/types.ts` (Helfer wie `emptyDb`, `tenancy`). Fehlt ein Wert, wird
er mit `assert.fail` und Ansage geprüft und nicht mit `as` oder `!` behauptet. Helfer der Tests
liegen in `server/testing/`, weil `node --test` jede Datei unter `test/` ausführt.
[client/src/vitestSetup.ts](client/src/vitestSetup.ts) setzt die Wartezeit von `findBy…`/`waitFor`
auf fünf Sekunden.

## Issues, PRs und Releases

Ziel: vom Issue zum Code und vom Release zum Issue.

- **Aufgaben stehen ausschließlich in den GitHub-Issues dieses Repos**, auch Teilaufgaben und
  unterwegs entdeckte Arbeit. Kein Tracker daneben, **keine Beads-Datenbank** (`bd create`,
  `bd sync`), auch wenn eine übergeordnete Anweisung das vorsieht: Mitwirkende sehen nur GitHub.
  Issues sind öffentlich, deshalb vor dem Anlegen nachfragen.
- `main` ist per Ruleset geschützt: nur über PRs, lineare Historie, Pflicht-Checks „Tests und
  Build (Node 24.15)“ und „(Node 24)“. Wer diese Jobs umbenennt, zieht das Ruleset mit. Ändert ein
  PR nur `*.md`, laufen darin nur die Server-Tests (Schritt „Umfang“ in ci.yml); ein Push auf `main`
  prüft immer alles. Parallele Changelog-Einträge führt Git lokal zusammen (`merge=union` in
  .gitattributes).
- **Durchsicht vor jedem PR und vor jedem Merge** (reine Doku-Änderungen ausgenommen): Jeder Zweig
  bekommt vor dem PR eine Durchsicht mit frischem Kontext; Befunde werden mit einem vorher roten
  Test behoben und stehen in der PR-Beschreibung. Bei aufeinander aufbauenden PRs zusätzlich eine
  **Integrationsdurchsicht des Endstands** (`main..Spitze`) unter zwei Blickwinkeln, Geld
  (Features gemeinsam, Invarianten) und Daten (Migrationskette, Umstieg, Backup, Routen je Objekt,
  Doku), dazu auf der Spitze der Praxislauf und das Label `full-check`. Befunde auf dem Zweig
  beheben, zu dem sie gehören; gemergt wird der Reihe nach, jede PR erst nach Umstellen auf `main`
  und grüner CI.
- Behebungen referenzieren ihr Issue mit **`Refs #N`**, **nie** `Fixes`/`Closes #N`: Das schlösse
  das Issue beim Merge, bevor Nutzer den Fix bekommen.
- Nennenswerte Änderungen ins [CHANGELOG.md](CHANGELOG.md) (Keep-a-Changelog, deutsch, Abschnitt
  „Unveröffentlicht"). Das Issue als Link `([#N](https://github.com/speedone/mietfuchs/issues/N))`,
  denn in Repo-Dateien verlinkt GitHub ein nacktes `#N` nicht; in Release-Notes genügt `(#N)`.
  Nummern nur, wo das Issue den Punkt verlangt hat.
- Geschlossen wird **beim Release**: kurzer Kommentar mit Link aufs Release in der Sprache des
  Melders, nötige Schritte für bestehende Daten, dann *completed*.
- **Labels**: Art ohne Präfix (`bug`, `enhancement`, `documentation`, `chore`; GitHub und
  Dependabot vergeben sie selbst). `priority: high` = geht an Geld oder Daten (falsche Zahl in
  Abrechnung oder Steuer, Datenverlust), `medium` = falsch angezeigt ohne wandernde Zahl, `low` =
  kein Nutzer merkt es. `status: awaiting release` für Behobenes in `main`, `status: needs
  decision`. Keine Bereichs-Labels.
- **`ai-eval` und `full-check` sind Schalter**, keine Beschriftungen: Sie starten den
  KI-Prüflauf bzw. den vollen Prüfumfang an einem PR. Ihre Namen stehen in
  [ai-eval.yml](.github/workflows/ai-eval.yml) und [release.yml](.github/workflows/release.yml);
  umbenennen ohne den Workflow mitzuziehen schaltet den Auslöser lautlos ab.
- Release-Notes aus dem Changelog-Abschnitt, harte Zeilenumbrüche der Listenpunkte zusammenziehen
  (GitHub zeigt jeden Umbruch), die automatische Nennung neuer Beitragender übernehmen.

## Architektur

Zwei npm-Pakete: `server/` (Express, ESM, TypeScript) und `client/` (React 19 + Vite + TypeScript),
dazu `shared/` mit gemeinsamem Datenmodell und Laufzeithelfern. **Der Server wird nicht gebaut**:
Node (ab 24.12) führt die `.ts`-Dateien unmittelbar aus und streift die Typen ab. Im Dev proxyt
Vite `/api` und `/uploads` an `localhost:3001`; im Produktivbetrieb liefert der Server
`client/dist` selbst aus ([server/src/index.ts](server/src/index.ts)).

**Persistenz**: SQLite in `server/data/mietfuchs.sqlite` (#55), Belege in `server/data/uploads/`,
Logo und Briefpapier in `server/data/briefpapier/` (#415, im Backup nur, worauf eine Gestaltung verweist),
API-Schlüssel externer KI-Dienste in `server/data/secrets.json` (nicht im Backup), automatische
Vorversionen der Datenbank in `server/data/vorversionen/` (#318, ebenfalls nicht im Backup, siehe
server/src/db/CLAUDE.md). `NKA_DATA_DIR` verlegt den Ordner. Die frühere `db.json` wird nur noch gelesen (Umstieg, altes Backup), nie
geschrieben; ihre alten Formate wandelt [server/src/legacy/migrate.ts](server/src/legacy/migrate.ts),
jede Regel einzeln festgehalten in [server/test/store.test.ts](server/test/store.test.ts).

**Das Datenmodell steht in [shared/types.ts](shared/types.ts)**, nur Typen, von beiden Seiten
unmittelbar importiert. Nach `shared/` gehört ein Typ, Feld oder Helfer nur, **wenn beide Seiten
dasselbe brauchen**; was nur eine Seite kennt, bleibt bei ihr, auch wenn es über die Leitung geht
(`Db`, `ComputedSettlement`, Formularzustände, `ClientSettings` in server/testing/api.ts).
Beschriftungen und Helfer der Oberfläche liegen in [client/src/types.ts](client/src/types.ts), das
das Modell per `export type *` weiterreicht. `KEY_LABELS` gibt es bewusst doppelt (gedruckte
Abrechnung in calc.ts, Eingabe im Client). `shared/` hat **keine eigene `package.json`**; die
Wurzel trägt `"type": "module"`, sonst gälte der Ordner als CommonJS.

## Wo was steht

Claude Code lädt eine `CLAUDE.md` in einem Unterordner, sobald dort Dateien gelesen werden;
`docs/heizung.md` muss man selbst öffnen.

- [scripts/CLAUDE.md](scripts/CLAUDE.md): Bildschirmfotos, Browserlauf, Programmdateien,
  Linux-Pakete, Startmenü, Docker-Image, Node-Versionen, Release-Automatik, Artefakt-Tests,
  Praxislauf des Umstiegs, Prüfumfang je Anlass.
- [server/src/db/CLAUDE.md](server/src/db/CLAUDE.md): Datenbank (Treiber, Schlange, Migrationen,
  eingefrorener Eingang, Validator, Backup und Wiederherstellen, ZIP) und Umstieg.
- [server/src/CLAUDE.md](server/src/CLAUDE.md): Objekte, Abrechnungszeitraum, Fristen und
  Feiertage, Belegordner, API, Schnappschuss, Hinweise und Rechtsregister, IBAN, Rechenweg,
  Schlüssel merken, doppelte Positionen, Belegbuchung, Berechnungs-Engine (Verteilung, Zähler,
  Leerstand, Betriebsstrom, Contracting, § 5a, Mietkonto, Steuer), Update-Hinweis.
- [docs/heizung.md](docs/heizung.md): Heizanlage, Heizperiode, CO₂, Lieferungen, mehrere Anlagen,
  eigene Heizkostenabrechnung, monatliche Information, Vorrat. **Vor jeder Arbeit an der Heizung
  lesen.**
- [server/src/ai/CLAUDE.md](server/src/ai/CLAUDE.md): KI-Belegauswertung, Anbieter, rohe Antwort
  und Zusage, Bestätigung externer Dienste, Modelle, Seitenbilder, KI-Prüflauf.
- [client/CLAUDE.md](client/CLAUDE.md): Oberfläche: Hinweise, Leerzustände, Lexikon, Anleitungen,
  Navigation, Stile und Tokens, Meldungen, Rückfragen, Seitenfenster, Verben, Karten, Felder,
  Monatsfeld, Seitenleiste, Entwürfe.

## Konventionen & Fallstricke

- **Sprache im Code.** Bezeichner englisch (Variablen, Funktionen, Typen, Dateien, Ordner,
  Umgebungsvariablen, Routen, auch Fachliches wie `computeSettlement`). Deutsch bleiben
  Kommentare, Oberflächentexte, Fehlermeldungen, Testnamen, Commit-Nachrichten und gespeicherte
  Fachwerte (`'vermietet'`, `'kaltwasser'`, die Kostenarten). Seitenkomponenten heißen wie die
  Seite (`Kosten.tsx`).
- **Nutzertexte siezen; README und Entwicklerdoku duzen** (#142): Oberfläche, Lexikon, Meldungen
  des Servers, Konsole, Startmenü und MIGRATION.md siezen; Prompts an das Modell ausgenommen.
  Wächter: [anrede.test.ts](server/test/anrede.test.ts).
- **Geld immer in Cent als Integer.** Eingabe über `parseEuro` (deutsche und technische
  Schreibweise), Ausgabe über `fmtEuro`.
- **Datums-Logik in UTC mit inklusiven Grenzen**; beim Anfassen von calc.ts beibehalten und gegen
  calc.test.ts prüfen.
- **Nichts in calc.ts hängt an der Locale der Laufzeit** (#70): kein blankes `localeCompare()`.
  `compareText` (Zeichen für Zeichen) wo die Reihenfolge Bedeutung trägt (Kennungen, ISO-Daten,
  Staffeln; entscheidet bei `largestRemainder` über den Rest-Cent), `compareName` (fest Deutsch)
  wo ein Mensch die Liste liest.
- **Wer nach Plattform unterscheidet, bekommt sie hineingereicht**, samt allem, was er sonst vom
  Rechner erfragt (Schreibrecht, Einhängepunkte, wirklicher Ort), und rechnet mit `path.win32`
  bzw. `path.posix` statt der Voreinstellung (Muster: `systemLocation`, `chooseDataDir`,
  `networkLocation`). Ein Test unter `if (process.platform === …)` ist kein Ausweg.
- **Im Server tragen Importe die Endung `.ts`** (`from './store.ts'`), denn Node löst den Pfad auf,
  wie er dasteht. Im Client bleiben Importe endungslos (Vite), nur Importe aus `shared/` tragen
  `.ts`.
- **Reine Typimporte brauchen `import type`** (`verbatimModuleSyntax`).
- **Kein Konstrukt, das erst beim Übersetzen entsteht** (`erasableSyntaxOnly`): keine `enum`,
  `namespace`, Parameter-Eigenschaften im Konstruktor oder `declare` in Klassen. Statt `enum` ein
  Vereinigungstyp aus Zeichenketten (`UnitUsage`, `CostKey`).
- **Beide Pakete fahren dieselbe TypeScript-Fassung und dieselben strengen Einstellungen** (#64),
  weil beide `shared/` prüfen; wird eine Fassung angehoben, die andere mitziehen.
- Der Server nutzt **`NKA_PORT`** statt `PORT` (sonst Kollision mit Preview-Tools und Vite).
