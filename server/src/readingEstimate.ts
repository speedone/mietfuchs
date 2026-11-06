// Geschätzte Ablesung (#98). Reine Rechnung ohne Speicher: welche als geschätzt gekennzeichneten Ablesungen ein
// Zeitraum benutzt, und der Text dafür beim Verbrauch des Mieters. Die Kennzeichnung ändert keine Zahl; gerechnet wird
// mit dem geschätzten Stand wie mit einem abgelesenen.
//
// Benutzt ist eine Ablesung, wenn der Verbrauch des Zeitraums aus ihr entsteht (`readingsUsedFor`, dieselbe Regel wie
// bei der Eichfrist): im Zeitraum, dazu der Stand davor bzw. danach, aus dem an der Grenze interpoliert wird.
import { readingsUsedFor } from './calibration.ts'
import type { SnapshotReading } from './snapshot.ts'

type Period = { from: string; to: string }
export type EstimatedReading = { meterId: string; date: string; reason: string }

export function estimatedReadingsUsed(readings: readonly SnapshotReading[], meterIds: Iterable<string>, period: Period): EstimatedReading[] {
  const out: EstimatedReading[] = []
  for (const id of new Set(meterIds)) {
    for (const x of readingsUsedFor(readings.filter((y) => y.meterId === id), period)) {
      if (x.estimated === true) out.push({ meterId: id, date: x.date, reason: (x.estimateReason ?? '').trim() })
    }
  }
  return out
}

// Ein Datum deutsch, aus der Zeichenkette gebaut (wie `fmtDay` in calc.ts), damit keine Zeitzone einen Tag verschiebt.
const fmtDay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

// Der Zusatz zur Zeile des Mieters: „; geschätzt: „Kaltwasser EG“ Stand vom 31.12.2025 („Begründung“)“, mit dem Namen
// des Zählers, denn auch ein Zähler außerhalb der Wohnung (der Hauptzähler) kann es sein. Leer ohne Schätzung.
export function estimatedSuffix(list: readonly EstimatedReading[], nameOf: (meterId: string) => string): string {
  if (list.length === 0) return ''
  const parts = list.map((e) => `„${nameOf(e.meterId)}“ Stand vom ${fmtDay(e.date)}${e.reason ? ` („${e.reason}“)` : ''}`)
  return `; geschätzt: ${parts.join(', ')}`
}
