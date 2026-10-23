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
  // Basis 50 + 50 × 184/365 m²: t-a 100.000 × 365/549 = 66.484,52, t-b × 184/549 = 33.515,48.
  assert.equal(shareOf(s, 't-a'), 66485)
  assert.equal(shareOf(s, 't-b'), 33515)
  assert.equal(s.landlord.totalCents, 0)
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
  // Nach Fläche geteilt wird in Teil 1 nach der Nutzung am Jahresende: b ist dann vermietet, also nichts privat.
  assert.equal(r.expenses.items.find((i) => i.costItemId === 'g')?.privateCents, 0)
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
