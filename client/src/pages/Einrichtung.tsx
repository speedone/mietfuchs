// Die Einrichtung der Anmeldung (#528, Entwurf „Oberfläche“): Mietfuchs ist im Netz erreichbar und noch ohne Passwort.
// Mit dem Einrichtungscode (vom Rechner, auf dem Mietfuchs läuft) legt man das Passwort fest oder geht bewusst ohne
// weiter. Im Programmfenster gilt die Anfrage als „am Rechner selbst“, dort fehlt das Codefeld. Geprüft wird vorher in
// der Seite (accessView.ts): Ungleiche oder zu kurze Passwörter gehen nicht hinaus.
// Den Zweig `info.window` gibt es für den Fall, dass das Fenster die Seite je zeigt: Mit seinem Schlüssel ist es angemeldet
// und kommt sonst nicht hierher (es richtet über die Heimnetz-Karte ein).
import { useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from '../api'
import type { AccessInfo } from '../access'
import { setupErrorField, setupProblems, WITHOUT_PASSWORD_WARNING, type AccessField } from '../accessView'
import { CodeField, NewPasswordFields, type NewPassword } from '../components/AccessFields'
import { ErrorSummary, useFormError } from '../components/ErrorSummary'
import { useConfirm, useToast } from '../components/feedback'
import FoxLogo from '../components/Logo'

export default function Einrichtung({ info, code: initialCode, onDone }: { info: AccessInfo; code: string; onDone: () => void }) {
  const [code, setCode] = useState(initialCode)
  const [value, setValue] = useState<NewPassword>({ password: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const errors = useFormError<AccessField>()
  const confirm = useConfirm()
  const toast = useToast()

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    try {
      await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ ...(info.window ? {} : { code }), ...body }) })
      onDone()
    } catch (e) {
      // 409: inzwischen anderswo festgelegt; dann gilt der neue Zustand, der Satz steht als Mitteilung
      if (e instanceof ApiError && e.status === 409) {
        toast(e.message, 'info')
        onDone()
        return
      }
      const field = setupErrorField(e)
      if (field) errors.report([{ field, text: errorText(e) }])
      else errors.show(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const problems = setupProblems(info, code, value)
    if (problems.length) return errors.report(problems)
    await send({ password: value.password })
  }

  async function withoutPassword() {
    if (busy) return
    const problems = setupProblems(info, code, null)
    if (problems.length) return errors.report(problems)
    const ok = await confirm({
      title: 'Ohne Passwort weiter?',
      message: `${WITHOUT_PASSWORD_WARNING} Ein Passwort können Sie später in den Einstellungen unter „Anmeldung“ festlegen.`,
      confirmLabel: 'Ohne Passwort weiter',
      danger: true,
    })
    if (ok) await send({ withoutPassword: true })
  }

  return (
    <main className="stopped">
      <div className="card text-left">
        <div className="flex items-center gap-3 mb-4">
          <FoxLogo size={40} />
          <h1 className="m-0">Mietfuchs einrichten</h1>
        </div>
        <p>Mietfuchs ist von anderen Geräten in Ihrem Netz erreichbar. Legen Sie ein Passwort fest, damit nur Sie Ihre Daten sehen.</p>
        {/* `stack` gibt den Feldern denselben Abstand wie in jeder Karte; die beiden Wege stehen in einer Zeile,
            der Hauptweg vorn (UI-Durchsicht 0.17.0) */}
        <form noValidate onSubmit={(e) => void submit(e)} className="stack">
          <ErrorSummary errors={errors} />
          {!info.window && <CodeField value={code} onChange={setCode} info={info} errors={errors} width="full" />}
          <NewPasswordFields value={value} onChange={setValue} minLength={info.minLength} errors={errors} width="full" />
          <div className="row center justify-between pt-2">
            <button type="submit" className="btn" disabled={busy}>{busy && <span className="spinner" />}Passwort festlegen</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void withoutPassword()}>Ohne Passwort weiter …</button>
          </div>
        </form>
      </div>
    </main>
  )
}
