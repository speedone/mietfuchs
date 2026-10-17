// Das Steuerjahr einer Kostenposition (#255, PR 1): In welchem Kalenderjahr ist sie für die Anlage V abgeflossen
// (§ 11 Abs. 2 Satz 1 EStG), und mit welchem Betrag? **Für die Rechnung der Steuer** steht das hier: Die
// Steuerübersicht (`taxPartsFor`, `taxReport` in calc.ts), der Hinweis zum Übertrag aus dem Vorrat (`carryShareCents`),
// die Abzüge beim Betriebsstrom (`deductionsOf` in snapshot.ts) und die Belege für die Steuer (`taxArchiveItems` in
// taxReceipts.ts) fragen diese Stelle. Vorher stand dieselbe Regel als `taxYearOf` in calc.ts und noch einmal
// ausgeschrieben in snapshot.ts. Seit PR 2 lesen auch der Wechsel des Abrechnungszeitraums (`effectiveTaxYear`,
// `taxEntry` in db/periodChange.ts) und die Schätzhilfe beim Betriebsstrom (db/operatingPower.ts) das bisherige Jahr
// hier (`storedOutflowYear`).
// **Noch nicht hier, sondern selbst lesen `taxYear ?? Beginn`** die Wege, die beim Schreiben vorbelegen oder klemmen:
// `taxYearIn` in db/heatingPeriodChange.ts und `defaultHeatingPlant` in db/repository.ts. Sie zieht PR 3 von #255
// nach (`taxYearSpan`); bis dahin sagen sie dasselbe, weil die Regel dieselbe ist, aber es ist eine zweite Fassung.
//
// **Die Form ist eine Liste von Anteilen** `{ year, cents, source }`, weil sie die Naht zu den Abbuchungen aus dem
// Kontoauszug ist (#292): Eine Zahlung in zwei Raten über den Jahreswechsel ergäbe zwei Anteile. Bis dahin gibt es
// genau einen Anteil über den ganzen Betrag, und zwar nach dieser Rangfolge (Entscheidung R-1 zu #255):
//   0. ein Abzug beim Betriebsstrom (`operatingPower: 'deduction'`) nimmt das Jahr seiner Stromrechnung
//      (`operatingPowerGeneralId`, Quelle `bill`; #267, Plan E5),
//   1. das angegebene Jahr der Zahlung (`taxYear`, Quelle `stated`),
//   2. sonst das Kalenderjahr, in dem der Zeitraum der Position beginnt (Quelle `period`). Bei einer Heizposition
//      unter eigener Heizperiode ist das deren Zeitraum, nicht der Abrechnungszeitraum, in dem sie steht.
// Ein Zeitraum ohne Angabe liegt in einem Kalenderjahr; repository.ts (`requireTaxYear`) sichert das zu.
//
// **Der Abzug (#267)** ist keine Zahlung, sondern ein Ausschnitt der bezahlten Stromrechnung; er wird nicht bezahlt
// und fließt deshalb mit ihr ab. Stand er in einem anderen Jahr als sie, blieb dort ein privater Rest, obwohl in dem
// Jahr nichts bezahlt wurde: Sein privater Teil geht nach dem Schlüssel der Stromrechnung, der des Ausgleichs beim
// Betriebsstrom (#268) nach dem Heizanteil. Das Jahr wird **abgeleitet und nicht gespeichert**: repository.ts leert
// `taxYear` am Abzug beim Speichern, und ein Wert aus der Zeit davor wird hier nicht gelesen. Die Rechnung steht immer
// im selben Zeitraum wie ihr Abzug (`guardDeductionSource` und `settleOperatingPowerLinks` in db/repository.ts), und
// `items` sind die Positionen, unter denen sie zu suchen ist. Fehlt sie dort, was die Datenbank ausschließt (CHECK
// `cost_items_operating_power_source_complete`, `guardDeductionSource`), gilt für den Abzug der Beginn seines Zeitraums,
// und ein gespeichertes Jahr am Abzug wird auch dann nicht gelesen (Durchsicht von PR 2, K1). Die Heizposition „steckt auch in der Stromrechnung“ (`included`) behält ihr Jahr:
// Sie und ihr Beitrag zum Ausgleich heben sich im selben Jahr auf, im Betrag wie im privaten Teil.
//
// Ein Zahlungsdatum gibt es hier noch nicht (kommt mit PR 3 von #255 vor dem angegebenen Jahr), und kein Anteil
// entsteht aus einer Abbuchung, solange #292 nicht entschieden hat, wie verknüpfte Abbuchungen zählen (R-1).
import type { BillingPeriod, CostItem, PeriodKey } from '../../shared/types.ts'
import { startYearOf } from '../../shared/period.ts'

export type OutflowSource = 'stated' | 'period' | 'bill'
export type OutflowShare = { year: number; cents: number; source: OutflowSource }

type OutflowItem = Pick<CostItem, 'taxYear' | 'amountCents'> & Partial<Pick<CostItem, 'id' | 'operatingPower' | 'operatingPowerGeneralId'>>

// `period`: der Zeitraum, in dem die Position steht (bei einer Heizposition unter eigener Heizperiode deren
// Heizperiode). Gelesen wird nur sein Beginn. `items`: die Positionen desselben Zeitraums, unter denen die Stromrechnung
// eines Abzugs steht; für jede andere Position ohne Bedeutung.
export function outflowShares(item: OutflowItem, period: Pick<BillingPeriod, 'from'>, items: readonly OutflowItem[] = []): OutflowShare[] {
  if (item.operatingPower === 'deduction' && item.operatingPowerGeneralId !== undefined) {
    const bill = items.find((c) => c.id === item.operatingPowerGeneralId && c.operatingPower !== 'deduction')
    if (bill !== undefined) {
      const shares = outflowShares(bill, period)
      const only = shares[0]
      // Mehrere Anteile der Rechnung (#292) teilten den Abzug anteilig; bis dahin gibt es genau einen.
      if (shares.length !== 1 || only === undefined) {
        throw new Error(`Die Stromrechnung ${bill.id ?? ''} des Abzugs ${item.id ?? ''} ist in mehreren Jahren abgeflossen; das rechnet die Steuerübersicht noch nicht.`)
      }
      return [{ year: only.year, cents: item.amountCents, source: 'bill' }]
    }
  }
  if (item.operatingPower === 'deduction') return [{ year: Number(period.from.slice(0, 4)), cents: item.amountCents, source: 'period' }]
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
export function paidWhollyIn(item: OutflowItem & Pick<CostItem, 'id'>, period: Pick<BillingPeriod, 'from'>, year: number, items: readonly OutflowItem[] = []): boolean {
  const shares = outflowShares(item, period, items)
  const inYear = shares.filter((s) => s.year === year).reduce((a, s) => a + s.cents, 0)
  const touches = shares.some((s) => s.year === year)
  if (touches && inYear !== item.amountCents) {
    throw new Error(`Die Position ${item.id} ist im Jahr ${year} nur mit einem Teilbetrag abgeflossen; das rechnet die Steuerübersicht noch nicht.`)
  }
  return touches
}

// Das eine Steuerjahr einer Position, wo eine Angabe genau ein Jahr verlangt (die Auskunft je Abzug beim Betriebsstrom,
// `OperatingPowerDeduction.taxYear`). Dieselbe Bedingung wie `paidWhollyIn`.
export function soleOutflowYear(item: OutflowItem & Pick<CostItem, 'id'>, period: Pick<BillingPeriod, 'from'>, items: readonly OutflowItem[] = []): number {
  const shares = outflowShares(item, period, items)
  const first = shares[0]
  if (shares.length !== 1 || first === undefined) {
    throw new Error(`Die Position ${item.id} ist in mehreren Jahren abgeflossen; hier ist genau ein Jahr verlangt.`)
  }
  return first.year
}

// Dasselbe für eine gespeicherte Position, deren Zeitraum nur als Schlüssel vorliegt (die Schreibwege in db/): Das Jahr
// des Beginns steht im Schlüssel, auch bei einer Heizperiode.
export function storedOutflowYear(item: OutflowItem & Pick<CostItem, 'id'> & { period: PeriodKey }, items: readonly (OutflowItem & { period: PeriodKey })[] = []): number {
  return soleOutflowYear(item, { from: `${startYearOf(item.period)}-01-01` }, items.filter((c) => c.period === item.period))
}
