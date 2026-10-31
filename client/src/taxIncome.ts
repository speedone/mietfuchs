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
// - Mit Angehörigen zeigen 15/18 und 20 Ist und Soll ohne sie, 19 und 22 ihr Soll (vom Server, `received.relatives`,
//   Durchsicht S4); jede „davon“-Zeile gehört nur zu ihrer Zeile.
import type { TaxReceived, TaxReport } from './types'
import { anlageVLines, type Line } from './anlageV'
import { incomeLines } from '../../shared/taxIncomeLines.ts'
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

export function incomeTable(report: TaxReport): IncomeTable {
  const i = anlageVLines(report.year)?.income
  const inc = report.income
  const r: TaxReceived | undefined = inc.received
  // Die Beträge aus der einen Rechnung (shared/taxIncomeLines.ts, Durchsicht S1); hier kommen nur Beschriftung, Zeile und Soll dazu.
  const L = incomeLines(report)
  const rel = hasRelatives(report)
  const settlement = inc.settlementBackPaymentsCents - inc.settlementRefundsCents
  // Das Soll der Angehörigen vom Server (Durchsicht S4): 15/18 und 20 zeigen das Soll der übrigen.
  const S = r?.relatives ?? { sollRentCents: 0, sollInclusiveRentCents: 0, sollAllocationsCents: 0, sollFlatRateCents: 0 }
  const make = (key: IncomeRowKey, label: string, paidCents: number | null, sollCents: number | null, sub: boolean, ls: (Line | undefined)[] = []): IncomeRow => ({
    key, label, paidCents, sollCents, sub, line: ls.length > 0 ? lineText(...ls) : null, code: ls.length > 0 ? codeText(...ls) : null,
  })
  const rows: IncomeRow[] = [
    make('homes', 'Mieteinnahmen ohne Umlagen', L ? L.homes : null, inc.baseRentSollCents - S.sollRentCents, false, [i?.homes, i?.otherRooms]),
    make('inclusive', 'davon Inklusivmieten (Nebenkosten eingeschlossen)', L ? L.inclusive : null, inc.inclusiveRentSollCents - S.sollInclusiveRentCents, true),
    make('unallocated', 'davon ohne vereinbarte Miete (Überzahlung)', L ? L.unallocated : null, null, true),
  ]
  if (rel) rows.push(make('relatives', 'Mieteinnahmen ohne Umlagen, an Angehörige vermietet', L ? L.relatives : null, S.sollRentCents, false, [i?.relatives]))
  rows.push(
    make('allocations', 'Umlagen: laufende Vorauszahlungen und Pauschalen', L ? L.allocations : null, inc.prepaymentSollCents + inc.flatRateSollCents - S.sollAllocationsCents, false, [i?.allocations]),
    make('flatRate', 'davon Betriebskostenpauschalen', L ? L.flatRate : null, inc.flatRateSollCents - S.sollFlatRateCents, true),
    make('settlement', 'Nachzahlungen minus erstattete Guthaben aus der Abrechnung', L ? L.settlement : settlement, null, false, [i?.settlement]),
  )
  if (rel) {
    rows.push(
      make('relativesAllocations', 'Umlagen, an Angehörige vermietet', L ? L.relativesAllocations : null, S.sollAllocationsCents, false, [i?.relativesAllocations]),
      make('relativesSettlement', 'Nachzahlungen minus Guthaben, an Angehörige vermietet', L ? L.relativesSettlement : null, null, false, [i?.relativesSettlement]),
    )
  }
  rows.push(
    make('formerYears', 'Mieten für frühere Jahre', L ? L.formerYears : null, null, false, [i?.formerYears]),
    make('formerYearsAllocations', 'davon Umlagen', L ? L.formerYearsAllocations : null, null, true),
  )
  // Zeilen mit 0 € (oder ohne Wert) in beiden Spalten entfallen, außer 15/18 und 20; mit Angehörigen bleiben 19 und 22.
  // Zeile 21 steht, sobald es eine Nachzahlung oder Erstattung gibt, auch wenn sie sich zu 0 aufheben (K5).
  const always: IncomeRowKey[] = [
    'homes', 'allocations', ...(rel ? (['relatives', 'relativesAllocations'] as const) : []),
    ...(inc.settlementBackPaymentsCents !== 0 || inc.settlementRefundsCents !== 0 ? (['settlement'] as const) : []),
  ]
  const shown = rows.filter((x) => always.includes(x.key) || (x.paidCents ?? 0) !== 0 || (x.sollCents ?? 0) !== 0)
  return {
    rows: shown,
    paidTotalCents: r ? r.totalCents : inc.paidCents,
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
  return i?.homes && i.otherRooms && i.allocations ? { rent: `den Zeilen ${i.homes.line} und ${i.otherRooms.line}`, allocations: `Zeile ${i.allocations.line}` } : null
}

// `turnOfYear` (E8 nach der Durchsicht von PR 2): nur mit Betrag. Vorwärts ruhig und ohne Vorbehalt, denn Mietfuchs
// wendet die Regel an; aus dem Vorjahr mit Beträgen je Zeile. Nie ein Satz, der eine Verschiebung ins alte Jahr nahelegt.
// Durchsicht M1: Wer das Vorjahr mit Mietfuchs bis 0.13 erklärt hat, hatte die Ende Dezember gezahlte Januarmiete dort; ein
// Satz zeigt dann aufs alte Jahr, ohne etwas zu verschieben (keine Norm, keine Rechnung).
export function turnOfYearLines(report: Pick<TaxReport, 'year' | 'income' | 'costModels'>): string[] {
  const t = report.income.received?.turnOfYear
  if (!t) return []
  const out: string[] = []
  if (t.fromPreviousCents !== 0) {
    const lines = hasRelatives(report) ? null : rentLines(report.year)
    const rent = t.fromPreviousCents - t.fromPreviousAllocationsCents
    const head = `${fmtEuro(t.fromPreviousCents)} im Dezember ${report.year - 1} eingegangene Januarmiete stehen nach § 11 Abs. 1 Satz 2 EStG in diesem Jahr`
    out.push(lines
      ? `${head}: ${t.fromPreviousAllocationsCents !== 0 ? `${fmtEuro(rent)} in ${lines.rent} und ${fmtEuro(t.fromPreviousAllocationsCents)} in ${lines.allocations}` : `in ${lines.rent}`}.`
      : `${head}${t.fromPreviousAllocationsCents !== 0 ? `, davon ${fmtEuro(t.fromPreviousAllocationsCents)} Umlagen` : ''}.`)
    out.push(`Haben Sie diesen Betrag schon in der Erklärung für ${report.year - 1} angegeben (Mietfuchs bis Version 0.13 zählte ihn dort), lassen Sie jene berichtigen.`)
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
  return `${fmtEuro(c)} Dezembermiete sind Anfang Januar eingegangen und stehen in diesem Jahr. Nur wenn die Miete am Monatsende fällig ist (so § 551 BGB a. F., sofern der Vertrag nichts anderes bestimmt), gehören sie ins Jahr ${report.year - 1}.`
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
  const line = anlageVLines(report.year)?.income.formerYears
  // S2: die Nummer nur aus `anlageVLines`.
  if (c < 0) return `${line ? `Zeile ${line.line} ist` : 'Die Mieten für frühere Jahre sind'} negativ (${fmtEuro(c)}). Eine Rücklastschrift nimmt eine früher verbuchte Miete zurück; tragen Sie den Betrag mit Minus ein.`
  const extra = [...(line ? [`Zeile ${line.line}`] : []), ...(r.formerYearsAllocationsCents !== 0 ? [`darin ${fmtEuro(r.formerYearsAllocationsCents)} Umlagen`] : [])]
  return `${fmtEuro(c)} Miete für frühere Jahre sind ${report.year} eingegangen${extra.length > 0 ? ` (${extra.join(', ')})` : ''}. Bestimmt der Mieter nichts, tilgt eine Zahlung zuerst die offenen Vorauszahlungen, dann die Miete, jeweils die ältesten zuerst (§ 366 Abs. 2 BGB); so begleicht sie zuerst Rückstände früherer Monate. Hat er einen Monat genannt, tragen Sie ihn im Mietkonto an der Zahlung unter „Für Monat“ ein.`
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
