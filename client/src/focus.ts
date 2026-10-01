// Ein Eintrag, den eine andere Seite geöffnet haben will (#142): „Hier beheben →“ in der
// Abrechnung führt nicht nur zur Seite, sondern zum betroffenen Eintrag. Die App hält das Ziel,
// die Seite liest es, sobald ihre Daten da sind, öffnet den Eintrag und meldet das zurück. So
// klappt ein späterer Besuch der Seite nichts mehr von selbst auf.

import { useCallback, useEffect, useRef } from 'react'
import type { NoticeSubject } from './types'

export type FocusProps = { focus?: NoticeSubject | null; onFocusDone?: () => void }

export function useFocusTarget<T>(
  focus: NoticeSubject | null | undefined,
  kind: NoticeSubject['kind'],
  items: readonly T[] | null,
  idOf: (item: T) => string,
  open: (item: T) => void,
  done: (() => void) | undefined,
): void {
  // Die Rückrufe ändern sich bei jedem Rendern; maßgeblich sind Ziel und Daten.
  const openRef = useRef(open)
  const doneRef = useRef(done)
  const idRef = useRef(idOf)
  openRef.current = open
  doneRef.current = done
  idRef.current = idOf
  useEffect(() => {
    if (!focus || focus.kind !== kind || !items) return
    const item = items.find((i) => idRef.current(i) === focus.id)
    if (item === undefined) return
    openRef.current(item)
    doneRef.current?.()
  }, [focus, kind, items])
}

// Den hervorgehobenen Eintrag ins Bild holen, sobald die Seite ihn gezeichnet hat. jsdom kennt
// scrollIntoView nicht. Laufende Zeitgeber werden beim Abbauen der Seite aufgeräumt, wie beim
// Toast in components/feedback.tsx: Ein Zeitgeber, der danach feuert, trifft auf ein abgebautes
// Dokument, in Komponententests auf eine abgebaute Umgebung („document is not defined“).
export function useScrollToFocus(): () => void {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])
  return useCallback(() => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      const el = document.querySelector('.focus-target')
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    timers.current.add(timer)
  }, [])
}
