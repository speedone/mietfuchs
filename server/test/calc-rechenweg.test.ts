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

test('Rechenweg mit Lohnanteil: weicht der § 35a-Anteil von der gewöhnlichen Rundung ab, steht der Restcent dabei (rc.1)', () => {
  // 300 € mit 200 € Lohnanteil auf drei gleiche Wohnungen: rechnerisch je 66,6667 €, gerundet je
  // 66,67 €, zusammen aber 200,01 €. Eine Zeile bekommt 66,66 €, und ohne Erklärung fehlte ihr ein
  // Cent, den niemand nachrechnen kann.
  const s = settle({
    units: [unit('a', 50), unit('b', 50), unit('c', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('garten', { category: 'Gartenpflege', amountCents: 30000, labor35aCents: 20000 })],
  })
  const labor = ['t-a', 't-b', 't-c'].map((t) => rowOf(s, t, 'garten')?.steps?.at(-1))
  const short = labor.filter((x) => x?.value.startsWith('66,66 €'))
  assert.equal(short.length, 1, 'genau eine Zeile weicht ab')
  assert.equal(short[0]?.value, '66,66 € (rechnerisch 66,6667 €; Restcent: damit die Lohnanteile zusammen genau den Lohnanteil der Rechnung ergeben, ist dieser einen Cent geringer als gewöhnlich gerundet)')
  assert.equal(short[0]?.label, 'davon Lohnanteil nach § 35a EStG')
  assert.equal(labor.filter((x) => x?.value === '66,67 €').length, 2, 'die übrigen ohne Zusatz')
})

test('Rechenweg mit Lohnanteil (M3): ein auf 0 gedeckelter Lohnanteil wird trotzdem erklärt', () => {
  // 1,00 € Hauswart mit 0,99 € Lohn auf 0,7 / 0,7 / 0,7 / 97,9 m². Rohanteile 0,7 / 0,7 / 0,7 /
  // 97,9 ct; das Restverfahren gibt t-a und t-b je 1 ct, t-c bekommt 0 ct. Ihr Lohnanteil wäre
  // rechnerisch 0,693 ct, gerundet 1 ct, und liegt damit über dem Kostenanteil: 0 ct. Ohne
  // Erklärung fehlte der Schritt ganz, weil der Lohnanteil 0 ist.
  const s = settle({
    units: [unit('a', 0.7), unit('b', 0.7), unit('c', 0.7), unit('d', 97.9)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c'), tenancy('t-d', 'd')],
    costItems: [item('h', { category: 'Hauswart', amountCents: 100, labor35aCents: 99 })],
  })
  const row = rowOf(s, 't-c', 'h')
  assert.equal(row?.shareCents, 0)
  assert.equal(row?.labor35aCents, 0)
  assert.deepEqual(row?.steps?.at(-1), {
    label: 'davon Lohnanteil nach § 35a EStG',
    value: '0,00 € (rechnerisch 0,0069 €; ein Lohnanteil liegt nie über dem Kostenanteil, deshalb ist er auf diesen begrenzt)',
    term: 'labor35a',
  })
})

test('Rechenweg mit Lohnanteil: ist die Rechnung ganz Lohn, steht kein eigener Restcent beim Lohnanteil (rc.1)', () => {
  // Der Lohnanteil ist dann der Kostenanteil; dessen Restcent erklärt schon der Schritt davor.
  const s = settle({
    units: [unit('a', 50), unit('b', 50), unit('c', 50)],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b'), tenancy('t-c', 'c')],
    costItems: [item('garten', { category: 'Gartenpflege', amountCents: 10000, labor35aCents: 10000 })],
  })
  for (const t of ['t-a', 't-b', 't-c']) {
    const row = rowOf(s, t, 'garten')
    assert.equal(row?.steps?.at(-1)?.value, `${(row?.shareCents ?? 0) / 100}`.replace('.', ',') + ' €')
  }
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
  // #144: verständlich für den Mieter statt „Anteil an Ihren Wohnungen“
  assert.deepEqual(steps?.find((x) => x[0] === 'Anteil Ihrer Wohnung daran'), ['Anteil Ihrer Wohnung daran', '60 von 100 MEA'])
  assert.ok(!steps?.some((x) => x[0] === 'Anteil an Ihren Wohnungen'))
  assert.deepEqual(steps?.find((x) => x[0] === 'Rechnung'), ['Rechnung', '200,00 € × 60 % = 120,00 €'])
})

// #144: Der Schritt aus der Gemeinschaftsabrechnung steht ausdrücklich da. Nachgestellt wie im
// Issue: Hausmeister, Anlage 6.000 €, 85,4 von 1.000 MEA, eigener Anteil 512,40 €.
const hausmeister = (amountCents: number) => settle({
  units: [{ ...unit('w', 70), mea: 85.4 }],
  tenancies: [tenancy('t', 'w')],
  costItems: [item('h', { category: 'Hauswart', description: 'Hausmeister', amountCents, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 600000 } })],
})

test('Rechenweg laut Gemeinschaftsabrechnung: Anteil an der Gemeinschaft, dann die Verteilung im Objekt (#144)', () => {
  const steps = rowOf(hausmeister(51240), 't', 'h')?.steps?.map((x) => [x.label, x.value])
  assert.deepEqual(steps?.slice(0, 3), [
    ['Kosten der Gemeinschaft', '6.000,00 €'],
    ['Umlageschlüssel', 'Laut Gemeinschaftsabrechnung'],
    ['Anteil an der Gemeinschaft', '85,4 von 1.000 MEA × 6.000,00 € = 512,40 €'],
  ])
  // Eine einzige Wohnung im Objekt: kein Schritt „85,4 von 85,4 MEA“.
  assert.ok(!steps?.some((x) => x[0] === 'Anteil Ihrer Wohnung daran'), JSON.stringify(steps))
  assert.ok(!steps?.some((x) => x[0] === 'Angesetzt laut Hausgeldabrechnung'))
  assert.deepEqual(steps?.at(-1), ['Ergebnis, auf Cent gerundet', '512,40 €'])
  assert.equal(rowOf(hausmeister(51240), 't', 'h')?.basisText, '85,4 von 1.000 MEA · Kosten der Gemeinschaft 6.000,00 €')
})

test('Rechenweg laut Gemeinschaftsabrechnung: weicht der Betrag ab, steht der angesetzte dabei, auch im Druck (#144)', () => {
  const row = rowOf(hausmeister(20496), 't', 'h')
  const steps = row?.steps?.map((x) => [x.label, x.value])
  assert.deepEqual(steps?.find((x) => x[0] === 'Angesetzt laut Hausgeldabrechnung'), ['Angesetzt laut Hausgeldabrechnung', '204,96 €'])
  assert.equal(row?.basisText, '85,4 von 1.000 MEA · Kosten der Gemeinschaft 6.000,00 € · angesetzt laut Hausgeldabrechnung')
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
