import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useOpenForm } from '../property'
import { sameDraft } from '../draft'
import { useConfirm } from './feedback'
import { focusBack } from './dialogKeys'
import { ErrorSummary, type FormErrors } from './ErrorSummary'
import { RequiredLegend, RequiredScope } from './Field'

type Props = {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  /** Schließt das Fenster; aufgerufen erst, wenn nichts geändert ist oder „Verwerfen“ bestätigt wurde. */
  onClose: () => void
  /**
   * Der Stand des Formulars, etwa das Formularobjekt. Daran erkennt das Fenster eine Änderung: Verglichen
   * wird mit dem Stand vor der ersten Eingabe im Fenster. Pflicht, damit kein Seitenfenster ohne
   * Rückfrage beim Schließen auskommt (#346, Schritt 2).
   */
  value: unknown
  /** Die Knöpfe im festen Fuß rechts neben „Abbrechen“, typischerweise „Anlegen“ bzw. „Speichern“. */
  actions?: ReactNode
  /** Beschriftung des Knopfs, der das Fenster schließt; vorgegeben „Abbrechen“. */
  cancelLabel?: string
  /** Solange etwas läuft (Speichern), schließt das Fenster auf keinem Weg. */
  busy?: boolean
  /** Hinweis auf die Tastenkürzel im Fuß, am Handy ausgeblendet (MOB4). */
  hint?: string
  children: ReactNode
  /** Wird bei Strg+S / Cmd+S ausgelöst, typischerweise das Speichern. */
  onSubmit?: () => void
  /** Breite in px, Standard 460. */
  width?: number
  /**
   * Die Fehler des Formulars aus `useFormError` (#346, Schritt 3). Die Sammelmeldung steht im festen Fuß über
   * den Knöpfen und ist damit immer sichtbar, auch wenn der Körper gescrollt ist (UI-Durchsicht M5).
   */
  errors?: FormErrors<any>
}

// Das Seitenfenster (#346, Schritt 2, Spezifikation Abschnitt 4): ein `<dialog>` mit `showModal()`, von
// rechts. Es liegt im Top-Layer, der Hintergrund ist inert, und die darunterliegende Liste bleibt sichtbar.
// Kopf mit Titel und ✕, scrollender Körper, fester Fuß mit „Abbrechen“ und den Knöpfen des Formulars.
//
// Schließen mit Änderungen (Esc, ✕, Klick daneben, „Abbrechen“) fragt „Änderungen verwerfen?“ mit dem
// Startfokus auf „Abbrechen“; ohne Änderung schließt es sofort. Geändert heißt: `value` weicht vom Stand
// vor der ersten Eingabe ab. Gemerkt wird dieser Stand erst bei der ersten Eingabe oder dem ersten Klick im
// Körper, nicht beim Öffnen: Ein Formular, das nach dem Öffnen noch Vorgaben nachlädt, gälte sonst als
// geändert. Nur ein geändertes Fenster meldet sich bei `useOpenForm` an; ein Wechsel von Seite, Objekt
// oder Zeitraum fragt bei einem unveränderten nicht nach.
//
// Zwei Pflichtregeln (Abschnitt 4): `cancel` und `close` zählen nur, wenn sie am Fenster selbst entstehen
// (`e.target === e.currentTarget`), denn React reicht die Ereignisse eines verschachtelten Dialogs weiter;
// und das erste Feld fokussiert das Fenster nach `showModal()` selbst. Den Fokus gibt es beim Schließen an
// den Auslöser zurück, denn ausgehängt wird es von der Seite, nicht mit `close()`.
// Ob im Fenster ein Popover offen ist. Ohne `:popover-open` (ältere Browser, jsdom) gibt es keines.
function hasOpenPopover(box: HTMLElement): boolean {
  return [...box.querySelectorAll('[popover]')].some((el) => {
    try {
      return el.matches(':popover-open')
    } catch {
      return false
    }
  })
}

export default function Drawer({ open, title, subtitle, onClose, value, actions, cancelLabel = 'Abbrechen', busy = false, hint = 'Strg+S speichert · Esc schließt', children, onSubmit, width = 460, errors }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Der Titel benennt den Dialog für Screenreader (#157).
  const titleId = useId()
  const confirm = useConfirm()
  // Die Pflichtfelder im Fenster melden sich an (#346, Schritt 3); steht eines darin, zeigt das Fenster die
  // Legende „* Pflichtangabe“ über den Feldern. Von selbst statt per Prop, damit kein Fenster sie vergisst.
  const [requiredCount, setRequiredCount] = useState(0)
  const register = useCallback(() => {
    setRequiredCount((n) => n + 1)
    return () => setRequiredCount((n) => n - 1)
  }, [])

  // Der Stand vor der ersten Eingabe, `null` bis dahin. Beim Schließen zurückgesetzt.
  const baseline = useRef<{ value: unknown } | null>(null)
  const current = useRef(value)
  current.current = value
  const dirty = open && baseline.current !== null && !sameDraft(value, baseline.current.value)
  // Ein geändertes Fenster ist ein offenes Formular: Seite, Objekt und Zeitraum fragen dann nach (#145, #356).
  useOpenForm(dirty)

  // Callbacks über Refs stabil halten, damit die Effects nicht bei jedem Render (Tastendruck)
  // neu laufen; sonst würde der Fokus ständig aufs erste Feld zurückspringen.
  const onCloseRef = useRef(onClose)
  const onSubmitRef = useRef(onSubmit)
  const busyRef = useRef(busy)
  onCloseRef.current = onClose
  onSubmitRef.current = onSubmit
  busyRef.current = busy

  const asking = useRef(false)
  const requestClose = useCallback(async () => {
    if (busyRef.current || asking.current) return
    const b = baseline.current
    if (b && !sameDraft(current.current, b.value)) {
      asking.current = true
      try {
        const discard = await confirm({
          title: 'Änderungen verwerfen?',
          message: 'Ihre Eingaben in diesem Fenster sind noch nicht gespeichert und gehen beim Schließen verloren.',
          confirmLabel: 'Verwerfen',
          cancelLabel: 'Abbrechen',
          danger: true,
        })
        if (!discard) return
      } finally {
        asking.current = false
      }
    }
    onCloseRef.current()
  }, [confirm])

  // Öffnen, Fokus aufs erste Feld, Scroll-Sperre; beim Schließen oder Aushängen Fokus zurück.
  const closingByUs = useRef(false)
  useLayoutEffect(() => {
    const box = dialogRef.current
    if (!open || !box) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closingByUs.current = false
    if (!box.open) box.showModal()
    // `showModal()` fokussiert das erste bedienbare Element, also ✕. Das erste Feld nimmt den Fokus jetzt
    // und, falls der Inhalt erst nachlädt, nach 60 ms noch einmal, aber nur, wenn er inzwischen nicht
    // woanders hingesetzt wurde (#346, Schritt 9).
    const auto = document.activeElement
    const focusFirst = () => bodyRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    focusFirst()
    const t = setTimeout(() => {
      const now = document.activeElement
      if (now === auto || now === null || now === document.body || now === box) focusFirst()
    }, 60)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      baseline.current = null
      closingByUs.current = true
      if (box.open) box.close()
      focusBack(opener)
    }
  }, [open])

  // Die erste Eingabe oder der erste Klick im Körper merkt den Stand davor. In der Einfangphase am
  // Fenster, also bevor React die Änderung verarbeitet (dessen Horcher sitzen an der Wurzel und laufen in
  // der Sprudelphase): `current` ist dann noch der gezeichnete Stand.
  useEffect(() => {
    const body = bodyRef.current
    if (!open || !body) return
    const mark = () => { if (!baseline.current) baseline.current = { value: current.current } }
    const kinds = ['input', 'change', 'click'] as const
    for (const k of kinds) body.addEventListener(k, mark, true)
    return () => { for (const k of kinds) body.removeEventListener(k, mark, true) }
  }, [open])

  // Esc fragt schon am Tastendruck und verhindert ihn: Ohne das schlösse Chrome das Fenster beim zweiten
  // Esc ohne Nutzeraktion dazwischen, ohne dass `cancel` sich noch abbrechen ließe. Esc gilt aber nicht dem
  // Fenster, wenn es zuerst etwas darin schließt (Durchsicht S5): ein Element, das Esc schon für sich
  // genommen hat (ein offener Begriff), ein offenes Popover im Fenster (das schließt der Browser) und eine
  // laufende Eingabe über ein Eingabesystem (IME). Ein geöffnetes natives Auswahlfeld gibt Esc gar nicht an
  // die Seite weiter. Strg+S speichert. Tab lenkt der Browser (dialogKeys.ts), Enter ebenso (Wächter S13).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented || e.nativeEvent.isComposing || hasOpenPopover(e.currentTarget)) return
      e.preventDefault()
      void requestClose()
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmitRef.current?.() }
  }

  // Ein Klick daneben trifft den `<dialog>` selbst, also seinen Hintergrund; gezählt wird er nur außerhalb
  // der Fläche (der Rand für die Kerbe gehört auch zum `<dialog>`) und nur, wenn er dort begann.
  const downOutside = useRef(false)
  const outside = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false
    const r = e.currentTarget.getBoundingClientRect()
    return !(r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
  }

  if (!open) return null
  return (
    <dialog
      ref={dialogRef}
      className="drawer no-print"
      style={{ width }}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); void requestClose() } }}
      // Hat der Browser das Fenster doch selbst geschlossen (eine Rückgeste, die sich nicht abbrechen
      // lässt), öffnet es mit Änderungen wieder und fragt; ohne Änderungen schließt es.
      onClose={(e) => {
        // Ein verspätetes `close` zählt nicht: Der Browser sendet es als eigene Aufgabe, und ist das Fenster bis
        // dahin wieder offen (StrictMode baut den Effekt einmal ab und wieder auf), gilt es dem alten Öffnen
        // (Durchsicht M1).
        if (e.target !== e.currentTarget || closingByUs.current || e.currentTarget.open) return
        const box = e.currentTarget
        const b = baseline.current
        if (b && !sameDraft(current.current, b.value)) { if (!box.open) box.showModal(); void requestClose() } else onCloseRef.current()
      }}
      onMouseDown={(e) => { downOutside.current = outside(e) }}
      onClick={(e) => { if (downOutside.current && outside(e)) void requestClose() }}
    >
      <header className="drawer-head">
        <div>
          <h2 className="drawer-title" id={titleId}>{title}</h2>
          {subtitle && <div className="drawer-sub">{subtitle}</div>}
        </div>
        <button type="button" className="drawer-x" onClick={() => void requestClose()} aria-label="Schließen" disabled={busy}>✕</button>
      </header>
      <div className="drawer-body" ref={bodyRef}>
        {requiredCount > 0 && <RequiredLegend />}
        <RequiredScope.Provider value={register}>{children}</RequiredScope.Provider>
      </div>
      <footer className="drawer-foot flex-wrap">
        {errors && <ErrorSummary errors={errors} className="basis-full m-0 summary-cap" />}
        <span className="drawer-hint">{hint}</span>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => void requestClose()} disabled={busy}>{cancelLabel}</button>
        {actions}
      </footer>
    </dialog>
  )
}
