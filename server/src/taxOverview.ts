// Gesamtsicht über alle Objekte (#96 PR 3, Entwurf docs/superpowers/specs/2026-10-30-steuer-objekt-ruecklage-design.md,
// Teil C). Sie rechnet nichts Neues: je Objekt **ein** Bericht aus `taxReportFor`, derselbe wie auf der Steuerseite des
// Objekts (/api/taxreport), und daraus dieselben Felder (Durchsicht S1, eine Quelle für die maßgebliche Summe):
// Einnahmen = Zeile 32 (`income.received.totalCents`, Zehn-Tage-Regel angewandt) mit den Zeilen aus
// shared/taxIncomeLines.ts, Werbungskosten nach Raten (`expenses.deductibleCents`, § 82b EStDV), Überschuss
// `surplusReceivedCents`. `paidCents` und `surplusPaidCents` (nach Datum) liest sie nicht. Die Rückgriffe der Verteilung auf
// das Jahr des Abflusses rechnet `taxReportFor` selbst mit `received: false` (Durchsicht X10).
//
// `hasRental` (Durchsicht R-C): ein Mietverhältnis im Jahr, ein Zufluss (Zeile 32 oder nach Datum) oder abziehbare
// Werbungskosten; auch bei Leerstand mit Vermietungsabsicht sind Werbungskosten abziehbar. Nur solche Objekte bekommen
// eine laufende Nummer der Anlage V, in der Reihenfolge der Objekte. Ein Objekt ohne steht neutral in der Liste, ohne
// Aussage über die Pflicht zur Anlage V (ob eine Vermietungsabsicht besteht, weiß Mietfuchs nicht).
//
// Scheitert der Bericht eines Objekts (etwa die Meldung aus `paidWhollyIn`), steht die Meldung in seiner Zeile, und es
// zählt weder in die Summe noch in die Nummern; die übrigen Objekte rechnen weiter.
import type { Property, TaxOverview, TaxOverviewRow, TaxOverviewSums, TaxReport } from '../../shared/types.ts'
import { incomeLines, type IncomeLineAmounts } from '../../shared/taxIncomeLines.ts'
import { taxReportFor } from './calc.ts'

const zeroLines = (): IncomeLineAmounts => ({
  homes: 0, inclusive: 0, unallocated: 0, relatives: 0, allocations: 0, flatRate: 0, settlement: 0,
  relativesAllocations: 0, relativesSettlement: 0, formerYears: 0, formerYearsAllocations: 0, totalCents: 0,
})

const zeroSums = (): TaxOverviewSums => ({
  incomeCents: 0, incomeLines: zeroLines(), sollCents: 0, expensesTotalCents: 0, privateCents: 0, gratuitousCents: 0,
  deferredCents: 0, deductibleCents: 0, reserveContributionCents: 0, surplusCents: 0, surplusSollCents: 0,
})

function sumsOf(report: TaxReport): TaxOverviewSums {
  const received = report.income.received
  const lines = incomeLines(report)
  // Die Route rechnet immer mit `received`; ohne wäre die Zeile 32 nicht bekannt, und eine Summe nach Datum wäre eine
  // andere Zahl als auf der Seite.
  if (received === undefined || lines === null || report.surplusReceivedCents === undefined) {
    throw new Error('Die Steuerübersicht dieses Objekts ist ohne die Einnahmen nach Zeilen gerechnet.')
  }
  return {
    incomeCents: received.totalCents,
    incomeLines: lines,
    sollCents: report.income.sollCents,
    expensesTotalCents: report.expenses.totalCents,
    privateCents: report.expenses.privateCents,
    gratuitousCents: report.expenses.gratuitousCents ?? 0,
    deferredCents: report.expenses.deferredCents ?? 0,
    deductibleCents: report.expenses.deductibleCents,
    reserveContributionCents: report.reserveContributionCents,
    surplusCents: report.surplusReceivedCents,
    surplusSollCents: report.surplusSollCents,
  }
}

function hasRental(report: TaxReport, sums: TaxOverviewSums): boolean {
  return report.costModels.tenancies > 0 || sums.incomeCents !== 0 || report.income.paidCents !== 0 || sums.deductibleCents !== 0
}

function add(a: TaxOverviewSums, b: TaxOverviewSums): TaxOverviewSums {
  const lines = { ...a.incomeLines }
  for (const k of Object.keys(lines) as (keyof IncomeLineAmounts)[]) lines[k] += b.incomeLines[k]
  return {
    incomeCents: a.incomeCents + b.incomeCents,
    incomeLines: lines,
    sollCents: a.sollCents + b.sollCents,
    expensesTotalCents: a.expensesTotalCents + b.expensesTotalCents,
    privateCents: a.privateCents + b.privateCents,
    gratuitousCents: a.gratuitousCents + b.gratuitousCents,
    deferredCents: a.deferredCents + b.deferredCents,
    deductibleCents: a.deductibleCents + b.deductibleCents,
    reserveContributionCents: a.reserveContributionCents + b.reserveContributionCents,
    surplusCents: a.surplusCents + b.surplusCents,
    surplusSollCents: a.surplusSollCents + b.surplusSollCents,
  }
}

// `properties` in der Reihenfolge der Objekte (`listProperties`). `reportOf` ist die Naht für den Test eines Objekts mit
// Fehler; sonst immer `taxReportFor`.
export function taxOverview(
  source: Parameters<typeof taxReportFor>[0], properties: readonly Pick<Property, 'id' | 'name' | 'kind'>[], year: number,
  reportOf: typeof taxReportFor = taxReportFor,
): TaxOverview {
  let number = 0
  let totals = zeroSums()
  const rows: TaxOverviewRow[] = properties.map((p) => {
    const head = { propertyId: p.id, name: p.name, kind: p.kind }
    let report: TaxReport
    let sums: TaxOverviewSums
    try {
      report = reportOf(source, p.id, year)
      sums = sumsOf(report)
    } catch (err) {
      return { ...head, ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
    const rental = hasRental(report, sums)
    totals = add(totals, sums)
    return { ...head, ok: true as const, hasRental: rental, number: rental ? ++number : null, sums }
  })
  return { year, rows, totals }
}
