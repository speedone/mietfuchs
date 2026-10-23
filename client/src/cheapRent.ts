// Die ortsübliche Warmmiete einer Wohnung und die Auskunft zur verbilligten Vermietung (§ 21 Abs. 2 EStG, #257),
// ohne DOM. Gerechnet wird auf dem Server (server/src/cheapRent.ts); hier stehen das Formular des Seitenfensters und
// die Sätze zur Quote. Die Grenzen kommen mit dem Bericht aus dem Rechtsregister und stehen hier nicht als Zahl.
import { fmtDate, fmtEuro, parseEuro } from './api'
import { MONTH_NAMES, monthLabel, parseMonthText } from './monthText'
import type { Problem } from './formProblems'
import type { CheapRentReport, CheapRentTenancy, LocalRentEntry, PrepaymentEntry, Tenancy, Unit } from './types'

export type LocalRentForm = {
  unitId: string
  // Der Monat des Eintrags, den das Fenster bearbeitet; leer beim Anlegen.
  originalFrom: string
  from: string
  amount: string
  source: string
  sourceDate: string
}
export type LocalRentField = 'unitId' | 'from' | 'amount' | 'source' | 'sourceDate'

const centsText = (cents: number): string => (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const emptyLocalRentForm = (unitId: string, year: number): LocalRentForm => ({
  unitId, originalFrom: '', from: `${year}-01`, amount: '', source: '', sourceDate: '',
})
export const localRentToForm = (unitId: string, e: LocalRentEntry): LocalRentForm => ({
  unitId, originalFrom: e.from, from: e.from, amount: centsText(e.monthlyCents), source: e.source, sourceDate: e.sourceDate,
})

// Die Wohnungen, an denen sich eine ortsübliche Miete eintragen lässt: alle, die nicht selbst genutzt werden, auch eine
// vermietete außerhalb der Abrechnungseinheit (Durchsicht von PR #422, K3). Ob sie im Jahr vermietet ist, sagen ihre
// Mietverhältnisse; das rechnet der Server.
export const rentedUnits = (units: readonly Unit[]): Unit[] => units.filter((u) => !(u.selfUsed && !u.participates))

// Ein Anteil (0 bis 1) in Prozent auf zwei Stellen **abgeschnitten** (Durchsicht S3), wie die Quote vom Server.
export const percentText = (share: number): string => `${(Math.floor(share * 10000 + 1e-9) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`

// Alle Angaben auf einmal, je mit Feld; danach die ganze neue Staffel der Wohnung. Ein Eintrag zum selben Monat wird
// ersetzt, beim Bearbeiten fällt der bisherige Monat weg, wenn er geändert wurde.
export function buildLocalRents(form: LocalRentForm, units: readonly Unit[]): { problems: Problem<LocalRentField>[] } | { unitId: string; localRents: LocalRentEntry[] } {
  const problems: Problem<LocalRentField>[] = []
  const unit = units.find((u) => u.id === form.unitId)
  if (!unit) problems.push({ field: 'unitId', short: 'Wohnung fehlt', text: 'Ortsübliche Miete: Wählen Sie die Wohnung.' })
  const month = parseMonthText(form.from)
  if (!form.from.trim()) problems.push({ field: 'from', short: 'Monat fehlt', text: 'Ab Monat: Geben Sie den Monat an, ab dem der Wert gilt, etwa 01.2025.' })
  else if (month.kind !== 'month') problems.push({ field: 'from', short: 'Kein Monat', text: 'Ab Monat: Geben Sie den Monat als Monat und Jahr an, etwa 01.2025.' })
  const cents = parseEuro(form.amount)
  if (!form.amount.trim()) problems.push({ field: 'amount', short: 'Betrag fehlt', text: 'Ortsübliche Warmmiete: Geben Sie den Betrag im Monat ein, Kaltmiete laut Mietspiegel und umlagefähige Kosten.' })
  else if (cents === null || cents <= 0) problems.push({ field: 'amount', short: 'Kein Betrag', text: 'Ortsübliche Warmmiete: Geben Sie einen Betrag über 0 € ein, etwa 900,00.' })
  if (!form.source.trim()) problems.push({ field: 'source', short: 'Quelle fehlt', text: 'Quelle: Nennen Sie, woher der Wert stammt, etwa „Mietspiegel Musterstadt 2025, 7,10 bis 8,40 €/m²“.' })
  if (!form.sourceDate) problems.push({ field: 'sourceDate', short: 'Datum fehlt', text: 'Stand der Quelle: Geben Sie das Datum der Quelle an.' })
  if (problems.length > 0 || !unit || month.kind !== 'month' || cents === null) return { problems }
  const entry: LocalRentEntry = { from: month.key, monthlyCents: cents, source: form.source.trim(), sourceDate: form.sourceDate }
  const rest = (unit.localRents ?? []).filter((e) => e.from !== entry.from && e.from !== form.originalFrom)
  return { unitId: unit.id, localRents: [...rest, entry].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) }
}

export const withoutLocalRent = (unit: Unit, from: string): LocalRentEntry[] => (unit.localRents ?? []).filter((e) => e.from !== from)

// ---------- Direkt an Dritte gezahlte Kosten (#257, Entscheidung in PR #422) ----------
//
// Am Mietverhältnis als Staffel je Monat (`Tenancy.directCharges`), denn die Quote rechnet je Monat des Mietverhältnisses
// und der Betrag ändert sich mit Abschlägen und Verträgen; eingetragen in derselben Karte wie die ortsübliche Miete,
// gleich neben der Quote, auf die er wirkt. Er geht nur ins Entgelt, nie in Werbungskosten, Mietkonto oder Abrechnung.
export type DirectChargeForm = { tenancyId: string; originalFrom: string; from: string; amount: string }
export type DirectChargeField = 'from' | 'amount'

export const emptyDirectChargeForm = (tenancyId: string, year: number): DirectChargeForm => ({ tenancyId, originalFrom: '', from: `${year}-01`, amount: '' })
export const directChargeToForm = (tenancyId: string, e: PrepaymentEntry): DirectChargeForm => ({ tenancyId, originalFrom: e.from, from: e.from, amount: centsText(e.monthlyCents) })

export function buildDirectCharges(form: DirectChargeForm, tenancies: readonly Tenancy[]): { problems: Problem<DirectChargeField>[] } | { tenancyId: string; directCharges: PrepaymentEntry[] } {
  const problems: Problem<DirectChargeField>[] = []
  const month = parseMonthText(form.from)
  if (!form.from.trim()) problems.push({ field: 'from', short: 'Monat fehlt', text: 'Ab Monat: Geben Sie den Monat an, ab dem der Betrag gilt, etwa 01.2025.' })
  else if (month.kind !== 'month') problems.push({ field: 'from', short: 'Kein Monat', text: 'Ab Monat: Geben Sie den Monat als Monat und Jahr an, etwa 01.2025.' })
  const cents = parseEuro(form.amount)
  if (!form.amount.trim()) problems.push({ field: 'amount', short: 'Betrag fehlt', text: 'Direkt gezahlt im Monat: Geben Sie den Betrag ein, den der Mieter selbst an Versorger oder Gemeinde zahlt, etwa 150,00.' })
  else if (cents === null || cents < 0) problems.push({ field: 'amount', short: 'Kein Betrag', text: 'Direkt gezahlt im Monat: Geben Sie einen Betrag von 0 € oder mehr ein.' })
  const tenancy = tenancies.find((t) => t.id === form.tenancyId)
  if (!tenancy) problems.push({ text: 'Das Mietverhältnis gibt es nicht mehr. Bitte laden Sie die Seite neu.' })
  if (problems.length > 0 || !tenancy || month.kind !== 'month' || cents === null) return { problems }
  const rest = (tenancy.directCharges ?? []).filter((e) => e.from !== month.key && e.from !== form.originalFrom)
  return { tenancyId: tenancy.id, directCharges: [...rest, { from: month.key, monthlyCents: cents }].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) }
}

export const withoutDirectCharge = (t: Tenancy, from: string): PrepaymentEntry[] => (t.directCharges ?? []).filter((e) => e.from !== from)
export const directChargeLine = (e: PrepaymentEntry): string => `ab ${monthLabel(e.from)}: ${fmtEuro(e.monthlyCents)} im Monat direkt an Dritte gezahlt`

export const localRentLine = (e: LocalRentEntry): string =>
  `ab ${monthLabel(e.from)}: ${fmtEuro(e.monthlyCents)} im Monat, ${e.source}, Stand ${fmtDate(e.sourceDate)}`

// Was die Quote eines Mietverhältnisses bedeutet, in einem Satz.
export function verdictText(t: CheapRentTenancy, law: NonNullable<CheapRentReport['law']>): string {
  const charges = t.chargesSource === 'settlement' ? 'Umlagen laut Abrechnung des Jahres' : 'Umlagen laut vereinbarten Vorauszahlungen'
  const direct = t.directChargesCents ? `, direkt an Dritte gezahlt ${fmtEuro(t.directChargesCents)}` : ''
  const base = `${t.tenantName}: Entgelt ${fmtEuro(t.entgeltCents)} (Kaltmiete ${fmtEuro(t.baseRentCents)}, ${charges} ${fmtEuro(t.chargesCents)}${direct}) von ortsüblich ${fmtEuro(t.comparisonCents)}`
  const quote = t.quotePercent === null ? '' : ` = ${t.quotePercent.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`
  switch (t.verdict) {
    case 'split':
      return `${base}${quote}. Unter ${law.split} %: Die Werbungskosten der Wohnung sind nur zum entgeltlichen Teil abziehbar; Mietfuchs kürzt sie.`
    case 'forecast':
      return `${base}${quote}. Zwischen ${law.split} und unter ${law.paid} %: Ob die Werbungskosten voll abziehbar sind, entscheidet eine Totalüberschussprognose. Fällt sie negativ aus, sind die Werbungskosten nur zum entgeltlichen Teil abziehbar (BMF-Schreiben vom 08.10.2004, BStBl I S. 933, Rz. 13). Mietfuchs rechnet die Prognose nicht und kürzt nicht.`
    case 'paid':
      return `${base}${quote}. Ab ${law.paid} % gilt die Vermietung als entgeltlich.`
    case 'lowerBound':
      return `${base}${quote}. Der Mieter heizt selbst; was er unmittelbar an den Versorger zahlt, gehört auch zum Entgelt, und die Quote ist deshalb höher. Mietfuchs kürzt nicht. Tragen Sie ein, was er unmittelbar an den Versorger zahlt; dann rechnet Mietfuchs die Quote.`
    case 'incomplete':
      return `${t.tenantName}: Für ${t.missingMonths.map((m) => MONTH_NAMES[m - 1]).join(', ')} fehlt die ortsübliche Miete; Mietfuchs rechnet die Quote nicht.`
  }
}
