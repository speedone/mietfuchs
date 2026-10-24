// Nach „Ältere anzeigen“ bzw. „Ältere Änderungen laden“ geht der Fokus auf den ersten neu gezeigten Eintrag.
// Sonst bliebe er auf dem Knopf, der mit der Liste nach unten rückt oder, wenn nichts mehr nachkommt,
// verschwindet; dann fiele er an den Anfang der Seite (Durchsicht von PR #449, K3).
//
// `expect(index)` merkt sich die Stelle des ersten neuen Eintrags (die Zahl der bisher gezeigten); sobald die
// Liste dort einen Eintrag hat, bekommt dessen erstes Bedienelement (`target`) den Fokus. `cancel()` vergisst
// die Stelle, etwa wenn das Nachladen scheitert oder die Liste neu beginnt.
import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useFocusFirstNew(container: RefObject<HTMLElement | null>, items: string, target: string) {
  const pending = useRef<number | null>(null)
  useLayoutEffect(() => {
    const index = pending.current
    if (index === null) return
    const item = container.current?.querySelectorAll(items)[index]
    if (!item) return
    pending.current = null
    const el = item.matches(target) ? item : item.querySelector(target)
    if (el instanceof HTMLElement) el.focus()
  })
  return {
    expect: (index: number) => { pending.current = index },
    cancel: () => { pending.current = null },
  }
}
