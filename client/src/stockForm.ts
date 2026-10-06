// Die Karte „Vorrat“ der Seite Heizkosten (Heizung PR 8, Entwurf 8.2, 11.4), ohne DOM. Den
// Anfangsbestand fragt sie nur in der ersten Heizperiode mit Vorrat; danach ist er der Endbestand der
// Vorperiode, und die Karte zeigt ihn nur an.
import { fmtEuro, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { STOCK_UNIT_LABELS, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import { co2CostsCountedFrom } from '../../shared/law/co2kostaufg.ts'
import { germanDate } from '../../shared/law/register.ts'
import type { Co2Method, HeatingMethod, StockUnit, StockView } from './types'

export const STOCK_UNIT_OPTIONS: readonly { value: StockUnit | ''; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'l', label: STOCK_UNIT_LABELS.l },
  { value: 'kg', label: STOCK_UNIT_LABELS.kg },
  { value: 'srm', label: STOCK_UNIT_LABELS.srm },
]
export type Before2023 = '' | 'yes' | 'no'
const FROM = germanDate(co2CostsCountedFrom())
export const BEFORE_2023_OPTIONS: readonly { value: Before2023; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'yes', label: `Ja, vor dem ${FROM} in Rechnung gestellt` },
  { value: 'no', label: `Nein, ab dem ${FROM} in Rechnung gestellt` },
]

// Schon mit einer früheren Abrechnung umgelegt (Durchsicht von #237, C1)? Vorbelegt mit „ja“, wenn
// die Vorperiode Brennstoff dieser Anlage nach Lieferung abgerechnet hat.
export type AlreadySettled = '' | 'yes' | 'no'
export const ALREADY_SETTLED_OPTIONS: readonly { value: AlreadySettled; label: string }[] = [
  { value: 'yes', label: 'Ja, die Mieter haben ihn mit den Rechnungen schon bezahlt (er zählt mit 0 €)' },
  { value: 'no', label: 'Nein, er ist noch nicht umgelegt (er zählt mit seinem Wert)' },
]

export type StockForm = {
  unit: StockUnit | ''
  openingQuantity: string
  openingCost: string
  openingKg: string
  openingCo2: string
  before2023: Before2023
  closingQuantity: string
  measuredOn: string
  alreadySettled: AlreadySettled
}

// Ohne Tausenderpunkt: `parseDecimal` liest „1.000“ als technische Schreibweise (1), und eine
// gespeicherte Menge muss unverändert zurückkommen.
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }))
const centsText = (c: number | null): string => (c === null ? '' : (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function stockToForm(view: StockView): StockForm {
  const r = view.row
  return {
    unit: r.stockUnit ?? '',
    openingQuantity: numberText(r.openingQuantity),
    openingCost: centsText(r.openingCostCents),
    openingKg: numberText(r.openingEmissionsKg),
    openingCo2: centsText(r.openingCo2Cents),
    before2023: r.openingInvoicedBefore2023 === null ? '' : r.openingInvoicedBefore2023 ? 'yes' : 'no',
    closingQuantity: numberText(r.closingQuantity),
    measuredOn: r.closingMeasuredOn ?? '',
    alreadySettled: r.openingAlreadySettled === null ? (view.askAlreadySettled ? 'yes' : '') : r.openingAlreadySettled ? 'yes' : 'no',
  }
}

export function stockBody(form: StockForm, view: StockView): { body: Record<string, unknown> } | { error: string } {
  const errors: string[] = []
  const quantity = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    if (n === null || n < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: keine Zahl ab 0.`)
      return null
    }
    return n
  }
  const money = (text: string, label: string): number | null => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    if (c === null || c < 0) {
      errors.push(`Bitte prüfen Sie „${label}“: kein Betrag ab 0 €.`)
      return null
    }
    return c
  }
  const body: Record<string, unknown> = {
    stockUnit: form.unit === '' ? null : form.unit,
    closingQuantity: quantity(form.closingQuantity, 'Endbestand'),
    closingMeasuredOn: form.measuredOn === '' ? null : form.measuredOn,
  }
  if (view.derived === null) {
    body.openingQuantity = quantity(form.openingQuantity, 'Anfangsbestand')
    body.openingCostCents = money(form.openingCost, 'Wert des Anfangsbestands')
    body.openingEmissionsKg = quantity(form.openingKg, 'CO₂ des Anfangsbestands (kg)')
    body.openingCo2Cents = money(form.openingCo2, 'CO₂-Kosten des Anfangsbestands')
    body.openingInvoicedBefore2023 = form.before2023 === '' ? null : form.before2023 === 'yes'
    if (view.askAlreadySettled && form.alreadySettled !== '') body.openingAlreadySettled = form.alreadySettled === 'yes'
  }
  const first = errors[0]
  if (first) return { error: first }
  if (form.unit === '' && (body.closingQuantity !== null || (body.openingQuantity ?? null) !== null)) return { error: 'Bitte wählen Sie die Einheit des Vorrats.' }
  return { body }
}

// Die Zeilen unter der Karte: was da war, was kam, was übrig ist und was verbraucht wurde.
// `co2`: CO₂-Angaben nur bei Brennstoffen, deren CO₂-Kosten aufzuteilen sind (Durchsicht von #237, I4).
export function stockSummary(view: StockView, co2 = true): string[] {
  const s = view.statement
  if (!s) return []
  const q = (n: number): string => `${n.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[s.unit]}`
  const euro = (c: number | null): string => (c === null ? 'Betrag unbekannt' : fmtEuro(c))
  const kg = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
  return [
    `Anfangsbestand ${q(s.opening.quantity)} · ${euro(s.opening.costCents)}`,
    ...s.deliveries.map((d) => `${d.label}: ${q(d.quantity)} · ${euro(d.costCents)}`),
    `Endbestand ${q(s.closing.quantity)} · ${euro(s.closing.costCents)} (zu den jüngsten Lieferungen bewertet)`,
    `Verbraucht ${q(s.consumed.quantity)} · ${euro(s.consumed.costCents)}${co2 ? ` · ${kg(s.consumed.emissionsKg)} kg CO₂ · CO₂-Kosten ${fmtEuro(s.consumed.co2Cents)}` : ''}`,
  ]
}

// Die Karte erscheint bei freien Schlüsseln und beim Messdienst ohne Aufteilung; mit Abzugszeile oder
// Ausweis führt der Messdienst den Bestand selbst (Entwurf 8.2).
export function showsStockCard(plant: { method: HeatingMethod }, view: { stock: StockView | null; co2: { method: Co2Method } | null }): boolean {
  if (view.stock === null) return false
  return plant.method === 'manual' || (plant.method === 'service' && view.co2?.method === 'selfAfterService')
}
