// Nach „Erneut versuchen“ verschwindet der Knopf mit dem Kasten „Gespeichert, nicht ausgewertet“, und der Fokus fiele
// auf body (Durchsicht #487). Er geht deshalb an „Abbrechen“ des Eintrags, solange dieser läuft, sonst an den Eintrag
// selbst (`data-queue-entry`, tabIndex -1). Hat der Nutzer den Fokus inzwischen woandershin gesetzt, bleibt er dort.
import { useLayoutEffect, useRef } from 'react'
import type { QueueBase } from './evaluationQueue'

export function useRetryFocus(queue: readonly QueueBase[]): (id: number) => void {
  const pending = useRef<number | null>(null)
  useLayoutEffect(() => {
    const id = pending.current
    if (id === null) return
    const box = document.querySelector<HTMLElement>(`[data-queue-entry="${id}"]`)
    const entry = queue.find((x) => x.id === id)
    const active = document.activeElement
    if (!box || !entry || (active && active !== document.body && !box.contains(active))) {
      pending.current = null
      return
    }
    ;(box.querySelector<HTMLElement>('[data-ai-cancel]') ?? box).focus()
    if (entry.status !== 'wartend' && entry.status !== 'läuft') pending.current = null
  }, [queue])
  return (id: number) => { pending.current = id }
}
