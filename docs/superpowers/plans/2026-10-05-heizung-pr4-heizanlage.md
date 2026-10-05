# Heizung PR 4: Heizanlage, Grundlage (#99, #214, #180) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Objekt bekommt eine Heizanlage mit Energieträger, Abrechnungsweg (Messdienst,
Gemeinschaft oder freie Schlüssel), angeschlossenen Wohnungen und Angaben zur Fernablesbarkeit;
Zähler kennen Warmwasser und Heizkostenverteiler, Einbaudatum und Fernablesbarkeit; die Abrechnung
beziffert die 3 % nach § 12 Abs. 1 Satz 2 HeizkostenV, wo sie sicher sind, und rechnet sonst keine
einzige Zahl anders als vorher.

**Architecture:** Drei neue Tabellen (`heating_plants`, `heating_plant_units`, `heating_periods`
ohne Vorrat) und neue Spalten an `meters` und `cost_items` entstehen in zwei erzeugten Migrationen
(erst Spalten und Tabellen, dann Bedingungen). Anlegen, Ändern und Entfernen einer Anlage stehen in
`server/src/db/heating.ts`; die Prüfungen an Kostenpositionen und Zählern bleiben in
`repository.ts`, das dafür seine Rumpf-Helfer exportiert. Die Berechnung bekommt die Anlagen über
den Schnappschuss; neu rechnet sie nur zwei Dinge, und beide greifen erst, wenn jemand etwas
einstellt: Zähler der Anlage sind keine Hauptzähler, und Warmwasserzähler zählen beim Kaltwasser
mit (G-B8). Die Fernablesbarkeit entscheidet `server/src/remoteReading.ts` nach den Parametern
`hkv.remote-reading.new-devices` (neu) und `hkv.remote-reading.retrofit` (PR 1). Die Oberfläche
bekommt die Karte „Heizung“ in den Stammdaten (Schritte 1, 2, 4, 5, 6 aus 11.2) und Felder am
Zähler.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.6 (N6, D-F2, D-R4), 0.7 (A2), 0.8 (B7), 0.9–0.11 („PR 4 bleibt unverändert“), 1.2 Nr. 1, 3.0,
3.12, 3.13, 4.3 (`hkv.remote-reading.new-devices`), 4.7, 5.1, 5.3, 5.7, 5.8, 5.9, 6.1 Nr. 1 und
4.3, 6.5, 8.9, 10.1 (`heating.remote-reading`, `property.kind-mismatch`), 10.3, 11.1, 11.2,
12.2 (G-B8, A2, R-A1, R-A21 nur als Sperre), 12.3 Nr. 12 und 13, 12.4, 13 (PR 4), 14.1, 14.2.

**Baut auf:** PR 1 (`docs/superpowers/plans/2026-10-05-heizung-pr1-rechtsregister.md`, Code auf
`feat/heizung-pr1-rechtsregister`), PR 2 (`…-pr2-zeitraum-kern.md`) und PR 3
(`…-pr3-zeitraum-bedienung.md`). Gearbeitet wird auf
`feat/heizung-pr4-heizanlage`, abgezweigt von der Spitze von PR 3; der PR wird gestapelt auf PR 3
gestellt und nach dessen Merge auf `main` umgestellt (CLAUDE.md, „Durchsicht vor jedem PR und vor
jedem Merge“).

## Global Constraints

- **Golden wortgleich:** Unter `server/test/fixtures/settlement/` ändert sich keine Datei;
  `settlement-golden.test.ts`, `db-golden.test.ts`, `db-objekte.test.ts`, `calc-wortlaut.test.ts`,
  `law-wording.test.ts` und `rechtstexte.test.ts` bleiben grün ohne Anpassung ihrer Erwartungen
  (Entwurf 1.2 Nr. 1: „Golden F01–F11 bleiben bis PR 5 wortgleich“).
- **Wer nichts einstellt, merkt nichts** (11.1): ohne Anlage, ohne Warmwasser- oder HKV-Zähler und
  ohne Anlagenzähler ist jede Zahl, jeder Hinweis und `legalBasis.values` gleich dem Stand nach
  PR 3. Kein neues Pflichtfeld, kein neuer Schritt im Weg.
- **Anlegen einer Anlage ändert keine Zahl** (11.2, A2): Eine Anlage mit den Vorgaben
  (`method = 'manual'` oder `'service'`, Fernablesbarkeit „unbekannt“) ergibt dieselbe Abrechnung
  wie ohne Anlage, über das ganze Ergebnis. `change_split` wird gespeichert und wirkt in PR 4
  nirgends (bei `manual` erst mit `heating_target`, PR 10; B7).
- **Sperren, 400 mit einem Satz** (13, W7): `method = 'self'`, `supply = 'perUnit'`, zweite Anlage
  im selben Objekt, eigene Heizperiode (`periodStartMonth`), getrennte Abrechnung
  (`separateSettlement`), beheizte Fläche je Wohnung (`heatedAreaM2`), Kostenschlüssel „nach
  Verbrauch“ mit Heizkostenverteilern. Jeder Satz endet mit „… kommt mit einer späteren Version.“
  oder nennt, was stattdessen geht.
- **Stufe hängt am Code** (CLAUDE.md, #112): Der Entwurf nennt für `heating.remote-reading` zwei
  Stufen (10.1). Weil `warn` je Code genau eine Stufe kennt, bleibt `heating.remote-reading` ein
  `hint` (unbekannt oder „bis zu 3 %“), und die sichere Kürzung bekommt den neuen Code
  `heating.remote-reading-missing` (`warning`, 3 % je Mieter). Ohne Anlage bleibt der Hinweis
  wortgleich wie nach PR 1.
- **Rechtswerte nur aus dem Register:** Der Stichtag 01.12.2021 und die 3 % kommen aus
  `hkv.remote-reading.new-devices`, `hkv.remote-reading.retrofit` und `hkv.cut.remote-reading`.
  Keine Datums- oder Prozentliterale im Muster des Wächters `law-literals.test.ts`;
  `server/src/remoteReading.ts` kommt in dessen `ENGINE_FILES`. Ein Parameter kommt mit der PR,
  die ihn nutzt (G-C7): hier nur `hkv.remote-reading.new-devices`.
- **Migrationen:** Aufbau nur mit `npm --prefix server run db:generate -- --name <name>`, nie von
  Hand. Zwei Schritte, in genau dieser Reihenfolge hinter den Schritten von PR 3: `heizanlage`
  (neue Tabellen und neue Spalten, keine geänderte Bedingung an einer bestehenden Tabelle) und
  `heizanlage_bedingungen` (Zählertypen, Objektart, Bedingungen an `meters`). PR 2 belegt
  0014/0015, PR 3 `0016_leistungszeitraum` und `0017_leistungszeitraum_pruefung`; PR 4 erzeugt also
  `0018_heizanlage` und `0019_heizanlage_bedingungen`. Keine Datenanweisung. Die Marken beider Schritte kommen in
  `server/test/migrations.test.ts`. Wird PR 3 vor dem ersten Push dieses Zweigs neu erzeugt,
  werden beide Schritte hier ebenfalls neu erzeugt (README „solange ein Schritt die Arbeitskopie
  nicht verlassen hat“).
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate}.ts` bleiben unverändert
  (Prüfsumme in `legacy-schema.test.ts`), ebenso `legacy/validate.ts` (die db.json kennt keine
  Warmwasser- und HKV-Zähler und keine Anlage). `legacy/read.ts` braucht keine Änderung: Alle
  neuen Felder im Schnappschuss sind optional.
- **Objektgrenze:** Anlage, ihre Wohnungen, ihre Zähler und ihre Kostenpositionen gehören zu genau
  einem Objekt; ein Verweis darüber hinaus ist ein `CrossPropertyError` (400) und beim
  Wiederherstellen ein Befund.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen
  (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und
  `NKA_UPDATE_URL` (geschlossener Port); in api.test.ts erledigt das `startServer`/`startServerIn`,
  beim Smoke-Test der Aufruf von Hand (Task 12).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #99` (dazu `#214` bei der
  Fernablesbarkeit, `#180` beim Zweifamilienhaus) und endet mit den Attribution-Zeilen der
  ausführenden Sitzung.

## Review Focus

1. **Ein Tab von vor dem Update legt eine Heizposition an** (ohne Feld `heatingPlantId`), oder die
   Belegbuchung tut es. Der Vermieter erwartet, dass die Position zur Anlage seines Objekts
   gehört, sonst fehlt sie ab PR 5 im Topf der Heizperiode. Erwartet: Eine neue Position der
   Kostenart „Heizung und Warmwasser“ bekommt die einzige Anlage ihres Objekts, außer ihr
   Zeitraum ist abgeschlossen. Test in Task 4.
2. **Die letzte angeschlossene Wohnung wird gelöscht.** Mit `ON DELETE CASCADE` bliebe eine Anlage
   ohne Zeilen zurück, und „keine Zeilen“ hieße „alle Wohnungen“: Die Anlage versorgte plötzlich
   das ganze Haus. Erwartet: Sie versorgt dann keine Wohnung, wie `participants_limited` bei den
   Kostenpositionen (#94). Test in Task 3.
3. **Ein Zähler der Anlage wird an eine Wohnung gehängt** (PUT mit `unitId`, die Anlage bleibt im
   Datensatz), oder eine Anlage mit Zählern wird entfernt. Erwartet: ein Satz statt eines
   Datenbankfehlers, und nie wird aus einem Wärmezähler am Speicher still ein Hauptzähler des
   Hauses, der Verbrauch nach #116 umverteilt. Tests in Task 3 und Task 4.
4. **Kostenposition oder Zähler eines Objekts zeigen auf die Anlage eines anderen** (zwei Objekte,
   alter Tab, von Hand bearbeitetes Archiv). Erwartet: 400 beim Schreiben, Ablehnung beim
   Wiederherstellen, bevor etwas ersetzt wird. Tests in Task 4 und Task 5.
5. **Ein Messdienst rechnet nach Heizkostenverteilern ab, und der Vermieter wählt bei der Position
   „nach Verbrauch“ mit Zählertyp Heizkostenverteiler.** Ohne Bewertungsfaktoren (PR 12) wäre das
   eine Verteilung nach rohen Einheiten. Erwartet: Der Typ wird gar nicht angeboten, und der
   Server lehnt ihn mit einem Satz ab, der auf die Einzelbeträge des Messdienstes verweist. Tests
   in Task 4 und Task 11.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/heizkostenv.ts`, `shared/law/params.ts` | Parameter `hkv.remote-reading.new-devices` | 1 |
| `shared/types.ts` | `HeatingPlant`, `HeatingPlantUnit`, `HeatingPeriodData`, Aufzählungen, `AssignableHeatingItem`; `Meter` und `CostItem` erweitert; `MeterType` + `warmwasser`, `hkv`; `PropertyKind` + `zfh` | 2 |
| `server/src/db/schema.ts` | Tabellen, Spalten, Listen, Bedingungen | 2 |
| `server/drizzle/0018_heizanlage.sql`, `0019_heizanlage_bedingungen.sql`, `meta/*` (erzeugt) | Migration | 2 |
| `shared/wording.ts`, `server/src/bookingPlan.ts`, `client/src/types.ts`, `client/src/meterForm.ts`, `client/src/unitForm.ts` | neue Zählertypen und Objektart beschriften | 2 |
| `server/src/db/read.ts` | Anlagen lesen, neue Felder an Zählern und Positionen, `Stock.heatingPlants` | 3, 4 |
| `server/src/db/heating.ts` (neu) | Anlage anlegen, ändern, entfernen; Zuordnung offener Heizpositionen; Befunde beim Wiederherstellen | 3, 5 |
| `server/src/db/repository.ts` | `HeatingError`; Rumpf-Helfer exportiert; Zähler und Positionen an der Anlage; Objekt löschen | 3, 4 |
| `server/src/db/backup.ts` | Wiederherstellen prüft die Anlagen | 5 |
| `server/src/index.ts` | Routen `/api/heating-plants`, Fehlerbehandlung | 6 |
| `server/src/snapshot.ts` | Anlagen und Zählerfelder im Schnappschuss | 7 |
| `server/src/calc.ts` | Anlagenzähler sind keine Hauptzähler, Wasserschlüssel, Fernablesbarkeit, Zweifamilienhaus | 7, 8, 9 |
| `server/src/remoteReading.ts` (neu) | Entscheidung über die Fernablesbarkeit | 8 |
| `shared/glossary.ts` | Begriffe `heatingSystem`, `heatCostAllocator` | 8 |
| `client/src/heatingForm.ts` (neu), `client/src/components/HeatingCard.tsx` (neu), `client/src/pages/Stammdaten.tsx` | Einrichtung „Heizung“ | 10 |
| `client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx`, `client/src/costForm.ts`, `client/src/pages/Kosten.tsx` | Zählerfelder, kein Verbrauchsschlüssel nach HKV | 11 |
| `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung der Programmdateien, Doku | 12 |
| Tests: `server/test/law.test.ts`, `law-history.test.ts`, `schema.test.ts`, `migrations.test.ts`, `db-heizanlage.test.ts` (neu), `db-repository.test.ts`, `db-backup.test.ts`, `api.test.ts`, `calc-heizanlage.test.ts` (neu), `remote-reading.test.ts` (neu), `law-literals.test.ts`, `client/src/heatingForm.test.ts` (neu), `client/src/components/HeatingCard.test.tsx` (neu), `client/src/meterForm.test.ts`, `client/src/costForm.test.ts`, `client/src/unitForm.test.ts` | | je Task |

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Aus dem Code von PR 1 (`feat/heizung-pr1-rechtsregister`, Stand `915d5e3`) und den Plänen von PR 1
und PR 2; Namen genau so:

- `shared/law/register.ts`: `law(param, ctx, log)` mit Überladungen für `periodStart`
  (`{ period }` → `T`), `eventDate` (`{ date }` → `T`), `overlap` (`{ period }` →
  `OverlapAnswer<T>` mit `coverage`, `value`, `validFrom?`, `validTo?`); `createLawLog()`,
  `LawLog`, `Period = { from: string; to: string }`, `valueAt`, `onlyVersion`, `germanDate`,
  `LAW_AS_OF`; `LawParam<T, M>` mit `describe(value)`.
- `shared/law/heizkostenv.ts`: `hkvCutRemoteReading` (`LawParam<number, 'periodStart'>`, 3),
  `hkvRemoteReadingRetrofit` (`LawParam<{ installedUpTo: string }, 'overlap'>`, `validFrom
  '2027-01-01'`); `shared/law/params.ts`: `LAW_PARAMS`.
- In `computeSettlement` nach PR 1 und PR 2: `lawLog`, `lawPeriod` (spannt P), `yFrom`, `yTo`,
  `diy`, `warn(code, text, subject?)`, `fmtDay`, `fmtCents`, `andList`, `statements`
  (`Map<string, Statement>`), `items`, `heatingBilledItem`, `heatingAgreeable`; der Block
  „Fernablesbarkeit“ mit `law(hkvRemoteReadingRetrofit, …)` und `law(hkvCutRemoteReading, …)`.
- `shared/period.ts` (PR 2): `PeriodKey`, `periodKey(text)`, `parsePeriodKey`, `periodOfKey`,
  `rulesOf`, `calendarPeriod`; `Snapshot.period`, `snapshotOf(source, year)`,
  `snapshotFor(source, propertyId, period: BillingPeriod)`; `CostItem.period` (kein `year`);
  `closedSettlements.period`; in repository.ts `PeriodError`, `rulesForProperty`,
  `Collection<T>.guard(db, before, after, body)` und `guardCostItem(db, before, after, body)`;
  `closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`.
- PR 3 (Plan `…-pr3-zeitraum-bedienung.md`): Migrationen 0016/0017 mit `cost_items.service_from`,
  `service_to`, `tax_year`, `heating_part` samt Bedingung `cost_items_heating_part_category` (nur
  Kostenart Heizung und Warmwasser, dieselbe Grenze wie `heatingPlantId` hier); `PeriodProvider`
  und `usePeriod` ersetzen `useYear`, die Karte „Abrechnungszeitraum“ (`PeriodCard`) steht in den
  Stammdaten. PR 4 liest keines
  dieser Felder. Wo ein Test alle Spalten einer Tabelle belegt (`db-repository.test.ts`), stehen
  sie schon in der Probe; dieser Plan ergänzt nur die eigenen.

---
### Task 1: Rechtsregister: Fernablesbarkeit neu eingebauter Geräte

Der Parameter, den der Entwurf PR 4 zuweist (4.3, N6): `hkv.remote-reading.new-devices`,
Zeitregel `eventDate` (Einbaudatum). Zwei Fassungen, damit jedes Datum eine Antwort hat; der
Stichtag steht zusätzlich im Wert, weil die Hinweise ihn nennen.

**Files:**
- Modify: `shared/law/heizkostenv.ts` (ans Ende), `shared/law/params.ts`
- Test: `server/test/law.test.ts`, `server/test/law-history.test.ts`

**Interfaces:**
- Consumes (PR 1): `LawParam`, `Source`, `germanDate` aus `shared/law/register.ts`; `checked`, `ENACTED` in `heizkostenv.ts`; `law`, `createLawLog`.
- Produces: `hkvRemoteReadingNewDevices: LawParam<{ readonly required: boolean; readonly installedAfter: string }, 'eventDate'>`, eingetragen in `LAW_PARAMS`.

- [ ] **Step 1: Write the failing tests**

In `server/test/law.test.ts` den Import aus `'../../shared/law/heizkostenv.ts'` um
`hkvRemoteReadingNewDevices` ergänzen, im Test „jede Konstante vom Typ LawParam in shared/law/
steht in LAW_PARAMS“ das Objekt `modules` um `hkvRemoteReadingNewDevices` ergänzen, und ans Ende
anhängen:

```ts
test('Stichtag hkv.remote-reading.new-devices: Einbau bis 01.12.2021 ohne, ab 02.12.2021 mit Pflicht ab Einbau', () => {
  const log = createLawLog()
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2015-03-01' }, log).required, false)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2021-12-01' }, log).required, false)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2021-12-02' }, log).required, true)
  assert.equal(law(hkvRemoteReadingNewDevices, { date: '2030-01-01' }, log).installedAfter, '2021-12-01')
  // Jede Fassung steht einmal im Protokoll, auch wenn sie mehrfach abgefragt wurde.
  assert.deepEqual(log.values.map((v) => [v.id, v.validFrom ?? '', v.text]), [
    ['hkv.remote-reading.new-devices', '', 'Einbau bis 01.12.2021: keine Pflicht ab Einbau'],
    ['hkv.remote-reading.new-devices', '2021-12-02', 'Einbau nach dem 01.12.2021: fernablesbar ab Einbau'],
  ])
})
```

In `server/test/law-history.test.ts` in `SHIPPED` hinter den Zeilen der vorigen PRs anhängen:

```ts
  // 0.11.0 (Heizung PR 4)
  'hkv.remote-reading.new-devices||2021-12-01|{"required":false,"installedAfter":"2021-12-01"}',
  'hkv.remote-reading.new-devices|2021-12-02||{"required":true,"installedAfter":"2021-12-01"}',
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts`
Expected: FAIL. Der Import `hkvRemoteReadingNewDevices` ist unbekannt
(`does not provide an export named 'hkvRemoteReadingNewDevices'`).

- [ ] **Step 3: Implement**

`shared/law/heizkostenv.ts` ans Ende:

```ts
// Geräte, die nach dem 01.12.2021 eingebaut werden, müssen fernablesbar sein, und zwar ab ihrem
// Einbau (§ 5 Abs. 2 Satz 1 HeizkostenV); ausgenommen ist der Ersatz oder die Ergänzung einzelner
// Geräte in einem nicht fernablesbaren Gesamtsystem (Satz 4). Zeitregel `eventDate`: Gefragt wird
// mit dem Einbaudatum (Heizung PR 4, N6 der dritten Fassung: eine Zeitregel je Parameter; die
// Altgeräte regelt `hkv.remote-reading.retrofit`). Zwei Fassungen, damit jedes Datum eine Antwort
// hat; der Stichtag steht zusätzlich im Wert, weil die Hinweise ihn nennen.
export const hkvRemoteReadingNewDevices: LawParam<{ readonly required: boolean; readonly installedAfter: string }, 'eventDate'> = {
  id: 'hkv.remote-reading.new-devices',
  title: 'Fernablesbarkeit neu eingebauter Geräte',
  norm: '§ 5 Abs. 2 HeizkostenV',
  timing: 'eventDate',
  versions: [
    {
      validTo: '2021-12-01',
      value: { required: false, installedAfter: '2021-12-01' },
      source: checked('§ 5 Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
      enacted: ENACTED,
    },
    {
      validFrom: '2021-12-02',
      value: { required: true, installedAfter: '2021-12-01' },
      source: checked('§ 5 Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
      enacted: ENACTED,
    },
  ],
  describe: (v) =>
    v.required
      ? `Einbau nach dem ${germanDate(v.installedAfter)}: fernablesbar ab Einbau`
      : `Einbau bis ${germanDate(v.installedAfter)}: keine Pflicht ab Einbau`,
}
```

`shared/law/params.ts`: den Import aus `'./heizkostenv.ts'` um `hkvRemoteReadingNewDevices`
ergänzen und in `LAW_PARAMS` hinter `hkvRemoteReadingRetrofit` die Zeile
`  hkvRemoteReadingNewDevices,` einfügen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/law.test.ts test/law-history.test.ts test/law-release.test.ts && npm run typecheck`
Expected: PASS, typecheck ohne Fehler. `LAW_AS_OF` bleibt `'2026-10-05'` (beide Fassungen tragen
`retrieved: '2026-10-05'` über `checked`).

- [ ] **Step 5: Commit**

```bash
git add shared/law/heizkostenv.ts shared/law/params.ts server/test/law.test.ts server/test/law-history.test.ts
git commit -m "Rechtsregister: Fernablesbarkeit neu eingebauter Geräte (§ 5 Abs. 2 HeizkostenV)

Refs #99, #214"
```

---

### Task 2: Datenmodell und Migrationen

Drei Tabellen, neue Spalten an Zählern und Kostenpositionen, zwei neue Zählertypen und die
Objektart Zweifamilienhaus. Zwei erzeugte Schritte, weil drizzle-kit beim Neubau einer Tabelle die
neuen Spalten aus der alten kopieren wollte (README „Neue Spalten und geänderte Bedingungen nie in
einem Schritt“): erst Tabellen und Spalten, dann die Bedingungen.

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`
- Create (erzeugt): `server/drizzle/0018_heizanlage.sql`, `server/drizzle/0019_heizanlage_bedingungen.sql`, `server/drizzle/meta/0018_snapshot.json`, `server/drizzle/meta/0019_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Modify (Beschriftungen der neuen Werte): `shared/wording.ts`, `server/src/bookingPlan.ts`, `client/src/types.ts`, `client/src/meterForm.ts`, `client/src/unitForm.ts`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`, `client/src/meterForm.test.ts`, `client/src/unitForm.test.ts`

**Interfaces:**
- Consumes (PR 2): `PeriodKey` aus `shared/types.ts`; die Prüfbedingung des Zeitraumschlüssels im Wortlaut aus PR 2.
- Produces:
  - Typen in `shared/types.ts`: `HeatingEnergy`, `HeatingSupply`, `HeatingMethod`, `DevicesRemote`, `DevicesInstalledAfter`, `HeatingSource`, `ChangeSplit`, `HeatingRole`, `InsulationRule`, `DhwMethod`, `HeatingPlantUnit = { unitId: string; heatedAreaM2: number | null }`, `HeatingPlant` (Felder unten), `HeatingPeriodData`, `AssignableHeatingItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents'>`
  - `MeterType = 'kaltwasser' | 'warmwasser' | 'strom' | 'waerme' | 'hkv' | 'sonstig'`, `PropertyKind = 'mfh' | 'etw' | 'efh' | 'zfh' | 'sonstiges'`
  - `Meter.heatingPlantId?: string | null`, `Meter.heatingRole?: HeatingRole | null`, `Meter.remoteReadable?: boolean | null`, `Meter.installedOn?: string | null`; `CostItem.heatingPlantId?: string | null`
  - Schema: `heatingPlants`, `heatingPlantUnits`, `heatingPeriods`; Listen `HEATING_ENERGIES`, `HEATING_SUPPLIES`, `HEATING_METHODS`, `DEVICES_REMOTE`, `DEVICES_INSTALLED_AFTER`, `HEATING_SOURCES`, `CHANGE_SPLITS`, `HEATING_ROLES`, `INSULATION_RULES`, `DHW_METHODS`; Spalten `meters.heatingPlantId`, `heatingRole`, `remoteReadable`, `installedOn`, `costItems.heatingPlantId`

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um `HeatingPeriodData,
HeatingPlant, HeatingPlantUnit` ergänzen. Hinter der Zeile
`type _Payments = Assert<Matches<typeof schema.payments.$inferSelect, Payment>>` einfügen:

```ts
// --- Heizanlage (Heizung PR 4) ---
// Die angeschlossenen Wohnungen stehen in heating_plant_units. Ob es eine Liste gibt, sagt
// `units_limited`, wie `participants_limited` bei den Kostenpositionen (#94): Ohne die Spalte
// sähe eine Anlage, deren letzte Wohnung gelöscht wurde, aus wie eine ohne Liste.
type HeatingPlantColumns = Omit<HeatingPlant, 'units'> & { unitsLimited: boolean }
type _HeatingPlants = Assert<Matches<typeof schema.heatingPlants.$inferSelect, HeatingPlantColumns>>
type _HeatingPlantUnits = Assert<Matches<Omit<typeof schema.heatingPlantUnits.$inferSelect, 'plantId'>, HeatingPlantUnit>>
type _HeatingPeriods = Assert<Matches<typeof schema.heatingPeriods.$inferSelect, HeatingPeriodData>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ in die erwartete Liste hinter
`'flat_rates',` einfügen:

```ts
      'heating_periods',
      'heating_plant_units',
      'heating_plants',
```

Ans Ende anhängen:

```ts
// ---------- Heizanlage (Heizung PR 4) ----------

const eineAnlage = "INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'gas')"

test('Heizanlage: Vorgaben, und die Gemeinschaft rechnet nur wie ein Messdienst ab', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    assert.deepEqual(
      connection.rows('SELECT name, supply, method, devices_remote, devices_installed_after_2021_12, source, change_split, units_limited FROM heating_plants')[0],
      ['', 'central', 'manual', 'unknown', 'unknown', 'building', 'degreeDays', 0],
    )
    assert.ok(
      rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, source, method) VALUES ('hp2', 'objekt-1', 'gas', 'homeowners', 'manual')"),
      'Gemeinschaft mit freien Schlüsseln',
    )
    assert.equal(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, source, method) VALUES ('hp3', 'objekt-1', 'gas', 'homeowners', 'service')"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp4', 'objekt-1', 'kernkraft')"), 'unbekannter Energieträger')
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, period_start_month) VALUES ('hp5', 'objekt-1', 'gas', 13)"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, warm_rent_average_2022_2024) VALUES ('hp6', 'objekt-1', 'gas', -1)"), 'negativer Betrag')
  } finally {
    cleanup()
  }
})

test('Heizanlage: Zähler der Anlage haben eine Rolle und keine Wohnung; Warmwasser und HKV sind Zählertypen', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id, heating_role) VALUES ('m1', 'objekt-1', 'Speicher', 'waerme', 'kWh', 'hp1', 'dhwHeat')"), null)
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id) VALUES ('m2', 'objekt-1', 'Ohne Rolle', 'waerme', 'kWh', 'hp1')"), 'Anlage ohne Rolle')
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_role) VALUES ('m3', 'objekt-1', 'Rolle ohne Anlage', 'waerme', 'kWh', 'supply')"), 'Rolle ohne Anlage')
    assert.ok(
      rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit, heating_plant_id, heating_role) VALUES ('m4', 'objekt-1', 'An Wohnung', 'u1', 'waerme', 'kWh', 'hp1', 'totalHeat')"),
      'Anlagenzähler an einer Wohnung',
    )
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id, heating_role) VALUES ('m5', 'objekt-1', 'X', 'waerme', 'kWh', 'hp1', 'kessel')"), 'unbekannte Rolle')
    assert.equal(
      rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit, remote_readable, installed_on) VALUES ('m6', 'objekt-1', 'HKV Bad', 'u1', 'hkv', 'Einheiten', 0, '2021-12-15')"),
      null,
    )
    assert.equal(rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m7', 'objekt-1', 'Warmwasser Küche', 'u1', 'warmwasser', 'm³')"), null)
    assert.equal(rejects(connection, "INSERT INTO unit_no_connection (unit_id, meter_type) VALUES ('u1', 'warmwasser')"), null)
    assert.equal(rejects(connection, "UPDATE properties SET kind = 'zfh' WHERE id = 'objekt-1'"), null)
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'eine Anlage mit Zähler bleibt stehen')
  } finally {
    cleanup()
  }
})

test('Heizanlage: Wohnungen und Heizperioden fallen mit, eine Kostenposition hält die Anlage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(eineAnlage)
    connection.exec("INSERT INTO heating_plant_units (plant_id, unit_id) VALUES ('hp1', 'u1')")
    assert.ok(rejects(connection, "INSERT INTO heating_plant_units (plant_id, unit_id) VALUES ('hp1', 'u1')"), 'dieselbe Wohnung zweimal')
    assert.ok(rejects(connection, "UPDATE heating_plant_units SET heated_area_m2 = 0"), 'beheizte Fläche 0')
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')")
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h2', 'hp1', '2025-01')"), 'Heizperiode doppelt')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h3', 'hp1', '2025-13')"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period, heat_consumption_pct) VALUES ('h4', 'hp1', '2026-01', 101)"), 'über 100 %')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period, dhw_method) VALUES ('h5', 'hp1', '2027-01', 'schaetzung')"), 'unbekanntes Verfahren')
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    connection.exec("DELETE FROM units WHERE id = 'u1'")
    assert.equal(zahl('heating_plant_units'), 0, 'die Zeile der Wohnung fällt mit')
    connection.exec(
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Gas', 100000, 'area', 'hp1')",
    )
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'die Kostenposition hält die Anlage')
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    connection.exec("DELETE FROM heating_plants WHERE id = 'hp1'")
    assert.equal(zahl('heating_periods'), 0, 'die Heizperioden fallen mit der Anlage')
  } finally {
    cleanup()
  }
})
```

(b) `client/src/meterForm.test.ts` anhängen:

```ts
test('Warmwasser in m³, Heizkostenverteiler in Einheiten (Heizung PR 4)', () => {
  expect(defaultMeterUnit('warmwasser')).toBe('m³')
  expect(defaultMeterUnit('hkv')).toBe('Einheiten')
})
```

(c) `client/src/unitForm.test.ts`, im Block `describe('Anschlüsse einer Einheit', …)` anhängen:

```ts
  test('Warmwasser ist ein eigener Anschluss, Heizkostenverteiler sind keiner (Heizung PR 4)', () => {
    const m = (type: MeterType, unitId: string | null = 'u1') => ({ type, unitId })
    expect(connectionTypes([m('warmwasser'), m('kaltwasser'), m('hkv')], [])).toEqual(['kaltwasser', 'warmwasser'])
    expect(connectionSummary(['warmwasser'])).toBe('ohne Warmwasseranschluss')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'heatingPlants' does not exist` in schema.test.ts und
`Argument of type '"warmwasser"' is not assignable to parameter of type 'MeterType'` in den beiden
Client-Tests.

- [ ] **Step 3: Typen (`shared/types.ts`)**

`Meter` bekommt hinter `unit: string // Maßeinheit, z. B. m³`:

```ts
  // Zähler der Heizanlage selbst (Heizung PR 4): ohne Wohnung, mit seiner Rolle (Versorgungszähler,
  // Wärmezähler am Warmwasserspeicher, Gesamtwärmezähler). Ohne Anlage keine Rolle.
  heatingPlantId?: string | null
  heatingRole?: HeatingRole | null
  // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV, Entwurf 3.13). Fehlt die Angabe, ist
  // sie unbekannt.
  remoteReadable?: boolean | null
  installedOn?: string | null // 'YYYY-MM-DD'
```

`CostItem` bekommt als letztes Feld:

```ts
  // Die Heizanlage, zu der die Position gehört (Heizung PR 4), nur bei der Kostenart „Heizung und
  // Warmwasser“. Fehlt sie bei einer neuen Position, setzt der Server die einzige Anlage des Objekts.
  heatingPlantId?: string | null
```

Ans Dateiende:

```ts
// ---------- Heizanlage (Heizung PR 4, Entwurf 5.3) ----------

// Womit geheizt wird. Pellets und Holz stehen getrennt, weil ihre Heizwerte verschieden sind
// (§ 9 Abs. 3 HeizkostenV, W8); Fernwärme heißt nicht pauschal „fossil“ (R-A28).
export type HeatingEnergy = 'gas' | 'oil' | 'lpg' | 'pellets' | 'wood' | 'districtHeating' | 'heatPump' | 'electric' | 'coal' | 'other'
// `perUnit`: Etagenheizungen mit Vertrag auf den Vermieter (§ 5 Abs. 1 Satz 2 CO2KostAufG); kommt mit PR 9.
export type HeatingSupply = 'central' | 'perUnit'
// Wer die Heizkostenabrechnung erstellt: Messdienst oder Gemeinschaft (`service`), Mietfuchs nach der
// Heizkostenverordnung (`self`, PR 10), niemand, also freie Schlüssel wie bisher (`manual`).
export type HeatingMethod = 'service' | 'self' | 'manual'
// Fernablesbarkeit und Einbau der Geräte als Angabe an der Anlage, wenn Mietfuchs die Zähler nicht
// kennt (G-C2, R-A1).
export type DevicesRemote = 'all' | 'none' | 'partial' | 'unknown'
export type DevicesInstalledAfter = 'all' | 'some' | 'none' | 'unknown'
// `homeowners`: vermietete Eigentumswohnung, die Gemeinschaft liefert die Abrechnung (§ 1 Abs. 2 Nr. 3
// HeizkostenV, D-F2); nur mit `service`.
export type HeatingSource = 'building' | 'homeowners'
// Mieterwechsel: übrige Wärmekosten nach Gradtagen oder zeitanteilig (§ 9b Abs. 2 HeizkostenV). Wirkt
// bei `manual` erst auf Positionen „nur Heizung“ (PR 10, A2).
export type ChangeSplit = 'degreeDays' | 'time'
export type HeatingRole = 'supply' | 'dhwHeat' | 'totalHeat'
export type InsulationRule = 'applies' | 'notApplies' | 'unknown'
export type DhwMethod = 'heatMeter' | 'volumeFormula' | 'areaFormula'

// Eine angeschlossene Wohnung. Die beheizte Fläche (§ 7 Abs. 1 Satz 5) kommt mit PR 10.
export type HeatingPlantUnit = { unitId: string; heatedAreaM2: number | null }

export type HeatingPlant = {
  id: string
  propertyId: string
  name: string
  energy: HeatingEnergy
  supply: HeatingSupply
  method: HeatingMethod
  // Getrennte Heizkostenabrechnung mit eigener Vorauszahlung (3.1, Weg d); kommt mit PR 5.
  separateSettlement: boolean | null
  devicesRemote: DevicesRemote
  devicesInstalledAfter2021: DevicesInstalledAfter
  source: HeatingSource
  // Wärmepumpe (§ 12 Abs. 3 HeizkostenV): Verbrauch am 01.10.2024 schon erfasst? Sonst seit wann.
  captureInstalledOn: string | null
  capturedOnOct2024: boolean | null
  // Durchschnittliche Heizkosten 2022 bis 2024 bei Bruttowarmmiete (§ 12 Abs. 3 Satz 3), in Cent.
  warmRentAverageCents: number | null
  changeSplit: ChangeSplit
  // Eigene Heizperiode (#217); `null` heißt wie das Objekt. Kommt mit PR 5.
  periodStartMonth: number | null
  // `null`: alle Wohnungen des Objekts ohne „kein Anschluss: Wärme“ (#117). Eine Liste, auch eine
  // leere, nennt die angeschlossenen.
  units: HeatingPlantUnit[] | null
}

// Die Angaben einer Heizperiode (Entwurf 5.3, ohne Vorrat). Geschrieben werden sie ab PR 6 (Warmwasser
// laut Messdienst), PR 10 (Verteilung) und PR 14 (§ 6a); PR 4 legt nur die Tabelle an.
export type HeatingPeriodData = {
  id: string
  plantId: string
  period: PeriodKey
  heatConsumptionPct: number | null
  waterConsumptionPct: number | null
  above70Agreed: boolean | null
  insulationRule: InsulationRule | null
  dhwMethod: DhwMethod | null
  dhwHeatKwh: number | null
  totalHeatKwh: number | null
  dhwVolumeM3: number | null
  dhwTempC: number | null
  dhwUnmeasurable: boolean | null
  infoTaxesText: string | null
  infoDistrictGhg: number | null
  infoDistrictPef: number | null
  climateFactor: number | null
  climateFactorPrev: number | null
  consumerContract: string | null
  infoContactsConfirmed: boolean | null
}

// Eine Heizposition, die beim Anlegen der Anlage zugeordnet werden kann (Vorschau, 11.2).
export type AssignableHeatingItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents'>
```

- [ ] **Step 4: Erster Schritt: Tabellen und Spalten (`server/src/db/schema.ts`)**

`MeterType` und `PropertyKind` bleiben in diesem Step unverändert. Den Typimport aus
`'../../../shared/types.ts'` um `ChangeSplit, DevicesInstalledAfter, DevicesRemote, DhwMethod,
HeatingEnergy, HeatingMethod, HeatingRole, HeatingSource, HeatingSupply, InsulationRule, PeriodKey`
ergänzen (`PeriodKey` nur, falls PR 2 ihn hier noch nicht importiert).

Direkt vor der Zeile `// ---------- Kostenpositionen ----------` einfügen:

```ts
// ---------- Heizanlage (Heizung PR 4, Entwurf 5.3) ----------

export const HEATING_ENERGIES = exactly<HeatingEnergy>()(['gas', 'oil', 'lpg', 'pellets', 'wood', 'districtHeating', 'heatPump', 'electric', 'coal', 'other'] as const)
export const HEATING_SUPPLIES = exactly<HeatingSupply>()(['central', 'perUnit'] as const)
export const HEATING_METHODS = exactly<HeatingMethod>()(['service', 'self', 'manual'] as const)
export const DEVICES_REMOTE = exactly<DevicesRemote>()(['all', 'none', 'partial', 'unknown'] as const)
export const DEVICES_INSTALLED_AFTER = exactly<DevicesInstalledAfter>()(['all', 'some', 'none', 'unknown'] as const)
export const HEATING_SOURCES = exactly<HeatingSource>()(['building', 'homeowners'] as const)
export const CHANGE_SPLITS = exactly<ChangeSplit>()(['degreeDays', 'time'] as const)
export const HEATING_ROLES = exactly<HeatingRole>()(['supply', 'dhwHeat', 'totalHeat'] as const)
export const INSULATION_RULES = exactly<InsulationRule>()(['applies', 'notApplies', 'unknown'] as const)
export const DHW_METHODS = exactly<DhwMethod>()(['heatMeter', 'volumeFormula', 'areaFormula'] as const)

// Die Heizanlage eines Objekts. Spalten späterer PRs kommen mit ihnen (CO₂-Merkmale mit PR 7, §§ 5a
// bis 5d mit PR 18, Erfassung und Ausnahmen mit PR 10 und 14); was PR 4 schon anlegt, aber erst
// später rechnet (`separate_settlement`, `period_start_month`), lehnt der Server bis dahin ab.
export const heatingPlants = sqliteTable(
  'heating_plants',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    // Ab der zweiten Anlage Pflicht (PR 9); bis dahin darf er leer sein.
    name: text('name').notNull().default(''),
    energy: text('energy', { enum: HEATING_ENERGIES }).notNull(),
    supply: text('supply', { enum: HEATING_SUPPLIES }).notNull().default('central'),
    method: text('method', { enum: HEATING_METHODS }).notNull().default('manual'),
    separateSettlement: integer('separate_settlement', { mode: 'boolean' }),
    devicesRemote: text('devices_remote', { enum: DEVICES_REMOTE }).notNull().default('unknown'),
    devicesInstalledAfter2021: text('devices_installed_after_2021_12', { enum: DEVICES_INSTALLED_AFTER }).notNull().default('unknown'),
    source: text('source', { enum: HEATING_SOURCES }).notNull().default('building'),
    captureInstalledOn: text('capture_installed_on'),
    capturedOnOct2024: integer('captured_on_2024_10_01', { mode: 'boolean' }),
    warmRentAverageCents: integer('warm_rent_average_2022_2024'),
    changeSplit: text('change_split', { enum: CHANGE_SPLITS }).notNull().default('degreeDays'),
    periodStartMonth: integer('period_start_month'),
    // Ob die Anlage eine Liste der angeschlossenen Wohnungen hat; ohne Liste alle (siehe
    // heating_plant_units). Eigens gespeichert wie `participants_limited` (#94).
    unitsLimited: integer('units_limited', { mode: 'boolean' }).notNull().default(false),
  },
  () => [
    oneOf('heating_plants_energy_known', 'energy', HEATING_ENERGIES),
    oneOf('heating_plants_supply_known', 'supply', HEATING_SUPPLIES),
    oneOf('heating_plants_method_known', 'method', HEATING_METHODS),
    oneOf('heating_plants_devices_remote_known', 'devices_remote', DEVICES_REMOTE),
    oneOf('heating_plants_devices_installed_known', 'devices_installed_after_2021_12', DEVICES_INSTALLED_AFTER),
    oneOf('heating_plants_source_known', 'source', HEATING_SOURCES),
    oneOf('heating_plants_change_split_known', 'change_split', CHANGE_SPLITS),
    check('heating_plants_period_start_month_valid', sql.raw('"period_start_month" BETWEEN 1 AND 12')),
    // Die Gemeinschaft liefert eine fertige Abrechnung; übernommen wird sie wie die eines
    // Messdienstes (Entwurf 8.9, D-F2).
    check('heating_plants_homeowners_by_service', sql.raw(`"source" <> 'homeowners' OR "method" = 'service'`)),
    notNegative('heating_plants_warm_rent_not_negative', 'warm_rent_average_2022_2024'),
  ],
)

// Die angeschlossenen Wohnungen einer Anlage. Eine gelöschte Wohnung fällt heraus; die Anlage
// behält über `units_limited` ihre Liste, auch wenn sie leer wird.
export const heatingPlantUnits = sqliteTable(
  'heating_plant_units',
  {
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    heatedAreaM2: real('heated_area_m2'),
  },
  (t) => [
    primaryKey({ columns: [t.plantId, t.unitId] }),
    check('heating_plant_units_heated_area_positive', sql.raw('"heated_area_m2" > 0')),
  ],
)

// Eine Zeile je Anlage und Heizperiode (Entwurf 5.3), ohne die Spalten des Vorrats (PR 7, 8). In
// PR 4 ist die Heizperiode der Abrechnungszeitraum des Objekts; eine eigene kommt mit PR 5.
export const heatingPeriods = sqliteTable(
  'heating_periods',
  {
    id: text('id').primaryKey().notNull(),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    period: text('period').$type<PeriodKey>().notNull(),
    // Verteilung (§§ 6 Abs. 4, 7, 8, 10 HeizkostenV)
    heatConsumptionPct: real('heat_consumption_pct'),
    waterConsumptionPct: real('water_consumption_pct'),
    above70Agreed: integer('above_70_agreed', { mode: 'boolean' }),
    insulationRule: text('insulation_rule', { enum: INSULATION_RULES }),
    // Warmwasser (§ 9 HeizkostenV)
    dhwMethod: text('dhw_method', { enum: DHW_METHODS }),
    dhwHeatKwh: real('dhw_heat_kwh'),
    totalHeatKwh: real('total_heat_kwh'),
    dhwVolumeM3: real('dhw_volume_m3'),
    dhwTempC: real('dhw_temp_c'),
    dhwUnmeasurable: integer('dhw_unmeasurable', { mode: 'boolean' }),
    // Abrechnungsinformationen (§ 6a Abs. 3 HeizkostenV)
    infoTaxesText: text('info_taxes_text'),
    infoDistrictGhg: real('info_district_ghg'),
    infoDistrictPef: real('info_district_pef'),
    climateFactor: real('climate_factor'),
    climateFactorPrev: real('climate_factor_prev'),
    consumerContract: text('consumer_contract'),
    infoContactsConfirmed: integer('info_contacts_confirmed', { mode: 'boolean' }),
  },
  (t) => [
    uniqueIndex('heating_periods_plant_period_idx').on(t.plantId, t.period),
    // Derselbe Wortlaut wie bei `period` der Kostenpositionen (PR 2, G-C3).
    check('heating_periods_period_valid', sql.raw(`"period" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("period", 6, 2) AS INTEGER) BETWEEN 1 AND 12`)),
    check('heating_periods_heat_pct_valid', sql.raw('"heat_consumption_pct" BETWEEN 0 AND 100')),
    check('heating_periods_water_pct_valid', sql.raw('"water_consumption_pct" BETWEEN 0 AND 100')),
    oneOf('heating_periods_insulation_rule_known', 'insulation_rule', INSULATION_RULES),
    oneOf('heating_periods_dhw_method_known', 'dhw_method', DHW_METHODS),
    notNegative('heating_periods_dhw_heat_not_negative', 'dhw_heat_kwh'),
    notNegative('heating_periods_total_heat_not_negative', 'total_heat_kwh'),
    notNegative('heating_periods_dhw_volume_not_negative', 'dhw_volume_m3'),
  ],
)
```

In `costItems` als letzte Spalte (hinter den Spalten von PR 3):

```ts
    // Die Heizanlage der Position (Heizung PR 4). `RESTRICT`: Eine Anlage mit Positionen wird nicht
    // still gelöscht; `removeHeatingPlant` gibt sie vorher frei.
    heatingPlantId: text('heating_plant_id').references(() => heatingPlants.id, { onDelete: 'restrict' }),
```

In `meters` hinter `unit: text('unit').notNull(),` (die Bedingungen der Tabelle bleiben in diesem
Step, wie sie sind):

```ts
    // Zähler der Heizanlage selbst (Heizung PR 4): ohne Wohnung, mit Rolle. `RESTRICT`: Ohne Anlage
    // wäre er ein Hauptzähler des Hauses und verteilte Verbrauch um (#116).
    heatingPlantId: text('heating_plant_id').references(() => heatingPlants.id, { onDelete: 'restrict' }),
    heatingRole: text('heating_role', { enum: HEATING_ROLES }),
    // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV); null heißt unbekannt.
    remoteReadable: integer('remote_readable', { mode: 'boolean' }),
    installedOn: text('installed_on'),
```

Run: `npm --prefix server run db:generate -- --name heizanlage`

Expected: eine neue Datei `server/drizzle/0018_heizanlage.sql`. Darin genau: je ein `CREATE TABLE` für
`heating_periods`, `heating_plant_units` und `heating_plants`, der eindeutige Index
`heating_periods_plant_period_idx`, ein `ALTER TABLE … ADD` für `cost_items.heating_plant_id` (mit
`REFERENCES heating_plants(id)`) und vier für `meters` (`heating_plant_id`, `heating_role`,
`remote_readable`, `installed_on`). **Kein** `__new_`. Steht ein Neubau darin, ist im Schema eine
Bedingung an einer bestehenden Tabelle mitgekommen: Datei, Journal-Eintrag und Momentaufnahme
löschen, Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach
einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Zweiter Schritt: Zählertypen, Objektart, Bedingungen**

`shared/types.ts`:

```ts
export type MeterType = 'kaltwasser' | 'warmwasser' | 'strom' | 'waerme' | 'hkv' | 'sonstig'
```

```ts
// Die Art eines Objekts (#92): Mehrfamilienhaus, vermietete Eigentumswohnung, Einfamilienhaus,
// Zweifamilienhaus (#180, Heizung PR 4; nur Beschreibung, die Ausnahme des § 2 HeizkostenV hängt an
// den Wohnungen), Sonstiges (etwa ein Garagenhof).
export type PropertyKind = 'mfh' | 'etw' | 'efh' | 'zfh' | 'sonstiges'
```

`server/src/db/schema.ts`:

```ts
export const METER_TYPES = exactly<MeterType>()(['kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig'] as const)
```

```ts
export const PROPERTY_KINDS = exactly<PropertyKind>()(['mfh', 'etw', 'efh', 'zfh', 'sonstiges'] as const)
```

Die Bedingungen von `meters` (das zweite Argument von `sqliteTable('meters', …)`):

```ts
  () => [
    // Der Zählertyp verbindet Zähler und Kostenposition (`cost_items.meter_type`). Ein
    // unbekannter Wert fände keine Zähler und ergäbe eine Position ohne Verteilbasis.
    oneOf('meters_type_known', 'type', METER_TYPES),
    oneOf('meters_heating_role_known', 'heating_role', HEATING_ROLES),
    // Ein Zähler der Anlage hat eine Rolle, und nur er (Heizung PR 4).
    check('meters_heating_role_with_plant', sql.raw('("heating_plant_id" IS NULL) = ("heating_role" IS NULL)')),
    // Ein Zähler der Anlage hängt an keiner Wohnung; die Zähler der Wohnungen gehören zu ihr über
    // die angeschlossenen Wohnungen.
    check('meters_heating_plant_without_unit', sql.raw('"heating_plant_id" IS NULL OR "unit_id" IS NULL')),
  ],
```

Run: `npm --prefix server run db:generate -- --name heizanlage_bedingungen`

Expected: `server/drizzle/0019_heizanlage_bedingungen.sql` mit `PRAGMA foreign_keys=OFF`, je einem
Neubau `__new_properties`, `__new_cost_items`, `__new_meters`, `__new_unit_no_connection` samt
`INSERT INTO … SELECT`, `DROP TABLE`, `RENAME`, und `PRAGMA foreign_keys=ON`. Kein
`ALTER TABLE … ADD`. Der Neubau von `cost_items` und `meters` schreibt
den Fremdschlüssel auf `heating_plants` mit `ON DELETE restrict`.

- [ ] **Step 6: Die neuen Werte beschriften**

`shared/wording.ts`:

```ts
export const METER_TYPE_LABELS: Record<MeterType, string> = {
  kaltwasser: 'Kaltwasser',
  warmwasser: 'Warmwasser',
  strom: 'Strom (Allgemein)',
  waerme: 'Wärme',
  hkv: 'Heizkostenverteiler',
  sonstig: 'Sonstiges',
}
```

`server/src/bookingPlan.ts`:

```ts
const METER_TYPES: Record<MeterType, true> = { kaltwasser: true, warmwasser: true, strom: true, waerme: true, hkv: true, sonstig: true }
```

`client/src/types.ts`:

```ts
export const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  mfh: 'Mehrfamilienhaus',
  zfh: 'Zweifamilienhaus',
  etw: 'Eigentumswohnung',
  efh: 'Einfamilienhaus',
  sonstiges: 'Sonstiges (z. B. Garagen)',
}
```

`client/src/meterForm.ts`:

```ts
const DEFAULT_UNITS: Record<MeterType, string> = { kaltwasser: 'm³', warmwasser: 'm³', waerme: 'kWh', hkv: 'Einheiten', strom: 'kWh', sonstig: '' }
```

`client/src/unitForm.ts`:

```ts
// Heizkostenverteiler sind kein Anschluss: Sie hängen an Heizkörpern, und eine Einheit ohne Heizung
// hat „kein Anschluss: Wärme“.
const CONNECTION_ORDER: MeterType[] = ['kaltwasser', 'warmwasser', 'waerme', 'sonstig', 'strom']
```

```ts
const CONNECTION_WORDS: Record<MeterType, string> = { kaltwasser: 'Wasser', warmwasser: 'Warmwasser', waerme: 'Wärme', hkv: '', strom: 'Strom', sonstig: '' }
```

- [ ] **Step 7: Marken eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('heizanlage')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter `'0017_leistungszeitraum_pruefung'` (PR 3) die
beiden ausgegebenen Zeilen einfügen, darüber der Kommentar:

```ts
  // Heizung PR 4. Wird PR 3 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt und
  // die Marken hier ersetzt.
```

Die beiden Werte sind keine offenen Stellen: Es sind die Prüfsummen der in Step 4 und Step 5
erzeugten Dateien, und erst die Ausgabe des Befehls nennt sie.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-golden.test.ts test/db-objekte.test.ts test/db-changeover.test.ts && npm --prefix client test -- meterForm unitForm && npm run typecheck`
Expected: PASS. `db-golden` und `db-objekte` bleiben grün: Die Kette läuft über eine Datenbank mit
Bestand, und kein Wert ändert sich.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/drizzle shared/wording.ts server/src/bookingPlan.ts client/src/types.ts client/src/meterForm.ts client/src/unitForm.ts server/test/schema.test.ts server/test/migrations.test.ts client/src/meterForm.test.ts client/src/unitForm.test.ts
git commit -m "Heizanlage: Tabellen, Zähler für Warmwasser und Heizkostenverteiler, Zweifamilienhaus

Zwei erzeugte Schritte: erst Tabellen und Spalten, dann die Bedingungen.

Refs #99, #180"
```

---

### Task 3: Die Heizanlage anlegen, ändern und entfernen

**Files:**
- Create: `server/src/db/heating.ts`
- Modify: `server/src/db/repository.ts` (Exporte, `HeatingError`, `removeProperty`), `server/src/db/read.ts`
- Test: `server/test/db-heizanlage.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2): `heatingPlants`, `heatingPlantUnits`, `costItems.heatingPlantId`, die Listen aus schema.ts; `HeatingPlant`, `AssignableHeatingItem`. Aus repository.ts (bisher intern, ab jetzt exportiert): `has`, `raw`, `merged`, `asText`, `asNullableText`, `oneOfOrUndefined`, `sameProperty`.
- Produces:
  - repository.ts: `class HeatingError extends Error { status: 400 | 409 }`, `asNullableFilled(value: unknown): string | null`, `ISO_DATE: RegExp`
  - read.ts: `readHeatingPlants(db: Database): Promise<HeatingPlant[]>`; `Stock.heatingPlants: HeatingPlant[]`; `CostItem.heatingPlantId` beim Lesen
  - heating.ts: `listHeatingPlants(db, propertyId): Promise<HeatingPlant[]>`, `assignableHeatingItems(db, propertyId): Promise<AssignableHeatingItem[]>`, `createHeatingPlant(db, id, propertyId, body): Promise<{ plant: HeatingPlant; assigned: number }>`, `updateHeatingPlant(db, id, body): Promise<HeatingPlant | null>`, `removeHeatingPlant(db, id): Promise<PlantRemoval>`, `type PlantRemoval = { removed: true; released: number } | { removed: false; reason: 'missing' } | { removed: false; reason: 'meters'; meters: string[] }`

- [ ] **Step 1: Write the failing test**

`server/test/db-heizanlage.test.ts`:

```ts
// Die Heizanlage (Heizung PR 4, Entwurf 5.3, 11.2 und 13): anlegen, ändern, entfernen, mit den
// Sperren der späteren PRs und der Zuordnung offener Heizpositionen. An der Verteilung ändert eine
// Anlage in dieser Version nichts; das prüft calc-heizanlage.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { closeSettlement, createEntity, createProperty, findEntity, HeatingError, removeEntity, removeProperty } from '../src/db/repository.ts'
import { assignableHeatingItems, createHeatingPlant, listHeatingPlants, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { meters } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizung-'))

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown =>
  entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined

const wohnung = (db: Database, id: string, propertyId = 'objekt-1') =>
  createEntity(db, 'units', id, { propertyId, name: id, areaM2: 50, participates: true })
const heizposition = (db: Database, id: string, period = '2025-01', extra: Record<string, unknown> = {}) =>
  createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', ...extra })

// Eine Ablehnung mit Status und Satz.
const refused = (status: 400 | 409, text: RegExp) => (err: unknown): boolean =>
  err instanceof HeatingError && err.status === status && text.test(err.message)

test('Anlegen: Vorgaben, und so steht sie in der Liste', async () => {
  await withDatabase(async (opened) => {
    const { plant, assigned } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service', assignItemIds: [] }))
    assert.equal(assigned, 0)
    assert.deepEqual(plant, {
      id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
      devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null,
      capturedOnOct2024: null, warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, units: null,
    })
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [plant])
  })
})

test('Anlegen: ohne Energieträger entsteht nichts', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { method: 'manual' })), refused(400, /Womit wird geheizt/))
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [])
  })
})

test('Sperren: was spätere Versionen rechnen, lehnt der Server mit einem Satz ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => wohnung(db, 'u1'))
    const faelle: [Record<string, unknown>, RegExp][] = [
      [{ method: 'self' }, /eigene Heizkostenabrechnung .* kommt mit einer späteren Version/],
      [{ supply: 'perUnit' }, /Etagenheizungen .* kommen mit einer späteren Version/],
      [{ periodStartMonth: 5 }, /eigene Heizperiode .* kommt mit einer späteren Version/],
      [{ separateSettlement: true }, /getrennte Heizkostenabrechnung .* kommt mit einer späteren Version/],
      [{ units: [{ unitId: 'u1', heatedAreaM2: 60 }] }, /beheizte Fläche .* kommt mit einer späteren Version/],
      [{ source: 'homeowners', method: 'manual' }, /Gemeinschaft/],
      [{ captureInstalledOn: '01.06.2025' }, /kein Datum/],
    ]
    for (const [rumpf, satz] of faelle) {
      await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', ...rumpf })), refused(400, satz), JSON.stringify(rumpf))
    }
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [])
  })
})

test('Zweite Anlage: im selben Objekt gesperrt, in einem anderen Objekt erlaubt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { energy: 'oil' })), refused(400, /zweite Heizanlage/))
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp3', 'objekt-2', { energy: 'oil' }))
    assert.equal(plant.propertyId, 'objekt-2')
  })
})

test('Wohnungen: nur aus dem eigenen Objekt; die letzte gelöscht heißt keine, nicht alle', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await wohnung(db, 'u1')
      await wohnung(db, 'fremd', 'objekt-2')
    })
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', units: [{ unitId: 'fremd', heatedAreaM2: null }] })),
      /Objekt/,
    )
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', units: [{ unitId: 'u1', heatedAreaM2: null }] }))
    assert.deepEqual(plant.units, [{ unitId: 'u1', heatedAreaM2: null }])
    await opened.write((db) => removeEntity(db, 'units', 'u1'))
    const [danach] = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual(danach?.units, [], 'eine leere Liste, nicht null: sonst versorgte die Anlage plötzlich alle Wohnungen')
  })
})

test('Zuordnung: offene Heizpositionen kommen mit dem Anlegen zur Anlage, abgeschlossene nicht', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c-offen')
      await heizposition(db, 'c-zu', '2024-01')
      await createEntity(db, 'costItems', 'c-kalt', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area' })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
    })
    assert.deepEqual(
      await opened.read((db) => assignableHeatingItems(db, 'objekt-1')),
      [{ id: 'c-offen', period: '2025-01', description: 'c-offen', amountCents: 100000 }],
    )
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c-zu'] })),
      refused(409, /geändert/),
    )
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [], 'nichts halb angelegt')
    const { assigned } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c-offen'] }))
    assert.equal(assigned, 1)
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-offen')), 'heatingPlantId'), 'hp1')
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-zu')), 'heatingPlantId'), undefined)
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-kalt')), 'heatingPlantId'), undefined)
  })
})

test('Ändern: verschmilzt, und die Sperren gelten auch hier', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' }))
    const geaendert = await opened.write((db) => updateHeatingPlant(db, 'hp1', { devicesRemote: 'partial', devicesInstalledAfter2021: 'some' }))
    assert.equal(geaendert?.devicesRemote, 'partial')
    assert.equal(geaendert?.devicesInstalledAfter2021, 'some')
    assert.equal(geaendert?.method, 'service', 'was nicht im Rumpf steht, bleibt')
    await assert.rejects(() => opened.write((db) => updateHeatingPlant(db, 'hp1', { method: 'self' })), refused(400, /späteren Version/))
    assert.equal(await opened.write((db) => updateHeatingPlant(db, 'gibt-es-nicht', { name: 'X' })), null)
  })
})

test('Entfernen: gibt die Positionen frei; mit Zählern erst, wenn sie gelöst sind', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c1')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c1'] })
      // Am Repository vorbei, die Merkmale der Zähler kommen erst mit Task 4.
      await db.insert(meters).values({ id: 'gas', propertyId: 'objekt-1', name: 'Gaszähler', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp1', heatingRole: 'supply' })
    })
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'meters', meters: ['Gaszähler'] })
    await opened.write((db) => removeEntity(db, 'meters', 'gas'))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: true, released: 1 })
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c1')), 'heatingPlantId'), undefined)
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'missing' })
  })
})

test('Objekt löschen: eine Heizanlage hält es, wie eine Wohnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp1', 'objekt-2', { energy: 'gas' })
    })
    assert.deepEqual(await opened.write((db) => removeProperty(db, 'objekt-2')), { removed: false, reason: 'inUse', inUse: '1 Heizanlage' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts`
Expected: FAIL mit `Cannot find module '…/src/db/heating.ts'`.

- [ ] **Step 3: Exporte und `HeatingError` (`server/src/db/repository.ts`)**

Vor die Konstanten und Funktionen `has`, `raw`, `asText`, `asNullableText`, `merged`,
`oneOfOrUndefined` und `sameProperty` jeweils `export` setzen; Inhalt unverändert.
Über `const isObject` den Satz ergänzen:

```ts
// Die Helfer hier lesen auch den Rumpf einer Heizanlage (db/heating.ts) und sind deshalb
// exportiert; heating.ts importiert von hier, nie umgekehrt.
```

Hinter `asNullableText`:

```ts
// Wie `asNullableText`, aber ein leeres Feld ist keine Angabe (Kennungen, Daten aus einem Formular).
export const asNullableFilled = (value: unknown): string | null => {
  const text = asNullableText(value)
  return text === '' ? null : text
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
```

Hinter `class PeriodError` (PR 2):

```ts
// Eine Ablehnung rund um die Heizanlage (Heizung PR 4): 400, wenn eine Angabe nicht passt oder eine
// Funktion erst mit einer späteren Version kommt; 409, wenn sich der Bestand inzwischen geändert hat
// oder ein abgeschlossener Zeitraum betroffen ist. Die Meldung ist für den Nutzer geschrieben; die
// Route gibt sie weiter wie `CrossPropertyError`.
export class HeatingError extends Error {
  status: 400 | 409
  constructor(status: 400 | 409, message: string) {
    super(message)
    this.status = status
  }
}
```

`removeProperty`: `heatingPlants` aus `'./schema.ts'` importieren, die Vereinigung im Typ von `zahl`
um `| typeof heatingPlants` ergänzen und in `teile` hinter der Zeile der Kostenpositionen:

```ts
    [await zahl(heatingPlants), 'Heizanlage', 'Heizanlagen'],
```

- [ ] **Step 4: Lesen (`server/src/db/read.ts`)**

`heatingPlants`, `heatingPlantUnits` aus `'./schema.ts'` und `HeatingPlant` als Typ importieren.
In `readCostItems` im Objekt je Position ergänzen:

```ts
    heatingPlantId: orUndefined(c.heatingPlantId),
```

Hinter `readMeters`:

```ts
// Die Heizanlagen (Heizung PR 4). Die Liste der Wohnungen gibt es nur, wenn die Anlage eine hat
// (`units_limited`); sonst versorgt sie alle Wohnungen ihres Objekts.
export async function readHeatingPlants(db: Database): Promise<HeatingPlant[]> {
  const rows = await db.select().from(heatingPlants).orderBy(INSERTION_ORDER)
  const zeilen = await db.select().from(heatingPlantUnits).orderBy(INSERTION_ORDER)
  const byPlant = groupBy(zeilen, (z) => z.plantId, (z) => ({ unitId: z.unitId, heatedAreaM2: z.heatedAreaM2 }))
  return rows.map((p) => ({
    id: p.id,
    propertyId: p.propertyId,
    name: p.name,
    energy: p.energy,
    supply: p.supply,
    method: p.method,
    separateSettlement: p.separateSettlement,
    devicesRemote: p.devicesRemote,
    devicesInstalledAfter2021: p.devicesInstalledAfter2021,
    source: p.source,
    captureInstalledOn: p.captureInstalledOn,
    capturedOnOct2024: p.capturedOnOct2024,
    warmRentAverageCents: p.warmRentAverageCents,
    changeSplit: p.changeSplit,
    periodStartMonth: p.periodStartMonth,
    units: p.unitsLimited ? (byPlant.get(p.id) ?? []) : null,
  }))
}
```

`Stock` bekommt `heatingPlants: HeatingPlant[]`, `readStock` die Zeile
`    heatingPlants: await readHeatingPlants(db),` hinter `meters`.

- [ ] **Step 5: Die Anlage (`server/src/db/heating.ts`)**

```ts
// Die Heizanlage eines Objekts (Heizung PR 4, Entwurf 5.3, 11.2 und 13): anlegen, ändern,
// entfernen, und was davor geprüft wird.
//
// **Was eine Anlage in dieser Version tut:** Sie hält fest, womit geheizt wird, wer abrechnet,
// welche Wohnungen angeschlossen sind und ob die Geräte fernablesbar sind. Gerechnet wird damit nur
// die Fernablesbarkeit (remoteReading.ts); an der Verteilung ändert eine Anlage nichts, denn
// `manual` und `service` verteilen wie bisher (Entwurf 11.2, A2).
//
// **Was später kommt, lehnt der Server mit einem Satz ab** (Entwurf 13, W7): die eigene
// Heizkostenabrechnung (PR 10), Etagenheizungen auf Vertrag des Vermieters und eine zweite Anlage
// (PR 9), eine eigene Heizperiode und die getrennte Abrechnung (PR 5), die beheizte Fläche je
// Wohnung (PR 10). Ihre Spalten stehen schon da, damit diese PRs die Tabelle nicht neu bauen.
//
// **Die angeschlossenen Wohnungen** stehen in `heating_plant_units`. Ob es eine Liste gibt, sagt
// `units_limited`: Ohne Liste versorgt die Anlage alle Wohnungen des Objekts. Eigens gespeichert
// aus demselben Grund wie `participants_limited` bei den Kostenpositionen (#94): Ohne die Spalte
// sähe eine Anlage, deren letzte Wohnung gelöscht wurde, aus wie eine ohne Liste, und sie
// versorgte plötzlich das ganze Haus.
//
// Diese Datei importiert aus repository.ts, nie umgekehrt; die Prüfungen an Kostenpositionen und
// Zählern stehen dort, weil sie zum Verschmelzen dieser Sammlungen gehören.
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import type { AssignableHeatingItem, HeatingPlant, HeatingPlantUnit } from '../../../shared/types.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { periodKey } from '../../../shared/period.ts'
import type { Database, Executor } from './client.ts'
import { readHeatingPlants } from './read.ts'
import { asNullableFilled, asNullableText, asText, HeatingError, ISO_DATE, merged, oneOfOrUndefined, raw, sameProperty } from './repository.ts'
import {
  CHANGE_SPLITS, closedSettlements, costItems, DEVICES_INSTALLED_AFTER, DEVICES_REMOTE, HEATING_ENERGIES, HEATING_METHODS,
  HEATING_SOURCES, HEATING_SUPPLIES, heatingPlants, heatingPlantUnits, meters,
} from './schema.ts'

// Die Sätze der Sperren. Jeder sagt, was bis dahin geht.
const LATER = {
  self: 'Die eigene Heizkostenabrechnung nach der Heizkostenverordnung kommt mit einer späteren Version. Wählen Sie bis dahin „Ein Messdienst oder die Hausverwaltung“ oder „Niemand“; an Ihren Beträgen ändert sich dadurch nichts.',
  perUnit: 'Etagenheizungen mit Vertrag auf den Vermieter kommen mit einer späteren Version. Bis dahin erfassen Sie ihre Kosten wie bisher, etwa direkt bei der Wohnung.',
  second: 'Eine zweite Heizanlage im selben Objekt kommt mit einer späteren Version. Bis dahin gehören alle Heizpositionen zur ersten.',
  ownPeriod: 'Eine eigene Heizperiode neben dem Abrechnungszeitraum des Objekts kommt mit einer späteren Version. Bis dahin gilt für die Heizung der Zeitraum des Objekts.',
  separate: 'Eine getrennte Heizkostenabrechnung mit eigener Vorauszahlung kommt mit einer späteren Version. Bis dahin rechnet Mietfuchs die Heizkosten in der Betriebskostenabrechnung ab.',
  heatedArea: 'Die beheizte Fläche je Wohnung braucht erst die eigene Heizkostenabrechnung; sie kommt mit einer späteren Version.',
}

const nullableBoolean = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Die angeschlossenen Wohnungen aus dem Rumpf: jede einmal, eine beheizte Fläche nur als Zahl. Ein
// Eintrag ohne Kennung fällt weg.
function readPlantUnits(value: unknown): HeatingPlantUnit[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: HeatingPlantUnit[] = []
  for (const row of value) {
    const unitId = asNullableFilled(raw(row, 'unitId'))
    if (unitId === null || seen.has(unitId)) continue
    seen.add(unitId)
    result.push({ unitId, heatedAreaM2: nullableNumber(raw(row, 'heatedAreaM2')) })
  }
  return result
}

// Kennungen aus dem Rumpf, jede einmal.
function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((v) => asNullableText(v)).filter((v): v is string => v !== null && v !== ''))]
}

function mergeHeatingPlant(current: HeatingPlant, body: unknown): HeatingPlant {
  return {
    id: current.id,
    // Eine Anlage wechselt das Objekt nicht; wer umzieht, legt sie im anderen neu an.
    propertyId: current.propertyId,
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    energy: merged(body, 'energy', current.energy, (v) => oneOfOrUndefined(HEATING_ENERGIES, v) ?? current.energy),
    supply: merged(body, 'supply', current.supply, (v) => oneOfOrUndefined(HEATING_SUPPLIES, v) ?? current.supply),
    method: merged(body, 'method', current.method, (v) => oneOfOrUndefined(HEATING_METHODS, v) ?? current.method),
    separateSettlement: merged(body, 'separateSettlement', current.separateSettlement, nullableBoolean),
    devicesRemote: merged(body, 'devicesRemote', current.devicesRemote, (v) => oneOfOrUndefined(DEVICES_REMOTE, v) ?? current.devicesRemote),
    devicesInstalledAfter2021: merged(body, 'devicesInstalledAfter2021', current.devicesInstalledAfter2021, (v) => oneOfOrUndefined(DEVICES_INSTALLED_AFTER, v) ?? current.devicesInstalledAfter2021),
    source: merged(body, 'source', current.source, (v) => oneOfOrUndefined(HEATING_SOURCES, v) ?? current.source),
    captureInstalledOn: merged(body, 'captureInstalledOn', current.captureInstalledOn, asNullableFilled),
    capturedOnOct2024: merged(body, 'capturedOnOct2024', current.capturedOnOct2024, nullableBoolean),
    warmRentAverageCents: merged(body, 'warmRentAverageCents', current.warmRentAverageCents, nullableNumber),
    changeSplit: merged(body, 'changeSplit', current.changeSplit, (v) => oneOfOrUndefined(CHANGE_SPLITS, v) ?? current.changeSplit),
    periodStartMonth: merged(body, 'periodStartMonth', current.periodStartMonth, nullableNumber),
    units: merged(body, 'units', current.units, (v) => (v === null ? null : readPlantUnits(v))),
  }
}

// Der Energieträger hat keine Vorgabe; ohne ihn entsteht keine Anlage (createHeatingPlant).
const emptyHeatingPlant = (id: string, propertyId: string): HeatingPlant => ({
  id, propertyId, name: '', energy: 'other', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null,
  capturedOnOct2024: null, warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, units: null,
})

async function guardHeatingPlant(db: Executor, before: HeatingPlant | null, after: HeatingPlant): Promise<void> {
  if (after.method === 'self') throw new HeatingError(400, LATER.self)
  if (after.supply === 'perUnit') throw new HeatingError(400, LATER.perUnit)
  if (after.periodStartMonth !== null) throw new HeatingError(400, LATER.ownPeriod)
  if (after.separateSettlement !== null) throw new HeatingError(400, LATER.separate)
  if ((after.units ?? []).some((u) => u.heatedAreaM2 !== null)) throw new HeatingError(400, LATER.heatedArea)
  if (after.source === 'homeowners' && after.method !== 'service') {
    throw new HeatingError(400, 'Rechnet die Gemeinschaft der Eigentümer ab, übernehmen Sie ihre Abrechnung wie die eines Messdienstes, als Einzelbeträge. Wählen Sie dafür „Die Gemeinschaft (Hausverwaltung) rechnet ab“.')
  }
  if (after.captureInstalledOn !== null && !ISO_DATE.test(after.captureInstalledOn)) {
    throw new HeatingError(400, 'Das Datum, seit dem der Verbrauch der Wärmepumpe erfasst wird, ist kein Datum. Bitte wählen Sie es im Kalender.')
  }
  if (after.warmRentAverageCents !== null && (!Number.isInteger(after.warmRentAverageCents) || after.warmRentAverageCents < 0)) {
    throw new HeatingError(400, 'Die durchschnittlichen Heizkosten der Jahre 2022 bis 2024 sind ein Betrag ab 0 €.')
  }
  await sameProperty(db, after.propertyId, (after.units ?? []).map((u) => u.unitId), 'Die Heizanlage')
  if (before === null) {
    const [schon] = await db.select({ n: count() }).from(heatingPlants).where(eq(heatingPlants.propertyId, after.propertyId))
    if ((schon?.n ?? 0) > 0) throw new HeatingError(400, LATER.second)
  }
}

const plantRow = (p: HeatingPlant) => ({
  id: p.id, propertyId: p.propertyId, name: p.name, energy: p.energy, supply: p.supply, method: p.method,
  separateSettlement: p.separateSettlement, devicesRemote: p.devicesRemote, devicesInstalledAfter2021: p.devicesInstalledAfter2021,
  source: p.source, captureInstalledOn: p.captureInstalledOn, capturedOnOct2024: p.capturedOnOct2024,
  warmRentAverageCents: p.warmRentAverageCents, changeSplit: p.changeSplit, periodStartMonth: p.periodStartMonth,
  unitsLimited: p.units !== null,
})

// Die Liste der Wohnungen, ganz ersetzt wie die Untertabellen in repository.ts.
async function writePlantUnits(db: Executor, p: HeatingPlant): Promise<void> {
  await db.delete(heatingPlantUnits).where(eq(heatingPlantUnits.plantId, p.id))
  const rows = p.units ?? []
  if (rows.length > 0) await db.insert(heatingPlantUnits).values(rows.map((u) => ({ plantId: p.id, unitId: u.unitId, heatedAreaM2: u.heatedAreaM2 })))
}

export async function listHeatingPlants(db: Database, propertyId: string): Promise<HeatingPlant[]> {
  return (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
}

// Heizpositionen, die beim Anlegen zugeordnet werden können (Entwurf 3.0, 11.2): Kostenart Heizung
// und Warmwasser, noch ohne Anlage, in einem Zeitraum, der nicht abgeschlossen ist. Abgeschlossene
// bekommen keine Anlage, denn der eingefrorene Stand bleibt maßgeblich.
async function assignableIn(db: Executor, propertyId: string): Promise<AssignableHeatingItem[]> {
  const offen = await db
    .select({ id: costItems.id, period: costItems.period, description: costItems.description, amountCents: costItems.amountCents })
    .from(costItems)
    .where(and(eq(costItems.propertyId, propertyId), eq(costItems.category, HEATING_CATEGORY), isNull(costItems.heatingPlantId)))
    .orderBy(costItems.period, costItems.description)
  const zu = new Set(
    (await db.select({ period: closedSettlements.period }).from(closedSettlements).where(eq(closedSettlements.propertyId, propertyId)))
      .map((c) => String(c.period)),
  )
  return offen
    .filter((c) => !zu.has(String(c.period)))
    .map((c) => ({ id: c.id, period: periodKey(String(c.period)), description: c.description, amountCents: c.amountCents }))
}

export const assignableHeatingItems = (db: Database, propertyId: string): Promise<AssignableHeatingItem[]> => assignableIn(db, propertyId)

// Anlegen samt Zuordnung der Positionen aus der Vorschau, in einer Transaktion. Steht in
// `assignItemIds` eine Position, die nicht mehr zuzuordnen ist (inzwischen abgeschlossen,
// gelöscht oder schon zugeordnet), entsteht nichts, und die Vorschau ist neu zu laden.
export async function createHeatingPlant(db: Database, id: string, propertyId: string, body: unknown): Promise<{ plant: HeatingPlant; assigned: number }> {
  if (oneOfOrUndefined(HEATING_ENERGIES, raw(body, 'energy')) === undefined) {
    throw new HeatingError(400, 'Womit wird geheizt? Bitte wählen Sie den Energieträger der Anlage.')
  }
  const plant = mergeHeatingPlant(emptyHeatingPlant(id, propertyId), body)
  const wanted = readIds(raw(body, 'assignItemIds'))
  await db.transaction(async (tx) => {
    await guardHeatingPlant(tx, null, plant)
    await tx.insert(heatingPlants).values(plantRow(plant))
    await writePlantUnits(tx, plant)
    const offen = new Set((await assignableIn(tx, propertyId)).map((c) => c.id))
    if (wanted.some((w) => !offen.has(w))) {
      throw new HeatingError(409, 'Die Heizpositionen haben sich geändert, seit die Vorschau geladen wurde. Bitte öffnen Sie die Einrichtung erneut; angelegt wurde nichts.')
    }
    if (wanted.length > 0) await tx.update(costItems).set({ heatingPlantId: id }).where(inArray(costItems.id, wanted))
  })
  const gespeichert = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!gespeichert) throw new Error('Die Heizanlage ist nach dem Anlegen nicht auffindbar.')
  return { plant: gespeichert, assigned: wanted.length }
}

// `null`, wenn es die Anlage nicht gibt; die Route macht daraus ihre 404.
export async function updateHeatingPlant(db: Database, id: string, body: unknown): Promise<HeatingPlant | null> {
  const current = (await readHeatingPlants(db)).find((p) => p.id === id)
  if (!current) return null
  const next = mergeHeatingPlant(current, body)
  await db.transaction(async (tx) => {
    await guardHeatingPlant(tx, current, next)
    const { id: _id, ...rest } = plantRow(next)
    await tx.update(heatingPlants).set(rest).where(eq(heatingPlants.id, id))
    await writePlantUnits(tx, next)
  })
  return (await readHeatingPlants(db)).find((p) => p.id === id) ?? null
}

export type PlantRemoval = { removed: true; released: number } | { removed: false; reason: 'missing' } | { removed: false; reason: 'meters'; meters: string[] }

// Entfernt wird eine Anlage samt Liste der Wohnungen und Heizperioden (CASCADE). Ihre
// Kostenpositionen bleiben, nur ohne Anlage; an Beträgen und Verteilung ändert das in dieser Version
// nichts. Hängen noch Zähler an ihr, wird nicht entfernt: Ohne Anlage wären sie Hauptzähler des
// Hauses und verteilten Verbrauch um (#116). Was aus ihnen wird, entscheidet der Vermieter.
export async function removeHeatingPlant(db: Database, id: string): Promise<PlantRemoval> {
  const [plant] = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.id, id))
  if (!plant) return { removed: false, reason: 'missing' }
  const zaehler = await db.select({ name: meters.name }).from(meters).where(eq(meters.heatingPlantId, id))
  if (zaehler.length > 0) return { removed: false, reason: 'meters', meters: zaehler.map((z) => z.name) }
  let released = 0
  await db.transaction(async (tx) => {
    const [n] = await tx.select({ n: count() }).from(costItems).where(eq(costItems.heatingPlantId, id))
    released = n?.n ?? 0
    await tx.update(costItems).set({ heatingPlantId: null }).where(eq(costItems.heatingPlantId, id))
    await tx.delete(heatingPlants).where(eq(heatingPlants.id, id))
  })
  return { removed: true, released }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/db-repository.test.ts test/db-stock.test.ts && npm run typecheck`
Expected: PASS (`db-heizanlage.test.ts`: 9 Tests). Prüft ein Test in `db-stock.test.ts` die
Schlüssel von `Stock` wörtlich, dort `'heatingPlants'` hinter `'meters'` ergänzen.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/heating.ts server/src/db/repository.ts server/src/db/read.ts server/test/db-heizanlage.test.ts server/test/db-stock.test.ts
git commit -m "Heizanlage anlegen, ändern und entfernen, mit Zuordnung offener Heizpositionen

Sperren für eigene Abrechnung, Etagenheizung, zweite Anlage, eigene Heizperiode und getrennte
Abrechnung, jeweils mit einem Satz.

Refs #99"
```

---
### Task 4: Kostenpositionen und Zähler an der Anlage

Eine Heizposition gehört zur Anlage ihres Objekts, ein Zähler der Anlage hat eine Rolle und keine
Wohnung, und nach Heizkostenverteilern verteilt Mietfuchs noch nicht selbst. Alles beim Schreiben,
mit einem Satz statt eines Datenbankfehlers.

**Files:**
- Modify: `server/src/db/repository.ts`, `server/src/db/read.ts`
- Test: `server/test/db-heizanlage.test.ts` (ergänzen), `server/test/db-repository.test.ts`

**Interfaces:**
- Consumes (Task 2, 3): `heatingPlants`, `HEATING_ROLES`, `HeatingError`, `asNullableFilled`, `ISO_DATE`, `createHeatingPlant`; aus PR 2 `guardCostItem(db, before, after, body)` und `closedSettlements.period`.
- Produces: `Meter` und `CostItem` mit den neuen Feldern beim Lesen und Schreiben; eine neue Heizposition ohne Feld `heatingPlantId` bekommt die einzige Anlage ihres Objekts (außer im abgeschlossenen Zeitraum).

- [ ] **Step 1: Write the failing tests**

In `server/test/db-heizanlage.test.ts` den Import aus `'../src/db/repository.ts'` um
`CrossPropertyError, updateEntity` ergänzen und anhängen:

```ts
// ---------- Kostenpositionen und Zähler an der Anlage ----------

test('Heizposition: eine neue gehört der einzigen Anlage, auch ohne Feld (alter Tab, Belegbuchung)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    assert.equal(fieldOf(await opened.write((db) => heizposition(db, 'c-neu')), 'heatingPlantId'), 'hp1')
    assert.equal(
      fieldOf(await opened.write((db) => heizposition(db, 'c-ohne', '2025-01', { heatingPlantId: null })), 'heatingPlantId'),
      undefined,
      'ausdrücklich ohne Anlage bleibt ohne',
    )
    assert.equal(
      fieldOf(await opened.write((db) => heizposition(db, 'c-alt', '2024-01')), 'heatingPlantId'),
      undefined,
      'ein abgeschlossener Zeitraum bekommt keine Anlage',
    )
    const kalt = await opened.write((db) => createEntity(db, 'costItems', 'c-kalt', {
      propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area',
    }))
    assert.equal(fieldOf(kalt, 'heatingPlantId'), undefined)
  })
})

test('Heizposition: wechselt die Kostenart, fällt die Anlage weg; beim Ändern wird nicht still zugeordnet', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' }))
    await opened.write((db) => heizposition(db, 'c1'))
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { category: 'Müllabfuhr' })), 'heatingPlantId'), undefined)
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { category: HEATING_CATEGORY })), 'heatingPlantId'), undefined)
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { heatingPlantId: 'hp1' })), 'heatingPlantId'), 'hp1')
  })
})

test('Heizposition: in einem abgeschlossenen Zeitraum keine neue Zuordnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c-zu', '2024-01')
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    await assert.rejects(() => opened.write((db) => updateEntity(db, 'costItems', 'c-zu', { heatingPlantId: 'hp1' })), refused(409, /abgeschlossen/))
  })
})

test('Zähler und Heizposition: die Anlage eines anderen Objekts wird abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp2', 'objekt-2', { energy: 'oil' })
    })
    const fremd = (err: unknown) => err instanceof CrossPropertyError && /Heizanlage aber zu/.test(err.message)
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { heatingPlantId: 'hp2' })), fremd)
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm1', {
      propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp2', heatingRole: 'supply',
    })), fremd)
  })
})

test('Verbrauchsschlüssel nach Heizkostenverteilern: abgelehnt mit Verweis auf die Einzelbeträge', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { key: 'meter', meterType: 'hkv' })), refused(400, /Einzelbeträge/))
  })
})

test('Zähler der Anlage: mit Rolle und ohne Wohnung; jede Abweichung mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await wohnung(db, 'u1')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    const speicher = await opened.write((db) => createEntity(db, 'meters', 'm1', {
      propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
      heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
    }))
    assert.deepEqual(
      ['heatingPlantId', 'heatingRole', 'remoteReadable', 'installedOn'].map((k) => fieldOf(speicher, k)),
      ['hp1', 'dhwHeat', false, '2022-03-01'],
    )
    await assert.rejects(() => opened.write((db) => updateEntity(db, 'meters', 'm1', { unitId: 'u1' })), refused(400, /Wohnung gehört nicht zur Heizanlage/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm2', {
      propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp1',
    })), refused(400, /Was misst der Zähler/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm3', {
      propertyId: 'objekt-1', name: 'Gesamt', unitId: null, type: 'kaltwasser', unit: 'm³', heatingPlantId: 'hp1', heatingRole: 'totalHeat',
    })), refused(400, /Sparte „Wärme“/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm4', {
      propertyId: 'objekt-1', name: 'HKV', unitId: null, type: 'hkv', unit: 'Einheiten',
    })), refused(400, /Heizkörper/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm5', {
      propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten', installedOn: '15.12.2021',
    })), refused(400, /kein Datum/))
    const hkv = await opened.write((db) => createEntity(db, 'meters', 'm6', {
      propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten', remoteReadable: true,
    }))
    assert.equal(fieldOf(hkv, 'remoteReadable'), true)
    assert.equal(fieldOf(hkv, 'heatingPlantId'), undefined)
    const geloest = await opened.write((db) => updateEntity(db, 'meters', 'm1', { heatingPlantId: null }))
    assert.equal(fieldOf(geloest, 'heatingRole'), undefined, 'ohne Anlage keine Rolle')
  })
})
```

In `server/test/db-repository.test.ts`, Test „Die Verschmelzung erreicht jede Spalte“: den Import
aus `'../src/db/heating.ts'` (`createHeatingPlant`) ergänzen. In `proben` steht bei `costItems` seit PR 3 schon
`category: 'Heizung und Warmwasser'` (PR-3-Plan, Task 2 Step 10); dort `heatingPlantId: 'hp1',`
anhängen (die Anlage gibt es nur für diese Kostenart, siehe `mergeCostItem`); den Rumpf der Probe
`meters` ersetzen durch:

```ts
      body: {
        propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', meterNumber: 'ABC', unit: 'kWh',
        heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
      },
```

und im Block „Die Datensätze, auf die die Fremdschlüssel zeigen“ als letzte Zeile ergänzen:

```ts
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/db-repository.test.ts`
Expected: FAIL. Die neue Heizposition hat `heatingPlantId` `undefined` statt `'hp1'`; die Zähler
verlieren ihre neuen Felder; `db-repository.test.ts` meldet „Die Spalte „heatingPlantId" ist beim
Verschmelzen verlorengegangen“.

- [ ] **Step 3: Implement (`server/src/db/repository.ts`)**

Importe ergänzen: `HEATING_CATEGORY` aus `'../../../shared/heating.ts'`; `heatingPlants`,
`HEATING_ROLES` aus `'./schema.ts'`.

`mergeCostItem`: Die Kostenart vor dem `return` lesen und im Objekt verwenden, dazu das neue Feld:

```ts
  const category = merged(body, 'category', current.category, (v) => asText(v, ''))
```

Im Objekt `category: merged(body, 'category', …),` durch `category,` ersetzen und als letztes Feld:

```ts
    // Die Heizanlage der Position (Heizung PR 4). Nur die Kostenart Heizung und Warmwasser gehört zu
    // einer Anlage; wechselt die Kostenart, fällt die Anlage weg. Fehlt das Feld bei einer neuen
    // Position, setzt `insert` die Anlage des Objekts (`defaultHeatingPlant`).
    heatingPlantId: category === HEATING_CATEGORY ? merged(body, 'heatingPlantId', current.heatingPlantId, asNullableFilled) : null,
```

`mergeMeter`, vor dem `return`:

```ts
  const heatingPlantId = merged(body, 'heatingPlantId', current.heatingPlantId ?? null, asNullableFilled)
```

und im Objekt hinter `unit: …`:

```ts
    // Zähler der Heizanlage selbst (Heizung PR 4). Ohne Anlage keine Rolle.
    heatingPlantId,
    heatingRole: heatingPlantId === null ? null : merged(body, 'heatingRole', current.heatingRole ?? null, (v) => oneOfOrUndefined(HEATING_ROLES, v) ?? null),
    // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV); `null` heißt unbekannt.
    remoteReadable: merged(body, 'remoteReadable', current.remoteReadable ?? null, (v) => (typeof v === 'boolean' ? v : null)),
    installedOn: merged(body, 'installedOn', current.installedOn ?? null, asNullableFilled),
```

`costItemRow` bekommt `heatingPlantId: c.heatingPlantId ?? null,`; `meterRow` bekommt
`heatingPlantId: m.heatingPlantId ?? null, heatingRole: m.heatingRole ?? null, remoteReadable: m.remoteReadable ?? null, installedOn: m.installedOn ?? null,`.

Hinter `class HeatingError`:

```ts
const PLANT_GONE = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.'

// Nach Heizkostenverteilern verteilt Mietfuchs erst mit deren Bewertungsfaktoren (PR 12); rohe
// Einheiten verschiedener Heizkörper sind nicht vergleichbar.
const HKV_KEY =
  'Nach Heizkostenverteilern verteilt Mietfuchs noch nicht selbst; dafür braucht es die Bewertungsfaktoren der Geräte, und die kommen mit einer späteren Version. ' +
  'Übernehmen Sie bis dahin die Abrechnung des Messdienstes als Einzelbeträge (Schlüssel „Einzelbeträge“).'

async function plantOf(db: Executor, plantId: string): Promise<{ propertyId: string } | undefined> {
  return (await db.select({ propertyId: heatingPlants.propertyId }).from(heatingPlants).where(eq(heatingPlants.id, plantId)))[0]
}

async function isPeriodClosed(db: Executor, propertyId: string, period: CostItem['period']): Promise<boolean> {
  const rows = await db.select({ id: closedSettlements.id }).from(closedSettlements)
    .where(and(eq(closedSettlements.propertyId, propertyId), eq(closedSettlements.period, period)))
  return rows.length > 0
}

// Die Anlage, die eine neue Heizposition ohne Angabe bekommt: die einzige ihres Objekts, außer ihr
// Zeitraum ist abgeschlossen (dort bleibt der eingefrorene Stand maßgeblich, Entwurf 3.0). So gehört
// auch eine Position, die ein Tab von vor dem Update oder die Belegbuchung anlegt, zur Anlage, und ab
// PR 5 steht sie im Topf ihrer Heizperiode. Bei mehreren Anlagen (PR 9) entscheidet der Vermieter.
async function defaultHeatingPlant(db: Executor, c: CostItem): Promise<string | null> {
  if (c.category !== HEATING_CATEGORY) return null
  const [einzige, ...weitere] = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.propertyId, c.propertyId))
  if (!einzige || weitere.length > 0) return null
  return (await isPeriodClosed(db, c.propertyId, c.period)) ? null : einzige.id
}

// Eine Heizposition an der Anlage (Heizung PR 4): dieselbe Objektgrenze wie bei den Wohnungen, und in
// einem abgeschlossenen Zeitraum keine neue Zuordnung.
async function guardCostItemHeating(db: Executor, before: CostItem | null, after: CostItem): Promise<void> {
  if (after.key === 'meter' && after.meterType === 'hkv') throw new HeatingError(400, HKV_KEY)
  const plantId = after.heatingPlantId
  if (!plantId) return
  const plant = await plantOf(db, plantId)
  if (!plant) throw new HeatingError(400, PLANT_GONE)
  if (plant.propertyId !== after.propertyId) {
    throw new CrossPropertyError(
      `Die Kostenposition gehört zu Objekt ${await propertyName(db, after.propertyId)}, die Heizanlage aber zu ` +
        `${await propertyName(db, plant.propertyId)}. Eine Heizposition gehört zur Heizanlage ihres eigenen Objekts.`,
    )
  }
  if ((before?.heatingPlantId ?? null) !== plantId && (await isPeriodClosed(db, after.propertyId, after.period))) {
    throw new HeatingError(409,
      'Die Abrechnung dieses Zeitraums ist abgeschlossen; ihre Positionen bekommen keine Heizanlage mehr, denn der eingefrorene Stand bleibt maßgeblich. ' +
        'Öffnen Sie die Abrechnung wieder, wenn Sie die Position zuordnen wollen.')
  }
}
```

`guardCostItem` (Fassung von PR 2) bekommt als letzte Zeile:

```ts
  await guardCostItemHeating(db, before, after)
```

`guardMeter` ersetzen durch:

```ts
async function guardMeter(db: Executor, _before: Meter | null, after: Meter): Promise<void> {
  await sameProperty(db, after.propertyId, after.unitId ? [after.unitId] : [], 'Der Zähler')
  if (after.type === 'hkv' && !after.unitId) {
    throw new HeatingError(400, 'Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung. Bitte wählen Sie bei der Zuordnung die Wohnung.')
  }
  if (after.installedOn && !ISO_DATE.test(after.installedOn)) {
    throw new HeatingError(400, 'Das Einbaudatum ist kein Datum. Bitte wählen Sie es im Kalender oder lassen Sie das Feld leer.')
  }
  const plantId = after.heatingPlantId
  if (!plantId) return
  // Ein Zähler der Anlage hängt an keiner Wohnung; sonst lehnte die Prüfbedingung ab, ohne Satz.
  if (after.unitId) {
    throw new HeatingError(400,
      'Ein Zähler an einer Wohnung gehört nicht zur Heizanlage selbst. Zur Anlage gehören nur Zähler ohne Wohnung, etwa der Gaszähler oder ein Wärmezähler am Warmwasserspeicher. ' +
        'Wählen Sie „Haus (Hauptzähler)“ oder nehmen Sie den Zähler aus der Anlage.')
  }
  const plant = await plantOf(db, plantId)
  if (!plant) throw new HeatingError(400, PLANT_GONE)
  if (plant.propertyId !== after.propertyId) {
    throw new CrossPropertyError(
      `Der Zähler gehört zu Objekt ${await propertyName(db, after.propertyId)}, die Heizanlage aber zu ` +
        `${await propertyName(db, plant.propertyId)}. Ein Zähler gehört zur Heizanlage seines eigenen Objekts.`,
    )
  }
  if (!after.heatingRole) {
    throw new HeatingError(400, 'Was misst der Zähler an der Heizanlage? Bitte wählen Sie Versorgungszähler, Wärmezähler Warmwasser oder Gesamtwärmezähler.')
  }
  if (after.heatingRole !== 'supply' && after.type !== 'waerme') {
    throw new HeatingError(400, 'Ein Wärmezähler an der Heizanlage hat die Sparte „Wärme“.')
  }
}
```

`costItemCollection.insert` ersetzen durch:

```ts
  insert: async (db, c) => {
    // Eine neue Heizposition ohne Angabe gehört zur Anlage ihres Objekts (Heizung PR 4). `undefined`
    // heißt „nicht angegeben“, `null` „ausdrücklich ohne“; nur das Erste wird ergänzt.
    const entity = c.heatingPlantId === undefined ? { ...c, heatingPlantId: await defaultHeatingPlant(db, c) } : c
    await db.insert(costItems).values(costItemRow(entity))
    await writeCostItemShares(db, entity)
  },
```

- [ ] **Step 4: Lesen (`server/src/db/read.ts`)**

In `readMeters` im Objekt je Zähler hinter `unit: m.unit,`:

```ts
    heatingPlantId: orUndefined(m.heatingPlantId),
    heatingRole: orUndefined(m.heatingRole),
    remoteReadable: orUndefined(m.remoteReadable),
    installedOn: orUndefined(m.installedOn),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizanlage.test.ts test/db-repository.test.ts test/booking.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS (`db-heizanlage.test.ts`: 15 Tests). `booking.test.ts` bleibt grün: Ohne Anlage ist
`defaultHeatingPlant` `null`, und die Belegbuchung schreibt wie bisher.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/repository.ts server/src/db/read.ts server/test/db-heizanlage.test.ts server/test/db-repository.test.ts
git commit -m "Heizanlage: Heizpositionen und Zähler gehören zur Anlage ihres Objekts

Neue Heizpositionen bekommen die einzige Anlage des Objekts, außer im abgeschlossenen Zeitraum.
Verbrauchsschlüssel nach Heizkostenverteilern wird mit Verweis auf die Einzelbeträge abgelehnt.

Refs #99, #214"
```

---

### Task 5: Wiederherstellen prüft die Heizanlagen

Was über die Routen nicht entsteht, kann in einem Archiv stehen (von Hand bearbeitet, oder aus
einer späteren Version, die keinen eigenen Schritt brauchte): Verweise auf die Anlage eines anderen
Objekts, Anlagen, die dieselben Wohnungen versorgen (Entwurf 5.3, 5.9), und Heizperioden, die es für
das Objekt nicht gibt.

**Files:**
- Modify: `server/src/db/heating.ts`, `server/src/db/backup.ts`
- Test: `server/test/db-backup.test.ts`

**Interfaces:**
- Consumes (Task 2, 3): Tabellen, `readHeatingPlants`; aus PR 2 `readProperties` mit `periodRules`, `rulesOf`, `parsePeriodKey`, `periodOfKey`.
- Produces: `heatingPlantViolations(db: Database): Promise<string[]>` (heating.ts), aufgerufen in `archiveDatabaseProblem` (backup.ts).

- [ ] **Step 1: Write the failing tests**

In `server/test/db-backup.test.ts` Importe ergänzen: `openDatabase` aus `'../src/db/open.ts'` (falls
noch nicht da), `createEntity, createProperty` aus `'../src/db/repository.ts'`,
`createHeatingPlant` aus `'../src/db/heating.ts'`, `costItems, heatingPeriods, heatingPlants` aus
`'../src/db/schema.ts'`, `HEATING_CATEGORY` aus `'../../shared/heating.ts'`, `periodKey` aus
`'../../shared/period.ts'`, `Database` als Typ aus `'../src/db/client.ts'`. Anhängen:

```ts
// ---------- Heizanlage (Heizung PR 4) ----------

async function withHeatingDatabase(fill: (db: Database) => Promise<void>): Promise<string | null> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(fill)
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    return await archiveDatabaseProblem(ziel)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Eine Datenbank mit einer Heizanlage samt zugeordneter Position wird nicht beanstandet', async () => {
  const befund = await withHeatingDatabase(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
    await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 100000, key: 'area' })
    await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', units: [{ unitId: 'u1', heatedAreaM2: null }], assignItemIds: ['c1'] })
    await db.insert(heatingPeriods).values({ id: 'h1', plantId: 'hp1', period: periodKey('2025-01') })
  })
  assert.equal(befund, null)
})

test('Heizanlagen über die Objektgrenze, überlappend oder mit fremder Heizperiode werden beanstandet', async () => {
  const befund = await withHeatingDatabase(async (db) => {
    await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
    await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    await createHeatingPlant(db, 'hp2', 'objekt-2', { energy: 'oil' })
    // Am Server vorbei, wie in einem von Hand bearbeiteten Archiv.
    await db.insert(costItems).values({
      id: 'c1', propertyId: 'objekt-1', period: periodKey('2025-01'), category: HEATING_CATEGORY, description: 'Gas', amountCents: 100000, key: 'area', heatingPlantId: 'hp2',
    })
    await db.insert(heatingPlants).values({ id: 'hp3', propertyId: 'objekt-1', energy: 'gas' })
  })
  assert.ok(befund, 'es gibt eine Beanstandung')
  assert.match(befund, /Angaben zur Heizanlage/)
  assert.match(befund, /Kostenposition „Gas“ gehört zur Heizanlage eines anderen Objekts/)
  assert.match(befund, /mehrere Heizanlagen/)
})

test('Eine Heizperiode, die es für das Objekt nicht gibt, wird beanstandet', async () => {
  const befund = await withHeatingDatabase(async (db) => {
    await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Keller', energy: 'gas' })
    // Beim Kalenderobjekt gibt es keinen Zeitraum, der im Mai beginnt.
    await db.insert(heatingPeriods).values({ id: 'h1', plantId: 'hp1', period: periodKey('2025-05') })
  })
  assert.ok(befund)
  assert.match(befund, /Heizanlage „Keller“ hat Angaben zur Heizperiode 2025-05/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-backup.test.ts`
Expected: FAIL. Der erste neue Test ist grün; die beiden anderen bekommen `null` statt einer
Beanstandung (`assert.ok(befund)` schlägt fehl).

- [ ] **Step 3: Implement**

`server/src/db/heating.ts`: Importe ergänzen: `ne` aus `'drizzle-orm'`; `parsePeriodKey`,
`periodOfKey`, `rulesOf` aus `'../../../shared/period.ts'`; `readProperties` aus `'./read.ts'`;
`heatingPeriods`, `units` aus `'./schema.ts'`. Ans Ende:

```ts
const plantName = (name: string): string => (name ? `„${name}“` : 'ohne Namen')

// Befunde an den Heizanlagen im ganzen Bestand, als lesbare Sätze (Entwurf 5.3, 5.9). Leer heißt in
// Ordnung. Über die Routen entsteht keiner davon; in einem Archiv kann einer stehen. Dieselbe Haltung
// wie `crossPropertyViolations` in repository.ts.
export async function heatingPlantViolations(db: Database): Promise<string[]> {
  const befunde: string[] = []
  const wohnungen = await db
    .select({ plant: heatingPlants.name, unit: units.name })
    .from(heatingPlantUnits)
    .innerJoin(heatingPlants, eq(heatingPlantUnits.plantId, heatingPlants.id))
    .innerJoin(units, eq(heatingPlantUnits.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const w of wohnungen) befunde.push(`Die Heizanlage ${plantName(w.plant)} versorgt die Wohnung „${w.unit}“ eines anderen Objekts.`)
  const posten = await db
    .select({ description: costItems.description })
    .from(costItems)
    .innerJoin(heatingPlants, eq(costItems.heatingPlantId, heatingPlants.id))
    .where(ne(costItems.propertyId, heatingPlants.propertyId))
  for (const c of posten) befunde.push(`Die Kostenposition „${c.description}“ gehört zur Heizanlage eines anderen Objekts.`)
  const zaehler = await db
    .select({ name: meters.name })
    .from(meters)
    .innerJoin(heatingPlants, eq(meters.heatingPlantId, heatingPlants.id))
    .where(ne(meters.propertyId, heatingPlants.propertyId))
  for (const z of zaehler) befunde.push(`Der Zähler „${z.name}“ gehört zur Heizanlage eines anderen Objekts.`)

  // Überlappende Anlagen: Ab zwei Anlagen in einem Objekt braucht jede ihre Liste, und keine Wohnung
  // hängt an zweien. Sonst verteilten zwei Anlagen dieselben Kosten auf dieselben Mieter.
  const anlagen = await readHeatingPlants(db)
  const unitNames = new Map((await db.select({ id: units.id, name: units.name }).from(units)).map((u) => [u.id, u.name]))
  for (const propertyId of new Set(anlagen.map((p) => p.propertyId))) {
    const imObjekt = anlagen.filter((p) => p.propertyId === propertyId)
    if (imObjekt.length < 2) continue
    for (const p of imObjekt.filter((x) => x.units === null)) {
      befunde.push(`Im Objekt stehen mehrere Heizanlagen, und die Heizanlage ${plantName(p.name)} hat keine Liste der Wohnungen; dann versorgten zwei Anlagen dieselben Wohnungen.`)
    }
    const gesehen = new Set<string>()
    for (const unitId of imObjekt.flatMap((p) => (p.units ?? []).map((u) => u.unitId))) {
      if (gesehen.has(unitId)) befunde.push(`Die Wohnung „${unitNames.get(unitId) ?? unitId}“ hängt an mehreren Heizanlagen.`)
      gesehen.add(unitId)
    }
  }

  // Heizperioden: In dieser Version ist jede Heizperiode ein Abrechnungszeitraum des Objekts (eine
  // eigene kommt mit PR 5).
  const rulesById = new Map((await readProperties(db)).map((p) => [p.id, rulesOf(p)]))
  const perioden = await db
    .select({ period: heatingPeriods.period, propertyId: heatingPlants.propertyId, name: heatingPlants.name })
    .from(heatingPeriods)
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
  for (const h of perioden) {
    const rules = rulesById.get(h.propertyId)
    const key = parsePeriodKey(h.period)
    if (!rules || key === null || periodOfKey(rules, key) === null) {
      befunde.push(`Die Heizanlage ${plantName(h.name)} hat Angaben zur Heizperiode ${h.period}, die es für ihr Objekt nicht gibt.`)
    }
  }
  return befunde
}
```

`server/src/db/backup.ts`: `import { heatingPlantViolations } from './heating.ts'` und hinter dem
Block `if (kreuz.length > 0) { … }` (und hinter dem Block von PR 2 zu `orphanPeriodKeys`):

```ts
    // Die Heizanlagen (Heizung PR 4): Verweise über Objektgrenzen, überlappende Anlagen und
    // Heizperioden ohne Zeitraum. Dieselbe Haltung wie bei den Verweisen darüber.
    const heizung = await heatingPlantViolations(connection.db)
    if (heizung.length > 0) {
      return (
        `Die Datenbank in diesem Archiv enthält Angaben zur Heizanlage, die in keiner Abrechnung ` +
        `aufgingen, deshalb wurde nichts davon übernommen. Ihre bisherigen Daten sind unverändert. ` +
        `${heizung.slice(0, 3).join(' ')}`
      )
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-backup.test.ts test/db-heizanlage.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/heating.ts server/src/db/backup.ts server/test/db-backup.test.ts
git commit -m "Wiederherstellen: Heizanlagen über Objektgrenzen, überlappend oder mit fremder Heizperiode ablehnen

Refs #99"
```

---

### Task 6: Routen der Heizanlage

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes (Task 3): `listHeatingPlants`, `assignableHeatingItems`, `createHeatingPlant`, `updateHeatingPlant`, `removeHeatingPlant`, `HeatingError`; `propertyOf(db, req, fromBody?)`, `readData`, `writeData`, `bodyObject`, `newId` in index.ts.
- Produces:
  - `GET /api/heating-plants?property=` → `HeatingPlant[]`
  - `GET /api/heating-plants/assignable?property=` → `AssignableHeatingItem[]`
  - `POST /api/heating-plants?property=` (Rumpf: Felder der Anlage und `assignItemIds: string[]`) → 201 `{ plant: HeatingPlant; assigned: number }`
  - `PUT /api/heating-plants/:id` → `HeatingPlant` (404 ohne Anlage)
  - `DELETE /api/heating-plants/:id` → `{ ok: true; released: number }`, 404, oder 409 mit den Namen der Zähler

- [ ] **Step 1: Write the failing tests**

In `server/test/api.test.ts` den Typimport aus `'../../shared/types.ts'` um `AssignableHeatingItem,
CostItem, HeatingPlant, Property, Settlement` ergänzen (soweit nicht vorhanden) und anhängen:

```ts
// ---------- Heizanlage (Heizung PR 4) ----------

const postJson = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

test('Heizanlage: anlegen samt Zuordnung offener Heizpositionen, und die Abrechnung bleibt gleich', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', postJson({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', postJson({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 2 }], start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
    }))
    const heizung = await s.api<CostItem>('/api/costItems', postJson({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 120000, key: 'area' }))
    const vorher = await s.api<Settlement>('/api/settlement/2025-01')
    assert.deepEqual((await s.api<AssignableHeatingItem[]>('/api/heating-plants/assignable')).map((i) => i.id), [heizung.id])
    const res = await fetch(`${s.base}/api/heating-plants`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ energy: 'gas', method: 'service', assignItemIds: [heizung.id] }),
    })
    assert.equal(res.status, 201)
    const { plant, assigned } = await jsonOf<{ plant: HeatingPlant; assigned: number }>(res)
    assert.equal(assigned, 1)
    assert.deepEqual(await s.api<HeatingPlant[]>('/api/heating-plants'), [plant])
    const [gespeichert] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(gespeichert?.heatingPlantId, plant.id)
    // Entwurf 11.2: Das Anlegen ändert keine Zahl und keinen Hinweis.
    assert.deepEqual(await s.api<Settlement>('/api/settlement/2025-01'), vorher)
  } finally {
    s.stop()
  }
})

test('Heizanlage: Sperren, Objektgrenze, Ändern und Entfernen über die Routen', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const selbst = await send('/api/heating-plants', postJson({ energy: 'gas', method: 'self' }))
    assert.equal(selbst.status, 400)
    assert.match(await errorFrom(selbst), /eigene Heizkostenabrechnung/)
    const angelegt = await send('/api/heating-plants', postJson({ energy: 'districtHeating', method: 'manual' }))
    assert.equal(angelegt.status, 201)
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(angelegt)
    const zweite = await send('/api/heating-plants', postJson({ energy: 'gas' }))
    assert.equal(zweite.status, 400)
    assert.match(await errorFrom(zweite), /zweite Heizanlage/)

    const objekt2 = await s.api<Property>('/api/properties', postJson({ name: 'Zweites Haus', kind: 'mfh', address: '' }))
    const fremd = await send(`/api/meters?property=${objekt2.id}`, postJson({ name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: plant.id, heatingRole: 'supply' }))
    assert.equal(fremd.status, 400)
    assert.match(await errorFrom(fremd), /Heizanlage aber zu/)

    const geaendert = await send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ devicesRemote: 'all' }) })
    assert.equal(geaendert.status, 200)
    assert.equal((await jsonOf<HeatingPlant>(geaendert)).devicesRemote, 'all')
    assert.equal((await send('/api/heating-plants/gibt-es-nicht', { method: 'PUT', body: '{}' })).status, 404)

    const zaehler = await send(`/api/meters?property=${plant.propertyId}`, postJson({ name: 'Fernwärme', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: plant.id, heatingRole: 'supply' }))
    assert.equal(zaehler.status, 201)
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /„Fernwärme“/)
    await send(`/api/meters/${(await jsonOf<Meter>(zaehler)).id}`, { method: 'DELETE' })
    const weg = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(weg.status, 200)
    assert.deepEqual(await jsonOf<{ ok: boolean; released: number }>(weg), { ok: true, released: 0 })
    assert.equal((await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })).status, 404)
  } finally {
    s.stop()
  }
})
```

`Meter` und `Unit` stehen schon im Typimport von api.test.ts; sonst ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- --test-name-pattern "Heizanlage" test/api.test.ts`
Expected: FAIL. `GET /api/heating-plants/assignable → 404` (die Route gibt es nicht).

- [ ] **Step 3: Implement (`server/src/index.ts`)**

Importe: aus `'./db/repository.ts'` zusätzlich `HeatingError`; neu
`import { assignableHeatingItems, createHeatingPlant, listHeatingPlants, removeHeatingPlant, updateHeatingPlant } from './db/heating.ts'`.

Hinter dem Block `// ---------- Objekte (#92) ----------` (nach `app.delete('/api/properties/:id', …)`):

```ts
// ---------- Heizanlage (Heizung PR 4) ----------
// Was eine Anlage ist und was sie in dieser Version tut, steht in db/heating.ts. Das Objekt kommt
// wie bei den übrigen Datenrouten aus `?property=` (beim Anlegen auch aus dem Rumpf); bei genau
// einem Objekt gilt dieses.

app.get('/api/heating-plants', async (req, res) => {
  res.json(await readData(async (db) => listHeatingPlants(db, await propertyOf(db, req))))
})
// Die Vorschau der Einrichtung: welche Heizpositionen beim Anlegen zur Anlage kommen.
app.get('/api/heating-plants/assignable', async (req, res) => {
  res.json(await readData(async (db) => assignableHeatingItems(db, await propertyOf(db, req))))
})
app.post('/api/heating-plants', async (req, res) => {
  res.status(201).json(await writeData(async (db) => createHeatingPlant(db, newId(), await propertyOf(db, req, true), bodyObject(req))))
})
app.put('/api/heating-plants/:id', async (req, res) => {
  const plant = await writeData((db) => updateHeatingPlant(db, req.params.id, bodyObject(req)))
  if (!plant) return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.json(plant)
})
app.delete('/api/heating-plants/:id', async (req, res) => {
  const result = await writeData((db) => removeHeatingPlant(db, req.params.id))
  if (result.removed) return res.json({ ok: true, released: result.released })
  if (result.reason === 'missing') return res.status(404).json({ error: 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.' })
  res.status(409).json({
    error: `An der Heizanlage hängen noch Zähler (${result.meters.map((n) => `„${n}“`).join(', ')}). Ordnen Sie sie auf der Seite ` +
      'Zähler neu zu oder löschen Sie sie; dann lässt sich die Anlage entfernen.',
  })
})
```

In der Fehlerbehandlung die Zeile der für den Nutzer geschriebenen Ablehnungen um
`|| err instanceof HeatingError` ergänzen (neben `CrossPropertyError` und `PeriodError` aus PR 2).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/api.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/index.ts server/test/api.test.ts
git commit -m "Routen der Heizanlage: anlegen mit Vorschau, ändern, entfernen

Refs #99"
```

---
### Task 7: Berechnung: Anlagen im Schnappschuss, Anlagenzähler, Wasserschlüssel

Der Schnappschuss trägt die Anlagen des Objekts und die neuen Angaben der Zähler. Die Berechnung
ändert genau zwei Dinge, beide nur mit Daten, die es vor PR 4 nicht gab: Ein Zähler der Anlage ist
kein Hauptzähler des Hauses (sonst machte ein Wärmezähler am Speicher aus jeder Wohnung ohne
Wärmezähler einen Rest nach #116), und beim Kaltwasser zählen die Warmwasserzähler der Wohnungen
mit, während nur ein Kaltwasserzähler sagt, ob eine Wohnung gemessen ist (Entwurf 5.3, G-B8).

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`
- Test: `server/test/calc-heizanlage.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2, 3): `HeatingPlant`, `Meter` mit den neuen Feldern, `Stock.heatingPlants`; aus PR 2 `snapshotOf(source, year)`, `snapshotFor(source, propertyId, period)`, `calendarPeriod`.
- Produces:
  - `SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'> & Partial<Pick<Meter, 'name'>>`
  - `SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>`
  - `Snapshot.heatingPlants?: SnapshotHeatingPlant[]`; `snapshotFor` füllt sie aus `source.heatingPlants` des Objekts

- [ ] **Step 1: Write the failing test**

`server/test/calc-heizanlage.test.ts`:

```ts
// Die Heizanlage in der Berechnung (Heizung PR 4). Eine Anlage ändert in dieser Version keine Zahl
// (Entwurf 11.2, A2); neu gerechnet werden nur zwei Dinge, und beide greifen erst mit Angaben, die
// es vorher nicht gab: Zähler der Anlage sind keine Hauptzähler des Hauses, und Warmwasserzähler
// zählen beim Kaltwasser mit (G-B8). Weiter unten: Fernablesbarkeit (#214) und Zweifamilienhaus (#180).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import {
  snapshotOf, type SnapshotCostItem, type SnapshotHeatingPlant, type SnapshotMeter, type SnapshotReading, type SnapshotSource,
  type SnapshotTenancy, type SnapshotUnit,
} from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarPeriod } from '../../shared/period.ts'

const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const item = (id: string, year: number, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, period: calendarPeriod(year), category: 'Wasserversorgung', description: id, amountCents: 200000, key: 'area', ...over,
})
const meter = (id: string, unitId: string | null, type: SnapshotMeter['type'], over: Partial<SnapshotMeter> = {}): SnapshotMeter => ({ id, unitId, type, ...over })
// Ein Zähler über das ganze Jahr: Stand am 31.12. des Vorjahres und am 31.12.
const wholeYear = (meterId: string, y: number, from: number, to: number): SnapshotReading[] => [
  { meterId, date: `${y - 1}-12-31`, value: from },
  { meterId, date: `${y}-12-31`, value: to },
]
const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const settle = (s: Partial<SnapshotSource>, y = 2025, plants?: SnapshotHeatingPlant[]): ComputedSettlement =>
  computeSettlement({ ...snapshotOf(source(s), y), ...(plants === undefined ? {} : { heatingPlants: plants }) })
const share = (r: ComputedSettlement, tenancyId: string, itemId: string): number | undefined =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents
const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant => ({
  id: 'hp1', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over,
})

// ---------- Wasserschlüssel (G-B8) ----------

test('Wasser (G-B8): Warmwasserzähler zählen beim Kaltwasser mit; nur mit Warmwasserzähler gilt der Hauptzähler', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('haus', null, 'kaltwasser'), meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('haus', 2025, 0, 200), ...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' })],
  })
  // b hat keinen Kaltwasserzähler, also ist der Hauptzähler die Basis (200 m³): a trägt 80 m³ (kalt
  // und warm), b seine 30 m³ Warmwasser, die übrigen 90 m³ bleiben beim Vermieter (#116). Vorher
  // trug a nur seine 60 m³ Kaltwasser, und die 20 m³ Warmwasser landeten beim Vermieter.
  assert.equal(share(r, 'ta', 'wasser'), 80000)
  assert.equal(share(r, 'tb', 'wasser'), 30000)
  assert.ok(r.notices.some((n) => n.code === 'meter.unit-without-meter' && n.text.includes('für b gibt es keinen abgelesenen Zähler „Kaltwasser“')))
})

test('Wasser (G-B8): ohne Hauptzähler ist die Basis kalt und warm zusammen; der Schlüssel Warmwasser nur warm', () => {
  const r = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-kalt', 'a', 'kaltwasser'), meter('a-warm', 'a', 'warmwasser'), meter('b-kalt', 'b', 'kaltwasser'), meter('b-warm', 'b', 'warmwasser')],
    readings: [...wholeYear('a-kalt', 2025, 0, 60), ...wholeYear('a-warm', 2025, 0, 20), ...wholeYear('b-kalt', 2025, 0, 30), ...wholeYear('b-warm', 2025, 0, 30)],
    costItems: [
      item('wasser', 2025, { key: 'meter', meterType: 'kaltwasser' }),
      item('warm', 2025, { amountCents: 60000, key: 'meter', meterType: 'warmwasser' }),
    ],
  })
  // 80 und 60 von 140 m³: 114.285,71 und 85.714,29 Cent, der Restcent geht an den größeren Rest.
  // Vorher 60 und 30 von 90 m³: 133.333 und 66.667 Cent.
  assert.equal(share(r, 'ta', 'wasser'), 114286)
  assert.equal(share(r, 'tb', 'wasser'), 85714)
  assert.equal(share(r, 'ta', 'warm'), 24000)
  assert.equal(share(r, 'tb', 'warm'), 36000)
})

// ---------- Zähler der Anlage ----------

test('Ein Zähler der Heizanlage ist kein Hauptzähler des Hauses', () => {
  const ohne: Partial<SnapshotSource> = {
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
    meters: [meter('a-waerme', 'a', 'waerme')],
    readings: wholeYear('a-waerme', 2025, 0, 1000),
    costItems: [item('heizung', 2025, { category: HEATING_CATEGORY, amountCents: 100000, key: 'meter', meterType: 'waerme' })],
  }
  const mit: Partial<SnapshotSource> = {
    ...ohne,
    meters: [...(ohne.meters ?? []), meter('speicher', null, 'waerme', { heatingPlantId: 'hp1', heatingRole: 'dhwHeat' })],
    readings: [...(ohne.readings ?? []), ...wholeYear('speicher', 2025, 0, 5000)],
  }
  // Als Hauptzähler gelesen, trüge a nur 1.000 von 5.000 kWh, also 200 €, und 800 € blieben beim
  // Vermieter.
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), 100000)
  assert.equal(share(settle(mit, 2025, [plant()]), 'ta', 'heizung'), share(settle(ohne), 'ta', 'heizung'))
})

// ---------- Anlegen ändert keine Zahl (Entwurf 11.2, A2, 12.3 Nr. 12) ----------

test('Anlage mit Vorgaben: jede Abrechnung bleibt gleich, über das ganze Ergebnis', () => {
  for (const y of [2025, 2027]) {
    const s: Partial<SnapshotSource> = {
      units: [
        unit('a', { areaM2: 60 }), unit('b', { areaM2: 40 }),
        unit('c', { participates: false, selfUsed: true, selfPersons: 2, areaM2: 80 }),
        unit('garage', { areaM2: 0, noConnection: ['waerme'] }),
      ],
      tenancies: [
        tenancy('ta1', 'a', { end: `${y}-04-30` }),
        tenancy('ta2', 'a', { start: `${y}-06-01` }),
        tenancy('tb', 'b', { heatingModel: 'flatRate' }),
      ],
      meters: [meter('a-waerme', 'a', 'waerme'), meter('b-waerme', 'b', 'waerme'), meter('c-waerme', 'c', 'waerme')],
      readings: [...wholeYear('a-waerme', y, 0, 4000), ...wholeYear('b-waerme', y, 0, 2500), ...wholeYear('c-waerme', y, 0, 3000)],
      costItems: [
        item('verbrauch', y, { category: HEATING_CATEGORY, amountCents: 700000, key: 'meter', meterType: 'waerme' }),
        item('grund', y, { category: HEATING_CATEGORY, amountCents: 300000, key: 'area' }),
        item('messdienst', y, { category: HEATING_CATEGORY, amountCents: 50000, key: 'amounts', tenancyAmounts: { ta1: 10000, ta2: 12000, tb: 15000 } }),
        item('wartung', y, { category: HEATING_CATEGORY, amountCents: 20000, key: 'direct', directUnitId: 'a' }),
        item('grundsteuer', y, { category: 'Grundsteuer', amountCents: 90000, key: 'area' }),
      ],
    }
    const ohne = settle(s, y)
    const anlagen = [plant(), plant({ method: 'service' }), plant({ method: 'service', source: 'homeowners' }), plant({ units: [{ unitId: 'a', heatedAreaM2: null }] })]
    for (const p of anlagen) assert.deepEqual(settle(s, y, [p]), ohne, `${y}: ${JSON.stringify(p)}`)
    assert.deepEqual(settle(s, y, []), ohne, `${y}: leere Liste`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/calc-heizanlage.test.ts`
Expected: FAIL. Typfehler beim Ausführen gibt es nicht (Node streift Typen ab), aber
`share(r, 'ta', 'wasser')` ist `60000` statt `80000`, im zweiten Test `133333` statt `114286`, und
der Zähler der Anlage ergibt `20000` statt `100000`. Der vierte Test ist schon grün.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

Den Typimport um `HeatingPlant` ergänzen. `SnapshotMeter` ersetzen:

```ts
// Gelesen werden Kennung, Wohnung (null = Hauptzähler) und Zählertyp, dazu die Angaben zur
// Heizanlage (Heizung PR 4): Ein Zähler der Anlage ist kein Hauptzähler des Hauses, und
// Fernablesbarkeit und Einbau entscheiden über die Kürzung nach § 12 Abs. 1 Satz 2 HeizkostenV. Der
// Name nur für diesen Hinweis, deshalb optional; Zählernummer und Maßeinheit sind Anzeige.
export type SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'> & Partial<Pick<Meter, 'name'>>
```

Hinter `SnapshotMeter`:

```ts
// Die Heizanlagen des Objekts (Heizung PR 4), eingedampft auf das, was die Berechnung liest: was über
// die Fernablesbarkeit bekannt ist und welche Wohnungen angeschlossen sind. Die Verteilung liest sie
// in dieser Version nicht (Entwurf 11.2, A2).
export type SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
```

In `Snapshot` hinter `previousCostItems?`:

```ts
  // Die Heizanlagen des Objekts (Heizung PR 4). Fehlt die Angabe (db.json, Regression, ein von Hand
  // gebauter Schnappschuss), rechnet die Berechnung wie ohne Anlage, und dasselbe gilt für eine
  // leere Liste.
  heatingPlants?: SnapshotHeatingPlant[]
```

`snapshotFor` (Fassung von PR 2 und PR 3): im Typ des ersten Parameters neben `properties?` ergänzen

```ts
heatingPlants?: (SnapshotHeatingPlant & { propertyId: string })[]
```

und im zurückgegebenen Objekt hinter `property: …`:

```ts
    // Die Anlagen tragen ihr Objekt wie die Wurzeln in `narrowToProperty`; eingegrenzt wird hier,
    // an derselben Stelle wie das Objekt selbst.
    heatingPlants: (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId),
```

- [ ] **Step 4: Berechnung (`server/src/calc.ts`)**

In `computeSettlement` direkt vor `const consumptionFor = (` einfügen:

```ts
  // Zähler der Heizanlage selbst (Gaszähler, Wärmezähler am Speicher; Heizung PR 4) haben keine
  // Wohnung, sind aber kein Hauptzähler des Hauses: Sie messen, was die Anlage bezieht oder erzeugt,
  // nicht, was die Wohnungen zusammen verbraucht haben. Als Hauptzähler gelesen, machte ein
  // Wärmezähler am Speicher aus jeder Wohnung ohne Wärmezähler einen Rest nach #116.
  const houseMeters = allMeters.filter((m) => !m.unitId && !m.heatingPlantId)
  // Wasser (Entwurf 5.3, G-B8): Beim Kaltwasser zählen die Warmwasserzähler der Wohnungen mit, denn
  // die Wasserkosten des Warmwassers gehören dazu, soweit sie nicht gesondert abgerechnet werden
  // (§ 8 Abs. 2 HeizkostenV), und der Hauptzähler misst beides. Ob eine Wohnung einen Zähler hat
  // (#116), sagt aber nur ein Kaltwasserzähler: Mit nur einem Warmwasserzähler fehlt ihr Kaltwasser,
  // und es kommt über den Hauptzähler.
  const measures = (type: string, m: SnapshotMeter): boolean => m.type === type || (type === 'kaltwasser' && m.type === 'warmwasser')
```

In `consumptionFor`:

- `const mainMeters = only === null ? allMeters.filter((m) => !m.unitId) : []` ersetzen durch
  `const mainMeters = only === null ? houseMeters : []`.
- `const meterTypes = [...new Set(unitMeters.map((m) => m.type))]` ersetzen durch

```ts
    // Ein Warmwasserzähler bringt auch den Kaltwasser-Schlüssel mit (siehe `measures`).
    const meterTypes = [...new Set(unitMeters.flatMap((m): string[] => (m.type === 'warmwasser' ? ['warmwasser', 'kaltwasser'] : [m.type])))]
```

- Den Anfang der Schleife über die Typen bis einschließlich `let selfConsumption = …` ersetzen durch:

```ts
    for (const type of meterTypes) {
      const meters = unitMeters.filter((m) => measures(type, m)) as (SnapshotMeter & { unitId: string })[]
      // Verbrauch je Wohnung, für den Eigenanteil; beim Kaltwasser samt Warmwasser.
      const usage = new Map<string, number>()
      // Wohnungen mit einem abgelesenen Zähler genau dieses Typs (#116, G-B8).
      const perUnit = new Map<string, number>()
      let basis = 0
      for (const m of meters) {
        const readings = readingsOf(m.id)
        const c = consumptionInPeriod(readings, yFrom, yTo)
        basis += c
        // Ein angelegter, aber im Jahr nie abgelesener Zähler ist kein Zähler: Sonst gälte die
        // Wohnung als gemessen, und der Fehler aus #116 käme ohne Warnung zurück.
        if (coveredDays(readings, yFrom, yTo) > 0) {
          usage.set(m.unitId, (usage.get(m.unitId) || 0) + c)
          if (m.type === type) perUnit.set(m.unitId, (perUnit.get(m.unitId) || 0) + c)
        }
      }
      // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge und zählt deshalb
      // unabhängig vom Beteiligungs-Kennzeichen in die Basis; der Anteil nicht vermieteter
      // Wohnungen fällt damit ohnehin dem Vermieter zu.
      let selfConsumption = selfOnes.reduce((a, u) => a + (usage.get(u.id) || 0), 0)
```

- In `partial` die Zeile mit `unitCoveredDays(meters.filter((m) => m.unitId === u.id)…` ersetzen durch:

```ts
        const covered = unitCoveredDays(meters.filter((m) => m.unitId === u.id && m.type === type).map((m) => readingsOf(m.id)), yFrom, yTo)
```

Der Rest von `consumptionFor` bleibt. `data.meters` enthält beim Kaltwasser nun auch die
Warmwasserzähler, und daran hängen gewollt der Verbrauch je Mietverhältnis, `measured` und der Teil
außerhalb der Abrechnungseinheit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-heizanlage.test.ts test/calc.test.ts test/calc-hauptzaehler.test.ts test/settlement-golden.test.ts && npm run typecheck`
Expected: PASS; `calc-hauptzaehler.test.ts` (#116) bleibt ohne Änderung grün.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS, Golden unverändert.

```bash
git add server/src/snapshot.ts server/src/calc.ts server/test/calc-heizanlage.test.ts
git commit -m "Berechnung: Zähler der Heizanlage sind keine Hauptzähler, Warmwasser zählt beim Kaltwasser mit

Eine Wohnung nur mit Warmwasserzähler gilt beim Kaltwasser als ohne Zähler (G-B8). Eine Anlage mit
Vorgaben ändert keine Zahl.

Refs #99"
```

---

### Task 8: Fernablesbarkeit nach Einbaudatum, beziffert (#214)

**Files:**
- Create: `server/src/remoteReading.ts`
- Modify: `server/src/calc.ts`, `shared/glossary.ts`, `server/test/law-literals.test.ts`
- Test: `server/test/remote-reading.test.ts` (neu), `server/test/calc-heizanlage.test.ts` (ergänzen)

**Interfaces:**
- Consumes (Task 1, 7): `hkvRemoteReadingNewDevices`, `hkvRemoteReadingRetrofit`, `hkvCutRemoteReading`, `law`, `LawLog`, `Period`; `Snapshot.heatingPlants`, `SnapshotMeter`.
- Produces:
  - `type RemoteLevel = 'required' | 'possible' | 'unknown' | 'fine'`
  - `type RemotePlant = Pick<HeatingPlant, 'id' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>`
  - `type RemoteMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'>`
  - `type RemoteUnit = Pick<Unit, 'id' | 'noConnection'>`
  - `type RemoteVerdict = { level: RemoteLevel; meterIds: string[]; byAnswer: boolean }`
  - `plantDevices(plant, meters, units): RemoteMeter[]`, `plantVerdict(plant, meters, units, period, log): RemoteVerdict`, `remoteReadingVerdict(plants, meters, units, period, log): RemoteVerdict | null`
  - Hinweis-Code `heating.remote-reading-missing` (`warning`); Begriffe `heatingSystem`, `heatCostAllocator`

- [ ] **Step 1: Write the failing tests**

`server/test/remote-reading.test.ts`:

```ts
// Fernablesbarkeit der Erfassungsgeräte (Heizung PR 4, Entwurf 3.13, 4.7, R-A1, G-C2). Geprüft wird
// die Entscheidung allein; Hinweise und Beträge stehen in calc-heizanlage.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog, type Period } from '../../shared/law/register.ts'
import type { DevicesInstalledAfter, DevicesRemote } from '../../shared/types.ts'
import { plantDevices, plantVerdict, remoteReadingVerdict, type RemoteLevel, type RemoteMeter, type RemotePlant, type RemoteUnit } from '../src/remoteReading.ts'

const year = (y: number): Period => ({ from: `${y}-01-01`, to: `${y}-12-31` })
const anlage = (over: Partial<RemotePlant> = {}): RemotePlant => ({ id: 'hp1', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over })
const hkv = (id: string, over: Partial<RemoteMeter> = {}): RemoteMeter => ({
  id, unitId: 'a', type: 'hkv', heatingPlantId: null, heatingRole: null, remoteReadable: null, installedOn: null, ...over,
})
const UNITS: RemoteUnit[] = [{ id: 'a' }, { id: 'b' }, { id: 'garage', noConnection: ['waerme'] }]
const level = (plant: RemotePlant, meters: RemoteMeter[], period: Period): RemoteLevel => plantVerdict(plant, meters, UNITS, period, createLawLog()).level

test('4.7: Gerät eingebaut 15.11.2021, nicht fernablesbar: 2026 keine Kürzung, 2027 die volle', () => {
  const m = [hkv('m1', { remoteReadable: false, installedOn: '2021-11-15' })]
  assert.equal(level(anlage(), m, year(2026)), 'fine')
  assert.equal(level(anlage(), m, year(2027)), 'required')
  // Ein Zeitraum, der 2027 nur berührt: „bis zu“ (Entwurf 3.13, 15.1 Nr. 7).
  assert.equal(level(anlage(), m, { from: '2026-07-01', to: '2027-06-30' }), 'possible')
})

test('4.7 und R-A1: Gerät eingebaut 15.12.2021, nicht fernablesbar: Kürzung schon 2022 und 2025', () => {
  const m = [hkv('m1', { remoteReadable: false, installedOn: '2021-12-15' })]
  assert.equal(level(anlage(), m, year(2022)), 'required')
  assert.equal(level(anlage(), m, year(2025)), 'required')
})

test('3.13: Einbaudatum unbekannt, nicht fernablesbar: „bis zu“ schon heute, ab 2027 sicher', () => {
  const m = [hkv('m1', { remoteReadable: false })]
  assert.equal(level(anlage(), m, year(2025)), 'possible')
  assert.equal(level(anlage(), m, year(2027)), 'required')
})

test('Erst nach dem Zeitraum eingebaut: in diesem Zeitraum nichts', () => {
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: false, installedOn: '2026-03-01' })], year(2025)), 'fine')
})

test('Fernablesbar, unbekannt, gemischt', () => {
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true })], year(2027)), 'fine')
  assert.equal(level(anlage(), [hkv('m1')], year(2027)), 'unknown')
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true }), hkv('m2')], year(2027)), 'unknown')
  assert.equal(level(anlage(), [], year(2027)), 'unknown')
})

test('Angabe an der Anlage, wenn Mietfuchs die Geräte nicht kennt (G-C2)', () => {
  const faelle: [DevicesRemote, DevicesInstalledAfter, Period, RemoteLevel][] = [
    ['all', 'all', year(2027), 'fine'],
    ['unknown', 'all', year(2027), 'unknown'],
    ['none', 'all', year(2025), 'required'],
    ['none', 'all', year(2020), 'fine'],
    ['none', 'some', year(2025), 'required'],
    ['partial', 'all', year(2025), 'required'],
    ['partial', 'some', year(2025), 'possible'],
    ['partial', 'some', year(2027), 'required'],
    ['none', 'none', year(2025), 'fine'],
    ['none', 'none', year(2027), 'required'],
    ['none', 'none', { from: '2026-07-01', to: '2027-06-30' }, 'possible'],
    ['none', 'unknown', year(2025), 'possible'],
  ]
  for (const [remote, after, period, erwartet] of faelle) {
    assert.equal(level(anlage({ devicesRemote: remote, devicesInstalledAfter2021: after }), [], period), erwartet, `${remote}/${after} ab ${period.from}`)
  }
})

test('Angabe und Zähler zusammen: das Schwerere gilt; unbekannte Zähler zählen neben einer Angabe nicht', () => {
  assert.equal(level(anlage({ devicesRemote: 'all' }), [hkv('m1', { remoteReadable: false, installedOn: '2021-12-15' })], year(2025)), 'required')
  assert.equal(level(anlage({ devicesRemote: 'all' }), [hkv('m1')], year(2027)), 'fine')
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true })], year(2027)), 'fine')
})

test('Geräte der Anlage: Wärme, Warmwasser und HKV ihrer Wohnungen und ihre eigenen Wärmezähler, nicht der Gaszähler', () => {
  const meters: RemoteMeter[] = [
    hkv('a-hkv'),
    hkv('b-kalt', { unitId: 'b', type: 'kaltwasser' }),
    hkv('b-warm', { unitId: 'b', type: 'warmwasser' }),
    hkv('garage-waerme', { unitId: 'garage', type: 'waerme' }),
    hkv('gas', { unitId: null, type: 'sonstig', heatingPlantId: 'hp1', heatingRole: 'supply' }),
    hkv('speicher', { unitId: null, type: 'waerme', heatingPlantId: 'hp1', heatingRole: 'dhwHeat' }),
    hkv('haus', { unitId: null, type: 'waerme' }),
  ]
  assert.deepEqual(plantDevices(anlage(), meters, UNITS).map((m) => m.id), ['a-hkv', 'b-warm', 'speicher'])
  assert.deepEqual(plantDevices(anlage({ units: [{ unitId: 'b', heatedAreaM2: null }] }), meters, UNITS).map((m) => m.id), ['b-warm', 'speicher'])
  assert.deepEqual(plantDevices(anlage({ units: [] }), meters, UNITS).map((m) => m.id), ['speicher'])
})

test('Mehrere Anlagen: das Schwerere gilt, die Zähler dieser Stufe werden genannt', () => {
  const v = remoteReadingVerdict(
    [anlage({ devicesRemote: 'all' }), anlage({ id: 'hp2', units: [{ unitId: 'b', heatedAreaM2: null }] })],
    [hkv('b-hkv', { unitId: 'b', remoteReadable: false, installedOn: '2023-05-01' })],
    UNITS, year(2025), createLawLog(),
  )
  assert.deepEqual(v, { level: 'required', meterIds: ['b-hkv'], byAnswer: false })
  assert.equal(remoteReadingVerdict([], [], UNITS, year(2025), createLawLog()), null)
})

test('Protokoll: ohne Angabe und ohne bekannte Geräte wird kein Rechtswert abgefragt', () => {
  const log = createLawLog()
  plantVerdict(anlage(), [hkv('m1')], UNITS, year(2027), log)
  assert.deepEqual(log.values, [])
})
```

In `server/test/calc-heizanlage.test.ts` anhängen:

```ts
// ---------- Fernablesbarkeit (#214, Entwurf 3.13, 6.5, 10.1) ----------

const heizBestand = (y: number, meters: SnapshotMeter[] = []): Partial<SnapshotSource> => ({
  units: [unit('a'), unit('b')],
  tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
  meters,
  costItems: [item('heizung', y, { category: HEATING_CATEGORY, amountCents: 100000, key: 'amounts', tenancyAmounts: { ta: 60000, tb: 40000 } })],
})
const remoteNotices = (r: ComputedSettlement) => r.notices.filter((n) => n.code.startsWith('heating.remote-reading'))

test('R-A1: Gerät eingebaut 15.12.2021, nicht fernablesbar, 2025: die Kürzung je Mieter beziffert', () => {
  const hkvA = meter('hkv-a', 'a', 'hkv', { name: 'HKV Wohnzimmer', remoteReadable: false, installedOn: '2021-12-15' })
  const r = settle(heizBestand(2025, [hkvA]), 2025, [plant({ method: 'service' })])
  const [n, ...weitere] = remoteNotices(r)
  assert.equal(weitere.length, 0)
  assert.equal(n?.code, 'heating.remote-reading-missing')
  assert.equal(n?.level, 'warning')
  assert.deepEqual(n?.subject, { kind: 'meter', id: 'hkv-a' })
  assert.match(n?.text ?? '', /„HKV Wohnzimmer“/)
  assert.match(n?.text ?? '', /nach dem 01\.12\.2021/)
  assert.match(n?.text ?? '', /um 3 % kürzen/)
  // 3 % der gedruckten Heizzeilen (Entwurf 6.5): 600,00 € und 400,00 €.
  assert.match(n?.text ?? '', /ta \(a\) 18,00 €/)
  assert.match(n?.text ?? '', /tb \(b\) 12,00 €/)
  assert.ok(r.legalBasis.values.some((v) => v.id === 'hkv.remote-reading.new-devices'))
  assert.ok(r.legalBasis.values.some((v) => v.id === 'hkv.cut.remote-reading'))
  // Ohne Anlage kennt Mietfuchs die Geräte nicht, und vor 2027 gibt es dann keinen Hinweis; so
  // rechnete auch die erste Fassung des Entwurfs.
  assert.deepEqual(remoteNotices(settle(heizBestand(2025, [hkvA]))), [])
})

test('Einbaudatum unbekannt: ein Hinweis mit „bis zu“, der die Ampel nicht färbt', () => {
  const r = settle(heizBestand(2025, [meter('hkv-a', 'a', 'hkv', { name: 'HKV', remoteReadable: false })]), 2025, [plant()])
  const [n] = remoteNotices(r)
  assert.equal(n?.code, 'heating.remote-reading')
  assert.equal(n?.level, 'hint')
  assert.match(n?.text ?? '', /um bis zu 3 % kürzen/)
  assert.match(n?.text ?? '', /ta \(a\) 18,00 €/)
})

test('Angabe an der Anlage: keine Geräte fernablesbar, einige nach 2021 eingebaut', () => {
  const r = settle(heizBestand(2025), 2025, [plant({ method: 'service', devicesRemote: 'none', devicesInstalledAfter2021: 'some' })])
  const [n] = remoteNotices(r)
  assert.equal(n?.code, 'heating.remote-reading-missing')
  assert.match(n?.text ?? '', /Laut Ihrer Angabe an der Heizanlage/)
  assert.equal(n?.subject, undefined)
})

test('Alle Geräte fernablesbar laut Anlage: kein Hinweis, auch ab 2027', () => {
  assert.deepEqual(remoteNotices(settle(heizBestand(2027), 2027, [plant({ devicesRemote: 'all' })])), [])
})

test('Ohne Anlage und mit unbekannter Angabe: der Hinweis aus PR 1, wortgleich', () => {
  const ohne = remoteNotices(settle(heizBestand(2027), 2027))
  assert.equal(ohne.length, 1)
  assert.equal(ohne[0]?.code, 'heating.remote-reading')
  assert.deepEqual(remoteNotices(settle(heizBestand(2027), 2027, [plant()])), ohne)
  assert.deepEqual(remoteNotices(settle(heizBestand(2026), 2026)), [])
})
```

In `server/test/law-literals.test.ts` die Liste `ENGINE_FILES` um `'server/src/remoteReading.ts'`
ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/remote-reading.test.ts test/calc-heizanlage.test.ts test/law-literals.test.ts`
Expected: FAIL. `remote-reading.test.ts`: `Cannot find module '…/src/remoteReading.ts'`;
`law-literals.test.ts`: „server/src/remoteReading.ts gibt es nicht; die Liste ist veraltet“;
`calc-heizanlage.test.ts`: im Test R-A1 ist `n` `undefined`.

- [ ] **Step 3: Entscheidung (`server/src/remoteReading.ts`)**

```ts
// Fernablesbarkeit der Erfassungsgeräte (Heizung PR 4, #214, Entwurf 3.13, R-A1, G-C2).
//
// § 12 Abs. 1 Satz 2 HeizkostenV erlaubt dem Mieter, seinen Anteil an den Heizkosten zu kürzen, wenn
// Geräte entgegen § 5 Abs. 2 oder 3 nicht fernablesbar sind. Ob das so ist, hängt am Gerät: Nach dem
// Stichtag eingebaute müssen es ab dem Einbau sein (§ 5 Abs. 2, `hkv.remote-reading.new-devices`),
// ältere ab dem Beginn von § 5 Abs. 3 (`hkv.remote-reading.retrofit`).
//
// Woher Mietfuchs das weiß, sagt die Anlage auf zwei Wegen: Zähler, die es kennt, tragen
// `remoteReadable` und `installedOn`; beim Messdienst und bei freien Schlüsseln kennt es die Geräte
// meist nicht, dann gilt die Angabe an der Anlage (G-C2). Diese Datei entscheidet nur; die Texte und
// Beträge stehen in calc.ts. Rechtszahlen stehen hier nicht (law-literals.test.ts).
import type { DevicesInstalledAfter, DevicesRemote, HeatingPlant, Meter, MeterType, Unit } from '../../shared/types.ts'
import { law, type LawLog, type Period } from '../../shared/law/register.ts'
import { hkvRemoteReadingNewDevices, hkvRemoteReadingRetrofit } from '../../shared/law/heizkostenv.ts'

// Wie sicher eine Kürzung ist:
//   required  ein Gerät ist nicht fernablesbar, obwohl es das in diesem Zeitraum sein muss
//   possible  es kann so sein; offen sind das Einbaudatum oder, bei einem Zeitraum, der den Beginn
//             von § 5 Abs. 3 nur berührt, die Rechtsfrage 15.1 Nr. 7: „bis zu“
//   unknown   Mietfuchs weiß nichts über die Geräte
//   fine      alle bekannten Geräte sind fernablesbar, oder keines muss es schon sein
export type RemoteLevel = 'required' | 'possible' | 'unknown' | 'fine'
const RANK: Record<RemoteLevel, number> = { fine: 0, unknown: 1, possible: 2, required: 3 }

export type RemotePlant = Pick<HeatingPlant, 'id' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
export type RemoteMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'>
export type RemoteUnit = Pick<Unit, 'id' | 'noConnection'>
// `meterIds`: die Zähler, die zu dieser Stufe geführt haben; `byAnswer`: auch die Angabe an der Anlage.
export type RemoteVerdict = { level: RemoteLevel; meterIds: string[]; byAnswer: boolean }

// Die Gerätearten, die § 5 HeizkostenV erfasst: Zähler und Heizkostenverteiler für Heizung und
// Warmwasser. Der Versorgungszähler gehört dem Versorger und fällt nicht darunter.
const DEVICE_TYPES: readonly MeterType[] = ['waerme', 'warmwasser', 'hkv']

const top = (levels: readonly RemoteLevel[]): RemoteLevel => levels.reduce<RemoteLevel>((a, l) => (RANK[l] > RANK[a] ? l : a), 'fine')

// Die Erfassungsgeräte einer Anlage: Wärme-, Warmwasserzähler und Heizkostenverteiler der Wohnungen,
// die sie versorgt (ohne Liste alle ohne „kein Anschluss: Wärme“, #117), dazu ihre eigenen
// Wärmezähler.
export function plantDevices(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[]): RemoteMeter[] {
  const served = new Set(plant.units === null
    ? units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)
    : plant.units.map((u) => u.unitId))
  return meters.filter((m) =>
    (m.unitId != null && served.has(m.unitId) && DEVICE_TYPES.includes(m.type)) ||
    (m.heatingPlantId === plant.id && m.heatingRole != null && m.heatingRole !== 'supply'))
}

// Ein Gerät, das nicht fernablesbar ist.
function deviceLevel(installedOn: string | null, period: Period, log: LawLog): RemoteLevel {
  // Erst nach dem Zeitraum eingebaut: In diesem Zeitraum gab es es noch nicht.
  if (installedOn !== null && installedOn > period.to) return 'fine'
  if (installedOn !== null && law(hkvRemoteReadingNewDevices, { date: installedOn }, log).required) return 'required'
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return 'required'
  // Ohne Einbaudatum kann es ein neues Gerät sein: „bis zu“ schon vor § 5 Abs. 3 (Entwurf 3.13).
  if (installedOn === null) return 'possible'
  return retrofit === 'partial' ? 'possible' : 'fine'
}

// Die Angabe an der Anlage: wie viele Geräte fernablesbar sind und wie viele nach dem Stichtag
// eingebaut wurden.
function answerLevel(remote: DevicesRemote, after: DevicesInstalledAfter, period: Period, log: LawLog): RemoteLevel {
  if (remote === 'unknown') return 'unknown'
  if (remote === 'all') return 'fine'
  // Sicher ist ein neues Gerät dabei, das nicht fernablesbar ist: alle neu, oder keines fernablesbar.
  if (after === 'all' || (after === 'some' && remote === 'none')) {
    if (law(hkvRemoteReadingNewDevices, { date: period.to }, log).required) return 'required'
    if (after === 'all') return 'fine'
  }
  const retrofit = law(hkvRemoteReadingRetrofit, { period }, log).coverage
  if (retrofit === 'full') return 'required'
  if (after === 'none') return retrofit === 'partial' ? 'possible' : 'fine'
  return 'possible'
}

export function plantVerdict(plant: RemotePlant, meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict {
  const answer = answerLevel(plant.devicesRemote, plant.devicesInstalledAfter2021, period, log)
  const devices = plantDevices(plant, meters, units).map((m) => ({
    id: m.id,
    level: m.remoteReadable === true ? ('fine' as const) : m.remoteReadable === false ? deviceLevel(m.installedOn ?? null, period, log) : ('unknown' as const),
  }))
  // Neben einer Angabe an der Anlage zählen nur Geräte, deren Fernablesbarkeit eingetragen ist; ohne
  // Angabe entscheiden die Geräte allein, und ohne Geräte bleibt es unbekannt.
  const candidates: RemoteLevel[] = answer === 'unknown'
    ? (devices.length > 0 ? devices.map((d) => d.level) : ['unknown'])
    : [answer, ...devices.map((d) => d.level).filter((l) => l !== 'unknown')]
  const level = top(candidates)
  return {
    level,
    meterIds: level === 'required' || level === 'possible' ? devices.filter((d) => d.level === level).map((d) => d.id) : [],
    byAnswer: answer === level,
  }
}

// Über alle Anlagen des Objekts: das Schwerere gilt. `null` ohne Anlage; dann bleibt es beim
// Hinweis aus PR 1.
export function remoteReadingVerdict(plants: readonly RemotePlant[], meters: readonly RemoteMeter[], units: readonly RemoteUnit[], period: Period, log: LawLog): RemoteVerdict | null {
  if (plants.length === 0) return null
  const verdicts = plants.map((p) => plantVerdict(p, meters, units, period, log))
  const level = top(verdicts.map((v) => v.level))
  const atLevel = verdicts.filter((v) => v.level === level)
  return { level, meterIds: [...new Set(atLevel.flatMap((v) => v.meterIds))], byAnswer: atLevel.some((v) => v.byAnswer) }
}
```

- [ ] **Step 4: Hinweis (`server/src/calc.ts`)**

Importe: `hkvRemoteReadingNewDevices` zum Import aus `'../../shared/law/heizkostenv.ts'`;
`import { remoteReadingVerdict } from './remoteReading.ts'`.

In `noticeKinds` hinter `'heating.remote-reading'`:

```ts
  // Heizung PR 4 (#214): ein Gerät ist nicht fernablesbar, obwohl es das sein muss. Eine eigene Stufe
  // und damit ein eigener Code: `heating.remote-reading` bleibt der Hinweis, wenn es nur sein kann.
  'heating.remote-reading-missing': { level: 'warning', title: 'Geräte der Heizung nicht fernablesbar', rule: 'heating-remote-reading', terms: ['heatingCostOrdinance', 'heatCostAllocator'] },
```

Im Block „Fernablesbarkeit“ (Fassung von PR 1) die Zeile
`const retrofit = heatingBilledItem ? law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog) : null`
ersetzen durch:

```ts
  // Mit Heizanlage (Heizung PR 4, #214) weiß Mietfuchs, was eingetragen ist: an den Zählern
  // Fernablesbarkeit und Einbaudatum, an der Anlage die Angabe für den Messdienst. Ohne Anlage, oder
  // solange dort nichts bekannt ist, bleibt es beim Hinweis darunter, Wort für Wort wie bisher.
  const remote = heatingBilledItem ? remoteReadingVerdict(snapshot.heatingPlants ?? [], snapshot.meters, snapshot.units, lawPeriod, lawLog) : null
  const retrofit = heatingBilledItem && (remote === null || remote.level === 'unknown') ? law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog) : null
```

Direkt hinter dem schließenden `}` dieses `if (retrofit && retrofit.coverage !== 'none') { … }`:

```ts
  if (remote && (remote.level === 'required' || remote.level === 'possible')) {
    const remoteCut = law(hkvCutRemoteReading, { period: lawPeriod }, lawLog)
    const newDevices = law(hkvRemoteReadingNewDevices, { date: lawPeriod.to }, lawLog)
    const retrofitRule = law(hkvRemoteReadingRetrofit, { period: lawPeriod }, lawLog)
    // Die Kürzung je Mieter auf seine gedruckten Heizzeilen, kaufmännisch gerundet (Entwurf 6.5).
    // Mietfuchs zieht nichts ab; erklären muss die Kürzung der Mieter.
    const cuts = [...statements.values()].flatMap((st) => {
      const heat = st.rows.filter((r) => r.category === HEATING_CATEGORY).reduce((a, r) => a + r.shareCents, 0)
      return heat > 0 ? [`${st.tenantName} (${st.unitName}) ${fmtCents(Math.round((heat * remoteCut) / 100))}`] : []
    })
    const names = remote.meterIds.map((id) => `„${snapshot.meters.find((m) => m.id === id)?.name ?? 'ohne Namen'}“`)
    const which = names.length > 0
      ? `Nicht fernablesbar ${names.length === 1 ? 'ist' : 'sind'} ${andList(names)}.`
      : 'Laut Ihrer Angabe an der Heizanlage sind nicht alle Zähler und Heizkostenverteiler fernablesbar.'
    const rule = `Geräte, die nach dem ${fmtDay(newDevices.installedAfter)} eingebaut wurden, müssen ab ihrem Einbau fernablesbar sein (§ 5 Abs. 2 HeizkostenV), alle übrigen ab dem ${fmtDay(retrofitRule.validFrom ?? '')} (§ 5 Abs. 3).`
    const subject: NoticeSubject | undefined = remote.meterIds[0] ? { kind: 'meter', id: remote.meterIds[0] } : undefined
    if (remote.level === 'required') {
      warn('heating.remote-reading-missing',
        `${which} ${rule} In diesem Zeitraum gilt das für diese Geräte. Jeder Mieter darf seinen Anteil an den Heizkosten deshalb um ${remoteCut} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV)` +
          `${cuts.length > 0 ? `, hier: ${andList(cuts)}` : ''}. Mietfuchs zieht nichts ab; die Kürzung muss der Mieter erklären. ` +
          'Ausgenommen sind ein einzelnes Gerät, das in einem nicht fernablesbaren System ersetzt oder ergänzt wurde (§ 5 Abs. 2 Satz 4), und Fälle, in denen die Nachrüstung technisch nicht möglich ist oder eine unbillige Härte wäre (§ 5 Abs. 3 Satz 2); bewahren Sie dafür einen Nachweis auf.',
        subject)
    } else {
      warn('heating.remote-reading',
        `${which} ${rule} Ob das in diesem Zeitraum schon für diese Geräte gilt, hängt an ihrem Einbaudatum. Wenn ja, darf jeder Mieter seinen Anteil an den Heizkosten um bis zu ${remoteCut} % kürzen (§ 12 Abs. 1 Satz 2 HeizkostenV)` +
          `${cuts.length > 0 ? `, hier bis zu: ${andList(cuts)}` : ''}. Tragen Sie das Einbaudatum am Zähler oder die Angabe an der Heizanlage ein; dann rechnet Mietfuchs es genau.`,
        subject)
    }
  }
```

`NoticeSubject` ist in calc.ts bereits als Typ importiert; sonst zum Typimport aus
`'../../shared/types.ts'` ergänzen.

- [ ] **Step 5: Begriffe (`shared/glossary.ts`)**

Den Import aus `'./law/heizkostenv.ts'` (PR 1) um `hkvRemoteReadingNewDevices,
hkvRemoteReadingRetrofit` ergänzen, den aus `'./law/register.ts'` um `germanDate, onlyVersion`, und
unter `const REMOTE_CUT = …`:

```ts
const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)
const RETROFIT_FROM = germanDate(onlyVersion(hkvRemoteReadingRetrofit).validFrom ?? '')
```

In `GLOSSARY` hinter `heatingCostOrdinance`:

```ts
  heatingSystem: {
    title: 'Heizanlage',
    short: 'Die Anlage, die das Haus mit Wärme und meist auch mit Warmwasser versorgt, etwa ein Gaskessel im Keller, eine Wärmepumpe oder der Anschluss an die Fernwärme. An der Heizanlage sagen Sie Mietfuchs, womit geheizt wird, wer die Heizkostenabrechnung erstellt und welche Wohnungen angeschlossen sind.',
    example: 'Ein Haus mit drei Wohnungen und Gaszentralheizung, abgerechnet vom Messdienst: Sie legen eine Heizanlage „Gas“ an und übernehmen die 3.600 € der Messdienstabrechnung wie bisher als Einzelbeträge, etwa 1.400 €, 1.200 € und 1.000 €. An diesen Beträgen ändert die Heizanlage nichts.',
    norm: '§ 1 HeizkostenV',
    needed: 'Nicht nötig, solange Sie die Heizkosten wie bisher erfassen. Mit den Angaben an der Heizanlage kann Mietfuchs sagen, ob Mieter wegen nicht fernablesbarer Geräte kürzen dürfen, und später die CO₂-Kosten und eine eigene Heizkostenabrechnung rechnen. Hat jede Wohnung eine eigene Heizung mit eigenem Vertrag des Mieters, gibt es keine Heizanlage des Hauses.',
  },
  heatCostAllocator: {
    title: 'Heizkostenverteiler',
    short: `Ein kleines Gerät am Heizkörper, das anzeigt, wie viel dieser Heizkörper im Verhältnis zu den übrigen geheizt hat. Seine Werte sind keine Kilowattstunden, sondern Einheiten, die erst mit den Werten aller Geräte des Hauses etwas bedeuten. Geräte, die nach dem ${NEW_DEVICES_AFTER} eingebaut wurden, müssen aus der Ferne ablesbar sein, alle übrigen ab dem ${RETROFIT_FROM}.`,
    example: `Im Wohnzimmer zeigt der Verteiler 420 Einheiten, im ganzen Haus sind es 4.200. Auf diesen Heizkörper entfällt damit ein Zehntel der Kosten nach Verbrauch, bei 2.100 € also 210 €. Ist das Gerät nicht fernablesbar, obwohl es das sein müsste, darf der Mieter seinen Anteil an den Heizkosten um ${REMOTE_CUT} % kürzen.`,
    norm: '§§ 5, 12 HeizkostenV',
    needed: 'Wenn Ihr Messdienst die Heizkosten nach Heizkostenverteilern abrechnet. Mietfuchs wertet ihre Einheiten noch nicht selbst aus; übernehmen Sie dafür die Abrechnung des Messdienstes als Einzelbeträge. Tragen Sie am Zähler ein, ob das Gerät fernablesbar ist und wann es eingebaut wurde; dann sagt die Abrechnung, ob Mieter kürzen dürfen.',
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/remote-reading.test.ts test/calc-heizanlage.test.ts test/law-literals.test.ts test/glossary.test.ts test/anrede.test.ts test/law-wording.test.ts test/rechtstexte.test.ts test/rechtsdurchsicht-2026.test.ts && npm run typecheck`
Expected: PASS. `law-wording.test.ts` und `rechtstexte.test.ts` bleiben unverändert grün: Ohne
Anlage ist der Hinweis Wort für Wort der aus PR 1.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS, Golden unverändert.

```bash
git add server/src/remoteReading.ts server/src/calc.ts shared/glossary.ts server/test/remote-reading.test.ts server/test/calc-heizanlage.test.ts server/test/law-literals.test.ts
git commit -m "Fernablesbarkeit nach Einbaudatum: 3 % je Mieter beziffert, wo sie sicher sind

Geräte nach dem Stichtag müssen ab Einbau fernablesbar sein (§ 5 Abs. 2 HeizkostenV), ältere ab
2027 (§ 5 Abs. 3). Beim Messdienst gilt die Angabe an der Anlage. Ohne Anlage bleibt der bisherige
Hinweis wortgleich.

Refs #99, #214"
```

---

### Task 9: Zweifamilienhaus: Objektart gegen die Wohnungen

Die Objektart `zfh` ist Beschreibung; die Ausnahme des § 2 HeizkostenV hängt an den Tatsachen
(`mayAgreeOtherwise`, Entwurf 8.9). Widerspricht das eine dem anderen, sagt es der Hinweis
`property.kind-mismatch` (`hint`), und gerechnet wird nach den Wohnungen.

**Files:**
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-heizanlage.test.ts` (ergänzen)

**Interfaces:**
- Consumes (Task 2): `PropertyKind` mit `'zfh'`; in calc.ts `heatingAgreeable`, `items`, `snapshot.property`.
- Produces: Hinweis-Code `property.kind-mismatch` (`hint`, Regel `heating-consumption`).

- [ ] **Step 1: Write the failing test**

In `server/test/calc-heizanlage.test.ts` anhängen:

```ts
// ---------- Zweifamilienhaus (#180, Entwurf 8.9) ----------

const zfh = (units: SnapshotUnit[], withHeating = true): ComputedSettlement => computeSettlement({
  ...snapshotOf(source({
    units,
    tenancies: units.filter((u) => u.participates).map((u) => tenancy(`t-${u.id}`, u.id)),
    costItems: withHeating ? [item('heizung', 2025, { category: HEATING_CATEGORY, amountCents: 100000, key: 'area' })] : [],
  }), 2025),
  property: { kind: 'zfh', cableBuiltBeforeDec2021: null },
})
const kindNotices = (r: ComputedSettlement) => r.notices.filter((n) => n.code === 'property.kind-mismatch')

test('Zweifamilienhaus: passt die Objektart nicht zu den Wohnungen, gibt es einen Hinweis', () => {
  const drei = [unit('eg'), unit('og'), unit('dg')]
  const [n] = kindNotices(zfh(drei))
  assert.equal(n?.level, 'hint')
  assert.match(n?.text ?? '', /höchstens zwei Wohnungen/)
  // Eine selbst bewohnte und eine vermietete Wohnung: Die Ausnahme kann gelten, kein Hinweis.
  assert.deepEqual(kindNotices(zfh([unit('eg', { participates: false, selfUsed: true, selfPersons: 2 }), unit('og')])), [])
  // Ohne Heizkosten spielt die Ausnahme keine Rolle.
  assert.deepEqual(kindNotices(zfh(drei, false)), [])
  // Ein Mehrfamilienhaus bekommt den Hinweis nie.
  const mfh = computeSettlement({ ...snapshotOf(source({ units: drei, costItems: [item('heizung', 2025, { category: HEATING_CATEGORY, key: 'area' })] }), 2025), property: { kind: 'mfh', cableBuiltBeforeDec2021: null } })
  assert.deepEqual(kindNotices(mfh), [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- --test-name-pattern "Zweifamilienhaus" test/calc-heizanlage.test.ts`
Expected: FAIL, `n` ist `undefined`.

- [ ] **Step 3: Implement (`server/src/calc.ts`)**

In `noticeKinds` hinter `'heating.may-agree-otherwise'`:

```ts
  // #180, Entwurf 8.9: Die Objektart ist eine Beschreibung; die Ausnahme des § 2 hängt an den Wohnungen.
  'property.kind-mismatch': { level: 'hint', title: 'Art des Objekts passt nicht zu den Wohnungen', rule: 'heating-consumption', terms: ['heatingCostOrdinance', 'heatingSystem'] },
```

Direkt hinter dem Block zur Fernablesbarkeit (Task 8) und vor
`const heating = heatingFindings(…)`:

```ts
  // Zweifamilienhaus (#180, Entwurf 8.9): Die Objektart sagt, wie der Vermieter das Haus nennt. Ob
  // die Ausnahme des § 2 HeizkostenV gilt, hängt an den Wohnungen (`heatingAgreeable`), und danach
  // rechnet Mietfuchs. Widerspricht die Art den Wohnungen, erfährt es der Vermieter; ohne
  // Heizkosten spielt die Ausnahme keine Rolle.
  if (snapshot.property?.kind === 'zfh' && !heatingAgreeable && items.some((c) => c.category === HEATING_CATEGORY)) {
    warn('property.kind-mismatch',
      'Das Objekt ist als Zweifamilienhaus eingetragen, nach den angelegten Wohnungen gilt die Ausnahme des § 2 HeizkostenV aber nicht: ' +
        'Dafür darf das Gebäude höchstens zwei Wohnungen haben, von denen Sie eine selbst bewohnen. Mietfuchs richtet sich nach den Wohnungen; ' +
        'die Heizkostenverordnung gilt hier ohne diese Ausnahme. Prüfen Sie die Art des Objekts in den Stammdaten oder ob Ihre eigene Wohnung als „Eigennutzung“ angelegt ist.')
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-heizanlage.test.ts test/calc-notices.test.ts test/glossary.test.ts test/anrede.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/calc.ts server/test/calc-heizanlage.test.ts
git commit -m "Zweifamilienhaus: Hinweis, wenn die Objektart nicht zu den Wohnungen passt

Refs #99, #180"
```

---
### Task 10: Oberfläche: Einrichtung „Heizung“

Die Karte „Heizung“ in den Stammdaten mit den Schritten 1, 2, 4, 5 und 6 aus Entwurf 11.2. Jede
Frage hat eine Vorgabe oder eine leere erste Wahl („— bitte wählen —“); was später kommt, sagt ein
Satz, statt eine Anlage anzulegen, die der Server ablehnen würde. Die Logik liegt in
`heatingForm.ts`, ohne DOM prüfbar; der jsdom-Test prüft, dass jedes Auswahlfeld den gespeicherten
Wert zeigt (CLAUDE.md, Tests Ebene 3).

**Files:**
- Create: `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx`
- Modify: `client/src/pages/Stammdaten.tsx`
- Test: `client/src/heatingForm.test.ts` (neu), `client/src/components/HeatingCard.test.tsx` (neu)

**Interfaces:**
- Consumes (Task 1, 2, 6): Routen `/api/heating-plants`, `/api/heating-plants/assignable`; Typen `HeatingPlant`, `AssignableHeatingItem`, `DevicesRemote`, `DevicesInstalledAfter`, `HeatingEnergy`; `hkvConsumptionShare`, `hkvCutNotByConsumption`, `hkvRemoteReadingNewDevices`, `valueAt`, `germanDate`, `LAW_AS_OF`; aus PR 2 `periodOfKey`, `periodLabel`, `rulesOf`, `periodKey`; `useProperty`, `withProperty`, `Drawer`, `Term`, `useToast`, `useConfirm`, `api`, `errorText`, `fmtEuro`, `parseEuro`.
- Produces: `heatingForm.ts` mit `HeatingForm`, `HeatingPlantBody`, `HeatingResult`, `ENERGY_OPTIONS`, `CONTRACT_OPTIONS`, `REMOTE_OPTIONS`, `INSTALLED_OPTIONS`, `CAPTURE_OPTIONS`, `NEW_DEVICES_AFTER`, `whoOptions(kind)`, `whoHint(who, kind)`, `defaultUnitIds(units)`, `emptyHeatingForm(units)`, `heatingToForm(plant, units)`, `heatingPlantBody(form, units)`, `heatingSummary(plant, units)`; Komponente `HeatingCard({ units })`.

- [ ] **Step 1: Write the failing tests**

`client/src/heatingForm.test.ts`:

```ts
// Die Einrichtung „Heizung“ (Heizung PR 4, Entwurf 11.2), ohne DOM.
import { describe, expect, test } from 'vitest'
import { emptyHeatingForm, heatingPlantBody, heatingSummary, heatingToForm, whoHint, whoOptions, type HeatingForm } from './heatingForm'
import type { HeatingPlant, Unit } from './types'

const UNITS: Pick<Unit, 'id' | 'name' | 'noConnection'>[] = [{ id: 'eg', name: 'EG' }, { id: 'og', name: 'OG' }, { id: 'garage', name: 'Garage', noConnection: ['waerme'] }]
const ausgefuellt = (over: Partial<HeatingForm> = {}): HeatingForm => ({ ...emptyHeatingForm(UNITS), energy: 'gas', who: 'service', ...over })
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'heatPump', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: '2025-06-01', capturedOnOct2024: false,
  warmRentAverageCents: 123456, changeSplit: 'degreeDays', periodStartMonth: null, units: [{ unitId: 'og', heatedAreaM2: null }],
}

describe('Einrichtung Heizung', () => {
  test('Vorgabe: alle Wohnungen außer denen ohne Wärmeanschluss, und so heißt die Liste „alle“', () => {
    expect(emptyHeatingForm(UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingPlantBody(ausgefuellt(), UNITS)).toEqual({
      body: {
        energy: 'gas', supply: 'central', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
        capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null, units: null,
      },
    })
    expect(heatingPlantBody(ausgefuellt({ unitIds: ['og'] }), UNITS)).toMatchObject({ body: { units: [{ unitId: 'og', heatedAreaM2: null }] } })
  })

  test('Ohne Antwort ein Satz statt einer Anlage', () => {
    expect(heatingPlantBody(emptyHeatingForm(UNITS), UNITS)).toEqual({ error: 'Bitte wählen Sie, womit geheizt wird.' })
    expect(heatingPlantBody({ ...emptyHeatingForm(UNITS), energy: 'gas' }, UNITS)).toEqual({ error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' })
    expect(heatingPlantBody(ausgefuellt({ unitIds: [] }), UNITS)).toEqual({ error: expect.stringMatching(/mindestens eine Wohnung/) })
  })

  test('Eigene Heizung je Wohnung: beim Mieter keine Anlage, beim Vermieter später', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit' }), UNITS)).toEqual({ error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'tenant' }), UNITS)).toEqual({ none: expect.stringMatching(/keine Heizanlage/) })
    expect(heatingPlantBody(ausgefuellt({ energy: 'perUnit', contract: 'landlord' }), UNITS)).toEqual({ error: expect.stringMatching(/späteren Version/) })
  })

  test('Eigene Abrechnung kommt später', () => {
    expect(heatingPlantBody(ausgefuellt({ who: 'self' }), UNITS)).toEqual({ error: expect.stringMatching(/eigene Heizkostenabrechnung kommt mit einer späteren Version/) })
    expect(whoHint('self', 'mfh')).toMatch(/späteren Version/)
  })

  test('Eigentumswohnung: die Gemeinschaft rechnet ab, übernommen wie vom Messdienst', () => {
    expect(whoOptions('etw')[0]).toEqual({ value: 'homeowners', label: 'Die Gemeinschaft (Hausverwaltung) rechnet ab' })
    expect(whoOptions('mfh').some((o) => o.value === 'homeowners')).toBe(false)
    expect(heatingPlantBody(ausgefuellt({ who: 'homeowners' }), UNITS)).toMatchObject({ body: { method: 'service', source: 'homeowners' } })
  })

  test('Wärmepumpe: Erfassung und Durchschnittskosten nur bei ihr', () => {
    expect(heatingPlantBody(ausgefuellt({ energy: 'heatPump', captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' }), UNITS))
      .toMatchObject({ body: { capturedOnOct2024: false, captureInstalledOn: '2025-06-01', warmRentAverageCents: 123456 } })
    expect(heatingPlantBody(ausgefuellt({ captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' }), UNITS))
      .toMatchObject({ body: { capturedOnOct2024: null, captureInstalledOn: null, warmRentAverageCents: null } })
    expect(heatingPlantBody(ausgefuellt({ energy: 'heatPump', warmRentAverage: 'viel' }), UNITS)).toEqual({ error: expect.stringMatching(/Betrag/) })
  })

  test('Niemand: der Satz nennt die Regel der Verordnung, im Zweifamilienhaus auch § 2', () => {
    expect(whoHint('manual', 'mfh')).toMatch(/50 bis 70 % der Heizkosten nach Verbrauch/)
    expect(whoHint('manual', 'mfh')).toMatch(/um 15 % kürzen/)
    expect(whoHint('manual', 'mfh')).not.toMatch(/§ 2/)
    expect(whoHint('manual', 'zfh')).toMatch(/§ 2 HeizkostenV/)
  })

  test('Bearbeiten: was gespeichert ist, steht wieder im Formular und geht unverändert zurück', () => {
    const form = heatingToForm(PLANT, UNITS)
    expect(form).toMatchObject({ energy: 'heatPump', who: 'service', unitIds: ['og'], remote: 'partial', installedAfter: 'some', captured: 'no', captureInstalledOn: '2025-06-01', warmRentAverage: '1.234,56' })
    expect(heatingPlantBody(form, UNITS)).toMatchObject({ body: { units: [{ unitId: 'og', heatedAreaM2: null }], warmRentAverageCents: 123456, capturedOnOct2024: false } })
    expect(heatingToForm({ ...PLANT, units: null }, UNITS).unitIds).toEqual(['eg', 'og'])
    expect(heatingToForm({ ...PLANT, source: 'homeowners' }, UNITS).who).toBe('homeowners')
  })

  test('Zusammenfassung auf der Karte', () => {
    expect(heatingSummary(PLANT, UNITS)).toEqual([
      'Energie: Wärmepumpe',
      'Abrechnung: Ein Messdienst oder die Hausverwaltung',
      'Angeschlossen: OG',
      'Aus der Ferne ablesbar: Nur einige',
    ])
    expect(heatingSummary({ ...PLANT, units: null }, UNITS)[2]).toBe('Angeschlossen: alle Wohnungen')
    expect(heatingSummary({ ...PLANT, units: [] }, UNITS)[2]).toBe('Angeschlossen: keine Wohnung')
  })
})
```

`client/src/components/HeatingCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Karte „Heizung“ (Heizung PR 4). Geprüft wird, was reine Logik nicht sieht: Der angezeigte Wert
// jedes Auswahlfelds ist der gespeicherte, und das Anlegen schickt die Positionen der Vorschau mit.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AssignableHeatingItem, HeatingPlant, Unit } from '../types'
import { PropertyProvider } from '../property'
import { periodKey } from '../../../shared/period.ts'
import HeatingCard from './HeatingCard'

const UNITS: Unit[] = [
  { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 70, participates: true },
]
const PLANT: HeatingPlant = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'districtHeating', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'partial', devicesInstalledAfter2021: 'some', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, units: null,
}
const ITEM: AssignableHeatingItem = { id: 'c1', period: periodKey('2025-01'), description: 'Fernwärme 2025', amountCents: 240000 }

let plants: HeatingPlant[]
let sent: { method: string; url: string; body: Record<string, unknown> }[]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  plants = []
  sent = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (method !== 'GET') {
      sent.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return json({ plant: PLANT, assigned: 1 }, 201)
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/heating-plants/assignable') return json([ITEM])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderCard = () => render(<PropertyProvider><HeatingCard units={UNITS} /></PropertyProvider>)
const valueOf = (label: RegExp): string => {
  const field = screen.getByLabelText(label)
  if (!(field instanceof HTMLSelectElement)) throw new Error(`kein Auswahlfeld: ${label}`)
  return field.value
}

test('Bearbeiten: jedes Auswahlfeld zeigt den gespeicherten Wert', async () => {
  plants = [PLANT]
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Ändern' }))
  expect(valueOf(/Womit wird geheizt/)).toBe('districtHeating')
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('manual')
  expect(valueOf(/aus der Ferne ablesbar/)).toBe('partial')
  expect(valueOf(/nach dem 01\.12\.2021 eingebaut/)).toBe('some')
})

test('Einrichten: Fragen ohne Vorauswahl, und das Anlegen nimmt die Positionen der Vorschau mit', async () => {
  renderCard()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Heizung einrichten' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Heizung einrichten' }))
  await waitFor(() => expect(screen.getByText(/Diese Heizposition kommt zur Anlage/)).toBeTruthy())
  expect(valueOf(/Womit wird geheizt/)).toBe('')
  expect(valueOf(/Wer erstellt Ihre Heizkostenabrechnung/)).toBe('')
  fireEvent.change(screen.getByLabelText(/Womit wird geheizt/), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.method).toBe('POST')
  expect(sent[0]?.body).toMatchObject({ energy: 'gas', method: 'service', source: 'building', units: null, assignItemIds: ['c1'] })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingForm HeatingCard`
Expected: FAIL mit `Failed to resolve import "./heatingForm"` und `"./HeatingCard"`.

- [ ] **Step 3: Logik (`client/src/heatingForm.ts`)**

```ts
// Die Einrichtung „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2), ohne DOM prüfbar
// (heatingForm.test.ts). Gefragt wird in der Reihenfolge des Entwurfs: womit geheizt wird
// (Schritt 1), wer die Heizkostenabrechnung erstellt (2), welche Wohnungen angeschlossen sind (4),
// ob die Geräte aus der Ferne ablesbar sind (5) und bei einer Wärmepumpe, seit wann ihr Verbrauch
// erfasst wird (6). Schritt 3 (eigener Zeitraum) kommt mit Heizung PR 5, Schritt 7 (eigene
// Abrechnung) mit PR 10. Nichts davon ändert eine Zahl der Abrechnung.
import type { DevicesInstalledAfter, DevicesRemote, HeatingEnergy, HeatingPlant, PropertyKind, Unit } from './types'
import { parseEuro } from './api'
import { hkvConsumptionShare, hkvCutNotByConsumption, hkvRemoteReadingNewDevices } from '../../shared/law/heizkostenv.ts'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'

// Rechtszahlen aus dem Register, in der Fassung von heute (wie Lexikon und Anleitungen).
const SHARE = valueAt(hkvConsumptionShare, LAW_AS_OF)
const CUT = valueAt(hkvCutNotByConsumption, LAW_AS_OF)
export const NEW_DEVICES_AFTER = germanDate(valueAt(hkvRemoteReadingNewDevices, LAW_AS_OF).installedAfter)

export type EnergyAnswer = HeatingEnergy | 'perUnit'
export type PerUnitContract = '' | 'tenant' | 'landlord'
export type WhoSettles = '' | 'service' | 'homeowners' | 'self' | 'manual'
export type CaptureAnswer = 'unknown' | 'yes' | 'no'

export type HeatingForm = {
  energy: EnergyAnswer | ''
  contract: PerUnitContract
  who: WhoSettles
  unitIds: string[]
  remote: DevicesRemote
  installedAfter: DevicesInstalledAfter
  captured: CaptureAnswer
  captureInstalledOn: string
  warmRentAverage: string
}

// Was die Einrichtung schickt. Die übrigen Felder der Anlage behalten ihre Vorgabe.
export type HeatingPlantBody = Pick<
  HeatingPlant,
  'energy' | 'supply' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'capturedOnOct2024' | 'captureInstalledOn' | 'warmRentAverageCents' | 'units'
>
// `none`: Es entsteht bewusst keine Anlage, und der Satz sagt warum.
export type HeatingResult = { body: HeatingPlantBody } | { error: string } | { none: string }

type UnitInfo = Pick<Unit, 'id' | 'noConnection'>

export const ENERGY_OPTIONS: { value: EnergyAnswer; label: string }[] = [
  { value: 'gas', label: 'Gas' },
  { value: 'oil', label: 'Öl' },
  { value: 'lpg', label: 'Flüssiggas' },
  { value: 'districtHeating', label: 'Fernwärme' },
  { value: 'heatPump', label: 'Wärmepumpe' },
  { value: 'pellets', label: 'Pellets' },
  { value: 'wood', label: 'Holz (Scheitholz, Hackschnitzel)' },
  { value: 'electric', label: 'Strom (Nachtspeicher, Elektroheizung)' },
  { value: 'coal', label: 'Kohle' },
  { value: 'other', label: 'Etwas anderes' },
  { value: 'perUnit', label: 'Jede Wohnung hat eine eigene Heizung' },
]

export const CONTRACT_OPTIONS: { value: Exclude<PerUnitContract, ''>; label: string }[] = [
  { value: 'tenant', label: 'Der Mieter hat den Vertrag, etwa für die Gastherme' },
  { value: 'landlord', label: 'Ich habe den Vertrag und lege die Kosten um' },
]

export function whoOptions(kind: PropertyKind): { value: Exclude<WhoSettles, ''>; label: string }[] {
  const options: { value: Exclude<WhoSettles, ''>; label: string }[] = [
    { value: 'service', label: 'Ein Messdienst oder die Hausverwaltung' },
    { value: 'self', label: 'Ich selbst, mit Zählern oder Heizkostenverteilern' },
    { value: 'manual', label: 'Niemand, die Heizkosten werden nach Fläche oder fest verteilt' },
  ]
  // Bei einer vermieteten Eigentumswohnung liefert die Gemeinschaft die Abrechnung (Entwurf 11.2, D-F2).
  return kind === 'etw' ? [{ value: 'homeowners', label: 'Die Gemeinschaft (Hausverwaltung) rechnet ab' }, ...options] : options
}

export const REMOTE_OPTIONS: { value: DevicesRemote; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'partial', label: 'Nur einige' },
  { value: 'none', label: 'Nein' },
]

export const INSTALLED_OPTIONS: { value: DevicesInstalledAfter; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'all', label: 'Ja, alle' },
  { value: 'some', label: 'Einige' },
  { value: 'none', label: 'Nein, alle früher' },
]

export const CAPTURE_OPTIONS: { value: CaptureAnswer; label: string }[] = [
  { value: 'unknown', label: 'Weiß ich nicht' },
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
]

const LATER_SELF = 'Die eigene Heizkostenabrechnung kommt mit einer späteren Version. Wählen Sie bis dahin „Ein Messdienst oder die Hausverwaltung“ oder „Niemand“; an Ihren Beträgen ändert sich dadurch nichts.'
const LATER_PER_UNIT = 'Etagenheizungen mit Vertrag auf den Vermieter kommen mit einer späteren Version. Bis dahin erfassen Sie ihre Kosten wie bisher, etwa direkt bei der Wohnung.'
const SELF_SUPPLY = 'Hat jeder Mieter einen eigenen Vertrag für seine Heizung, gibt es keine Heizkostenabrechnung des Hauses, und Mietfuchs legt keine Heizanlage an. Was Mieter für CO₂-Kosten vom Vermieter verlangen können, erklärt Mietfuchs mit einer späteren Version.'

// Der Satz unter der zweiten Frage.
export function whoHint(who: WhoSettles, kind: PropertyKind): string {
  if (who === 'self') return LATER_SELF
  if (who === 'service') return 'Die Abrechnung des Messdienstes übernehmen Sie wie bisher als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“.'
  if (who === 'homeowners') return 'Die Abrechnung der Gemeinschaft übernehmen Sie wie die eines Messdienstes: als Position „Heizung und Warmwasser“ mit dem Schlüssel „Einzelbeträge“, mit den Beträgen der Hausgeldabrechnung.'
  if (who === 'manual') {
    const rule = `Die Heizkostenverordnung verlangt, ${SHARE.min} bis ${SHARE.max} % der Heizkosten nach Verbrauch zu verteilen; sonst darf jeder Mieter seinen Anteil um ${CUT} % kürzen. Mietfuchs rechnet wie bisher und sagt es in der Abrechnung.`
    return kind === 'zfh'
      ? `${rule} Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren (§ 2 HeizkostenV).`
      : rule
  }
  return ''
}

// „Alle Wohnungen“ heißt: alle ohne „kein Anschluss: Wärme“ (#117), wie beim Server ohne Liste.
export const defaultUnitIds = (units: readonly UnitInfo[]): string[] =>
  units.filter((u) => !(u.noConnection ?? []).includes('waerme')).map((u) => u.id)

export function emptyHeatingForm(units: readonly UnitInfo[]): HeatingForm {
  return {
    energy: '', contract: '', who: '', unitIds: defaultUnitIds(units), remote: 'unknown', installedAfter: 'unknown',
    captured: 'unknown', captureInstalledOn: '', warmRentAverage: '',
  }
}

const centsText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function heatingToForm(plant: HeatingPlant, units: readonly UnitInfo[]): HeatingForm {
  return {
    energy: plant.energy,
    contract: '',
    who: plant.source === 'homeowners' ? 'homeowners' : plant.method,
    unitIds: plant.units === null ? defaultUnitIds(units) : plant.units.map((u) => u.unitId),
    remote: plant.devicesRemote,
    installedAfter: plant.devicesInstalledAfter2021,
    captured: plant.capturedOnOct2024 === null ? 'unknown' : plant.capturedOnOct2024 ? 'yes' : 'no',
    captureInstalledOn: plant.captureInstalledOn ?? '',
    warmRentAverage: plant.warmRentAverageCents === null ? '' : centsText(plant.warmRentAverageCents),
  }
}

export function heatingPlantBody(form: HeatingForm, units: readonly UnitInfo[]): HeatingResult {
  if (form.energy === '') return { error: 'Bitte wählen Sie, womit geheizt wird.' }
  if (form.energy === 'perUnit') {
    if (form.contract === '') return { error: 'Wer hat den Vertrag für die Heizung in der Wohnung?' }
    return form.contract === 'tenant' ? { none: SELF_SUPPLY } : { error: LATER_PER_UNIT }
  }
  const energy: HeatingEnergy = form.energy
  const who = form.who
  if (who === '') return { error: 'Bitte wählen Sie, wer die Heizkostenabrechnung erstellt.' }
  if (who === 'self') return { error: LATER_SELF }
  if (form.unitIds.length === 0) return { error: 'Bitte haken Sie mindestens eine Wohnung an, die an dieser Heizung hängt.' }
  const heatPump = energy === 'heatPump'
  const averageText = heatPump ? form.warmRentAverage.trim() : ''
  const average = averageText === '' ? null : parseEuro(averageText)
  if (averageText !== '' && (average === null || average < 0)) {
    return { error: 'Bitte geben Sie die durchschnittlichen Heizkosten als Betrag ein, etwa 1.234,56.' }
  }
  const all = defaultUnitIds(units)
  const allServed = form.unitIds.length === all.length && all.every((id) => form.unitIds.includes(id))
  return {
    body: {
      energy,
      supply: 'central',
      method: who === 'homeowners' ? 'service' : who,
      source: who === 'homeowners' ? 'homeowners' : 'building',
      devicesRemote: form.remote,
      devicesInstalledAfter2021: form.installedAfter,
      capturedOnOct2024: heatPump && form.captured !== 'unknown' ? form.captured === 'yes' : null,
      captureInstalledOn: heatPump && form.captured === 'no' && form.captureInstalledOn !== '' ? form.captureInstalledOn : null,
      warmRentAverageCents: average,
      units: allServed ? null : form.unitIds.map((unitId) => ({ unitId, heatedAreaM2: null })),
    },
  }
}

// Die Zeilen der Karte, wenn eine Anlage eingerichtet ist.
export function heatingSummary(plant: HeatingPlant, units: readonly Pick<Unit, 'id' | 'name'>[]): string[] {
  const energy = ENERGY_OPTIONS.find((o) => o.value === plant.energy)?.label ?? plant.energy
  const who = plant.source === 'homeowners'
    ? 'Die Gemeinschaft (Hausverwaltung) rechnet ab'
    : (whoOptions('mfh').find((o) => o.value === plant.method)?.label ?? plant.method)
  const served = plant.units === null
    ? 'alle Wohnungen'
    : plant.units.length === 0
      ? 'keine Wohnung'
      : plant.units.map((u) => units.find((x) => x.id === u.unitId)?.name ?? u.unitId).join(', ')
  const remote = REMOTE_OPTIONS.find((o) => o.value === plant.devicesRemote)?.label ?? plant.devicesRemote
  return [`Energie: ${energy}`, `Abrechnung: ${who}`, `Angeschlossen: ${served}`, `Aus der Ferne ablesbar: ${remote}`]
}
```

- [ ] **Step 4: Karte (`client/src/components/HeatingCard.tsx`)**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { AssignableHeatingItem, DevicesInstalledAfter, DevicesRemote, HeatingPlant, Unit } from '../types'
import { api, errorText, fmtEuro } from '../api'
import { useProperty, withProperty } from '../property'
import { periodLabel, periodOfKey, rulesOf } from '../../../shared/period.ts'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import Term from './Term'
import {
  CAPTURE_OPTIONS, CONTRACT_OPTIONS, ENERGY_OPTIONS, INSTALLED_OPTIONS, NEW_DEVICES_AFTER, REMOTE_OPTIONS, emptyHeatingForm, heatingPlantBody,
  heatingSummary, heatingToForm, whoHint, whoOptions, type CaptureAnswer, type EnergyAnswer, type HeatingForm, type PerUnitContract, type WhoSettles,
} from '../heatingForm'

// Die Karte „Heizung“ in den Stammdaten (Heizung PR 4, Entwurf 11.2). Ohne Anlage ein Satz und der
// Knopf „Heizung einrichten“; nichts davon ist Pflicht, und an keiner Zahl ändert sich etwas (11.1).
// Beim Anlegen zeigt die Einrichtung, welche Heizpositionen zur Anlage kommen (Vorschau, 3.0); der
// Server nimmt genau diese, oder er lehnt ab, wenn sich die Liste inzwischen geändert hat.
export default function HeatingCard({ units }: { units: Unit[] }) {
  const { property } = useProperty()
  const propertyId = property?.id
  const toast = useToast()
  const confirm = useConfirm()
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [form, setForm] = useState<HeatingForm | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [assignable, setAssignable] = useState<AssignableHeatingItem[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setPlants(await api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)))
  }, [propertyId])

  useEffect(() => {
    load().catch((e) => setError(errorText(e)))
  }, [load])

  async function openNew() {
    setError('')
    try {
      setAssignable(await api<AssignableHeatingItem[]>(withProperty('/api/heating-plants/assignable', propertyId)))
    } catch (e) {
      setError(errorText(e))
      return
    }
    setEditingId(null)
    setForm(emptyHeatingForm(units))
  }

  function openEdit(p: HeatingPlant) {
    setError('')
    setAssignable([])
    setEditingId(p.id)
    setForm(heatingToForm(p, units))
  }

  function close() {
    setError('')
    setForm(null)
  }

  async function save() {
    if (!form) return
    const result = heatingPlantBody(form, units)
    if ('error' in result) {
      setError(result.error)
      return
    }
    if ('none' in result) {
      close()
      toast(result.none)
      return
    }
    try {
      if (editingId) {
        await api(`/api/heating-plants/${editingId}`, { method: 'PUT', body: JSON.stringify(result.body) })
      } else {
        await api(withProperty('/api/heating-plants', propertyId), {
          method: 'POST',
          body: JSON.stringify({ ...result.body, assignItemIds: assignable.map((i) => i.id) }),
        })
      }
    } catch (e) {
      setError(errorText(e))
      return
    }
    const created = editingId === null
    close()
    await load()
    toast(created ? 'Heizung eingerichtet. An Ihren Beträgen ändert sich nichts.' : 'Heizung gespeichert.')
  }

  async function remove(p: HeatingPlant) {
    const ok = await confirm({
      title: 'Heizanlage entfernen?',
      message: 'Die Heizpositionen bleiben, wie sie sind, nur ohne Heizanlage. Zähler der Anlage lösen Sie vorher auf der Seite Zähler.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/heating-plants/${p.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(errorText(e))
      return
    }
    setError('')
    await load()
    toast('Heizanlage entfernt.')
  }

  const kind = property?.kind ?? 'mfh'
  const periodText = (key: AssignableHeatingItem['period']): string => {
    const p = periodOfKey(rulesOf(property), key)
    return p ? periodLabel(p) : key
  }

  return (
    <div className="card">
      <h2><Term id="heatingSystem">Heizung</Term></h2>
      {error && !form && <div className="error">{error}</div>}
      {plants.length === 0 && (
        <>
          <p className="muted">
            Optional. Wenn Sie hier angeben, womit geheizt wird und wer abrechnet, sagt die Abrechnung, ob Mieter wegen nicht
            fernablesbarer Geräte kürzen dürfen. An Ihren Beträgen ändert sich dadurch nichts.
          </p>
          <button className="btn secondary" onClick={openNew}>Heizung einrichten</button>
        </>
      )}
      {plants.map((p) => (
        <div key={p.id}>
          <ul>{heatingSummary(p, units).map((line) => <li key={line}>{line}</li>)}</ul>
          <div className="row">
            <button className="btn ghost" onClick={() => openEdit(p)}>Ändern</button>
            <button className="btn ghost" onClick={() => remove(p)}>Entfernen</button>
          </div>
        </div>
      ))}
      {form && (
        <Drawer
          open
          title={editingId ? 'Heizung ändern' : 'Heizung einrichten'}
          onClose={close}
          onSubmit={save}
          footer={
            <>
              <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
              <span className="spacer" />
              <button className="btn ghost" onClick={close}>Abbrechen</button>
              <button className="btn" onClick={save}>{editingId ? 'Übernehmen' : 'Anlegen'}</button>
            </>
          }
        >
          {error && <div className="error">{error}</div>}
          <label className="field grow">
            Womit wird geheizt?
            <select value={form.energy} onChange={(e) => setForm({ ...form, energy: e.target.value as EnergyAnswer | '' })}>
              <option value="">— bitte wählen —</option>
              {ENERGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {form.energy === 'perUnit' ? (
            <label className="field grow">
              Wer hat den Vertrag für die Heizung in der Wohnung?
              <select value={form.contract} onChange={(e) => setForm({ ...form, contract: e.target.value as PerUnitContract })}>
                <option value="">— bitte wählen —</option>
                {CONTRACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="field grow">
                Wer erstellt Ihre Heizkostenabrechnung?
                <select value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value as WhoSettles })}>
                  <option value="">— bitte wählen —</option>
                  {whoOptions(kind).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {whoHint(form.who, kind) && <p className="muted">{whoHint(form.who, kind)}</p>}
              <fieldset className="field grow no-connection">
                <legend className="field-legend">Welche Wohnungen hängen an dieser Heizung?</legend>
                <div className="row" style={{ gap: 10 }}>
                  {units.map((u) => (
                    <label key={u.id} className="checkline">
                      <input
                        type="checkbox"
                        checked={form.unitIds.includes(u.id)}
                        onChange={(e) => setForm({ ...form, unitIds: e.target.checked ? [...form.unitIds, u.id] : form.unitIds.filter((id) => id !== u.id) })}
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field grow">
                Sind die Zähler und Heizkostenverteiler aus der Ferne ablesbar?
                <select value={form.remote} onChange={(e) => setForm({ ...form, remote: e.target.value as DevicesRemote })}>
                  {REMOTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <small className="muted">Woran erkenne ich das? Fernablesbare Geräte liest der Messdienst per Funk ab, ohne die Wohnungen zu betreten. Im Zweifel fragen Sie Ihren Messdienst.</small>
              </label>
              <label className="field grow">
                {`Wurden sie nach dem ${NEW_DEVICES_AFTER} eingebaut?`}
                <select value={form.installedAfter} onChange={(e) => setForm({ ...form, installedAfter: e.target.value as DevicesInstalledAfter })}>
                  {INSTALLED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {form.energy === 'heatPump' && (
                <>
                  <label className="field grow">
                    Wurde der Verbrauch der Wärmepumpe am 01.10.2024 schon erfasst?
                    <select value={form.captured} onChange={(e) => setForm({ ...form, captured: e.target.value as CaptureAnswer })}>
                      {CAPTURE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  {form.captured === 'no' && (
                    <label className="field grow">
                      Seit wann wird er erfasst?
                      <input type="date" value={form.captureInstalledOn} onChange={(e) => setForm({ ...form, captureInstalledOn: e.target.value })} />
                    </label>
                  )}
                  <label className="field grow">
                    Nur bei Warmmiete ohne Abrechnung: durchschnittliche Heizkosten 2022 bis 2024 (€ im Jahr)
                    <input inputMode="decimal" value={form.warmRentAverage} onChange={(e) => setForm({ ...form, warmRentAverage: e.target.value })} />
                    <small className="muted">Bei einer Bruttowarmmiete bestimmt § 12 Abs. 3 HeizkostenV, wie diese Kosten zu ermitteln sind. Mietfuchs rechnet damit in einer späteren Version; tragen Sie den Betrag ein, sobald Sie ihn kennen.</small>
                  </label>
                </>
              )}
              {!editingId && assignable.length > 0 && (
                <div className="muted">
                  {assignable.length === 1 ? 'Diese Heizposition kommt zur Anlage' : `Diese ${assignable.length} Heizpositionen kommen zur Anlage`}; an den Beträgen ändert sich nichts:
                  <ul>{assignable.map((i) => <li key={i.id}>{periodText(i.period)}: {i.description} ({fmtEuro(i.amountCents)})</li>)}</ul>
                </div>
              )}
            </>
          )}
        </Drawer>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Stammdaten (`client/src/pages/Stammdaten.tsx`)**

`import HeatingCard from '../components/HeatingCard'` ergänzen und direkt vor der Karte
`<div className="card">` mit `<h2>Mietverhältnisse</h2>` einfügen:

```tsx
      {/* Heizung PR 4: optional, nach den Wohnungen, weil Schritt 4 nach ihnen fragt. */}
      <HeatingCard units={units} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingForm HeatingCard Stammdaten && npm run typecheck && npm --prefix server test -- test/law-literals.test.ts test/anrede.test.ts`
Expected: PASS. Der Wächter `law-literals.test.ts` findet in den neuen Dateien keine Rechtszahl als
Literal (die Prozente stehen als `${…}`), `anrede.test.ts` keine Du-Form. Fragt
`Stammdaten.test.tsx` über einen eigenen `fetch`-Stub ab, liefert der für
`/api/heating-plants` die leere Liste über seinen Rückfall `json([])`; sonst dort die Zeile
`if (path === '/api/heating-plants') return json([])` ergänzen.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

```bash
git add client/src/heatingForm.ts client/src/heatingForm.test.ts client/src/components/HeatingCard.tsx client/src/components/HeatingCard.test.tsx client/src/pages/Stammdaten.tsx
git commit -m "Oberfläche: Einrichtung Heizung in den Stammdaten

Womit geheizt wird, wer abrechnet, welche Wohnungen angeschlossen sind, Fernablesbarkeit und bei der
Wärmepumpe die Erfassung. Beim Anlegen zeigt die Einrichtung, welche Heizpositionen zur Anlage kommen.

Refs #99, #214"
```

---

### Task 11: Oberfläche: Zähler und Kosten

Am Zähler: Warmwasser und Heizkostenverteiler als Sparte (aus Task 2), dazu „Gehört zur
Heizanlage?“ bei einem Zähler ohne Wohnung, „Aus der Ferne ablesbar?“ und „Eingebaut am“ bei den
Geräten, die § 5 HeizkostenV erfasst. In den Kosten steht der Heizkostenverteiler nicht als
Zählertyp zur Wahl (Review Focus 5).

**Files:**
- Modify: `client/src/meterForm.ts`, `client/src/pages/Zaehler.tsx`, `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`
- Test: `client/src/meterForm.test.ts`, `client/src/costForm.test.ts`

**Interfaces:**
- Consumes (Task 2, 4, 6): `Meter` mit `heatingPlantId`, `heatingRole`, `remoteReadable`, `installedOn`; `HeatingRole`; Route `GET /api/heating-plants`.
- Produces: `MeterForm` mit `heatingRole: HeatingRole | ''`, `remote: RemoteAnswer`, `installedOn: string`; `RemoteAnswer = '' | 'yes' | 'no'`; `meterToForm(m: Meter): MeterForm`; `meterBody(form, plantId: string | null): { body: MeterBody } | { error: string }`; `asksRemote(form): boolean`; `HEATING_ROLE_LABELS: Record<HeatingRole, string>`; `costMeterTypes(meters): MeterType[]`.

- [ ] **Step 1: Write the failing tests**

`client/src/meterForm.test.ts`: den Import ersetzen durch
`import { defaultMeterUnit, emptyMeterForm, meterBody, meterToForm, oldEndText, withMeterType } from './meterForm'`.
In den beiden Tests mit Formular-Literalen die Literale über die Vorgabe bauen:
`const form = { name: 'Wärme EG', unitId: '', type: 'kaltwasser' as const, meterNumber: '', unit: 'm³' }`
wird `const form = { ...emptyMeterForm(), name: 'Wärme EG' }`, und
`const vorhanden = { id: 'm1', name: 'Zähler', unitId: '', type: 'kaltwasser' as const, meterNumber: '', unit: 'm³' }`
wird `const vorhanden = { ...emptyMeterForm(), id: 'm1', name: 'Zähler' }`. Anhängen:

```ts
test('Zähler der Heizanlage: nur ohne Wohnung und mit Anlage; Fernablesbarkeit nur bei Geräten nach § 5 HeizkostenV', () => {
  const speicher = { ...emptyMeterForm(), name: 'Speicher', type: 'waerme' as const, unit: 'kWh', heatingRole: 'dhwHeat' as const, remote: 'no' as const, installedOn: '2022-03-01' }
  expect(meterBody(speicher, 'hp1')).toEqual({
    body: { name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01' },
  })
  // Ohne Anlage im Objekt bleibt es ein Hauptzähler, und dann fragt das Formular nicht nach § 5.
  expect(meterBody(speicher, null)).toMatchObject({ body: { heatingPlantId: null, heatingRole: null, remoteReadable: null, installedOn: null } })
  // Der Gaszähler gehört dem Versorger: Rolle ja, Fernablesbarkeit nein.
  expect(meterBody({ ...speicher, name: 'Gas', type: 'sonstig', heatingRole: 'supply' }, 'hp1'))
    .toMatchObject({ body: { heatingPlantId: 'hp1', heatingRole: 'supply', remoteReadable: null, installedOn: null } })
  // An einer Wohnung: Kaltwasser ohne, Heizkostenverteiler mit Fernablesbarkeit.
  expect(meterBody({ ...emptyMeterForm(), name: 'Küche', unitId: 'eg', remote: 'yes' }, 'hp1')).toMatchObject({ body: { unitId: 'eg', heatingPlantId: null, remoteReadable: null } })
  const hkv = { ...emptyMeterForm(), name: 'HKV Bad', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten', remote: 'yes' as const }
  expect(meterBody(hkv, 'hp1')).toMatchObject({ body: { remoteReadable: true, heatingPlantId: null } })
  expect(meterBody({ ...hkv, unitId: '' }, 'hp1')).toEqual({ error: expect.stringMatching(/Heizkörper/) })
  expect(meterBody({ ...hkv, name: ' ' }, 'hp1')).toEqual({ error: 'Bitte einen Namen für den Zähler angeben.' })
})

test('Bearbeiten: was gespeichert ist, steht wieder im Formular', () => {
  expect(meterToForm({
    id: 'm1', propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
    heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
  })).toEqual({ id: 'm1', name: 'Speicher', unitId: '', type: 'waerme', meterNumber: '', unit: 'kWh', heatingRole: 'dhwHeat', remote: 'no', installedOn: '2022-03-01' })
})
```

`client/src/costForm.test.ts`: `costMeterTypes` zum Import aus `'./costForm'` ergänzen und im
Block `describe('Auswahllisten enthalten immer den gewählten Wert', …)` anhängen:

```ts
  test('Heizkostenverteiler stehen als Zählertyp nicht zur Wahl, Warmwasser schon (Heizung PR 4)', () => {
    expect(costMeterTypes([{ type: 'hkv', unitId: 'u1' }, { type: 'warmwasser', unitId: 'u1' }, { type: 'kaltwasser', unitId: null }])).toEqual(['warmwasser'])
    expect(costMeterTypes([{ type: 'hkv', unitId: 'u1' }])).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- meterForm costForm`
Expected: FAIL: `meterBody`, `meterToForm` und `costMeterTypes` sind keine Exporte.

- [ ] **Step 3: Implement (`client/src/meterForm.ts`)**

Den Typimport durch `import type { HeatingRole, Meter, MeterType } from './types'` ersetzen. `MeterForm`
und `emptyMeterForm` ersetzen, die übrigen Funktionen bleiben:

```ts
// Fernablesbar? Leer heißt „weiß ich nicht“.
export type RemoteAnswer = '' | 'yes' | 'no'

export type MeterForm = {
  id?: string
  name: string
  unitId: string
  type: MeterType
  meterNumber: string
  unit: string
  // Heizung PR 4: Rolle an der Heizanlage (nur ohne Wohnung), Fernablesbarkeit und Einbau.
  heatingRole: HeatingRole | ''
  remote: RemoteAnswer
  installedOn: string
}
```

```ts
export const emptyMeterForm = (): MeterForm => ({
  name: '', unitId: '', type: 'kaltwasser', meterNumber: '', unit: defaultMeterUnit('kaltwasser'), heatingRole: '', remote: '', installedOn: '',
})

export const meterToForm = (m: Meter): MeterForm => ({
  id: m.id,
  name: m.name,
  unitId: m.unitId ?? '',
  type: m.type,
  meterNumber: m.meterNumber ?? '',
  unit: m.unit,
  heatingRole: m.heatingRole ?? '',
  remote: m.remoteReadable === true ? 'yes' : m.remoteReadable === false ? 'no' : '',
  installedOn: m.installedOn ?? '',
})

export const HEATING_ROLE_LABELS: Record<HeatingRole, string> = {
  supply: 'Versorgungszähler der Heizanlage (etwa der Gaszähler)',
  dhwHeat: 'Wärmezähler für das Warmwasser an der Heizanlage',
  totalHeat: 'Gesamtwärmezähler an der Heizanlage',
}

// Fernablesbarkeit und Einbau fragt das Formular nur bei Geräten, die § 5 HeizkostenV erfasst:
// Wärme- und Warmwasserzähler und Heizkostenverteiler der Wohnungen, dazu die Wärmezähler der
// Heizanlage. Der Gaszähler gehört dem Versorger.
export function asksRemote(form: MeterForm): boolean {
  if (form.unitId) return form.type === 'waerme' || form.type === 'warmwasser' || form.type === 'hkv'
  return form.heatingRole === 'dhwHeat' || form.heatingRole === 'totalHeat'
}

export type MeterBody = {
  name: string
  unitId: string | null
  type: MeterType
  meterNumber?: string
  unit: string
  heatingPlantId: string | null
  heatingRole: HeatingRole | null
  remoteReadable: boolean | null
  installedOn: string | null
}

// Der Rumpf zum Speichern. `plantId`: die Heizanlage des Objekts, `null` ohne. Eine Zählernummer
// fehlt im Rumpf, wenn das Feld leer ist, wie bisher.
export function meterBody(form: MeterForm, plantId: string | null): { body: MeterBody } | { error: string } {
  if (!form.name.trim()) return { error: 'Bitte einen Namen für den Zähler angeben.' }
  if (form.type === 'hkv' && !form.unitId) {
    return { error: 'Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung. Bitte wählen Sie die Wohnung.' }
  }
  const role = !form.unitId && plantId !== null && form.heatingRole !== '' ? form.heatingRole : null
  const asks = asksRemote({ ...form, heatingRole: role ?? '' })
  const number = form.meterNumber.trim()
  return {
    body: {
      name: form.name.trim(),
      unitId: form.unitId || null,
      type: form.type,
      ...(number ? { meterNumber: number } : {}),
      // Ohne Angabe die Vorgabe der Sparte (#142), nicht für jede Sparte „m³“.
      unit: form.unit.trim() || defaultMeterUnit(form.type),
      heatingPlantId: role === null ? null : plantId,
      heatingRole: role,
      remoteReadable: asks && form.remote !== '' ? form.remote === 'yes' : null,
      installedOn: asks && form.installedOn !== '' ? form.installedOn : null,
    },
  }
}
```

- [ ] **Step 4: Implement (`client/src/pages/Zaehler.tsx`)**

Importe: aus `'../meterForm'` zusätzlich `asksRemote, HEATING_ROLE_LABELS, meterBody, meterToForm,
type RemoteAnswer`; `HeatingPlant`, `HeatingRole` als Typen aus `'../types'`.

Zustand und Laden: `const [plants, setPlants] = useState<HeatingPlant[]>([])`; in `load` das
`Promise.all` um `api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId))` ergänzen und
das Ergebnis mit `setPlants(…)` setzen.

In `saveMeter` den Block von `if (!meterForm.name.trim()) {` bis einschließlich der Zeile mit
`const body = JSON.stringify({ … })` ersetzen durch:

```ts
    // Die Heizanlage des Objekts; in dieser Version gibt es höchstens eine (Heizung PR 4).
    const result = meterBody(meterForm, plants[0]?.id ?? null)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError('')
    const body = JSON.stringify(result.body)
```

`onEdit` der Zeile: `setMeterForm(meterToForm(m))` statt des Objektliterals.

Im Drawer hinter dem Feld „Einheit“ (vor dem schließenden `</div>` der `row`):

```tsx
            {!meterForm.unitId && plants.length > 0 && (
              <label className="field grow">
                Gehört zur Heizanlage?
                <select value={meterForm.heatingRole} onChange={(e) => setMeterForm({ ...meterForm, heatingRole: e.target.value as HeatingRole | '' })}>
                  <option value="">Nein, Hauptzähler des Hauses</option>
                  {(Object.keys(HEATING_ROLE_LABELS) as HeatingRole[]).map((r) => <option key={r} value={r}>{HEATING_ROLE_LABELS[r]}</option>)}
                </select>
              </label>
            )}
            {asksRemote(meterForm) && (
              <>
                <label className="field grow">
                  Aus der Ferne ablesbar?
                  <select value={meterForm.remote} onChange={(e) => setMeterForm({ ...meterForm, remote: e.target.value as RemoteAnswer })}>
                    <option value="">Weiß ich nicht</option>
                    <option value="yes">Ja</option>
                    <option value="no">Nein</option>
                  </select>
                </label>
                <label className="field grow">
                  Eingebaut am
                  <input type="date" value={meterForm.installedOn} onChange={(e) => setMeterForm({ ...meterForm, installedOn: e.target.value })} />
                  <small className="muted">Für die Kürzung nach § 12 HeizkostenV: Neuere Geräte müssen ab dem Einbau aus der Ferne ablesbar sein, ältere ab 2027.</small>
                </label>
              </>
            )}
```

- [ ] **Step 5: Implement (`client/src/costForm.ts`, `client/src/pages/Kosten.tsx`)**

`costForm.ts`, hinter `meterTypeOptions`:

```ts
// Die Zählertypen, nach denen eine Position verteilt werden kann: die der Wohnungszähler, ohne
// Heizkostenverteiler (Heizung PR 4). Deren Einheiten verteilt Mietfuchs erst mit den
// Bewertungsfaktoren (PR 12); bis dahin lehnt auch der Server den Schlüssel ab.
export function costMeterTypes(meters: readonly Pick<Meter, 'type' | 'unitId'>[]): MeterType[] {
  return [...new Set(meters.filter((m) => m.unitId && m.type !== 'hkv').map((m) => m.type))]
}
```

`Kosten.tsx`: `costMeterTypes` zum Import aus `'../costForm'` ergänzen und
`const unitMeterTypes = useMemo(() => [...new Set(meters.filter((m) => m.unitId).map((m) => m.type))], [meters])`
ersetzen durch `const unitMeterTypes = useMemo(() => costMeterTypes(meters), [meters])`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- meterForm costForm Kosten Zaehler && npm run typecheck`
Expected: PASS. Liefert der `fetch`-Stub von `Zaehler.test.tsx` für unbekannte Pfade kein Array,
dort `if (path === '/api/heating-plants') return json([])` ergänzen.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test && npm run build`
Expected: PASS.

```bash
git add client/src/meterForm.ts client/src/meterForm.test.ts client/src/pages/Zaehler.tsx client/src/costForm.ts client/src/costForm.test.ts client/src/pages/Kosten.tsx
git commit -m "Oberfläche: Zähler der Heizanlage, Fernablesbarkeit und Einbaudatum; kein Verbrauchsschlüssel nach HKV

Refs #99, #214"
```

---

### Task 12: Smoke-Test, Doku, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks.
- Produces: Prüfung der Programmdateien mit Heizanlage (Entwurf 12.4 „Smoke-Test: PUT einer Anlage“; der CO₂-Teil kommt mit PR 6), CHANGELOG-Einträge, Architekturabschnitt.

- [ ] **Step 1: Smoke-Test erweitern (`scripts/smoke-test.mjs`)**

Hinter `uploadsAndSettlement`:

```js
// Heizanlage (Heizung PR 4): anlegen; eine neue Heizposition gehört ihr von selbst, und die
// Abrechnung bleibt dieselbe.
async function heatingPlant() {
  const vorher = (await request('/api/settlement/2025')).body
  const angelegt = await request('/api/heating-plants', json('POST', { energy: 'gas', method: 'service', assignItemIds: [] }))
  assert(angelegt.status === 201 && angelegt.body.plant?.energy === 'gas', 'Heizanlage anlegen', angelegt.body)
  const posten = await request('/api/costItems', json('POST', {
    period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 0, key: 'area',
  }))
  assert(posten.body.heatingPlantId === angelegt.body.plant.id, 'eine neue Heizposition gehört zur Anlage', posten.body)
  await request(`/api/costItems/${posten.body.id}`, { method: 'DELETE' })
  const nachher = (await request('/api/settlement/2025')).body
  assert(JSON.stringify(nachher.statements) === JSON.stringify(vorher.statements) && nachher.totalCostsCents === vorher.totalCostsCents,
    'die Abrechnung bleibt mit Heizanlage dieselbe', { vorher: vorher.totalCostsCents, nachher: nachher.totalCostsCents })
}
```

In `backupAndRestore` hinter der Zusicherung „Backup wiederherstellen bringt die Daten zurück“:

```js
  const anlagen = (await request('/api/heating-plants')).body
  assert(Array.isArray(anlagen) && anlagen.length === 1, 'die Heizanlage ist nach der Wiederherstellung da', anlagen)
```

In `main` zwischen `const unit = await uploadsAndSettlement()` und `await backupAndRestore(unit)`:

```js
  await heatingPlant()
```

- [ ] **Step 2: Smoke-Test gegen eine laufende Instanz**

Run:

```bash
npm run build
D=$(mktemp -d)
CI=1 NKA_DATA_DIR="$D" NKA_UPDATE_URL=http://127.0.0.1:9/kein-internet NKA_PORT=3999 npm start > "$D.log" 2>&1 &
SERVER=$!
node scripts/smoke-test.mjs --url http://127.0.0.1:3999 --mode npm; echo "Exit $?"
kill $SERVER
```

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ Heizanlage anlegen“, „✓ eine neue
Heizposition gehört zur Anlage“, „✓ die Abrechnung bleibt mit Heizanlage dieselbe“ und „✓ die
Heizanlage ist nach der Wiederherstellung da“. Der Datenordner `$D` ist ein Wegwerf-Ordner, `CI=1`
verhindert das Browserfenster, `NKA_UPDATE_URL` zeigt auf einen geschlossenen Port.

- [ ] **Step 3: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]` (neben den Einträgen von PR 1 bis PR 3; fehlt die Überschrift, anlegen):

```md
### Hinzugefügt

- **Heizanlage in den Stammdaten.** Unter „Heizung“ geben Sie an, womit geheizt wird, wer die
  Heizkostenabrechnung erstellt (ein Messdienst, bei einer Eigentumswohnung die Gemeinschaft, oder
  niemand), welche Wohnungen angeschlossen sind und ob die Zähler und Heizkostenverteiler aus der
  Ferne ablesbar sind. Vorhandene Heizpositionen offener Zeiträume kommen beim Einrichten zur
  Anlage, neue von selbst. An keinem Betrag ändert sich dadurch etwas
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- **Fernablesbarkeit nach Einbaudatum, beziffert.** Zähler kennen jetzt die Sparten Warmwasser und
  Heizkostenverteiler, dazu „aus der Ferne ablesbar“ und das Einbaudatum; beim Messdienst genügt die
  Angabe an der Heizanlage. Ist ein Gerät nicht fernablesbar, obwohl es das sein muss (nach dem
  01.12.2021 eingebaut: ab dem Einbau, ältere ab 2027), nennt die Abrechnung die Kürzung von 3 %
  der Heizkosten je Mieter; ist das nur möglich, sagt sie „bis zu“. Ohne Angaben bleibt es beim
  bisherigen Hinweis ([#214](https://github.com/speedone/mietfuchs/issues/214)).
- **Zweifamilienhaus als Art des Objekts**, mit einem Hinweis, wenn die angelegten Wohnungen nicht
  dazu passen; ob die Ausnahme des § 2 HeizkostenV gilt, richtet sich weiter nach den Wohnungen
  ([#180](https://github.com/speedone/mietfuchs/issues/180)).

### Geändert

- **Wasser nach Zählern: Warmwasserzähler zählen mit.** Beim Kaltwasser nach Verbrauch gehen die
  Warmwasserzähler der Wohnungen in die Verteilung ein, denn die Wasserkosten des Warmwassers
  gehören dazu. Ob eine Wohnung einen Zähler hat, sagt aber nur ein Kaltwasserzähler; mit nur einem
  Warmwasserzähler gilt für ihr Kaltwasser der Rest des Hauptzählers. Zähler, die zur Heizanlage
  selbst gehören (etwa ein Wärmezähler am Speicher), gelten nicht als Hauptzähler des Hauses. Beides
  betrifft nur Bestände mit diesen neuen Zählern, keine bisherige Abrechnung
  ([#99](https://github.com/speedone/mietfuchs/issues/99)).
- Ein Kostenschlüssel „nach Verbrauch“ mit Heizkostenverteilern wird abgelehnt, bis Mietfuchs deren
  Bewertungsfaktoren kennt; übernehmen Sie die Abrechnung des Messdienstes als Einzelbeträge.
```

- [ ] **Step 4: CLAUDE.md**

Im Abschnitt „Architektur“ direkt vor dem Absatz, der mit `**Der Umstieg**` beginnt, einfügen:

```md
**Heizanlage** (Heizung PR 4, #99, #214, #180): Ein Objekt hat höchstens eine Heizanlage
(`heating_plants`, eine zweite kommt mit PR 9), dazu die angeschlossenen Wohnungen
(`heating_plant_units`) und eine Zeile je Heizperiode (`heating_periods`, ohne Vorrat; geschrieben
ab PR 6). Anlegen, Ändern und Entfernen stehen in
[server/src/db/heating.ts](server/src/db/heating.ts), die Prüfungen an Zählern und Kostenpositionen
in repository.ts, das dafür seine Rumpf-Helfer exportiert (heating.ts importiert von dort, nie
umgekehrt).

- **Eine Anlage ändert keine Zahl.** `manual` und `service` verteilen wie bisher; `change_split` wird
  gespeichert und wirkt erst mit `heating_target` (PR 10). Was spätere PRs rechnen (eigene
  Abrechnung, Etagenheizung, zweite Anlage, eigene Heizperiode, getrennte Abrechnung, beheizte
  Fläche), lehnt der Server mit `HeatingError` (400) und einem Satz ab.
- **Ohne Liste alle Wohnungen, mit Liste genau diese.** Ob es eine Liste gibt, sagt
  `units_limited`, wie `participants_limited` (#94): Sonst versorgte eine Anlage, deren letzte
  Wohnung gelöscht wurde, plötzlich das ganze Haus.
- **Heizpositionen gehören zur Anlage ihres Objekts.** Beim Einrichten mit Vorschau
  (`/api/heating-plants/assignable`), danach bekommt jede neue Position der Kostenart Heizung und
  Warmwasser ohne Feld `heatingPlantId` die einzige Anlage (`defaultHeatingPlant`, auch für alte
  Tabs und die Belegbuchung). Abgeschlossene Zeiträume bekommen keine Anlage. Entfernen gibt die
  Positionen frei; hängen noch Zähler an der Anlage, wird abgelehnt.
- **Zähler der Anlage** (`heating_plant_id` mit Rolle, ohne Wohnung) sind **keine Hauptzähler** des
  Hauses (`houseMeters` in calc.ts). **Warmwasserzähler zählen beim Kaltwasser mit**, aber nur ein
  Kaltwasserzähler sagt, ob eine Wohnung gemessen ist (G-B8, `measures`). Nach
  Heizkostenverteilern verteilt Mietfuchs erst mit Bewertungsfaktoren (PR 12); bis dahin lehnt der
  Server den Schlüssel ab, und die Oberfläche bietet ihn nicht an.
- **Fernablesbarkeit** entscheidet [server/src/remoteReading.ts](server/src/remoteReading.ts) nach
  `hkv.remote-reading.new-devices` (Einbau nach dem Stichtag: ab Einbau) und
  `hkv.remote-reading.retrofit` (ältere ab 2027), aus den Zählern oder, beim Messdienst, aus der
  Angabe an der Anlage. Sicher heißt `heating.remote-reading-missing` (warning, 3 % je Mieter auf
  die gedruckten Heizzeilen), möglich `heating.remote-reading` mit „bis zu“; ohne Anlage oder ohne
  Angaben bleibt `heating.remote-reading` wortgleich wie vor PR 4. Zwei Codes, weil die Stufe am
  Code hängt (#112).
- **Zweifamilienhaus** ist eine Art des Objekts (`zfh`) und nur Beschreibung; § 2 hängt an den
  Wohnungen (`mayAgreeOtherwise`), ein Widerspruch ergibt `property.kind-mismatch` (hint).
- Das Wiederherstellen prüft Verweise auf Anlagen anderer Objekte, überlappende Anlagen und
  Heizperioden ohne Zeitraum (`heatingPlantViolations`).
```

Im Absatz `**API**` hinter `` `/api/properties` (Objekte anlegen, ändern, nur leere löschen), ``
ergänzen: `` `/api/heating-plants` (Heizanlage, siehe dort), ``.

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden (er startet echte Server mit
Wegwerf-Ordnern, `CI` und geschlossenem Update-Port). Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement
```

Expected: keine Ausgabe (Golden unverändert).

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-test.mjs CHANGELOG.md CLAUDE.md
git commit -m "Heizanlage: Smoke-Test, CHANGELOG und Architekturabschnitt

Refs #99, #214, #180"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“), Befunde mit einem
vorher roten Test beheben, PR gestapelt auf PR 3 mit `Refs #99, #214, #180` und den Befunden in der
Beschreibung. Vor PR 7 die Laienprobe der Formulare aus PR 4–6 (Entwurf 11.2, Hinweis 7).

---

## Selbstprüfung

**1. Abdeckung des Entwurfs (Zeile PR 4 in Abschnitt 13 und die genannten Abschnitte):**

| Anforderung | Task |
|---|---|
| `heating_plants` samt `source` und Wärmepumpen-Erfassung (5.3) | 2, 3 |
| `heating_plant_units` mit `heated_area_m2`, ohne Zeilen alle Wohnungen (5.3) | 2, 3 (mit `units_limited`) |
| `heating_periods` ohne Vorrat, eindeutig je Anlage und Heizperiode (5.3) | 2, 5 (Prüfung beim Wiederherstellen) |
| `cost_items.heating_plant_id`, RESTRICT, mit Schreibprüfung (5.3, 3.0) | 2, 4 |
| Zähler `warmwasser`, `hkv`, `heating_plant_id`, `heating_role`, `remote_readable`, `installed_on` (5.3) | 2, 4, 11 |
| `hkv.remote-reading.new-devices`, eventDate (4.3, N6) | 1 |
| Fernablesbarkeit neuer Geräte und an der Anlage für den Messdienst (3.13, R-A1, G-C2), 3 % je Mieter (6.5) | 8 |
| Tests 4.7 zu `hkv.cut.remote-reading` (15.11. und 15.12.2021) und R-A1 aus 12.2 | 8 |
| `change_split` gespeichert, wirkt bei `manual` erst mit `heating_target` (A2, B7) | 2, 3, 7 (Anlage ändert keine Zahl) |
| Wasserschlüssel G-B8 | 7 |
| `zfh` und `property.kind-mismatch` (8.9, 10.1) | 2, 9 |
| Eigentumswohnung als Anlage `homeowners` mit `service` (D-F2, 11.2) | 2, 3, 10 |
| Einrichtung Schritte 1, 2, 4, 5, 6 (11.2) | 10 |
| Sperren `self`, `perUnit`, zweite Anlage, eigene Heizperiode (13) | 3 |
| Anlegen samt Zuordnung offener Positionen mit Vorschau; abgeschlossene nie (3.0, 11.2, 12.4) | 3, 6 |
| Fremdes Objekt 400, überlappende Anlagen 400 bzw. beim Wiederherstellen (5.3, 5.9, 12.4) | 4, 5, 6 |
| Wer nichts einstellt, merkt nichts; Anlegen ändert keine Zahl (1.2, 11.1, 11.2, 12.3 Nr. 12) | 7, 6 (über HTTP), 12 (Smoke) |
| Zwei Anlagen rechnen unabhängig (12.3 Nr. 13) | entfällt in PR 4 (zweite Anlage gesperrt); `remoteReadingVerdict` nimmt mehrere Anlagen schon an (Task 8) |
| Lexikon `heatingSystem`, `heatCostAllocator` (10.3) | 8 |
| jsdom für jedes neue Auswahlfeld, `heatingForm` (11, 12.4) | 10 (Karte), 11 (Zählerfelder über `meterToForm`/`meterBody`) |
| Smoke-Test „PUT einer Anlage“ (12.4) | 12 (Anlage; CO₂ kommt mit PR 6) |
| Migrationen nur per db:generate, Reihenfolge nach PR 3 (13, W7) | 2 |

Bewusst nicht in PR 4, mit Grund: Schritt 3 der Einrichtung, eigene Heizperiode,
Umschlüsseln und der Test G-A2 „direkter Schreibversuch mit `'2026-01'` → 400“ (PR 5; in PR 4 ist
jede Heizperiode ein Zeitraum des Objekts, und `requirePeriods` aus PR 2 prüft den Schlüssel
schon); Schreibroute und Sperre (409) für `heating_periods` (mit der ersten PR, die ein Feld davon
schreibt, PR 6); `hot_water`, CO₂-Merkmale, §§ 5a–5d und Erfassung an der Anlage (Spalten kommen mit
PR 6, 7, 10, 18 laut 5.1); Anleitung „Heizung einrichten“ (11.4, sinnvoll erst mit Schritt 3 und 7);
`heating.change-split-time` (PR 10).

**Abweichung vom Entwurf, begründet:** 10.1 nennt für `heating.remote-reading` zwei Stufen. Weil
`warn` je Code genau eine Stufe kennt (CLAUDE.md, #112), trägt die sichere Kürzung den Code
`heating.remote-reading-missing`. `heating.remote-reading` bleibt `hint` und im Client
„informational“ (färbt die Ampel nicht), wie bisher.

**2. Platzhalter:** Keine offenen Stellen. Die beiden Marken in Task 2 Step 7 sind Ausgaben des
angegebenen Befehls (Prüfsummen der erzeugten Dateien 0018 und 0019), wie in den Plänen von PR 2 und
PR 3; der Plan gibt Namen, Inhalt und Prüfung jedes Schritts vor.

**3. Typen und Namen:** `HeatingPlant` (Task 2) wird in Task 3 gelesen und geschrieben, in Task 7
als `SnapshotHeatingPlant`, in Task 8 als `RemotePlant` geschnitten und in Task 10 als
`HeatingPlantBody`; die Felder heißen überall `devicesRemote`, `devicesInstalledAfter2021`,
`capturedOnOct2024`, `captureInstalledOn`, `warmRentAverageCents`, `units` (`null` = alle).
`HeatingError(status, message)` (Task 3) wird in Task 4 geworfen und in Task 6 in der
Fehlerbehandlung geprüft. `createHeatingPlant(db, id, propertyId, body)` hat in Task 3, 4, 5 und 6
dieselbe Reihenfolge. `remoteReadingVerdict(plants, meters, units, period, log)` (Task 8) wird in
calc.ts genau so aufgerufen.

**4. Review Focus:** Jede Zeile hat ihren Test: 1 in Task 4 („eine neue gehört der einzigen
Anlage, auch ohne Feld“), 2 in Task 3 („die letzte gelöscht heißt keine, nicht alle“), 3 in Task 3
(„Entfernen … mit Zählern erst, wenn sie gelöst sind“) und Task 4 („Zähler der Anlage … jede
Abweichung mit einem Satz“), 4 in Task 4 und Task 5, 5 in Task 4 („Verbrauchsschlüssel nach
Heizkostenverteilern“) und Task 11 (`costMeterTypes`).
