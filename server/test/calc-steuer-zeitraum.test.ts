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
