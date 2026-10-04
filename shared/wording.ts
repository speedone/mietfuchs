// Kleine Helfer für Texte an den Nutzer (#180), von Server und Client gemeinsam benutzt: Die
// Hinweise der Berechnung und die Zeilen des Cockpits sollen gleich sprechen. Statt „Wohnung(en)“
// steht die richtige Zahl, statt einer Aufzählung nur mit Kommas eine mit „und“.
import type { MeterType } from './types.ts'

// Deutsche Aufzählung: „A“, „A und B“, „A, B und C“. Eine leere Liste ergibt einen leeren Text.
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`
}

// Ein- oder Mehrzahl nach der Anzahl, ohne die Zahl: plural(1, 'Wohnung', 'Wohnungen').
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

// Anzahl mit passendem Wort: „1 Position“, „3 Positionen“, „0 Positionen“.
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${plural(count, one, many)}`
}

// Die Zählerarten, wie sie der Nutzer liest. Die Oberfläche beschriftet damit ihre Auswahl, die
// Berechnung ihre Hinweise; vorher stand dort der gespeicherte Wert („kaltwasser“).
export const METER_TYPE_LABELS: Record<MeterType, string> = {
  kaltwasser: 'Kaltwasser',
  strom: 'Strom (Allgemein)',
  waerme: 'Wärme',
  sonstig: 'Sonstiges',
}

// Beschriftung einer gespeicherten Zählerart; was keine bekannte ist, bleibt, wie es dasteht.
export function meterTypeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return (METER_TYPE_LABELS as Record<string, string>)[type] ?? type
}
