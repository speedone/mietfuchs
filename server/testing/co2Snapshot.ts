// Eine Abrechnung mit Gasanlage (freie Schlüssel), einer Heizposition und einer verknüpften Lieferung, für
// die Tests der CO₂-Plausibilität (Heizung PR 17). Liegt in testing/, weil node --test jede Datei unter
// test/ als Test ausführt.
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, type SnapshotHeatingPlant } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { FuelDelivery, LawOverride } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]

export function co2Source(year: number, delivery: Partial<FuelDelivery>, overrides: LawOverride[] = [], plant: Partial<SnapshotHeatingPlant> = {}): Source {
  const d: FuelDelivery = {
    id: 'd', plantId: 'hp', label: 'Gasrechnung', invoiceDate: `${year + 1}-01-20`, deliveredAt: null, invoiceFrom: `${year}-01-01`, invoiceTo: `${year}-12-31`,
    unitId: null, amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null,
    emissionsKg: 10000, co2CostCents: null, emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null,
    estimated: false, usedByService: true, parts: [], ...delivery,
  }
  return {
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [
      { id: 'a', name: 'A', areaM2: 60, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'B', areaM2: 40, participates: true, propertyId: 'objekt-1' },
    ],
    tenancies: ['a', 'b'].map((u) => ({
      id: `t${u}`, unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, personHistory: [], start: '2020-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    })),
    costItems: [{
      id: 'gas', propertyId: 'objekt-1', period: periodKey(`${year}-01`), category: HEATING_CATEGORY, description: 'Gas', amountCents: 300000, key: 'area',
      heatingPlantId: 'hp', fuelDeliveryId: 'd',
    }],
    meters: [], readings: [], payments: [], closedSettlements: [],
    heatingPlants: [{
      id: 'hp', name: 'Kessel', energy: 'gas', method: 'manual', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null,
      propertyId: 'objekt-1', ...plant,
    }],
    fuelDeliveries: [d],
    lawOverrides: overrides,
  }
}

export function settleWithDelivery(year: number, delivery: Partial<FuelDelivery>, overrides: LawOverride[] = [], plant: Partial<SnapshotHeatingPlant> = {}): ComputedSettlement {
  const P = periodOfKey(CALENDAR_RULES, periodKey(`${year}-01`))
  if (!P) throw new Error(`kein Zeitraum ${year}`)
  return computeSettlement(snapshotFor(co2Source(year, delivery, overrides, plant), 'objekt-1', P))
}

// 10 t × 64,20 € × 1,19 = 763,98 €: plausibel gegen den eingetragenen Preis 2027.
export const settleWithDelivery2027 = (overrides: LawOverride[]): ComputedSettlement => settleWithDelivery(2027, { co2CostCents: 76398 }, overrides)
