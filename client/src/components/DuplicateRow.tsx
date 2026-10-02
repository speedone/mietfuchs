import type { CostItem } from '../types'
import { candidateText, linkLabel, linkTargets } from '../triage'

// Die Zeile unter einer KI-Position, wenn dieselbe Rechnung schon erfasst sein könnte
// (shared/duplicates.ts), etwa als Übernahme aus dem Vorjahr mit Schätzbetrag. Angeboten wird,
// den Beleg mit einer Position ohne Beleg zu verknüpfen und ihren Betrag zu setzen; wer wirklich
// eine zweite Rechnung hat, hakt die Zeile an und legt sie als neue Position an. Schnellerfassung
// und Kostenseite zeigen dieselbe Zeile.
export default function DuplicateRow({ candidates, amount, year, colSpan, linked, busy, onLink }: {
  candidates: CostItem[]
  amount: string
  year: number
  colSpan: number
  linked?: string
  busy?: boolean
  onLink: (target: CostItem) => void
}) {
  if (linked) {
    return (
      <tr className="no-print">
        <td colSpan={colSpan}><span className="badge green">✓ verknüpft mit „{linked}“</span></td>
      </tr>
    )
  }
  if (candidates.length === 0) return null
  const targets = linkTargets(candidates)
  return (
    <tr className="no-print">
      <td colSpan={colSpan}>
        <div className="warn" style={{ margin: 0 }}>
          Für {year} schon erfasst: {candidates.map(candidateText).join(', ')}.{' '}
          {targets.length > 0
            ? 'Ist das dieselbe Rechnung, verknüpfen Sie den Beleg mit der Position. Ist es eine zweite Rechnung, haken Sie die Zeile an und legen sie als neue Position an.'
            : 'Ist das dieselbe Rechnung, übernehmen Sie die Zeile bitte nicht. Ist es eine zweite, haken Sie sie an.'}
          {targets.length > 0 && (
            <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
              {targets.map((t) => (
                <button key={t.id} type="button" className="btn small secondary" disabled={busy} onClick={() => onLink(t)}>
                  {linkLabel(t, { amount })}
                </button>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
