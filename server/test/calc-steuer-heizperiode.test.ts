// Steuerübersicht mit eigener Heizperiode (Heizung PR 5, Entwurf 3.10): Jahr der Zahlung je
// Position, Eigenanteil aus der Abrechnung, in der die Position steht (Weg b: P, Weg d: die
// Heizkostenabrechnung), keine Vorauszahlung der Abrechnung bei Weg d.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReportFor } from '../src/calc.ts'
import type { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]

const haus = (separateSpans: SeparateSpan[]): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [
    { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: false, selfUsed: true, selfPersons: 1 },
  ],
  tenancies: [{
    id: 'A', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 30000 }], prepaymentOverrides: {}, baseRents: [],
  }],
  costItems: [
    { id: 'heizung', propertyId: 'objekt-1', period: periodKey('2025-05'), category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents: 150000, key: 'area', heatingPlantId: 'hp1', taxYear: 2026 },
    { id: 'grundsteuer', propertyId: 'objekt-1', period: periodKey('2026-01'), category: 'Grundsteuer', description: 'Grundsteuer 2026', amountCents: 50000, key: 'area' },
  ],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
    units: null, periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: separateSpans.length > 0,
  }],
} as Source)

test('Weg b: Die Heizposition 2025/2026 zählt im Jahr ihrer Zahlung, der Eigenanteil aus der Abrechnung 2026', () => {
  const r2026 = taxReportFor(haus([]), 'objekt-1', 2026)
  const heizung = r2026.expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail('Heizposition fehlt')
  assert.equal(heizung.privateCents, 60000, '40 von 100 m² selbstgenutzt')
  assert.deepEqual(r2026.settlementPeriods.map((p) => p.label), ['2026'])
  assert.notEqual(r2026.income.prepaymentSettlementCents, null)
  assert.equal(taxReportFor(haus([]), 'objekt-1', 2025).expenses.items.some((i) => i.costItemId === 'heizung'), false)
})

test('Weg d: Die Heizposition kommt aus der Heizkostenabrechnung, die Vorauszahlung der Abrechnung entfällt', () => {
  const r2026 = taxReportFor(haus([{ from: '2025-05', until: null }]), 'objekt-1', 2026)
  const heizung = r2026.expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail('Heizposition fehlt')
  assert.equal(heizung.privateCents, 60000)
  assert.deepEqual(r2026.settlementPeriods.map((p) => p.label), ['2026', 'Heizkosten 2025/2026'])
  assert.equal(r2026.income.prepaymentSettlementCents, null)
  assert.ok(r2026.expenses.items.some((i) => i.costItemId === 'grundsteuer'))
})

test('Weg b: Eine Heizposition, gezahlt im Jahr, in dem ihre Heizperiode beginnt, steht in der Anlage V dieses Jahres (Durchsicht von #231, Important 3)', () => {
  for (const spans of [[], [{ from: '2025-05', until: null }]] as SeparateSpan[][]) {
    const src = haus(spans)
    const item = src.costItems.find((c) => c.id === 'heizung') ?? assert.fail('keine Heizposition')
    item.taxYear = 2025
    const r2025 = taxReportFor(src, 'objekt-1', 2025)
    assert.ok(r2025.expenses.items.some((i) => i.costItemId === 'heizung'), `2025, Spannen ${JSON.stringify(spans)}`)
    assert.equal(taxReportFor(src, 'objekt-1', 2026).expenses.items.some((i) => i.costItemId === 'heizung'), false, '2026 nicht')
  }
})
