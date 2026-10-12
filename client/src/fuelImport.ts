// Eine ausgelesene Lieferantenrechnung ins Formular der Lieferung (Heizung PR 20, #103), ohne DOM. Gespeichert
// wird mit „Lieferung speichern“ wie jede Lieferung. Mietfuchs rechnet nichts vor (Entwurf 16); die Prüfungen
// vergleichen nur Angaben derselben Rechnung miteinander und sagen, was das Formular nicht übernimmt.
import { fmtEuro } from './api'
import type { FuelForm } from './fuelForm'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { formatDayRange } from '../../shared/period.ts'
import { germanDate } from '../../shared/law/register.ts'
import { bioCapFrom, gmodgHeating43 } from '../../shared/law/gmodg.ts'
import { co2HalfSplit, halfSplitBioFirstDay } from '../../shared/law/co2kostaufg.ts'
import type { FuelInvoiceExtraction, FuelQuantityUnit, HeatingMethod } from './types'

// Wo die Rechnung landet: wer abrechnet, ob Brennstoff aus einem Vorrat (Lieferdatum und Menge statt
// Zeitraum, PR 8) und ob die Anlage eine Heizung nach § 43 Abs. 1 GModG ist (Netzentgelte und
// Biobrennstoff, PR 18).
export type FuelImportPlace = { method: HeatingMethod; stock: boolean; halfSplit: boolean }

const euroText = (eur: number | null): string => (eur === null ? '' : eur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: false }))
const cents = (eur: number | null): number => Math.round((eur ?? 0) * 100)
const STOCK_UNITS: readonly FuelQuantityUnit[] = ['l', 'kg', 'srm']
const METERED_UNITS: readonly FuelQuantityUnit[] = ['m3', 'kWh']

// Der letzte Tag, nach dem sich die Grenze richtet: das Ende des Rechnungszeitraums, beim Vorrat der Liefertag
// (wie `guardDelivery` in server/src/db/fuel.ts).
const endOf = (x: FuelInvoiceExtraction): string | null => x.periodEnd ?? x.deliveredAt ?? null

// Ob der Server einen Betrag zum Biobrennstoff an dieser Anlage annimmt (PR 18, `guardDelivery`): nur an einer
// Heizung nach § 43 Abs. 1 GModG; aus einem Vorrat und ab dem Jahr, in dem der Pflichtanteil die Grenze von
// § 5a Abs. 3 Nr. 3 CO2KostAufG übersteigt, nur die 0.
export function bioAccepted(at: { halfSplit: boolean; stock: boolean }, bioEur: number | null, end: string | null): boolean {
  if (bioEur === null || !at.halfSplit) return false
  if (bioEur === 0) return true
  const cap = bioCapFrom()
  return !at.stock && !(cap !== null && end !== null && end >= cap)
}

export function fuelFormFromExtraction(x: FuelInvoiceExtraction, base: FuelForm, place: FuelImportPlace): FuelForm {
  const when = !place.stock && x.periodStart && x.periodEnd ? formatDayRange(x.periodStart, x.periodEnd) : x.deliveredAt ? germanDate(x.deliveredAt) : ''
  const units = place.stock ? STOCK_UNITS : METERED_UNITS
  const bio = bioAccepted(place, x.bioCostEur, endOf(x))
  return {
    ...base,
    label: base.label || [x.vendor ?? 'Rechnung', when].filter((s) => s !== '').join(' '),
    // Beim Vorrat gibt es keinen Rechnungszeitraum und keine Teilmengen (der Server lehnt sie dort ab).
    invoiceFrom: place.stock ? base.invoiceFrom : x.periodStart ?? base.invoiceFrom,
    invoiceTo: place.stock ? base.invoiceTo : x.periodEnd ?? base.invoiceTo,
    deliveredAt: place.stock ? x.deliveredAt ?? base.deliveredAt : base.deliveredAt,
    invoiceDate: x.invoiceDate ?? base.invoiceDate,
    amount: x.totalGrossEur !== null ? euroText(x.totalGrossEur) : base.amount,
    fixed: x.fixedEur !== null ? euroText(x.fixedEur) : base.fixed,
    quantity: x.quantity !== null && x.quantityUnit !== null && units.includes(x.quantityUnit) ? numberText(x.quantity) : base.quantity,
    quantityUnit: x.quantityUnit !== null && units.includes(x.quantityUnit) ? x.quantityUnit : base.quantityUnit,
    energyKwh: x.energyKwh !== null ? numberText(x.energyKwh) : base.energyKwh,
    gasBasis: x.gasBasis ?? base.gasBasis,
    heatingValue: x.heatingValue !== null ? numberText(x.heatingValue) : base.heatingValue,
    emissionsKg: x.emissionsKg !== null ? numberText(x.emissionsKg) : base.emissionsKg,
    co2Cost: x.co2CostEur !== null ? euroText(x.co2CostEur) : base.co2Cost,
    emissionFactor: x.emissionFactor !== null ? numberText(x.emissionFactor) : base.emissionFactor,
    // Nur, wo der Server es annimmt; sonst bleibt das Feld, wie es war, und fuelChecks nennt den Betrag.
    bioCost: bio && x.bioCostEur !== null ? euroText(x.bioCostEur) : base.bioCost,
    parts: place.stock ? base.parts : x.parts.map((p) => ({
      from: p.from, to: p.to, energyKwh: numberText(p.energyKwh), amount: euroText(p.amountEur), fixed: euroText(p.fixedEur),
      emissionsKg: numberText(p.emissionsKg), co2Cost: euroText(p.co2CostEur),
    })),
  }
}

const BIO = 'Preisbestandteil für den nach § 43 Abs. 1 GModG anteilig zu nutzenden Brennstoff'

// Warum der Preisbestandteil nach § 3 Abs. 1 Nr. 6 CO2KostAufG nicht im Formular steht, oder dass er übernommen
// ist (Prüfung M6). Datum und Prozent kommen aus dem Rechtsregister.
function bioText(x: FuelInvoiceExtraction, place: FuelImportPlace): string | null {
  if (x.bioCostEur === null || x.bioCostEur === 0) return null
  const read = `Die Rechnung weist ${fmtEuro(cents(x.bioCostEur))} als ${BIO} aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG).`
  if (!place.halfSplit) {
    const [heating] = gmodgHeating43.versions
    const after = heating ? germanDate(heating.value.installedAfter) : ''
    return `${read} Mietfuchs hat ihn nicht übernommen, weil an dieser Heizanlage kein Einbau nach § 43 Abs. 1 GModG eingetragen ist. Diese Pflicht gilt nur für eine Gas-, Öl- oder Flüssiggasheizung, die nach dem ${after} in ein bestehendes Gebäude eingebaut wurde. Trifft das zu, tragen Sie den Tag des Einbaus an der Heizanlage ein und lesen Sie die Rechnung erneut aus.`
  }
  if (place.stock) return `${read} Mietfuchs hat ihn nicht übernommen, weil Mietfuchs diesen Preisbestandteil bei Brennstoff aus einem Vorrat noch nicht rechnet. Bitte bewahren Sie die Rechnung auf.`
  const cap = bioCapFrom()
  const end = endOf(x)
  if (cap !== null && end !== null && end >= cap) {
    return `${read} Mietfuchs hat ihn nicht übernommen, weil ab dem ${germanDate(cap)} der Pflichtanteil die Grenze von § 5a Abs. 3 Nr. 3 CO2KostAufG übersteigt; das rechnet Mietfuchs mit einer späteren Version. Bitte bewahren Sie die Rechnung auf.`
  }
  const capPermille = co2HalfSplit.versions.map((v) => v.value.bioCapPermille).find((c) => c !== null) ?? null
  const limit = capPermille === null ? '' : ` und höchstens für einen Brennstoffanteil von ${capPermille / 10} Prozent`
  return `Die Rechnung weist einen ${BIO} aus (§ 3 Abs. 1 Nr. 6 CO2KostAufG). Mietfuchs hat ihn übernommen. Hälftig geteilt werden diese Kosten erst ab dem ${germanDate(halfSplitBioFirstDay())}${limit} (§ 5a Abs. 1 Nr. 2, Abs. 3 Nr. 3 CO2KostAufG).`
}

export function fuelChecks(x: FuelInvoiceExtraction, place: FuelImportPlace): string[] {
  const out: string[] = []
  // Bei freien Schlüsseln und eigener Abrechnung nimmt eine Lieferung keinen Betrag an (Prüfung S3).
  if (place.method !== 'service' && x.totalGrossEur !== null) {
    out.push(`Bei freien Schlüsseln steht der Rechnungsbetrag in der Kostenposition. Legen Sie eine Position „${HEATING_CATEGORY}“ über ${fmtEuro(cents(x.totalGrossEur))} an und verknüpfen Sie sie mit dieser Lieferung.`)
  }
  if (x.parts.length > 0 && x.totalGrossEur !== null) {
    const sum = x.parts.reduce((a, p) => a + cents(p.amountEur), 0)
    if (Math.abs(sum - cents(x.totalGrossEur)) > x.parts.length) {
      out.push(`Die Teilmengen ergeben ${fmtEuro(sum)}, der Rechnungsbetrag ist ${fmtEuro(cents(x.totalGrossEur))}. Bitte prüfen Sie, ob eine Teilmenge fehlt oder ob die Nachzahlung statt des Rechnungsbetrags gelesen wurde.`)
    }
  }
  if (x.parts.length > 0 && x.energyKwh !== null && x.parts.every((p) => p.energyKwh !== null)) {
    const kwh = x.parts.reduce((a, p) => a + (p.energyKwh ?? 0), 0)
    if (Math.abs(kwh - x.energyKwh) > 1) {
      out.push(`Die Teilmengen ergeben ${kwh.toLocaleString('de-DE')} kWh, die Rechnung nennt ${x.energyKwh.toLocaleString('de-DE')} kWh.`)
    }
  }
  if (x.co2CostNet) {
    out.push('Die Rechnung nennt die CO₂-Kosten ohne Umsatzsteuer. Auszuweisen sind sie einschließlich Umsatzsteuer (§ 3 Abs. 1 Nr. 2, Abs. 3 CO2KostAufG); das ist Sache des Lieferanten. Sie können bei ihm eine berichtigte Rechnung anfordern. Mietfuchs rechnet den Betrag nicht um. Kennen Sie den Betrag mit Umsatzsteuer, tragen Sie ihn selbst ein.')
  }
  if (x.amountsAdjusted === 'netto') {
    out.push('Die Teilmengen waren netto ausgewiesen; Mietfuchs hat sie anteilig auf den Rechnungsbetrag hochgerechnet. Bitte prüfen Sie die Beträge.')
  }
  if (x.amountsNetUnadjusted) {
    out.push('Die Rechnung nennt die Teilmengen netto, und der Abstand zum Rechnungsbetrag lässt sich nicht allein mit der Umsatzsteuer erklären. Bitte tragen Sie die Bruttobeträge von Hand ein.')
  }
  const bio = bioText(x, place)
  if (bio) out.push(bio)
  return out
}
