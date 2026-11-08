// Karte „Anmeldung“ in den Einstellungen (#528, Entwurf „Oberfläche“): sichtbar, wenn Mietfuchs im Netz erreichbar ist,
// ein Passwort hat oder im Übergang steht. Sie nennt den Zustand in Worten; geändert wird im Seitenfenster: Passwort
// ändern, auf allen Geräten abmelden, die Anmeldung ausschalten (mit Rückfrage), bei `off` oder im Übergang ein Passwort
// festlegen (mit Einrichtungscode, im Fenster ohne). Jede Änderung am Zugang verlangt das bisherige Passwort, außer im
// Programmfenster, das am Rechner selbst steht. Ist NKA_AUTH gesetzt, entscheidet die Umgebung über Ein und Aus; die
// Karte bietet dann kein Ausschalten und kein „Ohne Passwort weiter“ an.
import { useState } from 'react'
import { api, ApiError, errorText } from '../api'
import { useAccess, type AccessInfo } from '../access'
import {
  accessStateText, ENV_FIXED_NOTE, passwordProblems, setupErrorField, setupProblems, showsAccessCard, TRANSITION_NOTE,
  WITHOUT_PASSWORD_WARNING, type AccessField,
} from '../accessView'
import type { JumpProps } from '../focus'
import type { Problem } from '../formProblems'
import { CodeField, NewPasswordFields, type NewPassword } from './AccessFields'
import Card from './Card'
import Drawer from './Drawer'
import { useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import Field from './Field'

type Action = 'change' | 'setup' | 'logoutAll' | 'off'
type Form = { action: Action; current: string; code: string; next: NewPassword }

const TITLES: Record<Action, string> = {
  change: 'Passwort ändern',
  setup: 'Passwort festlegen',
  logoutAll: 'Auf allen Geräten abmelden',
  off: 'Anmeldung ausschalten',
}

const needsCurrent = (info: AccessInfo, action: Action): boolean => !info.window && action !== 'setup'

function problemsOf(info: AccessInfo, form: Form): Problem<AccessField>[] {
  if (form.action === 'setup') return setupProblems(info, form.code, form.next)
  const problems: Problem<AccessField>[] = []
  if (needsCurrent(info, form.action) && !form.current) problems.push({ field: 'current', short: 'fehlt', text: 'Bitte geben Sie Ihr bisheriges Passwort ein.' })
  if (form.action === 'change') problems.push(...passwordProblems(form.next.password, form.next.repeat, info.minLength))
  return problems
}

export default function AccessCard({ jump }: { jump?: JumpProps }) {
  const access = useAccess()
  const info = access?.info ?? null
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const errors = useFormError<AccessField>()
  const confirm = useConfirm()
  const toast = useToast()
  if (!access || !info || !showsAccessCard(info)) return null

  const open = (action: Action) => {
    errors.clear()
    setForm({ action, current: '', code: access.setupCode, next: { password: '', repeat: '' } })
  }
  const password = info.mode === 'password'
  const canSetUp = !(info.envFixed && info.mode === 'none') && (info.mode === 'off' || info.mode === 'transition' || info.mode === 'setup')

  async function run(body: Record<string, unknown>, path: string, method: string, done: string) {
    setBusy(true)
    try {
      await api(path, { method, body: JSON.stringify(body) })
    } catch (e) {
      setBusy(false)
      // 409: Der Zustand hat sich anderswo geändert; Fenster zu, neu lesen, der Satz als Mitteilung
      if (e instanceof ApiError && e.status === 409) {
        setForm(null)
        toast(e.message, 'info')
        await access?.reload()
        return
      }
      const field = setupErrorField(e)
      if (field) errors.report([{ field, text: errorText(e) }])
      else errors.show(errorText(e))
      return
    }
    setBusy(false)
    setForm(null)
    // Nach jeder Einrichtung gilt der Code aus der Adresse nicht mehr (der Server gibt einen neuen aus)
    if (path === '/api/auth/setup') access?.clearSetupCode()
    toast(done)
    await access?.reload()
  }

  async function submit(f: Form) {
    if (busy || !info) return
    const problems = problemsOf(info, f)
    if (problems.length) return errors.report(problems)
    const current = needsCurrent(info, f.action) ? { current: f.current } : {}
    if (f.action === 'change') return run({ ...current, password: f.next.password }, '/api/auth/password', 'PUT', 'Das Passwort ist geändert. Alle anderen Geräte sind abgemeldet.')
    if (f.action === 'logoutAll') return run(current, '/api/auth/logout-all', 'POST', 'Alle anderen Geräte sind abgemeldet.')
    if (f.action === 'setup') return run({ ...(info.window ? {} : { code: f.code }), password: f.next.password }, '/api/auth/setup', 'POST', 'Das Passwort ist festgelegt.')
    const ok = await confirm({ title: 'Anmeldung ausschalten?', message: WITHOUT_PASSWORD_WARNING, confirmLabel: 'Ausschalten', danger: true })
    if (ok) await run(current, '/api/auth/off', 'POST', 'Die Anmeldung ist ausgeschaltet.')
  }

  // Nur im Übergang: bewusst ohne Passwort, mit Code (bzw. im Fenster) und Rückfrage
  async function withoutPassword(f: Form) {
    if (busy || !info) return
    const problems = setupProblems(info, f.code, null)
    if (problems.length) return errors.report(problems)
    const ok = await confirm({ title: 'Ohne Passwort weiter?', message: WITHOUT_PASSWORD_WARNING, confirmLabel: 'Ohne Passwort weiter', danger: true })
    if (ok) await run({ ...(info.window ? {} : { code: f.code }), withoutPassword: true }, '/api/auth/setup', 'POST', 'Mietfuchs bleibt ohne Passwort.')
  }

  return (
    <Card title="Anmeldung" {...jump}>
      <p>{accessStateText(info)}</p>
      {info.mode === 'transition' && <p>{TRANSITION_NOTE}</p>}
      {info.envFixed && <p className="muted">{ENV_FIXED_NOTE}</p>}
      <div className="row">
        {canSetUp && <button type="button" className="btn" onClick={() => open('setup')}>Passwort festlegen</button>}
        {password && <button type="button" className="btn secondary" onClick={() => open('change')}>Passwort ändern</button>}
        {password && <button type="button" className="btn secondary" onClick={() => open('logoutAll')}>Auf allen Geräten abmelden</button>}
        {password && !info.envFixed && <button type="button" className="btn ghost danger-ghost ml-auto" onClick={() => open('off')}>Anmeldung ausschalten …</button>}
      </div>
      <Drawer open={form !== null} title={form ? TITLES[form.action] : ''} value={form} busy={busy} errors={errors}
        onClose={() => setForm(null)} onSubmit={() => { if (form) void submit(form) }}
        actions={form && (
          <>
            {form.action === 'setup' && info.mode === 'transition' && !info.envFixed && (
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void withoutPassword(form)}>Ohne Passwort weiter …</button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void submit(form)}>
              {form.action === 'off' ? 'Ausschalten' : form.action === 'logoutAll' ? 'Abmelden' : 'Speichern'}
            </button>
          </>
        )}>
        {form && (
          <>
            {form.action === 'logoutAll' && <p>Alle Geräte außer diesem müssen sich danach neu anmelden.</p>}
            {form.action === 'change' && <p>Alle anderen Geräte sind danach abgemeldet.</p>}
            {form.action === 'off' && <p>{`${WITHOUT_PASSWORD_WARNING} Wieder einschalten lässt sich die Anmeldung mit dem Einrichtungscode.`}</p>}
            {form.action === 'setup' && <p>Andere Geräte brauchen danach dieses Passwort.</p>}
            {form.action === 'setup' && info.mode === 'transition' && <p className="muted">{TRANSITION_NOTE}</p>}
            {needsCurrent(info, form.action) && (
              <Field label="Bisheriges Passwort" width="l" {...errors.field('current')}>
                <input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
              </Field>
            )}
            {form.action === 'setup' && !info.window && <CodeField value={form.code} onChange={(code) => setForm({ ...form, code })} info={info} errors={errors} />}
            {(form.action === 'change' || form.action === 'setup') && (
              <NewPasswordFields label={form.action === 'change' ? 'Neues Passwort' : 'Passwort'} repeatLabel={form.action === 'change' ? 'Neues Passwort wiederholen' : 'Passwort wiederholen'} value={form.next} onChange={(next) => setForm({ ...form, next })} minLength={info.minLength} errors={errors} />
            )}
          </>
        )}
      </Drawer>
    </Card>
  )
}
