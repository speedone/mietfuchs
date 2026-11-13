// Ist ein Konto lückenlos eingelesen (#188)? Die Importe eines Kontos schließen an, wenn der nächste spätestens am
// Folgetag des vorigen beginnt und sein Anfangssaldo gleich dem Endsaldo des vorigen ist. Gesucht ist der längste
// anschließende Zeitraum bis zum jüngsten Auszug. Wortlaut in der Oberfläche: „Konto lückenlos eingelesen vom … bis …“,
// nie „Einnahmen vollständig“.
//
// Importe ohne Salden (camt.052, deren Saldo vorgemerkte Umsätze enthalten kann) zählen nicht mit. Hat keiner Salden,
// ist nichts zu sagen (`null`).

import { compareText } from '../apportion.ts'
import type { BankImport } from './model.ts'

// Ein Kalendertag 'JJJJ-MM-TT' plus `days` Tage, in UTC. Reine Datumsrechnung, ohne Feiertage.
export const addIsoDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export type Coverage = { from: string; to: string } | { gapAfter: string; gapBefore: string }

export function coverageOf(imports: readonly BankImport[]): Coverage | null {
  const withBalances = imports
    .filter((i) => i.openingBalanceCents !== null && i.closingBalanceCents !== null)
    .sort((a, b) => compareText(a.toDate, b.toDate) || compareText(a.fromDate, b.fromDate))
  let current = withBalances[withBalances.length - 1]
  if (!current) return null
  let from = current.fromDate
  const to = current.toDate
  for (let i = withBalances.length - 2; i >= 0; i--) {
    const previous = withBalances[i]
    if (!previous) break
    const joins = compareText(current.fromDate, addIsoDays(previous.toDate, 1)) <= 0 && previous.closingBalanceCents === current.openingBalanceCents
    if (!joins) {
      // Ein Auszug, der ganz im schon gedeckten Zeitraum liegt (etwa ein Monatsauszug neben den Tagesauszügen), bricht
      // die Kette nicht.
      if (compareText(previous.fromDate, from) >= 0) continue
      return { gapAfter: previous.toDate, gapBefore: current.fromDate }
    }
    if (compareText(previous.fromDate, from) < 0) from = previous.fromDate
    current = previous
  }
  return { from, to }
}
