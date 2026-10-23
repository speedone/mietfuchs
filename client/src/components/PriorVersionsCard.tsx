// Karte „Automatische Vorversionen“ in den Einstellungen (#318, Schritt 1). Der Server legt höchstens einmal
// in der Woche eine Kopie der Datenbank an und behält vier (server/src/db/priorVersions.ts). Hier stehen sie
// zum Einspielen, über denselben Weg wie die Datenbank aus einem Backup. Nichts speichert beim Anklicken:
// Eingespielt wird erst nach der Rückfrage.
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Card from './Card'
import Table from './Table'
import { NoticeBox } from './Notice'

export type PriorVersion = { name: string; createdAt: string; size: number }

// Zeitpunkt in der Zeit des Rechners, auf dem die Oberfläche läuft; der Name der Datei trägt UTC.
export const priorVersionWhen = (iso: string): string => {
  const d = new Date(iso)
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time} Uhr`
}

export const fileSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

// Die Hinweise des Servers überstehen das Neuladen in sessionStorage (Durchsicht S2). Nach dem
// Einspielen wird **immer** neu geladen, denn jede Seite hält noch Daten des alten Stands; ohne Neuladen
// arbeitete der Vermieter mit ihnen weiter und schriebe sie womöglich zurück. Damit die Hinweise (etwa
// fehlende Belege) trotzdem gelesen werden, stehen sie danach einmal in dieser Karte. Der Speicher kann
// fehlen oder werfen (privates Fenster); dann bleibt es beim Neuladen ohne Hinweise.
const NOTES_KEY = 'mietfuchs.vorversion.hinweise'
function keepNotes(text: string): void {
  try {
    sessionStorage.setItem(NOTES_KEY, text)
  } catch {
    // siehe oben
  }
}
// Gelesen beim Einhängen, entfernt erst im Effekt: React ruft den Anfangswert im StrictMode zweimal
// auf, und ein Entfernen dort ließe den zweiten Aufruf leer ausgehen.
function readNotes(): string {
  try {
    return sessionStorage.getItem(NOTES_KEY) ?? ''
  } catch {
    return ''
  }
}
function dropNotes(): void {
  try {
    sessionStorage.removeItem(NOTES_KEY)
  } catch {
    // siehe oben
  }
}

export default function PriorVersionsCard({ reloadPage = () => window.location.reload() }: { reloadPage?: () => void } = {}) {
  const confirm = useConfirm()
  const toast = useToast()
  const [versions, setVersions] = useState<PriorVersion[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(readNotes)
  useEffect(dropNotes, [])

  useEffect(() => {
    api<PriorVersion[]>('/api/prior-versions').then(setVersions, (e: unknown) => setLoadError(errorText(e)))
  }, [])

  async function restore(v: PriorVersion) {
    const ok = await confirm({
      title: `Vorversion vom ${priorVersionWhen(v.createdAt)} einspielen?`,
      message:
        'Alle aktuellen Daten werden durch diesen Stand ersetzt; was Sie seither erfasst oder geändert haben, geht verloren. ' +
        'Die Belege bleiben, wie sie sind: Seither hochgeladene bleiben im Belegordner, seither gelöschte fehlen danach. ' +
        'Der bisherige Stand bleibt als mietfuchs.sqlite.vor-restore im Datenordner; eine frühere Sicherung dieses Namens wird nicht überschrieben, sondern mit Datum daneben gelegt.',
      confirmLabel: 'Einspielen',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setDone('')
    try {
      const answer = await api<{ notes?: string[] }>(`/api/prior-versions/${encodeURIComponent(v.name)}/restore`, { method: 'POST' })
      const notes = answer?.notes ?? []
      keepNotes(`Vorversion eingespielt.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`)
      setDone('Vorversion eingespielt, die Seite wird neu geladen …')
      reloadPage()
    } catch (e) {
      toast(errorText(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Card title="Automatische Vorversionen">
      <p className="muted">
        Mietfuchs legt von sich aus höchstens einmal in der Woche eine Kopie Ihrer Daten an und behält die letzten
        vier, im Datenordner unter <code>vorversionen</code>. Haben Sie versehentlich etwas gelöscht, können Sie
        hier einen früheren Stand einspielen. Die Vorversionen gehören nicht zum Backup; sie ersetzen es auch nicht,
        denn sie liegen auf demselben Rechner.
      </p>
      {loadError && <NoticeBox level="error" title="Die Vorversionen ließen sich nicht laden" action={loadError} />}
      {versions && versions.length === 0 && (
        <p className="muted">
          Noch keine Vorversion. Die erste entsteht, sobald Daten erfasst sind: beim nächsten Start von Mietfuchs
          oder spätestens einen Tag später.
        </p>
      )}
      {versions && versions.length > 0 && (
        <Table className="stacked">
          <thead><tr><th>Stand vom</th><th className="num">Größe</th><th><span className="sr-only">Aktion</span></th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.name}>
                <td data-label="Stand vom" id={`vorversion-${v.name}`}>{priorVersionWhen(v.createdAt)}</td>
                <td className="num" data-label="Größe">{fileSize(v.size)}</td>
                <td data-label="Aktion">
                  {/* Welcher Stand, sagt die Zelle daneben (für Vorleser über aria-describedby). */}
                  <button className="btn ghost danger-ghost ml-auto" disabled={busy} aria-describedby={`vorversion-${v.name}`} onClick={() => void restore(v)}>
                    Einspielen …
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {done && <div className="ok" role="status">{done}</div>}
    </Card>
  )
}
