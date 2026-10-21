import { useRef, useState, type ReactNode } from 'react'
import type { HeatingPeriodChangePreview, HeatingPlant, PeriodRules, SeparatePreview } from '../types'
import { ApiError, api, errorText, fmtDate, fmtEuro } from '../api'
import { earliestOpenChange, localToday, MONTH_OPTIONS } from '../periodForm'
import { EffectsList } from './PeriodCard'
import Term from './Term'
import Drawer from './Drawer'
import { useSaving } from '../useSaving'
import MonthField from './MonthField'
import { parseMonthText } from '../monthText'
import { hasOwnRhythm } from '../../../shared/heatingPeriod.ts'
import {
  PERIOD_CHOICE_OPTIONS, SEPARATE_OPTIONS, heatingPeriodAnswersOf, heatingPeriodForm, heatingPeriodSummary, heatingRulesBody, initialHeatingPeriodAnswers,
  heatingWays, initialSeparateAnswers, isCalendarObject, separateAnswersOf, separatePanelIntro, suggestedWay, type HeatingPeriodAnswerForm, type HeatingPeriodForm, type PeriodChoice, type SeparateAnswerForm,
  type SeparateChoice,
} from '../heatingPeriodForm'
import { ErrorSummary, useFormError } from './ErrorSummary'

// Der Abschnitt „Zeitraum der Heizung“ einer Anlage in der Karte „Heizung“ (Heizung PR 5, Entwurf 11.2
// Schritt 3): Zeitraum wechseln mit Vorschau, getrennte Heizkostenabrechnung ein- und ausschalten mit
// Vorschau. Geschrieben wird erst mit „Speichern“; lehnt der Server ab (409), steht seine Meldung da
// und die neue Vorschau.
type Props = {
  plant: HeatingPlant
  objectRules: PeriodRules
  hasCalendarData: boolean
  onChanged: () => Promise<void>
  notify: (text: string) => void
  // Sichtprüfung E5: Die Aktionen der Anlage stehen in derselben Zeile wie die des Zeitraums.
  actions?: ReactNode
  dangerAction?: ReactNode
}

// Bei 409 bringt der Server die neue Vorschau mit (veraltete Marke oder fehlende Angaben, wie beim
// Wechsel des Abrechnungszeitraums); sie ersetzt die alte, eingetragene Beträge bleiben stehen.
function freshPreview<T>(e: unknown): T | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const p = e.data.preview
  return p !== null && typeof p === 'object' ? p as T : null
}

export default function HeatingPeriodSection({ plant, objectRules, hasCalendarData, onChanged, notify, actions, dangerAction }: Props) {
  const [open, setOpen] = useState<'none' | 'period' | 'separate'>('none')
  const [form, setForm] = useState<HeatingPeriodForm>(heatingPeriodForm(plant))
  // Gespeichert wird im Seitenfenster (#346 Schritt 12, wie der Abrechnungszeitraum in Schritt 7); ein geändertes Fenster
  // meldet sich selbst bei useOpenForm an, und useSaving sperrt einen zweiten Klick auf „Speichern“.
  const saving = useSaving()
  // Jede Anfrage einer Vorschau trägt eine Nummer; eine Antwort, die nach einer Änderung ankommt, gilt nicht mehr
  // (Durchsicht des Seitenfensters, sonst kehrte M2 durch die Hintertür zurück). `stale` sagt im Fenster, warum.
  const previewSeq = useRef(0)
  const [stale, setStale] = useState(false)
  const [periodPreview, setPeriodPreview] = useState<HeatingPeriodChangePreview | null>(null)
  const [periodAnswers, setPeriodAnswers] = useState<HeatingPeriodAnswerForm | null>(null)
  const [separatePreview, setSeparatePreview] = useState<SeparatePreview | null>(null)
  const [separateAnswers, setSeparateAnswers] = useState<SeparateAnswerForm | null>(null)
  const [month, setMonth] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [periodUnderstood, setPeriodUnderstood] = useState(false)
  // Der Bereich „getrennt“ als zweiter Schritt nach dem Zeitraum (E7)
  const [secondStep, setSecondStep] = useState(false)
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const own = hasOwnRhythm(plant)
  const openSpan = plant.separateSpans.some((s) => s.until === null)
  const separateOn = openSpan || (!own && plant.separateSettlement === true)

  // Eine Änderung nach der Vorschau verwirft sie samt Antworten und Bestätigung; „Speichern“ wartet auf die nächste
  // (wie Durchsicht M2 beim Abrechnungszeitraum: sonst gälte die Vorschau für einen anderen Stand als im Formular).
  function changeForm(next: HeatingPeriodForm) {
    setForm(next)
    if (periodPreview !== null || previewSeq.current > 0) setStale(true)
    previewSeq.current += 1
    setPeriodPreview(null)
    setPeriodAnswers(null)
    setPeriodUnderstood(false)
  }
  function changeMonth(next: string) {
    setMonth(next)
    if (separatePreview !== null || previewSeq.current > 0) setStale(true)
    previewSeq.current += 1
    setSeparatePreview(null)
    setSeparateAnswers(null)
    setUnderstood(false)
  }

  // Schließen setzt alles zurück, auch Monat, Antworten und Bestätigung (Durchsicht: sonst rechnete der zweite Schritt
  // mit dem Monat eines früher abgebrochenen Fensters)
  function close() {
    setOpen('none')
    setSecondStep(false)
    setError('')
    previewSeq.current = 0
    setStale(false)
    setPeriodPreview(null)
    setPeriodAnswers(null)
    setPeriodUnderstood(false)
    setSeparatePreview(null)
    setSeparateAnswers(null)
    setUnderstood(false)
    setMonth('')
  }

  async function loadPeriodPreview() {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body) return errors.report([{ field: body.field, short: body.short, text: body.error }])
    const seq = ++previewSeq.current
    try {
      const p = await api<HeatingPeriodChangePreview>(`/api/heating-plants/${plant.id}/period/preview`, { method: 'POST', body: JSON.stringify(body) })
      if (seq !== previewSeq.current) return
      setStale(false)
      setPeriodPreview(p)
      setPeriodAnswers(initialHeatingPeriodAnswers(p))
      setPeriodUnderstood(false)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Gibt zurück, ob danach der zweite Schritt (Vorschau zum Aufteilen) folgt; die lädt erst nach dem Speichern, damit das
  // zweite Fenster währenddessen nicht gesperrt ist (Durchsicht)
  async function savePeriod(): Promise<boolean> {
    const body = heatingRulesBody(form, plant, objectRules)
    if ('error' in body || !periodPreview || !periodAnswers) return false
    const answers = heatingPeriodAnswersOf(periodPreview, periodAnswers)
    if ('error' in answers) { setError(answers.error); return false }
    try {
      await api(`/api/heating-plants/${plant.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: body.rules, answers: { ...answers, understood: periodUnderstood } }) })
    } catch (e) {
      const fresh = freshPreview<HeatingPeriodChangePreview>(e)
      if (fresh) {
        setPeriodPreview(fresh)
        setPeriodAnswers({ ...initialHeatingPeriodAnswers(fresh), amounts: periodAnswers.amounts, none: periodAnswers.none })
      }
      // Review Runde 2: Die Bestätigung galt der alten Vorschau.
      setPeriodUnderstood(false)
      setError(fresh ? `${errorText(e)} Bitte prüfen Sie die Vorschau erneut.` : errorText(e))
      return false
    }
    // Die Antwort auf die Frage nach der getrennten Abrechnung (Schritt 3): bei „ja“ und eigener
    // Heizperiode geht es mit der Vorschau zum Aufteilen weiter (Weg d), sonst wird sie gespeichert.
    close()
    await onChanged()
    // Laienprobe B11: Bei „ja“ ist die getrennte Abrechnung erst nach dem Aufteilen der Vorauszahlung
    // eingeschaltet. Die Vorschau dazu öffnet sich gleich, und die Meldung sagt, dass noch etwas fehlt.
    if (form.choice === 'own' && form.separate === 'yes' && !openSpan) {
      notify('Zeitraum der Heizung gespeichert. Noch nicht eingeschaltet ist die getrennte Heizkostenabrechnung: Prüfen Sie im Fenster die Aufteilung der Vorauszahlung und klicken Sie „Speichern“.')
      setOpen('separate')
      setSecondStep(true)
      return true
    }
    notify('Zeitraum der Heizung gespeichert.')
    return false
  }

  async function savePeriodThen() {
    let next = false
    await saving.run(async () => { next = await savePeriod() })
    if (next) void loadSeparatePreview(true, '')
  }

  async function loadSeparatePreview(switchOn = false, forMonth = month) {
    // Aus dem Monatsfeld kommt ein Text, der kein Monat ist, unverändert (#287, #346 Schritt 5); er wird gemeldet.
    const parsed = parseMonthText(forMonth)
    if (parsed.kind === 'invalid') {
      errors.report([{ field: 'month', short: parsed.short, text: `Monat: ${parsed.text}` }])
      return
    }
    const body = separateOn && !switchOn ? { separate: false, ...(forMonth ? { until: forMonth } : {}) } : { separate: true, ...(forMonth ? { month: forMonth } : {}) }
    const seq = ++previewSeq.current
    try {
      const p = await api<SeparatePreview>(`/api/heating-plants/${plant.id}/separate/preview`, { method: 'POST', body: JSON.stringify(body) })
      if (seq !== previewSeq.current) return
      setStale(false)
      setSeparatePreview(p)
      setSeparateAnswers(initialSeparateAnswers(p))
      setUnderstood(false)
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
    const confirmed = { ...answers, understood }
    const body = separatePreview.separate
      ? { separate: true, month: separatePreview.month, answers: confirmed }
      : { separate: false, ...(separatePreview.until ? { until: separatePreview.until } : { month: separatePreview.month }), answers: confirmed }
    try {
      await api(`/api/heating-plants/${plant.id}/separate`, { method: 'PUT', body: JSON.stringify(body) })
    } catch (e) {
      const fresh = freshPreview<SeparatePreview>(e)
      if (fresh) {
        setSeparatePreview(fresh)
        setSeparateAnswers({ ...initialSeparateAnswers(fresh), amounts: separateAnswers.amounts, none: separateAnswers.none, merge: separateAnswers.merge })
      }
      // Review Runde 1: Nach einer 409 gilt die alte Bestätigung nicht für die neue Vorschau.
      setUnderstood(false)
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
    <div className="stack heating-period">
      <ul className="facts">{heatingPeriodSummary(plant, objectRules).map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="row">
        {actions}
        <button className="btn secondary" onClick={() => { setForm(heatingPeriodForm(plant)); setOpen('period') }}>Zeitraum der Heizung ändern</button>
        {(own || plant.separateSettlement === true) && (
          <button className="btn secondary" onClick={() => { setMonth(''); setOpen('separate') }}>
            {separateOn ? 'Getrennte Heizkostenabrechnung ausschalten' : own ? 'Getrennte Heizkostenabrechnung einschalten' : 'Vorauszahlung aufteilen'}
          </button>
        )}
        {/* Gefahr mit Abstand zu den übrigen Knöpfen (#346 Schritt 7, M19) */}
        {dangerAction && <span className="ml-auto">{dangerAction}</span>}
      </div>
      {open === 'none' && <ErrorSummary errors={errors} />}

      {open === 'period' && (
        <Drawer
          key="zeitraum-heizung"
          open
          title="Zeitraum der Heizung ändern"
          width={560}
          onClose={close}
          value={{ form, periodAnswers, periodUnderstood }}
          busy={saving.busy}
          errors={errors}
          onSubmit={() => { if (periodPreview !== null && periodPreview.blocked.length === 0 && !(periodPreview.effects.some((e) => e.passed) && !periodUnderstood)) void savePeriodThen() }}
          actions={<button className="btn" disabled={saving.busy || !(periodPreview !== null && periodPreview.blocked.length === 0 && !(periodPreview.effects.some((e) => e.passed) && !periodUnderstood))} onClick={() => void savePeriodThen()}>Speichern</button>}
        >
          <label className="field">
            Für welchen Zeitraum rechnet die Heizung ab?
            <select value={form.choice} onChange={(e) => changeForm({ ...form, choice: e.target.value as PeriodChoice })}>
              {PERIOD_CHOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {/* Der Satz steht außerhalb des label, sonst gehörte er zum Namen des Auswahlfelds. */}
          <small className="muted">Woran erkenne ich das? Am Zeitraum auf der Abrechnung Ihres Messdienstes, etwa „01.05.2025–30.04.2026“. Ohne Messdienst: am Tag, an dem Sie die Zähler ablesen oder an dem Ihre Gas- oder Ölrechnung endet.</small>
          {form.choice === 'own' && (
            <>
              {/* Die drei Wege (Nutzerwunsch zu Schritt 3): jeder mit Vor- und Nachteilen, Weg 1 als Vorgabe. */}
              {/* Sichtprüfung S12/E6: je Weg der Titel und wie es geht; Vor- und Nachteile zum Aufklappen */}
              <div className="stack heating-ways">
                <p>Rechnet Ihr Messdienst in einem anderen Zeitraum ab als Ihre Betriebskosten, gibt es drei Wege:</p>
                <ol>
                  {ways.map((w) => (
                    <li key={w.id} className="stack">
                      <div className="way-title"><strong>{w.title}</strong>{w.recommended && <> <span className="badge accent">Vorgabe</span></>}</div>
                      <small className="muted">{w.how}</small>
                      <details>
                        <summary>Vor- und Nachteile</summary>
                        <div>Vorteile: {w.pros.join(' ')}</div>
                        <div>Nachteile: {w.cons.join(' ')}</div>
                        {w.example && <small className="muted">{w.example}</small>}
                      </details>
                      {w.recommended && w.why && <small className="muted">{w.why}</small>}
                    </li>
                  ))}
                </ol>
              </div>
              <fieldset>
                <legend className="field-legend">Gilt dieser Zeitraum schon immer oder erst ab einem Monat?</legend>
                <div className="checks">
                  <label className="checkline"><input type="radio" checked={form.mode === 'start'} onChange={() => changeForm({ ...form, mode: 'start' })} /> Schon immer</label>
                  <label className="checkline"><input type="radio" checked={form.mode === 'change'} onChange={() => changeForm({ ...form, mode: 'change' })} /> Ab einem Monat</label>
                </div>
              </fieldset>
              {/* Laienprobe B14: „Ab Monat“ wurde als „seit wann“ gelesen; gemeint ist der Beginn jeder Heizperiode. */}
              {form.mode === 'start' ? (
                <label className="field">
                  Heizperiode beginnt im
                  <select value={String(form.month)} onChange={(e) => changeForm({ ...form, month: Number(e.target.value) })}>
                    {MONTH_OPTIONS.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
                  </select>
                </label>
              ) : (
                // Das Monatsfeld: `type="month"` kennen Safari und Firefox nicht (#287, #346 Schritt 5).
                <MonthField label="Neue Heizperiode beginnt ab Monat" value={form.from} today={localToday()} onChange={(from) => changeForm({ ...form, from })} {...errors.field('from')} />
              )}
              <label className="field">
                <span>Rechnen Sie die Heizkosten <Term id="separateHeatingSettlement">getrennt ab</Term>, mit eigener Heizkostenvorauszahlung?</span>
                <select value={form.separate} onChange={(e) => changeForm({ ...form, separate: e.target.value as SeparateChoice })}>
                  <option value="">— bitte wählen —</option>
                  {SEPARATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <small className="muted">Woran erkenne ich das? Im Mietvertrag steht eine eigene Vorauszahlung für Heizung und Warmwasser, und Sie schicken dafür eine eigene Abrechnung.</small>
              {way?.way === 'd' && <p className="muted">{way.text}</p>}
            </>
          )}
          <div className="row">
            <button className="btn secondary" disabled={saving.busy} onClick={() => void loadPeriodPreview()}>Vorschau</button>
          </div>
          {!periodPreview && (
            <p className="muted">{stale ? 'Sie haben die Angaben geändert. Fordern Sie die Vorschau erneut an; gespeichert wird erst danach.' : 'Die Vorschau zeigt, was sich ändert; gespeichert wird erst danach.'}</p>
          )}
          {periodPreview && periodAnswers && (
            <div className="preview">
              {periodPreview.blocked.map((b) => <div key={b} className="error">{b}</div>)}
              {/* Laienprobe B12, B13: je Position die Heizperiode mit Tagen, vorbelegt mit der, die im bisherigen Zeitraum endet. */}
              {periodPreview.moves.map((m) => (
                <div key={m.costItemId}>
                  <label className="field">
                    {`Heizperiode für „${m.description}“ (${fmtEuro(m.amountCents)}, bisher ${m.fromRange})`}
                    <select value={periodAnswers.moves[m.costItemId] ?? m.to} onChange={(e) => setPeriodAnswers({ ...periodAnswers, moves: { ...periodAnswers.moves, [m.costItemId]: e.target.value } })}>
                      {m.options.map((o) => <option key={o.key} value={o.key}>{`Heizperiode ${o.range}${o.key === m.to ? ' (Vorgabe)' : ''}`}</option>)}
                    </select>
                  </label>
                  {m.check && (
                    <small className="muted">
                      {`Prüfen Sie, welchen Zeitraum die Rechnung abdeckt. Vorgeschlagen ist die Heizperiode, die in ${m.fromLabel} endet; so bleibt sie in derselben Abrechnung. Ist es eine Rechnung des Versorgers über ${m.fromRange}, deckt sie keine Heizperiode genau ab: Tragen Sie danach ihren Leistungszeitraum ein; Mietfuchs warnt dann, wenn er über die Heizperiode hinausreicht.`}
                    </small>
                  )}
                </div>
              ))}
              {periodPreview.groups.map((g) => (
                <label key={g.from} className="field">
                  {`Heizperiode für ${g.items.map((i) => i.description).join(', ')}`}
                  <select value={periodAnswers.groups[g.from] ?? ''} onChange={(e) => setPeriodAnswers({ ...periodAnswers, groups: { ...periodAnswers.groups, [g.from]: e.target.value } })}>
                    {g.options.map((o) => <option key={o.key} value={o.key}>{`Heizperiode ${o.range}`}</option>)}
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
              {/* Review Runde 2: Fristen und Bestätigung wie beim Zeitraum des Objekts. */}
              <EffectsList effects={periodPreview.effects} earliest={earliestOpenChange(localToday())} />
              {periodPreview.effects.some((e) => e.passed) && (
                <label className="checkline">
                  <input type="checkbox" checked={periodUnderstood} onChange={(e) => setPeriodUnderstood(e.target.checked)} /> Ich habe verstanden, dass ich aus einer Abrechnung mit abgelaufener Frist keine Nachzahlung mehr verlangen kann.
                </label>
              )}
            </div>
          )}
        </Drawer>
      )}

      {open === 'separate' && (() => {
        const intro = separatePanelIntro({ separateOn, own, afterPeriodChange: secondStep })
        return (
        <Drawer
          key="getrennt"
          open
          title={intro.title}
          width={560}
          onClose={close}
          value={{ month, separateAnswers, understood }}
          // Nach dem Speichern des Zeitraums ist das Fenster vorbelegt und fragt beim Schließen (Durchsicht)
          changedFrom={secondStep ? { value: { month: '', separateAnswers: null, understood: false } } : undefined}
          busy={saving.busy}
          errors={errors}
          onSubmit={() => { if (separatePreview !== null && separatePreview.blocked.length === 0 && !(separatePreview.effects.some((e) => e.passed) && !understood)) void saving.run(saveSeparate) }}
          actions={<button className="btn" disabled={saving.busy || !(separatePreview !== null && separatePreview.blocked.length === 0 && !(separatePreview.effects.some((e) => e.passed) && !understood))} onClick={() => void saving.run(saveSeparate)}>Speichern</button>}
        >
          <p className="muted">{intro.text}</p>
          <MonthField label={intro.monthLabel} value={month} today={localToday()} onChange={changeMonth} {...errors.field('month')} />
          <div className="row">
            <button className="btn secondary" disabled={saving.busy} onClick={() => void loadSeparatePreview()}>Vorschau</button>
          </div>
          {!separatePreview && (
            <p className="muted">{stale ? 'Sie haben die Angaben geändert. Fordern Sie die Vorschau erneut an; gespeichert wird erst danach.' : 'Die Vorschau zeigt, was sich ändert; gespeichert wird erst danach.'}</p>
          )}
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
                <fieldset key={`${o.tenancyId}|${o.period}`} className="field">
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
                  {`Heizkostenabrechnung ${d.label}: Frist ${fmtDate(d.deadline)}${d.passed ? ' – abgelaufen; eine Nachforderung ist in der Regel ausgeschlossen, außer Sie haben die Verspätung nicht zu vertreten (§ 556 Abs. 3 Satz 3 BGB).' : ''}`}
                </p>
              ))}
              <EffectsList effects={separatePreview.effects} />
              {separatePreview.effects.some((e) => e.passed) && (
                <label className="checkline">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> Ich habe verstanden, dass ich aus einer Abrechnung mit abgelaufener Frist keine Nachzahlung mehr verlangen kann.
                </label>
              )}
              {separatePreview.keep.length > 0 && <p className="muted">{`Getrennt bleiben: ${separatePreview.keep.map((k) => `${k.label} (Frist ${fmtDate(k.deadline)})`).join(', ')}.`}</p>}
              {separatePreview.merge.length > 0 && (
                <label className="checkline">
                  <input type="checkbox" checked={separateAnswers.merge} onChange={(e) => setSeparateAnswers({ ...separateAnswers, merge: e.target.checked })} /> Heizvorauszahlung und übrige Vorauszahlung wieder zu einer zusammenführen
                </label>
              )}
            </div>
          )}
        </Drawer>
        )
      })()}
    </div>
  )
}
