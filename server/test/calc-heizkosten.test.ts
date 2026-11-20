// Heizkosten nicht nach Verbrauch (#140): Die Heizkostenverordnung verlangt, 50 bis 70 Prozent
// nach erfasstem Verbrauch zu verteilen (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV); wird nicht
// verbrauchsabhängig abgerechnet, darf der Mieter seinen Anteil um 15 Prozent kürzen (§ 12 Abs. 1).
// Mietfuchs rechnet weiter wie erfasst und beziffert die Kürzung je Mieter.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, areaM2: number, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const heizung = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'h', period: calendarPeriod(2025), category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 540000, key: 'area', ...over,
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

test('Mischfall: der Verbrauchsanteil rechnet mit verrechneten Gutschriften (#140, letzte Durchsicht)', () => {
  // 1.800 € nach Zählern, 1.200 € Grundkosten, dazu 600 € Gutschrift nach Fläche: verteilt werden
  // tatsächlich 1.800 von 2.400 €, also 75 % nach Verbrauch. Ein Kürzungsrecht entsteht nicht.
  const s = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ id: 'v', key: 'meter', meterType: 'waerme', amountCents: 180000 }),
    heizung({ id: 'gk', amountCents: 120000 }),
    heizung({ id: 'g', description: 'Gutschrift', amountCents: -60000 }),
  ] })
  const n = notesOf(s, 'heating.consumption-share')
  assert.equal(n.length, 1)
  assert.match(n[0]?.text ?? '', /75 %/)
  assert.deepEqual(heatingNotices(s), [])
  // Ist eine Nettosumme nicht positiv, gibt es keinen Prozentsatz.
  const negativ = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ id: 'v', key: 'meter', meterType: 'waerme', amountCents: 180000 }),
    heizung({ id: 'gk', amountCents: 120000 }),
    heizung({ id: 'g', description: 'Gutschrift', amountCents: -400000 }),
  ] })
  assert.deepEqual(notesOf(negativ, 'heating.consumption-share'), [])
})

// § 2 HeizkostenV: Eine Einheit ohne Fläche und ohne Bewohner zählt nicht als Wohnung, gleich ob
// leer, außerhalb der Abrechnungseinheit oder selbstgenutzt ohne Personenangabe.
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

// ---------- Zweite Browserabnahme zu #140 ----------

test('Garage ohne Wärmeanschluss mit Inklusivmiete: keine Warnung zur Warmmiete (#140)', () => {
  const s = settle({
    units: [unit('w1', 70), unit('w2', 70), unit('w3', 70), unit('g', 0, { noConnection: ['waerme'] })],
    tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2'), tenancy('C', 'w3'), tenancy('G', 'g', { costModel: 'inclusive', heatingModel: 'inclusive', prepayments: [] })],
    costItems: [heizung({ key: 'meter', meterType: 'waerme' })],
  })
  assert.deepEqual(notesOf(s, 'heating.flat-rate'), [])
})

test('Garage-artige Einheit (0 m², 0 Personen) mit Warmmiete: keine Warnung zur Warmmiete (#140)', () => {
  const s = settle({
    units: [unit('w1', 70), unit('w2', 70), unit('w3', 70), unit('g', 0)],
    tenancies: [tenancy('A', 'w1'), tenancy('G', 'g', { heatingModel: 'flatRate', prepayments: [], persons: 0, personHistory: [{ from: '2025-01-01', persons: 0 }] })],
    costItems: [heizung({ key: 'meter', meterType: 'waerme' })],
  })
  assert.deepEqual(notesOf(s, 'heating.flat-rate'), [])
})

test('Einheit ohne Wärmeanschluss bekommt keinen Kürzungsbetrag (#140)', () => {
  const s = settle({
    units: [unit('w1', 70), unit('w2', 70), unit('w3', 70), unit('g', 15, { noConnection: ['waerme'] })],
    tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2'), tenancy('C', 'w3'), tenancy('G', 'g')],
    costItems: [heizung({ key: 'units', amountCents: 400000 })],
  })
  const text = heatingNotices(s)[0]?.text ?? ''
  assert.ok(text.includes('A (w1)'), text)
  assert.ok(!text.includes('G (g)'), text)
})

// ---------- Letzte Durchsicht zu #140 ----------

test('§ 2 HeizkostenV: eine bewohnte Wohnung mit vergessener Fläche zählt als Wohnung (#140)', () => {
  // Dreifamilienhaus: eigene Wohnung, w1 mit 80 m², w2 mit 2 Personen und 0 m² (Fläche vergessen).
  // Das ist kein Zweifamilienhaus; die Verordnung geht vor.
  const s = settle({
    units: [unit('eigen', 100, { participates: false, selfUsed: true, selfPersons: 2 }), unit('w1', 80), unit('w2', 0)],
    tenancies: [tenancy('A', 'w1'), tenancy('B', 'w2', { persons: 2, personHistory: [{ from: '2025-01-01', persons: 2 }] })],
    costItems: [heizung({ key: 'persons', amountCents: 300000 })],
  })
  assert.equal(heatingNotices(s).length, 1)
  assert.deepEqual(notesOf(s, 'heating.may-agree-otherwise'), [])
  const pauschal = settle({
    units: [unit('eigen', 100, { participates: false, selfUsed: true, selfPersons: 2 }), unit('w1', 80), unit('w2', 0)],
    tenancies: [tenancy('A', 'w1', { heatingModel: 'flatRate', prepayments: [] }), tenancy('B', 'w2', { persons: 2, personHistory: [{ from: '2025-01-01', persons: 2 }] })],
    costItems: [heizung({ key: 'persons', amountCents: 300000 })],
  })
  assert.equal(notesOf(pauschal, 'heating.flat-rate').length, 1)
})

test('Verbrauch 0 an einem abgelesenen Wärmezähler ist gedeckt, kein Kürzungsrecht (#140)', () => {
  const nullStand = ablesungen.map((r) => (r.meterId === 'wc' ? { ...r, value: 500 } : r))
  const s = settle({ ...drei, meters: waermezaehler, readings: nullStand, costItems: [
    heizung({ id: 'v', key: 'meter', meterType: 'waerme', amountCents: 350000 }),
    heizung({ id: 'gk', amountCents: 150000 }),
  ] })
  assert.deepEqual(heatingNotices(s), [])
})

test('Einzelbetrag 0 aus der Messdienstabrechnung ist gedeckt, kein Kürzungsrecht (#140)', () => {
  const s = settle({ ...drei, costItems: [
    heizung({ id: 'md', key: 'amounts', amountCents: 300000, tenancyAmounts: { A: 150000, B: 150000, C: 0 } }),
    heizung({ id: 'w', description: 'Wartung', key: 'area', amountCents: 30000 }),
  ] })
  assert.deepEqual(heatingNotices(s), [])
})

// ---------- Systemprüfung: ganz nach Wärmezähler ----------

const ALL = 'heating.all-by-consumption'
const ganz = (over: Partial<SnapshotCostItem> = {}) => heizung({ id: 'v', description: 'Erdgas und Wartung', key: 'meter', meterType: 'waerme', amountCents: 300000, ...over })
const zaehlerDer = (type: 'waerme' | 'warmwasser' | 'hkv' | 'strom' | 'sonstig' | 'kaltwasser') => {
  const meters = ['a', 'b', 'c'].map((u) => ({ id: `${type}-${u}`, unitId: u, type }))
  return { meters, readings: meters.flatMap((m, i) => [{ meterId: m.id, date: '2024-12-31', value: 0 }, { meterId: m.id, date: '2025-12-31', value: 10 + i }]) }
}

test('Eine Position ganz nach Wärmezähler: eigener Hinweis auf den Höchstsatz und § 10, ohne Betrag', () => {
  const s = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [ganz()] })
  const n = notesOf(s, ALL)
  assert.equal(n.length, 1)
  assert.equal(n[0]?.level, 'hint')
  assert.equal(n[0]?.title, 'Heizkosten ganz nach Verbrauch verteilt')
  assert.equal(n[0]?.rule, 'heating-consumption')
  assert.deepEqual(n[0]?.subject, { kind: 'costItem', id: 'v' })
  // Der Fall hat einen eigenen Code, der das Cockpit nicht färbt (Durchsicht, Punkt 2); der Code des Mischfalls schweigt.
  assert.deepEqual(notesOf(s, 'heating.consumption-share'), [])
  const text = n[0]?.text ?? ''
  assert.match(text, /„Erdgas und Wartung“/)
  assert.match(text, /ganz nach Zählern verteilt/)
  assert.match(text, /mindestens 50 und höchstens 70 %/)
  // § 7 Abs. 1 Satz 5: bei der Wärme auch der umbaute Raum (Durchsicht, Punkt 5).
  assert.match(text, /den Rest nach Wohn- oder Nutzfläche, bei der Wärme auch nach dem umbauten Raum \(§ 7 Abs\. 1, § 8 Abs\. 1 HeizkostenV\)/)
  assert.match(text, /§ 10 HeizkostenV/)
  assert.match(text, /ist nichts zu tun/)
  // Das Warmwasser in derselben Position (§ 8 Abs. 1, § 9 Abs. 1 HeizkostenV): bedingt, denn ob es enthalten ist, weiß Mietfuchs nicht.
  assert.match(text, /Enthält die Position auch die Kosten des Warmwassers/)
  assert.match(text, /§ 9 Abs\. 1 HeizkostenV/)
  // Verbrauchsabhängig wird abgerechnet: kein Kürzungsrecht behauptet, kein Betrag.
  assert.doesNotMatch(text, /€|kürzen|§ 12/)
  assert.deepEqual(heatingNotices(s), [])
  // Der Hinweis ändert keine Zahl: verteilt wird weiter nach dem Verbrauch 10 : 11 : 12.
  assert.deepEqual(s.statements.map((st) => st.totalShareCents), [90909, 100000, 109091])
})

test('Ganz nach Wärmezähler, aber ohne Ablesungen: nichts ist nach Verbrauch verteilt, kein Hinweis auf den Höchstsatz', () => {
  const s = settle({ ...drei, costItems: [ganz()] })
  assert.deepEqual(notesOf(s, ALL), [])
})

test('Einzelbeträge des Messdienstes und eine Gutschrift nach Wärmezähler allein: kein Hinweis auf den Höchstsatz', () => {
  const messdienst = settle({ ...drei, costItems: [heizung({ id: 'md', key: 'amounts', tenancyAmounts: { A: 100000, B: 100000, C: 100000 }, amountCents: 300000 })] })
  assert.deepEqual(notesOf(messdienst, ALL), [])
  const gutschrift = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [ganz({ amountCents: -5000 })] })
  assert.deepEqual(notesOf(gutschrift, ALL), [])
})

// ---------- Durchsicht des Zweigs: wo die Verordnung nicht gilt oder niemand abgerechnet wird ----------

for (const [name, tenancies] of [
  ['alle Mieter heizen selbst', drei.tenancies.map((t) => ({ ...t, heatingModel: 'selfSupply' as const, selfSupplyKind: 'perUnit' as const }))],
  ['alle Mieter mit Warmmiete', drei.tenancies.map((t) => ({ ...t, heatingModel: 'inclusive' as const }))],
  ['alle Mieter mit Pauschale', drei.tenancies.map((t) => ({ ...t, heatingModel: 'flatRate' as const }))],
] as const) {
  test(`Ganz nach Zählern, ${name}: kein Hinweis auf den Höchstsatz`, () => {
    const s = settle({ units: drei.units, tenancies: [...tenancies], meters: waermezaehler, readings: ablesungen, costItems: [ganz()] })
    assert.deepEqual([...notesOf(s, ALL), ...notesOf(s, 'heating.consumption-share')], [])
  })
}

test('Ganz nach Zählern, ein Mieter wird abgerechnet, die anderen heizen selbst oder zahlen warm: der Hinweis bleibt', () => {
  const tenancies = [tenancy('A', 'a'), tenancy('B', 'b', { heatingModel: 'selfSupply', selfSupplyKind: 'perUnit' }), tenancy('C', 'c', { heatingModel: 'inclusive' })]
  const s = settle({ units: drei.units, tenancies, meters: waermezaehler, readings: ablesungen, costItems: [ganz()] })
  assert.equal(notesOf(s, ALL).length, 1)
})

test('Ganz nach Zählern, aber nur eine Wohnung beteiligt: es gibt nichts zu verteilen, kein Hinweis', () => {
  const s = settle({ ...drei, meters: waermezaehler.slice(0, 1), readings: ablesungen.filter((r) => r.meterId === 'wa'), costItems: [ganz({ participantUnitIds: ['a'] })] })
  assert.deepEqual(notesOf(s, ALL), [])
})

for (const type of ['strom', 'sonstig', 'kaltwasser'] as const) {
  test(`Ganz nach Zählern der Art „${type}“ (Nachtspeicher, Gaszähler je Wohnung): keine zentrale Anlage erkennbar, kein Hinweis`, () => {
    const s = settle({ ...drei, ...zaehlerDer(type), costItems: [ganz({ meterType: type })] })
    assert.deepEqual([...notesOf(s, ALL), ...notesOf(s, 'heating.consumption-share')], [])
    assert.deepEqual(s.statements.map((st) => st.totalShareCents), [90909, 100000, 109091])
  })
}

test('Wärme und Warmwasser als zwei Positionen, je ganz nach Zähler: der Hinweis ohne den Satz zum enthaltenen Warmwasser', () => {
  const w = zaehlerDer('waerme')
  const ww = zaehlerDer('warmwasser')
  const s = settle({ ...drei, meters: [...w.meters, ...ww.meters], readings: [...w.readings, ...ww.readings], costItems: [
    ganz({ id: 'h1', description: 'Wärme' }), ganz({ id: 'h2', description: 'Warmwasser', meterType: 'warmwasser', amountCents: 50000 }),
  ] })
  const n = notesOf(s, ALL)
  assert.equal(n.length, 1)
  assert.doesNotMatch(n[0]?.text ?? '', /Enthält die Position auch die Kosten des Warmwassers/)
})

test('Mischfall über 70 %: der Hinweis nennt die rechtsgeschäftliche Bestimmung nach § 10; unter 50 % bleibt der Text', () => {
  const ueber = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ id: 'v', description: 'Verbrauchskosten', key: 'meter', meterType: 'waerme', amountCents: 299000 }),
    heizung({ id: 'gk', description: 'Grundkosten', amountCents: 1000 }),
  ] })
  const n = notesOf(ueber, 'heating.consumption-share')
  assert.equal(n.length, 1)
  assert.equal(n[0]?.text, 'Heizung und Warmwasser („Verbrauchskosten“ und „Grundkosten“): nach Zählern verteilt werden 99,7 % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Ein höherer Anteil nach Verbrauch bleibt nur bestehen, wenn er rechtsgeschäftlich bestimmt ist, etwa im Mietvertrag vereinbart (§ 10 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.')
  assert.deepEqual(notesOf(ueber, ALL), [])
  const unter = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [
    heizung({ id: 'v', description: 'Verbrauchskosten', key: 'meter', meterType: 'waerme', amountCents: 90000 }),
    heizung({ id: 'gk', description: 'Grundkosten', amountCents: 210000 }),
  ] })
  assert.equal(notesOf(unter, 'heating.consumption-share')[0]?.text, 'Heizung und Warmwasser („Verbrauchskosten“ und „Grundkosten“): nach Zählern verteilt werden 30 % der Heizkosten. Die Heizkostenverordnung verlangt mindestens 50 und höchstens 70 % nach dem erfassten Verbrauch (§ 7 Abs. 1, § 8 Abs. 1 HeizkostenV). Bitte die Aufteilung zwischen Verbrauchs- und Grundkosten prüfen.')
})

// Das Regelverzeichnis nennt jetzt § 10. Eine früher abgeschlossene Abrechnung trägt die alte Fassung der Regel und
// keinen der neuen Hinweise; das ist keine Abweichung (settlementDiff vergleicht Zahlen und Rechtswerte).
test('Abgeschlossen vor der Änderung: weder der neue Hinweis noch die ergänzte Regel erscheinen als Abweichung', () => {
  const s = settle({ ...drei, meters: waermezaehler, readings: ablesungen, costItems: [ganz()] })
  const regel = s.legalBasis?.rules.find((r) => r.code === 'heating-consumption') ?? assert.fail('Regel fehlt im Rechtsstand')
  assert.match(regel.norm, /§§ 2, 7 Abs\. 1, 8 Abs\. 1, 10, 12 Abs\. 1 HeizkostenV/)
  const frozen: typeof s = structuredClone(s)
  frozen.notices = []
  if (frozen.legalBasis) frozen.legalBasis.rules = frozen.legalBasis.rules.map((r) => (r.code === 'heating-consumption' ? { ...r, norm: '§§ 2, 7 Abs. 1, 8 Abs. 1, 12 Abs. 1 HeizkostenV' } : r))
  const d = compareWithFrozen(frozen, s, '2026-12-31', '2026-11-20')
  assert.deepEqual([d.comparable, d.deviations, d.valueChanges], [true, [], []])
})
