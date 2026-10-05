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
