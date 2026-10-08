// Das Blatt „CO₂-Angaben für den Messdienst“ nach der Durchsicht von #246, Runde 4: Abgrenzung bei einer Lücke,
// Stufe, Weg d und Fläche aus der Abrechnung, der Anfangsbestand aus der Vorperiode und der Vermerk, wenn die
// Bestandsrechnung nicht aufgeht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { co2SheetFor } from '../src/co2Sheet.ts'
import { heatingSnapshotFor, snapshotFor, type SnapshotCostItem, type SnapshotHeatingPeriodRow, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { co2Source } from '../testing/co2Snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Sheet, FuelDelivery, HeatingStatement } from '../../shared/types.ts'

const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum 2025')
type Src = ReturnType<typeof co2Source>

function both(src: Src, plantId = 'hp'): { sheet: Co2Sheet; heating: HeatingStatement | null } {
  const sheet = co2SheetFor(src, 'objekt-1', plantId, P, '2026-10-07') ?? assert.fail('kein Blatt')
  const s = computeSettlement(snapshotFor(src, 'objekt-1', P))
  return { sheet, heating: s.heating?.find((h) => h.plantId === plantId) ?? null }
}

const oel: Partial<FuelDelivery> = { deliveredAt: '2025-03-15', invoiceDate: '2025-03-15', invoiceFrom: null, invoiceTo: null, quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549, label: 'Heizöl März' }
const row = (period: string, over: Partial<SnapshotHeatingPeriodRow>): SnapshotHeatingPeriodRow => ({
  plantId: 'hp', period: periodKey(period), dhwMethod: null, dhwUnmeasurable: null, stockUnit: 'l', openingQuantity: null, openingCostCents: null, openingEmissionsKg: null,
  openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null, ...over,
})
function oelSource(rows: SnapshotHeatingPeriodRow[], linked = true): Src {
  const src = co2Source(2025, oel, [], { energy: 'oil' })
  return {
    ...src,
    costItems: src.costItems.map((c) => ({ ...c, amountCents: 315000, fuelDeliveryId: linked ? c.fuelDeliveryId : null })),
    heatingPeriodRows: rows,
  }
}
const VORRAT = row('2025-01', { openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 17517, openingInvoicedBefore2023: false, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' })

test('Gegenmutation a: bei einer Lücke ist die abgegrenzte Zeile die Summe der abgegrenzten Teile, nicht die hochgerechneten kg', () => {
  // Eine Gasrechnung Juli 2024 bis Juni 2025: Sie deckt die Heizperiode 2025 nur zum Teil ab.
  const src = co2Source(2025, { invoiceFrom: '2024-07-01', invoiceTo: '2025-06-30', invoiceDate: '2025-07-10', emissionsKg: 10000, co2CostCents: 65450 })
  const { sheet, heating } = both(src)
  const fuel = heating?.fuel ?? assert.fail('keine Abgrenzung')
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  const inPeriod = sheet.billing.inPeriod ?? assert.fail('keine abgegrenzte Zeile')
  assert.ok(inPeriod.coveragePermille < 1000, `Abdeckung ${inPeriod.coveragePermille}`)
  const teile = fuel.deliveries.reduce((a, l) => a + (l.emissionsKg ?? 0), 0)
  assert.ok(Math.abs(inPeriod.emissionsKg - teile) < 1e-6, `${inPeriod.emissionsKg} gegen ${teile}`)
  assert.ok(inPeriod.emissionsKg < 10000, `nicht hochgerechnet: ${inPeriod.emissionsKg}`)
  // Die Abrechnung rechnet nur die kg hoch, die CO₂-Kosten nicht: € der Zeile = € der Grundlage.
  assert.equal(inPeriod.co2Cents, co2.totalCents)
  assert.deepEqual([sheet.billing.basis?.emissionsKg, sheet.billing.basis?.co2Cents], [co2.emissionsKg, co2.totalCents])
  assert.ok((co2.emissionsKg ?? 0) > inPeriod.emissionsKg + 1, 'die Grundlage ist hochgerechnet')
})

test('Gegenmutation b: die Stufe kommt aus der Abrechnung', () => {
  const { sheet, heating } = both(oelSource([VORRAT]))
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.ok(co2.stage, 'die Abrechnung stuft ein')
  assert.deepEqual(sheet.billing.basis?.stage, co2.stage)
  assert.equal(sheet.billing.basis?.areaM2, co2.areaM2)
})

test('Gegenmutation c: nach Weg d liest das Blatt die eigene Heizkostenabrechnung der Heizperiode', () => {
  // Die Anlage rechnet Mai bis April und gesondert ab (Weg d); das Objekt im Kalenderjahr.
  const H = periodKey('2025-05')
  const h = periodOfKey({ startMonth: 5, changes: [] }, H) ?? assert.fail('keine Heizperiode')
  const base = co2Source(2025, { invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', invoiceDate: '2026-05-10', emissionsKg: 9000, co2CostCents: 58905 }, [], {
    periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], separateSettlement: true,
  })
  const src: Src = { ...base, costItems: base.costItems.map((c) => ({ ...c, period: H })) }
  const sheet = co2SheetFor(src, 'objekt-1', 'hp', h, '2026-10-07') ?? assert.fail('kein Blatt')
  const snap = heatingSnapshotFor(src, 'objekt-1', 'hp', h) ?? assert.fail('kein Schnappschuss')
  const heating = computeSettlement(snap).heating?.find((x) => x.plantId === 'hp') ?? assert.fail('keine Anlage in der Heizkostenabrechnung')
  const co2 = heating.co2 ?? assert.fail('keine CO₂-Aufteilung')
  assert.ok(sheet.billing.basis, 'das Blatt nennt die Grundlage der eigenen Heizkostenabrechnung')
  assert.deepEqual([sheet.billing.basis?.emissionsKg, sheet.billing.basis?.co2Cents, sheet.billing.basis?.kgPerM2], [co2.emissionsKg, co2.totalCents, co2.kgPerM2])
  assert.equal(sheet.billing.inPeriod?.coveragePermille, 1000)
})

test('Fläche aus der Abrechnung: zwei Anlagen im selben Gebäude, das Blatt nennt die gemeinsame Fläche der Einstufung', () => {
  const base = co2Source(2025, {})
  const anlage = (over: Partial<SnapshotHeatingPlant> & { id: string }): SnapshotHeatingPlant & { propertyId: string } => ({
    name: over.id, energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null,
    units: null, propertyId: 'objekt-1', ...over,
  })
  const position = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
    propertyId: 'objekt-1', period: P.key, category: HEATING_CATEGORY, description: over.id, amountCents: 0, key: 'area', heatingPart: 'fuel', ...over,
  })
  const d = base.fuelDeliveries[0] ?? assert.fail('keine Lieferung')
  const src: Src = {
    ...base,
    heatingPlants: [
      anlage({ id: 'H1', name: 'Zentral A', units: [{ unitId: 'a', heatedAreaM2: null }] }),
      anlage({ id: 'H2', name: 'Zentral B', units: [{ unitId: 'b', heatedAreaM2: null }], buildingWith: 'H1' }),
    ],
    costItems: [
      position({ id: 'g1', amountCents: 200000, heatingPlantId: 'H1', fuelDeliveryId: 'd1', participantUnitIds: ['a'] }),
      position({ id: 'g2', amountCents: 100000, key: 'direct', directUnitId: 'b', heatingPlantId: 'H2', fuelDeliveryId: 'd2' }),
    ],
    fuelDeliveries: [
      { ...d, id: 'd1', plantId: 'H1', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 6000, co2CostCents: 33000 },
      { ...d, id: 'd2', plantId: 'H2', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 3000, co2CostCents: 16500 },
    ],
  }
  const { sheet, heating } = both(src, 'H1')
  const co2 = heating?.co2 ?? assert.fail('keine CO₂-Aufteilung')
  // Gemeinsam: 9.000 kg auf 100 m² (60 + 40); die eigene Anlage versorgt nur 60 m².
  assert.equal(co2.areaM2, 100)
  assert.deepEqual([sheet.areaM2, sheet.areaSource], [100, 'building'])
})

test('Fläche aus der Abrechnung: ohne zweite Anlage bleibt sie die der versorgten Wohnungen', () => {
  const { sheet, heating } = both(oelSource([VORRAT]))
  assert.deepEqual([sheet.areaM2, sheet.areaSource], [heating?.co2?.areaM2, 'served'])
})

test('S-K1, Vorperiode: Ein übernommener Anfangsbestand ist als übernommen gekennzeichnet', () => {
  const vorjahr = row('2024-01', { openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 35034, openingInvoicedBefore2023: false, closingQuantity: 1000, closingMeasuredOn: '2024-12-31' })
  const { sheet } = both(oelSource([vorjahr, row('2025-01', { closingQuantity: 1800, closingMeasuredOn: '2025-12-31' })]))
  const o = sheet.opening ?? assert.fail('kein Anfangsbestand')
  assert.equal(o.source, 'carried')
  assert.equal(o.co2CostCents, o.countedCents)
  assert.equal(both(oelSource([VORRAT])).sheet.opening?.source, 'entered')
})

test('Klein 2: geht die Bestandsrechnung nicht auf, sagt der Vermerk genau das, einmal „nicht berücksichtigt“', () => {
  const note = both(oelSource([VORRAT], false)).sheet.opening?.note ?? assert.fail('kein Vermerk')
  assert.equal(note, 'Nicht berücksichtigt: Die Bestandsrechnung des Vorrats (Heizperiode 2025) geht nicht auf.')
})
