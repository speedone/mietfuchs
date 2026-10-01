import { useEffect, useState } from 'react'
import { api } from '../api'
import { databaseHint, DISMISS_KEY, UPDATE_DISMISS_KEY, updateHint, type HealthReport } from '../database'
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
// Der Speicher des Browsers kann fehlen oder werfen (privates Fenster, gesperrte Website-Daten).
// Dann erscheint ein Hinweis eben beim nächsten Öffnen noch einmal; kaputtgehen darf nichts.
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* siehe oben */
  }
}

export default function DatabaseNotice() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => remembered(DISMISS_KEY))
  const [updateDismissed, setUpdateDismissed] = useState<string | null>(() => remembered(UPDATE_DISMISS_KEY))

  useEffect(() => {
    api<HealthReport>('/healthz')
      .then((r) => setReport(r))
      .catch(() => {})
  }, [])

  const database: DatabaseState | null = report?.database ?? null
  const hint = databaseHint(database, dismissed)
  // Nach einem Update (#154). Neben einem gelungenen Umstieg steht er nie: Der Umstieg schreibt
  // in eine neue Datei, und der Server nennt dann keine Sicherung.
  const update = updateHint(database, report?.version, updateDismissed)
  if (!hint && !update) return null

  return (
    <>
      {hint && (
        <section className={`card db-notice${hint.kind === 'failed' ? ' db-notice-problem' : ''}`} role="status">
          <span className="db-notice-icon" aria-hidden="true">{hint.kind === 'failed' ? '⚠️' : hint.kind === 'stale' ? 'ℹ️' : '🗄️'}</span>
          <div className="db-notice-body">
            <h2>{hint.kind === 'done' ? 'Deine Daten sind umgezogen' : hint.kind === 'stale' ? 'Im Datenordner liegt noch eine alte Datei' : 'Der Umstieg der Daten ist nicht gelungen'}</h2>
            <p>{hint.message}</p>
            {hint.notes.map((note) => <p key={note} className="muted">{note}</p>)}
          </div>
          <button className="btn" onClick={() => {
            remember(DISMISS_KEY, hint.message)
            setDismissed(hint.message)
          }}>Verstanden</button>
        </section>
      )}
      {update && (
        <section className="card db-notice" role="status">
          <span className="db-notice-icon" aria-hidden="true">🗄️</span>
          <div className="db-notice-body">
            <h2>Sicherung vor dem Update angelegt</h2>
            <p>{update.message}</p>
            <p><a href={update.guideUrl} target="_blank" rel="noreferrer">Zur Anleitung: Zurück zu einer älteren Version</a></p>
          </div>
          <button className="btn" onClick={() => {
            remember(UPDATE_DISMISS_KEY, update.backup)
            setUpdateDismissed(update.backup)
          }}>Verstanden</button>
        </section>
      )}
    </>
  )
}
