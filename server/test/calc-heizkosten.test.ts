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

// ---------- Durchsicht zu #140 ----------

const notesOf = (s: ComputedSettlement, code: string) => s.notices.filter((n) => n.code === code)
// Wärmezähler mit Ablesungen: Eine Verbrauchsposition deckt eine Wohnung erst, wenn sie aus ihr
// wirklich einen Anteil bekommt (Integrationsdurchsicht).
const zaehlerHaus = {
  meters: ['w1', 'w2', 'w3', 'w4'].map((u) => ({ id: `z-${u}`, unitId: u, type: 'waerme' as const })),
  readings: ['w1', 'w2', 'w3', 'w4'].flatMap((u, i) => [{ meterId: `z-${u}`, date: '2024-12-31', value: 0 }, { meterId: `z-${u}`, date: '2025-12-31', value: 10 + i }]),
}

test('Mischfall 70/30: Verbrauch 70 %, Grundkosten 30 % nach Fläche, kein Kürzungsrecht und kein Hinweis (#140)', () => {
  const s = settle({ ...haus, ...zaehlerHaus, costItems: [
    heizung({ id: 'grund', description: 'Grundkosten', amountCents: 162000 }),
    heizung({ id: 'verbrauch', description: 'Verbrauchskosten', amountCents: 378000, key: 'meter', meterType: 'waerme' }),
  ] })
  assert.deepEqual(heatingNotices(s), [])
  assert.deepEqual(notesOf(s, 'heating.consumption-share'), [])
})

test('Mischfall 30/70: Verbrauchsanteil unter 50 %, Hinweis ohne Betrag (#140)', () => {
  const s = settle({ ...haus, ...zaehlerHaus, costItems: [
    heizung({ id: 'grund', description: 'Grundkosten', amountCents: 378000 }),
    heizung({ id: 'verbrauch', description: 'Verbrauchskosten', amountCents: 162000, key: 'meter', meterType: 'waerme' }),
  ] })
  assert.deepEqual(heatingNotices(s), [], 'kein Kürzungsrecht, verbrauchsabhängig wird abgerechnet')
  const n = notesOf(s, 'heating.consumption-share')
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'hint')
  assert.match(n[0]?.text ?? '', /30 %/)
  assert.match(n[0]?.text ?? '', /§ 7 Abs\. 1, § 8 Abs\. 1 HeizkostenV/)
  assert.doesNotMatch(n[0]?.text ?? '', /€/)
})

test('Ratschlag: nicht zu 100 % nach Verbrauch raten (#140)', () => {
  const text = heatingNotices(settle({ ...haus, costItems: [heizung()] }))[0]?.text ?? ''
  assert.match(text, /50 bis 70 % nach Verbrauch/)
  assert.doesNotMatch(text, /Rechnen Sie nach Verbrauch ab/)
})

test('Teilnehmer: nur Wohnungen ohne eigene Verbrauchsposition bekommen einen Kürzungsbetrag (#140)', () => {
  const s = settle({ ...haus, ...zaehlerHaus, costItems: [
    heizung({ id: 'grund', description: 'Grundkosten', amountCents: 162000 }),
    heizung({ id: 'verbrauch', description: 'Verbrauch vorne', amountCents: 378000, key: 'meter', meterType: 'waerme', participantUnitIds: ['w1', 'w2'] }),
  ] })
  const text = heatingNotices(s)[0]?.text ?? ''
  assert.ok(text.includes('C (w3)') && text.includes('D (w4)'), text)
  assert.ok(!text.includes('A (w1)') && !text.includes('B (w2)'), text)
})

test('Direktzuordnung (Wartung der Gastherme einer Wohnung) ist keine Verteilung: kein Hinweis (#140)', () => {
  const s = settle({ ...haus, costItems: [heizung({ key: 'direct', directUnitId: 'w1', amountCents: 12000, description: 'Wartung Gastherme' })] })
  assert.deepEqual(heatingNotices(s), [])
  assert.deepEqual(notesOf(s, 'heating.may-agree-otherwise'), [])
})

test('§ 2 HeizkostenV: im Zweifamilienhaus mit eigener Wohnung ein Hinweis ohne Betrag statt Schweigen (#140)', () => {
  const s = settle({
    units: [unit('oben', 80), unit('unten', 80, { participates: false, selfUsed: true })],
    tenancies: [tenancy('A', 'oben')],
    costItems: [heizung()],
  })
  const n = notesOf(s, 'heating.may-agree-otherwise')
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'hint')
  assert.match(n[0]?.text ?? '', /sofern im Mietvertrag nichts anderes vereinbart ist/)
  assert.match(n[0]?.text ?? '', /darf anderes vereinbart werden/)
  assert.doesNotMatch(n[0]?.text ?? '', /€/)
})

test('§ 2 HeizkostenV: eine Garage zählt nicht als Wohnung, für beide Heizhinweise (#140)', () => {
  const garage = { units: [unit('oben', 80), unit('unten', 80, { participates: false, selfUsed: true }), unit('garage', 0)] }
  const mieter = tenancy('G', 'garage', { persons: 0, personHistory: [{ from: '2025-01-01', persons: 0 }] })
  const s = settle({ ...garage, tenancies: [tenancy('A', 'oben'), mieter], costItems: [heizung()] })
  assert.deepEqual(heatingNotices(s), [])
  assert.equal(notesOf(s, 'heating.may-agree-otherwise').length, 1)
  const pauschal = settle({ ...garage, tenancies: [tenancy('A', 'oben', { heatingModel: 'flatRate', prepayments: [] }), mieter], costItems: [heizung()] })
  assert.deepEqual(notesOf(pauschal, 'heating.flat-rate'), [], 'Warmmiete im Zweifamilienhaus mit Garage ist zulässig vereinbar')
})

// ---------- Integrationsdurchsicht Geld zu #140 ----------

const drei = {
  units: [unit('a', 60), unit('b', 60), unit('c', 60)],
  tenancies: [tenancy('A', 'a'), tenancy('B', 'b'), tenancy('C', 'c')],
}
const waermezaehler = ['a', 'b', 'c'].map((u) => ({ id: `w${u}`, unitId: u, type: 'waerme' as const }))
const ablesungen = waermezaehler.flatMap((m, i) => [{ meterId: m.id, date: '2024-12-31', value: 0 }, { meterId: m.id, date: '2025-12-31', value: 10 + i }])

test('1b: eine Gutschrift nach Wärmezähler macht die Heizung nicht verbrauchsabhängig (#140)', () => {
  const s = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ amountCents: 300000 }),
    heizung({ id: 'g', description: 'Gutschrift Versorger', amountCents: -5000, key: 'meter', meterType: 'waerme' }),
  ] })
  const text = heatingNotices(s)[0]?.text ?? ''
  assert.ok(text.includes('A (a) 150,00 €'), text)
})

test('1c: eine Verbrauchsposition ohne Ablesungen deckt keine Wohnung (#140)', () => {
  const s = settle({ ...drei, costItems: [
    heizung({ amountCents: 300000 }),
    heizung({ id: 'v', description: 'Verbrauch', amountCents: 100, key: 'meter', meterType: 'waerme' }),
  ] })
  assert.equal(heatingNotices(s).length, 1)
})

test('Mischfall: eine Gutschrift auf die Grundkosten verschiebt den Verbrauchsanteil nicht (#140)', () => {
  // 1.800 € nach Zählern, 1.200 € Grundkosten, dazu 600 € Gutschrift nach Fläche: gemessen werden
  // die positiven Positionen, 60 %. Mit der Gutschrift verrechnet wären es 75 %.
  const s = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ id: 'v', key: 'meter', meterType: 'waerme', amountCents: 180000 }),
    heizung({ id: 'gk', amountCents: 120000 }),
    heizung({ id: 'g', description: 'Gutschrift', amountCents: -60000 }),
  ] })
  assert.deepEqual(notesOf(s, 'heating.consumption-share'), [])
  assert.deepEqual(heatingNotices(s), [])
})

// § 2 HeizkostenV: Eine Wohnung hat Fläche. Eine Einheit mit 0 m² zählt nie mit, gleich ob leer,
// außerhalb der Abrechnungseinheit oder selbstgenutzt ohne Personenangabe.
for (const [name, garage] of [
  ['3b leer', unit('g', 0)],
  ['3c außerhalb der Abrechnungseinheit', unit('g', 0, { participates: false, selfUsed: false })],
  ['3d selbstgenutzt ohne Personenangabe', unit('g', 0, { participates: false, selfUsed: true })],
] as const) {
  test(`§ 2 HeizkostenV: Garage (${name}) zählt nicht als Wohnung (#140)`, () => {
    const s = settle({
      units: [unit('m', 80), unit('e', 100, { participates: false, selfUsed: true, selfPersons: 2 }), garage],
      tenancies: [tenancy('A', 'm')],
      costItems: [heizung()],
    })
    assert.deepEqual(heatingNotices(s), [])
    assert.equal(notesOf(s, 'heating.may-agree-otherwise').length, 1)
  })
}
