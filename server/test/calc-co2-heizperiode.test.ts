// CO₂ beim Messdienst mit eigener Heizperiode (Heizung PR 6 auf PR 5): Jahr der Zahlung einer
// Heizposition über zwei Kalenderjahre, Weg b und Weg d, Heizvorauszahlung neben der Abzugszeile.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { heatingSnapshotFor, type snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { Co2Method, Co2Statement, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const H = periodKey('2025-05')

const co2 = (method: Co2Method, S: number, L: number): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp1', period: H, method, areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null,
  serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: L, serviceUsersTotalCents: S, serviceUsersTotalApprox: false,
  serviceUnitsCount: 2, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
})

// Ein Mieter (EG) und eine selbstgenutzte Wohnung (OG); die Anlage rechnet Mai bis April ab, das
// Objekt im Kalenderjahr. Die Messdienstposition 2025/2026 ist im Jahr 2026 gezahlt.
const haus = (separateSpans: SeparateSpan[], amountCents: number, tenancyAmount: number, selfAmount: number, statements: Co2Statement[]): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [
    { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: false, selfUsed: true, selfPersons: 1 },
  ],
  tenancies: [{
    id: 'A', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 30000 }], prepaymentOverrides: {}, baseRents: [],
    heatingPrepayments: separateSpans.length > 0 ? [{ from: '2025-05', monthlyCents: 10000 }] : [],
  }],
  costItems: [{
    id: 'heizung', propertyId: 'objekt-1', period: H, category: HEATING_CATEGORY, description: 'Messdienst 2025/2026', amountCents, key: 'amounts',
    tenancyAmounts: { A: tenancyAmount }, selfAmounts: { u2: selfAmount }, heatingPlantId: 'hp1', taxYear: 2026,
  }],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
    units: null, periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: separateSpans.length > 0,
  }],
  co2Statements: statements,
} as Source)

test('Vorwegabzug, Weg b und Weg d: L_self ist privat im Jahr der Zahlung, co2Share abziehbar; das Vorjahr bleibt leer', () => {
  // S = 1.200 + 600 = 1.800 €, L = 100 €, Betrag 1.900 €. L_self = 100 · 600 / 1.800 = 33,33 €.
  for (const spans of [[], [{ from: '2025-05', until: null }]] as SeparateSpan[][]) {
    const src = haus(spans, 190000, 120000, 60000, [co2('serviceDeducted', 180000, 10000)])
    const r2026 = taxReportFor(src, 'objekt-1', 2026)
    const heizung = r2026.expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail(`Heizposition fehlt, Spannen ${JSON.stringify(spans)}`)
    assert.deepEqual([heizung.amountCents, heizung.privateCents, heizung.deductibleCents], [190000, 63333, 126667], JSON.stringify(spans))
    assert.equal(taxReportFor(src, 'objekt-1', 2025).expenses.items.some((i) => i.costItemId === 'heizung'), false)
  }
})

test('Nur ausgewiesen, Weg d: die Abzugszeile steht in der Heizkostenabrechnung und mindert den Saldo neben der Heizvorauszahlung', () => {
  // S = 1.800 €, L = 100 €; der Mieter trägt 1.200 €, sein Abzug 100 · 1.200 / 1.800 = 66,67 €.
  const src = haus([{ from: '2025-05', until: null }], 180000, 120000, 60000, [co2('serviceShown', 180000, 10000)])
  const h = periodOfKey({ startMonth: 5, changes: [] }, H) ?? assert.fail('keine Heizperiode')
  const snap = heatingSnapshotFor(src, 'objekt-1', 'hp1', h) ?? assert.fail('kein Schnappschuss')
  const r = computeSettlement(snap)
  const st = r.statements.find((s) => s.tenancyId === 'A') ?? assert.fail('kein Mieter')
  assert.deepEqual(st.rows.filter((row) => row.kind === 'co2Relief').map((row) => row.shareCents), [-6667])
  assert.equal(st.totalShareCents, 120000 - 6667)
  assert.equal(st.prepaymentCents, 12 * 10000)
  assert.equal(st.balanceCents, 12 * 10000 - (120000 - 6667))
  // Steuer: Betrag S ganz in der Position, privat der Eigenbetrag; die Abzugszeile ist keine Position.
  const heizung = taxReportFor(src, 'objekt-1', 2026).expenses.items.find((i) => i.costItemId === 'heizung') ?? assert.fail('Heizposition fehlt')
  assert.deepEqual([heizung.amountCents, heizung.privateCents], [180000, 60000])
  assert.equal(taxReportFor(src, 'objekt-1', 2026).expenses.items.some((i) => i.costItemId.startsWith('co2:')), false)
})
