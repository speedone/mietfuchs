// Kesseltausch Öl → Gas mit Restöl (Heizung PR 9): Die Ölheizung endet am 30.06.2025, die Gastherme
// beginnt am 01.07.2025 mit denselben Wohnungen. Der Restbestand im Tank gehört dem Vermieter; die
// Mieter tragen nur den verbrauchten Brennstoff. Abrechnung und Steuer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { FuelDelivery } from '../../shared/types.ts'

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
