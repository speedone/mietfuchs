import { useCallback, useEffect, useRef, useState } from 'react'

// Eine Fehlermeldung beim Knopf, der sie ausgelöst hat (UI-Durchsicht H3, #341). Vorher stand sie oft oben
// auf der Seite und lag beim Klick außerhalb des Bildes; es wirkte, als passiere nichts. Die Meldung
// trägt `role="alert"`, damit Bildschirmleser sie vorlesen, und rollt beim Setzen ins Bild, und zwar
// auch dann, wenn derselbe Text ein zweites Mal kommt (Zähler `seq`).
//
// Gebrauch: `const formError = useFormError<'date' | 'value'>()`, im Ablauf `formError.show(text, field)`
// bzw. `formError.clear()`, im Formular direkt über oder neben dem Knopf
// `<FormError error={formError.error} id={…} />`. Nennt `show` ein Feld, markiert die Seite es mit
// `aria-invalid` und `aria-describedby` auf dieselbe `id` und setzt den Fokus darauf (`invalidProps`,
// `useFocusOnError`); geändert wird die Markierung mit `clearField`, sobald der Nutzer das Feld ändert.

export type FormErrorState<F extends string = string> = { text: string; seq: number; field?: F }

export function useFormError<F extends string = string>() {
  const [error, setError] = useState<FormErrorState<F>>({ text: '', seq: 0 })
  const show = useCallback((text: string, field?: F) => setError((s) => ({ text, seq: s.seq + 1, ...(field ? { field } : {}) })), [])
  const clear = useCallback(() => setError((s) => (s.text ? { text: '', seq: s.seq } : s)), [])
  // Nimmt die Meldung weg, wenn sie dieses Feld betrifft (der Nutzer hat es geändert).
  const clearField = useCallback((field: F) => setError((s) => (s.text && s.field === field ? { text: '', seq: s.seq } : s)), [])
  return { error, show, clear, clearField }
}

// Die Angaben am Feld, das die Meldung betrifft; an jedem anderen Feld nichts.
export function invalidProps<F extends string>(error: FormErrorState<F>, field: F, id: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return error.text && error.field === field ? { 'aria-invalid': true, 'aria-describedby': id } : {}
}

// Setzt bei jeder neuen Meldung mit Feld den Fokus auf das Feld, das `refs` dafür nennt.
export function useFocusOnError<F extends string>(error: FormErrorState<F>, refs: Partial<Record<F, { current: HTMLElement | null }>>) {
  const latest = useRef(refs)
  latest.current = refs
  useEffect(() => {
    if (error.text && error.field) latest.current[error.field]?.current?.focus()
  }, [error.seq, error.text, error.field])
}

export function FormError<F extends string>({ error, id }: { error: FormErrorState<F>; id?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // jsdom kennt scrollIntoView nicht, daher die Frage nach der Methode.
    if (error.text) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error.text, error.seq])
  if (!error.text) return null
  return <div ref={ref} id={id} className="error form-error" role="alert">{error.text}</div>
}
