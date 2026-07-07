import { useEffect, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  /** Inhalt des fest stehenden Fußbereichs (Aktionen). */
  footer?: ReactNode
  children: ReactNode
  /** Wird bei Strg+S / Cmd+S ausgelöst — typischerweise das Speichern. */
  onSubmit?: () => void
  /** Drawer-Breite in px, Standard 460. */
  width?: number
}

// Von rechts einschwebendes Panel zum Bearbeiten. Hält die darunterliegende Liste sichtbar,
// statt das Formular ans Seitenende zu hängen. Escape schließt, Strg+S speichert; beim Öffnen
// wird das erste Eingabefeld fokussiert und der Seiten-Scroll gesperrt.
export default function Drawer({ open, title, subtitle, onClose, footer, children, onSubmit, width = 460 }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // Callbacks über Refs stabil halten, damit die Effects nicht bei jedem Render (Tastendruck)
  // neu laufen — sonst würde der Fokus ständig aufs erste Feld zurückspringen.
  const onCloseRef = useRef(onClose)
  const onSubmitRef = useRef(onSubmit)
  onCloseRef.current = onClose
  onSubmitRef.current = onSubmit

  // Fokus aufs erste Feld + Scroll-Sperre — nur beim Öffnen, nicht bei jedem Render.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => bodyRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus(), 60)
    return () => {
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
    }
  }, [open])

  // Tastatur-Kürzel (Esc/Strg+S) — greifen über die Refs immer auf die aktuellen Callbacks zu.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmitRef.current?.() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="drawer-backdrop no-print" onMouseDown={onClose}>
      <aside
        className="drawer"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <div className="drawer-title">{title}</div>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button className="drawer-x" onClick={onClose} aria-label="Schließen">✕</button>
        </header>
        <div className="drawer-body" ref={bodyRef}>{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  )
}
