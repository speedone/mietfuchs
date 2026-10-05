import { useState } from 'react'
import type { PeriodChangePreview, PeriodEffect, Property } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { useOpenForm, useProperty } from '../property'
import { useToast } from './feedback'
import Term from './Term'
import {
  answersAfterConflict, answersOf, changeLabel, conflictPreview, earliestOpenChange, initialAnswers, localToday, MONTH_OPTIONS, nextRules, periodChangedText, rhythmText, withoutChange,
  type AnswerForm, type RhythmForm,
} from '../periodForm'
import { rulesOf } from '../../../shared/period.ts'

// Die Karte „Abrechnungszeitraum“ in den Stammdaten (#208, Entwurf 3.6, 11.4). Jede Änderung geht
// über die Vorschau des Servers; gespeichert wird erst mit „Zeitraum wechseln“, in einer
// Transaktion. Wer im Kalenderjahr abrechnet, sieht hier eine Zeile und muss nichts tun.

export function RhythmFields({ form, onChange }: { form: RhythmForm; onChange: (next: RhythmForm) => void }) {
  return (
    <>
    <div className="row">
      <label className="field">
        Was möchten Sie ändern?
        <select value={form.mode} onChange={(e) => onChange({ ...form, mode: e.target.value === 'change' ? 'change' : 'start' })}>
          <option value="change">Wechsel ab einem Monat (frühere Zeiträume bleiben)</option>
          <option value="start">Beginnmonat von Anfang an (auch alle früheren Zeiträume)</option>
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
          Neuer Zeitraum beginnt ab (Monat/Jahr)
          <input type="month" placeholder="JJJJ-MM" value={form.from} onChange={(e) => onChange({ ...form, from: e.target.value })} />
          <span className="muted">Danach läuft jeder Zeitraum von diesem Monat bis zum Vormonat im Folgejahr; davor entsteht ein kürzerer Rumpfzeitraum.</span>
        </label>
      )}
    </div>
    {/* Laienprobe B4: „von Anfang an“ deutet die Vergangenheit um, auch schon verschickte Abrechnungen. */}
    {form.mode === 'start' && (
      <div className="warn">
        Das ändert auch alle früheren Abrechnungszeiträume, nicht nur künftige. Haben Sie eine Abrechnung davon schon verschickt,
        wählen Sie „Wechsel ab einem Monat“; sonst stimmen die Zahlen hier nicht mehr mit der verschickten Abrechnung überein.
      </div>
    )}
    </>
  )
}

// Laienprobe B3, B3a: Fristen und Ergebnisse der Abrechnungen, die die Änderung trifft und die schon
// begonnen haben, vorher und nachher. Abgelaufene Frist: rot, mit der Folge (§ 556 Abs. 3 S. 3 BGB)
// und dem Betrag. Auch die Vorschau der Heizung nutzt die Liste.
const balance = (cents: number): string => (cents >= 0 ? `Guthaben ${fmtEuro(cents)}` : `Nachzahlung ${fmtEuro(-cents)}`)

export function EffectsList({ effects, earliest }: { effects: PeriodEffect[]; earliest?: string }) {
  if (effects.length === 0) return null
  return (
    <div>
      <h4>Was sich an schon begonnenen Abrechnungen ändert</h4>
      {effects.map((e) => (
        <div key={e.label} className={e.passed ? 'error' : 'muted'}>
          <p>
            <strong>{e.label}</strong>: Abrechnung bis {fmtDate(e.deadline)} zustellen
            {e.passed ? ' – diese Frist ist schon abgelaufen.' : '.'}
            {e.replaces.length > 0 && ` Bisher: ${e.replaces.map((r) => `${r.label} (Frist ${fmtDate(r.deadline)})`).join(', ')}.`}
          </p>
          {e.tenants.length > 0 && (
            <ul>
              {e.tenants.map((t) => (
                <li key={t.tenantName}>
                  {t.tenantName}: {t.beforeCents === null ? '' : `vorher ${balance(t.beforeCents)}, `}nachher {balance(t.afterCents)}
                </li>
              ))}
            </ul>
          )}
          {e.passed && (
            <p>
              Aus einem Zeitraum mit abgelaufener Frist dürfen Sie keine Nachzahlung mehr verlangen (§ 556 Abs. 3 Satz 3 BGB)
              {e.lostClaimsCents > 0 ? `; hier wären das ${fmtEuro(e.lostClaimsCents)}` : ''}.
              {earliest && ` Damit keine abgelaufene Abrechnung entsteht, wechseln Sie frühestens ab ${changeLabel(earliest)}.`}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export function PreviewAnswers({ preview, answers, onChange }: { preview: PeriodChangePreview; answers: AnswerForm; onChange: (next: AnswerForm) => void }) {
  // Das Jahr der Zahlung einer Position einer Gruppe nur für den gewählten Zeitraum (I1).
  const groupOf = new Map(preview.groups.flatMap((g) => g.items.map((i) => [i.costItemId, g] as const)))
  const chosenOf = (g: PeriodChangePreview['groups'][number]): string => answers.groups[g.id] ?? g.suggested
  const shownTax = preview.taxYears.filter((t) => {
    const g = groupOf.get(t.costItemId)
    if (g === undefined) return true
    const chosen = chosenOf(g)
    return chosen === 'split' ? true : chosen === t.period
  })
  return (
    <>
      {preview.groups.map((g) => {
        const chosen = chosenOf(g)
        const target = g.options.find((o) => o.key === chosen)
        const total = g.items.reduce((sum, i) => sum + i.amountCents, 0)
        const short = target !== undefined && preview.periods.some((p) => p.key === target.key && p.short)
        return (
          <div key={g.id}>
            <label className="field">
              Zeitraum für {g.items.map((i) => `„${i.description}“`).join(', ')} (bisher {g.fromLabel})
              <select value={chosen} onChange={(e) => onChange({ ...answers, groups: { ...answers.groups, [g.id]: e.target.value } })}>
                {g.split !== null && <option value="split">Nach Tagen auf die neuen Zeiträume aufteilen (Vorgabe)</option>}
                {g.options.map((o) => <option key={o.key} value={o.key}>ganz nach {o.label}</option>)}
              </select>
            </label>
            {/* Laienprobe B2: was das Aufteilen ergibt, und was das Nicht-Aufteilen bedeutet. */}
            {g.split !== null && chosen === 'split' && (
              <p className="muted">
                Die Rechnungen gelten als Kosten von {g.split.range} und werden nach Tagen geteilt:{' '}
                {g.split.items.map((it) => {
                  const d = g.items.find((i) => i.costItemId === it.costItemId)?.description ?? ''
                  return `„${d}“ ${it.parts.map((p) => `${p.label}: ${fmtEuro(p.amountCents)}`).join(', ')}`
                }).join('; ')}.
              </p>
            )}
            {g.split !== null && chosen !== 'split' && (
              <div className="warn">
                {fmtEuro(total)} kommen ganz nach {target?.label ?? chosen}. Wählen Sie das nur, wenn die Rechnungen ausschließlich diesen Zeitraum betreffen;
                eine Jahresrechnung stünde sonst ganz in {target?.label ?? chosen}.
              </div>
            )}
            {g.heating && (
              <div className="warn">
                Heizkosten teilt Mietfuchs nicht nach Tagen, denn im Winter wird mehr verbraucht als im Sommer (BGH VIII ZR 156/11).
                {short
                  ? ` ${fmtEuro(total)} stehen danach ganz im Rumpfzeitraum ${target?.label ?? ''}. Ist das eine Rechnung über ein ganzes Jahr, zahlen die Mieter dort die Heizkosten eines Jahres gegen die Vorauszahlungen weniger Monate. Tragen Sie danach den Leistungszeitraum der Rechnung ein und lassen Sie sie zum Stichtag abgrenzen (Zählerstand oder Zwischenrechnung des Versorgers).`
                  : ' Wählen Sie den Zeitraum, in dem die Wärme verbraucht wurde.'}
              </div>
            )}
          </div>
        )
      })}
      {shownTax.map((t) => (
        <label key={t.key} className="field">
          Jahr der Zahlung (Steuer) für „{t.description}“ in {t.label}
          <select value={answers.taxYears[t.key] ?? String(t.suggested)} onChange={(e) => onChange({ ...answers, taxYears: { ...answers.taxYears, [t.key]: e.target.value } })}>
            {t.options.map((y) => <option key={y} value={String(y)}>{y}</option>)}
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

export default function PeriodCard({ onChanged }: { onChanged?: () => Promise<void> } = {}) {
  const { property, reload } = useProperty()
  const toast = useToast()
  // Laienprobe B4: Vorgabe ist der Wechsel ab dem laufenden Monat; frühere Zeiträume bleiben, wie sie sind.
  const [form, setForm] = useState<RhythmForm>({ mode: 'change', month: 1, from: localToday().slice(0, 7) })
  const [understood, setUnderstood] = useState(false)
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
      setUnderstood(false)
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
      const done = preview
      setPreview(null)
      setAnswers(null)
      setError('')
      await reload()
      await onChanged?.()
      // Laienprobe B7: was jetzt gilt und bis wann der Rumpf zugehen muss.
      toast(periodChangedText(done))
    } catch (e) {
      // 409: veraltete Vorschau oder fehlende Angaben. Die Antwort bringt die neue Vorschau mit
      // (Durchsicht von #226, M2); sie ersetzt die alte, die Antworten werden neu vorbelegt.
      const fresh = conflictPreview(e)
      if (fresh) {
        setPreview(fresh)
        setAnswers(answersAfterConflict(fresh, preview.token, answers))
      }
      setError(`${errorText(e)} Bitte prüfen Sie die Vorschau erneut.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2><Term id="billingPeriod">Abrechnungszeitraum</Term></h2>
      <p>
        {rhythmText(rules)}.{' '}
        <span className="muted">
          Wählen Sie einen anderen Beginn nur, wenn Ihr Mietvertrag oder Ihr Messdienst ihn vorgibt. Weicht nur die Heizung ab,
          stellen Sie das in der Karte „Heizung“ ein; der Zeitraum der übrigen Kosten bleibt dann, wie er ist.
        </span>
      </p>
      {rules.changes.map((c) => (
        <button key={c} className="btn secondary" disabled={busy} onClick={() => void ask(withoutChange(rules, c))}>Wechsel ab {changeLabel(c)} entfernen …</button>
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
          <EffectsList effects={preview.effects} earliest={earliestOpenChange(localToday())} />
          {preview.effects.some((e) => e.passed) && (
            <label className="field checkline">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>Ich habe verstanden, dass ich aus einem Zeitraum mit abgelaufener Frist keine Nachzahlung mehr verlangen kann.</span>
            </label>
          )}
          <div className="row">
            <button className="btn" disabled={busy || preview.blocked.length > 0 || (preview.effects.some((e) => e.passed) && !understood)} onClick={() => void apply()}>Zeitraum wechseln</button>
            <button className="btn secondary" disabled={busy} onClick={() => { setPreview(null); setAnswers(null); setError('') }}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
