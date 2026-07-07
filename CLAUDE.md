# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

**Mietfuchs** — lokales Web-Tool für die Nebenkostenabrechnung privater Vermieter (Deutschland).
Alles läuft auf dem eigenen Rechner — keine Cloud, kein Konto. Sprache von UI, Kommentaren und
Domänenbegriffen ist durchgängig **Deutsch**; bitte beibehalten.

## Commands

Vom Repo-Root (npm-Workspaces-artiges Setup ohne echte Workspaces — `postinstall` installiert
Server und Client mit):

```powershell
npm install        # installiert Root + server + client
npm run dev        # concurrently: Server (Port 3001) + Vite (Port 5173)
npm test           # Tests der Berechnungs-Engine (delegiert an server)
npm run build      # baut das Frontend nach client/dist (tsc --noEmit + vite build)
npm start          # Produktivbetrieb: Server liefert App + API auf Port 3001
npm run package    # baut eigenständige Binaries nach dist-bin/ (braucht Bun)
```

**Eigenständige Binaries** (für Endanwender ohne Node): [scripts/package-binaries.mjs](scripts/package-binaries.mjs)
kompiliert Server + eingebettetes Frontend per **Bun `--compile`** zu je einer Datei pro
Plattform (Windows/macOS-Intel/macOS-ARM/Linux) in `dist-bin/`. `node scripts/package-binaries.mjs win`
baut nur ein Ziel. Bun wird gewählt, weil der Server ESM ist und `pdfjs-dist` top-level await
nutzt — beides kann pkg/SEA nicht bündeln. Das Frontend wird beim Build über
[scripts/embed-client.mjs](scripts/embed-client.mjs) aus `client/dist` in das generierte
(gitignorierte) Modul `server/src/embedded-client.js` eingebettet (Bun-Importattribut
`with { type: 'file' }`) und im gepackten Betrieb daraus ausgeliefert. In der Binary erkennt der
Server den gepackten Modus an `globalThis.Bun`: Daten landen dann in `data/` **neben der
ausführbaren Datei** (nicht in `server/data`), und der Standard-Browser wird automatisch geöffnet.
Release-Automatik: [.github/workflows/release.yml](.github/workflows/release.yml) baut bei einem
`v*`-Tag alle Ziele auf einem Linux-Runner und hängt sie ans GitHub-Release.

Einzelnen Test ausführen (node:test, kein Framework):

```powershell
npm --prefix server test -- --test-name-pattern "Flächenschlüssel"
```

Es gibt **keinen Linter** und keine Client-Tests. `npm run build` ist der einzige
Typecheck-Pfad (`tsc --noEmit`).

## Architektur

Zwei getrennte npm-Pakete: `server/` (Express, ESM, kein TypeScript) und `client/` (React 19 +
Vite + TypeScript). Im Dev proxyt Vite `/api` und `/uploads` an `localhost:3001`
([client/vite.config.ts](client/vite.config.ts)); im Produktivbuild liefert der Express-Server
das statische `client/dist` selbst aus ([server/src/index.js](server/src/index.js)).

**Persistenz**: eine einzige JSON-Datei `server/data/db.json`, atomar geschrieben (Temp +
rename) über [server/src/store.js](server/src/store.js). Belege liegen in `server/data/uploads/`.
Backup = diesen Ordner kopieren. Keine Datenbank, keine Migrationen-Tooling — Schema-Migrationen
älterer `db.json` passieren imperativ in `load()` in store.js (z. B. fester Monatsbetrag →
Vorauszahlungs-Staffel). Beim Erweitern des Datenmodells dort die Migration ergänzen.

**API** ([server/src/index.js](server/src/index.js)): generische CRUD-Routen werden in einer
Schleife für die Collections `units, tenancies, costItems, meters, readings, payments` erzeugt.
Löschen einer `unit` bzw. `meter` kaskadiert manuell auf abhängige Datensätze (auch `payments`
beim Löschen einer `unit`/`tenancy`). Daneben Spezialrouten:
`/api/settings`, `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`
(Mietkonto: Soll/Ist je Monat), `/api/taxreport/:year` (Steuer-Übersicht Anlage V),
`/api/upload`, `/api/extract`, `/api/ollama/status`, `/api/uploads` (Belegarchiv: Liste +
Löschen unverknüpfter Dateien), `/api/backup`/`/api/restore` (ZIP via adm-zip) sowie
`/api/settlement/:year/close` (POST/PUT/DELETE): friert die Abrechnung als Snapshot in der
Collection `closedSettlements` ein (inkl. `sentAt` für die §556-Frist) — `GET
/api/settlement/:year` liefert dann den Snapshot statt der Live-Berechnung.

**Berechnungs-Engine** ([server/src/calc.js](server/src/calc.js)) — das Herzstück, hier liegt
die ganze fachliche Komplexität:
- **Alle Beträge in Cent (Integer)**, niemals Euro-Floats — Gleitkomma-Fehler vermeiden.
- Centgenaue Verteilung per **Hare/largest-remainder** (`largestRemainder`). Schöpfen die
  Rohanteile die Summe nahezu voll aus, wird centgenau auf Mieter verteilt; sonst trägt der
  **Vermieter** die Differenz (Leerstand, Eigenanteil, Rundungsrest, „Nicht umlagefähig").
- **Umlageschlüssel** (`item.key`): `area` (Wohnfläche), `persons` (personentagesgenau),
  `units` (Wohneinheiten), `meter` (Verbrauch nach Zählertyp), `direct` (Direktzuordnung).
- **Staffeln statt Neuanlage**: Personenzahl (`personHistory`) und Vorauszahlung
  (`prepayments`, `from: YYYY-MM`) werden als „ab Datum gilt Wert" geführt. Tatsächlich
  gezahlte Vorauszahlungen pro Jahr können via `prepaymentOverrides` überschrieben werden
  (haben Vorrang — rechtlich zählt das tatsächlich Gezahlte).
- **Zeiträume** sind ISO-Strings mit inklusiven Grenzen, in UTC gerechnet; Tagesanteile zählen
  für Teiljahre. `end: null` = offenes Mietverhältnis.
- **Zähler**: Ablesungen → Verbrauchssegmente (`meterSegments`), tagesanteilig interpoliert
  (`consumptionInPeriod`). Zählerwechsel über `replacement: true` + `oldEndValue`. Negativer
  Verbrauch erzeugt eine Warnung.
- Nur Wohnungen mit `participates: true` nehmen an der Verteilung teil (die selbstbewohnte
  Wohnung ist `false`).
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

**KI-Belegauswertung** ([server/src/extract.js](server/src/extract.js)): optional, gegen eine
lokale **Ollama**-Instanz (URL/Modell aus den Settings). PDF → Textebene via `pdf-parse`;
Scans ohne (brauchbare) Textebene werden per `pdf-to-img` seitenweise als PNG gerendert und
ans Vision-Modell gegeben. Bilder → Base64 (braucht Vision-Modell). Erzwingt
strukturiertes JSON über `format: SCHEMA`. Die KI macht nur Vorschläge — Übernahme erst nach
manueller Prüfung. Die Kategorie-Enums in extract.js und in `CATEGORIES`/`matchCategory` in
types.ts müssen zusammenpassen.

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
Assets werden im Build via `vite-plugin-static-copy` nach `dist/pdfjs/` kopiert.

## Konventionen & Fallstricke

- **Geld immer in Cent als Integer.** Eingabe-Parsing (deutsche + technische Schreibweise) über
  `parseEuro`; Ausgabe über `fmtEuro`.
- **Datums-Logik** rechnet in UTC mit inklusiven Grenzen — beim Anfassen von calc.js die
  bestehende Konvention beibehalten und gegen [server/test/calc.test.js](server/test/calc.test.js)
  prüfen.
- Der Server nutzt bewusst **`NKA_PORT`** statt `PORT` (generische `PORT`-Variablen von
  Preview-Tools kollidieren sonst mit Vite).
- Fachliche Rahmenbedingungen des Nutzers: 3 Wohnungen, eine selbstbewohnt (nicht beteiligt),
  nur kalte Betriebskosten, Mieter zahlen Energie direkt.
