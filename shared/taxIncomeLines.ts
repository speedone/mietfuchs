// Die Beträge der Einnahmenzeilen der Anlage V aus `income.received` (#312 PR 3, Durchsicht S1): **eine Rechnung** für die
// Steuerseite (client/src/taxIncome.ts, mit Beschriftungen und Zeilennummern), `Einnahmen.csv` (server/src/taxReceipts.ts)
// und später die Gesamtsicht (#96 PR 3). Ohne Beschriftungen, ohne Zeilennummern (die stehen je Jahr in
// client/src/anlageV.ts) und ohne eigene Auslegung: Die Zuordnung der Teile zu den Zeilen hat der Server schon getroffen
// (calc.ts, `receivedIncome`); hier wird nur nach Angehörigen getrennt und summiert.
//
// Die Summe ist Zeile 32 und gleich `received.totalCents` (Invariante in invariant-steuer-zufluss.test.ts).
import type { TaxReceived, TaxReceivedTenancy, TaxReport } from './types.ts'

// Je Mietverhältnis (eine Zeile von `Einnahmen.csv`).
export type TenancyIncome = {
  rentCents: number // Miete ohne Umlagen (Zeile 15/18 bzw. 19), samt Inklusivmiete und Zahlungen ohne vereinbarte Miete
  inclusiveRentCents: number // davon Inklusivmiete
  unallocatedCents: number // davon ohne vereinbarte Miete
  allocationsCents: number // Umlagen laufend (Zeile 20 bzw. 22)
  flatRateCents: number // davon Pauschale
  settlementCents: number // Nachzahlung minus Erstattung aus der Abrechnung (Zeile 21 bzw. 23)
  formerYearsCents: number // Mieten für frühere Jahre (Zeile 25)
  totalCents: number // was in diesem Jahr zählt (Beitrag zu Zeile 32)
  fromPreviousCents: number // darin aus dem Vorjahr nach der Zehn-Tage-Regel
  forwardCents: number // nicht darin: zählt nach der Zehn-Tage-Regel im Folgejahr
  paidInYearCents: number // nach Datum im Jahr gezahlt (Kontoauszug) = total − fromPrevious + forward
}

export function tenancyIncome(t: Omit<TaxReceivedTenancy, 'tenancyId' | 'unitId' | 'tenantName' | 'unitName' | 'start' | 'end' | 'relative'>): TenancyIncome {
  const totalCents = t.rentCents + t.allocationsCents + t.settlementCents + t.formerYearsCents
  return {
    rentCents: t.rentCents, inclusiveRentCents: t.inclusiveRentCents, unallocatedCents: t.unallocatedCents,
    allocationsCents: t.allocationsCents, flatRateCents: t.flatRateCents, settlementCents: t.settlementCents, formerYearsCents: t.formerYearsCents,
    totalCents, fromPreviousCents: t.fromPreviousCents, forwardCents: t.forwardCents, paidInYearCents: totalCents - t.fromPreviousCents + t.forwardCents,
  }
}

// Was in keiner Zeile von `byTenancy` steht: Mietzahlungen an ein Mietverhältnis, das der Schnappschuss nicht führt
// (`unassignedCents`), und Zahlungen aus der Abrechnung ohne Mietverhältnis der Liste. Nach `snapshotFor` gibt es beides
// nicht; `null`, wenn nichts übrig ist.
export function unassignedIncome(report: Pick<TaxReport, 'income'>): TenancyIncome | null {
  const r = report.income.received
  if (!r) return null
  const balance = report.income.settlementBackPaymentsCents - report.income.settlementRefundsCents
  const settlementCents = balance - r.byTenancy.reduce((a, t) => a + t.settlementCents, 0)
  if (r.unassignedCents === 0 && settlementCents === 0) return null
  return tenancyIncome({
    rentCents: r.unassignedCents, inclusiveRentCents: 0, unallocatedCents: r.unassignedCents, allocationsCents: 0, flatRateCents: 0,
    settlementCents, formerYearsCents: 0, forwardCents: 0, fromPreviousCents: 0,
  })
}

// Die Zeilen des Vordrucks: ohne Angehörige 15/18, 20, 21, 25; die Angehörigen in 19, 22, 23 (Zeile 25 trennt der
// Vordruck nicht). `null` ohne `received` (Option `received: false`).
export type IncomeLineAmounts = {
  homes: number; inclusive: number; unallocated: number
  relatives: number
  allocations: number; flatRate: number
  settlement: number
  relativesAllocations: number; relativesSettlement: number
  formerYears: number; formerYearsAllocations: number
  totalCents: number
}

export function incomeLines(report: Pick<TaxReport, 'income'>): IncomeLineAmounts | null {
  const r: TaxReceived | undefined = report.income.received
  if (!r) return null
  const out: IncomeLineAmounts = {
    homes: 0, inclusive: 0, unallocated: 0, relatives: 0, allocations: 0, flatRate: 0, settlement: 0,
    relativesAllocations: 0, relativesSettlement: 0, formerYears: 0, formerYearsAllocations: r.formerYearsAllocationsCents, totalCents: 0,
  }
  const rows: { relative: boolean; x: TenancyIncome }[] = r.byTenancy.map((t) => ({ relative: t.relative, x: tenancyIncome(t) }))
  const rest = unassignedIncome(report)
  if (rest) rows.push({ relative: false, x: rest })
  for (const { relative, x } of rows) {
    if (relative) {
      out.relatives += x.rentCents
      out.relativesAllocations += x.allocationsCents
      out.relativesSettlement += x.settlementCents
    } else {
      out.homes += x.rentCents
      out.inclusive += x.inclusiveRentCents
      out.unallocated += x.unallocatedCents
      out.allocations += x.allocationsCents
      out.flatRate += x.flatRateCents
      out.settlement += x.settlementCents
    }
    out.formerYears += x.formerYearsCents
    out.totalCents += x.totalCents
  }
  return out
}
