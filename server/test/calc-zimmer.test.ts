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
import { snapshotOf, type Snapshot, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
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
