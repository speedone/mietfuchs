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
npm start          # Produktivbetrieb: Server liefert App + API auf Port 3001
npm run package    # baut eigenständige Binaries nach dist-bin/ (braucht Bun)
npm run package:linux # baut daraus .deb/.rpm/Arch-Pakete (braucht nFPM oder Docker)
```

**Eigenständige Binaries** (für Endanwender ohne Node): [scripts/package-binaries.mjs](scripts/package-binaries.mjs)
kompiliert Server + eingebettetes Frontend per **Bun `--compile`** zu je einer Datei pro
Plattform (Windows/macOS-Intel/macOS-ARM/Linux) in `dist-bin/`. `node scripts/package-binaries.mjs win`
baut nur ein Ziel. Bun wird gewählt, weil der Server ESM ist, was pkg/SEA nicht bündeln
kann. Native Module lassen sich so nicht für alle Ziele einbetten, der Server kommt deshalb
bewusst ohne aus (siehe KI-Belegauswertung). Das Frontend wird beim Build über
[scripts/embed-client.mjs](scripts/embed-client.mjs) aus `client/dist` in das generierte
(gitignorierte) Modul `server/src/embedded-client.js` eingebettet (Bun-Importattribut
`with { type: 'file' }`) und im gepackten Betrieb daraus ausgeliefert. In der Binary erkennt der
Server den gepackten Modus an `globalThis.Bun`: Daten landen dann in `data/` **neben der
ausführbaren Datei** (nicht in `server/data`), und der Standard-Browser wird automatisch geöffnet.
Wo die Daten liegen, entscheidet `chooseDataDir` in [server/src/store.js](server/src/store.js).

**Linux-Pakete** (#25): [scripts/package-linux.mjs](scripts/package-linux.mjs) (`npm run
package:linux`) baut aus denselben Linux-Programmdateien `.deb`, `.rpm` und das Arch-Paket, je
für x64 und ARM64. Gebaut wird mit **nFPM** nach [packaging/nfpm.yaml](packaging/nfpm.yaml),
das alle Formate aus einer Vorschrift erzeugt; nFPM kommt von der Platte oder aus seinem
Container, mehr als Docker braucht der Rechner nicht. Das Paket legt die Programmdatei nach
`/usr/bin`, dazu [packaging/mietfuchs.desktop](packaging/mietfuchs.desktop) (Startmenü,
`Terminal=true`, weil das Fenster der sichtbare Weg zum Beenden ist) und das Symbol als SVG und
PNG. Dort installiert, kann der Server nicht neben sich schreiben, deshalb liegen die Daten
dann in `~/.local/share/mietfuchs` (XDG; entsprechend unter Windows und macOS). Die Regel dafür
steht in `chooseDataDir`: ein Systemort (`/usr`, `/opt`, Programme) führt immer in den
Benutzerordner, auch mit Schreibrecht, sonst würde ein Start als Administrator die Daten dorthin
legen, wo der normale Benutzer sie nicht wiederfindet. Vor dem Release wird jedes Format in
einem Container seiner Distribution installiert, als gewöhnlicher Benutzer gestartet und mit
[scripts/smoke-test.mjs](scripts/smoke-test.mjs) geprüft.
**Docker-Image**: [.github/workflows/docker.yml](.github/workflows/docker.yml) baut das
[Dockerfile](Dockerfile) bei `v*`-Tags und Pushes auf `main` für `linux/amd64` + `linux/arm64`
und pusht nach `ghcr.io/speedone/mietfuchs` (Tags: `X.Y.Z`, `X.Y`, `latest`, `main`). Damit
läuft die App ohne Clone des Repos. Bei PRs, die Dockerfile, Abhängigkeiten oder den Workflow
ändern, baut er nur zur Probe (ohne Login und Push).

**Node-Versionen**: Docker-Image und Release-Build nutzen Node 24, die CI testet zusätzlich die
Mindestversion 22.12 aus `engines` (erst ab dort lädt Node JSON-Module ohne Warnung, siehe
[server/src/version.js](server/src/version.js)). Beim Anheben alle Stellen mitziehen: `engines` (plus
`package-lock.json`), README-Badge, Dockerfile, `ci.yml`, `release.yml`. Actions und npm-Pakete
hält Dependabot aktuell ([.github/dependabot.yml](.github/dependabot.yml), monatlich: Actions
in einem PR, kleine npm-Updates gebündelt je Ordner, Hauptversionen einzeln). Sicherheitswarnungen
und automatische Sicherheits-PRs sind im Repo eingeschaltet. Bei Hauptversionen die
Changelogs gegen unsere Nutzung prüfen; Express 5 etwa ruft den `listen`-Callback auch bei
Startfehlern auf, und `res.sendFile` braucht `root`, wenn der Installationspfad Punkt-Ordner hat.

Release-Automatik: [.github/workflows/release.yml](.github/workflows/release.yml) baut bei einem
`v*`-Tag alle Ziele auf einem Linux-Runner und hängt sie ans GitHub-Release — macOS als Zip,
Linux als tar.gz (konserviert das Ausführungs-Bit, das rohe Downloads verlieren würden), die
Windows-`.exe` roh. Ziele: Windows, Linux und macOS jeweils für x64 und ARM64. Die Namen der
x64-Dateien bleiben fest, der Update-Hinweis älterer Versionen sucht sie darunter.

**Artefakt-Tests** (#22): Vor dem Anhängen startet jede Programmdatei auf einem GitHub-Runner
ihres Systems (Linux, Windows und macOS jeweils x64 und ARM64), die Linux-Dateien zusätzlich in
Containern von 15 Distributionen (CentOS 7 mit glibc 2.17 bis Ubuntu 26.04). Das Docker-Image
wird für amd64 und arm64 ebenso geprüft, bevor es veröffentlicht wird, und die CI prüft den
Start aus dem Quellcode. Alle nutzen [scripts/smoke-test.mjs](scripts/smoke-test.mjs): Es
prüft eine laufende Instanz von außen (Oberfläche mit allen Skriptteilen und pdf.js-Dateien,
KI-Auswertung gegen ein eigenes nachgebautes Ollama, Belege, Abrechnung, Backup und
Wiederherstellung) und braucht einen leeren Datenordner. Lokal:
`node scripts/smoke-test.mjs --url http://127.0.0.1:3001 --mode npm`. Mit `--slow-ai 320`
schweigt das nachgebaute Ollama länger als fünf Minuten; die Auswertung muss trotzdem ankommen
(siehe KI-Belegauswertung). So läuft es in der CI gegen Node und beim Prüfen der
Programmdateien je Betriebssystem einmal. Ist `CI` gesetzt, öffnet die Programmdatei keinen
Browser. Bun baut bewusst mit `latest`; eine fehlerhafte neue Version
fällt in diesen Tests auf. Die macOS-Dateien werden nach dem Bau auf einem Mac-Runner mit
`codesign --sign -` neu signiert: Buns eigene Ad-hoc-Signatur beim Cross-Kompilieren unter
Linux war wiederholt ungültig (zuletzt die Intel-Datei mit Bun 1.4.2), und neuere macOS-Versionen
beenden solche Programme beim Start.

Einzelnen Test ausführen:

```powershell
npm --prefix server test -- --test-name-pattern "Flächenschlüssel"
npm --prefix client test -- costForm
```

Es gibt **keinen Linter**; `npm run build` ist der einzige Typecheck-Pfad (`tsc --noEmit`).

**Tests, drei Ebenen** — beim Erweitern der Verteilung oder der Formulare jeweils mitdenken:

1. [server/test/calc.test.js](server/test/calc.test.js) — Engine (node:test, kein Framework).
   Neben Beispielfällen prüfen drei Tests Invarianten über zufällig erzeugte Datenbestände
   (fester Startwert, also reproduzierbar): Mieteranteile + Vermieteranteil = Gesamtkosten,
   keine negativen Anteile, Eigenanteil ≤ Vermieteranteil. Einzelfall-Tests übersehen genau
   die schiefen Konstellationen — ein Geldverlust bei der Direktzuordnung fiel erst hier auf.
2. [server/test/api.test.js](server/test/api.test.js) — Integration: startet den Server als
   eigenen Prozess mit `NKA_DATA_DIR` auf einem Wegwerf-Ordner (deshalb gibt es diese
   Variable) und prüft die Routen. Berührt nie eine vorhandene `db.json`. `NKA_UPDATE_URL`
   zeigt dort standardmäßig auf einen geschlossenen Port, damit kein Test GitHub erreicht.
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

Nennenswerte Änderungen gehören ins [CHANGELOG.md](CHANGELOG.md) (Keep-a-Changelog, deutsch);
der Abschnitt „Unveröffentlicht" wird beim Release zur Version.

**Issues & Releases** — Ziel ist, dass man vom Issue zum Code und vom Release zum Issue kommt:

- `main` ist per Ruleset geschützt: nur über PRs, lineare Historie (Rebase oder Squash), und die
  CI-Jobs „Tests und Build (Node 22.12)“ und „(Node 24)“ müssen grün sein. Kein Löschen, kein
  Force-Push. Admins können im Notfall umgehen. Benennt man diese Jobs um, das Ruleset
  mitziehen, sonst wartet jeder PR auf einen Check, den es nicht mehr gibt.
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
- Release-Notes aus dem Changelog-Abschnitt erzeugen, dabei die harten Zeilenumbrüche der
  Listenpunkte zusammenziehen — GitHub stellt jeden Umbruch in Release-Texten als echten dar.
  Die automatisch erzeugte Nennung neuer Beitragender übernehmen.

## Architektur

Zwei getrennte npm-Pakete: `server/` (Express, ESM, kein TypeScript) und `client/` (React 19 +
Vite + TypeScript). Im Dev proxyt Vite `/api` und `/uploads` an `localhost:3001`
([client/vite.config.ts](client/vite.config.ts)); im Produktivbuild liefert der Express-Server
das statische `client/dist` selbst aus ([server/src/index.js](server/src/index.js)).

**Persistenz**: eine einzige JSON-Datei `server/data/db.json`, atomar geschrieben (Temp +
rename) über [server/src/store.js](server/src/store.js). `NKA_DATA_DIR` verlegt den Ordner
(Tests, abweichende Ablage). Belege liegen in `server/data/uploads/`, API-Schlüssel externer
KI-Dienste getrennt davon in `server/data/secrets.json` (siehe secrets.js; nicht im Backup).
Backup = diesen Ordner kopieren. Keine Datenbank, keine Migrationen-Tooling — Schema-Migrationen
älterer `db.json` passieren imperativ in `load()` in store.js (z. B. fester Monatsbetrag →
Vorauszahlungs-Staffel). Beim Erweitern des Datenmodells dort die Migration ergänzen.

**API** ([server/src/index.js](server/src/index.js)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Löschen einer `unit` bzw. `meter` kaskadiert manuell auf abhängige Datensätze (auch `payments`
beim Löschen einer `unit`/`tenancy`). Daneben Spezialrouten:
`/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract` und `/api/intake` (KI-Auswertung, auf Wunsch als Strom, siehe
unten), die KI-Einstellungen `/api/ai/presets`, `/api/ai/status`, `/api/ai/key` und
`/api/ai/consent` sowie `/api/ollama/status` für ältere Tabs (alles siehe
KI-Belegauswertung), `/api/update` und `POST /api/update/check`
(Update-Hinweis, siehe unten), `/api/uploads` (Belegarchiv: Liste +
Löschen unverknüpfter Dateien), `/api/backup`/`/api/restore` (ZIP via adm-zip) sowie
`/api/settlement/:year/close` (POST/PUT/DELETE): friert die Abrechnung als Snapshot in der
Collection `closedSettlements` ein (inkl. `sentAt` für die §556-Frist) — `GET
/api/settlement/:year` liefert dann den Snapshot statt der Live-Berechnung; ebenso nimmt
`taxReport` den Eigenanteil aus dem Snapshot, damit Steuerübersicht und versendete Abrechnung
nicht auseinanderlaufen.

**Berechnungs-Engine** ([server/src/calc.js](server/src/calc.js)) — das Herzstück, hier liegt
die ganze fachliche Komplexität:
- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats — Gleitkomma-Fehler vermeiden.
- Centgenaue Verteilung per **Hare/largest-remainder** (`largestRemainder`). Schöpfen die
  Rohanteile die Summe nahezu voll aus, wird centgenau auf Mieter verteilt; sonst trägt der
  **Vermieter** die Differenz (Leerstand, Eigenanteil, Rundungsrest, „Nicht umlagefähig").
- **Umlageschlüssel** (`item.key`): `area` (Wohnfläche), `persons` (personentagesgenau),
  `units` (Wohneinheiten), `meter` (Verbrauch nach Zählertyp), `direct` (Direktzuordnung),
  `custom` (vereinbarte Prozentanteile je Wohnung in `item.customShares`, absolut gerechnet —
  was unter 100 % fehlt, trägt der Vermieter).
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`) und Vorauszahlung
  (`prepayments`, `from: YYYY-MM`) werden als „ab Datum gilt Wert" geführt. Tatsächlich
  gezahlte Vorauszahlungen pro Jahr können via `prepaymentOverrides` überschrieben werden
  (haben Vorrang — rechtlich zählt das tatsächlich Gezahlte).
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen, in UTC gerechnet; Tagesanteile zählen
  für Teiljahre. `end: null` = offenes Mietverhältnis.
- **Zähler**: Ablesungen → Verbrauchssegmente (`meterSegments`), tagesanteilig interpoliert
  (`consumptionInPeriod`). Zählerwechsel über `replacement: true` + `oldEndValue`. Negativer
  Verbrauch erzeugt eine Warnung.
- **Beteiligung je Wohnung** (drei Zustände, siehe `UnitUsage` in types.ts): `participates:
  true` = vermietet, Anteil trägt der Mieter · `selfUsed: true` = selbstgenutzt, zählt in die
  Verteilbasis von `area`/`units`/`persons` (dort mit `selfPersons`), Anteil fällt in den
  Vermieteranteil · beides `false` = außerhalb der Abrechnungseinheit, bleibt ganz außen vor.
  Grund für die Basis-Zugehörigkeit: Kosten einer Rechnung über das ganze Haus dürfen nur
  anteilig auf die Mieter umgelegt werden. Beim `meter`-Schlüssel bilden **alle**
  Wohnungszähler die Basis, unabhängig vom Kennzeichen — ein Zählerstand belegt Verbrauch
  innerhalb der abgerechneten Menge. `computeSettlement` liefert den auf `selfUsed`-Wohnungen
  entfallenden Teil separat als `selfUsedShareCents` (für die Anlage V privat, nicht
  abziehbar); `load()` migriert bewusst **nicht** automatisch, weil ein gesetztes Kennzeichen
  die Verteilung bereits abgerechneter Jahre verändern würde.
- **Mietkonto** (`rentLedger`): Kaltmiete-Staffel (`baseRents`) + Vorauszahlung ergeben das
  monatliche Soll (Bruttomiete); Zahlungseingänge (`payments`) werden Jan→Dez FIFO auf die
  Monate verteilt (Status bezahlt/teilweise/offen).
- **Steuer/Anlage V** (`taxReport`): aggregiert Einnahmen (aus `rentLedger`, Soll + Ist) und
  Werbungskosten (Kostenpositionen nach `ANLAGE_V_GROUP`-Mapping), liefert §35a-Summe,
  vermieteten Flächenanteil und Überschuss. Bewusst beschreibende Gruppen statt fester
  Anlage-V-Zeilennummern; keine automatische Eigennutzungs-Aufteilung (nur Hinweis).

Der Server kennt **keine Domänentypen als Code** — die maßgebliche Typdefinition des gesamten
Datenmodells steht in [client/src/types.ts](client/src/types.ts) (Unit, Tenancy, Meter,
Reading, CostItem, Settings, Settlement …). Server und Client müssen hier konsistent bleiben.
Die `KEY_LABELS` existieren bewusst doppelt (calc.js liefert UI-Strings im Settlement, types.ts
hat eigene Labels für die Eingabe-Oberfläche).

**KI-Belegauswertung**: optional, gegen **Ollama** oder einen **OpenAI-kompatiblen Dienst**
(#18). Die KI macht nur Vorschläge, übernommen wird erst nach manueller Prüfung. Aufgeteilt in:
- [server/src/extract.js](server/src/extract.js): das Fachliche, also Prompts, JSON-Schemas,
  Ablauf (Auswertung, zweiter Durchgang nur für Kostenarten, Belegart, Zählerstand) und
  Zeitlimits je Schritt. Die Kategorie-Enums dort und `CATEGORIES`/`matchCategory` in types.ts
  müssen zusammenpassen.
- [server/src/ai/settings.js](server/src/ai/settings.js): das Datenmodell `settings.ai` mit den
  Plätzen `text` (Standard) und `images` (eigener Anbieter für Fotos und Scans), den
  Einstellungen für Fortgeschrittene, der Migration aus `ollamaUrl`/`ollamaModel`, den
  Umgebungsvariablen und der Regel, was als extern gilt (`isExternalUrl`, `consentProblem`).
- [server/src/ai/presets.js](server/src/ai/presets.js): die Vorlagen (Ollama lokal, entfernt,
  Cloud, OpenAI, IONOS, Mistral, LM Studio, eigener Dienst) mit Adresse, Bedarf an einem
  Schlüssel, Feldname für die Antwortlänge, Temperatur, `json_object` und Links. Sie belegen
  nur vor, geändert werden darf alles.
- [server/src/ai/index.js](server/src/ai/index.js): die Schnittstelle der Anbieter,
  `json({ prompt, images, schema, timeoutMs, signal, onProgress }) → { data, stats }`, dazu die
  Wahl des Platzes je Beleg (Bilder → `images`, falls eingerichtet) und die Durchsetzung der
  Bestätigung vor jeder Anfrage.
- [server/src/ai/openai.js](server/src/ai/openai.js): Chat-Completions-Schnittstelle als
  SSE-Strom. Schickt immer eine Antwortlänge (IONOS nimmt sonst 16 Token), Temperatur 0 außer
  bei OpenAI, und JSON in Stufen: striktes Schema, Schema ohne `strict`, `json_object` mit
  Schema im Prompt (nicht bei LM Studio), nur Prompt. Lehnt ein Dienst etwas ab, probiert das
  Modul die nächste Möglichkeit und merkt sie sich je Adresse und Modell. Fehlerformate von
  OpenAI, Mistral, IONOS und Ollama werden gleich gelesen, ein Schlüssel erscheint nie in einer
  Meldung.
- [server/src/secrets.js](server/src/secrets.js): API-Schlüssel je Platz in `data/secrets.json`
  (unter Unix 0600), nie in `GET /api/settings` und nicht im Backup. `NKA_AI_API_KEY` oder
  `NKA_AI_API_KEY_FILE` (Docker-Secret) haben Vorrang.
- [server/src/ai/ollama.js](server/src/ai/ollama.js): Transport und Eigenheiten von Ollama.
  Streamt `/api/chat`, setzt `think: false` und einen festen Kontext (`num_ctx` 16384, sonst
  kürzt Ollama bei unter 24 GB Grafikspeicher auf 4096 Token; ein wechselnder Wert lädt das
  Modell neu). Lehnt ein Modell `think: false` ab, wie manche bei Ollama Cloud, geht die
  Anfrage einmal ohne das Feld. Prüft über `/api/show`, ob das Modell Bilder versteht und ob
  Ollama es an einen Cloud-Dienst weiterreicht (eine Minute gemerkt), und übersetzt Fehler in
  Meldungen für die Oberfläche (nicht erreichbar, nicht installiert, Schlüssel, Zeitlimit,
  abgeschnittene Antwort). Dazu Modellliste und Suche nach Ollama unter üblichen Adressen.
- [server/src/ai/http.js](server/src/ai/http.js): Verbindung ohne die 300-Sekunden-Grenze von
  `fetch` (Node und Bun brechen ab, wenn so lange keine Antwort-Header kommen, Ollama schickt
  sie erst mit dem ersten Token). Unter Node über `node:http(s)`, unter Bun über `fetch` mit
  `timeout: false`. Für KI-Anfragen deshalb nicht `fetch` direkt nehmen.

PDFs öffnet der Server nicht selbst: Der Browser liest sie vor dem Hochladen mit pdf.js
([client/src/pdfIntake.ts](client/src/pdfIntake.ts)) und schickt die Textebene im Feld
`pdfText` mit, bei Scans ohne brauchbare Textebene (unter 80 Zeichen) bis zu vier Seiten als
JPEG im Feld `pages`. Die Seitenbilder bleiben im Arbeitsspeicher (gemischter multer-Speicher
in index.js) und landen nicht im Belegarchiv. So braucht der Server kein natives Modul:
`pdf-to-img` scheiterte in der Bun-Programmdatei, weil pdf.js dort `@napi-rs/canvas` nicht
findet (#21). Intern laufen Bilder als `{ mimeType, data }`.

`/api/extract` und `/api/intake` antworten mit `Accept: application/x-ndjson` als Strom: Header
sofort, dann Zeilen mit `progress`, `heartbeat` (alle zehn Sekunden) und zuletzt `result` oder
`error`. Grund: Firefox wartet höchstens 300 Sekunden auf Header. Ohne diesen Accept-Wert gibt
es die JSON-Antwort wie früher. Bricht der Browser ab, stoppt der Server die Anfrage an den
Anbieter und löscht den gerade hochgeladenen Beleg wieder. Den Abbruch erfährt er über
`POST /api/ai/cancel/<requestId>` (die Kennung schickt der Browser im Formularfeld `requestId`
mit, beim Schließen des Tabs per `sendBeacon`) und zusätzlich über das Schließen der
Verbindung. Die Kennung ist der verlässliche Weg, denn unter Bun 1.3 kam das Schließen nicht bei
Express an (unter Bun 1.4.2 schon), und ein Proxy kann die Verbindung zum Server offen halten.
Der Smoke-Test prüft die Kennung auf jeder Programmdatei und berichtet zusätzlich, ob das bloße
Schließen ankommt. Im Client liest
[client/src/aiRequest.ts](client/src/aiRequest.ts) den Strom und kümmert sich um den Abbruch,
die Karte der Einstellungen ist [AiSettings.tsx](client/src/components/AiSettings.tsx) mit der
Logik in [client/src/aiForm.ts](client/src/aiForm.ts) und
[client/src/modelForm.ts](client/src/modelForm.ts).

**Bestätigung externer Dienste**: Zeigt die Adresse eines Platzes aus dem Haus, oder reicht ein
lokales Ollama das Modell an einen Cloud-Dienst weiter, schickt der Server erst nach einer
Bestätigung Belege dorthin (`POST`/`DELETE /api/ai/consent`, gespeichert in `ai.consent`). Als
lokal gelten dieser Rechner, private und Link-local-Adressen, Namen ohne Punkt sowie `.local`,
`.lan`, `.home.arpa`, `.internal`, `.intern` und `fritz.box`. Was extern ist, entscheidet allein
der Server; die Oberfläche bekommt es als `aiExternal` in den Einstellungen und zeigt es auch
auf Kosten und Schnellerfassung an.

Routen: `/api/ai/presets` (Vorlagen), `/api/ai/status?slot=text|images` (Modelle des Anbieters,
bei Ollama mit Adresssuche), `PUT /api/ai/key` und `DELETE /api/ai/key/:slot`,
`POST /api/ai/consent` und `DELETE /api/ai/consent/:slot`. `/api/ollama/status` bleibt für Tabs
von vor dem Update und liefert in `models` nur Namen, die Einzelheiten in `modelDetails`. Die
Adresssuche fragt je nach Betriebsart nur Sinnvolles (Docker: Host und Compose-Dienst, sonst
dieser Rechner) und nur, wenn die eingestellte Adresse gar nicht erreichbar war.

Umgebungsvariablen (die Einstellungen zeigen betroffene Felder gesperrt, `fixedByEnv`, in die
db.json gelangen die Werte nicht): `NKA_AI_PROVIDER`, `NKA_AI_URL`, `NKA_AI_MODEL`,
`NKA_AI_API_KEY` bzw. `NKA_AI_API_KEY_FILE`, `NKA_AI_TIMEOUT`, `NKA_AI_MAX_TOKENS`; dazu
`NKA_OLLAMA_URL`, `NKA_OLLAMA_MODEL` und `NKA_OLLAMA_NUM_CTX`, die weiter gelten, solange
Ollama der Anbieter ist. Ein ungültiger Wert verhindert den Start mit klarer Meldung. Einzige
Ausnahme vom Grundsatz, dass Werte aus der Umgebung nicht in die db.json gelangen: Die
Bestätigung merkt sich die Adresse, für die sie gilt, auch wenn diese aus der Umgebung stammt.
Sonst ließe sich später nicht prüfen, wofür sie erteilt wurde. Den Schlüssel des
Bilder-Anbieters gibt es bewusst nur in der Oberfläche, die Umgebung legt nur den Standard fest.
`NKA_OLLAMA_CANDIDATES` ersetzt die Adressen der Suche und ist für Tests gedacht. Das
Compose-Profil `ki` startet Ollama als Dienst `ollama` mit und lädt das Modell über den Dienst
`ollama-pull`.

**Modelle laden und Empfehlungen** (#33): [server/src/ai/recommendations.js](server/src/ai/recommendations.js)
hält die Empfehlungsliste. Jede Version bringt eine Kopie mit (`BUILT_IN`, muss mit
[ki-modelle.json](ki-modelle.json) übereinstimmen, ein Test vergleicht beide). Nachgeladen wird
die Datei aus dem Repo nur mit derselben Zustimmung wie beim Update-Hinweis
(`settings.updateCheck === 'on'`), höchstens einmal am Tag, und streng geprüft; unbekannte
Felder fallen weg, eine kaputte Datei ändert nichts. `NKA_MODELS_URL` lenkt die Abfrage auf
einen nachgebauten Server. `GET /api/ai/recommendations` liefert `{ models, updated, source }`.
`POST /api/ai/pull` lädt ein Modell über Ollamas `/api/pull` und antwortet als derselbe Strom
wie die Auswertung (Fortschritt, Lebenszeichen, Abbruch über die Kennung). Nur für ein Ollama
auf diesem Rechner oder im Heimnetz: Dienste im Internet bringen ihre Modelle mit. Vor dem
Download fragt die Oberfläche nach, denn Mietfuchs ist im Heimnetz ohne Anmeldung erreichbar.

**KI-Prüflauf** ([.github/workflows/ai-eval.yml](.github/workflows/ai-eval.yml),
[scripts/ai-eval.mjs](scripts/ai-eval.mjs)): vergleicht echte Ollama-Modelle auf GitHub-Runnern
ohne Grafikkarte an erfundenen Belegen in [scripts/ai-eval/](scripts/ai-eval/), je als PDF mit
Textebene, Scan und Foto. Start von Hand oder per Label `ki-pruefung` an einem PR. Neue
Beispielbelege nur erfunden, nie echte Rechnungen.

**Update-Hinweis** ([server/src/update.js](server/src/update.js)): Nur mit Zustimmung
(`settings.updateCheck === 'on'`, beim ersten Start im Cockpit gefragt) fragt der Server
`releases/latest` bei GitHub ab, höchstens einmal am Tag je laufender Instanz. Ohne Zustimmung
geht keine Anfrage hinaus, `/api/update` liefert dann nur die installierte Version. Nach einem
Fehler wartet er eine Stunde, bei einem Rate-Limit bis `retry-after` bzw. `x-ratelimit-reset`
(höchstens einen Tag), dann auch für „Jetzt prüfen". „Jetzt prüfen" fragt ohnehin höchstens
einmal pro Minute, gleichzeitige Aufrufe teilen sich eine Anfrage, und Links aus der Antwort
werden nur übernommen, wenn sie ins eigene Repo zeigen. Ein Selbst-Update gibt es nicht: Der
Hinweis führt zu einer Anleitung, bei der Programmdatei mit dem Download der passenden Datei
und Schritten je System, bei Docker und npm mit Befehlen. Die Entscheidungslogik der
Oberfläche liegt in [client/src/update.ts](client/src/update.ts). Ob später ein Updater
dazukommt, ist offen (Issue #20). Die eigene Version liest
[server/src/version.js](server/src/version.js) per JSON-Import aus `server/package.json`, den
Bun beim Kompilieren einbettet. Die Betriebsart ergibt sich aus `globalThis.Bun`
(Programmdatei) bzw. `NKA_RUNTIME=docker` (setzt das Dockerfile), sonst `npm`.
`NKA_UPDATE_URL` lenkt die Abfrage auf einen nachgebauten Server.

**Client** ([client/src/](client/src/)): React ohne Router — `App.tsx` schaltet per State
zwischen den Seiten (`pages/`: Cockpit, Schnellerfassung, Zaehler, Kosten, Mietkonto,
Abrechnung, Uebersicht/Kostenvergleich, Steuer, Stammdaten, Belege, Einstellungen), gruppiert
nach Arbeitsphase in der Sidebar (das Abrechnungsjahr liegt zentral im `YearProvider`,
[client/src/year.tsx](client/src/year.tsx)). Dark Mode über `data-theme` auf `<html>` + CSS-Variablen (Umschalter in der
Sidebar, Druck ist immer hell); PWA-Manifest und Icons liegen in `client/public/` (Icons
erzeugt `server/scripts/make-icons.mjs`).
Zentraler Fetch-Wrapper `api()` und Geld-/Datums-Helfer (`parseEuro`, `fmtEuro`, `fmtDate`) in
[client/src/api.ts](client/src/api.ts). Druck/PDF läuft über die Browser-Druckfunktion;
hochgeladene Belege werden für den Druck per **pdf.js** auf Canvas gerendert
([client/src/pdfPreview.ts](client/src/pdfPreview.ts)) — die zugehörigen pdf.js-WASM/Font-
Assets werden im Build via `vite-plugin-static-copy` nach `dist/pdfjs/` kopiert. pdf.js wird
für Druck und Upload über [client/src/pdf.ts](client/src/pdf.ts) geladen, bewusst in der
legacy-Fassung (`pdfjs-dist/legacy/build`): Die moderne setzt die allerneuesten Browser voraus.
Ein Test mit echtem pdf.js ([pdfIntake.pdfjs.test.ts](client/src/pdfIntake.pdfjs.test.ts))
schlägt fehl, wenn jemand auf die moderne Fassung zurückwechselt.

## Konventionen & Fallstricke

- **Sprache im Code.** Bezeichner sind englisch: Variablen, Funktionen, Typen, Datei- und
  Ordnernamen, Umgebungsvariablen und API-Routen, auch für Fachliches (`computeSettlement`,
  `rentLedger`, `buildCostItemBody`). Deutsch bleiben Kommentare, Oberflächentexte,
  Fehlermeldungen, Testnamen, Commit-Nachrichten und gespeicherte Fachwerte (`'vermietet'`,
  `'kaltwasser'`, die Kostenarten). Seitenkomponenten heißen wie die Seite (`Kosten.tsx`).
- **Geld immer in Cent als Integer.** Eingabe-Parsing (deutsche + technische Schreibweise) über
  `parseEuro`; Ausgabe über `fmtEuro`.
- **Datums-Logik** rechnet in UTC mit inklusiven Grenzen — beim Anfassen von calc.js die
  bestehende Konvention beibehalten und gegen [server/test/calc.test.js](server/test/calc.test.js)
  prüfen.
- Der Server nutzt bewusst **`NKA_PORT`** statt `PORT` (generische `PORT`-Variablen von
  Preview-Tools kollidieren sonst mit Vite).
- Zielbild ist das kleine Mehrfamilienhaus in Eigenverwaltung: wenige Wohnungen, davon
  gegebenenfalls eine selbstgenutzte, kalte Betriebskosten. Heizung/Warmwasser nach HeizkostenV
  deckt das Tool derzeit nicht ab — Energie rechnen die Mieter direkt mit ihrem Versorger ab.
- **Maßstab für Erweiterungen** (siehe [CONTRIBUTING.md](CONTRIBUTING.md)): Mietfuchs muss für
  Vermieter ohne technische Vorkenntnisse nutzbar und einfach einzurichten bleiben. Die Technik
  darunter darf wachsen (Datenbank, Serverbetrieb), solange Skripte, Installer und
  Voreinstellungen die Einrichtung übernehmen. Architekturentscheidungen also nicht pauschal
  ausschließen, sondern daran messen, was beim Nutzer ankommt.
