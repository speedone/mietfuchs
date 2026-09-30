// Einzelbeträge für die selbstgenutzte Wohnung (#104). Der Messdienst rechnet auch die Wohnung
// des Vermieters ab; ihr Betrag ist sein Eigenanteil und in der Steuer privat. Vorher ließ er
// sich nicht eintragen, steckte im Rest beim Vermieter und fehlte im Eigenanteil.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const haupt: SnapshotUnit = { id: 'haupt', name: 'Hauptwohnung', areaM2: 100, participates: false, selfUsed: true, selfPersons: 2 }
const el: SnapshotUnit = { id: 'el', name: 'Einlieger', areaM2: 50, participates: true }
const heizung = (over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id: 'h', year: 2025, category: 'Heizung und Warmwasser', description: 'Heizung laut Messdienst', amountCents: 300000, key: 'amounts', ...over,
})
const source = (item: SnapshotCostItem): SnapshotSource => ({
  units: [haupt, el], tenancies: [tenancy('t', 'el')], costItems: [item], meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (item: SnapshotCostItem): ComputedSettlement => computeSettlement(snapshotOf(source(item), 2025))

test('Der Betrag der eigenen Wohnung ist ihr Eigenanteil, und die Warnung entfällt', () => {
  const s = settle(heizung({ tenancyAmounts: { t: 124000 }, selfAmounts: { haupt: 160000 } }))
  assert.equal(s.statements[0]?.totalShareCents, 124000)
  assert.equal(s.landlord.totalCents, 176000)
  assert.equal(s.selfUsedShareCents, 160000)
  assert.ok(!s.notices.some((n) => n.code === 'amounts.self-hidden'), s.warnings.join(' | '))
})

test('Die Steuerübersicht nennt den privaten Anteil jetzt richtig', () => {
  const r = taxReport(snapshotOf(source(heizung({ tenancyAmounts: { t: 124000 }, selfAmounts: { haupt: 160000 } })), 2025))
  assert.equal(r.selfUsedShareCents, 160000)
})

test('Ohne Betrag für die eigene Wohnung bleibt die Warnung', () => {
  const s = settle(heizung({ tenancyAmounts: { t: 124000 } }))
  assert.ok(s.notices.some((n) => n.code === 'amounts.self-hidden'))
  assert.equal(s.selfUsedShareCents, 0)
})

test('Die Beträge der eigenen Wohnung zählen in die Prüfung gegen den Rechnungsbetrag', () => {
  const s = settle(heizung({ tenancyAmounts: { t: 200000 }, selfAmounts: { haupt: 160000 } }))
  assert.ok(s.notices.some((n) => n.code === 'amounts.exceed'), s.warnings.join(' | '))
  assert.equal(s.selfUsedShareCents, 0, 'nichts verteilt, also auch kein ausgewiesener Eigenanteil')
})

test('Ein Betrag für eine Wohnung, die nicht selbstgenutzt ist, wird nicht als Eigenanteil gezählt', () => {
  const s = settle(heizung({ tenancyAmounts: { t: 124000 }, selfAmounts: { el: 50000 } }))
  assert.equal(s.selfUsedShareCents, 0)
  assert.ok(s.notices.some((n) => n.code === 'amounts.self-forfeited'), s.warnings.join(' | '))
})
