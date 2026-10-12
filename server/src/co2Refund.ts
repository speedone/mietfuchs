// CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, #97; § 5 Abs. 3, § 6 Abs. 2, 3, § 8 Abs. 2, § 9 und
// ab 2028 § 5a CO2KostAufG). Reine Funktionen. Rechtswerte reicht der Aufrufer herein; hier steht kein Datum und
// keine Rechtszahl (law-literals.test.ts).
//
// Den Betrag ermittelt nach § 5 Abs. 3 der Mieter; gebucht wird, was er angezeigt hat. Die Nachrechnung prüft ihn
// und steht im Rechenweg; weicht sie ab, meldet die Abrechnung das (`co2.refund-differs`). Gerechnet wird mit
// derselben Einstufung wie bei der eigenen Aufteilung des Vermieters (`selfSplit`, Heizung PR 7 und 18): Stufe,
// § 8, § 9 und die hälftige Teilung nach § 5a gemischt nach Gradtagen, § 9 nur auf den Teil nach Stufen.
import type { DayRange } from '../../shared/degreeDays.ts'
import type { Co2Refund, Co2StageRange, PeriodKey } from '../../shared/types.ts'
import type { Co2Stage } from '../../shared/law/co2kostaufg.ts'
import type { DegreeDayTable } from '../../shared/law/heizkostenv.ts'
import { dayBefore, eventPeriodEnd, shiftMonths } from '../../shared/law/register.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { selfSplit, stageRanges, tableFactor } from './co2.ts'
import { termsFromPieces, type Piece } from './halfSplit.ts'

export type RefundBasis = Pick<Co2Refund, 'billedFrom' | 'billedTo' | 'emissionsKg' | 'co2CostCents' | 'areaM2' | 'ownAppliances' | 'commercialUse' | 'commercialMetered' | 'nonResidential' | 'restriction' | 'halfSplitFrom' | 'gridFeeCents' | 'bioCostCents'>

// `applicable`: § 11 Abs. 2 für den Zeitraum des Lieferanten; `ranges`: Stufentabelle, bei einem Zeitraum unter
// einem Jahr gekürzt (§ 5 Abs. 3 Satz 4 i. V. m. Abs. 1 Satz 4); `restriction`: § 9 aus dem Register, `null` ohne
// Vorgabe; `pieces`: die Fassungen von `co2.half-split` über den Zeitraum des Lieferanten; `weigh`: Gradtage.
// `overYear`: Der Zeitraum ist länger als ein Jahr (Prüfung S6); dann rechnet Mietfuchs nicht nach. Umzurechnen ist nach
// § 6 Abs. 2 Satz 2, § 5 Abs. 3 Satz 4 i. V. m. § 5 Abs. 1 Satz 5; offen ist nur das Verfahren bei einer Tankfüllung
// (nach Zeit, Gradtagen oder Füllstand; Durchsicht S-6).
export type RefundLaw = {
  applicable: boolean
  ranges: readonly Co2StageRange[]
  decimals: number
  nonResidentialPermille: number
  restriction: { factor: number; bothSplit: boolean } | null
  cutPercent: number
  pieces: readonly Piece[]
  weigh: (r: DayRange) => number
  overYear: boolean
}

// Wie die Rechtswerte erfragt werden: in der Abrechnung mit Protokoll (`law`), in der Liste der Erstattungen ohne
// (`valueAt`).
export type LawAsk = {
  applicable: (period: DayRange) => boolean
  stageTable: (period: DayRange) => readonly Co2Stage[]
  decimals: (period: DayRange) => number
  restriction: (period: DayRange) => { factor: number; bothSplit: boolean }
  selfSupply: (date: string) => { nonResidentialPermille: number; ownAppliancesCutPercent: number }
  pieces: (period: DayRange) => readonly Piece[]
  degreeDays: (period: DayRange) => DegreeDayTable
}

// Die Rechtswerte für die Nachrechnung; `null`, wenn der Zeitraum des Lieferanten fehlt.
export function refundLawAt(b: RefundBasis & { supplierBilledAt: string }, ask: LawAsk): RefundLaw | null {
  if (b.billedFrom === null || b.billedTo === null) return null
  const period = { from: b.billedFrom, to: b.billedTo }
  const yearEnd = dayBefore(shiftMonths(period.from, 12))
  const none = { ranges: [], decimals: 0, nonResidentialPermille: 0, restriction: null, cutPercent: 0, pieces: [], weigh: () => 0 }
  if (period.to > yearEnd) return { applicable: true, overYear: true, ...none }
  if (!ask.applicable(period)) return { applicable: false, overYear: false, ...none }
  const self = ask.selfSupply(b.supplierBilledAt)
  const table = ask.degreeDays(period)
  return {
    applicable: true,
    overYear: false,
    ranges: stageRanges(ask.stageTable(period), tableFactor({ ...period, short: period.to < yearEnd })),
    decimals: ask.decimals(period),
    nonResidentialPermille: self.nonResidentialPermille,
    restriction: b.restriction === 'none' ? null : ask.restriction(period),
    cutPercent: self.ownAppliancesCutPercent,
    pieces: b.halfSplitFrom !== null ? ask.pieces(period) : [],
    weigh: (r) => degreeDayPermille([r], table),
  }
}

export type RefundExclusion = 'notApplicable' | 'commercialUnmetered' | 'overYear'
export type RefundProposal = {
  cents: number
  raw: number
  excluded: RefundExclusion | null
  value: number | null
  stagePercent: number | null
  permille: number | null
  co2Raw: number
  gridFeeRaw: number
  bioRaw: number
  cutRaw: number
}

export function refundProposal(b: RefundBasis, l: RefundLaw): RefundProposal | null {
  if (b.billedFrom === null || b.billedTo === null || b.co2CostCents === null) return null
  const none = (excluded: RefundExclusion): RefundProposal =>
    ({ cents: 0, raw: 0, excluded, value: null, stagePercent: null, permille: null, co2Raw: 0, gridFeeRaw: 0, bioRaw: 0, cutRaw: 0 })
  // Prüfung S6, Durchsicht S-6: Umzurechnen ist auf den Abrechnungszeitraum; wie bei einer Lieferung über mehr als ein
  // Jahr, sagt das Gesetz nicht.
  if (l.overYear) return none('overYear')
  if (!l.applicable) return none('notApplicable')
  // § 6 Abs. 3 Satz 1: bei gewerblicher Nutzung nur mit getrennter Messung und Nachweis.
  if (b.commercialUse && !b.commercialMetered) return none('commercialUnmetered')
  // § 6 Abs. 2 Satz 1 n. F. mit § 5a Abs. 3: ab dem Tag, der für die Heizung des Mieters gilt.
  const span = { from: b.billedFrom, to: b.billedTo }
  const applicable: DayRange[] = b.halfSplitFrom !== null && b.halfSplitFrom <= span.to
    ? [{ from: b.halfSplitFrom > span.from ? b.halfSplitFrom : span.from, to: span.to }]
    : []
  const terms = (pick: (v: Piece['value']) => number | null) => termsFromPieces(l.pieces, applicable, l.weigh, pick)
  const split = selfSplit({
    emissionsKg: b.emissionsKg,
    co2Cents: b.co2CostCents,
    areaM2: b.areaM2,
    ranges: l.ranges,
    decimals: l.decimals,
    // § 8 Abs. 2: im Nichtwohngebäude statt der Stufe.
    nonResidentialPermille: b.nonResidential ? l.nonResidentialPermille : null,
    restriction: b.restriction === 'none' || l.restriction === null ? null : { ...l.restriction, both: b.restriction === 'both' },
    halfSplit: terms((v) => v.co2Permille),
  })
  if (split.permille === null || split.landlordRaw === null) return null
  const half = (pick: (v: Piece['value']) => number | null): number => terms(pick).reduce((a, t) => a + (t.weight * t.permille) / 1000, 0)
  const co2Raw = split.landlordRaw
  const gridFeeRaw = (b.gridFeeCents ?? 0) * half((v) => v.gridFeePermille)
  const bioRaw = (b.bioCostCents ?? 0) * half((v) => v.bioPermille)
  const before = co2Raw + gridFeeRaw + bioRaw
  // § 6 Abs. 3 Satz 2: der ganze Anspruch um den Satz gekürzt. `ownAppliances` heißt: ein Gerät, das der Mieter
  // selbst gewählt hat und das ihm gehört (BT-Drs. 20/3172, S. 35); die Oberfläche fragt so.
  const cutRaw = b.ownAppliances ? (before * l.cutPercent) / 100 : 0
  const raw = before - cutRaw
  return { cents: Math.round(raw), raw, excluded: null, value: split.value, stagePercent: split.stage?.landlordPercent ?? null, permille: split.permille, co2Raw, gridFeeRaw, bioRaw, cutRaw }
}

// Ob eine Vorauszahlung auf Betriebskosten vereinbart ist (§ 6 Abs. 2 Satz 4): eine Staffel mit einem Betrag über
// 0, die im Zeitraum gilt (die der Nebenkosten oder eine eigene Heizvorauszahlung), und kein Nebenkostenmodell
// Pauschale oder Inklusivmiete. Die Vereinbarung zählt, nicht das Gezahlte. Ein Eintrag gilt ab seinem Monat bis
// zum nächsten Eintrag. Bei Pauschale oder ohne Umlage ist auszuzahlen (BT-Drs. 20/3172, S. 35).
type Staffel = readonly { from: string; monthlyCents: number }[]
export function prepaymentAgreed(
  t: { prepayments: Staffel; heatingPrepayments?: Staffel; costModel?: 'settlement' | 'flatRate' | 'inclusive' },
  p: { from: string; to: string },
): boolean {
  const startMonth = p.from.slice(0, 7)
  const endMonth = p.to.slice(0, 7)
  const inPeriod = (list: Staffel): boolean => {
    const sorted = [...list].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    return sorted.some((e, i) => {
      const until = sorted[i + 1]?.from
      return e.monthlyCents > 0 && e.from <= endMonth && (until === undefined || until > startMonth)
    })
  }
  // Durchsicht K-1: Die Staffel der Nebenkosten zählt nur ohne Pauschale oder Inklusivmiete für die kalten Kosten; eine
  // eigene Heizvorauszahlung ist auch dann eine Vorauszahlung auf Betriebskosten.
  const cold = t.costModel !== 'flatRate' && t.costModel !== 'inclusive' && inPeriod(t.prepayments)
  return cold || inPeriod(t.heatingPrepayments ?? [])
}

export type RefundStepText = { euro: (cents: number) => string; exact: (cents: number) => string; num: (n: number) => string; applicableFrom: string; cutPercent: number }

// Der Rechenweg der Gutschriftzeile (#114): die Nachrechnung, soweit die Grundlagen eingetragen sind, und der
// angezeigte Betrag.
export function refundSteps(p: RefundProposal | null, b: RefundBasis, amountCents: number, t: RefundStepText): { label: string; value: string }[] {
  const shown = { label: 'Betrag laut Anzeige', value: t.euro(amountCents) }
  if (!p) return [shown]
  if (p.excluded === 'overYear') return [{ label: 'Nachgerechnet', value: 'nicht nachgerechnet: Das Gesetz verlangt, den Ausstoß auf den vereinbarten Abrechnungszeitraum umzurechnen (§ 6 Abs. 2 Satz 2, § 5 Abs. 3 Satz 4 i. V. m. § 5 Abs. 1 Satz 5 CO2KostAufG); wie das bei einer Lieferung über mehr als ein Jahr geschieht, sagt es nicht, und Mietfuchs rechnet es deshalb nicht nach.' }, shown]
  if (p.excluded === 'notApplicable') return [{ label: 'Nachgerechnet', value: `kein Anspruch: Der Zeitraum des Lieferanten beginnt vor dem ${t.applicableFrom} (§ 11 Abs. 2 CO2KostAufG)` }, shown]
  if (p.excluded === 'commercialUnmetered') return [{ label: 'Nachgerechnet', value: 'kein Anspruch ohne getrennte Messung des Wärmeverbrauchs bei gewerblicher Nutzung (§ 6 Abs. 3 Satz 1 CO2KostAufG)' }, shown]
  const steps: { label: string; value: string }[] = []
  if (p.value !== null && b.emissionsKg !== null && b.areaM2 !== null) {
    steps.push({ label: 'CO₂-Ausstoß je m² und Jahr', value: `${t.num(b.emissionsKg)} kg ÷ ${t.num(b.areaM2)} m² = ${t.num(p.value)} kg` })
  }
  const percent = t.num(Math.round((p.permille ?? 0) * 100) / 1000)
  steps.push({ label: 'Anteil des Vermieters', value: `${percent} %` })
  steps.push({ label: 'CO₂-Kosten des Vermieters', value: `${t.euro(b.co2CostCents ?? 0)} × ${percent} % = ${t.exact(p.co2Raw)}` })
  if (p.gridFeeRaw > 0) steps.push({ label: 'Gasnetzentgelte nach § 5a', value: t.exact(p.gridFeeRaw) })
  if (p.bioRaw > 0) steps.push({ label: 'Biobrennstoff nach § 5a', value: t.exact(p.bioRaw) })
  if (p.cutRaw > 0) steps.push({ label: 'Eigene Geräte zu anderen Zwecken', value: `− ${t.cutPercent} %: − ${t.exact(p.cutRaw)} (§ 6 Abs. 3 Satz 2 CO2KostAufG)` })
  steps.push({ label: 'Nachgerechnet', value: t.euro(p.cents) })
  steps.push(shown)
  return steps
}

// § 6 Abs. 2 Satz 3: Anzeige binnen der Frist ab der Abrechnung des Lieferanten; Satz 5: Erstattung spätestens so
// lange nach der Anzeige. Fristende nach §§ 187 Abs. 1, 188 Abs. 2, 3 BGB.
export const claimDeadline = (supplierBilledAt: string, months: number): string => eventPeriodEnd(supplierBilledAt, months)
export const refundDueDate = (claimedAt: string, months: number): string => eventPeriodEnd(claimedAt, months)

export type SettlementCandidate = { key: PeriodKey; from: string; deadline: string; sentAt: string | null }

// „Die nächste auf die Anzeige folgende jährliche Betriebskostenabrechnung“ (§ 6 Abs. 2 Satz 4): die früheste, deren
// Frist (§ 556 Abs. 3 Satz 2 BGB) am Tag der Anzeige noch läuft und die nicht vorher versandt wurde. Festlegung:
// Auch eine verspätete Abrechnung, nur ohne Nachforderung, ist eine „folgende“; der Hinweis sagt deshalb „in der Regel“.
export function nextSettlement(claimedAt: string, candidates: readonly SettlementCandidate[]): PeriodKey | null {
  const open = candidates.filter((c) => c.deadline >= claimedAt && !(c.sentAt !== null && c.sentAt.slice(0, 10) < claimedAt))
  let first: SettlementCandidate | null = null
  for (const c of open) if (first === null || c.from < first.from) first = c
  return first?.key ?? null
}
