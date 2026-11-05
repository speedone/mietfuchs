// Bezugszähler und verteilter Rest (#98): die eine Regel, wann „tragen Sie (wie bisher)“ (`key: 'standard'`) gilt, für
// Formular, Prüfung beim Speichern und Berechnung (Nachprüfung der Abschlussdurchsicht von #98). „Wie bisher“ rechnet wie ohne
// Angabe (#116), und das nimmt den Hauptzähler nur, wenn alle Wohnungen beteiligt sind; mit einem anderen Bezugszähler
// oder eigenen Empfängern gibt es kein „wie bisher“.
import type { MeterRest } from './types.ts'

export const STANDARD_ONLY = '„tragen Sie (wie bisher)“ geht nur, wenn alle Wohnungen an der Position beteiligt sind und der Hauptzähler der Bezugszähler ist. Wählen Sie sonst für den Verbrauch ohne eigenen Zähler einen Schlüssel, etwa „nach Fläche“.'

// `participantUnitIds`: die Teilnehmer der Position, `null` (oder fehlend) heißt alle.
export const standardMisplaced = (rest: MeterRest, participantUnitIds: readonly string[] | null | undefined): boolean =>
  rest.key === 'standard' && (rest.referenceMeterId !== null || rest.behindMeterIds !== null || rest.unitIds !== null || (participantUnitIds ?? null) !== null)
