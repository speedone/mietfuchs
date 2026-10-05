# Heizung PR 5: Eigene Heizperiode und getrennte Heizkostenabrechnung (#217) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Heizanlage kann einen eigenen Zeitraum haben (etwa Mai bis April neben dem
Kalenderjahr des Objekts): Ihre Heizperiode steht in der Betriebskostenabrechnung, in der sie endet
(Weg b), oder, bei getrennter Abrechnung mit eigener Heizvorauszahlung, in einer eigenen
Heizkostenabrechnung je Heizperiode mit eigener Frist und eigenem Abschluss (Weg d); jeder Monat der
Heizstaffel wird dabei genau einmal angerechnet, und wer nichts einstellt, merkt nichts.

**Architecture:** Eine erzeugte Migration (`0020_heizperiode`) legt sechs neue Tabellen an: die
Wechsel der Heizperiode, die Heizstaffel und ihre Korrekturen, die Zeitspannen nach Weg d und die
abgeschlossenen Heizkostenabrechnungen samt Verlauf; keine bestehende Tabelle ändert sich.
`shared/heatingPeriod.ts` rechnet aus Rhythmus der Anlage, Rhythmus des Objekts und den Zeitspannen,
welche Heizperiode in welcher Abrechnung steht und wem ein Monat der Heizstaffel gehört. Der
Schnappschuss eines Objektzeitraums P trägt die Heizperioden, die in P enden; `computeSettlement`
rechnet jede nach Weg b als Teilabrechnung über ihre Tage und führt sie in P zusammen (samt
Abrechnungen nur mit Heizkosten), eine nach Weg d lässt es weg. Dieselbe Funktion rechnet mit
`scope: 'heating'` die Heizkostenabrechnung einer Heizperiode. Rhythmuswechsel der Anlage und Ein-
und Ausschalten von Weg d laufen über je eine Vorschau mit Antworten in einer Transaktion
(`server/src/db/heatingPeriodChange.ts`, `server/src/db/separateSettlement.ts`), wie der Wechsel des
Objektzeitraums aus PR 3.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest mit jsdom.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
0.6 (D-R3), 0.7 (A3), 0.8 (B1–B3), 0.9 (C1–C4, R13), 0.10 (D1, D2, R-a, R-g, R-h), 0.11 (D2 mit
`provisional`, `from_month`, `to_month`), 1.1 W1, 1.2 Nr. 1, 3.0, 3.M, 3.1, 3.6 (Heizkorrektur beim
Rhythmuswechsel), 3.7 (Vorschlag für die Heizvorauszahlung), 3.8 (Fristen), 3.10 (Steuer bei Weg d),
3.11 (Mietkonto mit beiden Staffeln), 5.1, 5.3 (`separate_settlement`, `heating_period_changes`,
`heating_prepayments`), 5.7 (`Statement.scope`, `recommendedDeadline`, `heatingOnly`), 5.8, 5.9,
6.1 Nr. 1, 2, 5 und 7, 10.1 (Zeilen der PR 5), 10.3 (`heatingPeriod`), 11.2 Schritt 3, 12.1 (F14),
12.2 (G-A2, R3, B1/C1, B2, C2/D2, C3, C4, D1 Fall 1 und 2, B3, A3 zweimal), 12.3 Nr. 4 und 11, 12.4,
13 (PR 5), 15.1 Nr. 2 und 21.

**Baut auf:** PR 1 (Code auf `feat/heizung-pr1-rechtsregister`, Stand `4486950`), PR 2 (Code auf
`feat/heizung-pr2-zeitraum`, Stand `e8dfe7d`, Tasks 1–3; die übrigen nach dem Plan
`docs/superpowers/plans/2026-10-05-heizung-pr2-zeitraum-kern.md`), PR 3 (Plan
`…-pr3-zeitraum-bedienung.md`) und PR 4 (Plan `…-pr4-heizanlage.md`). Gearbeitet wird auf
`feat/heizung-pr5-heizperiode`, abgezweigt von der Spitze von PR 4; der PR wird gestapelt auf PR 4
gestellt und nach dessen Merge auf `main` umgestellt (`git rebase --onto`).

## Global Constraints

- **Golden wortgleich:** Unter `server/test/fixtures/settlement/` ändert sich keine Datei;
  `settlement-golden.test.ts`, `db-golden.test.ts`, `db-objekte.test.ts`, `calc-wortlaut.test.ts`,
  `law-wording.test.ts`, `rechtstexte.test.ts`, der Gleichheitstest in `calc-zeitraum.test.ts` (PR 2)
  und der Test „Anlage mit Vorgaben: jede Abrechnung bleibt gleich“ in `calc-heizanlage.test.ts`
  (PR 4) bleiben ohne Anpassung ihrer Erwartungen grün (Entwurf 1.2 Nr. 1: „Golden F01–F11 bleiben
  bis PR 5 wortgleich“).
- **Ohne eigene Heizperiode und ohne Weg d merkt niemand etwas** (11.1, 11.2): Ohne Anlage, mit einer
  Anlage, die dem Objekt folgt (`periodStartMonth = null`), und ohne Heizstaffel ist jede Zahl, jeder
  Hinweis, jedes Feld der Abrechnung, des Mietkontos und der Steuerübersicht gleich dem Stand nach
  PR 4. Neue Felder (`heatingPrepaymentCents`, `heatingOnly`, `scope`, `heatingPeriods`,
  `separateHeating`, `heatingPrepaymentCents` am Monat des Mietkontos) erscheinen nur, wenn es sie
  gibt; kein neues Pflichtfeld, kein neuer Schritt im Weg.
- **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5, C4, D1): in der
  Heizkostenabrechnung nach Weg d, deren Heizperiode ihn enthält, sonst in der Abrechnung P, die ihn
  enthält. Die Regel steht genau einmal, in `separateOwner` (`shared/heatingPeriod.ts`); P und die
  Heizkostenabrechnung fragen beide dort.
- **Weg d nur bei getrennter Abrechnung und H ≠ P** (3.1, A3, 15.1 Nr. 21): Eine Heizperiode, die
  zugleich ein Abrechnungszeitraum des Objekts ist, steht immer in der Gesamtabrechnung; dort werden
  beide Vorauszahlungen getrennt ausgewiesen und angerechnet. Weg d ist eine Auslegung; die Texte
  nennen den Zustimmungsvorbehalt, wenn der Mietvertrag den Zeitraum festlegt.
- **Einschalten nicht vor dem letzten Abschluss, Ausschalten erst ab W** (C3, D1): X frühestens im
  Monat nach dem Ende der letzten abgeschlossenen Abrechnung P (409); W ist der Beginn der ersten
  Heizperiode, die weder abgeschlossen ist noch Monate in einer abgeschlossenen Abrechnung P hat
  (409 bei früherem W). Gespeichert wird der Zeitraum, in dem Weg d gilt, als Spanne
  (`heating_separate_spans`), damit kein späteres Umschalten eine frühere Heizperiode umdeutet.
- **Vorschau, Antworten, eine Transaktion** (3.1, 3.6): Rhythmuswechsel der Anlage und Ein- und
  Ausschalten von Weg d schreiben nur mit vollständigen Antworten, sonst 409 mit der neuen Vorschau
  und ohne geschriebene Zeile. Den Rhythmus setzt `PUT /api/heating-plants/:id` nie.
- **Migration:** nur mit `npm --prefix server run db:generate -- --name heizperiode`, Nummer
  `0020_heizperiode` hinter `0018_heizanlage` und `0019_heizanlage_bedingungen` (PR 4). Nur neue
  Tabellen, kein `ALTER TABLE`, kein Neubau (`__new_`), keine Datenanweisung. Die Marke kommt in
  `server/test/migrations.test.ts`. Wird PR 4 vor dem ersten Push dieses Zweigs neu erzeugt, wird
  0020 ebenfalls neu erzeugt.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate}.ts` und `legacy/validate.ts`
  bleiben unverändert (Prüfsumme in `legacy-schema.test.ts`); die db.json kennt weder Heizperiode noch
  Heizstaffel. `legacy/read.ts` braucht keine Änderung, alle neuen Felder sind optional.
- **Rechtswerte nur aus dem Register:** Die zwölf Monate der Frist kommen über `settlementDeadline`
  (PR 2, `bgb.deadline-months`); keine Datums- oder Prozentliterale in den Dateien der Berechnung
  (`law-literals.test.ts`). `shared/heatingPeriod.ts` kommt in `ENGINE_FILES`.
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch;
  Nutzertexte siezen (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`). Im Client endungslose Importe,
  nur aus `shared/` mit `.ts`.
- **Auswahlfelder** werden aus Optionslisten gespeist; je neuem Auswahlfeld ein jsdom-Test, dass der
  angezeigte Wert dem gespeicherten entspricht.
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in `api.test.ts` erledigen das `startServer`/`startServerIn`, im Praxislauf
  `withServer`, beim Smoke-Test der Aufruf von Hand (Task 13).
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` enden mit Exit-Status 0 (nie hinter
  `grep` prüfen). Jede Commit-Nachricht ist deutsch, nennt `Refs #217` und endet mit den
  Attribution-Zeilen der ausführenden Sitzung.

## Schnittstellen der Vorgänger, auf die dieser Plan baut

Namen genau so; wer einen davon in PR 2 bis PR 4 anders umsetzt, zieht ihn hier nach, bevor Task 1
beginnt.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 `shared/law/register.ts` | `law`, `createLawLog`, `LawLog` (`values: AppliedValue[]`, Eintrag mit `id`, `validFrom`), `LAW_AS_OF`, `valueAt`, `germanDate` | Code `4486950` |
| PR 2 `shared/period.ts` (Code `e8dfe7d`) | `parsePeriodKey`, `periodKey`, `calendarPeriod`, `startYearOf`, `isCalendarRules`, `rulesOf`, `periodContaining`, `periodOfKey`, `periodsBetween`, `previousPeriod`, `calendarYearPeriod`, `periodLabel`, `settlementPeriod`, `settlementDeadline(p, months?)` (Vorgabe nach PR 2 Task 7 aus `bgb.deadline-months`), `periodDays`, `periodMonths`, `CALENDAR_RULES` | wie im Code |
| PR 2 `shared/types.ts` | `PeriodKey`, `PeriodRules`, `BillingPeriod`, `SettlementPeriod`; `Settlement.period`, `Settlement.deadline` | Code + Plan Task 5 |
| PR 2 `server/src/db/schema.ts` | `periodKeyCheck(name, column)` (modulintern), `notNegative`, `propertyRef`, `prepayments`, `prepaymentOverrides`, `closedSettlements`, `closedSettlementHistory` | Code |
| PR 2 `server/src/db/repository.ts` | `PeriodError` (400), `rulesForProperty(db, propertyId)` (PR 3 exportiert), `requirePeriods`, `guardCostItem`, `guardTenancy(db, before, after, body)`, `writeTenancyChildren`, `readSchedule`, `moneyEntry`, `orphanPeriodKeys`, `crossPropertyViolations`, `closeSettlement`, `findClosedSettlement`, `reopenSettlement`, `settlementHistory`, `SettlementHistoryEntry` | Code |
| PR 2 `server/src/db/read.ts` | `readTenancies`, `readClosedSettlements`, `StoredClosedSettlement`, `Stock`, `readStock`, `groupBy`, `INSERTION_ORDER`, `orUndefined` | Code |
| PR 2 `server/src/snapshot.ts` | `Snapshot` (`period`, `previousPeriod`, `year`, `costItems`, `previousCostItems?`, `closedSettlement`, `property?`, `propertyId`), `snapshotOfPeriod(source, period, previous)`, `snapshotFor(source, propertyId, period)`, `narrowToProperty`, `frozenSettlementOf`, `SnapshotClosedSettlement`, `SnapshotTenancy`, `SnapshotCostItem`, `SnapshotSource` | Code + Plan Task 5 |
| PR 2 `server/src/calc.ts` | `computePrepaymentCents(tenancy, period)`, `ledgerRows(source, span, options?)`, `rateAtMonth`, im Kopf von `computeSettlement` `period`, `year`, `diy`, `yFrom`, `yTo`, `label`, `lawLog`, `lawPeriod`, `warn`, `fmtDay`, `fmtCents`, `statements`, `landlordRows`, `totalCostsCents`, `selfUsedShareCents`, `notices`, `items`, `partTenancies`; die Schleife `for (const t of partTenancies)` mit `const pp = computePrepaymentCents(t, period)` | Plan Task 5 |
| PR 2 `server/src/index.ts` | `propertyOf(db, req, fromBody?)`, `periodOf(db, req, propertyId)`, `RouteProblem(status, message)`, `readData`, `writeData`, `bodyObject`, `newId`, `today()`, `sentAtOf`, `SENT_AT_INVALID`; `compareWithFrozen(frozen, currentOrCompute, deadline, today)` | Plan Task 6 |
| PR 3 `server/src/db/periodChange.ts` | `checkRules(raw): PeriodRules`, `monthsText(months)`, `planPeriodChange` (intern) | Plan Task 4 |
| PR 3 `server/src/prepaymentSuggestion.ts` | `annualFactors(period, items, previous, degreeDays): AnnualBasis` | Plan Task 6 |
| PR 3 `server/src/calc.ts` | `shortBasis` und `continuing` vor `const result`, `prepayment.no-suggestion`; `taxYearOf`, `TaxPart`, `taxReport(snapshot, parts?)`, `taxPartsFor`, `taxReportFor`; im Kopf `hkvDegreeDays` | Plan Task 6, 7 |
| PR 3 `server/src/db/repository.ts` | `requireServiceAndTax(db, before, after, options)` mit `const rules = await rulesForProperty(db, after.propertyId)` | Plan Task 2 |
| PR 3 Client | `usePeriod()` → `PeriodView` (`key`, `label`, `param`, `calendar`, `period`, `rules`), `PeriodCard`, `monthsText` im Client nicht; `client/src/periodForm.ts` | Plan Task 8, 10 |
| PR 4 `shared/types.ts` | `HeatingPlant` (mit `periodStartMonth`, `separateSettlement`, `units`), `HeatingPlantUnit`, `CostItem.heatingPlantId` | Plan Task 2 |
| PR 4 `server/src/db/schema.ts` | `heatingPlants`, `heatingPlantUnits`, `heatingPeriods` | Plan Task 2 |
| PR 4 `server/src/db/heating.ts` | `LATER`, `mergeHeatingPlant`, `emptyHeatingPlant`, `guardHeatingPlant`, `listHeatingPlants`, `createHeatingPlant`, `updateHeatingPlant`, `removeHeatingPlant`, `PlantRemoval` | Plan Task 3 |
| PR 4 `server/src/db/repository.ts` | `HeatingError(status, message)`, `defaultHeatingPlant`, `isPeriodClosed`, `costItemCollection.insert`, exportierte Helfer `has`, `raw`, `merged`, `asText`, `asNullableText`, `asNullableFilled`, `oneOfOrUndefined`, `sameProperty`, `ISO_DATE` | Plan Task 3, 4 |
| PR 4 `server/src/db/read.ts` | `readHeatingPlants(db)`, `Stock.heatingPlants` | Plan Task 3 |
| PR 4 `server/src/snapshot.ts` | `SnapshotHeatingPlant`, `Snapshot.heatingPlants?`, `snapshotFor` füllt sie | Plan Task 7 |
| PR 4 Client | `client/src/heatingForm.ts`, `client/src/components/HeatingCard.tsx` (`HeatingCard({ units })`), `Stammdaten.tsx` bindet sie ein | Plan Task 10 |

## Review Focus

1. **Ein Tab von vor dem Update legt eine Heizposition mit dem Schlüssel des Objektzeitraums an**
   (`'2026-01'`), während die Anlage Mai bis April abrechnet. Erwartet: Die Position landet in der
   Heizperiode, die in diesem Zeitraum endet (`'2025-05'`), mit dem Jahr der Zahlung 2026, statt mit
   einem Schlüssel, den es für die Anlage nicht gibt, und damit in keiner Abrechnung. Test in Task 3.
2. **Ein Rhythmuswechsel der Anlage trifft eine abgeschlossene Abrechnung** (Heizperiode, deren
   Monate in einer abgeschlossenen Abrechnung P liegen, oder eine abgeschlossene
   Heizkostenabrechnung). Erwartet: 409 mit Satz, nichts geschrieben, Positionen und Korrekturen
   unverändert. Test in Task 4.
3. **Weg d wird ausgeschaltet und später wieder eingeschaltet.** Erwartet: Die Heizperioden der
   ersten Spanne bleiben getrennte Heizkostenabrechnungen, keine Vorauszahlung wird doppelt oder gar
   nicht angerechnet, und die Positionen der ersten Spanne wandern nicht in eine Abrechnung P. Test in
   Task 8.
4. **Eine Erhöhung der Vorauszahlung über das gewöhnliche Formular, nachdem Weg d eingeschaltet
   ist** (neue Stufe nur in `prepayments`). Erwartet: Die Summe stimmt, die Heizstaffel bleibt, und
   der Hinweis `prepayment.heating-share-unchanged` fragt nach (R-h). Test in Task 5.
5. **Ein Wechsel des Objektzeitraums, der eine Heizperiode nach Weg d zu einem Abrechnungszeitraum
   des Objekts macht** (oder umgekehrt). Erwartet: abgelehnt mit dem Satz, zuerst die Heizung
   umzustellen, statt eine getrennte Heizkostenabrechnung still in die Gesamtabrechnung zu ziehen.
   Test in Task 4.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/types.ts` | `SeparateSpan`, `HeatingPrepaymentOverride`, Felder an `HeatingPlant`, `Tenancy`, `Statement`, `Settlement`, `RentMonth`, `RentLedgerRow`, `NoticeSubject`; Vorschauen; `HeatingSettlementInfo` | 1, 4, 8, 9 |
| `server/src/db/schema.ts`, `server/drizzle/0020_heizperiode.sql`, `meta/*` (erzeugt) | sechs Tabellen | 1 |
| `shared/heatingPeriod.ts` (neu) | Heizperiode, Weg, Eigentümer eines Monats, empfohlene Frist | 2 |
| `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts` | Lesen, Schreiben, Prüfungen, Entfernen, Befunde beim Wiederherstellen | 3 |
| `server/src/db/heatingPeriodChange.ts` (neu), `server/src/db/periodChange.ts`, `server/src/index.ts` | Rhythmuswechsel der Anlage mit Vorschau; Wechsel des Objekts schont Heizpositionen | 4 |
| `server/src/snapshot.ts`, `server/src/calc.ts`, `shared/glossary.ts`, `client/src/notices.ts` | Weg b, Vorauszahlungen beider Staffeln, Mietkonto, Hinweise | 5 |
| `server/test/fixtures/period/F14-heizperiode/README.md` (neu), `server/test/heating-period-golden.test.ts` (neu) | F14 | 6 |
| `server/src/snapshot.ts`, `server/src/calc.ts` | Heizkostenabrechnung nach Weg d | 7 |
| `server/src/db/separateSettlement.ts` (neu), `server/src/index.ts` | Weg d ein- und ausschalten | 8 |
| `server/src/db/heatingSettlements.ts` (neu), `server/src/index.ts`, `server/src/calc.ts` | Abschluss, Routen, Steuer | 9 |
| `server/test/invariant-heizperiode.test.ts` (neu) | Invarianten 4 und 11 | 10 |
| `client/src/heatingPeriodForm.ts` (neu), `client/src/components/HeatingPeriodSection.tsx` (neu), `client/src/components/HeatingCard.tsx`, `client/src/pages/Stammdaten.tsx` | Einrichtung Schritt 3, Vorschauen | 11 |
| `client/src/heatingSettlementView.ts` (neu), `client/src/pages/{Abrechnung,Cockpit,Mietkonto,Kosten,Stammdaten}.tsx` | Heizkostenabrechnung, beide Staffeln, Fristen | 12 |
| `scripts/smoke-test.mjs`, `scripts/umstieg-praxislauf.mjs`, `CHANGELOG.md`, `CLAUDE.md` | Prüfung, Doku | 13 |

---
### Task 1: Datenmodell und Migration 0020

Sechs neue Tabellen, keine geänderte. Die Typen am gemeinsamen Modell kommen hier vollständig dazu,
damit jede spätere Task gegen dieselben Namen schreibt; gelesen und geschrieben werden sie ab Task 3.

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`
- Create (erzeugt): `server/drizzle/0020_heizperiode.sql`, `server/drizzle/meta/0020_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/schema.test.ts`, `server/test/migrations.test.ts`

**Interfaces:**
- Consumes (PR 2, PR 4): `PeriodKey`, `PeriodRules`, `PrepaymentEntry`, `SettlementPeriod`, `HeatingPlant`; in schema.ts `periodKeyCheck`, `notNegative`, `tenancies`, `heatingPlants`.
- Produces:
  - `shared/types.ts`: `type SeparateSpan = { from: string; until: PeriodKey | null }`; `type HeatingPrepaymentOverride = { plantId: string; period: PeriodKey; cents: number; provisional: boolean; fromMonth: string | null; toMonth: string | null }`; `HeatingPlant.periodChanges: string[]`, `HeatingPlant.separateSpans: SeparateSpan[]`; `Tenancy.heatingPrepayments?: PrepaymentEntry[]`, `Tenancy.heatingPrepaymentOverrides?: HeatingPrepaymentOverride[]`; `Statement.scope?`, `Statement.heatingOnly?`, `Statement.recommendedDeadline?`, `Statement.heatingPrepaymentCents?`, `Statement.prepaymentNote?`; `type HeatingPeriodRef = { plantId: string; period: SettlementPeriod }`, `type SeparateHeatingRef = { plantId: string; plantName: string; period: SettlementPeriod; deadline: string }`, `type HeatingScopeRef = { kind: 'heating'; plantId: string; plantName: string }`; `Settlement.heatingPeriods?: HeatingPeriodRef[]`, `Settlement.separateHeating?: SeparateHeatingRef[]`, `Settlement.scope?: HeatingScopeRef`; `RentMonth.heatingPrepaymentCents?: number`, `RentLedgerRow.heatingPrepaymentYearCents?: number`; `NoticeSubject['kind']` + `'heatingPlant'`
  - schema.ts: `heatingPeriodChanges`, `heatingSeparateSpans`, `heatingPrepayments`, `heatingPrepaymentOverrides`, `closedHeatingSettlements`, `closedHeatingSettlementHistory`

- [ ] **Step 1: Write the failing tests**

(a) `server/test/schema.test.ts`: den Typimport aus `'../../shared/types.ts'` um
`HeatingPrepaymentOverride, SeparateSpan` ergänzen (`PrepaymentEntry` steht dort schon für die
Pauschale; sonst ebenfalls). Die Zeile von PR 4

```ts
type HeatingPlantColumns = Omit<HeatingPlant, 'units'> & { unitsLimited: boolean }
```

ersetzen durch

```ts
// Die Wechsel der eigenen Heizperiode und die Spannen nach Weg d stehen in eigenen Tabellen
// (Heizung PR 5), wie die Wohnungen in heating_plant_units.
type HeatingPlantColumns = Omit<HeatingPlant, 'units' | 'periodChanges' | 'separateSpans'> & { unitsLimited: boolean }
```

und dahinter einfügen:

```ts
// --- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ---
type _HeatingPrepayments = Assert<Matches<Omit<typeof schema.heatingPrepayments.$inferSelect, 'tenancyId'>, PrepaymentEntry>>
type _HeatingPrepaymentOverrides = Assert<Matches<Omit<typeof schema.heatingPrepaymentOverrides.$inferSelect, 'tenancyId'>, HeatingPrepaymentOverride>>
type _HeatingSeparateSpans = Assert<Matches<Omit<typeof schema.heatingSeparateSpans.$inferSelect, 'plantId'>, SeparateSpan>>
```

Im Test „Migration lässt sich anwenden und legt alle Tabellen an“ die erwartete Liste um die sechs
neuen Namen an ihrer alphabetischen Stelle ergänzen; der Ausschnitt um sie herum lautet danach:

```ts
      'closed_heating_settlement_history',
      'closed_heating_settlements',
      'closed_settlement_history',
      'closed_settlements',
```

und

```ts
      'heating_period_changes',
      'heating_periods',
      'heating_plant_units',
      'heating_plants',
      'heating_prepayment_overrides',
      'heating_prepayments',
      'heating_separate_spans',
```

Ans Ende anhängen:

```ts
// ---------- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ----------

const einMieter = "INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2024-01-01')"

test('Heizperiode: Wechsel und Spannen nach Weg d gehören zur Anlage und fallen mit ihr', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO heating_period_changes (plant_id, from_month) VALUES ('hp1', '2026-01')"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_period_changes (plant_id, from_month) VALUES ('hp1', '2026-13')"), 'Monat 13')
    assert.equal(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2026-01', NULL)"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2027-05', '2026-05')"), 'Ende vor Beginn')
    assert.ok(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2025-5', NULL)"), 'kein Monat')
    connection.exec("DELETE FROM heating_plants WHERE id = 'hp1'")
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    assert.equal(zahl('heating_period_changes'), 0)
    assert.equal(zahl('heating_separate_spans'), 0)
  } finally {
    cleanup()
  }
})

test('Heizstaffel und Heizkorrektur: nie negativ, vorläufig nur mit Monaten, endgültig ohne', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(einMieter)
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', '2025-05', 12300)"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', '2026-01', -1)"), 'negativ')
    const korrektur = (werte: string) => `INSERT INTO heating_prepayment_overrides (tenancy_id, plant_id, period, amount_cents, provisional, from_month, to_month) VALUES ${werte}`
    assert.equal(rejects(connection, korrektur("('t1', 'hp1', '2025-05', 30000, 0, NULL, NULL)")), null)
    assert.equal(rejects(connection, korrektur("('t1', 'hp1', '2026-05', 87600, 1, '2026-05', '2026-12')")), null)
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2027-05', 100, 1, NULL, NULL)")), 'vorläufig ohne Monate')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2028-05', 100, 0, '2028-05', '2028-12')")), 'endgültig mit Monaten')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2029-05', 100, 1, '2029-12', '2029-05')")), 'Ende vor Beginn')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2030-05', -1, 0, NULL, NULL)")), 'negativ')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2025-05', 1, 0, NULL, NULL)")), 'je Heizperiode eine')
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'eine Heizkorrektur hält die Anlage')
    connection.exec("DELETE FROM tenancies WHERE id = 't1'")
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    assert.equal(zahl('heating_prepayments'), 0, 'die Staffel fällt mit dem Mietverhältnis')
    assert.equal(zahl('heating_prepayment_overrides'), 0, 'die Korrektur fällt mit dem Mietverhältnis')
  } finally {
    cleanup()
  }
})

test('Abgeschlossene Heizkostenabrechnung: eindeutig je Anlage und Heizperiode, JSON, hält die Anlage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    const abschluss = (id: string, period: string, inhalt = "'{}'") =>
      `INSERT INTO closed_heating_settlements (id, plant_id, period, closed_at, settlement) VALUES ('${id}', 'hp1', '${period}', '2027-01-10', ${inhalt})`
    assert.equal(rejects(connection, abschluss('a1', '2025-05')), null)
    assert.ok(rejects(connection, abschluss('a2', '2025-05')), 'zweimal dieselbe Heizperiode')
    assert.ok(rejects(connection, abschluss('a3', '2026-05', "'kein json'")), 'kein JSON')
    assert.ok(rejects(connection, abschluss('a4', '2026-13')), 'Monat 13')
    assert.equal(rejects(connection, "INSERT INTO closed_heating_settlement_history (id, plant_id, period, closed_at, reopened_at, settlement) VALUES ('v1', 'hp1', '2025-05', '2027-01-10', '2027-02-01', '{}')"), null)
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'ein Abschluss hält die Anlage')
  } finally {
    cleanup()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck`
Expected: FAIL mit `Property 'heatingPrepayments' does not exist on type` in schema.test.ts und
`Module '"../../shared/types.ts"' has no exported member 'HeatingPrepaymentOverride'`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

In `Tenancy` hinter `prepaymentOverrides: …`:

```ts
  // Die Heizvorauszahlung, getrennt von den übrigen (Heizung PR 5, Entwurf 3.1, 5.3): Bei getrennter
  // Heizkostenabrechnung steht hier ab dem Umstellen der Heizanteil, in `prepayments` der Rest; je
  // Monat bleibt die Summe gleich. Fehlt die Staffel, ist die ganze Vorauszahlung in `prepayments`.
  heatingPrepayments?: PrepaymentEntry[]
  // Was an Heizvorauszahlungen einer Heizperiode tatsächlich gezahlt wurde, endgültig oder vorläufig
  // für einige Monate (D2). Je Anlage und Heizperiode höchstens eine.
  heatingPrepaymentOverrides?: HeatingPrepaymentOverride[]
```

In `Statement` hinter `balanceCents: number`:

```ts
  // Heizung PR 5 (Entwurf 5.7). `scope`: 'heating' in der Heizkostenabrechnung einer Heizperiode
  // (Weg d); fehlt es, ist es die Betriebskostenabrechnung. `heatingOnly`: Das Mietverhältnis hat im
  // Abrechnungszeitraum nicht mehr gewohnt, die Abrechnung enthält nur seine Heizkosten (3.1, R-A4);
  // `recommendedDeadline` ist dann die empfohlene, frühere Frist. `heatingPrepaymentCents`: der in
  // `prepaymentCents` enthaltene Teil der Heizvorauszahlung, nur wenn es eine Heizstaffel gibt.
  // `prepaymentNote`: wo Vorauszahlungen von Monaten dieser Abrechnung angerechnet sind (C3).
  scope?: 'all' | 'heating'
  heatingOnly?: boolean
  recommendedDeadline?: string
  heatingPrepaymentCents?: number
  prepaymentNote?: string
```

In `Settlement` hinter `deadline: string`:

```ts
  // Heizung PR 5. `heatingPeriods`: die eigenen Heizperioden, deren Heizkosten in dieser Abrechnung
  // stehen (Weg b). `separateHeating`: Heizperioden, die in diesem Zeitraum enden, aber getrennt
  // abgerechnet werden (Weg d), mit ihrer Frist. `scope`: gesetzt in der Heizkostenabrechnung.
  heatingPeriods?: HeatingPeriodRef[]
  separateHeating?: SeparateHeatingRef[]
  scope?: HeatingScopeRef
```

In `RentMonth` hinter `flatRateCents: number …`:

```ts
  heatingPrepaymentCents?: number // Heizvorauszahlung (Heizung PR 5), nur mit Heizstaffel
```

und den Kommentar an `sollCents` auf `// Bruttomiete = Kaltmiete + Vorauszahlung + Heizvorauszahlung + Pauschale` ändern.
In `RentLedgerRow` hinter `flatRateYearCents: number …`:

```ts
  heatingPrepaymentYearCents?: number // davon Heizvorauszahlung (Heizung PR 5), nur mit Heizstaffel
```

`NoticeSubject`:

```ts
export type NoticeSubject = { kind: 'costItem' | 'unit' | 'tenancy' | 'meter' | 'rentLedger' | 'heatingPlant'; id: string }
```

In `HeatingPlant` (PR 4) hinter `periodStartMonth: number | null`:

```ts
  // Die Wechsel der eigenen Heizperiode als 'JJJJ-MM', aufsteigend, wie beim Objekt (Heizung PR 5).
  // Ohne eigene Heizperiode leer.
  periodChanges: string[]
  // Die Zeitspannen, in denen die Heizkosten getrennt abgerechnet werden (Weg d), aufsteigend.
  separateSpans: SeparateSpan[]
```

und den Kommentar über `periodStartMonth` auf
`// Eigene Heizperiode (#217, Heizung PR 5); `null` heißt wie das Objekt. Gesetzt nur über den Wechsel mit Vorschau.`
sowie über `separateSettlement` auf
`// Werden die Heizkosten getrennt abgerechnet, mit eigener Vorauszahlung (3.1)? `null` unbekannt.`
ändern.

Ans Dateiende:

```ts
// ---------- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ----------

// Ein Zeitraum, in dem die Heizkosten einer Anlage getrennt abgerechnet werden (Weg d, Entwurf 3.1).
// `from` ist der Monat X ('JJJJ-MM'), ab dem die Heizstaffel der getrennten Abrechnung gehört;
// `until` die erste Heizperiode, die wieder in der Gesamtabrechnung steht (W), `null` heißt: bis auf
// Weiteres. Getrennt abgerechnet wird jede Heizperiode, die in diese Spanne reicht und kein
// Abrechnungszeitraum des Objekts ist (`settledSeparately` in shared/heatingPeriod.ts). Gespeichert,
// weil Ein- und Ausschalten nicht rückwirkend wirken dürfen (C3, D1).
export type SeparateSpan = { from: string; until: PeriodKey | null }

// Die Korrektur der Heizvorauszahlung einer Heizperiode (Entwurf 3.1, D2 der achten Fassung).
// Endgültig (`provisional` false, ohne Monate) ersetzt sie die Anrechnung der ganzen Heizperiode;
// vorläufig gilt sie nur für die Monate `fromMonth` bis `toMonth`, die übrigen rechnen nach der
// Staffel. Eine vorläufige entsteht beim Aufteilen der Korrektur eines Abrechnungszeitraums und wird
// beim Abrechnen der Heizperiode durch die endgültige ersetzt.
export type HeatingPrepaymentOverride = {
  plantId: string
  period: PeriodKey
  cents: number
  provisional: boolean
  fromMonth: string | null
  toMonth: string | null
}

export type HeatingPeriodRef = { plantId: string; period: SettlementPeriod }
export type SeparateHeatingRef = { plantId: string; plantName: string; period: SettlementPeriod; deadline: string }
export type HeatingScopeRef = { kind: 'heating'; plantId: string; plantName: string }
```

- [ ] **Step 4: Tabellen (`server/src/db/schema.ts`)**

Den Typimport aus `'../../../shared/types.ts'` braucht nichts Neues (`PeriodKey` ist da). Direkt
hinter der Tabelle `heatingPeriods` (PR 4) einfügen:

```ts
// ---------- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5, Entwurf 3.1, 5.3) ----------

// Die Wechsel der eigenen Heizperiode einer Anlage, wie `period_changes` beim Objekt (#208). Der
// Beginnmonat steht in `heating_plants.period_start_month`; `null` dort heißt „wie das Objekt“, und
// dann gibt es hier keine Zeile.
export const heatingPeriodChanges = sqliteTable(
  'heating_period_changes',
  {
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    fromMonth: text('from_month').notNull(),
  },
  (t) => [primaryKey({ columns: [t.plantId, t.fromMonth] }), periodKeyCheck('heating_period_changes_from_month_valid', 'from_month')],
)

// Die Zeitspannen nach Weg d (siehe `SeparateSpan`): Eine Spanne entsteht beim Einschalten ab dem
// Monat X und wird beim Ausschalten bei der Heizperiode W geschlossen (C3, D1). Ohne sie ließe sich
// nicht sagen, welche Heizperiode vor einem Ausschalten getrennt war und ab welchem Monat ihre
// Heizstaffel ihr gehört.
export const heatingSeparateSpans = sqliteTable(
  'heating_separate_spans',
  {
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    from: text('from_month').notNull(),
    until: text('until_period').$type<PeriodKey>(),
  },
  (t) => [
    primaryKey({ columns: [t.plantId, t.from] }),
    periodKeyCheck('heating_separate_spans_from_valid', 'from_month'),
    periodKeyCheck('heating_separate_spans_until_valid', 'until_period'),
    check('heating_separate_spans_order', sql.raw('"until_period" IS NULL OR "until_period" > "from_month"')),
  ],
)

// Die Heizvorauszahlung je Mietverhältnis (Weg d und H = P mit getrennter Vorauszahlung), eine
// Staffel wie `prepayments`.
export const heatingPrepayments = sqliteTable(
  'heating_prepayments',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    monthlyCents: integer('monthly_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.from] }),
    notNegative('heating_prepayments_monthly_not_negative', 'monthly_cents'),
  ],
)

// Die Korrektur der Heizvorauszahlung je Heizperiode (D2). `RESTRICT` auf die Anlage: Eine Anlage
// mit Korrekturen wird nicht still entfernt (removeHeatingPlant lehnt vorher mit einem Satz ab).
export const heatingPrepaymentOverrides = sqliteTable(
  'heating_prepayment_overrides',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'restrict' }),
    period: text('period').$type<PeriodKey>().notNull(),
    cents: integer('amount_cents').notNull(),
    provisional: integer('provisional', { mode: 'boolean' }).notNull().default(false),
    fromMonth: text('from_month'),
    toMonth: text('to_month'),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.plantId, t.period] }),
    periodKeyCheck('heating_prepayment_overrides_period_valid', 'period'),
    periodKeyCheck('heating_prepayment_overrides_from_valid', 'from_month'),
    periodKeyCheck('heating_prepayment_overrides_to_valid', 'to_month'),
    notNegative('heating_prepayment_overrides_amount_not_negative', 'amount_cents'),
    // Vorläufig genau dann, wenn Monate genannt sind, und dann beide (D2).
    check('heating_prepayment_overrides_provisional_months', sql.raw('("provisional" = 1) = ("from_month" IS NOT NULL) AND ("from_month" IS NULL) = ("to_month" IS NULL)')),
    check('heating_prepayment_overrides_months_order', sql.raw('"to_month" IS NULL OR "to_month" >= "from_month"')),
  ],
)

// Die abgeschlossene Heizkostenabrechnung einer Heizperiode (Weg d, B3), ein Archivstück wie
// `closed_settlements` und aus demselben Grund JSON. `closed_settlements` bleibt unverändert: So
// braucht diese PR keinen Neubau dieser Tabelle, und der Abschluss von P friert die
// Heizkostenabrechnung nicht ein.
export const closedHeatingSettlements = sqliteTable(
  'closed_heating_settlements',
  {
    id: text('id').primaryKey().notNull(),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'restrict' }),
    period: text('period').$type<PeriodKey>().notNull(),
    closedAt: text('closed_at').notNull(),
    sentAt: text('sent_at'),
    settlement: text('settlement', { mode: 'json' }).notNull(),
  },
  (t) => [
    uniqueIndex('closed_heating_settlements_plant_period_idx').on(t.plantId, t.period),
    periodKeyCheck('closed_heating_settlements_period_valid', 'period'),
    // Unqualifiziert, wie bei closed_settlements (macOS-SQLite nach dem Umbenennen).
    check('closed_heating_settlements_settlement_is_json', sql.raw('json_valid("settlement")')),
  ],
)

// Frühere Abschlüsse einer Heizkostenabrechnung (#56), wie `closed_settlement_history`.
export const closedHeatingSettlementHistory = sqliteTable(
  'closed_heating_settlement_history',
  {
    id: text('id').primaryKey().notNull(),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'restrict' }),
    period: text('period').$type<PeriodKey>().notNull(),
    closedAt: text('closed_at').notNull(),
    sentAt: text('sent_at'),
    reopenedAt: text('reopened_at').notNull(),
    settlement: text('settlement', { mode: 'json' }).notNull(),
  },
  (t) => [
    index('closed_heating_settlement_history_plant_period_idx').on(t.plantId, t.period),
    periodKeyCheck('closed_heating_settlement_history_period_valid', 'period'),
    check('closed_heating_settlement_history_settlement_is_json', sql.raw('json_valid("settlement")')),
  ],
)
```

Run: `npm --prefix server run db:generate -- --name heizperiode`

Expected: genau eine neue Datei `server/drizzle/0020_heizperiode.sql`. Darin sechs `CREATE TABLE`
(die sechs Namen oben), `CREATE UNIQUE INDEX closed_heating_settlements_plant_period_idx` und
`CREATE INDEX closed_heating_settlement_history_plant_period_idx`. **Kein** `ALTER TABLE`, **kein**
`__new_`. Steht eines davon darin, hat sich eine bestehende Tabelle mitgeändert: Datei,
Journal-Eintrag und Momentaufnahme löschen, Schema berichtigen, neu erzeugen. Fragt drizzle-kit nach
einer Umbenennung, ist die Antwort „create“.

- [ ] **Step 5: Marke eintragen**

Run:

```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag.includes('heizperiode')) console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```

In `server/test/migrations.test.ts` in `VEROEFFENTLICHT` hinter `'0019_heizanlage_bedingungen'` die
ausgegebene Zeile einfügen, darüber:

```ts
  // Heizung PR 5. Wird PR 4 vor dem Push neu erzeugt, wird dieser Schritt neu erzeugt und die Marke
  // hier ersetzt.
```

Der Wert ist keine offene Stelle: Es ist die Prüfsumme der in Step 4 erzeugten Datei, und erst die
Ausgabe des Befehls nennt sie.

- [ ] **Step 6: Bestehende Objektliterale ergänzen**

`HeatingPlant` hat zwei neue Pflichtfelder. Run: `npm run typecheck`
Expected: Fehler `Property 'periodChanges' is missing` an jedem Objektliteral vom Typ `HeatingPlant`
(PR 4: `emptyHeatingPlant` und `readHeatingPlants` im Server, Testdaten in
`client/src/heatingForm.test.ts` und `client/src/components/HeatingCard.test.tsx`). In den
Client-Tests je Literal `periodChanges: [], separateSpans: [],` hinter `periodStartMonth: …`
ergänzen. In `server/src/db/heating.ts`, `emptyHeatingPlant`, hinter `periodStartMonth: null,`:

```ts
  periodChanges: [], separateSpans: [],
```

In `server/src/db/read.ts`, `readHeatingPlants`, hinter `periodStartMonth: p.periodStartMonth,`
vorläufig (Task 3 liest sie aus den Tabellen):

```ts
    periodChanges: [],
    separateSpans: [],
```

In `mergeHeatingPlant` (heating.ts) hinter `periodStartMonth: …`:

```ts
    // Wechsel und Spannen setzen nur die Routen mit Vorschau (Heizung PR 5, Task 4 und 9).
    periodChanges: current.periodChanges,
    separateSpans: current.separateSpans,
```

In `server/test/db-heizanlage.test.ts` (PR 4), Test „Anlegen: Vorgaben, und so steht sie in der
Liste“, in der Erwartung hinter `periodStartMonth: null, units: null,` ergänzen:
`periodChanges: [], separateSpans: [],`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/schema.test.ts test/migrations.test.ts test/db-heizanlage.test.ts test/db-golden.test.ts test/db-objekte.test.ts && npm run typecheck`
Expected: PASS; die drei neuen Tests in schema.test.ts grün, Golden unverändert.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/schema.ts server/src/db/heating.ts server/src/db/read.ts server/drizzle server/test/schema.test.ts server/test/migrations.test.ts server/test/db-heizanlage.test.ts client/src/heatingForm.test.ts client/src/components/HeatingCard.test.tsx
git commit -m "Heizperiode: Tabellen für Heizperiode, Heizstaffel, Weg d und Abschluss der Heizkostenabrechnung

Ein erzeugter Schritt 0020, nur neue Tabellen.

Refs #217"
```

---
### Task 2: Heizperioden rechnen (`shared/heatingPeriod.ts`)

Eine Datei für alle Fragen nach der Heizperiode: welche Regeln gelten, welche Heizperioden in einem
Abrechnungszeitraum enden, ob eine Heizperiode getrennt abgerechnet wird, wem ein Monat der
Heizstaffel gehört, und die empfohlene Frist einer Abrechnung nur mit Heizkosten. Server und
Oberfläche fragen beide hier; sie liegt deshalb in `shared/` wie `period.ts`.

**Files:**
- Create: `shared/heatingPeriod.ts`
- Modify: `server/test/law-literals.test.ts` (`ENGINE_FILES`)
- Test: `server/test/heating-period.test.ts` (neu)

**Interfaces:**
- Consumes (PR 2): `periodContaining`, `periodOfKey`, `periodsBetween`, `settlementDeadline`, `periodMonths`; Typen `BillingPeriod`, `PeriodKey`, `PeriodRules`, `HeatingPlant`, `Unit`, `SeparateSpan` (Task 1).
- Produces (`shared/heatingPeriod.ts`):
  - `type PlantRhythm = { periodStartMonth: number | null; periodChanges: readonly string[] }`
  - `type PlantWay = PlantRhythm & { separateSpans: readonly SeparateSpan[] }`
  - `hasOwnRhythm(plant: Pick<PlantRhythm, 'periodStartMonth'>): boolean`
  - `plantRules(plant: PlantRhythm, objectRules: PeriodRules): PeriodRules`
  - `sameSpan(a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): boolean`
  - `isObjectPeriod(objectRules: PeriodRules, h: BillingPeriod): boolean`
  - `heatingPeriodsEndingIn(rules: PeriodRules, p: Pick<BillingPeriod, 'from' | 'to'>): BillingPeriod[]`
  - `spanOf(spans: readonly SeparateSpan[], h: BillingPeriod): SeparateSpan | undefined`
  - `settledSeparately(plant: PlantWay, objectRules: PeriodRules, h: BillingPeriod): boolean`
  - `separateOwner(plant: PlantWay, objectRules: PeriodRules, month: string): BillingPeriod | null`
  - `servesUnit(plant: { units: readonly { unitId: string }[] | null }, unit: Pick<Unit, 'id' | 'noConnection'>): boolean`
  - `recommendedDeadline(objectRules: PeriodRules, end: string): string`
  - `requestMonth(deadline: string): string`
  - `monthSpanText(months: readonly string[]): string`

- [ ] **Step 1: Write the failing test**

`server/test/heating-period.test.ts`:

```ts
// Die eigene Heizperiode (#217, Entwurf 3.0, 3.1): Regeln, Zuordnung zur Abrechnung, Weg d und der
// Eigentümer eines Monats der Heizstaffel. Reine Funktionen aus shared/heatingPeriod.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  heatingPeriodsEndingIn, isObjectPeriod, monthSpanText, plantRules, recommendedDeadline, requestMonth, sameSpan,
  separateOwner, servesUnit, settledSeparately, spanOf, type PlantWay,
} from '../../shared/heatingPeriod.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const anlage = (over: Partial<PlantWay> = {}): PlantWay => ({ periodStartMonth: 5, periodChanges: [], separateSpans: [], ...over })
const keys = (ps: BillingPeriod[]) => ps.map((p) => p.key)

test('Regeln: ohne eigene Heizperiode die des Objekts, sonst die eigenen', () => {
  assert.deepEqual(plantRules(anlage({ periodStartMonth: null }), CALENDAR_RULES), CALENDAR_RULES)
  assert.deepEqual(plantRules(anlage({ periodStartMonth: null }), MAI), MAI)
  assert.deepEqual(plantRules(anlage({ periodChanges: ['2026-01'] }), CALENDAR_RULES), { startMonth: 5, changes: ['2026-01'] })
})

test('Zuordnung (VIII ZR 240/07): eine Heizperiode gehört in die Abrechnung, in der sie endet', () => {
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of(CALENDAR_RULES, '2026-01'))), ['2025-05'])
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of(CALENDAR_RULES, '2025-01'))), ['2024-05'])
  // Ein Wechsel kann zwei Heizperioden in eine Abrechnung legen, und eine andere bleibt ohne (3.0).
  const wechsel: PeriodRules = { startMonth: 5, changes: ['2026-01'] }
  assert.deepEqual(keys(heatingPeriodsEndingIn(wechsel, of(CALENDAR_RULES, '2025-01'))), ['2024-05', '2025-05'])
  assert.deepEqual(keys(heatingPeriodsEndingIn(wechsel, of(CALENDAR_RULES, '2026-01'))), ['2026-01'])
  // Rumpf des Objekts 01.01.–31.03.2025: Die Heizperiode Mai–April endet erst im April.
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of({ startMonth: 1, changes: ['2025-04'] }, '2025-01'))), [])
})

test('H = P: dieselben Grenzen, nicht derselbe Schlüssel', () => {
  assert.equal(isObjectPeriod(CALENDAR_RULES, of(CALENDAR_RULES, '2025-01')), true)
  assert.equal(isObjectPeriod(CALENDAR_RULES, of(MAI, '2025-05')), false)
  // Gleicher Schlüssel, andere Grenzen: Rumpf 01–04/2025 des Objekts gegen das Kalenderjahr der Anlage.
  assert.equal(isObjectPeriod({ startMonth: 1, changes: ['2025-05'] }, of(CALENDAR_RULES, '2025-01')), false)
  assert.equal(sameSpan(of(MAI, '2025-05'), { from: '2025-05-01', to: '2026-04-30' }), true)
})

test('Weg d nur mit eigener Heizperiode, in der Spanne und bei H ≠ P (A3, D1)', () => {
  const offen = anlage({ separateSpans: [{ from: '2025-05', until: null }] })
  assert.equal(settledSeparately(offen, CALENDAR_RULES, of(MAI, '2025-05')), true)
  assert.equal(settledSeparately(offen, CALENDAR_RULES, of(MAI, '2024-05')), false, 'vor der Spanne')
  const zu = anlage({ separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })
  assert.equal(settledSeparately(zu, CALENDAR_RULES, of(MAI, '2025-05')), true)
  assert.equal(settledSeparately(zu, CALENDAR_RULES, of(MAI, '2026-05')), false, 'ab W nicht mehr')
  assert.equal(settledSeparately(anlage({ periodStartMonth: null, separateSpans: [{ from: periodKey('2025-01'), until: null }] }), CALENDAR_RULES, of(CALENDAR_RULES, '2025-01')), false, 'ohne eigene Heizperiode nie')
  // B2: Die Heizperiode wechselt auf Januar; ab 2026 ist H = P und damit kein Weg d mehr.
  const b2 = anlage({ periodChanges: ['2026-01'], separateSpans: [{ from: '2025-05', until: null }] })
  const rules = plantRules(b2, CALENDAR_RULES)
  assert.equal(settledSeparately(b2, CALENDAR_RULES, of(rules, '2025-05')), true, 'der Rumpf Mai–Dezember 2025')
  assert.equal(settledSeparately(b2, CALENDAR_RULES, of(rules, '2026-01')), false, 'H = P')
  assert.equal(spanOf([{ from: '2025-05', until: null }], of(MAI, '2030-05'))?.from, '2025-05')
})

test('Weg d ab einem Monat mitten in der Heizperiode (C3): die Heizperiode ist getrennt, ihre Monate davor gehören P', () => {
  const ab2026 = anlage({ separateSpans: [{ from: '2026-01', until: null }] })
  assert.equal(settledSeparately(ab2026, CALENDAR_RULES, of(MAI, '2025-05')), true, 'sie reicht in die Spanne')
  assert.equal(settledSeparately(ab2026, CALENDAR_RULES, of(MAI, '2024-05')), false)
  assert.equal(separateOwner(ab2026, CALENDAR_RULES, '2025-12'), null, 'vor X rechnet P an')
  assert.equal(separateOwner(ab2026, CALENDAR_RULES, '2026-01')?.key, '2025-05')
})

test('Eigentümer eines Monats der Heizstaffel: die getrennte Heizperiode, sonst niemand (also P)', () => {
  const d1 = anlage({ separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2025-04'), null)
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2025-05')?.key, '2025-05')
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2026-04')?.key, '2025-05')
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2026-05'), null, 'ab W gehört der Monat wieder P (D1)')
  assert.equal(separateOwner(anlage({ periodStartMonth: null }), CALENDAR_RULES, '2025-07'), null)
})

test('Versorgte Wohnungen: ohne Liste alle mit Wärmeanschluss, mit Liste genau diese', () => {
  assert.equal(servesUnit({ units: null }, { id: 'u1' }), true)
  assert.equal(servesUnit({ units: null }, { id: 'g', noConnection: ['waerme'] }), false)
  assert.equal(servesUnit({ units: [{ unitId: 'u2' }] }, { id: 'u1' }), false)
  assert.equal(servesUnit({ units: [] }, { id: 'u1' }), false)
})

test('Empfohlene Frist einer Abrechnung nur mit Heizkosten (R-A4, 15.1 Nr. 2)', () => {
  // Auszug 31.10.2025 im Kalenderjahr: zwölf Monate nach Ende von 2025.
  assert.equal(recommendedDeadline(CALENDAR_RULES, '2025-10-31'), '2026-12-31')
  assert.equal(recommendedDeadline(MAI, '2025-10-31'), '2027-04-30')
  // Die Abrechnung des Messdienstes zwei Monate vorher anfordern (Entwurf 3.1, L3: 31.12.2026 → Oktober 2026).
  assert.equal(requestMonth('2026-12-31'), 'Oktober 2026')
  assert.equal(requestMonth('2027-01-31'), 'November 2026')
})

test('Monate in Worten', () => {
  assert.equal(monthSpanText(['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']), 'Mai bis Dezember 2025')
  assert.equal(monthSpanText(['2025-12', '2026-01']), 'Dezember 2025 bis Januar 2026')
  assert.equal(monthSpanText(['2025-05']), 'Mai 2025')
  assert.equal(monthSpanText([]), '')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/heating-period.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `shared/heatingPeriod.ts`.

- [ ] **Step 3: `shared/heatingPeriod.ts`**

```ts
// Die eigene Heizperiode einer Heizanlage (#217, Heizung PR 5, Entwurf 3.0, 3.1).
//
// Eine Anlage rechnet im Zeitraum ihres Objekts ab (`periodStartMonth` null) oder in einem eigenen
// Rhythmus, etwa Mai bis April wie ihr Messdienst. Die Heizperioden werden wie die Zeiträume des
// Objekts berechnet (shared/period.ts) und nie gespeichert; ihr Schlüssel ist der Monat des Beginns.
//
// **Wo eine Heizperiode abgerechnet wird.** Ohne getrennte Abrechnung gehört sie in die
// Betriebskostenabrechnung des Objektzeitraums, in dem sie endet (Weg b, BGH VIII ZR 240/07: zulässig,
// wenn über die Heizkosten nicht getrennt abzurechnen ist). Werden die Heizkosten mit eigener
// Vorauszahlung getrennt abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit
// eigener Frist (Weg d, Auslegung nach 15.1 Nr. 21), aber nur, wenn sie kein Abrechnungszeitraum des
// Objekts ist: Bei H = P gibt es eine Gesamtabrechnung, die beide Vorauszahlungen getrennt ausweist.
// Ob Weg d gilt, sagen die gespeicherten Spannen (`separateSpans`), nicht die Antwort von heute:
// Ein Ausschalten wirkt erst ab W, und eine Heizperiode davor bleibt getrennt (D1).
//
// **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5): in der
// Heizkostenabrechnung der getrennten Heizperiode, die ihn enthält, sonst in der Abrechnung P, die
// ihn enthält. Die Regel steht hier und nur hier (`separateOwner`); P und die Heizkostenabrechnung
// fragen beide.

import { periodContaining, periodOfKey, periodsBetween, settlementDeadline } from './period.ts'
import type { BillingPeriod, PeriodRules, SeparateSpan, Unit } from './types.ts'

export type PlantRhythm = { periodStartMonth: number | null; periodChanges: readonly string[] }
export type PlantWay = PlantRhythm & { separateSpans: readonly SeparateSpan[] }

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthName = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)

export const hasOwnRhythm = (plant: Pick<PlantRhythm, 'periodStartMonth'>): boolean => plant.periodStartMonth !== null

export const plantRules = (plant: PlantRhythm, objectRules: PeriodRules): PeriodRules =>
  plant.periodStartMonth === null ? objectRules : { startMonth: plant.periodStartMonth, changes: [...plant.periodChanges] }

export const sameSpan = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): boolean => a.from === b.from && a.to === b.to

// Ist die Heizperiode zugleich ein Abrechnungszeitraum des Objekts? Verglichen werden die Grenzen,
// nicht der Schlüssel: Der Rumpf 01.01.–30.04.2025 des Objekts und das Kalenderjahr 2025 der Anlage
// tragen beide '2025-01'.
export function isObjectPeriod(objectRules: PeriodRules, h: BillingPeriod): boolean {
  const p = periodOfKey(objectRules, h.key)
  return p !== null && sameSpan(p, h)
}

// Die Heizperioden, deren Ende in P liegt, in ihrer Reihenfolge. Bei zwei Zwölfmonatsrhythmen genau
// eine; nur ein Wechsel kann zwei oder keine ergeben (Entwurf 3.0).
export function heatingPeriodsEndingIn(rules: PeriodRules, p: Pick<BillingPeriod, 'from' | 'to'>): BillingPeriod[] {
  return periodsBetween(rules, p.from, p.to).filter((h) => h.to >= p.from && h.to <= p.to)
}

// Die Spanne, in die eine Heizperiode reicht: Sie endet am oder nach dem Monat X und beginnt vor W.
// Monate als 'JJJJ-MM' werden Zeichen für Zeichen verglichen, wie `compareText` in calc.ts.
export const spanOf = (spans: readonly SeparateSpan[], h: BillingPeriod): SeparateSpan | undefined =>
  spans.find((s) => h.to.slice(0, 7) >= s.from && (s.until === null || h.key < s.until))

export function settledSeparately(plant: PlantWay, objectRules: PeriodRules, h: BillingPeriod): boolean {
  return hasOwnRhythm(plant) && !isObjectPeriod(objectRules, h) && spanOf(plant.separateSpans, h) !== undefined
}

// Die getrennt abgerechnete Heizperiode, der ein Monat der Heizstaffel gehört; `null` heißt: Die
// Abrechnung P, die den Monat enthält, rechnet ihn an. Ein Monat vor X gehört P, auch wenn seine
// Heizperiode getrennt abgerechnet wird: Seine Vorauszahlung stand beim Umstellen ganz in
// `prepayments` und ist dort angerechnet (C3).
export function separateOwner(plant: PlantWay, objectRules: PeriodRules, month: string): BillingPeriod | null {
  if (!hasOwnRhythm(plant)) return null
  const h = periodContaining(plantRules(plant, objectRules), `${month}-01`)
  const span = isObjectPeriod(objectRules, h) ? undefined : spanOf(plant.separateSpans, h)
  return span !== undefined && month >= span.from ? h : null
}

// Ohne Liste versorgt eine Anlage alle Wohnungen ohne „kein Anschluss: Wärme“ (#117), mit Liste
// genau diese (PR 4, `units_limited`).
export function servesUnit(plant: { units: readonly { unitId: string }[] | null }, unit: Pick<Unit, 'id' | 'noConnection'>): boolean {
  if (plant.units === null) return !(unit.noConnection ?? []).includes('waerme')
  return plant.units.some((u) => u.unitId === unit.id)
}

// Eine Abrechnung nur mit Heizkosten für einen Zeitraum, in dem der Mieter nicht mehr gewohnt hat,
// ist nicht entschieden (15.1 Nr. 2). Empfohlen wird die Frist des Zeitraums, in dem das
// Mietverhältnis endete; die zwölf Monate kommen aus dem Rechtsregister (`settlementDeadline`).
export function recommendedDeadline(objectRules: PeriodRules, end: string): string {
  return settlementDeadline(periodContaining(objectRules, end))
}

// Bis wann die Abrechnung des Messdienstes anzufordern ist, damit die empfohlene Frist hält: zwei
// Monate vorher, wie im Beispiel des Entwurfs (3.1, L3: Frist 31.12.2026, Anforderung bis Oktober
// 2026). Eine Festlegung für den Text, keine Rechtsfrist.
export function requestMonth(deadline: string): string {
  const index = Number(deadline.slice(0, 4)) * 12 + Number(deadline.slice(5, 7)) - 1 - 2
  const year = Math.floor(index / 12)
  return `${MONTH_NAMES[index - year * 12] ?? ''} ${year}`
}

// „Mai bis Dezember 2025“, über den Jahreswechsel „Dezember 2025 bis Januar 2026“, ein Monat „Mai 2025“.
export function monthSpanText(months: readonly string[]): string {
  const first = months[0]
  const last = months[months.length - 1]
  if (first === undefined || last === undefined) return ''
  if (first === last) return `${monthName(first)} ${first.slice(0, 4)}`
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${monthName(first)} bis ${monthName(last)} ${first.slice(0, 4)}`
    : `${monthName(first)} ${first.slice(0, 4)} bis ${monthName(last)} ${last.slice(0, 4)}`
}
```

- [ ] **Step 4: Wächter (`server/test/law-literals.test.ts`)**

In `ENGINE_FILES` hinter `'shared/period.ts'` (PR 2, Task 7) ergänzen:

```ts
  'shared/heatingPeriod.ts',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/heating-period.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (heating-period 9 Tests). `law-literals` findet in der Datei kein Datum und keinen
Prozentsatz: Die zwei Monate in `requestMonth` sind keine Rechtszahl und stehen nicht im Muster.

- [ ] **Step 6: Commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/heatingPeriod.ts server/test/heating-period.test.ts server/test/law-literals.test.ts
git commit -m "Heizperiode: Zuordnung zur Abrechnung, Weg d und Eigentümer eines Monats der Heizstaffel

Refs #217"
```

---
### Task 3: Lesen, Schreiben und Prüfen

Die Anlage liest ihre Wechsel und Spannen, das Mietverhältnis seine Heizstaffel und
Heizkorrekturen, der Bestand die abgeschlossenen Heizkostenabrechnungen. Eine Heizposition einer
Anlage mit eigener Heizperiode trägt den Schlüssel einer Heizperiode (G-A2); eine neue ohne Angabe
bekommt die Heizperiode, die in ihrem Objektzeitraum endet. Den Rhythmus setzt `PUT` nie; eine
Anlage mit Daten nach Weg d lässt sich nicht still entfernen.

**Files:**
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/heating.ts`, `server/src/index.ts` (eine Zeile der Löschroute)
- Test: `server/test/db-heizperiode.test.ts` (neu); Modify: `server/test/db-heizanlage.test.ts` (Sperren von PR 4), `server/test/db-stock.test.ts`

**Interfaces:**
- Consumes (Task 1, 2): Tabellen und Typen aus Task 1; `plantRules`, `heatingPeriodsEndingIn` aus `shared/heatingPeriod.ts`; aus PR 2/3/4 `rulesForProperty`, `requirePeriods`, `requireServiceAndTax`, `isPeriodClosed`, `defaultHeatingPlant`, `guardCostItemHeating`, `HeatingError`, `CrossPropertyError`, `PeriodError`, `propertyName`, `readSchedule`, `moneyEntry`, `asOptionalNumber`, `asNullableFilled`, `raw`.
- Produces:
  - read.ts: `readHeatingPlants` füllt `periodChanges` und `separateSpans`; `readTenancies` füllt `heatingPrepayments` und `heatingPrepaymentOverrides` (nur wenn es Zeilen gibt); `type StoredClosedHeatingSettlement = Omit<StoredClosedSettlement, 'propertyId'> & { plantId: string }`; `readClosedHeatingSettlements(db): Promise<StoredClosedHeatingSettlement[]>`; `Stock.closedHeatingSettlements`
  - repository.ts: `heatingRulesOf(db: Executor, plantId: string): Promise<{ propertyId: string; own: boolean; rules: PeriodRules } | null>`; `itemPeriodClosed(db: Executor, c: CostItem): Promise<boolean>`; `defaultHeatingPlant(db, c): Promise<Pick<CostItem, 'heatingPlantId' | 'period' | 'taxYear'>>`
  - heating.ts: `PlantRemoval` + `{ removed: false; reason: 'separate' }`

- [ ] **Step 1: Write the failing test**

`server/test/db-heizperiode.test.ts`:

```ts
// Eigene Heizperiode im Bestand (Heizung PR 5, Entwurf 3.0, 3.1, 5.3): lesen, schreiben und die
// Schreibprüfungen. Den Rhythmus setzt hier der Test unmittelbar in der Tabelle; über die Route mit
// Vorschau geht es in db-heizperiode-wechsel.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, orphanPeriodKeys, PeriodError, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, listHeatingPlants, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { heatingPeriodChanges, heatingPlants, heatingPrepaymentOverrides, heatingSeparateSpans } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizperiode-'))
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

// Ein Haus im Kalenderjahr mit einer Wohnung, einem Mieter und einer Anlage, die Mai bis April
// abrechnet, ab der Heizperiode 2025/2026 getrennt (Weg d).
async function haus(db: Database): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })
  await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
  await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
  await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
}

const korrektur = (period: string, cents: number, monate?: [string, string]) => ({
  plantId: 'hp1', period, cents, provisional: monate !== undefined, fromMonth: monate?.[0] ?? null, toMonth: monate?.[1] ?? null,
})

test('Lesen: Wechsel und Spannen der Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await db.insert(heatingPeriodChanges).values({ plantId: 'hp1', fromMonth: '2027-01' })
    })
    const [anlage] = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual([anlage?.periodStartMonth, anlage?.periodChanges, anlage?.separateSpans], [5, ['2027-01'], [{ from: '2025-05', until: null }]])
  })
})

test('Heizstaffel und Heizkorrektur: lesen, schreiben, ganz ersetzen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', {
      prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }],
      heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
      heatingPrepaymentOverrides: [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])],
    }))
    const t = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    assert.deepEqual(fieldOf(t, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
    assert.deepEqual(fieldOf(t, 'heatingPrepaymentOverrides'), [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])])
    // Ein Rumpf ohne die Felder lässt sie stehen (Teilrumpf, wie beim Auszug).
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { end: '2027-04-30' }))
    assert.deepEqual(fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }])
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingPrepaymentOverrides: [] }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), 'heatingPrepaymentOverrides'), undefined)
  })
})

test('Heizkorrektur: fremde Anlage, Heizperiode, die es nicht gibt, Monate außerhalb', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp2', 'objekt-2', { energy: 'oil' })
    })
    const setzen = (o: unknown) => opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingPrepaymentOverrides: [o] }))
    await assert.rejects(setzen({ ...korrektur('2025-01', 100), plantId: 'hp2' }), (e: unknown) => e instanceof CrossPropertyError && /Heizanlage aber zu/.test(e.message))
    await assert.rejects(setzen(korrektur('2026-01', 100)), (e: unknown) => e instanceof PeriodError && /Heizperiode, die es für die Heizanlage nicht gibt/.test(e.message))
    await assert.rejects(setzen(korrektur('2025-05', 100, ['2026-05', '2026-12'])), (e: unknown) => e instanceof PeriodError && /außerhalb der Heizperiode 2025\/2026/.test(e.message))
    // Vor der Spanne wird die Heizperiode nicht getrennt abgerechnet; dort gilt die Jahreskorrektur der Abrechnung (3.7).
    await assert.rejects(setzen(korrektur('2024-05', 100)), (e: unknown) => e instanceof PeriodError && /nur für eine getrennt abgerechnete Heizperiode/.test(e.message))
    await assert.rejects(setzen({ ...korrektur('2025-05', 100), plantId: 'gibt-es-nicht' }), (e: unknown) => e instanceof HeatingError && e.status === 400)
  })
})

test('Heizposition einer Anlage mit eigener Heizperiode: nur unter einer ihrer Heizperioden (G-A2)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    const position = (id: string, over: Record<string, unknown>) => opened.write((db) => createEntity(db, 'costItems', id, {
      propertyId: 'objekt-1', category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', heatingPlantId: 'hp1', ...over,
    }))
    await assert.rejects(position('c1', { period: '2026-01' }), (e: unknown) => e instanceof PeriodError && /meinen Sie 2025\/2026/.test(e.message))
    await assert.rejects(position('c2', { period: '2025-05' }), (e: unknown) => e instanceof PeriodError && /Jahr der Zahlung/.test(e.message))
    const ok = await position('c3', { period: '2025-05', taxYear: 2026 })
    assert.deepEqual([fieldOf(ok, 'period'), fieldOf(ok, 'heatingPlantId'), fieldOf(ok, 'taxYear')], ['2025-05', 'hp1', 2026])
  })
})

test('Alter Tab: eine Heizposition unter dem Objektzeitraum kommt in die Heizperiode, die darin endet (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    const neu = await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 100000, key: 'area',
    }))
    assert.deepEqual([fieldOf(neu, 'period'), fieldOf(neu, 'heatingPlantId'), fieldOf(neu, 'taxYear')], ['2025-05', 'hp1', 2026])
    const kalt = await opened.write((db) => createEntity(db, 'costItems', 'c2', {
      propertyId: 'objekt-1', period: '2026-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 40000, key: 'area',
    }))
    assert.deepEqual([fieldOf(kalt, 'period'), fieldOf(kalt, 'heatingPlantId')], ['2026-01', undefined])
  })
})

test('Anlage: den Rhythmus setzt PUT nie; getrennt abgerechnet nur ohne eigene Heizperiode', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await assert.rejects(opened.write((db) => createHeatingPlant(db, 'hp0', 'objekt-1', { energy: 'gas', periodStartMonth: 5 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Zeitraum der Heizung/.test(e.message))
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp1', { periodStartMonth: 5 })),
      (e: unknown) => e instanceof HeatingError && /Zeitraum der Heizung/.test(e.message))
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { separateSettlement: true })))?.separateSettlement, true, 'H = P: nur eine Angabe')
    await opened.write((db) => db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1')))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp1', { separateSettlement: false })),
      (e: unknown) => e instanceof HeatingError && /Getrennte Heizkostenabrechnung/.test(e.message))
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { name: 'Kessel' })))?.name, 'Kessel', 'sonst ändert PUT wie bisher')
  })
})

test('Entfernen: Mit Daten nach Weg d bleibt die Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(haus)
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'separate' })
  })
})

test('Wiederherstellen: eine Heizkorrektur unter einer fremden Heizperiode ist ein Befund', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await db.insert(heatingPrepaymentOverrides).values({ tenancyId: 't1', plantId: 'hp1', period: periodKey('2026-01'), cents: 100, provisional: false, fromMonth: null, toMonth: null })
    })
    const befunde = await opened.read(orphanPeriodKeys)
    assert.ok(befunde.some((b) => /Heizvorauszahlung von „Müller“ steht unter der Heizperiode 2026-01/.test(b)), befunde.join(' | '))
  })
})
```

In `server/test/db-heizanlage.test.ts` (PR 4), Test „Sperren: was spätere Versionen rechnen …“, in
`faelle` die beiden Zeilen

```ts
      [{ periodStartMonth: 5 }, /eigene Heizperiode .* kommt mit einer späteren Version/],
      [{ separateSettlement: true }, /getrennte Heizkostenabrechnung .* kommt mit einer späteren Version/],
```

ersetzen durch

```ts
      // Heizung PR 5: den Rhythmus setzt nur der Wechsel mit Vorschau.
      [{ periodStartMonth: 5 }, /Zeitraum der Heizung/],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-heizperiode.test.ts`
Expected: FAIL. `periodChanges` ist leer statt `['2027-01']`, die Heizstaffel fehlt beim Lesen,
`'2026-01'` wird angenommen, und `removeHeatingPlant` liefert `{ removed: true, … }`.

- [ ] **Step 3: Lesen (`server/src/db/read.ts`)**

Aus `'./schema.ts'` zusätzlich `closedHeatingSettlements, heatingPeriodChanges, heatingPrepaymentOverrides, heatingPrepayments, heatingSeparateSpans`
importieren. In `readHeatingPlants` vor `return rows.map(…)`:

```ts
  // Wechsel und Spannen nach Weg d (Heizung PR 5), aufsteigend.
  const wechsel = groupBy(await db.select().from(heatingPeriodChanges).orderBy(heatingPeriodChanges.fromMonth), (w) => w.plantId, (w) => w.fromMonth)
  const spannen = groupBy(await db.select().from(heatingSeparateSpans).orderBy(heatingSeparateSpans.from), (s) => s.plantId, (s) => ({ from: s.from, until: s.until }))
```

und die beiden Zeilen aus Task 1 Step 6 ersetzen durch:

```ts
    periodChanges: wechsel.get(p.id) ?? [],
    separateSpans: spannen.get(p.id) ?? [],
```

In `readTenancies` neben dem Lesen der Pauschale (`flatRates`):

```ts
  // Heizstaffel und Heizkorrekturen (Heizung PR 5). Wie die Pauschale nur, wenn es Zeilen gibt: So
  // bleibt ein Mietverhältnis ohne getrennte Heizvorauszahlung genau so, wie es vorher gelesen wurde.
  const heizstaffel = groupBy(await db.select().from(heatingPrepayments).orderBy(INSERTION_ORDER), (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  const heizkorrekturen = groupBy(
    await db.select().from(heatingPrepaymentOverrides).orderBy(INSERTION_ORDER),
    (r) => r.tenancyId,
    (r) => ({ plantId: r.plantId, period: r.period, cents: r.cents, provisional: r.provisional, fromMonth: r.fromMonth, toMonth: r.toMonth }),
  )
```

und im Objekt je Mietverhältnis (hinter `flatRates`):

```ts
    ...(heizstaffel.has(t.id) ? { heatingPrepayments: heizstaffel.get(t.id) ?? [] } : {}),
    ...(heizkorrekturen.has(t.id) ? { heatingPrepaymentOverrides: heizkorrekturen.get(t.id) ?? [] } : {}),
```

Hinter `readClosedSettlements`:

```ts
// Die abgeschlossenen Heizkostenabrechnungen nach Weg d (Heizung PR 5), mit demselben Auszug aus dem
// Archivstück wie bei den Abrechnungen des Objekts.
export type StoredClosedHeatingSettlement = Omit<StoredClosedSettlement, 'propertyId'> & { plantId: string }

export async function readClosedHeatingSettlements(db: Database): Promise<StoredClosedHeatingSettlement[]> {
  const rows = await db.select().from(closedHeatingSettlements).orderBy(INSERTION_ORDER)
  return rows.map((c) => ({
    id: c.id,
    plantId: c.plantId,
    period: c.period,
    closedAt: c.closedAt,
    sentAt: c.sentAt,
    ...frozenSettlementOf(c.settlement),
    settlement: c.settlement,
  }))
}
```

`Stock` bekommt `closedHeatingSettlements: StoredClosedHeatingSettlement[]`, `readStock` die Zeile
`    closedHeatingSettlements: await readClosedHeatingSettlements(db),` hinter `closedSettlements`.
In `server/test/db-stock.test.ts`, wo die Schlüssel von `Stock` wörtlich stehen,
`'closedHeatingSettlements'` hinter `'closedSettlements'` ergänzen.

- [ ] **Step 4: Schreiben und Prüfen (`server/src/db/repository.ts`)**

Importe: aus `'./schema.ts'` zusätzlich `closedHeatingSettlementHistory, closedHeatingSettlements, heatingPeriodChanges, heatingPrepaymentOverrides, heatingPrepayments, heatingSeparateSpans`;
aus `'../../../shared/heatingPeriod.ts'` `heatingPeriodsEndingIn, isObjectPeriod, plantRules, spanOf`; aus
`'../../../shared/period.ts'` zusätzlich `CALENDAR_RULES, periodContaining, periodMonths, spansTwoYears, startYearOf`
(soweit nicht da); `HeatingPrepaymentOverride` als Typ; `readHeatingPlants` aus `'./read.ts'`.

Hinter `readOverrides`:

```ts
// Die Korrekturen der Heizvorauszahlung (Heizung PR 5, D2): je Anlage und Heizperiode eine, die
// letzte gilt. Eine vorläufige trägt ihre Monate; ob sie zur Heizperiode passen, prüft
// `guardHeatingOverrides`. Ein Eintrag ohne Anlage, Schlüssel oder Betrag fällt weg.
function readHeatingOverrides(value: unknown): HeatingPrepaymentOverride[] | undefined {
  if (value === null) return undefined
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, HeatingPrepaymentOverride>()
  for (const row of value) {
    const plantId = asNullableFilled(raw(row, 'plantId'))
    const period = parsePeriodKey(raw(row, 'period'))
    const cents = asOptionalNumber(raw(row, 'cents'))
    if (plantId === null || period === null || cents === undefined) continue
    const provisional = raw(row, 'provisional') === true
    byKey.set(`${plantId}|${period}`, {
      plantId, period, cents, provisional,
      fromMonth: provisional ? parsePeriodKey(raw(row, 'fromMonth')) : null,
      toMonth: provisional ? parsePeriodKey(raw(row, 'toMonth')) : null,
    })
  }
  return [...byKey.values()]
}
```

In `mergeTenancy` hinter `flatRates: …`:

```ts
    // Heizstaffel und Heizkorrekturen (Heizung PR 5): wie die Pauschale ganz ersetzt.
    heatingPrepayments: merged(body, 'heatingPrepayments', current.heatingPrepayments, (v) => (v === null ? undefined : readSchedule<PrepaymentEntry>(v, moneyEntry))),
    heatingPrepaymentOverrides: merged(body, 'heatingPrepaymentOverrides', current.heatingPrepaymentOverrides, readHeatingOverrides),
```

In `writeTenancyChildren` vor `if (t.personHistory.length > 0)`:

```ts
  await db.delete(heatingPrepayments).where(eq(heatingPrepayments.tenancyId, t.id))
  const heizstaffel = t.heatingPrepayments ?? []
  if (heizstaffel.length > 0) {
    await db.insert(heatingPrepayments).values(heizstaffel.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  await db.delete(heatingPrepaymentOverrides).where(eq(heatingPrepaymentOverrides.tenancyId, t.id))
  const heizkorrekturen = t.heatingPrepaymentOverrides ?? []
  if (heizkorrekturen.length > 0) await db.insert(heatingPrepaymentOverrides).values(heizkorrekturen.map((o) => ({ tenancyId: t.id, ...o })))
```

Hinter `rulesForProperty`:

```ts
// Die Regeln, nach denen die Heizperioden einer Anlage gezählt werden (Heizung PR 5): die eigenen
// oder die des Objekts. `own` false heißt: Jede Heizperiode ist ein Abrechnungszeitraum des Objekts,
// und die Positionen tragen dessen Schlüssel wie bisher.
export async function heatingRulesOf(db: Executor, plantId: string): Promise<{ propertyId: string; own: boolean; rules: PeriodRules } | null> {
  const [plant] = await db.select({ propertyId: heatingPlants.propertyId, startMonth: heatingPlants.periodStartMonth }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (!plant) return null
  const objectRules = await rulesForProperty(db, plant.propertyId)
  if (plant.startMonth === null) return { propertyId: plant.propertyId, own: false, rules: objectRules }
  const changes = await db.select({ fromMonth: heatingPeriodChanges.fromMonth }).from(heatingPeriodChanges)
    .where(eq(heatingPeriodChanges.plantId, plantId)).orderBy(heatingPeriodChanges.fromMonth)
  return { propertyId: plant.propertyId, own: true, rules: plantRules({ periodStartMonth: plant.startMonth, periodChanges: changes.map((c) => c.fromMonth) }, objectRules) }
}

// Die Regeln des Schlüssels einer Kostenposition: bei einer Heizposition einer Anlage mit eigener
// Heizperiode deren, sonst die des Objekts.
async function itemRules(db: Executor, c: CostItem): Promise<PeriodRules> {
  const heating = c.heatingPlantId ? await heatingRulesOf(db, c.heatingPlantId) : null
  return heating?.own ? heating.rules : rulesForProperty(db, c.propertyId)
}

// G-A2: Eine Heizposition einer Anlage mit eigener Heizperiode steht unter einer Heizperiode der
// Anlage. Ein Objektzeitraum wäre dort ein Schlüssel ohne Abrechnung.
function requireHeatingPeriod(rules: PeriodRules, after: CostItem): void {
  if (periodOfKey(rules, after.period) !== null) return
  const nah = periodContaining(rules, `${after.period}-01`)
  throw new PeriodError(
    `Die Heizposition „${after.description}“ steht unter ${after.period}; die Heizanlage rechnet aber in eigenen Heizperioden ab. ` +
      `Bitte wählen Sie die Heizperiode; meinen Sie ${periodLabel(nah)}?`,
  )
}
```

`guardCostItem` (Fassung von PR 3): die Zeile mit `requirePeriods(…)` ersetzen durch

```ts
  // Der Zeitraum (#208) muss zum Objekt gehören, bei einer Heizposition mit eigener Heizperiode zur
  // Anlage (Heizung PR 5). `year` ohne `period` schickt nur ein alter Tab.
  const heating = after.heatingPlantId ? await heatingRulesOf(db, after.heatingPlantId) : null
  if (heating?.own) requireHeatingPeriod(heating.rules, after)
  else await requirePeriods(db, after.propertyId, [after.period], has(body, 'year') && !has(body, 'period'), 'Die Kostenposition')
```

In `requireServiceAndTax` (PR 3) die Zeile
`const rules = await rulesForProperty(db, after.propertyId)` ersetzen durch
`const rules = await itemRules(db, after)` (Heizung PR 5: das Jahr der Zahlung einer Heizposition
richtet sich nach ihrer Heizperiode).

Hinter `isPeriodClosed` (PR 4):

```ts
// Ist der Zeitraum einer Position abgeschlossen? Bei einer Heizposition mit eigener Heizperiode
// (Heizung PR 5): ihre Heizkostenabrechnung (Weg d) oder die Abrechnung, in der ihre Heizperiode endet.
export async function itemPeriodClosed(db: Executor, c: CostItem): Promise<boolean> {
  const heating = c.heatingPlantId ? await heatingRulesOf(db, c.heatingPlantId) : null
  if (!heating?.own || !c.heatingPlantId) return isPeriodClosed(db, c.propertyId, c.period)
  const h = periodOfKey(heating.rules, c.period)
  if (h === null) return false
  const zu = await db.select({ id: closedHeatingSettlements.id }).from(closedHeatingSettlements)
    .where(and(eq(closedHeatingSettlements.plantId, c.heatingPlantId), eq(closedHeatingSettlements.period, c.period)))
  if (zu.length > 0) return true
  return isPeriodClosed(db, c.propertyId, periodContaining(await rulesForProperty(db, c.propertyId), h.to).key)
}
```

In `guardCostItemHeating` (PR 4) `(await isPeriodClosed(db, after.propertyId, after.period))` durch
`(await itemPeriodClosed(db, after))` ersetzen.

`defaultHeatingPlant` (PR 4) ersetzen:

```ts
// Die Anlage, die eine neue Heizposition ohne Angabe bekommt: die einzige ihres Objekts, außer ihr
// Zeitraum ist abgeschlossen (Entwurf 3.0). Rechnet die Anlage in eigenen Heizperioden ab (Heizung
// PR 5), kommt die Position in die Heizperiode, die in ihrem Objektzeitraum endet, mit dem Jahr der
// Zahlung des Objektzeitraums, wenn die Heizperiode über zwei Kalenderjahre reicht; so legt ein Tab
// von vor dem Update oder die Belegbuchung keine Position unter einem Schlüssel an, den es für die
// Anlage nicht gibt. Endet dort keine oder mehr als eine Heizperiode, bleibt sie ohne Anlage, und
// der Vermieter ordnet sie zu.
async function defaultHeatingPlant(db: Executor, c: CostItem): Promise<Pick<CostItem, 'heatingPlantId' | 'period' | 'taxYear'>> {
  const none = { heatingPlantId: null, period: c.period, taxYear: c.taxYear }
  if (c.category !== HEATING_CATEGORY) return none
  const [einzige, ...weitere] = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.propertyId, c.propertyId))
  if (!einzige || weitere.length > 0) return none
  if (await isPeriodClosed(db, c.propertyId, c.period)) return none
  const heating = await heatingRulesOf(db, einzige.id)
  if (!heating?.own) return { ...none, heatingPlantId: einzige.id }
  const p = periodOfKey(await rulesForProperty(db, c.propertyId), c.period)
  const enden = p === null ? [] : heatingPeriodsEndingIn(heating.rules, p)
  const h = enden.length === 1 ? enden[0] : undefined
  if (h === undefined) return none
  const neu = { heatingPlantId: einzige.id, period: h.key, taxYear: spansTwoYears(h) ? (c.taxYear ?? startYearOf(c.period)) : undefined }
  return (await itemPeriodClosed(db, { ...c, ...neu })) ? none : neu
}
```

`costItemCollection.insert` (PR 4): die erste Zeile ersetzen durch

```ts
    const entity = c.heatingPlantId === undefined ? { ...c, ...(await defaultHeatingPlant(db, c)) } : c
```

Hinter `guardTenancyMove`:

```ts
// Die Korrekturen der Heizvorauszahlung (Heizung PR 5): Anlage desselben Objekts, Schlüssel einer
// getrennt abgerechneten Heizperiode der Anlage, eine vorläufige nur mit Monaten dieser
// Heizperiode (D2).
async function guardHeatingOverrides(db: Executor, after: Tenancy): Promise<void> {
  const overrides = after.heatingPrepaymentOverrides ?? []
  if (overrides.length === 0) return
  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, after.unitId))
  for (const o of overrides) {
    const heating = await heatingRulesOf(db, o.plantId)
    if (!heating) throw new HeatingError(400, 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
    if (unit && heating.propertyId !== unit.propertyId) {
      throw new CrossPropertyError(
        `Die Heizvorauszahlung von „${after.tenantName}“ gehört zu Objekt ${await propertyName(db, unit.propertyId)}, die Heizanlage aber zu ` +
          `${await propertyName(db, heating.propertyId)}. Eine Korrektur gehört zur Heizanlage des eigenen Objekts.`,
      )
    }
    const h = periodOfKey(heating.rules, o.period)
    if (h === null) {
      throw new PeriodError(`Die Korrektur der Heizvorauszahlung von „${after.tenantName}“ steht unter ${o.period}, einer Heizperiode, die es für die Heizanlage nicht gibt.`)
    }
    // Eine Heizkorrektur gibt es nur für eine getrennt abgerechnete Heizperiode (Weg d). Sonst
    // rechnet die Abrechnung des Objekts die Heizstaffel an, und ihre Jahreskorrektur gilt für alles,
    // was sie anrechnet (3.7).
    const spans = await db.select({ from: heatingSeparateSpans.from, until: heatingSeparateSpans.until }).from(heatingSeparateSpans).where(eq(heatingSeparateSpans.plantId, o.plantId))
    if (!heating.own || isObjectPeriod(await rulesForProperty(db, heating.propertyId), h) || spanOf(spans, h) === undefined) {
      throw new PeriodError(
        `Die Korrektur der Heizvorauszahlung von „${after.tenantName}“ für ${periodLabel(h)}: Eine solche Korrektur gibt es nur für eine getrennt abgerechnete Heizperiode. ` +
          'Tragen Sie den tatsächlich gezahlten Betrag als Jahreskorrektur der Abrechnung ein.',
      )
    }
    if (!o.provisional) continue
    const months = periodMonths(h)
    if (o.fromMonth === null || o.toMonth === null || !months.includes(o.fromMonth) || !months.includes(o.toMonth) || o.toMonth < o.fromMonth) {
      throw new PeriodError(`Die vorläufige Korrektur der Heizvorauszahlung von „${after.tenantName}“ nennt Monate außerhalb der Heizperiode ${periodLabel(h)}.`)
    }
  }
}
```

In `guardTenancy` vor `await guardTenancyMove(db, before, after)`:

```ts
  await guardHeatingOverrides(db, after)
```

`orphanPeriodKeys`: direkt nach `const pruefe = …` einfügen

```ts
  // Heizpositionen und Heizkorrekturen einer Anlage mit eigener Heizperiode tragen deren Schlüssel
  // (Heizung PR 5); ohne eigene die des Objekts.
  const plantRulesById = new Map((await readHeatingPlants(db)).map((p) => [p.id, {
    propertyId: p.propertyId,
    rules: p.periodStartMonth === null ? null : plantRules(p, rulesById.get(p.propertyId) ?? CALENDAR_RULES),
  }]))
  const pruefeHeizung = (plantId: string | null, propertyId: string | null, key: string, was: string): void => {
    const plant = plantId === null ? undefined : plantRulesById.get(plantId)
    if (!plant?.rules) return pruefe(plant?.propertyId ?? propertyId, key, was)
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(plant.rules, period) === null) befunde.push(`${was} steht unter der Heizperiode ${key}, die es für die Heizanlage nicht gibt.`)
  }
```

die Schleife über die Kostenpositionen ersetzen durch

```ts
  for (const c of await db.select({ propertyId: costItems.propertyId, period: costItems.period, description: costItems.description, plantId: costItems.heatingPlantId }).from(costItems)) {
    pruefeHeizung(c.plantId, c.propertyId, c.period, `Die Kostenposition „${c.description}“`)
  }
```

und vor `return befunde` ergänzen:

```ts
  const heizkorrekturen = await db
    .select({ plantId: heatingPrepaymentOverrides.plantId, period: heatingPrepaymentOverrides.period, tenantName: tenancies.tenantName })
    .from(heatingPrepaymentOverrides)
    .innerJoin(tenancies, eq(heatingPrepaymentOverrides.tenancyId, tenancies.id))
  for (const k of heizkorrekturen) pruefeHeizung(k.plantId, null, k.period, `Die Korrektur der Heizvorauszahlung von „${k.tenantName}“`)
  for (const c of await db.select({ plantId: closedHeatingSettlements.plantId, period: closedHeatingSettlements.period }).from(closedHeatingSettlements)) {
    pruefeHeizung(c.plantId, null, c.period, 'Eine abgeschlossene Heizkostenabrechnung')
  }
  for (const c of await db.select({ plantId: closedHeatingSettlementHistory.plantId, period: closedHeatingSettlementHistory.period }).from(closedHeatingSettlementHistory)) {
    pruefeHeizung(c.plantId, null, c.period, 'Ein früherer Abschluss einer Heizkostenabrechnung')
  }
```

`crossPropertyViolations`: vor `return befunde` ergänzen

```ts
  // Heizung PR 5: eine Heizkorrektur auf die Anlage eines anderen Objekts.
  const anlagen = new Map((await db.select({ id: heatingPlants.id, propertyId: heatingPlants.propertyId }).from(heatingPlants)).map((p) => [p.id, p.propertyId]))
  const heiz = await db
    .select({ plantId: heatingPrepaymentOverrides.plantId, tenantName: tenancies.tenantName, propertyId: units.propertyId })
    .from(heatingPrepaymentOverrides)
    .innerJoin(tenancies, eq(heatingPrepaymentOverrides.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
  for (const h of heiz) {
    if (anlagen.get(h.plantId) !== h.propertyId) befunde.push(`Die Korrektur der Heizvorauszahlung von „${h.tenantName}“ zeigt auf die Heizanlage eines anderen Objekts.`)
  }
```

Das Wiederherstellen (`server/src/db/backup.ts`, PR 2) ruft `orphanPeriodKeys` und
`crossPropertyViolations` schon; dort ändert sich nichts.

- [ ] **Step 5: Die Anlage (`server/src/db/heating.ts`)**

Importe aus `'./schema.ts'` um `closedHeatingSettlementHistory, closedHeatingSettlements, heatingPrepaymentOverrides, heatingSeparateSpans` ergänzen.
In `LATER` die Einträge `ownPeriod` und `separate` ersetzen durch:

```ts
  rhythm: 'Den Zeitraum der Heizung stellen Sie nach dem Anlegen unter „Zeitraum der Heizung“ ein; eine Vorschau zeigt, was mit Ihren Heizpositionen geschieht.',
  separateVia: 'Ob die Heizkosten getrennt abgerechnet werden, stellen Sie bei einer eigenen Heizperiode unter „Getrennte Heizkostenabrechnung“ ein; eine Vorschau zeigt, wie die Vorauszahlung aufgeteilt wird.',
```

In `guardHeatingPlant` die beiden Zeilen mit `LATER.ownPeriod` und `LATER.separate` ersetzen durch:

```ts
  // Den Rhythmus setzt nur der Wechsel mit Vorschau (heatingPeriodChange.ts, Heizung PR 5).
  if ((before?.periodStartMonth ?? null) !== after.periodStartMonth) throw new HeatingError(400, LATER.rhythm)
  // Mit eigener Heizperiode ändert die Antwort auf „getrennt abgerechnet?“ die Anrechnung der
  // Vorauszahlungen; das geht nur über die Vorschau (separateSettlement.ts). Ohne eigene Heizperiode
  // ist H = P, und die Antwort ist eine Angabe.
  if (before !== null && after.periodStartMonth !== null && before.separateSettlement !== after.separateSettlement) {
    throw new HeatingError(400, LATER.separateVia)
  }
```

`PlantRemoval` ersetzen:

```ts
export type PlantRemoval =
  | { removed: true; released: number }
  | { removed: false; reason: 'missing' }
  | { removed: false; reason: 'meters'; meters: string[] }
  | { removed: false; reason: 'separate' }
```

In `removeHeatingPlant` hinter `if (!plant) return { removed: false, reason: 'missing' }`:

```ts
  // Getrennte Heizkostenabrechnung (Heizung PR 5): Spannen, Heizkorrekturen und abgeschlossene
  // Heizkostenabrechnungen hängen an der Anlage. Ohne sie fiele jede getrennte Heizperiode still in
  // die Betriebskostenabrechnung zurück.
  const anzahl = async (table: typeof heatingSeparateSpans | typeof heatingPrepaymentOverrides | typeof closedHeatingSettlements | typeof closedHeatingSettlementHistory) =>
    (await db.select({ n: count() }).from(table).where(eq(table.plantId, id)))[0]?.n ?? 0
  const getrennt = (await anzahl(heatingSeparateSpans)) + (await anzahl(heatingPrepaymentOverrides)) + (await anzahl(closedHeatingSettlements)) + (await anzahl(closedHeatingSettlementHistory))
  if (getrennt > 0) return { removed: false, reason: 'separate' }
```

- [ ] **Step 6: Löschroute (`server/src/index.ts`)**

In `app.delete('/api/heating-plants/:id', …)` (PR 4) hinter der Zeile mit `result.reason === 'missing'`:

```ts
  if (result.reason === 'separate') {
    return res.status(409).json({
      error: 'Die Heizkosten dieser Anlage werden getrennt abgerechnet, oder es gibt abgeschlossene Heizkostenabrechnungen oder Korrekturen der ' +
        'Heizvorauszahlung. Schalten Sie zuerst die getrennte Heizkostenabrechnung aus. Abgeschlossene Heizkostenabrechnungen bleiben als Archiv; ' +
        'solange es sie gibt, bleibt die Anlage bestehen.',
    })
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizperiode.test.ts test/db-heizanlage.test.ts test/db-repository.test.ts test/db-stock.test.ts test/db-backup.test.ts test/booking.test.ts && npm run typecheck`
Expected: PASS (db-heizperiode 8 Tests). `booking.test.ts` bleibt grün: Ohne Anlage mit eigener
Heizperiode schreibt die Belegbuchung wie bisher.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/read.ts server/src/db/repository.ts server/src/db/heating.ts server/src/index.ts server/test/db-heizperiode.test.ts server/test/db-heizanlage.test.ts server/test/db-stock.test.ts
git commit -m "Heizperiode: Heizstaffel und Heizkorrekturen lesen und schreiben, Heizpositionen unter ihrer Heizperiode

Eine neue Heizposition unter dem Objektzeitraum kommt in die Heizperiode, die darin endet. Den
Rhythmus setzt PUT nie; eine Anlage mit Daten nach Weg d lässt sich nicht still entfernen.

Refs #217"
```

---
### Task 4: Den Zeitraum der Heizung wechseln, mit Vorschau

Entwurf 3.0, 3.6 und B2: Beim Wechsel des Rhythmus einer Anlage (auch beim ersten Einstellen einer
eigenen Heizperiode und beim Zurück zum Zeitraum des Objekts) kommen die Heizpositionen offener
Zeiträume in die Heizperiode, die in ihrem Abrechnungszeitraum endet; Korrekturen der
Heizvorauszahlung werden je neuer Heizperiode neu erfasst; Abgeschlossenes ist unantastbar. Der
Wechsel des Objektzeitraums (PR 3) lässt Heizpositionen einer Anlage mit eigener Heizperiode, wo sie
sind, und lehnt ab, wenn er für eine Heizperiode Weg d ein- oder ausschalten würde.

**Files:**
- Create: `server/src/db/heatingPeriodChange.ts`
- Modify: `shared/types.ts`, `server/src/db/periodChange.ts`, `server/src/index.ts`
- Test: `server/test/db-heizperiode-wechsel.test.ts` (neu), `server/test/api.test.ts`

**Interfaces:**
- Consumes: `checkRules`, `monthsText` (PR 3, periodChange.ts); `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`, `separateOwner` (Task 2); `readHeatingPlants`, `readTenancies`, `readCostItems`, `readClosedSettlements`, `readProperties` (read.ts); `PeriodError` (repository.ts); Tabellen aus Task 1 und PR 4.
- Produces:
  - `type HeatingPeriodChangePreview`, `type HeatingPeriodChangeAnswers` (`shared/types.ts`, Gestalt unten)
  - `previewHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, today: string): Promise<HeatingPeriodChangePreview | null>`, `applyHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, rawAnswers: unknown, today: string): Promise<{ plant: HeatingPlant } | { error: string; preview: HeatingPeriodChangePreview } | null>` (`server/src/db/heatingPeriodChange.ts`); `rawRules === null` heißt „wie das Objekt“
  - Routen `POST /api/heating-plants/:id/period/preview` (Rumpf `{ rules }`; 200, 400, 404) und `PUT /api/heating-plants/:id/period` (Rumpf `{ rules, answers }`; 200 Anlage, 400, 404, 409 `{ error, preview }`)

- [ ] **Step 1: Write the failing test**

`server/test/db-heizperiode-wechsel.test.ts`:

```ts
// Wechsel der eigenen Heizperiode (Heizung PR 5, Entwurf 3.0, 3.6, G-A2, B2) und was der Wechsel des
// Objektzeitraums mit Heizpositionen tut.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange } from '../src/db/heatingPeriodChange.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { closeSettlement, createEntity, findEntity, listCollection, PeriodError, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, listHeatingPlants } from '../src/db/heating.ts'
import { heatingPlants, heatingSeparateSpans } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, HeatingPeriodChangePreview } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizwechsel-'))
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
const heizposition = (db: Database, id: string, period: string, over: Record<string, unknown> = {}) =>
  createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', ...over })
const items = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const preview = async (opened: OpenedDatabase, rules: unknown): Promise<HeatingPeriodChangePreview> =>
  (await opened.read((db) => previewHeatingPeriodChange(db, 'hp1', rules, TODAY))) ?? assert.fail('keine Anlage')
const eigeneHeizperiode = (db: Database, startMonth: number) => db.update(heatingPlants).set({ periodStartMonth: startMonth }).where(eq(heatingPlants.id, 'hp1'))

async function haus(db: Database): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] })
}

test('G-A2: Beim ersten Einstellen kommt die Messdienstabrechnung 2025/26 von 2026 nach 2025/2026; Abgeschlossenes bleibt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await heizposition(db, 'c2024', '2024-01')
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await heizposition(db, 'c2026', '2026-01')
    })
    const v = await preview(opened, MAI)
    assert.deepEqual(v.blocked, [])
    assert.deepEqual(v.moves.map((m) => [m.costItemId, m.from, m.to, m.toLabel]), [['c2026', '2026-01', '2025-05', '2025/2026']])
    assert.deepEqual(v.groups, [])
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', MAI, {}, TODAY))
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.periodStartMonth, r.plant.periodChanges], [5, []])
    const nachher = Object.fromEntries((await items(opened)).map((c) => [c.id, [c.period, c.taxYear, c.heatingPlantId]]))
    assert.deepEqual(nachher, { c2024: ['2024-01', undefined, undefined], c2026: ['2025-05', 2026, 'hp1'] })
  })
})

test('Eine Heizperiode in einer abgeschlossenen Abrechnung sperrt den Wechsel (Review Focus 2)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2024-05', { heatingPlantId: 'hp1', taxYear: 2025 })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} })
    })
    const v = await preview(opened, { startMonth: 1, changes: [] })
    assert.match(v.blocked.join(' '), /Heizperiode 2024\/2025 gehört zur abgeschlossenen Abrechnung 2025/)
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', { startMonth: 1, changes: [] }, {}, TODAY))
    assert.ok(r && 'error' in r)
    assert.match(r.error, /Gespeichert wurde nichts/)
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.periodStartMonth, 5)
    assert.equal((await items(opened))[0]?.period, '2024-05')
  })
})

test('B2: Die Heizperiode wechselt auf Januar; die Heizkorrektur wird für den Rumpf und das Jahr neu erfasst', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
      await updateEntity(db, 'tenancies', 't1', {
        prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }],
        heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
        heatingPrepaymentOverrides: [{ plantId: 'hp1', period: '2025-05', cents: 140000, provisional: false, fromMonth: null, toMonth: null }],
        // Die Jahreskorrektur 2026 enthält bei Weg d nur die übrigen Vorauszahlungen (3.7).
        prepaymentOverrides: { '2026-01': 212400 },
      })
    })
    const rules = { startMonth: 5, changes: ['2026-01'] }
    const v = await preview(opened, rules)
    assert.deepEqual(v.newShort, [{ key: '2025-05', label: '01.05.–31.12.2025' }])
    // Der Rumpf 2025-05 bleibt getrennt: Heizkorrektur. 2026 ist H = P: Die Abrechnung 2026 rechnet
    // danach auch die Heizstaffel an, ihre Jahreskorrektur wird deshalb für alles neu erfasst.
    assert.deepEqual(v.overrides.map((o) => [o.tenancyId, o.from.map((f) => [f.kind, f.key, f.cents]), o.ask.map((a) => [a.kind, a.period, a.months])]), [
      ['t1', [['heating', '2025-05', 140000], ['total', '2026-01', 212400]], [['heating', '2025-05', '05–12/2025'], ['total', '2026-01', '01–12/2026']]],
    ])
    // Ab 2026 ist H = P: Diese Heizperioden stehen danach in der Gesamtabrechnung (die Liste reicht
    // bis zum Ende des Jahres nach dem letzten Wechsel).
    assert.deepEqual(v.endsSeparate, [{ key: '2026-01', label: '2026' }, { key: '2027-01', label: '2027' }])
    const ohne = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', rules, {}, TODAY))
    assert.ok(ohne && 'error' in ohne)
    assert.match(ohne.error, /Müller: tatsächlich gezahlte Heizvorauszahlung 05–12\/2025/)
    const ok = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', rules, { overrides: { t1: { '2025-05': 90000 } }, totals: { t1: { '2026-01': 360000 } } }, TODAY))
    assert.ok(ok && 'plant' in ok)
    assert.deepEqual(ok.plant.periodChanges, ['2026-01'])
    const t1 = await opened.read((db) => findEntity(db, 'tenancies', 't1'))
    assert.deepEqual(fieldOf(t1, 'heatingPrepaymentOverrides'), [{ plantId: 'hp1', period: '2025-05', cents: 90000, provisional: false, fromMonth: null, toMonth: null }])
    assert.deepEqual(fieldOf(t1, 'prepaymentOverrides'), { '2026-01': 360000 })
  })
})

test('Zurück zum Zeitraum des Objekts: die Heizposition kommt in den Zeitraum, in dem ihre Heizperiode endet', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2025-05', { heatingPlantId: 'hp1', taxYear: 2026 })
    })
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', null, {}, TODAY))
    assert.ok(r && 'plant' in r)
    assert.equal(r.plant.periodStartMonth, null)
    assert.deepEqual((await items(opened)).map((c) => [c.period, c.taxYear]), [['2026-01', undefined]])
    await assert.rejects(opened.read((db) => previewHeatingPeriodChange(db, 'hp1', null, TODAY)), (e: unknown) => e instanceof PeriodError && /Es ändert sich nichts/.test(e.message))
    assert.equal(await opened.read((db) => previewHeatingPeriodChange(db, 'gibt-es-nicht', MAI, TODAY)), null)
  })
})

test('Wechsel des Objektzeitraums: Heizpositionen der eigenen Heizperiode bleiben, wo sie sind', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await heizposition(db, 'c1', '2025-05', { heatingPlantId: 'hp1', taxYear: 2026 })
      await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
    })
    const v = await opened.read((db) => previewPeriodChange(db, 'objekt-1', { startMonth: 1, changes: ['2025-07'] }, TODAY)) ?? assert.fail('kein Objekt')
    assert.deepEqual(v.groups.flatMap((g) => g.items.map((i) => i.costItemId)), ['mu'])
    assert.deepEqual(v.blocked, [])
  })
})

test('Wechsel des Objektzeitraums, der Weg d für eine Heizperiode umschalten würde, wird abgelehnt (Review Focus 5)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await eigeneHeizperiode(db, 5)
      await db.insert(heatingSeparateSpans).values({ plantId: 'hp1', from: '2025-05', until: null })
    })
    const v = await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI, TODAY)) ?? assert.fail('kein Objekt')
    assert.match(v.blocked.join(' '), /nicht mehr getrennt abgerechnet\. Stellen Sie zuerst unter Stammdaten → Heizung/)
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI, {}, () => 'neu', TODAY))
    assert.ok(r && 'error' in r)
  })
})
```

An `server/test/api.test.ts` anhängen:

```ts
test('Zeitraum der Heizung (Heizung PR 5): Vorschau und Wechsel über HTTP, PUT der Anlage setzt ihn nicht', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const position = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2026-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100000, key: 'amounts' }) })
    const vorschau = await jsonOf<{ moves: { to: string }[] }>(await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } }))
    assert.deepEqual(vorschau.moves.map((m) => m.to), ['2025-05'])
    const per = await send(`/api/heating-plants/${plant.id}`, 'PUT', { periodStartMonth: 5 })
    assert.equal(per.status, 400)
    const ok = await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: {} })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<HeatingPlant>(ok)).periodStartMonth, 5)
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === position.id)?.period, '2025-05')
    assert.equal((await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 13, changes: [] } })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/period/preview', 'POST', { rules: null })).status, 404)
  } finally {
    s.stop()
  }
})
```

(`jsonOf`, `HeatingPlant`, `CostItem` stehen seit PR 4 im Import von api.test.ts; sonst ergänzen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-heizperiode-wechsel.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/db/heatingPeriodChange.ts`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter `PeriodChangeAnswers` (PR 3):

```ts
// Die Vorschau eines Wechsels der eigenen Heizperiode (Heizung PR 5, Entwurf 3.0, 3.6, B2).
// `rules` null heißt „wie das Objekt“. `moves`: Heizpositionen, die in eine andere Heizperiode
// kommen; `groups`: solche, bei denen der Vermieter wählt; `overrides`: Korrekturen, die neu erfasst
// werden, je Mietverhältnis mit den bisherigen (`from`) und den gefragten (`ask`): `heating` je
// getrennt abgerechneter Heizperiode, `total` je Abrechnung P für alles, was sie anrechnet (3.7);
// `endsSeparate`: Heizperioden, die danach in der Gesamtabrechnung stehen.
export type HeatingPeriodChangePreview = {
  rules: PeriodRules | null
  periods: { key: PeriodKey; label: string; short: boolean; separate: boolean }[]
  newShort: { key: PeriodKey; label: string }[]
  blocked: string[]
  moves: { costItemId: string; description: string; amountCents: number; from: PeriodKey; fromLabel: string; to: PeriodKey; toLabel: string }[]
  groups: { from: PeriodKey; fromLabel: string; items: { costItemId: string; description: string; amountCents: number }[]; options: { key: PeriodKey; label: string }[]; suggested: PeriodKey }[]
  overrides: {
    tenancyId: string
    tenantName: string
    from: { kind: 'heating' | 'total'; key: PeriodKey; label: string; cents: number }[]
    ask: { kind: 'heating' | 'total'; period: PeriodKey; label: string; months: string }[]
  }[]
  endsSeparate: { key: PeriodKey; label: string }[]
}

// Die Antworten: je Gruppe die neue Heizperiode; je Mietverhältnis und gefragter Heizperiode die
// tatsächlich gezahlte Heizvorauszahlung (`overrides`) und je gefragter Abrechnung P die tatsächlich
// gezahlten Vorauszahlungen insgesamt (`totals`), in Cent; `null` heißt „keine Korrektur, die
// Staffel gilt“.
export type HeatingPeriodChangeAnswers = {
  groups?: Record<string, string>
  overrides?: Record<string, Record<string, number | null>>
  totals?: Record<string, Record<string, number | null>>
}
```

- [ ] **Step 4: `server/src/db/heatingPeriodChange.ts`**

```ts
// Wechsel der eigenen Heizperiode einer Anlage mit Vorschau (#217, Heizung PR 5, Entwurf 3.0, 3.6,
// B2): dasselbe Verfahren wie beim Wechsel des Objektzeitraums (periodChange.ts). Gezeigt wird vorher,
// was mit jeder Zeile geschieht; geschrieben wird in einer Transaktion und nur mit den Antworten, die
// die Vorschau verlangt.
//
// - **Heizpositionen** kommen in die Heizperiode, die in ihrem Abrechnungszeitraum endet (3.0, G-A2):
//   Eine Messdienstabrechnung 2025/26, bisher unter 2026, steht danach unter 2025/2026. Endet dort
//   keine oder mehr als eine, ordnet der Vermieter je Gruppe zu. Heizkosten werden nie nach Tagen
//   geteilt (G-C1).
// - **Korrekturen** lassen sich nicht auf Monate verteilen (N4, B2): Ändert sich eine getrennt
//   abgerechnete Heizperiode mit Heizkorrektur, wird je neuer Heizperiode gefragt, und wo ihre Monate
//   danach eine Abrechnung P anrechnet, nach den Vorauszahlungen insgesamt dieser Abrechnung. Ebenso für
//   jede offene Abrechnung P mit Jahreskorrektur, deren Monate der Heizstaffel danach woanders
//   angerechnet würden: Die Jahreskorrektur gilt für alles, was P anrechnet (3.7).
// - **Unantastbar** (409): eine abgeschlossene Heizkostenabrechnung, deren Heizperiode sich ändert;
//   eine Heizperiode mit Heizpositionen, die in einer abgeschlossenen Abrechnung des Objekts endet;
//   jeder Monat einer abgeschlossenen Abrechnung, dessen Heizvorauszahlung danach woanders angerechnet
//   würde; Angaben je Heizperiode (`heating_periods`), die ab PR 6 geschrieben werden und deren
//   Umschlüsselung mit ihnen kommt.
//
// Gelesen wird vor der Transaktion; die Schlange in open.ts lässt dazwischen keine andere Anfrage herein.

import { and, eq, inArray } from 'drizzle-orm'
import { heatingPeriodsEndingIn, plantRules, separateOwner, servesUnit, settledSeparately, type PlantWay } from '../../../shared/heatingPeriod.ts'
import { parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, spansTwoYears, startYearOf } from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, HeatingPeriodChangePreview, HeatingPlant, PeriodKey, PeriodRules, Tenancy } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { checkRules, monthsText } from './periodChange.ts'
import { readClosedSettlements, readCostItems, readHeatingPlants, readProperties, readTenancies, readUnits } from './read.ts'
import { PeriodError } from './repository.ts'
import {
  closedHeatingSettlementHistory, closedHeatingSettlements, costItems, heatingPeriodChanges, heatingPeriods, heatingPlants, heatingPrepaymentOverrides, prepaymentOverrides,
} from './schema.ts'

type Status = 'same' | 'grows' | 'shrinks' | 'gone'
type Affected = { key: PeriodKey; old: BillingPeriod; now: BillingPeriod | null; status: Status }

function affectedOf(before: PeriodRules, next: PeriodRules, key: PeriodKey): Affected | null {
  const old = periodOfKey(before, key)
  if (old === null) return null
  const now = periodOfKey(next, key)
  const status: Status = now === null ? 'gone'
    : now.from === old.from && now.to === old.to ? 'same'
      : now.from <= old.from && now.to >= old.to ? 'grows' : 'shrinks'
  return { key, old, now, status }
}

const sameRules = (a: PeriodRules, b: PeriodRules): boolean => a.startMonth === b.startMonth && a.changes.join() === b.changes.join()
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: BillingPeriod): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))
const overlapDays = (a: BillingPeriod, b: BillingPeriod): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}
// Das Jahr der Zahlung in der neuen Heizperiode, dieselbe Regel wie beim Wechsel des Objektzeitraums.
const taxYearIn = (target: BillingPeriod, item: CostItem): number | null =>
  spansTwoYears(target) ? item.taxYear ?? startYearOf(item.period) : null

type Ask = { kind: 'heating' | 'total'; period: BillingPeriod; months: string[] }
type OverrideAsk = {
  tenancy: Tenancy
  dropHeating: Set<PeriodKey>
  dropTotals: Set<PeriodKey>
  from: { kind: 'heating' | 'total'; key: PeriodKey; label: string; cents: number }[]
  ask: Map<string, Ask>
}
type Plan = {
  preview: HeatingPeriodChangePreview
  plant: HeatingPlant
  own: PeriodRules | null
  moves: { item: CostItem; to: BillingPeriod }[]
  groups: Map<PeriodKey, { items: CostItem[]; options: BillingPeriod[] }>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
}

async function planHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, today: string): Promise<Plan | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  const own = rawRules === null ? null : checkRules(rawRules)
  const before = plantRules(plant, objectRules)
  const next = own ?? objectRules
  if ((own === null) === (plant.periodStartMonth === null) && sameRules(before, next)) {
    throw new PeriodError('Es ändert sich nichts: Der Zeitraum der Heizung ist schon so eingestellt.')
  }
  const nextPlant: PlantWay = { periodStartMonth: own?.startMonth ?? null, periodChanges: own?.changes ?? [], separateSpans: plant.separateSpans }

  const memo = new Map<PeriodKey, Affected | null>()
  const changed = (key: PeriodKey): Affected | null => {
    if (!memo.has(key)) memo.set(key, affectedOf(before, next, key))
    const a = memo.get(key) ?? null
    return a !== null && a.status !== 'same' ? a : null
  }

  const items = (await readCostItems(db)).filter((c) => c.heatingPlantId === plantId)
  const closedP = (await readClosedSettlements(db)).filter((c) => c.propertyId === plant.propertyId)
  const closedH = await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, plantId))
  const historyH = await db.select({ period: closedHeatingSettlementHistory.period }).from(closedHeatingSettlementHistory).where(eq(closedHeatingSettlementHistory.plantId, plantId))
  const periodRows = await db.select({ period: heatingPeriods.period }).from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const served = new Set((await readUnits(db)).filter((u) => u.propertyId === plant.propertyId && servesUnit(plant, u)).map((u) => u.id))
  const tenancies = (await readTenancies(db)).filter((t) => served.has(t.unitId))
  const separateNow = (h: BillingPeriod): boolean => settledSeparately(nextPlant, objectRules, h)

  const blocked = new Set<string>()
  for (const c of closedH) {
    const a = changed(c.period)
    if (a) blocked.add(`Die Heizkostenabrechnung ${periodLabel(a.old)} ist abgeschlossen; nach dem Wechsel hätte sie einen anderen Zeitraum. Öffnen Sie sie wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
  }
  for (const h of historyH) {
    const a = changed(h.period)
    if (a?.status === 'gone') blocked.add(`Für die Heizkostenabrechnung ${periodLabel(a.old)} gibt es frühere Abschlüsse im Verlauf; diese Heizperiode gäbe es nach dem Wechsel nicht mehr. Wählen Sie einen späteren Beginn.`)
  }
  for (const r of periodRows) {
    const a = changed(r.period)
    if (a) blocked.add(`Für die Heizperiode ${periodLabel(a.old)} sind Angaben zur Heizung erfasst (Warmwasser, Verteilung). Den Zeitraum einer solchen Heizperiode zu ändern, kommt mit einer späteren Version.`)
  }
  for (const p of closedP) {
    const closed = periodOfKey(objectRules, p.period)
    if (closed === null) continue
    for (const item of items) {
      const a = changed(item.period)
      if (a && a.old.to >= closed.from && a.old.to <= closed.to) {
        blocked.add(`Die Heizperiode ${periodLabel(a.old)} gehört zur abgeschlossenen Abrechnung ${periodLabel(closed)}; nach dem Wechsel stünde sie anders darin. Öffnen Sie die Abrechnung wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
      }
    }
    // Jeder Monat der Heizstaffel wird genau einmal angerechnet (6.1 Nr. 5): Wo er in einer
    // abgeschlossenen Abrechnung angerechnet ist, muss er es bleiben.
    if (periodMonths(closed).some((m) => separateOwner(plant, objectRules, m)?.key !== separateOwner(nextPlant, objectRules, m)?.key)) {
      blocked.add(`Die Heizvorauszahlungen der abgeschlossenen Abrechnung ${periodLabel(closed)} würden nach dem Wechsel anders angerechnet. Öffnen Sie die Abrechnung wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
    }
  }

  const moves: Plan['moves'] = []
  const groups: Plan['groups'] = new Map()
  for (const item of items) {
    const a = changed(item.period)
    // Eine Heizperiode, die nur wächst, behält ihre Positionen, wie beim Objekt.
    if (a === null || a.status === 'grows') continue
    const candidates = heatingPeriodsEndingIn(next, periodContaining(objectRules, a.old.to))
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only) {
      if (only.key !== item.period) moves.push({ item, to: only })
      continue
    }
    const g = groups.get(a.key) ?? { items: [], options: candidates.length > 0 ? candidates : periodsBetween(next, a.old.from, a.old.to) }
    g.items.push(item)
    groups.set(a.key, g)
  }

  const closedKeys = new Set(closedP.map((c) => String(c.period)))
  const overrideRekeys: Plan['overrideRekeys'] = []
  const asks = new Map<string, OverrideAsk>()
  const entryOf = (t: Tenancy): OverrideAsk => {
    const found = asks.get(t.id)
    if (found) return found
    const neu: OverrideAsk = { tenancy: t, dropHeating: new Set(), dropTotals: new Set(), from: [], ask: new Map() }
    asks.set(t.id, neu)
    return neu
  }
  const askTotal = (t: Tenancy, p: BillingPeriod): void => {
    if (closedKeys.has(p.key)) return
    const e = entryOf(t)
    e.ask.set(`total:${p.key}`, { kind: 'total', period: p, months: activeMonths(t, p) })
    e.dropTotals.add(p.key)
    const cents = t.prepaymentOverrides[p.key]
    if (cents !== undefined && !e.from.some((f) => f.kind === 'total' && f.key === p.key)) e.from.push({ kind: 'total', key: p.key, label: periodLabel(p), cents })
  }
  const ownerChanges = (m: string): boolean => separateOwner(plant, objectRules, m)?.key !== separateOwner(nextPlant, objectRules, m)?.key
  for (const t of tenancies) {
    for (const o of t.heatingPrepaymentOverrides ?? []) {
      if (o.plantId !== plantId) continue
      const a = changed(o.period)
      if (a === null) continue
      const withMonths = periodsBetween(next, a.old.from, a.old.to).map((p) => ({ period: p, months: activeMonths(t, p) })).filter((x) => x.months.length > 0)
      const one = withMonths.length === 1 ? withMonths[0] : undefined
      if (one && separateNow(one.period) && one.months.join() === activeMonths(t, a.old).join()) {
        if (one.period.key !== o.period) overrideRekeys.push({ tenancyId: t.id, from: o.period, to: one.period.key })
        continue
      }
      const e = entryOf(t)
      e.dropHeating.add(o.period)
      e.from.push({ kind: 'heating', key: o.period, label: periodLabel(a.old), cents: o.cents })
      for (const x of withMonths) {
        if (separateNow(x.period)) e.ask.set(`heating:${x.period.key}`, { kind: 'heating', period: x.period, months: x.months })
        else for (const p of periodsBetween(objectRules, `${x.months[0] ?? x.period.from.slice(0, 7)}-01`, x.period.to)) askTotal(t, p)
      }
    }
    for (const schluessel of Object.keys(t.prepaymentOverrides)) {
      const key = parsePeriodKey(schluessel)
      const p = key === null ? null : periodOfKey(objectRules, key)
      if (p !== null && activeMonths(t, p).some(ownerChanges)) askTotal(t, p)
    }
  }

  const years = [...[...memo.values()].flatMap((a) => (a ? [a.old.from] : [])), ...next.changes.map((c) => `${c}-01`), ...before.changes.map((c) => `${c}-01`), today].sort()
  const listFrom = `${Number((years[0] ?? today).slice(0, 4)) - 1}-01-01`
  const listTo = `${Number((years[years.length - 1] ?? today).slice(0, 4)) + 1}-12-31`
  const periods = periodsBetween(next, listFrom, listTo)
  const wasShort = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old !== null && old.short && old.from === p.from && old.to === p.to
  }
  const bestFor = (old: BillingPeriod, options: readonly BillingPeriod[]): BillingPeriod => {
    let best = options[0] ?? old
    for (const p of options) if (overlapDays(p, old) > overlapDays(best, old)) best = p
    return best
  }
  const preview: HeatingPeriodChangePreview = {
    rules: own,
    periods: periods.map((p) => ({ key: p.key, label: periodLabel(p), short: p.short, separate: separateNow(p) })),
    newShort: periods.filter((p) => p.short && !wasShort(p)).map((p) => ({ key: p.key, label: periodLabel(p) })),
    blocked: [...blocked],
    moves: moves.map(({ item, to }) => ({
      costItemId: item.id, description: item.description, amountCents: item.amountCents,
      from: item.period, fromLabel: periodLabel(changed(item.period)?.old ?? to), to: to.key, toLabel: periodLabel(to),
    })),
    groups: [...groups.entries()].map(([from, g]) => {
      const old = changed(from)?.old ?? g.options[0]
      if (old === undefined) throw new Error(`Heizperiode ${from} ohne Befund in der Vorschau`)
      return {
        from, fromLabel: periodLabel(old),
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p) })),
        suggested: bestFor(old, g.options).key,
      }
    }),
    overrides: [...asks.values()].map((o) => ({
      tenancyId: o.tenancy.id, tenantName: o.tenancy.tenantName, from: o.from,
      ask: [...o.ask.values()].map((x) => ({ kind: x.kind, period: x.period.key, label: periodLabel(x.period), months: monthsText(x.months) })),
    })),
    endsSeparate: periods
      .filter((p) => !separateNow(p) && periodMonths(p).some((m) => separateOwner(plant, objectRules, m) !== null))
      .map((p) => ({ key: p.key, label: periodLabel(p) })),
  }
  return { preview, plant, own, moves, groups, overrideRekeys, overrideAsks: [...asks.values()] }
}

export async function previewHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, today: string): Promise<HeatingPeriodChangePreview | null> {
  return (await planHeatingPeriodChange(db, plantId, rawRules, today))?.preview ?? null
}

const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export async function applyHeatingPeriodChange(
  db: Database, plantId: string, rawRules: unknown, rawAnswers: unknown, today: string,
): Promise<{ plant: HeatingPlant } | { error: string; preview: HeatingPeriodChangePreview } | null> {
  const plan = await planHeatingPeriodChange(db, plantId, rawRules, today)
  if (plan === null) return null
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const answers = objectOr(rawAnswers)
  const groupAnswers = objectOr(answers.groups)
  const overrideAnswers = objectOr(answers.overrides)
  const totalAnswers = objectOr(answers.totals)
  const missing: string[] = []
  for (const g of plan.groups.values()) {
    const from = g.items[0]?.period
    if (from === undefined || !g.options.some((p) => p.key === groupAnswers[from])) missing.push(`Heizperiode für ${g.items.map((i) => `„${i.description}“`).join(', ')} wählen.`)
  }
  for (const o of plan.overrideAsks) {
    for (const x of o.ask.values()) {
      const given = objectOr((x.kind === 'heating' ? overrideAnswers : totalAnswers)[o.tenancy.id])
      const v = given[x.period.key]
      if (!Object.hasOwn(given, x.period.key) || !(v === null || isCents(v))) {
        missing.push(x.kind === 'heating'
          ? `${o.tenancy.tenantName}: tatsächlich gezahlte Heizvorauszahlung ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`
          : `${o.tenancy.tenantName}: tatsächlich gezahlte Vorauszahlungen insgesamt ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`)
      }
    }
  }
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }

  await db.transaction(async (tx) => {
    await tx.update(heatingPlants).set({ periodStartMonth: plan.own?.startMonth ?? null }).where(eq(heatingPlants.id, plantId))
    await tx.delete(heatingPeriodChanges).where(eq(heatingPeriodChanges.plantId, plantId))
    if (plan.own && plan.own.changes.length > 0) await tx.insert(heatingPeriodChanges).values(plan.own.changes.map((fromMonth) => ({ plantId, fromMonth })))
    for (const { item, to } of plan.moves) {
      await tx.update(costItems).set({ period: to.key, taxYear: taxYearIn(to, item) }).where(eq(costItems.id, item.id))
    }
    for (const g of plan.groups.values()) {
      const from = g.items[0]?.period
      const target = g.options.find((p) => p.key === (from === undefined ? undefined : groupAnswers[from]))
      if (!target) continue
      for (const item of g.items) await tx.update(costItems).set({ period: target.key, taxYear: taxYearIn(target, item) }).where(eq(costItems.id, item.id))
    }
    for (const r of plan.overrideRekeys) {
      await tx.update(heatingPrepaymentOverrides).set({ period: r.to })
        .where(and(eq(heatingPrepaymentOverrides.tenancyId, r.tenancyId), eq(heatingPrepaymentOverrides.plantId, plantId), eq(heatingPrepaymentOverrides.period, r.from)))
    }
    for (const o of plan.overrideAsks) {
      if (o.dropHeating.size > 0) {
        await tx.delete(heatingPrepaymentOverrides)
          .where(and(eq(heatingPrepaymentOverrides.tenancyId, o.tenancy.id), eq(heatingPrepaymentOverrides.plantId, plantId), inArray(heatingPrepaymentOverrides.period, [...o.dropHeating])))
      }
      if (o.dropTotals.size > 0) {
        await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, o.tenancy.id), inArray(prepaymentOverrides.period, [...o.dropTotals])))
      }
      const heating = objectOr(overrideAnswers[o.tenancy.id])
      const totals = objectOr(totalAnswers[o.tenancy.id])
      for (const x of o.ask.values()) {
        const cents = (x.kind === 'heating' ? heating : totals)[x.period.key]
        if (!isCents(cents)) continue
        if (x.kind === 'heating') {
          await tx.insert(heatingPrepaymentOverrides).values({ tenancyId: o.tenancy.id, plantId, period: x.period.key, cents, provisional: false, fromMonth: null, toMonth: null })
        } else {
          await tx.insert(prepaymentOverrides).values({ tenancyId: o.tenancy.id, period: x.period.key, amountCents: cents })
        }
      }
    }
  })
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  return plant ? { plant } : null
}
```

- [ ] **Step 5: Der Wechsel des Objektzeitraums (`server/src/db/periodChange.ts`, PR 3)**

Importe: `readHeatingPlants` aus `'./read.ts'`; `plantRules, settledSeparately` aus
`'../../../shared/heatingPeriod.ts'`.

In `planPeriodChange` direkt hinter `const items = …`:

```ts
  // Heizung PR 5: Heizpositionen einer Anlage mit eigener Heizperiode tragen deren Schlüssel und
  // bleiben beim Wechsel des Objektzeitraums, wo sie sind; in welcher Abrechnung ihre Heizperiode
  // steht, ergibt sich danach von selbst (Entwurf 3.0).
  const plants = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
  const ownPlantIds = new Set(plants.filter((p) => p.periodStartMonth !== null).map((p) => p.id))
```

In der Schleife `for (const item of items)` als erste Zeile:

```ts
    if (item.heatingPlantId && ownPlantIds.has(item.heatingPlantId)) continue
```

Hinter der Schleife über `history` (die Sperren):

```ts
  // Heizung PR 5: Ob eine Heizperiode getrennt abgerechnet wird, hängt auch am Objektzeitraum (bei
  // H = P gibt es eine Gesamtabrechnung, Entwurf 3.1). Ein Wechsel, der das für eine Heizperiode
  // umschaltet, ginge an der Vorschau der Heizung vorbei, die die Vorauszahlungen aufteilt.
  for (const plant of plants) {
    const first = plant.separateSpans[0]
    if (plant.periodStartMonth === null || first === undefined) continue
    const rules = plantRules(plant, before)
    for (const h of periodsBetween(rules, `${first.from}-01`, `${Number(today.slice(0, 4)) + 2}-12-31`)) {
      const vorher = settledSeparately(plant, before, h)
      if (vorher === settledSeparately(plant, next, h)) continue
      blocked.add(
        `Die Heizkosten ${periodLabel(h)}${plant.name ? ` der Heizanlage „${plant.name}“` : ''} würden nach dem Wechsel ${vorher ? 'nicht mehr getrennt' : 'getrennt'} abgerechnet. ` +
          'Stellen Sie zuerst unter Stammdaten → Heizung den Zeitraum der Heizung oder die getrennte Heizkostenabrechnung um; dort zeigt eine Vorschau, was mit den Vorauszahlungen geschieht.',
      )
      break
    }
  }
```

- [ ] **Step 6: Routen (`server/src/index.ts`)**

Import `applyHeatingPeriodChange, previewHeatingPeriodChange` aus `'./db/heatingPeriodChange.ts'`.
Hinter `app.delete('/api/heating-plants/:id', …)`:

```ts
// Zeitraum der Heizung (Heizung PR 5, Entwurf 3.0, 3.6): erst die Vorschau, dann der Wechsel mit den
// Antworten, in einer Transaktion. `rules: null` heißt „wie das Objekt“. Fehlt eine Antwort oder
// träfe der Wechsel Abgeschlossenes, antwortet der Server mit 409 und der neuen Vorschau.
const PLANT_GONE_TEXT = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu.'
app.post('/api/heating-plants/:id/period/preview', async (req, res) => {
  const preview = await readData((db) => previewHeatingPeriodChange(db, req.params.id, bodyObject(req).rules, today()))
  if (!preview) return res.status(404).json({ error: PLANT_GONE_TEXT })
  res.json(preview)
})
app.put('/api/heating-plants/:id/period', async (req, res) => {
  const body = bodyObject(req)
  const result = await writeData((db) => applyHeatingPeriodChange(db, req.params.id, body.rules, body.answers, today()))
  if (!result) return res.status(404).json({ error: PLANT_GONE_TEXT })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.plant)
})
```

(Fehlt `rules` im Rumpf, lehnt `checkRules` mit 400 und „Bitte geben Sie den Rhythmus an …“ ab;
`PeriodError` gibt die Fehlerbehandlung seit PR 2 mit 400 weiter.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-heizperiode-wechsel.test.ts test/db-wechsel.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Zeitraum der Heizung" && npm run typecheck`
Expected: PASS (db-heizperiode-wechsel 6 Tests, api 1); `db-wechsel.test.ts` (PR 3) unverändert grün.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/heatingPeriodChange.ts server/src/db/periodChange.ts server/src/index.ts server/test/db-heizperiode-wechsel.test.ts server/test/api.test.ts
git commit -m "Heizperiode: Zeitraum der Heizung wechseln mit Vorschau, Umschlüsseln und Neuerfassung der Heizkorrektur

Der Wechsel des Objektzeitraums lässt Heizpositionen einer eigenen Heizperiode, wo sie sind, und
lehnt ab, wenn er Weg d für eine Heizperiode umschalten würde.

Refs #217"
```

---
### Task 5: Berechnung nach Weg b, Vorauszahlungen beider Staffeln, Mietkonto

Der Schnappschuss eines Objektzeitraums P trägt die Heizperioden, die in P enden. `computeSettlement`
verteilt jede nach Weg b mit derselben Rechnung über ihre eigenen Tage (`scope: 'heatingPart'`, ohne
Vorauszahlungen) und führt sie in P zusammen; wer nur in der Heizperiode gewohnt hat, bekommt eine
Abrechnung nur mit Heizkosten samt Warnung und empfohlener Frist. Eine Heizperiode nach Weg d steht
nicht in P. Die Heizstaffel rechnet P nur für Monate an, die keiner getrennten Heizperiode gehören;
das Mietkonto führt beide Staffeln im Soll.

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`, `shared/glossary.ts`, `client/src/notices.ts`
- Test: `server/test/calc-heizperiode.test.ts` (neu)

**Interfaces:**
- Consumes (Task 1, 2): `HeatingPeriodRef`, `SeparateHeatingRef`, `HeatingPrepaymentOverride`; `plantRules`, `heatingPeriodsEndingIn`, `settledSeparately`, `separateOwner`, `servesUnit`, `sameSpan`, `recommendedDeadline`, `requestMonth`, `monthSpanText`, `PlantWay`; aus PR 2/3/4 die Namen der Tabelle oben (`computeSettlement` samt Kopf, `ledgerRows`, `rateAtMonth`, `annualFactors`, `shortBasis`).
- Produces:
  - snapshot.ts: `SnapshotTenancy` pickt zusätzlich `'heatingPrepayments' | 'heatingPrepaymentOverrides'`, `SnapshotCostItem` zusätzlich `'heatingPlantId'`; `SnapshotHeatingPlant` mit optionalen `name`, `periodStartMonth`, `periodChanges`, `separateSpans`, `separateSettlement`; `wayOf(p: SnapshotHeatingPlant): PlantWay`; `type SnapshotHeatingPart = { plantId: string; period: BillingPeriod; previous: BillingPeriod; items: SnapshotCostItem[]; previousItems: SnapshotCostItem[]; separate: boolean }`; `type SnapshotScope = { kind: 'heating' | 'heatingPart'; plant: SnapshotHeatingPlant }`; `Snapshot.objectRules?: PeriodRules`, `Snapshot.heatingParts?: SnapshotHeatingPart[]`, `Snapshot.scope?: SnapshotScope`; `SnapshotSource.closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]`
  - calc.ts: `type HeatingCredit = { ownerOf: (month: string) => PeriodKey | null }`; `computePrepaymentCents(tenancy, period, heating?: HeatingCredit): { cents: number; overridden: boolean; heatingCents?: number }`; eine Jahreskorrektur von P gilt für alles, was P anrechnet (übrige und Heizstaffel); in `computeSettlement` die Größen `scope`, `objectRules`, `plants`, `prepaymentOf`, `mergedParts`; Codes `period.heating-differs`, `period.heating-only-statement`, `period.no-heating-period`, `prepayment.heating-share-missing`, `prepayment.heating-share-unchanged`
  - glossary: Begriff `heatingPeriod`

- [ ] **Step 1: Write the failing test**

`server/test/calc-heizperiode.test.ts`:

```ts
// Die eigene Heizperiode in der Berechnung (Heizung PR 5, Entwurf 3.1, 6.1, 12.2): Weg b in der
// Gesamtabrechnung, Abrechnung nur mit Heizkosten, und welche Abrechnung welchen Monat der
// Heizstaffel anrechnet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, PeriodRules, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (over: { periodStartMonth?: number | null; periodChanges?: string[]; separateSpans?: SeparateSpan[]; separateSettlement?: boolean | null } = {}) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, units: null,
  periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false, ...over,
})
const mieter = (id: string, start: string, end: string | null, prepayments: { from: string; monthlyCents: number }[], over: Record<string, unknown> = {}) => ({
  id, unitId: 'u1', tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments, prepaymentOverrides: {}, baseRents: [], ...over,
})
const position = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Grundsteuer', description: id, amountCents, key: 'area' as const, ...over,
})
const heizung = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) =>
  position(id, key, amountCents, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', ...over })
const haus = (over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage()],
  ...over,
} as Source)
const settle = (src: Source, key: string, rules: PeriodRules = CALENDAR_RULES): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))
const st = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`${id} fehlt`)

test('Weg b (Entwurf 3.1): Auszug 31.10.2025, die Abrechnung 2026 enthält 2025/2026, M bekommt nur Heizkosten', () => {
  const src = haus({
    tenancies: [mieter('M', '2024-01-01', '2025-10-31', [{ from: '2024-01', monthlyCents: 20000 }]), mieter('N', '2025-11-01', null, [{ from: '2025-11', monthlyCents: 22000 }])],
    costItems: [
      heizung('messdienst', '2025-05', 100000, { key: 'amounts', tenancyAmounts: { M: 41230, N: 58770 }, taxYear: 2026 }),
      position('grundsteuer', '2026-01', 60000),
    ],
  })
  const s = settle(src, '2026-01')
  assert.equal(s.deadline, '2027-12-31')
  assert.deepEqual(s.heatingPeriods?.map((h) => [h.plantId, h.period.key, h.period.label]), [['hp1', '2025-05', '2025/2026']])
  const n = st(s, 'N')
  assert.deepEqual(n.rows.map((r) => [r.costItemId, r.shareCents]), [['grundsteuer', 60000], ['messdienst', 58770]])
  assert.deepEqual([n.totalShareCents, n.prepaymentCents, n.heatingOnly], [118770, 264000, undefined])
  const m = st(s, 'M')
  assert.deepEqual([m.heatingOnly, m.recommendedDeadline, m.totalShareCents, m.prepaymentCents, m.suggestedMonthlyCents, m.balanceCents], [true, '2026-12-31', 41230, 0, 0, -41230])
  const nur = s.notices?.find((x) => x.code === 'period.heating-only-statement') ?? assert.fail('keine Warnung')
  assert.equal(nur.level, 'warning')
  assert.equal(nur.text,
    'Ob eine Abrechnung nur der Heizkosten für ein Jahr, in dem M nicht mehr gewohnt hat, die Frist bis 31.12.2027 hat, ist nicht entschieden. ' +
      'Stellen Sie sie bis 31.12.2026 zu. Fordern Sie dafür die Abrechnung des Messdienstes für 2025/2026 bis spätestens Oktober 2026 an.')
  assert.ok(s.notices?.some((x) => x.code === 'period.heating-differs' && x.level === 'hint' && x.text.includes('Heizperiode 2025/2026')))
  assert.equal(s.totalCostsCents, 160000)
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0) + s.landlord.totalCents, s.totalCostsCents)
})

test('Ohne eigene Heizperiode bleibt jede Zahl und jedes Feld gleich (Entwurf 1.2 Nr. 1, 12.3 Nr. 12)', () => {
  const src = (heatingPlants: Source['heatingPlants']) => haus({
    heatingPlants,
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 25000 }])],
    costItems: [position('gas', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1' }), position('grundsteuer', '2025-01', 50000)],
  })
  assert.deepEqual(settle(src([anlage({ periodStartMonth: null, separateSettlement: false })]), '2025-01'), settle(src([]), '2025-01'))
})

test('Weg d: P lässt die getrennte Heizperiode weg und rechnet die Heizstaffel nur in ihren übrigen Monaten an (6.1 Nr. 5, D1 Fall 1, B3)', () => {
  const src = haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }] })],
    costItems: [heizung('messdienst', '2025-05', 150000, { taxYear: 2026 }), heizung('messdienst-2026', '2026-05', 160000, { taxYear: 2027 })],
  })
  const s2026 = settle(src, '2026-01')
  assert.deepEqual(s2026.separateHeating?.map((h) => [h.period.key, h.deadline]), [['2025-05', '2027-04-30']])
  assert.equal(s2026.heatingPeriods, undefined)
  assert.deepEqual(st(s2026, 'A').rows, [], 'die Heizkosten 2025/2026 stehen in ihrer eigenen Abrechnung')
  // Januar bis April 2026 gehören der getrennten Heizperiode, Mai bis Dezember wieder P (ab W).
  assert.deepEqual([st(s2026, 'A').prepaymentCents, st(s2026, 'A').heatingPrepaymentCents], [12 * 17700 + 8 * 12300, 8 * 12300])
  const s2025 = settle(src, '2025-01')
  assert.deepEqual([st(s2025, 'A').prepaymentCents, st(s2025, 'A').heatingPrepaymentCents], [4 * 30000 + 8 * 17700, 0])
  // 2027 endet die Heizperiode 2026/2027 (nach W, also Weg b): sie steht in der Gesamtabrechnung.
  assert.deepEqual(settle(src, '2027-01').heatingPeriods?.map((h) => h.period.key), ['2026-05'])
})

test('H = P mit getrennter Vorauszahlung (A3): eine Gesamtabrechnung, beide Vorauszahlungen; die Jahreskorrektur gilt für beide', () => {
  const tenancy = (over: Record<string, unknown> = {}) => mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2024-01', monthlyCents: 12300 }], ...over })
  const src = (t: ReturnType<typeof tenancy>) => haus({
    heatingPlants: [anlage({ periodStartMonth: null, separateSettlement: true })],
    tenancies: [t],
    costItems: [heizung('gas', '2025-01', 150000), position('grundsteuer', '2025-01', 50000)],
  })
  const s = settle(src(tenancy()), '2025-01')
  assert.deepEqual([st(s, 'A').prepaymentCents, st(s, 'A').heatingPrepaymentCents, st(s, 'A').prepaymentOverridden], [360000, 147600, false])
  assert.deepEqual(st(s, 'A').rows.map((r) => r.costItemId), ['gas', 'grundsteuer'])
  assert.equal(s.separateHeating, undefined)
  // Die Jahreskorrektur von P ist, was tatsächlich an P gezahlt wurde, übrige und Heizung (3.7); eine
  // Aufteilung kennt sie nicht, deshalb steht dann kein Heizanteil daneben.
  const mitKorrektur = settle(src(tenancy({ prepaymentOverrides: { '2025-01': 352400 } })), '2025-01')
  assert.deepEqual([st(mitKorrektur, 'A').prepaymentCents, st(mitKorrektur, 'A').heatingPrepaymentCents, st(mitKorrektur, 'A').prepaymentOverridden], [352400, undefined, true])
})

test('R13: getrennt abgerechnet, aber die Vorauszahlung nicht aufgeteilt', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ periodStartMonth: null, separateSettlement: true })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('gas', '2025-01', 150000)],
  }), '2025-01')
  const hint = s.notices?.find((n) => n.code === 'prepayment.heating-share-missing') ?? assert.fail('kein Hinweis')
  assert.deepEqual([hint.level, hint.subject], ['hint', { kind: 'heatingPlant', id: 'hp1' }])
})

test('R-h: Die Vorauszahlung steigt, die Heizvorauszahlung nicht (Review Focus 4)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: null }] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }, { from: '2026-03', monthlyCents: 19700 }], {
      heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
    })],
  }), '2026-01')
  const hint = s.notices?.find((n) => n.code === 'prepayment.heating-share-unchanged') ?? assert.fail('kein Hinweis')
  assert.match(hint.text, /ab März 2026 auf 197,00 €, die Heizvorauszahlung nicht/)
  assert.deepEqual(hint.subject, { kind: 'tenancy', id: 'A' })
})

test('Mietkonto (3.11): beide Staffeln im Soll, die Summe je Monat bleibt', () => {
  const src = haus({
    tenancies: [
      mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }] }),
      mieter('B', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 20000 }]),
    ],
  })
  const konto = rentLedger(snapshotFor(src, 'objekt-1', calendarYearPeriod(2025)))
  const a = konto.rows.find((r) => r.tenancyId === 'A') ?? assert.fail('A fehlt')
  assert.deepEqual(a.months.map((m) => m.sollCents), Array(12).fill(30000))
  assert.deepEqual([a.months[4]?.heatingPrepaymentCents, a.heatingPrepaymentYearCents, a.prepaymentYearCents], [12300, 8 * 12300, 4 * 30000 + 8 * 17700])
  const b = konto.rows.find((r) => r.tenancyId === 'B') ?? assert.fail('B fehlt')
  assert.equal(Object.hasOwn(b, 'heatingPrepaymentYearCents'), false, 'ohne Heizstaffel bleibt die Zeile, wie sie war')
  assert.equal(Object.hasOwn(b.months[0] ?? {}, 'heatingPrepaymentCents'), false)
})

test('Zwei Heizperioden in einer Abrechnung nach einem Wechsel der Anlage: beide, jede über ihre Tage', () => {
  const src = haus({
    heatingPlants: [anlage({ periodChanges: ['2026-01'] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('h2024', '2024-05', 120000, { taxYear: 2025 }), heizung('rumpf', '2025-05', 80000)],
  })
  const s = settle(src, '2025-01')
  assert.deepEqual(s.heatingPeriods?.map((h) => h.period.label), ['2024/2025', '01.05.–31.12.2025'])
  assert.deepEqual(st(s, 'A').rows.map((r) => [r.costItemId, r.shareCents]), [['h2024', 120000], ['rumpf', 80000]])
})

test('Ein Rumpf der Heizperiode in P: ohne Brennstoffkennzeichen kein Vorschlag (R11)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ periodChanges: ['2026-01'] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('rumpf', '2025-05', 80000), position('grundsteuer', '2025-01', 50000)],
  }), '2025-01')
  assert.equal(st(s, 'A').suggestedMonthlyCents, 0)
  assert.ok(s.notices?.some((n) => n.code === 'prepayment.no-suggestion' && /Brennstoff/.test(n.text)))
})

test('Kein Ende einer Heizperiode in P: Warnung an der Heizanlage', () => {
  const objekt: PeriodRules = { startMonth: 1, changes: ['2025-04'] }
  const s = settle(haus({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: objekt }],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
  }), '2025-01', objekt)
  const w = s.notices?.find((n) => n.code === 'period.no-heating-period') ?? assert.fail('keine Warnung')
  assert.deepEqual([w.level, w.subject], ['warning', { kind: 'heatingPlant', id: 'hp1' }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/calc-heizperiode.test.ts`
Expected: FAIL. Die Heizposition 2025/2026 fehlt in der Abrechnung 2026 (`heatingPeriods` undefined,
N hat nur die Grundsteuer), M fehlt ganz, und `heatingPrepaymentCents` gibt es nicht.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

Importe: `heatingPeriodsEndingIn, plantRules, settledSeparately, type PlantWay` aus
`'../../shared/heatingPeriod.ts'`; `PeriodRules` als Typ (soweit nicht da).

In `SnapshotTenancy` die Liste der gepickten Felder um `| 'heatingPrepayments' | 'heatingPrepaymentOverrides'`
ergänzen, in `SnapshotCostItem` um `| 'heatingPlantId'`.

`SnapshotHeatingPlant` (PR 4) ersetzen:

```ts
// Die Heizanlagen des Objekts (Heizung PR 4), eingedampft auf das, was die Berechnung liest. Seit
// Heizung PR 5 dazu Name, eigene Heizperiode und die Spannen nach Weg d; fehlen sie (ein von Hand
// gebauter Schnappschuss), folgt die Anlage dem Objekt und rechnet nichts getrennt ab.
export type SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'units'>
  & Partial<Pick<HeatingPlant, 'name' | 'periodStartMonth' | 'periodChanges' | 'separateSpans' | 'separateSettlement'>>

export const wayOf = (p: SnapshotHeatingPlant): PlantWay => ({
  periodStartMonth: p.periodStartMonth ?? null, periodChanges: p.periodChanges ?? [], separateSpans: p.separateSpans ?? [],
})

// Eine Heizperiode, die in P endet (Heizung PR 5, Entwurf 5.8): mit ihren Positionen und denen ihrer
// Vorperiode (für den Vorschlag nach § 560). `separate`: nach Weg d getrennt abgerechnet; dann steht
// sie nicht in P.
export type SnapshotHeatingPart = {
  plantId: string
  period: BillingPeriod
  previous: BillingPeriod
  items: SnapshotCostItem[]
  previousItems: SnapshotCostItem[]
  separate: boolean
}

// Was ein Schnappschuss rechnet, wenn nicht die Betriebskostenabrechnung: die Heizkostenabrechnung
// einer Heizperiode (Weg d) oder die Heizperiode, die eine Abrechnung P nach Weg b aufnimmt.
export type SnapshotScope = { kind: 'heating' | 'heatingPart'; plant: SnapshotHeatingPlant }
```

In `Snapshot` hinter `heatingPlants?`:

```ts
  // Heizung PR 5. Der Rhythmus des Objekts (für die empfohlene Frist und die Frage H = P), die
  // Heizperioden, die in P enden, und was der Schnappschuss rechnet. Fehlt alles (db.json, Umstieg,
  // Regression, ein von Hand gebauter Schnappschuss), rechnet die Berechnung wie bisher.
  objectRules?: PeriodRules
  heatingParts?: SnapshotHeatingPart[]
  scope?: SnapshotScope
```

In `SnapshotSource` (als letztes Feld):

```ts
  // Die abgeschlossenen Heizkostenabrechnungen nach Weg d (Heizung PR 5); fehlt die Angabe, gibt es keine.
  closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
```

`snapshotFor` (Fassung von PR 4) ersetzen:

```ts
// Der Schnappschuss eines Objekts in einem Abrechnungszeitraum. Die Routen rechnen nur hierüber; den
// Vorzeitraum bestimmt der Rhythmus des Objekts (#208).
//
// **Eigene Heizperiode (Heizung PR 5).** Die Positionen einer Anlage mit eigener Heizperiode tragen
// den Schlüssel ihrer Heizperiode, nicht den von P (Entwurf 3.0); ein gleicher Schlüssel hieße nicht
// dieselben Tage. Sie gehen deshalb nicht in `costItems`, sondern je Heizperiode, die in P endet, in
// `heatingParts`. Ohne eigene Heizperiode bleibt alles wie bisher.
export function snapshotFor(
  source: PropertyScopedSource & {
    properties?: (SnapshotProperty & { id: string, periodRules?: PeriodRules })[]
    heatingPlants?: (SnapshotHeatingPlant & { propertyId: string })[]
  },
  propertyId: string,
  period: BillingPeriod,
): Snapshot {
  const found = source.properties?.find((p) => p.id === propertyId)
  const objectRules = rulesOf(found)
  const narrowed = narrowToProperty(source, propertyId)
  const plants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId)
  const own = plants.filter((p) => (p.periodStartMonth ?? null) !== null)
  const ownIds = new Set(own.map((p) => p.id))
  const general = { ...narrowed, costItems: narrowed.costItems.filter((c) => !(c.heatingPlantId && ownIds.has(c.heatingPlantId))) }
  const heatingParts = own.flatMap((plant) => {
    const way = wayOf(plant)
    const rules = plantRules(way, objectRules)
    const mine = narrowed.costItems.filter((c) => c.heatingPlantId === plant.id)
    return heatingPeriodsEndingIn(rules, period).map((h): SnapshotHeatingPart => {
      const previous = previousPeriod(rules, h)
      return {
        plantId: plant.id, period: h, previous,
        items: mine.filter((c) => c.period === h.key),
        previousItems: mine.filter((c) => c.period === previous.key),
        separate: settledSeparately(way, objectRules, h),
      }
    })
  })
  return {
    ...snapshotOfPeriod(general, period, previousPeriod(objectRules, period)),
    propertyId,
    property: found ? { kind: found.kind, cableBuiltBeforeDec2021: found.cableBuiltBeforeDec2021 ?? null } : null,
    // Die Anlagen tragen ihr Objekt wie die Wurzeln in `narrowToProperty`; eingegrenzt wird hier.
    heatingPlants: plants,
    objectRules,
    ...(heatingParts.length > 0 ? { heatingParts } : {}),
  }
}
```

(Weicht der Rumpf der Fassung von PR 4 in Kleinigkeiten ab, etwa beim Feld `property`, gilt die
Fassung von PR 4 für diese Felder; neu sind nur `objectRules`, `heatingParts` und die Aufteilung der
Positionen in `general` und `mine`.)

- [ ] **Step 4: Vorauszahlungen und Mietkonto (`server/src/calc.ts`)**

Importe: `heatingPeriodsEndingIn` wird hier nicht gebraucht; aus `'../../shared/heatingPeriod.ts'`
`monthSpanText, plantRules, recommendedDeadline, requestMonth, sameSpan, separateOwner, servesUnit`;
aus `'./snapshot.ts'` `wayOf` und die Typen `SnapshotHeatingPart`; aus `'../../shared/period.ts'`
zusätzlich `CALENDAR_RULES, periodOfKey, settlementPeriod` (soweit nicht da); aus
`'../../shared/types.ts'` die Typen `HeatingPeriodRef, PeriodKey, SeparateHeatingRef`;
`AnnualBasis` als Typ aus `'./prepaymentSuggestion.ts'`.

`computePrepaymentCents` (Fassung von PR 2) heißt ab jetzt `basePrepaymentCents`, Rumpf und Kommentar
unverändert, ohne `export`. Darunter:

```ts
// Die Heizvorauszahlung in einer Abrechnung P (Heizung PR 5, Entwurf 6.1 Nr. 5). `ownerOf` nennt die
// getrennt abgerechnete Heizperiode, der ein Monat gehört; ihn rechnet dann nicht P an, sondern deren
// Heizkostenabrechnung. Ohne Angabe rechnet P jeden Monat der Heizstaffel an.
export type HeatingCredit = { ownerOf: (month: string) => PeriodKey | null }

// Vorauszahlungen eines Abrechnungszeitraums (#208): die übrigen (`prepayments`) und die Heizstaffel
// der Monate, die P gehören (Heizung PR 5). **Die Jahreskorrektur von P gilt für alles, was P
// anrechnet** (3.7): Bei Weg d enthält sie nur noch die übrigen Vorauszahlungen, weil P keinen Monat
// der Heizstaffel mehr anrechnet; bei H = P mit getrennter Vorauszahlung beide. Eine Aufteilung kennt
// die Korrektur nicht, deshalb fehlt dann `heatingCents`. Ohne Heizstaffel genau wie vorher.
export function computePrepaymentCents(
  tenancy: SnapshotTenancy,
  period: Pick<BillingPeriod, 'key' | 'from' | 'to'>,
  heating?: HeatingCredit,
): { cents: number, overridden: boolean, heatingCents?: number } {
  const base = basePrepaymentCents(tenancy, period)
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  if (schedule.length === 0 || base.overridden) return base
  const months = periodMonths(period).filter((m) => tenancy.start <= `${m}-01` && !(tenancy.end && tenancy.end < `${m}-01`))
  const heatingCents = months.filter((m) => (heating?.ownerOf(m) ?? null) === null).reduce((a, m) => a + rateAtMonth(schedule, m), 0)
  return { cents: base.cents + heatingCents, overridden: false, heatingCents }
}
```

In `ledgerRows` (PR 2) hinter `const flatSchedule: MonthlySchedule[] = …`:

```ts
      // Die Heizstaffel (Heizung PR 5, Entwurf 3.11): im Soll neben der übrigen Vorauszahlung. Die
      // Felder dazu stehen nur in Zeilen mit Heizstaffel, damit sich ohne sie nichts ändert.
      const heatingSchedule: MonthlySchedule[] = Array.isArray(t.heatingPrepayments) ? t.heatingPrepayments : []
      const withHeating = heatingSchedule.length > 0
```

im Objekt des Monats `const flatRateCents = …` um eine Zeile ergänzen und `sollCents` anpassen:

```ts
        const heatingPrepaymentCents = active && withHeating ? rateAtMonth(heatingSchedule, mm) : 0
        return {
          month: Number(mm.slice(5, 7)),
          baseRentCents,
          prepaymentCents,
          ...(withHeating ? { heatingPrepaymentCents } : {}),
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + heatingPrepaymentCents + flatRateCents,
          paidCents: 0,
          status: 'open',
        }
```

und im Objekt der Zeile hinter `flatRateYearCents: …`:

```ts
        ...(withHeating ? { heatingPrepaymentYearCents: rowMonths.reduce((a, mo) => a + (mo.heatingPrepaymentCents ?? 0), 0) } : {}),
```

In `taxReport` die Zeile `const prepaymentSollCents = ledger.rows.reduce((a, r) => a + r.prepaymentYearCents, 0)` ersetzen:

```ts
  // Das Soll der Vorauszahlungen, beide Staffeln (Heizung PR 5): Die Heizvorauszahlung ist ein Teil davon.
  const prepaymentSollCents = ledger.rows.reduce((a, r) => a + r.prepaymentYearCents + (r.heatingPrepaymentYearCents ?? 0), 0)
```

- [ ] **Step 5: Hinweise (`noticeKinds` in `server/src/calc.ts`)**

Hinter den Codes `period.*` aus PR 3:

```ts
  'period.heating-differs': { level: 'hint', title: 'Eigene Heizperiode', terms: ['heatingPeriod', 'billingPeriod'] },
  'period.heating-only-statement': { level: 'warning', title: 'Abrechnung nur mit Heizkosten', terms: ['heatingPeriod', 'settlementDeadline'] },
  'period.no-heating-period': { level: 'warning', title: 'Keine Heizperiode in diesem Zeitraum', terms: ['heatingPeriod'] },
  'prepayment.heating-share-missing': { level: 'hint', title: 'Heizvorauszahlung nicht aufgeteilt', terms: ['heatingPeriod', 'prepayment'] },
  'prepayment.heating-share-unchanged': { level: 'hint', title: 'Heizvorauszahlung unverändert', terms: ['prepayment'] },
```

- [ ] **Step 6: Weg b in `computeSettlement`**

Im Kopf direkt hinter `const at = contextOf(…)`:

```ts
  // Heizung PR 5. `scope`: 'heatingPart' ist die Heizperiode, die eine Abrechnung P nach Weg b in sich
  // aufnimmt (ohne Vorauszahlungen, ohne eigene Hinweise zum Mietkonto), 'heating' die
  // Heizkostenabrechnung einer Heizperiode nach Weg d; ohne Angabe die Betriebskostenabrechnung.
  const scope = snapshot.scope?.kind ?? 'all'
  const objectRules = snapshot.objectRules ?? CALENDAR_RULES
  const plants = snapshot.heatingPlants ?? []
```

Direkt vor `const statements = new Map<string, Statement>()`:

```ts
  // Die Vorauszahlungen eines Mietverhältnisses (#208, Heizung PR 5): in einer Teilabrechnung nach
  // Weg b keine (die rechnet P an); sonst die übrigen und die Heizstaffel der Monate, die keiner
  // getrennt abgerechneten Heizperiode gehören (6.1 Nr. 5). Welche Anlage die Wohnung versorgt, sagt
  // `servesUnit`; ohne Anlage zählt die ganze Heizstaffel.
  const prepaymentOf = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents?: number, note?: string } => {
    if (scope !== 'all') return { cents: 0, overridden: false }
    const plant = plants.find((p) => servesUnit(p, t.unit))
    if (!plant) return computePrepaymentCents(t, period)
    const way = wayOf(plant)
    return computePrepaymentCents(t, period, { ownerOf: (m) => separateOwner(way, objectRules, m)?.key ?? null })
  }
```

In der Schleife `for (const t of partTenancies)` die Zeile `const pp = computePrepaymentCents(t, period)`
durch `const pp = prepaymentOf(t)` ersetzen und im Objekt des Statements hinter
`prepaymentOverridden: pp.overridden,` ergänzen:

```ts
      ...(pp.heatingCents !== undefined ? { heatingPrepaymentCents: pp.heatingCents } : {}),
      ...(pp.note ? { prepaymentNote: pp.note } : {}),
```

Direkt vor dem Kommentar `// Ohne Abrechnung (#93): …` einfügen:

```ts
  // ---------- Eigene Heizperiode (#217, Entwurf 3.0, 3.1, 6.1 Nr. 2, 4 und 7) ----------
  // Rechnet eine Anlage in eigenen Heizperioden ab, stehen ihre Positionen unter der Heizperiode
  // (snapshot.ts). Jede Heizperiode, die in P endet, wird nach Weg b mit derselben Rechnung über ihre
  // eigenen Tage verteilt (`scope: 'heatingPart'`) und hier zusammengeführt; wer nur in der Heizperiode
  // gewohnt hat, bekommt eine Abrechnung nur mit Heizkosten. Eine Heizperiode nach Weg d steht nicht in
  // P; sie hat ihre eigene Abrechnung mit eigener Frist (`separateHeating`).
  const heatingPeriodsShown: HeatingPeriodRef[] = []
  const separateHeating: SeparateHeatingRef[] = []
  const mergedParts: SnapshotHeatingPart[] = []
  const deadlineP = settlementDeadline(period)
  const mergeHeatingPart = (sub: ComputedSettlement, part: SnapshotHeatingPart): void => {
    for (const s of sub.statements) {
      if (s.rows.length === 0) continue
      const own = statements.get(s.tenancyId)
      if (own) {
        own.rows.push(...s.rows)
        own.totalShareCents += s.totalShareCents
        own.total35aCents += s.total35aCents
        continue
      }
      // Hat in P nicht mehr gewohnt: eine Abrechnung nur mit Heizkosten (3.1, R-A4). Ob dafür die
      // Frist von P gilt, ist nicht entschieden (15.1 Nr. 2); empfohlen wird die frühere.
      const end = snapshot.tenancies.find((x) => x.id === s.tenancyId)?.end ?? null
      const recommended = end === null ? null : recommendedDeadline(objectRules, end)
      statements.set(s.tenancyId, {
        ...s, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0, heatingOnly: true,
        ...(recommended === null ? {} : { recommendedDeadline: recommended }),
      })
      if (recommended !== null) {
        warn('period.heating-only-statement',
          `Ob eine Abrechnung nur der Heizkosten für ein Jahr, in dem ${s.tenantName} nicht mehr gewohnt hat, die Frist bis ${fmtDay(deadlineP)} hat, ist nicht entschieden. ` +
            `Stellen Sie sie bis ${fmtDay(recommended)} zu. Fordern Sie dafür die Abrechnung des Messdienstes für ${periodLabel(part.period)} bis spätestens ${requestMonth(recommended)} an.`,
          { kind: 'tenancy', id: s.tenancyId })
      }
    }
    landlordRows.push(...sub.landlord.rows)
    totalCostsCents += sub.totalCostsCents
    selfUsedShareCents += sub.selfUsedShareCents
    for (const n of sub.notices ?? []) if (!notices.some((m) => m.code === n.code && m.text === n.text)) notices.push(n)
    for (const v of sub.legalBasis?.values ?? []) if (!lawLog.values.some((a) => a.id === v.id && a.validFrom === v.validFrom)) lawLog.values.push(v)
  }
  if (scope === 'all') {
    for (const plant of plants.filter((p) => (p.periodStartMonth ?? null) !== null)) {
      const parts = (snapshot.heatingParts ?? []).filter((x) => x.plantId === plant.id)
      if (parts.length === 0) {
        warn('period.no-heating-period',
          `In der Abrechnung ${label} endet keine Heizperiode der Heizanlage${plant.name ? ` „${plant.name}“` : ''}. Ihre Heizkosten stehen in der Abrechnung, in der ihre Heizperiode endet; prüfen Sie den Zeitraum der Heizung unter Stammdaten.`,
          { kind: 'heatingPlant', id: plant.id })
        continue
      }
      for (const part of parts) {
        if (part.separate) {
          separateHeating.push({ plantId: plant.id, plantName: plant.name ?? '', period: settlementPeriod(part.period), deadline: settlementDeadline(part.period) })
          continue
        }
        heatingPeriodsShown.push({ plantId: plant.id, period: settlementPeriod(part.period) })
        if (part.items.length === 0) continue
        if (!sameSpan(part.period, period)) {
          warn('period.heating-differs',
            `Die Heiz- und Warmwasserkosten dieser Abrechnung gelten für die Heizperiode ${periodLabel(part.period)}, die übrigen Kosten für ${label}. ` +
              'Das ist zulässig, wenn Heizkosten und übrige Betriebskosten nicht getrennt abgerechnet werden, also bei einer gemeinsamen Vorauszahlung (BGH, Urteil vom 30.04.2008, VIII ZR 240/07).',
            { kind: 'heatingPlant', id: plant.id })
        }
        const sub = computeSettlement({
          ...snapshot,
          period: part.period,
          previousPeriod: part.previous,
          year: Number(part.period.from.slice(0, 4)),
          costItems: part.items,
          previousCostItems: part.previousItems,
          heatingParts: [],
          closedSettlement: null,
          scope: { kind: 'heatingPart', plant },
        }, options)
        mergeHeatingPart(sub, part)
        mergedParts.push(part)
      }
    }
    // Hinweise zur Heizstaffel (R13, R-h), je Mietverhältnis, das eine Anlage versorgt.
    for (const t of partTenancies) {
      const own = statements.get(t.id)
      const plant = plants.find((p) => servesUnit(p, t.unit))
      if (!own || !plant) continue
      const same = periodOfKey(plantRules(wayOf(plant), objectRules), period.key)
      if (plant.separateSettlement === true && same !== null && sameSpan(same, period) && own.prepaymentCents > 0 && (own.heatingPrepaymentCents ?? 0) === 0) {
        warn('prepayment.heating-share-missing',
          `${t.tenantName} (${t.unit.name}): Die Heizkosten werden getrennt abgerechnet, die Vorauszahlung ist aber nicht aufgeteilt; die Abrechnung weist für die Heizung 0 € aus. ` +
            'Teilen Sie die Vorauszahlung unter Stammdaten → Heizung auf („Vorauszahlung aufteilen“); an der Summe ändert sich nichts.',
          { kind: 'heatingPlant', id: plant.id })
      }
      const heizstaffel = t.heatingPrepayments ?? []
      const first = [...heizstaffel].sort((a, b) => compareText(a.from, b.from))[0]
      if (first === undefined) continue
      const months = periodMonths(period)
      for (const e of t.prepayments) {
        if (e.from <= first.from || !months.includes(e.from) || heizstaffel.some((h) => h.from === e.from)) continue
        warn('prepayment.heating-share-unchanged',
          `${t.tenantName} (${t.unit.name}): Die Vorauszahlung ändert sich ab ${monthSpanText([e.from])} auf ${fmtCents(e.monthlyCents)}, die Heizvorauszahlung nicht. ` +
            'Gehört die Änderung ganz zu den übrigen Kosten? Sonst tragen Sie ab diesem Monat auch die Heizvorauszahlung neu ein.',
          { kind: 'tenancy', id: t.id })
      }
    }
  }
```

Den Block „Ohne Abrechnung (#93)“ in einer Teilabrechnung überspringen: die Zeile
`for (const t of partTenancies) {` dieses Blocks ersetzen durch
`for (const t of scope === 'heatingPart' ? [] : partTenancies) {`. Im selben Block die Bedingung
`if (prepaid > 0 && (neither || (st && st.rows.length === 0))) {` durch
`if (scope === 'all' && prepaid > 0 && (neither || (st && st.rows.length === 0))) {` ersetzen.

Beim Rückstand im Mietkonto die Bedingung `if (ledgerInUse && anyDue) {` durch
`if (scope === 'all' && ledgerInUse && anyDue) {` ersetzen: Die Teilabrechnung und die
Heizkostenabrechnung melden ihn nicht noch einmal.

Den Block aus PR 3, der `shortBasis` und `continuing` setzt (direkt vor `const result`), ersetzen:

```ts
  // Vorschlag nach § 560 Abs. 4 BGB (#208, Heizung PR 5): je Position ein Faktor auf zwölf Monate,
  // siehe prepaymentSuggestion.ts. Gebraucht wird er im Rumpf und, wenn P nach Weg b eine
  // Heizperiode aufnimmt, die selbst ein Rumpf ist; eine volle Heizperiode zählt mit ihrem Betrag
  // (Faktor 1), ebenso jede Position eines vollen P.
  const degreeDays = () => law(hkvDegreeDays, { period: lawPeriod }, lawLog)
  let shortBasis: AnnualBasis | null = null
  if (period.short || mergedParts.some((p) => p.period.short)) {
    const ones = (list: readonly SnapshotCostItem[]): AnnualBasis => ({ ok: true, factors: new Map(list.map((c) => [c.id, 1])) })
    const bases: AnnualBasis[] = [
      period.short
        ? annualFactors(period, items, snapshot.previousCostItems ? { period: snapshot.previousPeriod, items: snapshot.previousCostItems } : null, degreeDays)
        : ones(items),
      ...mergedParts.map((p) => (p.period.short ? annualFactors(p.period, p.items, { period: p.previous, items: p.previousItems }, degreeDays) : ones(p.items))),
    ]
    const failed = bases.find((b) => !b.ok)
    const factors = new Map<string, number>()
    for (const b of bases) if (b.ok) for (const [id, f] of b.factors) factors.set(id, f)
    shortBasis = failed ?? { ok: true, factors }
  }
  const continuing = partTenancies.some((t) => !(t.end != null && t.end <= yTo))
  const basis = shortBasis
  if (scope !== 'heatingPart' && basis && !basis.ok && continuing) {
    const which = [...items, ...mergedParts.flatMap((p) => p.items)].find((c) => c.id === basis.costItemId)
    // Die beiden Texte aus PR 3 (R10), wörtlich.
    warn('prepayment.no-suggestion', basis.reason === 'unmarked'
      ? `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: Keine Position der Heizkosten ist als Brennstoff gekennzeichnet. Kennzeichnen Sie die Brennstoffrechnung (Gas, Öl, Fernwärme, Strom der Wärmepumpe) unter „Weitere Angaben“ mit „Brennstoff/Energie“ und tragen Sie ihren Leistungszeitraum ein; dann rechnet Mietfuchs den Vorschlag nach Gradtagen hoch.`
      : `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: „${which?.description ?? ''}“ ist eine Lieferung ohne Leistungszeitraum. Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung.`,
    which ? itemSubject(which) : undefined)
  }
```

(Die Texte sind die aus PR 3 Task 6; weichen sie dort ab, gilt deren Fassung, denn
`calc-vorschlag.test.ts` hält sie fest. Die Schleife über `result.statements` aus PR 3 liest
weiter `shortBasis`.)

Im Ergebnis `const result: ComputedSettlement = {` hinter `deadline: …`:

```ts
    ...(heatingPeriodsShown.length > 0 ? { heatingPeriods: heatingPeriodsShown } : {}),
    ...(separateHeating.length > 0 ? { separateHeating } : {}),
```

In der Schleife `for (const st of result.statements)` als erste Zeilen hinter
`st.balanceCents = …`:

```ts
    // Eine Abrechnung nur mit Heizkosten hat keine künftige Vorauszahlung (3.7: „heatingOnly ergibt
    // keinen Vorschlag“).
    if (st.heatingOnly) {
      st.suggestedMonthlyCents = 0
      continue
    }
```

- [ ] **Step 7: Lexikon und Ampel**

`shared/glossary.ts`, hinter `settlementDeadline`:

```ts
  // Heizung PR 5 (#217): BGH, Urteil vom 30.04.2008, VIII ZR 240/07, Leitsätze nachgelesen (Entwurf 3.1).
  heatingPeriod: {
    title: 'Eigene Heizperiode',
    short: 'Die Heizkosten werden für einen anderen Zeitraum abgerechnet als die übrigen Betriebskosten, meist für den des Messdienstes, etwa Mai bis April.',
    example: 'Die Betriebskostenabrechnung 2026 umfasst Januar bis Dezember 2026, darin die Heizkosten der Heizperiode 01.05.2025–30.04.2026. Ein Mieter, der am 31.10.2025 ausgezogen ist, bekommt für 2026 eine Abrechnung nur mit seinen Heizkosten vom 01.05. bis 31.10.2025, im Beispiel 412,30 €.',
    norm: 'BGH, Urteil vom 30.04.2008, VIII ZR 240/07; § 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst nicht im Zeitraum Ihrer Abrechnung abrechnet und Sie den Zeitraum nicht umstellen wollen. Zulässig ist das, wenn Heizkosten und übrige Kosten mit einer gemeinsamen Vorauszahlung abgerechnet werden. Werden die Heizkosten mit eigener Vorauszahlung getrennt abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit eigener Frist; das ist eine Auslegung des Gesetzes. Legt Ihr Mietvertrag den Zeitraum fest, braucht eine Änderung die Zustimmung der Mieter.',
  },
```

`client/src/notices.ts`: in `INFORMATIONAL` `'period.heating-differs'` ergänzen und über der Zeile
den Satz anfügen: `// Ebenso die eigene Heizperiode (Heizung PR 5): zulässig und nur eine Auskunft.`

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-heizperiode.test.ts test/calc-heizanlage.test.ts test/calc-zeitraum.test.ts test/calc-vorschlag.test.ts test/settlement-golden.test.ts test/glossary.test.ts test/law-literals.test.ts && npm --prefix client test -- notices && npm run typecheck`
Expected: PASS (calc-heizperiode 10 Tests); Golden, Gleichheitstest (PR 2) und „Anlage mit Vorgaben“
(PR 4) unverändert grün.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/snapshot.ts server/src/calc.ts shared/glossary.ts client/src/notices.ts server/test/calc-heizperiode.test.ts
git commit -m "Heizperiode: Weg b in der Gesamtabrechnung, Abrechnung nur mit Heizkosten, beide Staffeln im Mietkonto

Jeder Monat der Heizstaffel wird in P angerechnet, außer er gehört einer getrennt abgerechneten
Heizperiode.

Refs #217"
```

---
### Task 6: F14 „Eigene Heizperiode“ (Golden mit Herleitung)

Entwurf 12.1: Objekt im Kalenderjahr, Anlage Mai bis April, einheitliche Vorauszahlung, Auszug
31.10.2025. Geprüft wird der ganze Weg über die Datenbank: Bestand im Kalenderjahr erfasst, Anlage
angelegt, Heizperiode eingestellt, Positionen umgeschlüsselt (G-A2), dann beide Abrechnungen auf den
Cent. Die Herleitung steht im README, damit ein Mensch jede Zahl nachrechnen kann.

**Files:**
- Create: `server/test/fixtures/period/F14-heizperiode/README.md`, `server/test/heating-period-golden.test.ts`

**Interfaces:**
- Consumes: `createHeatingPlant` (PR 4), `applyHeatingPeriodChange`, `previewHeatingPeriodChange` (Task 4), `readStock` (read.ts), `snapshotFor` (Task 5), `computeSettlement`, `periodOfKey`, `periodKey`, `CALENDAR_RULES`.
- Produces: keine neuen Schnittstellen.

- [ ] **Step 1: README (`server/test/fixtures/period/F14-heizperiode/README.md`)**

```markdown
# F14 Eigene Heizperiode

Ein Haus mit einer Wohnung (EG, 60 m²), abgerechnet im Kalenderjahr. Die Heizanlage wird vom
Messdienst von Mai bis April abgerechnet; die Vorauszahlung ist einheitlich (keine getrennte
Heizkostenabrechnung), also Weg b (Entwurf 3.1, BGH VIII ZR 240/07).

| Mietverhältnis | Zeit | Vorauszahlung |
|---|---|---|
| M | 01.01.2024–31.10.2025 | 200 € im Monat |
| N | ab 01.11.2025 | 220 € im Monat |

Erfasst, bevor die Anlage angelegt wird, also unter dem Kalenderjahr:

| Position | Zeitraum | Betrag | Schlüssel |
|---|---|---|---|
| Messdienst 2024/2025 | 2025 | 950,00 € | Einzelbeträge: M 950,00 € |
| Messdienst 2025/2026 | 2026 | 1.000,00 € | Einzelbeträge: M 412,30 €, N 587,70 € |
| Grundsteuer 2025 | 2025 | 600,00 € | Wohnfläche |
| Grundsteuer 2026 | 2026 | 600,00 € | Wohnfläche |

## Umschlüsseln (G-A2)

Die Anlage bekommt Mai als Beginn ihrer Heizperiode. Jede Heizposition kommt in die Heizperiode, die
in ihrem Abrechnungszeitraum endet: „Messdienst 2024/2025“ von `2025-01` nach `2024-05`
(01.05.2024–30.04.2025, endet 2025), „Messdienst 2025/2026“ von `2026-01` nach `2025-05`
(01.05.2025–30.04.2026, endet 2026). Beide Heizperioden reichen über zwei Kalenderjahre; das Jahr der
Zahlung wird das Jahr des bisherigen Zeitraums (2025 bzw. 2026).

## Abrechnung 2025 (Frist 31.12.2026)

- Grundsteuer 600,00 € nach Fläche, eine Wohnung, durchgehend bewohnt: M 304 Tage, N 61 Tage von 365.
  M 600 · 304/365 = 499,7260 €, N 600 · 61/365 = 100,2740 €. Abgerundet 499,72 + 100,27 = 599,99 €;
  der Restcent geht an den größeren Rest (M, 0,60 ct gegen 0,40 ct): **M 499,73 €, N 100,27 €**.
- Heizperiode 2024/2025: N wohnte darin nicht; **M 950,00 €** laut Einzelbetrag.
- M: 499,73 + 950,00 = 1.449,73 €; Vorauszahlungen Januar bis Oktober 10 · 200 = 2.000,00 €;
  **Guthaben 550,27 €**.
- N: 100,27 €; Vorauszahlungen November und Dezember 2 · 220 = 440,00 €; **Guthaben 339,73 €**.

## Abrechnung 2026 (Frist 31.12.2027)

- Grundsteuer 600,00 €: **N 600,00 €**.
- Heizperiode 2025/2026: **N 587,70 €**, **M 412,30 €**.
- N: 600,00 + 587,70 = 1.187,70 €; Vorauszahlungen 12 · 220 = 2.640,00 €; **Guthaben 1.452,30 €**.
- M wohnte 2026 nicht mehr: **Abrechnung nur mit Heizkosten**, 412,30 €, keine Vorauszahlung,
  **Nachzahlung 412,30 €**. Ob dafür die Frist 31.12.2027 gilt, ist nicht entschieden (15.1 Nr. 2);
  empfohlen ist die Frist des Zeitraums, in dem das Mietverhältnis endete: **31.12.2026**. Die
  Abrechnung des Messdienstes für 2025/2026 ist dafür bis **Oktober 2026** anzufordern (zwei Monate
  vorher, Entwurf 3.1).

## Summen

Jede Position steht in genau einer Abrechnung: 2025 enthält 950,00 + 600,00 = 1.550,00 €, 2026
enthält 1.000,00 + 600,00 = 1.600,00 €; der Vermieter trägt nichts.
```

- [ ] **Step 2: Write the test**

`server/test/heating-period-golden.test.ts`:

```ts
// F14 „Eigene Heizperiode“ (Entwurf 12.1, Herleitung in fixtures/period/F14-heizperiode/README.md):
// der ganze Weg über die Datenbank, vom Bestand im Kalenderjahr bis zu beiden Abrechnungen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { applyHeatingPeriodChange, previewHeatingPeriodChange } from '../src/db/heatingPeriodChange.ts'
import { readStock } from '../src/db/read.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

const TODAY = '2026-10-05'

test('F14: eigene Heizperiode, Auszug 31.10.2025, Abrechnung nur mit Heizkosten', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-f14-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'eg', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't-m', { unitId: 'eg', tenantName: 'M', persons: 1, start: '2024-01-01', end: '2025-10-31', prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
      await createEntity(db, 'tenancies', 't-n', { unitId: 'eg', tenantName: 'N', persons: 1, start: '2025-11-01', prepayments: [{ from: '2025-11', monthlyCents: 22000 }] })
      const heizung = (id: string, period: string, amountCents: number, tenancyAmounts: Record<string, number>) =>
        createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents, key: 'amounts', tenancyAmounts })
      await heizung('Messdienst 2024/2025', '2025-01', 95000, { 't-m': 95000 })
      await heizung('Messdienst 2025/2026', '2026-01', 100000, { 't-m': 41230, 't-n': 58770 })
      for (const year of [2025, 2026]) {
        await createEntity(db, 'costItems', `Grundsteuer ${year}`, { propertyId: 'objekt-1', period: `${year}-01`, category: 'Grundsteuer', description: `Grundsteuer ${year}`, amountCents: 60000, key: 'area' })
      }
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service', assignItemIds: ['Messdienst 2024/2025', 'Messdienst 2025/2026'] })
    })
    const mai = { startMonth: 5, changes: [] }
    const vorschau = await opened.read((db) => previewHeatingPeriodChange(db, 'hp1', mai, TODAY)) ?? assert.fail('keine Anlage')
    assert.deepEqual(vorschau.moves.map((m) => [m.costItemId, m.from, m.to]), [
      ['Messdienst 2024/2025', '2025-01', '2024-05'],
      ['Messdienst 2025/2026', '2026-01', '2025-05'],
    ])
    const r = await opened.write((db) => applyHeatingPeriodChange(db, 'hp1', mai, {}, TODAY))
    assert.ok(r && 'plant' in r)

    const stock = await opened.read(readStock)
    assert.deepEqual(
      stock.costItems.filter((c) => c.category === HEATING_CATEGORY).map((c) => [c.id, c.period, c.taxYear]),
      [['Messdienst 2024/2025', '2024-05', 2025], ['Messdienst 2025/2026', '2025-05', 2026]],
    )
    const abrechnung = (key: string) => computeSettlement(snapshotFor(stock, 'objekt-1', periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(key)), { asOf: TODAY })
    const zeilen = (s: ReturnType<typeof abrechnung>) => Object.fromEntries(s.statements.map((st) => [st.tenantName, {
      rows: st.rows.map((row) => [row.description, row.shareCents]),
      total: st.totalShareCents, prepayment: st.prepaymentCents, balance: st.balanceCents,
      ...(st.heatingOnly ? { heatingOnly: true, recommended: st.recommendedDeadline } : {}),
    }]))

    const s2025 = abrechnung('2025-01')
    assert.equal(s2025.deadline, '2026-12-31')
    assert.deepEqual(s2025.heatingPeriods?.map((h) => h.period.label), ['2024/2025'])
    assert.deepEqual(zeilen(s2025), {
      M: { rows: [['Grundsteuer 2025', 49973], ['Messdienst 2024/2025', 95000]], total: 144973, prepayment: 200000, balance: 55027 },
      N: { rows: [['Grundsteuer 2025', 10027]], total: 10027, prepayment: 44000, balance: 33973 },
    })
    assert.equal(s2025.totalCostsCents, 155000)

    const s2026 = abrechnung('2026-01')
    assert.equal(s2026.deadline, '2027-12-31')
    assert.deepEqual(s2026.heatingPeriods?.map((h) => h.period.label), ['2025/2026'])
    assert.deepEqual(zeilen(s2026), {
      N: { rows: [['Grundsteuer 2026', 60000], ['Messdienst 2025/2026', 58770]], total: 118770, prepayment: 264000, balance: 145230 },
      M: { rows: [['Messdienst 2025/2026', 41230]], total: 41230, prepayment: 0, balance: -41230, heatingOnly: true, recommended: '2026-12-31' },
    })
    assert.equal(s2026.totalCostsCents, 160000)
    const warnung = s2026.notices?.find((n) => n.code === 'period.heating-only-statement') ?? assert.fail('keine Warnung')
    assert.match(warnung.text, /Stellen Sie sie bis 31\.12\.2026 zu\. Fordern Sie dafür die Abrechnung des Messdienstes für 2025\/2026 bis spätestens Oktober 2026 an\./)
    for (const s of [s2025, s2026]) {
      assert.equal(s.landlord.totalCents, 0)
      assert.equal(s.statements.reduce((a, st) => a + st.totalShareCents, 0), s.totalCostsCents)
    }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run test**

Run: `npm --prefix server test -- test/heating-period-golden.test.ts`
Expected: PASS. Fällt eine Zahl anders aus, zuerst die Herleitung im README nachrechnen, dann den
Code; die Erwartung wird nie an die Ausgabe angepasst.

- [ ] **Step 4: Commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/test/fixtures/period/F14-heizperiode/README.md server/test/heating-period-golden.test.ts
git commit -m "Heizperiode: F14 mit Herleitung, vom Bestand im Kalenderjahr bis zur Abrechnung nur mit Heizkosten

Refs #217"
```

---
### Task 7: Die Heizkostenabrechnung nach Weg d

Entwurf 6.1 Nr. 7: Je Anlage und getrennt abgerechneter Heizperiode eine eigene Abrechnung mit
derselben Rechnung (`scope: 'heating'`): nur die Positionen der Anlage unter dieser Heizperiode, als
Vorauszahlung die Heizstaffel der Monate dieser Heizperiode (endgültige oder vorläufige
Heizkorrektur, D2), Frist `settlementDeadline(H)`, Vorschlag nach § 560 Abs. 4 für die
Heizvorauszahlung. Monate vor dem Beginn der Heizstaffel sind in der Abrechnung des Objekts
angerechnet; die Abrechnung sagt das (C3).

**Files:**
- Modify: `server/src/snapshot.ts`, `server/src/calc.ts`
- Test: `server/test/calc-weg-d.test.ts` (neu)

**Interfaces:**
- Consumes (Task 2, 5): `plantRules`, `monthSpanText`, `wayOf`, `SnapshotScope`, `scope`, `prepaymentOf`, `objectRules`; `rateAtMonth`, `periodMonths`, `periodContaining`, `periodLabel`.
- Produces:
  - snapshot.ts: `heatingSnapshotFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, plantId: string, h: BillingPeriod): Snapshot | null`
  - calc.ts: `heatingPrepaymentCents(tenancy: SnapshotTenancy, plantId: string, h: Pick<BillingPeriod, 'key' | 'from' | 'to'>, owns?: (month: string) => boolean): { cents: number; overridden: boolean; provisional: HeatingPrepaymentOverride | null; elsewhere: string[] }`; Code `prepayment.heating-override-pending`; `Statement.scope = 'heating'`, `Settlement.scope` in der Heizkostenabrechnung

- [ ] **Step 1: Write the failing test**

`server/test/calc-weg-d.test.ts`:

```ts
// Die Heizkostenabrechnung nach Weg d (Heizung PR 5, Entwurf 3.1, 6.1 Nr. 7, Testfälle R3, B3, A3,
// C2/D2, C3, D1 aus 12.2).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, heatingPrepaymentCents, type ComputedSettlement } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, HeatingPrepaymentOverride, PeriodRules, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (separateSpans: SeparateSpan[], units: { unitId: string; heatedAreaM2: null }[] | null = null) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, units,
  periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: true,
})
const offen: SeparateSpan[] = [{ from: '2025-05', until: null }]
// Weg d ab X = 01/2026 (C2, C3): Die Heizperiode 2025/2026 ist getrennt, ihre Monate vor X gehören P.
const ab2026: SeparateSpan[] = [{ from: '2026-01', until: null }]
const mieter = (id: string, unitId: string, heating: { from: string; monthlyCents: number }[], overrides: HeatingPrepaymentOverride[] = []) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: heating[0]?.from ?? '2024-01', monthlyCents: 17700 }],
  prepaymentOverrides: {}, baseRents: [], heatingPrepayments: heating, heatingPrepaymentOverrides: overrides,
})
const heizung = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: HEATING_CATEGORY, description: id, amountCents, key: 'area' as const, heatingPlantId: 'hp1', ...over,
})
const haus = (over: Partial<Source>): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage(offen)],
  ...over,
} as Source)
const heizkosten = (src: Source, key: string): ComputedSettlement =>
  computeSettlement(heatingSnapshotFor(src, 'objekt-1', 'hp1', of(MAI, key)) ?? assert.fail('keine Anlage'))
const st = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`${id} fehlt`)
const korrektur = (period: string, cents: number, monate?: [string, string]): HeatingPrepaymentOverride => ({
  plantId: 'hp1', period: periodKey(period), cents, provisional: monate !== undefined, fromMonth: monate?.[0] ?? null, toMonth: monate?.[1] ?? null,
})

test('R3/B3/A3: eigene Heizkostenabrechnung je Heizperiode, Frist 30.04.2027, Vorschlag für die Heizvorauszahlung', () => {
  const src = haus({
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }])],
    costItems: [heizung('Messdienst', '2025-05', 150000, { taxYear: 2026 }), { ...heizung('Grundsteuer', '2026-01', 50000), category: 'Grundsteuer', heatingPlantId: undefined }],
  })
  const h = heizkosten(src, '2025-05')
  assert.deepEqual([h.period.label, h.deadline, h.scope], ['2025/2026', '2027-04-30', { kind: 'heating', plantId: 'hp1', plantName: '' }])
  const a = st(h, 'A')
  assert.deepEqual(
    [a.scope, a.rows.map((r) => [r.costItemId, r.shareCents]), a.prepaymentCents, a.heatingPrepaymentCents, a.balanceCents, a.suggestedMonthlyCents],
    ['heating', [['Messdienst', 150000]], 147600, 147600, -2400, 12500],
  )
  assert.equal(a.prepaymentNote, undefined)
  const p = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2026-01')))
  assert.deepEqual(st(p, 'A').rows.map((r) => r.costItemId), ['Grundsteuer'], 'die Gesamtabrechnung 2026 enthält die Heizkosten nicht')
  assert.deepEqual(p.separateHeating?.map((x) => [x.period.key, x.deadline]), [['2025-05', '2027-04-30']])
})

test('C2/D2: vorläufige Heizkorrektur 876 € für Mai–Dezember 2026, Staffel Januar–April 2027: 1.368 € angerechnet', () => {
  const src = haus({
    heatingPlants: [anlage(ab2026)],
    tenancies: [mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }], [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 }), heizung('H26', '2026-05', 150000, { taxYear: 2027 })],
  })
  const h26 = st(heizkosten(src, '2026-05'), 'A')
  assert.equal(h26.prepaymentCents, 87600 + 4 * 12300)
  assert.notEqual(h26.prepaymentCents, 8 * 12300 + 4 * 12300, 'Fehlbild: Restbetrag nicht gespeichert, die Staffel für Mai–Dezember')
  const pending = heizkosten(src, '2026-05').notices?.find((n) => n.code === 'prepayment.heating-override-pending') ?? assert.fail('keine Warnung')
  assert.equal(pending.level, 'warning')
  assert.match(pending.text, /Für Mai bis Dezember 2026 gilt vorläufig 876,00 €, der Rest der Korrektur der Abrechnung 2026\./)
  const h25 = st(heizkosten(src, '2025-05'), 'A')
  assert.deepEqual([h25.prepaymentCents, h25.prepaymentOverridden], [30000, true])
  assert.equal(h25.prepaymentNote, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.')
  assert.equal(heizkosten(src, '2025-05').notices?.some((n) => n.code === 'prepayment.heating-override-pending'), false)
})

test('C3: Weg d nach dem Abschluss von 2025 eingerichtet, X = 01/2026: 2025/2026 rechnet vier Monate an und nennt die übrigen', () => {
  const src = haus({
    heatingPlants: [anlage(ab2026)],
    tenancies: [mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 })],
  })
  const a = st(heizkosten(src, '2025-05'), 'A')
  assert.equal(a.prepaymentCents, 4 * 12300)
  assert.equal(a.prepaymentNote, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.')
})

test('D1 Fall 1: Die Heizperiode vor W rechnet alle zwölf Monate an (1.476 €), keine geht verloren', () => {
  const src = haus({
    heatingPlants: [anlage([{ from: '2025-05', until: periodKey('2026-05') }])],
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 })],
  })
  assert.equal(st(heizkosten(src, '2025-05'), 'A').prepaymentCents, 12 * 12300)
  const p2026 = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2026-01')))
  assert.equal(st(p2026, 'A').heatingPrepaymentCents, 8 * 12300, 'P 2026 rechnet die Heizstaffel ab 05/2026 an')
})

test('Heizvorauszahlung einer Heizperiode: endgültig, vorläufig, Monate, die P anrechnet', () => {
  const t = mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }], [korrektur('2026-05', 87600, ['2026-05', '2026-12'])])
  assert.deepEqual(heatingPrepaymentCents(t, 'hp1', of(MAI, '2026-05')), {
    cents: 87600 + 4 * 12300, overridden: true, provisional: korrektur('2026-05', 87600, ['2026-05', '2026-12']), elsewhere: [],
  })
  const abX = (m: string) => m >= '2026-01'
  assert.deepEqual(heatingPrepaymentCents(t, 'hp1', of(MAI, '2025-05'), abX), {
    cents: 4 * 12300, overridden: false, provisional: null,
    elsewhere: ['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'],
  })
})

test('Wohnungen ohne Heizposition fehlen in der Heizkostenabrechnung', () => {
  const src = haus({
    heatingPlants: [anlage(offen, [{ unitId: 'u1', heatedAreaM2: null }])],
    units: [
      { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
      { id: 'g1', propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true, noConnection: ['waerme'] },
    ],
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }]), { ...mieter('B', 'g1', []), heatingPrepayments: [] }],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026, participantUnitIds: ['u1'] })],
  })
  assert.deepEqual(heizkosten(src, '2025-05').statements.map((s) => s.tenancyId), ['A'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/calc-weg-d.test.ts`
Expected: FAIL beim Import: `heatingSnapshotFor` und `heatingPrepaymentCents` gibt es nicht.

- [ ] **Step 3: Schnappschuss (`server/src/snapshot.ts`)**

Hinter `snapshotFor`:

```ts
// Der Schnappschuss der Heizkostenabrechnung einer Heizperiode nach Weg d (Heizung PR 5, Entwurf
// 3.1, 6.1 Nr. 7): nur die Positionen der Anlage unter dieser Heizperiode; Mietverhältnisse,
// Ablesungen und Zahlungen wie immer vollständig. Der abgeschlossene Stand ist der der
// Heizkostenabrechnung und nie der einer Abrechnung des Objekts mit zufällig gleichem Schlüssel.
// Ob die Heizperiode wirklich getrennt abgerechnet wird, prüft die Route; `null` ohne Anlage.
export function heatingSnapshotFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, plantId: string, h: BillingPeriod): Snapshot | null {
  const found = source.properties?.find((p) => p.id === propertyId)
  const objectRules = rulesOf(found)
  const plants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId)
  const plant = plants.find((p) => p.id === plantId)
  if (!plant) return null
  const rules = plantRules(wayOf(plant), objectRules)
  const narrowed = narrowToProperty(source, propertyId)
  const mine = narrowed.costItems.filter((c) => c.heatingPlantId === plantId)
  const frozen = (source.closedHeatingSettlements ?? []).find((c) => c.plantId === plantId && c.period === h.key)
  return {
    ...snapshotOfPeriod({ ...narrowed, costItems: mine, closedSettlements: [] }, h, previousPeriod(rules, h)),
    propertyId,
    property: found ? { kind: found.kind, cableBuiltBeforeDec2021: found.cableBuiltBeforeDec2021 ?? null } : null,
    heatingPlants: plants,
    objectRules,
    closedSettlement: frozen
      ? {
          selfUsedShareCents: frozen.selfUsedShareCents,
          prepaymentCents: frozen.prepaymentCents,
          prepaymentOverridden: frozen.prepaymentOverridden,
          selfUseByItem: frozen.selfUseByItem ?? null,
          itemTotals: frozen.itemTotals ?? null,
        }
      : null,
    scope: { kind: 'heating', plant },
  }
}
```

- [ ] **Step 4: Berechnung (`server/src/calc.ts`)**

Typ `HeatingPrepaymentOverride` aus `'../../shared/types.ts'` importieren. Hinter
`computePrepaymentCents`:

```ts
// Die Heizvorauszahlung in der Heizkostenabrechnung einer Heizperiode (Weg d, Entwurf 3.1, D2 der
// achten Fassung). `owns` sagt, welche Monate dieser Heizperiode ihre Heizstaffel hier anrechnen
// (`separateOwner`); die übrigen, die Monate vor X, rechnet die Abrechnung des Objekts an, und die
// Heizkostenabrechnung nennt sie (`elsewhere`, C3). Eine endgültige Korrektur ersetzt die Anrechnung
// der ganzen Heizperiode; eine vorläufige nur ihre Monate, die übrigen rechnen nach der Staffel.
export function heatingPrepaymentCents(
  tenancy: SnapshotTenancy,
  plantId: string,
  h: Pick<BillingPeriod, 'key' | 'from' | 'to'>,
  owns: (month: string) => boolean = () => true,
): { cents: number, overridden: boolean, provisional: HeatingPrepaymentOverride | null, elsewhere: string[] } {
  const schedule: MonthlySchedule[] = Array.isArray(tenancy.heatingPrepayments) ? tenancy.heatingPrepayments : []
  const months = periodMonths(h).filter((m) => tenancy.start <= `${m}-01` && !(tenancy.end && tenancy.end < `${m}-01`))
  const mine = months.filter(owns)
  const elsewhere = months.filter((m) => !owns(m))
  const staffel = (list: readonly string[]): number => list.reduce((a, m) => a + rateAtMonth(schedule, m), 0)
  const override = (tenancy.heatingPrepaymentOverrides ?? []).find((o) => o.plantId === plantId && o.period === h.key)
  if (override && !override.provisional) return { cents: override.cents, overridden: true, provisional: null, elsewhere }
  if (override && override.fromMonth !== null && override.toMonth !== null) {
    const from = override.fromMonth
    const to = override.toMonth
    return { cents: override.cents + staffel(mine.filter((m) => m < from || m > to)), overridden: true, provisional: override, elsewhere }
  }
  return { cents: staffel(mine), overridden: false, provisional: null, elsewhere }
}
```

In `noticeKinds` hinter `prepayment.heating-share-unchanged`:

```ts
  'prepayment.heating-override-pending': { level: 'warning', title: 'Heizkorrektur vorläufig', terms: ['heatingPeriod', 'prepayment'] },
```

In `computeSettlement` direkt vor `const prepaymentOf = …`:

```ts
  // Weg d (Heizung PR 5): die Heizvorauszahlungen der Monate dieser Heizperiode. Eine vorläufige
  // Korrektur meldet die Abrechnung, bis die Heizperiode abgeschlossen ist (D2 der achten Fassung);
  // danach steht die Warnung im eingefrorenen Stand, und eine neue Abrechnung gibt es nicht.
  const heatingScopePrepayment = (t: TenancyWithUnit): { cents: number, overridden: boolean, heatingCents: number, note?: string } => {
    const plant = snapshot.scope?.plant
    const way = plant ? wayOf(plant) : null
    const r = heatingPrepaymentCents(t, plant?.id ?? '', period, (m) => way !== null && separateOwner(way, objectRules, m)?.key === period.key)
    const byPeriod = new Map<string, { label: string, months: string[] }>()
    for (const m of r.elsewhere) {
      const p = periodContaining(objectRules, `${m}-01`)
      const entry = byPeriod.get(p.key) ?? { label: periodLabel(p), months: [] }
      entry.months.push(m)
      byPeriod.set(p.key, entry)
    }
    const note = [...byPeriod.values()].map((e) => `Die Vorauszahlungen ${monthSpanText(e.months)} sind in der Abrechnung ${e.label} angerechnet.`).join(' ')
    if (r.provisional !== null && r.provisional.fromMonth !== null && r.provisional.toMonth !== null) {
      const from = r.provisional.fromMonth
      const to = r.provisional.toMonth
      const covered = periodMonths(period).filter((m) => m >= from && m <= to)
      warn('prepayment.heating-override-pending',
        `${t.tenantName} (${t.unit.name}): Für ${monthSpanText(covered)} gilt vorläufig ${fmtCents(r.provisional.cents)}, der Rest der Korrektur der Abrechnung ${periodLabel(periodContaining(objectRules, `${from}-01`))}. ` +
          `Erfassen Sie beim Abrechnen die tatsächlich gezahlten Heizvorauszahlungen für die ganze Heizperiode ${label} („✎ anpassen“); bis dahin bleibt diese Warnung.`,
        { kind: 'tenancy', id: t.id })
    }
    return { cents: r.cents, overridden: r.overridden, heatingCents: r.cents, ...(note ? { note } : {}) }
  }
```

In `prepaymentOf` die Zeile `if (scope !== 'all') return { cents: 0, overridden: false }` ersetzen durch:

```ts
    if (scope === 'heatingPart') return { cents: 0, overridden: false }
    if (scope === 'heating') return heatingScopePrepayment(t)
```

Im Objekt des Statements (Schleife `for (const t of partTenancies)`) hinter den Zeilen aus Task 5:

```ts
      ...(scope === 'heating' ? { scope: 'heating' as const } : {}),
```

Direkt hinter dem Block „Ohne Abrechnung (#93)“:

```ts
  // In der Heizkostenabrechnung steht nur, wer Heizkosten oder eine Heizvorauszahlung hat; eine
  // Garage ohne Anschluss an die Anlage bekäme sonst eine leere Abrechnung (Heizung PR 5).
  if (scope === 'heating') {
    for (const [id, own] of statements) if (own.rows.length === 0 && own.prepaymentCents === 0) statements.delete(id)
  }
```

Im Ergebnis hinter den Zeilen aus Task 5:

```ts
    ...(scope === 'heating' && snapshot.scope
      ? { scope: { kind: 'heating' as const, plantId: snapshot.scope.plant.id, plantName: snapshot.scope.plant.name ?? '' } }
      : {}),
```

Frist, Vorschlag nach § 560 und Rumpf folgen von selbst aus `period` = H: Die Frist ist
`settlementDeadline(H)`, der Vorschlag rechnet über die Heizpositionen allein (A3), und ist H ein
Rumpf, rechnet `annualFactors` wie in PR 3.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-weg-d.test.ts test/calc-heizperiode.test.ts test/settlement-golden.test.ts test/glossary.test.ts && npm run typecheck`
Expected: PASS (calc-weg-d 6 Tests).

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/snapshot.ts server/src/calc.ts server/test/calc-weg-d.test.ts
git commit -m "Heizperiode: Heizkostenabrechnung nach Weg d mit eigener Frist, Heizkorrektur endgültig oder vorläufig

Monate vor dem Beginn der Heizstaffel nennt die Abrechnung als in der Abrechnung des Objekts
angerechnet (C3); eine vorläufige Heizkorrektur bleibt bis zum Abschluss eine Warnung (D2).

Refs #217"
```

---
### Task 8: Getrennte Heizkostenabrechnung ein- und ausschalten, mit Vorschau

Entwurf 3.1 (B1, C1–C4, D1, D2, R-g): Einschalten ab einem Monat X teilt jede Stufe der Staffel ab X
in übrige Vorauszahlung und Heizanteil (Summe je Monat gleich), erfasst Jahreskorrekturen offener
Abrechnungen neu (übrige, Heizkorrektur je beendeter Heizperiode, Restbetrag als vorläufige
Korrektur) und nennt die Fristen. Ausschalten wirkt ab W, führt beide Staffeln auf Wunsch wieder
zusammen und erfasst Korrekturen neu, deren Monate danach eine Abrechnung P anrechnet. Bei H = P gibt
es keine Spanne: Einschalten teilt nur die Vorauszahlung für den getrennten Ausweis.

**Files:**
- Create: `server/src/db/separateSettlement.ts`
- Modify: `shared/types.ts`, `server/src/index.ts`
- Test: `server/test/db-weg-d.test.ts` (neu), `server/test/api.test.ts`

**Interfaces:**
- Consumes: `hasOwnRhythm`, `heatingPeriodsEndingIn`, `isObjectPeriod`, `monthSpanText`, `plantRules`, `separateOwner`, `servesUnit`, `settledSeparately`, `PlantWay` (Task 2); `monthsText` (PR 3, periodChange.ts); `PeriodError` (repository.ts); `readHeatingPlants`, `readTenancies`, `readUnits`, `readCostItems`, `readClosedSettlements`, `readProperties` (read.ts); Tabellen aus Task 1 und PR 2.
- Produces:
  - `type SeparatePreview`, `type SeparateAnswers` (`shared/types.ts`, Gestalt unten)
  - `previewSeparate(db: Database, plantId: string, body: unknown, today: string): Promise<SeparatePreview | null>`, `applySeparate(db: Database, plantId: string, body: unknown, today: string): Promise<{ plant: HeatingPlant } | { error: string; preview: SeparatePreview } | null>` (`server/src/db/separateSettlement.ts`); Rumpf `{ separate: boolean; month?: 'JJJJ-MM'; until?: 'JJJJ-MM'; answers?: SeparateAnswers }`
  - Routen `POST /api/heating-plants/:id/separate/preview` (200, 400, 404) und `PUT /api/heating-plants/:id/separate` (200 Anlage, 400, 404, 409 `{ error, preview }`)

- [ ] **Step 1: Write the failing test**

`server/test/db-weg-d.test.ts`:

```ts
// Getrennte Heizkostenabrechnung ein- und ausschalten (Heizung PR 5, Entwurf 3.1, Testfälle B1/C1,
// C2/D2, C3, C4, D1 Fall 1 und 2, R-g aus 12.2, Review Focus 3).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { applySeparate, previewSeparate } from '../src/db/separateSettlement.ts'
import { closeSettlement, createEntity, findEntity } from '../src/db/repository.ts'
import { createHeatingPlant, listHeatingPlants } from '../src/db/heating.ts'
import { readStock } from '../src/db/read.ts'
import { closedHeatingSettlements, heatingPlants } from '../src/db/schema.ts'
import { computeSettlement, rentLedger } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import type { SeparatePreview } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-weg-d-'))
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

// Ein Haus im Kalenderjahr, die Anlage rechnet Mai bis April ab. Die Abrechnung 2024 enthält
// 4.100 € Heizkosten von 10.000 € (41 %, Testfall B1).
async function haus(db: Database, tenancy: Record<string, unknown>): Promise<void> {
  await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
  await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }], ...tenancy })
  await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
  await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
  await createEntity(db, 'costItems', 'gs2024', { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer 2024', amountCents: 590000, key: 'area' })
  await createEntity(db, 'costItems', 'h2023', { propertyId: 'objekt-1', period: '2023-05', category: HEATING_CATEGORY, description: 'Messdienst 2023/2024', amountCents: 410000, key: 'area', heatingPlantId: 'hp1', taxYear: 2024 })
  await createEntity(db, 'costItems', 'h2025', { propertyId: 'objekt-1', period: '2025-05', category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 150000, key: 'area', heatingPlantId: 'hp1', taxYear: 2026 })
}

const preview = async (opened: OpenedDatabase, body: unknown, today = TODAY): Promise<SeparatePreview> =>
  (await opened.read((db) => previewSeparate(db, 'hp1', body, today))) ?? assert.fail('keine Anlage')
const apply = (opened: OpenedDatabase, body: unknown) => opened.write((db) => applySeparate(db, 'hp1', body, TODAY))
const ein = (opened: OpenedDatabase, month: string, steps: Record<string, number>, extra: Record<string, unknown> = {}) =>
  apply(opened, { separate: true, month, answers: { steps: { t1: steps }, ...extra } })
const tenancyField = async (opened: OpenedDatabase, key: string) => fieldOf(await opened.read((db) => findEntity(db, 'tenancies', 't1')), key)
const schliessen = (opened: OpenedDatabase, period: string) =>
  opened.write((db) => closeSettlement(db, { id: `s${period}`, propertyId: 'objekt-1', period: periodKey(period), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
const abrechnung = async (opened: OpenedDatabase, key: string) => {
  const stock = await opened.read(readStock)
  return computeSettlement(snapshotFor(stock, 'objekt-1', periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(key)))
}
const heizkosten = async (opened: OpenedDatabase, key: string) => {
  const stock = await opened.read(readStock)
  return computeSettlement(heatingSnapshotFor(stock, 'objekt-1', 'hp1', periodOfKey(MAI, periodKey(key)) ?? assert.fail(key)) ?? assert.fail('keine Anlage'))
}
const mieter = (s: { statements: { tenancyId: string; prepaymentCents: number; prepaymentNote?: string }[] }) =>
  s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')

test('B1/C1: Jede Stufe ab X wird geteilt, vorbelegt mit 41 %; das Mietkonto bleibt bei 300 und 330 €', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 30000 }, { from: '2026-01', monthlyCents: 33000 }] }))
    const v = await preview(opened, { separate: true, month: '2025-05' })
    assert.deepEqual([v.way, v.month, v.share], ['separate', '2025-05', { permille: 410, source: 'Abrechnung 2024: Heizkosten 4.100,00 € von 10.000,00 €' }])
    assert.deepEqual(v.steps, [{ tenancyId: 't1', tenantName: 'Müller', rows: [{ from: '2025-05', totalCents: 30000, heatingCents: 12300 }, { from: '2026-01', totalCents: 33000, heatingCents: 13500 }] }])
    assert.deepEqual(v.deadlines, [
      { period: '2025-05', label: '2025/2026', deadline: '2027-04-30', passed: false },
      { period: '2026-05', label: '2026/2027', deadline: '2028-04-30', passed: false },
    ])
    const ohne = await apply(opened, { separate: true, month: '2025-05' })
    assert.ok(ohne && 'error' in ohne)
    assert.match(ohne.error, /Müller: Heizanteil ab 05\/2025 eintragen/)
    const r = await ein(opened, '2025-05', { '2025-05': 12300, '2026-01': 13500 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [true, [{ from: '2025-05', until: null }]])
    assert.deepEqual(await tenancyField(opened, 'prepayments'), [{ from: '2025-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }, { from: '2026-01', monthlyCents: 19500 }])
    assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), [{ from: '2025-05', monthlyCents: 12300 }, { from: '2026-01', monthlyCents: 13500 }])
    const stock = await opened.read(readStock)
    for (const [year, soll] of [[2025, 30000], [2026, 33000]] as const) {
      const row = rentLedger(snapshotFor(stock, 'objekt-1', calendarYearPeriod(year))).rows[0] ?? assert.fail('keine Zeile')
      assert.deepEqual(row.months.map((m) => m.sollCents), Array(12).fill(soll), `Soll ${year}`)
    }
  })
})

test('C2/D2: Jahreskorrektur 2026 über 3.300 € neu erfasst; 876 € vorläufig für Mai–Dezember 2026, angerechnet 1.368 €', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { prepaymentOverrides: { '2026-01': 330000 } }))
    const v = await preview(opened, { separate: true, month: '2026-01' })
    assert.deepEqual(v.overrides, [{
      tenancyId: 't1', tenantName: 'Müller', period: '2026-01', label: '2026', cents: 330000,
      asks: [
        { kind: 'total', period: '2026-01', label: '2026', months: '01–12/2026' },
        { kind: 'heating', period: '2025-05', label: '2025/2026', months: '01–04/2026' },
      ],
      remainder: { period: '2026-05', label: '2026/2027', months: '05–12/2026' },
    }])
    const r = await ein(opened, '2026-01', { '2026-01': 12300 }, { totals: { t1: { '2026-01': 212400 } }, overrides: { t1: { '2025-05': 30000 } } })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(await tenancyField(opened, 'heatingPrepaymentOverrides'), [
      { plantId: 'hp1', period: '2025-05', cents: 30000, provisional: false, fromMonth: null, toMonth: null },
      { plantId: 'hp1', period: '2026-05', cents: 87600, provisional: true, fromMonth: '2026-05', toMonth: '2026-12' },
    ])
    assert.equal(mieter(await heizkosten(opened, '2026-05')).prepaymentCents, 136800)
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 30000)
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 212400)
  })
})

test('C2: Beträge über der Jahreskorrektur werden abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, { prepaymentOverrides: { '2026-01': 330000 } }))
    const r = await ein(opened, '2026-01', { '2026-01': 12300 }, { totals: { t1: { '2026-01': 300000 } }, overrides: { t1: { '2025-05': 40000 } } })
    assert.ok(r && 'error' in r)
    assert.match(r.error, /übersteigen die Jahreskorrektur 2026 \(3\.300,00 €\)/)
  })
})

test('C3: Nach dem Abschluss von 2025 frühestens ab 01/2026; 2025/2026 rechnet dann vier Monate an', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await schliessen(opened, '2025-01')
    const vorgabe = await preview(opened, { separate: true })
    assert.deepEqual([vorgabe.month, vorgabe.earliestMonth], ['2026-05', '2026-01'])
    const frueh = await preview(opened, { separate: true, month: '2025-05' })
    assert.deepEqual(frueh.blocked, ['Die Vorauszahlungen bis Dezember 2025 sind in der abgeschlossenen Abrechnung 2025 angerechnet. Öffnen Sie sie wieder, wenn Sie früher beginnen wollen.'])
    const abgelehnt = await ein(opened, '2025-05', { '2025-05': 12300 })
    assert.ok(abgelehnt && 'error' in abgelehnt)
    const r = await ein(opened, '2026-01', { '2026-01': 12300 })
    assert.ok(r && 'plant' in r)
    const a = mieter(await heizkosten(opened, '2025-05'))
    assert.deepEqual([a.prepaymentCents, a.prepaymentNote], [4 * 12300, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.'])
  })
})

test('C4: Ausschalten ohne Abschluss führt die Staffeln ab W zusammen; ohne Zusammenführen rechnet P beide an', async () => {
  for (const merge of [true, false]) {
    await withDatabase(async (opened) => {
      await opened.write((db) => haus(db, {}))
      await ein(opened, '2025-05', { '2025-05': 12300 })
      const v = await preview(opened, { separate: false })
      assert.deepEqual([v.until, v.earliestUntil, v.keep], ['2025-05', '2025-05', []])
      assert.deepEqual(v.merge, [{ tenancyId: 't1', tenantName: 'Müller', rows: [{ from: '2025-05', prepaymentCents: 30000 }] }])
      const r = await apply(opened, { separate: false, answers: { merge } })
      assert.ok(r && 'plant' in r)
      assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [false, []])
      assert.deepEqual(await tenancyField(opened, 'heatingPrepayments'), merge ? undefined : [{ from: '2025-05', monthlyCents: 12300 }])
      assert.equal(mieter(await abrechnung(opened, '2025-01')).prepaymentCents, 12 * 30000, `merge ${merge}`)
    })
  }
})

test('D1 Fall 1: P 2025 abgeschlossen, Ausschalten wirkt ab 2026/2027; 2025/2026 rechnet zwölf Monate an', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await schliessen(opened, '2025-01')
    const v = await preview(opened, { separate: false })
    assert.deepEqual([v.until, v.keep.map((k) => [k.period, k.deadline])], ['2026-05', [['2025-05', '2027-04-30']]])
    const frueh = await preview(opened, { separate: false, until: '2025-05' })
    assert.match(frueh.blocked.join(' '), /Die Heizperiode 2025\/2026 hat Monate in der abgeschlossenen Abrechnung 2025\. Sie bleiben eigene Heizkostenabrechnungen/)
    const r = await apply(opened, { separate: false, answers: {} })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(r.plant.separateSpans, [{ from: '2025-05', until: '2026-05' }])
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 12 * 12300)
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 12 * 17700 + 8 * 12300)
  })
})

test('D1 Fall 2: Heizkostenabrechnung 2025/2026 abgeschlossen; ihre Positionen kommen nicht in P 2026', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await opened.write((db) => db.insert(closedHeatingSettlements).values({ id: 'z', plantId: 'hp1', period: periodKey('2025-05'), closedAt: '2026-06-01', sentAt: null, settlement: {} }))
    const frueh = await preview(opened, { separate: false, until: '2025-05' })
    assert.match(frueh.blocked.join(' '), /Die Heizkostenabrechnung 2025\/2026 ist abgeschlossen/)
    const r = await apply(opened, { separate: false, answers: {} })
    assert.ok(r && 'plant' in r)
    const p2026 = await abrechnung(opened, '2026-01')
    assert.deepEqual(mieter({ statements: p2026.statements }).prepaymentCents, 12 * 17700 + 8 * 12300)
    assert.equal(p2026.statements.flatMap((s) => s.rows).some((row) => row.costItemId === 'h2025'), false)
  })
})

test('Wieder einschalten nach dem Ausschalten: die frühere Spanne bleibt, kein Monat doppelt (Review Focus 3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    await ein(opened, '2025-05', { '2025-05': 12300 })
    await schliessen(opened, '2025-01')
    await apply(opened, { separate: false, answers: {} })
    const zuFrueh = await preview(opened, { separate: true, month: '2026-01' })
    assert.deepEqual(zuFrueh.blocked, ['Bis April 2026 gilt die frühere getrennte Heizkostenabrechnung. Wählen Sie einen Beginn ab Mai 2026.'])
    const r = await ein(opened, '2026-05', { '2026-05': 12300 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual(r.plant.separateSpans, [{ from: '2025-05', until: '2026-05' }, { from: '2026-05', until: null }])
    assert.equal(mieter(await heizkosten(opened, '2025-05')).prepaymentCents, 12 * 12300)
    assert.equal(mieter(await heizkosten(opened, '2026-05')).prepaymentCents, 12 * 12300)
    // P 2026 rechnet keinen Monat der Heizstaffel an: Januar bis April gehören 2025/2026, Mai bis Dezember 2026/2027.
    assert.equal(mieter(await abrechnung(opened, '2026-01')).prepaymentCents, 12 * 17700)
  })
})

test('R-g: Die Vorschau nennt eine abgelaufene Frist', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => haus(db, {}))
    const v = await preview(opened, { separate: true, month: '2025-05' }, '2027-06-01')
    assert.deepEqual(v.deadlines[0], { period: '2025-05', label: '2025/2026', deadline: '2027-04-30', passed: true })
  })
})

test('H = P: Einschalten teilt nur die Vorauszahlung, ohne Spanne und ohne neue Korrekturen (A3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await haus(db, { prepaymentOverrides: { '2025-01': 350000 } })
      await db.update(heatingPlants).set({ periodStartMonth: null }).where(eq(heatingPlants.id, 'hp1'))
    })
    const v = await preview(opened, { separate: true, month: '2025-01' })
    assert.deepEqual([v.way, v.overrides, v.deadlines], ['samePeriod', [], []])
    const r = await ein(opened, '2025-01', { '2025-01': 12300 })
    assert.ok(r && 'plant' in r)
    assert.deepEqual([r.plant.separateSettlement, r.plant.separateSpans], [true, []])
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1')))[0]?.separateSettlement, true)
  })
})
```

An `server/test/api.test.ts` anhängen:

```ts
test('Getrennte Heizkostenabrechnung (Heizung PR 5): Vorschau und Einschalten über HTTP, 409 ohne Antworten', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: {} })
    const vorschau = await jsonOf<{ way: string; steps: { rows: { from: string }[] }[] }>(await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: true, month: '2025-05' }))
    assert.deepEqual([vorschau.way, vorschau.steps[0]?.rows.map((r) => r.from)], ['separate', ['2025-05']])
    assert.equal((await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05' })).status, 409)
    const ok = await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers: { steps: { [mieter.id]: { '2025-05': 12300 } } } })
    assert.equal(ok.status, 200)
    assert.deepEqual((await jsonOf<HeatingPlant>(ok)).separateSpans, [{ from: '2025-05', until: null }])
    assert.equal((await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: 'ja' })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/separate/preview', 'POST', { separate: true })).status, 404)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-weg-d.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/db/separateSettlement.ts`.

- [ ] **Step 3: Typen (`shared/types.ts`)**

Hinter `HeatingPeriodChangeAnswers`:

```ts
// Die Vorschau zum Ein- und Ausschalten der getrennten Heizkostenabrechnung (Heizung PR 5, Entwurf
// 3.1). `way`: 'separate' bei eigener Heizperiode, die kein Abrechnungszeitraum ist (Weg d), sonst
// 'samePeriod' (H = P, nur getrennter Ausweis). Einschalten: `month` ist X, `steps` jede Stufe ab X
// mit dem vorgeschlagenen Heizanteil, `overrides` die Jahreskorrekturen offener Abrechnungen mit
// Monaten ab X, `deadlines` die Fristen der getrennten Heizperioden (R-g). Ausschalten: `until` ist
// W, `keep` die Heizperioden, die getrennt bleiben, `merge` die zusammengeführte Staffel ab `month`,
// `overrides` die Jahreskorrekturen, die neu erfasst werden.
export type SeparatePreview = {
  separate: boolean
  way: 'separate' | 'samePeriod'
  month: string | null
  earliestMonth: string | null
  until: PeriodKey | null
  earliestUntil: PeriodKey | null
  share: { permille: number; source: string } | null
  steps: { tenancyId: string; tenantName: string; rows: { from: string; totalCents: number; heatingCents: number }[] }[]
  overrides: {
    tenancyId: string
    tenantName: string
    period: PeriodKey
    label: string
    cents: number | null
    asks: { kind: 'total' | 'heating' | 'provisional'; period: PeriodKey; label: string; months: string }[]
    remainder: { period: PeriodKey; label: string; months: string } | null
  }[]
  deadlines: { period: PeriodKey; label: string; deadline: string; passed: boolean }[]
  keep: { period: PeriodKey; label: string; deadline: string }[]
  merge: { tenancyId: string; tenantName: string; rows: { from: string; prepaymentCents: number }[] }[]
  blocked: string[]
}

// Die Antworten, Beträge in Cent: je Mietverhältnis und Stufe der Heizanteil (`steps`), je
// Heizperiode die Heizkorrektur (`overrides`, endgültig; bei einer Frage der Art `provisional`
// vorläufig für deren Monate), je Abrechnung P die Jahreskorrektur (`totals`; beim Einschalten
// „davon übrige“, beim Ausschalten „insgesamt“; `null` heißt keine Korrektur). `merge` false lässt
// beim Ausschalten beide Staffeln stehen.
export type SeparateAnswers = {
  steps?: Record<string, Record<string, number>>
  overrides?: Record<string, Record<string, number>>
  totals?: Record<string, Record<string, number | null>>
  merge?: boolean
}
```

- [ ] **Step 4: `server/src/db/separateSettlement.ts`**

```ts
// Getrennte Heizkostenabrechnung ein- und ausschalten, mit Vorschau (#217, Heizung PR 5, Entwurf
// 3.1, B1, C1–C4, D1, D2 der siebten und achten Fassung, R-g).
//
// **Einschalten ab X** (B1, C1–C3). Bisher steht die ganze Vorauszahlung in `prepayments`. Ab dem
// Monat X wird jede Stufe geteilt: `prepayments` Y − Z, `heating_prepayments` Z, je Monat bleibt die
// Summe Y. Vorbelegt ist Z mit dem Anteil der Heizkosten an allen Kosten der letzten Abrechnung vor
// X, auf volle Euro. X liegt nie vor dem Monat nach der letzten abgeschlossenen Abrechnung des
// Objekts (409): Deren Vorauszahlungen sind schon angerechnet. Bei eigener Heizperiode, die kein
// Abrechnungszeitraum ist, entsteht eine Spanne ab X (Weg d): Die Heizperiode, die X enthält, wird
// getrennt abgerechnet, ihre Monate vor X rechnet weiter die Abrechnung des Objekts an
// (`separateOwner`). Bei H = P gibt es keine Spanne, nur den getrennten Ausweis (A3).
//
// **Jahreskorrekturen offener Abrechnungen** mit Monaten ab X werden neu erfasst (C2, D2): „davon
// übrige“ für P, die Heizkorrektur einer beendeten Heizperiode, deren Monate ab X ganz in P liegen,
// und für eine Heizperiode, die über P hinausreicht oder noch läuft, der Restbetrag als vorläufige
// Korrektur mit ihren Monaten. Gibt es mehrere solcher Heizperioden, fragt die Vorschau für alle bis
// auf die letzte nach dem Betrag; die letzte bekommt den Rest.
//
// **Ausschalten ab W** (C4, D1): W ist der Beginn der ersten Heizperiode der Spanne, die weder
// abgeschlossen ist noch Monate in einer abgeschlossenen Abrechnung des Objekts hat. Jede
// Heizperiode davor bleibt getrennt; ein früheres W lehnt der Server ab (409). Ab W bietet die
// Vorschau an, beide Staffeln zusammenzuführen (Vorgabe); ohne das rechnet P beide an. Eine
// Jahreskorrektur einer offenen Abrechnung P, die danach Monate der Heizstaffel anrechnet, und eine
// Heizkorrektur einer Heizperiode ab W werden als Jahreskorrektur „insgesamt“ neu erfasst.
//
// Jeder Monat der Heizstaffel bleibt dabei genau einmal angerechnet (6.1 Nr. 5).

import { and, eq, gte } from 'drizzle-orm'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import {
  hasOwnRhythm, heatingPeriodsEndingIn, isObjectPeriod, monthSpanText, plantRules, separateOwner, servesUnit, settledSeparately, type PlantWay,
} from '../../../shared/heatingPeriod.ts'
import { parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod, rulesOf, settlementDeadline } from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, HeatingPlant, PeriodKey, PeriodRules, PrepaymentEntry, SeparatePreview, Tenancy } from '../../../shared/types.ts'
import type { Database, Executor } from './client.ts'
import { monthsText } from './periodChange.ts'
import { readClosedSettlements, readCostItems, readHeatingPlants, readProperties, readTenancies, readUnits } from './read.ts'
import { PeriodError } from './repository.ts'
import { closedHeatingSettlements, heatingPlants, heatingPrepaymentOverrides, heatingPrepayments, heatingSeparateSpans, prepaymentOverrides, prepayments } from './schema.ts'

type Ctx = {
  plant: HeatingPlant
  objectRules: PeriodRules
  rules: PeriodRules
  tenancies: Tenancy[]
  closedP: BillingPeriod[]
  closedH: Set<string>
  items: CostItem[]
  today: string
}

async function contextOf(db: Database, plantId: string, today: string): Promise<Ctx | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  const served = new Set((await readUnits(db)).filter((u) => u.propertyId === plant.propertyId && servesUnit(plant, u)).map((u) => u.id))
  const closedP = (await readClosedSettlements(db)).filter((c) => c.propertyId === plant.propertyId).flatMap((c) => {
    const p = periodOfKey(objectRules, c.period)
    return p ? [p] : []
  })
  const closedH = new Set((await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, plantId))).map((r) => String(r.period)))
  return {
    plant, objectRules, rules: plantRules(plant, objectRules),
    tenancies: (await readTenancies(db)).filter((t) => served.has(t.unitId)),
    closedP, closedH,
    items: (await readCostItems(db)).filter((c) => c.propertyId === plant.propertyId),
    today,
  }
}

const monthOf = (date: string): string => date.slice(0, 7)
const shiftMonth = (month: string, n: number): string => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  const year = Math.floor(index / 12)
  return `${String(year).padStart(4, '0')}-${String(index - year * 12 + 1).padStart(2, '0')}`
}
const rate = (schedule: readonly PrepaymentEntry[], month: string): number => {
  let r = 0
  for (const e of [...schedule].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) if (e.from <= month) r = e.monthlyCents
  return r
}
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: Pick<BillingPeriod, 'from' | 'to'>): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))
const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function readMonth(raw: unknown, what: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const key = parsePeriodKey(raw)
  if (key === null) throw new PeriodError(`${what}: „${String(raw)}“ ist kein Monat (JJJJ-MM).`)
  return key
}

// Die letzte abgeschlossene Abrechnung des Objekts und der erste Monat danach.
function lastClosed(c: Ctx): BillingPeriod | null {
  return c.closedP.reduce<BillingPeriod | null>((a, p) => (a === null || p.to > a.to ? p : a), null)
}
const earliestMonth = (c: Ctx): string | null => {
  const last = lastClosed(c)
  return last === null ? null : shiftMonth(monthOf(last.to), 1)
}

// Der Anteil der Heizkosten an allen Kosten der letzten Abrechnung vor X (B1), in Promille.
function lastShare(c: Ctx, x: string): { permille: number; source: string } | null {
  let p = periodContaining(c.objectRules, `${x}-01`)
  for (let i = 0; i < 3; i++) {
    p = previousPeriod(c.objectRules, p)
    const keys = new Set(hasOwnRhythm(c.plant) ? heatingPeriodsEndingIn(c.rules, p).map((h) => String(h.key)) : [String(p.key)])
    const inP = c.items.filter((it) => (it.heatingPlantId === c.plant.id ? keys.has(String(it.period)) : it.period === p.key))
    const total = inP.reduce((a, it) => a + it.amountCents, 0)
    const heating = inP.filter((it) => it.category === HEATING_CATEGORY).reduce((a, it) => a + it.amountCents, 0)
    if (total > 0 && heating > 0) return { permille: Math.round((heating * 1000) / total), source: `Abrechnung ${periodLabel(p)}: Heizkosten ${euro(heating)} von ${euro(total)}` }
  }
  return null
}

type Ask = { kind: 'total' | 'heating' | 'provisional'; period: BillingPeriod; months: string[] }
type OverrideEntry = { tenancy: Tenancy; period: BillingPeriod; cents: number | null; asks: Ask[]; remainder: { period: BillingPeriod; months: string[] } | null }
type StepEntry = { tenancy: Tenancy; first: string; rows: { from: string; totalCents: number; heatingCents: number }[] }
type MergeEntry = { tenancy: Tenancy; from: string; rows: { from: string; prepaymentCents: number }[] }
type Plan = {
  preview: SeparatePreview
  separate: boolean
  way: 'separate' | 'samePeriod'
  x: string
  steps: StepEntry[]
  overrides: OverrideEntry[]
  span: { from: string; keep: boolean } | null
  until: PeriodKey | null
  merges: MergeEntry[]
}

const outOverrides = (list: readonly OverrideEntry[]): SeparatePreview['overrides'] => list.map((e) => ({
  tenancyId: e.tenancy.id, tenantName: e.tenancy.tenantName, period: e.period.key, label: periodLabel(e.period), cents: e.cents,
  asks: e.asks.map((a) => ({ kind: a.kind, period: a.period.key, label: periodLabel(a.period), months: monthsText(a.months) })),
  remainder: e.remainder ? { period: e.remainder.period.key, label: periodLabel(e.remainder.period), months: monthsText(e.remainder.months) } : null,
}))

// Einschalten ab X.
function planOn(c: Ctx, rawMonth: unknown): Plan {
  if (c.plant.separateSpans.some((s) => s.until === null)) throw new PeriodError('Die getrennte Heizkostenabrechnung ist schon eingeschaltet.')
  const earliest = earliestMonth(c)
  const current = monthOf(periodContaining(c.rules, c.today).from)
  const x = readMonth(rawMonth, 'Beginn') ?? (earliest !== null && earliest > current ? earliest : current)
  const blocked: string[] = []
  const last = lastClosed(c)
  if (earliest !== null && last !== null && x < earliest) {
    blocked.push(`Die Vorauszahlungen bis ${monthSpanText([shiftMonth(earliest, -1)])} sind in der abgeschlossenen Abrechnung ${periodLabel(last)} angerechnet. Öffnen Sie sie wieder, wenn Sie früher beginnen wollen.`)
  }
  const lastUntil = c.plant.separateSpans.flatMap((s) => (s.until === null ? [] : [String(s.until)])).sort().pop()
  if (lastUntil !== undefined && x < lastUntil) {
    blocked.push(`Bis ${monthSpanText([shiftMonth(lastUntil, -1)])} gilt die frühere getrennte Heizkostenabrechnung. Wählen Sie einen Beginn ab ${monthSpanText([lastUntil])}.`)
  }
  const hX = periodContaining(c.rules, `${x}-01`)
  const way = hasOwnRhythm(c.plant) && !isObjectPeriod(c.objectRules, hX) ? 'separate' : 'samePeriod'
  const next: PlantWay = way === 'separate' ? { ...c.plant, separateSpans: [...c.plant.separateSpans, { from: x, until: null }] } : c.plant
  const share = lastShare(c, x)

  const steps: StepEntry[] = c.tenancies.filter((t) => !(t.end !== null && t.end < `${x}-01`)).map((t) => {
    const first = monthOf(t.start) > x ? monthOf(t.start) : x
    const heat = t.heatingPrepayments ?? []
    const bounds = [...new Set([first, ...t.prepayments.map((e) => e.from), ...heat.map((e) => e.from)])].filter((b) => b >= first).sort()
    return {
      tenancy: t, first,
      rows: bounds.map((from) => {
        const total = rate(t.prepayments, from) + rate(heat, from)
        return { from, totalCents: total, heatingCents: share ? Math.round((total * share.permille) / 1000 / 100) * 100 : rate(heat, from) }
      }),
    }
  })

  const overrides: OverrideEntry[] = way !== 'separate' ? [] : c.tenancies.flatMap((t) => Object.entries(t.prepaymentOverrides).flatMap(([schluessel, cents]): OverrideEntry[] => {
    const key = parsePeriodKey(schluessel)
    const p = key === null ? null : periodOfKey(c.objectRules, key)
    if (p === null || c.closedP.some((q) => q.key === p.key)) return []
    const after = activeMonths(t, p).filter((m) => m >= x)
    const first = after[0]
    if (first === undefined) return []
    const asks: Ask[] = [{ kind: 'total', period: p, months: activeMonths(t, p) }]
    const open: { period: BillingPeriod; months: string[] }[] = []
    for (const h of periodsBetween(c.rules, `${first}-01`, p.to)) {
      const months = after.filter((m) => separateOwner(next, c.objectRules, m)?.key === h.key)
      if (months.length === 0) continue
      const inside = periodMonths(h).filter((m) => m >= x).every((m) => m >= monthOf(p.from) && m <= monthOf(p.to))
      if (h.to < c.today && inside) asks.push({ kind: 'heating', period: h, months })
      else open.push({ period: h, months })
    }
    const remainder = open.pop() ?? null
    for (const o of open) asks.push({ kind: 'provisional', ...o })
    return [{ tenancy: t, period: p, cents, asks, remainder }]
  }))

  const reach = c.today > hX.to ? c.today : hX.to
  const deadlines = way !== 'separate' ? [] : periodsBetween(c.rules, hX.from, reach)
    .filter((h) => settledSeparately(next, c.objectRules, h))
    .map((h) => {
      const deadline = settlementDeadline(h)
      return { period: h.key, label: periodLabel(h), deadline, passed: c.today > deadline }
    })

  const preview: SeparatePreview = {
    separate: true, way, month: x, earliestMonth: earliest, until: null, earliestUntil: null, share,
    steps: steps.map((s) => ({ tenancyId: s.tenancy.id, tenantName: s.tenancy.tenantName, rows: s.rows })),
    overrides: outOverrides(overrides), deadlines, keep: [], merge: [], blocked,
  }
  return { preview, separate: true, way, x, steps, overrides, span: null, until: null, merges: [] }
}

// Ausschalten ab W (Weg d) bzw. Ende der getrennten Vorauszahlung (H = P).
function planOff(c: Ctx, rawUntil: unknown, rawMonth: unknown): Plan {
  const span = c.plant.separateSpans.find((s) => s.until === null)
  const blocked: string[] = []
  const mergesFrom = (from: string): MergeEntry[] => c.tenancies.flatMap((t) => {
    const heat = t.heatingPrepayments ?? []
    if (heat.length === 0 || (t.end !== null && t.end < `${from}-01`)) return []
    const bounds = [...new Set([from, ...t.prepayments.map((e) => e.from), ...heat.map((e) => e.from)])].filter((b) => b >= from).sort()
    return [{ tenancy: t, from, rows: bounds.map((b) => ({ from: b, prepaymentCents: rate(t.prepayments, b) + rate(heat, b) })) }]
  })
  const out = (way: 'separate' | 'samePeriod', month: string, until: PeriodKey | null, earliestUntil: PeriodKey | null, keep: SeparatePreview['keep'], overrides: OverrideEntry[], merges: MergeEntry[], spanPlan: Plan['span']): Plan => ({
    preview: {
      separate: false, way, month, earliestMonth: earliestMonth(c), until, earliestUntil, share: null, steps: [],
      overrides: outOverrides(overrides), deadlines: [], keep,
      merge: merges.map((m) => ({ tenancyId: m.tenancy.id, tenantName: m.tenancy.tenantName, rows: m.rows })), blocked,
    },
    separate: false, way, x: month, steps: [], overrides, span: spanPlan, until, merges,
  })

  if (!span) {
    if (c.plant.separateSettlement !== true) throw new PeriodError('Die getrennte Heizkostenabrechnung ist schon ausgeschaltet.')
    // H = P: Angerechnet wird wie bisher in P; es endet nur der getrennte Ausweis.
    const earliest = earliestMonth(c)
    const current = monthOf(periodContaining(c.objectRules, c.today).from)
    const from = readMonth(rawMonth, 'Zusammenführen ab') ?? (earliest !== null && earliest > current ? earliest : current)
    if (earliest !== null && from < earliest) blocked.push(`Bis ${monthSpanText([shiftMonth(earliest, -1)])} sind die Vorauszahlungen abgeschlossen angerechnet; führen Sie die Staffeln ab ${monthSpanText([earliest])} zusammen.`)
    return out('samePeriod', from, null, null, [], [], mergesFrom(from), null)
  }

  const horizon = `${Number(c.today.slice(0, 4)) + 3}-12-31`
  const candidates = periodsBetween(c.rules, `${span.from}-01`, horizon).filter((h) => monthOf(h.to) >= span.from)
  const reason = (h: BillingPeriod): string | null => {
    if (c.closedH.has(h.key)) return `Die Heizkostenabrechnung ${periodLabel(h)} ist abgeschlossen.`
    const p = c.closedP.find((q) => q.from <= h.to && q.to >= h.from)
    return p ? `Die Heizperiode ${periodLabel(h)} hat Monate in der abgeschlossenen Abrechnung ${periodLabel(p)}.` : null
  }
  const w = candidates.find((h) => reason(h) === null) ?? candidates[candidates.length - 1]
  if (w === undefined) throw new Error('Spanne ohne Heizperiode')
  const untilText = readMonth(rawUntil, 'Ende')
  const until = untilText === null ? w : periodOfKey(c.rules, parsePeriodKey(untilText) ?? w.key)
  if (until === null) throw new PeriodError(`Eine Heizperiode, die im ${monthSpanText([untilText ?? ''])} beginnt, gibt es für die Heizanlage nicht.`)
  if (until.key < w.key) {
    blocked.push(...candidates.filter((h) => h.key >= until.key && h.key < w.key).flatMap((h) => {
      const r = reason(h)
      return r === null ? [] : [r]
    }))
    blocked.push('Sie bleiben eigene Heizkostenabrechnungen; öffnen Sie die Abrechnung wieder, wenn das Ausschalten früher wirken soll.')
  }
  const keep = candidates.filter((h) => h.key < until.key && settledSeparately(c.plant, c.objectRules, h))
  const next: PlantWay = { ...c.plant, separateSpans: c.plant.separateSpans.map((s) => (s === span ? { ...s, until: until.key } : s)) }
  const ownerChanges = (m: string): boolean => separateOwner(c.plant, c.objectRules, m)?.key !== separateOwner(next, c.objectRules, m)?.key
  const overrides: OverrideEntry[] = c.tenancies.flatMap((t) => {
    const deleted = (t.heatingPrepaymentOverrides ?? []).filter((o) => o.plantId === c.plant.id && o.period >= until.key)
    return periodsBetween(c.objectRules, until.from, horizon).flatMap((p): OverrideEntry[] => {
      if (c.closedP.some((q) => q.key === p.key)) return []
      const months = activeMonths(t, p)
      if (!months.some(ownerChanges)) return []
      const had = t.prepaymentOverrides[p.key]
      const touched = deleted.some((o) => {
        const h = periodOfKey(c.rules, o.period)
        return h !== null && months.some((m) => periodMonths(h).includes(m))
      })
      if (had === undefined && !touched) return []
      return [{ tenancy: t, period: p, cents: had ?? null, asks: [{ kind: 'total', period: p, months }], remainder: null }]
    })
  })
  return out('separate', until.key, until.key, w.key,
    keep.map((h) => ({ period: h.key, label: periodLabel(h), deadline: settlementDeadline(h) })),
    overrides, mergesFrom(until.key), { from: span.from, keep: keep.length > 0 })
}

async function plan(db: Database, plantId: string, body: unknown, today: string): Promise<Plan | null> {
  const c = await contextOf(db, plantId, today)
  if (c === null) return null
  const b = objectOr(body)
  if (typeof b.separate !== 'boolean') throw new PeriodError('Bitte geben Sie an, ob die Heizkosten getrennt abgerechnet werden (ja oder nein).')
  return b.separate ? planOn(c, b.month) : planOff(c, b.until, b.month)
}

export async function previewSeparate(db: Database, plantId: string, body: unknown, today: string): Promise<SeparatePreview | null> {
  return (await plan(db, plantId, body, today))?.preview ?? null
}

// Eine Staffel ab einem Monat ersetzen: Einträge davor bleiben, ab dort gelten die neuen.
async function writeSchedule(tx: Executor, table: typeof prepayments | typeof heatingPrepayments, t: Tenancy, keep: readonly PrepaymentEntry[], rows: readonly PrepaymentEntry[]): Promise<void> {
  await tx.delete(table).where(eq(table.tenancyId, t.id))
  const all = [...keep, ...rows]
  if (all.length > 0) await tx.insert(table).values(all.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
}

async function setTotal(tx: Executor, tenancyId: string, period: PeriodKey, cents: number | null): Promise<void> {
  await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, tenancyId), eq(prepaymentOverrides.period, period)))
  if (cents !== null) await tx.insert(prepaymentOverrides).values({ tenancyId, period, amountCents: cents })
}

async function setHeating(tx: Executor, tenancyId: string, plantId: string, period: PeriodKey, cents: number, months: readonly string[] | null): Promise<void> {
  await tx.delete(heatingPrepaymentOverrides)
    .where(and(eq(heatingPrepaymentOverrides.tenancyId, tenancyId), eq(heatingPrepaymentOverrides.plantId, plantId), eq(heatingPrepaymentOverrides.period, period)))
  await tx.insert(heatingPrepaymentOverrides).values({
    tenancyId, plantId, period, cents, provisional: months !== null, fromMonth: months?.[0] ?? null, toMonth: months?.[months.length - 1] ?? null,
  })
}

export async function applySeparate(db: Database, plantId: string, body: unknown, today: string): Promise<{ plant: HeatingPlant } | { error: string; preview: SeparatePreview } | null> {
  const p = await plan(db, plantId, body, today)
  if (p === null) return null
  if (p.preview.blocked.length > 0) return { error: `${p.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: p.preview }
  const answers = objectOr(objectOr(body).answers)
  const stepAnswers = objectOr(answers.steps)
  const overrideAnswers = objectOr(answers.overrides)
  const totalAnswers = objectOr(answers.totals)
  const missing: string[] = []
  for (const s of p.steps) {
    const given = objectOr(stepAnswers[s.tenancy.id])
    for (const row of s.rows) {
      const v = given[row.from]
      if (!isCents(v) || v > row.totalCents) missing.push(`${s.tenancy.tenantName}: Heizanteil ab ${monthsText([row.from])} eintragen (0 bis ${euro(row.totalCents)}).`)
    }
  }
  const rests = new Map<OverrideEntry, number>()
  for (const e of p.overrides) {
    const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
    const heating = objectOr(overrideAnswers[e.tenancy.id])
    if (p.separate ? !isCents(total) : !(total === null || isCents(total))) {
      missing.push(p.separate
        ? `${e.tenancy.tenantName}: tatsächlich gezahlte übrige Vorauszahlungen ${periodLabel(e.period)} eintragen (ohne Heizvorauszahlung ab ${monthsText([p.x])}).`
        : `${e.tenancy.tenantName}: tatsächlich gezahlte Vorauszahlungen insgesamt ${periodLabel(e.period)} eintragen (oder „keine Korrektur“).`)
      continue
    }
    let used = isCents(total) ? total : 0
    for (const a of e.asks) {
      if (a.kind === 'total') continue
      const v = heating[a.period.key]
      if (!isCents(v)) missing.push(`${e.tenancy.tenantName}: Heizvorauszahlung ${periodLabel(a.period)} (${monthsText(a.months)}) eintragen.`)
      else used += v
    }
    if (e.remainder && e.cents !== null) {
      const rest = e.cents - used
      if (rest < 0) missing.push(`Die Beträge für ${e.tenancy.tenantName} übersteigen die Jahreskorrektur ${periodLabel(e.period)} (${euro(e.cents)}).`)
      else rests.set(e, rest)
    }
  }
  if (missing.length > 0) return { error: `Es fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: p.preview }

  await db.transaction(async (tx) => {
    await tx.update(heatingPlants).set({ separateSettlement: p.separate }).where(eq(heatingPlants.id, plantId))
    if (p.separate) {
      if (p.way === 'separate') await tx.insert(heatingSeparateSpans).values({ plantId, from: p.x, until: null })
      for (const s of p.steps) {
        const given = objectOr(stepAnswers[s.tenancy.id])
        const z = (from: string): number => {
          const v = given[from]
          return isCents(v) ? v : 0
        }
        await writeSchedule(tx, prepayments, s.tenancy, s.tenancy.prepayments.filter((e) => e.from < s.first), s.rows.map((r) => ({ from: r.from, monthlyCents: r.totalCents - z(r.from) })))
        await writeSchedule(tx, heatingPrepayments, s.tenancy, (s.tenancy.heatingPrepayments ?? []).filter((e) => e.from < s.first), s.rows.map((r) => ({ from: r.from, monthlyCents: z(r.from) })))
      }
      for (const e of p.overrides) {
        const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
        await setTotal(tx, e.tenancy.id, e.period.key, isCents(total) ? total : null)
        const heating = objectOr(overrideAnswers[e.tenancy.id])
        for (const a of e.asks) {
          const v = heating[a.period.key]
          if (a.kind !== 'total' && isCents(v)) await setHeating(tx, e.tenancy.id, plantId, a.period.key, v, a.kind === 'provisional' ? a.months : null)
        }
        const rest = rests.get(e)
        if (e.remainder && rest !== undefined) await setHeating(tx, e.tenancy.id, plantId, e.remainder.period.key, rest, e.remainder.months)
      }
    } else {
      if (p.span && p.until) {
        if (p.span.keep) await tx.update(heatingSeparateSpans).set({ until: p.until }).where(and(eq(heatingSeparateSpans.plantId, plantId), eq(heatingSeparateSpans.from, p.span.from)))
        else await tx.delete(heatingSeparateSpans).where(and(eq(heatingSeparateSpans.plantId, plantId), eq(heatingSeparateSpans.from, p.span.from)))
        await tx.delete(heatingPrepaymentOverrides).where(and(eq(heatingPrepaymentOverrides.plantId, plantId), gte(heatingPrepaymentOverrides.period, p.until)))
      }
      for (const e of p.overrides) {
        const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
        await setTotal(tx, e.tenancy.id, e.period.key, isCents(total) ? total : null)
      }
      if (answers.merge !== false) {
        for (const m of p.merges) {
          const heat = m.tenancy.heatingPrepayments ?? []
          const before = heat.filter((e) => e.from < m.from)
          await writeSchedule(tx, prepayments, m.tenancy, m.tenancy.prepayments.filter((e) => e.from < m.from), m.rows.map((r) => ({ from: r.from, monthlyCents: r.prepaymentCents })))
          await writeSchedule(tx, heatingPrepayments, m.tenancy, before, before.length > 0 && rate(heat, m.from) > 0 ? [{ from: m.from, monthlyCents: 0 }] : [])
        }
      }
    }
  })
  const plant = (await readHeatingPlants(db)).find((x) => x.id === plantId)
  return plant ? { plant } : null
}
```

- [ ] **Step 5: Routen (`server/src/index.ts`)**

Import `applySeparate, previewSeparate` aus `'./db/separateSettlement.ts'`. Hinter den Routen aus
Task 4:

```ts
// Getrennte Heizkostenabrechnung ein- und ausschalten (Heizung PR 5, Entwurf 3.1): Vorschau, dann
// Speichern mit den Antworten in einer Transaktion. Begründung in db/separateSettlement.ts.
app.post('/api/heating-plants/:id/separate/preview', async (req, res) => {
  const preview = await readData((db) => previewSeparate(db, req.params.id, bodyObject(req), today()))
  if (!preview) return res.status(404).json({ error: PLANT_GONE_TEXT })
  res.json(preview)
})
app.put('/api/heating-plants/:id/separate', async (req, res) => {
  const result = await writeData((db) => applySeparate(db, req.params.id, bodyObject(req), today()))
  if (!result) return res.status(404).json({ error: PLANT_GONE_TEXT })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.plant)
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-weg-d.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Getrennte Heizkostenabrechnung" && npm run typecheck`
Expected: PASS (db-weg-d 10 Tests, api 1).

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/separateSettlement.ts server/src/index.ts server/test/db-weg-d.test.ts server/test/api.test.ts
git commit -m "Heizperiode: getrennte Heizkostenabrechnung ein- und ausschalten mit Vorschau

Einschalten ab X teilt jede Stufe, erfasst Jahreskorrekturen neu (Restbetrag vorläufig), nennt die
Fristen; Ausschalten wirkt ab W und führt die Staffeln auf Wunsch zusammen.

Refs #217"
```

---
### Task 9: Heizkostenabrechnung abschließen, Routen, Steuer

Entwurf 3.1 (B3), 3.10, 6.1 Nr. 7: Je getrennt abgerechneter Heizperiode eine Route zum Rechnen und
zum Abschließen in `closed_heating_settlements` samt Verlauf (#56), eine Liste für Cockpit und
Abrechnungsseite. Der Abschluss von P friert die Heizkostenabrechnung nicht ein. Die Steuerübersicht
nimmt die Heizpositionen einer eigenen Heizperiode mit (nach Weg b aus der Abrechnung P, nach Weg d
aus der Heizkostenabrechnung, beide mit ihrem Eigenanteil) und nennt bei Weg d keine Vorauszahlung
der Abrechnung.

**Files:**
- Create: `server/src/db/heatingSettlements.ts`
- Modify: `shared/types.ts`, `server/src/index.ts`, `server/src/calc.ts`
- Test: `server/test/api.test.ts`, `server/test/calc-steuer-heizperiode.test.ts` (neu)

**Interfaces:**
- Consumes: `heatingSnapshotFor`, `wayOf` (Task 5, 7); `plantRules`, `settledSeparately` (Task 2); `readClosedHeatingSettlements`, `StoredClosedHeatingSettlement` (Task 3); aus PR 2/3 `SettlementHistoryEntry`, `compareWithFrozen`, `sentAtOf`, `SENT_AT_INVALID`, `RouteProblem`, `propertyOf`, `readStock`, `taxPartsFor`, `taxReport`, `TaxPart`, `taxYearOf`.
- Produces:
  - `type HeatingSettlementInfo = SeparateHeatingRef & { closed: { closedAt: string; sentAt: string | null } | null }` (`shared/types.ts`)
  - `heatingSettlements.ts`: `findClosedHeatingSettlement(db, plantId, period): Promise<StoredClosedHeatingSettlement | undefined>`, `closeHeatingSettlement(db, entry: { id: string; plantId: string; period: PeriodKey; closedAt: string; sentAt: string | null; settlement: unknown }): Promise<void>`, `setHeatingSentAt(db, plantId, period, sentAt): Promise<boolean>`, `reopenHeatingSettlement(db, plantId, period, historyId): Promise<boolean>`, `heatingSettlementHistory(db, plantId, period): Promise<SettlementHistoryEntry[]>`, `separateHeatingSettlements(db, propertyId, today): Promise<HeatingSettlementInfo[]>`
  - Routen `GET /api/heating-settlements?property=`, `GET /api/heating-settlement/:plant/:period`, `POST|PUT|DELETE /api/heating-settlement/:plant/:period/close`, `GET /api/heating-settlement/:plant/:period/history`

- [ ] **Step 1: Write the failing tests**

`server/test/calc-steuer-heizperiode.test.ts`:

```ts
// Steuerübersicht mit eigener Heizperiode (Heizung PR 5, Entwurf 3.10): Jahr der Zahlung je
// Position, Eigenanteil aus der Abrechnung, in der die Position steht (Weg b: P, Weg d: die
// Heizkostenabrechnung), keine Vorauszahlung der Abrechnung bei Weg d.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReportFor } from '../src/calc.ts'
import type { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]

const haus = (separateSpans: SeparateSpan[]): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [
    { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: false, selfUsed: true, selfPersons: 1 },
  ],
  tenancies: [{
    id: 'A', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 30000 }], prepaymentOverrides: {}, baseRents: [],
  }],
  costItems: [
    { id: 'heizung', propertyId: 'objekt-1', period: periodKey('2025-05'), category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 150000, key: 'area', heatingPlantId: 'hp1', taxYear: 2026 },
    { id: 'grundsteuer', propertyId: 'objekt-1', period: periodKey('2026-01'), category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 50000, key: 'area' },
  ],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [{
    id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown',
    units: null, periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: separateSpans.length > 0,
  }],
} as Source)

test('Weg b: Die Heizposition 2025/2026 zählt im Jahr ihrer Zahlung, der Eigenanteil aus der Abrechnung 2026', () => {
  const r2026 = taxReportFor(haus([]), 'objekt-1', 2026)
  const heizung = r2026.expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail('Heizposition fehlt')
  assert.equal(heizung.privateCents, 60000, '40 von 100 m² selbstgenutzt')
  assert.deepEqual(r2026.settlementPeriods.map((p) => p.label), ['2026'])
  assert.notEqual(r2026.income.prepaymentSettlementCents, null)
  assert.equal(taxReportFor(haus([]), 'objekt-1', 2025).expenses.items.some((i) => i.costItemId === 'heizung'), false)
})

test('Weg d: Die Heizposition kommt aus der Heizkostenabrechnung, die Vorauszahlung der Abrechnung entfällt', () => {
  const r2026 = taxReportFor(haus([{ from: '2025-05', until: null }]), 'objekt-1', 2026)
  const heizung = r2026.expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail('Heizposition fehlt')
  assert.equal(heizung.privateCents, 60000)
  assert.deepEqual(r2026.settlementPeriods.map((p) => p.label), ['2026', 'Heizkosten 2025/2026'])
  assert.equal(r2026.income.prepaymentSettlementCents, null)
  assert.ok(r2026.expenses.items.some((i) => i.costItemId === 'grundsteuer'))
})
```

An `server/test/api.test.ts` anhängen:

```ts
test('Heizkostenabrechnung (Heizung PR 5): rechnen, eigene Frist, abschließen; der Abschluss von P friert sie nicht ein', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body?: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: {} })
    await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers: { steps: { [mieter.id]: { '2025-05': 12300 } } } })
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 }) })
    const url = `/api/heating-settlement/${plant.id}/2025-05`
    const h = await s.api<Settlement>(url)
    assert.deepEqual([h.deadline, h.scope?.kind, h.statements[0]?.scope, h.statements[0]?.prepaymentCents, h.closed], ['2027-04-30', 'heating', 'heating', 147600, null])
    const liste = await s.api<{ period: { key: string }; deadline: string; closed: unknown }[]>('/api/heating-settlements')
    // Die Liste reicht bis zur Heizperiode, die heute läuft; geprüft werden die ersten beiden.
    assert.deepEqual(liste.slice(0, 2).map((x) => [x.period.key, x.deadline, x.closed]), [['2025-05', '2027-04-30', null], ['2026-05', '2028-04-30', null]])
    const nichtGetrennt = await send(`/api/heating-settlement/${plant.id}/2024-05`, 'GET')
    assert.equal(nichtGetrennt.status, 404)
    assert.match(await errorFrom(nichtGetrennt), /stehen in der Betriebskostenabrechnung 2025/)
    // B3: Der Abschluss von P 2026 friert die Heizkostenabrechnung nicht ein.
    assert.equal((await send('/api/settlement/2026/close', 'POST', {})).status, 201)
    assert.equal((await s.api<Settlement>(url)).closed, null)
    assert.equal((await send(`${url}/close`, 'POST', {})).status, 201)
    assert.equal((await send(`${url}/close`, 'POST', {})).status, 409)
    assert.equal((await send(`${url}/close`, 'PUT', { sentAt: '2027-03-01' })).status, 200)
    assert.deepEqual((await s.api<Settlement>(url)).closed?.sentAt, '2027-03-01')
    assert.equal((await send(`/api/heating-plants/${plant.id}`, 'DELETE')).status, 409)
    assert.equal((await send(`${url}/close`, 'DELETE')).status, 200)
    assert.equal((await s.api<unknown[]>(`${url}/history`)).length, 1)
  } finally {
    s.stop()
  }
})
```

(`Settlement`, `HeatingPlant`, `jsonOf` und `errorFrom` stehen seit PR 2 und PR 4 im Import von
api.test.ts; sonst ergänzen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-steuer-heizperiode.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Heizkostenabrechnung"`
Expected: FAIL. Die Steuerübersicht kennt die Heizposition nicht (sie steht in keinem Teil), und
`GET /api/heating-settlement/…` antwortet 404 ohne Route.

- [ ] **Step 3: Typ (`shared/types.ts`)**

Hinter `HeatingScopeRef`:

```ts
// Eine Heizkostenabrechnung nach Weg d in der Liste für Cockpit und Abrechnungsseite (Heizung PR 5).
export type HeatingSettlementInfo = SeparateHeatingRef & { closed: { closedAt: string; sentAt: string | null } | null }
```

- [ ] **Step 4: `server/src/db/heatingSettlements.ts`**

```ts
// Die Heizkostenabrechnungen nach Weg d (Heizung PR 5, Entwurf 3.1, B3): Abschluss, Versanddatum,
// Wiederöffnen und Verlauf (#56), wie bei den Abrechnungen des Objekts in repository.ts, aber in
// eigenen Tabellen. Der Abschluss einer Abrechnung des Objekts friert eine Heizkostenabrechnung nie
// mit ein, denn sie hat ihre eigene Frist.

import { and, desc, eq, sql } from 'drizzle-orm'
import { plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import { periodsBetween, rulesOf, settlementDeadline, settlementPeriod } from '../../../shared/period.ts'
import type { HeatingSettlementInfo, PeriodKey } from '../../../shared/types.ts'
import type { Database } from './client.ts'
import { readClosedHeatingSettlements, readHeatingPlants, readProperties, type StoredClosedHeatingSettlement } from './read.ts'
import type { SettlementHistoryEntry } from './repository.ts'
import { closedHeatingSettlementHistory, closedHeatingSettlements } from './schema.ts'

const closedOf = (plantId: string, period: PeriodKey) =>
  and(eq(closedHeatingSettlements.plantId, plantId), eq(closedHeatingSettlements.period, period))

export async function findClosedHeatingSettlement(db: Database, plantId: string, period: PeriodKey): Promise<StoredClosedHeatingSettlement | undefined> {
  return (await readClosedHeatingSettlements(db)).find((c) => c.plantId === plantId && c.period === period)
}

export async function closeHeatingSettlement(
  db: Database,
  entry: { id: string, plantId: string, period: PeriodKey, closedAt: string, sentAt: string | null, settlement: unknown },
): Promise<void> {
  await db.insert(closedHeatingSettlements).values(entry)
}

export async function setHeatingSentAt(db: Database, plantId: string, period: PeriodKey, sentAt: string | null): Promise<boolean> {
  if (!(await findClosedHeatingSettlement(db, plantId, period))) return false
  await db.update(closedHeatingSettlements).set({ sentAt }).where(closedOf(plantId, period))
  return true
}

export async function reopenHeatingSettlement(db: Database, plantId: string, period: PeriodKey, historyId: string): Promise<boolean> {
  const eintrag = await findClosedHeatingSettlement(db, plantId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedHeatingSettlementHistory).values({
      id: historyId, plantId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedHeatingSettlements).where(closedOf(plantId, period))
  })
  return true
}

export async function heatingSettlementHistory(db: Database, plantId: string, period: PeriodKey): Promise<SettlementHistoryEntry[]> {
  const rows = await db
    .select()
    .from(closedHeatingSettlementHistory)
    .where(and(eq(closedHeatingSettlementHistory.plantId, plantId), eq(closedHeatingSettlementHistory.period, period)))
    .orderBy(desc(closedHeatingSettlementHistory.reopenedAt), desc(sql`rowid`))
  return rows.map((r) => ({ id: r.id, closedAt: r.closedAt, sentAt: r.sentAt, reopenedAt: r.reopenedAt, settlement: r.settlement }))
}

// Die Heizkostenabrechnungen eines Objekts nach Weg d, von der ersten Spanne bis zur Heizperiode, die
// heute läuft, mit Frist und Abschluss. Das Cockpit führt jede mit ihrer eigenen Frist (3.1).
export async function separateHeatingSettlements(db: Database, propertyId: string, today: string): Promise<HeatingSettlementInfo[]> {
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === propertyId))
  const closed = await readClosedHeatingSettlements(db)
  const result: HeatingSettlementInfo[] = []
  for (const plant of (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)) {
    const first = plant.separateSpans[0]
    if (plant.periodStartMonth === null || first === undefined) continue
    for (const h of periodsBetween(plantRules(plant, objectRules), `${first.from}-01`, today)) {
      if (!settledSeparately(plant, objectRules, h)) continue
      const c = closed.find((x) => x.plantId === plant.id && x.period === h.key)
      result.push({
        plantId: plant.id, plantName: plant.name, period: settlementPeriod(h), deadline: settlementDeadline(h),
        closed: c ? { closedAt: c.closedAt, sentAt: c.sentAt } : null,
      })
    }
  }
  return result
}
```

- [ ] **Step 5: Routen (`server/src/index.ts`)**

Importe: aus `'./db/heatingSettlements.ts'` alle sechs Funktionen; `heatingSnapshotFor` aus
`'./snapshot.ts'`; `plantRules, settledSeparately` aus `'../../shared/heatingPeriod.ts'`;
`parsePeriodKey, periodContaining, periodOfKey` aus `'../../shared/period.ts'` (soweit nicht da);
`readHeatingPlants`, `type Stock` aus `'./db/read.ts'`; die Typen `BillingPeriod, HeatingPlant`.

Hinter den Routen `/api/settlement/:period…`:

```ts
// ---------- Heizkostenabrechnung nach Weg d (Heizung PR 5, Entwurf 3.1, 6.1 Nr. 7, B3) ----------
// Je Anlage und getrennt abgerechneter Heizperiode eine eigene Abrechnung mit eigener Frist und
// eigenem Abschluss. Eine Heizperiode, die in der Betriebskostenabrechnung steht, hat keine; die
// Antwort sagt dann, wo ihre Heizkosten stehen.
async function heatingTargetOf(db: Database, req: Request): Promise<{ plant: HeatingPlant, period: BillingPeriod }> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === req.params.plant)
  if (!plant) throw new RouteProblem(404, PLANT_GONE_TEXT)
  const objectRules = rulesOf((await listProperties(db)).find((p) => p.id === plant.propertyId))
  const key = parsePeriodKey(String(req.params.period ?? ''))
  const period = key === null ? null : periodOfKey(plantRules(plant, objectRules), key)
  if (period === null) throw new RouteProblem(404, 'Diese Heizperiode gibt es für die Heizanlage nicht.')
  if (!settledSeparately(plant, objectRules, period)) {
    throw new RouteProblem(404,
      `Die Heizkosten ${periodLabel(period)} stehen in der Betriebskostenabrechnung ${periodLabel(periodContaining(objectRules, period.to))}; eine eigene Heizkostenabrechnung gibt es dafür nicht.`)
  }
  return { plant, period }
}

function computeHeating(stock: Stock, plant: HeatingPlant, period: BillingPeriod): ComputedSettlement {
  const snapshot = heatingSnapshotFor(stock, plant.propertyId, plant.id, period)
  if (!snapshot) throw new RouteProblem(404, PLANT_GONE_TEXT)
  return computeSettlement(snapshot, { asOf: today() })
}

app.get('/api/heating-settlements', async (req, res) => {
  res.json(await readData(async (db) => separateHeatingSettlements(db, await propertyOf(db, req), today())))
})

app.get('/api/heating-settlement/:plant/:period', async (req, res) => {
  const { target, closed, stock } = await readData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return { target, closed: await findClosedHeatingSettlement(db, target.plant.id, target.period.key), stock: await readStock(db) }
  })
  const frame = {
    period: settlementPeriod(target.period),
    deadline: settlementDeadline(target.period),
    scope: { kind: 'heating' as const, plantId: target.plant.id, plantName: target.plant.name },
  }
  if (closed) {
    const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
    const deviation = compareWithFrozen(closed.settlement, () => computeHeating(stock, target.plant, target.period), frame.deadline, today())
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation })
  }
  res.json({ ...computeHeating(stock, target.plant, target.period), closed: null })
})

app.post('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  // Rechnen und Einfrieren im selben Vorgang, wie bei der Abrechnung des Objekts.
  const ergebnis = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    const label = periodLabel(target.period)
    if (await findClosedHeatingSettlement(db, target.plant.id, target.period.key)) return { schonDa: true, label }
    await closeHeatingSettlement(db, {
      id: newId(), plantId: target.plant.id, period: target.period.key, closedAt: new Date().toISOString(), sentAt,
      settlement: computeHeating(await readStock(db), target.plant, target.period),
    })
    return { schonDa: false, label }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Die Heizkostenabrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  res.status(201).json({ ok: true })
})

app.put('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const gefunden = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return setHeatingSentAt(db, target.plant.id, target.period.key, sentAt)
  })
  if (!gefunden) return res.status(404).json({ error: 'Die Heizkostenabrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

app.get('/api/heating-settlement/:plant/:period/history', async (req, res) => {
  res.json(await readData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return heatingSettlementHistory(db, target.plant.id, target.period.key)
  }))
})

app.delete('/api/heating-settlement/:plant/:period/close', async (req, res) => {
  const gefunden = await writeData(async (db) => {
    const target = await heatingTargetOf(db, req)
    return reopenHeatingSettlement(db, target.plant.id, target.period.key, newId())
  })
  if (!gefunden) return res.status(404).json({ error: 'Die Heizkostenabrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})
```

- [ ] **Step 6: Steuer (`server/src/calc.ts`)**

Importe: `heatingSnapshotFor, wayOf` aus `'./snapshot.ts'`; `plantRules, settledSeparately` aus
`'../../shared/heatingPeriod.ts'` (soweit nicht da).

`taxPartsFor` (PR 3) ersetzen:

```ts
// Die Teile der Steuerübersicht eines Objekts mit eigenem Rhythmus oder eigener Heizperiode (#208,
// Heizung PR 5, Entwurf 3.10): jeder Abrechnungszeitraum, der das Jahr oder das Vorjahr berührt, mit
// seinen Positionen, deren Jahr der Zahlung dieses Jahr ist, dazu die Heizpositionen der
// Heizperioden, die er nach Weg b aufnimmt (ihr Jahr der Zahlung richtet sich nach ihrer
// Heizperiode). Jede Heizkostenabrechnung nach Weg d ist ein eigener Teil; den Eigenanteil liefert
// dann sie. `null` beim Kalenderobjekt ohne eigene Heizperiode: Dort rechnet `taxReport` wie bisher.
export function taxPartsFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxPart[] | null {
  const rules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  const ownPlants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId && (p.periodStartMonth ?? null) !== null)
  if (isCalendarRules(rules) && ownPlants.length === 0) return null
  const jahr = calendarYearPeriod(year)
  const vorjahr = calendarYearPeriod(year - 1)
  const parts: TaxPart[] = periodsBetween(rules, vorjahr.from, jahr.to).flatMap((p) => {
    const snap = snapshotFor(source, propertyId, p)
    const items = [
      ...snap.costItems.filter((c) => taxYearOf(c, p) === year),
      ...(snap.heatingParts ?? []).filter((x) => !x.separate).flatMap((x) => x.items.filter((c) => taxYearOf(c, x.period) === year)),
    ]
    const touches = p.from <= jahr.to && p.to >= jahr.from
    return items.length > 0 || touches ? [{ snapshot: snap, items }] : []
  })
  const separate: TaxPart[] = ownPlants.flatMap((plant) => {
    const way = wayOf(plant)
    return periodsBetween(plantRules(way, rules), vorjahr.from, jahr.to).flatMap((h) => {
      if (!settledSeparately(way, rules, h)) return []
      const snap = heatingSnapshotFor(source, propertyId, plant.id, h)
      if (!snap) return []
      const items = snap.costItems.filter((c) => taxYearOf(c, h) === year)
      return items.length > 0 ? [{ snapshot: snap, items }] : []
    })
  })
  return [...parts, ...separate]
}
```

In `taxReport` (Fassung von PR 3):

- die Zeile `const same = settled.find(({ part }) => part.snapshot.period.from === calendar.from && part.snapshot.period.to === calendar.to)` ersetzen durch

```ts
  // Eine Heizkostenabrechnung nach Weg d ist kein Abrechnungszeitraum des Objekts. Gibt es eine,
  // gibt es für die Vorauszahlungen der Abrechnung keine einzelne Zahl mehr (Entwurf 3.10): `null`.
  const separateHeating = used.some((p) => p.snapshot.scope?.kind === 'heating')
  const same = separateHeating ? undefined
    : settled.find(({ part }) => part.snapshot.scope === undefined && part.snapshot.period.from === calendar.from && part.snapshot.period.to === calendar.to)
```

- in `settlementPeriods: used.map(…)` das `label` ersetzen durch
  `label: p.snapshot.scope?.kind === 'heating' ? \`Heizkosten ${periodLabel(p.snapshot.period)}\` : periodLabel(p.snapshot.period)`.

`prepaymentSettlementCents`, `prepaymentOverridden` und `selfUsedShareCents` lesen `same`; mit
`same === undefined` nehmen sie schon den Weg „aus mehreren Abrechnungen“ (PR 3), dort ändert sich
nichts.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-steuer-heizperiode.test.ts test/calc-steuer-zeitraum.test.ts test/api.test.ts && npm run typecheck`
Expected: PASS; `calc-steuer-zeitraum.test.ts` (PR 3) unverändert grün.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/heatingSettlements.ts server/src/index.ts server/src/calc.ts server/test/calc-steuer-heizperiode.test.ts server/test/api.test.ts
git commit -m "Heizperiode: Heizkostenabrechnung rechnen, abschließen und wiederöffnen; Steuer mit eigener Heizperiode

Der Abschluss der Betriebskostenabrechnung friert die Heizkostenabrechnung nicht ein (B3).

Refs #217"
```

---
### Task 10: Invarianten 4 und 11 über zufällige Abläufe

Entwurf 12.3: Ohne Jahreskorrektur ist die Summe der angerechneten Vorauszahlungen (aus den
Abrechnungen P und den Heizkostenabrechnungen) gleich der Summe beider Staffeln im Mietkonto über
dieselben Monate, auch über Stufen der Staffel nach X, eine Einrichtung von Weg d nach einem
Abschluss und ein Ausschalten nach einem Abschluss von P oder H (C1, C3, D1); und jede Heizperiode
steht in genau einer Abrechnung. Geprüft wird über die Datenbank mit den echten Routinen fürs
Einschalten, Ausschalten und Abschließen, denn erst dort treffen eingefrorene und neu gerechnete
Abrechnungen aufeinander.

**Files:**
- Create: `server/test/invariant-heizperiode.test.ts`

**Interfaces:**
- Consumes: `applySeparate`, `previewSeparate` (Task 8), `closeHeatingSettlement` (Task 9), `closeSettlement`, `createEntity` (repository.ts), `createHeatingPlant` (PR 4), `readStock`, `snapshotFor`, `heatingSnapshotFor`, `computeSettlement`, `rentLedger`, `plantRules`, `settledSeparately`.
- Produces: keine neuen Schnittstellen.

- [ ] **Step 1: Write the test**

`server/test/invariant-heizperiode.test.ts`:

```ts
// Invarianten 4 und 11 (Heizung PR 5, Entwurf 12.3) über zufällige Abläufe in der Datenbank: Weg d
// ein- und ausschalten, Abrechnungen P und Heizkostenabrechnungen abschließen, in jeder Reihenfolge,
// die die Routinen zulassen. Fester Startwert, also reproduzierbar.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { applySeparate, previewSeparate } from '../src/db/separateSettlement.ts'
import { closeHeatingSettlement } from '../src/db/heatingSettlements.ts'
import { readStock, type Stock } from '../src/db/read.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { computeSettlement, rentLedger } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodContaining, periodKey, periodsBetween } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028]

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r: () => number, n: number): number => Math.floor(r() * n)

// Was eine eingefrorene oder gerechnete Abrechnung für t1 anrechnet, und welche Heizperioden sie
// nach Weg b enthält. Gelesen wird das Archivstück, ohne Behauptung über seinen Typ.
const field = (o: unknown, key: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined)
const creditOf = (settlement: unknown): number => {
  const list = field(settlement, 'statements')
  if (!Array.isArray(list)) return 0
  return list.reduce((a: number, s: unknown) => (field(s, 'tenancyId') === 't1' && typeof field(s, 'prepaymentCents') === 'number' ? a + Number(field(s, 'prepaymentCents')) : a), 0)
}
const heatingKeysOf = (settlement: unknown): string[] => {
  const list = field(settlement, 'heatingPeriods')
  return Array.isArray(list) ? list.map((h: unknown) => String(field(field(h, 'period'), 'key'))) : []
}

async function scenario(seed: number): Promise<void> {
  const r = rng(seed)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `mietfuchs-invariante-${seed}-`))
  const opened: OpenedDatabase = await openDatabase({ dataDir })
  try {
    const startMonth = `${2023 + pick(r, 2)}-${String(1 + pick(r, 6)).padStart(2, '0')}`
    const end = [null, '2026-03-31', '2026-10-31', '2027-06-30'][pick(r, 4)] ?? null
    const base = 25000 + pick(r, 40) * 250
    const prepayments = [{ from: startMonth, monthlyCents: base }, ...(r() < 0.6 ? [{ from: ['2025-07', '2026-03'][pick(r, 2)] ?? '2025-07', monthlyCents: base + 2000 }] : [])]
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: `${startMonth}-01`, end, prepayments })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
      for (const y of YEARS) {
        await createEntity(db, 'costItems', `gs${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: 'Grundsteuer', description: `Grundsteuer ${y}`, amountCents: 60000, key: 'area' })
        await createEntity(db, 'costItems', `h${y - 1}`, {
          propertyId: 'objekt-1', period: `${y - 1}-05`, category: HEATING_CATEGORY, description: `Heizung ${y - 1}/${y}`, amountCents: 120000, key: 'area',
          heatingPlantId: 'hp1', taxYear: y,
        })
      }
    })
    const closedP = new Set<string>()
    const closeP = async (key: string): Promise<void> => {
      const stock = await opened.read(readStock)
      const settlement = computeSettlement(snapshotFor(stock, 'objekt-1', periodContaining(CALENDAR_RULES, `${key}-01`)))
      await opened.write((db) => closeSettlement(db, { id: `p${key}`, propertyId: 'objekt-1', period: periodKey(key), closedAt: '2027-01-01', sentAt: null, settlement }))
      closedP.add(key)
    }
    if (r() < 0.5) await closeP('2024-01')
    const earliest = closedP.has('2024-01') ? '2025-01' : '2023-01'
    const choices = ['2024-05', '2025-01', '2025-05', '2025-09', '2026-01'].filter((m) => m >= earliest)
    const x = choices[pick(r, choices.length)] ?? '2026-01'
    const vorschau = await opened.read((db) => previewSeparate(db, 'hp1', { separate: true, month: x }, TODAY)) ?? assert.fail('keine Anlage')
    assert.deepEqual(vorschau.blocked, [], `Fall ${seed}: Einschalten ab ${x}`)
    const steps = Object.fromEntries(vorschau.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((row) => [row.from, row.heatingCents]))]))
    const ein = await opened.write((db) => applySeparate(db, 'hp1', { separate: true, month: x, answers: { steps } }, TODAY))
    assert.ok(ein && 'plant' in ein, `Fall ${seed}: eingeschaltet`)
    if (r() < 0.5 && !closedP.has('2025-01')) await closeP('2025-01')
    if (r() < 0.4) {
      const stock = await opened.read(readStock)
      const h = periodContaining(MAI, `${x}-01`)
      const snap = heatingSnapshotFor(stock, 'objekt-1', 'hp1', h) ?? assert.fail('keine Anlage')
      await opened.write((db) => closeHeatingSettlement(db, { id: `h${h.key}`, plantId: 'hp1', period: h.key, closedAt: '2027-01-01', sentAt: null, settlement: computeSettlement(snap) }))
    }
    if (r() < 0.6) {
      const aus = await opened.write((db) => applySeparate(db, 'hp1', { separate: false, answers: { merge: r() < 0.5 } }, TODAY))
      assert.ok(aus && 'plant' in aus, `Fall ${seed}: ausgeschaltet`)
    }
    if (r() < 0.5 && !closedP.has('2026-01')) await closeP('2026-01')

    const stock: Stock = await opened.read(readStock)
    const plant = stock.heatingPlants.find((p) => p.id === 'hp1') ?? assert.fail('keine Anlage')
    const rules = plantRules(plant, CALENDAR_RULES)
    const settlements = new Map(YEARS.map((y) => {
      const frozen = stock.closedSettlements.find((c) => c.period === `${y}-01`)
      return [y, frozen ? frozen.settlement : computeSettlement(snapshotFor(stock, 'objekt-1', calendarYearPeriod(y)))]
    }))
    let credited = [...settlements.values()].reduce((a, s) => a + creditOf(s), 0)
    for (const h of periodsBetween(rules, '2022-05-01', '2028-12-31')) {
      if (!settledSeparately(plant, CALENDAR_RULES, h)) continue
      const frozen = stock.closedHeatingSettlements.find((c) => c.period === h.key)
      const snap = heatingSnapshotFor(stock, 'objekt-1', 'hp1', h) ?? assert.fail('keine Anlage')
      credited += creditOf(frozen ? frozen.settlement : computeSettlement(snap))
    }
    // Invariante 11: Jeder Monat beider Staffeln wird genau einmal angerechnet.
    const ledger = YEARS.reduce((a, y) => a + rentLedger(snapshotFor(stock, 'objekt-1', calendarYearPeriod(y))).rows
      .filter((row) => row.tenancyId === 't1')
      .reduce((b, row) => b + row.prepaymentYearCents + (row.heatingPrepaymentYearCents ?? 0), 0), 0)
    assert.equal(credited, ledger, `Fall ${seed}: X ${x}, abgeschlossen ${[...closedP].join(', ')}, Spannen ${JSON.stringify(plant.separateSpans)}`)
    // Invariante 4: Jede Heizperiode mit Heizkosten steht in genau einer Abrechnung.
    for (const h of periodsBetween(rules, '2022-05-01', '2027-12-31')) {
      const inP = [...settlements.values()].filter((s) => heatingKeysOf(s).includes(h.key)).length
      const getrennt = settledSeparately(plant, CALENDAR_RULES, h) ? 1 : 0
      assert.equal(inP + getrennt, 1, `Fall ${seed}: Heizperiode ${h.key}`)
    }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Invarianten 4 und 11: zufällige Abläufe mit Ein- und Ausschalten und Abschlüssen (Entwurf 12.3)', async () => {
  for (let seed = 1; seed <= 16; seed++) await scenario(seed)
})
```

- [ ] **Step 2: Run test**

Run: `npm --prefix server test -- test/invariant-heizperiode.test.ts`
Expected: PASS. Schlägt ein Fall fehl, nennt die Meldung X, die abgeschlossenen Zeiträume und die
Spannen; der Fall ist mit seinem Startwert nachzustellen. Zuerst prüfen, ob die Regel
`separateOwner` oder eine Sperre (X, W) verletzt ist; die Erwartung wird nie angepasst.

- [ ] **Step 3: Commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add server/test/invariant-heizperiode.test.ts
git commit -m "Heizperiode: Invarianten 4 und 11 über zufällige Abläufe mit Weg d und Abschlüssen

Refs #217"
```

---
### Task 11: Oberfläche: Einrichtung Schritt 3 (Zeitraum der Heizung, getrennte Abrechnung)

Entwurf 11.2 Schritt 3: „Für welchen Zeitraum rechnet sie ab?“ mit Vorgabe „wie das Objekt“; weicht
er ab, die Frage nach der getrennten Abrechnung, der vorgeschlagene Weg samt Zustimmungsvorbehalt,
dann die Vorschau des Umschlüsselns und, bei Weg d (oder später beim Ein- oder Ausschalten), die
Vorschau zum Aufteilen der Vorauszahlung mit X, jeder Stufe, den Jahreskorrekturen und den Fristen.
Die Logik steht DOM-frei in `client/src/heatingPeriodForm.ts`; die Karte bekommt einen Abschnitt je
Anlage. „Hier beheben →“ an einem Hinweis zur Heizanlage führt in die Stammdaten zur Karte.

**Files:**
- Create: `client/src/heatingPeriodForm.ts`, `client/src/components/HeatingPeriodSection.tsx`
- Modify: `client/src/components/HeatingCard.tsx`, `client/src/pages/Stammdaten.tsx`, `client/src/notices.ts`
- Test: `client/src/heatingPeriodForm.test.ts` (neu), `client/src/components/HeatingPeriodSection.test.tsx` (neu), `client/src/notices.test.ts`

**Interfaces:**
- Consumes: `HeatingPeriodChangePreview`, `HeatingPeriodChangeAnswers` (Task 4), `SeparatePreview`, `SeparateAnswers` (Task 8), Routen aus Task 4 und 8; `hasOwnRhythm`, `plantRules`, `monthSpanText` (Task 2); `rhythmText`, `MONTH_OPTIONS` (PR 3, `client/src/periodForm.ts`); `api`, `errorText`, `parseEuro`, `fmtEuro`, `fmtDate` (`client/src/api.ts`); `useFocusTarget` (`client/src/focus.ts`).
- Produces:
  - `heatingPeriodForm.ts`: `type PeriodChoice = 'object' | 'own'`, `type SeparateChoice = '' | 'yes' | 'no' | 'unknown'`, `type HeatingPeriodForm = { choice: PeriodChoice; mode: 'start' | 'change'; month: number; from: string; separate: SeparateChoice }`, `PERIOD_CHOICE_OPTIONS`, `SEPARATE_OPTIONS`, `heatingPeriodForm(plant)`, `heatingRulesBody(form, plant, objectRules): { rules: PeriodRules | null } | { error: string }`, `suggestedWay(input): { way: 'a' | 'b' | 'd'; text: string } | null`, `heatingPeriodSummary(plant, objectRules): string[]`, `type HeatingPeriodAnswerForm`, `initialHeatingPeriodAnswers(preview)`, `heatingPeriodAnswersOf(preview, form)`, `type SeparateAnswerForm`, `initialSeparateAnswers(preview)`, `separateAnswersOf(preview, form)`
  - `HeatingPeriodSection({ plant, objectRules, hasCalendarData, onChanged, notify })`; `HeatingCard` nimmt zusätzlich `FocusProps`
  - `notices.ts`: Ziel `heatingPlant` → Stammdaten

- [ ] **Step 1: Write the failing tests**

`client/src/heatingPeriodForm.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  heatingPeriodAnswersOf, heatingPeriodForm, heatingPeriodSummary, heatingRulesBody, initialHeatingPeriodAnswers, initialSeparateAnswers,
  separateAnswersOf, suggestedWay,
} from './heatingPeriodForm'
import { CALENDAR_RULES, periodKey as k } from '../../shared/period.ts'
import type { HeatingPeriodChangePreview, HeatingPlant, SeparatePreview } from './types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, ...over,
})

describe('Zeitraum der Heizung (Entwurf 11.2 Schritt 3)', () => {
  test('Vorgabe: wie das Objekt; mit eigener Heizperiode ihr Beginnmonat', () => {
    expect(heatingPeriodForm(plant())).toEqual({ choice: 'object', mode: 'start', month: 5, from: '', separate: '' })
    expect(heatingPeriodForm(plant({ periodStartMonth: 7, separateSettlement: true }))).toEqual({ choice: 'own', mode: 'start', month: 7, from: '', separate: 'yes' })
  })
  test('Regeln: wie das Objekt, von Anfang an, ab einem Monat', () => {
    expect(heatingRulesBody({ choice: 'object', mode: 'start', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ rules: null })
    expect(heatingRulesBody({ choice: 'own', mode: 'start', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ rules: { startMonth: 5, changes: [] } })
    expect(heatingRulesBody({ choice: 'own', mode: 'change', month: 5, from: '2026-01', separate: '' }, plant({ periodStartMonth: 5 }), CALENDAR_RULES)).toEqual({ rules: { startMonth: 5, changes: ['2026-01'] } })
    expect(heatingRulesBody({ choice: 'own', mode: 'change', month: 5, from: '', separate: '' }, plant(), CALENDAR_RULES)).toEqual({ error: 'Bitte geben Sie den Monat an, ab dem die Heizung im neuen Zeitraum abrechnet.' })
  })
  test('Vorgeschlagener Weg: getrennt → d, sonst b bei vorhandenen Daten, sonst a; immer mit dem Mietvertrag', () => {
    expect(suggestedWay({ differs: false, separate: 'yes', hasCalendarData: true })).toBe(null)
    expect(suggestedWay({ differs: true, separate: 'yes', hasCalendarData: true })?.way).toBe('d')
    expect(suggestedWay({ differs: true, separate: 'no', hasCalendarData: true })?.way).toBe('b')
    expect(suggestedWay({ differs: true, separate: 'unknown', hasCalendarData: false })?.way).toBe('a')
    expect(suggestedWay({ differs: true, separate: 'no', hasCalendarData: true })?.text).toMatch(/Zustimmung der Mieter/)
  })
  test('Zusammenfassung in der Karte', () => {
    expect(heatingPeriodSummary(plant(), CALENDAR_RULES)).toEqual(['Zeitraum der Heizung: wie das Objekt'])
    expect(heatingPeriodSummary(plant({ periodStartMonth: 5, separateSettlement: true, separateSpans: [{ from: '2026-01', until: null }] }), CALENDAR_RULES)).toEqual([
      'Zeitraum der Heizung: Mai bis April',
      'Heizkosten getrennt abgerechnet ab Januar 2026',
    ])
  })
})

describe('Antworten zu den Vorschauen', () => {
  const wechsel: HeatingPeriodChangePreview = {
    rules: { startMonth: 5, changes: [] }, periods: [], newShort: [], blocked: [], moves: [], endsSeparate: [],
    groups: [{ from: k('2026-01'), fromLabel: '2026', items: [{ costItemId: 'c1', description: 'Gas', amountCents: 100000 }], options: [{ key: k('2025-05'), label: '2025/2026' }], suggested: k('2025-05') }],
    overrides: [{ tenancyId: 't1', tenantName: 'A', from: [], ask: [{ kind: 'heating', period: k('2025-05'), label: '01.05.–31.12.2025', months: '05–12/2025' }, { kind: 'total', period: k('2026-01'), label: '2026', months: '01–12/2026' }] }],
  }
  test('Wechsel: Gruppen vorbelegt, Beträge oder „keine Korrektur“', () => {
    const form = initialHeatingPeriodAnswers(wechsel)
    expect(form.groups).toEqual({ '2026-01': '2025-05' })
    expect(heatingPeriodAnswersOf(wechsel, form)).toEqual({ error: 'Bitte tragen Sie für A den Betrag 05–12/2025 ein oder setzen Sie „keine Korrektur“.' })
    const ok = heatingPeriodAnswersOf(wechsel, { ...form, amounts: { 't1|heating|2025-05': '900,00' }, none: { 't1|total|2026-01': true } })
    expect(ok).toEqual({ groups: { '2026-01': '2025-05' }, overrides: { t1: { '2025-05': 90000 } }, totals: { t1: { '2026-01': null } } })
  })
  const ein: SeparatePreview = {
    separate: true, way: 'separate', month: '2026-01', earliestMonth: null, until: null, earliestUntil: null, share: null, keep: [], merge: [], blocked: [], deadlines: [],
    steps: [{ tenancyId: 't1', tenantName: 'A', rows: [{ from: '2026-01', totalCents: 30000, heatingCents: 12300 }] }],
    overrides: [{ tenancyId: 't1', tenantName: 'A', period: k('2026-01'), label: '2026', cents: 330000,
      asks: [{ kind: 'total', period: k('2026-01'), label: '2026', months: '01–12/2026' }, { kind: 'heating', period: k('2025-05'), label: '2025/2026', months: '01–04/2026' }],
      remainder: { period: k('2026-05'), label: '2026/2027', months: '05–12/2026' } }],
  }
  test('Einschalten: Heizanteil vorbelegt, Korrekturen verlangt, Rest wird angezeigt', () => {
    const form = initialSeparateAnswers(ein)
    expect(form.steps).toEqual({ 't1|2026-01': '123,00' })
    expect(separateAnswersOf(ein, form)).toEqual({ error: 'Bitte tragen Sie für A „2026“ ein.' })
    const ok = separateAnswersOf(ein, { ...form, amounts: { 't1|total|2026-01': '2.124,00', 't1|heating|2025-05': '300,00' } })
    expect(ok).toEqual({ steps: { t1: { '2026-01': 12300 } }, totals: { t1: { '2026-01': 212400 } }, overrides: { t1: { '2025-05': 30000 } }, merge: true })
    expect(separateAnswersOf(ein, { ...form, steps: { 't1|2026-01': '400,00' } })).toEqual({ error: 'Der Heizanteil von A ab 01/2026 liegt über der Vorauszahlung von 300,00 €.' })
  })
})
```

`client/src/components/HeatingPeriodSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingPeriodSection from './HeatingPeriodSection'
import { CALENDAR_RULES } from '../../../shared/period.ts'
import type { HeatingPlant } from '../types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, ...over,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Abschnitt „Zeitraum der Heizung“', () => {
  test('Jedes Auswahlfeld zeigt den gespeicherten Wert', () => {
    render(<HeatingPeriodSection plant={plant({ separateSettlement: false })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    expect((screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }) as HTMLSelectElement).value).toBe('own')
    expect((screen.getByRole('combobox', { name: 'Ab Monat' }) as HTMLSelectElement).value).toBe('5')
    expect((screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }) as HTMLSelectElement).value).toBe('no')
  })

  test('Vorschau, dann Übernehmen mit den Antworten', async () => {
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/period/preview')) {
        return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [],
          moves: [{ costItemId: 'c1', description: 'Messdienst 2025/2026', amountCents: 100000, from: '2025-05', fromLabel: '2025/2026', to: '2026-01', toLabel: '2026' }] })
      }
      return json(plant({ periodStartMonth: null }))
    }))
    const changed = vi.fn(async () => {})
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={changed} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    await screen.findByText(/Messdienst 2025\/2026: von 2025\/2026 nach 2026/)
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/heating-plants/hp1/period/preview', { rules: null }],
      ['PUT', '/api/heating-plants/hp1/period', { rules: null, answers: { groups: {}, overrides: {}, totals: {} } }],
    ])
  })
})
```

In `client/src/notices.test.ts` anhängen:

```ts
test('Hinweis an der Heizanlage führt in die Stammdaten (Heizung PR 5)', () => {
  expect(noticeTarget({ kind: 'heatingPlant', id: 'hp1' })).toEqual({ tab: 'stammdaten', label: 'Hier beheben → Stammdaten', focus: { kind: 'heatingPlant', id: 'hp1' } })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingPeriodForm HeatingPeriodSection notices`
Expected: FAIL: Die Module gibt es nicht; `noticeTarget` liefert für `heatingPlant` `null`.

- [ ] **Step 3: `client/src/heatingPeriodForm.ts`**

```ts
// Die Einrichtung „Heizung“, Schritt 3 (Heizung PR 5, Entwurf 11.2): für welchen Zeitraum die Heizung
// abrechnet, ob die Heizkosten getrennt abgerechnet werden, welcher Weg vorgeschlagen wird (3.1), und
// die Antworten zu den beiden Vorschauen (Zeitraum der Heizung, getrennte Abrechnung). Ohne DOM prüfbar.
import { parseEuro } from './api'
import { rhythmText } from './periodForm'
import { hasOwnRhythm, monthSpanText, plantRules } from '../../shared/heatingPeriod.ts'
import { parsePeriodKey } from '../../shared/period.ts'
import type { HeatingPeriodChangeAnswers, HeatingPeriodChangePreview, HeatingPlant, PeriodRules, SeparateAnswers, SeparatePreview } from './types'

export type PeriodChoice = 'object' | 'own'
export type SeparateChoice = '' | 'yes' | 'no' | 'unknown'
export type HeatingPeriodForm = { choice: PeriodChoice; mode: 'start' | 'change'; month: number; from: string; separate: SeparateChoice }

export const PERIOD_CHOICE_OPTIONS: { value: PeriodChoice; label: string }[] = [
  { value: 'object', label: 'Wie der Abrechnungszeitraum des Objekts' },
  { value: 'own', label: 'Ein eigener Zeitraum, etwa Mai bis April wie der Messdienst' },
]

export const SEPARATE_OPTIONS: { value: Exclude<SeparateChoice, ''>; label: string }[] = [
  { value: 'no', label: 'Nein, eine gemeinsame Vorauszahlung für alle Nebenkosten' },
  { value: 'yes', label: 'Ja, mit eigener Heizkostenvorauszahlung und eigener Heizkostenabrechnung' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]

export function heatingPeriodForm(plant: HeatingPlant): HeatingPeriodForm {
  return {
    choice: hasOwnRhythm(plant) ? 'own' : 'object',
    mode: 'start',
    month: plant.periodStartMonth ?? 5,
    from: '',
    separate: plant.separateSettlement === true ? 'yes' : plant.separateSettlement === false ? 'no' : '',
  }
}

// Die Regeln für die Vorschau: `null` heißt „wie das Objekt“; „ab einem Monat“ fügt einen Wechsel an
// den bisherigen Rhythmus der Heizung an (oder an den des Objekts, wenn sie ihm bisher folgt).
export function heatingRulesBody(form: HeatingPeriodForm, plant: HeatingPlant, objectRules: PeriodRules): { rules: PeriodRules | null } | { error: string } {
  if (form.choice === 'object') return { rules: null }
  if (form.mode === 'start') return { rules: { startMonth: form.month, changes: [] } }
  const from = parsePeriodKey(form.from)
  if (from === null) return { error: 'Bitte geben Sie den Monat an, ab dem die Heizung im neuen Zeitraum abrechnet.' }
  const current = plantRules(plant, objectRules)
  return { rules: { startMonth: current.startMonth, changes: [...current.changes, from] } }
}

// Der vorgeschlagene Weg (Entwurf 3.1, 11.2): bei getrennter Abrechnung Weg d, sonst die eigene
// Heizperiode in der Gesamtabrechnung (Weg b), wenn schon Daten im Zeitraum des Objekts stehen, sonst
// die Umstellung des ganzen Objekts (Weg a). Jeder Weg nennt den Zustimmungsvorbehalt (A3).
export function suggestedWay(input: { differs: boolean; separate: SeparateChoice; hasCalendarData: boolean }): { way: 'a' | 'b' | 'd'; text: string } | null {
  if (!input.differs) return null
  const contract = ' Legt Ihr Mietvertrag den Abrechnungszeitraum fest, braucht die Änderung die Zustimmung der Mieter.'
  if (input.separate === 'yes') {
    return { way: 'd', text: 'Vorgeschlagen: eine eigene Heizkostenabrechnung je Heizperiode, mit eigener Frist. Mietfuchs teilt dafür die bisherige Vorauszahlung auf; die Vorschau zeigt jeden Betrag. Das ist eine Auslegung des Gesetzes.' + contract }
  }
  if (input.hasCalendarData) {
    return { way: 'b', text: 'Vorgeschlagen: Die Heizkosten einer Heizperiode stehen in der Betriebskostenabrechnung des Zeitraums, in dem sie endet. Das ist bei einer gemeinsamen Vorauszahlung zulässig (BGH, Urteil vom 30.04.2008, VIII ZR 240/07).' + contract }
  }
  return { way: 'a', text: 'Vorgeschlagen: den Abrechnungszeitraum des ganzen Objekts auf den Zeitraum des Messdienstes umstellen (Karte „Abrechnungszeitraum“).' + contract }
}

// Die Zeilen der Karte zum Zeitraum der Heizung.
export function heatingPeriodSummary(plant: HeatingPlant, objectRules: PeriodRules): string[] {
  if (!hasOwnRhythm(plant)) {
    return plant.separateSettlement === true
      ? ['Zeitraum der Heizung: wie das Objekt', 'Heizvorauszahlung getrennt ausgewiesen']
      : ['Zeitraum der Heizung: wie das Objekt']
  }
  const lines = [`Zeitraum der Heizung: ${rhythmText(plantRules(plant, objectRules))}`]
  for (const s of plant.separateSpans) {
    lines.push(s.until === null
      ? `Heizkosten getrennt abgerechnet ab ${monthSpanText([s.from])}`
      : `Heizkosten getrennt abgerechnet von ${monthSpanText([s.from])} bis vor der Heizperiode ab ${monthSpanText([s.until])}`)
  }
  return lines
}

const euroText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monthText = (month: string): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`

// ---------- Antworten zur Vorschau „Zeitraum der Heizung“ ----------

// Beträge je Frage unter dem Schlüssel `Mietverhältnis|Art|Zeitraum`, „keine Korrektur“ eigens.
export type HeatingPeriodAnswerForm = { groups: Record<string, string>; amounts: Record<string, string>; none: Record<string, boolean> }

export function initialHeatingPeriodAnswers(p: HeatingPeriodChangePreview): HeatingPeriodAnswerForm {
  return { groups: Object.fromEntries(p.groups.map((g) => [g.from, g.suggested])), amounts: {}, none: {} }
}

export function heatingPeriodAnswersOf(p: HeatingPeriodChangePreview, form: HeatingPeriodAnswerForm): HeatingPeriodChangeAnswers | { error: string } {
  const overrides: Record<string, Record<string, number | null>> = {}
  const totals: Record<string, Record<string, number | null>> = {}
  for (const o of p.overrides) {
    for (const a of o.ask) {
      const key = `${o.tenancyId}|${a.kind}|${a.period}`
      const cents = form.none[key] ? null : parseEuro(form.amounts[key] ?? '')
      if (!form.none[key] && (cents === null || cents < 0)) return { error: `Bitte tragen Sie für ${o.tenantName} den Betrag ${a.months} ein oder setzen Sie „keine Korrektur“.` }
      const target = a.kind === 'heating' ? overrides : totals
      target[o.tenancyId] = { ...(target[o.tenancyId] ?? {}), [a.period]: cents }
    }
  }
  return { groups: form.groups, overrides, totals }
}

// ---------- Antworten zur Vorschau „getrennte Heizkostenabrechnung“ ----------

// Heizanteil je Stufe unter `Mietverhältnis|Monat`, Beträge der Korrekturen unter
// `Mietverhältnis|Art|Zeitraum`; beim Ausschalten „keine Korrektur“ eigens und die Frage nach dem
// Zusammenführen (Vorgabe ja).
export type SeparateAnswerForm = { steps: Record<string, string>; amounts: Record<string, string>; none: Record<string, boolean>; merge: boolean }

export function initialSeparateAnswers(p: SeparatePreview): SeparateAnswerForm {
  return {
    steps: Object.fromEntries(p.steps.flatMap((s) => s.rows.map((r) => [`${s.tenancyId}|${r.from}`, euroText(r.heatingCents)]))),
    amounts: {}, none: {}, merge: true,
  }
}

export function separateAnswersOf(p: SeparatePreview, form: SeparateAnswerForm): SeparateAnswers | { error: string } {
  const steps: Record<string, Record<string, number>> = {}
  for (const s of p.steps) {
    for (const r of s.rows) {
      const cents = parseEuro(form.steps[`${s.tenancyId}|${r.from}`] ?? '')
      if (cents === null || cents < 0) return { error: `Bitte tragen Sie den Heizanteil von ${s.tenantName} ab ${monthText(r.from)} ein.` }
      if (cents > r.totalCents) return { error: `Der Heizanteil von ${s.tenantName} ab ${monthText(r.from)} liegt über der Vorauszahlung von ${euroText(r.totalCents)} €.` }
      steps[s.tenancyId] = { ...(steps[s.tenancyId] ?? {}), [r.from]: cents }
    }
  }
  const totals: Record<string, Record<string, number | null>> = {}
  const overrides: Record<string, Record<string, number>> = {}
  for (const o of p.overrides) {
    for (const a of o.asks) {
      const key = `${o.tenancyId}|${a.kind}|${a.period}`
      const allowNone = !p.separate && a.kind === 'total'
      const cents = allowNone && form.none[key] ? null : parseEuro(form.amounts[key] ?? '')
      if (!(allowNone && form.none[key]) && (cents === null || cents < 0)) return { error: `Bitte tragen Sie für ${o.tenantName} „${a.label}“ ein.` }
      if (a.kind === 'total') totals[o.tenancyId] = { ...(totals[o.tenancyId] ?? {}), [a.period]: cents }
      else if (cents !== null) overrides[o.tenancyId] = { ...(overrides[o.tenancyId] ?? {}), [a.period]: cents }
    }
  }
  return { steps, totals, overrides, merge: form.merge }
}
```

- [ ] **Step 4: `client/src/components/HeatingPeriodSection.tsx`**

```tsx
import { useState } from 'react'
import type { HeatingPeriodChangePreview, HeatingPlant, PeriodRules, SeparatePreview } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { MONTH_OPTIONS } from '../periodForm'
import { hasOwnRhythm } from '../../../shared/heatingPeriod.ts'
import {
  PERIOD_CHOICE_OPTIONS, SEPARATE_OPTIONS, heatingPeriodAnswersOf, heatingPeriodForm, heatingPeriodSummary, heatingRulesBody, initialHeatingPeriodAnswers,
  initialSeparateAnswers, separateAnswersOf, suggestedWay, type HeatingPeriodAnswerForm, type HeatingPeriodForm, type PeriodChoice, type SeparateAnswerForm,
  type SeparateChoice,
} from '../heatingPeriodForm'

// Der Abschnitt „Zeitraum der Heizung“ einer Anlage in der Karte „Heizung“ (Heizung PR 5, Entwurf 11.2
// Schritt 3): Zeitraum wechseln mit Vorschau, getrennte Heizkostenabrechnung ein- und ausschalten mit
// Vorschau. Geschrieben wird erst mit „Übernehmen“; lehnt der Server ab (409), steht seine Meldung da
// und die neue Vorschau.
type Props = {
  plant: HeatingPlant
  objectRules: PeriodRules
  hasCalendarData: boolean
  onChanged: () => Promise<void>
  notify: (text: string) => void
}

export default function HeatingPeriodSection({ plant, objectRules, hasCalendarData, onChanged, notify }: Props) {
  const [open, setOpen] = useState<'none' | 'period' | 'separate'>('none')
  const [form, setForm] = useState<HeatingPeriodForm>(heatingPeriodForm(plant))
  const [periodPreview, setPeriodPreview] = useState<HeatingPeriodChangePreview | null>(null)
  const [periodAnswers, setPeriodAnswers] = useState<HeatingPeriodAnswerForm | null>(null)
  const [separatePreview, setSeparatePreview] = useState<SeparatePreview | null>(null)
  const [separateAnswers, setSeparateAnswers] = useState<SeparateAnswerForm | null>(null)
  const [month, setMonth] = useState('')
  const [error, setError] = useState('')
  const own = hasOwnRhythm(plant)
  const openSpan = plant.separateSpans.some((s) => s.until === null)
  const separateOn = openSpan || (!own && plant.separateSettlement === true)

  function close() {
    setOpen('none')
    setError('')
    setPeriodPreview(null)
    setSeparatePreview(null)
  }

  async function loadPeriodPreview() {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body) return setError(body.error)
    try {
      const p = await api<HeatingPeriodChangePreview>(`/api/heating-plants/${plant.id}/period/preview`, { method: 'POST', body: JSON.stringify(body) })
      setPeriodPreview(p)
      setPeriodAnswers(initialHeatingPeriodAnswers(p))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function savePeriod() {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body || !periodPreview || !periodAnswers) return
    const answers = heatingPeriodAnswersOf(periodPreview, periodAnswers)
    if ('error' in answers) return setError(answers.error)
    try {
      await api(`/api/heating-plants/${plant.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: body.rules, answers }) })
    } catch (e) {
      setError(errorText(e))
      return
    }
    // Die Antwort auf die Frage nach der getrennten Abrechnung (Schritt 3): bei „ja“ und eigener
    // Heizperiode geht es mit der Vorschau zum Aufteilen weiter (Weg d), sonst wird sie gespeichert.
    close()
    await onChanged()
    notify('Zeitraum der Heizung gespeichert.')
    if (form.choice === 'own' && form.separate === 'yes' && !openSpan) setOpen('separate')
  }

  async function loadSeparatePreview() {
    const body = separateOn ? { separate: false, ...(month ? { until: month } : {}) } : { separate: true, ...(month ? { month } : {}) }
    try {
      const p = await api<SeparatePreview>(`/api/heating-plants/${plant.id}/separate/preview`, { method: 'POST', body: JSON.stringify(body) })
      setSeparatePreview(p)
      setSeparateAnswers(initialSeparateAnswers(p))
      setMonth(p.separate ? p.month ?? '' : p.until ?? p.month ?? '')
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveSeparate() {
    if (!separatePreview || !separateAnswers) return
    const answers = separateAnswersOf(separatePreview, separateAnswers)
    if ('error' in answers) return setError(answers.error)
    const body = separatePreview.separate
      ? { separate: true, month: separatePreview.month, answers }
      : { separate: false, ...(separatePreview.until ? { until: separatePreview.until } : { month: separatePreview.month }), answers }
    try {
      await api(`/api/heating-plants/${plant.id}/separate`, { method: 'PUT', body: JSON.stringify(body) })
    } catch (e) {
      setError(errorText(e))
      return
    }
    close()
    await onChanged()
    notify(separatePreview.separate ? 'Getrennte Heizkostenabrechnung eingeschaltet.' : 'Getrennte Heizkostenabrechnung ausgeschaltet.')
  }

  const way = suggestedWay({ differs: form.choice === 'own', separate: form.separate, hasCalendarData })
  const amount = (key: string) => separateAnswers?.amounts[key] ?? ''

  return (
    <div className="heating-period">
      <ul>{heatingPeriodSummary(plant, objectRules).map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="row">
        <button className="btn ghost" onClick={() => { setForm(heatingPeriodForm(plant)); setOpen('period') }}>Zeitraum der Heizung ändern</button>
        {(own || plant.separateSettlement === true) && (
          <button className="btn ghost" onClick={() => { setMonth(''); setOpen('separate') }}>
            {separateOn ? 'Getrennte Heizkostenabrechnung ausschalten' : own ? 'Getrennte Heizkostenabrechnung einschalten' : 'Vorauszahlung aufteilen'}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {open === 'period' && (
        <div className="panel">
          <label className="field grow">
            Für welchen Zeitraum rechnet die Heizung ab?
            <select value={form.choice} onChange={(e) => setForm({ ...form, choice: e.target.value as PeriodChoice })}>
              {PERIOD_CHOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {/* Der Satz steht außerhalb des label, sonst gehörte er zum Namen des Auswahlfelds. */}
          <small className="muted">Woran erkenne ich das? Am Zeitraum auf der Abrechnung Ihres Messdienstes, etwa „01.05.2025–30.04.2026“.</small>
          {form.choice === 'own' && (
            <>
              <fieldset className="field grow">
                <legend className="field-legend">Seit wann?</legend>
                <label className="checkline"><input type="radio" checked={form.mode === 'start'} onChange={() => setForm({ ...form, mode: 'start' })} /> Schon immer</label>
                <label className="checkline"><input type="radio" checked={form.mode === 'change'} onChange={() => setForm({ ...form, mode: 'change' })} /> Ab einem Monat</label>
              </fieldset>
              {form.mode === 'start' ? (
                <label className="field">
                  Ab Monat
                  <select value={String(form.month)} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
                    {MONTH_OPTIONS.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
                  </select>
                </label>
              ) : (
                <label className="field">
                  Neuer Zeitraum ab
                  <input type="month" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                </label>
              )}
              <label className="field grow">
                Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?
                <select value={form.separate} onChange={(e) => setForm({ ...form, separate: e.target.value as SeparateChoice })}>
                  <option value="">— bitte wählen —</option>
                  {SEPARATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Woran erkenne ich das? Im Mietvertrag steht eine eigene Vorauszahlung für Heizung und Warmwasser, und Sie schicken dafür eine eigene Abrechnung.</small>
              {way && <p className="muted">{way.text}</p>}
            </>
          )}
          <div className="row">
            <button className="btn secondary" onClick={() => void loadPeriodPreview()}>Vorschau</button>
            <button className="btn ghost" onClick={close}>Abbrechen</button>
          </div>
          {periodPreview && periodAnswers && (
            <div className="preview">
              {periodPreview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
              {periodPreview.moves.length > 0 && (
                <ul>{periodPreview.moves.map((m) => <li key={m.costItemId}>{m.description}: von {m.fromLabel} nach {m.toLabel} ({fmtEuro(m.amountCents)})</li>)}</ul>
              )}
              {periodPreview.groups.map((g) => (
                <label key={g.from} className="field grow">
                  {`Heizperiode für ${g.items.map((i) => i.description).join(', ')}`}
                  <select value={periodAnswers.groups[g.from] ?? ''} onChange={(e) => setPeriodAnswers({ ...periodAnswers, groups: { ...periodAnswers.groups, [g.from]: e.target.value } })}>
                    {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </label>
              ))}
              {periodPreview.overrides.flatMap((o) => o.ask.map((a) => {
                const key = `${o.tenancyId}|${a.kind}|${a.period}`
                return (
                  <div key={key} className="row">
                    <label className="field">
                      {a.kind === 'heating' ? `${o.tenantName}: Heizvorauszahlung ${a.months} tatsächlich gezahlt` : `${o.tenantName}: Vorauszahlungen ${a.months} insgesamt tatsächlich gezahlt`}
                      <input inputMode="decimal" value={periodAnswers.amounts[key] ?? ''} onChange={(e) => setPeriodAnswers({ ...periodAnswers, amounts: { ...periodAnswers.amounts, [key]: e.target.value } })} />
                    </label>
                    <label className="checkline">
                      <input type="checkbox" checked={periodAnswers.none[key] ?? false} onChange={(e) => setPeriodAnswers({ ...periodAnswers, none: { ...periodAnswers.none, [key]: e.target.checked } })} /> keine Korrektur (die Staffel gilt)
                    </label>
                  </div>
                )
              }))}
              {periodPreview.endsSeparate.length > 0 && (
                <p className="muted">{`Danach in der Betriebskostenabrechnung statt getrennt: ${periodPreview.endsSeparate.map((e) => e.label).join(', ')}.`}</p>
              )}
              <button className="btn" disabled={periodPreview.blocked.length > 0} onClick={() => void savePeriod()}>Übernehmen</button>
            </div>
          )}
        </div>
      )}

      {open === 'separate' && (
        <div className="panel">
          <label className="field">
            {separateOn && own ? 'Ab welcher Heizperiode wieder gemeinsam? (Monat ihres Beginns)' : 'Ab welchem Monat?'}
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn secondary" onClick={() => void loadSeparatePreview()}>Vorschau</button>
            <button className="btn ghost" onClick={close}>Abbrechen</button>
          </div>
          {separatePreview && separateAnswers && (
            <div className="preview">
              {separatePreview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
              {separatePreview.share && <p className="muted">{`Vorbelegt mit dem Anteil der Heizkosten: ${(separatePreview.share.permille / 10).toLocaleString('de-DE')} % (${separatePreview.share.source}).`}</p>}
              {separatePreview.steps.flatMap((s) => s.rows.map((r) => {
                const key = `${s.tenancyId}|${r.from}`
                return (
                  <label key={key} className="field">
                    {`${s.tenantName} ab ${r.from.slice(5, 7)}/${r.from.slice(0, 4)}: davon Heizung (Vorauszahlung ${fmtEuro(r.totalCents)})`}
                    <input inputMode="decimal" value={separateAnswers.steps[key] ?? ''} onChange={(e) => setSeparateAnswers({ ...separateAnswers, steps: { ...separateAnswers.steps, [key]: e.target.value } })} />
                  </label>
                )
              }))}
              {separatePreview.overrides.map((o) => (
                <fieldset key={`${o.tenancyId}|${o.period}`} className="field grow">
                  <legend className="field-legend">{`${o.tenantName}: Jahreskorrektur ${o.label}${o.cents === null ? '' : ` (bisher ${fmtEuro(o.cents)})`}`}</legend>
                  {o.asks.map((a) => {
                    const key = `${o.tenancyId}|${a.kind}|${a.period}`
                    const text = a.kind === 'total'
                      ? (separatePreview.separate ? `davon übrige Vorauszahlungen ${a.months}` : `Vorauszahlungen ${a.months} insgesamt`)
                      : `Heizvorauszahlung ${a.label} (${a.months})${a.kind === 'provisional' ? ', vorläufig' : ''}`
                    return (
                      <div key={key} className="row">
                        <label className="field">
                          {text}
                          <input inputMode="decimal" value={amount(key)} onChange={(e) => setSeparateAnswers({ ...separateAnswers, amounts: { ...separateAnswers.amounts, [key]: e.target.value } })} />
                        </label>
                        {!separatePreview.separate && (
                          <label className="checkline">
                            <input type="checkbox" checked={separateAnswers.none[key] ?? false} onChange={(e) => setSeparateAnswers({ ...separateAnswers, none: { ...separateAnswers.none, [key]: e.target.checked } })} /> keine Korrektur
                          </label>
                        )}
                      </div>
                    )
                  })}
                  {o.remainder && <p className="muted">{`Der Rest gilt vorläufig für ${o.remainder.label} (${o.remainder.months}); beim Abrechnen dieser Heizperiode erfassen Sie die endgültige Heizvorauszahlung.`}</p>}
                </fieldset>
              ))}
              {separatePreview.deadlines.map((d) => (
                <p key={d.period} className={d.passed ? 'error' : 'muted'}>
                  {`Heizkostenabrechnung ${d.label}: Frist ${fmtDate(d.deadline)}${d.passed ? ' – abgelaufen; eine Nachforderung ist ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB).' : ''}`}
                </p>
              ))}
              {separatePreview.keep.length > 0 && <p className="muted">{`Getrennt bleiben: ${separatePreview.keep.map((k) => `${k.label} (Frist ${fmtDate(k.deadline)})`).join(', ')}.`}</p>}
              {separatePreview.merge.length > 0 && (
                <label className="checkline">
                  <input type="checkbox" checked={separateAnswers.merge} onChange={(e) => setSeparateAnswers({ ...separateAnswers, merge: e.target.checked })} /> Heizvorauszahlung und übrige Vorauszahlung wieder zu einer zusammenführen
                </label>
              )}
              <button className="btn" disabled={separatePreview.blocked.length > 0} onClick={() => void saveSeparate()}>Übernehmen</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

(`fmtDate` aus `client/src/api.ts` macht aus `2027-04-30` `30.04.2027`; `MONTH_OPTIONS` aus PR 3
hat `value` als Zahl.)

- [ ] **Step 5: Karte, Stammdaten, Ziel des Hinweises**

`client/src/components/HeatingCard.tsx` (PR 4): Signatur auf
`export default function HeatingCard({ units, focus, onFocusDone }: { units: Unit[] } & FocusProps)`
ändern; Importe `HeatingPeriodSection` aus `'./HeatingPeriodSection'`, `useFocusTarget, type FocusProps`
aus `'../focus'`, `useRef` aus `'react'`, `rulesOf` aus `'../../../shared/period.ts'` (soweit nicht da).
Hinter `const [error, setError] = useState('')`:

```tsx
  // „Hier beheben →“ an einem Hinweis zur Heizanlage (Heizung PR 5): die Karte ins Bild holen.
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTarget(focus, 'heatingPlant', plants, (p) => p.id, () => cardRef.current?.scrollIntoView?.({ block: 'start' }), onFocusDone)
```

`<div className="card">` wird `<div className="card" ref={cardRef}>`. In der Schleife über `plants`
hinter `<ul>{heatingSummary(p, units).map(…)}</ul>`:

```tsx
          <HeatingPeriodSection
            plant={p}
            objectRules={rulesOf(property)}
            hasCalendarData={assignable.length > 0 || units.length > 0}
            onChanged={load}
            notify={toast}
          />
```

`client/src/pages/Stammdaten.tsx`: `<HeatingCard units={units} />` wird
`<HeatingCard units={units} focus={focus} onFocusDone={onFocusDone} />`.

`client/src/notices.ts`, in `TARGETS` hinter `rentLedger`:

```ts
  heatingPlant: { tab: 'stammdaten', page: 'Stammdaten' },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- heatingPeriodForm HeatingPeriodSection HeatingCard notices Stammdaten && npm run typecheck && npm --prefix server test -- test/anrede.test.ts test/law-literals.test.ts`
Expected: PASS. `anrede.test.ts` findet keine Du-Form, `law-literals` kein Rechtsliteral in den
neuen Dateien (der 30.04.2008 steht als Datum eines Urteils im Text; liegt `client/src/heatingPeriodForm.ts`
im Muster des Wächters, dort in `ALLOWED` mit Begründung „Datum eines Urteils, kein Rechtswert“
eintragen).

- [ ] **Step 7: Run all tests and commit**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

```bash
git add client/src/heatingPeriodForm.ts client/src/heatingPeriodForm.test.ts client/src/components/HeatingPeriodSection.tsx client/src/components/HeatingPeriodSection.test.tsx client/src/components/HeatingCard.tsx client/src/pages/Stammdaten.tsx client/src/notices.ts client/src/notices.test.ts server/test/law-literals.test.ts
git commit -m "Oberfläche: Zeitraum der Heizung und getrennte Heizkostenabrechnung mit Vorschau

Einrichtung Schritt 3 mit vorgeschlagenem Weg und Zustimmungsvorbehalt; Aufteilen der Vorauszahlung
je Stufe, Jahreskorrekturen und Fristen in der Vorschau.

Refs #217"
```

---
### Task 12: Oberfläche: Heizkostenabrechnung, beide Staffeln, Fristen, Heizperiode im Kostenformular

Die Seite Abrechnung wählt neben der Betriebskostenabrechnung jede Heizkostenabrechnung, deren
Heizperiode im gewählten Zeitraum endet, zeigt sie mit derselben Darstellung (Überschrift, Frist,
Abschluss, „✎ anpassen“ als Heizkorrektur) und druckt den Kopf „Betriebskosten 2026, darin Heiz- und
Warmwasserkosten 01.05.2025–30.04.2026“; eine Abrechnung nur mit Heizkosten sagt das dem Mieter und
dem Vermieter die empfohlene Frist. Das Cockpit führt jede Heizkostenabrechnung mit ihrer eigenen
Frist, das Mietkonto die Heizvorauszahlung, das Mietverhältnis beide Staffeln nebeneinander, und das
Kostenformular bietet bei eigener Heizperiode deren Heizperioden an. Die Logik steht DOM-frei in
`client/src/heatingSettlementView.ts`.

**Files:**
- Create: `client/src/heatingSettlementView.ts`, `client/src/components/HeatingPeriodSelect.tsx`
- Modify: `client/src/pages/Abrechnung.tsx`, `client/src/pages/Cockpit.tsx`, `client/src/pages/Mietkonto.tsx`, `client/src/pages/Kosten.tsx`, `client/src/pages/Stammdaten.tsx`
- Test: `client/src/heatingSettlementView.test.ts` (neu), `client/src/components/HeatingPeriodSelect.test.tsx` (neu)

**Interfaces:**
- Consumes: `HeatingSettlementInfo`, `HeatingPrepaymentOverride`, `Statement`-Felder aus Task 1; Routen aus Task 9; `heatingPeriodsEndingIn`, `hasOwnRhythm`, `plantRules` (Task 2); `usePeriod()` (PR 3: `key`, `label`, `param`, `period`, `rules`); `withProperty`, `useProperty` (`client/src/property.tsx`); `api`, `fmtDate`, `fmtEuro`, `parseEuro`.
- Produces (`client/src/heatingSettlementView.ts`): `settlementTitle(s)`, `heatingOnlyNote(st)`, `recommendedDeadlineText(st)`, `prepaymentLabel(st)`, `prepaymentSplit(st): { label: string; cents: number }[]`, `heatingChoices(list, p)`, `settlementPaths(param, target)`, `heatingOverridesWith(tenancy, plantId, period, cents)`, `type HeatingDeadlineRow`, `cockpitHeatingRows(list, today)`, `heatingItemPeriods(plants, objectRules, p)`, `itemsOfPeriod(items, key, heatingKeys)`, `scheduleOf(rows)`; Komponente `HeatingPeriodSelect({ options, value, onChange })`

- [ ] **Step 1: Write the failing tests**

`client/src/heatingSettlementView.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  cockpitHeatingRows, heatingChoices, heatingItemPeriods, heatingOnlyNote, heatingOverridesWith, itemsOfPeriod, prepaymentLabel, prepaymentSplit,
  recommendedDeadlineText, scheduleOf, settlementPaths, settlementTitle,
} from './heatingSettlementView'
import { CALENDAR_RULES, calendarYearPeriod, periodKey as k, settlementPeriod } from '../../shared/period.ts'
import type { HeatingPlant, HeatingSettlementInfo, Statement, Tenancy } from './types'

const p2026 = settlementPeriod(calendarYearPeriod(2026))
const h2025 = { key: k('2025-05'), from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' }
const statement = (over: Partial<Statement> = {}): Statement => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'M', unitName: 'EG', persons: 1, days: 184, personDays: 184, periodStart: '2025-05-01', periodEnd: '2025-10-31',
  rows: [], totalShareCents: 41230, total35aCents: 0, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: -41230, ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, ...over,
})

describe('Überschrift und Druckkopf (Entwurf 3.1)', () => {
  test('Betriebskosten mit eigener Heizperiode, Heizkostenabrechnung, sonst wie bisher', () => {
    expect(settlementTitle({ period: p2026, heatingPeriods: [{ plantId: 'hp1', period: h2025 }] })).toBe('Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026')
    expect(settlementTitle({ period: h2025, scope: { kind: 'heating', plantId: 'hp1', plantName: '' } })).toBe('Heizkostenabrechnung 2025/2026')
    expect(settlementTitle({ period: p2026 })).toBe('Nebenkostenabrechnung 2026')
    expect(settlementTitle({ period: p2026, heatingPeriods: [{ plantId: 'hp1', period: p2026 }] })).toBe('Nebenkostenabrechnung 2026')
  })
  test('Abrechnung nur mit Heizkosten', () => {
    expect(heatingOnlyNote(statement({ heatingOnly: true }))).toMatch(/^Abrechnung nur der Heizkosten/)
    expect(heatingOnlyNote(statement())).toBe(null)
    expect(recommendedDeadlineText(statement({ heatingOnly: true, recommendedDeadline: '2026-12-31' }))).toBe('Empfohlene Frist für diese Abrechnung: 31.12.2026 (die Frist der Abrechnung selbst ist nicht entschieden).')
  })
  test('Vorauszahlungen: beide getrennt ausgewiesen, in der Heizkostenabrechnung die Heizvorauszahlung', () => {
    expect(prepaymentSplit(statement({ prepaymentCents: 360000, heatingPrepaymentCents: 147600 }))).toEqual([
      { label: 'davon Heizvorauszahlung', cents: 147600 },
      { label: 'davon übrige Vorauszahlungen', cents: 212400 },
    ])
    expect(prepaymentSplit(statement({ prepaymentCents: 147600, heatingPrepaymentCents: 147600, scope: 'heating' }))).toEqual([])
    expect(prepaymentLabel(statement({ scope: 'heating' }))).toBe('abzüglich geleisteter Heizvorauszahlungen')
    expect(prepaymentLabel(statement())).toBe('abzüglich geleisteter Vorauszahlungen')
  })
})

describe('Heizkostenabrechnungen auswählen, abschließen, korrigieren', () => {
  const info = (key: string, to: string, closed: HeatingSettlementInfo['closed'] = null): HeatingSettlementInfo => ({
    plantId: 'hp1', plantName: '', period: { key: k(key), from: `${key}-01`, to, short: false, label: key }, deadline: `${Number(to.slice(0, 4)) + 1}${to.slice(4)}`, closed,
  })
  test('Auswahl: die Heizperioden, die im Zeitraum enden', () => {
    const list = [info('2024-05', '2025-04-30'), info('2025-05', '2026-04-30'), info('2026-05', '2027-04-30')]
    expect(heatingChoices(list, p2026).map((h) => h.period.key)).toEqual(['2025-05'])
  })
  test('Adressen', () => {
    expect(settlementPaths('2026', null)).toEqual({ load: '/api/settlement/2026', close: '/api/settlement/2026/close', history: '/api/settlement/2026/history' })
    expect(settlementPaths('2026', { plantId: 'hp1', period: k('2025-05') }).close).toBe('/api/heating-settlement/hp1/2025-05/close')
  })
  test('„✎ anpassen“ schreibt die Heizkorrektur der Heizperiode, endgültig', () => {
    const t = { heatingPrepaymentOverrides: [{ plantId: 'hp1', period: k('2026-05'), cents: 87600, provisional: true, fromMonth: '2026-05', toMonth: '2026-12' }] } satisfies Pick<Tenancy, 'heatingPrepaymentOverrides'>
    expect(heatingOverridesWith(t, 'hp1', k('2026-05'), 140000)).toEqual([{ plantId: 'hp1', period: '2026-05', cents: 140000, provisional: false, fromMonth: null, toMonth: null }])
    expect(heatingOverridesWith(t, 'hp1', k('2026-05'), null)).toEqual([])
  })
  test('Cockpit: jede beendete Heizperiode mit ihrer Frist', () => {
    const rows = cockpitHeatingRows([
      info('2024-05', '2025-04-30', { closedAt: '2025-08-01', sentAt: '2025-08-02' }),
      info('2025-05', '2026-04-30'),
      info('2026-05', '2027-04-30'),
    ], '2026-10-05')
    expect(rows.map((r) => [r.label, r.level])).toEqual([['Heizkostenabrechnung 2024-05', 'gruen'], ['Heizkostenabrechnung 2025-05', 'gelb']])
    expect(rows[1]?.text).toBe('Frist 30.04.2027, noch nicht versendet.')
    expect(cockpitHeatingRows([info('2024-05', '2025-04-30')], '2026-05-01')[0]).toMatchObject({ level: 'rot', text: 'Frist 30.04.2026 abgelaufen; eine Nachforderung ist ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB).' })
  })
})

describe('Kostenformular und Mietverhältnis', () => {
  test('Heizperioden einer eigenen Heizperiode im Zeitraum, und die Positionen dazu', () => {
    expect(heatingItemPeriods([plant(), plant({ id: 'hp2', periodStartMonth: null })], CALENDAR_RULES, p2026)).toEqual([
      { plantId: 'hp1', options: [{ value: '2025-05', label: 'Heizperiode 2025/2026' }] },
    ])
    const items = [
      { id: 'a', period: k('2026-01'), heatingPlantId: undefined },
      { id: 'b', period: k('2025-05'), heatingPlantId: 'hp1' },
      { id: 'c', period: k('2025-05'), heatingPlantId: undefined },
    ]
    expect(itemsOfPeriod(items, k('2026-01'), [{ plantId: 'hp1', key: '2025-05' }]).map((c) => c.id)).toEqual(['a', 'b'])
  })
  test('Staffel aus dem Formular', () => {
    expect(scheduleOf([{ from: '2025-05', amount: '123,00' }, { from: '', amount: '' }])).toEqual([{ from: '2025-05', monthlyCents: 12300 }])
    expect(scheduleOf([{ from: '2025-05', amount: 'viel' }])).toEqual({ error: 'Bitte die Staffel der Heizvorauszahlung prüfen (Monat und Betrag).' })
  })
})
```

`client/src/components/HeatingPeriodSelect.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import HeatingPeriodSelect from './HeatingPeriodSelect'

afterEach(cleanup)

test('Die Heizperiode zeigt den gespeicherten Wert', () => {
  render(<HeatingPeriodSelect options={[{ value: '2024-05', label: 'Heizperiode 2024/2025' }, { value: '2025-05', label: 'Heizperiode 2025/2026' }]} value="2025-05" onChange={() => {}} />)
  const select = screen.getByRole('combobox', { name: 'Heizperiode' }) as HTMLSelectElement
  expect(select.value).toBe('2025-05')
  expect(select.selectedOptions[0]?.textContent).toBe('Heizperiode 2025/2026')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- heatingSettlementView HeatingPeriodSelect`
Expected: FAIL, die Module gibt es nicht.

- [ ] **Step 3: `client/src/heatingSettlementView.ts`**

```ts
// Die eigene Heizperiode und die Heizkostenabrechnung auf den Seiten (Heizung PR 5, Entwurf 3.1, 3.8,
// 3.11, 11.4): Überschrift und Druckkopf, die Abrechnung nur mit Heizkosten, die Auswahl der
// Heizkostenabrechnungen, ihre Fristen im Cockpit, die Heizkorrektur, die Heizperioden im
// Kostenformular und die Heizstaffel im Mietverhältnis. Ohne DOM prüfbar.
import { fmtDate, parseEuro } from './api'
import { hasOwnRhythm, heatingPeriodsEndingIn, plantRules } from '../../shared/heatingPeriod.ts'
import { periodLabel } from '../../shared/period.ts'
import type { BillingPeriod, HeatingPlant, HeatingPrepaymentOverride, HeatingSettlementInfo, PeriodKey, PeriodRules, Settlement, Statement, Tenancy } from './types'

const sameDays = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): boolean => a.from === b.from && a.to === b.to

// „Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“ (3.1, Ausdruck).
export function settlementTitle(s: Pick<Settlement, 'period' | 'heatingPeriods' | 'scope'>): string {
  if (s.scope?.kind === 'heating') return `Heizkostenabrechnung ${s.period.label}`
  const other = (s.heatingPeriods ?? []).filter((h) => !sameDays(h.period, s.period))
  if (other.length === 0) return `Nebenkostenabrechnung ${s.period.label}`
  return `Betriebskosten ${s.period.label}, darin Heiz- und Warmwasserkosten ${other.map((h) => `${fmtDate(h.period.from)}–${fmtDate(h.period.to)}`).join(' und ')}`
}

// Für den Mieter auf seiner Abrechnung (3.1, R-A4).
export function heatingOnlyNote(st: Pick<Statement, 'heatingOnly'>): string | null {
  return st.heatingOnly
    ? 'Abrechnung nur der Heizkosten: Sie haben in diesem Abrechnungszeitraum nicht mehr hier gewohnt. Abgerechnet werden Ihre Heiz- und Warmwasserkosten aus der Heizperiode, in der Sie noch hier wohnten; eine Vorauszahlung wird nicht angerechnet, denn sie steht in Ihrer letzten Abrechnung.'
    : null
}

// Für den Vermieter, nicht für den Druck (3.8, 15.1 Nr. 2).
export function recommendedDeadlineText(st: Pick<Statement, 'heatingOnly' | 'recommendedDeadline'>): string | null {
  return st.heatingOnly && st.recommendedDeadline
    ? `Empfohlene Frist für diese Abrechnung: ${fmtDate(st.recommendedDeadline)} (die Frist der Abrechnung selbst ist nicht entschieden).`
    : null
}

export const prepaymentLabel = (st: Pick<Statement, 'scope'>): string =>
  st.scope === 'heating' ? 'abzüglich geleisteter Heizvorauszahlungen' : 'abzüglich geleisteter Vorauszahlungen'

// Bei getrennter Heizvorauszahlung weist die Gesamtabrechnung beide aus (A3); die
// Heizkostenabrechnung hat nur die eine.
export function prepaymentSplit(st: Pick<Statement, 'scope' | 'prepaymentCents' | 'heatingPrepaymentCents'>): { label: string; cents: number }[] {
  if (st.scope === 'heating' || st.heatingPrepaymentCents === undefined) return []
  return [
    { label: 'davon Heizvorauszahlung', cents: st.heatingPrepaymentCents },
    { label: 'davon übrige Vorauszahlungen', cents: st.prepaymentCents - st.heatingPrepaymentCents },
  ]
}

// Die Heizkostenabrechnungen, deren Heizperiode im gewählten Zeitraum endet: Sie gehören zu diesem
// Abrechnungsjahr, auch wenn sie ihre eigene Frist haben.
export function heatingChoices(list: readonly HeatingSettlementInfo[], p: Pick<BillingPeriod, 'from' | 'to'>): HeatingSettlementInfo[] {
  return list.filter((h) => h.period.to >= p.from && h.period.to <= p.to)
}

export function settlementPaths(param: string, target: { plantId: string; period: PeriodKey } | null): { load: string; close: string; history: string } {
  const base = target ? `/api/heating-settlement/${target.plantId}/${target.period}` : `/api/settlement/${param}`
  return { load: base, close: `${base}/close`, history: `${base}/history` }
}

// „✎ anpassen“ in der Heizkostenabrechnung: die endgültige Heizkorrektur der Heizperiode; sie ersetzt
// eine vorläufige (D2). `null` setzt zurück.
export function heatingOverridesWith(tenancy: Pick<Tenancy, 'heatingPrepaymentOverrides'>, plantId: string, period: PeriodKey, cents: number | null): HeatingPrepaymentOverride[] {
  const rest = (tenancy.heatingPrepaymentOverrides ?? []).filter((o) => !(o.plantId === plantId && o.period === period))
  return cents === null ? rest : [...rest, { plantId, period, cents, provisional: false, fromMonth: null, toMonth: null }]
}

export type HeatingDeadlineRow = { key: string; label: string; level: 'gruen' | 'gelb' | 'rot'; text: string }

// Das Cockpit führt jede beendete Heizperiode nach Weg d mit ihrer eigenen Frist (3.1, B3).
export function cockpitHeatingRows(list: readonly HeatingSettlementInfo[], today: string): HeatingDeadlineRow[] {
  return list.filter((h) => h.period.to < today).map((h) => {
    const label = `Heizkostenabrechnung ${h.period.label}${h.plantName ? ` (${h.plantName})` : ''}`
    const key = `${h.plantId}|${h.period.key}`
    const sent = h.closed?.sentAt ?? null
    if (sent !== null) {
      return sent <= h.deadline
        ? { key, label, level: 'gruen', text: `Versendet am ${fmtDate(sent)}, vor Ablauf der Frist.` }
        : { key, label, level: 'rot', text: `Versendet am ${fmtDate(sent)}, nach Ablauf der Frist ${fmtDate(h.deadline)}.` }
    }
    if (today > h.deadline) return { key, label, level: 'rot', text: `Frist ${fmtDate(h.deadline)} abgelaufen; eine Nachforderung ist ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB).` }
    return { key, label, level: 'gelb', text: `Frist ${fmtDate(h.deadline)}, noch nicht versendet.` }
  })
}

// Die Heizperioden, die das Kostenformular bei einer Heizposition anbietet: je Anlage mit eigener
// Heizperiode die, die im gewählten Zeitraum enden (Entwurf 3.0).
export function heatingItemPeriods(plants: readonly HeatingPlant[], objectRules: PeriodRules, p: Pick<BillingPeriod, 'from' | 'to'>): { plantId: string; options: { value: string; label: string }[] }[] {
  return plants.filter((plant) => hasOwnRhythm(plant)).map((plant) => ({
    plantId: plant.id,
    options: heatingPeriodsEndingIn(plantRules(plant, objectRules), p).map((h) => ({ value: h.key, label: `Heizperiode ${periodLabel(h)}` })),
  }))
}

// Die Positionen eines Zeitraums auf der Seite Kosten: seine eigenen und die Heizpositionen der
// Heizperioden, die darin enden.
export function itemsOfPeriod<T extends { period: string; heatingPlantId?: string | null }>(items: readonly T[], key: string, heatingKeys: readonly { plantId: string; key: string }[]): T[] {
  return items.filter((c) => (c.heatingPlantId ? heatingKeys.some((h) => h.plantId === c.heatingPlantId && h.key === c.period) : false) || (c.period === key && !heatingKeys.some((h) => h.plantId === c.heatingPlantId)))
}

// Die Heizstaffel aus den Zeilen des Formulars; leere Zeilen fallen weg.
export function scheduleOf(rows: readonly { from: string; amount: string }[]): { from: string; monthlyCents: number }[] | { error: string } {
  const result: { from: string; monthlyCents: number }[] = []
  for (const row of rows) {
    if (row.from === '' && row.amount.trim() === '') continue
    const cents = parseEuro(row.amount)
    if (!/^\d{4}-\d{2}$/.test(row.from) || cents === null || cents < 0) return { error: 'Bitte die Staffel der Heizvorauszahlung prüfen (Monat und Betrag).' }
    result.push({ from: row.from, monthlyCents: cents })
  }
  return result
}
```

- [ ] **Step 4: `client/src/components/HeatingPeriodSelect.tsx`**

```tsx
// Die Heizperiode einer Heizposition im Kostenformular (Heizung PR 5), aus der Optionsliste gespeist:
// So zeigt das Feld immer den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
export default function HeatingPeriodSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      Heizperiode
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
```

- [ ] **Step 5: Seiten**

`client/src/pages/Abrechnung.tsx` (Fassung von PR 3). Importe: aus `'../heatingSettlementView'`
`heatingChoices, heatingOnlyNote, heatingOverridesWith, prepaymentLabel, prepaymentSplit, recommendedDeadlineText, settlementPaths, settlementTitle`;
die Typen `HeatingSettlementInfo, PeriodKey` aus `'../types'`. Im Rumpf hinter
`const { key, label, param, calendar } = usePeriod()` (auch `period` aus `usePeriod()` holen):

```tsx
  // Heizung PR 5: die Heizkostenabrechnungen nach Weg d, deren Heizperiode in diesem Zeitraum endet.
  // Gewählt ist entweder die Betriebskostenabrechnung (`null`) oder eine von ihnen.
  const [heatingList, setHeatingList] = useState<HeatingSettlementInfo[]>([])
  const [target, setTarget] = useState<{ plantId: string; period: PeriodKey } | null>(null)
  const paths = settlementPaths(param, target)
  const choices = heatingChoices(heatingList, period)
```

In `load` (dort, wo die Abrechnung und der Verlauf geholt werden) die Adressen
`` `/api/settlement/${param}` `` durch `paths.load`, `` `/api/settlement/${param}/history` `` durch
`paths.history` ersetzen und daneben die Liste holen:

```tsx
      api<HeatingSettlementInfo[]>(withProperty('/api/heating-settlements', propertyId)).then(setHeatingList).catch(() => setHeatingList([])),
```

In `closeSettlement`, `reopenSettlement` und `saveSentAt` `` `/api/settlement/${param}/close` `` durch
`paths.close` ersetzen; die Abhängigkeiten von `load` um `paths.load` ergänzen. In `savePpOverride`
die Zeilen ab `const overrides = …` bis zum `api(…)`-Aufruf ersetzen durch:

```tsx
    // In der Heizkostenabrechnung ist „✎ anpassen“ die endgültige Heizkorrektur der Heizperiode (D2).
    const body = target
      ? { heatingPrepaymentOverrides: heatingOverridesWith(ten ?? {}, target.plantId, target.period, cents) }
      : { prepaymentOverrides: (() => { const o = { ...(ten?.prepaymentOverrides ?? {}) }; if (cents === null) delete o[key]; else o[key] = cents; return o })() }
    if (!(await attempt(() => api(`/api/tenancies/${tenancyId}`, { method: 'PUT', body: JSON.stringify(body) })))) return
```

Direkt unter dem Umschalter `<PeriodSelect />`:

```tsx
        {choices.length > 0 && (
          <div className="row no-print">
            <button className={target === null ? 'btn' : 'btn ghost'} onClick={() => setTarget(null)}>{`Betriebskosten ${label}`}</button>
            {choices.map((h) => (
              <button key={`${h.plantId}|${h.period.key}`} className={target?.period === h.period.key ? 'btn' : 'btn ghost'} onClick={() => setTarget({ plantId: h.plantId, period: h.period.key })}>
                {`Heizkosten ${h.period.label} (eigene Abrechnung, Frist ${fmtDate(h.deadline)})`}
              </button>
            ))}
          </div>
        )}
        {data?.separateHeating && data.separateHeating.length > 0 && target === null && (
          <div className="info no-print">{`Die Heizkosten ${data.separateHeating.map((h) => h.period.label).join(', ')} rechnen Sie getrennt ab; sie stehen nicht in dieser Abrechnung.`}</div>
        )}
```

Die Überschrift der gedruckten Abrechnung (`<h2 …>Nebenkostenabrechnung {label}</h2>`, PR 3) wird
`<h2 style={{ marginBottom: 2 }}>{data ? settlementTitle(data) : `Nebenkostenabrechnung ${label}`}</h2>`;
ebenso der Dateiname beim Drucken (`document.title = …`): dort `` `Nebenkostenabrechnung ${label}` `` durch
`settlementTitle(data)` ersetzen. Unter dem Kopf eines Mieters (Name, Wohnung, Zeitraum):

```tsx
                  {heatingOnlyNote(st) && <p>{heatingOnlyNote(st)}</p>}
                  {recommendedDeadlineText(st) && <p className="muted no-print">{recommendedDeadlineText(st)}</p>}
                  {st.prepaymentNote && <p className="muted">{st.prepaymentNote}</p>}
```

In der Zeile der Vorauszahlungen den festen Text `abzüglich geleisteter Vorauszahlungen` durch
`{prepaymentLabel(st)}` ersetzen und hinter dieser Tabellenzeile:

```tsx
                    {prepaymentSplit(st).map((line) => (
                      <tr key={line.label}>
                        <td colSpan={3} className="muted">{line.label}</td>
                        <td className="num muted">{fmtEuro(line.cents)}</td>
                      </tr>
                    ))}
```

`client/src/pages/Cockpit.tsx`: Importe `cockpitHeatingRows` aus `'../heatingSettlementView'`, Typ
`HeatingSettlementInfo`; ein Zustand `const [heatingList, setHeatingList] = useState<HeatingSettlementInfo[]>([])`,
geladen neben der Abrechnung mit
`api<HeatingSettlementInfo[]>(withProperty('/api/heating-settlements', propertyId)).then(setHeatingList).catch(() => setHeatingList([]))`.
Direkt unter der Zeile zur Frist der Abrechnung (Prüfung „Abgeschlossen & versendet“):

```tsx
      {cockpitHeatingRows(heatingList, localToday()).map((row) => (
        <div key={row.key} className={`check ${row.level}`}>
          <strong>{row.label}</strong> {row.text}
        </div>
      ))}
```

(`localToday` aus `'../periodForm'`, PR 3; die Klassen `check gruen|gelb|rot` sind die der übrigen
Zeilen des Cockpits; heißen sie dort anders, die dortigen nehmen.)

`client/src/pages/Mietkonto.tsx`: hinter der Tabellenzeile „NK-Vorauszahlung“:

```tsx
                    {r.heatingPrepaymentYearCents !== undefined && (
                      <tr>
                        <td>Heizvorauszahlung</td>
                        <td className="num">{fmtEuro(r.heatingPrepaymentYearCents)}</td>
                      </tr>
                    )}
```

`client/src/pages/Kosten.tsx`: Importe `HeatingPeriodSelect` aus `'../components/HeatingPeriodSelect'`,
`heatingItemPeriods, itemsOfPeriod` aus `'../heatingSettlementView'`, Typ `HeatingPlant`. Neben den
übrigen Zuständen:

```tsx
  // Heizung PR 5: Heizpositionen einer Anlage mit eigener Heizperiode tragen deren Schlüssel.
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [heatingPeriod, setHeatingPeriod] = useState('')
  useEffect(() => {
    api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)).then(setPlants).catch(() => setPlants([]))
  }, [propertyId])
  const heatingOptions = heatingItemPeriods(plants, rules, period)
  const heatingKeys = heatingOptions.flatMap((h) => h.options.map((o) => ({ plantId: h.plantId, key: o.value })))
  const ownPlant = heatingOptions[0]
```

(`rules`, `period` aus `usePeriod()`, `propertyId` wie in den übrigen Abrufen der Seite.) Wo die
Liste der Positionen des Zeitraums gefiltert wird (`c.period === key`, PR 3), stattdessen
`itemsOfPeriod(costItems, key, heatingKeys)` verwenden. Im Formular direkt hinter der Auswahl der
Kostenart:

```tsx
            {form.category === HEATING_CATEGORY && ownPlant && ownPlant.options.length > 0 && (
              <HeatingPeriodSelect options={ownPlant.options} value={heatingPeriod || (ownPlant.options[0]?.value ?? '')} onChange={setHeatingPeriod} />
            )}
```

und in der Funktion, die den Rumpf zum Speichern baut, direkt hinter der Zeile, die
`costItemBody(` aufruft (das Ergebnis heiße dort `body`):

```tsx
    // Eine Heizposition der Anlage mit eigener Heizperiode steht unter deren Heizperiode (G-A2).
    const heating = form.category === HEATING_CATEGORY && ownPlant && ownPlant.options.length > 0
      ? { period: heatingPeriod || (ownPlant.options[0]?.value ?? ''), heatingPlantId: ownPlant.plantId }
      : {}
```

und `body` beim Senden als `{ ...body, ...heating }` schicken. Beim Öffnen einer bestehenden
Heizposition `setHeatingPeriod(item.period)`.

`client/src/pages/Stammdaten.tsx`: `TenancyForm` bekommt `heatingPrepayments: { from: string; amount: string }[]`
(in der leeren Vorlage `[]`); `tenancyToForm` füllt es aus `t.heatingPrepayments` wie `flatRates`
(Betrag mit `toLocaleString('de-DE', { minimumFractionDigits: 2 })`); beim Speichern hinter dem Block
der Pauschale:

```tsx
    // Heizung PR 5: die Heizstaffel neben der übrigen Vorauszahlung (nach dem Aufteilen, Entwurf 3.1).
    const heating = scheduleOf(tenForm.heatingPrepayments)
    if ('error' in heating) {
      setError(heating.error)
      return
    }
```

und im Rumpf `heatingPrepayments: heating,` neben `flatRates`. Im Formular direkt unter der Staffel
„NK-Vorauszahlung“, nur wenn `tenForm.heatingPrepayments.length > 0`:

```tsx
              {tenForm.heatingPrepayments.length > 0 && (
                <>
                  <div className="field-group-label">davon Heizvorauszahlung je Monat — Staffel</div>
                  <p className="muted">Die Heizkosten rechnen Sie getrennt ab. Ändert sich die Vorauszahlung, tragen Sie die neue Heizvorauszahlung ab demselben Monat hier ein.</p>
                  {tenForm.heatingPrepayments.map((p, i) => (
                    <div key={i} className="row">
                      <label className="field">ab Monat
                        <input type="month" value={p.from} onChange={(e) => setTenForm({ ...tenForm, heatingPrepayments: tenForm.heatingPrepayments.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                      </label>
                      <label className="field">€ je Monat
                        <input value={p.amount} onChange={(e) => setTenForm({ ...tenForm, heatingPrepayments: tenForm.heatingPrepayments.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                      </label>
                    </div>
                  ))}
                  <button className="btn small secondary field-add" onClick={() => setTenForm({ ...tenForm, heatingPrepayments: [...tenForm.heatingPrepayments, { from: '', amount: '' }] })}>+ Änderung ab Monat …</button>
                </>
              )}
```

(Import `scheduleOf` aus `'../heatingSettlementView'`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test && npm run typecheck && npm run build`
Expected: PASS; die bestehenden Tests der Seiten (`Abrechnung.test.tsx`, `noticeFocus.test.tsx`,
`Kosten.test.tsx`, `Stammdaten.test.tsx`) bleiben grün. Holt ein Seitentest über einen eigenen
`fetch`-Stub ab, liefert der für `/api/heating-settlements` und `/api/heating-plants` die leere Liste
über seinen Rückfall `json([])`; sonst dort `if (path.startsWith('/api/heating-')) return json([])`
ergänzen.

- [ ] **Step 7: Commit**

Run: `npm test`
Expected: PASS.

```bash
git add client/src/heatingSettlementView.ts client/src/heatingSettlementView.test.ts client/src/components/HeatingPeriodSelect.tsx client/src/components/HeatingPeriodSelect.test.tsx client/src/pages/Abrechnung.tsx client/src/pages/Cockpit.tsx client/src/pages/Mietkonto.tsx client/src/pages/Kosten.tsx client/src/pages/Stammdaten.tsx
git commit -m "Oberfläche: Heizkostenabrechnung je Heizperiode, beide Staffeln, Fristen im Cockpit

Druckkopf mit eigener Heizperiode, Abrechnung nur mit Heizkosten samt empfohlener Frist,
Heizperiode im Kostenformular.

Refs #217"
```

---
### Task 13: Smoke-Test, Praxislauf, CHANGELOG, CLAUDE.md, Gesamtprüfung

**Files:**
- Modify: `scripts/smoke-test.mjs`, `scripts/umstieg-praxislauf.mjs`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alle vorigen Tasks; im Smoke-Test `request`, `json`, `assert` und die Funktion `heatingPlant` aus PR 4; im Praxislauf `fall`, `tempDir`, `withServer`, `holen`, `jsonOf`, `gleich`, `backupHolen`, `backupEinspielen` (PR 3, Fall 15).
- Produces: Prüfung der Programmdateien mit eigener Heizperiode und Weg d (Entwurf 12.4), Praxislauf Fall 17 (Entwurf 5.9: Backup mit eigener Heizperiode), CHANGELOG-Einträge, Architekturabschnitt.

- [ ] **Step 1: Smoke-Test (`scripts/smoke-test.mjs`)**

Hinter `heatingPlant` (PR 4):

```js
// Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5): Zeitraum der Heizung über die
// Vorschau, Weg d ab 05/2025 einschalten, Heizkostenabrechnung 2025/2026 mit eigener Frist lesen.
async function heatingPeriod() {
  const [anlage] = (await request('/api/heating-plants')).body
  const wechsel = await request(`/api/heating-plants/${anlage.id}/period`, json('PUT', { rules: { startMonth: 5, changes: [] }, answers: {} }))
  assert(wechsel.status === 200 && wechsel.body.periodStartMonth === 5, 'Zeitraum der Heizung Mai bis April', wechsel.body)
  const vorschau = await request(`/api/heating-plants/${anlage.id}/separate/preview`, json('POST', { separate: true, month: '2025-05' }))
  assert(vorschau.status === 200 && vorschau.body.way === 'separate', 'Vorschau der getrennten Heizkostenabrechnung', vorschau.body)
  // Die Antworten aus der Vorschau: Heizanteil wie vorgeschlagen; jede Jahreskorrektur bleibt ganz bei
  // den übrigen Vorauszahlungen, die Heizkorrekturen 0 €.
  const steps = Object.fromEntries(vorschau.body.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((r) => [r.from, r.heatingCents]))]))
  const totals = {}
  const overrides = {}
  for (const o of vorschau.body.overrides) {
    totals[o.tenancyId] = { ...(totals[o.tenancyId] ?? {}), [o.period]: o.cents ?? 0 }
    for (const a of o.asks) if (a.kind !== 'total') overrides[o.tenancyId] = { ...(overrides[o.tenancyId] ?? {}), [a.period]: 0 }
  }
  const ein = await request(`/api/heating-plants/${anlage.id}/separate`, json('PUT', { separate: true, month: '2025-05', answers: { steps, totals, overrides } }))
  assert(ein.status === 200 && ein.body.separateSpans?.length === 1, 'getrennte Heizkostenabrechnung eingeschaltet', ein.body)
  const heiz = await request(`/api/heating-settlement/${anlage.id}/2025-05`)
  assert(heiz.status === 200 && heiz.body.deadline === '2027-04-30' && heiz.body.scope?.kind === 'heating', 'Heizkostenabrechnung 2025/2026 mit eigener Frist', heiz.body)
}
```

In `backupAndRestore` hinter der Zusicherung „die Heizanlage ist nach der Wiederherstellung da“ (PR 4):

```js
  assert(anlagen[0]?.periodStartMonth === 5 && anlagen[0]?.separateSpans?.length === 1, 'Heizperiode und getrennte Abrechnung sind nach der Wiederherstellung da', anlagen)
```

In `main` hinter `await heatingPlant()`:

```js
  await heatingPeriod()
```

- [ ] **Step 2: Praxislauf, Fall 17 (`scripts/umstieg-praxislauf.mjs`)**

Im Kommentar von Fall 15 (PR 3) den Satz „Die eigene Heizperiode (Entwurf 5.9) kommt mit PR 5 dazu;
hier der Zeitraum des Objekts.“ ersetzen durch „Die eigene Heizperiode prüft Fall 17.“ Hinter Fall 16:

```js
fall(17, 'Backup mit eigener Heizperiode und getrennter Heizkostenabrechnung (#217)', async () => {
  // Entwurf 5.9: Heizperiode, Spanne nach Weg d, Heizstaffel und abgeschlossene Heizkostenabrechnung
  // überstehen Backup, Wiederherstellen und Neustart, und jede Zahl bleibt.
  const dataDir = tempDir()
  const senden = (base, pfad, method, body) => fetch(`${base}${pfad}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let anlageId = ''
  const pruefen = async (base, name) => {
    const [anlage] = await holen(base, '/api/heating-plants')
    gleich([anlage?.periodStartMonth, anlage?.separateSpans], [5, [{ from: '2025-05', until: null }]], `${name}: Heizperiode und Spanne`)
    const heiz = await holen(base, `/api/heating-settlement/${anlageId}/2025-05`)
    gleich([heiz.deadline, heiz.statements?.[0]?.prepaymentCents, heiz.closed !== null], ['2027-04-30', 147600, true], `${name}: Heizkostenabrechnung 2025/2026 abgeschlossen, 12 · 123 € angerechnet`)
    const p2026 = await holen(base, '/api/settlement/2026')
    gleich(p2026.separateHeating?.map((h) => h.period.key), ['2025-05'], `${name}: die Abrechnung 2026 enthält die Heizkosten nicht`)
    const [mieter] = await holen(base, '/api/tenancies')
    gleich(mieter?.heatingPrepayments, [{ from: '2025-05', monthlyCents: 12300 }], `${name}: die Heizstaffel ist da`)
  }
  await withServer(dataDir, async ({ base }) => {
    const unit = await jsonOf(await senden(base, '/api/units', 'POST', { name: 'EG', areaM2: 60, participates: true }))
    const mieter = await jsonOf(await senden(base, '/api/tenancies', 'POST', { unitId: unit.id, tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }))
    const { plant } = await jsonOf(await senden(base, '/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    anlageId = plant.id
    gleich((await senden(base, `/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: {} })).status, 200, 'Heizperiode Mai bis April')
    const ein = await senden(base, `/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers: { steps: { [mieter.id]: { '2025-05': 12300 } } } })
    gleich(ein.status, 200, 'Weg d ab 05/2025')
    await senden(base, '/api/costItems', 'POST', { period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst 2025/2026', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 })
    gleich((await senden(base, `/api/heating-settlement/${plant.id}/2025-05/close`, 'POST', {})).status, 201, 'Heizkostenabrechnung abgeschlossen')
    await pruefen(base, 'vor dem Backup')
    const zip = await backupHolen(base)
    await senden(base, '/api/units', 'POST', { name: 'Nach dem Backup', areaM2: 10, participates: true })
    const antwort = await backupEinspielen(base, zip)
    gleich(antwort.status, 200, 'Wiederherstellen: die Route nimmt das Archiv an')
    gleich((await holen(base, '/api/units')).length, 1, 'Wiederherstellen: der Stand des Archivs gilt')
    await pruefen(base, 'nach dem Wiederherstellen')
  })
  await withServer(dataDir, async ({ base }) => {
    await pruefen(base, 'nach dem Neustart')
  })
})
```

Run: `node scripts/umstieg-praxislauf.mjs --nur 17 && node scripts/umstieg-praxislauf.mjs --nur 15`
Expected: je Fall nur Zeilen mit „✓“ und am Ende „Alle Prüfungen bestanden.“

- [ ] **Step 3: Smoke-Test gegen eine laufende Instanz**

Run:

```bash
npm run build
D=$(mktemp -d)
CI=1 NKA_DATA_DIR="$D" NKA_UPDATE_URL=http://127.0.0.1:9/kein-internet NKA_PORT=3999 npm start > "$D.log" 2>&1 &
SERVER=$!
node scripts/smoke-test.mjs --url http://127.0.0.1:3999 --mode npm; echo "Exit $?"
kill $SERVER
```

Expected: „Alle … Prüfungen bestanden.“ und `Exit 0`, darunter „✓ Zeitraum der Heizung Mai bis April“,
„✓ getrennte Heizkostenabrechnung eingeschaltet“, „✓ Heizkostenabrechnung 2025/2026 mit eigener
Frist“ und „✓ Heizperiode und getrennte Abrechnung sind nach der Wiederherstellung da“.

- [ ] **Step 4: CHANGELOG (`CHANGELOG.md`)**

Unter `## [Unveröffentlicht]`, `### Hinzugefügt` (neben PR 1 bis PR 4):

```md
- **Eigene Heizperiode.** Rechnet Ihr Messdienst die Heizkosten etwa von Mai bis April ab, stellen
  Sie unter Stammdaten → Heizung den Zeitraum der Heizung ein, mit Vorschau. Die Heizkosten einer
  Heizperiode stehen dann in der Betriebskostenabrechnung des Jahres, in dem sie endet; vorhandene
  Heizpositionen kommen dorthin. Wer in diesem Jahr nicht mehr im Haus wohnte, bekommt eine
  Abrechnung nur mit seinen Heizkosten; Mietfuchs empfiehlt dafür die frühere Frist und sagt, bis
  wann die Abrechnung des Messdienstes anzufordern ist
  ([#217](https://github.com/speedone/mietfuchs/issues/217)).
- **Getrennte Heizkostenabrechnung.** Werden die Heizkosten mit eigener Vorauszahlung getrennt
  abgerechnet, bekommt jede Heizperiode ihre eigene Heizkostenabrechnung mit eigener Frist und
  eigenem Abschluss. Beim Einschalten teilt eine Vorschau die bisherige Vorauszahlung in
  Heizvorauszahlung und übrige Vorauszahlung, erfasst Jahreskorrekturen neu und nennt die Fristen;
  ausgeschaltet wird erst ab der ersten Heizperiode, die nicht abgeschlossen ist. Jeder Monat der
  Vorauszahlung wird genau einmal angerechnet. Mietkonto und Mietverhältnis zeigen beide
  Vorauszahlungen, das Cockpit jede Heizkostenabrechnung mit ihrer Frist
  ([#217](https://github.com/speedone/mietfuchs/issues/217)).
```

- [ ] **Step 5: CLAUDE.md**

Im Abschnitt „Architektur“ direkt hinter dem Absatz `**Heizanlage** (Heizung PR 4, …)` samt seiner
Liste:

```md
**Eigene Heizperiode und getrennte Heizkostenabrechnung** (Heizung PR 5, #217): Eine Anlage rechnet
im Zeitraum ihres Objekts ab (`period_start_month` null) oder in eigenen Heizperioden
(`period_start_month`, `heating_period_changes`, berechnet wie die Zeiträume des Objekts). Die Regeln
stehen in [shared/heatingPeriod.ts](shared/heatingPeriod.ts).

- **Positionen tragen den Schlüssel ihrer Heizperiode** (G-A2): Eine Heizposition einer Anlage mit
  eigener Heizperiode steht unter einer Heizperiode der Anlage, sonst 400. Eine neue ohne Angabe (alter
  Tab, Belegbuchung) kommt in die Heizperiode, die in ihrem Objektzeitraum endet
  (`defaultHeatingPlant`). Den Rhythmus setzt nur der Wechsel mit Vorschau
  ([server/src/db/heatingPeriodChange.ts](server/src/db/heatingPeriodChange.ts)), nie `PUT`; er
  schlüsselt die Positionen um, erfasst Korrekturen neu und lässt Abgeschlossenes unangetastet.
- **Weg b** (VIII ZR 240/07): Eine Heizperiode gehört in die Abrechnung P, in der sie endet. Der
  Schnappschuss trägt sie als `heatingParts`; `computeSettlement` rechnet jede mit derselben Funktion
  über ihre eigenen Tage (`scope: 'heatingPart'`, ohne Vorauszahlungen) und führt sie in P zusammen.
  Wer nur in der Heizperiode wohnte, bekommt `heatingOnly` mit `recommendedDeadline` und der Warnung
  `period.heating-only-statement` (15.1 Nr. 2).
- **Weg d** (Auslegung, 15.1 Nr. 21): Nur bei getrennter Abrechnung und H ≠ P. Ob eine Heizperiode
  getrennt abgerechnet wird, sagen die gespeicherten Spannen (`heating_separate_spans`: ab Monat X bis
  vor W), nicht die Antwort von heute, damit Ein- und Ausschalten nie rückwirkend wirken (C3, D1).
  Ein- und Ausschalten laufen über die Vorschau in
  [server/src/db/separateSettlement.ts](server/src/db/separateSettlement.ts); P lässt die Heizperiode
  weg, sie hat ihre eigene Abrechnung (`scope: 'heating'`, `heatingSnapshotFor`), Frist und
  Abschluss (`closed_heating_settlements` samt Verlauf; der Abschluss von P friert sie nicht ein).
  Bei H = P gibt es eine Gesamtabrechnung mit getrennt ausgewiesenen Vorauszahlungen.
- **Jeder Monat der Heizstaffel wird genau einmal angerechnet** (6.1 Nr. 5): Er gehört der getrennt
  abgerechneten Heizperiode, die ihn enthält, wenn er ab X liegt, sonst der Abrechnung P
  (`separateOwner`, die einzige Stelle). **Die Jahreskorrektur von P gilt für alles, was P anrechnet**
  (bei Weg d also nur die übrigen Vorauszahlungen); eine Heizkorrektur (`heating_prepayment_overrides`,
  endgültig oder vorläufig mit Monaten, D2) gibt es nur für eine getrennt abgerechnete Heizperiode.
  Invariante 11 prüft das über zufällige Abläufe mit Abschlüssen (invariant-heizperiode.test.ts).
- Das Mietkonto führt beide Staffeln im Soll; die Steuerübersicht nimmt Heizpositionen einer eigenen
  Heizperiode im Jahr ihrer Zahlung, bei Weg d aus der Heizkostenabrechnung, und nennt dann keine
  Vorauszahlung der Abrechnung (`prepaymentSettlementCents` null).
- Ein Wechsel des Objektzeitraums lässt Heizpositionen einer eigenen Heizperiode, wo sie sind, und
  lehnt ab, wenn er Weg d für eine Heizperiode umschalten würde.
```

Im Absatz `**API**` hinter `` `/api/heating-plants` (Heizanlage, siehe dort), `` ergänzen:
`` `/api/heating-plants/:id/period` und `/separate` (je mit `/preview`), `/api/heating-settlement/:plant/:period` (samt `/close` und `/history`) und `/api/heating-settlements` (eigene Heizperiode, siehe dort), ``.

- [ ] **Step 6: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build && node scripts/umstieg-praxislauf.mjs`
Expected: alles grün; der Praxislauf meldet jeden Fall als bestanden. Danach:

```bash
git diff --stat main -- server/test/fixtures/settlement
grep -rn "kommt mit einer späteren Version" server/src/db/heating.ts
```

Expected: keine Ausgabe beim ersten Befehl (Golden unverändert); beim zweiten nur noch die Sperren
von PR 4 für eigene Abrechnung, Etagenheizung, zweite Anlage und beheizte Fläche, keine zur eigenen
Heizperiode oder getrennten Abrechnung.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-test.mjs scripts/umstieg-praxislauf.mjs CHANGELOG.md CLAUDE.md
git commit -m "Heizperiode: Smoke-Test, Praxislauf Fall 17, CHANGELOG und Architekturabschnitt

Refs #217"
```

Danach Durchsicht mit frischem Kontext (CLAUDE.md „Durchsicht vor jedem PR“), Befunde mit einem
vorher roten Test beheben, PR gestapelt auf PR 4 mit `Refs #217` und den Befunden in der
Beschreibung. Am Ende von Phase A die Integrationsdurchsicht des Stapels PR 1–5 (Geld und Daten),
Praxislauf und `full-check` (Entwurf 13).

---
## Selbstprüfung

**1. Abdeckung des Entwurfs (Zeile PR 5 in Abschnitt 13 und die genannten Abschnitte):**

| Anforderung | Task |
|---|---|
| Rhythmus der Anlage (`period_start_month`, `heating_period_changes`, 5.1, 5.3) | 1, 3, 4 |
| Zuordnung H → P, Häufigkeit (zwei oder keine H in P), `period.no-heating-period` (3.0) | 2, 5 |
| Umschlüsseln mit Vorschau beim Rhythmuswechsel, Schreibprüfung 400 (G-A2), Abgeschlossenes nie (3.0) | 3, 4 |
| Abrechnung nur mit Heizkosten, `heatingOnly`, `recommendedDeadline`, Warnung samt Termin beim Messdienst (3.1, 3.8, L3, R-A4, 15.1 Nr. 2) | 2, 5, 6, 12 |
| F14 (12.1) | 6 |
| Weg d nur bei `separate_settlement` und H ≠ P (3.1, A3, 15.1 Nr. 21), H = P eine Gesamtabrechnung mit beiden Vorauszahlungen | 2, 5, 8 |
| `heating_prepayments`, `heating_prepayment_overrides` mit `provisional`, `from_month`, `to_month` (D2 der achten Fassung) | 1, 3, 7 |
| Aufteilen der Vorauszahlung über alle Stufen ab X, Vorbelegung mit dem Anteil der letzten Abrechnung (B1, C1) | 8 |
| X nicht vor dem letzten Abschluss (409, C3), Vermerk der früheren Anrechnung | 7, 8 |
| Neuerfassung der Jahreskorrekturen offener P, Heizkorrektur je beendeter H, Restbetrag vorläufig (C2, D2), Fristen in der Vorschau (R-g) | 8 |
| Ein- und Ausschalten über dieselbe Vorschau, Ausschalten ab W, Zusammenführen (C4, D1) | 8 |
| Jeder Monat der Heizstaffel genau einmal (6.1 Nr. 5) | 2, 5, 7, 10 |
| Heizkorrektur beim Rhythmuswechsel neu erfasst (B2, 3.6) | 4 |
| Eigene Berechnung, Route, Frist, Abschluss in `closed_heating_settlements` samt Verlauf (B3, 6.1 Nr. 7) | 7, 9 |
| `Statement.scope` (5.7), Vorschlag nach § 560 für die Heizvorauszahlung (3.7, A3) | 7 |
| P lässt Heizpositionen und Heizvorauszahlungen weg, friert die Heizkostenabrechnung nicht ein (B3) | 5, 9 |
| Hinweise `period.heating-differs`, `period.heating-only-statement`, `prepayment.heating-share-missing`, `prepayment.heating-override-pending`, `prepayment.heating-share-unchanged`, `period.no-heating-period` (10.1) | 5, 7 |
| Mietkonto mit beiden Staffeln (3.11), Steuer bei Weg d (3.10) | 5, 9, 12 |
| Einrichtung Schritt 3 mit vorgeschlagenem Weg und Zustimmungsvorbehalt (11.2) | 11 |
| Lexikon `heatingPeriod` (10.3) | 5 |
| Tests 12.2: G-A2, R3, B1/C1, B2, C2/D2 (876 €, 1.368 €, Fehlbild 984 €), C3 (492 €), C4, D1 Fall 1 (984 €) und Fall 2 (492 €), B3, A3 zweimal | 3, 4, 5, 7, 8, 9 |
| Invarianten 12.3 Nr. 4 und 11 mit Abläufen C1, C3, D1 | 10 |
| api.test (12.4): Route, Frist, Aufteilen in einer Transaktion, 409 ohne Antwort, 409 bei X und W, Ausschalten | 4, 8, 9 |
| Praxislauf, Smoke-Test, CHANGELOG, CLAUDE.md | 13 |

**2. Platzhalter:** Keine offenen Stellen. Die Marke der Migration 0020 entsteht erst beim Erzeugen;
Task 1 Step 5 nennt den Befehl, der sie ausgibt. Wo eine Seite des Clients nach PR 3 Zeilen hat, die
dieser Plan nicht wörtlich kennt (Abrechnung, Cockpit, Kosten, Stammdaten), nennt Task 12 die Stelle
über ihren Inhalt und gibt den Code vollständig.

**3. Typen und Namen über die Tasks:** `SeparateSpan.from` ist ein Monat X, `until` ein Schlüssel W
(Task 1, 2, 8); `settledSeparately`, `separateOwner`, `spanOf` (Task 2) benutzen Task 3, 4, 5, 7, 8,
9, 10. `HeatingCredit = { ownerOf }` (Task 5) nur in calc.ts. `heatingPrepaymentCents(t, plantId, h,
owns)` (Task 7). `HeatingPeriodChangeAnswers` mit `overrides` und `totals` (Task 4, 11),
`SeparateAnswers` mit `steps`, `overrides`, `totals`, `merge` (Task 8, 11, 13). `HeatingSettlementInfo`
(Task 9, 12). Die Jahreskorrektur von P gilt für alles, was P anrechnet: Task 4, 5, 8 rechnen und
fragen danach.

**4. Review Focus:** Punkt 1 → Task 3 (Test „Alter Tab“), Punkt 2 → Task 4 (Test „Eine Heizperiode in
einer abgeschlossenen Abrechnung“), Punkt 3 → Task 8 (Test „Wieder einschalten“), Punkt 4 → Task 5
(Test „R-h“), Punkt 5 → Task 4 (Test „Wechsel des Objektzeitraums, der Weg d …“).

**Abweichungen vom Entwurf, begründet:**

1. **Eine siebte Tabelle `heating_separate_spans`.** Der Entwurf nennt für PR 5 nur `separate_settlement`;
   „Ausschalten wirkt erst ab W“ und „X … rechnet nur ab X an“ verlangen aber, dass gespeichert ist,
   welche Heizperioden ab welchem Monat getrennt abgerechnet werden. Aus der Antwort von heute ließe
   sich das nicht ableiten, ohne frühere Abrechnungen umzudeuten.
2. **Eine Migration statt zwei:** Es ändert sich keine bestehende Tabelle, die Bedingungen der neuen
   stehen in ihrem `CREATE TABLE` (Muster von PR 4, Schritt 0018).
3. **Die Jahreskorrektur von P gilt für alles, was P anrechnet**, und eine Heizkorrektur gibt es nur für
   eine getrennt abgerechnete Heizperiode. Der Entwurf sagt für Weg d „enthält nur noch die übrigen“;
   bei H = P mit getrennter Vorauszahlung ist sie damit die Summe beider. So gibt es für jeden Monat
   genau eine Korrektur, und Rhythmuswechsel und Ausschalten fragen „insgesamt“ nach, wo eine
   Abrechnung P danach Heizmonate anrechnet.
4. **Zusätzliche Felder:** `Statement.prepaymentNote` (Text zu C3), `Statement.heatingPrepaymentCents`
   (getrennter Ausweis), `Settlement.heatingPeriods`, `separateHeating`, `scope`,
   `RentMonth.heatingPrepaymentCents`, `RentLedgerRow.heatingPrepaymentYearCents`, `NoticeSubject`
   `heatingPlant`. Alle erscheinen nur, wenn es sie gibt (Golden wortgleich).
5. **Ein Wechsel des Objektzeitraums, der Weg d für eine Heizperiode umschalten würde, wird abgelehnt**
   statt in derselben Vorschau aufgeteilt; der Satz verweist auf die Vorschau der Heizung (C4 „jedes
   Umschalten über dieselbe Vorschau“ bleibt so erfüllt).
6. **Den Rhythmus setzt nur die Route mit Vorschau, nach dem Anlegen** (11.2: „Nach Schritt 2 legt
   Mietfuchs die Anlage an. Zeitraum … lassen sich später ergänzen“); `POST /api/heating-plants` mit
   `periodStartMonth` lehnt mit Verweis darauf ab.
7. **Vorbelegung von X:** Beginn der Heizperiode, die heute läuft, nicht vor dem Monat nach dem letzten
   Abschluss; X gilt für alle Mietverhältnisse der Anlage. Der Entwurf sagt „Beginn der ersten H nach
   Weg d“ ohne nähere Regel.
8. **Mehrere laufende Heizperioden in einer Jahreskorrektur:** Die Vorschau fragt für alle bis auf die
   letzte den vorläufigen Betrag; die letzte bekommt den Rest (der Entwurf kennt nur eine).
9. **Termin für die Anforderung beim Messdienst:** zwei Monate vor der empfohlenen Frist, aus dem
   Beispiel des Entwurfs (31.12.2026 → Oktober 2026) abgeleitet, als Festlegung für den Text.
10. **Die Regel `period-heating-differs` (10.2) kommt nicht ins Regelverzeichnis:** Jede neue Regel ohne
    Gültigkeit stünde im Rechtsstand jeder Abrechnung, auch ohne eigene Heizperiode; der Hinweis nennt
    das Urteil im Text. Nachzuholen, wenn das Verzeichnis Regeln je Anlass filtert.
11. **Angaben je Heizperiode (`heating_periods`) sperren einen Rhythmuswechsel**, bis PR 6 sie schreibt
    und ihre Umschlüsselung mitbringt (Entwurf 3.6 „wie Positionen“).
12. **Praxislauf Fall 17 statt Erweiterung von Fall 15** (5.9): eigene Heizperiode bei einem Objekt im
    Kalenderjahr, getrennt vom Rumpf des Objekts in Fall 15.
