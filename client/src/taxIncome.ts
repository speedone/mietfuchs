// Die Einnahmen der Steuerübersicht nach Zeilen der Anlage V (#312 PR 3, Entwurf
// docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md, „Oberfläche“ und E8).
//
// Der Server teilt das Zugeflossene jeder Mietzahlung nach der Tilgung auf (`income.received`, calc.ts
// `receivedIncome`); hier wird es nur den Zeilen des Vordrucks zugeordnet, deren Nummern aus der einen Tabelle
// `anlageVLines` kommen. Die Seite rendert nur. Mit Mietverhältnissen an Angehörige (`relative`) stehen die Zeilen 19, 22
// und 23 eigens, 15/18, 20 und 21 zeigen den Rest (E4). Die Summe der Zeilen ist Zeile 32; wegen der Zehn-Tage-Regel
// (§ 11 Abs. 1 Satz 2 EStG) ist sie `paidCents` − `forwardCents` + `fromPreviousCents`.
//
// **Auslegungen dieses Moduls** (im Bericht des PR genannt):
// - Zeile 15/18 zählt die Inklusivmiete mit, beide Spalten: Die ganze Miete gehört dann zu den Mieteinnahmen (Hinweis
//   `inclusiveLine24`, E5); sie steht als „davon“ darunter. Das Soll dieser Zeile ist deshalb `baseRentSollCents` (in dem
//   die Inklusivmiete schon steckt), nicht Kaltmiete ohne Inklusivmiete.
// - Das Soll kennt der Bericht nicht je Mietverhältnis. Mit Angehörigen tragen 15/18 und 20 das ganze Soll, vermerkt
//   „einschließlich Zeile 19“ bzw. „22“; die Zeilen der Angehörigen haben kein Soll.
// - Die Pauschale nennt die Tabelle unter Zeile 20 für alle Mietverhältnisse; mit Angehörigen steht sie zusammen für 20 und 22.
import type { TaxReceived, TaxReport } from './types'
import { anlageVLines, type Line } from './anlageV'
import { fmtDate, fmtEuro } from './api'
import { germanDate, LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { estgShortPeriodDays } from '../../shared/law/estg.ts'
import { bgbRentDueAtStart } from '../../shared/law/bgb-betrkv.ts'

// Die kurze Zeit um den Jahreswechsel in Tagen (§ 11 Abs. 1 Satz 2 EStG), für Texte zum Rechtsstand (K3).
export const SHORT_PERIOD_DAYS = valueAt(estgShortPeriodDays, LAW_AS_OF)
// Bis zu diesem Tag bestehende Mietverhältnisse zahlen nach § 551 BGB a. F. am Monatsende (Art. 229 § 3 Abs. 1 Nr. 7 EGBGB).
export const OLD_LEASE_UNTIL = germanDate(bgbRentDueAtStart.versions.find((v) => v.value === false)?.validTo ?? '')

export type IncomeRowKey =
  | 'homes' | 'inclusive' | 'unallocated' | 'relatives' | 'allocations' | 'flatRate'
  | 'settlement' | 'relativesAllocations' | 'relativesSettlement' | 'formerYears' | 'formerYearsAllocations'

export type IncomeRow = {
  key: IncomeRowKey
  // Zeile und Kennzahl des Vordrucks, wo das Jahr gelesen ist (`anlageVLines`), sonst null.
  line: string | null
  code: string | null
  label: string
  // eingegangen (Ist) und vereinbart (Soll); null = gibt es nicht oder ist nicht bekannt („–“)
  paidCents: number | null
  sollCents: number | null
  // eine „davon“-Zeile
  sub: boolean
  // ein Vermerk am Soll, wenn es mehr umfasst als die Zeile
  sollNote?: string
}

export type IncomeTable = {
  rows: IncomeRow[]
  paidTotalCents: number
  sollTotalCents: number
  // Zeile 32, wo gelesen
  totalLine: number | null
  // Spalte „Zeile“ nur, wenn der Vordruck des Jahres eine Nummer kennt
  showsLines: boolean
  relatives: boolean
}

const lineText = (...ls: (Line | undefined)[]): string | null => (ls.every((l) => l !== undefined) ? ls.map((l) => String(l?.line)).join(', ') : null)
const codeText = (...ls: (Line | undefined)[]): string | null =>
  ls.every((l) => l?.code !== undefined) ? ls.map((l) => String(l?.code).padStart(2, '0')).join(', ') : null

// Gibt es Mietverhältnisse an Angehörige? Dann stehen 19, 22 und 23 eigens.
export function hasRelatives(report: Pick<TaxReport, 'income' | 'costModels'>): boolean {
  return (report.costModels.relativeTenancies ?? 0) > 0 || (report.income.received?.byTenancy.some((t) => t.relative) ?? false)
}

// Die Summe der Zeilen (Zeile 32) auf der Ist-Grundlage: der Zufluss nach Datum, um die Zehn-Tage-Regel berichtigt.
export function receivedTotalCents(report: Pick<TaxReport, 'income'>): number {
  const t = report.income.received?.turnOfYear
  return report.income.paidCents - (t?.forwardCents ?? 0) + (t?.fromPreviousCents ?? 0)
}

export function incomeTable(report: TaxReport): IncomeTable {
  const i = anlageVLines(report.year)?.income
  const inc = report.income
  const r: TaxReceived | undefined = inc.received
  const rel = hasRelatives(report)
  const others = (r?.byTenancy ?? []).filter((t) => !t.relative)
  const sumOthers = (f: (t: TaxReceived['byTenancy'][number]) => number): number => others.reduce((a, t) => a + f(t), 0)
  const settlement = inc.settlementBackPaymentsCents - inc.settlementRefundsCents
  const R = r?.relatives ?? { rentCents: 0, allocationsCents: 0, settlementCents: 0 }
  const make = (key: IncomeRowKey, label: string, paidCents: number | null, sollCents: number | null, sub: boolean, ls: (Line | undefined)[] = [], sollNote?: string): IncomeRow => ({
    key, label, paidCents, sollCents, sub, line: ls.length > 0 ? lineText(...ls) : null, code: ls.length > 0 ? codeText(...ls) : null, ...(sollNote ? { sollNote } : {}),
  })
  const rows: IncomeRow[] = [
    make('homes', 'Mieteinnahmen ohne Umlagen', r ? r.rentCents - R.rentCents : null, inc.baseRentSollCents, false, [i?.homes, i?.otherRooms],
      rel && i?.relatives ? `einschließlich Zeile ${i.relatives.line}` : rel ? 'einschließlich der Angehörigen' : undefined),
    make('inclusive', 'davon Inklusivmieten (Nebenkosten eingeschlossen)', r ? (rel ? sumOthers((t) => t.inclusiveRentCents) : r.inclusiveRentCents) : null, inc.inclusiveRentSollCents, true),
    make('unallocated', 'davon ohne vereinbarte Miete (Überzahlung)', r ? (rel ? sumOthers((t) => t.unallocatedCents) : r.unallocatedCents) : null, null, true),
  ]
  if (rel) rows.push(make('relatives', 'Mieteinnahmen ohne Umlagen, an Angehörige vermietet', r ? R.rentCents : null, null, false, [i?.relatives]))
  rows.push(
    make('allocations', 'Umlagen: laufende Vorauszahlungen und Pauschalen', r ? r.allocationsCents - R.allocationsCents : null, inc.prepaymentSollCents + inc.flatRateSollCents, false, [i?.allocations],
      rel && i?.relativesAllocations ? `einschließlich Zeile ${i.relativesAllocations.line}` : rel ? 'einschließlich der Angehörigen' : undefined),
    make('flatRate', rel ? 'davon Betriebskostenpauschalen (mit den Angehörigen)' : 'davon Betriebskostenpauschalen', r ? r.flatRateCents : null, inc.flatRateSollCents, true),
    make('settlement', 'Nachzahlungen minus erstattete Guthaben aus der Abrechnung', settlement - (r ? R.settlementCents : 0), null, false, [i?.settlement]),
  )
  if (rel) {
    rows.push(
      make('relativesAllocations', 'Umlagen, an Angehörige vermietet', r ? R.allocationsCents : null, null, false, [i?.relativesAllocations]),
      make('relativesSettlement', 'Nachzahlungen minus Guthaben, an Angehörige vermietet', r ? R.settlementCents : null, null, false, [i?.relativesSettlement]),
    )
  }
  rows.push(
    make('formerYears', 'Mieten für frühere Jahre', r ? r.formerYearsCents : null, null, false, [i?.formerYears]),
    make('formerYearsAllocations', 'davon Umlagen', r ? r.formerYearsAllocationsCents : null, null, true),
  )
  // Zeilen mit 0 € (oder ohne Wert) in beiden Spalten entfallen, außer 15/18 und 20; mit Angehörigen bleiben 19 und 22.
  const always: IncomeRowKey[] = ['homes', 'allocations', ...(rel ? (['relatives', 'relativesAllocations'] as const) : [])]
  const shown = rows.filter((x) => always.includes(x.key) || (x.paidCents ?? 0) !== 0 || (x.sollCents ?? 0) !== 0)
  return {
    rows: shown,
    paidTotalCents: r ? receivedTotalCents(report) : inc.paidCents,
    sollTotalCents: inc.sollCents,
    totalLine: i?.total ?? null,
    showsLines: shown.some((x) => x.line !== null),
    relatives: rel,
  }
}

// Je Wohnung für die Zeilen 13 und 14: Bezeichnung, Fläche, Miete ohne Umlagen; an Angehörige vermietet gehört sie in Zeile 19.
export type UnitIncomeRow = { unitId: string; unitName: string; areaM2: number | null; rentCents: number; relative: boolean }
export function unitRows(report: Pick<TaxReport, 'income'>): UnitIncomeRow[] {
  const r = report.income.received
  if (!r) return []
  return r.byUnit.map((u) => ({
    unitId: u.unitId, unitName: u.unitName, areaM2: u.areaM2, rentCents: u.rentCents,
    relative: r.byTenancy.some((t) => t.unitId === u.unitId && t.relative),
  }))
}

// ---------- Sätze der Hinweise ----------

const rentLines = (year: number): { rent: string; allocations: string } | null => {
  const i = anlageVLines(year)?.income
  return i?.homes && i.otherRooms && i.allocations ? { rent: `Zeile ${i.homes.line}/${i.otherRooms.line}`, allocations: `Zeile ${i.allocations.line}` } : null
}

// `turnOfYear` (E8 nach der Durchsicht von PR 2): nur mit Betrag. Vorwärts ruhig und ohne Vorbehalt, denn Mietfuchs
// wendet die Regel an; aus dem Vorjahr mit Beträgen je Zeile. Nie ein Satz, der eine Verschiebung ins alte Jahr nahelegt.
export function turnOfYearLines(report: Pick<TaxReport, 'year' | 'income' | 'costModels'>): string[] {
  const t = report.income.received?.turnOfYear
  if (!t) return []
  const out: string[] = []
  if (t.fromPreviousCents !== 0) {
    const lines = hasRelatives(report) ? null : rentLines(report.year)
    const rent = t.fromPreviousCents - t.fromPreviousAllocationsCents
    const head = `${fmtEuro(t.fromPreviousCents)} Januarmiete aus dem Dezember ${report.year - 1} stehen nach § 11 Abs. 1 Satz 2 EStG in diesem Jahr`
    out.push(lines
      ? `${head}: ${t.fromPreviousAllocationsCents !== 0 ? `${fmtEuro(rent)} in ${lines.rent} und ${fmtEuro(t.fromPreviousAllocationsCents)} in ${lines.allocations}` : `in ${lines.rent}`}.`
      : `${head}${t.fromPreviousAllocationsCents !== 0 ? `, davon ${fmtEuro(t.fromPreviousAllocationsCents)} Umlagen` : ''}.`)
  }
  if (t.forwardCents !== 0) {
    out.push(`${fmtEuro(t.forwardCents)} Januarmiete sind Ende Dezember ${report.year} eingegangen; sie zählen nach § 11 Abs. 1 Satz 2 EStG im Jahr ${report.year + 1} und stehen dort.`)
  }
  return out
}

// Die Begründung unter „Mehr dazu“, mit der Zahl der Tage aus dem Register.
export const TURN_OF_YEAR_MORE = `Regelmäßig wiederkehrende Einnahmen wie die Miete, die kurze Zeit vor Beginn oder nach Ende des Kalenderjahres zufließen, zu dem sie wirtschaftlich gehören, gelten als in diesem Jahr bezogen (§ 11 Abs. 1 Satz 2 EStG). Kurze Zeit sind bis zu ${SHORT_PERIOD_DAYS} Tage, und in dieser Zeit muss die Zahlung auch fällig sein (H 11 EStH; BFH, Urteil vom 24.07.1986, IV R 309/84; BFH, Urteil vom 16.02.2022, X R 2/21). Die Januarmiete ist spätestens am dritten Werktag fällig (§ 556b Abs. 1 BGB). Das Mietkonto bleibt beim Datum der Zahlung.`

// Altvertrag vorwärts: Mietfuchs verschiebt nicht, nennt aber den Vorbehalt.
export function oldLeaseForwardText(report: Pick<TaxReport, 'year' | 'income'>): string | null {
  const c = report.income.received?.turnOfYear.forwardOldLeaseCents ?? 0
  if (c === 0) return null
  return `${fmtEuro(c)} Januarmiete sind Ende Dezember eingegangen, aus einem Mietverhältnis, das schon am ${OLD_LEASE_UNTIL} bestand. Ohne andere Vereinbarung ist die Miete dort am Monatsende fällig, die Januarmiete also nicht in den ${SHORT_PERIOD_DAYS} Tagen um den Jahreswechsel; Mietfuchs lässt den Betrag deshalb im Jahr der Zahlung. Ist laut Vertrag zu Beginn des Monats zu zahlen, gehört er ins Jahr ${report.year + 1}.`
}
export const OLD_LEASE_MORE = `Art. 229 § 3 Abs. 1 Nr. 7 EGBGB mit § 551 BGB in der bis zum ${OLD_LEASE_UNTIL} geltenden Fassung; die Fälligkeit lässt sich vertraglich anders vereinbaren.`

// Rückwärts nur beim Altvertrag: ein ruhiger Satz ohne Titel. Bei Mietverhältnissen nach § 556b kein Satz, die
// Dezembermiete war im Dezember fällig und bleibt im neuen Jahr.
export function lateDecemberText(report: Pick<TaxReport, 'year' | 'income'>): string | null {
  const c = report.income.received?.turnOfYear.lateDecemberCents ?? 0
  if (c === 0) return null
  return `${fmtEuro(c)} Dezembermiete sind Anfang Januar eingegangen und stehen in diesem Jahr. Nur wenn die Miete laut Vertrag am Monatsende fällig ist, gehören sie ins Jahr ${report.year - 1}.`
}

export function unallocatedText(report: Pick<TaxReport, 'income'>): string | null {
  const c = report.income.received?.unallocatedCents ?? 0
  if (c === 0) return null
  return c > 0 ? `${fmtEuro(c)} sind ohne vereinbarte Miete eingegangen.` : `${fmtEuro(-c)} sind ohne vereinbarte Miete zurückgezahlt worden.`
}

export function possibleDepositText(report: Pick<TaxReport, 'income'>): string {
  return (report.income.received?.possibleDeposits ?? []).map((d) => `Zahlung vom ${fmtDate(d.paidOn)} über ${fmtEuro(d.cents)} (${d.tenantName})`).join('; ')
}

export function formerYearsText(report: Pick<TaxReport, 'year' | 'income'>): string | null {
  const r = report.income.received
  const c = r?.formerYearsCents ?? 0
  if (!r || c === 0) return null
  if (c < 0) return `Zeile 25 ist negativ (${fmtEuro(c)}). Eine Rücklastschrift nimmt eine früher verbuchte Miete zurück; tragen Sie den Betrag mit Minus ein.`
  const line = anlageVLines(report.year)?.income.formerYears
  const extra = [...(line ? [`Zeile ${line.line}`] : []), ...(r.formerYearsAllocationsCents !== 0 ? [`darin ${fmtEuro(r.formerYearsAllocationsCents)} Umlagen`] : [])]
  return `${fmtEuro(c)} Miete für frühere Jahre sind ${report.year} eingegangen${extra.length > 0 ? ` (${extra.join(', ')})` : ''}. Bestimmt der Mieter nichts, tilgt eine Zahlung zuerst offene Beträge früherer Monate (§ 366 Abs. 2 BGB). Hat er einen Monat genannt, tragen Sie ihn im Mietkonto an der Zahlung unter „Für Monat“ ein.`
}

// „Mehr dazu“ unter der Tabelle: nur Begründungen mit Fundstelle (Entwurf, Oberfläche). Die Zeile der Abrechnung nur, wo
// der Vordruck des Jahres gelesen ist.
export function incomeMore(year: number): string[] {
  const settlement = anlageVLines(year)?.income.settlement
  return [
    'Mietfuchs teilt jede Mietzahlung nach der gesetzlichen Tilgungsreihenfolge auf: Bestimmt der Mieter nichts, zuerst auf die offenen Vorauszahlungen, weil sie die geringere Sicherheit bieten, dann auf die Miete, jeweils die ältesten zuerst (§ 366 Abs. 2 BGB; BGH, Urteil vom 21.03.2018, VIII ZR 68/17; VIII ZR 84/17, Rn. 53 und 57).',
    'Einnahmen zählen im Kalenderjahr, in dem sie zugeflossen sind (§ 11 Abs. 1 Satz 1 EStG); eine Miete für ein früheres Jahr steht deshalb bei den Mieten für frühere Jahre.',
    `Zahlt ein Mieter Vorauszahlungen eines schon abgerechneten Zeitraums nach, gehört der Betrag wirtschaftlich zur Abrechnung (${settlement ? `Zeile ${settlement.line}` : 'Nachzahlungen und Erstattungen'}). Mietfuchs führt ihn nach der gesetzlichen Reihenfolge als Umlage bzw. Miete für frühere Jahre; die Summe ändert das nicht. Besprechen Sie größere Beträge mit Ihrem Steuerberater.`,
  ]
}
