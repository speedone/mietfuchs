// Oberflächenseite des Datenmodells: Beschriftungen und Helfer. Die Typen selbst stehen in
// shared/types.ts und werden hier weitergereicht, damit die Importe im Client unverändert
// bleiben (#48).
import type { CostKey, DepositStatus, MeterType, PropertyKind, Unit, UnitUsage } from '../../shared/types.ts'
export type * from '../../shared/types.ts'

// Die Arten eines Objekts (#92), wie sie die Oberfläche nennt.
export const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  mfh: 'Mehrfamilienhaus',
  etw: 'Eigentumswohnung',
  efh: 'Einfamilienhaus',
  sonstiges: 'Sonstiges (z. B. Garagen)',
}

export const UNIT_USAGE_LABELS: Record<UnitUsage, string> = {
  vermietet: 'vermietet — Anteil trägt der Mieter',
  eigen: 'Eigennutzung — Anteil trägt der Vermieter',
  ausgenommen: 'nicht beteiligt — bleibt außen vor',
}

export function usageOf(u: Pick<Unit, 'participates' | 'selfUsed'>): UnitUsage {
  if (u.participates) return 'vermietet'
  return u.selfUsed ? 'eigen' : 'ausgenommen'
}

export const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  offen: 'offen',
  erhalten: 'erhalten',
  teilweise: 'teilweise erhalten',
  'zurückgezahlt': 'zurückgezahlt',
}

export const METER_TYPE_LABELS: Record<MeterType, string> = {
  kaltwasser: 'Kaltwasser',
  strom: 'Strom (Allgemein)',
  waerme: 'Wärme',
  sonstig: 'Sonstiges',
}

// Kostenarten, Zuordnung und Vorbelegung stehen seit der Belegbuchung (#170) in shared/, weil
// der Server dieselbe Antwort braucht. Hier weitergereicht, damit die Importe der Seiten bleiben.
export { CATEGORIES, NOT_ALLOCABLE, defaultKeyFor, isNotAllocable, matchCategory } from '../../shared/categories.ts'

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'nach Wohnfläche',
  persons: 'nach Personenzahl',
  units: 'nach Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'nach Verbrauch (Zähler)',
  custom: 'nach vereinbarten Anteilen (%)',
  external: 'laut Gemeinschaftsabrechnung (Eigentumswohnung)',
  amounts: 'Einzelbeträge je Mieter (z. B. Messdienst)',
}
