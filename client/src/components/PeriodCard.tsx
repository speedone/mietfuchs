import { useState } from 'react'
import type { PeriodChangePreview, Property } from '../types'
import { api, errorText, fmtEuro } from '../api'
import { useOpenForm, useProperty } from '../property'
import { useToast } from './feedback'
import Term from './Term'
import { answersOf, initialAnswers, MONTH_OPTIONS, nextRules, rhythmText, withoutChange, type AnswerForm, type RhythmForm } from '../periodForm'
import { rulesOf } from '../../../shared/period.ts'

// Die Karte „Abrechnungszeitraum“ in den Stammdaten (#208, Entwurf 3.6, 11.4). Jede Änderung geht
// über die Vorschau des Servers; gespeichert wird erst mit „Zeitraum wechseln“, in einer
// Transaktion. Wer im Kalenderjahr abrechnet, sieht hier eine Zeile und muss nichts tun.

export function RhythmFields({ form, onChange }: { form: RhythmForm; onChange: (next: RhythmForm) => void }) {
  return (
    <div className="row">
      <label className="field">
        Was möchten Sie ändern?
        <select value={form.mode} onChange={(e) => onChange({ ...form, mode: e.target.value === 'change' ? 'change' : 'start' })}>
          <option value="start">Beginnmonat von Anfang an</option>
          <option value="change">Wechsel ab einem Monat</option>
        </select>
      </label>
      {form.mode === 'start' ? (
        <label className="field">
          Abrechnungszeitraum beginnt im
          <select value={form.month} onChange={(e) => onChange({ ...form, month: Number(e.target.value) })}>
            {MONTH_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      ) : (
        <label className="field">
          Ab (Monat und Jahr)
          <input type="month" value={form.from} onChange={(e) => onChange({ ...form, from: e.target.value })} />
        </label>
      )}
    </div>
  )
}

export function PreviewAnswers({ preview, answers, onChange }: { preview: PeriodChangePreview; answers: AnswerForm; onChange: (next: AnswerForm) => void }) {
  return (
    <>
      {preview.groups.map((g) => (
        <label key={g.from} className="field">
          Zeitraum für {g.items.map((i) => `„${i.description}“`).join(', ')} (bisher {g.fromLabel})
          <select value={answers.groups[g.from] ?? g.suggested} onChange={(e) => onChange({ ...answers, groups: { ...answers.groups, [g.from]: e.target.value } })}>
            {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {preview.overrides.map((o) => (
        <fieldset key={o.tenancyId} className="field">
          <legend>
            {o.tenantName}: <Term id="prepayment">tatsächlich gezahlte Vorauszahlungen</Term> neu erfassen
            (bisher {o.from.map((f) => `${fmtEuro(f.cents)} für ${f.label}`).join(', ')})
          </legend>
          {o.ask.map((a) => {
            const entry = answers.overrides[o.tenancyId]?.[a.period] ?? { amount: '', none: false }
            const set = (next: { amount: string; none: boolean }) =>
              onChange({ ...answers, overrides: { ...answers.overrides, [o.tenancyId]: { ...(answers.overrides[o.tenancyId] ?? {}), [a.period]: next } } })
            return (
              <div key={a.period} className="row">
                <label className="field">
                  tatsächlich gezahlt {a.months} ({a.label}) €
                  <input value={entry.amount} disabled={entry.none} inputMode="decimal" onChange={(e) => set({ ...entry, amount: e.target.value })} />
                </label>
                <label className="field checkline">
                  <input type="checkbox" checked={entry.none} onChange={(e) => set({ ...entry, none: e.target.checked })} />
                  <span>keine Korrektur (die Staffel gilt)</span>
                </label>
              </div>
            )
          })}
        </fieldset>
      ))}
    </>
  )
}

export default function PeriodCard() {
  const { property, reload } = useProperty()
  const toast = useToast()
  const [form, setForm] = useState<RhythmForm>({ mode: 'start', month: 1, from: '' })
  const [preview, setPreview] = useState<PeriodChangePreview | null>(null)
  const [answers, setAnswers] = useState<AnswerForm | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Eine offene Vorschau gehört zu diesem Objekt (#145); ein Wechsel des Objekts fragt dann.
  useOpenForm(preview !== null)
  if (!property) return null
  const rules = rulesOf(property)

  async function ask(next: ReturnType<typeof nextRules>) {
    if (!property) return
    if ('error' in next) { setError(next.error); return }
    setError('')
    setBusy(true)
    try {
      const p = await api<PeriodChangePreview>(`/api/properties/${property.id}/period/preview`, { method: 'POST', body: JSON.stringify({ rules: next }) })
      setPreview(p)
      setAnswers(initialAnswers(p))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!property || !preview || !answers) return
    const given = answersOf(preview, answers)
    if ('error' in given) { setError(given.error); return }
    setBusy(true)
    try {
      await api<Property>(`/api/properties/${property.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: preview.rules, answers: given }) })
      setPreview(null)
      setAnswers(null)
      setError('')
      await reload()
      toast('Abrechnungszeitraum umgestellt.')
    } catch (e) {
      // 409: veraltete Vorschau oder fehlende Angaben; die Meldung sagt, was fehlt.
      setError(`${errorText(e)} Bitte prüfen Sie die Vorschau erneut.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2><Term id="billingPeriod">Abrechnungszeitraum</Term></h2>
      <p>{rhythmText(rules)}. <span className="muted">Januar heißt Kalenderjahr. Wählen Sie den Monat, mit dem Ihr Messdienst abrechnet.</span></p>
      {rules.changes.map((c) => (
        <button key={c} className="btn secondary" disabled={busy} onClick={() => void ask(withoutChange(rules, c))}>Wechsel ab {c} entfernen …</button>
      ))}
      <RhythmFields form={form} onChange={setForm} />
      <button className="btn secondary" disabled={busy} onClick={() => void ask(nextRules(rules, form))}>Vorschau</button>
      {error && <div className="error">{error}</div>}
      {preview && answers && (
        <div className="card inset">
          <h3>Nach dem Wechsel</h3>
          <p>{preview.periods.map((p) => (p.short ? `${p.label} (Rumpf)` : p.label)).join(' · ')}</p>
          {preview.newShort.length > 0 && (
            <div className="warn">
              <Term id="shortPeriod">Rumpfzeitraum</Term> {preview.newShort.map((p) => p.label).join(', ')}. Eine Verkürzung braucht einen sachlichen Grund,
              etwa die Angleichung an den Messdienst. Legt Ihr Mietvertrag den Zeitraum fest, braucht die Umstellung die Zustimmung der Mieter.
            </div>
          )}
          {preview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
          {preview.moves.map((m) => (
            <p key={m.costItemId}>„{m.description}“ ({fmtEuro(m.amountCents)}) wird nach Tagen aufgeteilt: {m.parts.map((p) => `${p.label}: ${fmtEuro(p.amountCents)}`).join(', ')}.</p>
          ))}
          {preview.assessments.map((a) => <p key={a.assessmentId} className="muted">Belegauswertung „{a.file}“: künftig {a.toLabel}.</p>)}
          <PreviewAnswers preview={preview} answers={answers} onChange={setAnswers} />
          <div className="row">
            <button className="btn" disabled={busy || preview.blocked.length > 0} onClick={() => void apply()}>Zeitraum wechseln</button>
            <button className="btn secondary" disabled={busy} onClick={() => { setPreview(null); setAnswers(null); setError('') }}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
