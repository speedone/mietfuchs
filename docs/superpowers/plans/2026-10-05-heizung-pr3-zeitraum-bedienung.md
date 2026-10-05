# Heizung PR 3: Zeitraum, Bedienung (#208) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Vermieter kann den Abrechnungszeitraum eines Objekts einstellen und wechseln (mit
Vorschau, Rumpfzeitraum und Neuerfassung der Jahreskorrekturen), Rechnungen mit Leistungszeitraum
erfassen (kalte Kosten werden beim Speichern aufgeteilt), das Jahr der Zahlung für die Steuer
angeben und bekommt im Rumpf einen Vorschlag nach § 560 Abs. 4 BGB, ohne dass sich für ein Objekt im
Kalenderjahr eine einzige Zahl ändert.

**Architecture:** PR 2 hat den Schlüssel `PeriodKey`, `shared/period.ts`, die Spalten `period` und
die Berechnung über P gebaut, aber keine Bedienung. PR 3 setzt darauf: zwei erzeugte Migrationen
(0016 Spalten, 0017 Bedingungen) bringen `cost_items.service_from`, `service_to`, `tax_year` und
`heating_part`; das Register bekommt `hkv.degree-days` und `shared/degreeDays.ts` rechnet damit;
`server/src/serviceSplit.ts` teilt kalte Kosten nach Tagen, `server/src/db/periodChange.ts`
rechnet und schreibt den Wechsel des Rhythmus mit Vorschau, `server/src/prepaymentSuggestion.ts`
rechnet den Vorschlag im Rumpf, `taxReport` schöpft bei abweichendem Zeitraum aus mehreren
Abrechnungen. In der Oberfläche wird der Jahresumschalter zum Zeitraumumschalter
(`PeriodProvider`, `usePeriod`), die Stammdaten bekommen die Karte „Abrechnungszeitraum“ und das
Kostenformular Leistungszeitraum, Jahr der Zahlung und „Brennstoff/Energie“. Jede Stelle mit dem
Kommentar „Brücke Kalenderjahr (#208): bis PR 3“ verschwindet.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest (jsdom für
Komponenten).

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (achte Fassung), maßgeblich
für PR 3: 0.6 (N3, N4), 0.7 (A1, Folgen für PR 3), 0.8 (B4), 0.9 (C5, R10, R11), 0.10 (D3), 0.11
(D3: feste Positionen derselben Art), 1.2, 3.0, 3.M, 3.4, 3.5 (Gradtagstabelle), 3.6, 3.7, 3.8, 3.10,
3.11, 4.3 (`hkv.degree-days`), 4.7, 5.1, 5.3 (`heating_part`), 5.7, 5.9 (Praxislauf 15/16), 10.1
(Zeiträume, `prepayment.no-suggestion`), 10.3 (Zeiträume, `degreeDays`), 11.1, 11.4, 12.1 (F18),
12.2 (G-A1/N4, Z-B5/R5/A11, C5, D3, D3 fest, R11, B4, A1), 12.3 (Nr. 3, 6, 10, 11, 12), 12.4, 13
(PR 3), 15.3. Ergänzend für die Oberfläche der abgelöste Teilentwurf
`feat/abrechnungszeitraum:docs/superpowers/specs/2026-10-05-abrechnungszeitraum-design.md`
Abschnitte 3.4, 5.3 und 10 (er gilt nicht, wo er dem Gesamtentwurf widerspricht: dort
Zahlenschlüssel und „größte Überschneidung“ für kalte Kosten, hier `'JJJJ-MM'` und Leistungsprinzip).

**Grundlage:** die Pläne von PR 1
(`docs/superpowers/plans/2026-10-05-heizung-pr1-rechtsregister.md`) und PR 2
(`docs/superpowers/plans/2026-10-05-heizung-pr2-zeitraum-kern.md`) auf `feat/heizung`. Von PR 2
gibt es beim Schreiben dieses Plans noch keinen Code (der Zweig `feat/heizung-pr2-zeitraum` trägt
nur den Plan); alle Namen von PR 2 sind deshalb wörtlich aus dessen Plan übernommen. Von PR 1 gibt
es Code auf `feat/heizung-pr1-rechtsregister` (Stand 915d5e3); die Typen des Registers sind daraus
abgelesen.

## Global Constraints

- **Golden wortgleich:** Unter `server/test/fixtures/settlement/` ändert sich keine Datei;
  `settlement-golden.test.ts`, `db-golden.test.ts`, `db-objekte.test.ts` und der Gleichheitstest in
  `calc-zeitraum.test.ts` (PR 2, Task 5) bleiben ohne Anpassung ihrer Erwartungen grün.
- **Wer nichts einstellt, merkt nichts** (Entwurf 1.2 Nr. 1, 11.1): Ohne Wechsel des Rhythmus und
  ohne Leistungszeitraum an einer Position gibt es keinen neuen Pflichtschritt, kein neues Feld im
  Weg, keinen neuen Hinweis und keinen anderen Betrag. Der Umschalter heißt bei einem
  Kalenderobjekt weiter „Abrechnungsjahr“ und seine Werte sind weiter Jahreszahlen.
- **Steuer und Mietkonto rechnen im Kalenderjahr** (Entwurf 3.10, 3.11): `/api/taxreport/:year`,
  `/api/receipts/tax/:year`, `/api/rentledger/:year` nehmen eine Jahreszahl. Die Steuerübersicht
  eines Objekts mit abweichendem Zeitraum schöpft aus mehreren Abrechnungen; die Ablehnung mit 400
  aus PR 2 (Task 6) fällt weg.
- **Kalte Kosten nach dem Leistungsprinzip, Heizkosten nie nach Tagen** (Entwurf 3.4, G-C1): Eine
  kalte Position, deren Leistungszeitraum zwei Abrechnungszeiträume berührt, wird beim Speichern
  tagesgenau in eine Position je Zeitraum zerlegt (Restcent nach `largestRemainder`, Kennung als
  Entscheid; §35a im selben Verhältnis; Beleg an jedem Teil). Eine Heizposition wird nie zerlegt.
  Ist ein betroffener Zeitraum abgeschlossen: 409.
- **Jahr der Zahlung** (Entwurf 3.10): `tax_year` ist `null`, wenn der Zeitraum der Position in
  einem Kalenderjahr liegt (dann ist es dieses), sonst Pflicht. Es ist eine benannte
  Vereinfachung, nicht § 11 EStG im Einzelnen.
- **Wechsel nur mit Vorschau** (Entwurf 3.6): `POST /api/properties/:id/period/preview` und
  `PUT /api/properties/:id/period`, eine Transaktion; abgeschlossene Zeiträume unantastbar (409);
  Jahreskorrekturen eines betroffenen Zeitraums werden neu erfasst, ohne Antwort wird nicht
  gespeichert (409 mit Satz). `PUT /api/properties/:id` setzt den Rhythmus weiterhin nicht.
- **§ 560 im Rumpf** (Entwurf 3.7): kalte Kosten nach Tagen; Brennstoff (`heating_part = 'fuel'`)
  mit Leistungszeitraum als Σ Beträge / Gradtagsanteil der Vereinigung der Leistungszeiträume;
  Brennstoff ohne Leistungszeitraum nach der letzten vollen Periode, sonst kein Vorschlag; feste
  Heizpositionen derselben Art als Σ Beträge × Tage der zwölf Monate / Tage der Vereinigung; fehlt
  für den Brennstoff ein Vorschlag oder ist keine Heizposition als Brennstoff gekennzeichnet, gibt
  es keinen Vorschlag (R11) und den Hinweis `prepayment.no-suggestion` mit einem von zwei Texten
  (R10). Volle Zeiträume rechnen wie bisher.
- **Rechtswerte nur im Register:** `hkv.degree-days` (Entwurf 4.3, Zeitregel `periodStart`) kommt mit
  dieser PR nach `shared/law/heizkostenv.ts`, samt Zeile in `law-history.test.ts`. Keine Zahl der
  Gradtagstabelle außerhalb von `shared/law/`; `shared/degreeDays.ts` kommt in `ENGINE_FILES` von
  `law-literals.test.ts`.
- **Migrationen:** nur mit `npm --prefix server run db:generate -- --name <name>`; Namen
  `0016_leistungszeitraum` (Spalten) und `0017_leistungszeitraum_pruefung` (Bedingungen). Keine
  Datenanweisung: jede neue Spalte ist nullbar und bleibt bei jedem Bestand `NULL`. Beide Marken in
  `server/test/migrations.test.ts`. Ein Schritt wird nie geändert.
- **Eingefrorener Eingang** (`server/src/legacy/{schema,write,migrate}.ts`) bleibt unverändert;
  `legacy/read.ts` braucht keine Änderung (die neuen Felder sind optional).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen, Commit-Nachrichten deutsch;
  Nutzertexte siezen (`anrede.test.ts`).
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace`, keine Parameter-Eigenschaften (`erasableSyntaxOnly`). Im Client endungslose Importe,
  nur aus `shared/` mit `.ts`.
- **Auswahlfelder** werden aus Optionslisten gespeist; je neuem Auswahlfeld ein jsdom-Test, dass der
  angezeigte Wert dem gespeicherten entspricht (CLAUDE.md, Tests Ebene 3).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in `api.test.ts` erledigen das `startServer`/`startServerIn`, im Praxislauf
  `withServer`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` müssen mit Exit-Status 0 enden (nicht
  hinter `grep` prüfen). Jede Commit-Nachricht ist deutsch, endet mit `Refs #208` und den
  Attribution-Zeilen der ausführenden Sitzung.
- **Arbeitszweig:** `feat/heizung-pr3-zeitraum-bedienung` von der Spitze des PR-2-Zweigs nach dessen
  Task 7 (also mit PR 1); nach dem Merge von PR 2 auf `main` umgestellt (`git rebase --onto`).

## Schnittstellen aus PR 1 und PR 2

PR 3 benutzt diese Namen unverändert; wer einen davon in PR 1 oder PR 2 anders umsetzt, zieht ihn
hier nach, bevor Task 1 beginnt.

| Herkunft | Name | Gestalt |
|---|---|---|
| PR 1 `shared/law/register.ts` | `LawParam<T, M>`, `Source`, `law`, `valueAt`, `onlyVersion`, `createLawLog`, `germanDate`, `dayBefore` | wie auf `feat/heizung-pr1-rechtsregister` (Stand 915d5e3) |
| PR 1 `shared/law/params.ts` | `LAW_PARAMS` | Liste aller Parameter |
| PR 1 `server/src/calc.ts` | `lawLog`, `lawPeriod: Period` im Kopf von `computeSettlement` | `law(param, { period: lawPeriod }, lawLog)` |
| PR 1 `server/test/law-history.test.ts`, `law-literals.test.ts` | `SHIPPED`, `ENGINE_FILES`, `ALLOWED` | PR 2 Task 7 hat `shared/period.ts` und die Zeilen `bgb.*` ergänzt |
| PR 2 `shared/types.ts` | `PeriodKey`, `PeriodRules`, `BillingPeriod`, `SettlementPeriod`, `CostItem.period`, `Property.periodRules`, `StoredAssessment.requestedPeriod`, `Settlement.period`, `Settlement.deadline` | PR-2-Plan Task 1, 2, 4, 5 |
| PR 2 `shared/period.ts` | `CALENDAR_RULES`, `parsePeriodKey`, `periodKey`, `calendarPeriod`, `startYearOf`, `isCalendarRules`, `rulesOf`, `periodOfKey`, `periodContaining`, `periodsBetween`, `previousPeriod`, `calendarYearPeriod`, `periodLabel`, `settlementPeriod`, `settlementDeadline`, `periodDays`, `periodMonths`, `PeriodContext`, `contextOf`, `periodContext`, `calendarContext`, `resolvePeriodParam` | PR-2-Plan Task 1 |
| PR 2 `server/src/db/schema.ts` | `periodChanges`, `properties.periodStartMonth`, `costItems.period`, `prepaymentOverrides.period`, `closedSettlements.period`, `closedSettlementHistory.period`, `assessments.requestedPeriod`, `periodKeyCheck` | PR-2-Plan Task 2 |
| PR 2 `server/src/db/repository.ts` | `PeriodError` (status 400), `rulesForProperty(db, propertyId)`, `requirePeriods`, `guardCostItem(db, before, after, body)`, `guardTenancy(db, before, after, body)`, `orphanPeriodKeys`, `findClosedSettlement(db, propertyId, period)` | PR-2-Plan Task 3 |
| PR 2 `server/src/snapshot.ts` | `Snapshot.period`, `Snapshot.previousPeriod`, `Snapshot.year`, `snapshotOfPeriod(source, period, previous)`, `snapshotFor(source, propertyId, period)`, `overridesByPeriod` | PR-2-Plan Task 5 |
| PR 2 `server/src/calc.ts` | `computePrepaymentCents(tenancy, period)`, `ledgerRows`, im Kopf von `computeSettlement` `period`, `year`, `diy`, `yFrom`, `yTo`, `label`, `at`; der Vorschlag `st.suggestedMonthlyCents = … \|\| period.short` | PR-2-Plan Task 5 |
| PR 2 `server/src/index.ts` | `periodOf(db, req, propertyId)`, `requireCalendarObject(db, propertyId)`, Routen `/api/settlement/:period…`, `/api/consumption/:period` | PR-2-Plan Task 6 |
| PR 2 `shared/allocation.ts`, `shared/duplicates.ts`, `shared/assessment.ts`, `shared/costItem.ts` | `previousAllocation(items, category, at: PeriodContext, description?)`, `possibleDuplicates(items, at, previous?)`, `categoryDeviationPct(items, category, at, …)`, `costItemBody(d, units, period: PeriodKey)`, `closedPeriodNotice(label)` | PR-2-Plan Task 4 |
| PR 2 `client/src/year.tsx` | `useYear(): { year, setYear, period }` | PR-2-Plan Task 4; wird in Task 8 ersetzt |

**Die Brücken.** PR 2 markiert jede Stelle, an der Oberfläche oder Belegbuchung noch in
Kalenderjahren denken, mit `// Brücke Kalenderjahr (#208): bis PR 3`. Vor Task 8 einmal ausgeben
und die Liste in die PR-Beschreibung übernehmen:

```bash
grep -rn "Brücke Kalenderjahr" client shared server/src
```

Task 8 und Task 11 beseitigen alle; Task 12 Step 6 prüft, dass keine übrig ist.

## Review Focus

1. **Ein Wechsel neben einer abgeschlossenen Abrechnung.** Der Vermieter hat 2025 abgeschlossen
   und stellt ab Mai 2025 um: Der Zeitraum 2025 würde zum Rumpf und bekäme andere Positionen.
   Erwartet: 409 mit Satz, nichts geschrieben, Abschluss und Positionen unverändert. Test in Task 4.
2. **Eine Gutschrift mit Leistungszeitraum über zwei Zeiträume.** Erwartet: beide Teile negativ,
   Summe exakt der Betrag, kein Teil mit dem falschen Vorzeichen, ein §35a-Anteil nur, wo er
   erlaubt ist (bei einer Gutschrift keiner). Test in Task 3.
3. **Eine veraltete Vorschau** (zweiter Tab, doppelt abgeschickt): Antworten zu Gruppen oder
   Jahreskorrekturen, die es nach dem Stand der Datenbank nicht mehr gibt oder die fehlen. Erwartet:
   409 mit der neuen Vorschau, nichts geschrieben; ein zweiter identischer Wechsel ergibt 400
   („Es ändert sich nichts“). Test in Task 4.
4. **Kalenderobjekt mit Leistungszeitraum im eigenen Jahr** (Wasserrechnung 01.01.–31.12.2025 in
   2025): kein Aufteilen, kein Hinweis, kein Jahr der Zahlung, keine andere Zahl, der Umschalter
   bleibt „Abrechnungsjahr“ mit Jahreszahlen. Tests in Task 2, 5, 7 und 8.
5. **Schaltjahr im Rumpf:** Rumpf 01.01.–30.04.2028 mit Jahreswartung für 2028 (366 Tage) und
   Gasrechnung über den 29.02.2028. Erwartet: die Jahreswartung zählt mit dem Jahresbetrag (nicht
   × 365/366), der 29.02. zählt mit 150/29 ‰. Tests in Task 1 und Task 6.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/law/heizkostenv.ts`, `shared/law/params.ts` | Parameter `hkv.degree-days` | 1 |
| `shared/degreeDays.ts` (neu) | Gradtagsanteil einer Vereinigung von Spannen, Tage der Vereinigung | 1 |
| `shared/types.ts` | `HeatingPart`, Felder an `CostItem`, `SplitPreviewPart`, `PeriodChangePreview`, `PeriodChangeAnswers`, `TaxReport.settlementPeriods` | 2, 3, 4, 7 |
| `server/src/db/schema.ts`, `server/drizzle/0016_*`, `0017_*`, `meta/*` | Spalten und Bedingungen | 2 |
| `server/src/db/read.ts`, `server/src/db/repository.ts` | Lesen, Schreiben, Schreibprüfungen, Aufteilen | 2, 3 |
| `server/src/serviceSplit.ts` (neu) | Aufteilen nach Tagen, Bezeichnung des Anteils | 3 |
| `server/src/db/periodChange.ts` (neu) | Vorschau und Wechsel des Rhythmus | 4 |
| `server/src/snapshot.ts` | `SnapshotCostItem` mit den neuen Feldern | 2 |
| `server/src/calc.ts` | Hinweise `period.*`, Vorschlag im Rumpf, Steuer über mehrere Abrechnungen | 5, 6, 7 |
| `server/src/prepaymentSuggestion.ts` (neu) | Jahresfaktoren je Position im Rumpf | 6 |
| `shared/glossary.ts` | `billingPeriod`, `shortPeriod`, `accrualPrinciple`, `degreeDays` | 5 |
| `server/src/index.ts` | Routen Aufteilen, Wechsel, Steuer, Belegbuchung | 3, 4, 7, 11 |
| `client/src/period.tsx` (ersetzt `year.tsx`), `client/src/periodForm.ts` (neu), `client/src/components/PeriodSelect.tsx` (neu) | Zeitraumumschalter | 8 |
| Seiten und Helfer des Clients | Brücken entfernen, Zeitraum statt Jahr | 8, 9, 11 |
| `client/src/components/CostPeriodFields.tsx` (neu), `client/src/costForm.ts`, `client/src/pages/Kosten.tsx`, `shared/costItem.ts` | Leistungszeitraum, Jahr der Zahlung, Brennstoff, Aufteilen | 9 |
| `client/src/components/PeriodCard.tsx` (neu), `client/src/pages/Stammdaten.tsx` | Karte „Abrechnungszeitraum“ mit Wechsel | 10 |
| `shared/assessment.ts`, `server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/db/booking.ts`, `server/src/db/assessments.ts` | Belegbuchung im Zeitraum des Objekts | 11 |
| `server/test/fixtures/period/F18-rumpfzeitraum/README.md` (neu), `server/test/period-golden.test.ts` (neu), `scripts/umstieg-praxislauf.mjs`, `shared/guides.ts`, `CHANGELOG.md`, `CLAUDE.md` | F18, Praxislauf 15/16, Anleitung, Doku | 12 |

---
### Task 1: Gradtage im Rechtsregister (`hkv.degree-days`, `shared/degreeDays.ts`)

Der Entwurf weist `hkv.degree-days` PR 3 zu (4.3, N3): Der Vorschlag nach § 560 rechnet im Rumpf
Brennstoff nach Gradtagen hoch. Die Tabelle steht im Register, die Rechnung über Tage und
Vereinigungen in `shared/degreeDays.ts`, das keine Zahl der Tabelle enthält.

**Files:**
- Modify: `shared/law/heizkostenv.ts`, `shared/law/params.ts`
- Create: `shared/degreeDays.ts`
- Test: `server/test/degree-days.test.ts` (neu); Modify: `server/test/law-history.test.ts`, `server/test/law-literals.test.ts`

**Interfaces:**
- Consumes: `LawParam`, `Source` (PR 1, `shared/law/register.ts`); `LAW_PARAMS` (PR 1).
- Produces:
  - `type DegreeDayTable = { readonly months: { readonly [month: string]: number }; readonly summer: number; readonly summerMonths: readonly string[] }` (`shared/law/heizkostenv.ts`)
  - `hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'>` (`shared/law/heizkostenv.ts`)
  - `type DayRange = { from: string; to: string }`, `unionOf(ranges): DayRange[]`, `unionDays(ranges): number`, `degreeDayPermille(ranges, table): number`, `yearDaysFrom(from: string): number` (`shared/degreeDays.ts`)

- [ ] **Step 1: Write the failing test**

`server/test/degree-days.test.ts`:

```ts
// Gradtage (#208, Entwurf 3.5): Die Tabelle steht im Rechtsregister (`hkv.degree-days`), die
// Rechnung über Tage und Vereinigungen in shared/degreeDays.ts. Geprüft wird an den Zahlen des
// Entwurfs (3.2, 3.7, 12.2) und an Schaltjahren.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { degreeDayPermille, unionDays, unionOf, yearDaysFrom } from '../../shared/degreeDays.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'

const table = onlyVersion(hkvDegreeDays).value
const pm = (from: string, to: string): number => degreeDayPermille([{ from, to }], table)
const close = (actual: number, expected: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} statt ${expected}`)

test('Gradtage: ein Jahr hat 1.000 Promille, auch über den Jahreswechsel und im Schaltjahr', () => {
  close(pm('2025-01-01', '2025-12-31'), 1000, 'Kalenderjahr 2025')
  close(pm('2024-03-01', '2025-02-28'), 1000, 'März 2024 bis Februar 2025 (Entwurf C5)')
  close(pm('2028-01-01', '2028-12-31'), 1000, 'Schaltjahr 2028')
  close(pm('2024-01-01', '2025-01-31'), 1170, 'dreizehn Monate liegen über 1.000')
})

test('Gradtage: die Zahlen des Entwurfs (3.2, 3.7)', () => {
  close(pm('2025-01-01', '2025-04-30'), 530, 'Winter-Rumpf Januar bis April')
  close(pm('2025-01-01', '2025-02-28'), 320, 'Januar und Februar')
  close(pm('2025-03-01', '2025-04-30'), 210, 'März und April')
  close(pm('2025-05-01', '2025-08-31'), 80, 'Sommer-Rumpf Mai bis August')
  assert.equal(pm('2025-03-15', '2025-12-31').toFixed(2), '621.29')
  assert.equal(pm('2025-05-01', '2026-03-14').toFixed(2), '848.71')
})

test('Gradtage: Tageswerte, der 29. Februar und der Sommer', () => {
  close(pm('2025-10-01', '2025-10-01'), 80 / 31, 'ein Oktobertag ist 80/31 (ista)')
  close(pm('2028-02-29', '2028-02-29'), 150 / 29, 'der 29.02. im Schaltjahr ist 150/29')
  close(pm('2028-02-01', '2028-02-29'), 150, 'der ganze Februar bleibt 150')
  close(pm('2025-07-15', '2025-07-15'), 40 / 92, 'ein Sommertag ist 40/92')
})

test('Gradtage: die Vereinigung zählt Überschneidungen einmal und fasst Angrenzendes zusammen', () => {
  const ranges = [{ from: '2025-03-01', to: '2025-04-30' }, { from: '2025-01-01', to: '2025-02-28' }, { from: '2025-02-01', to: '2025-03-31' }]
  assert.deepEqual(unionOf(ranges), [{ from: '2025-01-01', to: '2025-04-30' }])
  close(degreeDayPermille(ranges, table), 530, 'Januar bis April einmal')
  assert.equal(unionDays([{ from: '2025-01-01', to: '2025-02-28' }, { from: '2025-03-01', to: '2025-04-30' }]), 120)
  assert.deepEqual(unionOf([{ from: '2025-01-01', to: '2025-01-31' }, { from: '2025-03-01', to: '2025-03-31' }]),
    [{ from: '2025-01-01', to: '2025-01-31' }, { from: '2025-03-01', to: '2025-03-31' }], 'eine Lücke bleibt eine Lücke')
  assert.equal(degreeDayPermille([], table), 0)
})

test('Tage der zwölf Monate ab einem Beginn: 365, über einen 29. Februar 366', () => {
  assert.equal(yearDaysFrom('2025-01-01'), 365)
  assert.equal(yearDaysFrom('2028-01-01'), 366)
  assert.equal(yearDaysFrom('2027-05-01'), 366)
  assert.equal(yearDaysFrom('2028-05-01'), 365)
})

test('Register: hkv.degree-days nennt § 9b Abs. 2, gilt nach dem Beginn des Zeitraums und hat zwölf Monate', () => {
  assert.equal(hkvDegreeDays.timing, 'periodStart')
  assert.match(hkvDegreeDays.norm, /§ 9b Abs\. 2 HeizkostenV/)
  const months = [...Object.keys(table.months), ...table.summerMonths].sort()
  assert.deepEqual(months, ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'])
  const sum = Object.values(table.months).reduce((a, n) => a + n, 0) + table.summer
  assert.equal(sum, 1000)
})
```

In `server/test/law-history.test.ts` am Ende von `SHIPPED` ergänzen:

```ts
  // 0.11.0 (Heizung PR 3, #208)
  'hkv.degree-days|||{"months":{"01":170,"02":150,"03":130,"04":80,"05":40,"09":30,"10":80,"11":120,"12":160},"summer":40,"summerMonths":["06","07","08"]}',
```

In `server/test/law-literals.test.ts` `shared/degreeDays.ts` in `ENGINE_FILES` aufnehmen (nach
PR 2 Task 7 steht dort schon `shared/period.ts`):

```ts
const ENGINE_FILES = ['server/src/calc.ts', 'server/src/snapshot.ts', 'shared/heating.ts', 'shared/period.ts', 'shared/degreeDays.ts']
```

und am Ende der Datei anfügen:

```ts
// Die Gradtagstabelle steht nur im Register (Entwurf 4.7: „die Zahlen von Stufen- und
// Gradtagstabelle als Feld“). Geprüft wird der Code ohne Kommentare, nicht nur die Texte: Eine
// Tabelle wäre ein Objekt aus Zahlen und fiele dem Scanner der Zeichenketten nicht auf.
test('Rechtszahlen: die Gradtagstabelle steht nur im Register (#208)', () => {
  const code = fs.readFileSync(path.join(ROOT, 'shared/degreeDays.ts'), 'utf8')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /\b(170|150|130|160|120)\b/, 'shared/degreeDays.ts enthält einen Wert der Gradtagstabelle')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/degree-days.test.ts test/law-history.test.ts test/law-literals.test.ts`
Expected: FAIL. `degree-days.test.ts` mit `ERR_MODULE_NOT_FOUND` für `shared/degreeDays.ts`,
`law-history.test.ts` mit „ausgelieferte Fassung geändert oder entfernt: hkv.degree-days…“,
`law-literals.test.ts` mit „shared/degreeDays.ts gibt es nicht; die Liste ist veraltet“.

- [ ] **Step 3: Parameter ins Register**

An `shared/law/heizkostenv.ts` anhängen:

```ts
// Gradtagszahlen: welcher Teil eines Jahres an Heizwärme auf einen Monat entfällt, in Promille;
// Juni bis August zusammen (Entwurf 3.5). Verankert in § 9b Abs. 2 HeizkostenV, der für die
// übrigen Wärmekosten beim Nutzerwechsel die „aus anerkannten Regeln der Technik ergebenden
// Gradtagszahlen“ nennt. Werte nach ista (Fachwissen „Gradtagszahlentabelle“) und Berliner
// Mieterverein, Info 73, beide gelesen am 05.10.2026; Herkunft VDI 2067 Blatt 1 (12/1983),
// Tabelle 22, heute in DIN 94680 angewandt (Minol). ⟨Norm offen: DIN 94680⟩ (Entwurf 15.3).
// Mit PR 3 rechnet nur der Vorschlag nach § 560 BGB im Rumpfzeitraum damit; die Abgrenzung von
// Lieferungen (PR 7) und der Nutzerwechsel (PR 10) folgen.
export type DegreeDayTable = {
  readonly months: { readonly [month: string]: number }
  readonly summer: number
  readonly summerMonths: readonly string[]
}

export const hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'> = {
  id: 'hkv.degree-days',
  title: 'Gradtagszahlen',
  norm: '§ 9b Abs. 2 HeizkostenV (anerkannte Regeln der Technik)',
  timing: 'periodStart',
  versions: [{
    value: {
      months: { '01': 170, '02': 150, '03': 130, '04': 80, '05': 40, '09': 30, '10': 80, '11': 120, '12': 160 },
      summer: 40,
      summerMonths: ['06', '07', '08'],
    },
    source: {
      rank: 'practice',
      cite: 'ista, Gradtagszahlentabelle; Berliner Mieterverein, Info 73; Herkunft VDI 2067 Blatt 1 (12/1983), Tabelle 22',
      url: 'https://www.ista.com/de/kontakt-service/fachwissen/gradtagszahlentabelle/',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Gradtagszahlentabelle nach VDI 2067 Blatt 1 (12/1983), heute DIN 94680',
  }],
  describe: (v) =>
    `${Object.entries(v.months).map(([m, n]) => `${m}: ${n}`).join(', ')}, ${v.summerMonths.join('/')} zusammen ${v.summer} (Promille je Monat)`,
}
```

In `shared/law/params.ts` `hkvDegreeDays` in den Import aus `./heizkostenv.ts` aufnehmen und in
`LAW_PARAMS` hinter `hkvCutRemoteReading` einreihen:

```ts
  hkvCutRemoteReading,
  hkvDegreeDays,
```

- [ ] **Step 4: `shared/degreeDays.ts`**

```ts
// Gradtage (#208, Entwurf 3.5): welcher Anteil eines Jahres an Heizwärme auf eine Zeitspanne
// entfällt. Ein Jahr hat 1.000 Promille; ein Monat seinen Wert aus der Tabelle des Registers
// (`hkv.degree-days`), Juni bis August zusammen den Sommerwert. Innerhalb eines Monats zählt jeder
// Tag gleich (Monatswert ÷ Tage des Monats, im Februar eines Schaltjahres ÷ 29), im Sommer der
// Sommerwert ÷ Tage von Juni bis August. Diese Tageswerte sind eine Festlegung (Entwurf 3.5, 15.3,
// ⟨Norm offen: DIN 94680⟩); ista nennt sie beispielhaft (Oktober 80/31).
//
// Die Tabelle kommt als Argument herein und wird hier nicht gelesen: Die Berechnung holt sie mit
// `law()`, damit der Wert, mit dem gerechnet wurde, mit der Abrechnung einfriert, und diese Datei
// enthält keine Zahl der Tabelle (law-literals.test.ts). Liegt in shared/, weil der Server rechnet
// und das Lexikon dieselbe Tabelle erklärt. Hängt an keiner Uhr und keiner Locale.

import type { DegreeDayTable } from './law/heizkostenv.ts'

export type DayRange = { from: string; to: string }

const MS_DAY = 86400000
const toUTC = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

// Die Spannen, überlappende und aneinandergrenzende zusammengefasst, aufsteigend. Eine Spanne mit
// Ende vor dem Beginn fällt weg.
export function unionOf(ranges: readonly DayRange[]): DayRange[] {
  const sorted = ranges.filter((r) => r.from <= r.to).map((r) => ({ ...r })).sort((a, b) => toUTC(a.from) - toUTC(b.from))
  const result: DayRange[] = []
  for (const r of sorted) {
    const last = result[result.length - 1]
    if (last && toUTC(r.from) <= toUTC(last.to) + MS_DAY) {
      if (r.to > last.to) last.to = r.to
    } else {
      result.push(r)
    }
  }
  return result
}

// Tage der Vereinigung, Grenzen einschließlich.
export function unionDays(ranges: readonly DayRange[]): number {
  return unionOf(ranges).reduce((a, r) => a + Math.round((toUTC(r.to) - toUTC(r.from)) / MS_DAY) + 1, 0)
}

// Tage der zwölf Monate ab einem Beginn: 365, über einen 29. Februar 366. „Genau zwölf Monate
// ergeben den Jahresbetrag“ (Entwurf 3.7, D3) heißt deshalb nicht immer × 365.
export function yearDaysFrom(from: string): number {
  const start = new Date(toUTC(from))
  const end = new Date(toUTC(from))
  end.setUTCFullYear(end.getUTCFullYear() + 1)
  return Math.round((end.getTime() - start.getTime()) / MS_DAY)
}

function dayValue(iso: string, table: DegreeDayTable): number {
  const year = Number(iso.slice(0, 4))
  const month = iso.slice(5, 7)
  if (table.summerMonths.includes(month)) {
    const summerDays = table.summerMonths.reduce((a, m) => a + daysInMonth(year, Number(m)), 0)
    return table.summer / summerDays
  }
  const monthly = table.months[month]
  if (monthly === undefined) throw new Error(`Die Gradtagstabelle hat keinen Wert für den Monat ${month}.`)
  return monthly / daysInMonth(year, Number(month))
}

// Promille der Gradtage über die Vereinigung der Spannen: Was sich überschneidet, zählt einmal.
// Zwölf Monate ergeben 1.000, mehr als zwölf Monate mehr (Entwurf 3.7: „über zwölf Monate liegt
// der Gradtagsanteil über 1.000 ‰ und senkt den Betrag entsprechend“).
export function degreeDayPermille(ranges: readonly DayRange[], table: DegreeDayTable): number {
  let sum = 0
  for (const r of unionOf(ranges)) {
    for (let t = toUTC(r.from); t <= toUTC(r.to); t += MS_DAY) sum += dayValue(isoOf(t), table)
  }
  return sum
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/degree-days.test.ts test/law-history.test.ts test/law-literals.test.ts test/law.test.ts && npm run typecheck`
Expected: PASS (degree-days 6 Tests); `law.test.ts` findet den neuen Parameter in `LAW_PARAMS`
und prüft Quelle, URL und Abruf; typecheck ohne Fehler.

- [ ] **Step 6: Commit**

```bash
git add shared/law/heizkostenv.ts shared/law/params.ts shared/degreeDays.ts server/test/degree-days.test.ts server/test/law-history.test.ts server/test/law-literals.test.ts
git commit -m "Zeitraum: Gradtagszahlen im Rechtsregister und Gradtagsanteil einer Zeitspanne

Refs #208"
```

---
### Task 2: Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal an der Kostenposition

Vier nullbare Spalten an `cost_items` (Entwurf 5.1: `service_from`, `service_to`, `tax_year` mit
PR 3; `heating_part` mit PR 3 nach A1), zwei erzeugte Schritte (Spalten, dann Bedingungen), Lesen
und Schreiben, und die Schreibprüfungen, die die Datenbank nicht leisten kann: Gibt es den
Abrechnungszeitraum über zwei Kalenderjahre, ist das Jahr der Zahlung Pflicht; eine kalte Rechnung
über zwei Zeiträume wird nicht als eine Position angenommen (das Aufteilen kommt mit Task 3).

**Files:**
- Modify: `shared/types.ts`, `server/src/db/schema.ts`, `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/snapshot.ts`
- Create (erzeugt): `server/drizzle/0016_leistungszeitraum.sql`, `server/drizzle/0017_leistungszeitraum_pruefung.sql`, `server/drizzle/meta/0016_snapshot.json`, `server/drizzle/meta/0017_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Test: `server/test/db-leistungszeitraum.test.ts` (neu); Modify: `server/test/migrations.test.ts`, `server/test/db-repository.test.ts`, `server/test/db-stock.test.ts`

**Interfaces:**
- Consumes (PR 2): `PeriodError`, `rulesForProperty`, `requirePeriods`, `guardCostItem(db, before, after, body)`, `periodOfKey`, `periodsBetween`, `periodLabel`; `CostItem.period`.
- Produces:
  - `type HeatingPart = 'fuel' | 'operating' | 'metering'` (`shared/types.ts`)
  - `CostItem.serviceFrom?: string`, `CostItem.serviceTo?: string`, `CostItem.taxYear?: number`, `CostItem.heatingPart?: HeatingPart`
  - `HEATING_PARTS` (`server/src/db/schema.ts`), Spalten `costItems.serviceFrom`, `serviceTo`, `taxYear`, `heatingPart`
  - `SnapshotCostItem` pickt zusätzlich `'serviceFrom' | 'serviceTo' | 'taxYear' | 'heatingPart'`
  - `export async function rulesForProperty(db: Executor, propertyId: string): Promise<PeriodRules>` (in PR 2 privat, jetzt exportiert)
  - `type CostItemGuardOptions = { splitPart?: boolean }`; `guardCostItem(db, before, after, body, options?: CostItemGuardOptions)`
  - `spansTwoYears(p: Pick<BillingPeriod, 'from' | 'to'>): boolean`, `formatDayRange(from: string, to: string): string` (`shared/period.ts`)

- [ ] **Step 1: Write the failing test**

`server/test/db-leistungszeitraum.test.ts`:

```ts
// Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal (#208, Entwurf 3.4, 3.10, 5.3): die
// Spalten nach 0016/0017 und die Schreibprüfungen. Das Aufteilen einer Rechnung über zwei
// Zeiträume prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, findEntity, PeriodError, updateEntity } from '../src/db/repository.ts'
import { periodChanges, properties } from '../src/db/schema.ts'
import { formatDayRange, spansTwoYears } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-leistung-'))

function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

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

// Einen Rhythmus setzt in dieser Datei die Datenbank selbst; die Bedienung prüft db-wechsel.test.ts.
const setRules = (opened: OpenedDatabase, startMonth: number, changes: string[]) =>
  opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: startMonth }).where(eq(properties.id, 'objekt-1'))
    for (const fromMonth of changes) await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth })
  })

const item = (over: Record<string, unknown>) => ({ propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', ...over })
const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)

test('Kette: 0016 und 0017 bringen vier nullbare Spalten, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag === '0016_leistungszeitraum')
    if (bis < 0) assert.fail('Schritt 0016_leistungszeitraum fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('alt', 'objekt-1', '2024-01', 'Grundsteuer', 'G', 100, 'area')`)
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT service_from, service_to, tax_year, heating_part FROM cost_items WHERE id = 'alt'"), [[null, null, null, null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Leistungszeitraum paarweise, geordnet und als Datum, Jahr 1900 bis 2200, Brennstoff nur bei Heizkosten', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const insert = (id: string, columns: string, values: string, category = 'Grundsteuer') =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${columns}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'G', 1, 'area'${values})`
    assert.equal(rejects(c, insert('ok', ', service_from, service_to, tax_year', ", '2025-01-01', '2025-12-31', 2025")), null)
    assert.match(rejects(c, insert('a', ', service_from', ", '2025-01-01'")) ?? '', /cost_items_service_pair/)
    assert.match(rejects(c, insert('b', ', service_from, service_to', ", '2025-12-31', '2025-01-01'")) ?? '', /cost_items_service_order/)
    assert.match(rejects(c, insert('c', ', service_from, service_to', ", '01.01.2025', '31.12.2025'")) ?? '', /cost_items_service_from_date/)
    assert.match(rejects(c, insert('d', ', tax_year', ', 1899')) ?? '', /cost_items_tax_year_range/)
    assert.match(rejects(c, insert('e', ', heating_part', ", 'kohle'", 'Heizung und Warmwasser')) ?? '', /cost_items_heating_part_known/)
    assert.match(rejects(c, insert('f', ', heating_part', ", 'fuel'")) ?? '', /cost_items_heating_part_category/)
    assert.equal(rejects(c, insert('g', ', heating_part', ", 'fuel'", 'Heizung und Warmwasser')), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Kalenderobjekt: ein Leistungszeitraum im eigenen Jahr wird gespeichert, ohne Jahr der Zahlung und ohne Aufteilen (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    const gespeichert = await opened.write((db) => createEntity(db, 'costItems', 'w', item({ category: 'Wasser/Abwasser', description: 'Wasser 2025', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })))
    assert.deepEqual([fieldOf(gespeichert, 'serviceFrom'), fieldOf(gespeichert, 'serviceTo'), fieldOf(gespeichert, 'taxYear')], ['2025-01-01', '2025-12-31', undefined])
    // Ein Jahr der Zahlung, das dem Kalenderjahr gleicht, ist erlaubt; ein anderes nicht (Entwurf 3.10: „ist es dieses“).
    await opened.write((db) => updateEntity(db, 'costItems', 'w', { taxYear: 2025 }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'w', { taxYear: 2026 })),
      (err: unknown) => err instanceof PeriodError && /liegt im Kalenderjahr 2025/.test(err.message))
    // Ohne Leistungszeitraum ändert sich nichts gegenüber heute.
    const ohne = await opened.write((db) => createEntity(db, 'costItems', 'g', item({})))
    assert.equal(fieldOf(ohne, 'serviceFrom'), undefined)
  })
})

test('Leistungszeitraum: beide oder keines, geordnet, als Datum; geleert wird mit null', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ serviceFrom: '2025-01-01' }))),
      (err: unknown) => err instanceof PeriodError && /fehlt ein Ende des Leistungszeitraums/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'b', item({ serviceFrom: '2025-12-31', serviceTo: '2025-01-01' }))),
      (err: unknown) => err instanceof PeriodError && /endet vor seinem Beginn/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c', item({ serviceFrom: '1.1.2025', serviceTo: '31.12.2025' }))),
      (err: unknown) => err instanceof PeriodError && /kein gültiges Datum/.test(err.message))
    await opened.write((db) => createEntity(db, 'costItems', 'd', item({ serviceFrom: '2025-01-01', serviceTo: '2025-06-30' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'd', { serviceFrom: null, serviceTo: null }))
    const d = await opened.read((db) => findEntity(db, 'costItems', 'd'))
    assert.deepEqual([fieldOf(d, 'serviceFrom'), fieldOf(d, 'serviceTo')], [undefined, undefined])
  })
})

test('Brennstoff/Energie nur bei der Kostenart „Heizung und Warmwasser“', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ heatingPart: 'fuel' }))),
      (err: unknown) => err instanceof PeriodError && /nur bei der Kostenart „Heizung und Warmwasser“/.test(err.message))
    const gas = await opened.write((db) => createEntity(db, 'costItems', 'b', item({ category: 'Heizung und Warmwasser', description: 'Gas', heatingPart: 'fuel' })))
    assert.equal(fieldOf(gas, 'heatingPart'), 'fuel')
    // Ein unbekannter Wert hat keine Spalte und kommt nicht an (#60).
    const fremd = await opened.write((db) => createEntity(db, 'costItems', 'c', item({ category: 'Heizung und Warmwasser', description: 'Gas', heatingPart: 'kohle' })))
    assert.equal(fieldOf(fremd, 'heatingPart'), undefined)
  })
})

test('Mai bis April: Das Jahr der Zahlung ist Pflicht und liegt zwischen Beginn und Ende + 1', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 5, [])
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ period: '2025-05' }))),
      (err: unknown) => err instanceof PeriodError && /reicht über zwei Kalenderjahre/.test(err.message) && /Jahr der Zahlung/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'b', item({ period: '2025-05', taxYear: 2028 }))),
      (err: unknown) => err instanceof PeriodError && /zwischen 2025 und 2027/.test(err.message))
    const ok = await opened.write((db) => createEntity(db, 'costItems', 'c', item({ period: '2025-05', taxYear: 2026 })))
    assert.equal(fieldOf(ok, 'taxYear'), 2026)
  })
})

test('Eine kalte Rechnung über zwei Zeiträume wird nicht als eine Position angenommen; eine Heizrechnung schon', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }))),
      (err: unknown) => err instanceof PeriodError && /betrifft die Abrechnungszeiträume 01\.01\.–30\.04\.2025 und 2025\/2026/.test(err.message) && /„Aufteilen und speichern“/.test(err.message))
    // Heizkosten werden nicht nach Tagen geteilt (G-C1); die Abrechnung warnt (Task 5).
    const heizung = await opened.write((db) => createEntity(db, 'costItems', 'b', item({ category: 'Heizung und Warmwasser', description: 'Wartung', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })))
    assert.equal(fieldOf(heizung, 'serviceTo'), '2025-12-31')
    // Ein Leistungszeitraum ganz in einem anderen Zeitraum ist erlaubt (Abflussprinzip bleibt möglich); die Abrechnung warnt.
    await opened.write((db) => createEntity(db, 'costItems', 'c', item({ serviceFrom: '2024-01-01', serviceTo: '2024-12-31' })))
  })
})

test('shared/period.ts: zwei Kalenderjahre und die Bezeichnung einer Tagesspanne', () => {
  assert.equal(spansTwoYears({ from: '2025-05-01', to: '2026-04-30' }), true)
  assert.equal(spansTwoYears({ from: '2025-01-01', to: '2025-04-30' }), false)
  assert.equal(formatDayRange('2025-01-01', '2025-04-30'), '01.01.–30.04.2025')
  assert.equal(formatDayRange('2025-11-01', '2026-04-30'), '01.11.2025–30.04.2026')
  assert.equal(formatDayRange('2025-03-15', '2025-03-15'), '15.03.2025')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-leistungszeitraum.test.ts`
Expected: FAIL beim Import: `formatDayRange` und `spansTwoYears` gibt es nicht in
`shared/period.ts`.

- [ ] **Step 3: Typen und Helfer**

In `shared/types.ts` vor `export type CostItem`:

```ts
// Teil der Heizkosten (#208, Entwurf 5.3, A1): Brennstoff/Energie, Betrieb, Messdienst. Mit PR 3
// bietet die Oberfläche nur „Brennstoff/Energie“ an; der Vorschlag nach § 560 BGB im Rumpf rechnet
// Brennstoff nach Gradtagen hoch. Pflicht wird die Angabe mit der eigenen Heizkostenabrechnung.
export type HeatingPart = 'fuel' | 'operating' | 'metering'
```

In `CostItem` hinter `period: PeriodKey`:

```ts
  // Der Leistungszeitraum der Rechnung (#208, Entwurf 3.4): beide oder keines, je 'JJJJ-MM-TT' mit
  // inklusiven Grenzen. Eine kalte Rechnung über zwei Abrechnungszeiträume ist in je eine Position
  // aufgeteilt; jeder Teil trägt den ganzen Leistungszeitraum der Rechnung, sein Betrag ist der
  // Anteil seines Zeitraums.
  serviceFrom?: string
  serviceTo?: string
  // Das Jahr der Zahlung für die Steuer (#208, Entwurf 3.10). Fehlt es, liegt der Zeitraum der
  // Position in einem Kalenderjahr, und es ist dieses. Eine Vereinfachung, siehe CLAUDE.md
  // („Nicht dem Abflussprinzip folgen die Werbungskosten“).
  taxYear?: number
  // Nur bei der Kostenart „Heizung und Warmwasser“ (#208, A1).
  heatingPart?: HeatingPart
```

In `shared/period.ts` anhängen:

```ts
// Reicht ein Zeitraum über zwei Kalenderjahre? Dann ist das Jahr der Zahlung einer Position Pflicht
// (#208, Entwurf 3.10), und die Steuer schöpft aus zwei Abrechnungen.
export const spansTwoYears = (p: Pick<BillingPeriod, 'from' | 'to'>): boolean => p.from.slice(0, 4) !== p.to.slice(0, 4)

// Eine Tagesspanne in Worten: „01.01.–30.04.2025“, über den Jahreswechsel „01.11.2025–30.04.2026“,
// ein einzelner Tag „15.03.2025“. Für Leistungszeiträume und Anteile; einen Abrechnungszeitraum
// bezeichnet `periodLabel`.
export function formatDayRange(from: string, to: string): string {
  if (from === to) return germanDate(from)
  return from.slice(0, 4) === to.slice(0, 4) ? `${from.slice(8, 10)}.${from.slice(5, 7)}.–${germanDate(to)}` : `${germanDate(from)}–${germanDate(to)}`
}
```

(`germanDate` steht schon in `shared/period.ts`, PR-2-Plan Task 1.)

- [ ] **Step 4: Schema, erster Schritt (Spalten) und 0016 erzeugen**

In `server/src/db/schema.ts` den Typimport um `HeatingPart` ergänzen, neben `METER_TYPES`:

```ts
export const HEATING_PARTS = exactly<HeatingPart>()(['fuel', 'operating', 'metering'] as const)
```

In `costItems` hinter `participantsLimited`:

```ts
    // Der Leistungszeitraum der Rechnung (#208, Entwurf 3.4), beide oder keines. Bei einer
    // aufgeteilten kalten Rechnung steht an jedem Teil der ganze Leistungszeitraum.
    serviceFrom: text('service_from'),
    serviceTo: text('service_to'),
    // Das Jahr der Zahlung für die Steuer (#208, Entwurf 3.10); NULL heißt das Kalenderjahr des
    // Zeitraums, wenn er in einem liegt. Pflicht bei einem Zeitraum über zwei Jahre prüft
    // repository.ts, denn die Datenbank kennt die Zeiträume nicht.
    taxYear: integer('tax_year'),
    // Teil der Heizkosten (#208, Entwurf 5.3, A1), nur bei „Heizung und Warmwasser“.
    heatingPart: text('heating_part', { enum: HEATING_PARTS }),
```

Run: `npm --prefix server run db:generate -- --name leistungszeitraum`
Expected: keine Rückfrage; `[✓] Your SQL migration file ➜ drizzle/0016_leistungszeitraum.sql` mit
vier Zeilen `ALTER TABLE \`cost_items\` ADD \`service_from\` text;` … `ADD \`heating_part\` text;`.

- [ ] **Step 5: Schema, zweiter Schritt (Bedingungen) und 0017 erzeugen**

In der Bedingungsliste von `costItems` hinter `oneOf('cost_items_external_measure_known', …)`:

```ts
    // Leistungszeitraum (#208): beide oder keines, als Datum, Beginn nicht nach dem Ende.
    check('cost_items_service_pair', sql.raw('("service_from" IS NULL) = ("service_to" IS NULL)')),
    check('cost_items_service_from_date', sql.raw(`"service_from" IS NULL OR "service_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('cost_items_service_to_date', sql.raw(`"service_to" IS NULL OR "service_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('cost_items_service_order', sql.raw('"service_from" IS NULL OR "service_from" <= "service_to"')),
    // Ein Jahr der Zahlung, das es geben kann; die genaue Spanne je Zeitraum prüft repository.ts.
    check('cost_items_tax_year_range', sql.raw('"tax_year" IS NULL OR "tax_year" BETWEEN 1900 AND 2200')),
    oneOf('cost_items_heating_part_known', 'heating_part', HEATING_PARTS),
    // Ein Brennstoffmerkmal an Müllabfuhr hätte keine Bedeutung und verwirrte den Vorschlag nach § 560.
    check('cost_items_heating_part_category', sql.raw(`"heating_part" IS NULL OR "category" = 'Heizung und Warmwasser'`)),
```

Run: `npm --prefix server run db:generate -- --name leistungszeitraum_pruefung`
Expected: `drizzle/0017_leistungszeitraum_pruefung.sql` beginnt mit `PRAGMA foreign_keys=OFF;` und
baut `cost_items` neu (`CREATE TABLE \`__new_cost_items\``, `INSERT INTO \`__new_cost_items\``
mit den vier neuen Spalten, `DROP TABLE`, `ALTER TABLE … RENAME`, die Indizes). Prüfen:

Run: `grep -c 'INSERT INTO `__new_cost_items`' server/drizzle/0017_leistungszeitraum_pruefung.sql && grep -c 'heating_part' server/drizzle/0017_leistungszeitraum_pruefung.sql`
Expected: `1`, dann eine Zahl ≥ 3 (Spalte, Bedingungen, Umkopieren).

- [ ] **Step 6: Marken eintragen**

Run:
```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag >= '0016') console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```
Expected: zwei Zeilen `'0016_leistungszeitraum': '<64 Hex>'` und `'0017_leistungszeitraum_pruefung': '<64 Hex>'`.

In `server/test/migrations.test.ts` hinter `'0015_zeitraum_pflicht'` diese beiden Zeilen einfügen,
mit dem Kommentar:

```ts
  // Leistungszeitraum, Jahr der Zahlung, Brennstoffmerkmal (#208, PR 3). Eingetragen vor dem
  // Merge; werden 0016 oder 0017 vor dem ersten Push neu erzeugt, hier die neue Marke eintragen.
```

(Die beiden Werte sind die eben ausgegebenen; sie hängen am erzeugten Inhalt.)

- [ ] **Step 7: Lesen und Schreiben**

`server/src/db/read.ts`, in `readCostItems` hinter `invoiceFile: orUndefined(c.invoiceFile),`:

```ts
      // Leistungszeitraum, Jahr der Zahlung, Brennstoffmerkmal (#208): nur, wenn es sie gibt, wie
      // die übrigen optionalen Felder. Ein Bestand ohne sie liest sich unverändert.
      serviceFrom: orUndefined(c.serviceFrom),
      serviceTo: orUndefined(c.serviceTo),
      taxYear: orUndefined(c.taxYear),
      heatingPart: orUndefined(c.heatingPart),
```

`server/src/db/repository.ts`, Importe ergänzen: `HEATING_PARTS` aus `./schema.ts`,
`formatDayRange, periodLabel, periodsBetween, spansTwoYears` aus `'../../../shared/period.ts'`
(`periodOfKey` ist seit PR 2 importiert), `HEATING_CATEGORY` aus `'../../../shared/heating.ts'`,
`andList` aus `'../../../shared/wording.ts'`, `BillingPeriod` als Typ.

In `mergeCostItem` hinter `invoiceFile: …`:

```ts
    // `null` leert, wie bei den übrigen optionalen Feldern (#208).
    serviceFrom: merged(body, 'serviceFrom', current.serviceFrom, asOptionalText),
    serviceTo: merged(body, 'serviceTo', current.serviceTo, asOptionalText),
    taxYear: merged(body, 'taxYear', current.taxYear, asOptionalNumber),
    heatingPart: merged(body, 'heatingPart', current.heatingPart, (v) => oneOfOrUndefined(HEATING_PARTS, v)),
```

In `costItemRow` hinter `participantsLimited: …`:

```ts
  serviceFrom: orNull(c.serviceFrom), serviceTo: orNull(c.serviceTo), taxYear: orNull(c.taxYear), heatingPart: orNull(c.heatingPart),
```

`rulesForProperty` (PR 2, Task 3) bekommt ein `export`.

- [ ] **Step 8: Schreibprüfungen**

In `server/src/db/repository.ts` hinter `requirePeriods`:

```ts
// Was eine Kostenposition mit Leistungszeitraum und Zeitraum über zwei Kalenderjahre braucht
// (#208, Entwurf 3.4, 3.10). Die Datenbank prüft Form und Reihenfolge (0017), nicht aber, was an
// den Zeiträumen des Objekts hängt.
//
// **Eine kalte Rechnung über zwei Zeiträume wird nicht als eine Position angenommen.** Nach dem
// Leistungsprinzip gehört sie anteilig in jeden (VIII ZR 49/07 lässt beides zu, Mietfuchs wählt
// das Leistungsprinzip, Entwurf 3.4); als eine Position stünde sie ganz in einem und fehlte im
// anderen. Aufgeteilt wird sie mit `saveCostItemSplit` (Task 3), dessen Teile `splitPart` tragen.
// Ein Teil, dessen Leistungszeitraum und Zeitraum unverändert bleiben (der Betrag wird berichtigt),
// ist weiter erlaubt. **Heizkosten werden nie nach Tagen geteilt** (G-C1, VIII ZR 156/11); sie
// nimmt die Prüfung an, und die Abrechnung warnt (`period.heating-mismatch`).
export type CostItemGuardOptions = { splitPart?: boolean }

async function requireServiceAndTax(db: Executor, before: CostItem | null, after: CostItem, options: CostItemGuardOptions): Promise<void> {
  const what = `„${after.description}“`
  const from = after.serviceFrom
  const to = after.serviceTo
  if ((from === undefined) !== (to === undefined)) {
    throw new PeriodError(`Für ${what} fehlt ein Ende des Leistungszeitraums. Bitte tragen Sie Beginn und Ende ein oder lassen Sie beide leer.`)
  }
  if (from !== undefined && to !== undefined) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new PeriodError(`Der Leistungszeitraum von ${what} ist kein gültiges Datum.`)
    if (from > to) throw new PeriodError(`Der Leistungszeitraum von ${what} endet vor seinem Beginn.`)
  }
  if (after.heatingPart !== undefined && after.category !== HEATING_CATEGORY) {
    throw new PeriodError(`„Brennstoff/Energie“ gibt es nur bei der Kostenart „${HEATING_CATEGORY}“.`)
  }
  const rules = await rulesForProperty(db, after.propertyId)
  const period = periodOfKey(rules, after.period)
  // Einen Zeitraum, den es nicht gibt, hat `requirePeriods` schon abgelehnt.
  if (period === null) return
  requireTaxYear(period, after, what)
  if (from === undefined || to === undefined || after.category === HEATING_CATEGORY || options.splitPart) return
  const unchanged = before !== null && before.serviceFrom === from && before.serviceTo === to && before.period === after.period
  if (unchanged) return
  const touched = periodsBetween(rules, from, to)
  if (touched.length > 1) {
    throw new PeriodError(
      `Die Rechnung ${what} betrifft die Abrechnungszeiträume ${andList(touched.map(periodLabel))} (Leistungszeitraum ${formatDayRange(from, to)}). ` +
        'Kalte Betriebskosten gehören anteilig in jeden dieser Zeiträume; speichern Sie die Rechnung mit „Aufteilen und speichern“.',
    )
  }
}

// Das Jahr der Zahlung (Entwurf 3.10): Liegt der Zeitraum in einem Kalenderjahr, ist es dieses und
// darf nur leer oder genau dieses sein. Reicht er über zwei, ist es Pflicht und liegt zwischen dem
// Jahr des Beginns und dem Jahr nach dem Ende (eine Messdienstabrechnung kommt oft erst danach).
function requireTaxYear(period: BillingPeriod, after: CostItem, what: string): void {
  const startYear = Number(period.from.slice(0, 4))
  const endYear = Number(period.to.slice(0, 4))
  if (!spansTwoYears(period)) {
    if (after.taxYear !== undefined && after.taxYear !== startYear) {
      throw new PeriodError(`Der Abrechnungszeitraum ${periodLabel(period)} liegt im Kalenderjahr ${startYear}; für die Steuer zählt ${what} deshalb zu ${startYear}.`)
    }
    return
  }
  if (after.taxYear === undefined) {
    throw new PeriodError(`Der Abrechnungszeitraum ${periodLabel(period)} reicht über zwei Kalenderjahre. Bitte geben Sie bei ${what} das Jahr der Zahlung an (für die Steuer, § 11 Abs. 2 EStG).`)
  }
  if (after.taxYear < startYear || after.taxYear > endYear + 1) {
    throw new PeriodError(`Das Jahr der Zahlung von ${what} muss zwischen ${startYear} und ${endYear + 1} liegen.`)
  }
}
```

`guardCostItem` (Fassung von PR 2 Task 4) bekommt den fünften Parameter und ruft die Prüfung
direkt hinter `requirePeriods`:

```ts
async function guardCostItem(db: Executor, before: CostItem | null, after: CostItem, body: unknown, options: CostItemGuardOptions = {}): Promise<void> {
  // Der Zeitraum (#208) muss zum Objekt gehören. `year` ohne `period` schickt nur ein alter Tab.
  await requirePeriods(db, after.propertyId, [after.period], has(body, 'year') && !has(body, 'period'), 'Die Kostenposition')
  await requireServiceAndTax(db, before, after, options)
  // … der bisherige Rumpf ab „Die Wohnungen der Einzelbeträge …“ unverändert
}
```

(`isIsoDate` steht weiter unten in der Datei; es wird erst zur Laufzeit gebraucht.)

- [ ] **Step 9: Schnappschuss**

`server/src/snapshot.ts`, in `SnapshotCostItem` die Liste der gepickten Felder hinter `| 'period'`
ergänzen:

```ts
  // Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal (#208): für die Hinweise zum
  // Zeitraum, den Vorschlag nach § 560 im Rumpf und die Steuer.
  | 'serviceFrom'
  | 'serviceTo'
  | 'taxYear'
  | 'heatingPart'
```

- [ ] **Step 10: Bestehende Wächter nachziehen**

`server/test/db-stock.test.ts`: `NOT_IN_DB_JSON` um `'serviceFrom', 'serviceTo', 'taxYear',
'heatingPart'` ergänzen (die db.json kennt sie nicht; nach PR 2 steht dort schon `'period'`).

`server/test/db-repository.test.ts`, Test „… jede Spalte …“ (die Probe für `costItems`): `category`
auf `'Heizung und Warmwasser'` und in den Rumpf

```ts
        // #208: Leistungszeitraum im Jahr der Position, das Jahr der Zahlung ist dann dieses.
        serviceFrom: '2024-01-01', serviceTo: '2024-12-31', taxYear: 2024, heatingPart: 'fuel',
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-leistungszeitraum.test.ts test/migrations.test.ts test/schema.test.ts test/db-repository.test.ts test/db-stock.test.ts && npm run typecheck`
Expected: PASS (db-leistungszeitraum 8 Tests). `schema.test.ts` vergleicht Spalten und Modell und
bleibt ohne Änderung grün, weil die neuen Felder optional sind und ihre Spalten nullbar.

- [ ] **Step 12: Run all tests and commit**

Run: `npm test`
Expected: PASS, Golden unverändert.

```bash
git add shared/types.ts shared/period.ts server/src/db server/drizzle server/src/snapshot.ts server/test
git commit -m "Zeitraum: Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal an der Kostenposition (Migration 0016/0017)

Refs #208"
```

---
### Task 3: Eine kalte Rechnung über zwei Zeiträume aufteilen

Entwurf 3.4: Eine Position, deren Leistungszeitraum zwei Objektzeiträume berührt, wird beim
Speichern in eine Position je Zeitraum zerlegt, tagesgenau, in einer Transaktion; Restcent nach
`largestRemainder` mit der Kennung als Entscheid; §35a im selben Verhältnis; der Beleg hängt an
jedem Teil; die Vorschau zeigt die Beträge; ist ein Zeitraum abgeschlossen, 409; nie für
Heizkosten. Die Zerlegung selbst ist eine reine Funktion (`server/src/serviceSplit.ts`), denn der
Wechsel des Rhythmus (Task 4) zerlegt mit derselben Regel.

**Files:**
- Create: `server/src/serviceSplit.ts`
- Modify: `shared/types.ts`, `server/src/db/repository.ts`, `server/src/index.ts`
- Test: `server/test/service-split.test.ts` (neu), `server/test/db-aufteilen.test.ts` (neu), `server/test/api.test.ts` (neuer Test)

**Interfaces:**
- Consumes: `largestRemainder(totalCents, raws, keys)` (calc.ts); `periodsBetween`, `periodLabel`, `formatDayRange`, `spansTwoYears` (shared/period.ts); `rulesForProperty`, `guardCostItem(…, { splitPart: true })`, `mergeCostItem`, `emptyCostItem`, `costItemCollection` (repository.ts, Task 2).
- Produces:
  - `type ServicePart = { period: BillingPeriod; days: number; amountCents: number; labor35aCents: number | null; description: string }`, `splitByService(rules, item): ServicePart[]`, `baseDescription(description: string): string` (`server/src/serviceSplit.ts`)
  - `type SplitPreviewPart = { period: PeriodKey; label: string; days: number; amountCents: number; labor35aCents: number | null; description: string; needsTaxYear: boolean; closed: boolean }` (`shared/types.ts`)
  - `class PeriodConflict extends Error { status = 409 }`, `previewCostItemSplit(db, propertyId: string | null, body: unknown, currentId: string | null): Promise<SplitPreviewPart[]>`, `saveCostItemSplit(db, propertyId: string | null, body: unknown, currentId: string | null, newId: () => string): Promise<CostItem[]>`, `writeCostItemParts(tx, base: CostItem, parts: readonly PartWrite[], newId, keepId: string | null): Promise<string[]>` mit `type PartWrite = { period: PeriodKey; amountCents: number; labor35aCents: number | null; description: string; taxYear: number | null }` (repository.ts)
  - Routen `POST /api/costItems/split/preview`, `POST /api/costItems/split`, `POST /api/costItems/:id/split/preview`, `PUT /api/costItems/:id/split`

- [ ] **Step 1: Write the failing tests**

`server/test/service-split.test.ts`:

```ts
// Aufteilen einer kalten Rechnung nach Tagen (#208, Entwurf 3.4). Reine Funktion; das Schreiben
// prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseDescription, splitByService } from '../src/serviceSplit.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

test('Grundsteuer 2025 über 480 € bei Mai bis April: 157,81 € und 322,19 € (Entwurf 3.4)', () => {
  const parts = splitByService(MAI, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.days, p.amountCents, p.description]), [
    ['2024-05', 120, 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'],
    ['2025-05', 245, 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)'],
  ])
})

test('Nach einem Wechsel heißt derselbe Rumpf 2025-01 (F18)', () => {
  const parts = splitByService(WECHSEL, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents]), [['2025-01', 15781], ['2025-05', 32219]])
})

test('Summe exakt, §35a im selben Verhältnis, Restcent nach der Kennung', () => {
  const parts = splitByService(MAI, { id: 'h', description: 'Hauswart', amountCents: 100000, labor35aCents: 60000, serviceFrom: '2025-03-01', serviceTo: '2025-06-30' })
  // März und April: 61 Tage, Mai und Juni: 61 Tage, also je die Hälfte.
  assert.deepEqual(parts.map((p) => [p.amountCents, p.labor35aCents]), [[50000, 30000], [50000, 30000]])
  const drei = splitByService(MAI, { id: 'x', description: 'X', amountCents: 100, serviceFrom: '2025-04-30', serviceTo: '2025-05-01' })
  assert.deepEqual(drei.map((p) => p.amountCents), [50, 50])
  assert.equal(drei.reduce((a, p) => a + p.amountCents, 0), 100)
})

test('Eine Gutschrift bleibt in jedem Teil negativ, die Summe stimmt (Review Focus 2)', () => {
  const parts = splitByService(MAI, { id: 'gs', description: 'Gutschrift Versicherung', amountCents: -10001, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.ok(parts.every((p) => p.amountCents < 0), 'jeder Teil negativ')
  assert.equal(parts.reduce((a, p) => a + p.amountCents, 0), -10001)
  assert.ok(parts.every((p) => p.labor35aCents === null), 'kein §35a an einer Gutschrift')
})

test('Ein Leistungszeitraum in einem einzigen Zeitraum ergibt einen Teil ohne Zusatz', () => {
  const parts = splitByService(MAI, { id: 'w', description: 'Wasser', amountCents: 9000, serviceFrom: '2025-05-01', serviceTo: '2026-04-30' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents, p.description]), [['2025-05', 9000, 'Wasser']])
})

test('Ein zweites Aufteilen hängt keinen zweiten Zusatz an', () => {
  assert.equal(baseDescription('Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'), 'Grundsteuer 2025')
  assert.equal(baseDescription('Grundsteuer 2025'), 'Grundsteuer 2025')
})
```

`server/test/db-aufteilen.test.ts`:

```ts
// Aufteilen beim Speichern (#208, Entwurf 3.4): Vorschau, Schreiben in einer Transaktion,
// abgeschlossene Zeiträume, Heizkosten, Jahr der Zahlung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, listCollection, PeriodConflict, PeriodError, previewCostItemSplit, saveCostItemSplit } from '../src/db/repository.ts'
import { periodChanges, properties } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem } from '../../shared/types.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-aufteilen-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const setRules = (opened: OpenedDatabase, startMonth: number, changes: string[]) =>
  opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: startMonth }).where(eq(properties.id, 'objekt-1'))
    for (const fromMonth of changes) await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth })
  })
let n = 0
const ids = () => `neu-${++n}`
const grundsteuer = { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', invoiceFile: 'gs.pdf', taxYear: 2025 }
const costItems = async (opened: OpenedDatabase): Promise<CostItem[]> => (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)

test('Vorschau und Speichern: zwei Positionen, Beleg an beiden, Jahr der Zahlung nur am Teil über zwei Kalenderjahre', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => [p.period, p.label, p.amountCents, p.needsTaxYear, p.closed]), [
      ['2025-01', '01.01.–30.04.2025', 15781, false, false],
      ['2025-05', '2025/2026', 32219, true, false],
    ])
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    assert.deepEqual(teile.map((c) => [c.period, c.amountCents, c.description, c.invoiceFile, c.taxYear, c.serviceFrom, c.serviceTo]), [
      ['2025-01', 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)', 'gs.pdf', undefined, '2025-01-01', '2025-12-31'],
      ['2025-05', 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', 'gs.pdf', 2025, '2025-01-01', '2025-12-31'],
    ])
  })
})

test('Ohne Jahr der Zahlung für den Teil über zwei Kalenderjahre wird nichts gespeichert', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const { taxYear: _ohne, ...ohneJahr } = grundsteuer
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', ohneJahr, null, ids)),
      (err: unknown) => err instanceof PeriodError && /Jahr der Zahlung/.test(err.message))
    assert.equal((await costItems(opened)).length, 0, 'auch der erste Teil steht nicht da')
  })
})

test('Ein abgeschlossener Zeitraum lehnt das Aufteilen ab (409), nichts wird geschrieben', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await opened.write((db) => closeSettlement(db, { id: 'z', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01T00:00:00Z', sentAt: null, settlement: {} }))
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => p.closed), [true, false])
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids)),
      (err: unknown) => err instanceof PeriodConflict && /Die Abrechnung 01\.01\.–30\.04\.2025 ist abgeschlossen/.test(err.message))
    assert.equal((await costItems(opened)).length, 0)
  })
})

test('Heizkosten werden nicht nach Tagen aufgeteilt; eine Rechnung in einem Zeitraum braucht kein Aufteilen', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, 'objekt-1', { ...grundsteuer, category: 'Heizung und Warmwasser' }, null)),
      (err: unknown) => err instanceof PeriodError && /Heizkosten teilt Mietfuchs nicht nach Tagen auf/.test(err.message))
    const eins = { ...grundsteuer, serviceFrom: '2025-01-01', serviceTo: '2025-03-31', taxYear: undefined }
    assert.equal((await opened.read((db) => previewCostItemSplit(db, 'objekt-1', eins, null))).length, 1)
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', eins, null, ids)),
      (err: unknown) => err instanceof PeriodError && /liegt in einem einzigen Abrechnungszeitraum/.test(err.message))
  })
})

test('Eine vorhandene Position aufteilen: Sie behält ihre Kennung für den Teil ihres Zeitraums', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'alt', { ...grundsteuer, serviceFrom: undefined, serviceTo: undefined, taxYear: undefined }))
    await setRules(opened, 1, ['2025-05'])
    const teile = await opened.write((db) => saveCostItemSplit(db, null, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }, 'alt', ids))
    assert.deepEqual(teile.map((c) => [c.id === 'alt', c.period, c.amountCents]), [[true, '2025-01', 15781], [false, '2025-05', 32219]])
    assert.equal((await costItems(opened)).length, 2)
  })
})
```

An `server/test/api.test.ts` anhängen (Importe ergänzen: `eq` aus `'drizzle-orm'` und
`properties as propertiesTable` aus `'../src/db/schema.ts'`, falls PR 2 sie noch nicht ergänzt hat):

```ts
test('Aufteilen (#208): Vorschau und Speichern über HTTP, 409 bei abgeschlossenem Zeitraum', async () => {
  const s = await startServer()
  try {
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, 'objekt-1')) })
    const rumpf = { category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }
    const vorschau = await s.api<{ parts: { period: string; amountCents: number }[] }>('/api/costItems/split/preview', { method: 'POST', body: JSON.stringify(rumpf) })
    assert.deepEqual(vorschau.parts.map((p) => [p.period, p.amountCents]), [['2024-05', 15781], ['2025-05', 32219]])
    // Ohne Aufteilen lehnt die gewöhnliche Route ab und nennt den Knopf.
    const einzeln = await fetch(`${s.base}/api/costItems`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...rumpf, period: '2025-05' }) })
    assert.equal(einzeln.status, 400)
    assert.match(await errorFrom(einzeln), /„Aufteilen und speichern“/)
    const angelegt = await s.api<CostItem[]>('/api/costItems/split', { method: 'POST', body: JSON.stringify(rumpf) })
    assert.equal(angelegt.length, 2)
    await s.api('/api/settlement/2025-05/close', { method: 'POST', body: '{}' })
    const zu = await fetch(`${s.base}/api/costItems/split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) })
    assert.equal(zu.status, 409)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/service-split.test.ts test/db-aufteilen.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/serviceSplit.ts` bzw. fehlende Exporte
`previewCostItemSplit`, `saveCostItemSplit`, `PeriodConflict`.

- [ ] **Step 3: `server/src/serviceSplit.ts`**

```ts
// Eine kalte Rechnung über mehrere Abrechnungszeiträume, nach Tagen geteilt (#208, Entwurf 3.4).
//
// Mietfuchs wendet für kalte Betriebskosten das Leistungsprinzip an: Eine Rechnung gehört anteilig
// in jeden Zeitraum, in dem die Leistung erbracht wurde. Das Abflussprinzip wäre ebenfalls zulässig
// (BGH VIII ZR 49/07), wird aber nicht angeboten, denn Positionen tragen kein Zahlungsdatum. Für
// Heizung und Warmwasser gilt das nicht (VIII ZR 156/11): Sie werden nie nach Tagen geteilt.
//
// Die Restcent verteilt `largestRemainder`, der Entscheid ist die Kennung der Rechnung mit dem
// Schlüssel des Zeitraums; der §35a-Lohnanteil folgt demselben Verhältnis. Eine Gutschrift wird mit
// ihrem Betrag geteilt und behält in jedem Teil ihr Vorzeichen. Dieselbe Regel nutzen das Speichern
// (repository.ts) und der Wechsel des Rhythmus (db/periodChange.ts).

import { largestRemainder } from './calc.ts'
import { formatDayRange, periodsBetween } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

export type ServicePart = { period: BillingPeriod; days: number; amountCents: number; labor35aCents: number | null; description: string }

type SplitItem = { id: string; description: string; amountCents: number; labor35aCents?: number; serviceFrom: string; serviceTo: string }

const MS_DAY = 86400000
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1

const SUFFIX = / \(anteilig [^)]*\)$/

// Die Beschreibung ohne den Zusatz eines früheren Aufteilens.
export const baseDescription = (description: string): string => description.replace(SUFFIX, '')

// Ein Betrag auf die Tage verteilt; ein negativer mit seinem Betrag und danach mit Vorzeichen.
function byDays(total: number, weights: number[], keys: string[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  return largestRemainder(abs, weights.map((w) => (abs * w) / sum), keys).map((c) => sign * c || 0)
}

export function splitByService(rules: PeriodRules, item: SplitItem): ServicePart[] {
  const periods = periodsBetween(rules, item.serviceFrom, item.serviceTo)
  const spans = periods.map((p) => ({ from: p.from > item.serviceFrom ? p.from : item.serviceFrom, to: p.to < item.serviceTo ? p.to : item.serviceTo }))
  const weights = spans.map((s) => days(s.from, s.to))
  const keys = periods.map((p) => `${item.id}|${p.key}`)
  const amounts = byDays(item.amountCents, weights, keys)
  // §35a nur an einer Rechnung, nicht an einer Gutschrift (amountProblem in shared/costItem.ts).
  const labor = item.labor35aCents && item.amountCents > 0 ? byDays(item.labor35aCents, weights, keys) : null
  const base = baseDescription(item.description)
  return periods.map((period, i) => {
    const span = spans[i] ?? { from: period.from, to: period.to }
    return {
      period,
      days: weights[i] ?? 0,
      amountCents: amounts[i] ?? 0,
      labor35aCents: labor ? labor[i] ?? 0 : null,
      description: periods.length > 1 ? `${base} (anteilig ${formatDayRange(span.from, span.to)})` : item.description,
    }
  })
}
```

- [ ] **Step 4: Repository: Vorschau, Teile schreiben, Speichern**

`shared/types.ts`, hinter `CostItem`:

```ts
// Ein Teil einer aufgeteilten Rechnung in der Vorschau (#208, Entwurf 3.4). `needsTaxYear`: Der
// Zeitraum reicht über zwei Kalenderjahre, das Jahr der Zahlung ist dort Pflicht. `closed`: Die
// Abrechnung des Zeitraums ist abgeschlossen; gespeichert wird dann nicht (409).
export type SplitPreviewPart = {
  period: PeriodKey
  label: string
  days: number
  amountCents: number
  labor35aCents: number | null
  description: string
  needsTaxYear: boolean
  closed: boolean
}
```

`server/src/db/repository.ts`, Importe: `splitByService` aus `'../serviceSplit.ts'`,
`SplitPreviewPart` und `PeriodKey` als Typen. Hinter `class PeriodError`:

```ts
// Ein Vorgang, der eine abgeschlossene Abrechnung träfe (#208). Wie bei `findClosedSettlement`
// bleibt der eingefrorene Stand maßgeblich; wer ändern will, öffnet sie wieder (#56).
export class PeriodConflict extends Error {
  status = 409
}
```

Vor `// ---------- Der Mieterwechsel (#150) ----------`:

```ts
// ---------- Eine Rechnung aufteilen (#208, Entwurf 3.4) ----------

export type PartWrite = { period: PeriodKey; amountCents: number; labor35aCents: number | null; description: string; taxYear: number | null }

// Schreibt die Teile einer Rechnung durch dieselbe Verschmelzung, denselben Wächter und dasselbe
// Schreiben wie das gewöhnliche Anlegen; `base` gibt alles Übrige (Schlüssel, Anteile, Beleg).
// `keepId`: Die Kennung bleibt am Teil dieses Zeitraums, sonst am ersten. Ohne Transaktion, denn
// beide Aufrufer (Aufteilen, Wechsel des Rhythmus) laufen schon in einer.
export async function writeCostItemParts(tx: Executor, base: CostItem, parts: readonly PartWrite[], newId: () => string, keepId: string | null): Promise<string[]> {
  const keepAt = Math.max(0, parts.findIndex((p) => p.period === base.period))
  const written: string[] = []
  for (const [i, part] of parts.entries()) {
    const id = keepId !== null && i === keepAt ? keepId : newId()
    const entity = mergeCostItem(keepId !== null && i === keepAt ? base : { ...base, id }, {
      period: part.period, amountCents: part.amountCents, labor35aCents: part.labor35aCents, description: part.description, taxYear: part.taxYear,
    })
    await guardCostItem(tx, keepId !== null && i === keepAt ? base : null, entity, {}, { splitPart: true })
    if (keepId !== null && i === keepAt) await costItemCollection.replace(tx, entity)
    else await costItemCollection.insert(tx, entity)
    written.push(id)
  }
  return written
}

// Die Rechnung, wie sie aufgeteilt würde: aus der gespeicherten Position (`currentId`) und dem
// Rumpf, sonst aus dem Rumpf allein. Das Objekt kommt bei einer vorhandenen Position von ihr.
async function splitBase(db: Database, propertyId: string | null, body: unknown, currentId: string | null): Promise<{ base: CostItem; from: string; to: string }> {
  const current = currentId === null ? undefined : (await readCostItems(db)).find((c) => c.id === currentId)
  if (currentId !== null && !current) throw new PeriodError('Diese Kostenposition gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
  const base = mergeCostItem(current ?? emptyCostItem(currentId ?? 'vorschau'), current ? body : { ...Object(body), propertyId })
  if (base.category === HEATING_CATEGORY) {
    throw new PeriodError('Heizkosten teilt Mietfuchs nicht nach Tagen auf: Sie müssen den Verbrauch im Abrechnungszeitraum abbilden (BGH VIII ZR 156/11).')
  }
  if (base.serviceFrom === undefined || base.serviceTo === undefined || !isIsoDate(base.serviceFrom) || !isIsoDate(base.serviceTo) || base.serviceFrom > base.serviceTo) {
    throw new PeriodError(`Zum Aufteilen braucht „${base.description}“ einen Leistungszeitraum mit Beginn und Ende.`)
  }
  return { base, from: base.serviceFrom, to: base.serviceTo }
}

export async function previewCostItemSplit(db: Database, propertyId: string | null, body: unknown, currentId: string | null): Promise<SplitPreviewPart[]> {
  const { base, from, to } = await splitBase(db, propertyId, body, currentId)
  const rules = await rulesForProperty(db, base.propertyId)
  const closed = new Set((await readClosedSettlements(db)).filter((c) => c.propertyId === base.propertyId).map((c) => c.period))
  return splitByService(rules, { ...base, serviceFrom: from, serviceTo: to }).map((p) => ({
    period: p.period.key,
    label: periodLabel(p.period),
    days: p.days,
    amountCents: p.amountCents,
    labor35aCents: p.labor35aCents,
    description: p.description,
    needsTaxYear: spansTwoYears(p.period),
    closed: closed.has(p.period.key),
  }))
}

// Speichert eine Rechnung als ihre Teile, in einer Transaktion: alle oder keiner. Ein Teil in
// einem abgeschlossenen Zeitraum lehnt ab (409), bevor etwas geschrieben ist. Das Jahr der Zahlung
// des Rumpfes gilt für jeden Teil über zwei Kalenderjahre; ein Teil in einem Kalenderjahr hat
// keines (Entwurf 3.10). Gelesen wird vor der Transaktion: Die Lesefunktionen aus read.ts nehmen
// die Verbindung und keine Transaktion, und die Schlange in open.ts lässt zwischen Lesen und
// Schreiben keine andere Anfrage herein.
export async function saveCostItemSplit(db: Database, propertyId: string | null, body: unknown, currentId: string | null, newId: () => string): Promise<CostItem[]> {
  const parts = await previewCostItemSplit(db, propertyId, body, currentId)
  if (parts.length < 2) throw new PeriodError('Diese Rechnung liegt in einem einzigen Abrechnungszeitraum; speichern Sie sie bitte gewöhnlich.')
  const zu = parts.find((p) => p.closed)
  if (zu) throw new PeriodConflict(`Die Abrechnung ${zu.label} ist abgeschlossen und bleibt, wie sie verschickt wurde. Öffnen Sie sie wieder, wenn die Rechnung anteilig hinein soll.`)
  const { base } = await splitBase(db, propertyId, body, currentId)
  const ids = await db.transaction((tx) => writeCostItemParts(tx, base, parts.map((p) => ({
    period: p.period, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description,
    taxYear: p.needsTaxYear ? base.taxYear ?? null : null,
  })), newId, currentId))
  const all = await readCostItems(db)
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is CostItem => c !== undefined)
}
```

(`readClosedSettlements` und `readCostItems` sind aus `./read.ts` importiert und nehmen eine
`Database`; `writeCostItemParts` nimmt die Transaktion als `Executor`.) Fehlt einem Teil über zwei Kalenderjahre das Jahr der
Zahlung, lehnt der Wächter in `writeCostItemParts` mit `PeriodError` ab, und die Transaktion rollt
den ersten Teil zurück.

- [ ] **Step 5: Routen und Fehlerbehandlung (`server/src/index.ts`)**

Importe aus `./db/repository.ts` ergänzen: `PeriodConflict`, `previewCostItemSplit`,
`saveCostItemSplit`. Vor der Schleife `for (const coll of COLLECTIONS)`:

```ts
// Eine kalte Rechnung über zwei Abrechnungszeiträume (#208, Entwurf 3.4): erst die Vorschau mit
// den Beträgen je Zeitraum, dann das Speichern aller Teile in einer Transaktion. Begründung in
// serviceSplit.ts und db/repository.ts.
app.post('/api/costItems/split/preview', async (req, res) => {
  res.json(await readData(async (db) => ({ parts: await previewCostItemSplit(db, await propertyOf(db, req, true), bodyObject(req), null) })))
})
app.post('/api/costItems/split', async (req, res) => {
  res.status(201).json(await writeData(async (db) => saveCostItemSplit(db, await propertyOf(db, req, true), bodyObject(req), null, newId)))
})
app.post('/api/costItems/:id/split/preview', async (req, res) => {
  res.json(await readData(async (db) => ({ parts: await previewCostItemSplit(db, null, bodyObject(req), req.params.id) })))
})
app.put('/api/costItems/:id/split', async (req, res) => {
  res.json(await writeData((db) => saveCostItemSplit(db, null, bodyObject(req), req.params.id, newId)))
})
```

In der Fehlerbehandlung `PeriodConflict` neben `PeriodError` aufnehmen:

```ts
  if (err instanceof RouteProblem || err instanceof CrossPropertyError || err instanceof PeriodError || err instanceof PeriodConflict || err instanceof TenantChangeError || err instanceof BookingRefusal) {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/service-split.test.ts test/db-aufteilen.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Aufteilen" && npm run typecheck`
Expected: PASS (service-split 6, db-aufteilen 5, api 1).

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/serviceSplit.ts server/src/db/repository.ts server/src/index.ts server/test/service-split.test.ts server/test/db-aufteilen.test.ts server/test/api.test.ts
git commit -m "Zeitraum: kalte Rechnungen über zwei Zeiträume beim Speichern aufteilen, mit Vorschau

Refs #208"
```

---
### Task 4: Den Abrechnungszeitraum wechseln, mit Vorschau

Entwurf 3.6 und N4: Ein Wechsel erzeugt einen Rumpf bis zum Tag vor dem neuen Beginn; die Vorschau
führt jede Zeile, deren Schlüssel entfällt oder seinen Umfang ändert. Abgeschlossene Zeiträume sind
unantastbar (409). Kalte Positionen mit Leistungszeitraum werden nach 3.4 aufgeteilt, alle übrigen
(ohne Leistungszeitraum oder Heizung) ordnet der Vermieter je Gruppe zu. Jahreskorrekturen eines
betroffenen Zeitraums werden neu erfasst, wenn das Mietverhältnis danach Monate in mehr als einem
oder in einem anders geschnittenen Zeitraum hat; ohne Antwort wird nicht gespeichert. Ein gewählter
Zeitraum einer Auswertung, den es nicht mehr gibt, wandert auf den mit der größten Überschneidung.
Alles in einer Transaktion.

Der Wechsel bekommt die **ganzen neuen Regeln** (`{ startMonth, changes }`) und vergleicht sie mit
den alten. So decken drei Wege der Oberfläche dieselbe Rechnung ab: Beginnmonat von Anfang an,
Wechsel ab einem Monat hinzufügen, Wechsel entfernen.

**Files:**
- Create: `server/src/db/periodChange.ts`
- Modify: `shared/types.ts`, `server/src/index.ts`
- Test: `server/test/db-wechsel.test.ts` (neu), `server/test/api.test.ts` (neuer Test); Modify: `server/test/db-zeitraum.test.ts` (Testname)

**Interfaces:**
- Consumes: `splitByService` (Task 3), `writeCostItemParts`, `PeriodError` (repository.ts), `rulesOf`, `periodOfKey`, `periodContaining`, `periodsBetween`, `periodMonths`, `periodLabel`, `parsePeriodKey`, `spansTwoYears`, `startYearOf` (shared/period.ts), `readProperties`, `readUnits`, `readTenancies`, `readCostItems`, `readClosedSettlements` (read.ts).
- Produces:
  - `type PeriodChangePreview`, `type PeriodChangeAnswers` (`shared/types.ts`, Gestalt unten)
  - `checkRules(raw: unknown): PeriodRules`, `previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null>`, `applyPeriodChange(db: Database, propertyId: string, rawRules: unknown, rawAnswers: unknown, newId: () => string, today: string): Promise<{ property: Property } | { error: string; preview: PeriodChangePreview } | null>`, `monthsText(months: readonly string[]): string` (`server/src/db/periodChange.ts`)
  - Routen `POST /api/properties/:id/period/preview` (200 Vorschau, 400, 404) und `PUT /api/properties/:id/period` (200 Objekt, 400, 404, 409 `{ error, preview }`)

- [ ] **Step 1: Write the failing test**

`server/test/db-wechsel.test.ts`:

```ts
// Wechsel des Abrechnungszeitraums (#208, Entwurf 3.6, N4, Testfall G-A1/N4 aus 12.2): Vorschau,
// Neuerfassung der Jahreskorrekturen, Aufteilen und Zuordnen der Positionen, Sperre neben einem
// Abschluss, alles in einer Transaktion.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { applyPeriodChange, monthsText, previewPeriodChange } from '../src/db/periodChange.ts'
import { closeSettlement, createEntity, listCollection, listProperties, PeriodError } from '../src/db/repository.ts'
import { assessments } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem, PeriodChangePreview, Tenancy } from '../../shared/types.ts'

const TODAY = '2026-10-05'
const MAI_AB_2025 = { startMonth: 1, changes: ['2025-05'] }
let n = 0
const ids = () => `neu-${++n}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-wechsel-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Der Bestand aus Testfall G-A1/N4: Mieter A das ganze Jahr mit Jahreskorrektur 2.200 € (Soll
// 2.400), Mieter B nur bis 28.02.2025 mit 350 €, Grundsteuer 480 € mit Leistungszeitraum 2025,
// Müllabfuhr ohne Leistungszeitraum.
async function bestand(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
    await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true })
    await createEntity(db, 'tenancies', 't-a', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: { '2025-01': 220000 } })
    await createEntity(db, 'tenancies', 't-b', { unitId: 'u2', tenantName: 'B', persons: 1, start: '2024-01-01', end: '2025-02-28', prepayments: [{ from: '2024-01', monthlyCents: 17500 }], prepaymentOverrides: { '2025-01': 35000 } })
    await createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 30000, key: 'area' })
  })
}

const items = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const tenancies = async (opened: OpenedDatabase): Promise<Tenancy[]> =>
  (await opened.read((db) => listCollection(db, 'tenancies'))).filter((e): e is Tenancy => 'tenantName' in e)
const rules = async (opened: OpenedDatabase) => (await opened.read(listProperties)).find((p) => p.id === 'objekt-1')?.periodRules
const preview = async (opened: OpenedDatabase, next: unknown): Promise<PeriodChangePreview> =>
  (await opened.read((db) => previewPeriodChange(db, 'objekt-1', next, TODAY))) ?? assert.fail('kein Objekt')

test('Monate in Worten', () => {
  assert.equal(monthsText(['2025-01', '2025-02', '2025-03', '2025-04']), '01–04/2025')
  assert.equal(monthsText(['2025-05', '2025-06', '2026-04']), '05/2025–04/2026')
  assert.equal(monthsText(['2025-03']), '03/2025')
})

test('Vorschau G-A1/N4: Rumpf, Aufteilen, Zuordnen und Neuerfassen der Jahreskorrektur nur für A', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const v = await preview(opened, MAI_AB_2025)
    assert.deepEqual(v.newShort, [{ key: '2025-01', label: '01.01.–30.04.2025' }])
    assert.ok(v.periods.some((p) => p.key === '2025-05' && p.label === '2025/2026'))
    assert.deepEqual(v.blocked, [])
    assert.deepEqual(v.moves.map((m) => [m.costItemId, m.parts.map((p) => [p.period, p.amountCents])]), [['gs', [['2025-01', 15781], ['2025-05', 32219]]]])
    assert.deepEqual(v.groups.map((g) => [g.from, g.fromLabel, g.items.map((i) => i.costItemId), g.options.map((o) => o.key), g.suggested]),
      [['2025-01', '2025', ['mu'], ['2025-01', '2025-05'], '2025-01']])
    assert.deepEqual(v.overrides, [{
      tenancyId: 't-a', tenantName: 'A',
      from: [{ key: '2025-01', label: '2025', cents: 220000 }],
      ask: [{ period: '2025-01', label: '01.01.–30.04.2025', months: '01–04/2025' }, { period: '2025-05', label: '2025/2026', months: '05/2025–04/2026' }],
    }], 'B lag ganz im Rumpf und behält seine Korrektur')
  })
})

test('Ohne Antworten wird nicht gespeichert, mit Antworten alles in einem Schritt (N4)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const ohne = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {}, ids, TODAY))
    assert.ok(ohne && 'error' in ohne, 'abgelehnt')
    assert.match(ohne.error, /Für den Wechsel fehlen Angaben/)
    assert.match(ohne.error, /„Müll 2025“/)
    assert.match(ohne.error, /A: tatsächlich gezahlt 01–04\/2025/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] }, 'nichts geschrieben')
    assert.equal((await items(opened)).length, 2)

    const ok = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {
      groups: { '2025-01': '2025-01' },
      overrides: { 't-a': { '2025-01': 70000, '2025-05': null } },
    }, ids, TODAY))
    assert.ok(ok && 'property' in ok)
    assert.deepEqual(ok.property.periodRules, MAI_AB_2025)
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.taxYear]).sort(), [
      ['2025-01', 15781, undefined], ['2025-01', 30000, undefined], ['2025-05', 32219, 2025],
    ])
    const korrektur = Object.fromEntries((await tenancies(opened)).map((t) => [t.id, t.prepaymentOverrides]))
    assert.deepEqual(korrektur, { 't-a': { '2025-01': 70000 }, 't-b': { '2025-01': 35000 } })
  })
})

test('Ein Wechsel neben einer abgeschlossenen Abrechnung wird abgelehnt, nichts geschrieben (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => closeSettlement(db, { id: 'z', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01T00:00:00Z', sentAt: null, settlement: {} }))
    const v = await preview(opened, MAI_AB_2025)
    assert.match(v.blocked.join(' '), /Die Abrechnung 2025 ist abgeschlossen/)
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, ids, TODAY))
    assert.ok(r && 'error' in r)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
    // Ein Wechsel nach dem abgeschlossenen Zeitraum geht.
    const spaeter = await preview(opened, { startMonth: 1, changes: ['2026-05'] })
    assert.deepEqual(spaeter.blocked, [])
  })
})

test('Eine Antwort, die nicht passt, oder eine veraltete Vorschau: 409 statt eines halben Wechsels (Review Focus 3)', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    const falsch = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {
      groups: { '2025-01': '2024-05' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } },
    }, ids, TODAY))
    assert.ok(falsch && 'error' in falsch)
    assert.match(falsch.error, /„Müll 2025“/)
    const halb = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {
      groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000 } },
    }, ids, TODAY))
    assert.ok(halb && 'error' in halb)
    assert.match(halb.error, /05\/2025–04\/2026/)
    assert.deepEqual(await rules(opened), { startMonth: 1, changes: [] })
    // Derselbe Wechsel ein zweites Mal: Es ändert sich nichts.
    await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } }, ids, TODAY))
    await assert.rejects(opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {}, ids, TODAY)),
      (err: unknown) => err instanceof PeriodError && /Es ändert sich nichts/.test(err.message))
  })
})

test('Regeln: Beginnmonat 1 bis 12, Monate als JJJJ-MM, kein Wechsel auf einen Monat, in dem ohnehin ein Zeitraum beginnt', async () => {
  await withDatabase(async (opened) => {
    const fehler = async (next: unknown, muster: RegExp) =>
      assert.rejects(opened.read((db) => previewPeriodChange(db, 'objekt-1', next, TODAY)), (err: unknown) => err instanceof PeriodError && muster.test(err.message))
    await fehler({ startMonth: 13, changes: [] }, /Januar bis Dezember/)
    await fehler({ startMonth: 1, changes: ['2025-5'] }, /kein Monat/)
    await fehler({ startMonth: 1, changes: ['2026-01'] }, /Ab Januar 2026 beginnt ohnehin ein Abrechnungszeitraum/)
    await fehler(null, /Rhythmus/)
    assert.equal(await opened.read((db) => previewPeriodChange(db, 'gibt-es-nicht', MAI_AB_2025, TODAY)), null)
  })
})

test('Einen Wechsel entfernen: Der Rumpf wächst wieder zum Jahr, beide Korrekturen werden neu erfasst', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened)
    await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': 240000 } } }, ids, TODAY))
    const v = await preview(opened, { startMonth: 1, changes: [] })
    const a = v.overrides.find((o) => o.tenancyId === 't-a') ?? assert.fail('A fehlt')
    assert.deepEqual(a.ask.map((x) => [x.period, x.months]), [['2025-01', '01–12/2025'], ['2026-01', '01–12/2026']])
    assert.deepEqual(v.newShort, [])
  })
})

test('Eine Auswertung wandert auf den Zeitraum mit der größten Überschneidung, wenn es ihren nicht mehr gibt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a1', file: 'a.pdf', propertyId: 'objekt-1', year: 2026, requestedPeriod: periodKey('2026-01'), createdAt: '2026-03-01T00:00:00Z' })
    })
    const v = await preview(opened, MAI_AB_2025)
    assert.deepEqual(v.assessments, [{ assessmentId: 'a1', file: 'a.pdf', from: '2026-01', to: '2026-05', toLabel: '2026/2027' }])
    await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, {}, ids, TODAY))
    const [row] = await opened.read((db) => db.select().from(assessments))
    assert.equal(row?.requestedPeriod, '2026-05')
  })
})
```

In `server/test/db-zeitraum.test.ts` (PR 2, Task 3) den Testnamen „Der Rhythmus lässt sich in
dieser Version nicht über die Objekte setzen (Bedienung: PR 3)“ ändern in „Der Rhythmus lässt sich
nicht über PUT /api/properties setzen, nur über den Wechsel mit Vorschau (#208)“; der Rumpf bleibt.

An `server/test/api.test.ts` anhängen:

```ts
test('Wechsel des Zeitraums (#208): Vorschau und Speichern über HTTP, 409 ohne Antworten', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    await s.api('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2025-01': 220000 } }) })
    const [objekt] = await s.api<{ id: string }[]>('/api/properties')
    const id = objekt?.id ?? assert.fail('kein Objekt')
    const next = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await s.api<{ overrides: { ask: { period: string }[] }[] }>(`/api/properties/${id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: next }) })
    assert.deepEqual(vorschau.overrides[0]?.ask.map((a) => a.period), ['2025-01', '2025-05'])
    const ohne = await fetch(`${s.base}/api/properties/${id}/period`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: next }) })
    assert.equal(ohne.status, 409)
    const tenancyId = (await s.api<{ id: string }[]>('/api/tenancies'))[0]?.id ?? assert.fail('kein Mietverhältnis')
    const property = await s.api<{ periodRules: unknown }>(`/api/properties/${id}`, {
      method: 'PUT', body: JSON.stringify({ periodRules: { startMonth: 5, changes: [] } }),
    })
    assert.deepEqual(property.periodRules, { startMonth: 1, changes: [] }, 'PUT /api/properties setzt den Rhythmus nicht')
    const gewechselt = await s.api<{ periodRules: unknown }>(`/api/properties/${id}/period`, {
      method: 'PUT', body: JSON.stringify({ rules: next, answers: { overrides: { [tenancyId]: { '2025-01': 70000, '2025-05': null } } } }),
    })
    assert.deepEqual(gewechselt.periodRules, next)
    assert.equal((await s.api<{ period: { label: string } }>('/api/settlement/2025-01')).period.label, '01.01.–30.04.2025')
    const falsch = await fetch(`${s.base}/api/properties/${id}/period/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { startMonth: 0, changes: [] } }) })
    assert.equal(falsch.status, 400)
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-wechsel.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/db/periodChange.ts`.

- [ ] **Step 3: Typen**

`shared/types.ts`, hinter `SplitPreviewPart`:

```ts
// Die Vorschau eines Wechsels des Abrechnungszeitraums (#208, Entwurf 3.6). `blocked`: Gründe, aus
// denen nicht gewechselt wird (abgeschlossene Abrechnungen). `moves`: kalte Rechnungen mit
// Leistungszeitraum, die nach Tagen auf die neuen Zeiträume aufgeteilt werden oder in einen
// anderen wandern. `groups`: Positionen ohne Leistungszeitraum und Heizkosten je bisherigem
// Zeitraum, die der Vermieter zuordnet. `overrides`: Jahreskorrekturen, die neu erfasst werden,
// je Mietverhältnis mit den Zeiträumen, für die gefragt wird. `assessments`: Belegauswertungen,
// deren gewählter Zeitraum entfällt.
export type PeriodChangePreview = {
  rules: PeriodRules
  periods: { key: PeriodKey; label: string; short: boolean }[]
  newShort: { key: PeriodKey; label: string }[]
  blocked: string[]
  moves: { costItemId: string; description: string; amountCents: number; parts: { period: PeriodKey; label: string; amountCents: number }[] }[]
  groups: { from: PeriodKey; fromLabel: string; items: { costItemId: string; description: string; amountCents: number }[]; options: { key: PeriodKey; label: string }[]; suggested: PeriodKey }[]
  overrides: { tenancyId: string; tenantName: string; from: { key: PeriodKey; label: string; cents: number }[]; ask: { period: PeriodKey; label: string; months: string }[] }[]
  assessments: { assessmentId: string; file: string; from: PeriodKey; to: PeriodKey; toLabel: string }[]
}

// Die Antworten zur Vorschau: je Gruppe (bisheriger Zeitraum) der neue Zeitraum; je
// Mietverhältnis und gefragtem Zeitraum der tatsächlich gezahlte Betrag in Cent, `null` heißt
// „keine Korrektur, es gilt die Staffel“. Eine fehlende Antwort ist keine Antwort (409).
export type PeriodChangeAnswers = {
  groups?: Record<string, string>
  overrides?: Record<string, Record<string, number | null>>
}
```

- [ ] **Step 4: `server/src/db/periodChange.ts`**

```ts
// Wechsel des Abrechnungszeitraums mit Vorschau (#208, Entwurf 3.6).
//
// Ein Objekt rechnet nach seinen Regeln ab (Beginnmonat und Wechsel, shared/period.ts). Ändern
// sich die Regeln, ändern sich Zeiträume, an denen Daten hängen: Kostenpositionen,
// Jahreskorrekturen, Abschlüsse, gewählte Zeiträume von Belegauswertungen. Diese Datei rechnet,
// was mit jeder dieser Zeilen geschieht, zeigt es vorher (Vorschau) und schreibt es dann in einer
// Transaktion, und zwar nur mit den Antworten, die die Vorschau verlangt.
//
// **Abgeschlossene Zeiträume sind unantastbar.** Hätte eine abgeschlossene Abrechnung nach dem
// Wechsel einen anderen Zeitraum, wird nicht gewechselt (409); wer das will, öffnet sie wieder
// (#56). Ein früherer Abschluss im Verlauf sperrt nur, wenn es seinen Zeitraum gar nicht mehr gäbe.
//
// **Eine tatsächlich gezahlte Summe lässt sich nicht auf Monate verteilen** (N4). Hat ein
// Mietverhältnis eine Jahreskorrektur und nach dem Wechsel Monate in mehr als einem Zeitraum oder
// in einem anders geschnittenen, fragt die Vorschau je neuem Zeitraum „tatsächlich gezahlt …“ und
// rechnet nicht. Liegen seine Monate unverändert in einem Zeitraum, wandert die Korrektur dorthin.
// Ohne Antwort würden sonst im Rumpf 2.400 € statt 800 € angerechnet (Testfall G-A1).
//
// **Kalte Rechnungen mit Leistungszeitraum werden nach Tagen aufgeteilt** (Entwurf 3.4, dieselbe
// Regel wie beim Speichern, serviceSplit.ts). Ohne Leistungszeitraum und bei Heizkosten (die nie
// nach Tagen geteilt werden) ordnet der Vermieter je bisherigem Zeitraum zu.
//
// Gelesen wird vor der Transaktion (die Lesefunktionen aus read.ts nehmen die Verbindung); die
// Schlange in open.ts lässt zwischen Lesen und Schreiben keine andere Anfrage herein.

import { and, eq, inArray } from 'drizzle-orm'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import {
  parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, spansTwoYears, startYearOf,
} from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, PeriodChangePreview, PeriodKey, PeriodRules, Property, Tenancy } from '../../../shared/types.ts'
import { splitByService, type ServicePart } from '../serviceSplit.ts'
import type { Database } from './client.ts'
import { readClosedSettlements, readCostItems, readProperties, readTenancies, readUnits } from './read.ts'
import { PeriodError, writeCostItemParts } from './repository.ts'
import { assessments, closedSettlementHistory, costItems, periodChanges, prepaymentOverrides, properties } from './schema.ts'

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthName = (key: string): string => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`

// Monate in Worten: „01–04/2025“, über den Jahreswechsel „05/2025–04/2026“, ein Monat „03/2025“.
export function monthsText(months: readonly string[]): string {
  const first = months[0]
  const last = months[months.length - 1]
  if (first === undefined || last === undefined) return ''
  const mm = (m: string) => m.slice(5, 7)
  const yy = (m: string) => m.slice(0, 4)
  if (first === last) return `${mm(first)}/${yy(first)}`
  return yy(first) === yy(last) ? `${mm(first)}–${mm(last)}/${yy(first)}` : `${mm(first)}/${yy(first)}–${mm(last)}/${yy(last)}`
}

// Die neuen Regeln aus dem Rumpf, geprüft. Ein Wechsel auf einen Monat, in dem ohnehin ein
// Zeitraum beginnt, ist keiner: Es entstünde kein Rumpf, und die Liste hätte einen toten Eintrag.
export function checkRules(raw: unknown): PeriodRules {
  if (raw === null || typeof raw !== 'object') throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const startMonth: unknown = Reflect.get(raw, 'startMonth')
  const changes: unknown = Reflect.get(raw, 'changes')
  if (typeof startMonth !== 'number' || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new PeriodError('Der Abrechnungszeitraum beginnt in einem Monat von Januar bis Dezember.')
  }
  if (!Array.isArray(changes)) throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const keys: PeriodKey[] = []
  for (const c of changes) {
    const key = parsePeriodKey(c)
    if (key === null) throw new PeriodError(`„${String(c)}“ ist kein Monat (JJJJ-MM).`)
    if (!keys.includes(key)) keys.push(key)
  }
  keys.sort()
  const rules: PeriodRules = { startMonth, changes: [] }
  for (const key of keys) {
    if (periodContaining(rules, `${key}-01`).from === `${key}-01`) {
      throw new PeriodError(`Ab ${monthName(key)} beginnt ohnehin ein Abrechnungszeitraum; ein Wechsel dorthin ändert nichts.`)
    }
    rules.changes.push(key)
  }
  return rules
}

type Status = 'same' | 'grows' | 'shrinks' | 'gone'
type Affected = { key: PeriodKey; old: BillingPeriod; now: BillingPeriod | null; status: Status }

function affectedOf(before: PeriodRules, next: PeriodRules, key: PeriodKey): Affected | null {
  const old = periodOfKey(before, key)
  // Ein Schlüssel ohne Zeitraum ist verwaist; das Wiederherstellen lehnt ihn ab (orphanPeriodKeys).
  if (old === null) return null
  const now = periodOfKey(next, key)
  const status: Status = now === null ? 'gone'
    : now.from === old.from && now.to === old.to ? 'same'
      : now.from <= old.from && now.to >= old.to ? 'grows' : 'shrinks'
  return { key, old, now, status }
}

// Die Monate eines Zeitraums, in denen das Mietverhältnis am Monatsersten besteht: dieselbe Regel
// wie `computePrepaymentCents` in calc.ts.
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: BillingPeriod): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))

const MS_DAY = 86400000
const overlapDays = (a: BillingPeriod, b: BillingPeriod): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1
}

// Der neue Zeitraum für Daten eines bisherigen: derselbe Schlüssel, wenn es ihn noch gibt, sonst
// der mit der größten Überschneidung, bei Gleichstand der frühere.
function bestFor(a: Affected, options: readonly BillingPeriod[]): BillingPeriod {
  if (a.now !== null) return a.now
  let best = options[0] ?? a.old
  for (const p of options) if (overlapDays(p, a.old) > overlapDays(best, a.old)) best = p
  return best
}

type OverrideAsk = { tenancy: Tenancy; drop: Set<PeriodKey>; from: { key: PeriodKey; label: string; cents: number }[]; ask: Map<PeriodKey, { period: BillingPeriod; months: string[] }> }

type Plan = {
  preview: PeriodChangePreview
  splits: { item: CostItem; parts: ServicePart[] }[]
  groups: Map<PeriodKey, { items: CostItem[]; options: BillingPeriod[] }>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
  assessmentMoves: { id: string; to: PeriodKey }[]
  next: PeriodRules
}

async function planPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<Plan | null> {
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  if (!property) return null
  const next = checkRules(rawRules)
  const before = rulesOf(property)
  if (before.startMonth === next.startMonth && before.changes.join() === next.changes.join()) {
    throw new PeriodError('Es ändert sich nichts: Der Abrechnungszeitraum ist schon so eingestellt.')
  }
  const unitIds = new Set((await readUnits(db)).filter((u) => u.propertyId === propertyId).map((u) => u.id))
  const tenancies = (await readTenancies(db)).filter((t) => unitIds.has(t.unitId))
  const items = (await readCostItems(db)).filter((c) => c.propertyId === propertyId)
  const closed = (await readClosedSettlements(db)).filter((c) => c.propertyId === propertyId)
  const history = await db.select({ period: closedSettlementHistory.period }).from(closedSettlementHistory).where(eq(closedSettlementHistory.propertyId, propertyId))
  const assessmentRows = await db.select({ id: assessments.id, file: assessments.file, period: assessments.requestedPeriod }).from(assessments).where(eq(assessments.propertyId, propertyId))

  const memo = new Map<PeriodKey, Affected | null>()
  const changed = (key: PeriodKey): Affected | null => {
    if (!memo.has(key)) memo.set(key, affectedOf(before, next, key))
    const a = memo.get(key) ?? null
    return a !== null && a.status !== 'same' ? a : null
  }
  const optionsFor = (a: Affected): BillingPeriod[] => periodsBetween(next, a.old.from, a.old.to)

  const blocked = new Set<string>()
  for (const c of closed) {
    const a = changed(c.period)
    if (a) blocked.add(`Die Abrechnung ${periodLabel(a.old)} ist abgeschlossen; nach dem Wechsel hätte sie einen anderen Zeitraum. Öffnen Sie sie wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
  }
  for (const h of history) {
    const a = changed(h.period)
    if (a?.status === 'gone') blocked.add(`Für ${periodLabel(a.old)} gibt es frühere Abschlüsse im Verlauf; diesen Zeitraum gäbe es nach dem Wechsel nicht mehr. Wählen Sie einen späteren Beginn.`)
  }

  const splits: Plan['splits'] = []
  const groups: Plan['groups'] = new Map()
  for (const item of items) {
    const a = changed(item.period)
    // Ein Zeitraum, der nur wächst, behält seine Positionen: Sie gehören weiter hinein.
    if (a === null || a.status === 'grows') continue
    if (item.category !== HEATING_CATEGORY && item.serviceFrom !== undefined && item.serviceTo !== undefined) {
      const parts = splitByService(next, { ...item, serviceFrom: item.serviceFrom, serviceTo: item.serviceTo })
      if (parts.length === 1 && parts[0]?.period.key === item.period) continue
      splits.push({ item, parts })
      continue
    }
    const g = groups.get(a.key) ?? { items: [], options: optionsFor(a) }
    g.items.push(item)
    groups.set(a.key, g)
  }

  const overrideRekeys: Plan['overrideRekeys'] = []
  const asks = new Map<string, OverrideAsk>()
  for (const t of tenancies) {
    for (const [schluessel, cents] of Object.entries(t.prepaymentOverrides)) {
      const key = parsePeriodKey(schluessel)
      const a = key === null ? null : changed(key)
      if (key === null || a === null) continue
      const oldMonths = activeMonths(t, a.old)
      const withMonths = optionsFor(a).map((p) => ({ period: p, months: activeMonths(t, p) })).filter((x) => x.months.length > 0)
      const only = withMonths.length === 1 ? withMonths[0] : undefined
      if (only && only.months.join() === oldMonths.join()) {
        if (only.period.key !== key) overrideRekeys.push({ tenancyId: t.id, from: key, to: only.period.key })
        continue
      }
      const entry = asks.get(t.id) ?? { tenancy: t, drop: new Set<PeriodKey>(), from: [], ask: new Map() }
      entry.drop.add(key)
      entry.from.push({ key, label: periodLabel(a.old), cents })
      for (const x of withMonths) entry.ask.set(x.period.key, x)
      asks.set(t.id, entry)
    }
  }

  const assessmentMoves: Plan['assessmentMoves'] = []
  const assessmentPreview: PeriodChangePreview['assessments'] = []
  for (const r of assessmentRows) {
    const a = r.period === null ? null : changed(r.period)
    if (a === null || a.status !== 'gone') continue
    const to = bestFor(a, optionsFor(a))
    assessmentMoves.push({ id: r.id, to: to.key })
    assessmentPreview.push({ assessmentId: r.id, file: r.file, from: a.key, to: to.key, toLabel: periodLabel(to) })
  }

  // Die Zeiträume im Umfeld des Wechsels, für die Liste der Vorschau.
  const years = [...[...memo.values()].flatMap((a) => (a ? [a.old.from] : [])), ...next.changes.map((c) => `${c}-01`), ...before.changes.map((c) => `${c}-01`), today].sort()
  const listFrom = `${Number((years[0] ?? today).slice(0, 4)) - 1}-01-01`
  const listTo = `${Number((years[years.length - 1] ?? today).slice(0, 4)) + 1}-12-31`
  const periods = periodsBetween(next, listFrom, listTo)
  const wasShort = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old !== null && old.short && old.from === p.from && old.to === p.to
  }

  const preview: PeriodChangePreview = {
    rules: next,
    periods: periods.map((p) => ({ key: p.key, label: periodLabel(p), short: p.short })),
    newShort: periods.filter((p) => p.short && !wasShort(p)).map((p) => ({ key: p.key, label: periodLabel(p) })),
    blocked: [...blocked],
    moves: splits.map(({ item, parts }) => ({
      costItemId: item.id, description: item.description, amountCents: item.amountCents,
      parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })),
    })),
    groups: [...groups.entries()].map(([from, g]) => {
      const a = changed(from) ?? noFinding(from)
      return {
        from,
        fromLabel: periodLabel(a.old),
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p) })),
        suggested: bestFor(a, g.options).key,
      }
    }),
    overrides: [...asks.values()].map((o) => ({
      tenancyId: o.tenancy.id,
      tenantName: o.tenancy.tenantName,
      from: o.from,
      ask: [...o.ask.values()].map((x) => ({ period: x.period.key, label: periodLabel(x.period), months: monthsText(x.months) })),
    })),
    assessments: assessmentPreview,
  }
  return { preview, splits, groups, overrideRekeys, overrideAsks: [...asks.values()], assessmentMoves, next }
}

// Eine Gruppe ohne betroffenen Zeitraum gibt es nicht; der Aufruf oben fragt nur bekannte.
function noFinding(key: PeriodKey): never {
  throw new Error(`Zeitraum ${key} ohne Befund in der Vorschau`)
}

export async function previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null> {
  return (await planPeriodChange(db, propertyId, rawRules, today))?.preview ?? null
}

type Answers = { groups: Record<string, unknown>; overrides: Record<string, unknown> }
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const readAnswers = (raw: unknown): Answers => {
  const a = objectOr(raw)
  return { groups: objectOr(a.groups), overrides: objectOr(a.overrides) }
}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Was an Antworten fehlt oder nicht passt, als Sätze für die Meldung.
function missingAnswers(plan: Plan, answers: Answers): string[] {
  const missing: string[] = []
  for (const [from, g] of plan.groups) {
    const chosen = answers.groups[from]
    if (!g.options.some((p) => p.key === chosen)) {
      missing.push(`Zeitraum für ${g.items.map((i) => `„${i.description}“`).join(', ')} wählen.`)
    }
  }
  for (const o of plan.overrideAsks) {
    const given = objectOr(answers.overrides[o.tenancy.id])
    for (const x of o.ask.values()) {
      const v = given[x.period.key]
      if (!Object.hasOwn(given, x.period.key) || !(v === null || isCents(v))) {
        missing.push(`${o.tenancy.tenantName}: tatsächlich gezahlt ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`)
      }
    }
  }
  return missing
}

// Das Jahr der Zahlung einer Position im neuen Zeitraum (Entwurf 3.10): Reicht er über zwei
// Kalenderjahre, das bisherige oder das Kalenderjahr, in dem ihr bisheriger Zeitraum begann (dort
// war sie bisher für die Steuer gezählt); sonst keines.
const taxYearIn = (target: BillingPeriod | null, item: CostItem): number | null =>
  target !== null && spansTwoYears(target) ? item.taxYear ?? startYearOf(item.period) : null

export async function applyPeriodChange(
  db: Database, propertyId: string, rawRules: unknown, rawAnswers: unknown, newId: () => string, today: string,
): Promise<{ property: Property } | { error: string; preview: PeriodChangePreview } | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  if (plan === null) return null
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const answers = readAnswers(rawAnswers)
  const missing = missingAnswers(plan, answers)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const { next } = plan
  await db.transaction(async (tx) => {
    await tx.update(properties).set({ periodStartMonth: next.startMonth }).where(eq(properties.id, propertyId))
    await tx.delete(periodChanges).where(eq(periodChanges.propertyId, propertyId))
    if (next.changes.length > 0) await tx.insert(periodChanges).values(next.changes.map((fromMonth) => ({ propertyId, fromMonth })))
    for (const { item, parts } of plan.splits) {
      await writeCostItemParts(tx, item, parts.map((p) => ({
        period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
      })), newId, item.id)
    }
    for (const [from, g] of plan.groups) {
      const target = g.options.find((p) => p.key === answers.groups[from]) ?? null
      if (target === null) continue
      for (const item of g.items) {
        await tx.update(costItems).set({ period: target.key, taxYear: taxYearIn(target, item) }).where(eq(costItems.id, item.id))
      }
    }
    for (const r of plan.overrideRekeys) {
      await tx.update(prepaymentOverrides).set({ period: r.to }).where(and(eq(prepaymentOverrides.tenancyId, r.tenancyId), eq(prepaymentOverrides.period, r.from)))
    }
    for (const o of plan.overrideAsks) {
      await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, o.tenancy.id), inArray(prepaymentOverrides.period, [...o.drop])))
      const given = objectOr(answers.overrides[o.tenancy.id])
      const rows = [...o.ask.keys()].flatMap((key) => {
        const cents = given[key]
        return isCents(cents) ? [{ tenancyId: o.tenancy.id, period: key, amountCents: cents }] : []
      })
      if (rows.length > 0) await tx.insert(prepaymentOverrides).values(rows)
    }
    for (const m of plan.assessmentMoves) await tx.update(assessments).set({ requestedPeriod: m.to }).where(eq(assessments.id, m.id))
  })
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  return property ? { property } : null
}
```

- [ ] **Step 5: Routen (`server/src/index.ts`)**

Import `applyPeriodChange, previewPeriodChange` aus `./db/periodChange.ts`. Hinter
`app.delete('/api/properties/:id', …)`:

```ts
// Wechsel des Abrechnungszeitraums (#208, Entwurf 3.6): erst die Vorschau, dann der Wechsel mit
// den Antworten, in einer Transaktion. Fehlt eine Antwort oder träfe der Wechsel eine
// abgeschlossene Abrechnung, antwortet der Server mit 409 und der neuen Vorschau, gespeichert ist
// nichts. Begründung in db/periodChange.ts.
app.post('/api/properties/:id/period/preview', async (req, res) => {
  const preview = await readData((db) => previewPeriodChange(db, req.params.id, bodyObject(req).rules, today()))
  if (!preview) return res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
  res.json(preview)
})
app.put('/api/properties/:id/period', async (req, res) => {
  const body = bodyObject(req)
  const result = await writeData((db) => applyPeriodChange(db, req.params.id, body.rules, body.answers, newId, today()))
  if (!result) return res.status(404).json({ error: 'Dieses Objekt gibt es nicht (mehr).' })
  if ('error' in result) return res.status(409).json(result)
  res.json(result.property)
})
```

(`today` steht seit PR 2 unter „Abrechnung“; die neuen Routen stehen davor. Die Konstante
`const today = …` deshalb vor die Objektrouten verschieben, mit ihrem Kommentar.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-wechsel.test.ts test/db-zeitraum.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Wechsel des Zeitraums" && npm run typecheck`
Expected: PASS (db-wechsel 8 Tests, api 1).

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/db/periodChange.ts server/src/index.ts server/test/db-wechsel.test.ts server/test/db-zeitraum.test.ts server/test/api.test.ts
git commit -m "Zeitraum: Abrechnungszeitraum wechseln mit Vorschau, Neuerfassung der Jahreskorrekturen und Sperre neben Abschlüssen

Refs #208"
```

---
### Task 5: Hinweise zum Zeitraum und Lexikon

Entwurf 10.1 weist PR 3 vier Hinweise zu: `period.short` (hint, färbt nicht), `period.item-outside`
(warning), `period.heating-mismatch` (warning) und `period.split-by-days-meter` (hint); dazu kommt
in Task 6 `prepayment.no-suggestion`. Jeder Code trägt Begriffe aus dem Lexikon (10.3: Zeiträume
`billingPeriod`, `shortPeriod`, `accrualPrinciple`; für den Vorschlag `degreeDays`). Alle vier
Hinweise entstehen nur bei einem Rumpf oder einer Position mit Leistungszeitraum; ein Bestand im
Kalenderjahr ohne Leistungszeitraum bekommt keinen.

**Files:**
- Modify: `server/src/calc.ts`, `shared/glossary.ts`, `client/src/notices.ts`
- Test: `server/test/calc-zeitraum-hinweise.test.ts` (neu); Modify: `server/test/glossary.test.ts`, `client/src/notices.test.ts`

**Interfaces:**
- Consumes: `formatDayRange` (Task 2), `HEATING_CATEGORY`, `dayBefore` (PR 1, register.ts), in `computeSettlement` `period`, `label`, `yFrom`, `yTo`, `items`, `warn`, `itemSubject` (PR 2).
- Produces: Codes `period.short`, `period.item-outside`, `period.heating-mismatch`, `period.split-by-days-meter` in `noticeKinds`; Begriffe `billingPeriod`, `shortPeriod`, `accrualPrinciple`, `degreeDays` in `GLOSSARY`; `period.short` in `INFORMATIONAL` (client/src/notices.ts).

- [ ] **Step 1: Write the failing tests**

`server/test/calc-zeitraum-hinweise.test.ts`:

```ts
// Hinweise zum Abrechnungszeitraum (#208, Entwurf 3.4, 3.6, 10.1).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (rules: PeriodRules, key: string, items: SnapshotCostItem[]) => {
  const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
  return computeSettlement(snapshotOfPeriod(haus(items), p, previousPeriod(rules, p)))
}
const codes = (s: ReturnType<typeof settle>) => s.notices.map((n) => n.code).filter((c) => c.startsWith('period.'))
const item = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({ id: 'k', period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area', ...over })

test('Rumpf: ein Hinweis mit dem sachlichen Grund und dem Mietvertrag (Entwurf 3.6)', () => {
  const s = settle(WECHSEL, '2025-01', [item({})])
  const n = s.notices.find((x) => x.code === 'period.short') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.equal(n.text, 'Rumpfzeitraum 01.01.–30.04.2025 wegen der Umstellung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.')
  assert.deepEqual(codes(settle(WECHSEL, '2025-05', [item({ period: periodKey('2025-05') })])), [], 'ein voller Zeitraum bekommt ihn nicht')
})

test('Leistungszeitraum außerhalb: warning mit Leistungs- und Abrechnungszeitraum', () => {
  const s = settle(WECHSEL, '2025-01', [item({ description: 'Versicherung 2024', serviceFrom: '2024-01-01', serviceTo: '2024-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.item-outside') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.equal(n.text, '„Versicherung 2024“: Der Leistungszeitraum 01.01.–31.12.2024 liegt außerhalb des Abrechnungszeitraums 01.01.–30.04.2025. Gehört die Rechnung in einen anderen Zeitraum, ordnen Sie sie dort zu.')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'k' })
})

test('Heizkosten über den Zeitraum hinaus: warning nach VIII ZR 156/11, ohne Aufteilen', () => {
  const s = settle(WECHSEL, '2025-01', [item({ category: 'Heizung und Warmwasser', description: 'Wartung', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.heating-mismatch') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /^„Wartung“: Heizkosten gehören in den Abrechnungszeitraum, in dem sie verbraucht wurden \(BGH VIII ZR 156\/11\)\. Der Leistungszeitraum 01\.01\.–31\.12\.2025 reicht über 01\.01\.–30\.04\.2025 hinaus/)
})

test('Ein Verbrauch nach Zählern, nach Tagen aufgeteilt: hint auf den Zählerstand zum Stichtag (Z-B11)', () => {
  const s = settle(WECHSEL, '2025-01', [item({ category: 'Wasser/Abwasser', description: 'Wasser 2025 (anteilig 01.01.–30.04.2025)', key: 'meter', meterType: 'kaltwasser', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.split-by-days-meter') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.equal(n.text, '„Wasser 2025 (anteilig 01.01.–30.04.2025)“ ist nach Tagen auf die Abrechnungszeiträume aufgeteilt. Mit dem Zählerstand zum 30.04.2025 wäre die Aufteilung genauer.')
  assert.deepEqual(codes(settle(WECHSEL, '2025-01', [item({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])), ['period.short'], 'nach Fläche geteilt: kein Hinweis auf Zähler')
})

test('Kalenderjahr mit Leistungszeitraum im Jahr: kein Hinweis (Review Focus 4)', () => {
  const s = computeSettlement(snapshotOf(haus([{ ...item({ category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }) }]), 2025))
  assert.deepEqual(codes(s), [])
})
```

In `server/test/glossary.test.ts` anhängen:

```ts
test('Zeiträume (#208): Abrechnungszeitraum, Rumpf, Leistungsprinzip und Gradtage mit nachgerechneten Beispielen', () => {
  assert.match(GLOSSARY.billingPeriod.example, /01\.05\.2025 bis 30\.04\.2026.*30\.04\.2027/s)
  assert.match(GLOSSARY.shortPeriod.example, /120 Tagen.*30\.04\.2026/s)
  // 480 € · 120/365 = 157,81 €, 480 € · 245/365 = 322,19 €
  assert.equal((48000 * 120 / 365 / 100).toFixed(2), '157.81')
  assert.equal((48000 * 245 / 365 / 100).toFixed(2), '322.19')
  assert.match(GLOSSARY.accrualPrinciple.example, /157,81 €.*322,19 €/s)
  // Januar bis April 530 Promille; 700 € / 0,53 = 1.320,75 € im Jahr, 110,06 € im Monat
  assert.match(GLOSSARY.degreeDays.example, /530 Promille.*1\.320,75 €.*110,06 €/s)
  assert.equal((70000 / 0.53 / 100).toFixed(2), '1320.75')
  assert.equal((70000 / 0.53 / 12 / 100).toFixed(2), '110.06')
  assert.match(GLOSSARY.degreeDays.norm, /§ 9b Abs\. 2 HeizkostenV/)
})
```

In `client/src/notices.test.ts` anhängen (die Fabrik `n` steht am Kopf der Datei):

```ts
test('Ein Rumpfzeitraum färbt die Ampel nicht (#208)', () => {
  const s = { warnings: ['Rumpfzeitraum …'], notices: [n({ code: 'period.short', level: 'hint', title: 'Rumpfzeitraum', text: 'Rumpfzeitraum …' })] }
  expect(noticesNeedAttention(s)).toBe(false)
  expect(attentionLevel(s)).toBe('gruen')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-zeitraum-hinweise.test.ts test/glossary.test.ts && npm --prefix client test -- notices`
Expected: FAIL: keine Hinweise `period.*`, `GLOSSARY.billingPeriod` fehlt (Übersetzer), die Ampel
färbt `period.short` gelb.

- [ ] **Step 3: Hinweis-Codes (`server/src/calc.ts`)**

In `noticeKinds` hinter `'cost.possible-duplicate'`:

```ts
  // Abrechnungszeitraum (#208, Entwurf 3.4, 3.6, 10.1)
  'period.short': { level: 'hint', title: 'Rumpfzeitraum', terms: ['shortPeriod', 'billingPeriod'] },
  'period.item-outside': { level: 'warning', title: 'Leistungszeitraum außerhalb des Abrechnungszeitraums', terms: ['accrualPrinciple', 'billingPeriod'] },
  'period.heating-mismatch': { level: 'warning', title: 'Heizkosten aus einem anderen Zeitraum', terms: ['accrualPrinciple', 'heatingCostOrdinance'] },
  'period.split-by-days-meter': { level: 'hint', title: 'Verbrauch nach Tagen aufgeteilt', terms: ['accrualPrinciple', 'meterReading'] },
```

Importe ergänzen: `formatDayRange` aus `'../../shared/period.ts'`, `dayBefore` aus
`'../../shared/law/register.ts'` (falls nicht schon importiert).

In `computeSettlement` direkt vor dem Block „Ohne Abrechnung (#93)“:

```ts
  // ---------- Zeitraum (#208, Entwurf 3.4, 3.6) ----------
  // Nur ein Rumpf und nur Positionen mit Leistungszeitraum ergeben hier etwas; ein Bestand im
  // Kalenderjahr ohne Leistungszeitraum bekommt keinen dieser Hinweise.
  if (period.short) {
    warn('period.short', `Rumpfzeitraum ${label} wegen der Umstellung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.`)
  }
  for (const item of items) {
    if (item.serviceFrom === undefined || item.serviceTo === undefined) continue
    const range = formatDayRange(item.serviceFrom, item.serviceTo)
    if (item.serviceTo < yFrom || item.serviceFrom > yTo) {
      warn('period.item-outside', `„${item.description}“: Der Leistungszeitraum ${range} liegt außerhalb des Abrechnungszeitraums ${label}. Gehört die Rechnung in einen anderen Zeitraum, ordnen Sie sie dort zu.`, itemSubject(item))
      continue
    }
    if (item.serviceFrom >= yFrom && item.serviceTo <= yTo) continue
    if (item.category === HEATING_CATEGORY) {
      // Heizkosten werden nie nach Tagen geteilt (G-C1): Sie müssen den Verbrauch des Zeitraums
      // abbilden, und Winter und Sommer verbrauchen nicht gleich viel.
      warn('period.heating-mismatch',
        `„${item.description}“: Heizkosten gehören in den Abrechnungszeitraum, in dem sie verbraucht wurden (BGH VIII ZR 156/11). Der Leistungszeitraum ${range} reicht über ${label} hinaus, und Heizkosten teilt Mietfuchs nicht nach Tagen auf. ` +
          'Lassen Sie die Rechnung zum Stichtag abgrenzen (Zählerstand oder Zwischenrechnung des Versorgers), oder rechnen Sie im Zeitraum Ihres Messdienstes ab.',
        itemSubject(item))
    } else if (item.key === 'meter') {
      // Ein Teil einer aufgeteilten Rechnung (Task 3 trägt an jedem Teil den ganzen
      // Leistungszeitraum). Zeitanteilig ist zulässig, mit dem Zählerstand genauer (Z-B11).
      const stichtag = item.serviceTo > yTo ? yTo : dayBefore(yFrom)
      warn('period.split-by-days-meter', `„${item.description}“ ist nach Tagen auf die Abrechnungszeiträume aufgeteilt. Mit dem Zählerstand zum ${fmtDay(stichtag)} wäre die Aufteilung genauer.`, itemSubject(item))
    }
  }
```

(`items` ist seit PR 2 die Liste der Positionen von P, `fmtDay` steht in calc.ts.)

- [ ] **Step 4: Lexikon (`shared/glossary.ts`)**

Importe: `hkvDegreeDays` aus `'./law/heizkostenv.ts'`, `onlyVersion` aus `'./law/register.ts'`.
Vor `export const GLOSSARY`:

```ts
// Die Gradtagstabelle kommt aus dem Register (Entwurf 10.3: „Die Zahlen kommen aus dem Register“).
const DEGREE_DAYS = onlyVersion(hkvDegreeDays).value
const winterPermille = ['01', '02', '03', '04'].reduce((a, m) => a + (DEGREE_DAYS.months[m] ?? 0), 0)
const deEuro = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

In `GLOSSARY` hinter `settlementDeadline`:

```ts
  // #208: Abrechnungszeitraum, Rumpf und Leistungsprinzip. § 556 Abs. 3 BGB und VIII ZR 316/10,
  // VIII ZR 49/07, VIII ZR 156/11 gelesen am 05.10.2026 (Entwurf 2).
  billingPeriod: {
    title: 'Abrechnungszeitraum',
    short: 'Die Zeit, über die Sie die Nebenkosten abrechnen: höchstens zwölf Monate, meist das Kalenderjahr, auf Wunsch etwa Mai bis April wie Ihr Messdienst.',
    example: 'Ein Objekt rechnet von Mai bis April ab: Der Zeitraum 2025/2026 läuft vom 01.05.2025 bis 30.04.2026, und die Abrechnung muss den Mietern bis 30.04.2027 zugehen.',
    norm: '§ 556 Abs. 3 BGB',
    needed: 'Nur wenn Ihr Messdienst oder Ihr Mietvertrag einen anderen Zeitraum als das Kalenderjahr nennt. Mietkonto und Steuer bleiben beim Kalenderjahr.',
  },
  shortPeriod: {
    title: 'Rumpfzeitraum',
    short: 'Ein kürzerer Abrechnungszeitraum vor einem Wechsel, damit kein Zeitraum länger als zwölf Monate wird.',
    example: 'Umstellung vom Kalenderjahr auf Mai bis April ab Mai 2025: 01.01.–30.04.2025 ist ein Rumpfzeitraum mit 120 Tagen; seine Abrechnung muss bis 30.04.2026 zugehen.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 27.07.2011, VIII ZR 316/10',
    needed: 'Nur beim Wechsel des Zeitraums. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst; legt der Mietvertrag den Zeitraum fest, braucht sie die Zustimmung der Mieter. Eine Verlängerung über zwölf Monate gibt es nicht.',
  },
  accrualPrinciple: {
    title: 'Leistungsprinzip',
    short: 'Eine Rechnung gehört in den Abrechnungszeitraum, in dem die Leistung erbracht wurde; reicht sie über zwei Zeiträume, teilt Mietfuchs kalte Betriebskosten nach Tagen auf. Heizkosten richten sich nach dem Verbrauch im Zeitraum und werden nicht nach Tagen geteilt.',
    example: 'Grundsteuer 2025 über 480 € bei einer Abrechnung von Mai bis April: 120 von 365 Tagen gehören in 2024/2025 (157,81 €), 245 Tage in 2025/2026 (322,19 €).',
    norm: 'BGH, Urteil vom 20.02.2008, VIII ZR 49/07; BGH, Urteil vom 01.02.2012, VIII ZR 156/11',
    needed: 'Nur wenn eine Rechnung einen anderen Zeitraum hat als Ihre Abrechnung. Tragen Sie dann unter „Weitere Angaben“ den Leistungszeitraum ein.',
  },
  // #208: Gradtage, für den Vorschlag nach § 560 BGB im Rumpf. Werte aus dem Register
  // (`hkv.degree-days`), Herkunft dort.
  degreeDays: {
    title: 'Gradtagszahlen',
    short: 'Eine Tabelle, die ein Jahr Heizwärme auf die Monate verteilt: Im Winter wird viel geheizt, im Sommer kaum. Ein Jahr hat 1.000 Promille.',
    example: `Januar bis April zusammen ${winterPermille} Promille. Eine Gasrechnung über 700 € für diese vier Monate entspricht 700 € / ${(winterPermille / 1000).toLocaleString('de-DE')} ≈ ${deEuro(Math.round(70000 / (winterPermille / 1000)))} € im Jahr, also rund ${deEuro(Math.round(70000 / (winterPermille / 1000) / 12))} € im Monat.`,
    norm: '§ 9b Abs. 2 HeizkostenV',
    needed: 'Nur im Rumpfzeitraum: Mietfuchs rechnet damit den Vorschlag für die neue Vorauszahlung hoch, wenn eine Brennstoffrechnung nur einen Teil des Jahres abdeckt. Die Werte stammen aus der Praxis der Messdienste; die Norm DIN 94680, in der sie heute stehen, hat Mietfuchs nicht gelesen.',
  },
```

(Mit 530 ‰: `700 € / 0,53 ≈ 1.320,75 €`, `110,06 €`; `Math.round(70000 / 0.53)` = 132075,
`Math.round(70000 / 0.53 / 12)` = 11006.)

- [ ] **Step 5: Ampel (`client/src/notices.ts`)**

```ts
const INFORMATIONAL = new Set(['basis.unit-zero', 'basis.tenancy-zero', 'basis.vacancy-persons', 'basis.vacancy-no-area', 'heating.remote-reading', 'period.short'])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-zeitraum-hinweise.test.ts test/glossary.test.ts test/law-literals.test.ts test/anrede.test.ts && npm --prefix client test -- notices && npm run typecheck`
Expected: PASS (calc-zeitraum-hinweise 5 Tests). `law-literals.test.ts` findet in `calc.ts` kein
neues Datumsliteral (die Texte setzen Daten über `${…}` ein) und im Lexikon kein Prozentmuster.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS, Golden unverändert (kein Fixture hat einen Rumpf oder einen Leistungszeitraum).

```bash
git add server/src/calc.ts shared/glossary.ts client/src/notices.ts server/test/calc-zeitraum-hinweise.test.ts server/test/glossary.test.ts client/src/notices.test.ts
git commit -m "Zeitraum: Hinweise zu Rumpf, Leistungszeitraum und Heizkosten aus anderem Zeitraum, Lexikon

Refs #208"
```

---
### Task 6: Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum

PR 2 schlägt im Rumpf nichts vor (`|| period.short`), weil vier Monate Kosten auf zwölf
hochgerechnet Winter und Sommer verschieben. Entwurf 3.7 (mit A1, A11, B4, C5, D3, R10, R11) sagt,
wie es richtig geht: je Position ein Faktor auf zwölf Monate. Volle Zeiträume rechnen weiter wie
bisher (Anteil × Tage des Zeitraums / Tage des Mieters / 12, auf volle Euro); Golden bleibt gleich.

Die Faktoren:

| Position | Faktor (Jahresbetrag / Betrag) |
|---|---|
| kalt | Tage der zwölf Monate ab Beginn des Rumpfs / Tage des Rumpfs (400 € · 365/120) |
| Brennstoff (`heating_part = 'fuel'`), alle mit Leistungszeitraum | 1.000 / Gradtagsanteil (‰) der Vereinigung ihrer Leistungszeiträume (C5, D3) |
| Brennstoff, mindestens einer ohne Leistungszeitraum (Lieferung) | Σ Brennstoff der letzten vollen Periode / Σ Brennstoff jetzt; ohne volle Periode kein Vorschlag (B4) |
| feste Heizposition, Gruppe derselben Art (`heating_part`, sonst Kostenart und Beschreibung ohne Jahreszahl), alle mit Leistungszeitraum | Tage der zwölf Monate ab Beginn der Vereinigung / Tage der Vereinigung (A11, D3) |
| feste Heizposition, nicht alle mit Leistungszeitraum | Σ derselben Gruppe in der letzten vollen Periode / Σ jetzt; sonst 0, kein Vorschlag für diese Position (A11) |

Kein Vorschlag (`suggestedMonthlyCents = 0`) und `prepayment.no-suggestion` (hint), wenn es
Heizpositionen gibt und keine als Brennstoff gekennzeichnet ist (Text A, D-R5) oder der Brennstoff
keinen Faktor hat (Text B, R10, R11). In PR 3 gibt es nur eine Vorauszahlung; ein Vorschlag nur aus
den kalten Kosten wäre als Ganzes zu niedrig (R11), deshalb entfällt er ganz.

**Files:**
- Create: `server/src/prepaymentSuggestion.ts`
- Modify: `server/src/calc.ts`
- Test: `server/test/calc-vorschlag.test.ts` (neu); Modify: `server/test/calc-zeitraum.test.ts` (PR 2, Rumpf-Test)

**Interfaces:**
- Consumes: `degreeDayPermille`, `unionDays`, `unionOf`, `yearDaysFrom` (Task 1), `hkvDegreeDays` (Task 1), `law`, `lawLog`, `lawPeriod` (PR 1), `Snapshot.previousPeriod`, `Snapshot.previousCostItems`, `period`, `diy`, `yTo` (PR 2), `SnapshotCostItem.serviceFrom`/`serviceTo`/`heatingPart` (Task 2).
- Produces:
  - `type AnnualBasis = { ok: true; factors: Map<string, number> } | { ok: false; reason: 'unmarked' | 'delivery'; costItemId: string }`
  - `annualFactors(period: BillingPeriod, items: readonly SnapshotCostItem[], previous: { period: BillingPeriod; items: readonly SnapshotCostItem[] } | null, degreeDays: () => DegreeDayTable): AnnualBasis` (`server/src/prepaymentSuggestion.ts`)
  - Code `prepayment.no-suggestion` (hint, Begriffe `prepayment`, `degreeDays`) in `noticeKinds`

- [ ] **Step 1: Write the failing test**

`server/test/calc-vorschlag.test.ts`:

```ts
// Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum (#208, Entwurf 3.7, Testfälle Z-B5/R5/A11,
// C5, D3, D3 fest, R11, B4, A1 aus 12.2). Ein Mieter, eine Wohnung: Sein Anteil ist der ganze
// Betrag, und die Zahlen lassen sich gegen den Entwurf lesen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { annualFactors } from '../src/prepaymentSuggestion.ts'
import { snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const table = () => onlyVersion(hkvDegreeDays).value
const WINTER: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
const SOMMER: PeriodRules = { startMonth: 5, changes: ['2025-09'] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const haus = (costItems: SnapshotCostItem[], end: string | null = null): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end, prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [] }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (rules: PeriodRules, key: string, items: SnapshotCostItem[], end: string | null = null) => {
  const p = of(rules, key)
  return computeSettlement(snapshotOfPeriod(haus(items, end), p, previousPeriod(rules, p)))
}
const vorschlag = (rules: PeriodRules, key: string, items: SnapshotCostItem[]) =>
  settle(rules, key, items).statements[0]?.suggestedMonthlyCents ?? assert.fail('kein Mieter')

let n = 0
const kalt = (key: string, amountCents: number, from?: string, to?: string): SnapshotCostItem =>
  ({ id: `k${++n}`, period: periodKey(key), category: 'Müllabfuhr', description: 'Müll', amountCents, key: 'area', ...(from && to ? { serviceFrom: from, serviceTo: to } : {}) })
const heiz = (key: string, description: string, amountCents: number, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem =>
  ({ id: `h${++n}`, period: periodKey(key), category: 'Heizung und Warmwasser', description, amountCents, key: 'amounts', tenancyAmounts: { t1: amountCents }, ...over })
const brennstoff = (key: string, amountCents: number, from?: string, to?: string): SnapshotCostItem =>
  heiz(key, 'Gas', amountCents, { heatingPart: 'fuel', ...(from && to ? { serviceFrom: from, serviceTo: to } : {}) })

test('Winter-Rumpf: kalt nach Tagen, Brennstoff nach Gradtagen, Jahreswartung mit dem Jahresbetrag: 228 € (Z-B5, A11)', () => {
  const items = [
    kalt('2025-01', 40000, '2025-01-01', '2025-04-30'),
    brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'),
    heiz('2025-01', 'Wartung', 20000, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }),
  ]
  // 400 · 365/120/12 = 101,39; 700 / 0,530 / 12 = 110,06; 200 / 12 = 16,67 → 228,12 → 228 €
  assert.equal(vorschlag(WINTER, '2025-01', items), 22800)
})

test('Derselbe Rumpf, die Wartung ist nur der Anteil Januar bis April: 262 € (A11)', () => {
  const items = [
    kalt('2025-01', 40000, '2025-01-01', '2025-04-30'),
    brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'),
    heiz('2025-01', 'Wartung', 20000, { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' }),
  ]
  assert.equal(vorschlag(WINTER, '2025-01', items), 26200)
})

test('Sommer-Rumpf 01.05.–31.08.: Brennstoff 80 € bei 80 ‰ und Jahreswartung: 100 € (Z-B5)', () => {
  const items = [
    brennstoff('2025-05', 8000, '2025-05-01', '2025-08-31'),
    heiz('2025-05', 'Wartung', 20000, { serviceFrom: '2025-05-01', serviceTo: '2026-04-30' }),
  ]
  assert.equal(of(SOMMER, '2025-05').short, true)
  assert.equal(vorschlag(SOMMER, '2025-05', items), 10000)
})

test('Gas-Jahresrechnung 01.03.2024–28.02.2025 im Rumpf: Jahresbetrag 2.400 € → 200 € (C5)', () => {
  assert.equal(vorschlag(WINTER, '2025-01', [brennstoff('2025-01', 240000, '2024-03-01', '2025-02-28')]), 20000)
})

test('Zwei Brennstoffrechnungen über die Vereinigung ihrer Leistungszeiträume: 110,06 € statt 223,21 € (D3)', () => {
  const p = of(WINTER, '2025-01')
  const items = [brennstoff('2025-01', 40000, '2025-01-01', '2025-02-28'), brennstoff('2025-01', 30000, '2025-03-01', '2025-04-30')]
  const basis = annualFactors(p, items, null, table)
  assert.ok(basis.ok)
  const monatlich = items.reduce((a, i) => a + i.amountCents * (basis.factors.get(i.id) ?? 0), 0) / 12
  assert.equal((monatlich / 100).toFixed(2), '110.06')
})

test('Feste Positionen derselben Art über die Vereinigung: 30,42 € statt 60,85 € (D3 der achten Fassung)', () => {
  const p = of(WINTER, '2025-01')
  const items = [
    heiz('2025-01', 'Fernwärme Grundpreis', 6000, { serviceFrom: '2025-01-01', serviceTo: '2025-02-28' }),
    heiz('2025-01', 'Fernwärme Grundpreis', 6000, { serviceFrom: '2025-03-01', serviceTo: '2025-04-30' }),
    brennstoff('2025-01', 1000, '2025-01-01', '2025-04-30'),
  ]
  const basis = annualFactors(p, items, null, table)
  assert.ok(basis.ok)
  const grundpreis = items.slice(0, 2).reduce((a, i) => a + i.amountCents * (basis.factors.get(i.id) ?? 0), 0) / 12
  assert.equal((grundpreis / 100).toFixed(2), '30.42')
})

test('Gasrechnung mit Leistungszeitraum neben einer Öllieferung ohne: kein Vorschlag für den ganzen Heizanteil (R11)', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000), brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'), brennstoff('2025-01', 300000)])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  const n = s.notices.find((x) => x.code === 'prepayment.no-suggestion') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung\./)
})

test('Öllieferung ohne Leistungszeitraum und ohne volle Vorperiode: kein Vorschlag (B4)', () => {
  const s = settle(WINTER, '2025-01', [brennstoff('2025-01', 300000)])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  assert.ok(s.notices.some((x) => x.code === 'prepayment.no-suggestion'))
})

test('Öllieferung ohne Leistungszeitraum mit voller Vorperiode: nach der letzten Abrechnung (B4, VIII ZR 294/10)', () => {
  // 2024 ist ein volles Kalenderjahr mit 3.000 € Brennstoff; im Rumpf kamen 1.000 € dazu. Der
  // Jahresbetrag ist der des Vorjahres, also 250 € im Monat.
  const vorjahr = brennstoff('2024-01', 300000)
  const p = of(WINTER, '2025-01')
  const jetzt = brennstoff('2025-01', 100000)
  const s = computeSettlement(snapshotOfPeriod(haus([vorjahr, jetzt]), p, previousPeriod(WINTER, p)))
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 25000)
})

test('Heizpositionen ohne Kennzeichnung als Brennstoff: kein Vorschlag, Hinweis zum Kennzeichnen (D-R5, A1)', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000), heiz('2025-01', 'Gas', 70000, { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  const n = s.notices.find((x) => x.code === 'prepayment.no-suggestion') ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Kennzeichnen Sie die Brennstoffrechnung/)
})

test('Nur kalte Kosten im Rumpf: nach Tagen, kein Hinweis', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000)])
  // 400 · 365/120/12 = 101,39 → 101 €
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 10100)
  assert.equal(s.notices.some((x) => x.code === 'prepayment.no-suggestion'), false)
})

test('Endet das Mietverhältnis im Rumpf, gibt es keinen Vorschlag und keinen Hinweis', () => {
  const s = settle(WINTER, '2025-01', [brennstoff('2025-01', 300000)], '2025-03-31')
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  assert.equal(s.notices.some((x) => x.code === 'prepayment.no-suggestion'), false)
})

test('Schaltjahr: Jahreswartung 2028 zählt mit dem Jahresbetrag, der 29.02. mit 150/29 (Review Focus 5)', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2028-05'] }
  const p = of(rules, '2028-01')
  const wartung = heiz('2028-01', 'Wartung', 36600, { serviceFrom: '2028-01-01', serviceTo: '2028-12-31' })
  const gas = brennstoff('2028-01', 53000, '2028-01-01', '2028-04-30')
  const basis = annualFactors(p, [wartung, gas], null, table)
  assert.ok(basis.ok)
  assert.equal(basis.factors.get(wartung.id), 1, '366 Tage ab 01.01.2028 sind zwölf Monate')
  assert.ok(Math.abs((basis.factors.get(gas.id) ?? 0) - 1000 / 530) < 1e-9, 'Januar bis April 2028 sind 530 ‰, mit dem 29.02.')
})

test('Ein voller Zeitraum rechnet wie bisher', () => {
  const s = settle({ startMonth: 1, changes: [] }, '2025-01', [kalt('2025-01', 120000)])
  // 1.200 € / 12 = 100 €
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 10000)
})
```

In `server/test/calc-zeitraum.test.ts` (PR 2, Task 5), Test „Rumpf 01.01.–30.04.2025 …“: Name
in „Rumpf 01.01.–30.04.2025: 120 Tage, vier Vorauszahlungsmonate, Vorschlag nach Tagen, Rückstand
nur über den Zeitraum“ ändern; Kommentar und Zusicherung:

```ts
  // Im Rumpf rechnet der Vorschlag kalte Kosten nach Tagen hoch (#208, PR 3): 240 € Anteil
  // (60 von 100 m² aus 400 €) · 365/120 / 12 = 60,83 € → 61 €.
  assert.deepEqual([st.days, st.periodEnd, st.prepaymentCents, st.suggestedMonthlyCents], [120, '2025-04-30', 80000, 6100])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-vorschlag.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `server/src/prepaymentSuggestion.ts`.

- [ ] **Step 3: `server/src/prepaymentSuggestion.ts`**

```ts
// Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum (#208, Entwurf 3.7).
//
// Angemessen ist eine Vorauszahlung in Höhe der voraussichtlichen Kosten, auf Grundlage der letzten
// Abrechnung; ein abstrakter Zuschlag ist unzulässig (BGH VIII ZR 294/10). Nach einem vollen
// Zeitraum sind das dessen Kosten. Nach einem Rumpf muss hochgerechnet werden, und zwar je Position
// verschieden: Vier Wintermonate Heizung auf zwölf Monate nach Tagen ergäben fast das Dreifache.
// Diese Datei rechnet je Position den Faktor vom Betrag im Rumpf zum Jahresbetrag; calc.ts
// multipliziert ihn mit dem Anteil des Mieters.
//
// - Kalte Kosten (nach 3.4 auf den Rumpf geteilt): nach Tagen.
// - Brennstoff (`heating_part = 'fuel'`) mit Leistungszeitraum, eine Verbrauchsrechnung: Σ der
//   Beträge geteilt durch den Gradtagsanteil der Vereinigung ihrer Leistungszeiträume (C5, D3).
//   Genau zwölf Monate ergeben 1.000 ‰ und damit den Jahresbetrag. Mehrere Rechnungen werden nicht
//   einzeln hochgerechnet und addiert.
// - Brennstoff ohne Leistungszeitraum ist eine Lieferung (Öl, Flüssiggas, Pellets) und kein
//   Verbrauch: dann gilt die letzte volle Periode, sonst gibt es keinen Vorschlag (B4).
// - Feste Heizpositionen (Wartung, Messdienst, Grundpreis) nach den Tagen ihres Leistungszeitraums
//   auf zwölf Monate; Positionen derselben Art über die Vereinigung ihrer Leistungszeiträume (A11,
//   D3). Ohne Leistungszeitraum die letzte volle Periode, sonst kein Vorschlag für diese Position.
//
// Fehlt für den Brennstoff ein Faktor, gibt es keinen Vorschlag (R11): Der Rest ohne Brennstoff wäre
// zu niedrig. Ist keine Heizposition als Brennstoff gekennzeichnet, ebenso (D-R5): Welche Position
// Verbrauch ist, weiß Mietfuchs dann nicht.

import { degreeDayPermille, unionDays, unionOf, yearDaysFrom, type DayRange } from '../../shared/degreeDays.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { periodDays } from '../../shared/period.ts'
import type { BillingPeriod } from '../../shared/types.ts'
import type { SnapshotCostItem } from './snapshot.ts'

export type AnnualBasis =
  | { ok: true; factors: Map<string, number> }
  | { ok: false; reason: 'unmarked' | 'delivery'; costItemId: string }

type Previous = { period: BillingPeriod; items: readonly SnapshotCostItem[] }

const rangeOf = (c: SnapshotCostItem): DayRange | null =>
  c.serviceFrom !== undefined && c.serviceTo !== undefined ? { from: c.serviceFrom, to: c.serviceTo } : null
const sum = (items: readonly SnapshotCostItem[]): number => items.reduce((a, c) => a + c.amountCents, 0)

// Positionen derselben Art (D3): gleicher Teil der Heizkosten, sonst gleiche Kostenart und
// Beschreibung, ohne Jahreszahl und ohne Groß- und Kleinschreibung („Wartung 2024“ ist im Folgejahr
// „Wartung 2025“).
const kindOf = (c: SnapshotCostItem): string =>
  c.heatingPart !== undefined ? `part:${c.heatingPart}` : `${c.category}|${c.description.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`

// Faktor aus der letzten vollen Periode: deren Summe derselben Positionen, geteilt durch die jetzige.
function fromPrevious(now: readonly SnapshotCostItem[], previous: Previous | null, same: (c: SnapshotCostItem) => boolean): number | null {
  if (previous === null || previous.period.short) return null
  const before = previous.items.filter(same)
  const current = sum(now)
  if (before.length === 0 || current === 0) return null
  return sum(before) / current
}

export function annualFactors(
  period: BillingPeriod,
  items: readonly SnapshotCostItem[],
  previous: Previous | null,
  degreeDays: () => DegreeDayTable,
): AnnualBasis {
  const factors = new Map<string, number>()
  const byDays = yearDaysFrom(period.from) / periodDays(period)
  const heating = items.filter((c) => c.category === HEATING_CATEGORY)
  for (const c of items) if (c.category !== HEATING_CATEGORY) factors.set(c.id, byDays)
  if (heating.length === 0) return { ok: true, factors }

  const fuel = heating.filter((c) => c.heatingPart === 'fuel')
  const first = heating[0]
  if (fuel.length === 0) return { ok: false, reason: 'unmarked', costItemId: first?.id ?? '' }
  const ranges = fuel.map(rangeOf)
  let fuelFactor: number | null
  if (ranges.every((r): r is DayRange => r !== null)) {
    const permille = degreeDayPermille(ranges, degreeDays())
    fuelFactor = permille > 0 ? 1000 / permille : null
  } else {
    fuelFactor = fromPrevious(fuel, previous, (c) => c.category === HEATING_CATEGORY && c.heatingPart === 'fuel')
  }
  if (fuelFactor === null) {
    const delivery = fuel.find((c) => rangeOf(c) === null) ?? fuel[0]
    return { ok: false, reason: 'delivery', costItemId: delivery?.id ?? '' }
  }
  for (const c of fuel) factors.set(c.id, fuelFactor)

  const groups = new Map<string, SnapshotCostItem[]>()
  for (const c of heating) {
    if (c.heatingPart === 'fuel') continue
    groups.set(kindOf(c), [...(groups.get(kindOf(c)) ?? []), c])
  }
  for (const [kind, group] of groups) {
    const groupRanges = group.map(rangeOf)
    let factor: number
    if (groupRanges.every((r): r is DayRange => r !== null)) {
      const union = unionOf(groupRanges)
      factor = yearDaysFrom(union[0]?.from ?? period.from) / unionDays(union)
    } else {
      factor = fromPrevious(group, previous, (c) => c.category === HEATING_CATEGORY && kindOf(c) === kind) ?? 0
    }
    for (const c of group) factors.set(c.id, factor)
  }
  return { ok: true, factors }
}
```

- [ ] **Step 4: In die Berechnung einbauen (`server/src/calc.ts`)**

Importe: `annualFactors` aus `'./prepaymentSuggestion.ts'`, `hkvDegreeDays` aus
`'../../shared/law/heizkostenv.ts'`.

In `noticeKinds` hinter den Codes aus Task 5:

```ts
  'prepayment.no-suggestion': { level: 'hint', title: 'Kein Vorschlag für die Vorauszahlung', terms: ['prepayment', 'degreeDays'] },
```

Im Rumpf von `computeSettlement` direkt vor `const result: ComputedSettlement = {` (nach dem Block
aus PR 2 Task 7, der `bgb.max-period-months` einfriert):

```ts
  // Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum (#208, Entwurf 3.7): je Position ein Faktor
  // auf zwölf Monate, siehe prepaymentSuggestion.ts. Die Gradtagstabelle wird nur gefragt (und
  // friert dann ein), wenn eine Brennstoffrechnung mit Leistungszeitraum da ist.
  const shortBasis = period.short
    ? annualFactors(
      period,
      items,
      snapshot.previousCostItems ? { period: snapshot.previousPeriod, items: snapshot.previousCostItems } : null,
      () => law(hkvDegreeDays, { period: lawPeriod }, lawLog),
    )
    : null
  const continuing = partTenancies.some((t) => !(t.end != null && t.end <= yTo))
  if (shortBasis && !shortBasis.ok && continuing) {
    const which = items.find((c) => c.id === shortBasis.costItemId)
    warn('prepayment.no-suggestion', shortBasis.reason === 'unmarked'
      ? `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: Keine Position der Heizkosten ist als Brennstoff gekennzeichnet. Kennzeichnen Sie die Brennstoffrechnung (Gas, Öl, Fernwärme, Strom der Wärmepumpe) unter „Weitere Angaben“ mit „Brennstoff/Energie“ und tragen Sie ihren Leistungszeitraum ein; dann rechnet Mietfuchs den Vorschlag nach Gradtagen hoch.`
      : `Für den Rumpfzeitraum ${label} schlägt Mietfuchs keine neue Vorauszahlung vor: „${which?.description ?? ''}“ ist eine Lieferung ohne Leistungszeitraum. Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung.`,
    which ? itemSubject(which) : undefined)
  }
```

In der Schleife über `result.statements` die Zuweisung von PR 2 (mit `|| period.short`) ersetzen:

```ts
    const end = tenancyEnd.get(st.tenancyId)
    const noFuture = (end != null && end <= yTo) || st.days <= 0
    if (noFuture || (shortBasis !== null && !shortBasis.ok)) {
      st.suggestedMonthlyCents = 0
    } else if (shortBasis !== null) {
      // Im Rumpf: jede Zeile mit ihrem Faktor auf zwölf Monate, dann wie im vollen Zeitraum auf die
      // Tage des Mieters bezogen (#134) und auf volle Euro gerundet.
      const annual = st.rows.reduce((a, row) => a + row.shareCents * (shortBasis.factors.get(row.costItemId) ?? 0), 0)
      st.suggestedMonthlyCents = Math.max(0, Math.round((annual * diy) / st.days / 12 / 100) * 100)
    } else {
      // Nie negativ: Überwiegen Gutschriften, gibt es keine Vorauszahlung unter 0 (Integrationsdurchsicht).
      st.suggestedMonthlyCents = Math.max(0, Math.round((st.totalShareCents * diy) / st.days / 12 / 100) * 100)
    }
```

(Der Kommentar über der Schleife „Vorschlag nach §560 Abs. 4 BGB: ein Zwölftel der Jahreskosten …“
bekommt den Satz: „Im Rumpfzeitraum rechnet `annualFactors` je Position hoch (#208).“; der Satz aus
PR 2 „Im Rumpfzeitraum gibt es keinen Vorschlag …“ entfällt.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-vorschlag.test.ts test/calc-zeitraum.test.ts test/glossary.test.ts test/law-literals.test.ts && npm run typecheck`
Expected: PASS (calc-vorschlag 15 Tests).

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS, Golden unverändert (kein Fixture ist ein Rumpf; im vollen Zeitraum ist der Weg
derselbe wie vorher).

```bash
git add server/src/prepaymentSuggestion.ts server/src/calc.ts server/test/calc-vorschlag.test.ts server/test/calc-zeitraum.test.ts
git commit -m "Zeitraum: Vorschlag nach § 560 BGB im Rumpf je Position, Brennstoff nach Gradtagen

Refs #208"
```

---
### Task 7: Steuer über mehrere Abrechnungen

Entwurf 3.10: Die Steuer bleibt beim Kalenderjahr. Werbungskosten zählen im Jahr der Zahlung
(`tax_year`, sonst das Kalenderjahr des Zeitraums der Position); der Eigenanteil je Position kommt
aus der Abrechnung ihres Zeitraums (abgeschlossen aus deren eingefrorenem Stand);
`prepaymentSettlementCents` ist `null`, wenn kein Zeitraum dem Kalenderjahr gleicht. Die Einnahmen
bleiben das Ist aus den Zahlungen; keine Zahl der Steuer eines Kalenderobjekts bewegt sich. Die
Ablehnung mit 400 aus PR 2 entfällt.

**Files:**
- Modify: `shared/types.ts` (`TaxReport`), `server/src/calc.ts`, `server/src/index.ts`, `client/src/taxView.ts`, `client/src/pages/Steuer.tsx`
- Test: `server/test/calc-steuer-zeitraum.test.ts` (neu); Modify: `server/test/api.test.ts` (Test aus PR 2 Task 6), `client/src/taxView.test.ts`

**Interfaces:**
- Consumes: `snapshotFor`, `calendarYearPeriod`, `periodsBetween`, `isCalendarRules`, `rulesOf`, `periodLabel`, `spansTwoYears` (PR 2, Task 2); `splitForTax` (calc.ts).
- Produces:
  - `TaxReport.income.prepaymentSettlementCents: number | null`, `TaxReport.settlementPeriods: { key: PeriodKey; label: string }[]` (`shared/types.ts`)
  - `type TaxPart = { snapshot: Snapshot; items: SnapshotCostItem[] }`, `taxReport(snapshot: Snapshot, parts?: readonly TaxPart[]): TaxReport`, `taxYearOf(item: Pick<SnapshotCostItem, 'taxYear'>, period: Pick<BillingPeriod, 'from'>): number`, `taxPartsFor(source, propertyId: string, year: number): TaxPart[] | null`, `taxReportFor(source, propertyId: string, year: number): TaxReport` (`server/src/calc.ts`)
  - `settlementSourcesText(report: TaxReport): string | null` (`client/src/taxView.ts`)

- [ ] **Step 1: Write the failing tests**

`server/test/calc-steuer-zeitraum.test.ts`:

```ts
// Steuerübersicht eines Objekts mit Abrechnungszeitraum Mai bis April (#208, Entwurf 3.10): Jahr
// der Zahlung je Position, Eigenanteil aus der Abrechnung ihres Zeitraums, kein Vergleich der
// Vorauszahlungen ohne einen Zeitraum gleich dem Kalenderjahr.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReport, taxReportFor, taxYearOf } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
// Ein Haus mit zwei gleich großen Einheiten: oben vermietet, unten selbst bewohnt. Privat ist
// deshalb die Hälfte jeder Position nach Fläche.
const source = (rules: PeriodRules, costItems: SnapshotCostItem[]) => ({
  properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [
    { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: false, selfUsed: true },
    { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 50, participates: true },
  ],
  tenancies: [{ id: 't1', unitId: 'og', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [] }],
  costItems: costItems.map((c) => ({ ...c, propertyId: 'objekt-1' })),
  meters: [], readings: [], payments: [{ tenancyId: 't1', date: '2025-03-01', amountCents: 50000 }],
  closedSettlements: [],
})
const pos = (id: string, key: string, amountCents: number, taxYear?: number): SnapshotCostItem =>
  ({ id, period: periodKey(key), category: 'Gebäudeversicherung', description: id, amountCents, key: 'area', ...(taxYear !== undefined ? { taxYear } : {}) })

test('Jahr der Zahlung: angegeben, sonst das Kalenderjahr des Zeitraums', () => {
  assert.equal(taxYearOf({ taxYear: 2026 }, { from: '2025-05-01' }), 2026)
  assert.equal(taxYearOf({}, { from: '2025-01-01' }), 2025)
})

test('Mai bis April: Werbungskosten nach Jahr der Zahlung aus zwei Abrechnungen, privat je aus ihrer', () => {
  const items = [pos('vers', '2024-05', 120000, 2025), pos('muell', '2025-05', 60000, 2025), pos('gs', '2025-05', 48000, 2026)]
  const r = taxReportFor(source(MAI, items), 'objekt-1', 2025)
  assert.deepEqual(r.expenses.items.map((i) => [i.costItemId, i.amountCents, i.privateCents]).sort(), [['muell', 60000, 30000], ['vers', 120000, 60000]])
  assert.equal(r.expenses.totalCents, 180000)
  assert.equal(r.income.prepaymentSettlementCents, null, 'kein Zeitraum gleicht dem Kalenderjahr')
  assert.deepEqual(r.settlementPeriods, [{ key: '2024-05', label: '2024/2025' }, { key: '2025-05', label: '2025/2026' }])
  assert.equal(r.income.paidCents, 50000, 'die Einnahmen bleiben das Ist des Kalenderjahres')
  const r26 = taxReportFor(source(MAI, items), 'objekt-1', 2026)
  assert.deepEqual(r26.expenses.items.map((i) => i.costItemId), ['gs'])
})

test('Kalenderobjekt: dieselbe Übersicht wie ohne Zeiträume, der Vergleich der Vorauszahlungen bleibt (Review Focus 4)', () => {
  const items = [pos('vers', '2025-01', 120000)]
  const src = source(CALENDAR_RULES, items)
  const viaZeitraum = taxReportFor(src, 'objekt-1', 2025)
  const direkt = taxReport({ ...snapshotOf(src, 2025), propertyId: 'objekt-1', property: { kind: 'mfh', cableBuiltBeforeDec2021: null } })
  assert.deepEqual(viaZeitraum, direkt)
  assert.equal(typeof viaZeitraum.income.prepaymentSettlementCents, 'number')
  assert.deepEqual(viaZeitraum.settlementPeriods, [{ key: '2025-01', label: '2025' }])
})

test('Invariante: über alle Kalenderjahre steht jede Position genau einmal in den Werbungskosten (Entwurf 12.3 Nr. 10)', () => {
  const items = [pos('a', '2024-05', 1000, 2024), pos('b', '2024-05', 2000, 2025), pos('c', '2025-05', 3000, 2026), pos('d', '2025-05', 4000, 2027)]
  const src = source(MAI, items)
  const seen = [2023, 2024, 2025, 2026, 2027, 2028].flatMap((y) => taxReportFor(src, 'objekt-1', y).expenses.items.map((i) => i.costItemId))
  assert.deepEqual(seen.sort(), ['a', 'b', 'c', 'd'])
})
```

In `server/test/api.test.ts` im Test „Zeitraum (#208): die Jahreszahl nur beim Kalenderobjekt …“
(PR 2, Task 6) die vier Zeilen zur Steuer ersetzen und den Testnamen auf „…, Steuer im
Kalenderjahr“ ändern:

```ts
    // Die Steuer rechnet im Kalenderjahr und schöpft aus den Abrechnungen 2024/2025 und 2025/2026 (#208, PR 3).
    const steuer = await s.api<{ settlementPeriods: { label: string }[] }>(`/api/taxreport/2025${q}`)
    assert.deepEqual(steuer.settlementPeriods.map((p) => p.label), ['2024/2025', '2025/2026'])
    assert.equal((await fetch(`${s.base}/api/receipts/tax/2025${q}`)).status, 200)
```

In `client/src/taxView.test.ts` anhängen (die Fabrik `report` steht am Kopf der Datei):

```ts
describe('Steuer über mehrere Abrechnungen (#208)', () => {
  test('ohne Zeitraum gleich dem Kalenderjahr: kein Vergleich, dafür die Quellen', () => {
    const r = { ...report({ prepaymentSettlementCents: null }), settlementPeriods: [{ key: '2024-05', label: '2024/2025' }, { key: '2025-05', label: '2025/2026' }] }
    expect(prepaymentNote(r)).toBeNull()
    expect(settlementSourcesText(r)).toBe('Die Eigenanteile stammen aus den Abrechnungen 2024/2025 und 2025/2026. Weil kein Abrechnungszeitraum dem Kalenderjahr entspricht, steht hier kein Vergleich der Vorauszahlungen mit einer Abrechnung.')
  })
  test('Kalenderjahr: kein Satz', () => {
    expect(settlementSourcesText({ ...report({}), settlementPeriods: [{ key: '2025-01', label: '2025' }] })).toBeNull()
  })
})
```

(`settlementSourcesText` in den Import aus `./taxView` aufnehmen; `report` liefert nach Step 3
`settlementPeriods: []` als Vorgabe, siehe dort.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/calc-steuer-zeitraum.test.ts && npm --prefix client test -- taxView`
Expected: FAIL: `taxReportFor`, `taxYearOf` gibt es nicht; `settlementSourcesText` fehlt.

- [ ] **Step 3: Typen**

`shared/types.ts`, in `TaxReport.income`:

```ts
    // … (bisheriger Kommentar) `null`, wenn kein Abrechnungszeitraum dem Kalenderjahr gleicht
    // (#208, Entwurf 3.10): Eine Zahl aus zwei halben Abrechnungen wäre eine erfundene.
    prepaymentSettlementCents: number | null
```

und in `TaxReport` hinter `expenses`:

```ts
  // Die Abrechnungen, aus denen die Eigenanteile stammen (#208): bei einem Kalenderobjekt die des
  // Jahres, bei Mai bis April die beiden, die das Jahr berühren.
  settlementPeriods: { key: PeriodKey; label: string }[]
```

In `client/src/taxView.test.ts` in der Fabrik `report` (am Kopf der Datei) `settlementPeriods: []`
ergänzen, damit sie dem Typ genügt.

- [ ] **Step 4: Berechnung (`server/src/calc.ts`)**

Importe: `isCalendarRules, periodLabel, periodsBetween, rulesOf` aus `'../../shared/period.ts'`
(soweit nicht schon da), `snapshotFor` aus `'./snapshot.ts'` (calc.ts importiert aus snapshot.ts bisher
nur Typen; snapshot.ts importiert calc.ts nicht), `PeriodKey` als Typ.

Vor `export function taxReport`:

```ts
// Das Jahr der Zahlung einer Position (#208, Entwurf 3.10): angegeben, sonst das Kalenderjahr, in
// dem ihr Zeitraum beginnt (ein Zeitraum ohne Angabe liegt in einem Kalenderjahr, repository.ts
// sichert das zu).
export const taxYearOf = (item: Pick<SnapshotCostItem, 'taxYear'>, period: Pick<BillingPeriod, 'from'>): number =>
  item.taxYear ?? Number(period.from.slice(0, 4))

// Ein Teil der Steuerübersicht: der Schnappschuss eines Abrechnungszeitraums und seine Positionen,
// die im Kalenderjahr gezahlt wurden. Der Eigenanteil kommt aus der Abrechnung dieses Zeitraums.
export type TaxPart = { snapshot: Snapshot; items: SnapshotCostItem[] }
```

`taxReport` bekommt den zweiten Parameter. Der Kopf und die Teile, die aus der Abrechnung lesen:

```ts
export function taxReport(snapshot: Snapshot, parts?: readonly TaxPart[]): TaxReport {
  const year = snapshot.year
  // Ohne Teile: der Schnappschuss eines Kalenderjahres, wie bisher (die Prüfung aus PR 2 bleibt).
  // Mit Teilen (#208): die Abrechnungen, die das Jahr berühren; `snapshot` liefert dann nur das
  // Mietkonto des Kalenderjahres.
  const calendar = calendarYearPeriod(year)
  if (parts === undefined && (snapshot.period.from !== calendar.from || snapshot.period.to !== calendar.to)) {
    throw new Error('Die Steuerübersicht rechnet im Kalenderjahr; dieser Schnappschuss trägt einen anderen Zeitraum.')
  }
  const used: readonly TaxPart[] = parts ?? [{ snapshot, items: snapshot.costItems.filter((c) => c.period === snapshot.period.key) }]
  // … Einnahmen aus `ledger` und den Zahlungen unverändert
```

Die übrigen Stellen in `taxReport`, die bisher `snapshot.costItems` oder die eine Abrechnung lesen:

```ts
  const heatingBilled = used.some((p) => p.items.some((c) => c.category === HEATING_CATEGORY))
```

```ts
  // Die Abrechnungen der Teile, je einmal gerechnet. Die Vorauszahlungen der Abrechnung (#70) gibt
  // es nur, wenn ein Zeitraum dem Kalenderjahr gleicht; sonst `null` (Entwurf 3.10).
  const settled = used.map((p) => ({ part: p, settlement: computeSettlement(p.snapshot) }))
  const same = settled.find(({ part }) => part.snapshot.period.from === calendar.from && part.snapshot.period.to === calendar.to)
  const frozen = same?.part.snapshot.closedSettlement ?? null
  const prepaymentSettlementCents = same === undefined ? null : frozen
    ? frozen.prepaymentCents
    : same.settlement.statements.reduce((a, st) => a + st.prepaymentCents, 0)
  const prepaymentOverridden = same === undefined ? false : frozen
    ? frozen.prepaymentOverridden
    : same.settlement.statements.some((st) => st.prepaymentOverridden)
```

(ersetzt `const settlement = computeSettlement(snapshot)` und die beiden Zeilen zu den
Vorauszahlungen samt ihrem Kommentar, der bleibt).

```ts
  const items = used.flatMap((p) => p.items)
  // Die Aufteilung bei teilweiser Eigennutzung (#163), je Position aus der Abrechnung ihres Zeitraums.
  const splits = settled.map(({ part, settlement }) => splitForTax(part.snapshot, part.items.filter((c) => groupOf(c.category) !== null), settlement, year))
  const split: TaxSplit = {
    items: new Map(splits.flatMap((s) => [...s.items.entries()])),
    selfUseChangedInYear: splits.some((s) => s.selfUseChangedInYear),
    closedSelfUseDiffers: splits.some((s) => s.closedSelfUseDiffers),
    closedItemsChanged: splits.reduce((a, s) => a + s.closedItemsChanged, 0),
  }
```

(ersetzt `const items = snapshot.costItems.filter(…)` und `const split = splitForTax(…)`).

```ts
  // Auf selbstgenutzte Wohnungen entfallender Teil: bei einem Zeitraum gleich dem Kalenderjahr wie
  // bisher aus dessen Abrechnung; sonst die Summe der Eigenanteile laut Abrechnung je Position.
  const selfUsedShareCents = same !== undefined
    ? same.part.snapshot.closedSettlement?.selfUsedShareCents ?? same.settlement.selfUsedShareCents
    : [...split.items.values()].filter((i) => i.allocation === 'settlement').reduce((a, i) => a + i.privateCents, 0)
```

(ersetzt die bisherige Berechnung von `selfUsedShareCents`). Im Ergebnis hinter `expenses: {…},`:

```ts
    settlementPeriods: used.map((p) => ({ key: p.snapshot.period.key, label: periodLabel(p.snapshot.period) })),
```

`splitForTax` bekommt das Kalenderjahr als vierten Parameter
(`function splitForTax(snapshot: Snapshot, items: SnapshotCostItem[], settlement: ComputedSettlement, year: number): TaxSplit`);
darin:

- `verhältnismäßig laut Nebenkostenabrechnung ${snapshot.year}` → `verhältnismäßig laut Nebenkostenabrechnung ${periodLabel(snapshot.period)}`
  (im Kalenderjahr wortgleich);
- `overlapDays(t.start, t.end, snapshot.year)` → `overlapDays(t.start, t.end, year)`.

Hinter `taxReport`:

```ts
// Die Teile der Steuerübersicht eines Objekts mit eigenem Rhythmus (#208, Entwurf 3.10): jeder
// Abrechnungszeitraum, der das Jahr oder das Vorjahr berührt (eine Position darf bis ein Jahr nach
// dem Ende ihres Zeitraums bezahlt sein, repository.ts), mit seinen Positionen, deren Jahr der
// Zahlung dieses Jahr ist. Ein Zeitraum, der das Jahr berührt, ist auch ohne Position dabei, denn
// die Übersicht nennt ihn als Quelle. `null` beim Kalenderobjekt: Dort rechnet `taxReport` wie bisher.
export function taxPartsFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxPart[] | null {
  const rules = rulesOf(source.properties?.find((p) => p.id === propertyId))
  if (isCalendarRules(rules)) return null
  const jahr = calendarYearPeriod(year)
  const vorjahr = calendarYearPeriod(year - 1)
  return periodsBetween(rules, vorjahr.from, jahr.to).flatMap((p) => {
    const snap = snapshotFor(source, propertyId, p)
    const items = snap.costItems.filter((c) => taxYearOf(c, p) === year)
    const touches = p.from <= jahr.to && p.to >= jahr.from
    return items.length > 0 || touches ? [{ snapshot: snap, items }] : []
  })
}

export function taxReportFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, year: number): TaxReport {
  const calendar = snapshotFor(source, propertyId, calendarYearPeriod(year))
  const parts = taxPartsFor(source, propertyId, year)
  return parts === null ? taxReport(calendar) : taxReport(calendar, parts)
}
```

- [ ] **Step 5: Routen (`server/src/index.ts`)**

Import `taxPartsFor, taxReportFor` aus `./calc.ts`; `requireCalendarObject` samt Kommentar löschen.

```ts
// Steuer-Übersicht (Hilfe für die Anlage V) im Kalenderjahr (#208): bei einem Objekt mit eigenem
// Rhythmus aus den Abrechnungen, die das Jahr berühren. Begründung in calc.ts (`taxPartsFor`).
app.get('/api/taxreport/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => taxReportFor(await readStock(db), await propertyOf(db, req), year)))
})
```

In `/api/receipts/tax/:year` den Rumpf von `readData` ersetzen:

```ts
    const propertyId = await propertyOf(db, req)
    const whole = await readStock(db)
    const stock = narrowToProperty(whole, propertyId)
    const property = (await listProperties(db)).find((p) => p.id === propertyId)
    // Privat und abziehbar je Position aus derselben Rechnung wie die Steuerübersicht (#163), und
    // dieselbe Auswahl der Positionen: das Jahr der Zahlung (#208).
    const report = taxReportFor(whole, propertyId, year)
    const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
    const parts = taxPartsFor(whole, propertyId, year)
    const ids = new Set(parts === null
      ? stock.costItems.filter((c) => c.period === calendarPeriod(year)).map((c) => c.id)
      : parts.flatMap((p) => p.items.map((c) => c.id)))
    return { items: stock.costItems.filter((c) => ids.has(c.id)), property, rows: await uploadRows(db), links: await uploadLinks(db), split }
```

- [ ] **Step 6: Oberfläche (`client/src/taxView.ts`, `client/src/pages/Steuer.tsx`)**

`client/src/taxView.ts`:

```ts
export function prepaymentNote(report: TaxReport): PrepaymentNote | null {
  const { prepaymentSettlementCents, prepaymentSollCents, prepaymentOverridden } = report.income
  // Ohne Zeitraum gleich dem Kalenderjahr gibt es keine Abrechnung zum Vergleich (#208).
  if (prepaymentSettlementCents === null || prepaymentSettlementCents === prepaymentSollCents) return null
  return {
    settlementCents: prepaymentSettlementCents,
    sollCents: prepaymentSollCents,
    jahreskorrektur: prepaymentOverridden,
  }
}

// Aus welchen Abrechnungen die Eigenanteile stammen (#208). Nur bei einem Objekt mit eigenem
// Rhythmus ein Satz; im Kalenderjahr ist es die eine Abrechnung des Jahres, und das sagt die Seite
// schon.
export function settlementSourcesText(report: TaxReport): string | null {
  const labels = report.settlementPeriods.map((p) => p.label)
  if (report.income.prepaymentSettlementCents !== null && labels.length <= 1) return null
  return `Die Eigenanteile stammen aus den Abrechnungen ${andList(labels)}. Weil kein Abrechnungszeitraum dem Kalenderjahr entspricht, steht hier kein Vergleich der Vorauszahlungen mit einer Abrechnung.`
}
```

(`andList` aus `'../../shared/wording.ts'` importieren.)

`client/src/pages/Steuer.tsx`: `settlementSourcesText` importieren, `const sources = data ?
settlementSourcesText(data) : null` neben `note`, und direkt über dem Block `{note && (`:

```tsx
            {sources && <p className="muted">{sources}</p>}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix server test -- test/calc-steuer-zeitraum.test.ts test/calc-steuer-eigennutzung.test.ts test/calc.test.ts test/taxReceipts.test.ts && npm --prefix server test -- test/api.test.ts --test-name-pattern "Zeitraum \(#208\)" && npm --prefix client test -- taxView Steuer && npm run typecheck`
Expected: PASS (calc-steuer-zeitraum 4 Tests). Die Steuertests des Kalenderjahres bleiben ohne
Änderung ihrer Erwartungen grün.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/types.ts server/src/calc.ts server/src/index.ts client/src/taxView.ts client/src/pages/Steuer.tsx server/test/calc-steuer-zeitraum.test.ts server/test/api.test.ts client/src/taxView.test.ts
git commit -m "Zeitraum: Steuerübersicht im Kalenderjahr aus den Abrechnungen, die es berühren

Refs #208"
```

---
### Task 8: Der Zeitraumumschalter (`PeriodProvider`) und die Seiten

Entwurf 11.4: Der Jahresumschalter wird zum Zeitraumumschalter; er führt den Zeitraum und das
Kalenderjahr. Ohne Abweichung ist es ein Umschalter wie heute (Beschriftung „Abrechnungsjahr“,
Werte sind Jahreszahlen, die Routen bekommen die Jahreszahl). Mit Abweichung zeigen die Seiten den
Zeitraum („2025/2026“, „01.01.–30.04.2025 (Rumpf)“), Mietkonto und Steuer einen eigenen
Kalenderjahr-Umschalter, und das Mietkonto nennt oben, welche Monate die Abrechnung umfasst (3.11).
Alle Brücken der Oberfläche aus PR 2 verschwinden (die der Belegbuchung in Task 11).

Die Entscheidungslogik steht DOM-frei in `client/src/periodForm.ts`; `client/src/period.tsx` hält nur
den Zustand (gewählter Tag im Zeitraum, gewähltes Kalenderjahr) und verbindet ihn mit den Regeln des
gewählten Objekts. Weil der Zustand ein Tag ist und kein Schlüssel, passt ein Wechsel des Objekts den
Zeitraum von selbst an: Es gilt der Zeitraum des neuen Objekts, der denselben Tag enthält (Teilentwurf
10).

**Files:**
- Create: `client/src/periodForm.ts`, `client/src/components/PeriodSelect.tsx`
- Rename and rewrite: `client/src/year.tsx` → `client/src/period.tsx`
- Modify: `client/src/property.tsx`, `client/src/App.tsx`, `client/src/statementView.ts`, `client/src/costForm.ts`, `client/src/carryOver.ts`, `client/src/unitForm.ts`, `shared/assessment.ts`, `client/src/pages/{Abrechnung,Cockpit,Kosten,Mietkonto,Steuer,Uebersicht,Zaehler,Belege,Schnellerfassung}.tsx`
- Test: `client/src/periodForm.test.ts` (neu), `client/src/components/PeriodSelect.test.tsx` (neu); Modify: alle Tests, die `YearProvider` aus `../year` holen (Umbenennung)

**Interfaces:**
- Consumes: `isCalendarRules`, `rulesOf`, `periodContaining`, `periodOfKey`, `periodsBetween`, `previousPeriod`, `periodLabel`, `contextOf`, `startYearOf`, `parsePeriodKey` (PR 2).
- Produces:
  - `type PeriodChoice = { anchor: string | null; calendarYear: number | null }`, `type PeriodOption = { value: string; label: string }`, `type PeriodView = { rules; calendar; period; key; label; at; param; year; options; calendarYear; calendarYearOptions; switcherLabel }`, `periodView(rules, choice, today): PeriodView`, `anchorOf(rules, value): string | null`, `labelOfKey(rules, key): string`, `periodSpanText(p): string`, `localToday(): string` (`client/src/periodForm.ts`)
  - `PeriodProvider`, `usePeriod(): PeriodView`, `useSwitchPeriod(): (value: string) => Promise<boolean>`, `useSwitchCalendarYear(): (year: number) => Promise<boolean>` (`client/src/period.tsx`)
  - `PeriodSelectView({ view, onChange, label? })`, `PeriodSelect({ label? })`, `CalendarYearSelect({ label? })` (`client/src/components/PeriodSelect.tsx`)
  - `useOptionalProperty(): PropertyCtx | null`, `useHasOpenForm(): () => boolean` (`client/src/property.tsx`); `useSwitchYear` entfällt
  - `KeyContext = { items; year: number; at?: PeriodContext; propertyKind? }` (`shared/assessment.ts`)
  - `costBasisText(label: string, calendar?: boolean)` (`client/src/statementView.ts`)

- [ ] **Step 1: Write the failing tests**

`client/src/periodForm.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { anchorOf, labelOfKey, periodSpanText, periodView } from './periodForm'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from './types'

const TODAY = '2026-10-05'
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

describe('Zeitraumumschalter (#208)', () => {
  test('Kalenderobjekt: wie bisher, das Vorjahr, Jahreszahlen als Werte, acht Jahre', () => {
    const v = periodView(CALENDAR_RULES, { anchor: null, calendarYear: null }, TODAY)
    expect([v.calendar, v.key, v.label, v.param, v.year, v.calendarYear, v.switcherLabel]).toEqual([true, '2025-01', '2025', '2025', 2025, 2025, 'Abrechnungsjahr'])
    expect(v.options.map((o) => o.value)).toEqual(['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'])
    expect(v.options.map((o) => o.label)).toEqual(['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'])
    expect(v.at.previousLabel).toBe('2024')
  })

  test('Mai bis April: der zuletzt beendete Zeitraum, Schlüssel als Werte, Kalenderjahr eigens', () => {
    const v = periodView(MAI, { anchor: null, calendarYear: null }, TODAY)
    expect([v.calendar, v.key, v.label, v.param, v.switcherLabel]).toEqual([false, '2025-05', '2025/2026', '2025-05', 'Abrechnungszeitraum'])
    expect(v.options[0]).toEqual({ value: '2026-05', label: '2026/2027' })
    expect(periodView(MAI, { anchor: null, calendarYear: 2024 }, TODAY).calendarYear).toBe(2024)
  })

  test('Ein Rumpf heißt in der Auswahl so', () => {
    const v = periodView(WECHSEL, { anchor: '2025-02-01', calendarYear: null }, TODAY)
    expect([v.key, v.label]).toEqual(['2025-01', '01.01.–30.04.2025'])
    expect(v.options.find((o) => o.value === '2025-01')?.label).toBe('01.01.–30.04.2025 (Rumpf)')
  })

  test('Der gewählte Tag bestimmt den Zeitraum, auch nach dem Wechsel des Objekts', () => {
    const anchor = anchorOf(CALENDAR_RULES, '2025') ?? ''
    expect(anchor).toBe('2025-01-01')
    expect(periodView(MAI, { anchor, calendarYear: null }, TODAY).key).toBe('2024-05')
    expect(anchorOf(MAI, '2025-05')).toBe('2025-05-01')
    expect(anchorOf(MAI, '2025-03')).toBeNull()
  })

  test('Ein älterer gewählter Zeitraum steht in der Auswahl', () => {
    const v = periodView(CALENDAR_RULES, { anchor: '2015-01-01', calendarYear: null }, TODAY)
    expect(v.options.some((o) => o.value === '2015')).toBe(true)
  })

  test('Bezeichnungen', () => {
    expect(labelOfKey(MAI, periodKey('2025-05'))).toBe('2025/2026')
    expect(periodSpanText(periodOfKey(MAI, periodKey('2025-05')) ?? expect.unreachable())).toBe('Mai 2025 bis April 2026')
  })
})
```

`client/src/components/PeriodSelect.test.tsx`:

```tsx
// @vitest-environment jsdom
// Der angezeigte Wert des Umschalters entspricht dem gewählten Zeitraum (CLAUDE.md, Tests Ebene 3).
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PeriodSelectView } from './PeriodSelect'
import { periodView } from '../periodForm'
import { CALENDAR_RULES } from '../../../shared/period.ts'

describe('Zeitraumumschalter (#208)', () => {
  test('Kalenderobjekt: „Abrechnungsjahr“ mit der Jahreszahl', () => {
    render(<PeriodSelectView view={periodView(CALENDAR_RULES, { anchor: '2024-01-01', calendarYear: null }, '2026-10-05')} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Abrechnungsjahr' }) as HTMLSelectElement
    expect(select.value).toBe('2024')
    expect(select.selectedOptions[0]?.textContent).toBe('2024')
  })
  test('Mai bis April: „Abrechnungszeitraum“ mit dem Schlüssel und der Bezeichnung', () => {
    render(<PeriodSelectView view={periodView({ startMonth: 5, changes: [] }, { anchor: '2024-06-01', calendarYear: null }, '2026-10-05')} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Abrechnungszeitraum' }) as HTMLSelectElement
    expect(select.value).toBe('2024-05')
    expect(select.selectedOptions[0]?.textContent).toBe('2024/2025')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- periodForm PeriodSelect`
Expected: FAIL, die Module `./periodForm` und `./PeriodSelect` gibt es nicht.

- [ ] **Step 3: `client/src/periodForm.ts`**

```ts
// Der Zeitraumumschalter (#208, Entwurf 11.4), ohne DOM. Die Oberfläche ist immer „in“ einem
// Abrechnungszeitraum des gewählten Objekts und daneben in einem Kalenderjahr (Mietkonto, Steuer).
//
// Gewählt wird ein **Tag**, nicht ein Schlüssel: Der Zeitraum ist der, der ihn enthält. So passt ein
// Wechsel des Objekts den Zeitraum von selbst an (Teilentwurf 10: „auf den zum gleichen Tag
// passenden des neuen Objekts“), und ein Wechsel des Rhythmus lässt keinen gewählten Schlüssel ins
// Leere zeigen. Ohne Wahl gilt der zuletzt beendete Zeitraum: beim Kalenderjahr das Vorjahr, wie
// bisher.
//
// **Ein Kalenderobjekt sieht aus wie bisher**: Der Umschalter heißt „Abrechnungsjahr“, seine Werte
// sind Jahreszahlen, und die Routen bekommen die Jahreszahl (`param`), die sie bei einem
// Kalenderobjekt wie bisher annehmen (PR 2, G-C6). Erst bei einem anderen Rhythmus stehen dort
// Schlüssel wie '2025-05'.

import { contextOf, isCalendarRules, parsePeriodKey, periodContaining, periodLabel, periodOfKey, periodsBetween, previousPeriod, startYearOf, type PeriodContext } from '../../shared/period.ts'
import type { BillingPeriod, PeriodKey, PeriodRules } from './types'

export type PeriodChoice = { anchor: string | null; calendarYear: number | null }
export type PeriodOption = { value: string; label: string }
export type PeriodView = {
  rules: PeriodRules
  calendar: boolean
  period: BillingPeriod
  key: PeriodKey
  label: string
  at: PeriodContext
  // Der Wert für die Routen und die Auswahl: die Jahreszahl beim Kalenderobjekt, sonst der Schlüssel.
  param: string
  // Das Kalenderjahr, in dem der Zeitraum beginnt (Belege, Kabelhinweis im Formular).
  year: number
  options: PeriodOption[]
  // Mietkonto und Steuer (Entwurf 3.10, 3.11). Beim Kalenderobjekt dasselbe Jahr wie der Zeitraum.
  calendarYear: number
  calendarYearOptions: number[]
  switcherLabel: string
}

const OPTION_YEARS = 8
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Der heutige Tag auf dem Rechner des Nutzers, wie bisher `new Date().getFullYear()`.
export function localToday(): string {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function periodView(rules: PeriodRules, choice: PeriodChoice, today: string): PeriodView {
  const calendar = isCalendarRules(rules)
  const period = choice.anchor !== null ? periodContaining(rules, choice.anchor) : previousPeriod(rules, periodContaining(rules, today))
  const thisYear = Number(today.slice(0, 4))
  const listed = periodsBetween(rules, `${thisYear - (OPTION_YEARS - 1)}-01-01`, today)
  if (!listed.some((p) => p.key === period.key)) listed.push(period)
  listed.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  const valueOf = (p: BillingPeriod): string => (calendar ? String(startYearOf(p.key)) : p.key)
  const year = startYearOf(period.key)
  const calendarYear = calendar ? year : choice.calendarYear ?? year
  const calendarYearOptions = Array.from({ length: OPTION_YEARS }, (_, k) => thisYear - k)
  if (!calendarYearOptions.includes(calendarYear)) calendarYearOptions.push(calendarYear)
  calendarYearOptions.sort((a, b) => b - a)
  return {
    rules,
    calendar,
    period,
    key: period.key,
    label: periodLabel(period),
    at: contextOf(period, previousPeriod(rules, period)),
    param: valueOf(period),
    year,
    options: listed.map((p) => ({ value: valueOf(p), label: p.short ? `${periodLabel(p)} (Rumpf)` : periodLabel(p) })),
    calendarYear,
    calendarYearOptions,
    switcherLabel: calendar ? 'Abrechnungsjahr' : 'Abrechnungszeitraum',
  }
}

// Der Tag zu einem Wert der Auswahl: eine Jahreszahl (Kalenderobjekt) ist ihr 1. Januar, ein
// Schlüssel der Beginn seines Zeitraums. `null`, wenn es den Zeitraum nicht gibt.
export function anchorOf(rules: PeriodRules, value: string): string | null {
  if (/^\d{4}$/.test(value)) return `${value}-01-01`
  const key = parsePeriodKey(value)
  const p = key === null ? null : periodOfKey(rules, key)
  return p === null ? null : p.from
}

// Die Bezeichnung eines Schlüssels; einer, den es nicht gibt, bleibt, wie er ist.
export function labelOfKey(rules: PeriodRules, key: PeriodKey): string {
  const p = periodOfKey(rules, key)
  return p === null ? key : periodLabel(p)
}

// „Mai 2025 bis April 2026“, für den Satz im Mietkonto (Entwurf 3.11).
export function periodSpanText(p: Pick<BillingPeriod, 'from' | 'to'>): string {
  const name = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`
  return `${name(p.from)} bis ${name(p.to)}`
}
```

- [ ] **Step 4: `client/src/period.tsx` (statt `year.tsx`)**

```bash
git mv client/src/year.tsx client/src/period.tsx
```

Inhalt von `client/src/period.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useConfirm } from './components/feedback'
import { anchorOf, localToday, periodView, type PeriodChoice, type PeriodView } from './periodForm'
import { useHasOpenForm, useOptionalProperty } from './property'
import { rulesOf } from '../../shared/period.ts'

// Der Abrechnungszeitraum ist der rote Faden der App (#208): die ganze Oberfläche ist immer „in“
// einem Zeitraum des gewählten Objekts. Statt auf jeder Seite einen eigenen zu führen, liegt die
// Wahl hier zentral; der Umschalter in der Seitenleiste und die Auswahl auf den Seiten verstellen
// denselben Wert. Was daraus folgt (Zeitraum, Bezeichnung, Auswahl), rechnet periodForm.ts.

type Choice = PeriodChoice & {
  setAnchor: (anchor: string | null) => void
  setCalendarYear: (year: number | null) => void
}

const Ctx = createContext<Choice | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<string | null>(null)
  const [calendarYear, setCalendarYear] = useState<number | null>(null)
  return <Ctx.Provider value={{ anchor, calendarYear, setAnchor, setCalendarYear }}>{children}</Ctx.Provider>
}

function useChoice(): Choice {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePeriod() muss innerhalb von <PeriodProvider> stehen')
  return c
}

// Der gewählte Zeitraum mit allem, was die Seiten daraus brauchen. Außerhalb des PropertyProvider
// (Tests einzelner Teile) gilt das Kalenderjahr.
export function usePeriod(): PeriodView {
  const { anchor, calendarYear } = useChoice()
  const property = useOptionalProperty()?.property ?? null
  const rules = rulesOf(property)
  const today = localToday()
  return useMemo(() => periodView(rules, { anchor, calendarYear }, today), [rules, anchor, calendarYear, today])
}

// Der eine Weg, den Zeitraum zu wechseln (Durchsicht zu #141), mit derselben Rückfrage wie beim
// Objekt: Ein offenes Formular legt im gewählten Zeitraum an. Nach dem Wechsel stellt App.tsx die
// Seiten neu auf. `value` ist ein Wert der Auswahl (Jahreszahl oder Schlüssel).
export function useSwitchPeriod(): (value: string) => Promise<boolean> {
  const view = usePeriod()
  const { setAnchor } = useChoice()
  const hasOpenForm = useHasOpenForm()
  const confirm = useConfirm()
  return useCallback(async (value: string) => {
    const anchor = anchorOf(view.rules, value)
    if (anchor === null || value === view.param) return value === view.param
    if (hasOpenForm()) {
      const next = view.options.find((o) => o.value === value)?.label ?? value
      const ok = await confirm({
        title: 'Offene Eingaben verwerfen?',
        message: `Sie haben für ${view.label} ein Formular offen oder Eingaben noch nicht übernommen. Beim Wechsel zu ${next} wird das geschlossen, ohne zu speichern.`,
        confirmLabel: view.calendar ? 'Jahr wechseln' : 'Zeitraum wechseln',
        cancelLabel: 'Abbrechen',
      })
      if (!ok) return false
    }
    setAnchor(anchor)
    return true
  }, [view, setAnchor, hasOpenForm, confirm])
}

// Das Kalenderjahr für Mietkonto und Steuer. Beim Kalenderobjekt ist es der Zeitraum selbst.
export function useSwitchCalendarYear(): (year: number) => Promise<boolean> {
  const view = usePeriod()
  const { setCalendarYear } = useChoice()
  const switchPeriod = useSwitchPeriod()
  return useCallback(async (year: number) => {
    if (view.calendar) return switchPeriod(String(year))
    setCalendarYear(year)
    return true
  }, [view.calendar, switchPeriod, setCalendarYear])
}
```

- [ ] **Step 5: `client/src/property.tsx`**

Den Import `import { useYear } from './year'` und die Funktion `useSwitchYear` samt Kommentar
löschen (sie steht jetzt als `useSwitchPeriod` in period.tsx). Im Kopfkommentar „nach dem Muster des
Abrechnungsjahres (year.tsx)“ → „nach dem Muster des Abrechnungszeitraums (period.tsx)“. Hinter
`usePropertyHeading` anfügen:

```tsx
// Das gewählte Objekt ohne Zwang zum Provider (#208): Der Zeitraumumschalter liest daraus die Regeln
// und gilt in Tests einzelner Teile ohne Provider als Kalenderjahr.
export function useOptionalProperty(): PropertyCtx | null {
  return useContext(Ctx)
}

// Ob ein Formular offen ist (#145), für Umschalter außerhalb dieser Datei. Ohne Provider keines.
export function useHasOpenForm(): () => boolean {
  const c = useContext(Ctx)
  return c?.hasOpenForm ?? (() => false)
}
```

`PeriodProvider` ersetzt `YearProvider`; in `App.tsx` bleibt die Verschachtelung
`<PeriodProvider><PropertyProvider>…</PropertyProvider></PeriodProvider>`: Der Zustand liegt außen,
die Regeln kommen über `useOptionalProperty` von innen.

- [ ] **Step 6: `client/src/components/PeriodSelect.tsx`**

```tsx
import type { PeriodView } from '../periodForm'
import { usePeriod, useSwitchCalendarYear, useSwitchPeriod } from '../period'

// Die Auswahl des Abrechnungszeitraums (#208). Beim Kalenderobjekt sieht sie aus wie die frühere
// Jahresauswahl: Beschriftung „Abrechnungsjahr“, Jahreszahlen als Werte. Die Ansicht ohne Hooks ist
// eigens da, damit der jsdom-Test den angezeigten gegen den gewählten Wert prüfen kann.
export function PeriodSelectView({ view, onChange, label, className = 'field' }: { view: PeriodView; onChange: (value: string) => void; label?: string; className?: string }) {
  return (
    <label className={className}>
      <span>{label ?? view.switcherLabel}</span>
      <select value={view.param} onChange={(e) => onChange(e.target.value)}>
        {view.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function PeriodSelect({ label, className }: { label?: string; className?: string }) {
  const view = usePeriod()
  const switchPeriod = useSwitchPeriod()
  return <PeriodSelectView view={view} label={label} className={className} onChange={(v) => void switchPeriod(v)} />
}

// Das Kalenderjahr für Mietkonto und Steuer (Entwurf 3.10, 3.11).
export function CalendarYearSelect({ label = 'Jahr' }: { label?: string }) {
  const view = usePeriod()
  const switchYear = useSwitchCalendarYear()
  return (
    <label className="field">
      {label}
      <select value={view.calendarYear} onChange={(e) => void switchYear(Number(e.target.value))}>
        {view.calendarYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  )
}
```

(`<span>` um die Beschriftung, wie im Seitenleisten-Umschalter: `getByRole('combobox', { name })`
findet das Feld über das umschließende `<label>`.)

- [ ] **Step 7: Seitenleiste (`client/src/App.tsx`)**

Importe: `YearProvider, useYear, YEAR_OPTIONS` aus `'./year'` → `PeriodProvider` aus `'./period'`
und `PeriodSelect` aus `'./components/PeriodSelect'`; `useSwitchYear` aus dem Import von
`'./property'` streichen. Die Zeilen `const { year } = useYear()` und `const switchYear =
useSwitchYear()` samt Kommentar entfallen. Der Umschalter:

```tsx
        <PeriodSelect className="year-switcher no-print" />
```

statt des bisherigen `<label className="year-switcher no-print">…</label>`. Außen
`<YearProvider>` → `<PeriodProvider>`. Die Seiten werden beim Wechsel neu aufgestellt wie bisher;
stand dort `key={`${propertyId}-${year}`}` o. ä., wird daraus `usePeriod().key` (in der
Komponente `const { key: periodKeyNow } = usePeriod()`, dann `${propertyId}-${periodKeyNow}`).

- [ ] **Step 8: Gemeinsame Helfer ohne Brücke**

`shared/assessment.ts` (Brücke „KeyContext trägt das Jahr der Oberfläche“):

```ts
// Was die Vorbelegung des Schlüssels braucht. `at` ist der Zeitraum, in dem gebucht wird, mit
// seinem Vorzeitraum (#208); fehlt er, ist es das Kalenderjahr `year` (Tests, Kalenderobjekt).
export type KeyContext = { items: readonly CostItem[]; year: number; at?: PeriodContext; propertyKind?: PropertyKind | null }
```

und an der Stelle mit `previousAllocation(ctx.items, category, calendarContext(ctx.year), description)`:

```ts
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, ctx.at ?? calendarContext(ctx.year), description) : null
```

(Kommentar „Brücke Kalenderjahr …“ an dieser Stelle löschen; die Brücke in der Duplikatprüfung oben
in der Datei bleibt bis Task 11.)

`client/src/costForm.ts`:

- `tenanciesForAmounts(tenancies, units, period: number | Pick<BillingPeriod, 'from' | 'to'>, participants = null)`:
  ```ts
  const span = typeof period === 'number' ? calendarYearPeriod(period) : period
  return tenancies.filter((t) => vermietet.has(t.unitId) && t.start <= span.to && (t.end === null || t.end >= span.from))
  ```
  und ebenso `visibleTenancyAmounts`, `amountsSumText`, `draftOf`: Parameter `year` → `period: number | BillingPeriod | undefined` (durchgereicht).
- `buildCostItemBody(form, units, period: number | BillingPeriod, tenancies?)`:
  ```ts
  export function buildCostItemBody(form: ItemForm, units: Unit[], period: number | BillingPeriod, tenancies?: Tenancy[]): BuildResult {
    // Eine Jahreszahl ist das Kalenderjahr (Tests, Kalenderobjekt); sonst der gewählte Zeitraum (#208).
    const p = typeof period === 'number' ? calendarYearPeriod(period) : period
    return costItemBody(draftOf(form, units, tenancies, p), units, p.key)
  }
  ```
- die beiden Stellen mit `calendarContext(ctx.year)` → `ctx.at ?? calendarContext(ctx.year)`;
  der Satz `${ctx.year - 1} wurde „…“` → `${(ctx.at ?? calendarContext(ctx.year)).previousLabel} wurde „…“`.
- `sameCostOf(items, body, propertyId, period: number | PeriodKey)`:
  `period: typeof period === 'number' ? calendarPeriod(period) : period`.

Alle Kommentare „Brücke Kalenderjahr (#208): bis PR 3“ in dieser Datei löschen; Importe
`calendarYearPeriod`, `calendarPeriod`, `calendarContext` aus `'../../shared/period.ts'`,
`BillingPeriod`, `PeriodKey` als Typen.

`client/src/carryOver.ts`: Parameter `year: number` von `alreadyCarried`, `carryOverRows`,
`carryOverBody` → `at: number | PeriodContext`, am Anfang je Funktion
`const ctx = typeof at === 'number' ? calendarContext(at) : at`; dann `calendarPeriod(year - 1)` →
`ctx.previous`, `calendarPeriod(year)` → `ctx.key`, `replaceYear(…, year - 1, year)` →
`replaceYear(…, ctx.previousYear, ctx.year)`, und `carryOverBody` reicht an `buildCostItemBody` den
Zeitraum des Schlüssels weiter: `periodOfKey(rules, ctx.key)` geht nicht ohne Regeln, deshalb bekommt
`carryOverBody` einen vierten Parameter `period: BillingPeriod` statt `at` (Aufrufer: Kosten.tsx mit
`view.period`, Tests mit `calendarYearPeriod(N)` per Umschreiber in Step 10). Brückenkommentare löschen.

`client/src/unitForm.ts`, `missingAreaCheck(missing, tenancies, period: number | BillingPeriod, items = [])`:

```ts
  const span = typeof period === 'number' ? calendarYearPeriod(period) : period
  const from = span.from
  const to = span.to
```

und `c.period === calendarPeriod(year)` → `c.period === span.key` (bei `number` ist `span` der
Kalenderzeitraum mit Schlüssel `'JJJJ-01'`). Brückenkommentar löschen.

`client/src/statementView.ts`:

```ts
// Welche Kosten die Abrechnung enthält (#208): die des Abrechnungsjahres oder -zeitraums.
export function costBasisText(label: string, calendar = true): string {
  return `Abgerechnet werden die Kosten des ${calendar ? 'Abrechnungsjahres' : 'Abrechnungszeitraums'} ${label}.`
}
```

- [ ] **Step 9: Die Seiten**

In jeder Seite `import { useYear } from '../year'` → `import { usePeriod } from '../period'`, den
Umschalter des Jahres durch `<PeriodSelect />` (Import aus `'../components/PeriodSelect'`) ersetzen
und `useSwitchYear` aus dem Import von `'../property'` streichen. Im Einzelnen:

| Seite | Ersetzen |
|---|---|
| `Abrechnung.tsx` | `const { year, period } = useYear()` → `const { key, label, param, calendar } = usePeriod()`; die drei Routen `/api/settlement/${year}` → `${param}`; `c.period === period` → `c.period === key` (zwei Stellen, Abhängigkeiten `[costItems, key]`); `savePpOverride`: `const key = calendarPeriod(year)` samt Brückenkommentar weg, die Korrektur steht unter `key`; die Texte `Abrechnung ${year}`, `Gesamtkosten {year}`, `im Jahr {year}`, `für {year}`, `Nebenkostenabrechnung {year}` und `zur Nebenkostenabrechnung {year}` → `label`; `costBasisText(year)` → `costBasisText(label, calendar)`; `closeSettlementTitle(year, …)` → `closeSettlementTitle(label, …)` (Parameter dort `year: number` → `label: string`); der Umschalter `<label className="field">Abrechnungsjahr<select …>…</select></label>` → `<PeriodSelect />` |
| `Cockpit.tsx` | `const { year, period } = useYear()` → `const { key, label, param, at, period } = usePeriod()`; Routen → `${param}`; `c.period === period` → `c.period === key`; `sumByCat(calendarPeriod(year - 1))` samt Brücke → `sumByCat(at.previous)`; `missingAreaCheck(noArea, tenancies, year, yearItems)` → `(noArea, tenancies, period, yearItems)`; Texte `${year}` → `${label}`, `${year - 1}` → `${at.previousLabel}`; `Abrechnung {year}` → `Abrechnung {label}` |
| `Kosten.tsx` | `const { year, period } = useYear()` → `const view = usePeriod()` und `const { key, label, at, param, period, year } = view`; Route `/api/settlement/${year}` → `${param}`; `fd.append('year', String(year))` beim Hochladen eines Belegs bleibt (Belege tragen Kalenderjahre); `yearItems` filtert `i.period === key`; `keyCtx = { items, year, at, propertyKind }`; `previousCount` → `i.period === at.previous`; `carryOverBody(row, units, year, tenancies)` → `carryOverBody(row, units, period, tenancies)`; `alreadyCarried(items, row, year)` → `(items, row, at)`; `carryOverRows(items, year)` → `(items, at)`; `buildCostItemBody(form, units, year, tenancies)` → `(form, units, period, tenancies)`; `sameCostOf(…, propertyId, year)` → `(…, propertyId, key)`; Texte `{year}` → `{label}`, `{year - 1}` / `${year - 1}` → `{at.previousLabel}` / `${at.previousLabel}`; der Umschalter → `<PeriodSelect />`; `entry.data.assessment.year !== year` bleibt bis Task 11 |
| `Uebersicht.tsx` | `const { year } = useYear()` → `const { key, label, param, at, rules } = usePeriod()`; Route → `${param}`; `byCategory` nimmt einen Schlüssel: `costItems.filter((c) => c.period === k)`; `cur = byCategory(key)`, `prev = byCategory(at.previous)`; der Verlauf summiert je Zeitraum: `map.set(c.period, …)`, sortiert nach Schlüssel, Zeile `<td>{labelOfKey(rules, k)}</td>`, `k === key` statt `y === year`, Spaltenbreite 60 → 140; Texte `{year}` → `{label}`, `{year - 1}` → `{at.previousLabel}`; Überschrift „Gesamtkosten im Jahresverlauf“ → „Gesamtkosten im Verlauf“; der Umschalter → `<PeriodSelect />` |
| `Zaehler.tsx` | `const { year } = useYear()` → `const { param, label } = usePeriod()`; Route `/api/consumption/${year}` → `${param}`; `Verbrauch {year}` → `Verbrauch {label}`; der Umschalter → `<PeriodSelect />` |
| `Mietkonto.tsx` | `const { year } = useYear()` → `const { calendarYear: year, calendar, label, period } = usePeriod()`; der Umschalter → `<CalendarYearSelect />`; über der ersten Karte: `{!calendar && <div className="info no-print">Die Abrechnung {label} umfasst {periodSpanText(period)}. Das Mietkonto zeigt das Kalenderjahr.</div>}` (`periodSpanText` aus `'../periodForm'`) |
| `Steuer.tsx` | `const { year } = useYear()` → `const { calendarYear: year } = usePeriod()`; `YEAR_OPTIONS`-Auswahl → `<CalendarYearSelect />` |
| `Belege.tsx` | `const { year: currentYear } = useYear()` → `const { year: currentYear } = usePeriod()`; `YEAR_OPTIONS` → `usePeriod().calendarYearOptions` (die Liste der Jahre im Ordner bleibt Kalenderjahre: Belege tragen Kalenderjahre); `c.period === calendarPeriod(year)` im Mieterordner und `/api/settlement/${startYearOf(c.period)}` → `c.period === key` mit `const { key } = usePeriod()` bzw. `/api/settlement/${c.period}`; `closedPeriodNotice(String(startYearOf(…)))` → `closedPeriodNotice(labelOfKey(rules, amountCheck.item.period))` |
| `Schnellerfassung.tsx` | `const { year } = useYear()` → `const { year, key } = usePeriod()`; der Umschalter → `<PeriodSelect />`; die Auswertung schickt `year` und neu `period: key` (im Formular der Warteschlange, siehe Task 11); `keyCtx` bleibt bis Task 11 |

Danach:

Run: `grep -rn "Brücke Kalenderjahr" client`
Expected: nur noch Treffer in `client/src/testing/fakeBooking.ts` (Task 11). `client/src/receipts.ts`
trägt den Kommentar für die ganze Datei; dort ist die Gliederung nach Kalenderjahren richtig
(Belege tragen Kalenderjahre). Den Kommentar ersetzen durch: „Der Belegordner gliedert nach
Kalenderjahren, denn Belege tragen Kalenderjahre (#208, Entwurf 5.2: `uploads.year` bleibt).“

Run: `grep -rn "from '\.\./year'\|from './year'\|useYear\b\|useSwitchYear\|YEAR_OPTIONS" client/src --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: keine Treffer.

- [ ] **Step 10: Tests umbenennen und Aufrufer nachziehen**

```bash
node -e "
const fs = require('node:fs'); const path = require('node:path')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
for (const f of walk('client/src').filter((f) => /\.test\.tsx?$/.test(f))) {
  const t = fs.readFileSync(f, 'utf8')
  const u = t.replaceAll('YearProvider', 'PeriodProvider').replace(/from '(\.\.?\/)year'/g, \"from '\$1period'\")
    .replace(/carryOverBody\(([^,]+), ([^,]+), (\d{4}|YEAR|PREV)(,|\))/g, 'carryOverBody(\$1, \$2, calendarYearPeriod(\$3)\$4')
  if (u !== t) { fs.writeFileSync(f, u); console.log('umgeschrieben: ' + f) }
}"
```

In jeder umgeschriebenen Datei, die jetzt `calendarYearPeriod` benutzt, den Import aus dem
relativen Pfad zu `shared/period.ts` ergänzen. Tests, die `costBasisText(N)` erwarten, rufen
`costBasisText(String(N))`.

Run: `npm run typecheck`
Expected: keine Fehler. Bleibt eine Meldung zu `KeyContext`, `buildCostItemBody` oder
`missingAreaCheck`, ist es ein Aufrufer derselben Regel (Zahl bleibt erlaubt, Zeitraum neu).

- [ ] **Step 11: Run tests to verify they pass**

Run: `npm --prefix client test -- periodForm PeriodSelect && npm --prefix client test && npm run build`
Expected: PASS; die Seitentests (Kosten.vorjahr, booking, Belege, Steuer, Abrechnung) bleiben ohne
Änderung ihrer Erwartungen grün, weil ein Kalenderobjekt dieselbe Beschriftung, dieselben Werte und
dieselben Routen hat.

- [ ] **Step 12: Run all tests and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add client shared/assessment.ts
git commit -m "Zeitraum: Zeitraumumschalter statt Jahresumschalter, Seiten ohne Brücke zum Kalenderjahr

Refs #208"
```

---
### Task 9: Kostenformular: Leistungszeitraum, Jahr der Zahlung, Brennstoff, Aufteilen

Entwurf 11.4: Leistungszeitraum unter „Weitere Angaben“, Aufteilung beim Speichern mit Vorschau
(3.4), Jahr der Zahlung nur bei einem Zeitraum über zwei Kalenderjahre (3.10, mit dem Satz
„Maßgeblich ist, wann Sie gezahlt haben (§ 11 Abs. 2 EStG).“), und das schmale Merkmal
„Brennstoff/Energie“ nur bei der Kostenart Heizung (A1). Die Logik steht in `shared/costItem.ts` und
`client/src/costForm.ts`, die Felder in einer eigenen Komponente, damit der jsdom-Test das neue
Auswahlfeld für sich prüfen kann.

**Files:**
- Create: `client/src/components/CostPeriodFields.tsx`
- Modify: `shared/costItem.ts`, `client/src/costForm.ts`, `client/src/carryOver.ts`, `client/src/pages/Kosten.tsx`, `server/src/assessment.ts` (`lineDraft`)
- Test: `client/src/components/CostPeriodFields.test.tsx` (neu); Modify: `client/src/costForm.test.ts`, `server/test/shared-cost-item.test.ts`

**Interfaces:**
- Consumes: `SplitPreviewPart` (Task 3), Routen `…/split/preview` und `…/split` (Task 3), `spansTwoYears` (Task 2), `HEATING_CATEGORY`, `usePeriod` (Task 8).
- Produces:
  - `CostItemDraft` + `serviceFrom: string | null; serviceTo: string | null; taxYear: number | null; heatingPart: HeatingPart | null`; `CostItemBody` + dieselben vier Felder (`shared/costItem.ts`)
  - `ItemForm` + `serviceFrom: string; serviceTo: string; taxYear: string; heatingFuel: boolean`; `needsSplitCheck(body: CostItemBody): boolean`, `splitDecision(parts: readonly SplitPreviewPart[], taxYear: string): { message: string } | { error: string; needsTaxYear: boolean }`, `taxYearOptions(startYear: number): number[]`, `showsTaxYear(period: Pick<BillingPeriod, 'from' | 'to'>, needsTaxYear: boolean): boolean` (`client/src/costForm.ts`)
  - `CostPeriodFields({ form, onChange, showTaxYear, years })` (`client/src/components/CostPeriodFields.tsx`)

- [ ] **Step 1: Write the failing tests**

An `client/src/costForm.test.ts` anhängen (Importe ergänzen: `needsSplitCheck, splitDecision,
showsTaxYear, taxYearOptions` aus `'./costForm'`, `SplitPreviewPart` als Typ aus `'./types'`):

```ts
describe('Leistungszeitraum, Jahr der Zahlung, Brennstoff (#208)', () => {
  const units = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }]
  const form = (over: Partial<ItemForm>): ItemForm => ({ ...EMPTY_ITEM_FORM, category: 'Grundsteuer', description: 'Grundsteuer 2025', amount: '480,00', ...over })

  test('der Rumpf trägt Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal', () => {
    const built = buildCostItemBody(form({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: '2025' }), units, 2025)
    if ('error' in built) return expect.unreachable(built.error)
    expect([built.body.serviceFrom, built.body.serviceTo, built.body.taxYear, built.body.heatingPart]).toEqual(['2025-01-01', '2025-12-31', 2025, null])
    const leer = buildCostItemBody(form({}), units, 2025)
    if ('error' in leer) return expect.unreachable(leer.error)
    expect([leer.body.serviceFrom, leer.body.serviceTo, leer.body.taxYear]).toEqual([null, null, null])
  })

  test('Leistungszeitraum: beide oder keines, Beginn nicht nach dem Ende', () => {
    expect(buildCostItemBody(form({ serviceFrom: '2025-01-01' }), units, 2025)).toEqual({ error: 'Für „Grundsteuer 2025“ fehlt ein Ende des Leistungszeitraums. Bitte tragen Sie Beginn und Ende ein oder lassen Sie beide leer.' })
    expect(buildCostItemBody(form({ serviceFrom: '2025-12-31', serviceTo: '2025-01-01' }), units, 2025)).toEqual({ error: 'Der Leistungszeitraum von „Grundsteuer 2025“ endet vor seinem Beginn.' })
  })

  test('Brennstoff/Energie nur bei Heizkosten; bei anderer Kostenart fällt es weg', () => {
    const heiz = buildCostItemBody(form({ category: 'Heizung und Warmwasser', description: 'Gas', key: 'area', heatingFuel: true }), units, 2025)
    if ('error' in heiz) return expect.unreachable(heiz.error)
    expect(heiz.body.heatingPart).toBe('fuel')
    const kalt = buildCostItemBody(form({ heatingFuel: true }), units, 2025)
    if ('error' in kalt) return expect.unreachable(kalt.error)
    expect(kalt.body.heatingPart).toBeNull()
  })

  test('Aufteilen nur bei kalten Kosten mit Leistungszeitraum', () => {
    const built = buildCostItemBody(form({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }), units, 2025)
    if ('error' in built) return expect.unreachable(built.error)
    expect(needsSplitCheck(built.body)).toBe(true)
    expect(needsSplitCheck({ ...built.body, category: 'Heizung und Warmwasser' })).toBe(false)
    expect(needsSplitCheck({ ...built.body, serviceFrom: null, serviceTo: null })).toBe(false)
  })

  test('Die Rückfrage nennt die Beträge je Zeitraum; ohne Jahr der Zahlung oder bei Abschluss eine Meldung', () => {
    const parts: SplitPreviewPart[] = [
      { period: periodKey('2025-01'), label: '01.01.–30.04.2025', days: 120, amountCents: 15781, labor35aCents: null, description: 'G', needsTaxYear: false, closed: false },
      { period: periodKey('2025-05'), label: '2025/2026', days: 245, amountCents: 32219, labor35aCents: null, description: 'G', needsTaxYear: true, closed: false },
    ]
    // `euro` setzt vor das Eurozeichen ein geschütztes Leerzeichen; die Erwartung nimmt es deshalb von dort.
    expect(splitDecision(parts, '2025')).toEqual({ message: `Die Rechnung betrifft 2 Abrechnungszeiträume. Mietfuchs legt je Zeitraum eine Position an: 01.01.–30.04.2025: ${euro(15781)}, 2025/2026: ${euro(32219)}.` })
    expect(euro(15781).replace('\u00a0', ' ')).toBe('157,81 €')
    expect(splitDecision(parts, '')).toEqual({ error: 'Bitte wählen Sie das Jahr der Zahlung (für die Steuer): Ein Teil der Rechnung gehört in den Zeitraum 2025/2026, der über zwei Kalenderjahre reicht.', needsTaxYear: true })
    const [rumpf, voll] = parts
    if (!rumpf || !voll) return expect.unreachable('zwei Teile gebaut')
    expect(splitDecision([{ ...rumpf, closed: true }, voll], '2025')).toEqual({ error: 'Die Abrechnung 01.01.–30.04.2025 ist abgeschlossen. Öffnen Sie sie wieder, wenn die Rechnung anteilig hinein soll.', needsTaxYear: false })
  })

  test('Jahr der Zahlung: nur bei zwei Kalenderjahren, Auswahl vom Beginn bis ein Jahr nach dem Ende', () => {
    expect(showsTaxYear({ from: '2025-05-01', to: '2026-04-30' }, false)).toBe(true)
    expect(showsTaxYear({ from: '2025-01-01', to: '2025-12-31' }, false)).toBe(false)
    expect(showsTaxYear({ from: '2025-01-01', to: '2025-12-31' }, true)).toBe(true)
    expect(taxYearOptions(2025)).toEqual([2025, 2026, 2027])
  })
})
```

(`periodKey` aus `'../../shared/period.ts'` und `euro` aus `'../../shared/costItem.ts'` importieren.)

`client/src/components/CostPeriodFields.test.tsx`:

```tsx
// @vitest-environment jsdom
// Das neue Auswahlfeld „Jahr der Zahlung“ zeigt den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import CostPeriodFields from './CostPeriodFields'
import { EMPTY_ITEM_FORM } from '../costForm'

describe('Leistungszeitraum und Jahr der Zahlung (#208)', () => {
  test('ein gewähltes Jahr steht im Feld', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '2026' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('2026')
    expect(select.selectedOptions[0]?.textContent).toBe('2026')
  })
  test('ohne Wahl steht „bitte wählen“ im Feld und nichts anderes', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('– bitte wählen –')
  })
  test('Brennstoff nur bei Heizkosten, Jahr der Zahlung nur auf Wunsch', () => {
    const { rerender } = render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByLabelText(/Brennstoff\/Energie/)).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Jahr der Zahlung/ })).toBeNull()
    rerender(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.getByLabelText(/Brennstoff\/Energie/)).toBeTruthy()
  })
})
```

In `server/test/shared-cost-item.test.ts` jede Erwartung an einen ganzen Rumpf aus `costItemBody`
um `serviceFrom: null, serviceTo: null, taxYear: null, heatingPart: null` ergänzen, und jede von
Hand gebaute `CostItemDraft` um dieselben vier Felder (der Übersetzer nennt sie).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- costForm CostPeriodFields`
Expected: FAIL: `needsSplitCheck` usw. fehlen, `ItemForm` kennt `serviceFrom` nicht, das Modul
`CostPeriodFields` gibt es nicht.

- [ ] **Step 3: `shared/costItem.ts`**

Import `HeatingPart` als Typ aus `'./types.ts'`, `HEATING_CATEGORY` aus `'./heating.ts'`.

In `CostItemDraft` am Ende:

```ts
  // Leistungszeitraum, Jahr der Zahlung, Brennstoffmerkmal (#208). `null` heißt keine Angabe.
  serviceFrom: string | null
  serviceTo: string | null
  taxYear: number | null
  heatingPart: HeatingPart | null
```

In `CostItemBody` am Ende dieselben vier Felder. In `costItemBody` vor `const common = {`:

```ts
  // Leistungszeitraum (#208): dieselben Sätze wie die Schreibprüfung in server/src/db/repository.ts.
  if ((d.serviceFrom === null) !== (d.serviceTo === null)) {
    return { error: `Für „${d.description.trim()}“ fehlt ein Ende des Leistungszeitraums. Bitte tragen Sie Beginn und Ende ein oder lassen Sie beide leer.` }
  }
  if (d.serviceFrom !== null && d.serviceTo !== null && d.serviceFrom > d.serviceTo) {
    return { error: `Der Leistungszeitraum von „${d.description.trim()}“ endet vor seinem Beginn.` }
  }
```

und in `common`:

```ts
    serviceFrom: d.serviceFrom,
    serviceTo: d.serviceTo,
    taxYear: d.taxYear,
    // Das Merkmal gibt es nur bei Heizkosten (A1); bei anderer Kostenart fällt es weg, wie eine
    // Zuordnung, die zum Schlüssel nicht gehört.
    heatingPart: d.category === HEATING_CATEGORY ? d.heatingPart : null,
```

`server/src/assessment.ts`, in `lineDraft` im zurückgegebenen Entwurf:

```ts
    // Die Belegbuchung kennt keinen Leistungszeitraum je Zeile (#208); das Jahr der Zahlung setzt Task 11.
    serviceFrom: null, serviceTo: null, taxYear: null, heatingPart: null,
```

- [ ] **Step 4: `client/src/costForm.ts`**

Importe: `spansTwoYears` aus `'../../shared/period.ts'`, `HEATING_CATEGORY` aus
`'../../shared/heating.ts'`, `euro` aus `'../../shared/costItem.ts'`, `BillingPeriod`,
`SplitPreviewPart` als Typen aus `'./types'`.

In `ItemForm` vor `invoiceFile?`:

```ts
  // Leistungszeitraum als 'JJJJ-MM-TT' aus <input type="date">, leer heißt keine Angabe (#208)
  serviceFrom: string
  serviceTo: string
  // Jahr der Zahlung als Text der Auswahl, leer heißt keine Angabe (#208)
  taxYear: string
  // „Brennstoff/Energie“, nur bei Heizkosten (#208, A1)
  heatingFuel: boolean
```

In `EMPTY_ITEM_FORM`: `serviceFrom: '', serviceTo: '', taxYear: '', heatingFuel: false,`. In
`itemToForm`:

```ts
    serviceFrom: i.serviceFrom ?? '',
    serviceTo: i.serviceTo ?? '',
    taxYear: i.taxYear !== undefined ? String(i.taxYear) : '',
    heatingFuel: i.heatingPart === 'fuel',
```

In `draftOf` am Ende des Entwurfs:

```ts
    serviceFrom: form.serviceFrom || null,
    serviceTo: form.serviceTo || null,
    taxYear: form.taxYear === '' ? null : Number(form.taxYear),
    heatingPart: form.heatingFuel ? 'fuel' : null,
```

Am Ende der Datei:

```ts
// ---------- Leistungszeitraum und Aufteilen (#208, Entwurf 3.4, 3.10) ----------

// Nur eine kalte Rechnung mit Leistungszeitraum kann zwei Zeiträume berühren; Heizkosten werden nie
// nach Tagen geteilt (G-C1).
export const needsSplitCheck = (body: CostItemBody): boolean =>
  body.serviceFrom !== null && body.serviceTo !== null && body.category !== HEATING_CATEGORY

// Die Rückfrage vor dem Aufteilen, oder warum nicht aufgeteilt werden kann.
export function splitDecision(parts: readonly SplitPreviewPart[], taxYear: string): { message: string } | { error: string; needsTaxYear: boolean } {
  const closed = parts.find((p) => p.closed)
  if (closed) return { error: `Die Abrechnung ${closed.label} ist abgeschlossen. Öffnen Sie sie wieder, wenn die Rechnung anteilig hinein soll.`, needsTaxYear: false }
  const twoYears = parts.find((p) => p.needsTaxYear)
  if (twoYears && taxYear === '') {
    return { error: `Bitte wählen Sie das Jahr der Zahlung (für die Steuer): Ein Teil der Rechnung gehört in den Zeitraum ${twoYears.label}, der über zwei Kalenderjahre reicht.`, needsTaxYear: true }
  }
  return { message: `Die Rechnung betrifft ${parts.length} Abrechnungszeiträume. Mietfuchs legt je Zeitraum eine Position an: ${parts.map((p) => `${p.label}: ${euro(p.amountCents)}`).join(', ')}.` }
}

// Das Jahr der Zahlung zeigt das Formular nur, wenn der Zeitraum über zwei Kalenderjahre reicht oder
// ein Teil einer aufgeteilten Rechnung dorthin gehört (Entwurf 3.10, 11.4).
export const showsTaxYear = (period: Pick<BillingPeriod, 'from' | 'to'>, needsTaxYear: boolean): boolean => needsTaxYear || spansTwoYears(period)

// Vom Jahr des Beginns bis ein Jahr nach dem Ende (dieselbe Spanne prüft der Server).
export const taxYearOptions = (startYear: number): number[] => [startYear, startYear + 1, startYear + 2]
```

(`euro` formatiert wie `fmtEuro`: „157,81 €“ mit geschütztem Leerzeichen vor dem Eurozeichen.)

`client/src/carryOver.ts`, `carryOverForm(row)`: die neuen Felder leer übernehmen, das Merkmal
aus der Vorlage:

```ts
    // Ein Leistungszeitraum oder ein Jahr der Zahlung des Vorzeitraums gilt nicht für den neuen (#208).
    serviceFrom: '', serviceTo: '', taxYear: '',
    heatingFuel: row.source.heatingPart === 'fuel',
```

- [ ] **Step 5: `client/src/components/CostPeriodFields.tsx`**

```tsx
import type { ItemForm } from '../costForm'
import Term from './Term'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'

// Leistungszeitraum, Jahr der Zahlung und „Brennstoff/Energie“ einer Kostenposition (#208).
// Steht unter „Weitere Angaben“, denn wer im Kalenderjahr abrechnet und Rechnungen für das
// Kalenderjahr hat, braucht nichts davon (Entwurf 11.1).
export default function CostPeriodFields({ form, onChange, showTaxYear, years }: {
  form: ItemForm
  onChange: (next: ItemForm) => void
  showTaxYear: boolean
  years: number[]
}) {
  return (
    <>
      <div className="row">
        <label className="field">
          <span><Term id="accrualPrinciple">Leistungszeitraum</Term> von</span>
          <input type="date" value={form.serviceFrom} onChange={(e) => onChange({ ...form, serviceFrom: e.target.value })} />
        </label>
        <label className="field">
          bis
          <input type="date" value={form.serviceTo} onChange={(e) => onChange({ ...form, serviceTo: e.target.value })} />
        </label>
      </div>
      <p className="muted">
        Nur nötig, wenn die Rechnung einen anderen Zeitraum hat als Ihre Abrechnung. Kalte Betriebskosten über zwei
        Abrechnungszeiträume teilt Mietfuchs beim Speichern nach Tagen auf; Heizkosten nicht.
      </p>
      {form.category === HEATING_CATEGORY && (
        <label className="field checkline">
          <input type="checkbox" checked={form.heatingFuel} onChange={(e) => onChange({ ...form, heatingFuel: e.target.checked })} />
          <span>Brennstoff/Energie (Gas, Öl, Fernwärme, Strom der Wärmepumpe)</span>
        </label>
      )}
      {showTaxYear && (
        <label className="field">
          Jahr der Zahlung (Steuer)
          <select value={form.taxYear} onChange={(e) => onChange({ ...form, taxYear: e.target.value })}>
            <option value="">– bitte wählen –</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <small className="muted">Maßgeblich ist, wann Sie gezahlt haben (§ 11 Abs. 2 EStG).</small>
        </label>
      )}
    </>
  )
}
```

- [ ] **Step 6: `client/src/pages/Kosten.tsx`**

Importe: `CostPeriodFields` aus `'../components/CostPeriodFields'`, `needsSplitCheck,
splitDecision, showsTaxYear, taxYearOptions` aus `'../costForm'`, `HEATING_CATEGORY` aus
`'../../../shared/heating.ts'`, `SplitPreviewPart` als Typ. `period` und `year` stammen aus
`usePeriod()` (Task 8).

Zustand neben `form`: `const [needsTaxYear, setNeedsTaxYear] = useState(false)` und
`useEffect(() => { if (!form) setNeedsTaxYear(false) }, [form])`.

Im Formular hinter dem Feld „davon §35a-Lohn €“:

```tsx
            <details open={!!(form.serviceFrom || form.serviceTo || form.taxYear || form.heatingFuel || showsTaxYear(period, needsTaxYear))}>
              <summary>Weitere Angaben — Leistungszeitraum{showsTaxYear(period, needsTaxYear) ? ', Jahr der Zahlung' : ''}{form.category === HEATING_CATEGORY ? ', Brennstoff/Energie' : ''} (optional)</summary>
              <CostPeriodFields form={form} onChange={setForm} showTaxYear={showsTaxYear(period, needsTaxYear)} years={taxYearOptions(year)} />
            </details>
```

In `saveItem` direkt hinter `const body = JSON.stringify(built.body)` und `const editing = !!form.id`:

```tsx
    // Eine kalte Rechnung über zwei Abrechnungszeiträume (#208, Entwurf 3.4): erst die Vorschau,
    // dann nach Rückfrage alle Teile auf einmal.
    if (needsSplitCheck(built.body)) {
      let parts: SplitPreviewPart[]
      try {
        parts = (await api<{ parts: SplitPreviewPart[] }>(
          editing ? `/api/costItems/${form.id}/split/preview` : withProperty('/api/costItems/split/preview', propertyId),
          { method: 'POST', body },
        )).parts
      } catch (e) {
        setError(errorText(e))
        return
      }
      if (parts.length > 1) {
        const decision = splitDecision(parts, form.taxYear)
        if ('error' in decision) {
          setNeedsTaxYear(decision.needsTaxYear)
          setError(decision.error)
          return
        }
        const ok = await confirm({ title: 'Rechnung aufteilen?', message: decision.message, confirmLabel: 'Aufteilen und speichern', cancelLabel: 'Abbrechen' })
        if (!ok) return
        try {
          await api(editing ? `/api/costItems/${form.id}/split` : withProperty('/api/costItems/split', propertyId), { method: editing ? 'PUT' : 'POST', body })
        } catch (e) {
          setError(errorText(e))
          return
        }
        const desc = form.description.trim()
        setForm(null)
        await load()
        toast(`„${desc}“ auf ${parts.length} Abrechnungszeiträume aufgeteilt.`)
        return
      }
    }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm --prefix client test -- costForm CostPeriodFields Kosten && npm --prefix server test -- test/shared-cost-item.test.ts test/assessment.test.ts test/booking.test.ts && npm run typecheck && npm run build`
Expected: PASS. Die übrigen Kostentests bleiben grün; ein Rumpf, den ein Test ganz vergleicht, trägt
jetzt die vier Felder mit `null`.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/costItem.ts client/src/costForm.ts client/src/carryOver.ts client/src/components/CostPeriodFields.tsx client/src/components/CostPeriodFields.test.tsx client/src/pages/Kosten.tsx client/src/costForm.test.ts server/src/assessment.ts server/test/shared-cost-item.test.ts
git commit -m "Zeitraum: Leistungszeitraum, Jahr der Zahlung und Brennstoff im Kostenformular, Aufteilen mit Rückfrage

Refs #208"
```

---
### Task 10: Stammdaten: Karte „Abrechnungszeitraum“ mit Wechsel und Vorschau

Teilentwurf 10 (Oberfläche), Entwurf 3.6 und 11.4: In den Stammdaten des Objekts steht „Abrechnungs­
zeitraum beginnt im: Januar“ mit dem Satz „Januar heißt Kalenderjahr“. Eine Änderung öffnet immer die
Vorschau (Task 4): die Zeiträume danach, der neue Rumpf mit dem Hinweis auf sachlichen Grund und
Mietvertrag, was aufgeteilt und zugeordnet wird, die Neuerfassung der Jahreskorrekturen und die
Sperre neben Abschlüssen. Gespeichert wird erst mit „Zeitraum wechseln“. Drei Wege führen zu neuen
Regeln: den Beginnmonat von Anfang an ändern, einen Wechsel ab einem Monat hinzufügen, einen
Wechsel entfernen.

**Files:**
- Modify: `client/src/periodForm.ts`, `client/src/pages/Stammdaten.tsx`
- Create: `client/src/components/PeriodCard.tsx`
- Test: `client/src/periodForm.test.ts` (ergänzen), `client/src/components/PeriodCard.test.tsx` (neu)

**Interfaces:**
- Consumes: `PeriodChangePreview`, `PeriodChangeAnswers` (Task 4), Routen `POST /api/properties/:id/period/preview`, `PUT /api/properties/:id/period` (Task 4), `useProperty`, `useOpenForm` (property.tsx), `parseEuro`, `fmtEuro`, `api`, `errorText` (api.ts).
- Produces:
  - `MONTH_OPTIONS: { value: number; label: string }[]`, `type RhythmForm = { mode: 'start' | 'change'; month: number; from: string }`, `rhythmText(rules): string`, `nextRules(current, form): PeriodRules | { error: string }`, `withoutChange(current, from): PeriodRules`, `type AnswerForm`, `initialAnswers(preview): AnswerForm`, `answersOf(preview, form): PeriodChangeAnswers | { error: string }` (`client/src/periodForm.ts`)
  - `RhythmFields`, `PreviewAnswers`, `PeriodCard` (`client/src/components/PeriodCard.tsx`)

- [ ] **Step 1: Write the failing tests**

An `client/src/periodForm.test.ts` anhängen (Importe ergänzen: `answersOf, initialAnswers,
nextRules, rhythmText, withoutChange` aus `'./periodForm'`, `PeriodChangePreview` als Typ aus
`'./types'`):

```ts
describe('Rhythmus ändern (#208)', () => {
  test('in Worten', () => {
    expect(rhythmText(CALENDAR_RULES)).toBe('Kalenderjahr (Januar bis Dezember)')
    expect(rhythmText(MAI)).toBe('Mai bis April')
    expect(rhythmText(WECHSEL)).toBe('Kalenderjahr (Januar bis Dezember), ab Mai 2025: Mai bis April')
  })
  test('neue Regeln aus dem Formular', () => {
    expect(nextRules(CALENDAR_RULES, { mode: 'start', month: 5, from: '' })).toEqual({ startMonth: 5, changes: [] })
    expect(nextRules(CALENDAR_RULES, { mode: 'change', month: 1, from: '2025-05' })).toEqual({ startMonth: 1, changes: ['2025-05'] })
    expect(nextRules(CALENDAR_RULES, { mode: 'change', month: 1, from: '' })).toEqual({ error: 'Bitte geben Sie an, ab welchem Monat der neue Zeitraum beginnt.' })
    expect(withoutChange(WECHSEL, '2025-05')).toEqual({ startMonth: 1, changes: [] })
  })
  const vorschau: PeriodChangePreview = {
    rules: WECHSEL, periods: [], newShort: [], blocked: [], moves: [], assessments: [],
    groups: [{ from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-01') }],
    overrides: [{ tenancyId: 't-a', tenantName: 'A', from: [{ key: periodKey('2025-01'), label: '2025', cents: 220000 }], ask: [{ period: periodKey('2025-01'), label: '01.01.–30.04.2025', months: '01–04/2025' }, { period: periodKey('2025-05'), label: '2025/2026', months: '05/2025–04/2026' }] }],
  }
  test('Antworten: Zuordnung vorbelegt, jede Korrektur verlangt einen Betrag oder „keine Korrektur“ (N4)', () => {
    const form = initialAnswers(vorschau)
    expect(form.groups).toEqual({ '2025-01': '2025-01' })
    expect(answersOf(vorschau, form)).toEqual({ error: 'Bitte tragen Sie für A ein, was 01–04/2025 tatsächlich gezahlt wurde, oder wählen Sie „keine Korrektur“.' })
    const ausgefuellt = { ...form, overrides: { 't-a': { '2025-01': { amount: '700,00', none: false }, '2025-05': { amount: '', none: true } } } }
    expect(answersOf(vorschau, ausgefuellt)).toEqual({ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } })
    expect(answersOf(vorschau, { ...ausgefuellt, overrides: { 't-a': { '2025-01': { amount: 'siebenhundert', none: false }, '2025-05': { amount: '', none: true } } } }))
      .toEqual({ error: 'Bitte tragen Sie für A ein, was 01–04/2025 tatsächlich gezahlt wurde, als Euro-Betrag, etwa 700,00.' })
  })
})
```

`client/src/components/PeriodCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// Die Auswahlfelder der Karte „Abrechnungszeitraum“ zeigen den gewählten Wert (CLAUDE.md, Tests Ebene 3).
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PreviewAnswers, RhythmFields } from './PeriodCard'
import { initialAnswers } from '../periodForm'
import { periodKey } from '../../../shared/period.ts'
import type { PeriodChangePreview } from '../types'

describe('Karte „Abrechnungszeitraum“ (#208)', () => {
  test('Beginnmonat: der gewählte Monat steht im Feld', () => {
    render(<RhythmFields form={{ mode: 'start', month: 5, from: '' }} onChange={() => {}} />)
    const art = screen.getByRole('combobox', { name: 'Was möchten Sie ändern?' }) as HTMLSelectElement
    expect(art.value).toBe('start')
    const monat = screen.getByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' }) as HTMLSelectElement
    expect([monat.value, monat.selectedOptions[0]?.textContent]).toEqual(['5', 'Mai'])
  })
  test('Wechsel: der Monat des Beginns, kein Beginnmonat', () => {
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2025-05' }} onChange={() => {}} />)
    expect((screen.getByLabelText(/Ab \(Monat und Jahr\)/) as HTMLInputElement).value).toBe('2025-05')
    expect(screen.queryByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' })).toBeNull()
  })
  test('Zuordnung einer Gruppe: der vorgeschlagene Zeitraum steht im Feld', () => {
    const preview: PeriodChangePreview = {
      rules: { startMonth: 1, changes: ['2025-05'] }, periods: [], newShort: [], blocked: [], moves: [], overrides: [], assessments: [],
      groups: [{ from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-05') }],
    }
    render(<PreviewAnswers preview={preview} answers={initialAnswers(preview)} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Zeitraum für „Müll 2025“/ }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['2025-05', '2025/2026'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix client test -- periodForm PeriodCard`
Expected: FAIL: `rhythmText`, `nextRules` usw. fehlen, das Modul `PeriodCard` gibt es nicht.

- [ ] **Step 3: Logik (`client/src/periodForm.ts`)**

Importe ergänzen: `parseEuro` aus `'./api'`, `PeriodChangeAnswers`, `PeriodChangePreview` als
Typen aus `'./types'`.

```ts
// ---------- Rhythmus ändern (#208, Entwurf 3.6) ----------

export const MONTH_OPTIONS: { value: number; label: string }[] = MONTH_NAMES.map((label, i) => ({ value: i + 1, label }))

const rhythmOfMonth = (month: number): string =>
  month === 1 ? 'Kalenderjahr (Januar bis Dezember)' : `${MONTH_NAMES[month - 1] ?? ''} bis ${MONTH_NAMES[(month + 10) % 12] ?? ''}`

// Der Rhythmus in Worten: „Kalenderjahr (Januar bis Dezember)“, „Mai bis April“, mit Wechseln
// „…, ab Mai 2025: Mai bis April“.
export function rhythmText(rules: PeriodRules): string {
  const parts = [rhythmOfMonth(rules.startMonth)]
  for (const change of rules.changes) {
    const month = Number(change.slice(5, 7))
    parts.push(`ab ${MONTH_NAMES[month - 1] ?? ''} ${change.slice(0, 4)}: ${rhythmOfMonth(month)}`)
  }
  return parts.join(', ')
}

// Was geändert wird: der Beginnmonat von Anfang an (alle Zeiträume ohne Wechsel bekommen ihn) oder
// ein Wechsel ab einem Monat (ab dort beginnt jeder Zeitraum in diesem Monat, davor ein Rumpf).
export type RhythmForm = { mode: 'start' | 'change'; month: number; from: string }

export function nextRules(current: PeriodRules, form: RhythmForm): PeriodRules | { error: string } {
  if (form.mode === 'start') return { startMonth: form.month, changes: [...current.changes] }
  if (parsePeriodKey(form.from) === null) return { error: 'Bitte geben Sie an, ab welchem Monat der neue Zeitraum beginnt.' }
  return { startMonth: current.startMonth, changes: [...current.changes, form.from].sort() }
}

export function withoutChange(current: PeriodRules, from: string): PeriodRules {
  return { startMonth: current.startMonth, changes: current.changes.filter((c) => c !== from) }
}

// Die Antworten zur Vorschau, wie das Formular sie hält: je Gruppe der gewählte Zeitraum, je
// Mietverhältnis und gefragtem Zeitraum ein Betrag oder „keine Korrektur“.
export type AnswerForm = {
  groups: Record<string, string>
  overrides: Record<string, Record<string, { amount: string; none: boolean }>>
}

export function initialAnswers(preview: PeriodChangePreview): AnswerForm {
  return {
    groups: Object.fromEntries(preview.groups.map((g) => [g.from, g.suggested])),
    overrides: Object.fromEntries(preview.overrides.map((o) => [o.tenancyId, Object.fromEntries(o.ask.map((a) => [a.period, { amount: '', none: false }]))])),
  }
}

// Ohne Antwort wird nicht gespeichert (N4): Jeder gefragte Zeitraum braucht einen Betrag oder
// ausdrücklich „keine Korrektur“; eine tatsächlich gezahlte Summe lässt sich nicht verteilen.
export function answersOf(preview: PeriodChangePreview, form: AnswerForm): PeriodChangeAnswers | { error: string } {
  const overrides: Record<string, Record<string, number | null>> = {}
  for (const o of preview.overrides) {
    const given = form.overrides[o.tenancyId] ?? {}
    const out: Record<string, number | null> = {}
    for (const a of o.ask) {
      const entry = given[a.period] ?? { amount: '', none: false }
      if (entry.none) { out[a.period] = null; continue }
      if (entry.amount.trim() === '') return { error: `Bitte tragen Sie für ${o.tenantName} ein, was ${a.months} tatsächlich gezahlt wurde, oder wählen Sie „keine Korrektur“.` }
      const cents = parseEuro(entry.amount)
      if (cents === null || cents < 0) return { error: `Bitte tragen Sie für ${o.tenantName} ein, was ${a.months} tatsächlich gezahlt wurde, als Euro-Betrag, etwa 700,00.` }
      out[a.period] = cents
    }
    overrides[o.tenancyId] = out
  }
  return { groups: { ...form.groups }, overrides }
}
```

(`parseEuro` gibt Cent oder `null` zurück, wie in `client/src/api.ts`.)

- [ ] **Step 4: `client/src/components/PeriodCard.tsx`**

```tsx
import { useState } from 'react'
import type { PeriodChangePreview, Property } from '../types'
import { api, errorText, fmtEuro } from '../api'
import { useOpenForm, useProperty } from '../property'
import { useToast } from './feedback'
import Term from './Term'
import { answersOf, initialAnswers, MONTH_OPTIONS, nextRules, rhythmText, withoutChange, type AnswerForm, type RhythmForm } from '../periodForm'
import { rulesOf } from '../../../shared/period.ts'

// Die Karte „Abrechnungszeitraum“ in den Stammdaten (#208, Entwurf 3.6, 11.4). Jede Änderung geht
// über die Vorschau des Servers; gespeichert wird erst mit „Zeitraum wechseln“, in einer
// Transaktion. Wer im Kalenderjahr abrechnet, sieht hier eine Zeile und muss nichts tun.

export function RhythmFields({ form, onChange }: { form: RhythmForm; onChange: (next: RhythmForm) => void }) {
  return (
    <div className="row">
      <label className="field">
        Was möchten Sie ändern?
        <select value={form.mode} onChange={(e) => onChange({ ...form, mode: e.target.value === 'change' ? 'change' : 'start' })}>
          <option value="start">Beginnmonat von Anfang an</option>
          <option value="change">Wechsel ab einem Monat</option>
        </select>
      </label>
      {form.mode === 'start' ? (
        <label className="field">
          Abrechnungszeitraum beginnt im
          <select value={form.month} onChange={(e) => onChange({ ...form, month: Number(e.target.value) })}>
            {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      ) : (
        <label className="field">
          Ab (Monat und Jahr)
          <input type="month" value={form.from} onChange={(e) => onChange({ ...form, from: e.target.value })} />
        </label>
      )}
    </div>
  )
}

export function PreviewAnswers({ preview, answers, onChange }: { preview: PeriodChangePreview; answers: AnswerForm; onChange: (next: AnswerForm) => void }) {
  return (
    <>
      {preview.groups.map((g) => (
        <label key={g.from} className="field">
          Zeitraum für {g.items.map((i) => `„${i.description}“`).join(', ')} (bisher {g.fromLabel})
          <select value={answers.groups[g.from] ?? g.suggested} onChange={(e) => onChange({ ...answers, groups: { ...answers.groups, [g.from]: e.target.value } })}>
            {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {preview.overrides.map((o) => (
        <fieldset key={o.tenancyId} className="field">
          <legend>
            {o.tenantName}: <Term id="prepayment">tatsächlich gezahlte Vorauszahlungen</Term> neu erfassen
            (bisher {o.from.map((f) => `${fmtEuro(f.cents)} für ${f.label}`).join(', ')})
          </legend>
          {o.ask.map((a) => {
            const entry = answers.overrides[o.tenancyId]?.[a.period] ?? { amount: '', none: false }
            const set = (next: { amount: string; none: boolean }) =>
              onChange({ ...answers, overrides: { ...answers.overrides, [o.tenancyId]: { ...(answers.overrides[o.tenancyId] ?? {}), [a.period]: next } } })
            return (
              <div key={a.period} className="row">
                <label className="field">
                  tatsächlich gezahlt {a.months} ({a.label}) €
                  <input value={entry.amount} disabled={entry.none} inputMode="decimal" onChange={(e) => set({ ...entry, amount: e.target.value })} />
                </label>
                <label className="field checkline">
                  <input type="checkbox" checked={entry.none} onChange={(e) => set({ ...entry, none: e.target.checked })} />
                  <span>keine Korrektur (die Staffel gilt)</span>
                </label>
              </div>
            )
          })}
        </fieldset>
      ))}
    </>
  )
}

export default function PeriodCard() {
  const { property, reload } = useProperty()
  const toast = useToast()
  const [form, setForm] = useState<RhythmForm>({ mode: 'start', month: 1, from: '' })
  const [preview, setPreview] = useState<PeriodChangePreview | null>(null)
  const [answers, setAnswers] = useState<AnswerForm | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Eine offene Vorschau gehört zu diesem Objekt (#145); ein Wechsel des Objekts fragt dann.
  useOpenForm(preview !== null)
  if (!property) return null
  const rules = rulesOf(property)

  async function ask(next: ReturnType<typeof nextRules>) {
    if (!property) return
    if ('error' in next) { setError(next.error); return }
    setError('')
    setBusy(true)
    try {
      const p = await api<PeriodChangePreview>(`/api/properties/${property.id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: next }) })
      setPreview(p)
      setAnswers(initialAnswers(p))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!property || !preview || !answers) return
    const given = answersOf(preview, answers)
    if ('error' in given) { setError(given.error); return }
    setBusy(true)
    try {
      await api<Property>(`/api/properties/${property.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: preview.rules, answers: given }) })
      setPreview(null)
      setAnswers(null)
      setError('')
      await reload()
      toast('Abrechnungszeitraum umgestellt.')
    } catch (e) {
      // 409: veraltete Vorschau oder fehlende Angaben; die Meldung sagt, was fehlt.
      setError(`${errorText(e)} Bitte prüfen Sie die Vorschau erneut.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2><Term id="billingPeriod">Abrechnungszeitraum</Term></h2>
      <p>{rhythmText(rules)}. <span className="muted">Januar heißt Kalenderjahr. Wählen Sie den Monat, mit dem Ihr Messdienst abrechnet.</span></p>
      {rules.changes.map((c) => (
        <button key={c} className="btn secondary" disabled={busy} onClick={() => void ask(withoutChange(rules, c))}>Wechsel ab {c} entfernen …</button>
      ))}
      <RhythmFields form={form} onChange={setForm} />
      <button className="btn secondary" disabled={busy} onClick={() => void ask(nextRules(rules, form))}>Vorschau</button>
      {error && <div className="error">{error}</div>}
      {preview && answers && (
        <div className="card inset">
          <h3>Nach dem Wechsel</h3>
          <p>{preview.periods.map((p) => (p.short ? `${p.label} (Rumpf)` : p.label)).join(' · ')}</p>
          {preview.newShort.length > 0 && (
            <div className="warn">
              <Term id="shortPeriod">Rumpfzeitraum</Term> {preview.newShort.map((p) => p.label).join(', ')}. Eine Verkürzung braucht einen sachlichen Grund,
              etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.
            </div>
          )}
          {preview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
          {preview.moves.map((m) => (
            <p key={m.costItemId}>„{m.description}“ ({fmtEuro(m.amountCents)}) wird nach Tagen aufgeteilt: {m.parts.map((p) => `${p.label}: ${fmtEuro(p.amountCents)}`).join(', ')}.</p>
          ))}
          {preview.assessments.map((a) => <p key={a.assessmentId} className="muted">Belegauswertung „{a.file}“: künftig {a.toLabel}.</p>)}
          <PreviewAnswers preview={preview} answers={answers} onChange={setAnswers} />
          <div className="row">
            <button className="btn" disabled={busy || preview.blocked.length > 0} onClick={() => void apply()}>Zeitraum wechseln</button>
            <button className="btn secondary" disabled={busy} onClick={() => { setPreview(null); setAnswers(null); setError('') }}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: In die Stammdaten (`client/src/pages/Stammdaten.tsx`)**

Import `PeriodCard` aus `'../components/PeriodCard'`; direkt unter `<PropertyCard />`:

```tsx
      <PeriodCard />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix client test -- periodForm PeriodCard Stammdaten && npm run typecheck && npm run build`
Expected: PASS (PeriodCard 3 Tests). `Stammdaten.test.tsx` bleibt grün: Beim Kalenderobjekt steht
eine Zeile mehr da, kein Feld im Weg.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS; `anrede.test.ts` findet keine Du-Form in den neuen Texten.

```bash
git add client/src/periodForm.ts client/src/periodForm.test.ts client/src/components/PeriodCard.tsx client/src/components/PeriodCard.test.tsx client/src/pages/Stammdaten.tsx
git commit -m "Zeitraum: Karte Abrechnungszeitraum in den Stammdaten mit Vorschau und Neuerfassung der Jahreskorrekturen

Refs #208"
```

---
### Task 11: Belegbuchung im Zeitraum des Objekts

PR 2 lässt die Belegbuchung in den Kalenderzeitraum des Jahres buchen und markiert jede dieser
Stellen als Brücke. Bei einem Objekt mit eigenem Rhythmus gäbe es diesen Zeitraum nicht (der
Wächter lehnte jede Buchung ab) oder es wäre ein Rumpf. Diese Aufgabe bestimmt den Zielzeitraum
einer Auswertung an einer Stelle (`bookingPeriod`): der gewählte Zeitraum, wenn er das Jahr des
Belegs berührt, sonst der Zeitraum mit der größten Überschneidung mit dem Kalenderjahr des Belegs
(Teilentwurf 10, „größte Überschneidung“ für den Vorschlag des Zeitraums). Bei einem Kalenderobjekt
ergibt das genau den Kalenderzeitraum des Jahres wie bisher, und die Ampel sagt dieselben Sätze.
Reicht der Zielzeitraum über zwei Kalenderjahre, setzt die Buchung das Jahr der Zahlung aus dem
Rechnungsdatum (Entwurf 3.10: „vorbelegt mit dem Jahr des Rechnungsdatums laut Beleg“).

**Files:**
- Modify: `shared/assessment.ts`, `shared/types.ts` (`AssessmentView`), `server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/db/booking.ts`, `server/src/db/assessments.ts`, `server/src/index.ts` (`rememberAssessment`), `client/src/evaluationQueue.ts`, `client/src/pages/Schnellerfassung.tsx`, `client/src/pages/Kosten.tsx`, `client/src/testing/fakeBooking.ts`
- Test: `server/test/booking-zeitraum.test.ts` (neu)

**Interfaces:**
- Consumes: `periodsBetween`, `periodOfKey`, `periodContext`, `periodLabel`, `calendarYearPeriod`, `isCalendarRules`, `rulesOf`, `spansTwoYears`, `parsePeriodKey`, `calendarPeriod` (PR 2, Task 2); `KeyContext.at` (Task 8); `CostItemDraft.taxYear` (Task 9).
- Produces:
  - `periodForYear(rules: PeriodRules, year: number): BillingPeriod`, `bookingPeriod(rules: PeriodRules, a: Pick<StoredAssessment, 'year' | 'requestedPeriod'>): BillingPeriod`, `bookingTaxYear(period: BillingPeriod, a: Pick<StoredAssessment, 'year' | 'invoiceDate'>): number | null` (`shared/assessment.ts`)
  - `PositionCtx.targetPeriod?: PeriodKey` (`shared/assessment.ts`)
  - `AssessmentView.targetPeriod?: PeriodKey`, `AssessmentView.targetLabel?: string` (`shared/types.ts`)
  - `DescribeContext.rules: PeriodRules`, `TargetContext.rules: PeriodRules` (server/src/assessment.ts), `PlanInput.rules: PeriodRules` (server/src/bookingPlan.ts)

- [ ] **Step 1: Write the failing test**

`server/test/booking-zeitraum.test.ts`:

```ts
// Belegbuchung im Abrechnungszeitraum des Objekts (#208).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bookingPeriod, bookingTaxYear, periodForYear } from '../../shared/assessment.ts'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import type { CostItem, LineDecision, PeriodRules } from '../../shared/types.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { readStock } from '../src/db/read.ts'
import { placeAssessment, saveAssessment } from '../src/db/assessments.ts'
import { bookAssessment, previewBooking, viewAssessment } from '../src/db/booking.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }

test('Zielzeitraum: Kalenderobjekt wie bisher, Mai bis April nach dem gewählten oder der größten Überschneidung', () => {
  assert.equal(bookingPeriod(CALENDAR_RULES, { year: 2025, requestedPeriod: periodKey('2024-01') }).key, '2025-01', 'gewählt war 2024, gebucht wird ins Jahr des Belegs')
  assert.equal(bookingPeriod(CALENDAR_RULES, { year: 2025, requestedPeriod: null }).key, '2025-01')
  assert.equal(periodForYear(MAI, 2025).key, '2025-05', 'Mai bis Dezember 2025 sind 245 Tage, Januar bis April 120')
  assert.equal(bookingPeriod(MAI, { year: 2025, requestedPeriod: periodKey('2024-05') }).key, '2024-05', 'der gewählte berührt 2025')
  assert.equal(bookingPeriod(MAI, { year: 2025, requestedPeriod: periodKey('2023-05') }).key, '2025-05', 'der gewählte berührt 2025 nicht')
  assert.equal(periodForYear({ startMonth: 9, changes: [] }, 2025).key, '2024-09', 'September bis August: Januar bis August 2025 überwiegt')
})

test('Jahr der Zahlung einer Buchung: aus dem Rechnungsdatum, nur bei einem Zeitraum über zwei Kalenderjahre', () => {
  const p = periodForYear(MAI, 2025)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: '2026-02-10' }), 2026)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: null }), 2025)
  assert.equal(bookingTaxYear(p, { year: 2025, invoiceDate: '2031-01-01' }), 2025, 'außerhalb der erlaubten Spanne gilt das Jahr des Belegs')
  assert.equal(bookingTaxYear(periodForYear(CALENDAR_RULES, 2025), { year: 2025, invoiceDate: '2026-02-10' }), null)
})

async function withWorld(work: (opened: OpenedDatabase, uploadDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-buchung-zeitraum-'))
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }))
    await work(opened, uploadDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Mai bis April: Die Buchung legt die Position im gewählten Zeitraum an, mit Jahr der Zahlung aus dem Rechnungsdatum', async () => {
  await withWorld(async (opened, uploadDir) => {
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    fs.writeFileSync(path.join(uploadDir, 'wasser.pdf'), '%PDF wasser')
    const r = await opened.write((db) => saveAssessment(db, {
      file: 'wasser.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedPeriod: periodKey('2025-05'), vendor: 'Stadtwerke', invoiceDate: '2026-02-10',
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false,
      lines: [{ description: 'Frischwasser', category: 'Wasser/Abwasser', categoryGuessed: false, amountCents: 70000, labor35aCents: null }],
    }, { id: 'a-wasser', now: '2026-10-02T00:00:00Z' }))
    const v = await opened.read((db) => viewAssessment(db, r.assessment.id, uploadDir))
    assert.deepEqual([v.targetPeriod, v.targetLabel], ['2025-05', '2025/2026'])
    const decisions: LineDecision[] = [{ idx: 0, action: 'create', fields: { description: 'Frischwasser', category: 'Wasser/Abwasser', amountCents: 70000, labor35aCents: null, key: 'area', allocation: null, externalTotalCents: null } }]
    const preview = await opened.read((db) => previewBooking(db, r.assessment.id, decisions, uploadDir))
    assert.deepEqual(preview.errors, [])
    const outcome = await opened.write((db) => bookAssessment(db, r.assessment.id, decisions, preview.token, { uploadDir, newId: () => 'neu-1' }))
    assert.equal(outcome.kind, 'done')
    const item = (await opened.read(readStock)).costItems.find((c: CostItem) => c.id === 'neu-1') ?? assert.fail('keine Position')
    assert.deepEqual([item.period, item.taxYear], ['2025-05', 2026])
  })
})

test('Das Jahr der Buchung von Hand setzen: beim Kalenderobjekt sein Kalenderzeitraum, bei Mai bis April der mit der größten Überschneidung', async () => {
  await withWorld(async (opened, uploadDir) => {
    fs.writeFileSync(path.join(uploadDir, 'b.pdf'), '%PDF b')
    await opened.write((db) => saveAssessment(db, {
      file: 'b.pdf', propertyId: 'objekt-1', year: 2025, detectedYear: 2025, requestedPeriod: periodKey('2025-01'), vendor: null, invoiceDate: null,
      totalGrossCents: null, amountsAdjusted: null, laborFromTotal: false, lines: [],
    }, { id: 'a-b', now: '2026-10-02T00:00:00Z' }))
    await opened.write((db) => placeAssessment(db, 'a-b', { year: 2024 }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-b', uploadDir))).requestedPeriod, '2024-01')
    await opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')) })
    await opened.write((db) => placeAssessment(db, 'a-b', { year: 2026 }))
    assert.equal((await opened.read((db) => viewAssessment(db, 'a-b', uploadDir))).requestedPeriod, '2026-05')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/booking-zeitraum.test.ts`
Expected: FAIL: `bookingPeriod`, `bookingTaxYear`, `periodForYear` fehlen.

- [ ] **Step 3: Gemeinsame Regel (`shared/assessment.ts`)**

Importe: `calendarYearPeriod, isCalendarRules, periodOfKey, periodsBetween, spansTwoYears` aus
`'./period.ts'`, `BillingPeriod`, `PeriodRules`, `StoredAssessment` als Typen aus `'./types.ts'`.

```ts
// ---------- Der Zielzeitraum einer Belegbuchung (#208) ----------

const MS_DAY = 86400000
const overlap = (a: Pick<BillingPeriod, 'from' | 'to'>, b: Pick<BillingPeriod, 'from' | 'to'>): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1
}

// Der Abrechnungszeitraum, in den ein Beleg eines Kalenderjahres gehört, wenn niemand etwas anderes
// gewählt hat: der mit der größten Überschneidung, bei Gleichstand der frühere (Teilentwurf 10). Beim
// Kalenderobjekt ist es das Kalenderjahr selbst.
export function periodForYear(rules: PeriodRules, year: number): BillingPeriod {
  const jahr = calendarYearPeriod(year)
  if (isCalendarRules(rules)) return jahr
  let best: BillingPeriod | null = null
  for (const p of periodsBetween(rules, jahr.from, jahr.to)) if (best === null || overlap(p, jahr) > overlap(best, jahr)) best = p
  return best ?? jahr
}

// Wohin eine Auswertung bucht: in den gewählten Zeitraum, wenn er das Jahr des Belegs berührt; sonst
// in den des Jahres (`periodForYear`). Beim Kalenderobjekt ergibt das wie bisher das Jahr des Belegs.
export function bookingPeriod(rules: PeriodRules, a: Pick<StoredAssessment, 'year' | 'requestedPeriod'>): BillingPeriod {
  const requested = a.requestedPeriod === null ? null : periodOfKey(rules, a.requestedPeriod)
  if (requested !== null && overlap(requested, calendarYearPeriod(a.year)) > 0) return requested
  return periodForYear(rules, a.year)
}

// Das Jahr der Zahlung einer gebuchten Position (Entwurf 3.10): nur bei einem Zeitraum über zwei
// Kalenderjahre, aus dem Rechnungsdatum, wenn es in der erlaubten Spanne liegt (Beginn bis ein Jahr
// nach dem Ende, wie in server/src/db/repository.ts), sonst das Jahr des Belegs, sonst der Beginn.
export function bookingTaxYear(period: BillingPeriod, a: Pick<StoredAssessment, 'year' | 'invoiceDate'>): number | null {
  if (!spansTwoYears(period)) return null
  const start = Number(period.from.slice(0, 4))
  const end = Number(period.to.slice(0, 4)) + 1
  const fits = (y: number): boolean => y >= start && y <= end
  const fromInvoice = a.invoiceDate !== null ? Number(a.invoiceDate.slice(0, 4)) : null
  if (fromInvoice !== null && fits(fromInvoice)) return fromInvoice
  return fits(a.year) ? a.year : start
}
```

In `PositionCtx`:

```ts
  // Der Zeitraum, in den gebucht wird (#208). Fehlt er, der Kalenderzeitraum des Jahres.
  targetPeriod?: PeriodKey
```

und in `scorePosition` die Brücke ersetzen:

```ts
  const period = ctx.targetPeriod ?? calendarPeriod(year)
```

(Brückenkommentar löschen, `PeriodKey` als Typ importieren.)

`shared/types.ts`, in `AssessmentView`:

```ts
  // Der Zeitraum, in den die Auswertung bucht, und seine Bezeichnung (#208, `bookingPeriod`).
  // Optional, weil Testattrappen und ältere Antworten ihn nicht tragen.
  targetPeriod?: PeriodKey
  targetLabel?: string
```

- [ ] **Step 4: Server (`server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/db/booking.ts`, `server/src/db/assessments.ts`, `server/src/index.ts`)**

`server/src/assessment.ts`: Importe `bookingPeriod, bookingTaxYear` aus
`'../../shared/assessment.ts'`, `periodContext, periodLabel` aus `'../../shared/period.ts'`,
`PeriodRules` als Typ. `DescribeContext` und `TargetContext` bekommen `rules: PeriodRules`. In jeder
Funktion, die `a` (die Auswertung) und einen dieser Kontexte bekommt, als erste Zeile
`const target = bookingPeriod(ctx.rules, a)`, dann:

| Stelle (PR 2, Brücke) | wird |
|---|---|
| `lineCandidates`: `period: calendarPeriod(a.year)` und `.filter((i) => i.period === calendarPeriod(a.year) && …)` | Parameter `target: PeriodKey` in den Optionen (`opts.target`), dort `period: opts.target` und `i.period === opts.target` |
| `replacedByLinking(candidates, l, a.year, booked)` | `replacedByLinking(candidates, l, target.key, booked)`, Parameter `period: PeriodKey`, Vergleich `c.period === period` |
| `aiPositionDefaults(…, { items: ctx.items, year: a.year, propertyKind: ctx.propertyKind }, …)` | `{ items: ctx.items, year: a.year, at: periodContext(ctx.rules, target), propertyKind: ctx.propertyKind }` |
| `categoryDeviationPct(ctx.items, line.category, calendarContext(a.year), …)` | `categoryDeviationPct(ctx.items, line.category, periodContext(ctx.rules, target), …)` |
| `costItemBody(lineDraft(fields, { vendor, invoiceFile: a.file }, ctx.units), ctx.units, calendarPeriod(a.year))` | `costItemBody(lineDraft(fields, { vendor, invoiceFile: a.file, taxYear: bookingTaxYear(target, a) }, ctx.units), ctx.units, target.key)` |
| `scorePosition({ …, targetYear: a.year, existingItems: pool, … })` | zusätzlich `targetPeriod: target.key` |
| `describeAssessment`: `const requestedYear = …; const otherYear = …` und `reasons.push(\`Beleg aus ${a.year}, gewählt war ${requestedYear} — …\`)` | siehe unten |

```ts
  // Der gewählte Zeitraum und der, in den gebucht wird (#208). Weichen sie ab, steht die Ampel auf
  // gelb und nichts ist vorab angehakt. Beim Kalenderobjekt sind es die Jahreszahlen wie bisher.
  const requested = a.requestedPeriod === null ? null : periodOfKey(ctx.rules, a.requestedPeriod)
  const otherYear = requested !== null && requested.key !== target.key
```

```ts
    reasons.push(`Beleg aus ${a.year}, gewählt war ${requested ? periodLabel(requested) : ''} — gebucht wird in ${periodLabel(target)}; sonst das Jahr der Buchung ändern`)
```

und im Ergebnis von `describeAssessment` `targetPeriod: target.key, targetLabel: periodLabel(target),`.
`lineDraft` nimmt in `extra` zusätzlich `taxYear?: number | null` und setzt
`taxYear: extra.taxYear ?? null` statt des festen `null` aus Task 9.

`server/src/bookingPlan.ts`: `PlanInput.rules: PeriodRules`; in `planBooking` als erste Zeilen
`const a = input.assessment` (steht da) und `const target = bookingPeriod(input.rules, a)`; dann:

- beide `costItemBody(…, input.units, calendarPeriod(a.year))` → `costItemBody(lineDraft(d.fields, { vendor: a.vendor ?? '', invoiceFile: a.file, taxYear: bookingTaxYear(target, a) }, input.units), input.units, target.key)`;
- `sameCostCandidates(pool, { …, period: calendarPeriod(a.year), … })` → `period: target.key`;
- `lineCandidates(others, a, body, input.booked, { own: ownItems, twinFiles: input.twinFiles })` → Optionen um `target: target.key`;
- die Prüfung beim Verknüpfen:
  ```ts
      if (item.period !== target.key) {
        errors.push({ idx: d.idx, message: `${quote(item.description)} gehört zu ${labelOf(item.period)}, der Beleg zu ${periodLabel(target)}. Ändern Sie das Jahr des Belegs oder legen Sie eine neue Position an.` })
        continue
      }
  ```
  mit `const labelOf = (key: PeriodKey): string => { const p = periodOfKey(input.rules, key); return p ? periodLabel(p) : key }` (die Variable heißt dort nach PR 2 `target`; sie wird in `item` umbenannt, weil `target` jetzt der Zeitraum ist);
- `closedPeriodNotice(String(startYearOf(t.period)))` → `closedPeriodNotice(labelOf(t.period))`.

Alle Kommentare „Brücke Kalenderjahr (#208): bis PR 3“ in beiden Dateien löschen.

`server/src/db/booking.ts`: Import `rulesOf` aus `'../../../shared/period.ts'`; in `viewOf` und
`openTargets`-Aufrufen sowie in `plannedFor` die Regeln mitgeben:

```ts
    rules: rulesOf(ctx.stock.properties.find((p) => p.id === a.propertyId)),
```

(in `plannedFor` mit `record.assessment.propertyId`).

`server/src/db/assessments.ts`, `placeAssessment`: Import `periodForYear` aus
`'../../../shared/assessment.ts'`, `rulesOf` aus `'../../../shared/period.ts'`, `readProperties`
aus `'./read.ts'`; die Brücke ersetzen:

```ts
  // Der gewählte Zeitraum hängt am Objekt (#208, Prüfbedingung „nur mit Objekt“): ohne Objekt
  // keiner; ein von Hand gesetztes Jahr wählt den Zeitraum dieses Jahres (`periodForYear`), beim
  // Kalenderobjekt also wie bisher den Kalenderzeitraum.
  const rules = rulesOf((await readProperties(db)).find((p) => p.id === propertyId))
  const requestedPeriod = propertyId === null ? null
    : change.year !== undefined ? periodForYear(rules, change.year).key
      : current.assessment.requestedPeriod
```

`server/src/index.ts`, `rememberAssessment`: Importe `periodForYear` aus
`'../../shared/assessment.ts'`, `parsePeriodKey, periodOfKey, rulesOf` aus
`'../../shared/period.ts'`. Hinter `const propertyId = …`:

```ts
      // Der gewählte Zeitraum (#208): bei einer früheren Auswertung deren, sonst der mitgeschickte,
      // wenn es ihn für das Objekt gibt (die Seite, von der aus ausgewertet wurde), sonst der des
      // gewählten Jahres. Beim Kalenderobjekt ist das wie bisher der Kalenderzeitraum.
      const rules = rulesOf(properties.find((p) => p.id === propertyId))
      const sentPeriod = parsePeriodKey(body.period)
      const requestedPeriod = propertyId === null ? null
        : previous ? previous.assessment.requestedPeriod
          : row?.year == null && sentPeriod !== null && periodOfKey(rules, sentPeriod) !== null ? sentPeriod
            : chosen !== null ? periodForYear(rules, chosen).key : null
```

und im Aufruf von `saveAssessment` `requestedPeriod: requestedPeriod,` statt der Zeile mit
`calendarPeriod(chosen)` samt Brückenkommentar.

- [ ] **Step 5: Oberfläche (`client/src/evaluationQueue.ts`, `Schnellerfassung.tsx`, `Kosten.tsx`, `testing/fakeBooking.ts`)**

`client/src/evaluationQueue.ts`: Die Optionen bekommen `period?: string`; neben
`fd.append('year', String(o.year))`:

```ts
        // Der gewählte Zeitraum (#208); der Server nimmt ihn nur, wenn es ihn für das Objekt gibt.
        if (o.period) fd.append('period', o.period)
```

`Schnellerfassung.tsx`: `const { year, key, rules, calendar } = usePeriod()`; die Warteschlange
bekommt `period: key` neben `year`; der Kontext des Schlüssels und das Abzeichen:

```tsx
  const keyCtx = (v: AssessmentView): KeyContext => {
    const target = periodOfKey(rules, v.targetPeriod ?? calendarPeriod(v.year))
    return { items: existingItems, year: v.year, at: target ? periodContext(rules, target) : undefined, propertyKind: property?.kind ?? null }
  }
```

```tsx
            {(v.targetPeriod ?? calendarPeriod(v.year)) !== key && <span className="badge gray">{calendar ? `Jahr ${v.year}` : v.targetLabel ?? `Jahr ${v.year}`}</span>}
```

und `keyContext={keyCtx(v)}`. Dieselben zwei Änderungen in `Kosten.tsx` an der Liste der offenen
Auswertungen (`entry.data.assessment.year !== year` und `keyContext={{ ...keyCtx, year: … }}`).
Importe `calendarPeriod, periodContext, periodOfKey` aus `'../../../shared/period.ts'`.

`client/src/testing/fakeBooking.ts`: den Brückenkommentar ersetzen durch „Die Attrappe kennt nur
Kalenderobjekte; dort ist der gewählte Zeitraum der Kalenderzeitraum des Jahres (#208).“ und in der
erzeugten Auswertung `targetPeriod: calendarPeriod(detected ?? opts.year), targetLabel: String(detected ?? opts.year),`
ergänzen.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix server test -- test/booking-zeitraum.test.ts test/booking.test.ts test/bookingResponse.test.ts test/assessment.test.ts && npm --prefix client test -- booking assessment intake Schnellerfassung && npm run typecheck`
Expected: PASS. Die bisherigen Tests der Belegbuchung bleiben ohne Änderung ihrer Erwartungen grün
(Kalenderobjekt: dieselben Zeiträume, dieselben Sätze).

Run: `grep -rn "Brücke Kalenderjahr" client shared server/src`
Expected: keine Treffer.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared server/src client/src server/test/booking-zeitraum.test.ts
git commit -m "Zeitraum: Belegbuchung bucht in den Abrechnungszeitraum des Objekts, Jahr der Zahlung aus dem Rechnungsdatum

Refs #208"
```

---
### Task 12: F18, Praxislauf 15 und 16, Anleitung, Doku, Gesamtprüfung

F18 ist das Golden-Fixture des Rumpfzeitraums (Entwurf 12.1). Die Fixtures F01–F11 stehen im
Format der db.json und kennen keinen Rhythmus; F18 entsteht deshalb über denselben Weg wie beim
Nutzer (Wechsel mit Vorschau, Aufteilen) in einer Wegwerf-Datenbank, und die Herleitung von Hand
steht in einer README daneben. Die gekürzte CO₂-Tabelle der Erwartung (Entwurf 12.1) prüft PR 6,
wenn es CO₂ gibt; die README sagt das. Der Praxislauf bekommt Fall 15 (Backup mit Rumpf) und Fall 16
(Datenbank von 0.10.1 mit Positionen in fünf Jahren), die Anleitungen „Abrechnungszeitraum Mai bis
April“ (Entwurf 11.4).

**Files:**
- Create: `server/test/fixtures/period/F18-rumpfzeitraum/README.md`, `server/test/period-golden.test.ts`
- Modify: `scripts/umstieg-praxislauf.mjs`, `shared/guides.ts`, `server/test/guides.test.ts`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: alles aus Task 1–11.
- Produces: keine neuen Schnittstellen.

- [ ] **Step 1: F18 (Test und Herleitung)**

`server/test/fixtures/period/F18-rumpfzeitraum/README.md`:

```markdown
# F18 Rumpfzeitraum

Ein Haus mit einer Wohnung (EG, 60 m²), ein Mietverhältnis seit 01.01.2024, Vorauszahlung 200 € im
Monat. Bis 2024 Kalenderjahr; ab Mai 2025 rechnet das Objekt von Mai bis April ab (Wechsel
`2025-05`, Entwurf 3.6). Vor dem Wechsel erfasst, im Zeitraum 2025:

| Position | Kostenart | Betrag | Leistungszeitraum | Schlüssel |
|---|---|---|---|---|
| Grundsteuer 2025 | Grundsteuer | 480,00 € | 01.01.–31.12.2025 | Fläche |
| Müll Januar bis April | Müllabfuhr | 242,19 € | 01.01.–30.04.2025 | Fläche |
| Gas | Heizung und Warmwasser, Brennstoff/Energie | 700,00 € | 01.01.–30.04.2025 | Einzelbeträge (Mieter 700,00 €) |
| Wartung | Heizung und Warmwasser | 200,00 € | 01.01.–31.12.2025 | Einzelbeträge (Mieter 200,00 €) |

Die Müllabfuhr ist so gewählt, dass die kalten Kosten im Rumpf zusammen 400,00 € ergeben wie im
Beispiel des Entwurfs (3.7).

## Herleitung

**Rumpf.** Der Wechsel ab Mai 2025 lässt den Zeitraum `2025-01` am 30.04.2025 enden: 120 Tage, Frist
zwölf Monate nach dem Ende, also 30.04.2026 (§ 556 Abs. 3 Satz 2 BGB). Der nächste Zeitraum `2025-05`
läuft vom 01.05.2025 bis 30.04.2026.

**Grundsteuer nach Tagen** (Leistungsprinzip, Entwurf 3.4): 480,00 € · 120/365 = 157,808… €, 480,00 € ·
245/365 = 322,191… €. Abgerundet 157,80 € und 322,19 € ergeben 479,99 €; der eine Restcent geht an
den größeren Nachkommarest (0,808 gegen 0,191), also 157,81 € in den Rumpf und 322,19 € nach
`2025-05`. Die übrigen Positionen liegen mit ihrem Leistungszeitraum im Rumpf (Müll, Gas) oder sind
Heizkosten, die nicht nach Tagen geteilt werden (Wartung, Entwurf 3.4 G-C1); der Vermieter ordnet sie
in der Vorschau dem Rumpf zu.

**Abrechnung des Rumpfs.** Eine Wohnung, ein Mieter, der den ganzen Rumpf wohnt: Er trägt jede
Position ganz. 157,81 + 242,19 + 700,00 + 200,00 = 1.300,00 €. Vorauszahlungen Januar bis April:
4 · 200,00 € = 800,00 €. Nachzahlung 500,00 €.

**Vorschlag nach § 560 Abs. 4 BGB** (Entwurf 3.7):

- kalt 400,00 € nach Tagen: 400,00 · 365/120 / 12 = 101,39 €
- Brennstoff 700,00 € mit Leistungszeitraum Januar bis April, Gradtage 170 + 150 + 130 + 80 = 530 ‰:
  700,00 / 0,530 / 12 = 110,06 €
- Wartung 200,00 € mit Leistungszeitraum zwölf Monate: Jahresbetrag, 200,00 / 12 = 16,67 €

Zusammen 228,12 €, auf volle Euro **228,00 €**.

**Hinweise:** `period.short` (Rumpf) und `period.heating-mismatch` (die Wartung reicht über den Rumpf
hinaus). Die gekürzte CO₂-Stufentabelle (Grenzen × 120/365, Entwurf 3.6) prüft PR 6.

**Zeitraum 2025/2026:** Grundsteuer 322,19 € mit dem Jahr der Zahlung 2025 (der bisherige Zeitraum
begann 2025).
```

`server/test/period-golden.test.ts`:

```ts
// F18 Rumpfzeitraum (#208, Entwurf 12.1). Herleitung von Hand in
// fixtures/period/F18-rumpfzeitraum/README.md; jede Zahl hier steht dort. Der Bestand entsteht über
// denselben Weg wie beim Nutzer: Positionen anlegen, Zeitraum wechseln mit Vorschau und Antworten.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement } from '../src/calc.ts'
import { openDatabase } from '../src/db/open.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'

test('F18 Rumpfzeitraum: 157,81 / 322,19 €, Frist 30.04.2026, Vorschlag 228 €', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-f18-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'Mieter', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }] })
      const base = { propertyId: 'objekt-1', period: '2025-01' }
      await createEntity(db, 'costItems', 'gs', { ...base, category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
      await createEntity(db, 'costItems', 'mu', { ...base, category: 'Müllabfuhr', description: 'Müll Januar bis April', amountCents: 24219, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })
      await createEntity(db, 'costItems', 'gas', { ...base, category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 70000, key: 'amounts', tenancyAmounts: { t1: 70000 }, heatingPart: 'fuel', serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })
      await createEntity(db, 'costItems', 'wa', { ...base, category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 20000, key: 'amounts', tenancyAmounts: { t1: 20000 }, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    })
    const regeln = { startMonth: 1, changes: ['2025-05'] }
    const vorschau = await opened.read((db) => previewPeriodChange(db, 'objekt-1', regeln, '2026-10-05')) ?? assert.fail('kein Objekt')
    assert.deepEqual(vorschau.groups.map((g) => [g.from, g.items.map((i) => i.costItemId).sort()]), [['2025-01', ['gas', 'wa']]])
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', regeln, { groups: { '2025-01': '2025-01' } }, () => 'gs-2', '2026-10-05'))
    assert.ok(r && 'property' in r, 'gewechselt')

    const stock = await opened.read(readStock)
    const rumpf = periodOfKey(regeln, periodKey('2025-01')) ?? assert.fail('kein Rumpf')
    const s = computeSettlement(snapshotFor(stock, 'objekt-1', rumpf))
    assert.deepEqual([s.period.label, s.deadline, s.daysInYear], ['01.01.–30.04.2025', '2026-04-30', 120])
    const st = s.statements[0] ?? assert.fail('kein Mieter')
    assert.deepEqual(st.rows.map((row) => [row.costItemId, row.shareCents]).sort(), [['gas', 70000], ['gs', 15781], ['mu', 24219], ['wa', 20000]])
    assert.deepEqual([st.totalShareCents, st.prepaymentCents, st.balanceCents, st.suggestedMonthlyCents], [130000, 80000, -50000, 22800])
    assert.deepEqual(s.notices.map((n) => n.code).filter((c) => c.startsWith('period.')).sort(), ['period.heating-mismatch', 'period.short'])
    assert.ok(s.legalBasis.values?.some((v) => v.id === 'hkv.degree-days'), 'die Gradtagstabelle friert mit ein')

    const voll = periodOfKey(regeln, periodKey('2025-05')) ?? assert.fail('kein Zeitraum 2025-05')
    const s2 = computeSettlement(snapshotFor(stock, 'objekt-1', voll))
    assert.deepEqual(s2.statements[0]?.rows.map((row) => [row.costItemId, row.shareCents]), [['gs-2', 32219]])
    assert.equal(stock.costItems.find((c) => c.id === 'gs-2')?.taxYear, 2025)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
```

Run: `npm --prefix server test -- test/period-golden.test.ts`
Expected: PASS (Task 1–6 sind da). Scheitert eine Zahl, ist entweder die Berechnung falsch oder die
Herleitung; die Erwartung wird nie an das Ergebnis angepasst (README des Prüfkatalogs).

- [ ] **Step 2: Praxislauf, Fall 15 und 16 (`scripts/umstieg-praxislauf.mjs`)**

Hinter `bestandHeute`:

```js
// Fünf Jahre Bestand (#208, Praxislauf Fall 16): dieselben Wohnungen, Mietverhältnisse seit 2021,
// je Jahr eine Müllabfuhr und eine Grundsteuer, eine Jahreskorrektur 2023.
const bestandFuenfJahre = () => {
  const b = bestandHeute()
  for (const t of b.tenancies) {
    t.start = '2021-01-01'
    t.personHistory = [{ from: '2021-01-01', persons: t.persons }]
    t.prepayments = [{ from: '2021-01', monthlyCents: t.prepayments[0].monthlyCents }]
  }
  b.tenancies[0].prepaymentOverrides = { 2023: 170000 }
  b.costItems = [2021, 2022, 2023, 2024, 2025].flatMap((year, i) => [
    { id: `m${year}`, year, category: 'Müllabfuhr', description: `Abfallgebühren ${year}`, amountCents: 120000 + i * 3001, key: 'area' },
    { id: `g${year}`, year, category: 'Grundsteuer', description: `Grundsteuer ${year}`, amountCents: 48000 + i * 7, key: 'units' },
  ])
  return b
}
```

Vor dem Abschnitt, der `--nur` liest:

```js
fall(15, 'Backup mit abweichendem Zeitraum und Rumpf (#208)', async () => {
  // Die eigene Heizperiode (Entwurf 5.9) kommt mit PR 5 dazu; hier der Zeitraum des Objekts.
  const dataDir = tempDir()
  const regeln = { startMonth: 1, changes: ['2025-05'] }
  const senden = (base, pfad, method, body) => fetch(`${base}${pfad}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const pruefen = async (base, name) => {
    const [o] = await holen(base, '/api/properties')
    gleich(o?.periodRules, regeln, `${name}: der Rhythmus ist da`)
    const kosten = (await holen(base, '/api/costItems')).map((c) => [c.period, c.amountCents]).sort()
    gleich(kosten, [['2025-01', 15781], ['2025-05', 32219]], `${name}: die Grundsteuer ist nach Tagen aufgeteilt`)
    const rumpf = await holen(base, '/api/settlement/2025-01')
    gleich([rumpf.period?.label, rumpf.deadline, rumpf.statements?.[0]?.prepaymentCents], ['01.01.–30.04.2025', '2026-04-30', 70000], `${name}: der Rumpf rechnet mit der neu erfassten Jahreskorrektur`)
    gleich((await fetch(`${base}/api/settlement/2025`)).status, 404, `${name}: die nackte Jahreszahl gibt es für dieses Objekt nicht`)
  }
  await withServer(dataDir, async ({ base }) => {
    const unit = await jsonOf(await senden(base, '/api/units', 'POST', { name: 'EG', areaM2: 60, participates: true }))
    const mieter = await jsonOf(await senden(base, '/api/tenancies', 'POST', {
      unitId: unit.id, tenantName: 'Müller', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: { '2025-01': 220000 },
    }))
    await senden(base, '/api/costItems', 'POST', { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
    const [objekt] = await holen(base, '/api/properties')
    const vorschau = await jsonOf(await senden(base, `/api/properties/${objekt.id}/period/preview`, 'POST', { rules: regeln }))
    gleich(vorschau.newShort?.map((p) => p.label), ['01.01.–30.04.2025'], 'Wechsel: die Vorschau nennt den Rumpf')
    const ohne = await senden(base, `/api/properties/${objekt.id}/period`, 'PUT', { rules: regeln })
    gleich(ohne.status, 409, 'Wechsel: ohne die neu erfasste Jahreskorrektur wird nicht gespeichert')
    const mit = await senden(base, `/api/properties/${objekt.id}/period`, 'PUT', { rules: regeln, answers: { overrides: { [mieter.id]: { '2025-01': 70000, '2025-05': null } } } })
    gleich(mit.status, 200, 'Wechsel: mit Antworten gespeichert')
    await pruefen(base, 'vor dem Backup')
    const zip = await backupHolen(base)
    await senden(base, '/api/units', 'POST', { name: 'Nach dem Backup', areaM2: 10, participates: true })
    gleich((await holen(base, '/api/units')).length, 2, 'Wiederherstellen: vorher sind es zwei Wohnungen')
    const antwort = await backupEinspielen(base, zip)
    gleich(antwort.status, 200, 'Wiederherstellen: die Route nimmt das Archiv an')
    gleich((await holen(base, '/api/units')).length, 1, 'Wiederherstellen: der Stand des Archivs gilt')
    await pruefen(base, 'nach dem Wiederherstellen')
  })
  await withServer(dataDir, async ({ base }) => {
    await pruefen(base, 'nach dem Neustart')
  })
})

fall(16, 'Datenbank von 0.10.1 mit Kostenpositionen in fünf Jahren, Update auf Zeiträume (#208)', async () => {
  // Der Weg der meisten Nutzer nach diesem Release: Die Datenbank steht auf 0013, und die neue
  // Version zieht `year` auf `period` um (0014/0015) und legt die Spalten aus 0016/0017 an. Jede
  // Zahl muss bleiben, wie die Berechnung sie vorher ergab.
  const { applyMigrations, connect, loadMigrations } = await import('../server/src/db/client.ts')
  const { migrateLegacy, straightenForDatabase } = await import('../server/src/legacy/migrate.ts')
  const { writeStock } = await import('../server/src/legacy/write.ts')
  const { computeSettlement } = await import('../server/src/calc.ts')
  const { snapshotFromDb } = await import('../server/src/snapshot.ts')
  const dataDir = tempDir()
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  const migrations = await loadMigrations()
  const bis = migrations.findIndex((m) => m.tag === '0014_zeitraum')
  if (bis < 0) return fail('Schritt 0014_zeitraum fehlt')
  applyMigrations(connection, migrations.slice(0, 1))
  const gerade = straightenForDatabase(migrateLegacy(/** @type {any} */ (bestandFuenfJahre())))
  await writeStock(connection.db, gerade)
  applyMigrations(connection, migrations.slice(0, bis))
  connection.close()

  const jahre = [2021, 2022, 2023, 2024, 2025]
  const zeilen = (s) => (s.statements ?? []).map((st) => [st.tenancyId, st.totalShareCents, st.prepaymentCents, st.balanceCents]).sort()
  const vorher = Object.fromEntries(jahre.map((y) => [y, zeilen(computeSettlement(snapshotFromDb(gerade, y)))]))
  await withServer(dataDir, async ({ base }) => {
    const kosten = await holen(base, '/api/costItems')
    gleich([...new Set(kosten.map((c) => c.period))].sort(), jahre.map((y) => `${y}-01`), 'Update: jede Position trägt den Kalenderzeitraum ihres Jahres')
    gleich(kosten.every((c) => c.year === Number(String(c.period).slice(0, 4))), true, 'Update: ein Tab von vor dem Update liest weiter das Jahr')
    for (const y of jahre) {
      const s = await holen(base, `/api/settlement/${y}`)
      gleich(zeilen(s), vorher[y], `Update: Abrechnung ${y} auf den Cent wie vorher`)
      gleich([s.period?.key, s.deadline], [`${y}-01`, `${y + 1}-12-31`], `Update: Abrechnung ${y} mit Zeitraum und Frist`)
    }
    const mieter = await holen(base, '/api/tenancies')
    gleich(mieter.find((t) => t.id === 't1')?.prepaymentOverrides, { '2023-01': 170000 }, 'Update: die Jahreskorrektur steht unter ihrem Zeitraum')
  })
  dateienImOrdner(dataDir, 'Update', { 'mietfuchs.sqlite.vor-0014_zeitraum': true })
})
```

Run: `node scripts/umstieg-praxislauf.mjs --nur 15 && node scripts/umstieg-praxislauf.mjs --nur 16`
Expected: je Fall nur Zeilen mit „✓“ und am Ende „Alle Prüfungen bestanden.“

- [ ] **Step 3: Anleitung „Abrechnungszeitraum Mai bis April“ (`shared/guides.ts`)**

In `GUIDE_DATA` hinter `tenantChange`:

```ts
  // #208: Abrechnungszeitraum, der vom Kalenderjahr abweicht (Entwurf 11.4).
  periodMayApril: {
    title: 'Abrechnungszeitraum Mai bis April',
    applies: 'Ihr Messdienst rechnet die Heizkosten von Mai bis April ab, oder Ihr Mietvertrag nennt einen anderen Abrechnungszeitraum als das Kalenderjahr.',
    steps: [
      { page: 'stammdaten', text: 'Öffnen Sie in den Stammdaten die Karte „Abrechnungszeitraum“. Wählen Sie unter „Was möchten Sie ändern?“ den „Wechsel ab einem Monat“, tragen Sie den Monat ein, ab dem neu abgerechnet wird, und klicken Sie auf „Vorschau“.' },
      { page: 'stammdaten', text: 'Die Vorschau zeigt den Rumpfzeitraum davor und was mit Ihren Rechnungen und Vorauszahlungen geschieht. Tragen Sie für jede Jahreskorrektur ein, was tatsächlich gezahlt wurde, oder setzen Sie den Haken „keine Korrektur (die Staffel gilt)“. Mit „Zeitraum wechseln“ wird alles gespeichert.' },
      { page: 'kosten', text: 'Eine Rechnung für ein Kalenderjahr, etwa die Grundsteuer, erfassen Sie mit ihrem Leistungszeitraum unter „Weitere Angaben“. Mietfuchs teilt sie beim Speichern nach Tagen auf die beiden Abrechnungszeiträume auf („Aufteilen und speichern“).' },
      { page: 'kosten', text: 'Reicht der Abrechnungszeitraum über zwei Kalenderjahre, fragt das Formular nach dem „Jahr der Zahlung (Steuer)“.' },
    ],
    result: [
      'Vor dem Wechsel entsteht ein Rumpfzeitraum. Seine Abrechnung muss zwölf Monate nach seinem Ende zugehen.',
      'Im Rumpfzeitraum rechnet der Vorschlag für die neue Vorauszahlung kalte Kosten nach Tagen hoch und Brennstoff nach Gradtagen, wenn die Brennstoffrechnung als „Brennstoff/Energie“ gekennzeichnet ist und einen Leistungszeitraum hat.',
      'Mietkonto und Steuer bleiben beim Kalenderjahr; die Steuerübersicht nimmt die Eigenanteile aus den Abrechnungen, die das Jahr berühren.',
    ],
    example: 'Umstellung ab Mai 2025: Der Rumpfzeitraum läuft vom 01.01. bis 30.04.2025 und muss bis 30.04.2026 abgerechnet sein. Die Grundsteuer 2025 über 480,00 € teilt Mietfuchs in 157,81 € für den Rumpf und 322,19 € für 2025/2026.',
    caveats: [
      { text: 'Eine Verkürzung des Abrechnungszeitraums braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter. Länger als zwölf Monate darf kein Zeitraum sein.', norm: '§ 556 Abs. 3 Satz 1 BGB' },
      { text: 'Heizkosten müssen den Verbrauch im Abrechnungszeitraum abbilden; eine Gasrechnung über einen anderen Zeitraum teilt Mietfuchs nicht nach Tagen auf, sondern weist darauf hin.', norm: 'BGH, Urteil vom 01.02.2012, VIII ZR 156/11' },
    ],
    gaps: [
      { text: 'Eine eigene Heizperiode neben dem Abrechnungszeitraum des Objekts und eine getrennte Heizkostenabrechnung.', issue: 217 },
    ],
    terms: ['billingPeriod', 'shortPeriod', 'accrualPrinciple'],
  },
```

`server/test/guides.test.ts`: im ersten Test die Liste der Kennungen um `'periodMayApril'` am Ende
ergänzen (Testname „die acht Vermietungsarten aus #164“ → „die Vermietungsarten aus #164 und der
Abrechnungszeitraum (#208)“), und anhängen:

```ts
test('Abrechnungszeitraum Mai bis April (#208): das Beispiel rechnet die Aufteilung nach', async () => {
  const { splitByService } = await import('../src/serviceSplit.ts')
  const parts = splitByService({ startMonth: 1, changes: ['2025-05'] }, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  const euro = (c: number) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })
  for (const p of parts) assert.match(GUIDES.periodMayApril.example, new RegExp(`${euro(p.amountCents).replace('.', '\\.')} €`))
  assert.deepEqual(parts.map((p) => p.amountCents), [15781, 32219])
})
```

Run: `npm --prefix server test -- test/guides.test.ts`
Expected: PASS; der Wächter über die Bedienangaben findet „Abrechnungszeitraum“, „Was möchten Sie
ändern?“, „Wechsel ab einem Monat“, „Vorschau“, „keine Korrektur (die Staffel gilt)“, „Zeitraum
wechseln“, „Weitere Angaben“, „Aufteilen und speichern“, „Jahr der Zahlung (Steuer)“ und
„Brennstoff/Energie“ im Quelltext (Task 9, 10).

- [ ] **Step 4: CHANGELOG**

`CHANGELOG.md`, unter „Unveröffentlicht“, Abschnitt „Hinzugefügt“:

```markdown
- Abrechnungszeitraum wählbar: In den Stammdaten stellen Sie unter „Abrechnungszeitraum“ ein, ob ein Objekt im Kalenderjahr oder etwa von Mai bis April abrechnet. Ein Wechsel zeigt vorher, was geschieht: den Rumpfzeitraum davor, welche Rechnungen nach Tagen aufgeteilt werden, und er fragt die tatsächlich gezahlten Vorauszahlungen neu ab, wo eine Jahreskorrektur nicht mehr passt. Abgeschlossene Abrechnungen bleiben unangetastet. Rechnungen tragen auf Wunsch ihren Leistungszeitraum; kalte Betriebskosten über zwei Abrechnungszeiträume teilt Mietfuchs beim Speichern nach Tagen auf, Heizkosten nicht. Reicht ein Zeitraum über zwei Kalenderjahre, fragt das Formular nach dem Jahr der Zahlung, und die Steuerübersicht bleibt beim Kalenderjahr. Im Rumpfzeitraum gibt es wieder einen Vorschlag für die neue Vorauszahlung, Brennstoff nach Gradtagen. Wer im Kalenderjahr abrechnet, merkt davon nichts ([#208](https://github.com/speedone/mietfuchs/issues/208)).
```

- [ ] **Step 5: CLAUDE.md**

Im Abschnitt „**Abrechnungszeitraum** (#208, Kern)“ (PR 2, Task 7) den letzten Satz ab
„**Bedienung fehlt noch** …“ ersetzen durch:

```markdown
**Bedienung** (PR 3): Den Rhythmus ändert nur der Wechsel mit Vorschau
([server/src/db/periodChange.ts](server/src/db/periodChange.ts), `POST /api/properties/:id/period/preview`
und `PUT …/period`); er bekommt die ganzen neuen Regeln und vergleicht sie mit den alten. Ein
abgeschlossener Zeitraum, der sich änderte, sperrt (409); Jahreskorrekturen werden neu erfasst, wenn
ein Mietverhältnis danach Monate in mehr als einem oder einem anders geschnittenen Zeitraum hat
(eine gezahlte Summe lässt sich nicht verteilen), ohne Antwort wird nicht gespeichert. **Kalte
Rechnungen mit Leistungszeitraum über zwei Zeiträume werden beim Speichern nach Tagen aufgeteilt**
([server/src/serviceSplit.ts](server/src/serviceSplit.ts), Leistungsprinzip); jeder Teil trägt den
ganzen Leistungszeitraum, daran erkennt die Abrechnung ihn. Heizkosten nie (VIII ZR 156/11), dort
warnt `period.heating-mismatch`. `tax_year` ist das Jahr der Zahlung, Pflicht nur bei einem
Zeitraum über zwei Kalenderjahre; die Steuerübersicht eines solchen Objekts schöpft aus allen
Abrechnungen, die das Jahr berühren (`taxPartsFor` in calc.ts). **Der Vorschlag nach § 560 im
Rumpf** rechnet je Position einen Jahresfaktor ([server/src/prepaymentSuggestion.ts](server/src/prepaymentSuggestion.ts)):
kalt nach Tagen, Brennstoff (`heating_part = 'fuel'`) nach Gradtagen aus `hkv.degree-days` über die
Vereinigung der Leistungszeiträume, feste Heizpositionen nach den Tagen ihres Leistungszeitraums;
fehlt für den Brennstoff ein Faktor, gibt es keinen Vorschlag. Die Oberfläche hält einen **Tag** und
keinen Schlüssel ([client/src/period.tsx](client/src/period.tsx), Logik in
[client/src/periodForm.ts](client/src/periodForm.ts)): Der Zeitraum ist der, der ihn enthält, so
passt ein Objektwechsel ihn von selbst an. Beim Kalenderobjekt heißt der Umschalter weiter
„Abrechnungsjahr“, seine Werte sind Jahreszahlen und die Routen bekommen die Jahreszahl; Mietkonto
und Steuer haben bei abweichendem Zeitraum einen eigenen Kalenderjahr-Umschalter. Die Belegbuchung
bucht in `bookingPeriod` (shared/assessment.ts): den gewählten Zeitraum, wenn er das Jahr des Belegs
berührt, sonst den mit der größten Überschneidung.
```

- [ ] **Step 6: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle bestanden, auch 15 und 16.

Run: `grep -rn "Brücke Kalenderjahr" client shared server/src | wc -l`
Expected: `0`.

Run: `git diff --stat origin/main -- server/test/fixtures/settlement`
Expected: keine Ausgabe (Golden wortgleich).

- [ ] **Step 7: Commit**

```bash
git add server/test/fixtures/period server/test/period-golden.test.ts scripts/umstieg-praxislauf.mjs shared/guides.ts server/test/guides.test.ts CHANGELOG.md CLAUDE.md
git commit -m "Zeitraum: F18 Rumpfzeitraum, Praxislauf 15 und 16, Anleitung Mai bis April, Doku

Refs #208"
```

- [ ] **Step 8: Durchsicht und PR**

Durchsicht mit frischem Kontext über den Zweig gegen den Stand von PR 2 (CLAUDE.md „Durchsicht vor
jedem PR“), mit den fünf Punkten aus „Review Focus“ als Schwerpunkt. Jeder Befund bekommt einen Test,
der vorher rot war. PR gegen den PR-2-Zweig (nach dessen Merge gegen `main`) mit `Refs #208` (nicht
`Fixes`), den Befunden der Durchsicht und der Liste der beseitigten Brücken (aus dem Abschnitt
„Schnittstellen aus PR 1 und PR 2“) in der Beschreibung. Vor dem Merge des Stapels PR 1–3 die
Integrationsdurchsicht (Geld und Daten), Praxislauf und das Label `full-check` an der obersten PR.

---
## Selbstprüfung

**Abdeckung des Entwurfs (13, PR 3, mit 0.6–0.11):**

| Anforderung | Task |
|---|---|
| Beginnmonat und Wechsel mit Vorschau schrumpfender Schlüssel (3.6, G-A1) | 4, 10 |
| Jahreskorrekturen in der Vorschau neu erfasst, ohne Antwort 409 (N4), Testfall 2.200 € ≠ Soll | 4 |
| Abgeschlossene Zeiträume unantastbar (409); frühere Abschlüsse eines entfallenden Zeitraums | 4 |
| `assessments.requested_period` in der Vorschau aufgeführt und neu zugeordnet (3.6) | 4 |
| Rumpf mit Hinweis `period.short` (hint, färbt nicht) | 5 |
| Leistungszeitraum `service_from`/`service_to` (5.1) | 2, 9 |
| Aufteilen nur kalter Kosten, tagesgenau, Restcent nach Kennung, §35a im Verhältnis, Beleg an beiden, Vorschau, 409 bei Abschluss, nie Heizung (3.4, G-C1) | 3, 9 |
| `period.item-outside`, `period.heating-mismatch`, `period.split-by-days-meter` (3.4, Z-B11) | 5 |
| Jahr der Zahlung `tax_year`, Pflicht nur über zwei Kalenderjahre, Satz zu § 11 Abs. 2 EStG (3.10) | 2, 9, 11 |
| Steuer über zwei Abrechnungen, `prepaymentSettlementCents` `null`, Eigenanteil aus der Abrechnung der Position (3.10) | 7 |
| `PeriodProvider` mit Zeitraum und Kalenderjahr; Mietkonto und Steuer im Kalenderjahr (11.4, 3.11) | 8 |
| Satz im Mietkonto „Die Abrechnung 2025/2026 umfasst Mai 2025 bis April 2026“ (3.11) | 8 |
| Cockpit mit Bezeichnung des Zeitraums, Frist vom Server (11.4) | 8 |
| `hkv.degree-days` im Register mit Zeile in `law-history` (4.3, N3) | 1 |
| `cost_items.heating_part` schmal, Oberfläche nur „Brennstoff/Energie“ (A1) | 2, 9 |
| § 560 im Rumpf: Brennstoff mit Leistungszeitraum nach Gradtagen der Vereinigung (C5, D3), Lieferung nach letzter voller Periode sonst kein Vorschlag (B4), kein Vorschlag für den Heizanteil mit zwei Texten (R10, R11), kalt nach Tagen, feste Positionen nach Tagen ihres Leistungszeitraums, gleichartige über die Vereinigung (A11, D3 der achten Fassung) | 6 |
| Testfälle 228 / 262 / 100 €, 200 €, 110,06 €, 30,42 €, R11, B4, A1 (12.2) | 6 |
| Lexikon `billingPeriod`, `shortPeriod`, `accrualPrinciple`, `degreeDays` (10.3) | 5 |
| F18 (12.1) | 12 |
| Praxislauf Fall 15 und 16 (5.9) | 12 |
| Anleitung „Abrechnungszeitraum Mai–April“ (11.4) | 12 |
| Invariante 12.3 Nr. 10 (jede Position genau einmal in den Werbungskosten) | 7 |
| Brücken aus PR 2 beseitigt | 8, 11, 12 (Prüfung) |
| Golden unverändert, wer nichts einstellt merkt nichts | Global Constraints; Gleichheitstest PR 2; Tests in 2, 5, 7, 8 |
| Gekürzte CO₂-Tabelle in F18, `heating_periods`, CO₂-Datensätze in der Vorschau, eigene Heizperiode, Weg d | bewusst später (PR 4–7), in F18 und Fall 15 benannt |

**Platzhalter:** Die beiden Marken in Task 2 Step 6 sind Ausgaben eines Befehls, der davor steht;
sie hängen am erzeugten Inhalt (wie in PR 2). Wo ein Code-Ausschnitt „… unverändert“ sagt, ändert er
nur die gezeigten Zeilen einer bestehenden Funktion. Die Tabellen in Task 8 und 11 nennen je Stelle
das, was dort nach PR 2 steht, und das, was daraus wird; der Übersetzer findet jede vergessene Stelle,
weil sich Signaturen ändern (`KeyContext`, `buildCostItemBody`, `missingAreaCheck`, `PlanInput`,
`DescribeContext`). Sonst keine.

**Typen über die Tasks:** `writeCostItemParts(tx, base, parts: PartWrite[], newId, keepId)` (Task 3)
nutzt Task 4 mit denselben Feldern. `splitByService(rules, item)` liefert `ServicePart` mit `period:
BillingPeriod` (Task 3, 4, 12). `annualFactors(period, items, previous, degreeDays: () =>
DegreeDayTable)` (Task 6) nimmt die Tabelle als Funktion, damit `law()` nur bei Bedarf protokolliert.
`previewPeriodChange(db, propertyId, rawRules, today)` und `applyPeriodChange(db, propertyId,
rawRules, rawAnswers, newId, today)` (Task 4) rufen Task 10 über die Routen und Task 12 direkt.
`PeriodView` (Task 8) trägt `param`, `key`, `label`, `at`, `period`, `year`, `calendarYear`; Task 9
bis 11 benutzen dieselben Namen. `KeyContext.at` ist optional (Task 8) und wird in Task 11 gesetzt.
`CostItemDraft`/`CostItemBody` tragen ab Task 9 `serviceFrom`, `serviceTo`, `taxYear`,
`heatingPart`; Task 11 setzt `taxYear` über `lineDraft(…, { …, taxYear })`. `TaxReport.income.
prepaymentSettlementCents` ist ab Task 7 `number | null`.

**Review Focus:** Alle fünf Punkte haben einen Test in der genannten Aufgabe: Abschluss neben dem
Wechsel (Task 4), Gutschrift über zwei Zeiträume (Task 3), veraltete oder unvollständige Antworten
(Task 4), Kalenderobjekt mit Leistungszeitraum im Jahr (Task 2, 5, 7, 8), Schaltjahr im Rumpf
(Task 1, 6).

**Ausführung:** Die Aufgaben bauen aufeinander auf (Task 3 braucht Task 2, Task 4 braucht Task 3,
Task 6 braucht Task 1 und 2, Task 9–11 brauchen Task 8); in dieser Reihenfolge ausführen. PR 3 beginnt
erst, wenn PR 2 Task 7 auf seinem Zweig steht.
