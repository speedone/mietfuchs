// Karte „Zugriff aus dem Heimnetz“ in den Einstellungen (#517), nur im Programmfenster. Das Häkchen ist ein Entwurf
// (#309); „Speichern“ lässt das Fenster den Server mit der neuen Adresse neu starten, danach lädt die Seite neu.
// Was die Karte zeigt, entscheidet desktopNetwork.ts.
import { useEffect, useState } from 'react'
import { errorText } from '../api'
import { networkView, type NetworkBridge, type NetworkState } from '../desktopNetwork'
import { useDraft } from '../useDraft'
import Card from './Card'
import DraftActions from './DraftActions'
import { NoticeBox } from './Notice'

// Fragt die Windows-Firewall nach dem Einschalten, soll nur das Heimnetz frei werden, nie ein öffentliches WLAN. Die
// Frage kommt erst nach dem Neustart, wenn die Karte schon die Adressen zeigt; deshalb steht der Satz auch dort.
const PRIVATE_ONLY = 'Wenn Windows fragt, lassen Sie nur „Private Netzwerke“ zu.'

export default function NetworkCard({ bridge }: { bridge: NetworkBridge }) {
  const [saved, setSaved] = useState<NetworkState | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    bridge.get().then(setSaved, (e: unknown) => setLoadError(errorText(e)))
  }, [bridge])
  const draft = useDraft(saved?.enabled ?? false)
  const view = saved && networkView(saved, draft.value)

  return (
    <Card title="Zugriff aus dem Heimnetz">
      <p className="muted">Öffnen Sie Mietfuchs auch auf dem Handy, Tablet oder einem anderen Rechner im selben WLAN.</p>
      {loadError && <NoticeBox level="error" action={`Der Stand ließ sich nicht abfragen: ${loadError}`} />}
      {view && (
        <>
          <label className="checkline">
            <input type="checkbox" checked={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.checked)} />
            Zugriff aus dem Heimnetz erlauben
          </label>
          <p className="muted">
            Mietfuchs hat kein Passwort: Solange der Zugriff erlaubt ist, kann jeder in Ihrem Heimnetz Ihre Daten öffnen
            und ändern. Erlauben Sie ihn nur in einem Netz, dem Sie vertrauen, nicht in einem öffentlichen WLAN.
          </p>
          {view.addresses && (
            <>
              <p className="mb-1">Auf dem Handy im Browser öffnen:</p>
              <ul className="mt-0">
                {view.addresses.map((a) => <li key={a}><code className="break-all">{a}</code></li>)}
              </ul>
              <p className="muted mb-1">{PRIVATE_ONLY}</p>
              <p className="muted">
                Öffnet sich die Adresse nicht, prüfen Sie, ob Handy und Rechner im selben WLAN sind und ob
                Windows dieses WLAN als privates Netzwerk führt (Einstellungen → Netzwerk und Internet → WLAN → Ihr Netz →
                Netzwerkprofiltyp „Privates Netzwerk“).
              </p>
            </>
          )}
          {view.noAddress && <p className="muted">Dieser Rechner ist gerade mit keinem Netzwerk verbunden.</p>}
          {view.restart && !draft.saving && (
            <p className="muted">
              Beim Speichern startet Mietfuchs neu und lädt die Seite neu.
              {view.firewall && ` ${PRIVATE_ONLY}`}
            </p>
          )}
          {draft.saving && <p role="status"><span className="spinner" />Mietfuchs startet neu …</p>}
          <DraftActions
            draft={draft}
            layout="card"
            what="Zugriff aus dem Heimnetz"
            onSave={async (enabled) => setSaved(await bridge.set(enabled))}
          />
        </>
      )}
    </Card>
  )
}
