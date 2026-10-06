// Kesseltausch Öl → Gas mit Restöl (Heizung PR 9): Die Ölheizung endet am 30.06.2025, die Gastherme
// beginnt am 01.07.2025 mit denselben Wohnungen. Der Restbestand im Tank gehört dem Vermieter; die
// Mieter tragen nur den verbrauchten Brennstoff. Abrechnung und Steuer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Statement, FuelDelivery } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Quelle = Parameters<typeof snapshotFor>[0]

const wohnung = (id: string) => ({ id, name: id.toUpperCase(), areaM2: 100, participates: true, propertyId: 'objekt-1' })
const mieter = (id: string, unitId: string) => ({
  id, unitId, tenantName: `Mieter ${unitId.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const UNITS = ['a', 'b', 'c']
const anlage = (over: Partial<SnapshotHeatingPlant> & { id: string }): SnapshotHeatingPlant & { propertyId: string } => ({
  name: over.id, energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
  units: UNITS.map((unitId) => ({ unitId, heatedAreaM2: null })), propertyId: 'objekt-1', ...over,
})
const lieferung = (over: Partial<FuelDelivery> & { id: string; plantId: string }): FuelDelivery => ({
  label: over.id, invoiceDate: null, deliveredAt: null, invoiceFrom: null, invoiceTo: null, unitId: null, amountCents: null, quantity: null, quantityUnit: null,
  energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null, emissionFactor: null, gridFeeCents: null, bioCostCents: null,
  sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: P.key, category: HEATING_CATEGORY, description: over.id, amountCents: 0, key: 'area', heatingPart: 'fuel', ...over,
})

const OEL = anlage({ id: 'oel', name: 'Ölkessel', energy: 'oil', endsOn: '2025-06-30' })
const GAS = anlage({ id: 'gas', name: 'Gastherme', replacesPlantId: 'oel' })
// Anfangsbestand 2.000 l (1.900 €, vor 2023 berechnet), Lieferung 3.000 l zu 3.150 € am 15.03.2025,
// Restbestand 500 l, gepeilt am Tag der Stilllegung. Verbraucht: 4.500 l.
const QUELLE = (over: Partial<Quelle> = {}): Quelle => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: UNITS.map(wohnung), tenancies: UNITS.map((u) => mieter(`t${u}`, u)),
  costItems: [
    position({ id: 'oelrechnung', description: 'Heizöl 15.03.2025', amountCents: 315000, heatingPlantId: 'oel', fuelDeliveryId: 'd-oel' }),
    position({ id: 'gasrechnung', description: 'Gas 07–12/2025', amountCents: 150000, heatingPlantId: 'gas', fuelDeliveryId: 'd-gas' }),
  ],
  meters: [], readings: [], payments: [], closedSettlements: [],
  heatingPlants: [OEL, GAS],
  heatingPeriodRows: [{
    plantId: 'oel', period: P.key, dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000,
    openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 500, closingMeasuredOn: '2025-06-30',
  }],
  fuelDeliveries: [
    lieferung({ id: 'd-oel', plantId: 'oel', label: 'Heizöl 15.03.2025', deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 }),
    lieferung({ id: 'd-gas', plantId: 'gas', label: 'Gas 07–12/2025', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-10', emissionsKg: 3000, co2CostCents: 16500 }),
  ],
  ...over,
})
const snap = (over: Partial<Quelle> = {}) => snapshotFor(QUELLE(over), 'objekt-1', P)
const codes = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string =>
  r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}, sondern: ${codes(r).join(', ')}`)
const rowOf = (r: ComputedSettlement, tenancyId: string, itemId: string): number =>
  r.statements.find((st) => st.tenancyId === tenancyId)?.rows.find((row) => row.costItemId === itemId)?.shareCents ?? assert.fail(`keine Zeile ${itemId} bei ${tenancyId}`)

test('Kesseltausch Öl → Gas mit Restöl: Mieter tragen den Verbrauch, der Restbestand von 525,00 € bleibt mit Wert beim Vermieter', () => {
  const r = computeSettlement(snap())
  const KEY = `stock:oel:${P.key}`
  // Je Mieter: aus dem Vorrat +633,33 €, im Vorrat (Restbestand) −175,00 €.
  for (const t of ['ta', 'tb', 'tc']) assert.equal(rowOf(r, t, `${KEY}:out`), -17500)
  const rest = r.landlord.rows.find((row) => row.costItemId === `${KEY}:remaining`) ?? assert.fail('kein Restbestand beim Vermieter')
  assert.deepEqual([rest.shareCents, rest.landlordParts], [52500, [{ reason: 'stockRemaining', cents: 52500 }]])
  assert.match(rest.description, /Restbestand/)
  const gegen = r.landlord.rows.find((row) => row.costItemId === KEY) ?? assert.fail('keine Gegenzeile')
  assert.deepEqual(gegen.landlordParts, [{ reason: 'fuelCarry', cents: -190000 }])
  // Σ aller Zeilen = Σ der Rechnungen (Entwurf 12.3 Nr. 1): 3.150 € Öl + 1.500 € Gas.
  assert.equal(r.totalCostsCents, 465000)
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 465000)
  const hinweis = textOf(r, 'fuel.stock-remaining')
  assert.match(hinweis, /Heizanlage „Ölkessel“ ist seit dem 01\.07\.2025 außer Betrieb/)
  assert.match(hinweis, /Restbestand von 500 l im Wert von 525,00 €/)
  assert.match(hinweis, /§ 7 Abs\. 2 HeizkostenV/)
  // Die Gastherme beginnt am 01.07.2025: keine Lücke für das erste Halbjahr.
  assert.ok(!codes(r).includes('fuel.uncovered'), codes(r).join(', '))
  // Gleiche Wohnungen an beiden Anlagen sind kein Fehler, und keine Position reicht über zwei Anlagen.
  assert.ok(!codes(r).includes('co2.item-spans-plants'), codes(r).join(', '))
  // Gepeilt am Tag der Stilllegung: kein Hinweis auf eine Peilung neben dem Ende.
  assert.ok(!codes(r).includes('fuel.stock-date-differs'), codes(r).join(', '))
})

test('Kesseltausch: eingestuft wird das Gebäude über den Ausstoß beider Anlagen im Jahr (§ 5 Abs. 1 Satz 1 CO2KostAufG)', () => {
  const r = computeSettlement(snap())
  const oel = r.heating?.find((h) => h.plantId === 'oel') ?? assert.fail('keine Ölheizung')
  const gas = r.heating?.find((h) => h.plantId === 'gas') ?? assert.fail('keine Gastherme')
  // Öl verbraucht 12.043,35 kg (5.352,6 + 8.028,9 − 1.338,15), Gas 3.000 kg: 15.043,35 kg / 300 m² = 50,1 → 80 %.
  // Allein wären es 40,1 (60 %) und 10,0 (0 %).
  assert.deepEqual([oel.co2?.kgPerM2, oel.co2?.stage?.landlordPercent], [50.1, 80])
  assert.deepEqual([gas.co2?.kgPerM2, gas.co2?.stage?.landlordPercent], [50.1, 80])
  assert.equal(gas.co2?.landlordCents, 13200)
  assert.match(textOf(r, 'co2.plant-replaced'), /Ausstoß beider Heizanlagen/)
})

test('Kesseltausch in der Steuer: die Rechnungen voll als Werbungskosten, der Restbestand mindert nichts', () => {
  const tax = taxReport(snap())
  const items = tax.expenses.items.filter((x) => x.costItemId === 'oelrechnung' || x.costItemId === 'gasrechnung')
  assert.deepEqual(items.map((x) => [x.costItemId, x.deductibleCents]).sort(), [['gasrechnung', 150000], ['oelrechnung', 315000]])
  assert.ok(!tax.expenses.items.some((x) => x.costItemId.startsWith('stock:')), 'Überträge und Restbestand sind keine Werbungskosten')
  assert.equal(tax.expenses.deductibleCents, 465000)
})

test('Nach dem Kesseltausch: im Folgejahr rechnet nur die Gastherme, die alte Anlage meldet nichts', () => {
  const P2 = periodOfKey(CALENDAR_RULES, periodKey('2026-01')) ?? assert.fail('kein Zeitraum 2026')
  const r = computeSettlement(snapshotFor(QUELLE({
    costItems: [position({ id: 'gas26', period: P2.key, amountCents: 300000, heatingPlantId: 'gas', fuelDeliveryId: 'd-gas26' })],
    fuelDeliveries: [lieferung({ id: 'd-gas26', plantId: 'gas', invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31', emissionsKg: 6000, co2CostCents: 33000 })],
  }), 'objekt-1', P2))
  assert.ok(!r.notices.some((n) => n.subject?.id === 'oel'), codes(r).join(', '))
  assert.deepEqual(r.heating?.map((h) => h.plantId), ['gas'])
})

// ---------- Befunde der Durchsicht von #238 ----------

const jahr = (y: number) => periodOfKey(CALENDAR_RULES, periodKey(`${y}-01`)) ?? assert.fail(`kein Zeitraum ${y}`)
const heizkosten = (r: ComputedSettlement): number =>
  r.statements.reduce((a, st) => a + st.rows.filter((row) => row.category === HEATING_CATEGORY && row.kind !== 'co2Relief').reduce((b, row) => b + row.shareCents, 0), 0)

test('C1: nach zwei Täuschen (Öl → Gas → Gas neu) gehört die Position der dritten Anlage zu ihrem Topf', () => {
  const P3 = jahr(2027)
  const r = computeSettlement(snapshotFor(QUELLE({
    heatingPlants: [
      anlage({ id: 'A', name: 'Öl', energy: 'oil', endsOn: '2024-12-31' }),
      anlage({ id: 'A2', name: 'Gas', endsOn: '2026-06-30', replacesPlantId: 'A' }),
      anlage({ id: 'A3', name: 'Gas neu', replacesPlantId: 'A2' }),
    ],
    heatingPeriodRows: [],
    costItems: [position({ id: 'gas27', period: P3.key, amountCents: 300000, heatingPlantId: 'A3', fuelDeliveryId: 'd27' })],
    fuelDeliveries: [lieferung({ id: 'd27', plantId: 'A3', invoiceFrom: '2027-01-01', invoiceTo: '2027-12-31', emissionsKg: 6000, co2CostCents: 33000 })],
  }), 'objekt-1', P3))
  assert.ok(!codes(r).includes('co2.item-spans-plants'), codes(r).join(', '))
  assert.equal(r.heating?.find((h) => h.plantId === 'A3')?.co2?.totalCents, 33000)
})

test('Recht I1: Öl → Öl, der Restbestand ist der Anfangsbestand der neuen Anlage; nichts bleibt beim Vermieter', () => {
  const r = computeSettlement(snap({
    heatingPlants: [OEL, anlage({ id: 'oel2', name: 'Neuer Kessel', energy: 'oil', replacesPlantId: 'oel' })],
    costItems: [
      position({ id: 'oelrechnung', amountCents: 315000, heatingPlantId: 'oel', fuelDeliveryId: 'd-oel' }),
      position({ id: 'oelrechnung2', amountCents: 105000, heatingPlantId: 'oel2', fuelDeliveryId: 'd-oel2' }),
    ],
    heatingPeriodRows: [
      { plantId: 'oel', period: P.key, dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000,
        openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 500, closingMeasuredOn: '2025-06-30' },
      { plantId: 'oel2', period: P.key, dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', closingQuantity: 300, closingMeasuredOn: '2025-12-31' },
    ],
    fuelDeliveries: [
      lieferung({ id: 'd-oel', plantId: 'oel', deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 }),
      lieferung({ id: 'd-oel2', plantId: 'oel2', deliveredAt: '2025-10-15', invoiceDate: '2025-10-15', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676.3, co2CostCents: 17516 }),
    ],
  }))
  assert.ok(!codes(r).includes('fuel.stock-remaining'), codes(r).join(', '))
  assert.ok(!r.landlord.rows.some((row) => row.costItemId.endsWith(':remaining')))
  // Die neue Anlage übernimmt 500 l zu 525 €; am Ende 300 l aus der Lieferung im Oktober (315 €).
  const neu = r.heating?.find((h) => h.plantId === 'oel2')?.stock ?? assert.fail('keine Bestandsrechnung der neuen Anlage')
  assert.deepEqual([neu.opening.quantity, neu.opening.costCents, neu.closing.costCents], [500, 52500, 31500])
  // Die Mieter tragen den Verbrauch beider Kessel: 1.900 + 3.150 + 1.050 − 315 = 5.785 €.
  assert.equal(heizkosten(r), 578500)
  assert.equal(r.statements.reduce((a, st) => a + st.totalShareCents, 0) + r.landlord.totalCents, 420000)
})

const MESSDIENST_GAS = (over: Partial<Co2Statement> = {}) => ({
  heatingPlants: [OEL, anlage({ id: 'gas', name: 'Gastherme', method: 'service', replacesPlantId: 'oel' })],
  costItems: [
    position({ id: 'oelrechnung', amountCents: 315000, heatingPlantId: 'oel', fuelDeliveryId: 'd-oel' }),
    position({ id: 'gasmd', amountCents: 150000, key: 'amounts', tenancyAmounts: { ta: 50000, tb: 50000, tc: 50000 }, heatingPlantId: 'gas', heatingPart: undefined }),
  ],
  co2Statements: [{
    heatingPeriodId: 'h-gas', plantId: 'gas', period: P.key, method: 'serviceShown' as const, areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null,
    serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
    serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
    serviceFuelNetCents: null, reliefs: [], ...over,
  }],
})

test('I2: Kennt Mietfuchs den Ausstoß der Nachfolgerin nicht, sagt die Einstufung der alten Anlage das; mit der Angabe des Messdienstes stuft sie gemeinsam ein', () => {
  const ohne = computeSettlement(snap(MESSDIENST_GAS()))
  const n = ohne.notices.find((x) => x.code === 'co2.classification-incomplete') ?? assert.fail(codes(ohne).join(', '))
  assert.deepEqual([n.level, n.subject], ['warning', { kind: 'heatingCosts', id: 'oel' }])
  assert.match(n.text, /„Gastherme“ als Vorgängerin oder Nachfolgerin/)
  assert.equal(ohne.heating?.find((h) => h.plantId === 'oel')?.co2?.kgPerM2, 40.1)
  const mit = computeSettlement(snap(MESSDIENST_GAS({ serviceEmissionsKg: 3000 })))
  assert.ok(!codes(mit).includes('co2.classification-incomplete'), codes(mit).join(', '))
  assert.equal(mit.heating?.find((h) => h.plantId === 'oel')?.co2?.kgPerM2, 50.1)
})

test('Recht I3: Anlagen im selben Gebäude werden gemeinsam eingestuft, in getrennten Gebäuden je für sich', () => {
  const haus = (buildingWith: string | null) => snap({
    heatingPlants: [
      anlage({ id: 'H1', name: 'Zentral', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] }),
      anlage({ id: 'H2', name: 'Therme C', supply: 'perUnit', units: [{ unitId: 'c', heatedAreaM2: null }], buildingWith }),
    ],
    heatingPeriodRows: [],
    costItems: [
      position({ id: 'g1', amountCents: 200000, heatingPlantId: 'H1', fuelDeliveryId: 'd1', participantUnitIds: ['a', 'b'] }),
      position({ id: 'g2', amountCents: 100000, key: 'direct', directUnitId: 'c', heatingPlantId: 'H2', fuelDeliveryId: 'd2' }),
    ],
    fuelDeliveries: [
      lieferung({ id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 }),
      lieferung({ id: 'd2', plantId: 'H2', unitId: 'c', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 }),
    ],
  })
  const stufe = (r: ComputedSettlement) => r.heating?.map((h) => [h.plantId, h.co2?.kgPerM2, h.co2?.stage?.landlordPercent])
  // Getrennt: 6.000 kg auf 200 m² = 30,0 (40 %), 6.000 kg auf 100 m² = 60,0 (95 %).
  assert.deepEqual(stufe(computeSettlement(haus('own'))), [['H1', 30, 40], ['H2', 60, 95]])
  // Gemeinsam: 12.000 kg auf 300 m² = 40,0 (60 %), mit Hinweis auf die Auslegung.
  const gemeinsam = computeSettlement(haus('H1'))
  assert.deepEqual(stufe(gemeinsam), [['H1', 40, 60], ['H2', 40, 60]])
  assert.match(textOf(gemeinsam, 'co2.building-joint'), /höchstrichterlich nicht geklärt/)
})

test('Recht I2 und Geld M5: eine Position über zwei Anlagen nennt die Folge, die Kürzung und den Handgriff, ohne Norm für „je Anlage“', () => {
  const r = computeSettlement(snap({
    heatingPlants: [
      anlage({ id: 'H1', name: 'Haus A', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] }),
      anlage({ id: 'H2', name: 'Haus B', units: [{ unitId: 'c', heatedAreaM2: null }], buildingWith: 'own' }),
    ],
    heatingPeriodRows: [],
    costItems: [position({ id: 'g1', description: 'Gas', amountCents: 300000, heatingPlantId: 'H1', fuelDeliveryId: 'd1' })],
    fuelDeliveries: [lieferung({ id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 })],
  }))
  const t = textOf(r, 'co2.item-spans-plants')
  assert.doesNotMatch(t, /§ 5 Abs\. 1/)
  assert.match(t, /mindert sie keinen CO₂-Abzug, und die Mieter tragen den CO₂-Anteil darin mit/)
  assert.match(t, /um 3 % kürzen \(§ 7 Abs\. 4 CO2KostAufG\), hier:/)
  assert.match(t, /unter „Weitere Optionen: nur bestimmte Wohnungen beteiligen“ die Wohnungen von „Haus A“ \(A, B\)/)
})

test('Nach dem Ende: keine Kette für die stillgelegte Anlage im Schnappschuss, und eine Rechnung über ihr Ende hinaus (Archiv) rechnet nicht mit', () => {
  const P26 = jahr(2026)
  // Der Schnappschuss 2026 führt für den Ölkessel keine Bestandskette mehr.
  const s = snapshotFor(QUELLE(), 'objekt-1', P26)
  assert.deepEqual((s.stockChains ?? []).map((c) => c.plantId), [])
  // Eine Gasrechnung der alten Anlage, die über ihren letzten Betriebstag hinausreicht, kann über die Routen
  // nicht entstehen, in einem Archiv aber stehen: Im Zeitraum danach rechnet die alte Anlage nicht.
  const GASALT = anlage({ id: 'gasalt', name: 'Gas alt', endsOn: '2025-06-30' })
  const FERN = anlage({ id: 'fern', name: 'Fernwärme', energy: 'districtHeating', replacesPlantId: 'gasalt' })
  const r = computeSettlement(snapshotFor(QUELLE({
    heatingPlants: [GASALT, FERN],
    heatingPeriodRows: [],
    costItems: [position({ id: 'fw', period: P26.key, amountCents: 200000, heatingPlantId: 'fern', fuelDeliveryId: 'dfw' })],
    fuelDeliveries: [
      lieferung({ id: 'dalt', plantId: 'gasalt', invoiceFrom: '2026-01-01', invoiceTo: '2026-03-31', emissionsKg: 900, co2CostCents: 5000 }),
      lieferung({ id: 'dfw', plantId: 'fern', invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31', emissionsKg: 3000, co2CostCents: 16500 }),
    ],
  }), 'objekt-1', P26))
  assert.ok(!r.heating?.some((h) => h.plantId === 'gasalt' && h.fuel), JSON.stringify(r.heating?.map((h) => h.plantId)))
})

// ---------- Nachprüfung von #238 ----------

const ZWEI_HAEUSER = (over: Partial<Quelle> = {}): Partial<Quelle> => ({
  heatingPlants: [
    anlage({ id: 'H1', name: 'Zentral AB', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] }),
    anlage({ id: 'H2', name: 'Zentral C', units: [{ unitId: 'c', heatedAreaM2: null }], buildingWith: 'H1' }),
  ],
  heatingPeriodRows: [],
  costItems: [
    position({ id: 'g1', amountCents: 200000, heatingPlantId: 'H1', fuelDeliveryId: 'd1', participantUnitIds: ['a', 'b'] }),
    position({ id: 'g2', amountCents: 100000, key: 'direct', directUnitId: 'c', heatingPlantId: 'H2', fuelDeliveryId: 'd2' }),
  ],
  fuelDeliveries: [
    lieferung({ id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 12000, co2CostCents: 66000 }),
    lieferung({ id: 'd2', plantId: 'H2', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 3000, co2CostCents: 16500 }),
  ],
  ...over,
})
const selfArea = (plantId: string, areaM2: number): Co2Statement => ({
  heatingPeriodId: `h-${plantId}`, plantId, period: P.key, method: 'self', areaM2, serviceEmissionsKg: null, serviceAreaM2: null,
  serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null,
  serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null,
  serviceFuelNetCents: null, reliefs: [],
})

test('I-A: eine eingetragene Fläche einer Anlage im selben Gebäude zählt mit der Fläche der anderen, nicht statt ihrer', () => {
  // 15.000 kg auf 300 m²: eingetragen 180 m² an „Zentral AB“, dazu 100 m² der Wohnung C = 280 m², 53,6 kg/m².
  const r = computeSettlement(snap(ZWEI_HAEUSER({ co2Statements: [selfArea('H1', 180)] })))
  assert.deepEqual(r.heating?.map((h) => [h.plantId, h.co2?.kgPerM2, h.co2?.areaM2]), [['H1', 53.6, 280], ['H2', 53.6, 280]])
  assert.match(textOf(r, 'co2.building-joint'), /15\.000 kg CO₂ auf 280 m²; je Anlage zählt die eingetragene Fläche, sonst die ihrer Wohnungen, jede Wohnung einmal/)
  // Probe B2: 200 m² eingetragen ergibt dieselbe Stufe wie ohne Eintrag (50 kg/m²).
  const b2 = computeSettlement(snap(ZWEI_HAEUSER({ co2Statements: [selfArea('H1', 200)] })))
  const ohne = computeSettlement(snap(ZWEI_HAEUSER()))
  assert.deepEqual(b2.heating?.map((h) => h.co2?.kgPerM2), [50, 50])
  assert.equal(b2.landlord.totalCents, ohne.landlord.totalCents)
})

test('I-C (Probe B4): Verweisen zwei Anlagen im Kreis aufeinander (Archiv), stehen sie im selben Gebäude', () => {
  const kreis = ZWEI_HAEUSER()
  const [h1, h2] = kreis.heatingPlants ?? []
  if (!h1 || !h2) assert.fail('zwei Anlagen erwartet')
  const r = computeSettlement(snap({ ...kreis, heatingPlants: [{ ...h1, buildingWith: 'H2' }, h2] }))
  assert.deepEqual(r.heating?.map((h) => h.co2?.kgPerM2), [50, 50])
})

test('N1: Eine Anlage, die im Zeitraum nicht heizt, macht eine Position nicht zur Position über zwei Anlagen', () => {
  const r = computeSettlement(snap({
    heatingPlants: [
      anlage({ id: 'H1', name: 'Zentral', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] }),
      // Die Therme der Wohnung C ist 2024 stillgelegt worden.
      anlage({ id: 'H2', name: 'Therme C', units: [{ unitId: 'c', heatedAreaM2: null }], buildingWith: 'own', endsOn: '2024-12-31' }),
    ],
    heatingPeriodRows: [],
    costItems: [position({ id: 'g1', amountCents: 300000, heatingPlantId: 'H1', fuelDeliveryId: 'd1' })],
    fuelDeliveries: [lieferung({ id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 })],
  }))
  assert.ok(!codes(r).includes('co2.item-spans-plants'), codes(r).join(', '))
})

test('Gasrechnung bis zum Tausch, erst im Folgejahr gebucht: die Mieter tragen sie einmal, im Jahr der Lieferung', () => {
  const P26 = jahr(2026)
  const quelle = QUELLE({
    heatingPlants: [anlage({ id: 'gasalt', name: 'Gas alt', endsOn: '2025-06-30' }), anlage({ id: 'fern', name: 'Fernwärme', energy: 'districtHeating', replacesPlantId: 'gasalt' })],
    heatingPeriodRows: [],
    costItems: [
      position({ id: 'alt', period: P26.key, amountCents: 100000, heatingPlantId: 'gasalt', fuelDeliveryId: 'dalt' }),
      position({ id: 'fw', period: P26.key, amountCents: 240000, heatingPlantId: 'fern', fuelDeliveryId: 'dfw' }),
    ],
    fuelDeliveries: [
      lieferung({ id: 'dalt', plantId: 'gasalt', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', emissionsKg: 900, co2CostCents: 5000 }),
      lieferung({ id: 'dfw', plantId: 'fern', invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31', emissionsKg: 3000, co2CostCents: 16500 }),
    ],
  })
  const tenants = (y: number) => computeSettlement(snapshotFor(quelle, 'objekt-1', jahr(y))).statements.reduce((a, st) => a + st.totalShareCents, 0)
  // 2025: 1.000 € aus der Rechnung des Folgejahres; 2026 nur die Fernwärme.
  assert.deepEqual([tenants(2025), tenants(2026)], [100000, 240000])
})
