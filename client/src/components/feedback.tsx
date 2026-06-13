import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

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
}
const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(1)
  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = idRef.current++
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
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
            <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <h2>{dialog.title}</h2>
              {dialog.message && <div className="dialog-msg">{dialog.message}</div>}
              <div className="dialog-actions">
                <button className="btn ghost" onClick={() => close(false)}>{dialog.cancelLabel ?? 'Abbrechen'}</button>
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
