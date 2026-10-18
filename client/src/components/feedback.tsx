import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

// Zentrale Rückmeldungs-Schicht: kurze Toasts (Speichern/Löschen bestätigt) und ein gestylter
// Bestätigungsdialog als Ersatz für das native confirm(). Beides wird über die Hooks useToast()
// und useConfirm() in den Seiten genutzt.

type ToastKind = 'ok' | 'error' | 'info'
type ToastItem = { id: number; msg: string; kind: ToastKind }
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

type ConfirmOpts = {
  title: string
  // Als Funktion bekommt die Nachricht `dismiss`, das die Rückfrage wie Abbrechen schließt; so kann ein
  // Knopf darin (etwa „Hier beheben →“, #319) wegführen, ohne dass die Rückfrage darüber stehen bleibt.
  message?: ReactNode | ((dismiss: () => void) => ReactNode)
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  // Eine dritte Wahl neben Abbrechen und Bestätigen, etwa „Stattdessen … bearbeiten“. Sie schließt
  // die Rückfrage wie Abbrechen (das Versprechen liefert false) und ruft vorher `onAlternative`.
  alternativeLabel?: string
  onAlternative?: () => void
  // Welcher Knopf beim Öffnen den Fokus bekommt; Enter wirkt immer auf den Knopf mit dem Fokus. Vorgegeben
  // ist die Bestätigung, bei `danger` aber Abbrechen (UI-Durchsicht H1): Ein Enter aus Gewohnheit löscht
  // dann nichts. `cancel` macht Abbrechen auch sonst zur Vorgabe, etwa wenn keine der Möglichkeiten zu
  // bestätigen sicher ist (Rückfrage zur Schätzung, Heizung PR 7); `confirm` überstimmt `danger`.
  defaultChoice?: 'confirm' | 'cancel'
}
const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(1)
  // Der Name der Rückfrage für Bildschirmleser (Laienprobe, Kleinigkeit): Ohne ihn stand sie
  // namenlos im Barrierebaum, etwa „Rechnung aufteilen?“ über dem Kostenformular.
  const titleId = useId()
  // Laufende Zeitgeber der Toasts, damit sie beim Abbauen nicht mehr feuern: Ein Zeitgeber, der
  // nach dem Ende eines Komponententests läuft, trifft auf eine abgebaute Testumgebung
  // („window is not defined“) und lässt den ganzen Lauf scheitern, obwohl jeder Test grün war.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])
  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = idRef.current++
    setToasts((t) => [...t, { id, msg, kind }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 3200)
    timers.current.add(timer)
  }, [])

  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Der Auslöser der Rückfrage bekommt den Fokus zurück, sonst landete er beim Schließen auf BODY
  // (UI-Durchsicht H1), und wer mit der Tastatur arbeitet, finge oben auf der Seite neu an.
  const opener = useRef<HTMLElement | null>(null)
  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setDialog({ ...opts, resolve })
    }),
    [],
  )
  const close = useCallback((v: boolean) => {
    setDialog((d) => { d?.resolve(v); return null })
    const back = opener.current
    opener.current = null
    if (back?.isConnected) back.focus()
    // Kam die Rückfrage aus der Navigation am Handy (☰, ⇅, untere Leiste, #346 Schritt 9) und ist die
    // inzwischen ausgehängt, weil das Fenster über 900 px breit wurde (oder umgekehrt), geht der Fokus
    // an die aktuelle Seite in der Navigation, die jetzt steht, statt auf BODY.
    else if (back && back.matches('.menu-toggle, .context-toggle, .bottom-bar button, .sidebar button')) {
      document.querySelector<HTMLElement>('nav [aria-current="page"], button.menu-toggle')?.focus()
    }
  }, [])
  const startOnCancel = dialog?.defaultChoice === 'cancel' || (dialog?.danger === true && dialog.defaultChoice !== 'confirm')

  useEffect(() => {
    if (!dialog) return
    // Am Fenster in der Einfangphase und ohne Weitergabe (#145): Ein Drawer darunter lauscht am
    // Dokument und schlösse sonst bei Esc mit, samt den Eingaben, die die Rückfrage gerade
    // schützen soll; Strg+S speicherte ihn hinter der Rückfrage.
    // Enter wirkt auf den Knopf mit dem Fokus (UI-Durchsicht H1): Vorher bestätigte Enter immer, auch mit
    // dem Fokus auf „Abbrechen“. Ausgelöst wird hier selbst und nicht über den Browser, damit Enter nicht
    // zum Drawer darunter durchdringt. Tab bleibt im Dialog (Fokusfalle), vom letzten zum ersten Knopf.
    const onKey = (e: KeyboardEvent) => {
      const box = dialogRef.current
      if (e.key === 'Escape') { e.stopPropagation(); close(false) }
      else if (e.key === 'Enter') {
        // Nur ein Knopf der Rückfrage wird hier ausgelöst; ein anderes Element (etwa ein Begriff,
        // `span role="button"`) bekommt Enter selbst (Durchsicht K1 zu #341).
        const active = document.activeElement
        if (active instanceof HTMLButtonElement && box?.contains(active)) { e.stopPropagation(); e.preventDefault(); active.click() }
      } else if (e.key === 'Tab' && box) {
        e.stopPropagation()
        e.preventDefault()
        const focusable = [...box.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.hasAttribute('disabled'))
        if (focusable.length === 0) return
        const at = focusable.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : (at < 0 || at === focusable.length - 1 ? 0 : at + 1)
        focusable[next]?.focus()
      }
      else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog, close])

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div className="toast-wrap no-print" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              <span className="toast-ic">{t.kind === 'error' ? '⚠' : t.kind === 'info' ? 'ℹ' : '✓'}</span>
              {t.msg}
            </div>
          ))}
        </div>
        {dialog && (
          <div className="dialog-backdrop no-print" onMouseDown={() => close(false)}>
            <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
              <h2 id={titleId}>{dialog.title}</h2>
              {dialog.message && <div className="dialog-msg">{typeof dialog.message === 'function' ? dialog.message(() => close(false)) : dialog.message}</div>}
              <div className="dialog-actions">
                <button className="btn ghost" onClick={() => close(false)} autoFocus={startOnCancel}>{dialog.cancelLabel ?? 'Abbrechen'}</button>
                {dialog.alternativeLabel && (
                  <button className="btn secondary" onClick={() => { dialog.onAlternative?.(); close(false) }}>{dialog.alternativeLabel}</button>
                )}
                <button className={`btn ${dialog.danger ? 'danger' : ''}`} onClick={() => close(true)} autoFocus={!startOnCancel}>
                  {dialog.confirmLabel ?? 'OK'}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}
