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

import type { Property, PropertyKind, TaxExpenseItem, TaxMovedOut, TaxOutflow, TaxReport } from './types'
import { andList } from '../../shared/wording.ts'
import { fmtDate, fmtEuro } from './api'
import { anlageVLines } from './anlageV'
import { RESERVE_WITHDRAWAL_CATEGORY } from '../../shared/categories.ts'
import { fileNumberDigits } from './propertyForm'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { estgAcquisitionRelated, yearsWord } from '../../shared/law/estg.ts'

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
  'reserveContribution', 'reserveSuspected', 'etwHousingMoney', 'maintenanceLines', 'reserveWithdrawalSuspected', 'specialLevy',
  'acquisitionRelated',
  'mixedUseSplit', 'mixedUseKeyNotArea', 'mixedUseAreaMissing', 'mixedUseDirectOutside', 'mixedUseChangedInYear',
  'mixedUseClosedChanged', 'mixedUseLabor35a', 'mixedUseNotCalculated', 'mixedUseExcludedArea', 'mixedUseClosedItemsChanged',
  'mixedUseAssignedUnits', 'usageChangedInYear',
  'operatingPowerBalance', 'operatingPowerAmbiguous', 'unmarkedPowerCredits',
  'movedIn', 'movedOut', 'unstated',
] as const

export type TaxHint = (typeof TAX_HINTS)[number]

// Was sie bedeuten:
//
//   `sollIsNotTaxBasis`  Es ist das Soll angesetzt, und das ist keine steuerliche Grundlage.
//
//   `paymentsMissing`    Auf Ist-Basis, und für mindestens ein Mietverhältnis mit Soll ist im
//                        Jahr **überhaupt keine** Mietzahlung erfasst (eine Nachzahlung aus der
//                        Abrechnung zählt dafür nicht, #280). Die angesetzte Einnahme ist
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
//                        Seit #96 mit dem Satz zur Entnahme (`ETW_WITHDRAWAL_TEXT`).
//
// Entnahme aus der Erhaltungsrücklage (#96 PR 1, Entwurf A4), alle nur Auskunft:
//
//   `maintenanceLines`   Es gibt Positionen der Gruppe „Erhaltungsaufwand“. Die Seite nennt die Zeilen 55/56 aus
//                        `anlageVLines`, für verteilte Positionen (#262) die Zeilen 57 bis 72, für Jahre ohne
//                        gelesenen Vordruck keine Nummer (`maintenanceLineText`).
//   `reserveWithdrawalSuspected` Eine Position „Nicht umlagefähig“ sieht nach einer Entnahme aus; die Seite rät zur
//                        Kostenart „Entnahme Erhaltungsrücklage“. Die Beträge bleiben, nur die Zeile der Anlage V hängt
//                        daran. Mit Zahlungsdatum ein Satz zum Jahr (`withdrawalSuspectDated`).
//   `specialLevy`        Eine Sonderumlage mit dem Datum der eigenen Zahlung oder als Zuführung erfasst: Die eigene
//                        Zahlung zählt nicht, erst die Ausgabe durch die Gemeinschaft. Mietfuchs stellt nichts um.
//   `acquisitionRelated` (#96 PR 2, A4.4, Durchsicht X6: der eine Hinweis für #96 und #262) Das Steuerjahr berührt die
//                        drei Jahre nach dem Eigentumsübergang oder das Kalenderjahr danach (ersatzweise großzügig ab dem
//                        Kaufvertrag, siehe `acquisitionRelated`), und es gibt abziehbaren
//                        Erhaltungsaufwand oder Instandhaltung: Die Grenze nach § 6 Abs. 1 Nr. 1a EStG gilt, und
//                        Mietfuchs kennt die Anschaffungskosten nicht (`acquisitionRelated`). Ohne Datum kein Hinweis,
//                        bis #262 PR 3 den Beginn einer Verteilung ergänzt.
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
//   `usageChangedInYear` Die Nutzung einer Einheit wechselt im Jahr (#259); was nach Fläche geteilt
//                        wird, gilt noch nach der Nutzung am Jahresende.
//   `mixedUseClosedChanged` Die abgeschlossene Abrechnung sagt beim Eigenanteil etwas anderes als
//                        die heutige Rechnung; es gilt der eingefrorene Stand.
//   `mixedUseLabor35a`   Eine Position mit §35a-Lohnanteil hat einen privaten Teil.
//   `mixedUseExcludedArea` Es gibt Einheiten außerhalb der Abrechnungseinheit; umlagefähige
//                        Positionen sind deshalb nach der Fläche des ganzen Gebäudes aufgeteilt, und
//                        der Hinweis beziffert den Abstand zum Eigenanteil der Abrechnung.
//   `mixedUseClosedItemsChanged` Positionen nach dem Abschluss erfasst oder im Betrag geändert;
//                        sie sind heute gerechnet und nicht aus dem eingefrorenen Stand.
//   `mixedUseAssignedUnits` Eine Position „Nicht umlagefähig“ ist bestimmten Einheiten zugeordnet
//                        („Betrifft (für die Steuer)“). Die Seite nennt Position, Einheit und
//                        Wirkung. Grund (Integrationsdurchsicht vor 0.10): Bis 0.8.0 speicherte das
//                        Formular auch bei dieser Kostenart den Umlageschlüssel, oft „direkt“ mit
//                        einer Wohnung, und seit #163 gilt genau das als Zuordnung. Ein Datenschritt
//                        räumt es bewusst nicht ab, denn eine bewusste Zuordnung ist am Datensatz
//                        nicht von einer stehengebliebenen zu unterscheiden; der Hinweis legt sie
//                        offen. Ohne selbstgenutzte Einheit wirkt die Zuordnung nicht.
//   `mixedUseNotCalculated` Was Mietfuchs nicht rechnet: AfA, Schuldzinsen, § 82b EStDV; bei
//                        verbilligter Vermietung (#257) nur deren Kürzung, die der erfassten Kosten schon.
//   `operatingPowerBalance` Abzüge beim Allgemeinstrom und Heizpositionen, die auch in der
//                        Stromrechnung stecken, gleichen sich im Jahr nicht aus (#268); die Übersicht
//                        rechnet die Zeile „Betriebsstrom der Heizung“ hinzu oder ab und sagt warum.
//   `operatingPowerAmbiguous` Ein Abzug ohne Verweis zählt als dem Messdienst gemeldet, obwohl im
//                        Zeitraum auch eine Anlage ohne Messdienst heizt (R-6 zu #268).
//   `unmarkedPowerCredits` Negativer Allgemeinstrom ohne Kennzeichnung neben einer zentralen Anlage
//                        ohne Messdienst (#268): ein Abzug aus der Zeit vor der Kennzeichnung?
//
// Zwischen den Jahren verschoben (#255, PR 4), auf beiden Grundlagen, denn es betrifft die Ausgaben:
//
//   `movedIn`            Positionen aus einer Abrechnung, deren Zeitraum dieses Jahr nicht berührt, die
//                        aber in diesem Jahr abgeflossen sind (§ 11 Abs. 2 Satz 1 EStG). Die Seite nennt
//                        Herkunft und Grund (Zahlungsdatum, angegebenes Jahr, Stromrechnung).
//   `movedOut`           Umgekehrt Positionen der Abrechnung dieses Jahres, die in einem anderen Jahr
//                        stehen. Nur Auskunft, sie zählen hier nicht.
//   `unstated`           Positionen ohne Angabe, wann sie bezahlt wurden; sie stehen im Jahr ihrer
//                        Abrechnung. Ruhig, kein Fehler: Meist stimmt das, und es behauptet keine Ursache.

export function taxHints(report: TaxReport, basis: Basis, propertyKind?: PropertyKind, acquisition?: AcquisitionDates | null): TaxHint[] {
  const hints: TaxHint[] = []
  if (report.reserveContributionCents !== 0) hints.push('reserveContribution')
  if (report.reserveSuspects.length > 0) hints.push('reserveSuspected')
  if ((report.operatingPowerBalanceCents ?? 0) !== 0) hints.push('operatingPowerBalance')
  if ((report.operatingPowerAmbiguous ?? []).length > 0) hints.push('operatingPowerAmbiguous')
  if ((report.unmarkedPowerCredits ?? []).length > 0) hints.push('unmarkedPowerCredits')
  if (propertyKind === 'etw') hints.push('etwHousingMoney')
  if (report.expenses.groups.some((g) => g.group === MAINTENANCE_GROUP) || report.expenses.items.some((x) => x.group === MAINTENANCE_GROUP)) hints.push('maintenanceLines')
  if ((report.reserveWithdrawalSuspects ?? []).length > 0) hints.push('reserveWithdrawalSuspected')
  if ((report.specialLevySuspects ?? []).length > 0) hints.push('specialLevy')
  if (acquisitionRelated(report, acquisition ?? null) !== null) hints.push('acquisitionRelated')
  if (movedInLines(report).length > 0) hints.push('movedIn')
  if (report.movedOut.length > 0) hints.push('movedOut')
  if (report.expenses.unstatedCount > 0) hints.push('unstated')
  const { tenancies, inclusive, partlyInclusive, flatRate } = report.costModels
  if (tenancies > 0 && inclusive === tenancies) hints.push('inclusiveLine24')
  else if (inclusive > 0 || partlyInclusive > 0) hints.push('inclusiveLine24Mixed')
  if (flatRate > 0) hints.push('flatRateLine20')
  if ((report.usageChangedUnits ?? []).length > 0) hints.push('usageChangedInYear')
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
    if (assignedUnitItems(report).length > 0) hints.push('mixedUseAssignedUnits')
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
  // Ist die Abrechnung abgeschlossen? Ihr Ansatz ist dann eingefroren, das Soll rechnet heute neu;
  // auch das ist ein Abstand, den die Seite nennt, ohne ihm eine Ursache zuzuschreiben (K3).
  closed: boolean
}

export function prepaymentNote(report: TaxReport): PrepaymentNote | null {
  const { prepaymentSettlementCents, prepaymentSollCents, prepaymentOverridden } = report.income
  // Ohne Zeitraum gleich dem Kalenderjahr gibt es keine Abrechnung zum Vergleich (#208).
  if (prepaymentSettlementCents === null || prepaymentSettlementCents === prepaymentSollCents) return null
  return {
    settlementCents: prepaymentSettlementCents,
    sollCents: prepaymentSollCents,
    jahreskorrektur: prepaymentOverridden,
    closed: report.income.prepaymentSettlementClosed === true,
  }
}

// Aus welchen Abrechnungen die Eigenanteile stammen (#208). Nur bei einem Objekt mit eigenem
// Rhythmus ein Satz; im Kalenderjahr ist es die eine Abrechnung des Jahres, und das sagt die Seite
// schon.
export function settlementSourcesText(report: TaxReport): string | null {
  const labels = report.settlementPeriods.map((p) => p.label)
  if (report.income.prepaymentSettlementCents !== null && labels.length <= 1) return null
  const sources = `Die Eigenanteile stammen aus den Abrechnungen ${andList(labels)}.`
  return report.income.prepaymentSettlementCents === null
    ? `${sources} Weil kein Abrechnungszeitraum dem Kalenderjahr entspricht, steht hier kein Vergleich der Vorauszahlungen mit einer Abrechnung.`
    : sources
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
// Mit einem unentgeltlichen Teil bei verbilligter Vermietung (#257) ebenso: Dann ist nicht alles abziehbar.
export function showsSplit(report: TaxReport): boolean {
  return report.selfOccupiedExists || report.expenses.privateCents !== 0 || !!report.expenses.gratuitousCents
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

// Positionen „Nicht umlagefähig“, die bestimmten Einheiten zugeordnet sind, und was das für die
// Steuer bewirkt: ganz privat, ganz abziehbar, oder nach der Fläche nur dieser Einheiten.
export type AssignedUnitItem = {
  costItemId: string
  description: string
  amountCents: number
  units: string[]
  // `unsplittable`: Für eine betroffene Einheit fehlt die Fläche, die Position steht ungekürzt bei
  // den abziehbaren Werbungskosten (wie `mixedUseAreaMissing`).
  effect: 'private' | 'deductible' | 'area' | 'unsplittable'
}

export function assignedUnitItems(report: TaxReport): AssignedUnitItem[] {
  return report.expenses.items.flatMap((x) => {
    if (x.taxUnits === null) return []
    const effect: AssignedUnitItem['effect'] = x.allocation === 'direct-self' ? 'private'
      : x.allocation === 'direct-rented' || x.allocation === 'direct-outside' ? 'deductible'
        : x.allocation === 'unsplittable' ? 'unsplittable'
          : 'area'
    return [{ costItemId: x.costItemId, description: x.description, amountCents: x.amountCents, units: x.taxUnits.map((u) => u.unitName), effect }]
  })
}

// ---------- Betriebsstrom der Heizung (#268) ----------
//
// Der Text zum Ausgleich beim Betriebsstrom. Fundstellen: Werbungskosten sind die Aufwendungen
// (§ 9 Abs. 1 Satz 1 EStG), abgesetzt im Jahr der Zahlung (§ 11 Abs. 2 Satz 1 EStG); die Stromrechnung ist eine
// Zahlung, ein Abzug und eine Heizposition „steckt auch in der Stromrechnung“ sind Ausschnitte davon. Mit Eigennutzung
// ein Satz zum Maßstab des privaten Teils, denn der ist eine Auslegung (Entscheidung R-4).
// Durchsicht S1: Der Text folgt der Lage (`operatingPowerBalanceKind`). „Selbst getragen“ nur beim Abzug ohne Verweis;
// „prüfen“ nur, wenn Abzug und Betriebsstrom im selben Steuerjahr verschieden hoch sind. Ein Paar über zwei
// Steuerjahre ist richtig erfasst, dort ist nichts zu tun. Fehlt die Lage (ältere Antwort), gilt der neutrale Text.
export function operatingPowerBalanceText(report: TaxReport): string | null {
  const c = report.operatingPowerBalanceCents ?? 0
  if (c === 0) return null
  const own = report.selfOccupiedExists
    ? ' Den privaten Teil teilt Mietfuchs nach Ihrem Eigenanteil an den Heizkosten der Anlage, bei einem Abzug ohne Verweis nach der Wohnfläche des ganzen Gebäudes; beides ist eine Auslegung.'
    : ''
  const line = '„Betriebsstrom der Heizung, Ausgleich“'
  const once = `Bezahlt haben Sie die Stromrechnung einmal; damit sie genau einmal in den Werbungskosten steht (§ 9 Abs. 1 Satz 1 EStG), gleicht Mietfuchs das in der Zeile ${line} aus.`
  switch (report.operatingPowerBalanceKind) {
    case 'kept':
      return `Beim Allgemeinstrom ist Betriebsstrom der Heizung abgezogen, ohne dass er in den Heizkosten steht (${fmtEuro(c)}). Diesen Teil legen Sie nicht um und tragen ihn selbst. ` +
        'Die Abrechnung an die Mieter mindert das, Ihre Werbungskosten nicht: Bezahlt haben Sie die ganze Stromrechnung (§ 9 Abs. 1 Satz 1, § 11 Abs. 2 Satz 1 EStG). ' +
        `Mietfuchs rechnet den Betrag deshalb in der Zeile „Betriebsstrom der Heizung, selbst getragen“ wieder hinzu.${own}`
    case 'otherYear':
      return `Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten stehen in verschiedenen Steuerjahren (Ausgleich in diesem Jahr ${fmtEuro(c)}). ` +
        `Jedes Jahr zählt die in ihm bezahlte Stromrechnung; die Zeile ${line} hebt auf, was zum anderen Jahr gehört. Zu tun ist nichts.${own}`
    case 'mixed':
      return `Ein Teil des Ausgleichs (${fmtEuro(c)}) ist Betriebsstrom, den Sie nicht umlegen und selbst tragen (Abzug ohne Verweis); ein Teil gehört zu Abzug und Betriebsstrom in verschiedenen Steuerjahren. ${once}${own}`
    case 'mismatch': {
      // Nachprüfung N2: Ein Abzug ohne Verweis daneben ist richtig erfasst; „prüfen“ gilt dann dem verknüpften Abzug.
      const kept = report.operatingPowerKeptCents ?? 0
      return `Abzug beim Allgemeinstrom und Betriebsstrom in den Heizkosten sind in diesem Steuerjahr verschieden hoch (Ausgleich ${fmtEuro(c)}). ` +
        (kept !== 0
          ? `Davon tragen Sie ${fmtEuro(kept)} selbst (Abzug ohne Verweis); dieser Teil ist richtig erfasst. ${once} Prüfen Sie in der Abrechnung, ob der verknüpfte Abzug beim Allgemeinstrom zum Betriebsstrom passt.`
          : `${once} Prüfen Sie in der Abrechnung, ob der Abzug beim Allgemeinstrom zum Betriebsstrom passt.`) +
        own
    }
    default:
      // Nachprüfung N1: ohne Lage (ältere Antwort) der neutrale Text.
      return `Beim Betriebsstrom der Heizung gleicht Mietfuchs Abzug beim Allgemeinstrom und Heizkosten aus (Ausgleich ${fmtEuro(c)}). ${once}${own}`
  }
}

// Heizung PR 8 (N8): Die Abrechnung rechnet den Brennstoff nach Verbrauch, die Steuerübersicht nach
// Bezahltem. Beim Eigenanteil liegen beide genau um den Eigenanteil am Übertrag aus dem Vorrat
// auseinander; der Satz erklärt die Richtung.
export function stockCarryNote(report: TaxReport): string | null {
  const c = report.expenses.stockCarrySelfCents ?? 0
  if (c === 0) return null
  const tail = 'Die Abrechnung rechnet nach Verbrauch, die Steuerübersicht nach Bezahltem.'
  return c > 0
    ? `Der Eigenanteil der Abrechnung ist um ${fmtEuro(c)} höher als der private Teil hier: Brennstoff aus dem Vorrat, steuerlich bereits ${report.year - 1} oder früher abgeflossen. ${tail}`
    : `Der Eigenanteil der Abrechnung ist um ${fmtEuro(-c)} niedriger als der private Teil hier: Brennstoff, der im Vorrat bleibt, steuerlich ${report.year} abgeflossen und erst später verbraucht. ${tail}`
}

// ---------- Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung (#280) ----------

// Wo die Anlage V sie abfragt, nur für Jahre, in denen es im amtlichen Vordruck selbst nachgesehen ist: Zeile 21
// (Kennzahl 11) als saldierte Zeile der Nachzahlungen und Erstattungen, Zeile 23 (Kennzahl 12) dasselbe für die an
// Angehörige vermieteten Wohnungen, dazu die Zeilen der laufenden Mieten und Umlagen. **Seit #96 (A5, Durchsicht X5) liest
// diese Funktion aus der einen Tabelle `anlageVLines`** (client/src/anlageV.ts, dort die Fundstellen); Name und Rückgabe
// bleiben, damit nichts umbenannt wird. Für andere Jahre nennt die Seite keine Zeile; eine erfundene wäre schlimmer als
// keine.
export type SettlementLine = {
  line: number
  code: number
  relativesLine: number
  relativesCode: number
  // Wohin der Zufluss ohne Abrechnung gehört: Summen der Mieten und die laufenden Umlagen.
  rentLines: readonly [number, number]
  prepaymentLine: number
  relativesRentLine: number
  relativesPrepaymentLine: number
}

export function settlementLine(year: number): SettlementLine | null {
  const i = anlageVLines(year)?.income
  if (!i?.settlement?.code || !i.relativesSettlement?.code || !i.homes || !i.otherRooms || !i.allocations || !i.relatives || !i.relativesAllocations) return null
  return {
    line: i.settlement.line, code: i.settlement.code, relativesLine: i.relativesSettlement.line, relativesCode: i.relativesSettlement.code,
    rentLines: [i.homes.line, i.otherRooms.line], prepaymentLine: i.allocations.line, relativesRentLine: i.relatives.line,
    relativesPrepaymentLine: i.relativesAllocations.line,
  }
}

// Der Betrag für diese Zeile: Nachzahlungen minus Erstattungen, eine Zahl mit Vorzeichen.
export function settlementBalanceCents(report: Pick<TaxReport, 'income'>): number {
  return report.income.settlementBackPaymentsCents - report.income.settlementRefundsCents
}

// Der Zufluss ohne Nachzahlungen und Guthaben aus der Abrechnung: das, was in die Zeilen der Mieten
// und laufenden Umlagen gehört (Durchsicht zu #328). Zusammen mit dem Saldo ergibt es den Zufluss;
// wer stattdessen den ganzen Zufluss dort einträgt und den Saldo zusätzlich in Zeile 21, zählt ihn doppelt.
export function paidWithoutSettlementCents(report: Pick<TaxReport, 'income'>): number {
  return report.income.paidCents - settlementBalanceCents(report)
}

// ---------- Zwischen den Jahren verschoben (#255, PR 4) ----------
//
// Die Sätze nennen nur, was in den Daten steht: das eingetragene Datum, das angegebene Jahr oder dass ein Abzug beim
// Betriebsstrom mit seiner Stromrechnung abfließt (#267). Eine Ursache für die späte oder frühe Zahlung behaupten sie
// nicht. Welche Position wo steht, entscheidet der Server (`outflowShares`); hier wird es nur in Worte gefasst.
function outflowReason(o: TaxOutflow): string {
  switch (o.source) {
    case 'paid': return o.paidOn !== undefined ? `bezahlt am ${fmtDate(o.paidOn)}` : `bezahlt ${o.year}`
    case 'stated': return `als Jahr der Zahlung ${o.year} angegeben`
    // Ein Abzug wird nicht bezahlt, er ist ein Ausschnitt der Stromrechnung und fließt mit ihr ab (Durchsicht PR 4, K4).
    case 'bill': return `fließt mit seiner Stromrechnung ${o.year} ab`
    case 'period': return `im Jahr der Abrechnung ${o.year}`
  }
}

// Die kurze Angabe an der Zeile der Aufstellung, nur bei einer Position aus einer anderen Abrechnung.
export function movedInText(item: TaxExpenseItem): string | null {
  if (!item.settlementPeriod || !item.outflow) return null
  return `aus Abrechnung ${item.settlementPeriod.label}, ${outflowReason(item.outflow)}`
}

export type ShiftLine = { costItemId: string; text: string; outsideSpan: boolean }
const quoted = (description: string, amountCents: number): string => `„${description || 'ohne Beschreibung'}“ (${fmtEuro(amountCents)})`

export function movedInLines(report: TaxReport): ShiftLine[] {
  return report.expenses.items.flatMap((x) => {
    const text = movedInText(x)
    return text === null ? [] : [{ costItemId: x.costItemId, text: `${quoted(x.description, x.amountCents)}, ${text}`, outsideSpan: x.outsideSpan === true }]
  })
}

export function movedOutLines(report: TaxReport): ShiftLine[] {
  return report.movedOut.map((m: TaxMovedOut) => ({
    costItemId: m.costItemId,
    text: `${quoted(m.description, m.amountCents)}, Abrechnung ${m.settlementPeriod.label}, ${outflowReason(m.outflow)}: steht in der Steuerübersicht ${m.outflow.year}`,
    outsideSpan: m.outsideSpan === true,
  }))
}

// Die Abrechnungen, aus denen die verschobenen Positionen stammen, für die Überschrift.
export function movedOutLabels(report: TaxReport): string[] {
  return [...new Set(report.movedOut.map((m) => m.settlementPeriod.label))]
}

// Ruhig und ohne Ursache: Ohne Angabe gilt das Jahr der Abrechnung, und meist stimmt das.
export function unstatedText(report: TaxReport): string | null {
  const n = report.expenses.unstatedCount
  if (n <= 0) return null
  const head = n === 1
    ? 'Bei einer Position dieses Jahres ist nicht angegeben, wann sie bezahlt wurde; sie steht im Jahr ihrer Abrechnung.'
    : `Bei ${n} Positionen dieses Jahres ist nicht angegeben, wann sie bezahlt wurden; sie stehen im Jahr ihrer Abrechnung.`
  return `${head} Haben Sie eine davon in einem anderen Jahr bezahlt, etwa als Nachzahlung im Folgejahr oder schon im Vorjahr, tragen Sie unter Kosten bei der Position „Bezahlt am (für die Steuer)“ ein.`
}

// ---------- Entnahme aus der Erhaltungsrücklage (#96 PR 1, A4) ----------

// Die Gruppe der Steuerübersicht (`ANLAGE_V_GROUP` in server/src/calc.ts).
export const MAINTENANCE_GROUP = 'Erhaltungsaufwand'

// A4.1: Wohin die Gruppe „Erhaltungsaufwand“ in der Anlage V gehört. **Die Zeilen 55/56 gelten nur für unverteilte
// Positionen** (Durchsicht X7): Eine nach § 82b EStDV verteilte (#262) steht im Block „zu verteilender
// Erhaltungsaufwand“, im ersten Jahr 57 bis 60, in den Folgejahren 61 bis 72. `isSpread` sagt, welche Position verteilt
// ist; bis #262 gibt es keine. Für ein Jahr ohne gelesenen Vordruck (`anlageVLines`) ohne Nummer.
export function maintenanceLineText(report: TaxReport, isSpread: (item: TaxExpenseItem) => boolean = () => false): { unspread: string | null; spread: string | null } {
  const items = report.expenses.items.filter((x) => x.group === MAINTENANCE_GROUP)
  const lines = anlageVLines(report.year)
  const m = lines?.maintenance
  const spreadItems = items.filter(isSpread)
  const hasUnspread = items.length > spreadItems.length || (items.length === 0 && report.expenses.groups.some((g) => g.group === MAINTENANCE_GROUP))
  const notAllocated = lines?.notAllocated
  // Durchsicht K1: Zeile 56 ist der verhältnismäßig aufgeteilte Aufwand; nur nennen, wenn eine unverteilte Position einen
  // abziehbaren Anteil zwischen 0 und 100 % hat.
  const proportional = items.some((x) => !isSpread(x) && x.deductiblePercent !== null && x.deductiblePercent > 0 && x.deductiblePercent < 100)
  const unspread = !hasUnspread ? null
    : m
      ? `Anlage V ${report.year}: Zeile ${m.direct.line}${proportional ? `, für verhältnismäßig aufgeteilten Aufwand Zeile ${m.proportional.line} (Gesamtbetrag und abzugsfähiger Anteil)` : ''}.` +
        (notAllocated ? ` Nicht in die Zeilen ${notAllocated[0]} bis ${notAllocated[1]}, die gelten „ohne Erhaltungsrücklage“.` : '')
      : `Anlage V ${report.year}: bei den Erhaltungsaufwendungen, einschließlich Entnahmen aus der Erhaltungsrücklage; die Zeile sehen Sie bitte im Vordruck für ${report.year} nach.`
  const last = m?.spreadFromPriorYears?.at(-1)?.sum.line
  const spread = spreadItems.length === 0 ? null
    : m?.spread && last !== undefined
      ? `Verteilter Erhaltungsaufwand: siehe Zeilen ${m.spread.total} bis ${last}.`
      : `Verteilter Erhaltungsaufwand: bei den auf bis zu fünf Jahre zu verteilenden Erhaltungsaufwendungen; die Zeilen sehen Sie bitte im Vordruck für ${report.year} nach.`
  return { unspread, spread }
}

// A4.2 (Durchsicht S2): der Satz zur vermuteten Entnahme, mit den Zeilen des Erhaltungsaufwands nur für Jahre, deren
// Vordruck gelesen ist (`anlageVLines`).
export function withdrawalLinesText(year: number): string {
  const m = anlageVLines(year)?.maintenance
  const last = m?.spreadFromPriorYears?.at(-1)?.sum.line ?? m?.spread?.sum.line ?? m?.proportional.line
  return `Entnahmen gehören zu den Erhaltungsaufwendungen${m && last !== undefined ? ` (Zeilen ${m.direct.line} bis ${last})` : ''}, nicht zu den übrigen nicht umgelegten Kosten.`
}

// A4.2: Trägt eine vermutete Entnahme ein Zahlungsdatum? Dann sagt die Seite, dass das Jahr der Ausgabe durch die
// Gemeinschaft zählt, nicht das der eigenen Hausgeldzahlung (R1, R4).
export const withdrawalSuspectDated = (report: TaxReport): boolean => (report.reserveWithdrawalSuspects ?? []).some((x) => x.paidOn !== undefined)

// A4.5: Wechselt die Nutzung im Jahr und ist eine Entnahme betroffen? Streng genommen zählt die Nutzung am Tag der
// Ausgabe durch die Gemeinschaft (R1); ohne dieses Datum teilt Mietfuchs nach Tagen wie bei jeder Position (Auslegung).
export const usageChangeTouchesWithdrawal = (report: TaxReport): boolean =>
  (report.usageChangedUnits ?? []).length > 0 && report.expenses.items.some((x) => x.category === RESERVE_WITHDRAWAL_CATEGORY)

// A4.6: der Satz zur Entnahme im Hinweis `etwHousingMoney` (R1, R4).
export const ETW_WITHDRAWAL_TEXT = 'Entnahmen aus der Erhaltungsrücklage zählen abweichend im Jahr, in dem die Gemeinschaft sie ausgibt, also nach der Hausgeldabrechnung dieses Jahres; die Zuführung, die in den gezahlten Vorschüssen steckt, ziehen Sie ab.'


// ---------- Kopf der Anlage V (#96 PR 2, Entwurf B1, B3) ----------

// Die Angaben am Objekt, die der Kopf liest.
export type TaxHeaderProperty = Pick<Property, 'groundTaxFileNumber' | 'purchaseContractOn' | 'ownershipTransferOn' | 'buildingApplicationOn' | 'completedOn'>

export type HeaderRowKey = 'groundTaxFile' | 'purchaseContract' | 'ownershipTransfer' | 'buildingApplication' | 'completed' | 'relatives'
// Eine Zeile des Kopfs: Zeile des Vordrucks (oder keine, wo er nicht gelesen ist), Kennzahl, Beschriftung und Wert;
// `value: null` heißt „nicht eingetragen“, und die Seite springt dann in die Stammdaten.
export type HeaderRow = { key: HeaderRowKey; line: number | null; code?: number; label: string; value: string | null }

// Ab diesem Jahr fragt der Vordruck in Zeile 7 nach Kauf und Bau (Vordruck 2025AnlV101; die Anleitung 2024 führt in Zeile 7
// die Veräußerung). Für ein späteres Jahr ohne gelesenen Vordruck stehen die Angaben ohne Nummer da.
const ACQUISITION_HEADER_FROM = 2025

export function headerRows(report: Pick<TaxReport, 'costModels'>, property: TaxHeaderProperty | null | undefined, year: number): HeaderRow[] {
  const head = anlageVLines(year)?.header
  const p = property ?? {}
  const day = (v: string | null | undefined): string | null => (v ? fmtDate(v) : null)
  const file = p.groundTaxFileNumber ? fileNumberDigits(p.groundTaxFileNumber) : ''
  const rows: HeaderRow[] = [{ key: 'groundTaxFile', line: head?.groundTaxFile ?? null, label: 'Aktenzeichen laut Grundsteuermessbescheid (ohne Sonderzeichen)', value: file === '' ? null : file }]
  if (year >= ACQUISITION_HEADER_FROM) {
    const line = head?.acquisition ?? null
    rows.push(
      { key: 'purchaseContract', line, label: 'Notar- oder Kaufvertrag vom', value: day(p.purchaseContractOn) },
      { key: 'ownershipTransfer', line, label: 'Eigentumsübergang am', value: day(p.ownershipTransferOn) },
      { key: 'buildingApplication', line, label: 'Bauantrag, Bauanzeige oder Baubeginnsanzeige vom', value: day(p.buildingApplicationOn) },
      { key: 'completed', line, label: 'Fertiggestellt am', value: day(p.completedOn) },
    )
  }
  // Zeile 10, Kennzahl 62 (Vordruck 2025): 1 = Ja, 2 = Nein. Die Kennzahl nur, wo die Zeile gelesen ist.
  const use = head?.use ?? null
  rows.push({
    key: 'relatives', line: use, ...(use !== null ? { code: 62 } : {}),
    label: 'An Angehörige zu Wohnzwecken vermietet', value: (report.costModels.relativeTenancies ?? 0) > 0 ? '1 = Ja' : '2 = Nein',
  })
  return rows
}

// ---------- Anschaffungsnahe Herstellungskosten (#96 PR 2, A4.4; gemeinsam mit #262, Durchsicht X6) ----------

export type AcquisitionDates = Partial<Pick<Property, 'ownershipTransferOn' | 'purchaseContractOn'>>
export type AcquisitionRelated = { from: string; until: string; basis: 'transfer' | 'contract' }

// § 6 Abs. 1 Nr. 1a Satz 1 EStG: Maßnahmen, „die innerhalb von drei Jahren nach der Anschaffung des Gebäudes durchgeführt
// werden“. Der Dreijahreszeitraum läuft taggenau ab dem Übergang von Besitz, Gefahr, Nutzungen und Lasten (BMF-Schreiben
// vom 26.01.2026, IV C 1 - S 2253/00082/001/064, Rn. 62). Gerechnet nach §§ 187 Abs. 1, 188 Abs. 2 BGB (über § 108 AO):
// Der Tag des Übergangs zählt nicht mit, die Frist endet mit dem Tag, der durch seine Zahl dem Übergang entspricht
// (01.07.2023 bis 01.07.2026); fehlt dieser Tag im letzten Monat, mit dessen letztem Tag (§ 188 Abs. 3 BGB, ein 29.02. am
// 28.02.). Wo die Auslegung einen Tag früher enden ließe, nimmt der Hinweis das spätere Ende: Er soll nicht zu früh schweigen.
// Grenze und Zeitraum stehen im Rechtsregister (`estg.acquisition-related`); die Seite nennt sie nur, also zum Rechtsstand.
export const ACQUISITION_LIMITS = valueAt(estgAcquisitionRelated, LAW_AS_OF)
const ACQUISITION_YEARS = ACQUISITION_LIMITS.years
// Die Gruppen der Steuerübersicht mit Erhaltung (`ANLAGE_V_GROUP` in server/src/calc.ts).
const MAINTENANCE_GROUPS: readonly string[] = [MAINTENANCE_GROUP, 'Verwaltung & Instandhaltung']

function sameDayYearsLater(from: string, years: number): string {
  const [y = 0, m = 1, d = 1] = from.split('-').map(Number)
  const day = new Date(Date.UTC(y + years, m - 1, d))
  // Ein 29.02.: Date.UTC rollt auf den 01.03.; dann der letzte Tag des Februars.
  const end = day.getUTCMonth() !== m - 1 ? new Date(Date.UTC(y + years, m, 0)) : day
  return end.toISOString().slice(0, 10)
}

// Der Hinweis gilt, wenn das Steuerjahr die drei Jahre oder das Kalenderjahr danach berührt und es abziehbare Positionen
// der Gruppen „Erhaltungsaufwand“ oder „Verwaltung & Instandhaltung“ gibt. Das Jahr danach, weil Mietfuchs nach Zahlung
// zuordnet und die Maßnahmen zum Fristende weder abgeschlossen noch abgerechnet noch bezahlt sein müssen (BMF-Schreiben
// vom 26.01.2026, Rn. 63): Was bis zum Fristende ausgeführt und erst danach bezahlt wurde, zählt mit.
// Gelesen wird der Eigentumsübergang; maßgeblich ist allein er (Rn. 62). Ist nur der Kaufvertrag eingetragen, liegt der
// Übergang danach, und eine Frist ab dem Kaufvertrag endete zu früh. Dann rechnet der Hinweis großzügig ein Jahr länger
// (vier Jahre ab dem Kaufvertrag) und bittet um den Übergang. Ohne Datum `null`; #262 PR 3 ergänzt den Beginn einer
// Verteilung.
export function acquisitionRelated(report: Pick<TaxReport, 'year' | 'expenses'>, dates: AcquisitionDates | null): AcquisitionRelated | null {
  const transfer = dates?.ownershipTransferOn ?? null
  const contract = dates?.purchaseContractOn ?? null
  const from = transfer ?? contract
  if (from === null) return null
  const until = sameDayYearsLater(from, transfer !== null ? ACQUISITION_YEARS : ACQUISITION_YEARS + 1)
  if (report.year < Number(from.slice(0, 4)) || report.year > Number(until.slice(0, 4)) + 1) return null
  if (!report.expenses.items.some((x) => MAINTENANCE_GROUPS.includes(x.group) && x.deductibleCents !== 0)) return null
  return { from, until, basis: transfer !== null ? 'transfer' : 'contract' }
}

const ACQUISITION_RULE = `sind Instandsetzung und Modernisierung Herstellungskosten, wenn sie ohne Umsatzsteuer zusammen mehr als ${ACQUISITION_LIMITS.percent} % der Anschaffungskosten des Gebäudes ausmachen; dann wirken sie nur über die Abschreibung.`
const ACQUISITION_SPAN = `In den ${yearsWord(ACQUISITION_YEARS)} Jahren nach`
const ACQUISITION_UNKNOWN = 'Mietfuchs kennt die Anschaffungskosten nicht und rechnet die Grenze nicht.'

export function acquisitionRelatedText(info: AcquisitionRelated): string {
  if (info.basis === 'transfer') {
    return `${ACQUISITION_SPAN} dem Eigentumsübergang am ${fmtDate(info.from)} (bis ${fmtDate(info.until)}) ${ACQUISITION_RULE} Arbeiten, die bis ${fmtDate(info.until)} ausgeführt wurden, zählen mit, auch wenn sie später bezahlt sind. ${ACQUISITION_UNKNOWN} Die Frist läuft ab dem Übergang von Besitz, Nutzen und Lasten; prüfen Sie bitte das Datum.`
  }
  return `${ACQUISITION_SPAN} der Anschaffung ${ACQUISITION_RULE} Die Frist läuft ab dem Übergang von Besitz, Nutzen und Lasten; eingetragen ist nur der Kaufvertrag vom ${fmtDate(info.from)}. Mietfuchs rechnet deshalb großzügig bis ${fmtDate(info.until)}, ein Jahr länger als ab dem Kaufvertrag; tragen Sie bitte den Eigentumsübergang ein. Arbeiten, die bis zum Ende der Frist ausgeführt wurden, zählen mit, auch wenn sie später bezahlt sind. ${ACQUISITION_UNKNOWN}`
}

// Der Satz „mehr“ des Hinweises, mit den Fundstellen (K6).
export const ACQUISITION_RELATED_MORE = `${estgAcquisitionRelated.norm}, für Werbungskosten nach § 9 Abs. 5 Satz 2 EStG; BMF-Schreiben vom 26.01.2026, IV C 1 - S 2253/00082/001/064, Rn. 54, 62 und 63. Mit zählen Entnahmen aus der Erhaltungsrücklage (BFH, Urteil vom 14.01.2025, IX R 19/24); nicht mit zählen Erweiterungen und Erhaltungsarbeiten, die jährlich üblicherweise anfallen.`
// Die Überschrift des Hinweises.
export const ACQUISITION_RELATED_TITLE = `die ${ACQUISITION_LIMITS.percent}-%-Grenze prüfen`
