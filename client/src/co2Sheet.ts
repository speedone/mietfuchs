// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210), ohne DOM: Kopf, Zeilen der Tabelle und
// die Angaben zur Einstufung als fertige Texte. Die Ansicht (Co2SheetView.tsx) rendert nur.
import { fmtDate, fmtEuro } from './api'
import { ENERGY_OPTIONS } from './heatingForm'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2DistrictEtsNew } from '../../shared/law/co2kostaufg.ts'
import { germanDate, onlyVersion } from '../../shared/law/register.ts'
import type { Co2Sheet, FuelDelivery, FuelQuantityUnit } from './types'

export type SheetRow = { label: string; cells: string[] }
export const SHEET_COLUMNS = ['Rechnung vom', 'Zeitraum', 'Menge', 'Energiegehalt', 'Emissionsfaktor', 'CO₂', 'CO₂-Kosten', 'Betrag']

const num = (n: number, digits: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
const UNIT_TEXT: Record<FuelQuantityUnit, string> = { ...STOCK_UNIT_TEXT, m3: 'm³', kWh: 'kWh' }
const energyLabel = (s: Pick<Co2Sheet, 'energy'>): string => ENERGY_OPTIONS.find((o) => o.value === s.energy)?.label ?? s.energy

export function sheetHead(s: Co2Sheet): { title: string; lines: string[] } {
  return {
    title: 'CO₂-Angaben für den Messdienst',
    lines: [
      [s.propertyName, s.address].filter(Boolean).join(', '),
      `Vermieter: ${s.landlordName || '–'}`,
      `Heizanlage: ${s.plantName ? `${s.plantName} ` : ''}(${energyLabel(s)})`,
      `Heizperiode: ${fmtDate(s.period.from)} bis ${fmtDate(s.period.to)}`,
    ].filter((l) => l !== ''),
  }
}

export function sheetRows(s: Co2Sheet): SheetRow[] {
  const rows = s.deliveries.map((d) => ({
    label: d.estimated ? `${d.label} (geschätzt)` : d.label,
    cells: [
      d.invoiceDate ? fmtDate(d.invoiceDate) : '–',
      d.from && d.to ? `${fmtDate(d.from)} bis ${fmtDate(d.to)}` : d.deliveredAt ? `geliefert ${fmtDate(d.deliveredAt)}` : '–',
      d.quantity !== null && d.quantityUnit ? `${num(d.quantity, 2)} ${UNIT_TEXT[d.quantityUnit]}` : '–',
      d.energyKwh !== null ? `${num(d.energyKwh, 0)} kWh${d.gasBasis === 'hs' ? ' (Brennwert)' : d.gasBasis === 'hi' ? ' (Heizwert)' : ''}` : '–',
      d.emissionFactor !== null ? `${num(d.emissionFactor, 4)} kg CO₂/kWh` : '–',
      d.emissionsKg !== null ? `${num(d.emissionsKg, 2)} kg` : '–',
      d.co2CostCents !== null ? fmtEuro(d.co2CostCents) : '–',
      d.amountCents !== null ? fmtEuro(d.amountCents) : '–',
    ],
  }))
  return [...rows, { label: 'Summe', cells: ['', '', '', '', '', `${num(s.totals.emissionsKg, 2)} kg`, fmtEuro(s.totals.co2CostCents), ''] }]
}

export function sheetFacts(s: Co2Sheet): string[] {
  const area = s.areaM2 === null
    ? 'Fläche für die Einstufung: nicht bekannt; bitte die Wohnfläche der versorgten Wohnungen angeben'
    : `Fläche für die Einstufung: ${num(s.areaM2, 2)} m² (${s.areaSource === 'entered' ? 'von Ihnen eingetragen' : 'Wohnfläche der versorgten Wohnungen'})`
  const restriction = s.restriction === 'none' ? 'keine Beschränkung nach § 9 CO2KostAufG'
    : s.restriction === 'both' ? 'Beschränkung nach § 9 Abs. 2 CO2KostAufG (Gebäude und Wärmeversorgung)'
      : `Beschränkung nach § 9 Abs. 1 CO2KostAufG (${s.restriction === 'building' ? 'Gebäude' : 'Wärmeversorgung'})`
  const facts = [area, `${s.nonResidential ? 'Nichtwohngebäude (§ 8 CO2KostAufG)' : 'Kein Nichtwohngebäude (§ 8 CO2KostAufG)'}; ${restriction}`]
  // Der Stichtag kommt aus dem Register (`co2.district-ets-new`), nicht als Text.
  if (s.districtEtsNew) facts.push(`Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem ${germanDate(onlyVersion(co2DistrictEtsNew).value.connectedAfter)} (§ 2 Abs. 4 Satz 2 CO2KostAufG)`)
  if (s.stock) {
    const unit = s.stock.stockUnit ? ` ${STOCK_UNIT_TEXT[s.stock.stockUnit]}` : ''
    const before = s.stock.openingInvoicedBefore2023 ? ' (vor 2023 in Rechnung gestellt, ohne CO₂-Kosten nach § 11 Abs. 2 Satz 2 CO2KostAufG)' : ''
    const opening = s.stock.openingQuantity !== null ? `Anfangsbestand ${num(s.stock.openingQuantity, 2)}${unit}${s.stock.openingEmissionsKg !== null ? ` mit ${num(s.stock.openingEmissionsKg, 2)} kg CO₂` : ''}${before}` : 'Anfangsbestand nicht eingetragen'
    const closing = s.stock.closingQuantity !== null ? `Endbestand ${num(s.stock.closingQuantity, 2)}${unit}${s.stock.closingMeasuredOn ? ` am ${fmtDate(s.stock.closingMeasuredOn)}` : ''}` : 'Endbestand nicht eingetragen'
    facts.push(`Vorrat: ${opening}; ${closing}`)
  }
  facts.push('Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist; nicht auf die Heizperiode abgegrenzt')
  return facts
}

// Ob es für eine Heizperiode etwas zu drucken gibt: eine Rechnung, deren Zeitraum oder Liefertag sie
// berührt. Dieselbe Regel wie auf dem Blatt (server/src/co2Sheet.ts), nicht die der Karte „Lieferungen“,
// die eine Rechnung nur in der Heizperiode zeigt, in der sie endet.
export function hasSheet(deliveries: readonly Pick<FuelDelivery, 'invoiceFrom' | 'invoiceTo' | 'deliveredAt'>[], h: { from: string; to: string }): boolean {
  return deliveries.some((d) => {
    const from = d.invoiceFrom && d.invoiceTo ? d.invoiceFrom : d.deliveredAt
    const to = d.invoiceFrom && d.invoiceTo ? d.invoiceTo : d.deliveredAt
    return from !== null && to !== null && from <= h.to && to >= h.from
  })
}
