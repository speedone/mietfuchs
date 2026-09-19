// Anzeige einer laufenden KI-Auswertung in den Warteschlangen von Kosten und Schnellerfassung:
// was das Modell gerade tut, wie lange es schon dauert, und ein Knopf zum Abbrechen.
import { useEffect, useState } from 'react'
import { fmtElapsed, progressText, type AiProgress } from '../aiRequest'

// Ab dann ein Hinweis, dass es ohne Grafikkarte länger dauern darf
const SLOW_AFTER_MS = 60_000

type Props = { progress: AiProgress | null; startedAt: number; onCancel: () => void }

export function AiProgressBadge({ progress, startedAt, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, now - startedAt)
  return (
    <>
      <span className="badge gray" role="status">
        <span className="spinner" />
        {progressText(progress)} <span className="ai-elapsed">{fmtElapsed(elapsed)}</span>
      </span>
      <button className="btn small ghost" onClick={onCancel}>Abbrechen</button>
      {elapsed >= SLOW_AFTER_MS && (
        <span className="muted">Ohne Grafikkarte kann ein Scan einige Minuten dauern.</span>
      )}
    </>
  )
}
