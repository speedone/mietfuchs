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
import { FUEL_METHOD_LABELS } from './fuelView'

// `kind`: der Anfangsbestand, eine Rechnung oder die Summe; `note` der Vermerk, warum eine Zeile nicht oder
// nur zum Teil zählt.
// `billing`: was die Abrechnung daraus macht (Endbestand, Verbrauch, abgegrenzte Rechnungen; Runde 3, S-W1).
// `sub`: je Rechnung der Teil in der Heizperiode, wie die Abrechnung ihn ansetzt.
export type SheetRow = { kind: 'opening' | 'delivery' | 'sum' | 'billing'; label: string; note: string | null; sub: string | null; cells: string[] }
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
    sub: d.inPeriod && d.inPeriod.emissionsKg !== null
      ? `davon in der Heizperiode: ${num(d.inPeriod.emissionsKg, 2)} kg, ${d.inPeriod.co2Cents !== null ? fmtEuro(d.inPeriod.co2Cents) : '–'} (${num(d.inPeriod.sharePermille, 1)} ‰, ${FUEL_METHOD_LABELS[d.inPeriod.method]})`
      : null,
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
        // Aus der Vorperiode übernommen, gibt es keine Rechnung: Die CO₂-Kosten sind die übernommenen (Runde 4, S-K1).
        label: `Anfangsbestand (Vorrat${o.source === 'carried' ? ', aus der Vorperiode übernommen' : ''}${o.co2Counted ? '' : o.kgCounted ? ', nur die kg zählen' : ', zählt nicht'})`,
        note: o.note,
        sub: null,
        cells: ['', '', o.quantity !== null && stock?.stockUnit ? `${num(o.quantity, 2)} ${STOCK_UNIT_TEXT[stock.stockUnit]}` : '–', '–', '–',
          o.emissionsKg !== null ? `${num(o.emissionsKg, 2)} kg` : '–', o.co2CostCents !== null ? fmtEuro(o.co2CostCents) : '–', ''],
      }]
    : []
  // Gilt das Gesetz nicht (§ 2 Abs. 4 Satz 2), gibt es keine Summe nach dem CO2KostAufG (Runde 2, O3).
  if (!s.checked) return [...opening, ...rows]
  return [...opening, ...rows, { kind: 'sum', label: 'Summe der Rechnungen (nicht abgegrenzt)', note: null, sub: null, cells: ['', '', '', '', '', `${num(s.totals.emissionsKg, 2)} kg`, fmtEuro(s.totals.co2CostCents), ''] }, ...billingRows(s)]
}

// Was die Abrechnung aus den Rechnungen macht, als Zeilen unter der Summe (Runde 3, S-W1).
function billingRows(s: Co2Sheet): SheetRow[] {
  if (!s.checked) return []
  const line = (label: string, kg: number | null, cents: number | null): SheetRow =>
    ({ kind: 'billing', label, note: null, sub: null, cells: ['', '', '', '', '', kg === null ? '–' : `${num(kg, 2)} kg`, cents === null ? '–' : fmtEuro(cents), ''] })
  const minus = (t: string): string => (t === '–' ? t : `−${t}`)
  // Die Summe der Rechnungen ist nicht abgegrenzt (Runde 3, S-W1). Was die Abrechnung daraus macht, steht
  // darunter, gelesen aus ihrem Ergebnis: beim Vorrat Endbestand und Verbrauch, bei Rechnungen über einen
  // Zeitraum ihr Teil in der Heizperiode, und die Grundlage der Aufteilung, wo sie hochgerechnet ist.
  const b = s.billing
  const billing: SheetRow[] = []
  if (b.closing && b.consumed) {
    const unit = s.stock?.stockUnit ? ` ${STOCK_UNIT_TEXT[s.stock.stockUnit]}` : ''
    const closing = line(`abzüglich Endbestand${b.closing.measuredOn ? ` am ${fmtDate(b.closing.measuredOn)}` : ''} (${num(b.closing.quantity, 2)}${unit})`, b.closing.emissionsKg, b.closing.co2Cents)
    billing.push({ ...closing, cells: closing.cells.map((c, i) => (i === 5 || i === 6 ? minus(c) : c)) })
    billing.push(line('Verbrauch in der Heizperiode (wie in der Abrechnung)', b.consumed.emissionsKg, b.consumed.co2Cents))
  } else if (b.inPeriod) {
    const cover = b.inPeriod.coveragePermille < 1000 ? `; die Rechnungen decken ${num(b.inPeriod.coveragePermille, 1)} ‰ der Gradtage ab` : ''
    billing.push(line(`davon in der Heizperiode (Abgrenzung wie in der Abrechnung${cover})`, b.inPeriod.emissionsKg, b.inPeriod.co2Cents))
  }
  if (b.basis && (billing.length === 0 || (b.inPeriod !== null && b.inPeriod.coveragePermille < 1000 && !b.closing))) {
    const scaled = b.inPeriod !== null && b.inPeriod.coveragePermille < 1000
    billing.push(line(`Grundlage der CO₂-Aufteilung in der Abrechnung${scaled ? ' (kg hochgerechnet auf die ganze Heizperiode)' : ''}`, b.basis.emissionsKg, b.basis.co2Cents))
  }
  return billing
}

// Die Vermerke und Teile in der Heizperiode, unter der Tabelle (Runde 4, W-O1): In der Tabelle, die auf dem
// Handy seitlich scrollt, lief ein Vermerk über ihre ganze Breite aus dem Bild. Die Zeile trägt die Nummer.
export function sheetNotes(rows: readonly SheetRow[]): { ref: number; label: string; lines: string[] }[] {
  const notes: { ref: number; label: string; lines: string[] }[] = []
  for (const r of rows) {
    const lines = [r.sub, r.note].filter((t): t is string => t !== null)
    if (lines.length > 0) notes.push({ ref: notes.length + 1, label: r.label, lines })
  }
  return notes
}

export function sheetFacts(s: Co2Sheet): string[] {
  const area = s.areaM2 === null
    ? 'Fläche für die Einstufung: nicht angegeben'
    : s.areaSource === null ? `Fläche für die Einstufung: ${num(s.areaM2, 2)} m²`
    : `Fläche für die Einstufung: ${num(s.areaM2, 2)} m² (${s.areaSource === 'entered' ? 'vom Vermieter angegeben'
      : s.areaSource === 'building' ? 'gemeinsame Wohnfläche der Wohnungen aller Heizanlagen des Gebäudes, wie die Abrechnung einstuft; § 5 Abs. 1 Satz 2 CO2KostAufG'
        : 'Summe der Wohnflächen der versorgten Wohnungen laut Vermieter'})`
  const restriction = s.restriction === 'none' ? 'keine Beschränkung nach § 9 CO2KostAufG'
    : s.restriction === 'both' ? 'Beschränkung nach § 9 Abs. 2 CO2KostAufG (Gebäude und Wärmeversorgung)'
      : `Beschränkung nach § 9 Abs. 1 CO2KostAufG (${s.restriction === 'building' ? 'Gebäude' : 'Wärmeversorgung'})`
  // Gilt das Gesetz nicht (§ 2 Abs. 4 Satz 2), wird nicht eingestuft: keine Fläche und keine §§ 8, 9 (Runde 3, klein).
  const facts = s.checked ? [area, `${s.nonResidential ? 'Nichtwohngebäude (§ 8 CO2KostAufG)' : 'Kein Nichtwohngebäude (§ 8 CO2KostAufG)'}; ${restriction}`] : []
  // Die Einstufung, wie die Abrechnung sie vornimmt (S-W1, Punkt 4): nie aus der Summe der Rechnungen.
  const basis = s.checked ? s.billing.basis : null
  if (basis && basis.kgPerM2 !== null) {
    const stage = basis.stage ? `, Stufe ${basis.stage.to === null ? `ab ${num(basis.stage.from, 1)} kg` : `${num(basis.stage.from, 1)} bis unter ${num(basis.stage.to, 1)} kg`}` : ''
    const share = basis.landlordPermille !== null ? `, Vermieter ${num(basis.landlordPermille / 10, 1)} % der CO₂-Kosten` : ''
    // Die Fläche steht nur einmal da, in der ersten Angabe; sie ist die der Abrechnung (Runde 4).
    facts.push(`Einstufung laut Abrechnung: ${num(basis.kgPerM2, 1)} kg CO₂ je m² Wohnfläche${stage}${share}`)
  }
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
  // „Die Zeilen darunter“ nur, wenn es sie gibt (Runde 4, K-1).
  const below = billingRows(s).length > 0
  facts.push(s.checked
    ? 'Angaben je Rechnung nach § 3 Abs. 1 Nr. 1 bis 4 CO2KostAufG, wie sie der Lieferant ausweist. ' +
      (below
        ? 'Die Summe der Rechnungen ist nicht der CO₂-Ausstoß des Abrechnungszeitraums: Auf ihn umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG) und ohne den Endbestand eines Vorrats ' +
          '(§ 7 Abs. 1 CO2KostAufG: im Abrechnungszeitraum verursacht) sind erst die Zeilen darunter, wie die Abrechnung sie ansetzt. '
        : 'Die Summe der Rechnungen ist nicht der CO₂-Ausstoß des Abrechnungszeitraums (§ 5 Abs. 1 Satz 5, § 7 Abs. 1 CO2KostAufG); die Abrechnung kann ihn derzeit nicht abgrenzen. ') +
      `Nicht gezählt sind Angaben, die nach dem CO2KostAufG unberücksichtigt bleiben${notes ? ' (siehe Vermerke)' : ''}.`
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
