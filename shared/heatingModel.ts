// Werden die Heizkosten eines Mietverhältnisses über Vorauszahlungen abgerechnet (#704)? Nur dann gibt es eine
// Heizvorauszahlung: nicht bei Pauschale und Inklusivmiete, und nicht beim Mieter, der selbst heizt (er zahlt seinen
// Brennstoff selbst; was ihm an Wartung bleibt, läuft über die übrige Vorauszahlung). Eine Stelle für den Vorschlag beim
// Aufteilen (server/src/db/separateSettlement.ts), den Hinweis `prepayment.heating-share-missing` (calc.ts) und den Satz
// am Mietverhältnis (Stammdaten.tsx); vorher fragte jede anders. Ohne Angabe gilt `settlement`.
import type { HeatingModel } from './types.ts'

export const settlesHeating = (model: HeatingModel | null | undefined): boolean => model === undefined || model === null || model === 'settlement'

// #712: Wofür die zweite Vorauszahlung (Heizstaffel) gilt. Voreinstellung ist die Kostenart „Heizung und Warmwasser“; an
// der Heizanlage lässt sich wählen, dass sie auch „Wasser/Abwasser“ deckt (`secondPrepaymentCoversWater`), was der
// Messdienst oft mit abrechnet. **Die eine Stelle für die Bezeichnung des zweiten Teils**: gedruckte Abrechnung, Satz
// `{Aufteilung}` im Anschreiben, Fenster „Anschreiben bearbeiten“, Übersicht und „In die Staffel übernehmen“ fragen sie.
// Ohne die Angabe bleibt jeder Wortlaut, wie er vor #712 war.
// - `costs`: die Kosten, denen der Teil gilt („… entfallen 45,00 € auf Heizung und Warmwasser“)
// - `prepayment`: die Vorauszahlung als Ding („davon Heizvorauszahlung“, Staffel der „Heizvorauszahlung“)
// - `short`: die Kurzform in Aufzählungen („davon Heizung 45,00 €“)
export const WATER_CATEGORY = 'Wasser/Abwasser'
export type SecondPrepaymentForm = 'costs' | 'prepayment' | 'short'
const WITH_WATER = 'Heizung, Warmwasser und Wasser/Abwasser'
export function secondPrepaymentLabel(coversWater: boolean | null | undefined, form: SecondPrepaymentForm = 'costs'): string {
  if (coversWater === true) return form === 'prepayment' ? `Vorauszahlung für ${WITH_WATER}` : WITH_WATER
  return form === 'prepayment' ? 'Heizvorauszahlung' : form === 'short' ? 'Heizung' : 'Heizung und Warmwasser'
}
// Die Ablehnung des Servers, wenn die Angabe an einer Anlage mit eigener Heizperiode gesetzt werden soll.
export const SECOND_PREPAYMENT_OWN_PERIOD = 'Die zweite Vorauszahlung kann nur in einer gemeinsamen Abrechnung auch Wasser und Abwasser decken. Diese Heizanlage rechnet in eigenen Heizperioden ab, und die Heizkostenabrechnung rechnet nur Heizung und Warmwasser ab.'
