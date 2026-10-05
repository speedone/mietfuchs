// Die Spalte „Grund“ beim Vermieteranteil (#142). Die Berechnung liefert je Zeile, woraus der
// Betrag besteht (`landlordParts`); hier steht nur, wie das heißt. Ein Grund allein steht ohne
// Betrag da, denn der steht schon in der Zeile; bei mehreren nennt jeder seinen.

import { fmtEuro } from './api'
import { isNotAllocable, type LandlordReason, type SettlementRow } from './types'

const LABELS: Record<LandlordReason, string> = {
  notAllocable: 'nicht umlagefähig',
  noBasis: 'keine Verteilbasis (siehe Hinweise)',
  selfUse: 'Eigennutzung',
  vacancy: 'Leerstand',
  flatRate: 'Betriebskostenpauschale',
  inclusive: 'Inklusivmiete',
  outsideUnit: 'Wohnung außerhalb der Abrechnungseinheit',
  amountsRest: 'Rest nach Einzelbeträgen',
  customRest: 'nicht vereinbarter Anteil',
  mainMeterRest: 'Rest des Hauptzählers',
  co2Share: 'CO₂-Anteil des Vermieters',
  fuelCarry: 'Brennstoff einer anderen Heizperiode (Abgrenzung)',
  fuelClosedPeriod: 'Brennstoff einer abgeschlossenen Heizperiode',
  fuelEstimateDiff: 'Abweichung von der Schätzung',
  rounding: 'Rundungsrest',
}

export function landlordReasonText(row: SettlementRow): string {
  const parts = row.landlordParts
  // Eine vorher abgeschlossene Abrechnung kennt die Zerlegung nicht; dann bleibt der bisherige Text.
  if (!parts || parts.length === 0) {
    return isNotAllocable(row.category) ? 'nicht umlagefähig' : 'Eigennutzung / Leerstand / Rundung / keine Verteilbasis'
  }
  // Unbekannte Gründe (aus einer späteren Fassung) stehen als Code da, statt die Seite umzuwerfen.
  const label = (reason: LandlordReason) => (Object.hasOwn(LABELS, reason) ? LABELS[reason] : reason)
  const [only] = parts
  if (parts.length === 1 && only) return label(only.reason)
  return parts.map((p) => `${label(p.reason)} ${fmtEuro(p.cents)}`).join(' · ')
}
