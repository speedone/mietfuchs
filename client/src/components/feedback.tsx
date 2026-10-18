import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { focusBack, topModalDialog } from './dialogKeys'

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
  const later = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      fn()
    }, ms)
    timers.current.add(timer)
  }, [])
  // Mitteilungen über einem offenen modalen Dialog (Rückfrage, Seitenfenster, Menüblatt; #346): Die Leiste
  // ist ein `popover="manual"` und wird bei jeder neuen Mitteilung neu gezeigt, damit sie im Top-Layer über
  // dem zuletzt geöffneten Dialog liegt; ein `z-index` reicht dort nicht hinauf. Ohne `showPopover`
  // (ältere Browser, jsdom) bleibt sie die feste Leiste.
  const toastRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = toastRef.current
    if (!el || typeof el.showPopover !== 'function') return
    if (el.matches(':popover-open')) el.hidePopover()
    if (toasts.length > 0) el.showPopover()
  }, [toasts])
  const toast = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = idRef.current++
    setToasts((t) => [...t, { id, msg, kind }])
    later(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
    // Angesagt wird sie dann aber nicht: Außerhalb des modalen Dialogs ist alles inert, auch die Leiste mit
    // ihrem `aria-live`. Deshalb steht dieselbe Mitteilung für Vorleser zusätzlich in einer eigenen, nur für
    // sie sichtbaren Ansage im obersten Dialog, solange einer offen ist (Durchsicht S7). Erst eingehängt,
    // dann befüllt: Eine Region, die mit ihrem Text erscheint, sagen manche Vorleser nicht an.
    const host = topModalDialog()
    if (!host) return
    const say = document.createElement('div')
    say.className = 'sr-only'
    say.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    host.append(say)
    later(() => { say.textContent = msg }, 100)
    later(() => say.remove(), 3200)
  }, [later])

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
    // Ausgehängt und aus der Navigation: an die aktuelle Seite (K-A aus #352), siehe dialogKeys.ts.
    focusBack(back)
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
  // mitschließt. Hat ein Element in der Rückfrage Esc schon für sich genommen (ein offener Begriff), bleibt
  // sie. Strg+S speichert nichts hinter der Rückfrage (#145). Kein Abfänger für Enter: Enter wirkt auf den
  // Knopf mit dem Fokus, das tut der Browser selbst (UI-Durchsicht H1, Wächter S13). Tab lenkt der Browser
  // (dialogKeys.ts).
  const onDialogKey = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') { if (e.defaultPrevented) return; e.preventDefault(); e.stopPropagation(); close(false) }
    else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); e.preventDefault() }
  }
  // Ein Klick daneben trifft den `<dialog>` selbst (seinen Hintergrund). Gezählt wird er nur, wenn er dort
  // auch begann: Wer Text in der Rückfrage markiert und die Maus daneben loslässt, bricht nichts ab.
  const downOnBackdrop = useRef(false)

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div ref={toastRef} className="toast-wrap no-print" aria-live="polite" popover="manual">
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
            // `close` kommt als eigene Aufgabe nach dem Schließen. Ist der Dialog bis dahin schon wieder offen
            // (eine neue Rückfrage gleich nach der alten, React hängt ihn nicht aus), gilt es der alten.
            onClose={(e) => { if (e.target === e.currentTarget && !e.currentTarget.open) close(false) }}
            onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
            onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) close(false) }}
          >
            <div className="dialog">
              <h2 id={titleId}>{dialog.title}</h2>
              {dialog.message && <div className="dialog-msg" id={messageId}>{typeof dialog.message === 'function' ? dialog.message(() => close(false)) : dialog.message}</div>}
              <div className="dialog-actions">
                <button ref={cancelRef} type="button" className="btn ghost" onClick={() => close(false)}>{dialog.cancelLabel ?? 'Abbrechen'}</button>
                {dialog.alternativeLabel && (
                  // Erst schließen, dann die Wahl ausführen: Öffnet sie selbst eine Rückfrage, beantwortete
                  // das spätere `close(false)` sonst die neue mit „nein“ (Durchsicht R1).
                  <button type="button" className="btn secondary" onClick={() => { const alternative = dialog.onAlternative; close(false); alternative?.() }}>{dialog.alternativeLabel}</button>
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
