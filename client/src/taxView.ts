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

import type { PropertyKind, TaxExpenseItem, TaxReport } from './types'

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
export const TAX_HINTS = [
  'sollIsNotTaxBasis', 'paymentsMissing', 'turnOfYear', 'inclusiveLine24', 'inclusiveLine24Mixed', 'flatRateLine20',
  'reserveContribution', 'reserveSuspected', 'etwHousingMoney',
  'mixedUseSplit', 'mixedUseKeyNotArea', 'mixedUseAreaMissing', 'mixedUseDirectOutside', 'mixedUseChangedInYear',
  'mixedUseClosedChanged', 'mixedUseLabor35a', 'mixedUseNotCalculated', 'mixedUseExcludedArea', 'mixedUseClosedItemsChanged',
] as const

export type TaxHint = (typeof TAX_HINTS)[number]

// Was sie bedeuten:
//
//   `sollIsNotTaxBasis`  Es ist das Soll angesetzt, und das ist keine steuerliche Grundlage.
//
//   `paymentsMissing`    Auf Ist-Basis, und für mindestens ein Mietverhältnis mit Soll ist im
//                        Jahr **überhaupt keine** Zahlung erfasst. Die angesetzte Einnahme ist
//                        dann zu niedrig, und das sieht man ihr nicht an.
//
//                        **Ein Hinweis für beide Stärken des Falls, und das ist eine
//                        Korrektur.** Vorher gab es zwei, und der für „gar nichts erfasst“
//                        behauptete dazu „Deshalb stehen hier 0 €“. Das stimmt seit der
//                        Umstellung nicht mehr: Eine Zahlung, die zu keiner Zeile des Jahres
//                        gehört, zählt in `paidCents`, aber zu keinem Mietverhältnis der Liste.
//                        Gemessen stand der Satz neben angesetzten Einnahmen von 800 €, und
//                        zwar auch im Ausdruck. Wie viele Mietverhältnisse betroffen sind, sagt
//                        die Seite aus den beiden Zahlen; das ist dieselbe Auskunft ohne die
//                        falsche Ursache.
//
//   `turnOfYear`         Der Vorbehalt zur Zehn-Tage-Regel, der nur auf der Ist-Grundlage etwas
//                        bedeutet.
//
//   `inclusiveLine24`    Alle Mietverhältnisse sind kalt und warm inklusiv (#96): Zeile 24 der
//                        Anlage V („Nebenkosten nicht gesondert vereinbart“). Auf beiden Grundlagen.
//
//   `inclusiveLine24Mixed` Nur ein Teil ist inklusiv, oder nur kalt oder nur warm: Zeile 24 fragt
//                        für das ganze Objekt, und die Antwort ist dann nicht eindeutig.
//
//   `flatRateLine20`     Es gibt eine Betriebskostenpauschale (#96). Nach dem Wortlaut gehört sie
//                        zu den Umlagen in Zeile 20; ausdrücklich sagt das die Anleitung nicht.
//
//   `reserveContribution` Es ist eine Zuführung zur Erhaltungsrücklage erfasst (#143). Sie steht
//                        nicht in den Werbungskosten, sondern daneben: abziehbar erst, wenn und
//                        soweit die Gemeinschaft sie verausgabt (BFH, Urteil vom 14.01.2025,
//                        IX R 19/24). Auf beiden Grundlagen, denn sie betrifft die Ausgaben.
//
//   `reserveSuspected`   Eine Position „Nicht umlagefähig“ heißt nach Rücklage (#143). Sie steht
//                        weiter in den Werbungskosten; der Hinweis rät zur eigenen Kostenart.
//                        Hier und nicht unter den Hinweisen der Abrechnung: Dort wirkt die
//                        Kostenart nicht, beide sind nicht umlagefähig.
//
//   `etwHousingMoney`    Das Objekt ist eine Eigentumswohnung (#143). Abgeflossen sind die
//                        Hausgeld-Vorschüsse des Jahres und eine Nachzahlung aus dem Vorjahr, nicht
//                        die Beträge der Hausgeldabrechnung (§ 11 Abs. 2 Satz 1 EStG). Rechnen
//                        lässt sich das erst mit erfassten Hausgeldzahlungen (#96).
//
// Teilweise Eigennutzung (#163), alle nur, wenn es eine selbstgenutzte Wohnung gibt:
//
//   `mixedUseSplit`      Wie aufgeteilt wurde: direkt oder verhältnismäßig, die Zeilen 11 und 12,
//                        und dass der Ausdruck als gesonderte Aufstellung taugt.
//   `mixedUseKeyNotArea` Mindestens eine umlagefähige Position verteilt die Abrechnung nach
//                        Personen, Einheiten oder vereinbarten Anteilen, und nach Fläche käme ein
//                        anderer privater Teil heraus. Ob das Finanzamt den Schlüssel als Maßstab
//                        anerkennt, ist nicht belegt; der Hinweis beziffert den Unterschied.
//   `mixedUseAreaMissing` Eine Position ließ sich mangels Fläche nicht aufteilen.
//   `mixedUseDirectOutside` Eine Position ist einer Einheit außerhalb der Abrechnungseinheit
//                        zugeordnet; Mietfuchs zählt sie als abziehbar, kann sie aber nicht einordnen.
//   `mixedUseChangedInYear` Eine selbstgenutzte Einheit hatte im Jahr ein Mietverhältnis.
//   `mixedUseClosedChanged` Die abgeschlossene Abrechnung sagt beim Eigenanteil etwas anderes als
//                        die heutige Rechnung; es gilt der eingefrorene Stand.
//   `mixedUseLabor35a`   Eine Position mit §35a-Lohnanteil hat einen privaten Teil.
//   `mixedUseExcludedArea` Es gibt Einheiten außerhalb der Abrechnungseinheit; umlagefähige
//                        Positionen sind deshalb nach der Fläche des ganzen Gebäudes aufgeteilt, und
//                        der Hinweis beziffert den Abstand zum Eigenanteil der Abrechnung.
//   `mixedUseClosedItemsChanged` Positionen nach dem Abschluss erfasst oder im Betrag geändert;
//                        sie sind heute gerechnet und nicht aus dem eingefrorenen Stand.
//   `mixedUseNotCalculated` Was Mietfuchs nicht rechnet: AfA, Schuldzinsen, § 82b EStDV,
//                        verbilligte Vermietung.

export function taxHints(report: TaxReport, basis: Basis, propertyKind?: PropertyKind): TaxHint[] {
  const hints: TaxHint[] = []
  if (report.reserveContributionCents !== 0) hints.push('reserveContribution')
  if (report.reserveSuspects.length > 0) hints.push('reserveSuspected')
  if (propertyKind === 'etw') hints.push('etwHousingMoney')
  const { tenancies, inclusive, partlyInclusive, flatRate } = report.costModels
  if (tenancies > 0 && inclusive === tenancies) hints.push('inclusiveLine24')
  else if (inclusive > 0 || partlyInclusive > 0) hints.push('inclusiveLine24Mixed')
  if (flatRate > 0) hints.push('flatRateLine20')
  if (report.selfOccupiedExists) {
    const items = report.expenses.items
    hints.push('mixedUseSplit')
    if (keyNotAreaDifference(report).count > 0) hints.push('mixedUseKeyNotArea')
    if (items.some((x) => x.allocation === 'unsplittable')) hints.push('mixedUseAreaMissing')
    if (items.some((x) => x.allocation === 'direct-outside')) hints.push('mixedUseDirectOutside')
    if (report.selfUseChangedInYear) hints.push('mixedUseChangedInYear')
    if (report.closedSelfUseDiffers) hints.push('mixedUseClosedChanged')
    if (report.closedItemsChanged > 0) hints.push('mixedUseClosedItemsChanged')
    if (excludedAreaDifference(report).count > 0) hints.push('mixedUseExcludedArea')
    if (items.some((x) => x.labor35aCents > 0 && x.privateCents !== 0)) hints.push('mixedUseLabor35a')
    hints.push('mixedUseNotCalculated')
  }
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

// ---------- Teilweise Eigennutzung (#163) ----------

// Die Spalten privat und abziehbar zeigt die Seite nur, wenn es etwas Privates geben kann. Ohne
// selbstgenutzte Wohnung wären sie eine Spalte voller Nullen und eine Spalte, die den Betrag
// wiederholt; eine Unterscheidung, die es nicht gibt, ist schlechter als keine (wie #68).
export function showsSplit(report: TaxReport): boolean {
  return report.selfOccupiedExists || report.expenses.privateCents !== 0
}

// Positionen, deren privater Teil laut Abrechnung von dem nach Fläche abweicht, und um wie viel
// zusammen. Der Betrag ist die Summe der Abstände und nicht ihr Saldo: Zwei Positionen, die sich
// gegenseitig ausgleichen, sind trotzdem zwei Fragen an den Steuerberater.
export function keyNotAreaDifference(report: TaxReport): { count: number; differenceCents: number } {
  const differing = report.expenses.items.filter((x) => x.areaPrivateCents !== null && x.areaPrivateCents !== x.privateCents)
  return {
    count: differing.length,
    differenceCents: differing.reduce((a, x) => a + Math.abs(x.privateCents - (x.areaPrivateCents ?? x.privateCents)), 0),
  }
}

// Positionen, die wegen Einheiten außerhalb der Abrechnungseinheit nach der Gebäudefläche statt
// laut Abrechnung aufgeteilt sind, und der Abstand zusammen (wie oben als Summe der Beträge).
// **Die Richtung steht getrennt daneben** (Durchsicht): Beim Flächenschlüssel ergibt die
// Gebäudefläche weniger privat als die Abrechnung, bei Personen, Einheiten oder vereinbarten
// Anteilen kann es ebenso mehr sein, und ein fest eingebautes „weniger“ wäre dann falsch.
export function excludedAreaDifference(report: TaxReport): { count: number; differenceCents: number; lessPrivateCents: number; morePrivateCents: number } {
  const differing = report.expenses.items.filter((x) => x.settlementPrivateCents !== null && x.settlementPrivateCents !== x.privateCents)
  const delta = (x: TaxExpenseItem): number => x.privateCents - (x.settlementPrivateCents ?? x.privateCents)
  return {
    count: differing.length,
    differenceCents: differing.reduce((a, x) => a + Math.abs(delta(x)), 0),
    lessPrivateCents: differing.reduce((a, x) => a + Math.max(0, -delta(x)), 0),
    morePrivateCents: differing.reduce((a, x) => a + Math.max(0, delta(x)), 0),
  }
}

// Die Zuordnung einer Position in der Sprache des Vordrucks: „direkt“ oder „verhältnismäßig“ mit
// dem abzugsfähigen Anteil in Prozent.
export function allocationLabel(item: TaxExpenseItem): string {
  const pct = item.deductiblePercent !== null ? `, abziehbar ${item.deductiblePercent.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %` : ''
  switch (item.allocation) {
    case 'settlement': return `anteilig${pct} (laut Abrechnung)`
    case 'area': return `anteilig${pct} (nach Fläche)`
    case 'direct-self': return 'direkt, selbstgenutzt'
    case 'direct-rented': return 'direkt, vermietet'
    case 'direct-outside': return 'direkt, außerhalb der Abrechnungseinheit'
    case 'unsplittable': return 'nicht aufteilbar, Fläche fehlt'
  }
}
