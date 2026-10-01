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
    ['Rechnung', '1.000,00 € × 33,333333 % = 333,3333 €'],
    ['Ergebnis, auf Cent gerundet', '333,33 €'],
  ])
  assert.equal(steps?.[2]?.term, 'distributionBasis')
})

test('Rechenweg: weicht ein Anteil von der gewöhnlichen Rundung ab, steht der Restcent dabei', () => {
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

test('Rechenweg bei der Gemeinschaftsabrechnung: der Anteil innerhalb der eigenen Wohnungen steht dabei', () => {
  // Befund der Durchsicht: „60 von 1.000 MEA“ und danach „× 60 %“ ließ sich nicht nachrechnen,
  // weil innerhalb der eigenen Wohnungen verteilt wird.
  const s = settle({
    units: [{ ...unit('a', 50), mea: 60 }, { ...unit('b', 50), mea: 40 }],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    costItems: [item('v', { amountCents: 20000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 200000 } })],
  })
  const steps = rowOf(s, 't-a', 'v')?.steps?.map((x) => [x.label, x.value])
  assert.deepEqual(steps?.find((x) => x[0] === 'Anteil an Ihren Wohnungen'), ['Anteil an Ihren Wohnungen', '60 von 100 MEA'])
  assert.deepEqual(steps?.find((x) => x[0] === 'Rechnung'), ['Rechnung', '200,00 € × 60 % = 120,00 €'])
})

test('Rechenweg bei großen Beträgen: Prozent × Betrag ergibt den gezeigten Wert', () => {
  const s = settle({
    units: [unit('a', 50), unit('b', 50), unit('c', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('g', { amountCents: 3000000 })],
  })
  assert.equal(rowOf(s, 't-a', 'g')?.steps?.find((x) => x.label === 'Rechnung')?.value, '30.000,00 € × 33,333333 % = 10.000,00 €')
})

test('Restcent über einem halben Cent: der Hinweis steht bei der Zeile, die von der gewöhnlichen Rundung abweicht', () => {
  // 2,00 € auf drei gleiche Wohnungen: je 0,6667 €, gewöhnlich gerundet dreimal 0,67 € = 2,01 €.
  // Eine Wohnung trägt 0,66 €; bei ihr steht der Hinweis, bei den anderen nicht.
  const s = settle({
    units: [unit('a', 50), unit('b', 50), unit('c', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('g', { amountCents: 200 })],
  })
  const results = ['t-a', 't-b', 't-c'].map((t) => rowOf(s, t, 'g')?.steps?.at(-1))
  const noted = results.filter((r) => r?.term === 'largestRemainder')
  assert.equal(noted.length, 1)
  assert.match(noted[0]?.value ?? '', /^0,66 €/)
})
