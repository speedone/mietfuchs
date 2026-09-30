// Gutschriften und der Eigenanteil (#129). Eine Gutschrift senkt die Kosten einer Position; der
// Teil, der auf die selbstgenutzte Wohnung entfällt, muss mitsinken, sonst weist die
// Steuerübersicht einen zu hohen privaten Anteil aus.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem } from '../src/snapshot.ts'

const item = (id: string, amountCents: number): SnapshotCostItem => ({ id, year: 2025, category: 'Grundsteuer', description: id, amountCents, key: 'area' })

test('Rechnung 1.000 € und Gutschrift −200 €, eigene Wohnung 50 % der Fläche: Eigenanteil 400 €', () => {
  const s = computeSettlement(snapshotOf({
    units: [{ id: 'eigen', name: 'Eigen', areaM2: 50, participates: false, selfUsed: true }, { id: 'a', name: 'A', areaM2: 50, participates: true }],
    tenancies: [{ id: 't', unitId: 'a', tenantName: 'M', persons: 1, personHistory: [], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
    costItems: [item('r', 100000), item('g', -20000)],
    meters: [], readings: [], payments: [], closedSettlements: [],
  }, 2025))
  assert.equal(s.selfUsedShareCents, 40000)
  assert.equal(s.landlord.totalCents, 40000)
  assert.ok(s.selfUsedShareCents <= s.landlord.totalCents)
})
