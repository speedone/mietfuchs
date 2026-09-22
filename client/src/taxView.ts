// Was die Steuerübersicht ansetzt und was sie dazu erklärt (#70).
//
// **Die Grundlage ist das tatsächlich Zugeflossene**, denn nur das ist eine Einnahme. § 11 Abs.
// 1 Satz 1 EStG: Einnahmen sind innerhalb des Kalenderjahres bezogen, in dem sie zugeflossen
// sind. Vom Mieter geleistete Vorauszahlungen zählen im Jahr des Zuflusses, auch wenn sie erst
// später abgerechnet werden; eine Nachzahlung zählt im Jahr des Zahlungseingangs und nicht im
// Abrechnungsjahr, eine ausgezahlte Erstattung mindert die Einnahmen im Auszahlungsjahr. Ein
// vereinbartes, aber nicht gezahltes Soll ist keine Einnahme.
//
// Das Soll bleibt trotzdem umschaltbar. Es ist die Zahl, gegen die man abgleicht, wenn man
// wissen will, ob ein Mieter im Rückstand ist, und Mietfuchs verstellt keine Wege. Es ist nur
// nicht mehr die Vorgabe.
//
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (taxView.test.ts).

import type { TaxReport } from './types'

export type Basis = 'soll' | 'ist'

// **Ist, nicht Soll.** Die bisherige Vorgabe war das Soll, mit einem ehrlichen Grund: Es liefert
// auch ohne erfasste Zahlungen eine Zahl. Genau das ist aber der schlechtere der beiden
// Ausgänge. Ein Ergebnis von 0 € ist sichtbar falsch und führt den Nutzer ins Mietkonto, wo die
// Eingänge hingehören. Eine Soll-Summe sieht stimmig aus, ist aber steuerlich falsch, und
// niemand merkt es, bevor sie in der Anlage V steht.
export const DEFAULT_BASIS: Basis = 'ist'

export type TaxHint =
  // Es ist das Soll angesetzt, und das ist keine steuerliche Grundlage.
  | 'sollIsNotTaxBasis'
  // Auf Ist-Basis, aber für das Jahr ist keine einzige Zahlung erfasst.
  | 'noPaymentsRecorded'
  // Für das Jahr gibt es eine Jahreskorrektur der Vorauszahlungen; die Abrechnung rechnet
  // deshalb mit einer anderen Zahl als das vereinbarte Soll dieser Übersicht.
  | 'prepaymentOverridden'

export function taxHints(report: TaxReport, basis: Basis): TaxHint[] {
  const hints: TaxHint[] = []
  if (basis === 'soll') hints.push('sollIsNotTaxBasis')
  // Nur wenn es überhaupt ein Soll gibt. Ein Jahr ohne Mietverhältnis ist kein Versäumnis, und
  // eine Ermahnung für etwas, das es nicht gibt, lehrt nur, Hinweise zu übersehen.
  if (basis === 'ist' && report.income.paidCents === 0 && report.income.sollCents > 0) {
    hints.push('noPaymentsRecorded')
  }
  // Unabhängig von der Grundlage: Der Unterschied besteht gegenüber der Abrechnung und nicht
  // gegenüber der angesetzten Zahl.
  if (report.income.prepaymentOverridden) hints.push('prepaymentOverridden')
  return hints
}

// Die angesetzten Einnahmen und die Einkünfte, je nach Grundlage. Beides steht hier, damit die
// Seite nicht an zwei Stellen dieselbe Fallunterscheidung trifft.
export function incomeCentsFor(report: TaxReport, basis: Basis): number {
  return basis === 'soll' ? report.income.sollCents : report.income.paidCents
}

export function surplusCentsFor(report: TaxReport, basis: Basis): number {
  return basis === 'soll' ? report.surplusSollCents : report.surplusPaidCents
}
