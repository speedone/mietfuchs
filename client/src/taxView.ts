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
// gilt für jede Entscheidung, an der eine **Aussage** hängt: Eine Bedingung, die in der
// Komponente stehen bleibt, hat keinen Test, und genau an solchen hat die Durchsicht zweimal
// eine Aussage gefunden, die nicht stimmte. Reines Ein- und Ausblenden ohne Behauptung bleibt in
// der Seite, etwa der Kasten zur gemischten Nutzung: Dort entscheidet der Server mit
// `selfOccupiedExists`, die Seite zeigt ihn nur an.

import type { TaxReport } from './types'

export type Basis = 'soll' | 'ist'

// **Ist, nicht Soll.** Die bisherige Vorgabe war das Soll, mit einem ehrlichen Grund: Es liefert
// auch ohne erfasste Zahlungen eine Zahl. Genau das ist aber der schlechtere der beiden
// Ausgänge. Ein Ergebnis von 0 € ist sichtbar falsch und führt den Nutzer ins Mietkonto, wo die
// Eingänge hingehören. Eine Soll-Summe sieht stimmig aus, ist aber steuerlich falsch, und
// niemand merkt es, bevor sie in der Anlage V steht.
export const DEFAULT_BASIS: Basis = 'ist'

// **Die Liste steht als Wert da und der Typ leitet sich daraus ab**, nicht umgekehrt. Ein
// Vereinigungstyp allein verschwindet beim Übersetzen, und dann kann kein Test über alle
// Hinweise laufen. Genau so ist einer von ihnen schon einmal aus der Seite verschwunden, ohne
// dass etwas rot wurde: Die Logik war geprüft, die Darstellung nicht. Der Komponententest in
// pages/Steuer.test.tsx geht diese Liste durch und verlangt für jeden Eintrag eine Lage, in der
// er erscheint; wer hier einen hinzufügt, bekommt dort einen Übersetzungsfehler, solange er ihn
// nicht einträgt.
export const TAX_HINTS = ['sollIsNotTaxBasis', 'paymentsMissing', 'turnOfYear'] as const

export type TaxHint = (typeof TAX_HINTS)[number]

// Was die drei bedeuten:
//
//   `sollIsNotTaxBasis`  Es ist das Soll angesetzt, und das ist keine steuerliche Grundlage.
//
//   `paymentsMissing`    Auf Ist-Basis, und für mindestens ein Mietverhältnis mit Soll ist im
//                        Jahr **überhaupt keine** Zahlung erfasst. Die angesetzte Einnahme ist
//                        dann zu niedrig, und das sieht man ihr nicht an.
//
//                        **Ein Hinweis für beide Stärken des Falls, und das ist eine
//                        Korrektur.** Vorher gab es zwei, und der für „gar nichts erfasst"
//                        behauptete dazu „Deshalb stehen hier 0 €". Das stimmt seit der
//                        Umstellung nicht mehr: Eine Zahlung, die zu keiner Zeile des Jahres
//                        gehört, zählt in `paidCents`, aber zu keinem Mietverhältnis der Liste.
//                        Gemessen stand der Satz neben angesetzten Einnahmen von 800 €, und
//                        zwar auch im Ausdruck. Wie viele Mietverhältnisse betroffen sind, sagt
//                        die Seite aus den beiden Zahlen; das ist dieselbe Auskunft ohne die
//                        falsche Ursache.
//
//   `turnOfYear`         Der Vorbehalt zur Zehn-Tage-Regel, der nur auf der Ist-Grundlage etwas
//                        bedeutet.

export function taxHints(report: TaxReport, basis: Basis): TaxHint[] {
  const hints: TaxHint[] = []
  if (basis === 'soll') {
    hints.push('sollIsNotTaxBasis')
    return hints
  }
  // Nur wenn es überhaupt ein Mietverhältnis mit Soll gibt. Ein Jahr ohne ist kein Versäumnis,
  // und eine Ermahnung für etwas, das es nicht gibt, lehrt nur, Hinweise zu übersehen.
  const { tenanciesWithSoll, tenanciesWithoutPayment } = report.income
  if (tenanciesWithSoll > 0 && tenanciesWithoutPayment > 0) hints.push('paymentsMissing')
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
