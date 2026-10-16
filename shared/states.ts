// Die 16 Länder mit ihren üblichen Kürzeln. Eine eigene Datei, weil das Rechtsregister
// (shared/law/feiertagsgesetze.ts) und die Feiertage (shared/holidays.ts) sie beide brauchen und
// holidays.ts das Register liest.
import type { FederalState } from './types.ts'

export const STATES: readonly { readonly code: FederalState; readonly name: string }[] = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' },
]

export const STATE_CODES: readonly FederalState[] = STATES.map((s) => s.code)

export function isFederalState(v: unknown): v is FederalState {
  return typeof v === 'string' && STATE_CODES.some((c) => c === v)
}

export function stateName(state: FederalState): string {
  return STATES.find((s) => s.code === state)?.name ?? state
}
