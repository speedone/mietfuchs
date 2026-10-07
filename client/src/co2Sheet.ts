// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210), ohne DOM: Kopf, Zeilen der Tabelle und
// die Angaben zur Einstufung als fertige Texte. Die Ansicht (Co2SheetView.tsx) rendert nur. Das Blatt geht an
// Dritte (Messdienst, Gemeinschaft, Steuerbüro): Die Texte stehen in der dritten Person und sprechen den
// Vermieter nicht an (Durchsicht von #246, R-W2).
import { fmtDate, fmtEuro } from './api'
import { ENERGY_OPTIONS } from './heatingForm'
import { STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2DistrictEtsNew } from '../../shared/law/co2kostaufg.ts'
import { germanDate, onlyVersion } from '../../shared/law/register.ts'
import type { Co2Sheet, Co2SheetDelivery, FuelDelivery, FuelQuantityUnit } from './types'

// `kind`: der Anfangsbestand, eine Rechnung oder die Summe; `note` der Vermerk, warum eine Zeile nicht oder
// nur zum Teil zählt.
export type SheetRow = { kind: 'opening' | 'delivery' | 'sum'; label: string; note: string | null; cells: string[] }
export const SHEET_COLUMNS = ['Rechnung vom', 'Zeitraum', 'Menge', 'Energiegehalt', 'Emissionsfaktor', 'CO₂', 'CO₂-Kosten', 'Betrag']

const num = (n: number, digits: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })
const UNIT_TEXT: Record<FuelQuantityUnit, string> = { ...STOCK_UNIT_TEXT, m3: 'm³', kWh: 'kWh' }
const energyLabel = (s: Pick<Co2Sheet, 'energy'>): string => ENERGY_OPTIONS.find((o) => o.value === s.energy)?.label ?? s.energy

export function sheetHead(s: Co2Sheet): { title: string; lines: string[] } {
  // Steht der Name schon am Anfang der Anschrift („Lindenweg 12“), nur die Anschrift (R-K6).
  const place = s.propertyName && s.address.startsWith(s.propertyName.trim()) ? s.address : [s.propertyName, s.address].filter(Boolean).join(', ')
  return {
    title: 'CO₂-Angaben für den Messdienst',
    lines: [
      place,
      `Vermieter: ${s.landlordName || '–'}`,
      `Heizanlage: ${s.plantName ? `${s.plantName} (${energyLabel(s)})` : energyLabel(s)}`,
      `Heizperiode: ${fmtDate(s.period.from)} bis ${fmtDate(s.period.to)}`,
      `Stand: ${fmtDate(s.createdOn)}`,
    ].filter((l) => l !== ''),
  }
}

const COUNTED_LABEL: Record<Co2SheetDelivery['counted'], string> = { full: '', partial: ' (geschätzt, zählt anteilig)', kgOnly: ' (nur die kg zählen)', none: ' (zählt nicht)' }

export function sheetRows(s: Co2Sheet): SheetRow[] {
  const rows: SheetRow[] = s.deliveries.map((d) => ({
    kind: 'delivery',
    label: `${d.label}${d.counted === 'full' && d.estimated ? ' (geschätzt)' : COUNTED_LABEL[d.counted]}`,
    note: d.note,
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
  // Der Anfangsbestand (Durchsicht von #246, G-W2): seine Rechnung steht in einer früheren Heizperiode.
  const o = s.opening
  const stock = s.stock
  const opening: SheetRow[] = o
    ? [{
        kind: 'opening',
        label: o.co2Counted ? 'Anfangsbestand (Vorrat)' : o.kgCounted ? 'Anfangsbestand (Vorrat, nur die kg zählen)' : 'Anfangsbestand (Vorrat, zählt nicht)',
        note: o.note,
        cells: ['', '', stock?.openingQuantity != null && stock.stockUnit ? `${num(stock.openingQuantity, 2)} ${STOCK_UNIT_TEXT[stock.stockUnit]}` : '–', '–', '–',
          o.emissionsKg !== null ? `${num(o.emissionsKg, 2)} kg` : '–', o.co2CostCents !== null ? fmtEuro(o.co2CostCents) : '–', ''],
      }]
    : []
  // Gilt das Gesetz nicht (§ 2 Abs. 4 Satz 2), gibt es keine Summe nach dem CO2KostAufG (Runde 2, O3).
  if (!s.checked) return [...opening, ...rows]
  return [...opening, ...rows, { kind: 'sum', label: 'Summe', note: null, cells: ['', '', '', '', '', `${num(s.totals.emissionsKg, 2)} kg`, fmtEuro(s.totals.co2CostCents), ''] }]
}

export function sheetFacts(s: Co2Sheet): string[] {
  const area = s.areaM2 === null
    ? 'Fläche für die Einstufung: nicht angegeben'
    : `Fläche für die Einstufung: ${num(s.areaM2, 2)} m² (${s.areaSource === 'entered' ? 'vom Vermieter angegeben' : 'Summe der Wohnflächen der versorgten Wohnungen laut Vermieter'})`
  const restriction = s.restriction === 'none' ? 'keine Beschränkung nach § 9 CO2KostAufG'
    : s.restriction === 'both' ? 'Beschränkung nach § 9 Abs. 2 CO2KostAufG (Gebäude und Wärmeversorgung)'
      : `Beschränkung nach § 9 Abs. 1 CO2KostAufG (${s.restriction === 'building' ? 'Gebäude' : 'Wärmeversorgung'})`
  const facts = [area, `${s.nonResidential ? 'Nichtwohngebäude (§ 8 CO2KostAufG)' : 'Kein Nichtwohngebäude (§ 8 CO2KostAufG)'}; ${restriction}`]
  // Der Stichtag kommt aus dem Register (`co2.district-ets-new`), nicht als Text. Für diese Wärme gilt das
  // Gesetz nicht; geprüft wird nichts (R-W1).
  if (s.districtEtsNew) {
    facts.push(`Wärme aus Anlagen des Emissionshandels, erster Anschluss nach dem ${germanDate(onlyVersion(co2DistrictEtsNew).value.connectedAfter)} (§ 2 Abs. 4 Satz 2 CO2KostAufG)` +
      (s.checked ? '' : ': Die CO₂-Kosten werden nicht aufgeteilt, die Angaben deshalb nicht geprüft.'))
  }
  if (s.stock) {
    const unit = s.stock.stockUnit ? ` ${STOCK_UNIT_TEXT[s.stock.stockUnit]}` : ''
    const before = s.stock.openingInvoicedBefore2023 ? ' (vor 2023 in Rechnung gestellt, ohne CO₂-Kosten nach § 11 Abs. 2 Satz 2 CO2KostAufG)' : ''
    const opening = s.stock.openingQuantity !== null ? `Anfangsbestand ${num(s.stock.openingQuantity, 2)}${unit}${s.stock.openingEmissionsKg !== null ? ` mit ${num(s.stock.openingEmissionsKg, 2)} kg CO₂` : ''}${before}` : 'Anfangsbestand nicht angegeben'
    const closing = s.stock.closingQuantity !== null ? `Endbestand ${num(s.stock.closingQuantity, 2)}${unit}${s.stock.closingMeasuredOn ? ` am ${fmtDate(s.stock.closingMeasuredOn)}` : ''}` : 'Endbestand nicht angegeben'
    facts.push(`Vorrat: ${opening}; ${closing}`)
  }
  // Der Fußsatz verweist nur auf Vermerke, die es gibt, und nennt keine Summe, wo das Gesetz nicht gilt (Runde 2, N3, O3).
  const notes = s.deliveries.some((d) => d.note !== null) || (s.opening?.note ?? null) !== null
  facts.push(s.checked
    ? `Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist; nicht auf die Heizperiode abgegrenzt. Die Summe enthält nur, was nach dem CO2KostAufG zählt${notes ? ' (siehe Vermerke)' : ''}.`
    : 'Angaben je Rechnung, wie sie der Lieferant ausweist. Nach § 2 Abs. 4 Satz 2 CO2KostAufG werden die CO₂-Kosten dieser Wärme nicht aufgeteilt; eine Summe entfällt deshalb.')
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
