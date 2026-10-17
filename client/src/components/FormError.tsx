import { useCallback, useEffect, useRef, useState } from 'react'

// Eine Fehlermeldung beim Knopf, der sie ausgelöst hat (UI-Durchsicht H3). Vorher stand sie oft oben
// auf der Seite und lag beim Klick außerhalb des Bildes; es wirkte, als passiere nichts. Die Meldung
// trägt `role="alert"`, damit Bildschirmleser sie vorlesen, und rollt beim Setzen ins Bild, und zwar
// auch dann, wenn derselbe Text ein zweites Mal kommt (Zähler `seq`).
//
// Gebrauch: `const formError = useFormError()`, im Ablauf `formError.show(text)` bzw.
// `formError.clear()`, und im Formular direkt über oder neben dem Knopf `<FormError error={formError.error} />`.

export type FormErrorState = { text: string; seq: number }

export function useFormError() {
  const [error, setError] = useState<FormErrorState>({ text: '', seq: 0 })
  const show = useCallback((text: string) => setError((s) => ({ text, seq: s.seq + 1 })), [])
  const clear = useCallback(() => setError((s) => (s.text ? { text: '', seq: s.seq } : s)), [])
  return { error, show, clear }
}

export function FormError({ error }: { error: FormErrorState }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // jsdom kennt scrollIntoView nicht, daher die Frage nach der Methode.
    if (error.text) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error.text, error.seq])
  if (!error.text) return null
  return <div ref={ref} className="error form-error" role="alert">{error.text}</div>
}
