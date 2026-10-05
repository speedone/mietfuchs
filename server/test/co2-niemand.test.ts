// Review der Laienprobe, Runde 2 (Punkt 8): Bei „Niemand rechnet ab“ teilt Mietfuchs die CO₂-Kosten
// noch nicht selbst. Der Rat auf der Seite Heizkosten: die Heizposition unangetastet lassen, den
// CO₂-Anteil des Vermieters als Gutschrift der Kostenart Heizung mit demselben Schlüssel und den
// Betrag zusätzlich als „Nicht umlagefähig“ erfassen. Hier wird nachgerechnet, dass das trägt.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { candidatePool } from '../src/assessment.ts'
import { calendarPeriod } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

const P = calendarPeriod(2025)
const item = (id: string, category: string, amountCents: number): SnapshotCostItem => ({ id, period: P, category, description: id, amountCents, key: 'area' })
const tenancy = (id: string, unitId: string) => ({ id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'a', name: 'A', areaM2: 80, participates: true }, { id: 'b', name: 'B', areaM2: 70, participates: true }],
  tenancies: [tenancy('ta', 'a'), tenancy('tb', 'b')],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Punkt 8: Heizung 3.000 €, Gutschrift „CO₂-Anteil Vermieter“ −150 €, nicht umlagefähig 150 €: Mieter um 150 € entlastet, Werbungskosten 3.000 €', () => {
  const ohne = computeSettlement(snapshotOf(haus([item('heizung', HEATING_CATEGORY, 300000)]), 2025))
  const mitRat = haus([item('heizung', HEATING_CATEGORY, 300000), item('co2', HEATING_CATEGORY, -15000), item('nu', 'Nicht umlagefähig', 15000)])
  const mit = computeSettlement(snapshotOf(mitRat, 2025))
  const mieter = (s: typeof mit) => s.statements.reduce((sum, st) => sum + st.totalShareCents, 0)
  assert.equal(mieter(ohne) - mieter(mit), 15000, 'die Mieter tragen zusammen 150 € weniger')
  assert.equal(mit.statements.find((s) => s.tenancyId === 'ta')?.totalShareCents, 152000)
  assert.equal(mit.statements.find((s) => s.tenancyId === 'tb')?.totalShareCents, 133000)
  const steuer = taxReport(snapshotOf(mitRat, 2025))
  assert.equal(steuer.expenses.deductibleCents, 300000, 'Heizung − Gutschrift + nicht umlagefähig = Heizung')
})

test('Punkt 8: Eine spätere Belegbuchung zur Heizung findet die Gutschrift nicht als Ziel, nur die Heizposition', () => {
  const items = [{ id: 'heizung', amountCents: 300000 }, { id: 'co2', amountCents: -15000 }]
  assert.deepEqual(candidatePool(items, 310000, []).map((i) => i.id), ['heizung'])
})
