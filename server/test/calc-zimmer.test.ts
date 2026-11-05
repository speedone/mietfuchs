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
  for (let i = 0; i < 1500; i++) {
    const r = makeRng(573_000 + i * 7919)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
    const units: SnapshotUnit[] = []
    const tenancies: SnapshotTenancy[] = []
    const meters: SnapshotMeter[] = []
    const readings: SnapshotReading[] = []
    const usageOf = () => pick(['vermietet', 'vermietet', 'vermietet', 'eigen', 'ausgenommen'] as const)
    const addUnit = (id: string, over: Partial<SnapshotUnit>) => {
      const usage = usageOf()
      units.push(unit(id, { name: id, areaM2: r() < 0.15 ? 0 : Math.round(r() * 30), participates: usage === 'vermietet', selfUsed: usage === 'eigen', selfPersons: usage === 'eigen' ? Math.floor(r() * 3) : undefined, ...over }))
      if (usage === 'vermietet' && r() < 0.8) {
        const start = r() < 0.3 ? `2025-0${1 + Math.floor(r() * 9)}-01` : '2024-01-01'
        const end = r() < 0.3 ? `2025-${String(10 + Math.floor(r() * 3))}-15` : null
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
    }
    if (r() < 0.85) reading('m-wg', 'wg', 'kaltwasser', Math.round(r() * 200))
    if (r() < 0.5) reading('m-wgs', 'wg', 'strom', Math.round(r() * 2000))
    if (r() < 0.5) reading('m-main', null, 'kaltwasser', Math.round(r() * 400))
    const ids = units.filter((u) => u.id !== 'wg').map((u) => u.id)
    const unitMeters = meters.filter((m) => m.unitId !== null && m.type === 'kaltwasser').map((m) => m.id)
    const key = pick(['area', 'persons', 'units', 'meter', 'meter', 'meter'] as const)
    const amount = 1 + Math.floor(r() * 200000)
    const drawn: SnapshotCostItem = item({
      id: 'c', category: pick(['Wasser/Abwasser', 'Müllabfuhr', 'Sonstige Betriebskosten'] as const), description: 'P', key,
      amountCents: r() < 0.15 ? -amount : amount,
      ...(key === 'meter' ? { meterType: pick(['kaltwasser', 'kaltwasser', 'strom'] as const), ...(r() < 0.5 ? { roomSplit: 'persons' as const } : {}) } : {}),
      ...(r() < 0.3 ? { participantUnitIds: ids.filter(() => r() < 0.7) } : {}),
    })
    const withRest = key === 'meter' && drawn.meterType === 'kaltwasser' && r() < 0.3
    const one: SnapshotCostItem = withRest
      ? { ...drawn, meterRest: { referenceMeterId: null, behindMeterIds: unitMeters, key: pick(['area', 'persons', 'units', 'meter', 'landlord'] as const), unitIds: null, subMeters: [] } }
      : drawn
    const context = `Fall ${i}\n${JSON.stringify({ units, tenancies, meters, readings, one })}`
    const s = settle(source({ units, tenancies, meters, readings, costItems: [one] }))
    items++
    const tenants = s.statements.flatMap((st) => st.rows.filter((x) => x.costItemId === 'c'))
    const landlord = s.landlord.rows.filter((x) => x.costItemId === 'c').reduce((a, x) => a + x.shareCents, 0)
    assert.equal(tenants.reduce((a, x) => a + x.shareCents, 0) + landlord, one.amountCents, `Summe: ${context}`)
    for (const x of tenants) assert.ok(x.shareCents === 0 || Math.sign(x.shareCents) === Math.sign(one.amountCents), `Vorzeichen ${x.shareCents}: ${context}`)
    const self = s.selfUsedShareCents
    assert.ok(self === 0 || Math.sign(self) === Math.sign(landlord), `Eigenanteil ${self}, Vermieter ${landlord}: ${context}`)
    assert.ok(Math.abs(self) <= Math.abs(landlord), `Eigenanteil ${self} > Vermieter ${landlord}: ${context}`)
    assertLandlordParts(s, tenancies.length, context)
    assertControlSums(s, context)
    if (key === 'meter' && meters.some((m) => m.unitId === 'wg' && m.type === one.meterType) && tenants.some((x) => x.shareCents !== 0)) split++
  }
  assert.ok(items === 1500 && split >= 200, `zu wenige Fälle mit Wohnungszähler: ${split}`)
})
