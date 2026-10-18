// Speichern ohne Doppelklick (#346 Schritt 7, Durchsicht S1): Ein zweiter Klick auf „Anlegen“, ein Strg+S oder Enter
// während die Anfrage läuft, legte die Ablesung oder die Lieferung zweimal an. `run` lässt einen zweiten Aufruf fallen,
// solange der erste läuft (Sperre über eine Referenz, wie in `useDraft`: zwei Klicks im selben Augenblick sähen beide
// noch `busy === false`), und `busy` geht an das Seitenfenster (`<Drawer busy>`) und an den Knopf (`disabled`).
import { useCallback, useRef, useState } from 'react'

export function useSaving(): { busy: boolean; run: (fn: () => unknown) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = useCallback(async (fn: () => unknown) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
