// Ein Eintrag, den eine andere Seite geöffnet haben will (#142): „Hier beheben →“ in der
// Abrechnung führt nicht nur zur Seite, sondern zum betroffenen Eintrag. Die App hält das Ziel,
// die Seite liest es, sobald ihre Daten da sind, öffnet den Eintrag und meldet das zurück. So
// klappt ein späterer Besuch der Seite nichts mehr von selbst auf.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoticeSubject } from './types'

// Sprungziele (#554): Neben einem Eintrag des Servers (`NoticeSubject`, das der Server an Hinweisen setzt und deshalb in
// shared/types.ts steht) kennt nur die Oberfläche drei weitere Ziele. „Anlegen“ öffnet auf der Zielseite dasselbe
// Formular wie deren eigener Knopf (`new`); „Prüfen“ und „Beheben“ führen zur Karte, in der man das Offene erledigt
// (`section`); die Angaben des Objekts öffnen das Fenster „Objekt bearbeiten“ mit dem betroffenen Teil (`property`).
// Welcher Knopf welches Ziel hat, steht in jumpTargets.ts.
export type NewForm = 'unit' | 'tenancy' | 'costItem'
// Die Karten, zu denen gesprungen wird, je Seite: Stammdaten (`units`, `tenancies`), Abrechnung (`checks` = „Zu
// prüfen“, `sentAt` = Kopfzeile mit „Als versendet markieren“ bzw. „versendet am“), Einstellungen (`landlord`, `ai`, `about`).
export type SectionId = 'units' | 'tenancies' | 'checks' | 'sentAt' | 'landlord' | 'ai' | 'about'
export type PropertyPart = 'tax' | 'landlord'
export type JumpTarget =
  | NoticeSubject
  | { kind: 'new'; what: NewForm }
  | { kind: 'section'; section: SectionId }
  | { kind: 'property'; part: PropertyPart }

// Ein Eintrag des Servers, kein Ziel der Oberfläche
export const isSubject = (t: JumpTarget): t is NoticeSubject => 'id' in t

export type FocusProps = { focus?: JumpTarget | null; onFocusDone?: () => void }

export function useFocusTarget<T>(
  focus: JumpTarget | null | undefined,
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
    if (!focus || !isSubject(focus) || focus.kind !== kind || !items) return
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

// Vor dem Öffnen eines Fensters aus einem Sprung den Fokus auf den Knopf setzen, der es auf der Seite selbst öffnet
// (Durchsicht zu #554): Das Seitenfenster merkt sich beim Öffnen das fokussierte Element und gibt ihm beim Schließen
// den Fokus zurück; der geklickte Knopf der anderen Seite ist dann schon ausgehängt, und der Fokus fiele auf body.
// Wie `FocusTenancyRow` in Stammdaten.tsx. Ohne Rollen, das Fenster legt sich darüber.
export function focusOpener(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true })
}

// „Anlegen“ aus einer anderen Seite (#554): das Formular öffnen, sobald die Seite es öffnen kann (`ready`: was ihr
// eigener Knopf voraussetzt, ist geladen). Den Fokus ins erste Feld setzt das Seitenfenster selbst (Drawer.tsx).
export function useNewTarget(
  focus: JumpTarget | null | undefined,
  what: NewForm,
  ready: boolean,
  open: () => void,
  done: (() => void) | undefined,
): void {
  const openRef = useRef(open)
  const doneRef = useRef(done)
  openRef.current = open
  doneRef.current = done
  useEffect(() => {
    if (!ready || !focus || focus.kind !== 'new' || focus.what !== what) return
    openRef.current()
    doneRef.current?.()
  }, [focus, what, ready])
}

// Die Angaben einer Karte, zu der gesprungen werden kann: die Kennung für die Suche im Dokument und, solange sie das
// Ziel ist, die Hervorhebung `.focus-target` (wie ein Eintrag, index.css).
export type JumpProps = { 'data-jump': SectionId; className?: string }

// „Prüfen“ und „Beheben“ aus einer anderen Seite (#554): die Karte des Ziels hervorheben, ins Bild holen und den Fokus
// auf ihr Feld (`data-jump-focus`) oder ihre Überschrift setzen. `sections` sind die Karten dieser Seite; `ready`,
// sobald sie gezeichnet sein können. Ergibt die Angaben je Karte, `className` sind deren eigene Klassen.
export function useSectionJump(
  focus: JumpTarget | null | undefined,
  sections: readonly SectionId[],
  ready: boolean,
  done: (() => void) | undefined,
): (section: SectionId, className?: string) => JumpProps {
  const [active, setActive] = useState<{ section: SectionId; seq: number } | null>(null)
  const doneRef = useRef(done)
  doneRef.current = done
  const own = focus?.kind === 'section' && sections.includes(focus.section) ? focus.section : null
  useEffect(() => {
    if (!ready || own === null) return
    setActive((a) => ({ section: own, seq: (a?.seq ?? 0) + 1 }))
    doneRef.current?.()
  }, [focus, own, ready])
  // Nach dem Zeichnen, mit der Hervorhebung. jsdom kennt scrollIntoView nicht.
  useEffect(() => {
    if (!active) return
    const card = document.querySelector<HTMLElement>(`[data-jump="${active.section}"]`)
    if (!card) return
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const target = card.querySelector<HTMLElement>('[data-jump-focus]') ?? card.querySelector<HTMLElement>('h2, h3')
    if (!target) return
    // Eine Überschrift nimmt den Fokus nur mit tabindex, in der Tabulatorfolge steht sie damit nicht.
    if (!target.hasAttribute('tabindex') && !target.matches('input, select, textarea, button')) target.tabIndex = -1
    target.focus({ preventScroll: true })
  }, [active])
  return useCallback((section: SectionId, className?: string): JumpProps => {
    const classes = [className, active?.section === section ? 'focus-target' : null].filter(Boolean).join(' ')
    return { 'data-jump': section, ...(classes ? { className: classes } : {}) }
  }, [active])
}
