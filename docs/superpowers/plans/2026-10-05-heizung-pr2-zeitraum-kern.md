# Heizung PR 2: Zeitraum, Kern (#208) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrechnungszeiträume werden im Datenmodell, in der Datenbank und in der Berechnung als
eigener Schlüssel `JJJJ-MM` geführt statt als Kalenderjahr, ohne dass sich für ein Objekt im
Kalenderjahr eine einzige Zahl oder ein einziger Hinweistext ändert.

**Architecture:** `shared/period.ts` berechnet aus Beginnmonat und Wechseln lückenlose Zeiträume
von höchstens zwölf Monaten; ihr Schlüssel ist der Markentyp `PeriodKey` (`'JJJJ-MM'`, Monat des
Beginns). Zwei erzeugte Migrationen ziehen `year` auf `period` um (0014: Spalten und Daten, 0015:
Pflicht, Prüfbedingungen, Indizes) und legen den Rhythmus am Objekt an
(`properties.period_start_month`, `period_changes`). Der Schnappschuss trägt den Zeitraum P,
`computeSettlement` rechnet über dessen Grenzen, Tage und Monate; das Mietkonto bleibt Kalenderjahr,
beide teilen sich die Monatsrechnung `ledgerRows`. Die Routen nehmen `JJJJ-MM`, eine nackte
Jahreszahl gilt nur bei einem reinen Kalenderobjekt. **Bedienung kommt mit PR 3:** In PR 2 gibt es
keinen Weg über die Oberfläche oder die API, einen Rhythmus zu setzen oder zu wechseln; die
Oberfläche bleibt beim Kalenderjahr und übersetzt an markierten Brücken.

**Tech Stack:** Node 24 (TypeScript ohne Build, Typen werden abgestreift), Express 5, Drizzle ORM
0.45 über `sqlite-proxy`, drizzle-kit 0.31, `node:test`, React 19 + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-heizung-gesamt-design.md` (geschrieben gegen die dritte
Fassung; die vierte bis achte ändern PR 2 laut 0.7 bis 0.11 nicht), maßgeblich
3.0, 3.6–3.8, 5.1, 5.2, 5.7–5.9, 6.1 (Schritte 1, 3, 5), 12.1, 12.3 (Nr. 3, 6, 11, 12), 12.4 und 13
(PR 2). Für die Liste der Engine-Stellen ist der abgelöste Teilentwurf
`feat/abrechnungszeitraum:docs/superpowers/specs/2026-10-05-abrechnungszeitraum-design.md`
Abschnitt 4.2/4.3 die Fundstelle; er gilt nicht mehr, wo er dem Gesamtentwurf widerspricht
(dort Zahlenschlüssel `202505`, hier Text `'2025-05'`).

## Global Constraints

- **Golden wortgleich:** Unter `server/test/fixtures/settlement/` ändert sich keine Datei;
  `settlement-golden.test.ts`, `db-golden.test.ts` und `db-objekte.test.ts` bleiben grün ohne
  Anpassung ihrer Erwartungen.
- **Wer nichts einstellt, merkt nichts:** Jedes Objekt hat Beginnmonat 1 und keine Wechsel. Jede
  Zahl und jeder Text einer Abrechnung, eines Mietkontos, einer Steuer- und Verbrauchsübersicht
  bleibt gleich (Gleichheitstest in Task 5).
- **Steuer und Mietkonto bleiben Kalenderjahr als Zahl:** `/api/taxreport/:year`,
  `/api/receipts/tax/:year`, `/api/rentledger/:year`. Die Steuerübersicht eines Objekts mit
  abweichendem Zeitraum lehnt der Server mit 400 und dem Satz „Die Steuerübersicht für ein Objekt
  mit abweichendem Abrechnungszeitraum kommt mit einer späteren Version.“ ab.
- **Kalenderjahre bleiben:** `uploads.year`, `assessments.year`, `assessments.detected_year`.
  Nur `assessments.requested_year` wird `requested_period`, und zwar nur mit Objekt (G-B7).
- **`PeriodKey` = `'JJJJ-MM'`**, Monat des Beginns, Markentyp über `string`. Aus Text wird er nur in
  `shared/period.ts` (`as PeriodKey` steht nirgends sonst; Wächtertest in Task 1).
- **Prüfbedingung wörtlich:**
  `"<spalte>" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("<spalte>", 6, 2) AS INTEGER) BETWEEN 1 AND 12`.
- **Migrationen:** Aufbau nur mit `npm --prefix server run db:generate -- --name <name>`. Daten
  nur an 0014 angehängt (Muster 0001/0002 in `server/drizzle/README.md`). Neue Spalten und neue
  Bedingungen nie im selben Schritt. Namen: `0014_zeitraum`, `0015_zeitraum_pflicht`. Die Marken
  beider Schritte kommen in `server/test/migrations.test.ts`.
- **Eingefrorener Eingang:** `server/src/legacy/{schema,write,migrate}.ts` bleiben unverändert
  (Prüfsumme in `legacy-schema.test.ts`). `legacy/read.ts` darf und muss sich ändern (G-C9).
- **Validator der db.json bleibt vierstellig** (`legacy/validate.ts` unverändert).
- **Sprache:** Bezeichner englisch; Kommentare, Meldungen, Testnamen deutsch; Nutzertexte siezen.
- **Server-Importe** tragen `.ts`; reine Typimporte als `import type`; kein `enum`, kein
  `namespace` (`erasableSyntaxOnly`).
- **Wer einen Server startet**, setzt `NKA_DATA_DIR` (Wegwerf-Ordner), `CI=1` und `NKA_UPDATE_URL`
  (geschlossener Port); in api.test.ts erledigen das `startServer`/`startServerIn`.
- **Brücken zum Kalenderjahr** in Oberfläche und Belegbuchung tragen den Kommentar
  `// Brücke Kalenderjahr (#208): bis PR 3`. PR 3 findet sie mit
  `grep -rn "Brücke Kalenderjahr" client shared server/src`.
- **Commit nur bei Grün:** `npm test` und `npm run typecheck` müssen mit Exit-Status 0 enden (nicht
  hinter `grep` prüfen). Jede Commit-Nachricht ist deutsch, endet mit `Refs #208` und den
  Attribution-Zeilen der ausführenden Sitzung.
- **Rechtswerte:** Die zwölf Monate aus § 556 Abs. 3 BGB stehen bis zum Merge von PR 1 als zwei
  Konstanten nur in `shared/period.ts`; Task 7 holt sie als `bgb.max-period-months` und
  `bgb.deadline-months` (Entwurf 4.3, Zeitregel `periodStart`) aus dem Register. Datumsliterale in
  den Dateien der Berechnung sind nach PR 1 verboten (`law-literals.test.ts`); PR 2 schreibt keine.
- **Arbeitszweig:** `feat/zeitraum-kern` von `feat/heizung`; nach dem Merge von PR 1 auf `main`
  umgestellt (Task 7).

## Überschneidungen mit PR 1 (Rechtsregister)

Grundlage ist der Plan von PR 1 (`docs/superpowers/plans/2026-10-05-heizung-pr1-rechtsregister.md`
auf `feat/heizung`). PR 1 wird zuerst gemergt. PR 2 vermeidet die Zeilen, die PR 1 umschreibt; wo
das nicht geht, steht hier die Auflösung. Task 7 setzt sie beim Umstellen auf `main` um und bringt
die beiden Parameter, die der Entwurf (4.3) PR 2 zuweist, ins Register.

| Datei | PR 1 ändert (Task im PR-1-Plan) | PR 2 ändert (Task) | Auflösung |
|---|---|---|---|
| `server/src/calc.ts` | Importe aus `shared/law/` (3, 4); hinter `const yTo` die Zeilen `lawLog` und `lawPeriod` (4); Leerstand über `practice.vacancy-persons` (4); Kabelblock über `law(betrkvTvSignal, …)` mit `year >= tvNewYear` und `Für ${year}` (4); Fernablesung (4); `legalBasis.values` im Ergebnis (4) | Kopf von `computeSettlement` (5), Texte mit Jahreszahl (4, 5), `ledgerRows` (5), Ergebnisfelder `period`/`deadline` (5), Kabelblock (7) | Kopf: die vier Zeilen von PR 2 (`period`, `diy`, `yFrom`, `yTo` aus P) und danach `lawLog`/`lawPeriod` von PR 1; `lawPeriod` spannt damit P. Kabel: die Fassung von PR 1 behalten und in Task 7 auf den Zeitraum umstellen. Übrige Blöcke getrennt, beide behalten. |
| `server/src/settlementDiff.ts` | Typ `Current`, `valueChanges` (7) | Parameter `year` → `deadline` (6) | Fassung von PR 1 nehmen, darin `year: number` durch `deadline: string` ersetzen und die Zeile `const deadline = …` löschen. |
| `server/src/store.ts` | `StoredSettlement` für `legalBasis.values` (7) | `StoredSettlement` mit `period`/`deadline` (5), `LegacyCostItem` (4) | Beide Ergänzungen der `Omit`-Liste und der optionalen Felder behalten. |
| `shared/types.ts` | `LawValue`, `AppliedValue`, `LegalBasis.values` (2), `LawValueChange`, `SettlementComparison.valueChanges` (7) | `CostItem`, `Property`, `Tenancy`, `StoredAssessment` (2, 4), `Settlement` (5), Abschnitt am Dateiende (1) | Verschiedene Blöcke; `Settlement` steht direkt unter `LegalBasis`: beide Änderungen übernehmen. |
| `client/src/pages/Cockpit.tsx` | Importe, Text der 15 % (6) | Importe, Kennzahlen (4), Frist (6) | Beide Importzeilen behalten. |
| `client/src/pages/Abrechnung.tsx` | Anzeige der Rechtswerte und Wertänderungen (7) | Jahreskorrektur (2), Filter nach Zeitraum (4), Frist (6) | Verschiedene Stellen, beide behalten. |
| `server/test/api.test.ts` | Import `LAW_AS_OF` (3), Rechtswerte (4, 7) | Helfer `closedOf` und `requestedPeriod` (2), neue Tests am Ende (4, 6) | Beide behalten. |
| `server/test/settlement-diff.test.ts` | neue Tests zu `valueChanges` mit `compareWithFrozen(…, 2025, …)` (7) | drittes Argument wird Frist (6) | Nach dem Rebase den Umschreiber aus Task 6 Step 4 noch einmal laufen lassen. |
| `server/test/calc-leerstand-personen.test.ts`, `calc-notices.test.ts`, `rechtsdurchsicht-2026.test.ts`, `rechtstexte.test.ts` | Erwartungen und Importe auf das Register (3, 4) | Kostenpositionen `year` → `period` (4), `compareWithFrozen` (6) | Beide behalten; nach dem Rebase die Umschreiber aus Task 4 Step 9 und Task 6 Step 4 noch einmal laufen lassen. |
| `server/test/calc-rechtswerte.test.ts`, `law-history.test.ts`, `law-literals.test.ts`, `shared/law/bgb-betrkv.ts`, `shared/law/params.ts` | neu (3, 4, 6) | Task 7: zwei Parameter, Zeilen der Historie, `shared/period.ts` in `ENGINE_FILES`, `bgb.*` aus der Liste „keine Rechtswerte“ | Nach dem Merge von PR 1, in Task 7. |
| `CHANGELOG.md`, `CLAUDE.md` | eigene Einträge (8) | eigene Einträge (7) | Beide behalten. |

`server/src/rules.ts` verschiebt PR 1 nach `shared/law/rules.ts`; PR 2 fasst die Datei nicht an.
PR 1 legt keine Migration an; sollte es doch eine geben, verschieben sich die Nummern von PR 2, und
beide Schritte werden **vor dem ersten Push** neu erzeugt (README „solange ein Schritt die
Arbeitskopie nicht verlassen hat“).

## Review Focus

1. **Ein Tab von vor dem Update** schickt beim Anlegen einer Kostenposition `year` statt `period`,
   bei der Jahreskorrektur den Schlüssel `"2025"` und liest `item.year` aus der Liste. Bei einem
   Kalenderobjekt muss er unverändert arbeiten (sonst sieht der Vermieter eine leere Kostenliste und
   erfasst alles doppelt); bei einem Objekt mit anderem Rhythmus muss der Server ablehnen, statt die
   Eingabe still in einen Rumpf zu schreiben. Tests in Task 3 (Schreiben), Task 4 (Liste beim Kalenderobjekt) und Task 6 (Objekt Mai–April über HTTP).
2. **Ein Objekt mit einer Auswertung löschen oder eine Auswertung vom Objekt lösen.** Die Fremdschlüssel
   setzen `property_id` auf NULL, und die neue Prüfbedingung „gewählter Zeitraum nur mit Objekt“
   ließe das Löschen sonst mit einem Datenbankfehler scheitern. Tests in Task 2 (lösen) und Task 3
   (löschen).
3. **Datenbank von 0.10.1** mit Kostenpositionen über mehrere Jahre, Jahreskorrekturen,
   abgeschlossenen und wiedergeöffneten Abrechnungen und Auswertungen mit und ohne Objekt: Die Kette
   läuft, `year` ist weg, jeder Schlüssel ist `JJJJ-01`, und jede Zahl bleibt gleich. Test in Task 2;
   die Zahlen hält `db-objekte.test.ts` fest.
4. **Ein Archiv mit einem Schlüssel, den es für sein Objekt nicht gibt** (von Hand bearbeitet, oder
   Beginnmonat geändert, ohne die Positionen umzuschlüsseln): Das Wiederherstellen lehnt ab, bevor
   etwas ersetzt wird. Test in Task 3.
5. **Rumpf- und Schaltjahrzeitraum in der Berechnung:** Tage, Personentage, Vorauszahlungsmonate und
   der Rückstandshinweis gelten über P und nie über das Kalenderjahr; im Rumpf gibt es keinen
   §-560-Vorschlag (kommt mit PR 3 nach Gradtagen), statt eines falschen. Test in Task 5.

## Dateien

| Datei | Verantwortung | Task |
|---|---|---|
| `shared/period.ts` (neu) | Zeiträume berechnen, Schlüssel bilden und lesen, Bezeichnung, Frist, Alias | 1 |
| `shared/types.ts` | `PeriodKey`, `PeriodRules`, `BillingPeriod`, `SettlementPeriod`; `CostItem.period`; `Property.periodRules`; `StoredAssessment.requestedPeriod`; `Settlement.period`/`deadline` | 1, 2, 4, 5 |
| `server/src/db/schema.ts` | Spalten, Tabelle `period_changes`, Prüfbedingungen | 2 |
| `server/drizzle/0014_zeitraum.sql`, `0015_zeitraum_pflicht.sql`, `meta/*` (erzeugt) | Migration | 2 |
| `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/assessments.ts` | Lesen und Schreiben mit Zeitraum, Schreibprüfungen, `orphanPeriodKeys` | 2, 3 |
| `server/src/db/backup.ts` | Wiederherstellen prüft Schlüssel | 3 |
| `server/src/legacy/read.ts`, `server/src/store.ts` | Eingang der db.json und der Datenbank 0000 liefert `period` | 2, 4 |
| `server/src/snapshot.ts` | Schnappschuss eines Zeitraums | 2, 4, 5 |
| `server/src/calc.ts` | Berechnung über P, `ledgerRows`, Ergebnis mit `period`/`deadline` | 2, 4, 5, 7 |
| `shared/allocation.ts`, `shared/duplicates.ts`, `shared/assessment.ts`, `shared/costItem.ts` | Vorjahresvergleich und Doppelungen über Zeitraumschlüssel | 4 |
| `server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/index.ts` | Belegbuchung und Routen | 2, 3, 4, 5, 6 |
| `server/src/settlementDiff.ts` | Frist als Parameter | 6 |
| `client/src/year.tsx`, Seiten und Helfer des Clients | Brücke Kalenderjahr, Frist vom Server | 2, 4, 5, 6 |
| `server/test/period.test.ts`, `db-zeitraum.test.ts`, `calc-zeitraum.test.ts` (neu) | Tests | 1, 2, 5 |
| `CLAUDE.md`, `CHANGELOG.md` | Doku | 7 |

---
### Task 1: Zeiträume rechnen (`shared/period.ts`)

**Files:**
- Create: `shared/period.ts`
- Modify: `shared/types.ts` (neuer Abschnitt am Dateiende)
- Test: `server/test/period.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces (alle aus `shared/period.ts`, Typen aus `shared/types.ts`):
  - `type PeriodKey = string & { readonly __periodKey: unique symbol }`
  - `type PeriodRules = { startMonth: number; changes: string[] }`
  - `type BillingPeriod = { key: PeriodKey; from: string; to: string; short: boolean }`
  - `type SettlementPeriod = BillingPeriod & { label: string }`
  - `CALENDAR_RULES: PeriodRules`
  - `parsePeriodKey(value: unknown): PeriodKey | null`, `periodKey(text: string): PeriodKey` (wirft)
  - `calendarPeriod(year: number): PeriodKey`, `startYearOf(key: PeriodKey): number`
  - `isCalendarRules(rules: PeriodRules): boolean`, `rulesOf(p?: { periodRules?: PeriodRules } | null): PeriodRules`
  - `periodOfKey(rules, key): BillingPeriod | null`, `periodContaining(rules, date: string): BillingPeriod`
  - `periodsBetween(rules, from: string, to: string): BillingPeriod[]`, `previousPeriod(rules, period): BillingPeriod`
  - `calendarYearPeriod(year: number): BillingPeriod`
  - `periodLabel(p): string`, `settlementPeriod(p): SettlementPeriod`, `settlementDeadline(p, months?: number): string`
  - `periodDays(p: Pick<BillingPeriod,'from'|'to'>): number`, `periodMonths(p: Pick<BillingPeriod,'from'|'to'>): string[]`
  - `type PeriodContext = { key: PeriodKey; previous: PeriodKey; label: string; previousLabel: string; year: number; previousYear: number }`
  - `contextOf(p: BillingPeriod, previous: BillingPeriod): PeriodContext`, `periodContext(rules, p): PeriodContext`, `calendarContext(year: number): PeriodContext`
  - `type PeriodResolution = { period: BillingPeriod } | { status: 400 | 404; error: string }`, `resolvePeriodParam(rules, text: string): PeriodResolution`

- [ ] **Step 1: Write the failing test**

`server/test/period.test.ts`:

```ts
// Abrechnungszeiträume (#208): shared/period.ts ist die eine Stelle, an der Zeiträume entstehen.
// Geprüft wird an den Zahlen des Entwurfs (Abschnitt 3.8, 12.2) und an zufälligen Rhythmen mit
// festem Startwert, wie die Invarianten in calc.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CALENDAR_RULES, calendarContext, calendarPeriod, calendarYearPeriod, contextOf, isCalendarRules, parsePeriodKey, periodContaining,
  periodContext, periodDays, periodKey, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod,
  resolvePeriodParam, rulesOf, settlementDeadline, settlementPeriod, startYearOf,
} from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const of = (rules: PeriodRules, key: string): BillingPeriod => {
  const p = periodOfKey(rules, periodKey(key))
  if (!p) return assert.fail(`kein Zeitraum ${key} bei ${JSON.stringify(rules)}`)
  return p
}
const MAI: PeriodRules = { startMonth: 5, changes: [] }

test('Kalenderjahr: Schlüssel, Grenzen, Bezeichnung und Frist wie bisher', () => {
  const p = of(CALENDAR_RULES, '2025-01')
  assert.deepEqual(p, { key: '2025-01', from: '2025-01-01', to: '2025-12-31', short: false })
  assert.equal(periodLabel(p), '2025')
  assert.equal(settlementDeadline(p), '2026-12-31')
  assert.equal(periodDays(p), 365)
  assert.deepEqual(calendarYearPeriod(2025), p)
  assert.equal(calendarPeriod(2025), '2025-01')
  assert.equal(startYearOf(periodKey('2025-05')), 2025)
  assert.ok(isCalendarRules(CALENDAR_RULES))
  assert.equal(isCalendarRules(MAI), false)
  assert.equal(isCalendarRules({ startMonth: 1, changes: ['2025-05'] }), false)
})

test('Mai bis April: Bezeichnung über zwei Jahre, Frist zwölf Monate nach dem Ende', () => {
  const p = of(MAI, '2025-05')
  assert.deepEqual(p, { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false })
  assert.equal(periodLabel(p), '2025/2026')
  assert.equal(settlementDeadline(p), '2027-04-30')
  assert.equal(periodOfKey(MAI, periodKey('2025-01')), null, 'im Januar beginnt bei Mai–April kein Zeitraum')
})

test('Wechsel Kalenderjahr → Mai ab 2025-05: Rumpf 01.01.–30.04.2025 mit Frist 30.04.2026', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
  const rumpf = of(rules, '2025-01')
  assert.deepEqual(rumpf, { key: '2025-01', from: '2025-01-01', to: '2025-04-30', short: true })
  assert.equal(periodLabel(rumpf), '01.01.–30.04.2025')
  assert.equal(settlementDeadline(rumpf), '2026-04-30')
  assert.equal(periodDays(rumpf), 120)
  assert.deepEqual(of(rules, '2025-05'), { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false })
  assert.deepEqual(of(rules, '2024-01'), calendarYearPeriod(2024))
  assert.equal(periodOfKey(rules, periodKey('2026-01')), null)
  assert.deepEqual(previousPeriod(rules, of(rules, '2025-05')), rumpf)
  assert.deepEqual(previousPeriod(rules, rumpf), calendarYearPeriod(2024))
})

test('Rumpf über den Jahreswechsel und zurück zum Kalenderjahr', () => {
  const november: PeriodRules = { startMonth: 11, changes: ['2026-05'] }
  const rumpf = of(november, '2025-11')
  assert.deepEqual(rumpf, { key: '2025-11', from: '2025-11-01', to: '2026-04-30', short: true })
  assert.equal(periodLabel(rumpf), '01.11.2025–30.04.2026')
  const zurueck: PeriodRules = { startMonth: 5, changes: ['2026-01'] }
  assert.deepEqual(of(zurueck, '2025-05'), { key: '2025-05', from: '2025-05-01', to: '2025-12-31', short: true })
  assert.equal(periodLabel(of(zurueck, '2025-05')), '01.05.–31.12.2025')
  assert.deepEqual(of(zurueck, '2026-01'), calendarYearPeriod(2026))
})

test('Frist im Schaltjahr: 01.03.2023–29.02.2024 endet am 28.02.2025', () => {
  const p = of({ startMonth: 3, changes: [] }, '2023-03')
  assert.equal(p.to, '2024-02-29')
  assert.equal(settlementDeadline(p), '2025-02-28')
})

test('Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage', () => {
  assert.equal(periodDays(of(MAI, '2027-05')), 366)
})

test('Monate eines Zeitraums', () => {
  assert.deepEqual(periodMonths(of(MAI, '2025-05')), [
    '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  ])
  assert.deepEqual(periodMonths(of({ startMonth: 1, changes: ['2025-05'] }, '2025-01')), ['2025-01', '2025-02', '2025-03', '2025-04'])
})

test('Schlüssel: nur JJJJ-MM mit Monat 01 bis 12 (G-C3)', () => {
  for (const bad of ['2025-00', '2025-13', '2025', '2025-1', '25-01', '2025-01-01', ' 2025-01', '2025-01 ', 2025, null, undefined, {}]) {
    assert.equal(parsePeriodKey(bad), null, String(bad))
  }
  assert.equal(parsePeriodKey('2025-05'), '2025-05')
  assert.throws(() => periodKey('2025-13'), /kein Zeitraumschlüssel/)
})

test('Kontext: Schlüssel, Vorzeitraum und Bezeichnungen', () => {
  assert.deepEqual(calendarContext(2025), { key: '2025-01', previous: '2024-01', label: '2025', previousLabel: '2024', year: 2025, previousYear: 2024 })
  assert.deepEqual(periodContext(MAI, of(MAI, '2025-05')), {
    key: '2025-05', previous: '2024-05', label: '2025/2026', previousLabel: '2024/2025', year: 2025, previousYear: 2024,
  })
  assert.deepEqual(contextOf(of(MAI, '2025-05'), of(MAI, '2023-05')).previous, '2023-05', 'der Vorzeitraum kommt hinein, er wird nicht geraten')
  assert.deepEqual(settlementPeriod(of(MAI, '2025-05')), { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' })
})

test('Regeln eines Objekts: ohne Angabe gilt das Kalenderjahr', () => {
  assert.deepEqual(rulesOf(undefined), CALENDAR_RULES)
  assert.deepEqual(rulesOf({}), CALENDAR_RULES)
  assert.deepEqual(rulesOf({ periodRules: MAI }), MAI)
})

test('Alias: eine nackte Jahreszahl nur beim reinen Kalenderobjekt (G-C6)', () => {
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025'), { period: calendarYearPeriod(2025) })
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025-01'), { period: calendarYearPeriod(2025) })
  assert.deepEqual(resolvePeriodParam(MAI, '2025-05'), { period: of(MAI, '2025-05') })
  assert.deepEqual(resolvePeriodParam(MAI, '2025'),
    { status: 404, error: 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026?' })
  assert.deepEqual(resolvePeriodParam({ startMonth: 1, changes: ['2025-05'] }, '2025'),
    { status: 404, error: 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 01.01.–30.04.2025 oder 2025/2026?' })
  assert.deepEqual(resolvePeriodParam(MAI, '2025-03'),
    { status: 404, error: 'Einen Abrechnungszeitraum, der im März 2025 beginnt, gibt es für dieses Objekt nicht; meinen Sie 2024/2025?' })
  const ungueltig = { status: 400, error: 'Ungültiger Zeitraum: erwartet wird der Monat des Beginns als JJJJ-MM, etwa 2025-05.' }
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025-13'), ungueltig)
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, 'abc'), ungueltig)
})

// ---------- Invariante: die Zerlegung der Zeit (Entwurf 12.3 Nr. 3) ----------

// mulberry32: klein, schnell, mit festem Startwert reproduzierbar.
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
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const monthCount = (p: BillingPeriod): number =>
  (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1

// Zufällige Regeln, wie sie die Bedienung aus PR 3 zulässt: Ein Wechsel liegt nie auf einem Monat,
// in dem ohnehin ein Zeitraum beginnt; dort gäbe es keinen Rumpf, und es wäre kein Wechsel.
function randomRules(r: () => number): PeriodRules {
  const rules: PeriodRules = { startMonth: 1 + pick(r, 12), changes: [] }
  let cursor = 2020 * 12 + pick(r, 24)
  for (let n = pick(r, 4); n > 0; n--) {
    cursor += 1 + pick(r, 30)
    const key = `${Math.floor(cursor / 12)}-${String((cursor % 12) + 1).padStart(2, '0')}`
    if (periodContaining(rules, `${key}-01`).from === `${key}-01`) continue
    rules.changes.push(key)
  }
  return rules
}

test('Zerlegung: lückenlos, überschneidungsfrei, höchstens zwölf Monate, Rumpf genau vor jedem Wechsel', () => {
  const r = rng(208)
  for (let fall = 0; fall < 300; fall++) {
    const rules = randomRules(r)
    const all = periodsBetween(rules, '2019-01-01', '2032-12-31')
    const keys = new Set<string>()
    for (const [i, p] of all.entries()) {
      const months = monthCount(p)
      assert.ok(months >= 1 && months <= 12, `${JSON.stringify(rules)} ${p.key}: ${months} Monate`)
      assert.equal(p.short, months < 12, `${JSON.stringify(rules)} ${p.key}`)
      assert.equal(p.from.slice(8), '01')
      assert.ok(!keys.has(p.key), `Schlüssel doppelt: ${p.key}`)
      keys.add(p.key)
      assert.deepEqual(periodOfKey(rules, p.key), p)
      const next = all[i + 1]
      if (next) assert.equal(next.from, nextDay(p.to), `Lücke oder Überschneidung nach ${p.key} bei ${JSON.stringify(rules)}`)
    }
    for (const change of rules.changes) {
      const vorher = all.find((p) => nextDay(p.to) === `${change}-01`)
      assert.ok(vorher?.short, `vor dem Wechsel ${change} steht ein Rumpf (${JSON.stringify(rules)})`)
      assert.ok(all.some((p) => p.key === change), `mit dem Wechsel ${change} beginnt ein Zeitraum`)
    }
    for (let k = 0; k < 20; k++) {
      const day = new Date(Date.UTC(2020, 0, 1) + pick(r, 365 * 12) * 86400000).toISOString().slice(0, 10)
      const p = periodContaining(rules, day)
      assert.ok(p.from <= day && day <= p.to, `${day} liegt nicht in ${p.key}`)
    }
  }
})

// ---------- Wächter: Schlüssel entstehen nur hier ----------

test('Nur shared/period.ts macht aus Text einen Zeitraumschlüssel', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  // Zusammengesetzt, damit diese Datei sich nicht selbst findet.
  const needle = ['as', 'PeriodKey'].join(' ')
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(needle)) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  for (const dir of ['shared', 'server/src', 'server/test', 'server/testing', 'client/src']) walk(path.join(root, dir))
  assert.deepEqual(found, ['shared/period.ts'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/period.test.ts`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` für `shared/period.ts`.

- [ ] **Step 3: Write minimal implementation**

An das Ende von `shared/types.ts` anhängen:

```ts
// ---------- Abrechnungszeitraum (#208) ----------

// Der Schlüssel eines Abrechnungszeitraums: der Monat seines Beginns als 'JJJJ-MM'. Kein Zeitraum
// beginnt im selben Monat wie ein anderer, auch nicht über einen Rumpfzeitraum hinweg; deshalb ist
// der Beginnmonat eindeutig. Ein Markentyp über `string`: Eine Jahreszahl passt nicht hinein, und
// jede Stelle, die noch mit `year - 1` rechnet, fällt beim Übersetzen auf. Aus Text wird er nur in
// shared/period.ts.
export type PeriodKey = string & { readonly __periodKey: unique symbol }

// Der Rhythmus eines Objekts: der Beginnmonat von Anfang an (1 heißt Kalenderjahr) und die Wechsel
// als 'JJJJ-MM', ab denen jeder Zeitraum in diesem Monat beginnt. Die Zeiträume selbst werden daraus
// berechnet und nie gespeichert.
export type PeriodRules = { startMonth: number; changes: string[] }

// Ein Abrechnungszeitraum mit inklusiven Grenzen als 'JJJJ-MM-TT'. `short` heißt Rumpfzeitraum:
// kürzer als zwölf Monate, weil danach ein Wechsel kommt.
export type BillingPeriod = { key: PeriodKey; from: string; to: string; short: boolean }

// Der Zeitraum, wie eine Abrechnung ihn trägt, mit der Bezeichnung für Kopf und Druck
// („2025“, „2025/2026“, „01.01.–30.04.2025“).
export type SettlementPeriod = BillingPeriod & { label: string }
```

`shared/period.ts`:

```ts
// Abrechnungszeiträume (#208), berechnet aus Beginnmonat und Wechseln, nie gespeichert.
//
// Ein Objekt rechnet im Kalenderjahr ab oder in einem eigenen Rhythmus, etwa Mai bis April wie
// sein Messdienst. Wechselt der Rhythmus, endet der letzte Zeitraum des alten am Tag vor dem
// Wechsel (Rumpfzeitraum). So sind die Zeiträume lückenlos, überschneidungsfrei und nie länger als
// zwölf Monate, und zwar aus der Konstruktion und nicht aus einer Prüfung. Eine Tabelle mit einer
// Zeile je Zeitraum müsste jedes Jahr fortgeschrieben werden, und jede Zeile könnte eine Lücke
// erzeugen.
//
// Server und Oberfläche rechnen mit dieser Datei, deshalb liegt sie in shared/ (ein Laufzeitanteil
// wie heating.ts und glossary.ts). Sie hängt an keiner Uhr und an keiner Locale.

import type { BillingPeriod, PeriodKey, PeriodRules, SettlementPeriod } from './types.ts'

export const CALENDAR_RULES: PeriodRules = { startMonth: 1, changes: [] }

// § 556 Abs. 3 BGB: jährlich abrechnen, also höchstens zwölf Monate (Satz 1, herrschende Meinung),
// und zugehen muss die Abrechnung bis zum Ablauf des zwölften Monats nach dem Ende (Satz 2). Beide
// Zahlen kommen nach dem Merge von PR 1 aus dem Rechtsregister (`bgb.max-period-months`,
// `bgb.deadline-months`, Entwurf 4.3); bis dahin stehen sie hier und nur hier.
const MAX_PERIOD_MONTHS = 12
const DEADLINE_MONTHS = 12

const KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Monate als fortlaufende Zahl (Jahr · 12 + Monat − 1): „zwölf Monate später“ ist dann + 12.
const monthIndex = (year: number, month: number): number => year * 12 + month - 1
const yearOf = (index: number): number => Math.floor(index / 12)
const monthOf = (index: number): number => index - yearOf(index) * 12 + 1
const pad = (n: number, width: number): string => String(n).padStart(width, '0')
const monthText = (index: number): string => `${pad(yearOf(index), 4)}-${pad(monthOf(index), 2)}`
const firstDay = (index: number): string => `${monthText(index)}-01`
const lastDay = (index: number): string =>
  `${monthText(index)}-${pad(new Date(Date.UTC(yearOf(index), monthOf(index), 0)).getUTCDate(), 2)}`
const indexOfDate = (date: string): number => monthIndex(Number(date.slice(0, 4)), Number(date.slice(5, 7)))
const germanDate = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`

// Die beiden einzigen Stellen, an denen aus Text ein Schlüssel wird.
export function parsePeriodKey(value: unknown): PeriodKey | null {
  return typeof value === 'string' && KEY.test(value) ? (value as PeriodKey) : null
}
export function periodKey(text: string): PeriodKey {
  const key = parsePeriodKey(text)
  if (key === null) throw new Error(`„${text}“ ist kein Zeitraumschlüssel (JJJJ-MM).`)
  return key
}

const keyOf = (index: number): PeriodKey => periodKey(monthText(index))

// Der Zeitraum eines Kalenderjahres beginnt im Januar.
export const calendarPeriod = (year: number): PeriodKey => keyOf(monthIndex(year, 1))
// Das Kalenderjahr, in dem ein Zeitraum beginnt.
export const startYearOf = (key: PeriodKey): number => Number(key.slice(0, 4))

export const isCalendarRules = (rules: PeriodRules): boolean => rules.startMonth === 1 && rules.changes.length === 0
// Der Rhythmus eines Objekts. Fehlt die Angabe (ein Objekt aus einem Tab von vor dem Update, ein
// Test), gilt das Kalenderjahr.
export const rulesOf = (property?: { periodRules?: PeriodRules } | null): PeriodRules => property?.periodRules ?? CALENDAR_RULES

// ---------- Der Rhythmus als Folge von Abschnitten ----------

// Bis zum ersten Wechsel gilt der Beginnmonat, ab jedem Wechsel dessen Monat. Ungültige Wechsel
// fallen weg; die Datenbank lässt sie gar nicht erst zu (Prüfbedingung), verlassen wird sich darauf
// nicht.
type Rhythm = { initial: number; changes: number[] }

function rhythmOf(rules: PeriodRules): Rhythm {
  if (!Number.isInteger(rules.startMonth) || rules.startMonth < 1 || rules.startMonth > 12) {
    throw new Error(`Beginnmonat ${rules.startMonth} liegt nicht zwischen 1 und 12.`)
  }
  const changes = new Set<number>()
  for (const change of rules.changes) {
    const key = parsePeriodKey(change)
    if (key !== null) changes.add(indexOfDate(key))
  }
  return { initial: rules.startMonth, changes: [...changes].sort((a, b) => a - b) }
}

// Der Monat, in dem die Zeiträume am Monat `index` beginnen (1..12). Die 12 in `startOf` ist die
// Zahl der Monate eines Jahres, kein Rechtswert: Der Rhythmus wiederholt sich jährlich.
function anchorAt(r: Rhythm, index: number): number {
  let anchor = r.initial
  for (const change of r.changes) if (change <= index) anchor = monthOf(change)
  return anchor
}

// Der Beginn des Zeitraums, der den Monat `index` enthält. Ein Wechsel beginnt in seinem eigenen
// Monat, also im Takt seines Abschnitts; der gesuchte Beginn liegt deshalb nie vor ihm.
function startOf(r: Rhythm, index: number): number {
  const anchor = anchorAt(r, index)
  return index - ((((index - (anchor - 1)) % 12) + 12) % 12)
}

// Der Beginn des nächsten Zeitraums: zwölf Monate später, außer ein Wechsel kommt früher.
function nextStart(r: Rhythm, start: number): number {
  let next = start + MAX_PERIOD_MONTHS
  for (const change of r.changes) if (change > start && change < next) next = change
  return next
}

function periodAt(r: Rhythm, start: number): BillingPeriod {
  const next = nextStart(r, start)
  return { key: keyOf(start), from: firstDay(start), to: lastDay(next - 1), short: next - start < MAX_PERIOD_MONTHS }
}

// ---------- Zeiträume ----------

export function periodContaining(rules: PeriodRules, date: string): BillingPeriod {
  const r = rhythmOf(rules)
  return periodAt(r, startOf(r, indexOfDate(date)))
}

// `null`, wenn in diesem Monat kein Zeitraum beginnt.
export function periodOfKey(rules: PeriodRules, key: PeriodKey): BillingPeriod | null {
  const r = rhythmOf(rules)
  const index = indexOfDate(key)
  return startOf(r, index) === index ? periodAt(r, index) : null
}

// Alle Zeiträume, die die Spanne [from, to] berühren, in ihrer Reihenfolge.
export function periodsBetween(rules: PeriodRules, from: string, to: string): BillingPeriod[] {
  const r = rhythmOf(rules)
  const end = indexOfDate(to)
  const result: BillingPeriod[] = []
  for (let start = startOf(r, indexOfDate(from)); start <= end; start = nextStart(r, start)) result.push(periodAt(r, start))
  return result
}

export function previousPeriod(rules: PeriodRules, period: BillingPeriod): BillingPeriod {
  const r = rhythmOf(rules)
  return periodAt(r, startOf(r, indexOfDate(period.key) - 1))
}

export const calendarYearPeriod = (year: number): BillingPeriod => periodAt(rhythmOf(CALENDAR_RULES), monthIndex(year, 1))

// „2025“ für ein Kalenderjahr, „2025/2026“ für zwölf Monate über den Jahreswechsel, sonst die
// Grenzen des Rumpfs („01.01.–30.04.2025“, über den Jahreswechsel „01.11.2025–30.04.2026“).
export function periodLabel(p: BillingPeriod): string {
  const fromYear = p.from.slice(0, 4)
  const toYear = p.to.slice(0, 4)
  if (!p.short) return p.from.slice(5) === '01-01' ? fromYear : `${fromYear}/${toYear}`
  return fromYear === toYear ? `${p.from.slice(8, 10)}.${p.from.slice(5, 7)}.–${germanDate(p.to)}` : `${germanDate(p.from)}–${germanDate(p.to)}`
}

export const settlementPeriod = (p: BillingPeriod): SettlementPeriod => ({ ...p, label: periodLabel(p) })

// § 556 Abs. 3 S. 2 BGB: Die Abrechnung muss spätestens bis zum Ablauf des zwölften Monats nach
// Ende des Abrechnungszeitraums zugehen. Ein Zeitraum endet immer an einem Monatsende, die Frist
// also am Ende desselben Monats im Folgejahr. `months` reicht die Berechnung aus dem Rechtsregister
// herein, damit der Wert in `legalBasis.values` einfriert (Task 7).
export function settlementDeadline(p: Pick<BillingPeriod, 'to'>, months: number = DEADLINE_MONTHS): string {
  return lastDay(indexOfDate(p.to) + months)
}

export function periodDays(p: Pick<BillingPeriod, 'from' | 'to'>): number {
  return Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86400000) + 1
}

// Die Monate eines Zeitraums als 'JJJJ-MM', aufsteigend.
export function periodMonths(p: Pick<BillingPeriod, 'from' | 'to'>): string[] {
  const months: string[] = []
  for (let i = indexOfDate(p.from); i <= indexOfDate(p.to); i++) months.push(monthText(i))
  return months
}

// ---------- Ein Zeitraum und sein Vorzeitraum ----------

// Was der Vergleich mit dem Vorzeitraum braucht (gemerkter Schlüssel, Doppelungen, #141): beide
// Schlüssel, ihre Bezeichnungen und die Kalenderjahre des Beginns für Beschreibungen wie
// „Grundsteuer 2025“.
export type PeriodContext = { key: PeriodKey; previous: PeriodKey; label: string; previousLabel: string; year: number; previousYear: number }

export function contextOf(p: BillingPeriod, previous: BillingPeriod): PeriodContext {
  return { key: p.key, previous: previous.key, label: periodLabel(p), previousLabel: periodLabel(previous), year: startYearOf(p.key), previousYear: startYearOf(previous.key) }
}

export const periodContext = (rules: PeriodRules, p: BillingPeriod): PeriodContext => contextOf(p, previousPeriod(rules, p))

export const calendarContext = (year: number): PeriodContext => periodContext(CALENDAR_RULES, calendarYearPeriod(year))

// ---------- Der Zeitraum einer Anfrage ----------

export type PeriodResolution = { period: BillingPeriod } | { status: 400 | 404; error: string }

const orList = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} oder ${items[items.length - 1] ?? ''}`

// `JJJJ-MM`, oder die nackte Jahreszahl **nur bei einem reinen Kalenderobjekt** (G-C6). Sonst nennt
// die Ablehnung, was gemeint sein könnte: Ein Tab von vor einem Wechsel bekäme sonst still den
// Rumpf, der zufällig im Januar beginnt.
export function resolvePeriodParam(rules: PeriodRules, text: string): PeriodResolution {
  if (/^\d{4}$/.test(text)) {
    if (isCalendarRules(rules)) return { period: calendarYearPeriod(Number(text)) }
    const starting = periodsBetween(rules, `${text}-01-01`, `${text}-12-31`).filter((p) => p.from.startsWith(`${text}-`)).map(periodLabel)
    return { status: 404, error: `Den Zeitraum ${text} gibt es für dieses Objekt nicht; meinen Sie ${orList(starting)}?` }
  }
  const key = parsePeriodKey(text)
  if (key === null) return { status: 400, error: 'Ungültiger Zeitraum: erwartet wird der Monat des Beginns als JJJJ-MM, etwa 2025-05.' }
  const period = periodOfKey(rules, key)
  if (period) return { period }
  const month = MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)
  return {
    status: 404,
    error: `Einen Abrechnungszeitraum, der im ${month} ${key.slice(0, 4)} beginnt, gibt es für dieses Objekt nicht; meinen Sie ${periodLabel(periodContaining(rules, `${key}-01`))}?`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix server test -- test/period.test.ts && npm run typecheck`
Expected: PASS (13 Tests), typecheck ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add shared/period.ts shared/types.ts server/test/period.test.ts
git commit -m "Zeitraum: Abrechnungszeiträume aus Beginnmonat und Wechseln berechnen

Refs #208"
```

---
### Task 2: Datenbank: Spalten, Migrationen 0014/0015, Lesen und Schreiben

Am Ende dieser Aufgabe steht jeder Zeitraum als `period` in der Datenbank, und alles, was sie
liest oder schreibt, spricht `period`. Die Berechnung bleibt in dieser Aufgabe beim Kalenderjahr.
`CostItem` bekommt `period` vorerst **optional** neben dem (jetzt abgeleiteten) `year`: So bleiben
die vielen von Hand gebauten Kostenpositionen in den Tests des Clients bis Task 4 unberührt, und
dort wird jede genau einmal umgestellt. Was aus der Datenbank kommt, trägt `period` immer
(`StoredCostItem`). Die Routen nehmen weiter die Jahreszahl und übersetzen sie mit `calendarPeriod`
(bis Task 6).

**Files:**
- Modify: `shared/types.ts` (`CostItem`, `Tenancy`, `Property`, `StoredAssessment`)
- Modify: `server/src/db/schema.ts`
- Create (erzeugt): `server/drizzle/0014_zeitraum.sql`, `server/drizzle/0015_zeitraum_pflicht.sql`, `server/drizzle/meta/0014_snapshot.json`, `server/drizzle/meta/0015_snapshot.json`; Modify (erzeugt): `server/drizzle/meta/_journal.json`
- Modify: `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/db/assessments.ts`
- Modify: `server/src/legacy/read.ts`, `server/src/snapshot.ts`, `server/src/calc.ts` (nur `computePrepaymentCents`), `server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/index.ts`
- Modify: `client/src/pages/Abrechnung.tsx`, `client/src/testing/fakeBooking.ts`
- Test: `server/test/db-zeitraum.test.ts` (neu); Modify: `server/test/migrations.test.ts`, `server/test/schema.test.ts`, `server/test/db-objekte.test.ts`, `server/test/db-repository.test.ts`, `server/test/db-stock.test.ts`, `server/test/calc.test.ts`, `server/test/calc-rueckstand.test.ts`, `server/test/calc-steuer-eigennutzung.test.ts`, `server/test/snapshot-property.test.ts`, `server/test/api.test.ts`, `server/test/bookingResponse.test.ts`, `server/test/assessment.test.ts`, `client/src/assessment.test.ts`, `client/src/pages/booking.test.tsx`, `client/src/pages/Abrechnung.test.tsx`

**Interfaces:**
- Consumes (Task 1): `PeriodKey`, `PeriodRules`, `calendarPeriod`, `parsePeriodKey`, `periodKey`, `startYearOf`.
- Produces:
  - `CostItem.period?: PeriodKey` (bis Task 4 optional) neben `CostItem.year: number` (abgeleitet)
  - `type StoredCostItem = CostItem & { period: PeriodKey }` (db/read.ts); `readCostItems(db): Promise<StoredCostItem[]>`, `Stock.costItems: StoredCostItem[]`
  - `Property.periodRules?: PeriodRules` (von `readProperties` immer gefüllt)
  - `Tenancy.prepaymentOverrides`: Schlüssel sind `'JJJJ-MM'`
  - `StoredAssessment.requestedPeriod: PeriodKey | null` statt `requestedYear`
  - Tabellen-Exporte in schema.ts: `periodChanges`; Spalten `costItems.period`, `closedSettlements.period`, `closedSettlementHistory.period`, `prepaymentOverrides.period`, `assessments.requestedPeriod`, `properties.periodStartMonth`
  - `StoredClosedSettlement.period: PeriodKey` (db/read.ts) statt `year`
  - `findClosedSettlement(db, propertyId, period: PeriodKey)`, `closeSettlement(db, { id, propertyId, period, closedAt, sentAt, settlement })`, `setSentAt(db, propertyId, period, sentAt)`, `reopenSettlement(db, propertyId, period, historyId)`, `settlementHistory(db, propertyId, period)`
  - `overridesByPeriod(overrides: Record<string, number>): Record<string, number>` (snapshot.ts): vierstellige Jahresschlüssel der db.json → `'JJJJ-01'`
  - `SnapshotSource.closedSettlements: (SnapshotClosedSettlement & { period: PeriodKey })[]`

- [ ] **Step 1: Write the failing test**

`server/test/db-zeitraum.test.ts`:

```ts
// Abrechnungszeitraum (#208): die Migration 0014/0015 auf einer Datenbank von 0.10.1 und die
// Zusicherungen danach. Dass dabei keine Zahl wandert, hält db-objekte.test.ts fest (jedes Fixture
// durch die ganze Kette); hier geht es um die Schlüssel selbst.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { placeAssessment } from '../src/db/assessments.ts'
import { assessments } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zeitraum-'))

// SQLite meldet eine verletzte Zusicherung mit ihrem Namen; `null` heißt angenommen.
function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Die Datenbank eines Nutzers von 0.10.1: alle Schritte bis 0013, dazu ein Bestand über mehrere
// Jahre mit allem, was ein Jahr trägt.
async function databaseAt0013(file: string): Promise<Connection> {
  const connection = await connect(file)
  const migrations = await loadMigrations()
  const bis = migrations.findIndex((m) => m.tag === '0014_zeitraum')
  if (bis < 0) assert.fail('Schritt 0014_zeitraum fehlt')
  applyMigrations(connection, migrations.slice(0, bis))
  connection.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)`)
  connection.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2023-01-01')`)
  connection.exec(`INSERT INTO prepayment_overrides (tenancy_id, year, amount_cents) VALUES ('t1', 2024, 170000), ('t1', 2025, 180000)`)
  connection.exec(`INSERT INTO cost_items (id, property_id, year, category, description, amount_cents, key) VALUES
    ('k-2023', 'objekt-1', 2023, 'Grundsteuer', 'Grundsteuer 2023', 48000, 'area'),
    ('k-2025', 'objekt-1', 2025, 'Grundsteuer', 'Grundsteuer 2025', 50000, 'area')`)
  connection.exec(`INSERT INTO closed_settlements (id, property_id, year, closed_at, settlement)
    VALUES ('a-2024', 'objekt-1', 2024, '2025-03-01T00:00:00Z', '{}')`)
  connection.exec(`INSERT INTO closed_settlement_history (id, property_id, year, closed_at, reopened_at, settlement)
    VALUES ('h-2023', 'objekt-1', 2023, '2024-03-01T00:00:00Z', '2024-04-01T00:00:00Z', '{}')`)
  connection.exec(`INSERT INTO assessments (id, file, property_id, year, requested_year, created_at) VALUES
    ('a-mit', 'mit.pdf', 'objekt-1', 2025, 2024, '2026-01-01T00:00:00Z'),
    ('a-ohne', 'ohne.pdf', NULL, 2025, 2024, '2026-01-01T00:00:00Z'),
    ('a-leer', 'leer.pdf', 'objekt-1', 2025, NULL, '2026-01-01T00:00:00Z')`)
  return connection
}

async function freshConnection(dir: string): Promise<Connection> {
  const connection = await connect(path.join(dir, 'db.sqlite'))
  applyMigrations(connection, await loadMigrations())
  return connection
}

test('Kette: Eine Datenbank von 0.10.1 bekommt Zeiträume, jedes Jahr wird sein Kalenderzeitraum', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAt0013(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    const rows = (sql: string) => connection.rows(sql)
    assert.deepEqual(rows('SELECT id, period FROM cost_items ORDER BY rowid'), [['k-2023', '2023-01'], ['k-2025', '2025-01']])
    assert.deepEqual(rows('SELECT tenancy_id, period, amount_cents FROM prepayment_overrides ORDER BY period'),
      [['t1', '2024-01', 170000], ['t1', '2025-01', 180000]])
    assert.deepEqual(rows('SELECT id, period FROM closed_settlements'), [['a-2024', '2024-01']])
    assert.deepEqual(rows('SELECT id, period FROM closed_settlement_history'), [['h-2023', '2023-01']])
    // Ein gewählter Zeitraum ist nur am Objekt bestimmt (G-B7); ohne Objekt entfällt er.
    assert.deepEqual(rows('SELECT id, requested_period FROM assessments ORDER BY id'), [['a-leer', null], ['a-mit', '2024-01'], ['a-ohne', null]])
    // Die Kalenderjahre des Belegs bleiben.
    assert.deepEqual(rows('SELECT id, year FROM assessments ORDER BY id'), [['a-leer', 2025], ['a-mit', 2025], ['a-ohne', 2025]])
    assert.deepEqual(rows('SELECT id, period_start_month FROM properties'), [['objekt-1', 1]])
    assert.deepEqual(rows('SELECT count(*) FROM period_changes'), [[0]])
    for (const table of ['cost_items', 'prepayment_overrides', 'closed_settlements', 'closed_settlement_history']) {
      const columns = rows(`PRAGMA table_info(${table})`).map((r) => r[1])
      assert.ok(!columns.includes('year'), `${table} hat noch eine Spalte year`)
      assert.ok(columns.includes('period'), `${table} hat keine Spalte period`)
    }
    assert.ok(!rows('PRAGMA table_info(assessments)').map((r) => r[1]).includes('requested_year'))
    assert.deepEqual(rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Monat 00 und 13, eine nackte Jahreszahl und ein gewählter Zeitraum ohne Objekt werden abgewiesen', async () => {
  const dir = tempDir()
  try {
    const c = await freshConnection(dir)
    const position = (id: string, period: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('${id}', 'objekt-1', '${period}', 'Grundsteuer', 'G', 100, 'area')`
    assert.equal(rejects(c, position('ok', '2025-05')), null)
    for (const bad of ['2025-00', '2025-13', '2025', '25-05', '2025-5']) {
      assert.match(rejects(c, position(`k-${bad}`, bad)) ?? '', /cost_items_period_valid/, bad)
    }
    assert.match(rejects(c, "INSERT INTO cost_items (id, property_id, category, description, amount_cents, key) VALUES ('ohne', 'objekt-1', 'G', 'G', 1, 'area')") ?? '', /NOT NULL/)
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)")
    c.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2025-01-01')")
    assert.match(rejects(c, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-13', 1)") ?? '', /prepayment_overrides_period_valid/)
    assert.match(rejects(c, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s', 'objekt-1', '2025-00', 'x', '{}')") ?? '', /closed_settlements_period_valid/)
    assert.match(rejects(c, "INSERT INTO closed_settlement_history (id, property_id, period, closed_at, reopened_at, settlement) VALUES ('h', 'objekt-1', '2025', 'x', 'y', '{}')") ?? '', /closed_settlement_history_period_valid/)
    assert.match(rejects(c, "INSERT INTO assessments (id, file, property_id, year, requested_period, created_at) VALUES ('a', 'a.pdf', NULL, 2025, '2025-01', 'x')") ?? '', /assessments_requested_period_with_property/)
    assert.match(rejects(c, "INSERT INTO assessments (id, file, property_id, year, requested_period, created_at) VALUES ('b', 'b.pdf', 'objekt-1', 2025, '2025-13', 'x')") ?? '', /assessments_requested_period_valid/)
    assert.match(rejects(c, 'UPDATE properties SET period_start_month = 13') ?? '', /properties_period_start_month_valid/)
    assert.match(rejects(c, 'UPDATE properties SET period_start_month = 0') ?? '', /properties_period_start_month_valid/)
    assert.match(rejects(c, "INSERT INTO period_changes (property_id, from_month) VALUES ('objekt-1', '2025-5')") ?? '', /period_changes_from_month_valid/)
    assert.equal(rejects(c, "INSERT INTO period_changes (property_id, from_month) VALUES ('objekt-1', '2025-05')"), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Eindeutig: je Objekt und Zeitraum ein Abschluss, je Mietverhältnis und Zeitraum eine Jahreskorrektur', async () => {
  const dir = tempDir()
  try {
    const c = await freshConnection(dir)
    c.exec("INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s1', 'objekt-1', '2025-01', 'x', '{}')")
    assert.match(rejects(c, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s2', 'objekt-1', '2025-01', 'y', '{}')") ?? '', /UNIQUE/)
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)")
    c.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2025-01-01')")
    c.exec("INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 1)")
    assert.match(rejects(c, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 2)") ?? '', /UNIQUE/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Lesen und Schreiben: Position, Jahreskorrektur und Objekt tragen ihren Zeitraum', async () => {
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', {
      unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2024-01': 1000, '2025': 2000 },
    }))
    const neu = await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area',
    }))
    const alt = await opened.write((db) => createEntity(db, 'costItems', 'c2', {
      propertyId: 'objekt-1', year: 2024, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area',
    }))
    assert.equal(Reflect.get(neu, 'period'), '2025-01')
    assert.equal(Reflect.get(alt, 'period'), '2024-01', 'ein Tab von vor dem Update schickt year')
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.tenancies[0]?.prepaymentOverrides, { '2024-01': 1000, '2025-01': 2000 })
    assert.deepEqual(stock.properties.map((p) => p.periodRules), [{ startMonth: 1, changes: [] }])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Auswertung: ohne Objekt kein gewählter Zeitraum, mit Objekt der Kalenderzeitraum des gewählten Jahres', async () => {
  // Review Focus 2: Die Prüfbedingung „nur mit Objekt“ ließe das Lösen vom Objekt sonst scheitern.
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a1', file: 'a.pdf', propertyId: 'objekt-1', year: 2025, requestedPeriod: periodKey('2024-01'), createdAt: '2026-01-01T00:00:00Z' })
    })
    const stand = async () => {
      const [row] = await opened.read((db) => db.select().from(assessments))
      return [row?.propertyId, row?.year, row?.requestedPeriod]
    }
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { propertyId: null })), 'ok')
    assert.deepEqual(await stand(), [null, 2025, null])
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { year: 2023 })), 'ok')
    assert.deepEqual(await stand(), [null, 2023, null])
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { propertyId: 'objekt-1', year: 2024 })), 'ok')
    assert.deepEqual(await stand(), ['objekt-1', 2024, '2024-01'])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/db-zeitraum.test.ts`
Expected: FAIL. Der erste Test mit `Schritt 0014_zeitraum fehlt`, die Prüfbedingungen an
`no such column: period`, die übrigen an ihren Zusicherungen (`period` kommt nicht zurück,
`periodRules` fehlt, `requestedPeriod` wird nicht gespeichert).

- [ ] **Step 3: Typen erweitern**

In `shared/types.ts`:

```ts
// in Property, nach cableBuiltBeforeDec2021:
  // Der Rhythmus der Abrechnungszeiträume (#208). Der Server liefert ihn immer mit; fehlt er, gilt
  // das Kalenderjahr (`rulesOf` in shared/period.ts). Ändern lässt er sich in dieser Version nicht.
  periodRules?: PeriodRules
```

```ts
// in Tenancy, die Zeile ersetzen:
  prepaymentOverrides: Record<string, number> // Zeitraum ('JJJJ-MM', #208) → tatsächlich gezahlter Betrag
```

```ts
// in CostItem, statt `year: number`:
  // Das Kalenderjahr, in dem `period` beginnt. Gespeichert wird es nicht mehr, sondern aus `period`
  // abgeleitet (#208), für Leser, die noch nicht auf `period` umgestellt sind.
  year: number
  // Der Abrechnungszeitraum (#208), dem die Position ganz gehört. Aus der Datenbank kommt er immer
  // (`StoredCostItem` in server/src/db/read.ts); optional nur, solange `year` daneben steht.
  period?: PeriodKey
```

```ts
// in StoredAssessment, statt requestedYear samt Kommentar:
  // Der gewählte Abrechnungszeitraum (#208): beim Auswerten mitgeschickt (die Seite, von der aus
  // ausgewertet wurde), danach der von Hand gesetzte. Nur mit Objekt, denn ein Zeitraum ist nur am
  // Objekt bestimmt (G-B7); `null`, wenn keiner gewählt ist. Weicht `year` davon ab, steht die Ampel
  // auf gelb und nichts ist vorab angehakt.
  requestedPeriod: PeriodKey | null
```

- [ ] **Step 4: Schema, erster Schritt (Spalten ohne Pflicht) und 0014 erzeugen**

In `server/src/db/schema.ts` den Typimport um `PeriodKey` ergänzen und:

```ts
// in properties, nach cableBuiltBeforeDec2021:
    // Beginnmonat der Abrechnungszeiträume von Anfang an (#208): 1 heißt Kalenderjahr. Die Zeiträume
    // werden berechnet (shared/period.ts), zusammen mit den Wechseln in `period_changes`.
    periodStartMonth: integer('period_start_month').notNull().default(1),
```

Direkt hinter der Tabelle `properties` (vor `const propertyRef`):

```ts
// Wechsel des Rhythmus (#208): Ab `from_month` ('JJJJ-MM') beginnt jeder Zeitraum in diesem Monat;
// der letzte Zeitraum davor endet am Tag vor dem Wechsel (Rumpfzeitraum). Gehört zum Objekt und
// fällt mit ihm.
export const periodChanges = sqliteTable(
  'period_changes',
  {
    propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    fromMonth: text('from_month').notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.fromMonth] })],
)
```

Je eine neue, noch nullbare Spalte `period` hinter `year` in `prepaymentOverrides`, `costItems`,
`closedSettlements` und `closedSettlementHistory`:

```ts
    period: text('period').$type<PeriodKey>(),
```

und in `assessments` hinter `requestedYear`:

```ts
    requestedPeriod: text('requested_period').$type<PeriodKey>(),
```

Run: `npm --prefix server run db:generate -- --name zeitraum`
Expected: keine Rückfrage; `[✓] Your SQL migration file ➜ drizzle/0014_zeitraum.sql`. Inhalt:

```sql
CREATE TABLE `period_changes` (
	`property_id` text NOT NULL,
	`from_month` text NOT NULL,
	PRIMARY KEY(`property_id`, `from_month`),
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `assessments` ADD `requested_period` text;--> statement-breakpoint
ALTER TABLE `closed_settlement_history` ADD `period` text;--> statement-breakpoint
ALTER TABLE `closed_settlements` ADD `period` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `period` text;--> statement-breakpoint
ALTER TABLE `prepayment_overrides` ADD `period` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `period_start_month` integer DEFAULT 1 NOT NULL;
```

- [ ] **Step 5: Datenanweisungen an 0014 anhängen**

An das Ende von `server/drizzle/0014_zeitraum.sql` (nach der letzten erzeugten Zeile) anfügen:

```sql
--> statement-breakpoint
-- Ab hier von Hand angehängt (#208), siehe „Datenanweisungen“ in README.md: Der Aufbau darüber
-- ist erzeugt; welchen Zeitraum die vorhandenen Zeilen bekommen, kann drizzle-kit nicht wissen.
-- Jedes vorhandene Jahr ist ein Kalenderjahr, sein Zeitraum beginnt im Januar ('JJJJ-01'). Ein
-- gewähltes Jahr einer Auswertung ohne Objekt entfällt: Ein Zeitraum ist nur am Objekt bestimmt
-- (Prüfbedingung in 0015, G-B7).
UPDATE `cost_items` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `closed_settlements` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `closed_settlement_history` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `prepayment_overrides` SET `period` = printf('%04d-01', `year`);--> statement-breakpoint
UPDATE `assessments` SET `requested_period` = printf('%04d-01', `requested_year`) WHERE `requested_year` IS NOT NULL AND `property_id` IS NOT NULL;
```

- [ ] **Step 6: Schema, zweiter Schritt (Pflicht, Bedingungen, Indizes) und 0015 erzeugen**

In `server/src/db/schema.ts` hinter `oneOf`:

```ts
// Prüfbedingung „ein Zeitraumschlüssel 'JJJJ-MM' mit Monat 01 bis 12“ (#208, G-C3). Ob es diesen
// Zeitraum für das Objekt gibt, weiß die Datenbank nicht; das prüft repository.ts beim Schreiben,
// und `orphanPeriodKeys` fragt es beim Wiederherstellen über den ganzen Bestand ab. NULL lässt sie
// durch wie `oneOf`.
const periodKeyCheck = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("${column}", 6, 2) AS INTEGER) BETWEEN 1 AND 12`))
```

Dann:

- `properties`, Bedingungsliste ergänzen:
  ```ts
      check('properties_period_start_month_valid', sql.raw('"period_start_month" BETWEEN 1 AND 12')),
  ```
- `periodChanges`: `(t) => [primaryKey({ columns: [t.propertyId, t.fromMonth] }), periodKeyCheck('period_changes_from_month_valid', 'from_month')],`
- `prepaymentOverrides`: Zeile `year: integer('year').notNull(),` löschen, `period: text('period').$type<PeriodKey>().notNull(),`, Primärschlüssel `primaryKey({ columns: [t.tenancyId, t.period] })`, dazu `periodKeyCheck('prepayment_overrides_period_valid', 'period'),`. Den Kommentar über der Tabelle ändern in: „Tatsächlich gezahlte Vorauszahlung eines Abrechnungszeitraums (#208). Sie hat Vorrang vor der Staffel, weil rechtlich zählt, was geflossen ist. Anders als die Staffeln ist sie nach **Zeitraum** geschlüsselt und nicht nach Datum; der zusammengesetzte Primärschlüssel sagt genau das.“ Im Kommentar zu `amount_cents` „Jahressumme“ durch „Summe des Zeitraums“ ersetzen.
- `costItems`: `year` löschen, `period: text('period').$type<PeriodKey>().notNull(),`; Index `index('cost_items_property_period_idx').on(t.propertyId, t.period),` (statt `cost_items_property_year_idx`, Kommentar: „Der einzige Filter, den der Schnappschuss wirklich setzt: die Kostenpositionen eines Abrechnungszeitraums (siehe snapshot.ts), innerhalb eines Objekts.“), dazu `periodKeyCheck('cost_items_period_valid', 'period'),`.
- `closedSettlements`: `year` löschen, `period: text('period').$type<PeriodKey>().notNull(),`; `uniqueIndex('closed_settlements_property_period_idx').on(t.propertyId, t.period),` (Kommentar „je Objekt und Zeitraum höchstens eine“), dazu `periodKeyCheck('closed_settlements_period_valid', 'period'),`.
- `closedSettlementHistory`: ebenso, `index('closed_settlement_history_property_period_idx').on(t.propertyId, t.period),` und `periodKeyCheck('closed_settlement_history_period_valid', 'period'),`.
- `assessments`: `requestedYear` samt Kommentar und `check('assessments_requested_year_positive', …)` löschen; Kommentar an `requestedPeriod`: „Der gewählte Abrechnungszeitraum (#208): beim Auswerten mitgeschickt, danach der von Hand gesetzte. Nur mit Objekt (G-B7): Ein Zeitraum ist nur am Objekt bestimmt.“; Bedingungen:
  ```ts
      check('assessments_requested_period_with_property', sql.raw('"requested_period" IS NULL OR "property_id" IS NOT NULL')),
      periodKeyCheck('assessments_requested_period_valid', 'requested_period'),
  ```

Run: `npm --prefix server run db:generate -- --name zeitraum_pflicht`
Expected: keine Rückfrage; `drizzle/0015_zeitraum_pflicht.sql` beginnt mit `PRAGMA foreign_keys=OFF;` und baut `assessments`, `closed_settlement_history`, `closed_settlements`, `cost_items`, `prepayment_overrides`, `period_changes` und `properties` neu. Prüfen, dass das Umkopieren `period` mitnimmt und `year` nicht mehr kennt:

Run: `grep -c 'INSERT INTO `__new_' server/drizzle/0015_zeitraum_pflicht.sql && grep -n '"year"' server/drizzle/0015_zeitraum_pflicht.sql`
Expected: `7`, danach nur Zeilen von `__new_assessments` (dort bleibt `"year"` das Kalenderjahr des Belegs).

- [ ] **Step 7: Marken eintragen**

Run:
```bash
node --input-type=module -e "const { loadMigrations } = await import('./server/src/db/client.ts'); for (const m of await loadMigrations()) if (m.tag >= '0014') console.log(\`  '\${m.tag}': '\${m.hash}',\`)"
```
Expected: zwei Zeilen `'0014_zeitraum': '<64 Hex>'` und `'0015_zeitraum_pflicht': '<64 Hex>'`.

In `server/test/migrations.test.ts` hinter `'0013_belegbuchung'` einfügen:

```ts
  // Abrechnungszeitraum (#208). Eingetragen vor dem Merge, wie 0001: Jeder Push auf main
  // veröffentlicht das Image, und ab dann haben Nutzer die Schritte angewendet. Werden 0014 oder
  // 0015 vor dem Push neu erzeugt, hier die neue Marke eintragen.
  '0014_zeitraum': '<Marke aus der Ausgabe>',
  '0015_zeitraum_pflicht': '<Marke aus der Ausgabe>',
```

(Die beiden Platzhalter in spitzen Klammern sind die eben ausgegebenen Werte; sie hängen am
erzeugten Inhalt und lassen sich nicht vorab nennen.)

- [ ] **Step 8: `schema.test.ts` an Spalten und Typen anpassen**

```ts
// statt `type _Overrides = Assert<Equals<OverrideRow['year'], number>>` samt Kommentar:
// `prepaymentOverrides` ist im Modell `Record<string, number>`, Zeitraum auf Betrag (#208). In der
// Tabelle sind daraus zwei Spalten geworden; geprüft wird, dass der Schlüssel ein Zeitraumschlüssel
// ist und der Wert den Typ behält, den der Record vorgibt.
type _Overrides = Assert<Equals<OverrideRow['period'], PeriodKey>>
```

```ts
// CostItemColumns: `year` ist abgeleitet und keine Spalte; `period` ist im Modell noch optional,
// in der Tabelle Pflicht (#208).
type CostItemColumns = Omit<CostItem, 'year' | 'period' | 'customShares' | 'participantUnitIds' | 'tenancyAmounts' | 'selfAmounts' | 'externalBasis'> & {
  period: PeriodKey
```
(die übrigen Felder des Objekttyps darunter bleiben).

```ts
// Abgeschlossene Abrechnungen: `ClosedSettlement` beschreibt die db.json mit Jahr; die Tabelle trägt
// seit #92 ein Objekt und seit #208 den Zeitraum statt des Jahres.
type ClosedWithProperty = Omit<ClosedSettlement, 'year'> & { propertyId: string, period: PeriodKey }
```

```ts
// --- Wechsel des Rhythmus (#208) ---
type PeriodChangeRow = typeof schema.periodChanges.$inferSelect
type _PeriodChangeMonth = Assert<Equals<PeriodChangeRow['fromMonth'], PeriodRules['changes'][number]>>
```

`PeriodKey` und `PeriodRules` in den Typimport aus `shared/types.ts` aufnehmen. In der Liste des Tests
„Migration lässt sich anwenden und legt alle Tabellen an“ `'period_changes',` zwischen `'payments'`
und `'person_history'` einfügen. Die rohen `INSERT`-Anweisungen dieser Datei schreiben jetzt `period`:

```bash
node -e "
const fs = require('node:fs'); const f = 'server/test/schema.test.ts'
const out = fs.readFileSync(f, 'utf8').split('\n').map((line) =>
  /INSERT INTO (cost_items|prepayment_overrides|closed_settlements) \(/.test(line) && line.includes(' year,')
    ? line.replace(' year,', ' period,').replace(/, (\d{4}),/, \", '\$1-01',\")
    : line).join('\n')
fs.writeFileSync(f, out)"
```

Run: `grep -n "year" server/test/schema.test.ts | grep INSERT`
Expected: keine Ausgabe.

- [ ] **Step 9: Lesen (`server/src/db/read.ts`)**

Import ergänzen: `periodChanges` aus `./schema.ts`, `startYearOf` aus `'../../../shared/period.ts'`,
`PeriodKey` als Typ. Dann:

```ts
// StoredClosedSettlement: `year: number` ersetzen durch
  // Der Zeitraum der Abrechnung (#208).
  period: PeriodKey
```

```ts
export async function readProperties(db: Database): Promise<Property[]> {
  const rows = await db.select().from(properties).orderBy(INSERTION_ORDER)
  // Die Wechsel aufsteigend nach Monat, nicht nach Anlage: shared/period.ts verlangt sie so.
  const changeRows = await db.select().from(periodChanges).orderBy(periodChanges.fromMonth)
  const changes = groupBy(changeRows, (r) => r.propertyId, (r) => r.fromMonth)
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    address: p.address,
    // Hier bleibt `null` stehen und wird nicht zu `undefined`: Es heißt „die Vorgabe gilt“ und
    // ist damit eine Auskunft, kein fehlendes Feld.
    landlordName: p.landlordName,
    iban: p.iban,
    paymentDeadlineDays: p.paymentDeadlineDays,
    cableBuiltBeforeDec2021: p.cableBuiltBeforeDec2021,
    // Der Rhythmus (#208). Immer mitgeliefert, damit niemand ihn erraten muss.
    periodRules: { startMonth: p.periodStartMonth, changes: changes.get(p.id) ?? [] },
  }))
}
```

In `readTenancies` die Jahreskorrektur:

```ts
  // Die Jahreskorrektur wird gleich zu einem Objekt (`Object.fromEntries`), deshalb Paare,
  // geschlüsselt nach Zeitraum (#208).
  const overrides = groupBy(overrideRows, (r) => r.tenancyId, (r): [string, number] => [r.period, r.amountCents])
```

Neben `StoredClosedSettlement`:

```ts
// Eine Kostenposition, wie sie aus der Datenbank kommt: mit Zeitraum (#208).
export type StoredCostItem = CostItem & { period: PeriodKey }
```

`Stock.costItems: StoredCostItem[]`, `readCostItems(db: Database): Promise<StoredCostItem[]>`, und
statt `year: c.year,`:

```ts
      period: c.period,
      // abgeleitet, siehe CostItem in shared/types.ts
      year: startYearOf(c.period),
```

In `readClosedSettlements` statt `year: c.year,`: `period: c.period,`.

- [ ] **Step 10: Schreiben (`server/src/db/repository.ts`)**

Importe: `calendarPeriod, parsePeriodKey, startYearOf` aus `'../../../shared/period.ts'`, `PeriodKey`
als Typ aus `shared/types.ts`.

`readAmountsByYear` samt `YEAR_KEY` ersetzen (der Kommentar darüber bleibt, der erste Absatz wird
ersetzt):

```ts
// Jahreskorrektur: Zeitraumschlüssel ('JJJJ-MM') auf Betrag (#208). Ein Tab von vor dem Update
// schickt noch die nackte Jahreszahl („2024“); sie ist der Kalenderzeitraum 'JJJJ-01' und geht
// einem gleichzeitig mitgeschickten 'JJJJ-01' vor, denn nur ein alter Tab schreibt sie, und dann
// ist sie seine Eingabe. Ob das Objekt diesen Zeitraum hat, prüft `guardTenancy`.
//
// **Verlangt wird genau eine dieser beiden Formen**, … (bisheriger Absatz zu „2024.0“ unverändert)
const YEAR_KEY = /^\d{4}$/

function readOverrides(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  const legacy: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(Object(value))) {
    const zahl = asOptionalNumber(betrag)
    if (zahl === undefined) continue
    if (YEAR_KEY.test(schluessel)) {
      legacy[calendarPeriod(Number(schluessel))] = zahl
      continue
    }
    const key = parsePeriodKey(schluessel)
    if (key !== null) rows[key] = zahl
  }
  return { ...rows, ...legacy }
}
```

In `mergeTenancy`: `readAmountsByYear` → `readOverrides`.

Vor `mergeCostItem`:

```ts
// Der Zeitraum einer Kostenposition (#208). `period` geht vor; ein Tab von vor dem Update schickt
// stattdessen `year`, und das ist der Kalenderzeitraum dieses Jahres. Ob das Objekt den Zeitraum
// hat, prüft `guardCostItem`.
function mergedPeriod(body: unknown, current: PeriodKey): PeriodKey {
  if (has(body, 'period')) return parsePeriodKey(raw(body, 'period')) ?? current
  const year = raw(body, 'year')
  return typeof year === 'number' && Number.isInteger(year) && year > 0 && year < 10000 ? calendarPeriod(year) : current
}
```

In `mergeCostItem` statt der Zeile `year: merged(…)`:

```ts
    period,
    year: startYearOf(period),
```

mit `const period = mergedPeriod(body, current.period ?? calendarPeriod(current.year))` als erster
Zeile der Funktion (der Rückfall auf `year` fällt in Task 4 weg).

```ts
const emptyCostItem = (id: string): CostItem => ({
  id, propertyId: '', period: calendarPeriod(new Date().getUTCFullYear()), year: new Date().getUTCFullYear(), category: '', description: '', amountCents: 0, key: 'area',
  directUnitId: null, meterType: null,
})
```

In `costItemRow`: `year: c.year` → `period: c.period ?? calendarPeriod(c.year)`.

In `writeTenancyChildren` die Jahreskorrektur:

```ts
  const korrekturen = Object.entries(t.prepaymentOverrides).flatMap(([schluessel, betrag]) => {
    const period = parsePeriodKey(schluessel)
    return period === null ? [] : [{ tenancyId: t.id, period, amountCents: betrag }]
  })
  if (korrekturen.length > 0) await db.insert(prepaymentOverrides).values(korrekturen)
```

Die abgeschlossenen Abrechnungen (Funktionsköpfe und Abfragen, Kommentare „je Objekt und Jahr“ →
„je Objekt und Zeitraum“):

```ts
export async function findClosedSettlement(db: Database, propertyId: string, period: PeriodKey): Promise<StoredClosedSettlement | undefined> {
  return (await readClosedSettlements(db)).find((eintrag) => eintrag.propertyId === propertyId && eintrag.period === period)
}

const closedOf = (propertyId: string, period: PeriodKey) =>
  and(eq(closedSettlements.propertyId, propertyId), eq(closedSettlements.period, period))

export async function closeSettlement(
  db: Database,
  entry: { id: string, propertyId: string, period: PeriodKey, closedAt: string, sentAt: string | null, settlement: unknown },
): Promise<void> {
  await db.insert(closedSettlements).values(entry)
}

export async function setSentAt(db: Database, propertyId: string, period: PeriodKey, sentAt: string | null): Promise<boolean> {
  if (!(await findClosedSettlement(db, propertyId, period))) return false
  await db.update(closedSettlements).set({ sentAt }).where(closedOf(propertyId, period))
  return true
}

export async function reopenSettlement(db: Database, propertyId: string, period: PeriodKey, historyId: string): Promise<boolean> {
  const eintrag = await findClosedSettlement(db, propertyId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedSettlementHistory).values({
      id: historyId, propertyId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedSettlements).where(closedOf(propertyId, period))
  })
  return true
}

export async function settlementHistory(db: Database, propertyId: string, period: PeriodKey): Promise<SettlementHistoryEntry[]> {
  const rows = await db
    .select()
    .from(closedSettlementHistory)
    .where(and(eq(closedSettlementHistory.propertyId, propertyId), eq(closedSettlementHistory.period, period)))
    .orderBy(desc(closedSettlementHistory.reopenedAt), desc(sql`rowid`))
  return rows.map((r) => ({ id: r.id, closedAt: r.closedAt, sentAt: r.sentAt, reopenedAt: r.reopenedAt, settlement: r.settlement }))
}
```

- [ ] **Step 11: Belegbuchung (`server/src/db/assessments.ts`, `server/src/assessment.ts`, `server/src/index.ts`)**

`server/src/db/assessments.ts`, in `saveAssessment` (Zeile mit `const placement`):

```ts
    const placement = booked.length > 0 ? {} : { propertyId: head.propertyId, year: head.year, requestedPeriod: head.requestedPeriod }
```

`placeAssessment` (Import `calendarPeriod` aus `'../../../shared/period.ts'`):

```ts
export async function placeAssessment(db: Database, id: string, change: { year?: number; propertyId?: string | null }): Promise<'ok' | 'missing' | 'booked'> {
  const current = await readAssessment(db, id)
  if (!current) return 'missing'
  const moves = (change.propertyId !== undefined && change.propertyId !== current.assessment.propertyId) ||
    (change.year !== undefined && change.year !== current.assessment.year)
  if (moves && current.lines.some((l) => l.costItemId !== null)) return 'booked'
  if (change.year === undefined && change.propertyId === undefined) return 'ok'
  const propertyId = change.propertyId !== undefined ? change.propertyId : current.assessment.propertyId
  // Der gewählte Zeitraum hängt am Objekt (#208, Prüfbedingung „nur mit Objekt“): ohne Objekt
  // keiner; ein von Hand gesetztes Jahr ist zugleich das gewählte.
  // Brücke Kalenderjahr (#208): bis PR 3
  const requestedPeriod = propertyId === null ? null
    : change.year !== undefined ? calendarPeriod(change.year)
      : current.assessment.requestedPeriod
  await db.update(assessments).set({ ...change, requestedPeriod }).where(eq(assessments.id, id))
  return 'ok'
}
```

`server/src/assessment.ts`, Import `startYearOf` aus `'../../shared/period.ts'`; in
`describeAssessment` statt `const otherYear = …` und der `reasons.push`-Zeile:

```ts
  // Brücke Kalenderjahr (#208): bis PR 3. Gewählt ist ein Kalenderzeitraum; verglichen wird sein Jahr.
  const requestedYear = a.requestedPeriod === null ? null : startYearOf(a.requestedPeriod)
  const otherYear = requestedYear !== null && requestedYear !== a.year
```

```ts
    reasons.push(`Beleg aus ${a.year}, gewählt war ${requestedYear} — gebucht wird in ${a.year}; sonst das Jahr der Buchung ändern`)
```

`server/src/index.ts` in `rememberAssessment` (Import `calendarPeriod, startYearOf` aus
`'../../shared/period.ts'`):

```ts
      const previous = await readAssessmentOfFile(db, file.filename)
      const previousYear = previous?.assessment.requestedPeriod ? startYearOf(previous.assessment.requestedPeriod) : null
      const chosen = previous
        ? previousYear ?? (sent || null)
        : row?.year ?? (sent || null)
      const propertyId = row?.propertyId ?? asked ?? (only && more.length === 0 ? only.id : null)
      if (signal.aborted) return null
      const record = await saveAssessment(db, {
        file: file.filename,
        propertyId,
        year: detected ?? chosen ?? new Date().getUTCFullYear(),
        detectedYear: detected,
        // Das gewählte Jahr bleibt gespeichert, als Kalenderzeitraum am Objekt (#208): Weicht das
        // Jahr aus dem Beleg davon ab, ist die Ampel gelb, und „Alle grünen übernehmen“ bucht die
        // Zeile nicht ungesehen in ein anderes Jahr.
        // Brücke Kalenderjahr (#208): bis PR 3
        requestedPeriod: chosen !== null && propertyId !== null ? calendarPeriod(chosen) : null,
```

(der Rest des Aufrufs bleibt; im Kommentar Punkt 1 „`placeAssessment` setzt `requestedYear`“ →
„setzt `requestedPeriod`“).

`server/src/bookingPlan.ts` bekommt die abgeschlossenen Abrechnungen jetzt mit Zeitraum
(`ctx.stock.closedSettlements` in db/booking.ts trägt `period`). Import `calendarPeriod` aus
`'../../shared/period.ts'`, `PeriodKey` als Typ:

```ts
  // Abgeschlossene Abrechnungen aller Objekte (Integrationsdurchsicht vor 0.10): Ändert die Buchung
  // den Betrag einer Position in einem solchen Zeitraum, sagt die Vorschau es
  closed: readonly { propertyId: string; period: PeriodKey }[]
```

```ts
    if ((sum !== t.amountCents || labor !== (t.labor35aCents ?? null)) && input.closed.some((c) => c.propertyId === t.propertyId && c.period === (t.period ?? calendarPeriod(t.year)))) {
```

- [ ] **Step 12: Abgeschlossene Abrechnungen in den Routen (Brücke bis Task 6)**

`server/src/index.ts`: In den fünf Routen unter `/api/settlement/:year` wird die geprüfte Jahreszahl
an jeder Stelle, an der sie ein Repository erreicht, zu `calendarPeriod(year)`:
`findClosedSettlement(db, property, calendarPeriod(year))` (GET und POST), im POST
`closeSettlement(db, { id: newId(), propertyId: property, period: calendarPeriod(year), closedAt: …, sentAt, settlement: … })`,
`setSentAt(db, …, calendarPeriod(year), sentAt)`, `settlementHistory(db, …, calendarPeriod(year))`,
`reopenSettlement(db, …, calendarPeriod(year), newId())`. In `PUT` und `DELETE …/close` fehlt bisher
die Prüfung `Number.isInteger(year)`; vor `calendarPeriod` ergänzen:
`if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })`
(sonst wirft `calendarPeriod` bei `NaN`).

- [ ] **Step 13: Eingänge mit Jahr (`server/src/snapshot.ts`, `server/src/legacy/read.ts`, `server/src/calc.ts`)**

`server/src/snapshot.ts`, Importe `calendarPeriod, parsePeriodKey` aus `'../../shared/period.ts'`,
`PeriodKey` als Typ:

```ts
// Die Jahreskorrektur der db.json und der Datenbank von 0000 ist nach Jahr geschlüsselt („2024“),
// die Berechnung fragt nach dem Zeitraum (#208). Ein Jahr ist dort immer ein Kalenderjahr. Ein
// Schlüssel, der schon ein Zeitraum ist, bleibt; alles andere las die Berechnung nie und fällt weg.
export function overridesByPeriod(overrides: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(overrides)) {
    if (/^\d{4}$/.test(schluessel)) result[calendarPeriod(Number(schluessel))] = betrag
    else if (parsePeriodKey(schluessel) !== null) result[schluessel] = betrag
  }
  return result
}
```

`SnapshotSource.closedSettlements` und die Typparameter `X` in `ScopedSource`/`narrowToProperty`:
`{ year: number }` → `{ period: PeriodKey }`. In `snapshotOf`:

```ts
  const closed = source.closedSettlements.find((c) => c.period === calendarPeriod(year))
```

In `snapshotFromDb`:

```ts
      tenancies: db.tenancies.map((t) => ({ ...t, prepaymentOverrides: overridesByPeriod(t.prepaymentOverrides ?? {}) })),
```

```ts
      closedSettlements: db.closedSettlements.map((c) => ({
        period: calendarPeriod(c.year),
        ...frozenSettlementOf(c.settlement),
      })),
```

Den Kommentar „Der Schnappschuss reicht die Datensätze durch und kopiert sie nicht“ an
`snapshotFromDb` ergänzen: „Die Mietverhältnisse der Datei sind die Ausnahme: Ihre Jahreskorrektur
wird auf Zeiträume umgeschlüsselt (#208), und das geht nur an einer Kopie.“

`server/src/legacy/read.ts` (Importe `calendarPeriod` aus `'../../../shared/period.ts'`,
`overridesByPeriod` aus `'../snapshot.ts'`):

```ts
// StoredClosedSettlement (legacy): `year` bleibt (der Vergleich des Umstiegs liest es), dazu
  // Der Zeitraum, nach dem `SnapshotSource` sie findet (#208); auf 0000 immer ein Kalenderjahr.
  period: PeriodKey
```

```ts
  const overrides = groupBy(overrideRows, (r) => r.tenancyId, (r): [string, number] => [String(r.year), r.amountCents])
  …
    prepaymentOverrides: overridesByPeriod(Object.fromEntries(overrides.get(t.id) ?? [])),
```

```ts
// readClosedSettlements (legacy), hinter `year: c.year,`:
    period: calendarPeriod(c.year),
```

`server/src/calc.ts`, Import `calendarPeriod` aus `'../../shared/period.ts'`; in
`computePrepaymentCents`:

```ts
  // Die Jahreskorrektur steht unter dem Schlüssel des Zeitraums (#208).
  const override = tenancy.prepaymentOverrides?.[calendarPeriod(year)]
```

- [ ] **Step 14: Oberfläche (`client/src/pages/Abrechnung.tsx`, `client/src/testing/fakeBooking.ts`)**

`Abrechnung.tsx`, Import `calendarPeriod` aus `'../../../shared/period.ts'`; in `savePpOverride`:

```ts
    // Die Korrektur steht unter dem Zeitraum (#208).
    // Brücke Kalenderjahr (#208): bis PR 3
    const key = calendarPeriod(year)
    if (cents === null) delete overrides[key]
    else overrides[key] = cents
```

`client/src/testing/fakeBooking.ts`, Import `calendarPeriod` aus `'../../../shared/period.ts'`:

```ts
          id, file, propertyId, year: detected ?? opts.year, detectedYear: detected,
          requestedPeriod: propertyId === null ? null : calendarPeriod(opts.year), vendor: ex.vendor ?? null,
```

```ts
        // Wie placeAssessment: ein von Hand gesetztes Jahr ist zugleich das gewählte.
        if (method === 'PUT' && typeof year === 'number') {
          r.assessment = { ...r.assessment, year, requestedPeriod: r.assessment.propertyId === null ? null : calendarPeriod(year) }
        }
```

- [ ] **Step 15: Tests nachziehen, die Jahresschlüssel aus der Datenbank erwarteten**

Die Regel: Was aus der **Datenbank** kommt, trägt `period` (`'JJJJ-01'`) und Jahreskorrekturen
unter `'JJJJ-01'`; was eine db.json oder ein `Db` beschreibt, bleibt beim Jahr. Konkret:

- `server/test/db-objekte.test.ts`, Test „dieselbe Jahreszahl darf je Objekt einmal abgeschlossen sein“:
  in beiden `INSERT INTO closed_settlements (id, property_id, year, …)` `year` → `period` und `2024` → `'2024-01'`.
- `server/test/db-repository.test.ts`: Erwartungen an `prepaymentOverrides` aus der Datenbank:
  `{ 2024: 170000 }` → `{ '2024-01': 170000 }` (Test „PUT verschmilzt“), `{ '2024': 180000 }` →
  `{ '2024-01': 180000 }` (beide `fieldOf(…, 'prepaymentOverrides')`). Die Eingaben (`{ '2024': … }`)
  bleiben: Sie sind genau der alte Tab.
- `server/test/db-stock.test.ts`: in „Rundreise: die Probe belegt jede Spalte des Schemas“
  `NOT_IN_DB_JSON` um `'period'` ergänzen; in „Rundreise: jedes Feld des Datenmodells kommt
  zurück“ (Import `calendarPeriod` aus `'../../shared/period.ts'`, `overridesByPeriod` aus
  `'../src/snapshot.ts'`):
  ```ts
      assert.deepStrictEqual(stock.tenancies, gerade.tenancies.map((t) => ({ ...t, prepaymentOverrides: overridesByPeriod(t.prepaymentOverrides) })), 'Mietverhältnisse')
      assert.deepStrictEqual(stock.costItems, inObjekt1(gerade.costItems).map((c) => ({ ...c, period: calendarPeriod(c.year) })), 'Kostenpositionen')
  ```
  (`gerade.costItems` trägt `year`, das abgeleitete `year` der Datenbank stimmt damit überein.)
- `server/test/calc.test.ts`, Test „Vorauszahlungen: manuelle Jahres-Korrektur hat Vorrang“:
  `prepaymentOverrides: { '2025': 165000 }` → `{ '2025-01': 165000 }` (das Mietverhältnis geht
  unmittelbar an `computePrepaymentCents`, nicht durch die db.json).
- `server/test/calc-rueckstand.test.ts`, Test „Rückstand mit gesetzter Jahreskorrektur“:
  `{ '2025': 72000 }` → `{ '2025-01': 72000 }`.
- `server/test/calc-steuer-eigennutzung.test.ts`: die fünf Einträge
  `closedSettlements: [{ year: 2025, …` → `[{ period: calendarPeriod(2025), …` (Import
  `calendarPeriod` aus `'../../shared/period.ts'`).
- `server/test/snapshot-property.test.ts`: in `closedSettlements` `year: 2024` → `period: calendarPeriod(2024)`
  (Import wie oben).
- `server/test/api.test.ts`: Helfer `closedOf`:
  ```ts
  const closedOf = async (s: { dataDir: string }, year: number) =>
    (await inDatabase(s, readClosedSettlements)).find((c) => c.period === calendarPeriod(year))
  ```
  und die Erwartungen an `requestedYear` (Import `calendarPeriod` aus `'../../shared/period.ts'`):
  `[a.detectedYear, a.year, a.requestedYear], [2025, 2025, 2024]` → `[a.detectedYear, a.year, a.requestedPeriod], [2025, 2025, '2024-01']`;
  `[chosen.requestedYear, …], [2025, …]` → `[chosen.requestedPeriod, …], ['2025-01', …]`;
  `[null, 2023, 2023]` → `[null, 2023, '2023-01']`; `[2025, 2025, 2025]` → `[2025, 2025, '2025-01']`;
  `[a.year, a.requestedYear], [2026, 2024]` → `[a.year, a.requestedPeriod], [2026, '2024-01']`.
- `server/test/bookingResponse.test.ts`, `server/test/assessment.test.ts`,
  `client/src/assessment.test.ts`, `client/src/pages/booking.test.tsx`: in den gespeicherten
  Auswertungen `requestedYear: N` → `requestedPeriod: calendarPeriod(N)` (jeweils mit Objekt;
  Import aus dem passenden relativen Pfad zu `shared/period.ts`).
- `client/src/pages/Abrechnung.test.tsx`: `prepaymentOverrides: { [String(YEAR)]: 50000 }` →
  `{ [calendarPeriod(YEAR)]: 50000 }`.

Run: `npm run typecheck`
Expected: keine Fehler. Bleibt eine Meldung `Property 'period' is missing in type …` oder
`'requestedYear' does not exist`, ist es eine weitere Stelle derselben Regel.

- [ ] **Step 16: Run all tests**

Run: `npm test`
Expected: PASS, darunter `db-zeitraum.test.ts` (5 Tests), `migrations.test.ts`, `schema.test.ts`,
`db-objekte.test.ts` (alle Fixtures „rechnet nach dem Update centgenau wie vorher“),
`settlement-golden.test.ts`, `db-golden.test.ts` ohne Änderung ihrer Erwartungen.

- [ ] **Step 17: Commit**

```bash
git add shared/types.ts server/src server/drizzle server/test client/src
git commit -m "Zeitraum: Datenbank führt period statt year (Migration 0014/0015)

Refs #208"
```

---
### Task 3: Schreibprüfungen, Objekt löschen, Wiederherstellen

Ein Schlüssel ist formal gültig, sobald die Prüfbedingung ihn annimmt; ob das Objekt diesen
Zeitraum hat, weiß nur `shared/period.ts`. Diese Aufgabe sorgt dafür, dass kein Schlüssel ohne
Zeitraum hineinkommt: beim Schreiben (400 mit Satz), beim Wiederherstellen (Ablehnung vor dem
Ersetzen), und dass die neue Prüfbedingung „nur mit Objekt“ das Löschen eines Objekts nicht
blockiert.

**Files:**
- Modify: `server/src/db/repository.ts`, `server/src/db/backup.ts`, `server/src/index.ts` (Fehlerbehandlung)
- Test: `server/test/db-zeitraum.test.ts` (ergänzen), `server/test/db-backup.test.ts` (ergänzen)

**Interfaces:**
- Consumes (Task 1, 2): `periodOfKey`, `parsePeriodKey`, `isCalendarRules`, `rulesOf`, `calendarPeriod`; Tabellen `periodChanges`, `assessments`; `readProperties`.
- Produces:
  - `class PeriodError extends Error { status = 400 }` (repository.ts)
  - `orphanPeriodKeys(db: Database): Promise<string[]>` (repository.ts)
  - `Collection<T>.guard: (db: Executor, before: T | null, after: T, body: unknown) => Promise<void>`; `guardCostItem` und `guardTenancy` mit vier Parametern

- [ ] **Step 1: Write the failing tests**

An `server/test/db-zeitraum.test.ts` anhängen (Importe ergänzen: `eq` aus `'drizzle-orm'`;
`createProperty, findEntity, PeriodError, removeProperty, updateEntity, updateProperty` aus
`'../src/db/repository.ts'`; `properties` aus `'../src/db/schema.ts'`):

```ts
// Einen Rhythmus kann in dieser Version nur die Datenbank selbst setzen (Bedienung: PR 3).
const setStartMonth = (opened: Awaited<ReturnType<typeof openDatabase>>, month: number) =>
  opened.write(async (db) => { await db.update(properties).set({ periodStartMonth: month }).where(eq(properties.id, 'objekt-1')) })

const position = (over: Record<string, unknown>) => ({ propertyId: 'objekt-1', category: 'Grundsteuer', description: 'G', amountCents: 1, key: 'area', ...over })

test('Schreiben: eine Position braucht einen Zeitraum ihres Objekts; year eines alten Tabs nur beim Kalenderobjekt', async () => {
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    // Kalenderobjekt: die Jahreszahl eines alten Tabs geht, ein Zeitraum ab Mai nicht.
    await opened.write((db) => createEntity(db, 'costItems', 'c1', position({ year: 2025 })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c2', position({ period: '2025-05' }))),
      (err: unknown) => err instanceof PeriodError && /Zeitraum 2025-05, den es für Objekt/.test(err.message))
    // Mai bis April: '2025-05' geht; '2025-01' gibt es nicht; die Jahreszahl eines alten Tabs fiele
    // still in einen Zeitraum, der zufällig im Januar beginnt, und wird abgelehnt.
    await setStartMonth(opened, 5)
    await opened.write((db) => createEntity(db, 'costItems', 'c3', position({ period: '2025-05' })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c4', position({ period: '2025-01' }))), PeriodError)
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c5', position({ year: 2025 }))),
      (err: unknown) => err instanceof PeriodError && /älter als das Programm/.test(err.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'c3', { year: 2025, amountCents: 5 })), PeriodError)
    const c3 = await opened.read((db) => findEntity(db, 'costItems', 'c3'))
    assert.equal(Reflect.get(c3 ?? {}, 'amountCents'), 1, 'abgelehnt heißt: nichts geändert')
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: Jahreskorrektur nur unter einem Zeitraum des Objekts; die Jahreszahl eines alten Tabs nur beim Kalenderobjekt', async () => {
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2025': 1 } }))
    await setStartMonth(opened, 5)
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { prepaymentOverrides: { '2025-05': 2 } }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'tenancies', 't1', { prepaymentOverrides: { '2025': 3 } })),
      (err: unknown) => err instanceof PeriodError && /älter als das Programm/.test(err.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'tenancies', 't1', { prepaymentOverrides: { '2025-01': 3 } })),
      (err: unknown) => err instanceof PeriodError && /Jahreskorrektur von „A“ steht unter dem Zeitraum 2025-01/.test(err.message))
    // Eine Änderung ohne Jahreskorrektur im Rumpf (der Auszug) geht weiter.
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { end: '2026-04-30' }))
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Ein Objekt löschen, an dem eine Auswertung mit gewähltem Zeitraum hängt, gelingt', async () => {
  // Review Focus 2: `ON DELETE SET NULL` träfe die Prüfbedingung „gewählter Zeitraum nur mit Objekt“.
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Gartenweg 3', kind: 'mfh', address: '' }))
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a2', file: 'b.pdf', propertyId: 'objekt-2', year: 2025, requestedPeriod: periodKey('2025-01'), createdAt: '2026-01-01T00:00:00Z' })
    })
    assert.deepEqual(await opened.write((db) => removeProperty(db, 'objekt-2')), { removed: true })
    const [row] = await opened.read((db) => db.select().from(assessments))
    assert.deepEqual([row?.propertyId, row?.requestedPeriod], [null, null])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Der Rhythmus lässt sich in dieser Version nicht über die Objekte setzen (Bedienung: PR 3)', async () => {
  // Bleibt grün und hält fest, dass es keine Hintertür gibt: Ein Wechsel ohne Vorschau ließe
  // Positionen und Jahreskorrekturen ohne Zeitraum zurück.
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    const p = await opened.write((db) => updateProperty(db, 'objekt-1', { periodRules: { startMonth: 5, changes: ['2026-05'] }, periodStartMonth: 5 }))
    assert.deepEqual(p?.periodRules, { startMonth: 1, changes: [] })
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
```

An `server/test/db-backup.test.ts` anhängen:

```ts
test('Ein Archiv mit einem Zeitraum, den es für sein Objekt nicht gibt, wird beanstandet (#208)', async () => {
  // Review Focus 4: von Hand den Beginnmonat auf Mai gestellt, ohne die Position umzuschlüsseln.
  // Die Position stünde dann in keiner Abrechnung, und niemand bemerkte es.
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    const bearbeitet = await connect(ziel)
    bearbeitet.exec("UPDATE properties SET period_start_month = 5 WHERE id = 'objekt-1'")
    bearbeitet.close()
    const befund = await archiveDatabaseProblem(ziel)
    assert.ok(befund, 'es gibt eine Beanstandung')
    assert.match(befund, /Abrechnungszeiträumen, die es für ihr Objekt nicht gibt/)
    assert.match(befund, /„Gebühren“ steht unter dem Zeitraum 2024-01/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/db-zeitraum.test.ts test/db-backup.test.ts`
Expected: FAIL. Der Übersetzer kennt `PeriodError` nicht; nach einem vorläufigen Export schlagen
die beiden Schreibtests fehl (kein Fehler geworfen), das Löschen mit
`CHECK constraint failed: assessments_requested_period_with_property`, das Archiv mit `befund === null`.
Der Test zum Rhythmus ist grün.

- [ ] **Step 3: Implement (`server/src/db/repository.ts`)**

Importe ergänzen: `isCalendarRules, periodOfKey, rulesOf` aus `'../../../shared/period.ts'`,
`PeriodRules` als Typ, `periodChanges` aus `'./schema.ts'`.

Hinter `class CrossPropertyError`:

```ts
// Ein Zeitraum, den es für das Objekt nicht gibt, oder die Jahreszahl eines alten Tabs bei einem
// Objekt mit eigenem Rhythmus (#208). Die Meldung ist für den Nutzer geschrieben; die Route gibt
// sie mit 400 weiter wie `CrossPropertyError`.
export class PeriodError extends Error {
  status = 400
}

const OLD_TAB =
  'Diese Seite ist älter als das Programm und kennt die Abrechnungszeiträume dieses Objekts noch nicht. ' +
  'Bitte laden Sie die Seite neu; gespeichert wurde nichts.'

const YEAR_ONLY = /^\d{4}$/

async function rulesForProperty(db: Executor, propertyId: string): Promise<PeriodRules> {
  const [row] = await db.select({ startMonth: properties.periodStartMonth }).from(properties).where(eq(properties.id, propertyId))
  const changes = await db.select({ fromMonth: periodChanges.fromMonth }).from(periodChanges)
    .where(eq(periodChanges.propertyId, propertyId)).orderBy(periodChanges.fromMonth)
  return { startMonth: row?.startMonth ?? 1, changes: changes.map((c) => c.fromMonth) }
}

// Wirft, wenn ein Schlüssel keinen Zeitraum des Objekts bezeichnet. `legacyYear` heißt: Der Rumpf
// kam mit einer nackten Jahreszahl, also von einem Tab von vor dem Update. Sie gilt nur bei einem
// reinen Kalenderobjekt; sonst fiele die Eingabe still in einen Zeitraum, der zufällig im Januar
// beginnt (bei einem Wechsel ab Mai der Rumpf).
async function requirePeriods(db: Executor, propertyId: string, keys: readonly string[], legacyYear: boolean, what: string): Promise<void> {
  if (keys.length === 0 && !legacyYear) return
  const rules = await rulesForProperty(db, propertyId)
  if (legacyYear && !isCalendarRules(rules)) throw new PeriodError(OLD_TAB)
  for (const key of keys) {
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(rules, period) === null) {
      throw new PeriodError(
        `${what} steht unter dem Zeitraum ${key}, den es für Objekt ${await propertyName(db, propertyId)} nicht gibt. ` +
          'Bitte wählen Sie einen Abrechnungszeitraum des Objekts.',
      )
    }
  }
}
```

`guardMeter`, `guardUnit` und `noGuard` bekommen den vierten Parameter nicht (TypeScript erlaubt
weniger Parameter). `guardCostItem` und `guardTenancy`:

```ts
async function guardCostItem(db: Executor, _before: CostItem | null, after: CostItem, body: unknown): Promise<void> {
  // Der Zeitraum (#208) muss zum Objekt gehören. `year` ohne `period` schickt nur ein alter Tab.
  await requirePeriods(db, after.propertyId, [after.period ?? calendarPeriod(after.year)], has(body, 'year') && !has(body, 'period'), 'Die Kostenposition')
  // … der bisherige Rumpf ab „Die Wohnungen der Einzelbeträge …“ unverändert
}
```

```ts
async function guardTenancy(db: Executor, before: Tenancy | null, after: Tenancy, body: unknown): Promise<void> {
  // Die Jahreskorrektur (#208): jeder Schlüssel ein Zeitraum des Objekts der Wohnung. Eine
  // vierstellige Jahreszahl im Rumpf schickt nur ein alter Tab.
  const sent = raw(body, 'prepaymentOverrides')
  const legacyYear = isObject(sent) && Object.keys(Object(sent)).some((k) => YEAR_ONLY.test(k))
  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, after.unitId))
  if (unit) await requirePeriods(db, unit.propertyId, Object.keys(after.prepaymentOverrides), legacyYear, `Die Jahreskorrektur von „${after.tenantName}“`)
  await guardTenancyMove(db, before, after)
}

// Ein Mietverhältnis erbt sein Objekt über die Wohnung. … (bisheriger Kommentar)
async function guardTenancyMove(db: Executor, before: Tenancy | null, after: Tenancy): Promise<void> {
  // … der bisherige Rumpf von guardTenancy unverändert
}
```

`Collection.guard` und die Aufrufe bekommen den Rumpf:

```ts
  guard: (db: Executor, before: T | null, after: T, body: unknown) => Promise<void>
```

- `createEntity`: `await c.guard(tx, null, entity, body)`
- `updateEntity`: `await c.guard(tx, current, entity, body)`
- `insertCostItemIn`: `await guardCostItem(tx, null, entity, body)`; die Funktion für das Ändern
  darunter (`mergeCostItem(current, body)`) ebenso: `await guardCostItem(tx, current, entity, body)`
- `changeTenant`: `await guardTenancy(tx, current, beendet, { end })` und
  `await guardTenancy(tx, null, nachmieter, nachmieterRumpf)`

`removeProperty`, die letzte Zeile `await db.delete(properties)…` ersetzen:

```ts
  // Eine Auswertung verliert mit ihrem Objekt auch den gewählten Zeitraum (#208): Der Fremdschlüssel
  // setzt `property_id` auf NULL, und ein Zeitraum ohne Objekt verletzte die Prüfbedingung.
  await db.transaction(async (tx) => {
    await tx.update(assessments).set({ requestedPeriod: null }).where(eq(assessments.propertyId, id))
    await tx.delete(properties).where(eq(properties.id, id))
  })
```

Hinter `crossPropertyViolations`:

```ts
// Zeitraumschlüssel, die für ihr Objekt keinen Zeitraum bezeichnen (#208), als lesbare Sätze. Über
// die Routen entsteht keiner (die Schreibprüfungen oben); in einem Archiv kann einer stehen, etwa von
// Hand bearbeitet. Was darunter steht, erschiene in keiner Abrechnung.
export async function orphanPeriodKeys(db: Database): Promise<string[]> {
  const rulesById = new Map((await readProperties(db)).map((p) => [p.id, rulesOf(p)]))
  const befunde: string[] = []
  const pruefe = (propertyId: string | null, key: string, was: string): void => {
    const rules = propertyId === null ? undefined : rulesById.get(propertyId)
    if (!rules) return
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(rules, period) === null) befunde.push(`${was} steht unter dem Zeitraum ${key}, den es für das Objekt nicht gibt.`)
  }
  for (const c of await db.select({ propertyId: costItems.propertyId, period: costItems.period, description: costItems.description }).from(costItems)) {
    pruefe(c.propertyId, c.period, `Die Kostenposition „${c.description}“`)
  }
  for (const c of await db.select({ propertyId: closedSettlements.propertyId, period: closedSettlements.period }).from(closedSettlements)) {
    pruefe(c.propertyId, c.period, 'Eine abgeschlossene Abrechnung')
  }
  for (const c of await db.select({ propertyId: closedSettlementHistory.propertyId, period: closedSettlementHistory.period }).from(closedSettlementHistory)) {
    pruefe(c.propertyId, c.period, 'Ein früherer Abschluss')
  }
  const korrekturen = await db
    .select({ propertyId: units.propertyId, period: prepaymentOverrides.period, tenantName: tenancies.tenantName })
    .from(prepaymentOverrides)
    .innerJoin(tenancies, eq(prepaymentOverrides.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
  for (const k of korrekturen) pruefe(k.propertyId, k.period, `Die Jahreskorrektur von „${k.tenantName}“`)
  for (const a of await db.select({ propertyId: assessments.propertyId, period: assessments.requestedPeriod, file: assessments.file }).from(assessments)) {
    if (a.period !== null) pruefe(a.propertyId, a.period, `Die Auswertung des Belegs „${a.file}“`)
  }
  return befunde
}
```

- [ ] **Step 4: Implement (`server/src/db/backup.ts`, `server/src/index.ts`)**

`backup.ts`: Import `orphanPeriodKeys` neben `crossPropertyViolations`; hinter dem Block
`if (kreuz.length > 0) { … }`:

```ts
    // Ein Zeitraumschlüssel, den es für sein Objekt nicht gibt (#208): Was darunter steht, erschiene
    // in keiner Abrechnung. Über die Oberfläche entsteht das nicht; in einem Archiv kann es stehen.
    const waisen = await orphanPeriodKeys(connection.db)
    if (waisen.length > 0) {
      return (
        `Die Datenbank in diesem Archiv enthält Angaben unter Abrechnungszeiträumen, die es für ihr ` +
        `Objekt nicht gibt, deshalb wurde nichts davon übernommen. Ihre bisherigen Daten sind ` +
        `unverändert. ${waisen.slice(0, 3).join(' ')}`
      )
    }
```

`index.ts`: `PeriodError` aus `./db/repository.ts` importieren und in der Fehlerbehandlung neben
`CrossPropertyError` aufnehmen:

```ts
  if (err instanceof RouteProblem || err instanceof CrossPropertyError || err instanceof PeriodError || err instanceof TenantChangeError || err instanceof BookingRefusal) {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix server test -- test/db-zeitraum.test.ts test/db-backup.test.ts test/db-repository.test.ts && npm run typecheck`
Expected: PASS (db-zeitraum jetzt 9 Tests), typecheck ohne Fehler.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/src/db/repository.ts server/src/db/backup.ts server/src/index.ts server/test/db-zeitraum.test.ts server/test/db-backup.test.ts
git commit -m "Zeitraum: nur Zeiträume des Objekts annehmen, Archive mit fremden Schlüsseln ablehnen

Refs #208"
```

---
### Task 4: Die Kostenposition kennt nur noch ihren Zeitraum

`year` verschwindet aus `CostItem`, `period` wird Pflicht. Alles, was Kostenpositionen eines Jahres
suchte, sucht jetzt nach Schlüssel: der Schnappschuss, der Vorjahresvergleich (#141), die Suche nach
Doppelungen, die Belegbuchung und die Oberfläche. Wo die Oberfläche und die Belegbuchung noch in
Kalenderjahren denken, übersetzen markierte Brücken mit `calendarPeriod`. Die Berechnung rechnet in
dieser Aufgabe weiter über das Kalenderjahr (`snapshotOf(source, year)`); Task 5 stellt sie auf P um.
Bei einem Kalenderobjekt ändert sich nichts Sichtbares.

**Files:**
- Modify: `shared/types.ts`, `shared/allocation.ts`, `shared/duplicates.ts`, `shared/assessment.ts`, `shared/costItem.ts`
- Modify: `server/src/store.ts`, `server/src/snapshot.ts`, `server/src/legacy/read.ts`, `server/src/db/read.ts`, `server/src/db/repository.ts`, `server/src/calc.ts`, `server/src/assessment.ts`, `server/src/bookingPlan.ts`, `server/src/index.ts`
- Modify: `client/src/year.tsx`, `client/src/carryOver.ts`, `client/src/costForm.ts`, `client/src/receipts.ts`, `client/src/unitForm.ts`, `client/src/pages/Abrechnung.tsx`, `client/src/pages/Belege.tsx`, `client/src/pages/Cockpit.tsx`, `client/src/pages/Kosten.tsx`, `client/src/pages/Uebersicht.tsx`
- Test: `server/test/allocation.test.ts`, `server/test/duplicates.test.ts`, `server/test/api.test.ts` (je ein neuer Test); Modify per Umschreiber: die Tests aus Step 9

**Interfaces:**
- Consumes (Task 1–3): `PeriodContext`, `calendarContext`, `calendarPeriod`, `startYearOf`; `CostItem.period`.
- Produces:
  - `CostItem.period: PeriodKey` (Pflicht), kein `CostItem.year`
  - `LegacyCostItem` (store.ts) trägt `year: number` selbst
  - `SnapshotCostItem` pickt `'period'` statt `'year'`
  - `AllocatedItem = Pick<CostItem, 'category' | 'key' | 'description'> & Partial<Pick<CostItem, 'period' | 'meterType' | 'directUnitId' | 'customShares' | 'participantUnitIds' | 'externalBasis'>>`
  - `previousPeriodItems(items, category, previous: PeriodKey)`, `comparablePrevious(items, category, at: PeriodContext, description?)`, `previousAllocation(items, category, at: PeriodContext, description?)`
  - `DuplicateItem = Pick<CostItem, 'id' | 'period' | 'category' | 'description'> & Partial<…>`, `CostQuery.period: PeriodKey`, `possibleDuplicates(items, at: PeriodContext, previous?)`
  - `categoryDeviationPct(items, category, at: PeriodContext, amountCents, replacedCents?)`
  - `CostItemBody.period: PeriodKey`, `costItemBody(d, units, period: PeriodKey)`, `closedPeriodNotice(label: string)` (ersetzt `closedYearNotice`)
  - `useYear(): { year: number; setYear: (y: number) => void; period: PeriodKey }`
  - `GET /api/costItems` liefert bei einem reinen Kalenderobjekt zusätzlich `year` (für alte Tabs)

- [ ] **Step 1: Write the failing tests**

An `server/test/allocation.test.ts` anhängen (Importe: `periodContext, periodKey, periodOfKey` aus
`'../../shared/period.ts'`, `PeriodRules` als Typ aus `'../../shared/types.ts'`):

```ts
test('Vorzeitraum: gesucht wird nach Zeitraum und nicht nach Jahreszahl (#208)', () => {
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const at = periodContext(mai, periodOfKey(mai, periodKey('2025-05')) ?? assert.fail('kein Zeitraum'))
  const items: AllocatedItem[] = [
    { period: periodKey('2024-05'), category: 'Müllabfuhr', key: 'persons', description: 'Müll' },
    // Beginnt im selben Kalenderjahr wie der Vorzeitraum, ist aber ein anderer Zeitraum.
    { period: periodKey('2024-01'), category: 'Müllabfuhr', key: 'area', description: 'Müll' },
  ]
  assert.equal(previousAllocation(items, 'Müllabfuhr', at)?.key, 'persons')
})
```

An `server/test/duplicates.test.ts` anhängen (Importe wie oben):

```ts
test('Doppelungen: nur innerhalb eines Zeitraums, der Vorzeitraum nach Schlüssel (#208)', () => {
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const at = periodContext(mai, periodOfKey(mai, periodKey('2025-05')) ?? assert.fail('kein Zeitraum'))
  const a = item({ period: periodKey('2025-05'), category: 'Grundsteuer', description: 'Grundsteuer 2025' })
  const b = item({ period: periodKey('2025-05'), category: 'Grundsteuer', description: 'Grundsteuer Nachtrag' })
  const fremd = item({ period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer 2025' })
  const vorjahr = [item({ period: periodKey('2024-05'), category: 'Grundsteuer', description: 'Grundsteuer 2024' })]
  assert.deepEqual(possibleDuplicates([a, b, fremd], at, vorjahr).map((g) => g.map((i) => i.id)), [[a.id, b.id]])
})
```

An `server/test/api.test.ts` anhängen (Review Focus 1; Import `CostItem` als Typ ist schon da, sonst
ergänzen):

```ts
test('Alter Tab: Die Kostenliste eines Kalenderobjekts nennt weiter das Jahr (#208)', async () => {
  // Ein Tab von vor dem Update filtert nach `item.year`. Ohne das Feld sähe der Vermieter eine leere
  // Liste und erfasste alles noch einmal.
  const s = await startServer()
  try {
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' }) })
    const [item] = await s.api<(CostItem & { year?: number })[]>('/api/costItems')
    assert.deepEqual([item?.period, item?.year], ['2025-01', 2025])
  } finally {
    s.stop()
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/allocation.test.ts test/duplicates.test.ts`
Expected: FAIL beim Übersetzen bzw. Laufen: `previousAllocation` erwartet eine Jahreszahl,
`DuplicateItem` kennt `period` nicht, der Vorzeitraum wird nicht gefunden. (Der Test in api.test.ts
ist grün, solange `CostItem.year` noch abgeleitet mitkommt; er bewacht Step 8.)

- [ ] **Step 3: Typen**

`shared/types.ts`, in `CostItem` die beiden Felder aus Task 2 ersetzen durch:

```ts
  // Der Abrechnungszeitraum (#208), dem die Position ganz gehört.
  period: PeriodKey
```

`server/src/store.ts`:

```ts
// Die db.json kennt Jahre, keine Zeiträume (#208): Ihre Kostenpositionen tragen `year`, und erst der
// Eingang macht daraus den Kalenderzeitraum.
export type LegacyCostItem = Omit<CostItem, 'period' | 'propertyId' | 'key' | 'participantUnitIds' | 'externalBasis' | 'tenancyAmounts' | 'selfAmounts'> & {
  key: LegacyCostKey
  year: number
}
```

`server/src/db/read.ts`: Typ `StoredCostItem` löschen, `Stock.costItems: CostItem[]`,
`readCostItems(db: Database): Promise<CostItem[]>`, die Zeile `year: startYearOf(c.period),` samt
Kommentar löschen (Import `startYearOf` entfällt).

`server/src/db/repository.ts`: in `mergeCostItem` `mergedPeriod(body, current.period)` (ohne
Rückfall), die Zeile `year: startYearOf(period),` löschen; `emptyCostItem` ohne `year`;
`costItemRow` mit `period: c.period`; in `guardCostItem` `[after.period]`.

`server/src/bookingPlan.ts`: `c.period === (t.period ?? calendarPeriod(t.year))` → `c.period === t.period`.

`server/test/schema.test.ts`:

```ts
type CostItemColumns = Omit<CostItem, 'customShares' | 'participantUnitIds' | 'tenancyAmounts' | 'selfAmounts' | 'externalBasis'> & {
```

(die Zeile `period: PeriodKey` aus Task 2 darunter wieder löschen).

- [ ] **Step 4: Gemeinsame Helfer**

`shared/allocation.ts`:

```ts
import type { CostItem, CostKey, ExternalMeasure, MeterType, PeriodKey } from './types.ts'
import type { PeriodContext } from './period.ts'

// Der Zeitraum ist optional: `allocationOf` braucht ihn nicht, nur die Suche nach dem Vorzeitraum.
export type AllocatedItem = Pick<CostItem, 'category' | 'key' | 'description'> &
  Partial<Pick<CostItem, 'period' | 'meterType' | 'directUnitId' | 'customShares' | 'participantUnitIds' | 'externalBasis'>>
```

```ts
// Die Positionen derselben Kostenart im Vorzeitraum (#208): der Zeitraum unmittelbar davor und kein
// früherer. Dieselbe Frage stellt der Hinweis der Berechnung, und § 556a BGB fragt von
// Abrechnungszeitraum zu Abrechnungszeitraum.
export function previousPeriodItems<T extends AllocatedItem>(items: readonly T[], category: string, previous: PeriodKey): T[] {
  return items.filter((i) => i.period === previous && i.category === category)
}
```

```ts
// Die Positionen des Vorzeitraums, mit denen eine Position verglichen wird. Gibt es dort eine mit
// derselben Beschreibung (Jahreszahl des Beginns ersetzt, ohne Groß- und Kleinschreibung), nur diese;
// sonst alle der Kostenart, außer bei einer breiten Kostenart, wo es dann keine gibt.
export function comparablePrevious<T extends AllocatedItem>(items: readonly T[], category: string, at: PeriodContext, description?: string): T[] {
  const prior = previousPeriodItems(items, category, at.previous)
  if (description?.trim()) {
    const wanted = normalized(description)
    const same = prior.filter((p) => normalized(replaceYear(p.description, at.previousYear, at.year)) === wanted)
    if (same.length > 0) return same
  }
  return BROAD_CATEGORIES.includes(category) ? [] : prior
}
```

```ts
export function previousAllocation(items: readonly AllocatedItem[], category: string, at: PeriodContext, description?: string): Allocation | null {
  const found = comparablePrevious(items, category, at, description).map((i) => allocationOf(i))
```

(Rest von `previousAllocation` unverändert; `previousYearItems` ist gelöscht, der Übersetzer nennt
übrige Aufrufer, sie nehmen `previousPeriodItems`.)

`shared/duplicates.ts`:

```ts
import type { CostItem, PeriodKey } from './types.ts'
import type { PeriodContext } from './period.ts'
import { BROAD_CATEGORIES } from './allocation.ts'

export type DuplicateItem = Pick<CostItem, 'id' | 'period' | 'category' | 'description'> &
  Partial<Pick<CostItem, 'propertyId' | 'vendor' | 'invoiceFile' | 'amountCents'>>

export type CostQuery = {
  propertyId?: string | null
  // Der Abrechnungszeitraum, in dem gesucht wird (#208).
  period: PeriodKey
```

In `sameCostCandidates`: `i.year === q.year` → `i.period === q.period` (Kommentar „dasselbe Jahr“ →
„derselbe Zeitraum“). Dann:

```ts
const queryOf = (i: DuplicateItem, period: PeriodKey = i.period): CostQuery => ({
  propertyId: i.propertyId, period, category: i.category, description: i.description, vendor: i.vendor, amountCents: i.amountCents, excludeId: i.id,
})

// Die Gruppen möglicher Doppelungen eines Zeitraums, … (Kommentar sonst unverändert, „Vorjahr“ →
// „Vorzeitraum“)
export function possibleDuplicates<T extends DuplicateItem>(items: readonly T[], at: PeriodContext, previous: readonly DuplicateItem[] = []): T[][] {
  const own = items.filter((i) => i.period === at.key)
```

und unten `queryOf(i, year - 1)` → `queryOf(i, at.previous)`.

`shared/assessment.ts` (Importe `calendarContext, calendarPeriod` aus `'./period.ts'`,
`PeriodContext` als Typ, `PeriodKey` als Typ aus `'./types.ts'`):

```ts
  const year = ctx.detectedYear ?? ctx.targetYear
  // Brücke Kalenderjahr (#208): bis PR 3. Die Belegbuchung bucht in den Kalenderzeitraum des Jahres.
  const period = calendarPeriod(year)
  if (vendor && ctx.amountCents !== 0) {
    const dupe = ctx.existingItems.some(
      (it) => it.period === period && it.amountCents === ctx.amountCents && (it.vendor ?? '').trim().toLowerCase() === vendor,
    )
```

```ts
  const candidates = sameCostCandidates(ctx.existingItems, { category: ctx.category, description: ctx.description ?? '', vendor: ctx.vendor, period, amountCents: ctx.amountCents })
```

```ts
// Weicht die Summe der Kostenart im Zeitraum, mit diesem Betrag, um wie viel Prozent vom Vorzeitraum
// ab? `null` ohne Vorzeitraum. … (Rest des Kommentars unverändert)
export function categoryDeviationPct(items: readonly CostItem[], category: string, at: PeriodContext, amountCents: number, replacedCents = 0): number | null {
  const sum = (key: PeriodKey) => items.filter((i) => i.period === key && i.category === category).reduce((a, i) => a + i.amountCents, 0)
  const prior = sum(at.previous)
  return prior > 0 ? ((sum(at.key) - replacedCents + amountCents - prior) / prior) * 100 : null
}
```

In `lastExternalBasis`: `(!found || i.year >= found.year)` → `(!found || i.period >= found.period)`
mit dem Kommentar „Zeitraumschlüssel 'JJJJ-MM' ordnen sich als Text wie die Zeit (#208).“ In der
Funktion mit `previousAllocation(ctx.items, category, ctx.year, description)`:

```ts
  // Brücke Kalenderjahr (#208): bis PR 3. KeyContext trägt das Jahr der Oberfläche.
  const remembered = ctx && !isNotAllocable(category) ? previousAllocation(ctx.items, category, calendarContext(ctx.year), description) : null
```

und im `allocationOf({ year: 0, category, … })` darunter `year: 0, ` löschen.

`shared/costItem.ts` (Import `PeriodKey` als Typ):

```ts
export const closedPeriodNotice = (label: string): string =>
  `Die Abrechnung ${label} ist abgeschlossen und bleibt, wie sie verschickt wurde; ändert sich dadurch der Saldo eines Mieters, zeigt die Abrechnungsseite das als Abweichung.`
```

(`closedYearNotice` löschen), in `CostItemBody` `year: number` → `period: PeriodKey`, und

```ts
export function costItemBody(d: CostItemDraft, units: readonly Unit[], period: PeriodKey): BuildResult {
  …
  const common = {
    period,
```

- [ ] **Step 5: Server: Schnappschuss, Eingang, Berechnung, Routen**

`server/src/snapshot.ts`: in `SnapshotCostItem` `| 'year'` → `| 'period'`; Kommentar „Gelesen werden
Kennung, Zeitraum, Kostenart …“. In `snapshotOf`:

```ts
  // `snapshotOf` ist der Eingang im Kalenderjahr: db.json, Umstieg, Regression und Tests. Hier ist
  // der Vorzeitraum wirklich das Vorjahr.
  const key = calendarPeriod(year)
  const previous = calendarPeriod(year - 1)
  const closed = source.closedSettlements.find((c) => c.period === key)
```

```ts
    costItems: source.costItems.filter((c) => c.period === key),
    // Der Vorzeitraum nur für den Vergleich der Schlüssel (#141) und der Doppelungen.
    previousCostItems: source.costItems.filter((c) => c.period === previous),
```

In `snapshotFromDb`: `costItems: db.costItems.map((c) => ({ ...c, period: calendarPeriod(c.year) })),`.
Den Kommentar „Nach Jahr eingegrenzt wird nur, was sein Jahr als Feld trägt“ am Kopf von `snapshotOf`
in „Nach Zeitraum eingegrenzt wird nur, was seinen Zeitraum als Feld trägt“ ändern.

`server/src/legacy/read.ts`: Stock-Typ `costItems: (CostItem & { period: PeriodKey })[]` (wobei
`CostItem` hier `LegacyCostItem` ist) und in `readCostItems` hinter `year: c.year,`:
`period: calendarPeriod(c.year),`.

`server/src/calc.ts` (Importe `calendarContext, calendarPeriod` aus `'../../shared/period.ts'`,
`PeriodContext` als Typ):

- in `taxReport` beide Filter `c.year === year` → `c.period === calendarPeriod(year)`;
- in `computeSettlement` direkt hinter `const yTo = …`:
  ```ts
    // Zeitraum und Vorzeitraum für Vergleich und Doppelungen (#208); Task 5 nimmt sie aus dem Schnappschuss.
    const at = calendarContext(year)
  ```
- `const items = snapshot.costItems.filter((c) => c.year === year)` → `c.period === at.key`;
- `possibleDuplicates(items, year, …)` → `possibleDuplicates(items, at, …)`, im Text
  `` `beide ${year}` : `${year} alle` `` → `` `beide ${at.label}` : `${at.label} alle` ``;
- `keyChangeText(item, snapshot.previousCostItems ?? [], year, basisUnitIds)` → `(…, at, basisUnitIds)` und:
  ```ts
  function keyChangeText(item: SnapshotCostItem, previous: readonly SnapshotCostItem[], at: PeriodContext, basisUnitIds: readonly string[]): string | null {
    if (isNotAllocable(item.category)) return null
    const before = comparablePrevious(previous, item.category, at, item.description).map((i) => allocationOf(i, basisUnitIds))
    …
    const what = !sameKey
      ? `„${item.description}“ wird ${at.label} ${KEY_PHRASES[now.key]} verteilt, die Kostenart „${item.category}“ ${at.previousLabel} ${KEY_PHRASES[first.key]}.`
      : `„${item.description}“ wird ${at.label} wieder ${KEY_PHRASES[now.key]} verteilt, aber mit ${
        …
      } als ${at.previousLabel}.`
  ```
  (die Zeile `const prevYear = year - 1` entfällt).

`server/src/index.ts` (Importe `isCalendarRules, rulesOf, startYearOf` aus `'../../shared/period.ts'`):

```ts
  app.get(`/api/${coll}`, async (req, res) => {
    res.json(await readData(async (db) => {
      const propertyId = await propertyOf(db, req)
      const stock = await readStock(db)
      const scoped = narrowToProperty(stock, propertyId)
      if (coll !== 'costItems') return scoped[coll]
      // Ein Tab von vor dem Update filtert die Kostenpositionen nach `year` (#208). Bei einem reinen
      // Kalenderobjekt bekommt er es weiter; sonst sähe er eine leere Liste und erfasste alles noch
      // einmal. Bei einem anderen Rhythmus gibt es kein Jahr, das stimmte; dort lehnt das Schreiben ab.
      const calendar = isCalendarRules(rulesOf(stock.properties.find((p) => p.id === propertyId)))
      return calendar ? scoped.costItems.map((c) => ({ ...c, year: startYearOf(c.period) })) : scoped.costItems
    }))
  })
```

In `/api/receipts/tax/:year`: `stock.costItems.filter((c) => c.year === year)` →
`stock.costItems.filter((c) => c.period === calendarPeriod(year))` mit dem Kommentar „Die Steuer
rechnet im Kalenderjahr (#208).“

- [ ] **Step 6: Belegbuchung auf dem Server (`server/src/assessment.ts`, `server/src/bookingPlan.ts`)**

Alle Stellen mit „Brücke Kalenderjahr (#208): bis PR 3“ kommentieren. `server/src/assessment.ts`
(Importe `calendarContext, calendarPeriod, startYearOf` aus `'../../shared/period.ts'`):

- `lineCandidates`: `sameCostCandidates(pool, { propertyId: a.propertyId, period: calendarPeriod(a.year), category: line.category, description: line.description, vendor: a.vendor ?? '' })`
  und `.filter((i) => i.period === calendarPeriod(a.year) && !same.includes(i))`;
- `replacedByLinking`: `c.year === year` → `c.period === calendarPeriod(year)`;
- `describeAssessment`: `categoryDeviationPct(ctx.items, line.category, calendarContext(a.year), deviation.amountCents, deviation.replacedCents)`
  und `costItemBody(…, ctx.units, calendarPeriod(a.year))`.

`server/src/bookingPlan.ts` (Importe `calendarPeriod, startYearOf`; `closedYearNotice` →
`closedPeriodNotice`):

- beide `costItemBody(…, input.units, a.year)` → `costItemBody(…, input.units, calendarPeriod(a.year))`;
- `sameCostCandidates(pool, { propertyId: a.propertyId, period: calendarPeriod(a.year), category: body.category, description: body.description, vendor: a.vendor ?? '' })`;
- die Jahresprüfung beim Verknüpfen:
  ```ts
      if (target.period !== calendarPeriod(a.year)) {
        errors.push({ idx: d.idx, message: `${quote(target.description)} gehört zu ${startYearOf(target.period)}, der Beleg zu ${a.year}. Ändern Sie das Jahr des Belegs oder legen Sie eine neue Position an.` })
        continue
      }
  ```
- beide `year: t.year` in `touchedItems.push` → `year: startYearOf(t.period)` (`PreviewItem.year` bleibt eine Jahreszahl);
- `closedYearNotice(t.year)` → `closedPeriodNotice(String(startYearOf(t.period)))`.

- [ ] **Step 7: Oberfläche**

Jede Stelle trägt den Kommentar `// Brücke Kalenderjahr (#208): bis PR 3`, außer den reinen
Vergleichen mit `period` aus `useYear()`.

`client/src/year.tsx`:

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react'
import { calendarPeriod } from '../../shared/period.ts'
import type { PeriodKey } from '../../shared/types.ts'

// … (Kommentar unverändert)
// `period` ist der Abrechnungszeitraum des gewählten Jahres (#208).
type YearCtx = { year: number; setYear: (y: number) => void; period: PeriodKey }
```

```tsx
export function YearProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(DEFAULT_YEAR)
  // Brücke Kalenderjahr (#208): bis PR 3. Die Oberfläche kennt in dieser Version nur Kalenderjahre;
  // PR 3 macht daraus den Zeitraum-Umschalter.
  return <Ctx.Provider value={{ year, setYear, period: calendarPeriod(year) }}>{children}</Ctx.Provider>
}
```

`client/src/pages/Cockpit.tsx`: `const { year, period } = useYear()`; `yearItems` filtert
`c.period === period` (Abhängigkeiten `[costItems, period]`); im Vorjahresvergleich:

```tsx
    const sumByCat = (key: PeriodKey) => {
      const m = new Map<string, number>()
      for (const c of costItems) if (c.period === key) m.set(c.category, (m.get(c.category) ?? 0) + c.amountCents)
      return m
    }
    const cur = sumByCat(period)
    // Brücke Kalenderjahr (#208): bis PR 3
    const prev = sumByCat(calendarPeriod(year - 1))
```

(Importe `calendarPeriod` aus `'../../../shared/period.ts'`, `PeriodKey` als Typ aus `'../types'`;
Abhängigkeiten des `useMemo` um `period` ergänzen.)

`client/src/pages/Kosten.tsx`: `const { year, period } = useYear()`; `yearItems` mit
`i.period === period`; `previousCount` mit `i.period === calendarPeriod(year - 1)` (Brücke).

`client/src/pages/Abrechnung.tsx`: `const { year, period } = useYear()`; beide
`c.year === year` → `c.period === period` (Abhängigkeiten `[costItems, period]`).

`client/src/pages/Uebersicht.tsx` (Brücke, die Seite vergleicht Kalenderjahre):
`costItems.filter((c) => startYearOf(c.period) === y)` und
`map.set(startYearOf(c.period), (map.get(startYearOf(c.period)) ?? 0) + c.amountCents)`.

`client/src/unitForm.ts`: `c.year === year` → `c.period === calendarPeriod(year)` (Brücke).

`client/src/carryOver.ts` (Brücke; Importe `calendarPeriod`):

```ts
  const previous = calendarPeriod(year - 1)
  const sisters = items
    .filter((i) => i.period === previous && i.category === category && i.id !== row.source.id)
  …
  return sameCostCandidates(items, { period: calendarPeriod(year), category, description: row.description, vendor: row.vendor ?? row.source.vendor, amountCents: row.source.amountCents })
```

```ts
export function carryOverRows(items: readonly CostItem[], year: number): CarryRow[] {
  return items.filter((i) => i.period === calendarPeriod(year - 1)).map((source) => {
```

und in `carryOverBody` den Aufruf von `costItemBody`/`buildCostItemBody` mit dem Jahr unverändert
lassen (er läuft über `buildCostItemBody` in costForm.ts, siehe unten).

`client/src/costForm.ts` (Brücke; Importe `calendarContext, calendarPeriod`):
- `previousAllocation(ctx.items, category, calendarContext(ctx.year), form.description)`;
- in `formAllocation` die Zeile `year: 0,` löschen;
- `comparablePrevious(ctx.items, form.category, calendarContext(ctx.year), form.description)`;
- in `buildCostItemBody` (bzw. `draftOf`) den Aufruf `costItemBody(…, year)` → `costItemBody(…, calendarPeriod(year))`;
- `sameCostOf`: `sameCostCandidates(items, { propertyId, period: calendarPeriod(year), category: body.category, description: body.description, vendor: body.vendor, amountCents: body.amountCents })`.

`client/src/receipts.ts` (Brücke für die ganze Datei: Der Belegordner gliedert nach Kalenderjahren,
weil Belege Kalenderjahre tragen; Import `startYearOf`):
- `years: [...new Set(linked.map((c) => startYearOf(c.period)))].sort((a, b) => b - a)`;
- `inScope`: `(f.year === 'all' || startYearOf(c.period) === f.year)`;
- `itemMatchesQuery`: `startYearOf(c.period) === Number(q)`;
- `buildFolder`: `const year = startYearOf(c.period)`, `const key = \`${year}|${c.category}\``, `g = { key, year, … }`;
- `inboxFor`: `fitsPlacement(card.upload, c.propertyId, startYearOf(c.period))`;
- `attachChoices`: `sameCostCandidates([c], { propertyId: c.propertyId, period: c.period, category, description: name })`.

`client/src/pages/Belege.tsx` (Brücke; Importe `calendarPeriod, startYearOf`, `closedYearNotice` →
`closedPeriodNotice`):
- Mieterordner: `c.year === year` → `c.period === calendarPeriod(year)`;
- `yearOptions`: `...costItems.map((c) => startYearOf(c.period))`;
- `/api/settlement/${c.year}` → `` `/api/settlement/${startYearOf(c.period)}` `` (die Route nimmt bis Task 6 nur die Jahreszahl);
- `fd.append('year', String(startYearOf(c.period)))` (Belege tragen Kalenderjahre, keine Brücke);
- `candidatesFor`: `(year === null || startYearOf(c.period) === year)` und in `.sort(…)` der erste
  Vergleich `b.year - a.year` → `startYearOf(b.period) - startYearOf(a.period)`;
- Liste: `{filter.year === startYearOf(c.period) ? '' : ` (${startYearOf(c.period)})`}`;
- Auswahl: `{startYearOf(c.period)} · {c.category} · …`;
- `closedPeriodNotice(String(startYearOf(amountCheck.item.period)))`.

- [ ] **Step 8: Run the new tests**

Run: `npm --prefix server test -- test/allocation.test.ts test/duplicates.test.ts`
Expected: Die beiden neuen Tests PASS; ältere Tests dieser Dateien scheitern noch, weil sie die
Helfer mit Jahreszahlen aufrufen und Positionen mit `year` bauen. Das behebt Step 9.

- [ ] **Step 9: Tests umschreiben**

Einmaliger Umschreiber, außerhalb des Repos (nicht einchecken), `/tmp/zeitraum-umschreiber.mjs`:

```js
// Einmaliger Umschreiber für #208: Kostenpositionen in Tests tragen `period` statt `year`.
// Aufruf: node /tmp/zeitraum-umschreiber.mjs <snapshot|fixtures> <Datei> …
import fs from 'node:fs'
import path from 'node:path'

const [mode, ...files] = process.argv.slice(2)
const FIXTURE_LINE = (line) => /amountCents/.test(line) && /category/.test(line) && !/beforeCents|afterCents|detectedYear|daysInYear|sollYearCents/.test(line)

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8')
  const before = text
  if (mode === 'snapshot') {
    text = text
      .replaceAll('${over.year}', '${startYearOf(over.period)}')
      .replace(/Pick<(SnapshotCostItem|DuplicateItem|AllocatedItem), ([^>]*)'year'/g, "Pick<$1, $2'period'")
      .replace(/\byear: (\d{4}|year)\b/g, 'period: calendarPeriod($1)')
      .replace(/(\{\s+|,\s*)year(?=\s*[,}])/g, '$1period: calendarPeriod(year)')
      .replace(/(previousAllocation|comparablePrevious|categoryDeviationPct)\(([^,]+), ('[^']*'), (\d{4})/g, '$1($2, $3, calendarContext($4)')
      .split('\n')
      .map((line) => (line.includes('possibleDuplicates(') ? line.replace(/\], (\d{4})(?=[,)])/g, '], calendarContext($1)') : line))
      .join('\n')
  } else {
    text = text
      .split('\n')
      .map((line) => (FIXTURE_LINE(line) ? line.replace(/\byear: ([^,}]+?)(?=\s*[,}])/g, 'period: calendarPeriod($1)') : line))
      .join('\n')
  }
  if (text === before) continue
  const used = ['calendarContext', 'calendarPeriod', 'startYearOf'].filter((name) => new RegExp(`\\b${name}\\(`).test(text))
  const existing = /import \{([^}]*)\} from '([^']*shared\/period\.ts)'/.exec(text)
  if (existing) {
    const names = new Set(existing[1].split(',').map((s) => s.trim()).filter(Boolean))
    for (const name of used) names.add(name)
    text = text.replace(existing[0], `import { ${[...names].sort().join(', ')} } from '${existing[2]}'`)
  } else if (used.length > 0) {
    const rel = path.relative(path.dirname(file), 'shared/period.ts').split(path.sep).join('/')
    const at = text.indexOf('\nimport ') + 1
    text = `${text.slice(0, at)}import { ${used.sort().join(', ')} } from '${rel.startsWith('.') ? rel : `./${rel}`}'\n${text.slice(at)}`
  }
  fs.writeFileSync(file, text)
  console.log(`umgeschrieben: ${file}`)
}
```

Run (vom Repo-Wurzelverzeichnis):

```bash
node /tmp/zeitraum-umschreiber.mjs snapshot \
  server/test/calc-doppelung.test.ts server/test/calc-eigenbetrag.test.ts server/test/calc-garage.test.ts \
  server/test/calc-gutschrift.test.ts server/test/calc-hauptzaehler.test.ts server/test/calc-heizkosten.test.ts \
  server/test/calc-kabel.test.ts server/test/calc-leerstand-personen.test.ts server/test/calc-lohnanteil.test.ts \
  server/test/calc-mietmodell.test.ts server/test/calc-notices.test.ts server/test/calc-rechenweg.test.ts \
  server/test/calc-ruecklage.test.ts server/test/calc-rueckstand.test.ts server/test/calc-schluessel.test.ts \
  server/test/calc-steuer-eigennutzung.test.ts server/test/calc-ueberschneidung.test.ts server/test/calc-vermieteranteil.test.ts \
  server/test/calc-verteilbasis.test.ts server/test/calc-wortlaut.test.ts server/test/guides.test.ts \
  server/test/rechtsdurchsicht-2026.test.ts server/test/rechtstexte.test.ts server/test/snapshot-property.test.ts \
  server/test/duplicates.test.ts server/test/allocation.test.ts
node /tmp/zeitraum-umschreiber.mjs fixtures \
  server/test/assessment.test.ts server/test/taxReceipts.test.ts server/test/shared-cost-item.test.ts \
  server/test/booking.test.ts server/test/bookingResponse.test.ts \
  $(ls client/src/*.test.ts client/src/*.test.tsx client/src/pages/*.test.tsx client/src/testing/*.ts)
```

Expected: je umgeschriebener Datei eine Zeile `umgeschrieben: …`; api.test.ts und
db-repository.test.ts sind bewusst nicht dabei (ihre Rümpfe mit `year` prüfen den alten Tab).

Danach von Hand, nach derselben Regel:
- `client/src/triage.test.ts`: in den beiden `sameCostCandidates(…, { …, year: 2026 })` bzw.
  `year: 2025` → `period: calendarPeriod(2026)` bzw. `calendarPeriod(2025)`; die drei
  `categoryDeviationPct(items, 'Grundsteuer', 2026, …)` bzw. `2025` → `calendarContext(2026)` bzw.
  `calendarContext(2025)` (Import aus `'../../shared/period.ts'` ergänzen).
- `server/test/calc.test.ts`, `scopedSource`:
  `costItems: db.costItems.map((c) => ({ ...c, period: calendarPeriod(c.year), propertyId })),`
  (Import `calendarPeriod`).
- Jede Stelle, die der Übersetzer jetzt noch nennt, folgt einer dieser Regeln:
  1. Eine Kostenposition (Typ `CostItem`, `SnapshotCostItem`, `DuplicateItem`, `AllocatedItem`)
     bekommt statt `year: X` den Schlüssel `period: calendarPeriod(X)`; über mehrere Zeilen
     verteilte Literale erfasst der Umschreiber nicht.
  2. Ein Aufruf eines Helfers mit Jahreszahl (`previousAllocation`, `comparablePrevious`,
     `categoryDeviationPct`, `possibleDuplicates`) bekommt `calendarContext(X)`, `sameCostCandidates`
     im Suchobjekt `period: calendarPeriod(X)`.
  3. Ein Test, der den Rumpf eines Anlegens aus der Oberfläche prüft, erwartet dort jetzt
     `period: calendarPeriod(X)` statt `year: X` (`costItemBody` schreibt `period`).
  4. Ein Test, der `closedYearNotice` aufruft, ruft `closedPeriodNotice(String(X))`.

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: PASS, Golden unverändert, der Test „Alter Tab: Die Kostenliste …“ grün.

Run: `grep -rn "\.year\b" server/src shared client/src --include=*.ts --include=*.tsx | grep -v test | grep -iE "costItem|item\.|c\.year|i\.year|t\.year"`
Expected: keine Treffer auf Kostenpositionen (übrig sind `assessment.year`, `upload.year`,
`settlement.year`, `ledger.year` und `snapshot.year`).

- [ ] **Step 11: Commit**

```bash
git add shared server client
git commit -m "Zeitraum: Kostenpositionen tragen nur noch ihren Zeitraum

Refs #208"
```

---
### Task 5: Die Berechnung rechnet über den Zeitraum

Der Schnappschuss trägt P und den Vorzeitraum; `computeSettlement` nimmt Grenzen, Tage und Monate
von P (Entwurf 6.1 Schritte 1, 3, 5; Teilentwurf 4.2). Das Mietkonto bleibt Kalenderjahr, die
Abrechnung liest die Monate ihres Zeitraums aus derselben Monatsrechnung (`ledgerRows`). Die
Abrechnung trägt `period` und `deadline`. Die Routen übergeben bis Task 6 den Kalenderzeitraum.

**Files:**
- Modify: `shared/types.ts` (`Settlement`), `server/src/store.ts` (`StoredSettlement`), `server/src/snapshot.ts`, `server/src/calc.ts`, `server/src/index.ts`
- Test: `server/test/calc-zeitraum.test.ts` (neu); Modify: `server/test/calc.test.ts`, `server/test/calc-schluessel.test.ts`, `server/test/db-objekte.test.ts`, `server/test/snapshot-property.test.ts`, `client/src/pages/Abrechnung.test.tsx`, `client/src/pages/noticeFocus.test.tsx`, `client/src/pages/ohneKosten.test.tsx`, `client/src/tenantFolder.test.ts`

**Interfaces:**
- Consumes (Task 1–4): `BillingPeriod`, `SettlementPeriod`, `calendarYearPeriod`, `contextOf`, `periodDays`, `periodLabel`, `periodMonths`, `previousPeriod`, `rulesOf`, `settlementDeadline`, `settlementPeriod`.
- Produces:
  - `Snapshot.period: BillingPeriod`, `Snapshot.previousPeriod: BillingPeriod`, `Snapshot.year` (Kalenderjahr des Beginns)
  - `snapshotOfPeriod(source: SnapshotSource, period: BillingPeriod, previous: BillingPeriod): Snapshot`
  - `snapshotOf(source, year)` unverändert (Kalenderjahr); `snapshotFor(source, propertyId, period: BillingPeriod)`
  - `computePrepaymentCents(tenancy, period: Pick<BillingPeriod, 'key' | 'from' | 'to'>)`
  - `ledgerRows(source: Pick<Snapshot, 'units' | 'tenancies' | 'payments'>, span: Pick<BillingPeriod, 'from' | 'to'>, options?: { asOf?: string }): RentLedgerRow[]`; `dueMonthsOf` entfällt
  - `Settlement.period: SettlementPeriod`, `Settlement.deadline: string` (Pflicht); `StoredSettlement` mit beiden optional

- [ ] **Step 1: Write the failing test**

`server/test/calc-zeitraum.test.ts`:

```ts
// Die Berechnung über den Abrechnungszeitraum (#208, Entwurf 6.1 und 12.3). Dass sich im
// Kalenderjahr nichts ändert, halten der Prüfkatalog, db-objekte.test.ts und der Gleichheitstest
// unten fest; die übrigen Tests rechnen Zeiträume, die keine Kalenderjahre sind.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computePrepaymentCents, computeSettlement, consumptionOverview, ledgerRows, rentLedger, taxReport, type ComputedSettlement } from '../src/calc.ts'
import {
  overridesByPeriod, snapshotFor, snapshotOf, snapshotOfPeriod,
  type SnapshotCostItem, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit,
} from '../src/snapshot.ts'
import {
  CALENDAR_RULES, calendarPeriod, calendarYearPeriod, periodContaining, periodKey, periodOfKey, periodsBetween, previousPeriod,
} from '../../shared/period.ts'
import type { BillingPeriod, PeriodKey, PeriodRules } from '../../shared/types.ts'
import { loadFixtures } from '../testing/fixtures.ts'

const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

const settle = (source: SnapshotSource, rules: PeriodRules, key: string, asOf?: string): ComputedSettlement => {
  const p = of(rules, key)
  return computeSettlement(snapshotOfPeriod(source, p, previousPeriod(rules, p)), asOf ? { asOf } : {})
}

function tenancy(id: string, unitId: string, start: string, end: string | null, monthlyCents = 20000): SnapshotTenancy {
  return {
    id, unitId, tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
    prepayments: [{ from: start.slice(0, 7), monthlyCents }], prepaymentOverrides: {}, baseRents: [],
  }
}
const haus = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [tenancy('t1', 'u1', '2020-01-01', null), tenancy('t2', 'u2', '2020-01-01', null)],
  costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const grundsteuer = (key: string, amountCents = 120000): SnapshotCostItem =>
  ({ id: `g${key}`, period: periodKey(key), category: 'Grundsteuer', description: 'Grundsteuer', amountCents, key: 'area' })

test('Gleichheit: Regeln { startMonth: 1, changes: [] } rechnen jedes Fixture wie das Kalenderjahr (Entwurf 12.1)', () => {
  for (const fx of loadFixtures()) {
    const db = fx.db()
    const scoped = {
      properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
      units: db.units.map((u) => ({ ...u, propertyId: 'objekt-1' })),
      tenancies: db.tenancies.map((t) => ({ ...t, prepaymentOverrides: overridesByPeriod(t.prepaymentOverrides ?? {}) })),
      costItems: db.costItems.map((c) => ({ ...c, period: calendarPeriod(c.year), propertyId: 'objekt-1' })),
      meters: db.meters.map((m) => ({ ...m, propertyId: 'objekt-1' })),
      readings: db.readings,
      payments: db.payments,
      closedSettlements: [],
    }
    for (const year of [fx.year - 1, fx.year, fx.year + 1]) {
      const viaRegeln = snapshotFor(scoped, 'objekt-1', of(CALENDAR_RULES, `${year}-01`))
      const viaJahr = { ...snapshotOf(scoped, year), propertyId: 'objekt-1', property: viaRegeln.property }
      const fall = `${fx.name} ${year}`
      assert.deepEqual(computeSettlement(viaRegeln), computeSettlement(viaJahr), `${fall}: Abrechnung`)
      assert.deepEqual(rentLedger(viaRegeln), rentLedger(viaJahr), `${fall}: Mietkonto`)
      assert.deepEqual(taxReport(viaRegeln), taxReport(viaJahr), `${fall}: Steuer`)
      assert.deepEqual(consumptionOverview(viaRegeln), consumptionOverview(viaJahr), `${fall}: Verbrauch`)
    }
  }
})

test('Kalenderjahr: Die Abrechnung trägt Zeitraum und Frist', () => {
  const s = computeSettlement(snapshotOf(haus({ costItems: [grundsteuer('2025-01')] }), 2025))
  assert.deepEqual(s.period, { key: '2025-01', from: '2025-01-01', to: '2025-12-31', short: false, label: '2025' })
  assert.equal(s.deadline, '2026-12-31')
})

test('Mai bis April: Tage, Vorauszahlungsmonate, Bezeichnung und Frist kommen vom Zeitraum', () => {
  const s = settle(haus({ costItems: [grundsteuer('2025-05')] }), MAI, '2025-05')
  assert.equal(s.daysInYear, 365)
  assert.equal(s.year, 2025)
  assert.deepEqual(s.period, { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' })
  assert.equal(s.deadline, '2027-04-30')
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  assert.deepEqual([st.periodStart, st.periodEnd, st.days, st.prepaymentCents], ['2025-05-01', '2026-04-30', 365, 240000])
  assert.equal(st.totalShareCents, 72000, '60 von 100 m² aus 1.200 €')
  assert.ok(st.suggestedMonthlyCents > 0, 'zwölf Monate: der Vorschlag nach § 560 Abs. 4 bleibt')
})

test('Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage, ein Auszug zum 29.02.2028 trägt 305 davon', () => {
  const src = haus({ tenancies: [tenancy('t1', 'u1', '2020-01-01', '2028-02-29'), tenancy('t2', 'u2', '2020-01-01', null)], costItems: [grundsteuer('2027-05', 73200)] })
  const s = settle(src, MAI, '2027-05')
  assert.equal(s.daysInYear, 366)
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  assert.equal(st.days, 305)
  assert.equal(st.totalShareCents, 36600, '73.200 · 60/100 · 305/366')
})

test('Rumpf 01.01.–30.04.2025: 120 Tage, vier Vorauszahlungsmonate, kein Vorschlag, Rückstand nur über den Zeitraum', () => {
  // Review Focus 5.
  const src = haus({
    tenancies: [tenancy('t1', 'u1', '2024-01-01', null), tenancy('t2', 'u2', '2024-01-01', null)],
    costItems: [grundsteuer('2025-01', 40000)],
    payments: [{ tenancyId: 't1', date: '2025-01-03', amountCents: 20000 }, { tenancyId: 't1', date: '2025-02-03', amountCents: 20000 }],
  })
  const s = settle(src, WECHSEL, '2025-01', '2025-06-15')
  assert.equal(s.daysInYear, 120)
  assert.equal(s.period.label, '01.01.–30.04.2025')
  assert.equal(s.deadline, '2026-04-30')
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  // Im Rumpf gibt es keinen Vorschlag, bis PR 3 ihn nach Gradtagen rechnet; ein falscher wäre schlimmer.
  assert.deepEqual([st.days, st.periodEnd, st.prepaymentCents, st.suggestedMonthlyCents], [120, '2025-04-30', 80000, 0])
  const rueckstand = s.notices.find((n) => n.code === 'prepayment.arrears' && n.subject?.id === 't1') ?? assert.fail('kein Hinweis auf den Rückstand')
  assert.match(rueckstand.text, /^Im Mietkonto 01\.01\.–30\.04\.2025 von t1 \(EG\) sind 400,00 € offen\./)
  // Das Mietkonto selbst bleibt beim Kalenderjahr (Entwurf 3.11).
  const konto = rentLedger(snapshotOf(src, 2025), { asOf: '2025-06-15' }).rows.find((r) => r.tenancyId === 't1') ?? assert.fail('t1 fehlt im Mietkonto')
  assert.deepEqual([konto.months.length, konto.arrearsCents], [12, 60000])
})

test('Steuer: nur im Kalenderjahr; ein Schnappschuss Mai–April wird abgelehnt statt still falsch gerechnet', () => {
  const p = of(MAI, '2025-05')
  assert.throws(() => taxReport(snapshotOfPeriod(haus(), p, previousPeriod(MAI, p))), /Kalenderjahr/)
})

// ---------- Invarianten (Entwurf 12.3) ----------

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
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const day2025 = (r: () => number, from = 0): string => addDays('2025-01-01', from + pick(r, 365 - from))

// Ein Bestand im Kalenderjahr 2025: nur kalte Kosten, keine Regel mit Stichtag, kein 29.02. in der
// Nähe (Entwurf 12.3 Nr. 6, G-H). Die Positionen tragen den Schlüssel, der übergeben wird.
function calendarStock(r: () => number, key: PeriodKey): SnapshotSource {
  const units: SnapshotUnit[] = Array.from({ length: 2 + pick(r, 3) }, (_, i) => ({ id: `u${i}`, name: `W${i}`, areaM2: 30 + pick(r, 70), participates: true }))
  const tenancies: SnapshotTenancy[] = []
  for (const u of units) {
    const persons = 1 + pick(r, 4)
    const end = r() < 0.5 ? null : day2025(r, 20)
    tenancies.push({ ...tenancy(`${u.id}-a`, u.id, '2024-06-01', end, 0), persons, personHistory: [{ from: '2024-06-01', persons }] })
    if (end !== null && r() < 0.7) {
      const start = addDays(end, 1 + pick(r, 30))
      const p2 = 1 + pick(r, 4)
      if (start <= '2025-12-31') tenancies.push({ ...tenancy(`${u.id}-b`, u.id, start, null, 0), persons: p2, personHistory: [{ from: start, persons: p2 }, { from: addDays(start, 40), persons: 1 + pick(r, 4) }] })
    }
  }
  const meters = units.map((u) => ({ id: `m${u.id}`, unitId: u.id, type: 'kaltwasser' as const }))
  const readings: SnapshotReading[] = meters.flatMap((m) => {
    const anfang = pick(r, 100)
    const mitte = anfang + pick(r, 50)
    return [
      { meterId: m.id, date: '2024-12-31', value: anfang },
      { meterId: m.id, date: day2025(r, 100), value: mitte },
      { meterId: m.id, date: '2025-12-31', value: mitte + pick(r, 60) },
    ]
  })
  const amount = () => 20000 + pick(r, 200000)
  const costItems: SnapshotCostItem[] = [
    { id: 'gs', period: key, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: amount(), key: 'area' },
    { id: 'mu', period: key, category: 'Müllabfuhr', description: 'Müll', amountCents: amount(), key: 'persons' },
    { id: 'wa', period: key, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: amount(), key: 'meter', meterType: 'kaltwasser' },
    { id: 'hw', period: key, category: 'Hauswart', description: 'Hauswart', amountCents: amount(), key: 'units' },
    { id: 'di', period: key, category: 'Sonstige Betriebskosten', description: 'Direkt', amountCents: amount(), key: 'direct', directUnitId: 'u0' },
    { id: 'cu', period: key, category: 'Gartenpflege', description: 'Garten', amountCents: amount(), key: 'custom', customShares: { u0: 40, u1: 50 } },
  ]
  return { units, tenancies, costItems, meters, readings, payments: [], closedSettlements: [] }
}

// Derselbe Bestand 120 Tage später: der 01.01.2025 wird der 01.05.2025.
function shifted(src: SnapshotSource, key: PeriodKey): SnapshotSource {
  return {
    ...src,
    tenancies: src.tenancies.map((t) => ({
      ...t, start: addDays(t.start, 120), end: t.end === null ? null : addDays(t.end, 120),
      personHistory: t.personHistory.map((e) => ({ ...e, from: addDays(e.from, 120) })),
    })),
    readings: src.readings.map((x) => ({ ...x, date: addDays(x.date, 120) })),
    costItems: src.costItems.map((c) => ({ ...c, period: key })),
  }
}

const shares = (s: ComputedSettlement) => ({
  tenants: Object.fromEntries(s.statements.map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((row) => [row.costItemId, row.shareCents]))])),
  landlord: Object.fromEntries(s.landlord.rows.map((row) => [row.costItemId, row.shareCents])),
})

test('Invariante: verschoben um 120 Tage und im Zeitraum Mai–April gerechnet, centgleiche Anteile (Entwurf 12.3 Nr. 6)', () => {
  const r = rng(6)
  for (let fall = 0; fall < 100; fall++) {
    const kalender = calendarStock(r, calendarPeriod(2025))
    const vorher = computeSettlement(snapshotOfPeriod(kalender, calendarYearPeriod(2025), calendarYearPeriod(2024)))
    const nachher = settle(shifted(kalender, periodKey('2025-05')), MAI, '2025-05')
    assert.deepEqual(shares(nachher), shares(vorher), `Fall ${fall}`)
  }
})

test('Invariante: Geld bleibt erhalten, auch im Rumpf und über den Jahreswechsel (Entwurf 12.3 Nr. 2)', () => {
  const r = rng(2)
  for (let fall = 0; fall < 100; fall++) {
    for (const [rules, key, stock] of [
      [WECHSEL, '2025-01', calendarStock(r, periodKey('2025-01'))],
      [MAI, '2025-05', shifted(calendarStock(r, periodKey('2025-01')), periodKey('2025-05'))],
    ] as const) {
      const s = settle(stock, rules, key)
      const mieter = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
      assert.equal(mieter + s.landlord.totalCents, s.totalCostsCents, `Fall ${fall} ${key}: Summe`)
      for (const st of s.statements) for (const row of st.rows) assert.ok(row.shareCents >= 0, `Fall ${fall} ${key}: negativer Anteil`)
    }
  }
})

test('Invariante: Die Vorauszahlungen aller Zeiträume einer Spanne sind die des Mietkontos über dieselben Monate (Entwurf 12.3 Nr. 11)', () => {
  const r = rng(11)
  const unit: SnapshotUnit = { id: 'u', name: 'U', areaM2: 50, participates: true }
  for (let fall = 0; fall < 200; fall++) {
    const rules: PeriodRules = { startMonth: 1 + pick(r, 12), changes: [] }
    const change = `2025-${String(1 + pick(r, 12)).padStart(2, '0')}`
    // Ein Wechsel auf einen Monat, in dem ohnehin ein Zeitraum beginnt, ist keiner (wie in period.test.ts).
    if (r() < 0.5 && periodContaining(rules, `${change}-01`).from !== `${change}-01`) rules.changes.push(change)
    const periods = periodsBetween(rules, '2024-01-01', '2026-12-31')
    const first = periods[0] ?? assert.fail('keine Zeiträume')
    const last = periods[periods.length - 1] ?? assert.fail('keine Zeiträume')
    const start = addDays('2023-06-01', pick(r, 1200))
    const t: SnapshotTenancy = {
      ...tenancy('t', 'u', start, r() < 0.5 ? null : addDays(start, pick(r, 900)), 10000 + pick(r, 20000)),
      prepayments: [
        { from: start.slice(0, 7), monthlyCents: 10000 + pick(r, 20000) },
        { from: `2025-${String(1 + pick(r, 12)).padStart(2, '0')}`, monthlyCents: pick(r, 30000) },
      ],
    }
    const viaZeitraum = periods.reduce((a, p) => a + computePrepaymentCents(t, p).cents, 0)
    const viaMietkonto = ledgerRows({ units: [unit], tenancies: [t], payments: [] }, { from: first.from, to: last.to })
      .reduce((a, row) => a + row.prepaymentYearCents, 0)
    assert.equal(viaZeitraum, viaMietkonto, `Fall ${fall}: ${JSON.stringify(rules)}`)
  }
})

test('Wache: computeSettlement rechnet nicht mehr mit dem Kalenderjahr (#208)', () => {
  const source = fs.readFileSync(new URL('../src/calc.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export function computeSettlement(')
  const end = source.indexOf('\nexport ', start + 1)
  const body = source.slice(start, end < 0 ? undefined : end)
  for (const pattern of [/-12-31/, /-01-01/, /\byear - 1\b/, /\byear \+ 1\b/, /\bdaysInYear\(/, /\boverlapDays\(/, /\bdueMonthsOf\(/]) {
    assert.doesNotMatch(body, pattern, `computeSettlement enthält ${pattern}`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix server test -- test/calc-zeitraum.test.ts`
Expected: FAIL, `snapshotOfPeriod` und `ledgerRows` gibt es nicht (SyntaxError beim Import).

- [ ] **Step 3: Typen**

`shared/types.ts`, in `Settlement`:

```ts
export type Settlement = {
  // Kalenderjahr, in dem der Abrechnungszeitraum beginnt (#208); bei einem Kalenderobjekt das
  // Abrechnungsjahr wie bisher.
  year: number
  // Tage des Abrechnungszeitraums (#208). Der Name stammt aus der Zeit, als jeder Zeitraum ein Jahr
  // war; ältere Tabs lesen ihn.
  daysInYear: number
  // Der Abrechnungszeitraum und das Ende der Frist nach § 556 Abs. 3 S. 2 BGB (#208). Eine vorher
  // abgeschlossene Abrechnung kennt beide nicht; die Route ergänzt sie aus dem Zeitraum.
  period: SettlementPeriod
  deadline: string
```

`server/src/store.ts`, `StoredSettlement`: `'period' | 'deadline'` in die `Omit`-Liste aufnehmen und
ergänzen:

```ts
  // vor #208 abgeschlossene Abrechnungen kennen Zeitraum und Frist nicht
  period?: ComputedSettlement['period']
  deadline?: ComputedSettlement['deadline']
```

- [ ] **Step 4: Schnappschuss (`server/src/snapshot.ts`)**

Importe: `BillingPeriod`, `PeriodRules` als Typen; `calendarYearPeriod, previousPeriod, rulesOf` aus
`'../../shared/period.ts'` (`calendarPeriod`, `parsePeriodKey` bleiben für `overridesByPeriod`).

In `Snapshot` statt `year: number` samt Kommentar:

```ts
  // Der Abrechnungszeitraum (#208). Er gehört zum Schnappschuss, nicht neben ihn: Sonst ließe sich
  // ein Schnappschuss mit einem anderen Zeitraum verrechnen, und weil die Kostenpositionen dann
  // fehlten, käme eine leere statt einer falschen Abrechnung heraus. Der Fehler fiele erst dem
  // Mieter auf.
  period: BillingPeriod
  // Der Zeitraum davor, für den Vergleich der Schlüssel und der Doppelungen (#141).
  previousPeriod: BillingPeriod
  // Das Kalenderjahr, in dem `period` beginnt. Mietkonto und Steuer rechnen im Kalenderjahr.
  year: number
```

`snapshotOf` wird zu `snapshotOfPeriod`, und `snapshotOf` ruft sie mit dem Kalenderjahr:

```ts
// Der Schnappschuss eines Abrechnungszeitraums. … (bisheriger Kommentar von snapshotOf, „Jahr“ →
// „Zeitraum“)
export function snapshotOfPeriod(source: SnapshotSource, period: BillingPeriod, previous: BillingPeriod): Snapshot {
  const closed = source.closedSettlements.find((c) => c.period === period.key)
  return {
    period,
    previousPeriod: previous,
    year: Number(period.from.slice(0, 4)),
    propertyId: null,
    units: source.units,
    tenancies: source.tenancies,
    costItems: source.costItems.filter((c) => c.period === period.key),
    // Der Vorzeitraum nur für den Vergleich der Schlüssel (#141) und der Doppelungen.
    previousCostItems: source.costItems.filter((c) => c.period === previous.key),
    meters: source.meters,
    readings: source.readings,
    payments: source.payments,
    closedSettlement: closed
      ? {
          selfUsedShareCents: closed.selfUsedShareCents,
          prepaymentCents: closed.prepaymentCents,
          prepaymentOverridden: closed.prepaymentOverridden,
          selfUseByItem: closed.selfUseByItem ?? null,
          itemTotals: closed.itemTotals ?? null,
        }
      : null,
  }
}

// Der Eingang im Kalenderjahr: db.json, Umstieg, Regression und Tests. Die db.json kannte nichts
// anderes, und hier ist der Vorzeitraum wirklich das Vorjahr.
export function snapshotOf(source: SnapshotSource, year: number): Snapshot {
  return snapshotOfPeriod(source, calendarYearPeriod(year), calendarYearPeriod(year - 1))
}
```

```ts
// Der Schnappschuss eines Objekts in einem Abrechnungszeitraum. Die Routen rechnen nur hierüber; den
// Vorzeitraum bestimmt der Rhythmus des Objekts (#208).
export function snapshotFor(
  source: PropertyScopedSource & { properties?: (SnapshotProperty & { id: string, periodRules?: PeriodRules })[] },
  propertyId: string,
  period: BillingPeriod,
): Snapshot {
  const found = source.properties?.find((p) => p.id === propertyId)
  return {
    ...snapshotOfPeriod(narrowToProperty(source, propertyId), period, previousPeriod(rulesOf(found), period)),
    propertyId,
    property: found ? { kind: found.kind, cableBuiltBeforeDec2021: found.cableBuiltBeforeDec2021 ?? null } : null,
  }
}
```

- [ ] **Step 5: Berechnung (`server/src/calc.ts`)**

Importe aus `'../../shared/period.ts'`: `calendarYearPeriod, contextOf, periodDays, periodLabel,
periodMonths, settlementDeadline, settlementPeriod` (`calendarContext` und `calendarPeriod` aus Task 4
entfallen); `BillingPeriod` als Typ aus `shared/types.ts`.

`consumptionOverview`:

```ts
// Übersicht für die Zähler-Seite über den Zeitraum der Abrechnung (#208): Verbrauch pro Zähler + Warnungen
export function consumptionOverview(snapshot: Snapshot): ConsumptionOverviewRow[] {
  const { from, to } = snapshot.period
```

`computePrepaymentCents`:

```ts
// Vorauszahlungen eines Abrechnungszeitraums (#208): pro Monat des Zeitraums zählt der
// Staffelbetrag, der am Monatsersten gilt — sofern das Mietverhältnis am Monatsersten besteht. Eine
// Korrektur für den Zeitraum (tatsächlich gezahlter Betrag) hat immer Vorrang, denn rechtlich sind
// die tatsächlich geleisteten Vorauszahlungen anzusetzen.
export function computePrepaymentCents(tenancy: SnapshotTenancy, period: Pick<BillingPeriod, 'key' | 'from' | 'to'>): { cents: number, overridden: boolean } {
  const override = tenancy.prepaymentOverrides?.[period.key]
  if (override != null) return { cents: override, overridden: true }
  // … `schedule` unverändert
  let cents = 0
  for (const month of periodMonths(period)) {
    const firstDay = `${month}-01`
    if (tenancy.start > firstDay) continue
    if (tenancy.end && tenancy.end < firstDay) continue
    let rate = 0
    for (const e of schedule) if (e.from <= month) rate = e.monthlyCents
    cents += rate
  }
  return { cents, overridden: false }
}
```

`dueMonthsOf` löschen; `rentLedger` wird zur Hülle um `ledgerRows`:

```ts
// Die Monatsrechnung für Abrechnung und Mietkonto (#208): je Mietverhältnis das Soll je Monat
// (Bruttomiete = Kaltmiete + Vorauszahlung + Pauschale) und die Zahlungen der Spanne, von vorn auf die
// Monate verteilt; so spiegelt der Status („bezahlt / teilweise / offen“) wider, bis zu welchem Monat
// das Konto gedeckt ist. Das Mietkonto ruft sie mit den zwölf Monaten des Kalenderjahres, die
// Abrechnung mit den Monaten ihres Zeitraums: eine Monatsregel und nicht zwei. `month` ist der
// Kalendermonat (1..12), in höchstens zwölf aufeinanderfolgenden Monaten also eindeutig.
//
// **Fällig ist nur, was vor dem Monat des Stichtags liegt** (#133). … (Begründung aus dem bisherigen
// Kommentar über `dueMonthsOf` hierher übernehmen)
export function ledgerRows(
  source: Pick<Snapshot, 'units' | 'tenancies' | 'payments'>,
  span: Pick<BillingPeriod, 'from' | 'to'>,
  options: { asOf?: string } = {},
): RentLedgerRow[] {
  const months = periodMonths(span)
  const asOfMonth = options.asOf?.slice(0, 7)
  const dueMonths = asOfMonth === undefined ? months.length : months.filter((m) => m < asOfMonth).length
  const unitById = new Map(source.units.map((u) => [u.id, u]))
  return source.tenancies
    .filter((t) => rangeOverlapDays(t.start, t.end, span.from, span.to) > 0)
    .map((t) => {
      const baseSchedule: MonthlySchedule[] = Array.isArray(t.baseRents) ? t.baseRents : []
      const ppSchedule: MonthlySchedule[] = Array.isArray(t.prepayments) ? t.prepayments : []
      const flatSchedule: MonthlySchedule[] = Array.isArray(t.flatRates) ? t.flatRates : []
      const rowMonths = months.map((mm): RentMonth => {
        const firstDay = `${mm}-01`
        const active = t.start <= firstDay && !(t.end && t.end < firstDay)
        const baseRentCents = active ? rateAtMonth(baseSchedule, mm) : 0
        const prepaymentCents = active ? rateAtMonth(ppSchedule, mm) : 0
        const flatRateCents = active ? rateAtMonth(flatSchedule, mm) : 0
        return {
          month: Number(mm.slice(5, 7)),
          baseRentCents,
          prepaymentCents,
          flatRateCents,
          sollCents: baseRentCents + prepaymentCents + flatRateCents,
          paidCents: 0,
          status: 'open',
        }
      })
      // Zahlungseingänge der Spanne der Reihe nach auf die Monate verteilen
      const paidYearCents = source.payments
        .filter((p) => p.tenancyId === t.id && p.date >= span.from && p.date <= span.to)
        .reduce((a, p) => a + p.amountCents, 0)
      let remaining = paidYearCents
      for (const [k, mo] of rowMonths.entries()) {
        if (mo.sollCents <= 0) {
          // kein Soll → als gedeckt behandeln, kein Geld verbrauchen
          mo.status = 'paid'
          continue
        }
        const applied = Math.max(0, Math.min(remaining, mo.sollCents))
        mo.paidCents = applied
        remaining -= applied
        mo.status = applied >= mo.sollCents ? 'paid' : k >= dueMonths ? 'notDue' : applied > 0 ? 'partial' : 'open'
      }
      const sollYearCents = rowMonths.reduce((a, mo) => a + mo.sollCents, 0)
      const dueSollCents = rowMonths.filter((_, k) => k < dueMonths).reduce((a, mo) => a + mo.sollCents, 0)
      return {
        tenancyId: t.id,
        tenantName: t.tenantName,
        unitName: unitById.get(t.unitId)?.name ?? '—',
        months: rowMonths,
        sollYearCents,
        baseRentYearCents: rowMonths.reduce((a, mo) => a + mo.baseRentCents, 0),
        prepaymentYearCents: rowMonths.reduce((a, mo) => a + mo.prepaymentCents, 0),
        flatRateYearCents: rowMonths.reduce((a, mo) => a + mo.flatRateCents, 0),
        paidYearCents,
        balanceCents: paidYearCents - sollYearCents,
        dueSollCents,
        arrearsCents: Math.max(0, dueSollCents - paidYearCents),
        openMonths: rowMonths.filter((mo) => mo.status === 'open' || mo.status === 'partial').length,
      }
    })
    // Eine Liste, die ein Mensch liest: deutsche Sortierung, fest eingestellt (siehe compareName).
    .sort((a, b) => compareName(a.unitName, b.unitName) || compareName(a.tenantName, b.tenantName))
}

// Das Mietkonto bleibt im Kalenderjahr (#208, Entwurf 3.11), auch wenn die Abrechnung einen anderen
// Zeitraum hat: Es ist die Grundlage der Einnahmen in der Steuer. `asOf` wie bei der Abrechnung:
// Monate ab dem des Stichtags sind „noch nicht fällig“ und kein Rückstand.
export function rentLedger(snapshot: Snapshot, options: { asOf?: string } = {}): RentLedger {
  const rows = ledgerRows(snapshot, calendarYearPeriod(snapshot.year), options)
  return {
    year: snapshot.year,
    rows,
    totals: {
      sollYearCents: rows.reduce((a, r) => a + r.sollYearCents, 0),
      paidYearCents: rows.reduce((a, r) => a + r.paidYearCents, 0),
      openCents: rows.reduce((a, r) => a + r.arrearsCents, 0),
    },
  }
}
```

`taxReport`, direkt nach `const year = snapshot.year`:

```ts
  // Die Steuerübersicht rechnet im Kalenderjahr (§ 11 EStG, #208). Aus zwei Abrechnungen schöpft sie
  // erst mit PR 3; bis dahin nimmt sie nur den Schnappschuss eines Kalenderjahres, und die Route lehnt
  // ein Objekt mit anderem Rhythmus ab.
  const calendar = calendarYearPeriod(year)
  if (snapshot.period.from !== calendar.from || snapshot.period.to !== calendar.to) {
    throw new Error('Die Steuerübersicht rechnet im Kalenderjahr; dieser Schnappschuss trägt einen anderen Zeitraum.')
  }
```

und beide Filter `c.period === calendarPeriod(year)` → `c.period === snapshot.period.key`. In
`splitForTax` `overlapDays(t.start, t.end, snapshot.year)` →
`rangeOverlapDays(t.start, t.end, snapshot.period.from, snapshot.period.to)`.

`computeSettlement`, Kopf:

```ts
export function computeSettlement(snapshot: Snapshot, options: SettlementOptions = {}): ComputedSettlement {
  // Der Abrechnungszeitraum (#208). Grenzen, Tage und Monate kommen von hier; `year` ist das
  // Kalenderjahr des Beginns und steht nur noch im Ergebnis und an den Kabelzeilen (siehe dort).
  const period = snapshot.period
  const year = snapshot.year
  const diy = periodDays(period)
  const yFrom = period.from
  const yTo = period.to
  const label = periodLabel(period)
  // Zeitraum und Vorzeitraum für den Vergleich der Schlüssel und der Doppelungen (#141).
  const at = contextOf(period, snapshot.previousPeriod)
```

(die Zeile `const at = calendarContext(year)` aus Task 4 entfällt). Im Rumpf, je nach Inhalt der Zeile:

- `const days = overlapDays(t.start, t.end, year)` → `const days = rangeOverlapDays(t.start, t.end, yFrom, yTo)`;
- `const pp = computePrepaymentCents(t, year)` → `computePrepaymentCents(t, period)`;
- `const items = snapshot.costItems.filter((c) => c.period === at.key)` → `c.period === period.key`;
- `meter.main-partial`:
  ```ts
          // Der Tag vor dem Zeitraum und sein Ende (#208); im Kalenderjahr wortgleich wie bisher.
          const vorher = new Date(toUTC(yFrom) - MS_DAY).toISOString().slice(0, 10)
          const kalender = calendarYearPeriod(year)
          const ende = yFrom === kalender.from && yTo === kalender.to ? 'zum Jahresende' : 'zum Ende des Zeitraums'
          warn('meter.main-partial', `„${item.description}“: der Hauptzähler deckt ${label} nur ${data.mainPartial.days} von ${diy} Tagen ab — bitte Ablesungen zum ${fmtDay(vorher)} und ${ende} (${fmtDay(yTo)}) nachtragen. Bis dahin wird nach den Wohnungszählern verteilt.`, { kind: 'meter', id: data.mainPartial.meterId })
  ```
  (`fmtDay` steht schon in calc.ts und macht aus `2025-12-31` `31.12.2025`);
- in `clause` der Überschneidung viermal `${year}` → `${label}`, in der Meldung `` ` in ${year}` `` → `` ` in ${label}` ``;
- `model.prepayment-unsettled`: `computePrepaymentCents(t, year)` → `(t, period)`, `für ${year}` →
  `für ${label}`, `gibt es ${year} keine` → `gibt es ${label} keine`;
- Rückstand:
  ```ts
    const ledgerInUse = snapshot.payments.some((p) => p.date >= yFrom && p.date <= yTo)
    // Fällig ist ein Monat des Zeitraums vor dem Monat des Stichtags; ohne Stichtag alle (#133).
    const asOfMonth = options.asOf?.slice(0, 7)
    const anyDue = asOfMonth === undefined || periodMonths(period).some((m) => m < asOfMonth)
    if (ledgerInUse && anyDue) {
      // Dieselbe Monatsrechnung wie das Mietkonto, über die Monate des Zeitraums (#208).
      const rowsByTenancy = new Map(ledgerRows(snapshot, period, { asOf: options.asOf }).map((r) => [r.tenancyId, r]))
      for (const st of statements.values()) {
        if (st.prepaymentOverridden || st.prepaymentCents <= 0) continue
        const row = rowsByTenancy.get(st.tenancyId)
  ```
  und im Text `Im Mietkonto ${year} von` → `Im Mietkonto ${label} von`;
- Ergebnis, hinter `daysInYear: diy,`:
  ```ts
    period: settlementPeriod(period),
    deadline: settlementDeadline(period),
  ```
- Vorschlag nach § 560:
  ```ts
    // Im Rumpfzeitraum gibt es keinen Vorschlag (#208): vier Monate Kosten auf zwölf Monate
    // hochgerechnet verschöben Winter und Sommer; PR 3 rechnet ihn nach Gradtagen und Tagen.
    st.suggestedMonthlyCents = (end != null && end <= yTo) || st.days <= 0 || period.short
  ```

Die Kabelzeilen (`year >= 2021`, `year === 2021`) bleiben in dieser Aufgabe stehen (Überschneidung
mit PR 1, Task 7).

- [ ] **Step 6: Routen (Brücke bis Task 6, `server/src/index.ts`)**

Import `calendarYearPeriod` aus `'../../shared/period.ts'`. Jeder Aufruf
`snapshotFor(<Bestand>, <Objekt>, year)` wird `snapshotFor(<Bestand>, <Objekt>, calendarYearPeriod(year))`
(GET und POST `/api/settlement/:year`, `/api/consumption/:year`, `/api/rentledger/:year`,
`/api/taxreport/:year`, `/api/receipts/tax/:year`).

Run: `grep -n "snapshotFor(" server/src/index.ts`
Expected: jede Zeile enthält `calendarYearPeriod(year)`.

- [ ] **Step 7: Tests nachziehen**

```bash
node -e "
const fs = require('node:fs')
for (const f of ['server/test/calc.test.ts', 'server/test/calc-schluessel.test.ts', 'server/test/db-objekte.test.ts', 'server/test/snapshot-property.test.ts']) {
  let t = fs.readFileSync(f, 'utf8')
  t = t.replace(/snapshotFor\(([^()]*), (\d{4}|year)\)/g, 'snapshotFor(\$1, calendarYearPeriod(\$2))')
       .replace(/computePrepaymentCents\(([^,()]+), (\d{4})\)/g, 'computePrepaymentCents(\$1, calendarYearPeriod(\$2))')
  fs.writeFileSync(f, t)
}"
```

In diesen vier Dateien `calendarYearPeriod` aus `'../../shared/period.ts'` importieren (in eine
vorhandene Importzeile aus dieser Datei aufnehmen). In calc.test.ts steht danach im Test „Manuelle
Jahres-Korrektur“ `computePrepaymentCents(t, calendarYearPeriod(2025))` mit dem Schlüssel `'2025-01'`
aus Task 2.

In den Client-Tests mit einer vollständigen `Settlement` (`client/src/pages/Abrechnung.test.tsx`,
`client/src/pages/noticeFocus.test.tsx`, `client/src/pages/ohneKosten.test.tsx`,
`client/src/tenantFolder.test.ts`) hinter `daysInYear: …,` ergänzen (Jahr wie im Fixture, in
tenantFolder.test.ts `2025` statt `YEAR`; Import `calendarYearPeriod, settlementPeriod` aus dem
relativen Pfad zu `shared/period.ts`):

```ts
    period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`,
```

- [ ] **Step 8: Run tests**

Run: `npm --prefix server test -- test/calc-zeitraum.test.ts && npm test && npm run typecheck`
Expected: PASS, calc-zeitraum mit 10 Tests; Golden unverändert.

- [ ] **Step 9: Commit**

```bash
git add shared/types.ts server client
git commit -m "Zeitraum: Abrechnung rechnet über den Zeitraum, Mietkonto bleibt Kalenderjahr

Refs #208"
```

---
### Task 6: Routen mit Zeitraum, Alias und Frist

Die Routen der Abrechnung und des Verbrauchs nehmen den Zeitraum (`JJJJ-MM`); die nackte Jahreszahl
gilt nur beim reinen Kalenderobjekt (G-C6), sonst 404 mit Satz. Jede Antwort der Abrechnung trägt
`period` und `deadline`, auch eine vorher eingefrorene. Die Frist rechnet niemand mehr selbst:
`settlementDiff.ts`, die Seite Abrechnung und das Cockpit nehmen sie vom Server. Steuer und Mietkonto
bleiben beim Kalenderjahr; die Steuerübersicht eines Objekts mit anderem Rhythmus lehnt der Server ab.

**Files:**
- Modify: `server/src/index.ts`, `server/src/settlementDiff.ts`, `client/src/settlementHistory.ts`, `client/src/pages/Abrechnung.tsx`, `client/src/pages/Cockpit.tsx`
- Test: `server/test/api.test.ts` (neuer Test), `server/test/period.test.ts` (Wache), `client/src/settlementHistory.test.ts`; Modify: `server/test/settlement-diff.test.ts`, `server/test/calc.test.ts`, `server/test/calc-leerstand-personen.test.ts`

**Interfaces:**
- Consumes (Task 1–5): `resolvePeriodParam`, `rulesOf`, `isCalendarRules`, `periodLabel`, `settlementPeriod`, `settlementDeadline`, `calendarYearPeriod`; `findClosedSettlement(…, period: PeriodKey)` usw.; `snapshotFor(…, period: BillingPeriod)`; `Settlement.period`, `Settlement.deadline`.
- Produces:
  - Routen `/api/settlement/:period`, `/api/settlement/:period/close` (POST, PUT, DELETE), `/api/settlement/:period/history`, `/api/consumption/:period`
  - `compareWithFrozen(frozen, currentOrCompute, deadline: string, today: string)`
  - `deadlineView(label: string, deadline: string, sentAt: string | null, history: HistoryEntry[], today: Date): DeadlineView`

- [ ] **Step 1: Write the failing tests**

An `server/test/api.test.ts` anhängen (Importe ergänzen: `eq` aus `'drizzle-orm'`,
`properties as propertiesTable` in die Importzeile aus `'../src/db/schema.ts'`):

```ts
test('Zeitraum (#208): die Jahreszahl nur beim Kalenderobjekt, JJJJ-MM mit Zeitraum und Frist, Steuer folgt später', async () => {
  const s = await startServer()
  try {
    const kalender = await s.api<Settlement>('/api/settlement/2025')
    assert.deepEqual([kalender.period.key, kalender.period.label, kalender.deadline], ['2025-01', '2025', '2026-12-31'])
    assert.equal((await s.api<Settlement>('/api/settlement/2025-01')).period.label, '2025')

    // Ein zweites Objekt, das Mai bis April abrechnet. In dieser Version setzt das nur die
    // Datenbank selbst (Bedienung: PR 3).
    const mai = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Gartenweg 3', kind: 'mfh', address: '' }) })
    await inDatabase(s, async (db) => { await db.update(propertiesTable).set({ periodStartMonth: 5 }).where(eq(propertiesTable.id, mai.id)) })
    const q = `?property=${mai.id}`

    const alt = await fetch(`${s.base}/api/settlement/2025${q}`)
    assert.equal(alt.status, 404)
    assert.equal(await errorFrom(alt), 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026?')
    const neu = await s.api<Settlement>(`/api/settlement/2025-05${q}`)
    assert.deepEqual([neu.period.from, neu.period.to, neu.period.label, neu.deadline, neu.daysInYear], ['2025-05-01', '2026-04-30', '2025/2026', '2027-04-30', 365])
    assert.equal((await fetch(`${s.base}/api/settlement/2025-13${q}`)).status, 400)

    // Abschließen, Versand, Verlauf und Wiederöffnen über denselben Schlüssel.
    const post = (path: string) => fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal((await post(`/api/settlement/2025-05/close${q}`)).status, 201)
    const doppelt = await post(`/api/settlement/2025-05/close${q}`)
    assert.equal(doppelt.status, 409)
    assert.equal(await errorFrom(doppelt), 'Abrechnung 2025/2026 ist bereits abgeschlossen.')
    const zu = await s.api<Settlement>(`/api/settlement/2025-05${q}`)
    assert.ok(zu.closed, 'abgeschlossen')
    assert.equal(zu.deadline, '2027-04-30')
    await s.api(`/api/settlement/2025-05/close${q}`, { method: 'PUT', body: JSON.stringify({ sentAt: '2026-06-01' }) })
    await s.api(`/api/settlement/2025-05/close${q}`, { method: 'DELETE' })
    assert.equal((await s.api<unknown[]>(`/api/settlement/2025-05/history${q}`)).length, 1)

    // Verbrauch über denselben Zeitraum; das Mietkonto bleibt Kalenderjahr; die Steuer kommt mit PR 3.
    assert.equal((await fetch(`${s.base}/api/consumption/2025${q}`)).status, 404)
    assert.equal((await fetch(`${s.base}/api/consumption/2025-05${q}`)).status, 200)
    assert.equal((await s.api<{ year: number }>(`/api/rentledger/2025${q}`)).year, 2025)
    const steuer = await fetch(`${s.base}/api/taxreport/2025${q}`)
    assert.equal(steuer.status, 400)
    assert.equal(await errorFrom(steuer), 'Die Steuerübersicht für ein Objekt mit abweichendem Abrechnungszeitraum kommt mit einer späteren Version.')
    assert.equal((await fetch(`${s.base}/api/receipts/tax/2025${q}`)).status, 400)

    // Ein alter Tab schreibt mit Jahreszahl: abgelehnt statt still in einen anderen Zeitraum
    // (Review Focus 1). Die Liste nennt für dieses Objekt kein Jahr, es gäbe keines, das stimmte.
    const altTab = await fetch(`${s.base}/api/costItems${q}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }),
    })
    assert.equal(altTab.status, 400)
    assert.match(await errorFrom(altTab), /älter als das Programm/)
    await s.api(`/api/costItems${q}`, { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }) })
    const [item] = await s.api<(CostItem & { year?: number })[]>(`/api/costItems${q}`)
    assert.deepEqual([item?.period, item?.year], ['2025-05', undefined])
  } finally {
    s.stop()
  }
})

test('Zeitraum (#208): eine vor dem Update abgeschlossene Abrechnung bekommt Zeitraum und Frist von der Route', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-alt-'))
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: {}, units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    closedSettlements: [{
      id: 'alt', year: 2030, closedAt: '2031-01-05', sentAt: null,
      settlement: { year: 2030, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 0 }, totalCostsCents: 0, warnings: [] },
    }],
  }))
  const s = await startServerIn(dataDir)
  try {
    const alt = await s.api<Settlement>('/api/settlement/2030')
    assert.deepEqual([alt.period.label, alt.deadline, alt.closed?.closedAt], ['2030', '2031-12-31', '2031-01-05'])
    assert.equal(alt.deviation?.deadline, '2031-12-31')
  } finally {
    s.stop()
  }
})
```

An `server/test/period.test.ts` anhängen:

```ts
test('Wache: die Frist rechnet nur noch settlementDeadline (#208)', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  for (const file of ['server/src/settlementDiff.ts', 'client/src/settlementHistory.ts', 'client/src/pages/Cockpit.tsx']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(text, /-12-31|year \+ 1\b|Date\.UTC\(year/, `${file} rechnet die Frist selbst`)
  }
})
```

In `client/src/settlementHistory.test.ts` anhängen:

```ts
  test('Mai bis April: Bezeichnung und Frist kommen von der Abrechnung (#208)', () => {
    expect(deadlineView('2025/2026', '2027-04-30', null, [], heute).text)
      .toBe('Abrechnungsfrist (§556 BGB): Die Abrechnung 2025/2026 muss dem Mieter bis zum 30.04.2027 zugehen — noch 211 Tage.')
  })
```

(innerhalb des `describe('Frist nach § 556 Abs. 3 BGB …')`, damit `heute` gilt).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix server test -- test/api.test.ts --test-name-pattern "Zeitraum \(#208\)" && npm --prefix server test -- test/period.test.ts && npm --prefix client test -- settlementHistory`
Expected: FAIL. `/api/settlement/2025-05` antwortet 400 („Ungültiges Jahr“), die vor dem Update
abgeschlossene Abrechnung hat kein `period`, die Wache findet `-12-31` in allen drei Dateien,
`deadlineView` erwartet eine Jahreszahl.

- [ ] **Step 3: Routen (`server/src/index.ts`)**

Importe aus `'../../shared/period.ts'`: `calendarYearPeriod, isCalendarRules, periodLabel,
resolvePeriodParam, rulesOf, settlementDeadline, settlementPeriod`; `BillingPeriod` als Typ.

Hinter `propertyOf`:

```ts
// Der Zeitraum einer Anfrage (#208): der Monat des Beginns als `JJJJ-MM`, bei einem reinen
// Kalenderobjekt auch die nackte Jahreszahl (G-C6). Gibt es ihn für das Objekt nicht, nennt die
// Antwort, was gemeint sein könnte; ein Tab von vor einem Wechsel bekommt so nie still den Rumpf.
async function periodOf(db: Database, req: Request, propertyId: string): Promise<BillingPeriod> {
  const property = (await listProperties(db)).find((p) => p.id === propertyId)
  const resolved = resolvePeriodParam(rulesOf(property), String(req.params.period ?? ''))
  if ('error' in resolved) throw new RouteProblem(resolved.status, resolved.error)
  return resolved.period
}

// Steuer und Mietkonto rechnen im Kalenderjahr (#208). Die Steuerübersicht eines Objekts mit anderem
// Rhythmus schöpft aus zwei Abrechnungen und kommt mit PR 3; bis dahin lieber ablehnen als eine Zahl
// nennen, die aus einer halben Abrechnung stammt.
async function requireCalendarObject(db: Database, propertyId: string): Promise<void> {
  const property = (await listProperties(db)).find((p) => p.id === propertyId)
  if (!isCalendarRules(rulesOf(property))) {
    throw new RouteProblem(400, 'Die Steuerübersicht für ein Objekt mit abweichendem Abrechnungszeitraum kommt mit einer späteren Version.')
  }
}
```

Die Abrechnungsrouten ersetzen (`sentAtOf`, `SENT_AT_INVALID`, `isDateOnly` bleiben):

```ts
// Liefert die abgeschlossene (eingefrorene) Abrechnung, falls vorhanden — sonst live berechnet.
app.get('/api/settlement/:period', async (req, res) => {
  const { closed, stock, property, period } = await readData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    return { property, period, closed: await findClosedSettlement(db, property, period.key), stock: await readStock(db) }
  })
  // Zeitraum und Frist (#208) stehen in jeder Antwort, auch bei einer vorher abgeschlossenen
  // Abrechnung, die sie noch nicht kennt: Die Oberfläche rechnet die Frist nicht mehr selbst.
  const frame = { period: settlementPeriod(period), deadline: settlementDeadline(period) }
  // (die bisherigen Kommentare zu selfUsedShareCents und zum eingefrorenen Stand bleiben hier)
  if (closed) {
    const stand = closed.settlement !== null && typeof closed.settlement === 'object' ? closed.settlement : {}
    const deviation = compareWithFrozen(closed.settlement, () => computeSettlement(snapshotFor(stock, property, period), { asOf: today() }), frame.deadline, today())
    return res.json({ selfUsedShareCents: 0, ...stand, ...frame, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt }, deviation })
  }
  res.json({ ...computeSettlement(snapshotFor(stock, property, period), { asOf: today() }), closed: null })
})
```

```ts
app.post('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  // Rechnen und Einfrieren im selben Vorgang: … (bisheriger Kommentar)
  const ergebnis = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    const period = await periodOf(db, req, property)
    const label = periodLabel(period)
    if (await findClosedSettlement(db, property, period.key)) return { schonDa: true, label }
    await closeSettlement(db, {
      id: newId(),
      propertyId: property,
      period: period.key,
      closedAt: new Date().toISOString(),
      sentAt,
      settlement: computeSettlement(snapshotFor(await readStock(db), property, period), { asOf: today() }),
    })
    return { schonDa: false, label }
  })
  if (ergebnis.schonDa) return res.status(409).json({ error: `Abrechnung ${ergebnis.label} ist bereits abgeschlossen.` })
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:period/close', async (req, res) => {
  const sentAt = sentAtOf(req)
  if (sentAt === false) return res.status(400).json({ error: SENT_AT_INVALID })
  const gefunden = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    return setSentAt(db, property, (await periodOf(db, req, property)).key, sentAt)
  })
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Frühere Abschlüsse eines Zeitraums (#56, Teil 2): … (bisheriger Kommentar)
app.get('/api/settlement/:period/history', async (req, res) => {
  res.json(await readData(async (db) => {
    const property = await propertyOf(db, req)
    return settlementHistory(db, property, (await periodOf(db, req, property)).key)
  }))
})

// Wieder öffnen: Der Stand wandert in den Verlauf, es gilt wieder die laufende Berechnung (#56).
app.delete('/api/settlement/:period/close', async (req, res) => {
  const gefunden = await writeData(async (db) => {
    const property = await propertyOf(db, req)
    return reopenSettlement(db, property, (await periodOf(db, req, property)).key, newId())
  })
  if (!gefunden) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  res.json({ ok: true })
})

// Verbrauch über den Zeitraum der Abrechnung (#208): Die Zähler-Seite zeigt denselben Zeitraum.
app.get('/api/consumption/:period', async (req, res) => {
  res.json(await readData(async (db) => {
    const property = await propertyOf(db, req)
    return consumptionOverview(snapshotFor(await readStock(db), property, await periodOf(db, req, property)))
  }))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis im **Kalenderjahr** (#208, Entwurf 3.11), auch bei
// einem Objekt mit anderem Rhythmus. Es liest keine Kostenposition, der Zeitraum dient nur dem Jahr.
app.get('/api/rentledger/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => rentLedger(snapshotFor(await readStock(db), await propertyOf(db, req), calendarYearPeriod(year)), { asOf: today() })))
})

// Steuer-Übersicht (Hilfe für die Anlage V) im Kalenderjahr: Einnahmen, Werbungskosten, Überschuss
app.get('/api/taxreport/:year', async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(await readData(async (db) => {
    const property = await propertyOf(db, req)
    await requireCalendarObject(db, property)
    return taxReport(snapshotFor(await readStock(db), property, calendarYearPeriod(year)))
  }))
})
```

In `/api/receipts/tax/:year` innerhalb des `readData`-Rumpfes, direkt nachdem das Objekt feststeht:
`await requireCalendarObject(db, propertyId)`.

Run: `grep -n "'/api/settlement/:year\|'/api/consumption/:year\|calendarPeriod(year)" server/src/index.ts`
Expected: keine Treffer außer in `/api/receipts/tax/:year` (dort filtert `calendarPeriod(year)` die
Positionen des Kalenderjahres; `calendarPeriod` bleibt dafür importiert).

- [ ] **Step 4: Frist als Parameter (`server/src/settlementDiff.ts`)**

```ts
// `deadline` ist das Ende der Frist nach § 556 Abs. 3 BGB für den Zeitraum der Abrechnung
// (`settlementDeadline`, #208), `today` der heutige Tag als JJJJ-MM-TT; beide hineingereicht, damit
// der Test nicht vom Kalender abhängt. …(übriger Kommentar unverändert)
export function compareWithFrozen(frozen: unknown, currentOrCompute: { statements: Saldo[] } | (() => { statements: Saldo[] }), deadline: string, today: string): SettlementComparison {
  const deadlinePassed = today > deadline
```

(die Zeile `const deadline = \`${year + 1}-12-31\`` samt Kommentar entfällt).

Aufrufer in Tests: in `server/test/settlement-diff.test.ts`, `server/test/calc.test.ts` und
`server/test/calc-leerstand-personen.test.ts` wird das Jahr im dritten Argument zur Frist:

```bash
node -e "
const fs = require('node:fs')
for (const f of ['server/test/settlement-diff.test.ts', 'server/test/calc.test.ts', 'server/test/calc-leerstand-personen.test.ts']) {
  const t = fs.readFileSync(f, 'utf8').replace(/(compareWithFrozen\([^\n]*?), (\d{4}), ('\d{4}-\d{2}-\d{2}')\)/g, (_m, head, year, today) => \`\${head}, '\${Number(year) + 1}-12-31', \${today})\`)
  fs.writeFileSync(f, t)
}"
grep -n "compareWithFrozen(" server/test/*.ts
```

Expected: jeder Aufruf hat als drittes Argument eine Frist wie `'2026-12-31'`. Steht ein Aufruf über
mehrere Zeilen (settlement-diff.test.ts, Tests ab Zeile 17 und 29), dort das Jahr `2025` von Hand durch
`'2026-12-31'` ersetzen.

- [ ] **Step 5: Oberfläche (`client/src/settlementHistory.ts`, `Abrechnung.tsx`, `Cockpit.tsx`)**

`client/src/settlementHistory.ts`:

```ts
// … (bisheriger Kommentar) Bezeichnung und Ende der Frist kommen von der Abrechnung des Servers
// (#208); die Seite rechnet sie nicht selbst.
export function deadlineView(label: string, deadline: string, sentAt: string | null, history: HistoryEntry[], today: Date): DeadlineView {
  const end = deadline
  const endText = fmtDate(deadline)
  const daysLeft = Math.ceil((Date.parse(`${deadline}T00:00:00Z`) - today.getTime()) / 86400000)
```

und im Rest der Funktion jedes `${year}` durch `${label}` ersetzen (sechs Stellen). Die Aufrufe in
`client/src/settlementHistory.test.ts`: `deadlineView(2025, …)` → `deadlineView('2025', '2026-12-31', …)`,
`deadlineView(2024, …)` → `deadlineView('2024', '2025-12-31', …)`.

`client/src/pages/Abrechnung.tsx`:

```tsx
  // §556 Abs. 3 BGB: … (bisheriger Kommentar). Bezeichnung und Frist vom Server (#208).
  const deadlineInfo = data ? deadlineView(data.period.label, data.deadline, data.closed?.sentAt ?? null, history, new Date()) : null
```

```tsx
      {data && deadlineInfo && data.totalCostsCents > 0 && (
        <div className={`${deadlineInfo.level} no-print`}>{deadlineInfo.text}</div>
      )}
```

und im Drucktitel `Nebenkostenabrechnung ${year}` → `Nebenkostenabrechnung ${data?.period.label ?? year}`.

`client/src/pages/Cockpit.tsx` (Import `fmtDate` ist da):

```tsx
  // §556 Abs. 3 BGB: Zugang beim Mieter binnen 12 Monaten nach Ende des Abrechnungszeitraums. Die
  // Frist kommt vom Server (#208); vor dem Laden gibt es keine.
  const deadline = settlement?.deadline ?? null
  const daysLeft = deadline === null ? 0 : Math.ceil((Date.parse(`${deadline}T00:00:00Z`) - Date.now()) / 86400000)
```

In den Prüfungen „Abgeschlossen & versendet“:

```tsx
    } else if (closed?.sentAt) {
      const ok = closed.sentAt <= settlement.deadline
```

```tsx
      const deadlineText = daysLeft >= 0
        ? `Noch ${daysLeft} Tage bis zur Frist (${fmtDate(settlement.deadline)}).`
        : `Frist am ${fmtDate(settlement.deadline)} abgelaufen.`
```

- [ ] **Step 6: Run tests**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS; der Build des Clients ohne Fehler. Scheitert ein jsdom-Test, weil er Cockpit oder
Abrechnung mit einer Abrechnung ohne `deadline` rendert (ein Objekt ohne Typ, etwa
`{ year: YEAR, statements: [], closed }` in erfassen.test.tsx), bekommt sie `period` und `deadline`
wie in Task 5 Step 7; mockt ein Test die URL `/api/settlement/${YEAR}`, bleibt sie, denn die
Oberfläche fragt bis PR 3 mit der Jahreszahl.

- [ ] **Step 7: Commit**

```bash
git add server client
git commit -m "Zeitraum: Routen nehmen JJJJ-MM, die Jahreszahl nur beim Kalenderobjekt; Frist vom Server

Refs #208"
```

---

### Task 7: Nach PR 1: Rechtsregister, Kabelzeilen, Doku, Gesamtprüfung

Erst, wenn PR 1 gemergt ist. Der Entwurf weist PR 2 zwei Parameter zu (4.3: `bgb.deadline-months`,
`bgb.max-period-months`, je 12, Zeitregel `periodStart`); sie kommen jetzt ins Register und frieren
mit jeder Abrechnung ein. Die Kabelzeilen, die PR 1 auf das Register umgestellt hat, rechnen danach
über den Zeitraum statt über das Kalenderjahr des Beginns.

**Files:**
- Modify: `shared/law/bgb-betrkv.ts`, `shared/law/params.ts`, `shared/period.ts`, `server/src/calc.ts`
- Modify: `server/test/law-history.test.ts`, `server/test/law-literals.test.ts`, `server/test/calc-rechtswerte.test.ts`, `server/test/calc-kabel.test.ts`, `server/test/calc-zeitraum.test.ts`
- Modify: `CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: aus PR 1 `LawParam`, `valueAt`, `law`, `lawLog`, `lawPeriod`, `LAW_PARAMS`, `betrkvTvSignal`, die Variablen `tv`, `tvNewFrom`, `tvUntil` in `computeSettlement`; aus Task 1–6 `settlementDeadline(p, months?)`, `periodLabel`, `label`.
- Produces: `bgbMaxPeriodMonths: LawParam<number, 'periodStart'>`, `bgbDeadlineMonths: LawParam<number, 'periodStart'>` (shared/law/bgb-betrkv.ts).

- [ ] **Step 1: Auf `main` mit PR 1 umstellen**

```bash
git fetch origin
git rebase origin/main
```

Konflikte nach der Tabelle „Überschneidungen mit PR 1“ auflösen. Danach die Umschreiber noch einmal
über die Dateien laufen lassen, die PR 1 geändert hat:

```bash
node /tmp/zeitraum-umschreiber.mjs snapshot server/test/calc-leerstand-personen.test.ts server/test/calc-notices.test.ts \
  server/test/rechtsdurchsicht-2026.test.ts server/test/rechtstexte.test.ts server/test/calc-rechtswerte.test.ts
```

und den Umschreiber für `compareWithFrozen` aus Task 6 Step 4 über `server/test/settlement-diff.test.ts`.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Write the failing tests**

`server/test/law-history.test.ts`, in `SHIPPED` am Ende:

```ts
  // 0.11.0 (Heizung PR 2, #208)
  'bgb.deadline-months|||12',
  'bgb.max-period-months|||12',
```

`server/test/law-literals.test.ts`: `shared/period.ts` in `ENGINE_FILES` aufnehmen (der Kommentar
dort kündigt es an):

```ts
const ENGINE_FILES = ['server/src/calc.ts', 'server/src/snapshot.ts', 'shared/heating.ts', 'shared/period.ts']
```

`server/test/calc-rechtswerte.test.ts`: Frist und Höchstdauer gelten für jede Abrechnung; die Tests,
die nach den übrigen Werten fragen, sehen sie nicht:

```ts
// Frist und Höchstdauer des Zeitraums (#208) stehen in jeder Abrechnung; gefragt wird hier nach den
// übrigen, deshalb ohne sie.
const ids = (s: ComputedSettlement) => s.legalBasis.values.map((v) => v.id).filter((id) => !id.startsWith('bgb.')).sort()
```

dort die beiden Zeilen `assert.deepEqual(s.legalBasis.values, [])` und
`assert.deepEqual(plain.legalBasis.values, [])` → `assert.deepEqual(ids(s), [])` bzw.
`assert.deepEqual(ids(plain), [])`, `leer.legalBasis.values[0]?.text` →
`leer.legalBasis.values.find((v) => v.id === 'practice.vacancy-persons')?.text` und
`s.legalBasis.values[0]?.validTo` → `s.legalBasis.values.find((v) => v.id === 'betrkv.tv-signal')?.validTo`. Dazu:

```ts
test('Rechtswerte: Frist und Höchstdauer des Zeitraums frieren in jeder Abrechnung ein (#208)', () => {
  const s = computeSettlement(snap(2025, { ...two, costItems: [item(2025, {})] }))
  const bgb = s.legalBasis.values.filter((v) => v.id.startsWith('bgb.')).map((v) => [v.id, v.value])
  assert.deepEqual(bgb.sort(), [['bgb.deadline-months', 12], ['bgb.max-period-months', 12]])
  assert.equal(s.deadline, '2026-12-31')
})
```

`server/test/calc-kabel.test.ts` (Importe: `snapshotOfPeriod`, Typ `SnapshotCostItem` aus
`'../src/snapshot.ts'`; `periodKey, periodOfKey, previousPeriod` aus `'../../shared/period.ts'`;
Typ `PeriodRules` aus `'../../shared/types.ts'`):

```ts
test('Kabel über den Zeitraum (#208): Mai–April nennt den Zeitraum, ein Rumpf vor der Errichtung ist nicht betroffen', () => {
  const kabel = (key: string): SnapshotCostItem => ({ id: 'k', period: periodKey(key), category: 'Kabel/Antenne', description: 'Kabelanschluss', amountCents: 12000, key: 'units' })
  const neueAnlage = { kind: 'mfh' as const, cableBuiltBeforeDec2021: false }
  const at = (rules: PeriodRules, key: string, property: { kind: 'mfh', cableBuiltBeforeDec2021: boolean | null } | null) => {
    const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
    return computeSettlement({ ...snapshotOfPeriod({ ...bestand(2021), costItems: [kabel(key)] }, p, previousPeriod(rules, p)), property }).notices
  }
  const mai: PeriodRules = { startMonth: 5, changes: [] }
  const neu = at(mai, '2021-05', neueAnlage).find((x) => x.code === 'tv-signal.new-system') ?? assert.fail('kein Hinweis')
  assert.match(neu.text, /Für 2021\/2022 gilt das für die Kosten ab der Errichtung/)
  const wechsel: PeriodRules = { startMonth: 1, changes: ['2021-05'] }
  assert.equal(at(wechsel, '2021-01', neueAnlage).some((x) => x.code === 'tv-signal.new-system'), false, 'der Rumpf endet am 30.04.2021, vor der Errichtung')
  // Das Übergangsjahr Mai–April: Die Regel endet am 30.06.2024, mitten im Zeitraum; „das erste
  // Halbjahr“ wäre hier Mai bis Oktober und damit falsch.
  const teil = at(mai, '2024-05', null).find((x) => x.code === 'tv-signal.partial-year') ?? assert.fail('kein Übergangshinweis')
  assert.match(teil.text, /Umlegen dürfen Sie für 2024\/2025 höchstens die Zeit bis zum 30\.06\.2024/)
})
```

`server/test/calc-zeitraum.test.ts`, in der Wache die Musterliste ergänzen um
`/\byear\s*(>=|<=|===|!==|>|<)/` und `/\$\{year\}/`.

Run: `npm --prefix server test -- test/law-history.test.ts test/law-literals.test.ts test/calc-rechtswerte.test.ts test/calc-kabel.test.ts test/calc-zeitraum.test.ts`
Expected: FAIL: Die Historie kennt zwei Zeilen ohne Fassung, die Rechtswerte enthalten keine
`bgb.*`, der Kabelhinweis sagt „Für 2021 gilt“ und meldet den Rumpf, der Übergangstext sagt „das
erste Halbjahr“, die Wache findet `year >= tvNewYear` und `${year}`.

- [ ] **Step 3: Implement: Parameter im Register**

`shared/law/bgb-betrkv.ts`, den Kopfkommentar „Frist und Höchstdauer … kommen mit PR 2.“ ersetzen
durch „Frist und Höchstdauer des Abrechnungszeitraums (§ 556 Abs. 3 BGB, #208).“ und anfügen:

```ts
const bgb556 = (cite: string): Source => ({ rank: 'law', cite, url: 'https://www.gesetze-im-internet.de/bgb/__556.html', retrieved: '2026-10-05', checked: 'checked' })

// Abgerechnet wird jährlich (§ 556 Abs. 3 Satz 1 BGB); ein Abrechnungszeitraum ist deshalb nach
// herrschender Meinung höchstens zwölf Monate lang. Shared/period.ts bildet daraus die Zeiträume,
// vor jedem Wechsel einen Rumpf. Wortlaut geprüft am 05.10.2026 (Entwurf 2, 4.3).
export const bgbMaxPeriodMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.max-period-months',
  title: 'Höchstdauer des Abrechnungszeitraums',
  norm: '§ 556 Abs. 3 Satz 1 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 1 BGB (herrschende Meinung)'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `höchstens ${v} Monate`,
}

// Die Abrechnung muss dem Mieter spätestens bis zum Ablauf des zwölften Monats nach Ende des
// Abrechnungszeitraums mitgeteilt werden (§ 556 Abs. 3 Satz 2 BGB); danach ist eine Nachforderung
// ausgeschlossen, es sei denn, der Vermieter hat die Verspätung nicht zu vertreten (Satz 3).
export const bgbDeadlineMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.deadline-months',
  title: 'Abrechnungsfrist',
  norm: '§ 556 Abs. 3 Satz 2 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 2 BGB'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `Zugang bis zum Ablauf des ${v}. Monats nach Ende des Zeitraums`,
}
```

(`Source` als Typ aus `'./register.ts'` importieren.) In `shared/law/params.ts` beide importieren und
in `LAW_PARAMS` hinter `betrkvTvSignal` einreihen (`bgbDeadlineMonths`, `bgbMaxPeriodMonths`).

`shared/period.ts`: die beiden Konstanten samt Kommentar ersetzen durch

```ts
import { valueAt } from './law/register.ts'
import { bgbDeadlineMonths, bgbMaxPeriodMonths } from './law/bgb-betrkv.ts'

// § 556 Abs. 3 BGB aus dem Rechtsregister (#208, Entwurf 4.3), Zeitregel `periodStart`: es gilt die
// Fassung am Beginn des Zeitraums.
const maxPeriodMonths = (start: number): number => valueAt(bgbMaxPeriodMonths, firstDay(start))
```

und `MAX_PERIOD_MONTHS` in `nextStart` und `periodAt` durch `maxPeriodMonths(start)`;

```ts
export function settlementDeadline(p: Pick<BillingPeriod, 'from' | 'to'>, months: number = valueAt(bgbDeadlineMonths, p.from)): string {
  return lastDay(indexOfDate(p.to) + months)
}
```

(`firstDay` steht oben in der Datei; die Importe gehören an den Dateianfang. In
`server/src/settlementDiff.ts` und Tests wird `settlementDeadline` nur mit einem `BillingPeriod`
aufgerufen, das `from` hat.)

`server/src/calc.ts` (Importe `bgbDeadlineMonths, bgbMaxPeriodMonths` aus
`'../../shared/law/bgb-betrkv.ts'`), im Ergebnis von `computeSettlement`:

```ts
    period: settlementPeriod(period),
    // Frist und Höchstdauer des Zeitraums frieren mit ein wie jeder Rechtswert (#208, Entwurf 4.4).
    deadline: settlementDeadline(period, law(bgbDeadlineMonths, { period: lawPeriod }, lawLog)),
```

und direkt vor `const result: ComputedSettlement = {`:

```ts
  // Die Höchstdauer hat P gebildet (shared/period.ts); eingefroren wird sie hier.
  law(bgbMaxPeriodMonths, { period: lawPeriod }, lawLog)
```

- [ ] **Step 4: Implement: Kabelzeilen über den Zeitraum**

In `computeSettlement`, im Kabelblock in der Fassung von PR 1:

```ts
  // Eine Anlage ab dem Stichtag der Regel fiel nie unter sie (#121, § 2 Satz 2 BetrKV): dann in
  // jedem Zeitraum, der bis in die Zeit ab dem Stichtag reicht, dieselbe Warnung (#208).
  const newSystem = tv !== null && snapshot.property?.cableBuiltBeforeDec2021 === false && yTo >= tvNewFrom
  // Fällt der Stichtag in den Zeitraum, gilt die Warnung für die Kosten ab der Errichtung.
  const newSystemInPeriod = yFrom < tvNewFrom && yTo >= tvNewFrom
  // „Das erste Halbjahr“ stimmt nur im Kalenderjahr; sonst nennt der Text das Ende der Regel (#208).
  const kalenderjahr = calendarYearPeriod(year)
  const umlegbar = yFrom === kalenderjahr.from && yTo === kalenderjahr.to ? `für ${label} höchstens das erste Halbjahr` : `für ${label} höchstens die Zeit bis zum ${fmtDay(tvUntil)}`
```

(die Zeile `const tvNewYear = …` entfällt), im Text von `tv-signal.new-system`
`${year === tvNewYear ? \` Für ${year} gilt das …\` : ''}` →
`${newSystemInPeriod ? \` Für ${label} gilt das für die Kosten ab der Errichtung; was davor auf eine ältere Anlage entfiel, war umlagefähig.\` : ''}`,
und im Text von `tv-signal.partial-year` `Umlegen dürfen Sie für ${year} höchstens das erste Halbjahr` →
`Umlegen dürfen Sie ${umlegbar}`. Für ein Kalenderjahr ergibt jede der drei Bedingungen dasselbe wie
vorher, der Prüfkatalog bleibt wortgleich.

Run: `npm --prefix server test -- test/law-history.test.ts test/law-literals.test.ts test/calc-rechtswerte.test.ts test/calc-kabel.test.ts test/calc-zeitraum.test.ts test/settlement-golden.test.ts test/period.test.ts`
Expected: PASS.

- [ ] **Step 5: Doku**

`CHANGELOG.md`, unter „Unveröffentlicht“, Abschnitt „Geändert“:

```markdown
- Abrechnungszeiträume werden intern als Zeitraum geführt und nicht mehr als Kalenderjahr: Kostenpositionen, abgeschlossene Abrechnungen und gezahlte Vorauszahlungen hängen an einem Zeitraum, der im Kalenderjahr wie bisher heißt. Wer im Kalenderjahr abrechnet, merkt davon nichts; jede Zahl bleibt gleich. Die Abrechnung nennt ihre Frist jetzt selbst, und Frist und Höchstdauer des Zeitraums (§ 556 Abs. 3 BGB) frieren mit der abgeschlossenen Abrechnung ein. Vorbereitung für Abrechnungszeiträume wie Mai bis April ([#208](https://github.com/speedone/mietfuchs/issues/208)).
```

`CLAUDE.md`, neuer Abschnitt hinter „**Objekte** (#92)“:

```markdown
**Abrechnungszeitraum** (#208, Kern): Ein Objekt rechnet im Kalenderjahr oder in einem eigenen
Rhythmus ab. **Der Zeitraum ist ein eigener Schlüssel** `PeriodKey` (`'JJJJ-MM'`, Monat des Beginns,
Markentyp in shared/types.ts), und kein Jahr: `cost_items.period`, `closed_settlements.period`,
`closed_settlement_history.period`, `prepayment_overrides.period` und `assessments.requested_period`
(nur mit Objekt). `uploads.year`, `assessments.year` und `detected_year` bleiben Kalenderjahre, denn
sie sind Tatsachen über den Beleg. **Die Zeiträume werden berechnet und nie gespeichert**
([shared/period.ts](shared/period.ts)): aus `properties.period_start_month` und `period_changes`
entstehen lückenlose Zeiträume von höchstens zwölf Monaten (`bgb.max-period-months`), vor jedem
Wechsel ein Rumpf. Aus Text wird ein Schlüssel nur dort (Wächter in period.test.ts). Der
Schnappschuss trägt P und den Vorzeitraum, `computeSettlement` rechnet über dessen Grenzen und
Monate, eine Wache in calc-zeitraum.test.ts verbietet Kalenderdaten in seinem Rumpf. **Mietkonto und
Steuer bleiben Kalenderjahr**; die Abrechnung teilt sich mit dem Mietkonto die Monatsrechnung
`ledgerRows`. Die Routen der Abrechnung und des Verbrauchs nehmen `JJJJ-MM`; **die nackte Jahreszahl
gilt nur bei einem reinen Kalenderobjekt**, sonst 404 mit einem Satz, der den gemeinten Zeitraum
nennt, damit ein alter Tab nie still einen Rumpf bekommt. Dasselbe beim Schreiben: `year` statt
`period` oder eine vierstellige Jahreskorrektur nimmt repository.ts nur beim Kalenderobjekt an
(`PeriodError`), und die Liste der Kostenpositionen nennt einem alten Tab dort weiter `year`. Ein
Schlüssel, den es für sein Objekt nicht gibt, wird beim Schreiben abgelehnt und beim Wiederherstellen
eines Archivs ebenso (`orphanPeriodKeys`). Die Frist kommt vom Server (`Settlement.deadline`,
`settlementDeadline` mit `bgb.deadline-months`) und friert mit ein. **Bedienung fehlt noch** (PR 3
des Meilensteins Heizung): Rhythmus und Wechsel lassen sich über die Oberfläche nicht setzen, die
Oberfläche denkt in Kalenderjahren und übersetzt an Stellen mit dem Kommentar „Brücke Kalenderjahr
(#208)“.
```

- [ ] **Step 6: Gesamtprüfung**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

Run: `node scripts/umstieg-praxislauf.mjs`
Expected: alle Fälle bestanden (der Umstieg schreibt auf 0000, danach läuft die Kette mit 0014 und
0015; Fall 7 mit Archiven von vor der Datenbank ebenso).

Run: `grep -rn "Brücke Kalenderjahr" client shared server/src | wc -l`
Expected: eine Zahl größer 0; die Liste gehört in die PR-Beschreibung als Übergabe an PR 3.

- [ ] **Step 7: Commit**

```bash
git add shared server CHANGELOG.md CLAUDE.md
git commit -m "Zeitraum: Frist und Höchstdauer aus dem Rechtsregister, Kabelregel über den Zeitraum, Doku

Refs #208"
```

- [ ] **Step 8: Durchsicht und PR**

Durchsicht mit frischem Kontext über `main..HEAD` (CLAUDE.md „Durchsicht vor jedem PR“), mit den
fünf Punkten aus „Review Focus“ und den Brücken als Schwerpunkt. Jeder Befund bekommt einen Test,
der vorher rot war. PR gegen `main` mit `Refs #208` (nicht `Fixes`), Befunden der Durchsicht und
der Liste der Brücken in der Beschreibung.

---

## Selbstprüfung

**Abdeckung des Entwurfs (13, PR 2):**

| Anforderung | Task |
|---|---|
| `shared/period.ts` (`periodOfKey`, `periodContaining`, `periodsBetween`, `previousPeriod`, `periodLabel`, `settlementDeadline`), `PeriodKey` als Markentyp, nur dort erzeugt | 1 |
| 0014 Spalten und Daten (`printf('%04d-01', year)`), `period_start_month`, `period_changes` | 2 |
| 0015 Pflicht, `year` entfällt, Prüfbedingung mit Monat 1..12, Indizes, eindeutig je Objekt und Zeitraum, PK der Jahreskorrektur, Beginnmonat 1..12, `from_month` | 2 |
| `assessments.requested_period` nur mit Objekt; `uploads.year`, `assessments.year`, `detected_year` bleiben | 2, 3 |
| Kette auf einer Datenbank von 0.10.1 | 2 (db-zeitraum), db-objekte |
| `legacy/read.ts` erzeugt `period`, Snapshot des Kalenderjahres, keine Anlage | 2, 4 |
| Schnappschuss und calc.ts über P, `Snapshot.period` | 4, 5 |
| `ledgerRows` | 5 |
| `settlementDeadline`, `Settlement.deadline`, ersetzt die drei festen Fristen | 5, 6 |
| Alias nur beim reinen Kalenderobjekt, 404 mit Satz | 1, 6 |
| Steuer und Mietkonto bleiben Kalenderjahr | 5, 6 |
| Golden unverändert, Gleichheitstest | 5 |
| Invarianten 3, 6, 11, 12 (Entwurf 12.3) | 1, 5 |
| `period.test.ts`: Fristen, Schaltjahr, Alias, Prüfbedingung 00/13 | 1, 2 |
| Wiederherstellen prüft `orphanPeriodKeys` (5.9) | 3 |
| `bgb.deadline-months`, `bgb.max-period-months` ins Register, eingefroren (4.3, 4.4) | 1 (Konstanten), 7 |
| `shared/period.ts` unter dem Wächter gegen Datumsliterale (PR-1-Plan, `ENGINE_FILES`) | 7 |
| Validator bleibt vierstellig | Global Constraints (keine Änderung) |
| Bedienung, Wechsel-Vorschau, `PeriodProvider`, `period.*`-Hinweise, Leistungszeitraum, Steuer über zwei Abrechnungen, Praxislauf 15/16, Lexikon | bewusst PR 3 |

**Platzhalter:** Die beiden Marken in Task 2 Step 7 sind keine offenen Stellen, sondern Ausgaben
eines Befehls, der davor steht; sie hängen am erzeugten Inhalt. Die Code-Ausschnitte mit „…
(bisheriger Kommentar/Rumpf unverändert)“ ändern nur die gezeigten Zeilen einer bestehenden
Funktion. Sonst keine.

**Typen über die Tasks:** `settlementDeadline(p, months?)` nimmt in Task 1 `Pick<BillingPeriod, 'to'>`,
ab Task 7 `Pick<BillingPeriod, 'from' | 'to'>`; alle Aufrufer geben einen ganzen Zeitraum.
`PeriodKey`, `BillingPeriod`, `SettlementPeriod`, `PeriodContext`,
`contextOf`, `calendarContext`, `calendarYearPeriod` (Task 1) werden in 2–7 mit denselben Namen
benutzt. `findClosedSettlement`/`setSentAt`/`reopenSettlement`/`settlementHistory` nehmen ab Task 2
`PeriodKey`; die Routen geben ab Task 6 `period.key`. `computePrepaymentCents` nimmt ab Task 5 einen
Zeitraum, vorher (Task 2) die Jahreszahl mit `calendarPeriod(year)` als Schlüssel. `CostItem.period`
ist in Task 2 und 3 optional, ab Task 4 Pflicht.

**Review Focus:** Alle fünf Punkte haben einen Test in der genannten Aufgabe (Task 3 und 6 für den
alten Tab, Task 2 und 3 für Auswertung und Objekt, Task 2 für 0.10.1, Task 3 für das Archiv, Task 5
für Rumpf und Schaltjahr).
