// Oberflächenseite des Datenmodells: Beschriftungen und Helfer. Die Typen selbst stehen in
// shared/types.ts und werden hier weitergereicht, damit die Importe im Client unverändert
// bleiben (#48).
import type { CostKey, DepositStatus, MeterType, Unit, UnitUsage } from '../../shared/types.ts'
export type * from '../../shared/types.ts'

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
  sonstig: 'Sonstig',
}

export const CATEGORIES = [
  'Grundsteuer',
  'Wasser/Abwasser',
  'Niederschlagswasser',
  'Müllabfuhr',
  'Straßenreinigung',
  'Gebäudereinigung',
  'Gartenpflege',
  'Beleuchtung/Allgemeinstrom',
  'Schornsteinfeger',
  'Sach- und Haftpflichtversicherung',
  'Hauswart',
  'Aufzug',
  'Kabel/Antenne',
  'Sonstige Betriebskosten',
  'Nicht umlagefähig',
]

export const KEY_LABELS: Record<CostKey, string> = {
  area: 'nach Wohnfläche',
  persons: 'nach Personenzahl',
  units: 'nach Wohneinheiten',
  direct: 'Direktzuordnung',
  meter: 'nach Verbrauch (Zähler)',
  custom: 'nach vereinbarten Anteilen (%)',
}

// Ordnet eine frei formulierte Kategorie (z. B. aus der KI-Auswertung) der
// nächstliegenden Betriebskostenart zu, statt hart auf „Sonstige" zu fallen.
export function matchCategory(raw: string): string {
  if (CATEGORIES.includes(raw)) return raw
  const s = raw.toLowerCase()
  if (/müll|abfall|restabfall|biotonne|wertstoff/.test(s)) return 'Müllabfuhr'
  if (/niederschlag|regenwasser|oberflächenwasser/.test(s)) return 'Niederschlagswasser'
  if (/wasser|abwasser|kanal/.test(s)) return 'Wasser/Abwasser'
  if (/grundsteuer|grundbesitz/.test(s)) return 'Grundsteuer'
  if (/versicherung|haftpflicht/.test(s)) return 'Sach- und Haftpflichtversicherung'
  if (/straßenreinigung|strassenreinigung|winterdienst/.test(s)) return 'Straßenreinigung'
  if (/schornstein|kamin|feuerstätte/.test(s)) return 'Schornsteinfeger'
  if (/garten|außenanlage|grünpflege/.test(s)) return 'Gartenpflege'
  if (/strom|beleuchtung/.test(s)) return 'Beleuchtung/Allgemeinstrom'
  if (/gebäudereinigung|hausreinigung|treppenhausreinigung/.test(s)) return 'Gebäudereinigung'
  if (/hauswart|hausmeister/.test(s)) return 'Hauswart'
  if (/aufzug|lift/.test(s)) return 'Aufzug'
  if (/kabel|antenne|breitband/.test(s)) return 'Kabel/Antenne'
  if (/instandhalt|reparatur|verwaltung|nicht umlage/.test(s)) return 'Nicht umlagefähig'
  return 'Sonstige Betriebskosten'
}

// Sinnvolle Vorbelegung des Umlageschlüssels je Kostenart
export function defaultKeyFor(category: string): CostKey {
  if (category === 'Wasser/Abwasser' || category === 'Müllabfuhr') return 'persons'
  return 'area'
}
