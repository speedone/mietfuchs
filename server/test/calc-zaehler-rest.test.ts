// Bezugszähler und verteilter Rest (#98): Zähler für einen Teil des Hauses.

import { calendarPeriod } from '../../shared/period.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
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
