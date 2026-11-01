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
              <p className="muted">
                Öffnet sich die Adresse nicht, prüfen Sie, ob Handy und Rechner im selben WLAN sind und unter Windows die
                Firewall Mietfuchs für private Netzwerke zulässt.
              </p>
            </>
          )}
          {view.noAddress && <p className="muted">Dieser Rechner ist gerade mit keinem Netzwerk verbunden.</p>}
          {view.restart && !draft.saving && (
            <p className="muted">
              Beim Speichern startet Mietfuchs neu und lädt die Seite neu.
              {view.firewall && ' Unter Windows fragt danach die Windows-Firewall: Erlauben Sie den Zugriff in privaten Netzwerken.'}
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
