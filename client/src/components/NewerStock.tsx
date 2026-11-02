import { useState } from 'react'
import { api, errorText } from '../api'
import { NoticeBox } from './Notice'
import { useConfirm } from './feedback'
import { movedLongDate, reloadWithArrival, placeText, type Arrival, type NewerStockInfo } from '../relocation'

// Nach dem Umzug ins Programmfenster (#517, Ergänzung 2): Alte Fassungen kennen den Vermerk nicht, und mancher startet
// die angeheftete Programmdatei weiter. Hat sich dort seit dem Umzug etwas geändert, sagt es dieser Hinweis oben auf
// jeder Seite und bietet an, den neueren Stand noch einmal zu übernehmen. Nie von selbst, nur nach Rückfrage; der Stand
// von jetzt wird vorher gesichert (server/src/index.ts, `/api/relocation/readopt`).
// Praxistest M: Was „Übernehmen“ ersetzt und was „Nicht übernehmen“ heißt, steht schon im Kasten; läuft das alte
// Mietfuchs noch, lässt es sich wie beim ersten Umzug von hier beenden. Der Ort in Worten, der Pfad unter „Genauer Ort“.
export default function NewerStock({ newer, onDismissed, reloadPage = reloadWithArrival }: {
  newer: NewerStockInfo
  onDismissed: () => void
  reloadPage?: (arrival: Arrival) => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(newer.running)
  const [stopped, setStopped] = useState(false)

  async function adoptAgain() {
    const ok = await confirm({
      title: 'Neueren Stand übernehmen?',
      message: 'Mietfuchs kopiert die Daten noch einmal aus dem bisherigen Mietfuchs. Was Sie hier seit dem Umzug geändert haben, wird dabei ersetzt; ' +
        'der Stand von jetzt wird vorher gesichert und steht danach im Verlauf. Beenden Sie das alte Mietfuchs bitte vorher.',
      confirmLabel: 'Übernehmen',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await api('/api/relocation/readopt', { method: 'POST', body: JSON.stringify({}) })
      reloadPage('newer')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function quitOld() {
    setBusy(true)
    setError('')
    try {
      const { stopped: done } = await api<{ stopped: boolean }>('/api/relocation/quit-old', { method: 'POST', body: JSON.stringify({}) })
      if (done) {
        setRunning(false)
        setStopped(true)
      } else {
        setError('Das alte Mietfuchs ließ sich nicht von hier beenden. Schließen Sie bitte das Fenster der alten Programmdatei (unter Windows ein schwarzes Fenster, auf dem Mac das Terminal).')
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    try {
      await api('/api/relocation/newer/dismiss', { method: 'POST', body: JSON.stringify({}) })
      onDismissed()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <section className="card db-notice no-print" role="status">
      <span className="db-notice-icon" aria-hidden="true">📦</span>
      <div className="db-notice-body">
        <h2>Im bisherigen Mietfuchs wurde nach dem Umzug noch etwas geändert</h2>
        <p>
          {newer.modifiedAt ? `Zuletzt am ${movedLongDate(newer.modifiedAt)}, im ` : 'Im '}{placeText(newer.place)}. Diese Änderungen fehlen hier.
          {' '}Übernehmen Sie den neueren Stand, ersetzt er alles, was Sie hier seit dem Umzug geändert haben; der Stand von jetzt wird vorher gesichert.
        </p>
        <details className="mt-2 text-xs text-muted wrap-anywhere">
          <summary className="cursor-pointer">Genauer Ort</summary>
          <span>{newer.from}</span>
        </details>
        <p className="muted">„Nicht übernehmen“: Sie arbeiten hier weiter, die Änderungen im alten Mietfuchs bleiben dort. Der Hinweis kommt erst wieder, wenn sich dort erneut etwas ändert.</p>
        {stopped && <p className="info" role="status">Das alte Mietfuchs ist beendet.</p>}
        {running && <p className="mt-2">Das alte Mietfuchs ist noch geöffnet. Beenden Sie es bitte vor dem Übernehmen.</p>}
        {error && <NoticeBox level="error" title="Nicht übernommen" action={error} />}
        <div className="row mt-3">
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void adoptAgain()}>{busy && <span className="spinner" />}Neueren Stand übernehmen …</button>
          {running && <button type="button" className="btn secondary" disabled={busy} onClick={() => void quitOld()}>Altes Mietfuchs beenden</button>}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void dismiss()}>Nicht übernehmen</button>
        </div>
      </div>
    </section>
  )
}

