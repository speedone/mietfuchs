// Die Heizkostenabrechnung nach Weg d (Heizung PR 5, Entwurf 3.1, 6.1 Nr. 7, Testfälle R3, B3, A3,
// C2/D2, C3, D1 aus 12.2).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, heatingPrepaymentCents, type ComputedSettlement } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, HeatingPrepaymentOverride, PeriodRules, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (separateSpans: SeparateSpan[], units: { unitId: string; heatedAreaM2: null }[] | null = null) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units,
  periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: true,
})
const offen: SeparateSpan[] = [{ from: '2025-05', until: null }]
// Weg d ab X = 01/2026 (C2, C3): Die Heizperiode 2025/2026 ist getrennt, ihre Monate vor X gehören P.
const ab2026: SeparateSpan[] = [{ from: '2026-01', until: null }]
const mieter = (id: string, unitId: string, heating: { from: string; monthlyCents: number }[], overrides: HeatingPrepaymentOverride[] = []) => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 30000 }, { from: heating[0]?.from ?? '2024-01', monthlyCents: 17700 }],
  prepaymentOverrides: {}, baseRents: [], heatingPrepayments: heating, heatingPrepaymentOverrides: overrides,
})
const heizung = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: HEATING_CATEGORY, description: id, amountCents, key: 'area' as const, heatingPlantId: 'hp1', ...over,
})
const haus = (over: Partial<Source>): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage(offen)],
  ...over,
} as Source)
const heizkosten = (src: Source, key: string): ComputedSettlement =>
  computeSettlement(heatingSnapshotFor(src, 'objekt-1', 'hp1', of(MAI, key)) ?? assert.fail('keine Anlage'))
const st = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`${id} fehlt`)
const korrektur = (period: string, cents: number, monate?: [string, string]): HeatingPrepaymentOverride => ({
  plantId: 'hp1', period: periodKey(period), cents, provisional: monate !== undefined, fromMonth: monate?.[0] ?? null, toMonth: monate?.[1] ?? null,
})

test('R3/B3/A3: eigene Heizkostenabrechnung je Heizperiode, Frist 30.04.2027, Vorschlag für die Heizvorauszahlung', () => {
  const src = haus({
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }])],
    costItems: [heizung('Messdienst', '2025-05', 150000, { taxYear: 2026 }), { ...heizung('Grundsteuer', '2026-01', 50000), category: 'Grundsteuer', heatingPlantId: undefined }],
  })
  const h = heizkosten(src, '2025-05')
  assert.deepEqual([h.period.label, h.deadline, h.scope], ['2025/2026', '2027-04-30', { kind: 'heating', plantId: 'hp1', plantName: '' }])
  const a = st(h, 'A')
  assert.deepEqual(
    [a.scope, a.rows.map((r) => [r.costItemId, r.shareCents]), a.prepaymentCents, a.heatingPrepaymentCents, a.balanceCents, a.suggestedMonthlyCents],
    ['heating', [['Messdienst', 150000]], 147600, 147600, -2400, 12500],
  )
  assert.equal(a.prepaymentNote, undefined)
  const p = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2026-01')))
  assert.deepEqual(st(p, 'A').rows.map((r) => r.costItemId), ['Grundsteuer'], 'die Gesamtabrechnung 2026 enthält die Heizkosten nicht')
  assert.deepEqual(p.separateHeating?.map((x) => [x.period.key, x.deadline]), [['2025-05', '2027-04-30']])
})

test('C2/D2: vorläufige Heizkorrektur 876 € für Mai–Dezember 2026, Staffel Januar–April 2027: 1.368 € angerechnet', () => {
  const src = haus({
    heatingPlants: [anlage(ab2026)],
    tenancies: [mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }], [korrektur('2025-05', 30000), korrektur('2026-05', 87600, ['2026-05', '2026-12'])])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 }), heizung('H26', '2026-05', 150000, { taxYear: 2027 })],
  })
  const h26 = st(heizkosten(src, '2026-05'), 'A')
  assert.equal(h26.prepaymentCents, 87600 + 4 * 12300)
  assert.notEqual(h26.prepaymentCents, 8 * 12300 + 4 * 12300, 'Fehlbild: Restbetrag nicht gespeichert, die Staffel für Mai–Dezember')
  const pending = heizkosten(src, '2026-05').notices?.find((n) => n.code === 'prepayment.heating-override-pending') ?? assert.fail('keine Warnung')
  assert.equal(pending.level, 'warning')
  assert.match(pending.text, /Für Mai bis Dezember 2026 gilt vorläufig 876,00 €, der Rest der Korrektur der Abrechnung 2026\./)
  const h25 = st(heizkosten(src, '2025-05'), 'A')
  assert.deepEqual([h25.prepaymentCents, h25.prepaymentOverridden], [30000, true])
  assert.equal(h25.prepaymentNote, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.')
  assert.equal(heizkosten(src, '2025-05').notices?.some((n) => n.code === 'prepayment.heating-override-pending'), false)
})

test('C3: Weg d nach dem Abschluss von 2025 eingerichtet, X = 01/2026: 2025/2026 rechnet vier Monate an und nennt die übrigen', () => {
  const src = haus({
    heatingPlants: [anlage(ab2026)],
    tenancies: [mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 })],
  })
  const a = st(heizkosten(src, '2025-05'), 'A')
  assert.equal(a.prepaymentCents, 4 * 12300)
  assert.equal(a.prepaymentNote, 'Die Vorauszahlungen Mai bis Dezember 2025 sind in der Abrechnung 2025 angerechnet.')
})

test('D1 Fall 1: Die Heizperiode vor W rechnet alle zwölf Monate an (1.476 €), keine geht verloren', () => {
  const src = haus({
    heatingPlants: [anlage([{ from: '2025-05', until: periodKey('2026-05') }])],
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }])],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026 })],
  })
  assert.equal(st(heizkosten(src, '2025-05'), 'A').prepaymentCents, 12 * 12300)
  const p2026 = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2026-01')))
  assert.equal(st(p2026, 'A').heatingPrepaymentCents, 8 * 12300, 'P 2026 rechnet die Heizstaffel ab 05/2026 an')
})

test('Heizvorauszahlung einer Heizperiode: endgültig, vorläufig, Monate, die P anrechnet', () => {
  const t = mieter('A', 'u1', [{ from: '2026-01', monthlyCents: 12300 }], [korrektur('2026-05', 87600, ['2026-05', '2026-12'])])
  assert.deepEqual(heatingPrepaymentCents(t, 'hp1', of(MAI, '2026-05')), {
    cents: 87600 + 4 * 12300, overridden: true, provisional: korrektur('2026-05', 87600, ['2026-05', '2026-12']), elsewhere: [],
  })
  const abX = (m: string) => m >= '2026-01'
  assert.deepEqual(heatingPrepaymentCents(t, 'hp1', of(MAI, '2025-05'), abX), {
    cents: 4 * 12300, overridden: false, provisional: null,
    elsewhere: ['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'],
  })
})

test('Wohnungen ohne Heizposition fehlen in der Heizkostenabrechnung', () => {
  const src = haus({
    heatingPlants: [anlage(offen, [{ unitId: 'u1', heatedAreaM2: null }])],
    units: [
      { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
      { id: 'g1', propertyId: 'objekt-1', name: 'Garage', areaM2: 0, participates: true, noConnection: ['waerme'] },
    ],
    tenancies: [mieter('A', 'u1', [{ from: '2025-05', monthlyCents: 12300 }]), { ...mieter('B', 'g1', []), heatingPrepayments: [] }],
    costItems: [heizung('H25', '2025-05', 150000, { taxYear: 2026, participantUnitIds: ['u1'] })],
  })
  assert.deepEqual(heizkosten(src, '2025-05').statements.map((s) => s.tenancyId), ['A'])
})
