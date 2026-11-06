// Zimmer einer Wohnung (#573) in der Rechnung: wirksame Fläche, Name, die Wohnung zählt einmal.
// Gebaut wird unmittelbar ein Schnappschuss; die db.json kennt keine Zimmer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { calendarPeriod, calendarYearPeriod } from '../../shared/period.ts'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotMeter, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { servesUnit } from '../../shared/heatingPeriod.ts'
import type { MeterRestTarget } from '../../shared/types.ts'
import { dwellingsOf, roomView } from '../../shared/rooms.ts'
import { makeRng } from '../testing/taxStock.ts'
import { assertControlSums, assertLandlordParts } from '../testing/landlordParts.ts'
import { selfMeter, selfMeters, selfReading, selfReadings, selfSnapshot, selfTenancy, selfUnit } from '../testing/selfHeating.ts'
import { agreeableFor } from '../src/db/heatingInfo.ts'
import { tenancies as tenancyTable, units as unitTable } from '../src/db/schema.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => ({
  id: 'gs', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area', ...over,
})
const source = (over: Partial<SnapshotSource>): SnapshotSource => ({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const shareOf = (s: ComputedSettlement, tenancyId: string): number => s.statements.find((st) => st.tenancyId === tenancyId)?.totalShareCents ?? 0
const statementOf = (s: ComputedSettlement, tenancyId: string) => {
  const st = s.statements.find((x) => x.tenancyId === tenancyId)
  if (!st) assert.fail(`keine Abrechnung für ${tenancyId}`)
  return st
}

// Haus mit Wohnung A (60 m², vermietet) und einer WG von 80 m² mit drei Zimmern, ohne Anteil an Küche und Bad.
const wgHouse = (flatArea = 80, extra: Partial<SnapshotSource> = {}): SnapshotSource => source({
  units: [
    unit('a', { name: 'A', areaM2: 60 }),
    unit('wg', { name: 'WG', areaM2: flatArea, participates: false }),
    unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
    unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
    unit('z3', { name: 'Zimmer 3', areaM2: 16, parentUnitId: 'wg' }),
  ],
  tenancies: [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3')],
  costItems: [item()],
  ...extra,
})

test('Orakel Fläche: die übrigen Mieter tragen wie mit der WG als einer 80-m²-Wohnung, die Zimmer nach wirksamer Fläche', () => {
  const mitZimmern = computeSettlement(snapshotOf(wgHouse(), 2025))
  const ohne = computeSettlement(snapshotOf(source({
    units: [unit('a', { name: 'A', areaM2: 60 }), unit('wg', { name: 'WG', areaM2: 80 })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-wg', 'wg')],
    costItems: [item()],
  }), 2025))
  assert.equal(shareOf(ohne, 't-a'), 42857)
  assert.equal(shareOf(mitZimmern, 't-a'), shareOf(ohne, 't-a'))
  assert.deepEqual(['t-z1', 't-z2', 't-z3'].map((id) => shareOf(mitZimmern, id)), [17143, 17143, 22857])
  assert.equal(['t-z1', 't-z2', 't-z3'].reduce((a, id) => a + shareOf(mitZimmern, id), 0), shareOf(ohne, 't-wg'))
  assert.equal(mitZimmern.landlord.totalCents, 0)
})

test('Rechenweg und Name des Zimmers', () => {
  const s = computeSettlement(snapshotOf(wgHouse(), 2025))
  const st = statementOf(s, 't-z1')
  assert.equal(st.unitName, 'Zimmer 1 in der Wohnung WG')
  const text = (st.rows[0]?.steps ?? []).map((x) => `${x.label}: ${x.value}`).join('\n')
  assert.match(text, /12,00 m²|24,00 m²/)
  assert.match(text, /12,00 m²/)
  assert.match(text, /24,00 m²/)
  assert.match(text, /Anteil an 80/)
  assert.equal(s.notices.some((n) => n.code === 'unit.rooms-area'), false)
})

test('Hinweis unit.rooms-area: Wohnung mit Zimmern ohne Fläche, die Zimmerflächen gelten, wie sie stehen', () => {
  const s = computeSettlement(snapshotOf(wgHouse(0), 2025))
  const n = s.notices.find((x) => x.code === 'unit.rooms-area')
  if (!n) assert.fail('kein Hinweis unit.rooms-area')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /WG/)
  assert.doesNotMatch(n.text, /\u2014/)
  // A 60 von 100 m², die Zimmer 12/12/16 von 100 m².
  assert.deepEqual(['t-a', 't-z1', 't-z2', 't-z3'].map((id) => shareOf(s, id)), [60000, 12000, 12000, 16000])
})

test('Ohne parentUnitId (Zimmer als eigene Wohnungen, Umweg aus #573) rechnet alles wie bisher', () => {
  const src = source({
    units: [
      unit('a', { name: 'A', areaM2: 60 }),
      unit('z1', { name: 'WG, Zimmer 1', areaM2: 12 }),
      unit('z2', { name: 'WG, Zimmer 2', areaM2: 12 }),
      unit('z3', { name: 'WG, Zimmer 3', areaM2: 16 }),
    ],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3')],
    costItems: [item(), item({ id: 'pz', category: 'Gartenpflege', description: 'Garten', key: 'custom', customShares: { z1: 30, z2: 30, z3: 40 } })],
  })
  const snap = snapshotOf(src, 2025)
  assert.equal(snap.units, src.units)
  assert.equal('rooms' in snap, false)
  const s = computeSettlement(snap)
  assert.deepEqual(['t-a', 't-z1', 't-z2', 't-z3'].map((id) => shareOf(s, id)), [60000, 12000 + 30000, 12000 + 30000, 16000 + 40000])
  assert.equal(statementOf(s, 't-z1').unitName, 'WG, Zimmer 1')
})

// ---------- Wohnungszahl ----------

const zfh = (s: Snapshot): Snapshot => ({ ...s, property: { kind: 'zfh', cableBuiltBeforeDec2021: null } })
const heating = item({ id: 'hz', category: 'Heizung und Warmwasser', description: 'Heizung', amountCents: 50000 })

test('Wohnungszahl in der Rechnung: EG selbstgenutzt und WG mit zwei vermieteten Zimmern ist ein Zweifamilienhaus', () => {
  const s = computeSettlement(zfh(snapshotOf(source({
    units: [
      unit('eg', { name: 'EG', areaM2: 70, participates: false, selfUsed: true, selfPersons: 2 }),
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
      unit('z2', { name: 'Zimmer 2', areaM2: 16, parentUnitId: 'wg' }),
    ],
    tenancies: [tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2')],
    costItems: [heating],
  }), 2025)))
  assert.equal(s.notices.some((n) => n.code === 'property.kind-mismatch'), false)
})

test('Einliegerwohnung: eine WG mit Zimmern ist eine angelegte Wohnung', () => {
  const s = computeSettlement(snapshotOf(source({
    units: [
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
      unit('z2', { name: 'Zimmer 2', areaM2: 16, parentUnitId: 'wg' }),
    ],
    tenancies: [tenancy('t-z1', 'z1', { heatingModel: 'flatRate' }), tenancy('t-z2', 'z2', { heatingModel: 'flatRate' })],
    costItems: [heating],
  }), 2025))
  const n = s.notices.find((x) => x.code === 'heating.flat-rate')
  if (!n) assert.fail('kein Hinweis heating.flat-rate')
  assert.match(n.text, /legen Sie Ihre eigene Wohnung/)
})

async function agreeable(rows: { units: (typeof unitTable.$inferInsert)[]; tenancies: (typeof tenancyTable.$inferInsert)[] }): Promise<boolean> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zimmer-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      for (const u of rows.units) await db.insert(unitTable).values(u)
      for (const t of rows.tenancies) await db.insert(tenancyTable).values(t)
    })
    return await opened.read((db) => agreeableFor(db, 'objekt-1'))
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const row = (id: string, over: Partial<typeof unitTable.$inferInsert> = {}): typeof unitTable.$inferInsert => ({ propertyId: 'objekt-1', id, name: id, areaM2: 12, participates: true, ...over })
const lease = (id: string, unitId: string): typeof tenancyTable.$inferInsert => ({ id, unitId, tenantName: id, persons: 1, start: '2025-01-01' })

test('agreeableFor: dieselbe Regel, die WG zählt einmal', async () => {
  assert.equal(await agreeable({
    units: [row('eg', { areaM2: 70, participates: false, selfUsed: true }), row('wg', { areaM2: 80, participates: false }), row('z1', { parentUnitId: 'wg' }), row('z2', { parentUnitId: 'wg' })],
    tenancies: [lease('t1', 'z1'), lease('t2', 'z2')],
  }), true)
  assert.equal(await agreeable({
    units: [row('eg', { areaM2: 70 }), row('wg', { areaM2: 80, participates: false }), row('z1', { parentUnitId: 'wg', participates: false, selfUsed: true }), row('z2', { parentUnitId: 'wg' })],
    tenancies: [lease('t0', 'eg'), lease('t2', 'z2')],
  }), false)
})

// ---------- Leser außerhalb des Schnappschusses ----------

test('CO₂-Blatt: die versorgte Fläche zählt die WG einmal, wie ohne Zimmer', () => {
  const base = co2Source(2025, {})
  const withRooms = {
    ...base,
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: false, propertyId: 'objekt-1' },
      { id: 'z1', name: 'Zimmer 1', areaM2: 10, participates: true, propertyId: 'objekt-1', parentUnitId: 'b' },
      { id: 'z2', name: 'Zimmer 2', areaM2: 10, participates: true, propertyId: 'objekt-1', parentUnitId: 'b' },
    ],
    tenancies: base.tenancies.map((t) => (t.unitId === 'b' ? { ...t, unitId: 'z1' } : t)).concat([{ ...tenancy('tz2', 'z2'), start: '2020-01-01' }]),
  }
  const P = calendarYearPeriod(2025)
  const ohne = co2SheetFor(base, 'objekt-1', 'hp', P, '2026-10-07') ?? assert.fail('kein Blatt')
  const mit = co2SheetFor(withRooms, 'objekt-1', 'hp', P, '2026-10-07') ?? assert.fail('kein Blatt')
  assert.equal(ohne.areaM2, 100)
  assert.equal(mit.areaM2, ohne.areaM2)
})

// ---------- Zähler der Wohnung auf die Zimmer, Einheiten, Hinweise (Task 3) ----------

const used = (meterId: string, amount: number): SnapshotReading[] => [
  { meterId, date: '2024-12-31', value: 0 }, { meterId, date: '2025-12-31', value: amount },
]
const gauge = (id: string, unitId: string | null, type: SnapshotMeter['type'] = 'kaltwasser'): SnapshotMeter => ({ id, name: id, unitId, type })
const water = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => item({
  id: 'w', category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 60000, key: 'meter', meterType: 'kaltwasser', ...over,
})
// WG mit drei Zimmern 12/12/16 m², Wohnung 80 m² mit Kaltwasserzähler 100 m³; A mit eigenem Zähler 50 m³; Hauptzähler 150 m³.
const waterHouse = (over: Partial<SnapshotSource> = {}, items: SnapshotCostItem[] = [water()]): SnapshotSource => wgHouse(80, {
  meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg')],
  readings: [...used('zh', 150), ...used('za', 50), ...used('zw', 100)],
  costItems: items,
  ...over,
})
const settle = (src: SnapshotSource) => computeSettlement(snapshotOf(src, 2025))
const shares = (s: ComputedSettlement, ids: string[]) => ids.map((id) => shareOf(s, id))
const landlordPart = (s: ComputedSettlement, reason: string): number =>
  s.landlord.rows.reduce((a, r) => a + (r.landlordParts ?? []).filter((p) => p.reason === reason).reduce((b, p) => b + p.cents, 0), 0)
const codes = (s: ComputedSettlement) => s.notices.map((n) => n.code)
const ROOMS = ['t-z1', 't-z2', 't-z3']

test('Wohnungszähler nach Fläche (roomSplit fehlt): A 200 €, Zimmer 120/120/160 €, kein Rest des Hauptzählers', () => {
  const s = settle(waterHouse())
  assert.equal(shareOf(s, 't-a'), 20000)
  assert.deepEqual(shares(s, ROOMS), [12000, 12000, 16000])
  assert.equal(s.landlord.totalCents, 0)
  assert.equal(landlordPart(s, 'mainMeterRest'), 0)
  assert.ok(!codes(s).includes('meter.unit-without-meter'), codes(s).join())
  assert.ok(!codes(s).includes('meter.rest-mixed'))
  const text = (statementOf(s, 't-z1').rows[0]?.steps ?? []).map((x) => `${x.label}: ${x.value}`).join('\n')
  assert.match(text, /Zähler der Wohnung WG/)
})

test('Orakel Zähler: die Summe der Zimmer ist der Anteil der WG als Wohnung mit eigenem Zähler und einem Mieter', () => {
  const ohne = settle(source({
    units: [unit('a', { name: 'A', areaM2: 60 }), unit('wg', { name: 'WG', areaM2: 80 })],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-wg', 'wg')],
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg')],
    readings: [...used('zh', 150), ...used('za', 50), ...used('zw', 100)],
    costItems: [water()],
  }))
  const mit = settle(waterHouse())
  assert.equal(shareOf(mit, 't-a'), shareOf(ohne, 't-a'))
  assert.equal(ROOMS.reduce((a, id) => a + shareOf(mit, id), 0), shareOf(ohne, 't-wg'))
})

test('Wohnungszähler nach Personentagen: Zimmer 3 halbes Jahr leer, sein leerer Teil beim Vermieter, die anderen zahlen nicht mehr', () => {
  const persons = water({ roomSplit: 'persons' })
  const full = settle(waterHouse({}, [persons]))
  const half = settle(waterHouse({ tenancies: [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3', { end: '2025-06-30' })] }, [persons]))
  assert.equal(shareOf(half, 't-a'), 20000)
  assert.ok(shareOf(half, 't-z1') <= shareOf(full, 't-z1'), `${shareOf(half, 't-z1')} > ${shareOf(full, 't-z1')}`)
  assert.ok(shareOf(half, 't-z2') <= shareOf(full, 't-z2'))
  assert.ok(Math.abs(shareOf(half, 't-z1') - 13333) <= 1)
  // 400 € × 181 / 1095 Personentagen
  assert.ok(Math.abs(shareOf(half, 't-z3') - 6612) <= 1, String(shareOf(half, 't-z3')))
  const landlord = half.landlord.totalCents
  assert.ok(Math.abs(landlord - (40000 - 13333 * 2 - 6612)) <= 2, String(landlord))
  assert.equal(landlordPart(half, 'outsideUnit'), landlord)
  assert.equal(half.selfUsedShareCents, 0)
})

test('Zimmer nicht in den Teilnehmern: sein Teil beim Vermieter, Hinweis rooms.outside-basis mit Betrag', () => {
  const s = settle(waterHouse({}, [water({ participantUnitIds: ['a', 'z1', 'z3'] })]))
  assert.equal(shareOf(s, 't-a'), 20000)
  assert.deepEqual(shares(s, ['t-z1', 't-z2', 't-z3']), [12000, 0, 16000])
  assert.equal(landlordPart(s, 'outsideUnit'), 12000)
  const n = s.notices.find((x) => x.code === 'rooms.outside-basis') ?? assert.fail(`kein Hinweis: ${codes(s).join()}`)
  assert.equal(n.level, 'warning')
  assert.match(n.text, /120,00 €/)
  assert.match(n.text, /Zimmer 2 in der Wohnung WG/)
  assert.doesNotMatch(n.text, /\u2014/)
})

test('Selbstgenutztes Zimmer: sein Teil des Wohnungszählers ist Eigenanteil', () => {
  const s = settle(waterHouse({
    units: [
      unit('a', { name: 'A', areaM2: 60 }),
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg', participates: false, selfUsed: true, selfPersons: 1 }),
      unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
      unit('z3', { name: 'Zimmer 3', areaM2: 16, parentUnitId: 'wg' }),
    ],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3')],
  }))
  assert.deepEqual(shares(s, ['t-a', 't-z2', 't-z3']), [20000, 12000, 16000])
  assert.equal(s.selfUsedShareCents, 12000)
  assert.equal(s.landlord.totalCents, 12000)
})

test('Zimmer mit eigenem Kaltwasserzähler: gemischte WG, meter.rest-mixed, Position nicht verteilt', () => {
  const s = settle(waterHouse({
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg'), gauge('z1m', 'z1')],
    readings: [...used('zh', 150), ...used('za', 50), ...used('zw', 100), ...used('z1m', 10)],
  }))
  const n = s.notices.find((x) => x.code === 'meter.rest-mixed') ?? assert.fail(`kein Fehler: ${codes(s).join()}`)
  assert.equal(n.level, 'error')
  assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [0, 0, 0, 0])
  assert.equal(s.landlord.totalCents, 60000)
})

test('Bezugszähler (#98) mit Wohnungszähler dahinter: gleiche Beträge wie ohne', () => {
  const s = settle(waterHouse({}, [water({ meterRest: { referenceMeterId: null, behindMeterIds: ['za', 'zw'], key: 'area', unitIds: null, subMeters: [] } })]))
  assert.equal(shareOf(s, 't-a'), 20000)
  assert.deepEqual(shares(s, ROOMS), [12000, 12000, 16000])
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!codes(s).includes('meter.rest-mixed'), codes(s).join())
})

test('Bezugszähler mit Rest nach Verbrauch: die Zimmer bekommen den Rest im Verhältnis ihrer Teile', () => {
  const s = settle(waterHouse({ readings: [...used('zh', 180), ...used('za', 50), ...used('zw', 100)] },
    [water({ meterRest: { referenceMeterId: null, behindMeterIds: ['za', 'zw'], key: 'meter', unitIds: null, subMeters: [] } })]))
  assert.equal(shareOf(s, 't-a'), 20000)
  assert.deepEqual(shares(s, ROOMS), [12000, 12000, 16000])
})

const muell = (over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => item({ id: 'm', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'units', ...over })

test('Einheiten-Schlüssel: die WG ist eine Einheit, die Zimmer nach eingetragener Fläche', () => {
  for (const over of [{}, { participantUnitIds: ['a', 'z1', 'z2', 'z3'] }]) {
    const s = settle(wgHouse(80, { costItems: [muell(over)] }))
    assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [15000, 4500, 4500, 6000], JSON.stringify(over))
    assert.equal(s.landlord.totalCents, 0)
  }
  const s = settle(wgHouse(80, { costItems: [muell()] }))
  const text = (statementOf(s, 't-z1').rows[0]?.steps ?? []).map((x) => `${x.label}: ${x.value}`).join('\n')
  assert.match(text, /1 von 2 Einheiten, davon 30 % für dieses Zimmer/)
})

test('Einheiten-Schlüssel: ein leeres Zimmer trägt sein Gewicht beim Vermieter, eines außerhalb der Teilnehmer mit Hinweis', () => {
  const leer = settle(wgHouse(80, { tenancies: [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2')], costItems: [muell()] }))
  assert.deepEqual(shares(leer, ['t-a', 't-z1', 't-z2']), [15000, 4500, 4500])
  assert.equal(leer.landlord.totalCents, 6000)
  const aussen = settle(wgHouse(80, { costItems: [muell({ participantUnitIds: ['a', 'z1', 'z3'] })] }))
  assert.deepEqual(shares(aussen, ['t-a', ...ROOMS]), [15000, 4500, 0, 6000])
  assert.equal(landlordPart(aussen, 'outsideUnit'), 4500)
  const n = aussen.notices.find((x) => x.code === 'rooms.outside-basis') ?? assert.fail('kein Hinweis')
  assert.match(n.text, /45,00 €/)
})

test('Einheiten-Schlüssel mit Nutzungswechsel (Abschnitte): ein ausgenommenes Zimmer belastet die übrigen Zimmer nicht', () => {
  const house = (z3: Partial<SnapshotUnit>, leases: SnapshotTenancy[]) => settle(source({
    units: [
      unit('a', { name: 'A', areaM2: 60, usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] }),
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
      unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
      unit('z3', { name: 'Zimmer 3', areaM2: 16, parentUnitId: 'wg', ...z3 }),
    ],
    tenancies: [tenancy('t-a', 'a', { end: '2025-06-30' }), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2'), ...leases],
    costItems: [muell()],
  }))
  const vermietet = house({}, [tenancy('t-z3', 'z3')])
  const ausgenommen = house({ participates: false }, [])
  assert.equal(shareOf(ausgenommen, 't-z1'), shareOf(vermietet, 't-z1'))
  assert.equal(shareOf(ausgenommen, 't-a'), shareOf(vermietet, 't-a'))
  assert.equal(landlordPart(ausgenommen, 'outsideUnit') - landlordPart(vermietet, 'outsideUnit'), shareOf(vermietet, 't-z3'))
  assert.ok(ausgenommen.notices.some((n) => n.code === 'rooms.outside-basis'))
})

// Laut Gemeinschaftsabrechnung (#573, Gesamtdurchsicht C1): Die Wohnung zählt im Maßstab der Gemeinschaft genau einmal,
// ihre MEA geht nach dem Verhältnis der Zimmerflächen auf die Zimmer, bei „Wohneinheiten“ trägt sie eine Einheit.
const gemeinschaft = (measure: 'mea' | 'units' | 'area', over: Partial<SnapshotCostItem> = {}): SnapshotCostItem => item({
  id: 'hg', category: 'Hausmeister', description: 'Hausmeister', amountCents: 14000, key: 'external',
  externalBasis: { measure, total: measure === 'mea' ? 1000 : measure === 'units' ? 20 : 2000, totalCents: measure === 'mea' ? 100000 : measure === 'units' ? 140000 : 200000 },
  ...over,
})
const etw = (src: SnapshotSource) => computeSettlement({ ...snapshotOf(src, 2025), property: { kind: 'etw', cableBuiltBeforeDec2021: null } })

test('Orakel Gemeinschaft (MEA, Wohneinheiten, Fläche): A trägt wie mit der WG als einer Wohnung, die Zimmer zusammen den Anteil der WG', () => {
  for (const measure of ['mea', 'units', 'area'] as const) {
    const withMea = (src: SnapshotSource): SnapshotSource => ({ ...src, units: src.units.map((u) => (u.id === 'a' ? { ...u, mea: 60 } : u.id === 'wg' ? { ...u, mea: 80 } : u)) })
    const mitZimmern = etw(withMea(wgHouse(80, { costItems: [gemeinschaft(measure)] })))
    const ohne = etw(withMea(source({
      units: [unit('a', { name: 'A', areaM2: 60 }), unit('wg', { name: 'WG', areaM2: 80 })],
      tenancies: [tenancy('t-a', 'a'), tenancy('t-wg', 'wg')],
      costItems: [gemeinschaft(measure)],
    })))
    assert.equal(shareOf(mitZimmern, 't-a'), shareOf(ohne, 't-a'), measure)
    assert.equal(ROOMS.reduce((a, id) => a + shareOf(mitZimmern, id), 0), shareOf(ohne, 't-wg'), measure)
    assert.equal(mitZimmern.landlord.totalCents, 0, measure)
    assert.deepEqual(mitZimmern.notices.filter((n) => n.code.startsWith('external.')).map((n) => n.code), [], measure)
    if (measure === 'mea') assert.deepEqual(shares(mitZimmern, ['t-a', ...ROOMS]), [6000, 2400, 2400, 3200])
    if (measure === 'units') assert.deepEqual(shares(mitZimmern, ['t-a', ...ROOMS]), [7000, 2100, 2100, 2800])
  }
})

test('Gemeinschaft nach Wohneinheiten: ein Zimmer außerhalb der Teilnehmer trägt sein Gewicht beim Vermieter, nie die übrigen Zimmer', () => {
  const s = etw(wgHouse(80, { costItems: [gemeinschaft('units', { participantUnitIds: ['a', 'z1', 'z3'] })] }))
  assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [7000, 2100, 0, 2800])
  assert.equal(landlordPart(s, 'outsideUnit'), 2100)
  assert.ok(s.notices.some((n) => n.code === 'rooms.outside-basis'))
  assert.ok(!s.notices.some((n) => n.code === 'external.amount-mismatch'))
})

test('Gemeinschaft: ein Zimmer mit 0 m² neben Zimmern mit Fläche bekommt einen passenden Hinweis, nicht external.value-missing', () => {
  for (const measure of ['mea', 'units', 'area'] as const) {
    const src = wgHouse(80, { costItems: [gemeinschaft(measure)] })
    const s = etw({ ...src, units: src.units.map((u) => (u.id === 'a' ? { ...u, mea: 60 } : u.id === 'wg' ? { ...u, mea: 80 } : u.id === 'z2' ? { ...u, areaM2: 0 } : u)) })
    assert.ok(!s.notices.some((n) => n.code === 'external.value-missing'), measure)
    const n = s.notices.find((x) => x.code === 'rooms.zero-area') ?? assert.fail(`kein Hinweis rooms.zero-area (${measure})`)
    assert.match(n.text, /Zimmer 2 in der Wohnung WG/)
    assert.match(n.text, /übrigen Zimmer/)
    assert.doesNotMatch(n.text, /keine Miteigentumsanteile|keine Wohnfläche hinterlegt/)
    // Der Anteil der WG bleibt bei ihren Zimmern: A trägt wie ohne Zimmer.
    assert.equal(shareOf(s, 't-z2'), 0, measure)
    assert.equal(shareOf(s, 't-a'), measure === 'units' ? 7000 : 6000, measure)
  }
})

test('rooms.outside-basis: ein nur zeitweise ausgenommenes Zimmer bekommt keinen Rat zu den Teilnehmern (Gesamtdurchsicht M1)', () => {
  const s = settle(source({
    units: [
      unit('a', { name: 'A', areaM2: 60 }),
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
      unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
      unit('z3', { name: 'Zimmer 3', areaM2: 16, parentUnitId: 'wg', usageChanges: [{ from: '2025-07-01', usage: 'ausgenommen' }] }),
    ],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3', { end: '2025-06-30' })],
    costItems: [muell()],
  }))
  const n = s.notices.find((x) => x.code === 'rooms.outside-basis') ?? assert.fail('kein Hinweis')
  assert.doesNotMatch(n.text, /Teilnehmer/)
  assert.match(n.text, /zeitweise/)
  assert.match(n.text, /Nutzung/)
  const teilnehmer = settle(wgHouse(80, { costItems: [muell({ participantUnitIds: ['a', 'z1', 'z3'] })] }))
  const m = teilnehmer.notices.find((x) => x.code === 'rooms.outside-basis') ?? assert.fail('kein Hinweis')
  assert.match(m.text, /nehmen Sie das Zimmer in die Teilnehmer der Position auf/)
})

test('rooms.household-cost: Internet nur für die Zimmer der WG und Stromzähler der Wohnung, nicht Wasser', () => {
  const internet = item({ id: 'i', category: 'Sonstige Betriebskosten', description: 'Internet', amountCents: 36000, key: 'area', participantUnitIds: ['z1', 'z2', 'z3'] })
  const s1 = settle(wgHouse(80, { costItems: [internet] }))
  const n = s1.notices.find((x) => x.code === 'rooms.household-cost') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /Kosten nur dieser Wohnung, etwa Strom oder Internet der WG, sind keine Betriebskosten, auch nicht mit einer Vereinbarung im Mietvertrag\. Verlangen können Sie sie nur aus einer gesonderten Abrede, etwa als Pauschale\. In der Betriebskostenabrechnung kann der Mieter sie zurückweisen\./)
  const strom = item({ id: 's', category: 'Strom', description: 'Strom', amountCents: 20000, key: 'meter', meterType: 'strom' })
  const s2 = settle(wgHouse(80, { meters: [gauge('sa', 'a', 'strom'), gauge('sw', 'wg', 'strom')], readings: [...used('sa', 1000), ...used('sw', 3000)], costItems: [strom] }))
  assert.ok(codes(s2).includes('rooms.household-cost'), codes(s2).join())
  const s3 = settle(waterHouse({}, [water({ participantUnitIds: ['z1', 'z2', 'z3'] })]))
  assert.ok(!codes(s3).includes('rooms.household-cost'))
  const s4 = settle(waterHouse())
  assert.ok(!codes(s4).includes('rooms.household-cost'))
})

// ---------- Anlage mit Liste, gemeinsame Regel der Wohnung (Rulings aus der Durchsicht von Task 2) ----------

test('servesUnit: nennt die Liste der Anlage die Wohnung, versorgt sie ihre Zimmer', () => {
  const plant = { units: [{ unitId: 'wg' }] }
  assert.equal(servesUnit(plant, { id: 'z1', parentUnitId: 'wg' }), true)
  assert.equal(servesUnit(plant, { id: 'z1', parentUnitId: 'andere' }), false)
  assert.equal(servesUnit(plant, { id: 'x' }), false)
})

test('roomView und dwellingsOf: dieselbe Regel für die Wohnung, auch bei krummem Bestand (Wiederherstellen)', () => {
  // p verweist auf eine Einheit, die es nicht gibt, x auf p: Für die Sicht ist p kein Zimmer und deshalb auch x keines.
  const units = [unit('p', { areaM2: 40, parentUnitId: 'weg' }), unit('x', { areaM2: 12, parentUnitId: 'p' })]
  assert.equal(roomView(units).roomsOf.size, 0)
  assert.deepEqual(dwellingsOf(units, () => true).map((d) => d.members.map((m) => m.id)), [['p'], ['x']])
  // Zwei Ebenen: c liegt in einem Zimmer und ist selbst keines.
  const chain = [unit('a', { areaM2: 80, participates: false }), unit('b', { areaM2: 12, parentUnitId: 'a' }), unit('c', { areaM2: 12, parentUnitId: 'b' })]
  assert.deepEqual([...roomView(chain).roomsOf.keys()], ['a'])
  assert.deepEqual(dwellingsOf(chain, () => true).map((d) => d.members.map((m) => m.id)), [['c'], ['b']])
})

test('Rechenweg der Heizung: Grundkosten nach Fläche nennen die Fläche des Zimmers', () => {
  const s = computeSettlement(selfSnapshot({
    units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 90, { participates: false }), selfUnit('r1', 20, { parentUnitId: 'c' }), selfUnit('r2', 40, { parentUnitId: 'c' })],
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('R1', 'r1', '2020-01-01', null), selfTenancy('R2', 'r2', '2020-01-01', null)],
    meters: selfMeters().map((m) => (m.unitId === 'c' ? { ...m, unitId: 'r1' } : m)).concat([selfMeter('wz-r2', 'r2', 'Wärme R2', 'waerme'), selfMeter('xw-r2', 'r2', 'Warmwasser R2', 'warmwasser')]),
    readings: selfReadings().filter((r) => r.date !== '2025-09-30').concat([selfReading('wz-r2', '2024-12-31', 0), selfReading('wz-r2', '2025-12-31', 3000), selfReading('xw-r2', '2024-12-31', 0), selfReading('xw-r2', '2025-12-31', 5)]),
  }))
  const st = statementOf(s, 'R1')
  const steps = (st.rows.find((r) => r.costItemId === 'wz')?.steps ?? assert.fail('keine Zeile wz')).map((x) => `${x.label}: ${x.value}`).join('\n')
  assert.match(steps, /Grundkosten Heizung: 30 von 230 m²/)
  assert.match(steps, /Fläche des Zimmers: 30,00 m² wirksam: 20,00 m² eingetragen, Anteil an 90,00 m² der Wohnung C/)
})

// ---------- Invariante über zufällige Bestände mit Zimmern ----------

test('Invariante: Bestände mit Zimmern - Summe, Vorzeichen, Eigenanteil im Vermieteranteil', () => {
  let items = 0
  let split = 0
  // Abgedeckt: Rest am Bezugszähler mit Warmwasser im Zimmer und Rest nach Verbrauch, mit Zwischenzähler, als Eigenanteil.
  const covered = { warmRest: 0, sub: 0, self: 0 }
  for (let i = 0; i < 1500; i++) {
    const r = makeRng(573_000 + i * 7919)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
    const units: SnapshotUnit[] = []
    const tenancies: SnapshotTenancy[] = []
    const meters: SnapshotMeter[] = []
    const readings: SnapshotReading[] = []
    // Ein Teil der Bestände ganz und ganzjährig vermietet: Ohne Leerstand und Eigennutzung fällt auf, wenn mehr als die
    // Rechnung an die Mieter geht (der Vermieter trüge dann gegen das Vorzeichen der Position).
    const full = r() < 0.25
    const usageOf = () => (full ? 'vermietet' : pick(['vermietet', 'vermietet', 'vermietet', 'eigen', 'ausgenommen'] as const))
    const addUnit = (id: string, over: Partial<SnapshotUnit>) => {
      const usage = usageOf()
      units.push(unit(id, { name: id, areaM2: r() < 0.15 ? 0 : Math.round(r() * 30), participates: usage === 'vermietet', selfUsed: usage === 'eigen', selfPersons: usage === 'eigen' ? Math.floor(r() * 3) : undefined, ...over }))
      if (usage === 'vermietet' && (full || r() < 0.8)) {
        const start = !full && r() < 0.3 ? `2025-0${1 + Math.floor(r() * 9)}-01` : '2024-01-01'
        const end = !full && r() < 0.3 ? `2025-${String(10 + Math.floor(r() * 3))}-15` : null
        const persons = Math.floor(r() * 3)
        tenancies.push(tenancy(`t-${id}`, id, { start, end, persons, personHistory: [{ from: start, persons }], ...(r() < 0.1 ? { costModel: 'flatRate' as const } : {}) }))
      }
    }
    const reading = (id: string, unitId: string | null, type: SnapshotMeter['type'], value: number) => {
      meters.push(gauge(id, unitId, type))
      readings.push({ meterId: id, date: r() < 0.9 ? '2024-12-31' : '2025-05-31', value: 0 }, { meterId: id, date: '2025-12-31', value })
    }
    for (let k = 0; k < Math.floor(r() * 3); k++) {
      addUnit(`u${k}`, {})
      if (r() < 0.6) reading(`m-u${k}`, `u${k}`, pick(['kaltwasser', 'strom'] as const), Math.round(r() * 100))
    }
    units.push(unit('wg', { name: 'WG', areaM2: r() < 0.2 ? 0 : 40 + Math.round(r() * 60), participates: false }))
    const roomIds = Array.from({ length: 2 + Math.floor(r() * 3) }, (_, k) => `z${k}`)
    for (const id of roomIds) {
      addUnit(id, { parentUnitId: 'wg' })
      if (r() < 0.1) reading(`m-${id}`, id, 'kaltwasser', Math.round(r() * 30))
      // Ein Warmwasserzähler im Zimmer misst eine eigene Leitung neben dem Kaltwasser der Wohnung.
      if (r() < 0.5) reading(`w-${id}`, id, 'warmwasser', Math.round(r() * 30))
    }
    if (r() < 0.85) reading('m-wg', 'wg', 'kaltwasser', Math.round(r() * 200))
    if (r() < 0.5) reading('m-wgs', 'wg', 'strom', Math.round(r() * 2000))
    if (r() < 0.6) reading('m-main', null, 'kaltwasser', 100 + Math.round(r() * 400))
    // Ein Zähler für einen Teil des Hauses (Garten) als Zwischenzähler.
    const garden = r() < 0.4
    if (garden) {
      reading('m-garden', null, 'kaltwasser', Math.round(r() * 40))
      const g = meters[meters.length - 1] ?? assert.fail('kein Gartenzähler')
      g.scope = 'common'
    }
    const ids = units.filter((u) => u.id !== 'wg').map((u) => u.id)
    const unitMeters = meters.filter((m) => m.unitId !== null && (m.type === 'kaltwasser' || m.type === 'warmwasser')).map((m) => m.id)
    const key = pick(['area', 'persons', 'units', 'meter', 'meter', 'meter'] as const)
    const amount = 1 + Math.floor(r() * 200000)
    const drawn: SnapshotCostItem = item({
      id: 'c', category: pick(['Wasser/Abwasser', 'Müllabfuhr', 'Sonstige Betriebskosten'] as const), description: 'P', key,
      amountCents: r() < 0.15 ? -amount : amount,
      ...(key === 'meter' ? { meterType: pick(['kaltwasser', 'kaltwasser', 'strom'] as const), ...(r() < 0.5 ? { roomSplit: 'persons' as const } : {}) } : {}),
      ...(r() < 0.3 ? { participantUnitIds: ids.filter(() => r() < 0.7) } : {}),
    })
    const withRest = key === 'meter' && drawn.meterType === 'kaltwasser' && r() < 0.5
    const subTarget = (): MeterRestTarget => pick([
      'landlord', 'selfUse', 'excluded', { key: 'area', unitIds: ids.filter(() => r() < 0.6) }, { key: 'direct', unitIds: [pick(ids)] },
    ] as const)
    const one: SnapshotCostItem = withRest
      ? {
        ...drawn,
        meterRest: {
          referenceMeterId: null, behindMeterIds: r() < 0.5 ? null : unitMeters,
          key: pick(['area', 'persons', 'units', 'meter', 'meter', 'landlord', 'selfUse', 'standard', 'standard'] as const), unitIds: null,
          subMeters: garden ? [{ meterId: 'm-garden', target: subTarget() }] : [],
        },
      }
      : drawn
    const context = `Fall ${i}\n${JSON.stringify({ units, tenancies, meters, readings, one })}`
    const s = settle(source({ units, tenancies, meters, readings, costItems: [one] }))
    items++
    const tenants = s.statements.flatMap((st) => st.rows.filter((x) => x.costItemId === 'c'))
    const landlord = s.landlord.rows.filter((x) => x.costItemId === 'c').reduce((a, x) => a + x.shareCents, 0)
    assert.equal(tenants.reduce((a, x) => a + x.shareCents, 0) + landlord, one.amountCents, `Summe: ${context}`)
    for (const x of tenants) assert.ok(x.shareCents === 0 || Math.sign(x.shareCents) === Math.sign(one.amountCents), `Vorzeichen ${x.shareCents}: ${context}`)
    // Auch der Vermieter trägt nie gegen das Vorzeichen der Position: Sonst gingen an die Mieter mehr als 100 % hinaus.
    assert.ok(landlord === 0 || Math.sign(landlord) === Math.sign(one.amountCents), `Vorzeichen Vermieter ${landlord}: ${context}`)
    const self = s.selfUsedShareCents
    assert.ok(self === 0 || Math.sign(self) === Math.sign(landlord), `Eigenanteil ${self}, Vermieter ${landlord}: ${context}`)
    assert.ok(Math.abs(self) <= Math.abs(landlord), `Eigenanteil ${self} > Vermieter ${landlord}: ${context}`)
    assertLandlordParts(s, tenancies.length, context)
    assertControlSums(s, context)
    if (key === 'meter' && meters.some((m) => m.unitId === 'wg' && m.type === one.meterType) && tenants.some((x) => x.shareCents !== 0)) split++
    const restKey = one.meterRest?.key
    const distributed = !s.notices.some((n) => n.level === 'error')
    if (distributed && (restKey === 'meter' || restKey === 'standard') && meters.some((m) => m.type === 'warmwasser') && tenants.some((x) => x.shareCents !== 0)) covered.warmRest++
    if (distributed && (one.meterRest?.subMeters.length ?? 0) > 0) covered.sub++
    if (distributed && (restKey === 'selfUse' || restKey === 'standard') && self !== 0) covered.self++
  }
  assert.ok(items === 1500 && split >= 200, `zu wenige Fälle mit Wohnungszähler: ${split}`)
  assert.ok(covered.warmRest >= 20 && covered.sub >= 20 && covered.self >= 10, `zu wenige Fälle mit Bezugszähler: ${JSON.stringify(covered)}`)
})

// ---------- Nachbesserung Task 3 (Durchsicht) ----------

test('Wohnungszähler nach Personentagen ohne Personen: Hinweis item.no-basis mit Betrag, Teil sichtbar beim Vermieter', () => {
  const zero = (id: string, unitId: string) => tenancy(id, unitId, { persons: 0, personHistory: [{ from: '2025-01-01', persons: 0 }] })
  const leases = [tenancy('t-a', 'a'), zero('t-z1', 'z1'), zero('t-z2', 'z2'), zero('t-z3', 'z3')]
  for (const meterRest of [undefined, { referenceMeterId: null, behindMeterIds: ['za', 'zw'], key: 'area' as const, unitIds: null, subMeters: [] }]) {
    const s = settle(waterHouse({ tenancies: leases }, [water({ roomSplit: 'persons', ...(meterRest ? { meterRest } : {}) })]))
    assert.equal(shareOf(s, 't-a'), 20000)
    assert.deepEqual(shares(s, ROOMS), [0, 0, 0])
    assert.equal(s.landlord.totalCents, 40000)
    const n = s.notices.find((x) => x.code === 'item.no-basis') ?? assert.fail(`kein Hinweis: ${codes(s).join()}`)
    assert.match(n.text, /keine Personen/)
    assert.match(n.text, /400,00 €/)
  }
})

test('Wohnungszähler nach Fläche mit überschneidenden Mietverhältnissen in einem Zimmer (#204): kein negativer Teil, Summen stimmen', () => {
  const rest = { referenceMeterId: null, behindMeterIds: ['za', 'zw'], key: 'area' as const, unitIds: null, subMeters: [] }
  const overlap = [tenancy('t-a', 'a'), tenancy('t-z1', 'z1'), tenancy('t-z1b', 'z1', { start: '2025-07-01' }), tenancy('t-z2', 'z2')]
  for (const meterRest of [undefined, rest]) {
    for (const z3 of [tenancy('t-z3', 'z3'), tenancy('t-z3', 'z3', { end: '2025-06-30' })]) {
      const leases = [...overlap, z3]
      const s = settle(waterHouse({ tenancies: leases }, [water(meterRest ? { meterRest } : {})]))
      const context = `${meterRest ? 'Bezug' : 'ohne'} ${z3.end ?? 'ganzjährig'} ${JSON.stringify(s.landlord.rows)}`
      assertLandlordParts(s, leases.length, context)
      assertControlSums(s, context)
      // Gerechnet wie erfasst (#204), wie bei jeder Wohnung nach Fläche oder Verbrauch: Beide Mietverhältnisse von
      // Zimmer 1 tragen ihren Teil, Hinweis tenancy.overlap, und der Mehrbetrag steht als negativer Leerstand beim
      // Vermieter. Kein anderer Grund wird negativ, auch nicht der Teil außerhalb.
      for (const r of s.landlord.rows) for (const p of r.landlordParts ?? []) if (p.reason !== 'vacancy') assert.ok(p.cents >= 0, `${p.reason} ${p.cents}: ${context}`)
      assert.equal(shareOf(s, 't-z1'), 12000, context)
      assert.ok(s.notices.some((n) => n.code === 'tenancy.overlap'), context)
      // Der Vermieter trägt den leeren Teil von Zimmer 3 (160 € × 184 / 365) abzüglich des Mehrbetrags von Zimmer 1, wie
      // die eine Verteilung (#202) jeden Mehrbetrag aus #204 mit dem Rest des Vermieters verrechnet.
      const empty = z3.end ? Math.round(16000 * 184 / 365) : 0
      assert.ok(Math.abs(s.landlord.totalCents - (empty - shareOf(s, 't-z1b'))) <= 1, `${s.landlord.totalCents}: ${context}`)
    }
  }
})

test('rooms.household-cost: nicht bei Entwässerung (Niederschlagswasser)', () => {
  const regen = item({ id: 'n', category: 'Niederschlagswasser', description: 'Niederschlagswasser', amountCents: 12000, key: 'area', participantUnitIds: ['z1', 'z2', 'z3'] })
  const s = settle(wgHouse(80, { costItems: [regen] }))
  assert.ok(!codes(s).includes('rooms.household-cost'), codes(s).join())
})

// ---------- Nachtrag zu #573: Warmwasserzähler im Zimmer, beheizte Fläche der Wohnung ----------

test('Zimmer mit eigenem Warmwasserzähler neben dem Kaltwasserzähler der Wohnung: nicht gemischt, Zimmer zahlt Teil der Wohnung plus eigenes Warmwasser', () => {
  // Kaltwasser- und Warmwasserzähler messen getrennte Leitungen (wie bei jeder Wohnung mit beiden Zählern, `measures`):
  // 50 m³ A, 100 m³ kalt in der WG, 10 m³ warm in Zimmer 1, zusammen 160 m³ für 600 €.
  const s = settle(waterHouse({
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg'), gauge('z1w', 'z1', 'warmwasser')],
    readings: [...used('zh', 160), ...used('za', 50), ...used('zw', 100), ...used('z1w', 10)],
  }))
  assert.ok(!codes(s).includes('meter.rest-mixed'), codes(s).join())
  // A 50/160, die WG 100/160 = 375 € nach Fläche 112,50/112,50/150, Zimmer 1 dazu 10/160 = 37,50 €.
  assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [18750, 15000, 11250, 15000])
  assert.equal(s.landlord.totalCents, 0)
  assert.ok(!codes(s).includes('meter.unit-without-meter'), codes(s).join())
})

test('Warmwasserzähler im Zimmer, Verteilung über den Bezugszähler (#98): ebenso nicht gemischt', () => {
  const s = settle(waterHouse({
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg'), gauge('z1w', 'z1', 'warmwasser')],
    readings: [...used('zh', 160), ...used('za', 50), ...used('zw', 100), ...used('z1w', 10)],
  }, [water({ meterRest: { referenceMeterId: null, behindMeterIds: ['za', 'zw', 'z1w'], key: 'area', unitIds: null, subMeters: [] } })]))
  assert.ok(!codes(s).includes('meter.rest-mixed'), codes(s).join())
  assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [18750, 15000, 11250, 15000])
  assert.equal(s.landlord.totalCents, 0)
})

test('Beheizte Fläche in der Liste der Anlage nur für die Wohnung: geht nach dem Verhältnis der Zimmerflächen auf die Zimmer', () => {
  const s = computeSettlement(selfSnapshot({
    units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 90, { participates: false }), selfUnit('r1', 20, { parentUnitId: 'c' }), selfUnit('r2', 40, { parentUnitId: 'c' })],
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('R1', 'r1', '2020-01-01', null), selfTenancy('R2', 'r2', '2020-01-01', null)],
    meters: selfMeters().map((m) => (m.unitId === 'c' ? { ...m, unitId: 'r1' } : m)).concat([selfMeter('wz-r2', 'r2', 'Wärme R2', 'waerme'), selfMeter('xw-r2', 'r2', 'Warmwasser R2', 'warmwasser')]),
    readings: selfReadings().filter((r) => r.date !== '2025-09-30').concat([selfReading('wz-r2', '2024-12-31', 0), selfReading('wz-r2', '2025-12-31', 3000), selfReading('xw-r2', '2024-12-31', 0), selfReading('xw-r2', '2025-12-31', 5)]),
    plant: { areaBasisHeat: 'heatedArea', units: [{ unitId: 'a', heatedAreaM2: 50, volumeM3: null }, { unitId: 'b', heatedAreaM2: 70, volumeM3: null }, { unitId: 'c', heatedAreaM2: 75, volumeM3: null }] },
  }))
  assert.ok(!s.notices.some((n) => n.level === 'error'), s.notices.filter((n) => n.level === 'error').map((n) => n.text).join('\n'))
  const steps = (id: string) => (statementOf(s, id).rows.find((r) => r.costItemId === 'wz')?.steps ?? assert.fail(`keine Zeile wz bei ${id}`)).map((x) => `${x.label}: ${x.value}`).join('\n')
  // 75 m² der Wohnung C nach 20 : 40 eingetragener Zimmerfläche: 25 und 50 m², zusammen 195 m².
  assert.match(steps('R1'), /Grundkosten Heizung: 25 von 195 m²/)
  assert.match(steps('R2'), /Grundkosten Heizung: 50 von 195 m²/)
  assert.match(steps('A'), /Grundkosten Heizung: 50 von 195 m²/)
})

test('Umbauter Raum nur für die Wohnung: ebenso nach dem Verhältnis der Zimmerflächen, ein eigener Eintrag des Zimmers geht vor', () => {
  const s = computeSettlement(selfSnapshot({
    units: [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 90, { participates: false }), selfUnit('r1', 20, { parentUnitId: 'c' }), selfUnit('r2', 40, { parentUnitId: 'c' })],
    tenancies: [selfTenancy('A', 'a', '2020-01-01', null), selfTenancy('B', 'b', '2020-01-01', null), selfTenancy('R1', 'r1', '2020-01-01', null), selfTenancy('R2', 'r2', '2020-01-01', null)],
    meters: selfMeters().map((m) => (m.unitId === 'c' ? { ...m, unitId: 'r1' } : m)).concat([selfMeter('wz-r2', 'r2', 'Wärme R2', 'waerme'), selfMeter('xw-r2', 'r2', 'Warmwasser R2', 'warmwasser')]),
    readings: selfReadings().filter((r) => r.date !== '2025-09-30').concat([selfReading('wz-r2', '2024-12-31', 0), selfReading('wz-r2', '2025-12-31', 3000), selfReading('xw-r2', '2024-12-31', 0), selfReading('xw-r2', '2025-12-31', 5)]),
    plant: { areaBasisHeat: 'volume', units: [{ unitId: 'a', heatedAreaM2: null, volumeM3: 150 }, { unitId: 'b', heatedAreaM2: null, volumeM3: 200 }, { unitId: 'c', heatedAreaM2: null, volumeM3: 240 }, { unitId: 'r2', heatedAreaM2: null, volumeM3: 100 }] },
  }))
  assert.ok(!s.notices.some((n) => n.level === 'error'), s.notices.filter((n) => n.level === 'error').map((n) => n.text).join('\n'))
  const steps = (id: string) => (statementOf(s, id).rows.find((r) => r.costItemId === 'wz')?.steps ?? assert.fail(`keine Zeile wz bei ${id}`)).map((x) => `${x.label}: ${x.value}`).join('\n')
  // R1 ohne eigenen Eintrag: 240 m³ × 20/60 = 80 m³; R2 mit eigenem Eintrag 100 m³. Zusammen 150 + 200 + 80 + 100 = 530.
  assert.match(steps('R1'), /Grundkosten Heizung: 80 von 530 m³/)
  assert.match(steps('R2'), /Grundkosten Heizung: 100 von 530 m³/)
})

test('Selbstgenutztes Zimmer mit Warmwasserzähler: Teil der Wohnung und eigenes Warmwasser sind Eigenanteil, auf beiden Wegen', () => {
  const units = [
    unit('a', { name: 'A', areaM2: 60 }),
    unit('wg', { name: 'WG', areaM2: 80, participates: false }),
    unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg', participates: false, selfUsed: true, selfPersons: 1 }),
    unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
    unit('z3', { name: 'Zimmer 3', areaM2: 16, parentUnitId: 'wg' }),
  ]
  const over = {
    units, tenancies: [tenancy('t-a', 'a'), tenancy('t-z2', 'z2'), tenancy('t-z3', 'z3')],
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg'), gauge('z1w', 'z1', 'warmwasser')],
    readings: [...used('zh', 160), ...used('za', 50), ...used('zw', 100), ...used('z1w', 10)],
  }
  for (const it of [water(), water({ meterRest: { referenceMeterId: null, behindMeterIds: ['za', 'zw', 'z1w'], key: 'area', unitIds: null, subMeters: [] } })]) {
    const s = settle(waterHouse(over, [it]))
    assert.deepEqual(shares(s, ['t-a', 't-z2', 't-z3']), [18750, 11250, 15000], it.meterRest ? 'Bezugszähler' : 'ohne')
    assert.equal(s.selfUsedShareCents, 15000, it.meterRest ? 'Bezugszähler' : 'ohne')
    assert.equal(s.landlord.totalCents, 15000)
  }
})

// ---------- Integrationsdurchsicht #573 mit #98: Rest am Bezugszähler und WG-Zimmer ----------

const restAt = (key: 'meter' | 'standard' | 'selfUse', subMeters: NonNullable<SnapshotCostItem['meterRest']>['subMeters'] = []) =>
  ({ meterRest: { referenceMeterId: null, behindMeterIds: null, key, unitIds: null, subMeters } })

test('Rest nach Verbrauch mit Warmwasserzähler im Zimmer: genau 100 % verteilt, wie ohne Angabe und wie zwei Wohnungen 70/50', () => {
  // WG mit zwei Zimmern je 12 m², Kaltwasser der Wohnung 100, Warmwasser in Zimmer 1 20, Hauptzähler 150, 1.500 €.
  // Zimmer 1 verbraucht 50 + 20 = 70, Zimmer 2 50; der Rest 30 geht im Verhältnis 70 : 50.
  const src = (it: SnapshotCostItem) => source({
    units: [
      unit('wg', { name: 'WG', areaM2: 80, participates: false }),
      unit('z1', { name: 'Zimmer 1', areaM2: 12, parentUnitId: 'wg' }),
      unit('z2', { name: 'Zimmer 2', areaM2: 12, parentUnitId: 'wg' }),
    ],
    tenancies: [tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2')],
    meters: [gauge('zh', null), gauge('zw', 'wg'), gauge('z1w', 'z1', 'warmwasser')],
    readings: [...used('zh', 150), ...used('zw', 100), ...used('z1w', 20)],
    costItems: [it],
  })
  for (const key of ['meter', 'standard', null] as const) {
    const s = settle(src(water({ amountCents: 150000, ...(key ? restAt(key) : {}) })))
    assert.deepEqual(shares(s, ['t-z1', 't-z2']), [87500, 62500], `Rest ${key ?? 'ohne Angabe'}`)
    assert.equal(s.landlord.totalCents, 0, `Rest ${key ?? 'ohne Angabe'}: ${JSON.stringify(s.landlord.rows)}`)
  }
})

test('Rest nach Verbrauch mit Warmwasserzählern in allen Zimmern und einer Wohnung daneben: wie ohne Angabe', () => {
  // A 50, WG 100 (Zimmer 12/12/16 m²), Warmwasser je Zimmer 10, Hauptzähler 200, 2.000 €: Rest 20 nach Verbrauch.
  const over = {
    meters: [gauge('zh', null), gauge('za', 'a'), gauge('zw', 'wg'), gauge('w1', 'z1', 'warmwasser'), gauge('w2', 'z2', 'warmwasser'), gauge('w3', 'z3', 'warmwasser')],
    readings: [...used('zh', 200), ...used('za', 50), ...used('zw', 100), ...used('w1', 10), ...used('w2', 10), ...used('w3', 10)],
  }
  for (const key of ['meter', 'standard', null] as const) {
    const s = settle(waterHouse(over, [water({ amountCents: 200000, ...(key ? restAt(key) : {}) })]))
    assert.deepEqual(shares(s, ['t-a', ...ROOMS]), [55556, 44444, 44444, 55556], `Rest ${key ?? 'ohne Angabe'}`)
    assert.equal(s.landlord.totalCents, 0, `Rest ${key ?? 'ohne Angabe'}: ${JSON.stringify(s.landlord.rows)}`)
  }
})

test("Rest als Eigenanteil ('selfUse', 'standard') bei einer über den Wohnungszähler gemessenen WG: der Eigenanteil bleibt", () => {
  // E 60 m² selbstgenutzt ohne Zähler, WG mit zwei Zimmern und Kaltwasserzähler 100, Hauptzähler 140, Garten (Teil des Hauses) 10.
  const src = (it: SnapshotCostItem, rooms: boolean) => source({
    units: [
      unit('e', { name: 'E', areaM2: 60, participates: false, selfUsed: true, selfPersons: 1 }),
      ...(rooms
        ? [unit('wg', { name: 'WG', areaM2: 80, participates: false }), unit('z1', { name: 'Zimmer 1', areaM2: 20, parentUnitId: 'wg' }), unit('z2', { name: 'Zimmer 2', areaM2: 20, parentUnitId: 'wg' })]
        : [unit('wg', { name: 'WG', areaM2: 80 })]),
    ],
    tenancies: rooms ? [tenancy('t-z1', 'z1'), tenancy('t-z2', 'z2')] : [tenancy('t-wg', 'wg')],
    meters: [gauge('zh', null), gauge('zw', 'wg'), { ...gauge('garten', null), scope: 'common' }],
    readings: [...used('zh', 140), ...used('zw', 100), ...used('garten', 10)],
    costItems: [it],
  })
  for (const rooms of [true, false]) {
    const label = rooms ? 'mit Zimmern' : 'Gegenprobe ohne Zimmer'
    // Ohne Zwischenzähler: der ganze Rest 40 ist der Verbrauch von E.
    const own = settle(src(water({ amountCents: 140000, ...restAt('selfUse') }), rooms))
    assert.equal(own.selfUsedShareCents, 40000, `selfUse ${label}`)
    assert.equal(landlordPart(own, 'selfUse'), 40000, `selfUse ${label}`)
    assert.equal(landlordPart(own, 'mainMeterRest'), 0, `selfUse ${label}`)
    // Garten an den Vermieter, wie die Oberfläche es als 'standard' speichert: Rest 30 Eigenanteil, Garten 10 abziehbar.
    const standard = settle(src(water({ amountCents: 140000, ...restAt('standard', [{ meterId: 'garten', target: 'landlord' }]) }), rooms))
    assert.equal(standard.selfUsedShareCents, 30000, `standard ${label}`)
    assert.equal(landlordPart(standard, 'selfUse'), 30000, `standard ${label}`)
    assert.equal(landlordPart(standard, 'mainMeterRest'), 10000, `standard ${label}`)
  }
})
