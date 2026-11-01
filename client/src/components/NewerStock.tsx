import { useState } from 'react'
import { api, errorText } from '../api'
import { NoticeBox } from './Notice'
import { useConfirm } from './feedback'
import { movedLongDate, type NewerStockInfo } from '../relocation'

// Nach dem Umzug ins Programmfenster (#517, Ergänzung 2): Alte Fassungen kennen den Vermerk nicht, und mancher startet
// die angeheftete Programmdatei weiter. Hat sich dort seit dem Umzug etwas geändert, sagt es dieser Hinweis oben auf
// jeder Seite und bietet an, den neueren Stand noch einmal zu übernehmen. Nie von selbst, nur nach Rückfrage; der Stand
// von jetzt wird vorher gesichert (server/src/index.ts, `/api/relocation/readopt`).
export default function NewerStock({ newer, onDismissed, reloadPage = () => window.location.reload() }: {
  newer: NewerStockInfo
  onDismissed: () => void
  reloadPage?: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
      reloadPage()
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
          {newer.modifiedAt ? `Zuletzt am ${movedLongDate(newer.modifiedAt)}, ` : ''}im Ordner <span className="break-all">{newer.from}</span>.
          {' '}Diese Änderungen fehlen hier. Sie können den neueren Stand noch einmal übernehmen.
        </p>
        {error && <NoticeBox level="error" title="Nicht übernommen" action={error} />}
        <div className="row">
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void adoptAgain()}>{busy && <span className="spinner" />}Neueren Stand übernehmen …</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void dismiss()}>Nicht übernehmen</button>
        </div>
      </div>
    </section>
  )
}
