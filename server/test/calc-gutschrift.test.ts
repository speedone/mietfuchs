// Gutschriften und der Eigenanteil (#129). Eine Gutschrift senkt die Kosten einer Position; der
// Teil, der auf die selbstgenutzte Wohnung entfällt, muss mitsinken, sonst weist die
// Steuerübersicht einen zu hohen privaten Anteil aus.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem } from '../src/snapshot.ts'

const item = (id: string, amountCents: number): SnapshotCostItem => ({ id, period: calendarPeriod(2025), category: 'Grundsteuer', description: id, amountCents, key: 'area' })

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

test('Gutschrift bei Leerstand: der Eigenanteil sinkt höchstens um den Teil, den der Vermieter von ihr trägt', () => {
  // Nur eine Gutschrift, eigene Wohnung und leere Wohnung je 50 m²: Der Vermieter trägt die ganze
  // Gutschrift (−200 €), davon die Hälfte privat.
  const s = computeSettlement(snapshotOf({
    units: [{ id: 'eigen', name: 'Eigen', areaM2: 50, participates: false, selfUsed: true }, { id: 'leer', name: 'Leer', areaM2: 50, participates: true }],
    tenancies: [], costItems: [item('g', -20000)], meters: [], readings: [], payments: [], closedSettlements: [],
  }, 2025))
  assert.equal(s.landlord.totalCents, -20000)
  assert.equal(s.selfUsedShareCents, -10000)
})

test('Invariante mit Gutschriften: je Position hat der Eigenanteil das Vorzeichen des Vermieteranteils und ist betraglich nicht größer', () => {
  let seed = 129
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 300; i++) {
    const units = [
      { id: 'eigen', name: 'Eigen', areaM2: 10 + Math.floor(rnd() * 90), participates: false, selfUsed: true },
      { id: 'a', name: 'A', areaM2: 10 + Math.floor(rnd() * 90), participates: true },
      { id: 'b', name: 'B', areaM2: 10 + Math.floor(rnd() * 90), participates: true },
    ]
    const start = rnd() < 0.5 ? '2024-01-01' : '2025-07-01'
    const tenancies = [{ id: 't', unitId: 'a', tenantName: 'M', persons: 1, personHistory: [], start, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
    const amount = Math.round((rnd() - 0.5) * 200000) || 1
    const s = computeSettlement(snapshotOf({ units, tenancies, costItems: [item('x', amount)], meters: [], readings: [], payments: [], closedSettlements: [] }, 2025))
    const l = s.landlord.totalCents
    const e = s.selfUsedShareCents
    assert.ok(e === 0 || Math.sign(e) === Math.sign(l), `Fall ${i}: Vorzeichen ${e} gegen ${l}`)
    assert.ok(Math.abs(e) <= Math.abs(l), `Fall ${i}: Eigenanteil ${e} über Vermieteranteil ${l}`)
  }
})
