// Rechenweg auf Klick (#114): Jede Zeile der Abrechnung trägt ihre Schritte als Daten, mit den
// Zahlen aus der Abrechnung selbst, damit man jede Zahl nachvollziehen und einem Mieter erklären
// kann.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number): SnapshotUnit => ({ id, name: id, areaM2, participates: true })
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const rowOf = (s: ComputedSettlement, tenancyId: string, itemId: string) =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((r) => r.costItemId === itemId)
const item = (id: string, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over,
})

test('Rechenweg nach Fläche: Betrag, Schlüssel, Anteil, Rechnung und Ergebnis', () => {
  const s = settle({
    units: [unit('a', 50), unit('b', 60), unit('c', 70)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('g', {})],
  })
  const steps = rowOf(s, 't-b', 'g')?.steps
  assert.deepEqual(steps?.map((x) => [x.label, x.value]), [
    ['Rechnungsbetrag', '1.000,00 €'],
    ['Umlageschlüssel', 'Wohnfläche'],
    ['Anteil an der Verteilbasis', '60 von 180 m²'],
    ['Rechnung', '1.000,00 € × 33,3333 % = 333,3333 €'],
    ['Ergebnis, auf Cent gerundet', '333,33 €'],
  ])
  assert.equal(steps?.[2]?.term, 'distributionBasis')
})

test('Rechenweg: der Restcent wird benannt, wo er landet', () => {
  const s = settle({
    units: [unit('a', 50), unit('b', 50), unit('c', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('g', { amountCents: 10000 })],
  })
  const results = ['t-a', 't-b', 't-c'].map((t) => rowOf(s, t, 'g')?.steps?.at(-1))
  const withCent = results.filter((r) => r?.value.startsWith('33,34 €'))
  assert.equal(withCent.length, 1, 'genau eine Wohnung bekommt den Restcent')
  assert.match(withCent[0]?.value ?? '', /Restcent/)
  assert.equal(withCent[0]?.term, 'largestRemainder')
  assert.ok(results.filter((r) => r?.value === '33,33 €').length === 2)
})

test('Rechenweg bei Einzelbeträgen: keine Rechnung, der Betrag steht in der Einzelabrechnung', () => {
  const s = settle({
    units: [unit('a', 50)],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item('h', { key: 'amounts', tenancyAmounts: { 't-a': 31240 } })],
  })
  assert.deepEqual(rowOf(s, 't-a', 'h')?.steps?.map((x) => x.label), ['Rechnungsbetrag', 'Umlageschlüssel', 'Einzelbetrag', 'Ergebnis, auf Cent gerundet'])
})

test('Rechenweg mit Lohnanteil: der § 35a-Anteil steht als letzter Schritt dabei', () => {
  const s = settle({
    units: [unit('a', 50), unit('b', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    costItems: [item('garten', { category: 'Gartenpflege', labor35aCents: 80000 })],
  })
  const last = rowOf(s, 't-a', 'garten')?.steps?.at(-1)
  assert.deepEqual([last?.label, last?.value, last?.term], ['davon Lohnanteil nach § 35a EStG', '400,00 €', 'labor35a'])
})
