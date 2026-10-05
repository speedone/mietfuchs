import { useState } from 'react'
import type { HeatingPeriodChangePreview, HeatingPlant, PeriodRules, SeparatePreview } from '../types'
import { ApiError, api, errorText, fmtDate, fmtEuro } from '../api'
import { MONTH_OPTIONS } from '../periodForm'
import { hasOwnRhythm } from '../../../shared/heatingPeriod.ts'
import {
  PERIOD_CHOICE_OPTIONS, SEPARATE_OPTIONS, heatingPeriodAnswersOf, heatingPeriodForm, heatingPeriodSummary, heatingRulesBody, initialHeatingPeriodAnswers,
  heatingWays, initialSeparateAnswers, isCalendarObject, separateAnswersOf, suggestedWay, type HeatingPeriodAnswerForm, type HeatingPeriodForm, type PeriodChoice, type SeparateAnswerForm,
  type SeparateChoice,
} from '../heatingPeriodForm'

// Der Abschnitt „Zeitraum der Heizung“ einer Anlage in der Karte „Heizung“ (Heizung PR 5, Entwurf 11.2
// Schritt 3): Zeitraum wechseln mit Vorschau, getrennte Heizkostenabrechnung ein- und ausschalten mit
// Vorschau. Geschrieben wird erst mit „Übernehmen“; lehnt der Server ab (409), steht seine Meldung da
// und die neue Vorschau.
type Props = {
  plant: HeatingPlant
  objectRules: PeriodRules
  hasCalendarData: boolean
  onChanged: () => Promise<void>
  notify: (text: string) => void
}

// Bei 409 bringt der Server die neue Vorschau mit (veraltete Marke oder fehlende Angaben, wie beim
// Wechsel des Abrechnungszeitraums); sie ersetzt die alte, eingetragene Beträge bleiben stehen.
function freshPreview<T>(e: unknown): T | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const p = e.data.preview
  return p !== null && typeof p === 'object' ? p as T : null
}

export default function HeatingPeriodSection({ plant, objectRules, hasCalendarData, onChanged, notify }: Props) {
  const [open, setOpen] = useState<'none' | 'period' | 'separate'>('none')
  const [form, setForm] = useState<HeatingPeriodForm>(heatingPeriodForm(plant))
  const [periodPreview, setPeriodPreview] = useState<HeatingPeriodChangePreview | null>(null)
  const [periodAnswers, setPeriodAnswers] = useState<HeatingPeriodAnswerForm | null>(null)
  const [separatePreview, setSeparatePreview] = useState<SeparatePreview | null>(null)
  const [separateAnswers, setSeparateAnswers] = useState<SeparateAnswerForm | null>(null)
  const [month, setMonth] = useState('')
  const [error, setError] = useState('')
  const own = hasOwnRhythm(plant)
  const openSpan = plant.separateSpans.some((s) => s.until === null)
  const separateOn = openSpan || (!own && plant.separateSettlement === true)

  function close() {
    setOpen('none')
    setError('')
    setPeriodPreview(null)
    setSeparatePreview(null)
  }

  async function loadPeriodPreview() {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body) return setError(body.error)
    try {
      const p = await api<HeatingPeriodChangePreview>(`/api/heating-plants/${plant.id}/period/preview`, { method: 'POST', body: JSON.stringify(body) })
      setPeriodPreview(p)
      setPeriodAnswers(initialHeatingPeriodAnswers(p))
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function savePeriod() {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body || !periodPreview || !periodAnswers) return
    const answers = heatingPeriodAnswersOf(periodPreview, periodAnswers)
    if ('error' in answers) return setError(answers.error)
    try {
      await api(`/api/heating-plants/${plant.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: body.rules, answers }) })
    } catch (e) {
      const fresh = freshPreview<HeatingPeriodChangePreview>(e)
      if (fresh) {
        setPeriodPreview(fresh)
        setPeriodAnswers({ ...initialHeatingPeriodAnswers(fresh), amounts: periodAnswers.amounts, none: periodAnswers.none })
      }
      setError(fresh ? `${errorText(e)} Bitte prüfen Sie die Vorschau erneut.` : errorText(e))
      return
    }
    // Die Antwort auf die Frage nach der getrennten Abrechnung (Schritt 3): bei „ja“ und eigener
    // Heizperiode geht es mit der Vorschau zum Aufteilen weiter (Weg d), sonst wird sie gespeichert.
    close()
    await onChanged()
    notify('Zeitraum der Heizung gespeichert.')
    if (form.choice === 'own' && form.separate === 'yes' && !openSpan) setOpen('separate')
  }

  async function loadSeparatePreview() {
    const body = separateOn ? { separate: false, ...(month ? { until: month } : {}) } : { separate: true, ...(month ? { month } : {}) }
    try {
      const p = await api<SeparatePreview>(`/api/heating-plants/${plant.id}/separate/preview`, { method: 'POST', body: JSON.stringify(body) })
      setSeparatePreview(p)
      setSeparateAnswers(initialSeparateAnswers(p))
      setMonth(p.separate ? p.month ?? '' : p.until ?? p.month ?? '')
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveSeparate() {
    if (!separatePreview || !separateAnswers) return
    const answers = separateAnswersOf(separatePreview, separateAnswers)
    if ('error' in answers) return setError(answers.error)
    const body = separatePreview.separate
      ? { separate: true, month: separatePreview.month, answers }
      : { separate: false, ...(separatePreview.until ? { until: separatePreview.until } : { month: separatePreview.month }), answers }
    try {
      await api(`/api/heating-plants/${plant.id}/separate`, { method: 'PUT', body: JSON.stringify(body) })
    } catch (e) {
      const fresh = freshPreview<SeparatePreview>(e)
      if (fresh) {
        setSeparatePreview(fresh)
        setSeparateAnswers({ ...initialSeparateAnswers(fresh), amounts: separateAnswers.amounts, none: separateAnswers.none, merge: separateAnswers.merge })
      }
      setError(fresh ? `${errorText(e)} Bitte prüfen Sie die Vorschau erneut.` : errorText(e))
      return
    }
    close()
    await onChanged()
    notify(separatePreview.separate ? 'Getrennte Heizkostenabrechnung eingeschaltet.' : 'Getrennte Heizkostenabrechnung ausgeschaltet.')
  }

  const way = suggestedWay({ differs: form.choice === 'own', separate: form.separate, hasCalendarData })
  const ways = heatingWays({ objectCalendar: isCalendarObject(objectRules), separate: form.separate })
  const amount = (key: string) => separateAnswers?.amounts[key] ?? ''

  return (
    <div className="heating-period">
      <ul>{heatingPeriodSummary(plant, objectRules).map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="row">
        <button className="btn ghost" onClick={() => { setForm(heatingPeriodForm(plant)); setOpen('period') }}>Zeitraum der Heizung ändern</button>
        {(own || plant.separateSettlement === true) && (
          <button className="btn ghost" onClick={() => { setMonth(''); setOpen('separate') }}>
            {separateOn ? 'Getrennte Heizkostenabrechnung ausschalten' : own ? 'Getrennte Heizkostenabrechnung einschalten' : 'Vorauszahlung aufteilen'}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      {open === 'period' && (
        <div className="panel">
          <label className="field grow">
            Für welchen Zeitraum rechnet die Heizung ab?
            <select value={form.choice} onChange={(e) => setForm({ ...form, choice: e.target.value as PeriodChoice })}>
              {PERIOD_CHOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {/* Der Satz steht außerhalb des label, sonst gehörte er zum Namen des Auswahlfelds. */}
          <small className="muted">Woran erkenne ich das? Am Zeitraum auf der Abrechnung Ihres Messdienstes, etwa „01.05.2025–30.04.2026“.</small>
          {form.choice === 'own' && (
            <>
              {/* Die drei Wege (Nutzerwunsch zu Schritt 3): jeder mit Vor- und Nachteilen, Weg 1 als Vorgabe. */}
              <div className="heating-ways">
                <p>Rechnet Ihr Messdienst in einem anderen Zeitraum ab als Ihre Betriebskosten, gibt es drei Wege:</p>
                <ol>
                  {ways.map((w) => (
                    <li key={w.id}>
                      <strong>{w.title}</strong>{w.recommended && <> <span className="badge">Vorgabe</span></>}
                      <div className="muted">{w.how}</div>
                      <div>Vorteile: {w.pros.join(' ')}</div>
                      <div>Nachteile: {w.cons.join(' ')}</div>
                      {w.example && <div className="muted">{w.example}</div>}
                      {w.recommended && w.why && <div className="muted">{w.why}</div>}
                    </li>
                  ))}
                </ol>
              </div>
              <fieldset className="field grow">
                <legend className="field-legend">Seit wann?</legend>
                <label className="checkline"><input type="radio" checked={form.mode === 'start'} onChange={() => setForm({ ...form, mode: 'start' })} /> Schon immer</label>
                <label className="checkline"><input type="radio" checked={form.mode === 'change'} onChange={() => setForm({ ...form, mode: 'change' })} /> Ab einem Monat</label>
              </fieldset>
              {form.mode === 'start' ? (
                <label className="field">
                  Ab Monat
                  <select value={String(form.month)} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
                    {MONTH_OPTIONS.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
                  </select>
                </label>
              ) : (
                <label className="field">
                  Neuer Zeitraum ab
                  <input type="month" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                </label>
              )}
              <label className="field grow">
                Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?
                <select value={form.separate} onChange={(e) => setForm({ ...form, separate: e.target.value as SeparateChoice })}>
                  <option value="">— bitte wählen —</option>
                  {SEPARATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Woran erkenne ich das? Im Mietvertrag steht eine eigene Vorauszahlung für Heizung und Warmwasser, und Sie schicken dafür eine eigene Abrechnung.</small>
              {way?.way === 'd' && <p className="muted">{way.text}</p>}
            </>
          )}
          <div className="row">
            <button className="btn secondary" onClick={() => void loadPeriodPreview()}>Vorschau</button>
            <button className="btn ghost" onClick={close}>Abbrechen</button>
          </div>
          {periodPreview && periodAnswers && (
            <div className="preview">
              {periodPreview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
              {periodPreview.moves.length > 0 && (
                <ul>{periodPreview.moves.map((m) => <li key={m.costItemId}>{m.description}: von {m.fromLabel} nach {m.toLabel} ({fmtEuro(m.amountCents)})</li>)}</ul>
              )}
              {periodPreview.groups.map((g) => (
                <label key={g.from} className="field grow">
                  {`Heizperiode für ${g.items.map((i) => i.description).join(', ')}`}
                  <select value={periodAnswers.groups[g.from] ?? ''} onChange={(e) => setPeriodAnswers({ ...periodAnswers, groups: { ...periodAnswers.groups, [g.from]: e.target.value } })}>
                    {g.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </label>
              ))}
              {periodPreview.overrides.flatMap((o) => o.ask.map((a) => {
                const key = `${o.tenancyId}|${a.kind}|${a.period}`
                return (
                  <div key={key} className="row">
                    <label className="field">
                      {a.kind === 'heating' ? `${o.tenantName}: Heizvorauszahlung ${a.months} tatsächlich gezahlt` : `${o.tenantName}: Vorauszahlungen ${a.months} insgesamt tatsächlich gezahlt`}
                      <input inputMode="decimal" value={periodAnswers.amounts[key] ?? ''} onChange={(e) => setPeriodAnswers({ ...periodAnswers, amounts: { ...periodAnswers.amounts, [key]: e.target.value } })} />
                    </label>
                    <label className="checkline">
                      <input type="checkbox" checked={periodAnswers.none[key] ?? false} onChange={(e) => setPeriodAnswers({ ...periodAnswers, none: { ...periodAnswers.none, [key]: e.target.checked } })} /> keine Korrektur (die Staffel gilt)
                    </label>
                  </div>
                )
              }))}
              {periodPreview.endsSeparate.length > 0 && (
                <p className="muted">{`Danach in der Betriebskostenabrechnung statt getrennt: ${periodPreview.endsSeparate.map((e) => e.label).join(', ')}.`}</p>
              )}
              <button className="btn" disabled={periodPreview.blocked.length > 0} onClick={() => void savePeriod()}>Übernehmen</button>
            </div>
          )}
        </div>
      )}

      {open === 'separate' && (
        <div className="panel">
          <label className="field">
            {separateOn && own ? 'Ab welcher Heizperiode wieder gemeinsam? (Monat ihres Beginns)' : 'Ab welchem Monat?'}
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn secondary" onClick={() => void loadSeparatePreview()}>Vorschau</button>
            <button className="btn ghost" onClick={close}>Abbrechen</button>
          </div>
          {separatePreview && separateAnswers && (
            <div className="preview">
              {separatePreview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
              {separatePreview.share && <p className="muted">{`Vorbelegt mit dem Anteil der Heizkosten: ${(separatePreview.share.permille / 10).toLocaleString('de-DE')} % (${separatePreview.share.source}).`}</p>}
              {separatePreview.steps.flatMap((s) => s.rows.map((r) => {
                const key = `${s.tenancyId}|${r.from}`
                return (
                  <label key={key} className="field">
                    {`${s.tenantName} ab ${r.from.slice(5, 7)}/${r.from.slice(0, 4)}: davon Heizung (Vorauszahlung ${fmtEuro(r.totalCents)})`}
                    <input inputMode="decimal" value={separateAnswers.steps[key] ?? ''} onChange={(e) => setSeparateAnswers({ ...separateAnswers, steps: { ...separateAnswers.steps, [key]: e.target.value } })} />
                  </label>
                )
              }))}
              {separatePreview.overrides.map((o) => (
                <fieldset key={`${o.tenancyId}|${o.period}`} className="field grow">
                  <legend className="field-legend">{`${o.tenantName}: Jahreskorrektur ${o.label}${o.cents === null ? '' : ` (bisher ${fmtEuro(o.cents)})`}`}</legend>
                  {o.asks.map((a) => {
                    const key = `${o.tenancyId}|${a.kind}|${a.period}`
                    const text = a.kind === 'total'
                      ? (separatePreview.separate ? `davon übrige Vorauszahlungen ${a.months}` : `Vorauszahlungen ${a.months} insgesamt`)
                      : `Heizvorauszahlung ${a.label} (${a.months})${a.kind === 'provisional' ? ', vorläufig' : ''}`
                    return (
                      <div key={key} className="row">
                        <label className="field">
                          {text}
                          <input inputMode="decimal" value={amount(key)} onChange={(e) => setSeparateAnswers({ ...separateAnswers, amounts: { ...separateAnswers.amounts, [key]: e.target.value } })} />
                        </label>
                        {!separatePreview.separate && (
                          <label className="checkline">
                            <input type="checkbox" checked={separateAnswers.none[key] ?? false} onChange={(e) => setSeparateAnswers({ ...separateAnswers, none: { ...separateAnswers.none, [key]: e.target.checked } })} /> keine Korrektur
                          </label>
                        )}
                      </div>
                    )
                  })}
                  {o.remainder && <p className="muted">{`Der Rest gilt vorläufig für ${o.remainder.label} (${o.remainder.months}); beim Abrechnen dieser Heizperiode erfassen Sie die endgültige Heizvorauszahlung.`}</p>}
                </fieldset>
              ))}
              {separatePreview.deadlines.map((d) => (
                <p key={d.period} className={d.passed ? 'error' : 'muted'}>
                  {`Heizkostenabrechnung ${d.label}: Frist ${fmtDate(d.deadline)}${d.passed ? ' – abgelaufen; eine Nachforderung ist ausgeschlossen (§ 556 Abs. 3 Satz 3 BGB).' : ''}`}
                </p>
              ))}
              {separatePreview.keep.length > 0 && <p className="muted">{`Getrennt bleiben: ${separatePreview.keep.map((k) => `${k.label} (Frist ${fmtDate(k.deadline)})`).join(', ')}.`}</p>}
              {separatePreview.merge.length > 0 && (
                <label className="checkline">
                  <input type="checkbox" checked={separateAnswers.merge} onChange={(e) => setSeparateAnswers({ ...separateAnswers, merge: e.target.checked })} /> Heizvorauszahlung und übrige Vorauszahlung wieder zu einer zusammenführen
                </label>
              )}
              <button className="btn" disabled={separatePreview.blocked.length > 0} onClick={() => void saveSeparate()}>Übernehmen</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
