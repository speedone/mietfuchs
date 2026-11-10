// „Verbunden mit nas:3001“ in der Seitenleiste (#528, Rückmeldung zur Kopplung): Zeigt das Programmfenster den
// Mietfuchs eines anderen Rechners, soll man das sehen, ohne in die Einstellungen zu gehen; sonst hält man die Daten
// leicht für die eigenen. Ruhig wie „Im Heimnetz erreichbar“ (NetworkHint.tsx), kein Hinweis einer Stufe. Ein Klick
// führt zu den Einstellungen mit der Karte „Mietfuchs im Heimnetz“ (RemoteCard.tsx). Den Stand liest die Zeile einmal
// von der Brücke; nach dem Koppeln oder Trennen lädt das Fenster ohnehin eine andere Seite.
import { useEffect, useState } from 'react'
import { connectedLine, remoteHost, type RemoteBridge, type RemoteState } from '../desktopRemote'

export default function RemoteHint({ bridge, onOpen }: { bridge: RemoteBridge; onOpen: () => void }) {
  const [state, setState] = useState<RemoteState | null>(null)
  useEffect(() => {
    let stopped = false
    // Ohne Antwort bleibt die Zeile aus; die Karte in den Einstellungen sagt dann, was nicht ging
    bridge.get().then((s) => { if (!stopped) setState(s) }, () => {})
    return () => { stopped = true }
  }, [bridge])
  if (!state?.connected) return null
  const line = state.origin ? `Verbunden mit ${remoteHost(state.origin)}` : 'Verbunden mit einem Mietfuchs im Heimnetz'
  return (
    <button type="button" className="mb-2 p-0 border-0 bg-transparent text-s text-muted hover:text-text text-left"
      aria-description="Zur Verbindung in den Einstellungen"
      title={`${connectedLine(state)}. Die Daten liegen dort, nicht auf diesem Rechner. Zur Verbindung in den Einstellungen`}
      onClick={onOpen}>
      <span aria-hidden="true">🔗</span> {line}
    </button>
  )
}
