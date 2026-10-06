// Die Formularlogik der Seite Heizkosten für Lieferungen, Gradtagzahlen des Orts und die CO₂-Angaben
// zum Gebäude (Heizung PR 7), ohne DOM prüfbar. Die Seite rendert nur.
import { fmtEuro, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { formatDayRange } from '../../shared/period.ts'
import { germanDate } from '../../shared/law/register.ts'
import { STOCK_UNIT_LABELS, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import type { Co2Restriction, DegreeDayValue, FuelDelivery, HeatingEnergy, HeatingMethod, HeatingPlant, StockUnit } from './types'

// Energieträger, bei denen CO₂-Kosten aufzuteilen sind: Brennstoffe mit Standardwerten nach § 7 Abs. 4
// BEHG (§ 2 Abs. 1 CO2KostAufG) und Fernwärme, wenn der Lieferant CO₂-Kosten ausweist. Dieselbe Liste
// wie `CO2_FUELS` in server/src/co2.ts, dazu Fernwärme (Durchsicht von #233, C1). Strom einer Wärmepumpe
// gehört nicht dazu.
export const CO2_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'districtHeating']

export type FuelForm = {
  label: string
  invoiceFrom: string
  invoiceTo: string
  amount: string
  fixed: string
  sharePercent: string
  emissionsKg: string
  co2Cost: string
  energyKwh: string
  usedByService: boolean
  // Vorrat (Heizung PR 8): Lieferdatum, Rechnungsdatum und Menge.
  deliveredAt: string
  invoiceDate: string
  quantity: string
  quantityUnit: StockUnit | ''
  // Etagenheizung (Heizung PR 9): die Wohnung, deren Heizung die Rechnung betrifft.
  unitId: string
}

export const emptyFuelForm = (): FuelForm => ({
  label: '', invoiceFrom: '', invoiceTo: '', amount: '', fixed: '', sharePercent: '', emissionsKg: '', co2Cost: '', energyKwh: '', usedByService: true,
  deliveredAt: '', invoiceDate: '', quantity: '', quantityUnit: '', unitId: '',
})

const centsText = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numberText = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false })

export function fuelToForm(d: FuelDelivery): FuelForm {
  return {
    label: d.label,
    invoiceFrom: d.invoiceFrom ?? '',
    invoiceTo: d.invoiceTo ?? '',
    amount: centsText(d.amountCents),
    fixed: centsText(d.fixedCents),
    sharePercent: d.sharePermille === null ? '' : numberText(d.sharePermille / 10),
    emissionsKg: numberText(d.emissionsKg),
    co2Cost: centsText(d.co2CostCents),
    energyKwh: numberText(d.energyKwh),
    usedByService: d.usedByService,
    deliveredAt: d.deliveredAt ?? '',
    invoiceDate: d.invoiceDate ?? '',
    quantity: numberText(d.quantity),
    quantityUnit: d.quantityUnit === 'l' || d.quantityUnit === 'kg' || d.quantityUnit === 'srm' ? d.quantityUnit : '',
    unitId: d.unitId ?? '',
  }
}

// Die Einheiten einer Lieferung für den Vorrat, mit leerer Vorauswahl.
export const STOCK_QUANTITY_OPTIONS: readonly { value: StockUnit | ''; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'l', label: STOCK_UNIT_LABELS.l },
  { value: 'kg', label: STOCK_UNIT_LABELS.kg },
  { value: 'srm', label: STOCK_UNIT_LABELS.srm },
]

// Der Rumpf einer Lieferung von Heizöl, Flüssiggas, Pellets, Holz oder Kohle (Heizung PR 8): Lieferdatum
// und Menge statt Rechnungszeitraum; abgegrenzt wird über Anfangs- und Endbestand. Den Betrag gibt es
// nur beim Messdienst (bei freien Schlüsseln steht er in den verknüpften Positionen).
export function stockFuelBody(form: FuelForm, method: HeatingMethod): { body: Record<string, unknown> } | { error: string } {
  if (form.deliveredAt === '') return { error: 'Bitte geben Sie das Lieferdatum an. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.' }
  const quantity = form.quantity.trim() === '' ? null : parseDecimal(form.quantity)
  if (quantity === null || !(quantity > 0)) return { error: 'Bitte geben Sie die gelieferte Menge an, wie auf der Rechnung.' }
  if (form.quantityUnit === '') return { error: 'Bitte wählen Sie die Einheit der Menge.' }
  const amount = method === 'service' && form.amount.trim() !== '' ? parseEuro(form.amount) : null
  if (method === 'service' && form.amount.trim() !== '' && amount === null) return { error: 'Der Rechnungsbetrag ist kein Betrag.' }
  const kg = form.emissionsKg.trim() === '' ? null : parseDecimal(form.emissionsKg)
  if (form.emissionsKg.trim() !== '' && (kg === null || kg < 0)) return { error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' }
  const co2 = form.co2Cost.trim() === '' ? null : parseEuro(form.co2Cost)
  if (form.co2Cost.trim() !== '' && co2 === null) return { error: 'Die CO₂-Kosten sind kein Betrag.' }
  return {
    body: {
      label: form.label.trim(),
      deliveredAt: form.deliveredAt,
      invoiceDate: form.invoiceDate === '' ? form.deliveredAt : form.invoiceDate,
      quantity,
      quantityUnit: form.quantityUnit,
      ...(method === 'service' ? { amountCents: amount, usedByService: form.usedByService } : {}),
      emissionsKg: kg,
      co2CostCents: co2,
    },
  }
}

// Der Rumpf für POST und PUT. Ein leeres Feld ist `null`, ein unlesbares ein Fehler mit Satz. Den
// Betrag gibt es nur beim Messdienst (bei freien Schlüsseln steht er in den verknüpften Positionen),
// ebenso „vom Messdienst angesetzt“.
export function fuelBody(form: FuelForm, method: HeatingMethod): { body: Record<string, unknown> } | { error: string } {
  if (form.invoiceFrom === '' || form.invoiceTo === '') return { error: 'Bitte geben Sie den Rechnungszeitraum an (Beginn und Ende laut Rechnung).' }
  const euro = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    return c === null ? { error: `${name} ist kein Betrag.` } : c
  }
  const decimal = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    return n === null || n < 0 ? { error: `${name} ist eine Zahl ab 0.` } : n
  }
  const fixed = euro(form.fixed, 'Der feste Preisbestandteil')
  const co2 = euro(form.co2Cost, 'Die CO₂-Kosten')
  const amount = method === 'service' ? euro(form.amount, 'Der Rechnungsbetrag') : null
  const kg = decimal(form.emissionsKg, 'Der CO₂-Ausstoß')
  const kwh = decimal(form.energyKwh, 'Die Energie')
  const share = decimal(form.sharePercent, 'Der eingetragene Anteil')
  for (const v of [fixed, co2, amount, kg, kwh, share]) if (v !== null && typeof v === 'object') return v
  const num = (v: number | null | { error: string }): number | null => (typeof v === 'number' ? v : null)
  const sharePercent = num(share)
  if (sharePercent !== null && sharePercent > 100) return { error: 'Der eingetragene Anteil liegt zwischen 0 und 100 %.' }
  const body: Record<string, unknown> = {
    label: form.label.trim(),
    invoiceFrom: form.invoiceFrom,
    invoiceTo: form.invoiceTo,
    ...(method === 'service' ? { amountCents: num(amount) } : {}),
    fixedCents: num(fixed),
    sharePermille: sharePercent === null ? null : Math.round(sharePercent * 1000) / 100,
    emissionsKg: num(kg),
    co2CostCents: num(co2),
    energyKwh: num(kwh),
    ...(method === 'service' ? { usedByService: form.usedByService } : {}),
  }
  return { body }
}

// Eine Zeile der Liste: Zeitraum, Betrag, Ausstoß und CO₂-Kosten, bei einer Schätzung der Vorbehalt.
// Die Wohnung einer Rechnung (Heizung PR 9, Entwurf 5.4 F8): bei einer Etagenheizung Pflicht, sonst nie.
// Getrennt von fuelBody, damit dessen Gestalt (form, method) für die späteren PRs bleibt; die Karte
// setzt das Ergebnis in den Rumpf.
export function deliveryUnitId(form: Pick<FuelForm, 'unitId'>, plant: Pick<HeatingPlant, 'supply'>): { unitId: string | null } | { error: string } {
  if (plant.supply !== 'perUnit') return { unitId: null }
  return form.unitId ? { unitId: form.unitId } : { error: 'Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft.' }
}

export function deliveryLine(d: FuelDelivery): string {
  const parts: string[] = []
  if (d.invoiceFrom && d.invoiceTo) parts.push(formatDayRange(d.invoiceFrom, d.invoiceTo))
  else if (d.deliveredAt) parts.push(`geliefert am ${germanDate(d.deliveredAt)}`)
  if (d.quantity !== null && (d.quantityUnit === 'l' || d.quantityUnit === 'kg' || d.quantityUnit === 'srm')) parts.push(`${d.quantity.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${STOCK_UNIT_TEXT[d.quantityUnit]}`)
  if (d.amountCents !== null) parts.push(fmtEuro(d.amountCents))
  if (d.emissionsKg !== null) parts.push(`${d.emissionsKg.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg CO₂`)
  if (d.co2CostCents !== null) parts.push(`CO₂-Kosten ${fmtEuro(d.co2CostCents)}`)
  if (d.estimated) parts.push('geschätzt, Nachberechnung vorbehalten')
  return parts.join(' · ')
}

// Die Auswahl an einer Position: keine oder eine echte Lieferung. Eine Schätzung hat keine Position.
export function deliveryOptions(deliveries: readonly FuelDelivery[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'keine Lieferung' },
    ...deliveries.filter((d) => !d.estimated).map((d) => ({
      value: d.id,
      label: d.label || (d.invoiceFrom && d.invoiceTo ? formatDayRange(d.invoiceFrom, d.invoiceTo) : d.deliveredAt ? `Lieferung vom ${germanDate(d.deliveredAt)}` : 'Lieferung'),
    })),
  ]
}

// Die Lieferungen, die in einer Heizperiode enden, beim Vorrat die, die in ihr geliefert wurden: Ihre
// Positionen stehen dort (Entwurf 5.4).
export function ownedBy(deliveries: readonly FuelDelivery[], view: { from: string; to: string }): FuelDelivery[] {
  return deliveries.filter((d) => {
    const end = d.invoiceTo ?? d.deliveredAt
    return end !== null && end >= view.from && end <= view.to
  })
}

// ---------- Gradtagzahlen des Orts (Stufe 4 in 3.2) ----------

// Die Monate ('JJJJ-MM') von `from` bis `to`, beide eingeschlossen.
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endY = Number(to.slice(0, 4))
  const endM = Number(to.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

export function degreeDaysToForm(values: readonly DegreeDayValue[], months: readonly string[]): Record<string, string> {
  return Object.fromEntries(months.map((month) => {
    const v = values.find((x) => x.month === month)
    return [month, v ? v.value.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : '']
  }))
}

export function degreeDaysBody(form: Record<string, string>): { body: { values: DegreeDayValue[] } } | { error: string } {
  const values: DegreeDayValue[] = []
  for (const [month, text] of Object.entries(form).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (text.trim() === '') continue
    const value = parseDecimal(text)
    if (value === null || value < 0) return { error: `Die Gradtagzahl für ${month.slice(5, 7)}/${month.slice(0, 4)} ist keine Zahl ab 0.` }
    values.push({ month, value })
  }
  return { body: { values } }
}

// ---------- CO₂: Angaben zum Gebäude (§ 8, § 9, § 2 Abs. 4 CO2KostAufG) ----------

export const RESTRICTION_OPTIONS: readonly { value: Co2Restriction; label: string }[] = [
  { value: 'none', label: 'Keine' },
  { value: 'building', label: 'Vorgaben stehen einer wesentlichen energetischen Verbesserung des Gebäudes entgegen (etwa Denkmalschutz)' },
  { value: 'supply', label: 'Vorgaben stehen einer wesentlichen Verbesserung der Wärme- und Warmwasserversorgung entgegen' },
  { value: 'both', label: 'Vorgaben stehen beidem entgegen' },
]
