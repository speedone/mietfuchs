# Bezugszähler und verteilter Rest: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Kostenposition nach Verbrauch kann den Verbrauch, den die Zähler der Einheiten nicht messen, nach einem zweiten Schlüssel verteilen, und Zwischenzähler ohne Wohnung einem eigenen Ziel geben; ohne Angabe rechnet alles wie heute.

**Architecture:** Neues Feld `CostItem.meterRest` in drei Untertabellen, `Meter.scope` als Spalte. In calc.ts wird die Verteilung nach Fläche, Einheiten und Personen in eine Funktion `keyRaws` herausgezogen (reiner Umbau); der Zweig `meter` zerlegt den Betrag in Teile (gemessen, Rest, je Zwischenzähler), holt für jeden Teil die Rohwerte über `keyRaws` bzw. die Zähler und verteilt die Summe **einmal** mit `distributeCents`. Der heutige Rest des Hauptzählers (#116) läuft danach über dieselbe Funktion.

**Tech Stack:** TypeScript, Express, SQLite über Drizzle (`npm --prefix server run db:generate`), React 19, node:test, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-virtuelle-zaehler-design.md`

## Global Constraints

- Ohne `meterRest` und ohne `scope` rechnet Mietfuchs wie heute; alle Golden-Tests (calc, tax-golden.json, tax-received-golden.json) bleiben centgenau grün.
- Sparten für `meterRest`: nur `kaltwasser`, `strom`, `sonstig`; Bezugs- und Zwischenzähler nie mit `heatingPlantId`.
- Eine Rundung je Position: alle Teile als exakte Rohwerte, dann ein `distributeCents` (#202).
- Ziele beim Vermieter: `'landlord'` → Grund `mainMeterRest` (abziehbar), `'selfUse'` → Grund `selfUse` (Eigenanteil). Kein neuer `LandlordReason`.
- Neue Hinweis-Codes: `meter.rest-mixed`, `meter.rest-unavailable`, `meter.sub-incomplete` (je `error`), `meter.rest-high` (`warning`). Schwelle 20 % als Parameter `practice.meter-rest-high` in shared/law/practice.ts (`checkOnly`, Fundstellen LG Braunschweig, Urteil vom 22.12.1998, 6 S 163/98; AG Mitte, 20 C 394/06).
- Kein Verweis über Objektgrenzen; Löschen eines verwiesenen Zählers → 409 mit Satz.
- Server: Importe mit `.ts`, `import type`, kein `enum`; Migration nur erzeugt, nie von Hand (server/src/db/CLAUDE.md).
- Nutzertexte siezen, kein Geviertstrich, keine Namen fremder Software (Wächter anrede.test.ts und der Geviertstrich-Wächter).
- Commits: `Refs #98`, nie `Fixes`. Zweig `feat/bezugszaehler-rest`, PR auf `main`.

## Review Focus

1. **Allgemeinstrom mit Wohnungsstromzählern der Mieter**: Bezug ein `common`-Zähler, `behindMeterIds: []`; die Mieterzähler werden nicht abgezogen, der Rest ist der ganze Allgemeinstrom (Test in Task 4).
2. **Teilnehmer und Hauptzähler als Bezug**: Verbrauch der Nicht-Teilnehmer geht an den Vermieter (`outsideUnit`), nie an die Gruppe (Test in Task 4).
3. **Gewerbe gemessen, Wohnungen ungemessen, Hauptzähler deckt nur 200 Tage**: Position nicht verteilt (`meter.rest-unavailable`), das Gewerbe trägt nicht die ganze Rechnung (Test in Task 4).
4. **Mieterwechsel in einer Wohnung der Rest-Gruppe bei Schlüssel Personen**: Rest nach Personentagen je Mietverhältnis, ohne Zwischenablesung des Bezugszählers (Test in Task 4).
5. **Gutschrift** (negativer Betrag) mit Rest und Zwischenzielen: Vorzeichen bleiben, Summe stimmt (Invariante in Task 5).

---

### Task 1: Modell, Tabellen, Lesen, Schreiben, Prüfen

**Files:**
- Modify: `shared/types.ts` (`Meter.scope`, `CostItem.meterRest`, Typen `MeterRest`, `MeterRestKey`, `MeterRestTarget`)
- Modify: `server/src/db/schema.ts` (Spalte `meters.scope`, Tabellen nach `costItemContract`), Migration per `npm --prefix server run db:generate`
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts` (Zusammenführen im `PUT` nach Anwesenheit wie `participantUnitIds`, Schreiben neben `writeCostItemShares`, Prüfungen, Objektgrenze, Löschsperre), `server/src/snapshot.ts` (`SnapshotCostItem`, `SnapshotMeter`)
- Test: `server/test/api-zaehler-rest.test.ts` (neu), `server/test/schema.test.ts`, `server/test/migrations.test.ts` (Marke des neuen Schritts)

**Interfaces:**
- Produces:
  ```ts
  type MeterRestKey = 'area' | 'persons' | 'units'
  type MeterRestTarget = 'landlord' | 'selfUse' | 'excluded' | { key: MeterRestKey | 'direct'; unitIds: string[] }
  type MeterRest = {
    referenceMeterId: string | null
    behindMeterIds: string[] | null
    key: MeterRestKey | 'meter' | 'landlord' | 'selfUse'
    unitIds: string[] | null
    subMeters: { meterId: string; target: MeterRestTarget }[]
  }
  Meter.scope?: 'property' | 'common'   // nur bei unitId null; gespeichert nur 'common'
  CostItem.meterRest?: MeterRest | null
  ```
  Tabellen: `cost_item_meter_rest(cost_item_id PK → cost_items CASCADE, reference_meter_id → meters RESTRICT NULL, key text CHECK, unit_ids_all integer boolean)`, `cost_item_meter_rest_units(cost_item_id, unit_id → units CASCADE)` (für `unitIds`), `cost_item_meter_rest_behind(cost_item_id, meter_id → meters RESTRICT)`, `cost_item_meter_rest_subs(cost_item_id, meter_id → meters RESTRICT, target_kind text CHECK in ('landlord','selfUse','excluded','group'), target_key text NULL CHECK, target_unit_ids text JSON NULL)`. Ein `behindMeterIds: null` heißt: keine Zeilen und Spalte `behind_all = 1`.

- [ ] **Step 1: Failing tests** in `api-zaehler-rest.test.ts` (`startServerIn`):
  - Position „Wasser“ nach Verbrauch (`kaltwasser`) mit `meterRest {referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: []}` anlegen; `GET` liefert es gleich zurück.
  - Zähler „WG Strom“ ohne Wohnung mit `scope: 'common'` anlegen und lesen; `scope: 'common'` an einem Zähler mit Wohnung → 400.
  - 400 jeweils mit Satz: `meterRest` bei Schlüssel `area`; Sparte `waerme`; Bezugszähler mit `heatingPlantId`; Bezugszähler aus anderem Objekt; Bezugszähler zugleich in `behindMeterIds`; Zähler zweimal; `referenceMeterId` gesetzt und `behindMeterIds: null`; `unitIds` außerhalb der Teilnehmer; Ziel eines Zwischenzählers mit Wohnung außerhalb der Teilnehmer; Zwischenzähler mit Wohnung (`scope` muss `common` sein).
  - `PUT` ohne `meterRest` lässt es stehen; `PUT` mit `meterRest: null` entfernt es.
  - `DELETE` eines Zählers, auf den eine Position verweist → 409 mit `/„Wasser“/`.
- [ ] **Step 2: Run** `node --test server/test/api-zaehler-rest.test.ts` → FAIL.
- [ ] **Step 3:** Typen, Schema, Migration erzeugen, Lesen, Schreiben, Prüfungen (Satzfehler als 400 im Stil von `CrossPropertyError`), `crossPropertyViolations` um die neuen Tabellen ergänzen, Snapshot-Felder durchreichen.
- [ ] **Step 4: Run** den Test, `node --test server/test/schema.test.ts server/test/migrations.test.ts server/test/db-repository.test.ts` → PASS; `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(zaehler): Bezugszähler, Rest und Zwischenzähler an der Kostenposition speichern`.

### Task 2: Verteilung nach Fläche, Einheiten, Personen herausziehen (reiner Umbau)

**Files:**
- Modify: `server/src/calc.ts` (Zweige `area`, `units`, `persons` um Zeile 5710-5755)
- Test: vorhandene Suite

**Interfaces:**
- Produces (innerhalb von `computeSettlement`, neben `basisOf`):
  ```ts
  const keyRaws = (key: 'area' | 'units' | 'persons', amountRaw: number, b: typeof fullBasis):
    { targets: { t: CostTenancy; raw: number; basisText: string }[]; selfRaw: number } | { noBasis: string }
  ```
  Liefert genau das, was die Zweige heute in `targets` und `selfRaw` schreiben, für einen beliebigen Teilbetrag `amountRaw` (keine Rundung). Die Zweige rufen sie mit `item.amountCents` auf.

- [ ] **Step 1:** Zweige auf `keyRaws` umstellen, `noBasis`-Sätze unverändert.
- [ ] **Step 2: Run** `npm run test:server` → PASS ohne eine geänderte Erwartung.
- [ ] **Step 3: Commit** `refactor(abrechnung): Verteilung nach Fläche, Einheiten und Personen als Funktion`.

### Task 3: Zähler mit `scope: 'common'` sind keine Hauptzähler

**Files:**
- Modify: `server/src/calc.ts` (`consumptionFor` um Zeile 3777: `mainOfType`, `houseMeters`, Basis)
- Test: `server/test/calc-zaehler-rest.test.ts` (neu)

**Interfaces:**
- Consumes: `SnapshotMeter.scope` aus Task 1.

- [ ] **Step 1: Failing test** `common-Zähler wirkt in keine Position ohne meterRest`: zwei Wohnungen mit Stromzählern (100 und 300 kWh), dazu ein Zähler ohne Wohnung mit `scope: 'common'` (1.000 kWh); Position 400 € nach Verbrauch `strom`: Anteile 100 € und 300 €, kein `mainMeterRest`, kein Hinweis `meter.main-gap`. Gegenprobe ohne `scope`: Hauptzähler wie heute.
- [ ] **Step 2: Run** `node --test server/test/calc-zaehler-rest.test.ts` → FAIL.
- [ ] **Step 3:** Zähler mit `scope === 'common'` aus `mainOfType` und der Basis nehmen.
- [ ] **Step 4: Run** → PASS; `npm run test:server` → PASS.
- [ ] **Step 5: Commit** `feat(zaehler): Zähler für einen Teil des Hauses zählen nicht als Hauptzähler`.

### Task 4: Rest und Zwischenzähler rechnen

**Files:**
- Create: `server/src/meterRest.ts` (reine Funktion, ohne Import aus calc.ts)
- Modify: `server/src/calc.ts` (Zweig `meter` um Zeile 5933, `noticeKinds`, `steps`), `shared/law/practice.ts` (`practice.meter-rest-high`, Wert 20, `checkOnly`)
- Test: `server/test/meter-rest.test.ts` (reine Funktion), `server/test/calc-zaehler-rest.test.ts`

**Interfaces:**
- Produces in `server/src/meterRest.ts`:
  ```ts
  type RestInput = {
    reference: number | null          // Verbrauch des Bezugszählers im Zeitraum, null = deckt ihn nicht
    behind: { unitId: string | null; inGroup: boolean; inBasis: boolean; value: number }[]
    subs: { meterId: string; value: number | null; target: MeterRestTarget }[]  // null = deckt den Zeitraum nicht
    group: { unitId: string; measured: boolean; occupied: boolean }[]
    unmeteredOutside: string[]        // bewohnte, ungemessene Einheiten hinter dem Bezug, nicht in der Gruppe
    key: MeterRest['key']
  }
  type RestPlan =
    | { kind: 'error'; code: 'meter.rest-mixed' | 'meter.rest-unavailable' | 'meter.sub-incomplete'; detail: string[] }
    | { kind: 'fallback'; reason: 'main-partial' | 'negative' }   // nur bei ganz gemessener Gruppe
    | { kind: 'plan'; total: number; measuredIn: number; outside: number; rest: number; subs: { meterId: string; value: number; target: MeterRestTarget }[] }
  export function planMeterRest(input: RestInput): RestPlan
  ```
  `total` ist die Verteilbasis (Bezug minus `excluded`), `outside` der Verbrauch hinter dem Bezug außerhalb der Verteilbasis. Es gilt `measuredIn + outside + rest + Σ subs (ohne excluded) = total`.
- calc.ts teilt `item.amountCents` in Rohbeträge: gemessen je Mietverhältnis wie heute (Anteil `c / total`), `outsideRaw`, Rest über `keyRaws(key, amount × rest / total, basisOf({...item, participantUnitIds: group}))` bzw. bei `'meter'` im Verhältnis von `measuredIn` je Einheit, Zwischenziele ebenso (`direct` = ganz an die eine Einheit, deren Mietverhältnisse nach Tagen), Vermieterziele in `mainRestRaw` bzw. `selfRaw`. Danach ein `distributeCents` wie bisher.

- [ ] **Step 1: Failing tests** in `meter-rest.test.ts` für `planMeterRest`: gemischte Gruppe → `rest-mixed`; ungemessen außerhalb → `rest-mixed`; `key: 'meter'` bei ungemessener Gruppe → `rest-mixed`; Bezug `null` bei ungemessener Gruppe → `rest-unavailable`, bei gemessener → `fallback main-partial`; Rest < 0 entsprechend; Zwischenzähler `value: null` → `sub-incomplete`; `excluded` mindert `total`; Summenregel aus Interfaces für zufällige Eingaben (fester Startwert).
- [ ] **Step 2: Failing tests** in `calc-zaehler-rest.test.ts`, Bestände über `emptyDb`/`tenancy`, je Fall aus der Tabelle der Spec mit Zahlen:
  - Messdifferenz: Haupt 1.100 m³, Wohnungen 400 und 600 m³, 1.100 €, `key: 'area'`, Flächen 40 und 60 m²: Anteile 400 + 40 = 440 € und 600 + 60 = 660 €.
  - Gleicher Bestand, `key: 'meter'`: genau die heutigen Anteile (Orakel gegen dieselbe Position ohne `meterRest`).
  - Gewerbe: Haupt 1.000, Gewerbezähler 200, Wohnungen W1/W2 ohne Zähler (50/50 m²), Rest an W1+W2 nach Fläche: Gewerbe 200, W1 400, W2 400 (bei 1.000 €).
  - Allgemeinstrom (Review Focus 1): Bezug `common` 2.000 kWh, `behindMeterIds: []`, Wohnungsstromzähler der Mieter vorhanden, Zwischenzähler Garage 200 kWh → `direct` auf Stellplatz-Einheit, Rest nach Fläche: Garage 10 %, Rest 90 % nach Fläche.
  - Gartenwasser beim Abwasser: Haupt 1.200, Garten 200 `excluded`, Wohnungen 400/600: verteilt wie 400/600 auf den ganzen Betrag.
  - Bauwasser `landlord`: Grund `mainMeterRest`; Garten des Vermieters `selfUse`: in `selfUsedShareCents` und privat in `taxReport`.
  - Teilnehmer (Review Focus 2), Rest-unavailable (Review Focus 3), Mieterwechsel mit Personen (Review Focus 4).
  - `meter.rest-high` ab Rest > 20 % von `total` bei ganz gemessener Gruppe, mit Betrag je Mieter; nicht bei ungemessener Gruppe.
  - Rechenweg: `steps` nennt Bezugszähler mit Anfangs- und Endstand, Summe der Zähler, Rest, Schlüssel.
- [ ] **Step 3: Run** `node --test server/test/meter-rest.test.ts server/test/calc-zaehler-rest.test.ts` → FAIL.
- [ ] **Step 4:** `planMeterRest` umsetzen, Zweig `meter` anschließen, Hinweise registrieren (Stufe, Titel, Begriffe `meterRest`, `referenceMeter` aus Task 7), Parameter anlegen.
- [ ] **Step 5: Run** beide Tests → PASS; `npm run test:server` → PASS ohne geänderte Erwartung; `noticeSamples.json` neu erzeugen (Kopf von client/src/noticeText.test.ts), `npm --prefix client test -- noticeText` → PASS.
- [ ] **Step 6: Commit** `feat(abrechnung): Rest des Bezugszählers und Zwischenzähler verteilen`.

### Task 5: Invarianten und Rest des Hauptzählers über denselben Weg

**Files:**
- Modify: `server/test/calc.test.ts` (`randomDb`, Invarianten), `server/src/calc.ts` (`mainMeterRest` aus #116 über `planMeterRest` mit festem Ziel)
- Test: `server/test/calc.test.ts`, Golden-Suite

**Interfaces:**
- Consumes: `planMeterRest`, `keyRaws`.

- [ ] **Step 1: Failing invariant** in `calc.test.ts`: `randomDb` setzt bei 25 % der Positionen `meter` ein zufälliges gültiges `meterRest` (Schlüssel, Gruppe, 0 bis 2 Zwischenzähler mit zufälligem Ziel, auch Gutschriften); geprüft: Mieteranteile + Vermieteranteil = Gesamtkosten, keine negativen Anteile außer bei Gutschrift spiegelbildlich, Eigenanteil ≤ Vermieteranteil, kein Mieter außerhalb der Gruppe bekommt Rest.
- [ ] **Step 2: Run** `node --test server/test/calc.test.ts` → FAIL (bis die Generatorfälle laufen) bzw. PASS, falls Task 4 schon trägt; Befunde beheben.
- [ ] **Step 3:** Den Zweig `data.main !== null` (Rest beim Vermieter bzw. Eigenanteil) über `planMeterRest` mit Ziel `landlord`/`selfUse` führen; Texte der Hinweise unverändert.
- [ ] **Step 4: Run** `npm run test:server` → PASS, Golden und tax-golden unverändert.
- [ ] **Step 5: Commit** `refactor(abrechnung): Rest des Hauptzählers über die Restverteilung`.

### Task 6: Oberfläche Zähler und Kostenposition

**Files:**
- Modify: `client/src/meterForm.ts` (+Test), `client/src/pages/Zaehler.tsx` (Frage „Misst dieser Zähler das ganze Haus oder einen Teil?“ nur bei Zähler ohne Wohnung)
- Modify: `client/src/costForm.ts` (+Test): `ItemForm.meterRest`, `itemToForm`, `buildCostItemBody`
- Create: `client/src/components/MeterRestFields.tsx` (+Test), eingebunden in `client/src/pages/Kosten.tsx` unter dem Schlüssel „nach Verbrauch“; `client/src/pages/Muster.tsx`

**Interfaces:**
- Produces in costForm.ts: `ItemForm.meterRest: MeterRest | null`; `meterRestChoices(form, meters, units): { references: Option[]; behind: Option[]; subs: Option[] }` (nur passende Sparte, ohne Heizanlage; `behind` vorbelegt mit den Zählern der Verteilbasis bei einem Bezug ungleich Hauptzähler); Problem `{ field: 'meterRest', short: 'Bitte wählen', text }`, wenn bei einem Bezug ungleich Hauptzähler keine Liste gewählt ist. Wechsel des Schlüssels weg von `meter` oder der Sparte auf eine nicht erlaubte leert `meterRest` mit Satz.
- `MeterRestFields`: Radiogruppe „Verbrauch ohne eigenen Zähler: tragen Sie / im Verhältnis der Zähler / nach Fläche / nach Personen / nach Einheiten“, darunter Bezugszähler (vorbelegt Hauptzähler), „nur auf bestimmte Wohnungen“, Liste „Zähler hinter dem Bezugszähler“, Zwischenzähler mit Ziel. Alle Auswahlfelder über `meterTypeOptions`/`costKeyOptions`-Muster, angezeigter Wert gleich gespeichertem.

- [ ] **Step 1: Failing tests:** `costForm.test.ts` (Vorbelegung, Leeren beim Schlüsselwechsel, Problem ohne Liste, Rumpf), `meterForm.test.ts` (`scope` nur ohne Wohnung), `MeterRestFields.test.tsx` (Auswahl sichtbar gleich gespeichert; Garage `direct` sendet die Einheit), `Kosten.test.tsx` (Speichern sendet `meterRest`).
- [ ] **Step 2: Run** `npm --prefix client test -- costForm meterForm MeterRestFields Kosten` → FAIL.
- [ ] **Step 3:** umsetzen; Regeln aus client/CLAUDE.md (Seitenfenster, Felder, Verben, Entwürfe).
- [ ] **Step 4: Run** dieselben Tests und `npm --prefix client test -- uiRules openFormGuard saveOnChange requiredFields` → PASS.
- [ ] **Step 5: Commit** `feat(kosten): Rest und Zwischenzähler im Seitenfenster einstellen`.

### Task 7: Lexikon, Doku, Changelog, Abschluss

**Files:**
- Modify: `shared/glossary.ts` (Begriffe `meterRest` „Allgemeinverbrauch“, `referenceMeter` „Bezugszähler“, Verweis aus `mainMeter`; je Erklärung, Beispiel mit den Zahlen aus Task 4, Rechtsgrundlage, „Brauche ich das?“), `CHANGELOG.md` („Hinzugefügt“, Link auf #98), `server/src/CLAUDE.md` (Abschnitt Verbrauchsschlüssel), `client/CLAUDE.md` falls ein neues Formularmuster entsteht, `docs/heizung.md` nicht (Heizung ausgenommen, ein Satz in server/src/CLAUDE.md genügt)

- [ ] **Step 1:** schreiben.
- [ ] **Step 2: Run** `npm run typecheck && npm test` → PASS; `npm run browser-check -- --engines chromium --pages kosten,zaehler,muster` → ohne Befund.
- [ ] **Step 3: Commit** `docs: Bezugszähler und verteilter Rest in Lexikon, Changelog und CLAUDE.md`.
- [ ] **Step 4:** Durchsicht mit frischem Kontext (Geld und Daten), Befunde mit vorher rotem Test beheben, PR (nicht Draft) mit `Refs #98`, Label `full-check`.
