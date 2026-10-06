// Beispiel A (Entwurf 8.6) als Schnappschuss ohne Datenbank, für die Tests der eigenen
// Heizkostenabrechnung ab Heizung PR 11 (Prüfbericht vom 05.10.2026, B.1). Dieselben Zahlen wie
// `beispielA` in server/test/calc-heizkostenabrechnung.test.ts (PR 10), das dieselbe Lage über die
// Datenbank baut; ein Test dort hält beide gleich. Feste Kennungen, damit Tests einzelne Datensätze
// treffen: Wohnungen `a`, `b`, `c`; Mietverhältnisse `A`, `B`, `C1` (bis 30.09.), `C2`; Anlage `hp`;
// Wärmezähler `wz-a`, `wz-b`, `wz-c`; Warmwasserzähler `xw-a`, `xw-b`, `xw-c`; Wärmezähler am Speicher
// `ww`; Lieferung `d1`; Positionen `gas`, `strom`, `wartung`, `imm`, `wz`, `wwz`.
//
// Gebaut wird über `snapshotFor`, damit jedes abgeleitete Feld (Lieferungen, Zeilen der Heizperiode,
// eingefrorene Stände) so entsteht wie im Betrieb. Die Datensätze sind nach den Typen des Modells gebaut,
// nicht als freies Objektliteral (CLAUDE.md). Bekommt ein Typ in einer späteren PR ein Pflichtfeld, nennt
// der Übersetzer die Stelle hier; die PR ergänzt es mit dem Wert, den ihre Vorgabe setzt.
import type {
  CostItem, FuelDelivery, HeatingPart, HeatingPeriodData, HeatingPlant, HeatingTarget, Meter, MeterType, Reading, Tenancy, Unit,
} from '../../shared/types.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { snapshotFor, type Snapshot } from '../src/snapshot.ts'

export const SELF_ITEMS = ['gas', 'strom', 'wartung', 'imm', 'wz', 'wwz'] as const

export type SelfSnapshotOptions = {
  // Das Kalenderjahr der Heizperiode; alle Daten verschieben sich mit. Vorgabe 2025.
  year?: number
  plant?: Partial<HeatingPlant>
  // Felder der Zeile dieser Heizperiode (Vorgabe: 70/70 %, Dämmung „trifft nicht zu“, gemessen).
  row?: Partial<HeatingPeriodData>
  // Weitere Zeilen, etwa die der Vorperiode.
  rows?: HeatingPeriodData[]
  // Weitere Anlagen (Kesseltausch) samt ihrer Wohnungen.
  plants?: HeatingPlant[]
  units?: Unit[]
  tenancies?: Tenancy[]
  meters?: Meter[]
  readings?: Reading[]
  deliveries?: FuelDelivery[]
  costItems?: CostItem[]
}

const P = 'objekt-1'

// Die Anlage nach der Einrichtung (PR 10 `setUpSelf`): Gas, eigene Abrechnung, verbundenes Warmwasser,
// Wärmezähler, Grundkosten nach Wohnfläche, Wechsel nach Gradtagen.
const plantOf = (year: number): HeatingPlant => ({
  id: 'hp', propertyId: P, name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null,
  selfSpans: [{ from: periodKey(`${year}-01`), until: null }],
})

// Die Zeile einer Heizperiode, wie `setUpSelf` (PR 10) sie schreibt; alle übrigen Spalten leer.
export function selfRow(over: Partial<HeatingPeriodData> = {}, year = 2025, plantId = 'hp'): HeatingPeriodData {
  return {
    id: `${plantId}-${year}`, plantId, period: periodKey(`${year}-01`),
    heatConsumptionPct: 70, waterConsumptionPct: 70, above70Agreed: null, insulationRule: 'notApplies',
    dhwMethod: 'heatMeter', dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null, dhwUnmeasurable: null,
    infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: null, climateFactorPrev: null, consumerContract: null, infoContactsConfirmed: null,
    stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null,
    openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null,
    ...over,
  }
}

// Die Gasrechnung von Beispiel A: 60.000 kWh über das ganze Jahr, mit CO₂-Angaben (PR 7). Ob nach
// Brennwert oder Heizwert, lässt Beispiel A offen (`gasBasis: null`); für eine Formel setzt der Test es.
export function selfDelivery(over: Partial<FuelDelivery> = {}, year = 2025): FuelDelivery {
  return {
    id: 'd1', plantId: 'hp', label: 'Erdgas', invoiceDate: `${year + 1}-01-15`, deliveredAt: null, invoiceFrom: `${year}-01-01`, invoiceTo: `${year}-12-31`,
    unitId: null, amountCents: null, quantity: null, quantityUnit: null, energyKwh: 60000, gasBasis: null, heatingValue: null, fuelGrade: null,
    emissionsKg: 10883.4, co2CostCents: 59859, emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: 0,
    estimated: false, usedByService: true, parts: [],
    ...over,
  }
}

export const selfUnit = (id: string, areaM2: number, over: Partial<Unit> = {}): Unit => ({ id, propertyId: P, name: id.toUpperCase(), areaM2, participates: true, selfUsed: false, ...over })
export const selfTenancy = (id: string, unitId: string, start: string, end: string | null): Tenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], costModel: 'settlement', heatingModel: 'settlement',
})
export const selfMeter = (id: string, unitId: string | null, name: string, type: MeterType, over: Partial<Meter> = {}): Meter =>
  ({ id, propertyId: P, name, unitId, type, unit: type === 'warmwasser' ? 'm³' : 'kWh', ...over })
export const selfReading = (meterId: string, date: string, value: number): Reading => ({ id: `${meterId}@${date}`, meterId, date, value })

export function selfSnapshot(o: SelfSnapshotOptions = {}): Snapshot {
  const year = o.year ?? 2025
  const key = periodKey(`${year}-01`)
  const period = periodOfKey(CALENDAR_RULES, key)
  if (!period) throw new Error(`Den Zeitraum ${key} gibt es im Kalenderjahr nicht.`)
  const start = `${year - 1}-12-31`
  const change = `${year}-09-30`
  const end = `${year}-12-31`
  const units = o.units ?? [selfUnit('a', 60), selfUnit('b', 80), selfUnit('c', 60)]
  const tenancies = o.tenancies ?? [
    selfTenancy('A', 'a', '2020-01-01', null),
    selfTenancy('B', 'b', '2020-01-01', null),
    selfTenancy('C1', 'c', '2020-01-01', change),
    selfTenancy('C2', 'c', `${year}-10-01`, null),
  ]
  const meters = o.meters ?? [
    selfMeter('wz-a', 'a', 'Wärme A', 'waerme'), selfMeter('xw-a', 'a', 'Warmwasser A', 'warmwasser'),
    selfMeter('wz-b', 'b', 'Wärme B', 'waerme'), selfMeter('xw-b', 'b', 'Warmwasser B', 'warmwasser'),
    selfMeter('wz-c', 'c', 'Wärme C', 'waerme'), selfMeter('xw-c', 'c', 'Warmwasser C', 'warmwasser'),
    selfMeter('ww', null, 'Wärmezähler Warmwasserspeicher', 'waerme', { heatingPlantId: 'hp', heatingRole: 'dhwHeat' }),
  ]
  const readings = o.readings ?? [
    selfReading('wz-a', start, 1000), selfReading('wz-a', end, 13000),
    selfReading('wz-b', start, 0), selfReading('wz-b', end, 16000),
    selfReading('wz-c', start, 500), selfReading('wz-c', change, 7700), selfReading('wz-c', end, 12500),
    selfReading('xw-a', start, 10), selfReading('xw-a', end, 40),
    selfReading('xw-b', start, 0), selfReading('xw-b', end, 40),
    selfReading('xw-c', start, 5), selfReading('xw-c', change, 43), selfReading('xw-c', end, 55),
    selfReading('ww', start, 0), selfReading('ww', end, 9000),
  ]
  const item = (id: string, description: string, amountCents: number, heatingPart: HeatingPart, heatingTarget: HeatingTarget, extra: Partial<CostItem> = {}): CostItem => ({
    id, propertyId: P, period: key, category: HEATING_CATEGORY, description, amountCents, key: 'heatingSystem',
    heatingPlantId: 'hp', heatingPart, heatingTarget, ...extra,
  })
  const costItems = o.costItems ?? [
    item('gas', 'Erdgas', 600000, 'fuel', 'both', { fuelDeliveryId: 'd1' }),
    item('strom', 'Betriebsstrom', 18000, 'operating', 'both'),
    item('wartung', 'Wartung', 24000, 'operating', 'both'),
    item('imm', 'Immissionsmessung', 6000, 'operating', 'both'),
    item('wz', 'Miete Wärmezähler', 12000, 'metering', 'heating'),
    item('wwz', 'Miete Warmwasserzähler', 6000, 'metering', 'water'),
  ]
  const plant: HeatingPlant = { ...plantOf(year), ...o.plant }
  const rows: HeatingPeriodData[] = [selfRow(o.row, year), ...(o.rows ?? [])]
  const deliveries = o.deliveries ?? [selfDelivery({}, year)]
  const source: Parameters<typeof snapshotFor>[0] = {
    units, tenancies, costItems, meters, readings, payments: [], closedSettlements: [],
    heatingPlants: [plant, ...(o.plants ?? [])], heatingPeriodRows: rows, fuelDeliveries: deliveries,
  }
  return snapshotFor(source, P, period)
}
