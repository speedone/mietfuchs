// Ampel-Triage für die Schnellerfassung. Die Ampel einer Rechnungsposition steht seit der
// Belegbuchung (#170) in shared/assessment.ts, weil der Server sie mitliefert, und das Verknüpfen
// mit einer bestehenden Position plant der Server (server/src/bookingPlan.ts); hier bleiben die
// Zählerstände.
import type { Meter, Reading, TrafficLight } from './types'
import { createScorer } from '../../shared/assessment.ts'
// Für die Rückfrage im Kostenformular (Kosten.tsx)
export { candidateText } from '../../shared/assessment.ts'

// ---------- Zählerstand ----------

// Findet den Zähler, dessen (auf Ziffern normalisierte) Nummer der gelesenen entspricht.
const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
export function autoMatchMeter(meterNumber: string | null, meters: Meter[]): string | null {
  const target = onlyDigits(meterNumber)
  if (!target) return null
  return meters.find((m) => onlyDigits(m.meterNumber) === target)?.id ?? null
}

export type ReadingCtx = {
  meterNumber: string | null
  value: number | null
  hasDate: boolean // verlässliches Datum aus EXIF/Bild vorhanden
  matchedMeterId: string | null // bereits zugeordneter Zähler (Auto-Match, vom Nutzer überschreibbar)
  readings: Reading[]
}

export type ScoredReading = {
  level: TrafficLight
  reasons: string[]
  replacementGuess: boolean
  suggestedOldEndValue: number | null
}

export function scoreReading(ctx: ReadingCtx): ScoredReading {
  const s = createScorer()
  const { matchedMeterId } = ctx

  if (ctx.value == null) s.bump('rot', 'Zählerstand nicht erkannt')
  if (!matchedMeterId) {
    s.bump('rot', ctx.meterNumber ? `Zählernummer ${ctx.meterNumber} keinem Zähler zugeordnet` : 'kein Zähler erkannt — bitte zuordnen')
  }

  let replacementGuess = false
  let suggestedOldEndValue: number | null = null
  if (matchedMeterId && ctx.value != null) {
    const own = ctx.readings.filter((r) => r.meterId === matchedMeterId).sort((a, b) => a.date.localeCompare(b.date))
    const prior = own[own.length - 1]
    if (prior) {
      if (ctx.value < prior.value) {
        s.bump('rot', `Stand ${ctx.value} < letzter Stand ${prior.value} — Zählerwechsel?`)
        replacementGuess = true
        suggestedOldEndValue = prior.value
      } else if (own.length >= 2) {
        // grobe Plausibilität: aktuellen Zuwachs mit dem letzten Segment vergleichen
        const lastDiff = own[own.length - 1].value - own[own.length - 2].value
        const diff = ctx.value - prior.value
        if (lastDiff > 0 && diff > lastDiff * 3) s.bump('gelb', 'Verbrauch deutlich höher als in der Vorperiode')
        if (lastDiff > 0 && diff < lastDiff * 0.3) s.bump('gelb', 'Verbrauch deutlich niedriger als in der Vorperiode')
      }
    }
  }

  if (!ctx.hasDate) s.bump('gelb', 'Ablesedatum unsicher — bitte prüfen')

  const { level, reasons } = s.result()
  return { level, reasons, replacementGuess, suggestedOldEndValue }
}
