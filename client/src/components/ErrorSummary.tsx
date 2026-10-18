import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Problem } from '../formProblems'

// Die eine Fehler-API der Formulare (#346, Schritt 3; Spezifikation Abschnitt 3 „Fehler: am Feld und als
// Sammelmeldung“, nach GOV.UK). Sie löst `FormError` aus #343 ab, der nur eine Meldung beim Knopf kannte.
//
//   const errors = useFormError<'date' | 'amount'>()
//   errors.report(problems)          // nach der Prüfung, alle Angaben auf einmal
//   errors.show(errorText(e))        // eine Meldung ohne Feld, etwa die Ablehnung durch den Server
//   <Field label="Datum" {...errors.field('date')}><input … /></Field>
//   <ErrorSummary errors={errors} />  // im Seitenfenster stattdessen die Prop `errors` am Drawer, im Fuß
//
// Jede Meldung steht am Feld (kurz) und in der Sammelmeldung „Bitte prüfen Sie N Angaben“ (mit Ort, als
// Link auf das Feld). Jedes neue Melden setzt den Fokus auf die Sammelmeldung und rollt sie ins Bild, auch
// beim selben Text ein zweites Mal (Zähler `seq`). Ändert der Nutzer ein Feld, verschwindet dessen Meldung
// an beiden Stellen (`onFix` aus `field()`, das `<Field>` beim Ändern aufruft).
// `focus`: ob dieses Melden den Fokus auf die Sammelmeldung setzt. Nach einer Handlung des Nutzers ja (Absenden),
// bei einem Fehler beim Laden nicht, denn der nähme ihm den Fokus mitten in einer anderen Eingabe weg.
export type FormErrorState<F extends string = string> = { problems: readonly Problem<F>[]; seq: number; focus: boolean }

export type FormErrors<F extends string = string> = {
  state: FormErrorState<F>
  /** Eine Meldung, mit Feld am Feld und in der Sammelmeldung, ohne Feld nur dort. */
  show: (text: string, field?: F) => void
  /** Alle Angaben einer Prüfung auf einmal; `focus: false` etwa für einen Fehler beim Laden. */
  report: (problems: readonly Problem<F>[], options?: { focus?: boolean }) => void
  /** Eine Meldung ohne Feld setzen, ein leerer Text nimmt alle weg (wie früher `setError`). */
  set: (text: string, options?: { focus?: boolean }) => void
  clear: () => void
  /** Nimmt die Meldungen zu diesem Feld weg (der Nutzer hat es geändert). */
  clearField: (field: F) => void
  /** Die `id` des Eingabefelds; auf sie zeigt der Link in der Sammelmeldung. */
  idFor: (field: F) => string
  /** Die Angaben für `<Field>`: `id`, die kurze Meldung und `onFix`. */
  field: (field: F) => { id: string; error?: string; onFix: () => void }
}

export function useFormError<F extends string = string>(): FormErrors<F> {
  const [state, setState] = useState<FormErrorState<F>>({ problems: [], seq: 0, focus: true })
  const base = useId()
  const report = useCallback((problems: readonly Problem<F>[], options?: { focus?: boolean }) => setState((s) => ({ problems: [...problems], seq: s.seq + 1, focus: options?.focus ?? true })), [])
  const show = useCallback((text: string, field?: F) => report([field ? { field, text } : { text }]), [report])
  const clear = useCallback(() => setState((s) => (s.problems.length ? { ...s, problems: [] } : s)), [])
  const set = useCallback((text: string, options?: { focus?: boolean }) => (text ? report([{ text }], options) : clear()), [report, clear])
  const clearField = useCallback((field: F) => setState((s) => (
    s.problems.some((p) => p.field === field) ? { ...s, problems: s.problems.filter((p) => p.field !== field) } : s
  )), [])
  const idFor = useCallback((field: F) => `${base}-${field}`, [base])
  return useMemo(() => ({
    state,
    show,
    report,
    set,
    clear,
    clearField,
    idFor,
    field: (field: F) => {
      const p = state.problems.find((x) => x.field === field)
      return { id: idFor(field), ...(p ? { error: p.short ?? p.text } : {}), onFix: () => clearField(field) }
    },
  }), [state, show, report, set, clear, clearField, idFor])
}

// Der Titel nennt die Zahl der Angaben; „Angabe“ auch bei nur einer (GOV.UK zeigt die Sammelmeldung immer).
export const summaryTitle = (count: number) => `Bitte prüfen Sie ${count} ${count === 1 ? 'Angabe' : 'Angaben'}`

// Die Sammelmeldung. `role="alert"` sitzt innen, wie bei GOV.UK, weil JAWS es am äußeren Element mit dem
// Fokus doppelt oder gar nicht vorlas; das äußere Element nimmt den Fokus (`tabIndex={-1}`). In einer Karte
// steht sie oben in der Karte, im Seitenfenster übergibt man die API dem Fenster (Prop `errors`), und
// es zeigt sie im festen Fuß über den Knöpfen, damit sie nie aus dem Bild gerollt ist (UI-Durchsicht M5).
export function ErrorSummary<F extends string>({ errors, className }: { errors: FormErrors<F>; className?: string }) {
  const { problems, seq, focus } = errors.state
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (problems.length === 0 || !focus) return
    const box = ref.current
    // jsdom kennt scrollIntoView nicht, daher die Frage nach der Methode.
    box?.scrollIntoView?.({ block: 'nearest' })
    box?.focus({ preventScroll: true })
    // Nur ein neues Melden setzt den Fokus, nicht das Wegnehmen einer Zeile beim Ändern eines Felds.
  }, [seq])
  if (problems.length === 0) return null
  const withField = problems.filter((p) => p.field !== undefined)
  const general = problems.filter((p) => p.field === undefined)
  const goTo = (field: F) => {
    const el = document.getElementById(errors.idFor(field))
    // Steht das Feld in einem zugeklappten Bereich ("Weitere Angaben"), wird er aufgeklappt.
    for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus({ preventScroll: true })
  }
  return (
    <div ref={ref} tabIndex={-1} data-error-summary="" className={className ? `error ${className}` : 'error'} aria-labelledby={withField.length ? titleId : undefined}>
      <div role="alert">
        {withField.length > 0 && (
          <>
            <strong id={titleId} className="block">{summaryTitle(withField.length)}</strong>
            <ul className="mt-1 mb-0 pl-5">
              {withField.map((p) => (
                <li key={`${p.field}:${p.text}`}>
                  <a href={`#${errors.idFor(p.field as F)}`} className="text-red underline"
                    onClick={(e) => { e.preventDefault(); goTo(p.field as F) }}>
                    {p.text}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {general.map((p) => <p key={p.text} className={withField.length ? 'mt-2 mb-0' : 'm-0'}>{p.text}</p>)}
      </div>
    </div>
  )
}
