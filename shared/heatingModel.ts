// Werden die Heizkosten eines Mietverhältnisses über Vorauszahlungen abgerechnet (#704)? Nur dann gibt es eine
// Heizvorauszahlung: nicht bei Pauschale und Inklusivmiete, und nicht beim Mieter, der selbst heizt (er zahlt seinen
// Brennstoff selbst; was ihm an Wartung bleibt, läuft über die übrige Vorauszahlung). Eine Stelle für den Vorschlag beim
// Aufteilen (server/src/db/separateSettlement.ts), den Hinweis `prepayment.heating-share-missing` (calc.ts) und den Satz
// am Mietverhältnis (Stammdaten.tsx); vorher fragte jede anders. Ohne Angabe gilt `settlement`.
import type { HeatingModel } from './types.ts'

export const settlesHeating = (model: HeatingModel | null | undefined): boolean => model === undefined || model === null || model === 'settlement'
