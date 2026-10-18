import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { keepTabInside } from './dialogKeys'

// Zentrale Rückmeldungs-Schicht: kurze Toasts (Speichern/Löschen bestätigt) und ein gestylter
// Bestätigungsdialog (`<dialog role="alertdialog">`) als Ersatz für das native confirm(). Beides wird über die Hooks useToast()
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

  // Die Rückfrage (#346, Schritt 1) ist ein `<dialog role="alertdialog">` mit `showModal()`: Sie liegt im
  // Top-Layer, auch über einem offenen Menüblatt oder Seitenfenster, und der Hintergrund ist inert.
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  // Die offene Rückfrage, damit sie genau einmal beantwortet wird, gleich auf welchem Weg sie schließt.
  const pending = useRef<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const messageId = useId()
  // Der Auslöser der Rückfrage bekommt den Fokus zurück, sonst landete er beim Schließen auf BODY
  // (UI-Durchsicht H1), und wer mit der Tastatur arbeitet, finge oben auf der Seite neu an. Das tut der
  // Baustein selbst: Der Browser gäbe ihn nur beim Schließen mit `close()` zurück, nicht beim Aushängen.
  const opener = useRef<HTMLElement | null>(null)
  const close = useCallback((v: boolean) => {
    const d = pending.current
    if (!d) return
    pending.current = null
    // Zuerst den Dialog schließen: Solange er modal offen ist, ist der Auslöser inert und nimmt keinen Fokus.
    const box = dialogRef.current
    if (box?.open) box.close()
    setDialog(null)
    d.resolve(v)
    const back = opener.current
    opener.current = null
    if (back?.isConnected) back.focus()
    // Kam die Rückfrage aus der Navigation (Kopf und untere Leiste am Handy, Menüblatt, Seitenleiste; #346
    // Schritt 9) und ist die inzwischen ausgehängt, weil das Fenster über 900 px breit wurde (oder umgekehrt),
    // geht der Fokus an die aktuelle Seite in der Navigation, die jetzt steht, statt auf BODY. `closest`
    // findet die Navigation auch am ausgehängten Knopf oder Auswahlfeld, denn ausgehängt wird der ganze Zweig.
    else if (back?.closest('.mobile-head, .bottom-bar, .sidebar')) {
      document.querySelector<HTMLElement>('nav [aria-current="page"], button.menu-toggle')?.focus()
    }
  }, [])
  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => {
      // Eine noch offene Rückfrage gilt als abgebrochen, statt nie beantwortet zu werden.
      const earlier = pending.current
      if (earlier) earlier.resolve(false)
      else opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const next = { ...opts, resolve }
      pending.current = next
      setDialog(next)
    }),
    [],
  )
  const startOnCancel = dialog?.defaultChoice === 'cancel' || (dialog?.danger === true && dialog.defaultChoice !== 'confirm')

  // Öffnen, sobald der Inhalt steht, und den Startfokus selbst setzen: React setzt `autoFocus` beim
  // Einhängen, solange der `<dialog>` noch geschlossen ist, und `showModal()` nähme dann den ersten Knopf.
  useLayoutEffect(() => {
    const box = dialogRef.current
    if (!dialog || !box) return
    if (!box.open) box.showModal()
    ;(startOnCancel ? cancelRef : confirmRef).current?.focus()
  }, [dialog, startOnCancel])

  // Esc bricht ab, über das Ereignis `cancel` des Browsers und schon am Tastendruck: Ein verhindertes
  // `keydown` löst kein `cancel` aus, und Chrome ließe ein zweites `cancel` ohne Nutzeraktion dazwischen
  // nicht mehr abbrechen. Angehalten wird, damit kein Horcher am Dokument (ein Seitenfenster darunter)
  // mitschließt. Strg+S speichert nichts hinter der Rückfrage (#145). Kein Abfänger für Enter: Enter wirkt
  // auf den Knopf mit dem Fokus, das tut der Browser selbst (UI-Durchsicht H1, Wächter S13).
  const onDialogKey = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false) }
    else if (e.key === 'Tab') keepTabInside(e, e.currentTarget)
    else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); e.preventDefault() }
  }
  // Ein Klick daneben trifft den `<dialog>` selbst (seinen Hintergrund). Gezählt wird er nur, wenn er dort
  // auch begann: Wer Text in der Rückfrage markiert und die Maus daneben loslässt, bricht nichts ab.
  const downOnBackdrop = useRef(false)

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
          <dialog
            ref={dialogRef}
            className="confirm no-print"
            role="alertdialog"
            aria-labelledby={titleId}
            aria-describedby={dialog.message ? messageId : undefined}
            onKeyDown={onDialogKey}
            // Nur Ereignisse dieses Dialogs; React reicht `cancel` und `close` eines verschachtelten weiter.
            onCancel={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); close(false) } }}
            onClose={(e) => { if (e.target === e.currentTarget) close(false) }}
            onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
            onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) close(false) }}
          >
            <div className="dialog">
              <h2 id={titleId}>{dialog.title}</h2>
              {dialog.message && <div className="dialog-msg" id={messageId}>{typeof dialog.message === 'function' ? dialog.message(() => close(false)) : dialog.message}</div>}
              <div className="dialog-actions">
                <button ref={cancelRef} type="button" className="btn ghost" onClick={() => close(false)}>{dialog.cancelLabel ?? 'Abbrechen'}</button>
                {dialog.alternativeLabel && (
                  <button type="button" className="btn secondary" onClick={() => { dialog.onAlternative?.(); close(false) }}>{dialog.alternativeLabel}</button>
                )}
                <button ref={confirmRef} type="button" className={`btn ${dialog.danger ? 'danger' : ''}`} onClick={() => close(true)}>
                  {dialog.confirmLabel ?? 'OK'}
                </button>
              </div>
            </div>
          </dialog>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}
