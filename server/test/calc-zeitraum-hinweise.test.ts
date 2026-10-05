// Hinweise zum Abrechnungszeitraum (#208, Entwurf 3.4, 3.6, 10.1).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
const haus = (costItems: SnapshotCostItem[]): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (rules: PeriodRules, key: string, items: SnapshotCostItem[]) => {
  const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
  return computeSettlement(snapshotOfPeriod(haus(items), p, previousPeriod(rules, p)))
}
const codes = (s: ReturnType<typeof settle>) => s.notices.map((n) => n.code).filter((c) => c.startsWith('period.'))
const item = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({ id: 'k', period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area', ...over })

test('Rumpf: ein Hinweis mit dem sachlichen Grund und dem Mietvertrag (Entwurf 3.6)', () => {
  const s = settle(WECHSEL, '2025-01', [item({})])
  const n = s.notices.find((x) => x.code === 'period.short') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.equal(n.text, 'Rumpfzeitraum 01.01.–30.04.2025 wegen der Umstellung. Eine Verkürzung braucht einen sachlichen Grund, etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.')
  assert.deepEqual(codes(settle(WECHSEL, '2025-05', [item({ period: periodKey('2025-05') })])), [], 'ein voller Zeitraum bekommt ihn nicht')
})

test('Leistungszeitraum außerhalb: warning mit Leistungs- und Abrechnungszeitraum', () => {
  const s = settle(WECHSEL, '2025-01', [item({ description: 'Versicherung 2024', serviceFrom: '2024-01-01', serviceTo: '2024-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.item-outside') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.equal(n.text, '„Versicherung 2024“: Der Leistungszeitraum 01.01.–31.12.2024 liegt außerhalb des Abrechnungszeitraums 01.01.–30.04.2025. Gehört die Rechnung in einen anderen Zeitraum, ordnen Sie sie dort zu.')
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'k' })
})

test('Heizkosten über den Zeitraum hinaus: warning nach VIII ZR 156/11, ohne Aufteilen', () => {
  const s = settle(WECHSEL, '2025-01', [item({ category: 'Heizung und Warmwasser', description: 'Wartung', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.heating-mismatch') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /^„Wartung“: Heizkosten gehören in den Abrechnungszeitraum, in dem sie verbraucht wurden \(BGH VIII ZR 156\/11\)\. Der Leistungszeitraum 01\.01\.–31\.12\.2025 reicht über 01\.01\.–30\.04\.2025 hinaus/)
})

test('Ein Verbrauch nach Zählern, nach Tagen aufgeteilt: hint auf den Zählerstand zum Stichtag (Z-B11)', () => {
  const s = settle(WECHSEL, '2025-01', [item({ category: 'Wasser/Abwasser', description: 'Wasser 2025 (anteilig 01.01.–30.04.2025)', key: 'meter', meterType: 'kaltwasser', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])
  const n = s.notices.find((x) => x.code === 'period.split-by-days-meter') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.equal(n.text, '„Wasser 2025 (anteilig 01.01.–30.04.2025)“ ist nach Tagen auf die Abrechnungszeiträume aufgeteilt. Mit dem Zählerstand zum 30.04.2025 wäre die Aufteilung genauer.')
  assert.deepEqual(codes(settle(WECHSEL, '2025-01', [item({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })])), ['period.short'], 'nach Fläche geteilt: kein Hinweis auf Zähler')
})

test('Kalenderjahr mit Leistungszeitraum im Jahr: kein Hinweis (Review Focus 4)', () => {
  const s = computeSettlement(snapshotOf(haus([{ ...item({ category: 'Wasser/Abwasser', key: 'meter', meterType: 'kaltwasser', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }) }]), 2025))
  assert.deepEqual(codes(s), [])
})
