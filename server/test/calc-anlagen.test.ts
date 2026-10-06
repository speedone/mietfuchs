// Mehrere Anlagen und Etagenheizung in der Abrechnung (Heizung PR 9, Entwurf 9.3, 12.3 Nr. 13).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Statement, FuelDelivery } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Quelle = Parameters<typeof snapshotFor>[0]

const wohnung = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), areaM2: 50, participates: true, propertyId: 'objekt-1', ...over })
const mieter = (id: string, unitId: string, over: Record<string, unknown> = {}) => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [], start: '2020-01-01', end: null as string | null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const anlage = (id: string, name: string, unitIds: string[], over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant & { propertyId: string } => ({
  id, name, energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
  units: unitIds.map((unitId) => ({ unitId, heatedAreaM2: null })), propertyId: 'objekt-1', ...over,
})
const co2 = (plantId: string, over: Partial<Co2Statement>): Co2Statement => ({
  heatingPeriodId: `h-${plantId}`, plantId, period: P.key, method: 'serviceShown', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [], ...over,
})
const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: P.key, category: HEATING_CATEGORY, description: over.id, amountCents: 100000, key: 'area', ...over,
})
const messdienst = (id: string, plantId: string, tenancyAmounts: Record<string, number>) =>
  position({ id, key: 'amounts', tenancyAmounts, heatingPlantId: plantId, amountCents: Object.values(tenancyAmounts).reduce((a, c) => a + c, 0) })
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const reliefRowsOf = (r: ComputedSettlement, plantId: string): [string, number][] =>
  r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief' && row.costItemId === `co2:${plantId}:${P.key}`).map((row): [string, number] => [st.tenancyId, row.shareCents]))

const quelle = (over: Partial<Quelle>): Quelle => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const settle = (over: Partial<Quelle>): ComputedSettlement => computeSettlement(snapshotFor(quelle(over), 'objekt-1', P))

// Zwei Häuser in einem Objekt: Zentralheizung für EG und OG, eine zweite Anlage für das DG.
const HAUS = { units: [wohnung('eg'), wohnung('og'), wohnung('dg')], tenancies: [mieter('ta', 'eg'), mieter('tb', 'og'), mieter('tc', 'dg')] }
const ZENTRAL = anlage('hp1', 'Zentralheizung', ['eg', 'og'])
const DG = anlage('hp2', 'Haus B', ['dg'])
const M1 = messdienst('m1', 'hp1', { ta: 60000, tb: 40000 })
const M2 = messdienst('m2', 'hp2', { tc: 50000 })
const ST1 = co2('hp1', { serviceUsersTotalCents: 100000, serviceLandlordCents: 5000, serviceUnitsCount: 2 })
const ST2 = co2('hp2', { serviceUsersTotalCents: 50000, serviceLandlordCents: 3000, serviceUnitsCount: 1 })
const zwei = (costItems: (SnapshotCostItem & { propertyId: string })[], plants: (SnapshotHeatingPlant & { propertyId: string })[], statements: Co2Statement[]) =>
  settle({ ...HAUS, costItems, heatingPlants: plants, co2Statements: statements })

test('Zwei Anlagen rechnen unabhängig (Entwurf 12.3 Nr. 13): Abzug jeder Anlage wie allein', () => {
  const beide = zwei([M1, M2], [ZENTRAL, DG], [ST1, ST2])
  const nurEins = zwei([M1], [ZENTRAL], [ST1])
  const nurZwei = zwei([M2], [DG], [ST2])
  assert.deepEqual(reliefRowsOf(beide, 'hp1'), reliefRowsOf(nurEins, 'hp1'))
  assert.deepEqual(reliefRowsOf(beide, 'hp2'), reliefRowsOf(nurZwei, 'hp2'))
  assert.deepEqual(reliefRowsOf(beide, 'hp1'), [['ta', -3000], ['tb', -2000]])
  assert.deepEqual(reliefRowsOf(beide, 'hp2'), [['tc', -3000]])
  assert.deepEqual(beide.heating?.map((h) => h.plantId), ['hp1', 'hp2'])
})

test('Position über zwei Anlagen (F9, Review Focus 2): co2.item-spans-plants, verteilt wie bisher, mindert keinen Abzug', () => {
  const wartung = position({ id: 'w', description: 'Wartung', amountCents: 30000, participantUnitIds: ['og', 'dg'], heatingPlantId: 'hp1' })
  const r = zwei([M1, M2, wartung], [ZENTRAL, DG], [ST1, ST2])
  const n = r.notices.find((x) => x.code === 'co2.item-spans-plants') ?? assert.fail(codes(r).join(', '))
  assert.deepEqual([n.level, n.subject], ['error', { kind: 'costItem', id: 'w' }])
  assert.match(n.text, /„Wartung“ gehört zur Heizanlage „Zentralheizung“, wird aber auch auf Wohnungen verteilt, die an „Haus B“ hängen \(DG\)\./)
  assert.ok(!r.notices.some((x) => x.code === 'co2.pool-foreign-item' && x.subject?.id === 'w'))
  // Verteilt wird sie weiter nach ihrem Schlüssel (OG und DG je 150 €).
  const zeile = (t: string) => r.statements.find((st) => st.tenancyId === t)?.rows.find((row) => row.costItemId === 'w')?.shareCents
  assert.deepEqual([zeile('tb'), zeile('tc')], [15000, 15000])
  // Der Abzug der Zentralheizung bleibt, wie er ohne die Wartung wäre.
  assert.deepEqual(reliefRowsOf(r, 'hp1'), reliefRowsOf(zwei([M1, M2], [ZENTRAL, DG], [ST1, ST2]), 'hp1'))
})

test('Position ohne Anlage, wenn das Objekt Anlagen hat (Festlegung 5): Hinweis an der Position statt „Heizung einrichten“', () => {
  const lose = position({ id: 'lose', description: 'Schornsteinfeger', amountCents: 9000, key: 'units' })
  const r = zwei([M1, M2, lose], [ZENTRAL, DG], [ST1, ST2])
  const n = r.notices.find((x) => x.code === 'co2.fuel-unknown') ?? assert.fail(codes(r).join(', '))
  assert.deepEqual(n.subject, { kind: 'costItem', id: 'lose' })
  assert.match(n.text, /^„Schornsteinfeger“ gehört zu keiner Heizanlage\./)
  assert.match(n.text, /Ordnen Sie die Position unter Kosten einer Heizanlage zu\.$/)
})

// ---------- Etagenheizung (F8) ----------

const gasrechnung = (id: string, unitId: string, emissionsKg: number, co2CostCents: number): FuelDelivery => ({
  id, plantId: 'hp', label: `Gas ${unitId}`, invoiceDate: '2026-01-15', deliveredAt: null, invoiceFrom: P.from, invoiceTo: P.to, unitId,
  amountCents: null, quantity: null, quantityUnit: 'kWh', energyKwh: Math.round(emissionsKg / 0.2), gasBasis: null, heatingValue: null, emissionsKg, co2CostCents,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
})
const direkt = (id: string, unitId: string, amountCents: number, fuelDeliveryId: string) =>
  position({ id, description: `Gas ${unitId.toUpperCase()}`, amountCents, key: 'direct', directUnitId: unitId, heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId })
const THERMEN = anlage('hp', 'Gasthermen', ['eg', 'og'], { method: 'manual', supply: 'perUnit' })
// EG 60 m², ganzjährig vermietet; OG 40 m², Mieter bis 30.04.2025 (120 Tage), Leerstand Mai und Juni
// (61 Tage), neuer Mieter ab 01.07.2025 (184 Tage). Je Wohnung eine Gasrechnung als Direktzuordnung.
const F8 = (over: Partial<Quelle> = {}): Partial<Quelle> => ({
  units: [wohnung('eg', { areaM2: 60 }), wohnung('og', { areaM2: 40 })],
  tenancies: [mieter('t1', 'eg'), mieter('t2', 'og', { start: '2024-05-01', end: '2025-04-30' }), mieter('t3', 'og', { start: '2025-07-01' })],
  costItems: [direkt('g-eg', 'eg', 150000, 'd-eg'), direkt('g-og', 'og', 100000, 'd-og')],
  heatingPlants: [THERMEN],
  fuelDeliveries: [gasrechnung('d-eg', 'eg', 1800, 20000), gasrechnung('d-og', 'og', 1200, 12000)],
  ...over,
})

test('Etagenheizung (F8, Review Focus 3): 30,0 kg/m² → 40 %, Abzug je Wohnung ohne Normierung, Leerstand beim Vermieter', () => {
  const r = settle(F8())
  const rows = r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map((row): [string, number] => [st.tenancyId, row.shareCents]))
  assert.deepEqual(rows, [['t1', -8000], ['t2', -1578], ['t3', -2420]])
  const co2Share = r.landlord.rows.flatMap((row) => row.landlordParts ?? []).filter((p) => p.reason === 'co2Share').reduce((a, p) => a + p.cents, 0)
  assert.equal(co2Share, 11998)
  const h = r.heating?.[0] ?? assert.fail('keine Anlage in der Abrechnung')
  assert.deepEqual([h.co2?.kgPerM2, h.co2?.stage?.landlordPercent, h.co2?.areaM2, h.co2?.totalCents], [30, 40, 100, 32000])
  assert.ok(!codes(r).includes('co2.exceeds-heating'), codes(r).join(', '))
  // Die eingetragene Fläche der Einstufung geht vor (9.2 Nr. 1): 3.000 kg / 120 m² = 25,0 → 30 %.
  const flaeche = settle(F8({ co2Statements: [co2('hp', { method: 'self', areaM2: 120 })] }))
  assert.equal(flaeche.heating?.[0]?.co2?.stage?.landlordPercent, 30)
})

test('Etagenheizung: CO₂-Kosten über der Gasrechnung einer Wohnung → co2.exceeds-heating, kein Abzug für sie', () => {
  const r = settle(F8({ fuelDeliveries: [gasrechnung('d-eg', 'eg', 1800, 20000), gasrechnung('d-og', 'og', 1200, 120000)] }))
  const n = r.notices.find((x) => x.code === 'co2.exceeds-heating') ?? assert.fail(codes(r).join(', '))
  assert.match(n.text, /Wohnung OG/)
  const tenanten = r.statements.flatMap((st) => st.rows.filter((row) => row.kind === 'co2Relief').map(() => st.tenancyId))
  assert.deepEqual(tenanten, ['t1'])
})

test('Etagenheizung: eine Wohnung ohne Rechnung zählt nicht zur Fläche der Einstufung (§ 5 Abs. 1 Satz 2)', () => {
  const r = settle(F8({ costItems: [direkt('g-eg', 'eg', 150000, 'd-eg')], fuelDeliveries: [gasrechnung('d-eg', 'eg', 1800, 20000)] }))
  const h = r.heating?.[0] ?? assert.fail('keine Anlage')
  // 1.800 kg / 60 m² = 30,0 → 40 %; das OG ohne Rechnung fehlt in der Fläche.
  assert.deepEqual([h.co2?.areaM2, h.co2?.kgPerM2], [60, 30])
})
