// Die Formularlogik der Seite Heizkosten für Lieferungen, Gradtagzahlen des Orts und die CO₂-Angaben
// zum Gebäude (Heizung PR 7), ohne DOM prüfbar. Die Seite rendert nur.
import { fmtEuro, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import { ambiguousText, ambiguousThousands } from './numbers'
import { formatDayRange } from '../../shared/period.ts'
import { germanDate } from '../../shared/law/register.ts'
import { STOCK_UNIT_LABELS, STOCK_UNIT_TEXT } from '../../shared/fuelStock.ts'
import type { Co2Restriction, DegreeDayValue, FuelDelivery, FuelGrade, FuelQuantityUnit, GasBasis, HeatGeneration, HeatingEnergy, HeatingMethod, HeatingPlant, StockUnit } from './types'
import { FUEL_GRADE_LABELS, GRADES_BY_ENERGY, HEATING_VALUE_UNIT_TEXT } from '../../shared/fuelGrades.ts'
import { billingEnergy, NO_CO2_FUELS } from '../../shared/heatDelivery.ts'
import type { Problem } from './formProblems'

// Energieträger, bei denen CO₂-Kosten aufzuteilen sind: Brennstoffe mit Standardwerten nach § 7 Abs. 4
// BEHG (§ 2 Abs. 1 CO2KostAufG) und Fernwärme, wenn der Lieferant CO₂-Kosten ausweist. Dieselbe Liste
// wie `CO2_FUELS` in server/src/co2.ts, dazu Fernwärme (Durchsicht von #233, C1). Strom einer Wärmepumpe
// gehört nicht dazu.
export const CO2_ENERGIES: readonly HeatingEnergy[] = ['gas', 'oil', 'lpg', 'coal', 'districtHeating']

// Ob für eine Anlage CO₂-Angaben gefragt werden (Heizung PR 16): nach der Energie der Abrechnung und, bei
// Contracting, dem Brennstoff des Lieferanten; dieselbe Regel wie `co2Required` in server/src/co2.ts.
// Mit einem weiteren Erzeuger des Lieferanten (`mixed`) bleiben die Felder (Nachprüfung von #272, N1).
export const asksCo2Facts = (plant: { energy: HeatingEnergy; contracting?: boolean; heatGeneration?: HeatGeneration | null }): boolean =>
  CO2_ENERGIES.includes(billingEnergy(plant)) && !(plant.contracting === true && NO_CO2_FUELS.includes(plant.energy) && plant.heatGeneration !== 'mixed')

// Eine Teilmenge laut Rechnung im Formular (Heizung PR 20, Stufe 3 in 3.2 des Entwurfs).
export type FuelPartForm = { from: string; to: string; energyKwh: string; amount: string; fixed: string; emissionsKg: string; co2Cost: string }

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
  // Vorrat (Heizung PR 8): Lieferdatum, Rechnungsdatum und Menge. Seit Heizung PR 20 die Menge auch bei Gas,
  // Fernwärme und Strom (m³ oder kWh laut Rechnung); der Vorrat nimmt nur Liter, Kilogramm und Schüttraummeter.
  deliveredAt: string
  invoiceDate: string
  quantity: string
  quantityUnit: FuelQuantityUnit | ''
  // Etagenheizung (Heizung PR 9): die Wohnung, deren Heizung die Rechnung betrifft.
  unitId: string
  // Heizung PR 11 (Warmwasseranteil der eigenen Abrechnung): bei Gas, ob nach Brennwert oder Heizwert
  // abgerechnet; beim Vorrat der Heizwert laut Rechnung (kWh je Einheit der Menge) und, falls keiner darauf
  // steht, die Zeile der Tabelle des § 9 Abs. 3 HeizkostenV.
  gasBasis: GasBasis | ''
  heatingValue: string
  grade: FuelGrade | ''
  // Heizung PR 18 (§ 5a CO2KostAufG): Netzentgelte und Kosten des Pflichtanteils an Biobrennstoff laut Rechnung.
  gridFee: string
  bioCost: string
  // Heizung PR 20: der Emissionsfaktor laut Rechnung (§ 3 Abs. 1 Nr. 3 CO2KostAufG) und die Teilmengen.
  emissionFactor: string
  parts: FuelPartForm[]
}

export const emptyFuelForm = (): FuelForm => ({
  label: '', invoiceFrom: '', invoiceTo: '', amount: '', fixed: '', sharePercent: '', emissionsKg: '', co2Cost: '', energyKwh: '', usedByService: true,
  deliveredAt: '', invoiceDate: '', quantity: '', quantityUnit: '', unitId: '', gasBasis: '', heatingValue: '', grade: '', gridFee: '', bioCost: '',
  emissionFactor: '', parts: [],
})

const centsText = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numberText = (n: number | null, digits = 4): string =>
  n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: digits, useGrouping: false })

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
    quantityUnit: d.quantityUnit ?? '',
    unitId: d.unitId ?? '',
    gasBasis: d.gasBasis ?? '',
    heatingValue: numberText(d.heatingValue),
    grade: d.fuelGrade ?? '',
    gridFee: centsText(d.gridFeeCents),
    bioCost: centsText(d.bioCostCents),
    emissionFactor: numberText(d.emissionFactor, 6),
    parts: d.parts.map((p) => ({
      from: p.from, to: p.to, energyKwh: numberText(p.energyKwh), amount: centsText(p.amountCents), fixed: centsText(p.fixedCents),
      emissionsKg: numberText(p.emissionsKg), co2Cost: centsText(p.co2CostCents),
    })),
  }
}

// Netzentgelte und Biobrennstoff (Heizung PR 18) gehen nur bei einer Heizung nach § 43 Abs. 1 GModG in den Rumpf;
// sonst bleibt er, wie er war, und der Server sperrt beide Felder.
export type HalfSplitOptions = { halfSplit: boolean }
const NO_HALF_SPLIT: HalfSplitOptions = { halfSplit: false }

// Beim Brennstoff aus dem Tank nimmt der Server beim Biobrennstoff nur 0 an (Abweichung 10 des Plans, Prüfung M11).
export const STOCK_BIO_ONLY_ZERO = 'Beim Brennstoff aus dem Tank nimmt Mietfuchs beim Biobrennstoff nur 0 an (kein Pflichtanteil in der Lieferung); einen Betrag rechnet Mietfuchs mit einer späteren Version.'

// Die Einheiten einer Lieferung für den Vorrat, mit leerer Vorauswahl.
export const STOCK_QUANTITY_OPTIONS: readonly { value: StockUnit | ''; label: string }[] = [
  { value: '', label: 'Bitte wählen …' },
  { value: 'l', label: STOCK_UNIT_LABELS.l },
  { value: 'kg', label: STOCK_UNIT_LABELS.kg },
  { value: 'srm', label: STOCK_UNIT_LABELS.srm },
]

// Die Einheiten der Menge bei Gas, Fernwärme und Strom (Heizung PR 20), mit leerer Vorauswahl.
export const METERED_QUANTITY_OPTIONS: readonly { value: FuelQuantityUnit | ''; label: string }[] = [
  { value: '', label: 'keine Angabe' },
  { value: 'm3', label: 'm³' },
  { value: 'kWh', label: 'kWh' },
]
const isStockUnit = (u: FuelQuantityUnit | ''): u is StockUnit => u === 'l' || u === 'kg' || u === 'srm'

// Die Pflichtangaben einer Lieferung (#346 Schritt 7), alle auf einmal und je mit Feld, für `useFormError`. Erst wenn
// sie da sind, prüfen `fuelBody` bzw. `stockFuelBody` den Rest; deren Rumpf ändert sich dadurch nicht.
export type FuelField = 'unitId' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'quantity' | 'quantityUnit'
export function fuelRequiredProblems(form: FuelForm, place: { stock: boolean; perUnit: boolean }): Problem<FuelField>[] {
  const problems: Problem<FuelField>[] = []
  if (place.perUnit && form.unitId === '') problems.push({ field: 'unitId', short: 'Wohnung fehlt', text: 'Bitte wählen Sie die Wohnung, deren Heizung die Rechnung betrifft.' })
  if (place.stock) {
    if (form.deliveredAt === '') problems.push({ field: 'deliveredAt', short: 'Lieferdatum fehlt', text: 'Lieferung: Bitte geben Sie das Lieferdatum an. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.' })
    if (form.quantity.trim() === '') problems.push({ field: 'quantity', short: 'Menge fehlt', text: 'Lieferung: Bitte geben Sie die gelieferte Menge an, wie auf der Rechnung.' })
    if (form.quantityUnit === '') problems.push({ field: 'quantityUnit', short: 'Einheit fehlt', text: 'Lieferung: Bitte wählen Sie die Einheit der Menge.' })
  } else {
    if (form.invoiceFrom === '') problems.push({ field: 'invoiceFrom', short: 'Beginn fehlt', text: 'Lieferung: Bitte geben Sie den Beginn des Rechnungszeitraums laut Rechnung an.' })
    if (form.invoiceTo === '') problems.push({ field: 'invoiceTo', short: 'Ende fehlt', text: 'Lieferung: Bitte geben Sie das Ende des Rechnungszeitraums laut Rechnung an.' })
  }
  return problems
}

// Der Rumpf einer Lieferung von Heizöl, Flüssiggas, Pellets, Holz oder Kohle (Heizung PR 8): Lieferdatum
// und Menge statt Rechnungszeitraum; abgegrenzt wird über Anfangs- und Endbestand. Den Betrag gibt es
// nur beim Messdienst (bei freien Schlüsseln steht er in den verknüpften Positionen).
export function stockFuelBody(form: FuelForm, method: HeatingMethod, opts: HalfSplitOptions = NO_HALF_SPLIT): { body: Record<string, unknown> } | { error: string } {
  if (form.deliveredAt === '') return { error: 'Bitte geben Sie das Lieferdatum an. Beim Vorrat zählt eine Lieferung zur Heizperiode, in der sie geliefert wurde.' }
  const quantity = form.quantity.trim() === '' ? null : parseDecimal(form.quantity)
  if (quantity === null || !(quantity > 0)) return { error: 'Bitte geben Sie die gelieferte Menge an, wie auf der Rechnung.' }
  if (form.quantityUnit === '') return { error: 'Bitte wählen Sie die Einheit der Menge.' }
  if (!isStockUnit(form.quantityUnit)) return { error: 'Beim Vorrat geben Sie die Menge in Litern, Kilogramm oder Schüttraummetern an, wie auf der Rechnung.' }
  const factor = form.emissionFactor.trim() === '' ? null : parseDecimal(form.emissionFactor)
  if (form.emissionFactor.trim() !== '' && (factor === null || factor < 0)) return { error: 'Der Emissionsfaktor ist eine Zahl ab 0.' }
  const amount = method === 'service' && form.amount.trim() !== '' ? parseEuro(form.amount) : null
  if (method === 'service' && form.amount.trim() !== '' && amount === null) return { error: 'Der Rechnungsbetrag ist kein Betrag.' }
  const kg = form.emissionsKg.trim() === '' ? null : parseDecimal(form.emissionsKg)
  if (form.emissionsKg.trim() !== '' && (kg === null || kg < 0)) return { error: 'Der CO₂-Ausstoß ist eine Zahl ab 0.' }
  const co2 = form.co2Cost.trim() === '' ? null : parseEuro(form.co2Cost)
  if (form.co2Cost.trim() !== '' && co2 === null) return { error: 'Die CO₂-Kosten sind kein Betrag.' }
  if (ambiguousThousands(form.heatingValue)) return { error: `Heizwert laut Rechnung: ${ambiguousText(form.heatingValue)}` }
  const heatingValue = form.heatingValue.trim() === '' ? null : parseDecimal(form.heatingValue)
  if (form.heatingValue.trim() !== '' && (heatingValue === null || !(heatingValue > 0))) return { error: 'Der Heizwert laut Rechnung ist eine Zahl über 0.' }
  const bio = opts.halfSplit && form.bioCost.trim() !== '' ? parseEuro(form.bioCost) : null
  if (opts.halfSplit && form.bioCost.trim() !== '' && bio === null) return { error: 'Die Angabe zum Biobrennstoff ist kein Betrag.' }
  if (bio !== null && bio !== 0) return { error: STOCK_BIO_ONLY_ZERO }
  return {
    body: {
      label: form.label.trim(),
      deliveredAt: form.deliveredAt,
      heatingValue,
      fuelGrade: heatingValue === null && form.grade !== '' ? form.grade : null,
      invoiceDate: form.invoiceDate === '' ? form.deliveredAt : form.invoiceDate,
      quantity,
      quantityUnit: form.quantityUnit,
      ...(method === 'service' ? { amountCents: amount, usedByService: form.usedByService } : {}),
      emissionsKg: kg,
      co2CostCents: co2,
      emissionFactor: factor,
      ...(opts.halfSplit ? { bioCostCents: bio } : {}),
    },
  }
}

// Der Rumpf für POST und PUT. Ein leeres Feld ist `null`, ein unlesbares ein Fehler mit Satz. Den
// Betrag gibt es nur beim Messdienst (bei freien Schlüsseln steht er in den verknüpften Positionen),
// ebenso „vom Messdienst angesetzt“.
export function fuelBody(form: FuelForm, method: HeatingMethod, opts: HalfSplitOptions = NO_HALF_SPLIT): { body: Record<string, unknown> } | { error: string } {
  if (form.invoiceFrom === '' || form.invoiceTo === '') return { error: 'Bitte geben Sie den Rechnungszeitraum an (Beginn und Ende laut Rechnung).' }
  // `plural`: „Die CO₂-Kosten sind kein Betrag.“ (Durchsicht, Kann K6).
  const euro = (text: string, name: string, plural = false): number | null | { error: string } => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    return c === null ? { error: `${name} ${plural ? 'sind' : 'ist'} kein Betrag.` } : c
  }
  const decimal = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    return n === null || n < 0 ? { error: `${name} ist eine Zahl ab 0.` } : n
  }
  const fixed = euro(form.fixed, 'Der feste Preisbestandteil')
  const co2 = euro(form.co2Cost, 'Die CO₂-Kosten', true)
  const amount = method === 'service' ? euro(form.amount, 'Der Rechnungsbetrag') : null
  const kg = decimal(form.emissionsKg, 'Der CO₂-Ausstoß')
  const kwh = decimal(form.energyKwh, 'Die Energie')
  const share = decimal(form.sharePercent, 'Der eingetragene Anteil')
  const grid = opts.halfSplit ? euro(form.gridFee, 'Die Angabe zu den Netzentgelten') : null
  const bio = opts.halfSplit ? euro(form.bioCost, 'Die Angabe zum Biobrennstoff') : null
  const factor = decimal(form.emissionFactor, 'Der Emissionsfaktor')
  const quantity = decimal(form.quantity, 'Die Menge')
  for (const v of [fixed, co2, amount, kg, kwh, share, grid, bio, factor, quantity]) if (v !== null && typeof v === 'object') return v
  const num = (v: number | null | { error: string }): number | null => (typeof v === 'number' ? v : null)
  // Teilmengen laut Rechnung (Heizung PR 20): je Zeile Zeitraum und Betrag, wie der Server sie verlangt.
  const parts: Record<string, unknown>[] = []
  for (const [i, p] of form.parts.entries()) {
    const label = `Teilmenge ${i + 1}`
    if (p.from === '' || p.to === '' || p.from > p.to) return { error: `${label}: Bitte geben Sie den Zeitraum an (von bis).` }
    const partAmount = euro(p.amount, `${label}: Der Betrag`)
    if (partAmount === null) return { error: `${label}: Jede Teilmenge braucht ihren Betrag laut Rechnung.` }
    const partFixed = euro(p.fixed, `${label}: Der feste Preisbestandteil`)
    const partCo2 = euro(p.co2Cost, `${label}: Die CO₂-Kosten`, true)
    const partKwh = decimal(p.energyKwh, `${label}: Die Energie`)
    const partKg = decimal(p.emissionsKg, `${label}: Der CO₂-Ausstoß`)
    for (const v of [partAmount, partFixed, partCo2, partKwh, partKg]) if (v !== null && typeof v === 'object') return v
    parts.push({ from: p.from, to: p.to, energyKwh: num(partKwh), amountCents: num(partAmount), fixedCents: num(partFixed), emissionsKg: num(partKg), co2CostCents: num(partCo2) })
  }
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
    gasBasis: form.gasBasis === '' ? null : form.gasBasis,
    ...(method === 'service' ? { usedByService: form.usedByService } : {}),
    ...(opts.halfSplit ? { gridFeeCents: num(grid), bioCostCents: num(bio) } : {}),
    quantity: num(quantity),
    quantityUnit: form.quantityUnit === 'm3' || form.quantityUnit === 'kWh' ? form.quantityUnit : null,
    emissionFactor: num(factor),
    parts,
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

// ---------- Heizwert und Abrechnungsgrundlage (Heizung PR 11, § 9 Abs. 2 Satz 6 Nr. 1 und Abs. 3 HeizkostenV) ----------

// Gas nach Brennwert oder Heizwert: Davon hängt der Faktor 1,11 der Formeln für das Warmwasser ab.
export const GAS_BASIS_LABEL = 'Kilowattstunden der Rechnung berechnet nach'
export const GAS_BASIS_MISSING = 'Für den Warmwasseranteil nach einer Formel braucht Mietfuchs diese Angabe (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV); ohne sie rechnet die Formel nicht.'
// Ohne Angabe und mit einer Formel für das Warmwasser in dieser Heizperiode: schon an der Lieferung sagen,
// dass sie fehlt (Durchsicht von #240, Recht-I3). Vorbelegt wird nicht.
export const gasBasisMissing = (form: Pick<FuelForm, 'gasBasis'>, view: { hotWater: { dhwMethod: string | null } }): boolean =>
  form.gasBasis === '' && (view.hotWater.dhwMethod === 'volumeFormula' || view.hotWater.dhwMethod === 'areaFormula')
export const GAS_BASIS_OPTIONS: readonly { value: GasBasis | ''; label: string }[] = [
  { value: '', label: 'keine Angabe' },
  { value: 'hs', label: 'nach Brennwert (Hs)' },
  { value: 'hi', label: 'nach Heizwert (Hi)' },
]

// Die Zeilen der Tabelle zum Energieträger der Anlage; leer bei Fernwärme, Wärmepumpe und Strom, denn
// die Tabelle gilt nur bei Heizkesseln (Entwurf R-A13).
export function gradeOptions(energy: HeatingEnergy): { value: FuelGrade | ''; label: string }[] {
  const grades = GRADES_BY_ENERGY[energy]
  return grades.length === 0 ? [] : [{ value: '', label: 'keine (Heizwert laut Rechnung)' }, ...grades.map((g) => ({ value: g, label: FUEL_GRADE_LABELS[g] }))]
}
// Die Einheit der Menge im Satz „kWh je …“; ohne bekannte Einheit „Einheit“.
export const unitWordFor = (unit: string): string =>
  unit === 'l' || unit === 'm3' || unit === 'kg' || unit === 'srm' ? HEATING_VALUE_UNIT_TEXT[unit] : 'Einheit'

// Vorbelegt wird nur, wo es genau eine Zeile gibt (Flüssiggas, Pellets); sonst wird nicht geraten
// (Abweichung 4 des Plans PR 11).
export function defaultGrade(energy: HeatingEnergy): FuelGrade | '' {
  const grades = GRADES_BY_ENERGY[energy]
  return grades.length === 1 ? (grades[0] ?? '') : ''
}
