// Ein Objekt mit drei Wohnungen (600 m²) und einer Gasheizung nach § 43 Abs. 1 GModG im Rhythmus Mai–April,
// für die Tests der hälftigen Teilung (Heizung PR 18, #215). Liegt in testing/, weil node --test jede Datei unter
// test/ ausführt (CLAUDE.md).
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, type SnapshotCostItem, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { FuelDelivery, PeriodRules } from '../../shared/types.ts'

export const MAI: PeriodRules = { startMonth: 5, changes: [] }
export type Quelle = Parameters<typeof snapshotFor>[0]

export const plant = (over: Partial<SnapshotHeatingPlant> = {}): SnapshotHeatingPlant & { propertyId: string } => ({
  id: 'hp', name: 'Gas', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
  gmodg43InstalledOn: '2027-03-01', emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null,
  propertyId: 'objekt-1', ...over,
})
export const delivery = (over: Partial<FuelDelivery> = {}): FuelDelivery => ({
  id: 'd', plantId: 'hp', label: 'Gas 2027/2028', invoiceDate: null, deliveredAt: null, invoiceFrom: '2027-05-01', invoiceTo: '2028-04-30', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: 24105.6, co2CostCents: 77379,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [], ...over,
})
export const item = (over: Partial<SnapshotCostItem> & { id: string }): SnapshotCostItem & { propertyId: string } => ({
  propertyId: 'objekt-1', period: periodKey('2027-05'), category: HEATING_CATEGORY, description: 'Gas', amountCents: 900000, key: 'area',
  heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId: 'd', ...over,
})
export const tenant = (id: string, unitId: string) => ({
  id, unitId, tenantName: `Mieter ${unitId.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})

// Drei Wohnungen mit 300, 180 und 120 m², Gas 9.000 € nach Fläche; die Gasrechnung deckt die Heizperiode genau
// (24.105,6 kg, CO₂-Kosten 773,79 €; 40,2 kg/m² → Stufe 60 %, Beispiel B1 des Entwurfs 9.4).
export function three(over: Partial<Quelle> = {}): Quelle {
  return {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, tightMarket: null, periodRules: MAI }],
    units: [
      { id: 'a', name: 'A', areaM2: 300, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 180, participates: true, propertyId: 'objekt-1' },
      { id: 'c', name: 'C', areaM2: 120, participates: true, propertyId: 'objekt-1' },
    ],
    tenancies: [tenant('ta', 'a'), tenant('tb', 'b'), tenant('tc', 'c')],
    costItems: [item({ id: 'gas' })],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [plant()],
    fuelDeliveries: [delivery()],
    ...over,
  }
}

export function settle(key: string, over: Partial<Quelle> = {}): ComputedSettlement {
  const p = periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
  return computeSettlement(snapshotFor(three(over), 'objekt-1', p))
}
export const reliefOf = (r: ComputedSettlement, tenancyId: string, kind: 'co2Relief' | 'gmodgRelief'): number =>
  r.statements.find((s) => s.tenancyId === tenancyId)?.rows.filter((row) => row.kind === kind).reduce((a, row) => a + row.shareCents, 0) ?? 0
export const partsOf = (r: ComputedSettlement, costItemId: string) =>
  r.landlord.rows.filter((row) => row.costItemId === costItemId).flatMap((row) => row.landlordParts ?? [])
export const sumOf = (r: ComputedSettlement): number =>
  r.statements.reduce((a, s) => a + s.rows.reduce((b, row) => b + row.shareCents, 0), 0) + r.landlord.rows.reduce((a, row) => a + row.shareCents, 0)
export const codesOf = (r: ComputedSettlement): string[] => r.notices.map((n) => n.code)
export function textOf(r: ComputedSettlement, code: string): string {
  const n = r.notices.find((x) => x.code === code)
  if (!n) assert.fail(`kein Hinweis ${code}, sondern: ${codesOf(r).join(', ')}`)
  return n.text
}
export const textsOf = (r: ComputedSettlement, code: string): string[] => r.notices.filter((x) => x.code === code).map((x) => x.text)
