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
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  // Eine dritte Wahl neben Abbrechen und Bestätigen, etwa „Stattdessen … bearbeiten“. Sie schließt
  // die Rückfrage wie Abbrechen (das Versprechen liefert false) und ruft vorher `onAlternative`.
  alternativeLabel?: string
  onAlternative?: () => void
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
  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  )
  const close = useCallback((v: boolean) => {
    setDialog((d) => { d?.resolve(v); return null })
  }, [])

  useEffect(() => {
    if (!dialog) return
    // Am Fenster in der Einfangphase und ohne Weitergabe (#145): Ein Drawer darunter lauscht am
    // Dokument und schlösse sonst bei Esc mit, samt den Eingaben, die die Rückfrage gerade
    // schützen soll; Strg+S speicherte ihn hinter der Rückfrage.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false) }
      else if (e.key === 'Enter') { e.stopPropagation(); close(true) }
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
            <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
              <h2 id={titleId}>{dialog.title}</h2>
              {dialog.message && <div className="dialog-msg">{dialog.message}</div>}
              <div className="dialog-actions">
                <button className="btn ghost" onClick={() => close(false)}>{dialog.cancelLabel ?? 'Abbrechen'}</button>
                {dialog.alternativeLabel && (
                  <button className="btn secondary" onClick={() => { dialog.onAlternative?.(); close(false) }}>{dialog.alternativeLabel}</button>
                )}
                <button className={`btn ${dialog.danger ? 'danger' : ''}`} onClick={() => close(true)} autoFocus>
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
