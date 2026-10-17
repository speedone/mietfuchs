// Das Steuerjahr einer Kostenposition (#255, PR 1): In welchem Kalenderjahr ist sie für die Anlage V abgeflossen
// (§ 11 Abs. 2 Satz 1 EStG), und mit welchem Betrag? **Für die Rechnung der Steuer** steht das hier: Die
// Steuerübersicht (`taxPartsFor`, `taxReport` in calc.ts), der Hinweis zum Übertrag aus dem Vorrat (`carryShareCents`),
// die Abzüge beim Betriebsstrom (`deductionsOf` in snapshot.ts) und die Belege für die Steuer (`taxArchiveItems` in
// taxReceipts.ts) fragen diese Stelle. Vorher stand dieselbe Regel als `taxYearOf` in calc.ts und noch einmal
// ausgeschrieben in snapshot.ts.
// **Noch nicht hier, sondern selbst lesen `taxYear ?? Beginn`** die Wege, die beim Schreiben vorbelegen oder klemmen:
// `effectiveTaxYear`/`taxEntry` in db/periodChange.ts, `taxYearIn` in db/heatingPeriodChange.ts, db/operatingPower.ts
// und `defaultHeatingPlant` in db/repository.ts. Sie zieht PR 3 von #255 nach (`taxYearSpan`); bis dahin sagen sie
// dasselbe, weil die Regel dieselbe ist, aber es ist eine zweite Fassung.
//
// **Die Form ist eine Liste von Anteilen** `{ year, cents, source }`, weil sie die Naht zu den Abbuchungen aus dem
// Kontoauszug ist (#292): Eine Zahlung in zwei Raten über den Jahreswechsel ergäbe zwei Anteile. Bis dahin gibt es
// genau einen Anteil über den ganzen Betrag, und zwar nach dieser Rangfolge (Entscheidung R-1 zu #255):
//   1. das angegebene Jahr der Zahlung (`taxYear`, Quelle `stated`),
//   2. sonst das Kalenderjahr, in dem der Zeitraum der Position beginnt (Quelle `period`). Bei einer Heizposition
//      unter eigener Heizperiode ist das deren Zeitraum, nicht der Abrechnungszeitraum, in dem sie steht.
// Ein Zeitraum ohne Angabe liegt in einem Kalenderjahr; repository.ts (`requireTaxYear`) sichert das zu.
//
// Ein Zahlungsdatum gibt es hier noch nicht (kommt mit PR 3 von #255 vor dem angegebenen Jahr), und kein Anteil
// entsteht aus einer Abbuchung, solange #292 nicht entschieden hat, wie verknüpfte Abbuchungen zählen (R-1).
import type { BillingPeriod, CostItem } from '../../shared/types.ts'

export type OutflowSource = 'stated' | 'period'
export type OutflowShare = { year: number; cents: number; source: OutflowSource }

type OutflowItem = Pick<CostItem, 'taxYear' | 'amountCents'>

// `period`: der Zeitraum, in dem die Position steht (bei einer Heizposition unter eigener Heizperiode deren
// Heizperiode). Gelesen wird nur sein Beginn.
export function outflowShares(item: OutflowItem, period: Pick<BillingPeriod, 'from'>): OutflowShare[] {
  // `!= null` und nicht `!== undefined` (Durchsicht K1): Ein `null`, das an einer Grenze durchrutscht, hieße sonst ein
  // Jahr „null“, und die Position fiele still aus jeder Steuerübersicht. Vorher stand hier `taxYear ?? Beginn`.
  if (item.taxYear != null) return [{ year: item.taxYear, cents: item.amountCents, source: 'stated' }]
  return [{ year: Number(period.from.slice(0, 4)), cents: item.amountCents, source: 'period' }]
}

// Gehört die Position in die Steuerübersicht dieses Jahres? **Nur ganz oder gar nicht**: Die Steuerübersicht verteilt
// den privaten Teil aus der Abrechnung über den ganzen Betrag einer Position, und einen Teilbetrag in einem Jahr
// rechnet sie noch nicht. Liefert `outflowShares` eines Tages mehrere Anteile (#292), bricht das hier mit einer
// Meldung ab statt still den ganzen Betrag in jedes Jahr zu stellen, in dem ein Anteil liegt. Wer das ändert, lässt
// `taxReport` und `splitForTax` den Anteil lesen.
export function paidWhollyIn(item: OutflowItem & Pick<CostItem, 'id'>, period: Pick<BillingPeriod, 'from'>, year: number): boolean {
  const shares = outflowShares(item, period)
  const inYear = shares.filter((s) => s.year === year).reduce((a, s) => a + s.cents, 0)
  const touches = shares.some((s) => s.year === year)
  if (touches && inYear !== item.amountCents) {
    throw new Error(`Die Position ${item.id} ist im Jahr ${year} nur mit einem Teilbetrag abgeflossen; das rechnet die Steuerübersicht noch nicht.`)
  }
  return touches
}

// Das eine Steuerjahr einer Position, wo eine Angabe genau ein Jahr verlangt (die Auskunft je Abzug beim Betriebsstrom,
// `OperatingPowerDeduction.taxYear`). Dieselbe Bedingung wie `paidWhollyIn`.
export function soleOutflowYear(item: OutflowItem & Pick<CostItem, 'id'>, period: Pick<BillingPeriod, 'from'>): number {
  const shares = outflowShares(item, period)
  const first = shares[0]
  if (shares.length !== 1 || first === undefined) {
    throw new Error(`Die Position ${item.id} ist in mehreren Jahren abgeflossen; hier ist genau ein Jahr verlangt.`)
  }
  return first.year
}
