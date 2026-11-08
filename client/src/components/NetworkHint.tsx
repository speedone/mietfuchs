// „Im Heimnetz erreichbar“ in der Seitenleiste (#517, Durchsicht vor 0.15.0 K5): Solange der Zugriff aus dem Heimnetz an
// ist, kann jeder im selben Netz Mietfuchs öffnen; das soll man sehen, ohne in die Einstellungen zu gehen. Ruhig, kein
// Hinweis einer Stufe: Eingeschaltet hat ihn der Nutzer selbst. Ein Klick führt zur Karte in den Einstellungen
// (NetworkCard.tsx). Den Stand liest die Zeile von der Brücke des Fensters und folgt danach der Karte (desktopNetwork.ts).
import { useEffect, useState } from 'react'
import { onNetworkChange, requestNetworkCard, type NetworkBridge } from '../desktopNetwork'

export default function NetworkHint({ bridge, onOpen }: { bridge: NetworkBridge; onOpen: () => void }) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let stopped = false
    // Ohne Antwort bleibt die Zeile aus; die Karte in den Einstellungen sagt dann, was nicht ging
    bridge.get().then((s) => { if (!stopped) setEnabled(s.enabled) }, () => {})
    const off = onNetworkChange((s) => setEnabled(s.enabled))
    return () => {
      stopped = true
      off()
    }
  }, [bridge])
  if (!enabled) return null
  return (
    <button type="button" className="mb-2 p-0 border-0 bg-transparent text-s text-muted hover:text-text" aria-description="Zur Einstellung „Zugriff aus dem Heimnetz“ in den Einstellungen"
      title="Zugriff aus dem Heimnetz ist an: Geräte im selben WLAN können Mietfuchs öffnen. Zur Einstellung"
      onClick={() => { requestNetworkCard(); onOpen() }}>
      <span aria-hidden="true">📶</span> Im Heimnetz erreichbar
    </button>
  )
}
