// Hauptzähler und Zwischenzähler (#116). Hat eine Wohnung der Verteilung keinen eigenen Zähler,
// ist ihr Verbrauch der Rest des Hauptzählers (Vorwegabzug). Vorher verteilte der
// Verbrauchsschlüssel nur über die Wohnungszähler, und bei einer Einliegerwohnung mit
// Zwischenzähler zahlte der Mieter das Wasser des Vermieters mit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const meter = (id: string, unitId: string | null): SnapshotMeter => ({ id, unitId, type: 'kaltwasser' })
// Ein Jahr Verbrauch: Stand 0 am 31.12.2024, `amount` am 31.12.2025.
const used = (meterId: string, amount: number): SnapshotReading[] => [
  { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
]
const water: SnapshotCostItem = { id: 'w', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' }
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [water], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const share = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)

const hauptwohnung = unit('haupt', { participates: false, selfUsed: true, selfPersons: 3 })

test('Einliegerwohnung: der Rest des Hauptzählers ist der Verbrauch der eigenen Wohnung', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 20000, '40 von 200 m³')
  assert.equal(s.landlord.totalCents, 80000)
  assert.equal(s.selfUsedShareCents, 80000, 'der Rest ist Eigenanteil und nicht abziehbar')
  assert.deepEqual(codes(s), [])
  assert.match(s.statements[0]?.rows[0]?.basisText ?? '', /40 von 200/)
})

test('Haben alle Wohnungen Zähler, bleibt es bei der Verteilung nach Wohnungszählern', () => {
  // Die Messdifferenz zum Hauptzähler (hier 10 m³) trägt dann niemand gesondert; das ist die
  // bisherige Rechnung und bleibt es.
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    meters: [meter('hz', null), meter('za', 'a'), meter('zb', 'b')],
    readings: [...used('hz', 110), ...used('za', 60), ...used('zb', 40)],
  })
  assert.equal(share(s, 't-a'), 60000)
  assert.equal(share(s, 't-b'), 40000)
  assert.deepEqual(codes(s), [])
})

test('Ohne Hauptzähler: die eigene Wohnung ohne Zähler bekommt eine Warnung, gerechnet wird wie bisher', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('zz', 'el')],
    readings: used('zz', 40),
  })
  assert.equal(share(s, 't'), 100000)
  assert.deepEqual(codes(s), ['meter.unit-without-meter'])
  assert.deepEqual(s.notices[0]?.subject, { kind: 'unit', id: 'haupt' })
  assert.match(s.warnings[0] ?? '', /Hauptzähler/)
})

test('Eine vermietete Wohnung ohne Zähler: der Rest geht an den Vermieter, nicht an die anderen Mieter', () => {
  // Wie viel davon auf die Wohnung ohne Zähler entfällt, weiß Mietfuchs nicht; zuschreiben ließe
  // es sich nur mit einer erfundenen Regel. Also warnt es, und der Rest bleibt beim Vermieter.
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    meters: [meter('hz', null), meter('za', 'a')],
    readings: [...used('hz', 100), ...used('za', 30)],
  })
  assert.equal(share(s, 't-a'), 30000)
  assert.equal(share(s, 't-b'), 0)
  assert.equal(s.landlord.totalCents, 70000)
  assert.equal(s.selfUsedShareCents, 0)
  assert.deepEqual(codes(s), ['meter.unit-without-meter'])
  assert.deepEqual(s.notices[0]?.subject, { kind: 'unit', id: 'b' })
})

test('Zwischenzähler über dem Hauptzähler: Warnung, und es bleibt bei den Wohnungszählern', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 30), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 100000)
  assert.deepEqual(codes(s), ['meter.sub-exceeds-main', 'meter.unit-without-meter'])
})

test('Mit Teilnehmern zählt der Hauptzähler nicht, denn er misst das ganze Haus', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
    costItems: [{ ...water, participantUnitIds: ['el'] }],
  })
  assert.equal(share(s, 't'), 100000)
  assert.deepEqual(codes(s), [])
})

test('Invariante (#116): mit zufälligen Haupt- und Zwischenzählern gehen die Summen auf', () => {
  let seed = 116
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 300; i++) {
    const units = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) =>
      unit(`u${k}`, rnd() < 0.3 ? { participates: false, selfUsed: true } : {}))
    const tenancies = units.filter((u) => u.participates).map((u) => tenancy(`t-${u.id}`, u.id))
    const meters: SnapshotMeter[] = []
    const readings: SnapshotReading[] = []
    for (const u of units) {
      if (rnd() < 0.6) {
        meters.push(meter(`z-${u.id}`, u.id))
        readings.push(...used(`z-${u.id}`, Math.round(rnd() * 100)))
      }
    }
    if (rnd() < 0.7) {
      meters.push(meter('hz', null))
      readings.push(...used('hz', Math.round(rnd() * 300)))
    }
    const s = settle({ units, tenancies, meters, readings })
    const mieter = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
    assert.equal(mieter + s.landlord.totalCents, s.totalCostsCents, `Fall ${i}`)
    for (const st of s.statements) assert.ok(st.totalShareCents >= 0, `Fall ${i}: negativer Anteil`)
    assert.ok(s.selfUsedShareCents <= s.landlord.totalCents, `Fall ${i}: Eigenanteil über Vermieteranteil`)
  }
})

test('§ 2 HeizkostenV: ist die eigene Wohnung nicht angelegt, sagt die Warnung, wie Mietfuchs die Ausnahme erkennt', () => {
  const heating: SnapshotCostItem = { id: 'h', year: 2025, category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 50000, key: 'area' }
  const nurEinlieger = settle({
    units: [unit('el')],
    tenancies: [{ ...tenancy('t', 'el'), heatingModel: 'inclusive' }],
    costItems: [heating],
  })
  assert.deepEqual(codes(nurEinlieger), ['heating.flat-rate'])
  assert.match(nurEinlieger.warnings[0] ?? '', /Wohnen Sie selbst im Haus/)
  // Mit drei Wohnungen hilft die eigene Wohnung nicht, der Satz entfällt.
  const dreiWohnungen = settle({
    units: [unit('a'), unit('b'), unit('c')],
    tenancies: [{ ...tenancy('t', 'a'), heatingModel: 'inclusive' }],
    costItems: [heating],
  })
  assert.doesNotMatch(dreiWohnungen.warnings[0] ?? '', /Wohnen Sie selbst im Haus/)
})

// ---------- Befunde der Durchsicht ----------

test('Ein Zähler ohne Ablesung zählt nicht als Zähler', () => {
  // Die eigene Wohnung hat einen angelegten, aber nie abgelesenen Zähler. Gälte er als Zähler,
  // zahlte der Mieter wieder die ganze Rechnung.
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el'), meter('zh', 'haupt')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 20000)
  assert.equal(s.selfUsedShareCents, 80000)
})

test('Ein Hauptzähler, der nicht das ganze Jahr abdeckt, wird nicht zur Basis, und das sagt eine Warnung', () => {
  // Der Versorger liest am 15.10. ab. Der Hauptzähler deckt 2025 dann nur bis dahin ab, und mit
  // ihm als Basis zahlte der Mieter 25 statt 20 Prozent.
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [
      { meterId: 'hz', date: '2024-10-15', value: 0 }, { meterId: 'hz', date: '2025-10-15', value: 200 },
      ...used('zz', 40),
    ],
  })
  assert.ok(codes(s).includes('meter.main-partial'), codes(s).join(', '))
  assert.match(s.warnings.join(' '), /31\.12\.2025|Jahresende/)
})

test('Eine leere Garage ohne Zähler nimmt der eigenen Wohnung nicht den Rest und warnt nicht', () => {
  const s = settle({
    units: [hauptwohnung, unit('el'), unit('garage', { areaM2: 0 })],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 20000)
  assert.equal(s.selfUsedShareCents, 80000)
  assert.deepEqual(codes(s), [])
})

test('Eine bewohnte Einheit außerhalb der Abrechnung ohne Zähler: der Rest ist nicht allein der Eigenanteil', () => {
  // Der Hauptzähler misst auch das Büro. Sein Verbrauch gehört nicht in den Eigenanteil, denn
  // der ist in der Steuer privat und nicht abziehbar.
  const s = settle({
    units: [hauptwohnung, unit('el'), unit('buero', { participates: false })],
    tenancies: [tenancy('t', 'el'), tenancy('t-buero', 'buero')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 20000)
  assert.equal(s.selfUsedShareCents, 0)
  assert.ok(codes(s).includes('meter.unit-without-meter'))
  assert.match(s.warnings.join(' '), /Eigenanteil/)
})

test('Hauptzähler vorhanden, aber unter den Wohnungszählern: der Hinweis empfiehlt keinen Hauptzähler', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 30), ...used('zz', 40)],
  })
  assert.doesNotMatch(s.warnings.join(' '), /Mit einem Hauptzähler/)
})

test('Auf der Abrechnung steht, dass die Basis der Hauptzähler ist', () => {
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.match(s.statements[0]?.rows[0]?.basisText ?? '', /40 von 200 \(Hauptzähler\)/)
})

test('Alle Wohnungen haben Zähler, erfassen aber weit weniger als der Hauptzähler: ein Hinweis, keine andere Zahl', () => {
  // Typisch, wenn die eigene Wohnung gar nicht angelegt ist. Die Zahl bleibt, denn eine
  // gewöhnliche Messdifferenz lässt sich davon nicht unterscheiden.
  const s = settle({
    units: [unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 100000)
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['meter.main-gap', 'hint']])
})

test('Deckt der Zwischenzähler nur einen Teil der Mietzeit ab, ist der Rest nicht allein der Eigenanteil', () => {
  // Befund der Integrationsdurchsicht: Der Zähler der Einliegerwohnung wurde erst im Juli
  // abgelesen, der Mieter wohnt aber das ganze Jahr. Sein Verbrauch bis Juli steckt dann im Rest
  // des Hauptzählers, und als Eigenanteil gebucht wäre er in der Steuer privat.
  const s = settle({
    units: [hauptwohnung, unit('el')],
    tenancies: [tenancy('t', 'el')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), { meterId: 'zz', date: '2025-06-30', value: 0 }, { meterId: 'zz', date: '2025-12-31', value: 20 }],
  })
  assert.equal(s.selfUsedShareCents, 0)
  assert.deepEqual(codes(s), ['meter.unit-partial'])
  assert.deepEqual(s.notices[0]?.subject, { kind: 'unit', id: 'el' })
})

test('Eine vermietete Garage ohne Wasseranschluss gilt nicht als Wohnung ohne Zähler (#117)', () => {
  const garage = unit('garage', { areaM2: 0, noConnection: ['kaltwasser'] })
  const s = settle({
    units: [hauptwohnung, unit('el'), garage],
    tenancies: [tenancy('t', 'el'), tenancy('t-g', 'garage')],
    meters: [meter('hz', null), meter('zz', 'el')],
    readings: [...used('hz', 200), ...used('zz', 40)],
  })
  assert.equal(share(s, 't'), 20000)
  assert.equal(s.selfUsedShareCents, 80000, 'der Rest ist wieder Eigenanteil')
  assert.deepEqual(codes(s), [])
})
