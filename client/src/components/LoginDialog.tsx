// Anmelden (#528): das Formular der Anmeldeseite (pages/Anmeldung.tsx) und derselbe Inhalt als Dialog über der Seite,
// wenn mitten in der Arbeit die Sitzung abgelaufen ist (`mietfuchs:anmeldung` mit `login`, access.ts). Die Seite
// darunter bleibt eingehängt, ihre Eingaben stehen danach noch da; nach der Anmeldung geht der Fokus an den Auslöser
// zurück. Ein Fehler steht am Feld und in der Sammelmeldung (die ihn ansagt), der Fokus bleibt im Feld, damit man
// gleich neu tippen kann.
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from '../api'
import type { AccessInfo } from '../access'
import { waitText } from '../accessView'
import { focusBack } from './dialogKeys'
import { ErrorSummary, useFormError } from './ErrorSummary'
import Field from './Field'
import { ResetHelp } from './AccessFields'

export type LoginResult = { failedAttempts: number }

// `autoFocus` auf der Anmeldeseite; der Dialog setzt den Fokus selbst, die Musterseite gar nicht
// `onStale`: 409, der Zustand hat sich anderswo geändert (kein Passwort mehr, ausgeschaltet); die App liest ihn neu
export function LoginForm({ info, onSignedIn, onStale, autoFocus = false }: {
  info: AccessInfo | null
  onSignedIn: (result: LoginResult) => void
  onStale?: (message: string) => void
  autoFocus?: boolean
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const errors = useFormError<'password'>()
  const input = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!password) {
      errors.report([{ field: 'password', short: 'Passwort fehlt', text: 'Bitte geben Sie Ihr Passwort ein.' }], { focus: false })
      input.current?.focus()
      return
    }
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; failedAttempts?: number }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      errors.clear()
      onSignedIn({ failedAttempts: typeof r.failedAttempts === 'number' ? r.failedAttempts : 0 })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && onStale) {
        onStale(err.message)
        return
      }
      // Bei 429 nennt der Server die Wartezeit im Satz; fehlt er, aus `retryAfter`
      const retry = err instanceof ApiError && err.status === 429 && typeof err.data.retryAfter === 'number' ? err.data.retryAfter : null
      const text = err instanceof ApiError && err.status === 429 && !/erneut/.test(err.message) && retry !== null ? `${err.message} ${waitText(retry)}` : errorText(err)
      errors.report([{ field: 'password', short: text, text }], { focus: false })
      setPassword('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="text-left">
      <ErrorSummary errors={errors} />
      <Field label="Passwort" width="full" {...errors.field('password')}>
        <input ref={input} type="password" autoComplete="current-password" autoFocus={autoFocus} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="row mt-3 mb-3">
        <button type="submit" className="btn" disabled={busy}>{busy && <span className="spinner" />}Anmelden</button>
      </div>
      <ResetHelp runtime={info?.runtime ?? ''} />
    </form>
  )
}

// Der Dialog über der Seite. `opener` ist das Element, das beim Abruf den Fokus hatte; dorthin geht er nach der
// Anmeldung oder beim Schließen zurück.
export default function LoginDialog({ info, opener, onSignedIn, onStale, onClose }: {
  info: AccessInfo | null
  opener: HTMLElement | null
  onSignedIn: (result: LoginResult) => void
  onStale: (message: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    if (!box.open) box.showModal()
    const focusField = () => box.querySelector<HTMLInputElement>('input[type="password"]')?.focus()
    focusField()
    // Die Seite darunter meldet ihren gescheiterten Abruf gleich danach und setzt den Fokus auf ihre Sammelmeldung. Hinter
    // einem modalen Dialog lässt der Browser das nicht zu; wo doch (jsdom, alte Browser), holt der Dialog ihn zurück.
    const keep = (e: FocusEvent) => { if (e.target instanceof Node && !box.contains(e.target)) focusField() }
    document.addEventListener('focusin', keep)
    return () => {
      document.removeEventListener('focusin', keep)
      if (box.open) box.close()
      focusBack(opener)
    }
  }, [opener])
  return (
    // Gestaltet wie die Rückfrage (dialog.confirm mit .dialog darin), aber als Dialog mit Formular, nicht als Alarm
    <dialog ref={ref} role="dialog" aria-labelledby={titleId} className="confirm no-print"
      onCancel={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose() } }}>
      <div className="dialog">
        <h2 id={titleId}>Bitte melden Sie sich wieder an</h2>
        <p className="dialog-msg">Ihre Anmeldung ist abgelaufen. Was Sie auf der Seite eingegeben haben, bleibt stehen; wiederholen Sie nach der Anmeldung den letzten Schritt.</p>
        <LoginForm info={info} onSignedIn={onSignedIn} onStale={onStale} />
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </dialog>
  )
}
