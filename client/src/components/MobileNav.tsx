import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BOTTOM_TABS, bottomNav, tabLabel, type Tab } from '../nav'

// Die Navigation am Handy (#346, Schritt 9, Spezifikation Abschnitt 2). Unter 900 px Breite ersetzt
// sie die Seitenleiste, die dort als 477 px hoher Block über jeder Seite stand (MOB2):
//
// - ein angehefteter Kopf mit ☰, dem Seitentitel, darunter „Objekt · Zeitraum“, und ⇅,
// - ein Menüblatt als `<dialog>` mit `showModal()`, das von links kommt und genau das zeigt, was am
//   Rechner die Seitenleiste zeigt (App.tsx reicht denselben Inhalt herein, keine zweite Liste),
// - eine untere Leiste mit Cockpit, Erfassen, Zähler, Stammdaten und „Mehr“ (BOTTOM_TABS in nav.ts).
//
// ⇅ öffnet dasselbe Blatt, mit dem Fokus auf der Auswahl von Objekt bzw. Zeitraum: ein Ort für die
// Wahl, wie am Rechner (M13), und nicht ein zweites, kleines Blatt mit eigenen Regeln.
//
// Der modale `<dialog>` macht den Hintergrund inert, Esc schließt ihn. Zwei Regeln aus
// Abschnitt 4 gelten hier wie im Seitenfenster: Geschlossen wird bei einem Klick daneben nur, wenn
// das Ereignis am `<dialog>` selbst entsteht (`e.target === e.currentTarget`; der Inhalt füllt das
// Blatt ganz aus, ein Klick hinein trifft ihn), und den Fokus gibt der Baustein selbst an den
// Knopf zurück, der das Blatt geöffnet hat.

// Dieselbe Grenze wie in index.css; dort und hier steht derselbe Ausdruck.
export const MOBILE_QUERY = '(max-width: 899px)'

// Ob ein Media Query gilt, mit Nachführen bei Größenänderung. Am Handy wird die Seitenleiste gar
// nicht erst gezeichnet (und am Rechner Kopf und Leiste nicht): Sonst stünden die Einträge doppelt
// im Baum, für Tests wie für Programme, die CSS nicht auswerten.
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const apply = () => setMatches(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [query])
  return matches
}

type Opened = 'menu' | 'context'

export default function MobileNav({ tab, context, onNavigate, sheet }: {
  tab: Tab
  // „Lindenweg 12 · 2025“: Objekt und Zeitraum, nur angezeigt
  context: string
  onNavigate: (tab: Tab) => void
  // Der Inhalt des Blatts; `close` schließt es (vor einem Seitenwechsel, einem Wechsel von Objekt
  // oder Zeitraum und vor jeder Rückfrage, denn die stünde sonst hinter dem modalen Blatt).
  sheet: (close: () => void) => ReactNode
}) {
  const sheetId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const isOpen = useRef(false)

  const open = (from: HTMLElement, what: Opened) => {
    opener.current = from
    isOpen.current = true
    setOpened(what)
  }

  // Nach dem Zeichnen des Inhalts öffnen, damit `showModal()` ihn schon vorfindet.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!opened || !dialog) return
    if (!dialog.open) dialog.showModal()
    if (opened === 'context') {
      // Das erste Auswahlfeld: das Objekt ab zwei Objekten, sonst der Zeitraum
      dialog.querySelector<HTMLElement>('.year-switcher select')?.focus()
    }
  }, [opened])

  // Schließen auf jedem Weg (Auswahl, ✕, Esc, Klick daneben), einmal. Der Fokus geht sofort und nicht
  // erst im Ereignis `close` zurück: Das kommt später, und eine Rückfrage, die gleich danach den
  // Fokus nimmt, verlöre ihn sonst wieder.
  const finish = useCallback(() => {
    if (!isOpen.current) return
    isOpen.current = false
    setOpened(null)
    const back = opener.current
    if (back?.isConnected) back.focus()
  }, [])
  const close = useCallback(() => {
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    finish()
  }, [finish])

  const items = bottomNav()
  // Der aktive Eintrag in Indigo auf getönter Fläche, wie in der Seitenleiste
  const ACTIVE = 'text-accent-strong font-strong'
  const IDLE = 'text-sidebar-text font-medium'
  const ICON = 'grid h-6 w-12 place-items-center rounded-full text-base leading-none'
  const BTN = 'flex min-w-0 flex-col items-center justify-center gap-0.5 text-xs'
  const elsewhere = !BOTTOM_TABS.includes(tab)
  return (
    <>
      <header className="mobile-head no-print sticky top-0 z-30 flex items-center gap-1 border-b border-line bg-sidebar">
        <button type="button" className="menu-toggle size-11 inline-flex shrink-0 items-center justify-center rounded-m text-xl leading-none text-text hover:bg-hover" aria-label="Menü" aria-haspopup="dialog" aria-expanded={opened !== null} aria-controls={sheetId}
          onClick={(e) => open(e.currentTarget, 'menu')}>☰</button>
        <div className="min-w-0 flex-1 leading-snug">
          <div className="truncate text-base font-strong text-text">{tabLabel(tab)}</div>
          <div className="truncate text-xs text-muted" data-testid="mobile-context">{context}</div>
        </div>
        <button type="button" className="context-toggle size-11 inline-flex shrink-0 items-center justify-center rounded-m text-xl leading-none text-text hover:bg-hover" aria-label={`Objekt und Zeitraum wechseln, jetzt ${context}`} aria-haspopup="dialog" aria-expanded={opened === 'context'} aria-controls={sheetId}
          onClick={(e) => open(e.currentTarget, 'context')}>⇅</button>
      </header>

      <dialog
        ref={dialogRef}
        id={sheetId}
        className="menu-sheet no-print"
        aria-label="Menü"
        onClose={(e) => { if (e.target === e.currentTarget) finish() }}
        onCancel={(e) => { if (e.target === e.currentTarget) finish() }}
        onClick={(e) => { if (e.target === e.currentTarget) close() }}
        // Esc gehört dem Blatt: Ohne das Anhalten erreichte es auch den Horcher eines offenen
        // Seitenfensters am Dokument (Drawer.tsx) und schlösse das Formular darunter mit.
        onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }}
      >
        {opened && sheet(close)}
      </dialog>

      <nav className="bottom-bar no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-sidebar" aria-label="Schnellzugriff">
        {items.map((it) => (
          <button key={it.id} type="button" className={`${BTN} ${tab === it.id ? ACTIVE : IDLE}`} aria-current={tab === it.id ? 'page' : undefined}
            onClick={() => onNavigate(it.id)}>
            <span className={`${ICON} ${tab === it.id ? 'bg-accent-soft' : ''}`} aria-hidden="true">{it.icon}</span>
            <span className="max-w-full truncate">{it.short ?? it.label}</span>
          </button>
        ))}
        <button type="button" className={`${BTN} ${elsewhere ? ACTIVE : IDLE}`} aria-haspopup="dialog" aria-expanded={opened !== null} aria-controls={sheetId}
          onClick={(e) => open(e.currentTarget, 'menu')}>
          <span className={`${ICON} ${elsewhere ? 'bg-accent-soft' : ''}`} aria-hidden="true">⋯</span>
          <span className="max-w-full truncate">Mehr</span>
        </button>
      </nav>
    </>
  )
}
