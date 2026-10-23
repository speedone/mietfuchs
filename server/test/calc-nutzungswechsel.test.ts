// Nutzungswechsel einer Einheit (#259): Die Nutzung ist eine Staffel „ab Datum“, die erste Stufe
// ist die Angabe an der Einheit. Handrechnungen je Schlüssel, der Widerspruch mit einem
// Mietverhältnis und eine Invariante über Zufallsbestände mit Wechseln.
// Entwurf: docs/superpowers/specs/2026-10-23-nutzungswechsel-design.md

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { assertLandlordParts } from '../testing/landlordParts.ts'
import { selfSnapshot, selfTenancy, selfUnit } from '../testing/selfHeating.ts'
import { usageAt, usageSpans, unitAsOf } from '../../shared/unitUsage.ts'
import type { CostKey, UnitUsage } from '../../shared/types.ts'

const tenancy = (id: string, unitId: string, start = '2025-01-01', end: string | null = null, persons = 1): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const eigen = { participates: false, selfUsed: true } as const
const item = (over: Partial<SnapshotCostItem> & Pick<SnapshotCostItem, 'key'>): SnapshotCostItem => ({
  id: 'k', period: calendarPeriod(2025), category: 'Gartenpflege', description: 'Probe', amountCents: 100000, ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const settle = (s: SnapshotSource): ComputedSettlement => computeSettlement(snapshotOf(s, 2025))
const shareOf = (s: ComputedSettlement, tenancyId: string): number =>
  s.statements.find((st) => st.tenancyId === tenancyId)?.totalShareCents ?? 0
const partOf = (s: ComputedSettlement, reason: string): number =>
  s.landlord.rows.reduce((a, r) => a + (r.landlordParts ?? []).filter((p) => p.reason === reason).reduce((b, p) => b + p.cents, 0), 0)
const codes = (s: ComputedSettlement): string[] => s.notices.map((n) => n.code)
const parts = (s: ComputedSettlement): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const r of s.landlord.rows) for (const p of r.landlordParts ?? []) m[p.reason] = (m[p.reason] ?? 0) + p.cents
  return m
}

// ---------- Die Staffel selbst ----------

test('Nutzung am Tag: vor dem ersten Wechsel gilt die Angabe an der Einheit, danach der Wechsel', () => {
  const u = unit('b', { ...eigen, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }, { from: '2026-01-01', usage: 'ausgenommen' }] })
  assert.equal(usageAt(u, '2025-06-30'), 'eigen')
  assert.equal(usageAt(u, '2025-07-01'), 'vermietet')
  assert.equal(usageAt(u, '2026-03-01'), 'ausgenommen')
  assert.deepEqual(usageSpans(u, '2025-01-01', '2025-12-31'), [
    { from: '2025-01-01', to: '2025-06-30', usage: 'eigen', days: 181 },
    { from: '2025-07-01', to: '2025-12-31', usage: 'vermietet', days: 184 },
  ])
  // Zwei Einträge am selben Tag: es gilt der letzte.
  const twice = unit('c', { usageChanges: [{ from: '2025-03-01', usage: 'eigen' }, { from: '2025-03-01', usage: 'ausgenommen' }] })
  assert.equal(usageAt(twice, '2025-03-01'), 'ausgenommen')
  // Ohne Wechsel am Stichtag dasselbe Objekt, damit keine Zahl wandert.
  const fixed = unit('d')
  assert.equal(unitAsOf(fixed, '2025-12-31'), fixed)
  assert.deepEqual({ ...unitAsOf(u, '2025-12-31') }, { ...u, participates: true, selfUsed: false, usageChanges: [] })
})

// ---------- Ohne Wechsel im Zeitraum ändert sich nichts ----------

test('ein Wechsel vor dem Zeitraum rechnet wie die feste Angabe', () => {
  for (const key of ['area', 'units', 'persons'] as const) {
    const vorher = settle(source({
      units: [unit('a'), unit('b', { usageChanges: [{ from: '2024-05-01', usage: 'eigen' }], selfPersons: 2 })],
      tenancies: [tenancy('t-a', 'a')],
      costItems: [item({ key })],
    }))
    const fest = settle(source({
      units: [unit('a'), unit('b', { ...eigen, selfPersons: 2 })],
      tenancies: [tenancy('t-a', 'a')],
      costItems: [item({ key })],
    }))
    assert.equal(shareOf(vorher, 't-a'), shareOf(fest, 't-a'), key)
    assert.equal(vorher.selfUsedShareCents, fest.selfUsedShareCents, key)
    assert.deepEqual(codes(vorher), codes(fest), key)
  }
})

test('ein Wechsel genau am Beginn des Zeitraums rechnet wie die feste Angabe, bei jedem Schlüssel (S5)', () => {
  const meters: SnapshotSource['meters'] = [{ id: 'ma', unitId: 'a', type: 'kaltwasser' }, { id: 'mb', unitId: 'b', type: 'kaltwasser' }]
  const readings: SnapshotSource['readings'] = [
    { meterId: 'ma', date: '2024-12-31', value: 0 }, { meterId: 'ma', date: '2025-12-31', value: 70 },
    { meterId: 'mb', date: '2024-12-31', value: 0 }, { meterId: 'mb', date: '2025-12-31', value: 30 },
  ]
  for (const target of ['eigen', 'ausgenommen'] as const) {
    for (const over of [{ key: 'area' }, { key: 'units' }, { key: 'persons' }, { key: 'meter', meterType: 'kaltwasser' }, { key: 'direct', directUnitId: 'b' }, { key: 'custom', customShares: { a: 50, b: 30 } }] as const) {
      const run = (b: SnapshotUnit) => settle(source({ units: [unit('a'), b], tenancies: [tenancy('t-a', 'a')], meters, readings, costItems: [item({ ...over })] }))
      const wechsel = run(unit('b', { selfPersons: 2, usageChanges: [{ from: '2025-01-01', usage: target }] }))
      const fest = run(unit('b', { participates: false, selfUsed: target === 'eigen', selfPersons: 2 }))
      const what = `${target} ${over.key}`
      assert.equal(shareOf(wechsel, 't-a'), shareOf(fest, 't-a'), what)
      assert.deepEqual(parts(wechsel), parts(fest), what)
      assert.deepEqual(codes(wechsel), codes(fest), what)
    }
  }
})

test('Verbrauch: was der Zähler in der Zeit außerhalb misst, trägt der Vermieter als außerhalb', () => {
  const s = settle(source({
    units: [unit('a'), unit('b', { participates: false, selfUsed: false, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    meters: [{ id: 'ma', unitId: 'a', type: 'kaltwasser' }, { id: 'mb', unitId: 'b', type: 'kaltwasser' }],
    readings: [
      { meterId: 'ma', date: '2024-12-31', value: 0 }, { meterId: 'ma', date: '2025-12-31', value: 100 },
      { meterId: 'mb', date: '2024-12-31', value: 0 }, { meterId: 'mb', date: '2025-06-30', value: 40 }, { meterId: 'mb', date: '2025-12-31', value: 100 },
    ],
    costItems: [item({ key: 'meter', meterType: 'kaltwasser' })],
  }))
  assert.deepEqual([shareOf(s, 't-a'), shareOf(s, 't-b'), partOf(s, 'outsideUnit')], [50000, 30000, 20000])
})

// ---------- Handrechnungen ----------

// Wohnung b: bis 30.06. selbstgenutzt, ab 01.07. vermietet an t-b. 181 und 184 Tage.
const switching = (over: Partial<SnapshotUnit> = {}) =>
  unit('b', { ...eigen, selfPersons: 2, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }], ...over })

test('Fläche: der Eigenanteil gilt nur für die Tage der Eigennutzung', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'area' })],
  }))
  // 100.000 × 50/100 × 184/365 = 25.205,48 und × 181/365 = 24.794,52 Cent.
  assert.equal(shareOf(s, 't-a'), 50000)
  assert.equal(shareOf(s, 't-b'), 25205)
  assert.equal(s.selfUsedShareCents, 24795)
  assert.equal(partOf(s, 'vacancy'), 0)
  assertLandlordParts(s, 2, 'Fläche')
  assert.ok(codes(s).includes('usage.changed'))
})

test('Fläche: eine Zeit außerhalb der Abrechnungseinheit zählt nicht zur Verteilbasis', () => {
  const s = settle(source({
    units: [unit('a'), unit('b', { participates: false, selfUsed: false, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'area' })],
  }))
  // Je Abschnitt (Durchsicht S1): Januar bis Juni trägt t-a allein 100.000 × 181/365 = 49.589,04, ab Juli je die
  // Hälfte von 50.410,96. t-a 74.794,52, t-b 25.205,48; vorher 66.485 und 33.515 (Basis über das Jahr gemittelt).
  assert.equal(shareOf(s, 't-a'), 74795)
  assert.equal(shareOf(s, 't-b'), 25205)
  assert.equal(s.landlord.totalCents, 0)
  assert.match(s.statements.find((x) => x.tenancyId === 't-b')?.rows[0]?.basisText ?? '', /50 von 100 m² 01\.07\.–31\.12\.2025/)
})

test('Einheiten und Gemeinschaft: je Abschnitt verteilt, wenn eine Einheit zwischen drinnen und außerhalb wechselt', () => {
  for (const key of ['units', 'external'] as const) {
    const s = settle(source({
      units: [unit('a', { mea: 100 }), unit('b', { mea: 100, participates: false, selfUsed: false, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] })],
      tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
      costItems: [item({ key, ...(key === 'external' ? { externalBasis: { measure: 'mea' as const, total: 1000, totalCents: 500000 } } : {}) })],
    }))
    assert.deepEqual([shareOf(s, 't-a'), shareOf(s, 't-b')], [74795, 25205], key)
    if (key === 'units') assert.doesNotMatch(s.statements.find((x) => x.tenancyId === 't-b')?.rows[0]?.basisText ?? '', /1,5/)
  }
})

test('Hauptzähler: der Rest einer nur teilweise selbstgenutzten Einheit ohne Zähler wird nach Tagen geteilt (S2)', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    meters: [{ id: 'ma', unitId: 'a', type: 'kaltwasser' }, { id: 'mm', unitId: null, type: 'kaltwasser' }],
    readings: [
      { meterId: 'ma', date: '2024-12-31', value: 0 }, { meterId: 'ma', date: '2025-12-31', value: 100 },
      { meterId: 'mm', date: '2024-12-31', value: 0 }, { meterId: 'mm', date: '2025-12-31', value: 200 },
    ],
    costItems: [item({ key: 'meter', meterType: 'kaltwasser' })],
  }))
  // Rest 50.000: 181/365 Eigenanteil (24.794,52), der übrige Teil beim Vermieter als Rest des Hauptzählers.
  assert.equal(shareOf(s, 't-a'), 50000)
  assert.equal(s.selfUsedShareCents, 24795)
  assert.equal(partOf(s, 'mainMeterRest'), 25205)
  const n = s.notices.find((x) => x.code === 'meter.unit-without-meter') ?? assert.fail('Hinweis fehlt')
  assert.match(n.text, /nach Tagen/)
})

test('§ 2 HeizkostenV: selbst bewohnt nur, wenn die Einheit an jedem Tag selbstgenutzt ist (S4)', () => {
  assert.ok(codes(computeSettlement({ ...snapshotOf(source({
    units: [unit('a'), unit('b', { ...eigen, selfPersons: 1 })], tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'area', category: 'Heizung und Warmwasser' })],
  }), 2025), property: { kind: 'zfh' } })).every((c) => c !== 'property.kind-mismatch'), 'ganzjährig selbst bewohnt: Ausnahme gilt')
  const zfh = computeSettlement({ ...snapshotOf(source({
    units: [unit('a'), unit('b', { ...eigen, selfPersons: 1, usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] })],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'area', category: 'Heizung und Warmwasser' })],
  }), 2025), property: { kind: 'zfh' } })
  assert.ok(codes(zfh).includes('property.kind-mismatch'), 'nur bis Juni selbst bewohnt: Ausnahme gilt nicht')
})


test('Fläche: Leerstand zwischen Eigennutzung und Einzug bleibt beim Vermieter', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-10-01')],
    costItems: [item({ key: 'area' })],
  }))
  // Juli bis September: 92 Tage Leerstand, 12.602,74 Cent; t-b 92 Tage, ebenso viel.
  assert.equal(shareOf(s, 't-b'), 12603)
  assert.equal(partOf(s, 'vacancy'), 12603)
  assert.equal(s.selfUsedShareCents, 24794)
  assert.equal(shareOf(s, 't-a') + shareOf(s, 't-b') + s.landlord.totalCents, 100000)
})

test('Einheiten: der Eigenanteil zählt die Tage', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'units' })],
  }))
  assert.deepEqual([shareOf(s, 't-a'), shareOf(s, 't-b'), s.selfUsedShareCents], [50000, 25205, 24795])
})

test('Personen: die eigenen Personen zählen nur in der Zeit der Eigennutzung', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'persons' })],
  }))
  // 365 + 184 + 2 × 181 = 911 Personentage.
  assert.equal(shareOf(s, 't-a'), Math.round(100000 * 365 / 911))
  assert.equal(shareOf(s, 't-b'), Math.round(100000 * 184 / 911))
  assert.equal(s.selfUsedShareCents, 100000 - Math.round(100000 * 365 / 911) - Math.round(100000 * 184 / 911))
})

test('Personen: Leerstand nach der Eigennutzung zählt mit einer Person je Tag (#177)', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'persons' })],
  }))
  // 365 (t-a) + 362 (eigen) + 184 (Leerstand) = 911.
  assert.equal(shareOf(s, 't-a'), Math.round(100000 * 365 / 911))
  assert.equal(partOf(s, 'vacancy'), Math.round(100000 * 184 / 911))
})

test('Vereinbarte Anteile: außerhalb verfällt der Anteil nur für diese Tage', () => {
  const s = settle(source({
    units: [unit('a'), unit('b', { participates: false, selfUsed: false, usageChanges: [{ from: '2025-07-01', usage: 'eigen' }] })],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'custom', customShares: { a: 60, b: 40 } })],
  }))
  assert.equal(shareOf(s, 't-a'), 60000)
  // 40 % × 184/365 Eigenanteil, 40 % × 181/365 außerhalb.
  assert.equal(s.selfUsedShareCents, 20164)
  assert.equal(partOf(s, 'outsideUnit'), 19836)
})

test('Direktzuordnung: Eigennutzung und Mieter teilen nach Tagen', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'direct', directUnitId: 'b' })],
  }))
  assert.equal(shareOf(s, 't-a'), 0)
  assert.equal(shareOf(s, 't-b'), 50411)
  assert.equal(s.selfUsedShareCents, 49589)
})

test('Verbrauch: was der Zähler in der Zeit der Eigennutzung misst, ist Eigenanteil', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    meters: [{ id: 'ma', unitId: 'a', type: 'kaltwasser' }, { id: 'mb', unitId: 'b', type: 'kaltwasser' }],
    readings: [
      { meterId: 'ma', date: '2024-12-31', value: 0 }, { meterId: 'ma', date: '2025-12-31', value: 100 },
      { meterId: 'mb', date: '2024-12-31', value: 0 }, { meterId: 'mb', date: '2025-06-30', value: 30 },
      { meterId: 'mb', date: '2025-12-31', value: 100 },
    ],
    costItems: [item({ key: 'meter', meterType: 'kaltwasser' })],
  }))
  // Basis 200 m³: a 100, b 30 eigen, 70 Mieter.
  assert.deepEqual([shareOf(s, 't-a'), shareOf(s, 't-b'), s.selfUsedShareCents], [50000, 35000, 15000])
})

test('Ein Mietverhältnis in der Zeit der Eigennutzung zählt erst ab der Vermietung und wird gemeldet', () => {
  const s = settle(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-04-01')],
    costItems: [item({ key: 'area' })],
  }))
  assert.equal(shareOf(s, 't-b'), 25205)
  assert.equal(s.selfUsedShareCents, 24795)
  const n = s.notices.find((x) => x.code === 'usage.tenancy-conflict') ?? assert.fail('Hinweis fehlt')
  assert.equal(n.level, 'error')
  assert.match(n.text, /t-b/)
  assert.match(n.text, /an 91 Tagen/)
  assert.doesNotMatch(n.text, /spätere vermietete Zeit/)
})

test('Ein Mietverhältnis über vermietet, Eigennutzung, vermietet zählt im ersten Abschnitt; der Hinweis trennt beide Teile', () => {
  const s = settle(source({
    units: [unit('a'), unit('b', { usageChanges: [{ from: '2025-04-01', usage: 'eigen' }, { from: '2025-07-01', usage: 'vermietet' }] })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    costItems: [item({ key: 'area' })],
  }))
  // Januar bis März 90 Tage: 100.000 × 50/100 × 90/365 = 12.328,77.
  assert.equal(shareOf(s, 't-b'), 12329)
  // Eigennutzung April bis Juni 91 Tage: 12.465,75; Juli bis Dezember Leerstand, denn das Mietverhältnis zählt dort nicht.
  assert.equal(s.selfUsedShareCents, 12466)
  assert.equal(partOf(s, 'vacancy'), 25205)
  const n = s.notices.find((x) => x.code === 'usage.tenancy-conflict') ?? assert.fail('Hinweis fehlt')
  assert.match(n.text, /an 91 Tagen in einer Zeit/)
  assert.match(n.text, /die übrigen 184 Tage nicht/)
})

test('Eigene Heizkostenabrechnung: ein Mietverhältnis ganz in der Zeit der Eigennutzung ist Eigenanteil (S3)', () => {
  const units = [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60, { selfPersons: 1, usageChanges: [{ from: '2025-10-01', usage: 'eigen' }] })]
  const base = [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('C1', 'c', '2020-01-01', '2025-09-30')]
  const ohne = computeSettlement(selfSnapshot({ units, tenancies: base }))
  const mit = computeSettlement(selfSnapshot({ units, tenancies: [...base, selfTenancy('C2', 'c', '2025-10-01', null)] }))
  // Ohne C2 trägt die Eigennutzung ab Oktober; mit C2 (Widerspruch) ebenso, nicht „außerhalb“.
  assert.equal(partOf(ohne, 'selfUse'), 75075)
  assert.equal(partOf(mit, 'selfUse'), 75075)
  assert.equal(partOf(mit, 'outsideUnit'), 0)
  const n = mit.notices.find((x) => x.code === 'usage.tenancy-conflict') ?? assert.fail('Hinweis fehlt')
  assert.doesNotMatch(n.text, /bleibt er dagegen Nutzer/)
})

// ---------- Steuerübersicht (Teil 1) ----------

test('Steuer: umlagefähige Kosten folgen dem tagesgenauen Eigenanteil, der Wechsel wird genannt', () => {
  const r = taxReport(snapshotOf(source({
    units: [unit('a'), switching()],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', '2025-07-01')],
    costItems: [item({ key: 'area' }), item({ id: 'g', key: 'area', category: 'Nicht umlagefähig', description: 'Dach' })],
  }), 2025))
  const x = r.expenses.items.find((i) => i.costItemId === 'k') ?? assert.fail('Position fehlt')
  assert.equal(x.privateCents, 24795)
  assert.deepEqual(r.usageChangedUnits, ['b'])
  assert.equal(r.selfUseChangedInYear, false)
  // Nach Fläche tagesgenau (Durchsicht M1): 100.000 × 50 × 181/365 / 100 = 24.794,52; vorher nach dem Jahresende 0.
  assert.equal(r.expenses.items.find((i) => i.costItemId === 'g')?.privateCents, 24795)
})

test('Steuer: nach Fläche tagesgenau, auch bei Einheiten außerhalb (M1, Probe P2 und P3)', () => {
  // P2: x selbst bis 30.06., dann außerhalb. Die Abrechnung: 24.795 Eigenanteil; die Steuer teilt nach dem Gebäude, weil
  // x an Tagen außerhalb liegt: 100.000 × (50 × 181/365) / 100 = 24.794,52.
  const p2 = taxReport(snapshotOf(source({
    units: [unit('a'), unit('x', { ...eigen, selfPersons: 1, usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] })],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'area' }), item({ id: 'g', key: 'area', category: 'Nicht umlagefähig', description: 'Dach' })],
  }), 2025))
  assert.deepEqual(p2.expenses.items.map((i) => [i.costItemId, i.privateCents]), [['k', 24795], ['g', 24795]])
  assert.equal(p2.selfOccupiedExists, true)
  // P3: x vermietet bis November, ab Dezember selbst, y ganz außerhalb: Gebäude 150 m², selbst 50 × 31/365.
  const p3 = taxReport(snapshotOf(source({
    units: [unit('a'), unit('x', { usageChanges: [{ from: '2025-12-01', usage: 'eigen' }], selfPersons: 1 }), unit('y', { participates: false, selfUsed: false })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-x', 'x', '2025-01-01', '2025-11-30')],
    costItems: [item({ key: 'area' })],
  }), 2025))
  const k = p3.expenses.items.find((i) => i.costItemId === 'k') ?? assert.fail('Position fehlt')
  assert.deepEqual([k.privateCents, k.settlementPrivateCents], [2831, 4247])
  // Die Fläche im Kopf der Anlage V nach Tagen (Auslegung): 50 × 31/365.
  assert.equal(p3.selfUsedAreaM2, Math.round(50 * 31 / 365 * 100) / 100)
})

test('Steuer: ohne Wechsel keine Angabe zum Nutzungswechsel', () => {
  const r = taxReport(snapshotOf(source({
    units: [unit('a'), unit('b', eigen)],
    tenancies: [tenancy('t-a', 'a')],
    costItems: [item({ key: 'area' })],
  }), 2025))
  assert.equal(r.usageChangedUnits, undefined)
})

// ---------- Invariante über Zufallsbestände mit Wechseln ----------

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

test('Invariante je Einheit bei gleichbleibender Basis: Eigenanteil nach Tagen, Leerstand nur aus vermieteten Tagen (S5)', () => {
  // Nur vermietet und selbstgenutzt: Die Basis bleibt, und der Eigenanteil einer Position nach Fläche ist genau
  // Σ Betrag × Fläche / Basis × Tage selbstgenutzt / Tage (bis auf die Rundung, ein Cent je Position).
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 31)
    const day = () => `2025-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
    const units: SnapshotUnit[] = []
    const tenancies: SnapshotTenancy[] = []
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
      const base = r() < 0.5 ? 'vermietet' : 'eigen'
      const changes = Array.from({ length: Math.floor(r() * 3) }, () => ({ from: day(), usage: (r() < 0.5 ? 'vermietet' : 'eigen') as UnitUsage }))
      const u = unit(`u${i}`, { areaM2: 20 + Math.floor(r() * 80), participates: base === 'vermietet', selfUsed: base === 'eigen', usageChanges: changes })
      units.push(u)
      // Ein Mietverhältnis in jedem vermieteten Abschnitt, mit Zufallslücke am Anfang (Leerstand).
      for (const [k, sp] of usageSpans(u, '2025-01-01', '2025-12-31').entries()) {
        if (sp.usage !== 'vermietet' || r() < 0.3) continue
        const start = r() < 0.5 ? sp.from : sp.to
        tenancies.push(tenancy(`t${i}-${k}`, u.id, start, sp.to))
      }
    }
    const amount = 1000 + Math.floor(r() * 300000)
    const s = settle(source({ units, tenancies, costItems: [item({ key: 'area', amountCents: amount })] }))
    const basis = units.reduce((a, u) => a + u.areaM2, 0)
    const share = (u: SnapshotUnit, k: UnitUsage) => usageSpans(u, '2025-01-01', '2025-12-31').filter((x) => x.usage === k).reduce((a, x) => a + x.days, 0) / 365
    const expectedSelf = units.reduce((a, u) => a + amount * (u.areaM2 / basis) * share(u, 'eigen'), 0)
    const rentedMax = units.reduce((a, u) => a + amount * (u.areaM2 / basis) * share(u, 'vermietet'), 0)
    assert.ok(Math.abs(s.selfUsedShareCents - expectedSelf) <= 1, `Startwert ${seed}: Eigenanteil ${s.selfUsedShareCents} statt ${expectedSelf}`)
    assert.ok((parts(s).vacancy ?? 0) <= rentedMax + 1, `Startwert ${seed}: Leerstand über den vermieteten Tagen`)
    assert.equal(parts(s).outsideUnit ?? 0, 0, `Startwert ${seed}: nichts außerhalb`)
  }
})

test('Invariante: Summen, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil, auch mit Nutzungswechseln', () => {
  const usages: UnitUsage[] = ['vermietet', 'eigen', 'ausgenommen']
  const keys: CostKey[] = ['area', 'units', 'persons', 'custom', 'direct', 'meter']
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
    const day = () => `2025-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
    const units: SnapshotUnit[] = []
    const tenancies: SnapshotTenancy[] = []
    const readings: SnapshotSource['readings'] = []
    const meters: SnapshotSource['meters'] = []
    const n = 2 + Math.floor(r() * 3)
    for (let i = 0; i < n; i++) {
      const base = pick(usages)
      const changes = Array.from({ length: Math.floor(r() * 3) }, () => ({ from: day(), usage: pick(usages) }))
      units.push(unit(`u${i}`, {
        areaM2: Math.floor(r() * 3) === 0 ? 0 : 20 + Math.floor(r() * 80),
        participates: base === 'vermietet', selfUsed: base === 'eigen', selfPersons: Math.floor(r() * 3),
        usageChanges: changes,
      }))
      // Ohne Überschneidung (#204 rechnet sie bewusst doppelt): bis zu zwei Mietverhältnisse nacheinander.
      const pts = [day(), day(), day(), day()].sort()
      const tCount = Math.floor(r() * 3)
      for (let k = 0; k < tCount; k++) {
        const start = pts[2 * k] as string
        const end = pts[2 * k + 1] as string
        if (k === 1 && start <= (pts[1] as string)) break
        tenancies.push(tenancy(`t${i}-${k}`, `u${i}`, start, k === tCount - 1 && r() < 0.3 ? null : end, Math.floor(r() * 4)))
      }
      if (r() < 0.7) {
        meters.push({ id: `m${i}`, unitId: `u${i}`, type: 'kaltwasser' })
        let v = 0
        readings.push({ meterId: `m${i}`, date: '2024-12-31', value: 0 })
        for (const d of ['2025-03-31', '2025-06-30', '2025-12-31']) { v += Math.floor(r() * 50); readings.push({ meterId: `m${i}`, date: d, value: v }) }
      }
    }
    const costItems = Array.from({ length: 4 }, (_, k) => {
      const key = pick(keys)
      return item({
        id: `k${k}`, key, amountCents: 1000 + Math.floor(r() * 200000),
        ...(key === 'custom' ? { customShares: Object.fromEntries(units.map((u) => [u.id, Math.floor(r() * 30)])) } : {}),
        ...(key === 'direct' ? { directUnitId: pick(units).id } : {}),
        ...(key === 'meter' ? { meterType: 'kaltwasser' as const } : {}),
      })
    })
    const s = settle(source({ units, tenancies, meters, readings, costItems }))
    const ctx = `Startwert ${seed}`
    const tenants = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
    assert.equal(tenants + s.landlord.totalCents, costItems.reduce((a, c) => a + c.amountCents, 0), ctx)
    for (const st of s.statements) for (const row of st.rows) assert.ok(row.shareCents >= 0, `${ctx}: negativer Anteil ${row.shareCents}`)
    for (const row of s.landlord.rows) assert.ok(row.shareCents >= 0, `${ctx}: negativer Vermieteranteil`)
    assert.ok(s.selfUsedShareCents >= 0 && s.selfUsedShareCents <= s.landlord.totalCents, `${ctx}: Eigenanteil ${s.selfUsedShareCents} über Vermieteranteil ${s.landlord.totalCents}`)
    assertLandlordParts(s, tenancies.length, ctx)
  }
})
