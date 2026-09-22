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
// Die Entscheidungslogik steht hier ohne DOM, damit sie prüfbar bleibt (taxView.test.ts). Das
// gilt für **jede** Entscheidung dieser Seite: Eine Bedingung, die in der Komponente stehen
// bleibt, hat keinen Test, und genau an einer solchen hat die Durchsicht eine Aussage gefunden,
// die nicht stimmte.

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
  // Auf Ist-Basis, und für **kein** Mietverhältnis des Jahres ist eine Zahlung erfasst.
  | 'noPaymentsRecorded'
  // Auf Ist-Basis, und für einen Teil der Mietverhältnisse fehlt jede Zahlung. Der gefährlichere
  // der beiden Fälle: Die Summe ist größer als null, sieht also vollständig aus, und die zu
  // niedrige Einnahme ginge ohne Vorbehalt in die Anlage V.
  | 'paymentsIncomplete'
  // Der Vorbehalt zur Zehn-Tage-Regel, der nur auf der Ist-Grundlage etwas bedeutet.
  | 'turnOfYear'

export function taxHints(report: TaxReport, basis: Basis): TaxHint[] {
  const hints: TaxHint[] = []
  if (basis === 'soll') {
    hints.push('sollIsNotTaxBasis')
    return hints
  }
  // Nur wenn es überhaupt ein Mietverhältnis mit Soll gibt. Ein Jahr ohne ist kein Versäumnis,
  // und eine Ermahnung für etwas, das es nicht gibt, lehrt nur, Hinweise zu übersehen.
  const { tenanciesWithSoll, tenanciesWithoutPayment } = report.income
  if (tenanciesWithSoll > 0 && tenanciesWithoutPayment > 0) {
    hints.push(tenanciesWithoutPayment === tenanciesWithSoll ? 'noPaymentsRecorded' : 'paymentsIncomplete')
  }
  hints.push('turnOfYear')
  return hints
}

// Der Unterschied zwischen dem, was die Abrechnung bei den Vorauszahlungen ansetzt, und dem
// vereinbarten Soll dieser Übersicht.
//
// **Ausgelöst wird er vom Unterschied selbst und nicht von der Jahreskorrektur.** Das war der
// erste Entwurf, und er war an beiden Enden falsch. Es gibt den Unterschied auch ohne Korrektur,
// nämlich wenn ein Mietverhältnis auf einer Wohnung außerhalb der Abrechnungseinheit liegt: Das
// Mietkonto führt es, die Abrechnung nicht. Gemessen lag der Abstand dann bei 1.500 €, wovon nur
// 600 € aus der Korrektur kamen. Und umgekehrt erklärte eine Korrektur, die zufällig dem Soll
// entspricht, einen Unterschied, den es gar nicht gibt.
//
// Deshalb nennt der Text auch keine Ursache mehr, sondern die beiden Eigenschaften der
// Abrechnung, aus denen der Abstand entstehen kann. Welche davon hier wie viel beigetragen hat,
// weiß die Übersicht nicht, und eine Behauptung darüber wäre schlechter als keine.
export type PrepaymentNote = {
  settlementCents: number
  sollCents: number
  // Setzt die Abrechnung eine Jahreskorrektur an? Dann ist das einen eigenen Satz wert, denn es
  // ist die Ursache, die der Vermieter selbst eingetragen hat und wiedererkennt.
  jahreskorrektur: boolean
}

export function prepaymentNote(report: TaxReport): PrepaymentNote | null {
  const { prepaymentSettlementCents, prepaymentSollCents, prepaymentOverridden } = report.income
  if (prepaymentSettlementCents === prepaymentSollCents) return null
  return {
    settlementCents: prepaymentSettlementCents,
    sollCents: prepaymentSollCents,
    jahreskorrektur: prepaymentOverridden,
  }
}

// Die angesetzten Einnahmen und die Einkünfte, je nach Grundlage. Beides steht hier, damit die
// Seite nicht an zwei Stellen dieselbe Fallunterscheidung trifft.
export function incomeCentsFor(report: TaxReport, basis: Basis): number {
  return basis === 'soll' ? report.income.sollCents : report.income.paidCents
}

export function surplusCentsFor(report: TaxReport, basis: Basis): number {
  return basis === 'soll' ? report.surplusSollCents : report.surplusPaidCents
}
