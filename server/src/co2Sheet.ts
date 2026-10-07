// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210, Abweichung 9 des Plans): je Rechnung,
// die die Heizperiode berührt, die Angaben des § 3 Abs. 1 Nr. 1–4 CO2KostAufG (kg, CO₂-Kosten,
// Emissionsfaktor, Energiegehalt) und was der Messdienst für die Einstufung braucht (Fläche, § 8, § 9,
// § 2 Abs. 4, Vorrat). Abgegrenzt wird nicht: Der Messdienst rechnet über seinen Zeitraum selbst und
// braucht die Rechnungen, wie sie sind. Das Blatt gibt es für jede Anlage mit
// Lieferungen, nicht nur beim Messdienst; auch die Gemeinschaft oder ein Steuerberater braucht es.
import { servesUnit } from '../../shared/heatingPeriod.ts'
import { createLawLog } from '../../shared/law/register.ts'
import type { Co2Sheet, Co2SheetDelivery, Co2SheetStock, FuelDelivery, HeatingPlant, LawOverride, Unit } from '../../shared/types.ts'
import { co2Plausibility, plausibilityText } from './co2Plausibility.ts'
import { rangeOf } from './fuel.ts'

export type Co2SheetInput = {
  propertyName: string
  address: string
  landlordName: string
  plant: Pick<HeatingPlant, 'id' | 'name' | 'energy' | 'units' | 'nonResidential' | 'restriction' | 'districtEtsNew'>
  h: { key: string; from: string; to: string }
  units: readonly Pick<Unit, 'id' | 'areaM2' | 'noConnection'>[]
  enteredAreaM2: number | null
  stock: Co2SheetStock | null
  deliveries: readonly FuelDelivery[]
  // Die Summe der Kostenpositionen je verknüpfter Lieferung: ohne eingetragenen Betrag (freie Schlüssel,
  // eigene Abrechnung) ist sie der Betrag der Rechnung.
  linkedCents?: Readonly<Record<string, number>>
  overrides: readonly LawOverride[]
}

const fmtCents = (c: number): string => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function co2SheetOf(i: Co2SheetInput): Co2Sheet {
  const touching = i.deliveries.filter((d) => {
    if (d.plantId !== i.plant.id) return false
    const r = rangeOf(d)
    return r !== null && r.from <= i.h.to && r.to >= i.h.from
  })
  // Die Einträge des Vermieters gelten auch hier; das Protokoll selbst wird nicht gebraucht.
  const log = createLawLog(i.overrides)
  const deliveries: Co2SheetDelivery[] = touching.map((d) => ({
    id: d.id, label: d.label, invoiceDate: d.invoiceDate, from: d.invoiceFrom, to: d.invoiceTo, deliveredAt: d.deliveredAt,
    quantity: d.quantity, quantityUnit: d.quantityUnit, energyKwh: d.energyKwh, gasBasis: d.gasBasis, emissionFactor: d.emissionFactor,
    emissionsKg: d.emissionsKg, co2CostCents: d.co2CostCents, amountCents: d.amountCents ?? i.linkedCents?.[d.id] ?? null, estimated: d.estimated,
    findings: co2Plausibility(d, i.plant.energy, log).map((f) => plausibilityText(f, fmtCents)),
  }))
  // Fläche der Einstufung (Entwurf 9.2): eingetragen, sonst die Wohnfläche der versorgten Wohnungen.
  const served = i.units.filter((u) => servesUnit(i.plant, u)).reduce((a, u) => a + (u.areaM2 > 0 ? u.areaM2 : 0), 0)
  const area = i.enteredAreaM2 ?? (served > 0 ? served : null)
  return {
    propertyName: i.propertyName, address: i.address, landlordName: i.landlordName,
    plantName: i.plant.name, energy: i.plant.energy,
    period: { key: i.h.key, from: i.h.from, to: i.h.to },
    areaM2: area, areaSource: i.enteredAreaM2 !== null ? 'entered' : area !== null ? 'served' : null,
    nonResidential: i.plant.nonResidential, restriction: i.plant.restriction, districtEtsNew: i.plant.districtEtsNew,
    stock: i.stock, deliveries,
    totals: {
      emissionsKg: Math.round(deliveries.reduce((a, d) => a + (d.emissionsKg ?? 0), 0) * 100) / 100,
      co2CostCents: deliveries.reduce((a, d) => a + (d.co2CostCents ?? 0), 0),
    },
  }
}
