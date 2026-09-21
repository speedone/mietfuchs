import { useEffect, useState } from 'react'
import { api } from '../api'
import { databaseHint, DISMISS_KEY, type HealthReport } from '../database'
import type { DatabaseState } from '../types'

// Was beim Start mit den Daten geschehen ist, einmal gesagt (#55).
//
// Den Umstieg in die Datenbank macht der Server beim Start; hier steht nur, was der Nutzer
// davon merkt. Gelingt er, ist es ein Satz und ein Knopf. Scheitert er, steht dieselbe Stelle
// für die Erklärung — dann arbeitet Mietfuchs unverändert mit der bisherigen Datei weiter, und
// genau das muss dabeistehen, damit niemand seine Daten für verloren hält.
//
// Gefragt wird einmal beim Öffnen. Der Umstieg läuft beim Start des Servers, danach ändert sich
// daran nichts mehr, solange er läuft. Bleibt die Antwort aus, bleibt der Hinweis aus, wie beim
// Update-Hinweis.
//
// Er steht bewusst im Hauptbereich und nicht in der Seitenleiste: Dort wäre er auf kleinen
// Bildschirmen ausgeblendet (siehe `.sidebar .update-hint` in index.css), und gerade die
// Meldung über einen gescheiterten Umstieg darf nicht davon abhängen, wie breit das Fenster ist.
export default function DatabaseNotice() {
  const [database, setDatabase] = useState<DatabaseState | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => localStorage.getItem(DISMISS_KEY))

  useEffect(() => {
    api<HealthReport>('/healthz')
      .then((report) => setDatabase(report.database ?? null))
      .catch(() => {})
  }, [])

  const hint = databaseHint(database, dismissed)
  if (!hint) return null

  const close = () => {
    localStorage.setItem(DISMISS_KEY, hint.message)
    setDismissed(hint.message)
  }

  return (
    <section className={`card db-notice${hint.kind === 'failed' ? ' db-notice-problem' : ''}`} role="status">
      <span className="db-notice-icon" aria-hidden="true">{hint.kind === 'done' ? '🗄️' : '⚠️'}</span>
      <div className="db-notice-body">
        <h2>{hint.kind === 'done' ? 'Deine Daten sind umgezogen' : 'Der Umstieg der Daten ist nicht gelungen'}</h2>
        <p>{hint.message}</p>
        {hint.notes.map((note) => <p key={note} className="muted">{note}</p>)}
      </div>
      <button className="btn" onClick={close}>Verstanden</button>
    </section>
  )
}
