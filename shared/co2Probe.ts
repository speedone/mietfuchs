// Die Probe der CO₂-Angaben beim Messdienst (Heizung PR 6, Entwurf 7.3, G-B3, W9). Server
// (Berechnung) und Oberfläche (Probe in der Karte „CO₂-Kosten“) rechnen mit derselben Funktion.
//
// S ist die gedruckte Kostensumme der Nutzer, also sind der Betrag der Positionen und S + L beide
// Kostensummen, ohne Rundung der Nutzerzeilen dazwischen. Spielraum gibt es deshalb nur für die
// Rundung von L (1 ct) und, bei den eingetragenen Einzel- und Eigenbeträgen, für die Rundung der
// Nutzerzeilen: vier je Nutzeinheit, weil Messdienste Grund- und Verbrauchsanteil je Heizung und
// Warmwasser getrennt ausweisen, je höchstens ein halber Cent (NE · 2 ct). Ist S geschätzt („Ich
// finde diese Zeile nicht“, R6), gilt dieser Spielraum auch für den Betrag.
//
// Geprüft werden nur die Messdienstpositionen des Topfs, also die mit Einzelbeträgen; eine
// Gutschrift des Versorgers oder eine Wartung daneben gehört nicht zur Abrechnung des Messdienstes.

export type ProbeItem = { amountCents: number; tenancyAmounts?: Readonly<Record<string, number>> | null; selfAmounts?: Readonly<Record<string, number>> | null }
export type ProbeInput = { deducted: boolean; items: readonly ProbeItem[]; usersTotalCents: number; landlordCents: number; unitsCount: number; approx: boolean }
export type ProbeResult = { ok: boolean; itemsCents: number; expectedCents: number; itemsOk: boolean; enteredCents: number; enteredOk: boolean; toleranceCents: number }

const L_ROUNDING_CENTS = 1
const ROUNDINGS_PER_UNIT = 4
const HALF_CENT = 0.5

// Die Beschriftung der Abzugszeile je Mieter beim reinen Ausweis (Entwurf 7.5); die Berechnung
// schreibt sie, Anleitung und Oberfläche nennen sie.
export const CO2_RELIEF_LABEL = 'CO₂-Kosten: Anteil des Vermieters'

// „Liegt bei“ (#704, `serviceEnclosed`): Nur nach der Antwort „Ja, es gibt eine Abzugszeile“ wählt der Vermieter, ob er
// die Angaben der Abrechnung einträgt (`serviceDeducted`, Mietfuchs prüft und druckt) oder nicht einträgt, weil die
// Heizkostenabrechnung des Messdienstes jeder Abrechnung beiliegt (`serviceEnclosed`: keine Probe, keine Buchung). Bei
// „nur ausgewiesen“ gibt es die Wahl nicht (Durchsicht M1): Dort enthalten die Beträge je Mieter den Anteil des
// Vermieters, und ohne Buchung trügen die Mieter ihn mit. Karte, `co2.sum-check`, Lexikon und Anleitung nennen die
// Beschriftungen wörtlich. Bei einer Eigentumswohnung rechnet die Gemeinschaft ab.
export const CO2_DEDUCTED_LABEL = 'Ja, es gibt eine Abzugszeile'
export const CO2_SHOWN_LABEL = 'Nein, die CO₂-Kosten sind nur ausgewiesen'
export const CO2_ENTER_LABEL = 'Angaben aus der Abrechnung hier eintragen (Mietfuchs prüft und druckt die CO₂-Aufteilung)'
export const CO2_ENCLOSED_LABEL = 'Nicht eintragen: Die Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei'
export const CO2_ENCLOSED_LABEL_HOMEOWNERS = 'Nicht eintragen: Die Einzelabrechnung der Heizkosten Ihrer Wohnung liegt jeder Abrechnung bei'
// Die Voraussetzung von „liegt bei“, wortgleich in Karte und Hinweis `co2.service-enclosed`.
export const enclosedCondition = (homeowners = false): string =>
  `Das setzt voraus, dass ${homeowners ? 'die Gemeinschaft' : 'der Messdienst'} den CO₂-Anteil des Vermieters vor der Verteilung abgezogen hat und die Beträge je Mieter ihn nicht enthalten. Weist die Abrechnung den Anteil nur aus, muss Mietfuchs ihn abziehen, sonst tragen die Mieter ihn mit.`
// Der Weg zu „liegt bei“ in einem Satzteil, für die Texte, die dorthin führen.
export const enclosedWay = (homeowners = false): string =>
  `nach „${CO2_DEDUCTED_LABEL}“ die Angabe „${homeowners ? CO2_ENCLOSED_LABEL_HOMEOWNERS : CO2_ENCLOSED_LABEL}“`
// Warum die Probe mit einem Sammelbetrag nicht aufgehen kann, für Karte und Meldung. `names`: die Positionen mit dem
// Haken, schon in Anführungszeichen und verbunden. Bei „nur ausgewiesen“ passt der Sammelbetrag gar nicht: Dann muss
// Mietfuchs den Anteil des Vermieters abziehen, und das geht nur an einer Position ohne Wasser.
export const includesWaterProbeText = (names: string, several: boolean, homeowners = false): string =>
  `${names} ${several ? 'enthalten' : 'enthält'} nach Ihrer Angabe auch Kaltwasser und Abwasser; die Probe vergleicht den Betrag aber mit den Kosten für Heizung und Warmwasser allein und kann so nicht aufgehen. ` +
  `Hat ${homeowners ? 'die Gemeinschaft' : 'der Messdienst'} den CO₂-Anteil des Vermieters vor der Verteilung abgezogen, wählen Sie auf der Seite Heizkosten in der Karte „CO₂-Kosten“ ${enclosedWay(homeowners)}. ` +
  'Weist die Abrechnung den Anteil nur aus, passt der Sammelbetrag nicht: Erfassen Sie dann Heizung und Warmwasser und das Wasser als getrennte Positionen, damit Mietfuchs den Anteil des Vermieters abziehen kann.'
// Der Zusatz zum Steuerrat bei „liegt bei“ (Durchsicht M2), wortgleich in Hinweis, Karte, Lexikon und Anleitung.
export const ENCLOSED_SELF_USED = 'Setzen Sie den CO₂-Anteil des Vermieters als Werbungskosten an, gehört der Teil, der auf Ihre selbst bewohnte Wohnung entfällt, zu deren Eigenbetrag und ist privat.'
// Das Feld der Karte „CO₂-Kosten“ für den Ausstoß; `co2.classification-incomplete` nennt es wörtlich.
export const CO2_EMISSIONS_FIELD = 'CO₂-Ausstoß insgesamt laut Abrechnung (kg)'

const positive = (amounts: Readonly<Record<string, number>> | null | undefined): number =>
  Object.values(amounts ?? {}).reduce((a, c) => a + Math.max(0, c), 0)

export const itemsCentsOf = (items: readonly ProbeItem[]): number => items.reduce((a, c) => a + c.amountCents, 0)
export const enteredCentsOf = (items: readonly ProbeItem[]): number =>
  items.reduce((a, c) => a + positive(c.tenancyAmounts) + positive(c.selfAmounts), 0)

export function serviceProbe(p: ProbeInput): ProbeResult {
  const toleranceCents = p.unitsCount * ROUNDINGS_PER_UNIT * HALF_CENT
  const expectedCents = p.deducted ? p.usersTotalCents + p.landlordCents : p.usersTotalCents
  const itemsCents = itemsCentsOf(p.items)
  const itemsTolerance = (p.deducted ? L_ROUNDING_CENTS : 0) + (p.approx ? toleranceCents : 0)
  const itemsOk = Math.abs(itemsCents - expectedCents) <= itemsTolerance
  const enteredCents = enteredCentsOf(p.items)
  const enteredOk = enteredCents <= p.usersTotalCents + toleranceCents
  return { ok: itemsOk && enteredOk, itemsCents, expectedCents, itemsOk, enteredCents, enteredOk, toleranceCents }
}
