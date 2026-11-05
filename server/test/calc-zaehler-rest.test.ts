// Bezugszähler und verteilter Rest (#98): Zähler für einen Teil des Hauses.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { consumptionOverview, taxReport } from '../src/calc.ts'
import type { MeterRest } from '../../shared/types.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const unit = (id: string): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true })
const meter = (id: string, unitId: string | null, scope?: 'common'): SnapshotMeter => ({
  id, unitId, type: 'strom', ...(scope ? { scope } : {}),
})
const used = (meterId: string, amount: number): SnapshotReading[] => [
  { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
]
const strom: SnapshotCostItem = { id: 's', period: calendarPeriod(2025), category: 'Strom', description: 'Strom', amountCents: 40000, key: 'meter', meterType: 'strom' }
const settle = (s: Partial<SnapshotSource>): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [strom], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, 2025))
const share = (s: ComputedSettlement, id: string) => s.statements.find((st) => st.tenancyId === id)?.totalShareCents
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)

const base = (scope?: 'common'): Partial<SnapshotSource> => ({
  units: [unit('a'), unit('b')],
  tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
  meters: [meter('za', 'a'), meter('zb', 'b'), meter('zg', null, scope)],
  readings: [...used('za', 100), ...used('zb', 300), ...used('zg', 1000)],
})

test('common-Zähler wirkt in keine Position ohne meterRest', () => {
  const s = settle(base('common'))
  assert.equal(share(s, 't-a'), 10000)
  assert.equal(share(s, 't-b'), 30000)
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!codes(s).includes('meter.main-gap'))
})

test('Gegenprobe: derselbe Zähler ohne scope ist Hauptzähler wie bisher', () => {
  const s = settle(base())
  assert.equal(share(s, 't-a'), 10000)
  assert.equal(share(s, 't-b'), 30000)
  assert.ok(codes(s).includes('meter.main-gap'))
})

// ---------- Rest des Bezugszählers und Zwischenzähler (#98, Task 4) ----------

type Over = Partial<SnapshotUnit>
const room = (id: string, areaM2: number, over: Over = {}): SnapshotUnit => ({ id, name: id, areaM2, participates: true, ...over })
const lease = (id: string, unitId: string, start = '2025-01-01', end: string | null = null, persons = 1): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons, personHistory: [{ from: start, persons }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const gauge = (id: string, unitId: string | null, type: SnapshotMeter['type'], scope?: 'common'): SnapshotMeter => ({
  id, name: id, unitId, type, ...(scope ? { scope } : {}),
})
const rest = (over: Partial<MeterRest> = {}): MeterRest => ({ referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [], ...over })
const water = (amountCents: number, meterRest: MeterRest | null, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'w', period: calendarPeriod(2025), category: 'Wasser/Abwasser', description: 'Wasser', amountCents, key: 'meter', meterType: 'kaltwasser',
  ...(meterRest ? { meterRest } : {}), ...over,
})
const run = (s: Partial<SnapshotSource>, items: SnapshotCostItem[]): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s, costItems: items,
}, 2025))
const part = (s: ComputedSettlement, reason: string): number =>
  s.landlord.rows.reduce((a, r) => a + (r.landlordParts ?? []).filter((p) => p.reason === reason).reduce((b, p) => b + p.cents, 0), 0)
const notice = (s: ComputedSettlement, code: string) => s.notices.find((n) => n.code === code)

// Zwei Wohnungen mit Zähler (40 und 60 m²), ein Hauptzähler.
const pair = (main: number, a = 400, b = 600): Partial<SnapshotSource> => ({
  units: [room('a', 40), room('b', 60)],
  tenancies: [lease('t-a', 'a'), lease('t-b', 'b')],
  meters: [gauge('za', 'a', 'kaltwasser'), gauge('zb', 'b', 'kaltwasser'), gauge('zm', null, 'kaltwasser')],
  readings: [...used('za', a), ...used('zb', b), ...used('zm', main)],
})

test('Messdifferenz nach Fläche: 400 + 40 und 600 + 60 €', () => {
  const s = run(pair(1100), [water(110000, rest())])
  assert.equal(share(s, 't-a'), 44000)
  assert.equal(share(s, 't-b'), 66000)
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!codes(s).includes('meter.rest-high'))
  // Bei gleichen Flächen unterscheidet sich das vom Verhältnis der Zähler: 400 + 50 und 600 + 50 €.
  const even = pair(1100)
  const t = run({ ...even, units: [room('a', 50), room('b', 50)] }, [water(110000, rest())])
  assert.equal(share(t, 't-a'), 45000)
  assert.equal(share(t, 't-b'), 65000)
})

test("Messdifferenz im Verhältnis der Zähler ('meter'): genau die heutigen Anteile (Orakel)", () => {
  for (const [main, a, b, amount] of [[1100, 400, 600, 110000], [1000, 333.3, 555.5, 123457], [987.65, 321.1, 600.2, 99999]] as const) {
    const today = run(pair(main, a, b), [water(amount, null)])
    const made = run(pair(main, a, b), [water(amount, rest({ key: 'meter' }))])
    assert.deepEqual([share(made, 't-a'), share(made, 't-b'), made.landlord.totalCents], [share(today, 't-a'), share(today, 't-b'), today.landlord.totalCents], `${main}/${a}/${b}`)
  }
})

// Gewerbe mit Zähler, zwei Wohnungen ohne (50/50 m²).
const shop = (over: Partial<SnapshotSource> = {}): Partial<SnapshotSource> => ({
  units: [room('g', 100), room('w1', 50), room('w2', 50)],
  tenancies: [lease('t-g', 'g'), lease('t-w1', 'w1'), lease('t-w2', 'w2')],
  meters: [gauge('zg', 'g', 'kaltwasser'), gauge('zm', null, 'kaltwasser')],
  readings: [...used('zg', 200), ...used('zm', 1000)],
  ...over,
})

test('Gewerbe mit Zähler, Wohnungen ohne: Rest an die Wohnungen nach Fläche', () => {
  const s = run(shop(), [water(100000, rest({ unitIds: ['w1', 'w2'] }))])
  assert.equal(share(s, 't-g'), 20000)
  assert.equal(share(s, 't-w1'), 40000)
  assert.equal(share(s, 't-w2'), 40000)
  assert.equal(s.landlord.totalCents, 0)
  // Bei ungemessener Gruppe ist der Rest kein Messfehler: keine Schwelle.
  assert.ok(!codes(s).includes('meter.rest-high'))
  assert.ok(!codes(s).includes('meter.unit-without-meter'), s.warnings.join(' | '))
})

test('Gruppe mit Nutzungswechsel: der Rest geht je Abschnitt nur an Mietverhältnisse der Gruppe', () => {
  const s = run(shop({
    units: [room('g', 100), room('w1', 50), room('w2', 50, { usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] })],
    tenancies: [lease('t-g', 'g'), lease('t-w1', 'w1'), lease('t-w2', 'w2', '2025-01-01', '2025-06-30')],
  }), [water(100000, rest({ unitIds: ['w1', 'w2'] }))])
  // Rest 80.000 ct: 181 Tage je zur Hälfte, 184 Tage allein an w1.
  const first = 80000 * (181 / 365)
  assert.equal(share(s, 't-g'), 20000)
  assert.equal(share(s, 't-w2'), Math.round(first / 2))
  assert.equal(share(s, 't-w1'), 100000 - 20000 - Math.round(first / 2))
})

test('Allgemeinstrom: Wohnungsstromzähler zählen nicht, Garage über Zwischenzähler direkt, Rest nach Fläche', () => {
  const s = run({
    units: [room('a', 50), room('b', 50), room('c', 0)],
    tenancies: [lease('t-a', 'a'), lease('t-b', 'b'), lease('t-c', 'c')],
    meters: [gauge('za', 'a', 'strom'), gauge('zb', 'b', 'strom'), gauge('zall', null, 'strom', 'common'), gauge('zgar', null, 'strom', 'common')],
    readings: [...used('za', 1500), ...used('zb', 2500), ...used('zall', 2000), ...used('zgar', 200)],
  }, [{
    id: 'as', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom', amountCents: 100000, key: 'meter', meterType: 'strom',
    meterRest: rest({ referenceMeterId: 'zall', behindMeterIds: [], subMeters: [{ meterId: 'zgar', target: { key: 'direct', unitIds: ['c'] } }] }),
  }])
  assert.equal(share(s, 't-c'), 10000)
  assert.equal(share(s, 't-a'), 45000)
  assert.equal(share(s, 't-b'), 45000)
})

test('Gartenwasser beim Abwasser (excluded): verteilt wie 400/600 auf den ganzen Betrag', () => {
  const p = pair(1200)
  const s = run({ ...p, meters: [...(p.meters ?? []), gauge('zgarten', null, 'kaltwasser', 'common')], readings: [...(p.readings ?? []), ...used('zgarten', 200)] },
    [water(100000, rest({ subMeters: [{ meterId: 'zgarten', target: 'excluded' }] }))])
  assert.equal(share(s, 't-a'), 40000)
  assert.equal(share(s, 't-b'), 60000)
})

test("Bauwasser an den Vermieter ('landlord'): Grund mainMeterRest", () => {
  const p = pair(1100)
  const s = run({ ...p, meters: [...(p.meters ?? []), gauge('zbau', null, 'kaltwasser', 'common')], readings: [...(p.readings ?? []), ...used('zbau', 100)] },
    [water(110000, rest({ subMeters: [{ meterId: 'zbau', target: 'landlord' }] }))])
  assert.equal(share(s, 't-a'), 40000)
  assert.equal(share(s, 't-b'), 60000)
  assert.equal(part(s, 'mainMeterRest'), 10000)
  assert.equal(s.selfUsedShareCents, 0)
})

test("Garten des Vermieters ('selfUse'): Eigenanteil und privat in der Steuer", () => {
  const p = pair(1200)
  const src: SnapshotSource = {
    units: [...(p.units ?? []), room('e', 50, { participates: false, selfUsed: true })],
    tenancies: p.tenancies ?? [],
    meters: [...(p.meters ?? []), gauge('ze', 'e', 'kaltwasser'), gauge('zgarten', null, 'kaltwasser', 'common')],
    readings: [...(p.readings ?? []), ...used('ze', 100), ...used('zgarten', 100)],
    costItems: [water(120000, rest({ subMeters: [{ meterId: 'zgarten', target: 'selfUse' }] }))],
    payments: [], closedSettlements: [],
  }
  const s = computeSettlement(snapshotOf(src, 2025))
  assert.equal(share(s, 't-a'), 40000)
  assert.equal(share(s, 't-b'), 60000)
  assert.equal(s.selfUsedShareCents, 20000)
  const tax = taxReport(snapshotOf(src, 2025))
  const row = tax.expenses.items.find((x) => x.costItemId === 'w') ?? assert.fail('Position fehlt in der Steuerübersicht')
  assert.equal(row.privateCents, 20000)
})

test('Teilnehmer mit Hauptzähler als Bezug: der Verbrauch der Nicht-Teilnehmer geht an den Vermieter', () => {
  const p = pair(1400)
  const s = run({
    ...p, units: [...(p.units ?? []), room('c', 50)], tenancies: [...(p.tenancies ?? []), lease('t-c', 'c')],
    meters: [...(p.meters ?? []), gauge('zc', 'c', 'kaltwasser')], readings: [...(p.readings ?? []), ...used('zc', 300)],
  }, [water(140000, rest(), { participantUnitIds: ['a', 'b'] })])
  assert.equal(share(s, 't-a'), 44000)
  assert.equal(share(s, 't-b'), 66000)
  assert.equal(share(s, 't-c'), 0)
  assert.equal(part(s, 'outsideUnit'), 30000)
})

test('ungemessener bewohnter Nicht-Teilnehmer hinter dem Hauptzähler: rest-mixed, nichts verteilt', () => {
  const s = run(shop({ units: [room('g', 100), room('w1', 50), room('w2', 50), room('x', 30)], tenancies: [lease('t-g', 'g'), lease('t-w1', 'w1'), lease('t-w2', 'w2'), lease('t-x', 'x')] }),
    [water(100000, rest({ unitIds: ['w1', 'w2'] }), { participantUnitIds: ['g', 'w1', 'w2'] })])
  assert.ok(codes(s).includes('meter.rest-mixed'))
  assert.equal(s.landlord.totalCents, 100000)
  assert.match(notice(s, 'meter.rest-mixed')?.text ?? '', /x/)
})

test('gemischte Gruppe: rest-mixed', () => {
  const s = run(shop({ meters: [gauge('zg', 'g', 'kaltwasser'), gauge('zw1', 'w1', 'kaltwasser'), gauge('zm', null, 'kaltwasser')], readings: [...used('zg', 200), ...used('zw1', 300), ...used('zm', 1000)] }),
    [water(100000, rest({ unitIds: ['w1', 'w2'] }))])
  assert.ok(codes(s).includes('meter.rest-mixed'))
  assert.equal(notice(s, 'meter.rest-mixed')?.level, 'error')
  assert.equal(s.landlord.totalCents, 100000)
})

test('Bezugszähler deckt den Zeitraum nicht: ungemessene Gruppe rest-unavailable, gemessene nach den Zählern', () => {
  const short: SnapshotReading[] = [{ meterId: 'zm', date: '2025-03-31', value: 0 }, { meterId: 'zm', date: '2025-12-31', value: 900 }]
  const s = run(shop({ readings: [...used('zg', 200), ...short] }), [water(100000, rest({ unitIds: ['w1', 'w2'] }))])
  assert.ok(codes(s).includes('meter.rest-unavailable'))
  assert.equal(s.landlord.totalCents, 100000)
  assert.equal(share(s, 't-g'), 0)
  const p = pair(0)
  const m = run({ ...p, readings: [...used('za', 400), ...used('zb', 600), ...short] }, [water(100000, rest())])
  assert.equal(share(m, 't-a'), 40000)
  assert.equal(share(m, 't-b'), 60000)
  assert.ok(codes(m).includes('meter.main-partial'))
  assert.ok(!codes(m).includes('meter.rest-unavailable'))
})

test('Rest unter 0: ungemessene Gruppe rest-unavailable, gemessene nach den Zählern mit sub-exceeds-main', () => {
  const s = run(shop({ readings: [...used('zg', 200), ...used('zm', 150)] }), [water(100000, rest({ unitIds: ['w1', 'w2'] }))])
  assert.ok(codes(s).includes('meter.rest-unavailable'))
  const m = run(pair(900), [water(100000, rest())])
  assert.equal(share(m, 't-a'), 40000)
  assert.ok(codes(m).includes('meter.sub-exceeds-main'))
})

test('Zwischenzähler ohne ganzen Zeitraum: sub-incomplete, nichts verteilt', () => {
  const p = pair(1200)
  const s = run({ ...p, meters: [...(p.meters ?? []), gauge('zgarten', null, 'kaltwasser', 'common')], readings: [...(p.readings ?? []), { meterId: 'zgarten', date: '2025-06-30', value: 0 }, { meterId: 'zgarten', date: '2025-12-31', value: 50 }] },
    [water(100000, rest({ subMeters: [{ meterId: 'zgarten', target: 'landlord' }] }))])
  assert.ok(codes(s).includes('meter.sub-incomplete'))
  assert.equal(s.landlord.totalCents, 100000)
})

test('Mieterwechsel mit Personen: der Rest über den Zeitraum, nach Personentagen', () => {
  const s = run(shop({
    tenancies: [lease('t-g', 'g'), lease('t1', 'w1', '2025-01-01', '2025-06-30', 2), lease('t2', 'w1', '2025-07-01', null, 1), lease('t3', 'w2')],
  }), [water(100000, rest({ unitIds: ['w1', 'w2'], key: 'persons' }))])
  // Personentage: t1 2 × 181 = 362, t2 184, t3 365, zusammen 911; Rest 80.000 ct.
  assert.equal(share(s, 't-g'), 20000)
  assert.equal(share(s, 't1'), 31789)
  assert.equal(share(s, 't2'), 16158)
  assert.equal(share(s, 't3'), 32053)
})

test('rest-high ab mehr als 20 % bei ganz gemessener Gruppe, mit Betrag je Mieter', () => {
  const s = run(pair(1500), [water(150000, rest())])
  const n = notice(s, 'meter.rest-high') ?? assert.fail(s.warnings.join(' | '))
  assert.equal(n.level, 'warning')
  // Rest 500 von 1.500 = 50.000 ct, nach Fläche 40/60.
  assert.match(n.text, /200,00 €/)
  assert.match(n.text, /300,00 €/)
  assert.ok(!codes(run(pair(1250), [water(125000, rest())])).includes('meter.rest-high'), 'genau 20 % ist noch keine Warnung')
  assert.ok(s.legalBasis?.values.some((v) => v.id === 'practice.meter-rest-high'), 'Schwelle im Rechtsstand')
})

test('Rechenweg: Bezugszähler mit Anfangs- und Endstand, Summe der Zähler, Rest, Schlüssel', () => {
  const s = run(pair(1100), [water(110000, rest())])
  const steps = s.statements.find((st) => st.tenancyId === 't-a')?.rows[0]?.steps ?? assert.fail('kein Rechenweg')
  const text = steps.map((x) => `${x.label}: ${x.value}`).join('\n')
  assert.match(text, /Bezugszähler: „zm“.*0 am 31\.12\.2024.*1\.100 am 31\.12\.2025/)
  assert.match(text, /Zähler dahinter: .*1\.000/)
  assert.match(text, /Allgemeinverbrauch: 1\.100 − 1\.000 = 100/)
  assert.match(text, /Wohnfläche/)
  assert.ok(steps.some((x) => x.term === 'referenceMeter') && steps.some((x) => x.term === 'meterRest'))
})

// ---------- Fix-Runde 1: Rest beim Vermieter oder als Eigenanteil, Eichfrist ----------

// Gewerbe mit Zähler (200 von 1.000), dazu eine Einheit e ohne Zähler.
const withOwn = (e: SnapshotUnit, extra: SnapshotTenancy[] = [], readings: SnapshotReading[] = used('zg', 200)): SnapshotSource => ({
  units: [room('g', 100), e],
  tenancies: [lease('t-g', 'g'), ...extra],
  meters: [gauge('zg', 'g', 'kaltwasser'), gauge('zm', null, 'kaltwasser')],
  readings: [...readings, ...used('zm', 1000)],
  costItems: [], payments: [], closedSettlements: [],
})
const settleSrc = (src: SnapshotSource, item: SnapshotCostItem) => computeSettlement(snapshotOf({ ...src, costItems: [item] }, 2025))
const privateOf = (src: SnapshotSource, item: SnapshotCostItem) =>
  (taxReport(snapshotOf({ ...src, costItems: [item] }, 2025)).expenses.items.find((x) => x.costItemId === item.id) ?? assert.fail('Position fehlt')).privateCents
const ownUnit = room('e', 80, { participates: false, selfUsed: true })

test("Rest 'landlord': an den Vermieter als mainMeterRest", () => {
  const src = withOwn(room('e', 80), [lease('t-e', 'e')])
  const s = settleSrc(src, water(100000, rest({ key: 'landlord' })))
  assert.equal(share(s, 't-g'), 20000)
  assert.equal(share(s, 't-e'), 0)
  assert.equal(part(s, 'mainMeterRest'), 80000)
  assert.equal(s.selfUsedShareCents, 0)
})

test("Rest 'selfUse' bei nur selbstgenutzter Einheit ohne Zähler: Eigenanteil, privat in der Steuer", () => {
  const src = withOwn(ownUnit)
  const item = water(100000, rest({ key: 'selfUse' }))
  const s = settleSrc(src, item)
  assert.equal(share(s, 't-g'), 20000)
  assert.equal(s.selfUsedShareCents, 80000)
  assert.equal(privateOf(src, item), 80000)
})

test("Rest 'selfUse' bei vermieteter Einheit ohne Zähler: kein Eigenanteil, beim Vermieter mit Hinweis", () => {
  const src = withOwn(room('e', 80), [lease('t-e', 'e')])
  const item = water(100000, rest({ key: 'selfUse' }))
  const s = settleSrc(src, item)
  assert.equal(s.selfUsedShareCents, 0)
  assert.equal(part(s, 'mainMeterRest'), 80000)
  assert.equal(privateOf(src, item), 0)
  // Ohne selbstgenutzte Einheit wie bei #116 ohne den Satz zum Eigenanteil.
  assert.match(notice(s, 'meter.unit-without-meter')?.text ?? '', /für e gibt es keinen abgelesenen Zähler.*geht an den Vermieter/)
})

test("Rest 'selfUse' bei Lücke im Zähler: kein Eigenanteil", () => {
  const gap: SnapshotReading[] = [{ meterId: 'zg', date: '2025-03-31', value: 0 }, { meterId: 'zg', date: '2025-12-31', value: 150 }]
  const s = settleSrc(withOwn(ownUnit, [], gap), water(100000, rest({ key: 'selfUse' })))
  assert.equal(s.selfUsedShareCents, 0)
  assert.match(notice(s, 'meter.unit-partial')?.text ?? '', /nicht als Eigenanteil/)
})

test("Rest 'selfUse' ohne Einheit ohne Zähler: Messdifferenz, kein Eigenanteil", () => {
  const p = pair(1100)
  const s = run(p, [water(110000, rest({ key: 'selfUse' }))])
  assert.equal(s.selfUsedShareCents, 0)
  assert.equal(part(s, 'mainMeterRest'), 10000)
  assert.ok(codes(s).includes('meter.rest-not-self'), s.warnings.join(' | '))
})

test("Rest 'selfUse' bei Nutzungswechsel: Eigenanteil nur für die Tage, an denen die Einheit ohne Zähler selbstgenutzt ist", () => {
  const e = room('e', 80, { participates: false, selfUsed: true, usageChanges: [{ from: '2025-07-01', usage: 'vermietet' }] })
  const s = settleSrc(withOwn(e), water(100000, rest({ key: 'selfUse' })))
  // 181 von 365 Tagen selbstgenutzt: 80.000 × 181/365 = 39.671,23 ct Eigenanteil, der Rest beim Vermieter.
  assert.equal(s.selfUsedShareCents, Math.round(80000 * 181 / 365))
  assert.ok(codes(s).includes('meter.unit-without-meter'))
})

test('Eichfrist gilt auch für Bezugs- und Zwischenzähler ohne Wohnung (scope common)', () => {
  const snap = snapshotOf({
    units: [room('a', 50)], tenancies: [lease('t-a', 'a')], costItems: [], payments: [], closedSettlements: [],
    meters: [{ ...gauge('zall', null, 'kaltwasser', 'common'), calibratedUntil: 2020 }, { ...gauge('zm', null, 'kaltwasser'), calibratedUntil: 2020 }],
    readings: [...used('zall', 100), ...used('zm', 100)],
  }, 2025)
  const overview = consumptionOverview(snap)
  for (const id of ['zall', 'zm']) {
    assert.ok(overview.find((r) => r.meterId === id)?.notices.some((n) => n.code === 'meter.calibration-overdue'), id)
  }
})

test('Allgemeinstrom ohne Zähler dahinter: kein „0 gemessen“ in der Verteilbasis', () => {
  const s = run({
    units: [room('a', 50), room('b', 50)], tenancies: [lease('t-a', 'a'), lease('t-b', 'b')],
    meters: [gauge('za', 'a', 'strom'), gauge('zall', null, 'strom', 'common')], readings: [...used('za', 1500), ...used('zall', 2000)],
  }, [{ id: 'as', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom', amountCents: 100000, key: 'meter', meterType: 'strom', meterRest: rest({ referenceMeterId: 'zall', behindMeterIds: [] }) }])
  const row = s.statements.find((st) => st.tenancyId === 't-a')?.rows[0] ?? assert.fail('keine Zeile')
  assert.doesNotMatch(row.basisText ?? '', /gemessen/)
  assert.equal(row.shareCents, 50000)
})

test('Zwischenzähler direkt an eine selbstgenutzte Wohnung: ein Mietverhältnis ohne Abrechnung dort zählt zur Eigennutzung', () => {
  // Wie die Direktzuordnung: e ist selbstgenutzt, ein dort eingetragenes Mietverhältnis hat keine Abrechnung.
  const p = pair(1100)
  const s = run({
    ...p, units: [...(p.units ?? []), room('e', 50, { participates: false, selfUsed: true })], tenancies: [...(p.tenancies ?? []), lease('t-e', 'e')],
    meters: [...(p.meters ?? []), gauge('ze', 'e', 'kaltwasser'), gauge('zgarten', null, 'kaltwasser', 'common')],
    readings: [...(p.readings ?? []), ...used('ze', 0), ...used('zgarten', 100)],
  }, [water(110000, rest({ subMeters: [{ meterId: 'zgarten', target: { key: 'direct', unitIds: ['e'] } }] }))])
  assert.equal(s.selfUsedShareCents, 10000)
  assert.equal(part(s, 'outsideUnit'), 0)
})

// ---------- Fix-Runde 2: Hinweise beim Eigenanteil wie bei #116 ----------

test("'selfUse' mit Bezugszähler der Einliegerwohnung: eine vermietete Wohnung mit eigenem Zähler, der nicht dahinter hängt, wird genannt, mit Rat zu den Teilnehmern", () => {
  const src: SnapshotSource = {
    units: [room('g', 60), room('e', 80, { participates: false, selfUsed: true }), room('h', 70)],
    tenancies: [lease('t-g', 'g'), lease('t-h', 'h')],
    meters: [gauge('zg', 'g', 'kaltwasser'), gauge('zh', 'h', 'kaltwasser'), gauge('zref', null, 'kaltwasser', 'common')],
    readings: [...used('zg', 200), ...used('zh', 300), ...used('zref', 1000)],
    costItems: [], payments: [], closedSettlements: [],
  }
  const s = settleSrc(src, water(100000, rest({ referenceMeterId: 'zref', behindMeterIds: ['zg'], key: 'selfUse' })))
  assert.equal(s.selfUsedShareCents, 0, 'im Zweifel abziehbar')
  const texts = s.notices.filter((n) => n.code === 'meter.unit-without-meter').map((n) => n.text)
  assert.ok(texts.some((t) => /h hat einen Zähler „Kaltwasser“, der nicht hinter dem Bezugszähler hängt/.test(t) && /nur bestimmte Wohnungen beteiligen/.test(t)), texts.join(' | '))
  assert.ok(texts.every((t) => !/für e und h gibt es keinen/.test(t)), texts.join(' | '))
  // Mit den Teilnehmern, die hinter dem Bezug hängen, ist der Rest Eigenanteil.
  const narrowed = settleSrc(src, water(100000, rest({ referenceMeterId: 'zref', behindMeterIds: ['zg'], key: 'selfUse' }), { participantUnitIds: ['g', 'e'] }))
  assert.equal(narrowed.selfUsedShareCents, 80000)
})

test("'selfUse': die Lücke im Zähler einer vermieteten Einheit außerhalb der Abrechnungseinheit wird genannt", () => {
  const gap: SnapshotReading[] = [{ meterId: 'zx', date: '2025-03-31', value: 0 }, { meterId: 'zx', date: '2025-12-31', value: 50 }]
  const src = withOwn(ownUnit, [lease('t-x', 'x')])
  const s = settleSrc({ ...src, units: [...src.units, room('x', 40, { participates: false })], meters: [...src.meters, gauge('zx', 'x', 'kaltwasser')], readings: [...src.readings, ...gap] },
    water(100000, rest({ key: 'selfUse' })))
  assert.equal(s.selfUsedShareCents, 0)
  assert.match(notice(s, 'meter.unit-partial')?.text ?? '', /x \(/)
})

test("'selfUse' mit Lücke und vermieteter Einheit ohne Zähler: beide Hinweise wie bei #116", () => {
  const gap: SnapshotReading[] = [{ meterId: 'zg', date: '2025-03-31', value: 0 }, { meterId: 'zg', date: '2025-12-31', value: 150 }]
  const src = withOwn(ownUnit, [lease('t-r', 'r')], gap)
  const s = settleSrc({ ...src, units: [...src.units, room('r', 40)] }, water(100000, rest({ key: 'selfUse' })))
  assert.ok(codes(s).includes('meter.unit-partial'))
  assert.match(notice(s, 'meter.unit-without-meter')?.text ?? '', /geht an den Vermieter/)
})

test("'selfUse' ohne gemeinsamen Tag der Eigennutzung: kein Eigenanteil und der Satz für den Vermieter", () => {
  const e1 = room('e1', 40, { participates: false, selfUsed: true, usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] })
  const e2 = room('e2', 40, { participates: false, selfUsed: false, usageChanges: [{ from: '2025-07-01', usage: 'eigen' }] })
  const src = withOwn(e1)
  const s = settleSrc({ ...src, units: [...src.units, e2] }, water(100000, rest({ key: 'selfUse' })))
  assert.equal(s.selfUsedShareCents, 0)
  const text = notice(s, 'meter.unit-without-meter')?.text ?? assert.fail(s.warnings.join(' | '))
  assert.match(text, /geht an den Vermieter/)
  assert.doesNotMatch(text, /für die Tage als Eigenanteil/)
})

// ---------- Abschlussdurchsicht (#98) ----------

// I1: Der Abzug beim Betriebsstrom ist ein Ausschnitt seiner Stromrechnung. Rechnet er ohne deren Angabe zum Bezugszähler,
// zahlen die Mieter den Abzug zu wenig ab (400/600 statt 320/480 €); das muss der Hinweis sagen.
test('Betriebsstrom: Abzug ohne die Angabe zum Bezugszähler seiner Stromrechnung ergibt heating.operating-power-key', () => {
  const general = rest({ referenceMeterId: 'as', behindMeterIds: [] })
  const g: SnapshotCostItem = { id: 'g', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom', amountCents: 100000, key: 'meter', meterType: 'strom', meterRest: general }
  const d: SnapshotCostItem = { id: 'd', period: calendarPeriod(2025), category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', amountCents: -20000, key: 'meter', meterType: 'strom', operatingPower: 'deduction', operatingPowerGeneralId: 'g' }
  const src: Partial<SnapshotSource> = {
    units: [room('a', 40), room('b', 60)], tenancies: [lease('t-a', 'a'), lease('t-b', 'b')],
    meters: [gauge('as', null, 'strom', 'common')], readings: used('as', 5000),
  }
  const without = run(src, [g, d])
  assert.ok(codes(without).includes('heating.operating-power-key'), without.warnings.join(' | '))
  const copied = run(src, [g, { ...d, meterRest: general }])
  assert.deepEqual([share(copied, 't-a'), share(copied, 't-b'), copied.landlord.totalCents], [32000, 48000, 0])
  assert.ok(!codes(copied).includes('heating.operating-power-key'))
})

// M3: Ein anderer Empfänger des Allgemeinverbrauchs ist ein anderer Schlüssel als im Vorjahr.
test('Schlüssel gegenüber dem Vorjahr: ein anderer Rest-Schlüssel ergibt key.changed-from-previous-year', () => {
  const before = water(110000, rest({ key: 'area' }), { id: 'alt', period: calendarPeriod(2024) })
  const changed = (now: MeterRest | null) => computeSettlement(snapshotOf({
    ...pair(1100), costItems: [before, water(110000, now)], payments: [], closedSettlements: [],
  } as SnapshotSource, 2025)).notices.filter((n) => n.code === 'key.changed-from-previous-year')
  assert.equal(changed(rest({ key: 'area' })).length, 0)
  const found = changed(rest({ key: 'meter' }))
  assert.equal(found.length, 1)
  assert.match(found[0]?.text ?? '', /Allgemeinverbrauch/)
  assert.equal(changed(null).length, 1)
})
