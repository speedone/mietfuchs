// Heizkosten nicht nach Verbrauch (#140): Die Heizkostenverordnung verlangt, 50 bis 70 Prozent
// nach erfasstem Verbrauch zu verteilen (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV); wird nicht
// verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen (§ 12 Abs. 1).
// Mietfuchs rechnet weiter wie erfasst und beziffert die Kürzung je Mieter.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const heizung = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'h', year: 2025, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 540000, key: 'area', ...over,
})
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const heatingNotices = (s: ComputedSettlement) => s.notices.filter((n) => n.code === 'heating.not-by-consumption')

// 540 m², 5.400 € nach Fläche: 10 € je m². Die leere Wohnung trägt der Vermieter.
const haus = {
  units: [unit('w1', 100), unit('w2', 130), unit('w3', 84.3), unit('w4', 71.26), unit('leer', 154.44)],
  tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2'), tenancy('C', 'w3'), tenancy('D', 'w4')],
}

test('Heizung nach Fläche: Hinweis mit dem Kürzungsbetrag je Mieter (#140)', () => {
  const s = settle({ ...haus, costItems: [heizung()] })
  assert.deepEqual(s.statements.map((st) => st.totalShareCents), [100000, 130000, 84300, 71260])
  const n = heatingNotices(s)
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'warning')
  assert.equal(n[0]?.rule, 'heating-consumption')
  assert.deepEqual(n[0]?.subject, { kind: 'costItem', id: 'h' })
  const text = n[0]?.text ?? ''
  for (const betrag of ['A (w1) 150,00 €', 'B (w2) 195,00 €', 'C (w3) 126,45 €', 'D (w4) 106,89 €']) assert.ok(text.includes(betrag), `${betrag} fehlt in: ${text}`)
  assert.match(text, /§ 12 Abs\. 1 HeizkostenV/)
  assert.ok(!text.includes('leer'), 'die leere Wohnung hat keinen Mieter, der kürzen könnte')
  // Gerechnet wird wie erfasst: Der Hinweis kürzt nicht selbst.
  assert.equal(s.landlord.totalCents, 154440)
})

test('Heizung nach Verbrauch, als Einzelbeträge oder laut Gemeinschaftsabrechnung: kein Hinweis (#140)', () => {
  const varianten: Partial<SnapshotCostItem>[] = [
    { key: 'meter', meterType: 'waerme' },
    { key: 'amounts', tenancyAmounts: { A: 100000 } },
    { key: 'external', externalBasis: { measure: 'area', total: 540, totalCents: 540000 } },
  ]
  for (const over of varianten) {
    assert.deepEqual(heatingNotices(settle({ ...haus, costItems: [heizung(over)] })), [], over.key)
  }
})

test('Andere Kostenart nach Fläche: kein Hinweis (#140)', () => {
  assert.deepEqual(heatingNotices(settle({ ...haus, costItems: [heizung({ category: 'Grundsteuer' })] })), [])
})

test('Zweifamilienhaus mit selbst bewohnter Wohnung: Ausnahme des § 2 HeizkostenV (#140)', () => {
  const s = settle({
    units: [unit('oben', 80), unit('unten', 80, { participates: false, selfUsed: true })],
    tenancies: [tenancy('A', 'oben')],
    costItems: [heizung()],
  })
  assert.deepEqual(heatingNotices(s), [])
})

test('Pauschale oder Warmmiete: kein Kürzungsbetrag, denn über die Heizung wird nicht abgerechnet (#140)', () => {
  const s = settle({
    units: haus.units,
    tenancies: [tenancy('A', 'w1', { heatingModel: 'flatRate', prepayments: [] }), tenancy('B', 'w2'), tenancy('C', 'w3', { heatingModel: 'inclusive' }), tenancy('D', 'w4')],
    costItems: [heizung()],
  })
  const text = heatingNotices(s)[0]?.text ?? ''
  assert.ok(text.includes('B (w2) 195,00 €') && text.includes('D (w4) 106,89 €'), text)
  assert.ok(!text.includes('A (w1)') && !text.includes('C (w3)'), text)
  // Ohne einen einzigen abgerechneten Mieter gibt es niemanden, der kürzen könnte.
  const nurPauschal = settle({ units: [unit('w1', 100), unit('w2', 100), unit('w3', 100)], tenancies: [tenancy('A', 'w1', { heatingModel: 'flatRate', prepayments: [] })], costItems: [heizung()] })
  assert.deepEqual(heatingNotices(nurPauschal), [])
})
