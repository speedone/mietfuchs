import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Ein Popover am Auslöser (#346, Schritt 5 und 6; Spezifikation Abschnitt 4 „Begriff und Monatsraster“), für
// das Monatsraster (MonthField.tsx) und die Begriffserklärung (Term.tsx). Nur diese beiden nehmen es (Wächter
// S12 in uiRules.test.ts).
//
// - `popover="auto"` im Top-Layer: Es schiebt nichts weg, liegt über Seitenfenster und Rückfrage, und der Browser
//   schließt es bei Esc und beim Klick daneben. Am Handy (bis 640 px) steht es als Blatt am unteren Rand
//   (Utility `anchored-pop` in tw.css), sonst unter dem Auslöser, so weit es ins Fenster passt.
// - Es hängt **nicht** im Auslöser, sondern im nächsten `<dialog>` um ihn (Seitenfenster, Rückfrage,
//   Menüblatt) bzw. in `body`, über ein Portal. Im Auslöser stünde es oft in einem `<label>`: Ein Knopf darin
//   wäre das erste bedienbare Element und nähme dem Feld die Beschriftung, ein Klick darin aktivierte das
//   Label, und solange es offen ist, gehörte sein Text zum Namen des Felds. Außerhalb des Dialogs wäre es
//   inert, denn `showModal()` sperrt alles außerhalb.
// - Den Fokus gibt der Baustein selbst zurück (im `toggle`-Ereignis), das tut der Browser nicht in jedem Fall:
//   Lag er beim Schließen im Popover (Esc, Auswahl, Klick auf den Auslöser), geht er an den Auslöser; hat der
//   Nutzer ihn woandershin gesetzt, bleibt er dort. Tab am Ende (Umschalt+Tab am Anfang) schließt und geht an
//   den Auslöser zurück, statt hinter das Ende des Dialogs zu springen, wo das Popover im Dokument steht.
// - Esc im Popover verhindert der Baustein und schließt nur das Popover; ein Seitenfenster darum bleibt offen
//   (Drawer.tsx sieht `defaultPrevented` bzw. ein offenes Popover).
// - Ohne `showPopover` (Safari vor 17, Firefox vor 125) steht dasselbe Element ohne Top-Layer fest am selben
//   Ort und wird über `hidden` gezeigt; Esc und Klick daneben schließen es dann über eigene Horcher.

const SUPPORTED = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'
const SHEET_QUERY = '(max-width: 640px)'
const GAP = 4
const EDGE = 8

const FOCUSABLE = ['button:not([disabled])', 'a[href]', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]']
  .map((s) => `${s}:not([tabindex="-1"])`).join(', ')

export type Popover = {
  open: boolean
  id: string
  /** Öffnet das Popover; vorher läuft `beforeOpen`, danach `onOpen` mit dem Element (etwa für den Fokus). */
  show: () => void
  hide: () => void
  /** An den Auslöser: Ref, Zeiger- und Klickbehandlung, `aria-expanded`, `aria-controls`. */
  trigger: {
    ref: (el: HTMLElement | null) => void
    onPointerDown: () => void
    onClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => void
    'aria-expanded': boolean
    'aria-controls': string
  }
  /** Das Popover selbst, im Portal; `children` ist sein Inhalt und steht nur im Dokument, solange es offen ist. */
  render: (props: { className: string; label?: string; labelledBy?: string; children: ReactNode }) => ReactNode
}

export function usePopover({ beforeOpen, onOpen }: { beforeOpen?: () => void; onOpen?: (el: HTMLElement) => void } = {}): Popover {
  const id = useId()
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  openRef.current = open
  const triggerRef = useRef<HTMLElement | null>(null)
  const popRef = useRef<HTMLElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const beforeOpenRef = useRef(beforeOpen)
  beforeOpenRef.current = beforeOpen
  // Der Auslöser kann umgehängt werden (Seitenfenster öffnet), deshalb wird der Ort bei jedem Ref gesucht.
  const triggerCallback = useCallback((el: HTMLElement | null) => {
    triggerRef.current = el
    if (el) setHost(el.closest('dialog') ?? document.body)
  }, [])

  const place = useCallback(() => {
    const trigger = triggerRef.current
    const pop = popRef.current
    if (!trigger || !pop) return
    if (typeof window.matchMedia === 'function' && window.matchMedia(SHEET_QUERY).matches) return
    const t = trigger.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const left = Math.max(EDGE, Math.min(t.left, window.innerWidth - w - EDGE))
    const below = t.bottom + GAP
    const top = below + h > window.innerHeight - EDGE && t.top - GAP - h >= EDGE ? t.top - GAP - h : below
    pop.style.setProperty('--pop-left', `${left}px`)
    pop.style.setProperty('--pop-top', `${Math.max(EDGE, top)}px`)
  }, [])

  const focusWasInside = useRef(false)
  const closed = useCallback(() => {
    setOpen(false)
    const active = document.activeElement
    if (focusWasInside.current || active === null || active === document.body) triggerRef.current?.focus()
    focusWasInside.current = false
  }, [])

  const hide = useCallback(() => {
    const pop = popRef.current
    if (!pop || !openRef.current) return
    if (SUPPORTED) {
      // `beforetoggle` und `toggle` erledigen den Rest, auch wenn der Browser selbst schließt.
      if (pop.matches(':popover-open')) pop.hidePopover()
      return
    }
    focusWasInside.current = pop.contains(document.activeElement)
    closed()
  }, [closed])

  const show = useCallback(() => {
    const pop = popRef.current
    if (!pop || openRef.current) return
    beforeOpenRef.current?.()
    if (SUPPORTED && !pop.matches(':popover-open')) pop.showPopover()
    setOpen(true)
  }, [])

  // Der Browser schließt `auto` von selbst (Esc, Klick daneben, ein anderes Popover); der Zustand folgt.
  useEffect(() => {
    const pop = popRef.current
    if (!SUPPORTED || !pop) return
    const before = (e: Event) => {
      if ((e as Event & { newState?: string }).newState === 'closed') focusWasInside.current = pop.contains(document.activeElement)
    }
    const toggle = (e: Event) => {
      if ((e as Event & { newState?: string }).newState === 'closed') closed()
    }
    pop.addEventListener('beforetoggle', before)
    pop.addEventListener('toggle', toggle)
    return () => {
      pop.removeEventListener('beforetoggle', before)
      pop.removeEventListener('toggle', toggle)
    }
  }, [host, closed])

  // Offen: an den Auslöser setzen (auch beim Scrollen und bei neuer Fenstergröße) und den Fokus hineingeben.
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!open || !pop) return
    place()
    onOpenRef.current?.(pop)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  // Ohne Popover im Browser: Klick daneben schließt.
  useEffect(() => {
    if (SUPPORTED || !open) return
    const down = (e: PointerEvent) => {
      const target = e.target as Node
      if (!popRef.current?.contains(target) && !triggerRef.current?.contains(target)) hide()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open, hide])

  // Ein Zeigerdruck auf den Auslöser schließt ein offenes `auto`-Popover schon, bevor der Klick ankommt (Klick
  // daneben); der Klick öffnete es sonst gleich wieder.
  const downWhileOpen = useRef(false)
  const trigger: Popover['trigger'] = {
    ref: triggerCallback,
    onPointerDown: () => { downWhileOpen.current = openRef.current },
    onClick: (e) => {
      // Im <label> öffnete ein Klick sonst zusätzlich das Feld (Aktivierung des Labels).
      e.preventDefault()
      e.stopPropagation()
      const wasOpen = downWhileOpen.current || openRef.current
      downWhileOpen.current = false
      if (wasOpen) hide()
      else show()
    },
    'aria-expanded': open,
    'aria-controls': id,
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      hide()
    } else if (e.key === 'Tab') {
      const pop = popRef.current
      if (!pop) return
      const list = [...pop.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = list[0] ?? pop
      const last = list[list.length - 1] ?? pop
      if ((!e.shiftKey && document.activeElement === last) || (e.shiftKey && (document.activeElement === first || document.activeElement === pop))) {
        e.preventDefault()
        hide()
      }
    }
  }
  // Verlässt der Fokus das Popover (nicht zum Auslöser), schließt es, ohne den Fokus zurückzuholen.
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && !popRef.current?.contains(next) && !triggerRef.current?.contains(next)) hide()
  }

  const render: Popover['render'] = ({ className, label, labelledBy, children }) => {
    if (!host) return null
    return createPortal(
      <span
        ref={(el) => { popRef.current = el }}
        id={id}
        role="dialog"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`anchored-pop ${className}`}
        {...(SUPPORTED ? { popover: 'auto' as const } : { hidden: !open })}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        {open ? children : null}
      </span>,
      host,
    )
  }

  return { open, id, show, hide, trigger, render }
}
