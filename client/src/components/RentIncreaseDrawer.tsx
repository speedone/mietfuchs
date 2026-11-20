// Seitenfenster „Mieterhöhung“ (#191), geöffnet aus dem Mietverhältnis in den Stammdaten. PR 2: Der Server sagt zu den
// Eingaben, ob, wann und um wie viel die Miete steigen darf (server/src/rentIncrease.ts), mit Gründen, Herleitung und
// Warnungen. PR 3: Eingaben für das Schreiben, „Schreiben als Entwurf anlegen“, und die Liste der Verlangen des
// Mietverhältnisses mit „Schreiben ansehen“, „Drucken“, „Als versendet speichern“ und der Antwort des Mieters, jeweils mit
// Rückfrage (server/src/rentIncreaseSave.ts schreibt). Die Formularlogik steht in rentIncreaseForm.ts und
// rentIncreaseLetterForm.ts, der Text des Schreibens in rentIncreaseLetter.ts; hier wird nur gerendert.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Property, RentIncreaseDecision, RentIncreasePlan, RentIncreasePlanView as PlanWithToken, RentIncreaseView, Settings, Tenancy, Unit } from '../types'
import { api, errorText, fmtDate, fmtEuro, parseEuro } from '../api'
import { localToday } from '../periodForm'
import { DECISION_LABELS, EXTRA_PARAGRAPH_HINT, PARTIES_HINT, RENT_INCREASE_STATUS_LABELS, SEVERAL_LANDLORDS_LABEL, decisionQuestion, followPlanRange, justificationOptions, notYetNote, qualifiedSurveyOptions, rentIncreaseDecisions, rentLetterInput, rentLetterStart, rentLetterWarnings, sendQuestion, senderNote, type RentLetterValue, type RentSurveyValue } from '../rentIncreaseLetterForm'
import { rentIncreaseBasisProblem } from '../../../shared/rentIncreaseLetter.ts'
import { effectiveLandlord } from '../landlord'
import type { EffectiveLandlord } from '../../../shared/landlord.ts'
import { RentIncreaseLetterSheet, RentIncreasePrint } from './RentIncreaseLetter'
import DisclosureButton from './DisclosureButton'
import { useConfirm, useToast } from './feedback'
import { useSaving } from '../useSaving'
import { monthLabel } from '../monthText'
import { RENT_CAP_HINT, RENT_INCREASE_STATE_LABELS, rentCapOptions, rentIncreaseKindOptions, rentIncreaseRequest, rentIncreaseStart, type RentIncreaseValue } from '../rentIncreaseForm'
import { CURRENT_INDEX_BASE, RENT_KIND_LABELS } from '../rentKindForm'
import Drawer from './Drawer'
import Field from './Field'
import MonthField from './MonthField'
import Term from './Term'
import { NoticeBox } from './Notice'
import { useFormError } from './ErrorSummary'
import { todayIso } from '../readingSheet'

// Wartezeit nach der letzten Eingabe, bevor neu gerechnet wird.
const PLAN_DELAY_MS = 250
const STATE_BADGE = { possible: 'green', notYet: 'amber', blocked: 'red' } as const

export default function RentIncreaseDrawer({ tenancy, unit, property, settings = null, onClose }: {
  tenancy: Tenancy
  unit: Unit | undefined
  property: Property | null | undefined
  // Für den Hinweis, wenn der heutige Absender vom eingefrorenen abweicht (Durchsicht K2); ohne Einstellungen keiner.
  settings?: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'> | null
  onClose: () => void
}) {
  const [value, setValue] = useState<RentIncreaseValue>(() => rentIncreaseStart(tenancy, unit, property))
  const [letter, setLetter] = useState<RentLetterValue>(() => rentLetterStart(tenancy, { low: value.rangeLow, high: value.rangeHigh }))
  const landlord = settings ? effectiveLandlord(property ?? null, settings) : null
  const [plan, setPlan] = useState<PlanWithToken | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Was der letzte Plan sagte und über das Neurechnen hinweg gilt: der Tag des Servers (Durchsicht S4) und der Tag der
  // Miete am Stichtag (Durchsicht K1).
  const [serverToday, setServerToday] = useState<string | null>(null)
  const [capDay, setCapDay] = useState<string | null>(null)
  const [increases, setIncreases] = useState<RentIncreaseView[] | null>(null)
  const [printing, setPrinting] = useState<RentIncreaseView | null>(null)
  // Feldnamen der Rechnung und Pfade der Eingaben des Schreibens („survey.name“), beide als Text.
  const errors = useFormError<string>()
  const seq = useRef(0)
  const saving = useSaving()
  const toast = useToast()
  const confirm = useConfirm()
  const set = <K extends keyof RentIncreaseValue>(key: K, v: RentIncreaseValue[K]) => setValue((old) => ({ ...old, [key]: v }))
  const setL = <K extends keyof RentLetterValue>(key: K, v: RentLetterValue[K]) => setLetter((old) => ({ ...old, [key]: v }))
  // Die Spanne der Rechnung zieht die des Schreibens mit (Durchsicht S2).
  const setRange = (key: 'rangeLow' | 'rangeHigh', text: string) => {
    const before = { low: value.rangeLow, high: value.rangeHigh }
    setLetter((old) => followPlanRange(old, before, key === 'rangeLow' ? { ...before, low: text } : { ...before, high: text }))
    set(key, text)
  }

  const loadIncreases = useCallback(() => {
    api<RentIncreaseView[]>(`/api/tenancies/${tenancy.id}/rent-increases`).then(setIncreases).catch((e: unknown) => toast(errorText(e), 'error'))
  }, [tenancy.id])
  useEffect(loadIncreases, [loadIncreases])

  // Die heute geltende Stufe, nach dem Tag des Servers, solange keiner bekannt ist nach dem des Rechners (Durchsicht S4).
  const todayMonth = (serverToday ?? todayIso()).slice(0, 7)
  const current = [...tenancy.baseRents].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).filter((r) => r.from <= todayMonth).at(-1)
  const stepBase = current?.index?.base ?? null

  // Die Rechnung folgt dem Zustand des Fensters; jede Änderung verwirft die alte (Folgenummer gegen späte Antworten).
  useEffect(() => {
    const n = ++seq.current
    setPlan(null)
    errors.clear()
    const built = rentIncreaseRequest(value, { stepBase })
    if ('problems' in built) {
      setNote(built.problems.map((p) => p.text).join(' '))
      return
    }
    setNote(null)
    const timer = setTimeout(() => {
      api<PlanWithToken>(`/api/tenancies/${tenancy.id}/rent-increase/plan`, { method: 'POST', body: JSON.stringify(built.body) })
        .then((p) => {
          if (n !== seq.current) return
          setPlan(p)
          setServerToday(p.today)
          if (p.capBaseDay) setCapDay(p.capBaseDay)
        })
        .catch((e: unknown) => { if (n === seq.current) errors.set(errorText(e), { focus: false }) })
    }, PLAN_DELAY_MS)
    return () => clearTimeout(timer)
    // `errors` ändert sich mit jeder Meldung; neu gerechnet wird nur bei geänderten Eingaben.
  }, [value, tenancy.id, stepBase, increases])

  // Ein Schreiben als Entwurf: Rechnung mit der Marke des gezeigten Plans, Eingaben des Schreibens geprüft wie auf dem Server.
  async function createDraft() {
    const built = rentIncreaseRequest(value)
    const checked = rentLetterInput(letter, value.kind)
    if ('problems' in built || 'problems' in checked) {
      errors.report([...('problems' in built ? built.problems : []), ...('problems' in checked ? checked.problems : [])])
      return
    }
    if (!plan) return
    try {
      await api<RentIncreaseView>(`/api/tenancies/${tenancy.id}/rent-increases`, { method: 'POST', body: JSON.stringify({ request: built.body, letter: checked.body, token: plan.token }) })
      toast('Schreiben als Entwurf angelegt.')
      loadIncreases()
    } catch (e) {
      errors.set(errorText(e))
      loadIncreases()
    }
  }
  async function act(url: string, init: RequestInit, done: string) {
    try {
      await api<unknown>(url, init)
      toast(done)
    } catch (e) {
      toast(errorText(e), 'error')
    }
    loadIncreases()
  }
  async function send(x: RentIncreaseView, receivedOn: string) {
    if (!(await confirm(sendQuestion(x, receivedOn)))) return
    await act(`/api/rent-increases/${x.id}/send`, { method: 'POST', body: JSON.stringify({ receivedOn, token: x.token }) }, 'Als versendet gespeichert.')
  }
  async function decide(x: RentIncreaseView, decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string) {
    if (!(await confirm(decisionQuestion(x, decision, agreedCents)))) return
    await act(`/api/rent-increases/${x.id}/status`, { method: 'POST', body: JSON.stringify({ status: decision, agreedCents, decidedOn, token: x.token }) }, `${RENT_INCREASE_STATUS_LABELS[decision]}: gespeichert.`)
  }
  // Vor dem Druck eines Entwurfs, der noch nicht zugehen darf, die Rückfrage mit dem frühesten Tag (Durchsicht S1).
  async function print(x: RentIncreaseView) {
    const early = notYetNote(x)
    if (early && !(await confirm({ title: 'Schreiben drucken?', message: early, confirmLabel: 'Drucken' }))) return
    setPrinting(x)
  }
  async function remove(x: RentIncreaseView) {
    if (!(await confirm({ title: 'Entwurf löschen?', message: 'Der Entwurf des Schreibens wird gelöscht. Ihre Eingaben in diesem Fenster bleiben stehen.', confirmLabel: 'Löschen', danger: true }))) return
    await act(`/api/rent-increases/${x.id}`, { method: 'DELETE', body: JSON.stringify({ token: x.token }) }, 'Entwurf gelöscht.')
  }

  const comparison = value.kind === 'comparison'
  return (
    <Drawer open title={`Mieterhöhung: ${tenancy.tenantName}`} width={640} cancelLabel="Schließen" hint="Esc schließt"
      onClose={onClose} value={{ value, letter }} errors={errors} busy={saving.busy}>
      <p className="m-0">
        Art der Miete: {tenancy.rentKind ? RENT_KIND_LABELS[tenancy.rentKind] : 'nicht angegeben'}
        {current && <> · bisher {fmtEuro(current.monthlyCents)} ab {monthLabel(current.from)}</>}.
        {' '}Gespeichert wird erst ein Schreiben, als Entwurf.
      </p>
      {/* Durchsicht K7: Ein offener Entwurf unterdrückt die Erinnerung in „Demnächst fällig“ (upcomingDeadlines.ts). */}
      {increases?.filter((x) => x.status === 'draft').map((x) => (
        <NoticeBox key={x.id} level="info">
          Ein Entwurf vom {fmtDate(x.createdOn)} ist noch offen; solange erinnert das Cockpit nicht an eine mögliche Mieterhöhung. Speichern Sie ihn als versendet, sobald er zugegangen ist, oder löschen Sie ihn.
        </NoticeBox>
      ))}

      <div className="field-grid">
        <Field label="Art der Erhöhung">
          <select value={value.kind} onChange={(e) => set('kind', e.target.value === 'index' ? 'index' : 'comparison')}>
            {rentIncreaseKindOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Zugang beim Mieter" hint="Leer heißt heute. Maßgeblich ist der Tag, an dem das Schreiben ankommt, nicht der Versand." {...errors.field('receivedOn')}>
          <input type="date" value={value.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} />
        </Field>
        <MonthField label="Wirksam ab" value={value.effectiveFrom} placeholder="frühestmöglich" onChange={(v) => set('effectiveFrom', v)} {...errors.field('effectiveFrom')} />
      </div>

      <fieldset className="grid gap-2">
        <legend>Bestätigungen</legend>
        <label className="checkline">
          <input type="checkbox" checked={value.allStepsEntered} onChange={(e) => set('allStepsEntered', e.target.checked)} />
          <span>Alle Änderungen der Kaltmiete seit Mietbeginn stehen mit ihrer Art in der Staffel, bei einer Staffelmiete auch die künftigen Stufen.</span>
        </label>
        <label className="checkline">
          <input type="checkbox" checked={value.residential} onChange={(e) => set('residential', e.target.checked)} />
          <span>Die Wohnung ist Wohnraum, nicht preisgebunden und nicht nur zum vorübergehenden Gebrauch vermietet.</span>
        </label>
        {comparison && (
          <label className="checkline">
            <input type="checkbox" checked={value.noThirdPartyFunds} onChange={(e) => set('noThirdPartyFunds', e.target.checked)} />
            <span>Für die Wohnung sind keine Fördermittel oder Zuschüsse Dritter geflossen.</span>
          </label>
        )}
      </fieldset>

      {comparison ? (
        <div className="field-grid">
          <Field label={<><Term id="comparisonRent">Vergleichsmiete</Term> je m² €</>} {...errors.field('comparison')}>
            <input value={value.comparison} inputMode="decimal" placeholder="z. B. 8,50" onChange={(e) => set('comparison', e.target.value)} />
          </Field>
          <Field label="Spanne von €/m²" {...errors.field('rangeLow')}>
            <input value={value.rangeLow} inputMode="decimal" onChange={(e) => setRange('rangeLow', e.target.value)} />
          </Field>
          <Field label="Spanne bis €/m²" {...errors.field('rangeHigh')}>
            <input value={value.rangeHigh} inputMode="decimal" onChange={(e) => setRange('rangeHigh', e.target.value)} />
          </Field>
          <Field label="Tatsächliche Wohnfläche m²" hint="Vorbelegt mit der Fläche der Wohnung; maßgeblich ist die tatsächliche." {...errors.field('area')}>
            <input value={value.area} inputMode="decimal" onChange={(e) => set('area', e.target.value)} />
          </Field>
          <Field label={<>Verordnung zur <Term id="rentCap">Kappungsgrenze</Term></>} hint={RENT_CAP_HINT}>
            <select value={value.rentCap} onChange={(e) => {
              const found = rentCapOptions().find((o) => o.value === e.target.value)
              if (found) set('rentCap', found.value)
            }}>
              {rentCapOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {(tenancy.costModel === 'inclusive' || tenancy.heatingModel === 'inclusive') && (
            <Field label="Enthaltene Betriebskosten € je Monat" hint="Der Betrag, der tatsächlich auf die Wohnung entfällt, etwa aus der letzten Abrechnung." {...errors.field('operatingCosts')}>
              <input value={value.operatingCosts} inputMode="decimal" onChange={(e) => set('operatingCosts', e.target.value)} />
            </Field>
          )}
          {plan?.needs.includes('rentAtCapDate') || value.rentAtCapDate !== '' ? (
            <Field label={capDay ? `Miete am ${fmtDate(capDay)} €` : 'Miete am Stichtag €'} hint="Die Miete, die am Stichtag der Kappungsgrenze vereinbart war (bei jüngerem Mietverhältnis die Miete bei Mietbeginn). Ändert sich der Stichtag, fragt Mietfuchs neu." {...errors.field('rentAtCapDate')}>
              <input value={value.rentAtCapDate} inputMode="decimal" onChange={(e) => {
                const text = e.target.value
                setValue((old) => ({ ...old, rentAtCapDate: text, rentAtCapDateOn: capDay ?? '' }))
              }} />
            </Field>
          ) : null}
          <Field label="Verlangte Miete €" hint="Leer heißt der Höchstbetrag." {...errors.field('requested')}>
            <input value={value.requested} inputMode="decimal" onChange={(e) => set('requested', e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="field-grid">
          <MonthField label={<><Term id="indexRent">Ausgangsindex</Term>, Monat</>} value={value.fromMonth} placeholder="laut Staffel" onChange={(v) => set('fromMonth', v)} {...errors.field('fromMonth')} />
          <Field label="Ausgangsindex, Wert" {...errors.field('fromValue')}>
            <input value={value.fromValue} inputMode="decimal" onChange={(e) => set('fromValue', e.target.value)} />
          </Field>
          <Field label="Ausgangsindex, Basisjahr" {...errors.field('fromBase')}>
            <input value={value.fromBase} inputMode="numeric" placeholder={CURRENT_INDEX_BASE} onChange={(e) => set('fromBase', e.target.value)} />
          </Field>
          <MonthField label="Neuer Index, Monat" value={value.toMonth} onChange={(v) => set('toMonth', v)} {...errors.field('toMonth')} />
          <Field label="Neuer Index, Wert" {...errors.field('toValue')}>
            <input value={value.toValue} inputMode="decimal" placeholder="z. B. 106,1" onChange={(e) => set('toValue', e.target.value)} />
          </Field>
          <Field label="Neuer Index, Basisjahr" {...errors.field('toBase')}>
            <input value={value.toBase} inputMode="numeric" placeholder={CURRENT_INDEX_BASE} onChange={(e) => set('toBase', e.target.value)} />
          </Field>
        </div>
      )}

      <section aria-label="Rechnung" aria-live="polite" className="grid gap-2">
        <h3>Rechnung</h3>
        {note && <p className="muted">{note}</p>}
        {!note && !plan && <p className="muted">Mietfuchs rechnet …</p>}
        {plan && <RentIncreasePlanView plan={plan} />}
      </section>

      {plan && plan.state !== 'blocked' && plan.newCents !== null && (
        <LetterInputs kind={value.kind} letter={letter} setL={setL} setLetter={setLetter} errors={errors} plan={plan}
          busy={saving.busy} onCreate={() => void saving.run(createDraft)} />
      )}

      <section aria-label="Verlangen und Erklärungen" className="grid gap-2">
        <h3>Verlangen und Erklärungen</h3>
        {increases === null && <p className="muted">Mietfuchs lädt …</p>}
        {increases?.length === 0 && <p className="muted">Für dieses Mietverhältnis ist noch kein Schreiben angelegt.</p>}
        {increases?.map((x) => (
          <IncreaseItem key={x.id} x={x} busy={saving.busy} landlord={landlord} onPrint={() => void print(x)}
            onSend={(receivedOn) => void saving.run(() => send(x, receivedOn))}
            onDecide={(decision, agreedCents, decidedOn) => void saving.run(() => decide(x, decision, agreedCents, decidedOn))}
            onDelete={() => void saving.run(() => remove(x))} />
        ))}
      </section>
      {printing && <RentIncreasePrint increase={printing} propertyId={property?.id ?? unit?.propertyId} onDone={() => setPrinting(null)} />}
    </Drawer>
  )
}

// Die Rechnung: Zustand als Wort, Daten, Warnungen, Herleitung und Gründe. Auch auf der Musterseite.
export function RentIncreasePlanView({ plan }: { plan: RentIncreasePlan }) {
  return (
    <>
      <p className="m-0">
        <span className={`badge ${STATE_BADGE[plan.state]}`} data-rent-increase-state={plan.state}>{RENT_INCREASE_STATE_LABELS[plan.state]}</span>
        {plan.newCents !== null && plan.currentCents !== null && <> {fmtEuro(plan.currentCents)} → <strong>{fmtEuro(plan.newCents)}</strong></>}
      </p>
      <dl className="grid gap-1">
        {plan.earliestReceivedOn && <div><dt className="muted">Frühester Zugang</dt><dd>{fmtDate(plan.earliestReceivedOn)}</dd></div>}
        {plan.effectiveFrom && <div><dt className="muted">Wirksam ab</dt><dd>{monthLabel(plan.effectiveFrom)}</dd></div>}
        {plan.consent && (
          <div>
            <dt className="muted"><Term id="consentPeriod">Zustimmungsfrist</Term></dt>
            <dd>
              bis {fmtDate(plan.consent.consentEnd)}
              {/* Durchsicht K4: das verlängerte Ende, wenn es abweicht; ob § 193 BGB hier greift, ist offen (Gründe). */}
              {plan.consent.consentEndOnWorkday !== plan.consent.consentEnd && <>, nach § 193 BGB bis {fmtDate(plan.consent.consentEndOnWorkday)} (Ende an Wochenende oder Feiertag)</>}
              ; Klage ab {fmtDate(plan.consent.suitFrom)} bis {fmtDate(plan.consent.suitEnd)}
            </dd>
          </div>
        )}
        {plan.maxCents !== null && plan.kind === 'comparison' && <div><dt className="muted">Höchstbetrag</dt><dd>{fmtEuro(plan.maxCents)}</dd></div>}
      </dl>
      {plan.warnings.map((w, i) => <NoticeBox key={i} level="warning">{w}</NoticeBox>)}
      {plan.steps.length > 0 && (
        <details>
          <summary>Herleitung</summary>
          <ol className="calc-steps-list">
            {plan.steps.map((s, i) => <li key={i}><span className="muted">{s.label}:</span> {s.value}</li>)}
          </ol>
        </details>
      )}
      {plan.staggered && (
        <details>
          <summary>Stufen der Staffelmiete</summary>
          <ul>
            {plan.staggered.steps.map((s) => <li key={s.from}>ab {monthLabel(s.from)}: {fmtEuro(s.cents)}</li>)}
          </ul>
          {plan.staggered.notes.map((n, i) => <p key={i} className="muted">{n}</p>)}
        </details>
      )}
      <ul className="grid gap-1">
        {plan.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </>
  )
}

// Die Eingaben für das Schreiben (PR 3): Begründungsmittel mit seinen Angaben, die Frage nach dem qualifizierten
// Mietspiegel (§ 558a Abs. 3 BGB), Empfänger mit den Bestätigungen zu Vermietern und Mietern, Zusatzabsatz.
function LetterInputs({ kind, letter, setL, setLetter, errors, plan, busy, onCreate }: {
  kind: RentIncreasePlan['kind']
  letter: RentLetterValue
  setL: <K extends keyof RentLetterValue>(key: K, v: RentLetterValue[K]) => void
  setLetter: (f: (old: RentLetterValue) => RentLetterValue) => void
  errors: ReturnType<typeof useFormError<string>>
  plan: RentIncreasePlan
  busy: boolean
  onCreate: () => void
}) {
  const checked = rentLetterInput(letter, kind)
  const warnings = 'body' in checked ? rentLetterWarnings(checked.body, plan, localToday()) : []
  const survey = (at: 'survey' | 'qualified', s: RentSurveyValue, title: string) => {
    const setS = (k: keyof RentSurveyValue, v: string) => setLetter((old) => ({ ...old, [at]: { ...old[at], [k]: v } }))
    return (
      <fieldset className="grid gap-2">
        <legend>{title}</legend>
        <div className="field-grid">
          <Field label="Name" width="l" {...errors.field(`${at}.name`)}><input value={s.name} placeholder="Mietspiegel der Stadt …" onChange={(e) => setS('name', e.target.value)} /></Field>
          <MonthField label="Stand" value={s.asOf} onChange={(v) => setS('asOf', v)} {...errors.field(`${at}.asOf`)} />
          <Field label="Feld bzw. Einordnung der Wohnung" width="full" {...errors.field(`${at}.field`)}><input value={s.field} onChange={(e) => setS('field', e.target.value)} /></Field>
          <Field label="Spanne von €/m²" {...errors.field(`${at}.range`)}><input value={s.low} inputMode="decimal" onChange={(e) => setS('low', e.target.value)} /></Field>
          <Field label="Spanne bis €/m²"><input value={s.high} inputMode="decimal" onChange={(e) => setS('high', e.target.value)} /></Field>
          <Field label="Wo allgemein zugänglich" width="l" hint="Etwa die Internetadresse. Leer heißt: Der Mietspiegel liegt dem Schreiben bei." {...errors.field(`${at}.availableAt`)}>
            <input value={s.availableAt} onChange={(e) => setS('availableAt', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    )
  }
  return (
    <section aria-label="Schreiben" className="grid gap-2">
      <h3>Schreiben</h3>
      {kind === 'comparison' && (
        <>
          <div className="field-grid">
            <Field label={<Term id="rentJustification">Begründungsmittel</Term>} {...errors.field('justification')}>
              <select value={letter.justification} onChange={(e) => {
                const found = justificationOptions().find((o) => o.value === e.target.value)
                if (found) setL('justification', found.value)
              }}>
                {justificationOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={<>Gibt es für die Gemeinde einen <Term id="qualifiedRentSurvey">qualifizierten Mietspiegel</Term>?</>} required
              hint="Seine Angaben gehören in jedes Schreiben, auch wenn Sie anders begründen (§ 558a Abs. 3 BGB)." {...errors.field('qualifiedSurvey')}>
              <select value={letter.qualifiedSurvey} onChange={(e) => {
                const found = qualifiedSurveyOptions().find((o) => o.value === e.target.value)
                if (found) setL('qualifiedSurvey', found.value)
              }}>
                {qualifiedSurveyOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          {letter.justification === 'survey' && survey('survey', letter.survey, letter.qualifiedSurvey === 'yes' ? 'Qualifizierter Mietspiegel' : 'Mietspiegel')}
          {letter.justification !== 'survey' && letter.qualifiedSurvey === 'yes' && survey('qualified', letter.qualified, 'Angaben des qualifizierten Mietspiegels')}
          {letter.justification === 'expert' && (
            <div className="field-grid">
              <Field label="Sachverständiger" width="l" hint="Öffentlich bestellt und vereidigt; das Gutachten liegt dem Schreiben bei." {...errors.field('expert.name')}><input value={letter.expertName} onChange={(e) => setL('expertName', e.target.value)} /></Field>
              <Field label="Datum des Gutachtens" {...errors.field('expert.date')}><input type="date" value={letter.expertDate} onChange={(e) => setL('expertDate', e.target.value)} /></Field>
            </div>
          )}
          {letter.justification === 'database' && (
            <div className="field-grid">
              <Field label="Mietdatenbank" width="l" {...errors.field('database.name')}><input value={letter.databaseName} onChange={(e) => setL('databaseName', e.target.value)} /></Field>
              <Field label="Datum der Auskunft" {...errors.field('database.date')}><input type="date" value={letter.databaseDate} onChange={(e) => setL('databaseDate', e.target.value)} /></Field>
            </div>
          )}
          {letter.justification === 'comparables' && letter.comparables.map((c, i) => {
            const setC = (k: keyof typeof c, v: string) => setLetter((old) => ({ ...old, comparables: old.comparables.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))
            return (
              <fieldset key={i} className="grid gap-2" {...(i === 0 ? errors.field('comparables') : {})}>
                <legend>Vergleichswohnung {i + 1}</legend>
                <div className="field-grid">
                  <Field label="Anschrift" width="l" {...errors.field(`comparables.${i}.address`)}><input value={c.address} onChange={(e) => setC('address', e.target.value)} /></Field>
                  <Field label="Geschoss, Lage" width="m" {...errors.field(`comparables.${i}.location`)}><input value={c.location} placeholder="2. OG links" onChange={(e) => setC('location', e.target.value)} /></Field>
                  <Field label="Fläche m²" {...errors.field(`comparables.${i}.areaM2`)}><input value={c.area} inputMode="decimal" onChange={(e) => setC('area', e.target.value)} /></Field>
                  <Field label="Miete je m² €" {...errors.field(`comparables.${i}.centsPerM2`)}><input value={c.perM2} inputMode="decimal" onChange={(e) => setC('perM2', e.target.value)} /></Field>
                </div>
              </fieldset>
            )
          })}
        </>
      )}
      <Field label="Empfänger" width="l" hint={PARTIES_HINT} {...errors.field('recipientName')}>
        <input value={letter.recipientName} onChange={(e) => setL('recipientName', e.target.value)} />
      </Field>
      <label className="checkline">
        <input type="checkbox" checked={letter.severalLandlords} onChange={(e) => setL('severalLandlords', e.target.checked)} />
        <span>{SEVERAL_LANDLORDS_LABEL}</span>
      </label>
      <label className="checkline">
        <input type="checkbox" checked={letter.allLandlordsNamed} onChange={(e) => setL('allLandlordsNamed', e.target.checked)} />
        <span>Im Briefkopf sind alle Vermieter laut Mietvertrag genannt.</span>
      </label>
      {errors.field('allLandlordsNamed').error && <p className="muted">{errors.field('allLandlordsNamed').error}</p>}
      <label className="checkline">
        <input type="checkbox" checked={letter.allTenantsNamed} onChange={(e) => setL('allTenantsNamed', e.target.checked)} />
        <span>Als Empfänger sind alle Mieter laut Mietvertrag genannt.</span>
      </label>
      {errors.field('allTenantsNamed').error && <p className="muted">{errors.field('allTenantsNamed').error}</p>}
      <Field label="Zusatzabsatz" hint={EXTRA_PARAGRAPH_HINT} {...errors.field('extraParagraph')}>
        <textarea rows={3} value={letter.extraParagraph} onChange={(e) => setL('extraParagraph', e.target.value)} />
      </Field>
      {warnings.map((w, i) => <NoticeBox key={i} level="warning">{w}</NoticeBox>)}
      <div className="flex gap-2">
        <button type="button" className="btn secondary" disabled={busy} onClick={onCreate}>Schreiben als Entwurf anlegen</button>
      </div>
    </section>
  )
}

// Ein Verlangen der Liste: Stand, Beträge, Fristen, Schreiben zum Ansehen und Drucken (aus `basis`), Versand mit Zugang,
// Antwort des Mieters mit Tag und bei teilweiser Zustimmung dem Betrag.
function IncreaseItem({ x, busy, landlord, onPrint, onSend, onDecide, onDelete }: {
  x: RentIncreaseView
  busy: boolean
  landlord: Pick<EffectiveLandlord, 'landlordName' | 'landlordAddress'> | null
  onPrint: () => void
  onSend: (receivedOn: string) => void
  onDecide: (decision: RentIncreaseDecision, agreedCents: number | null, decidedOn: string) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [receivedOn, setReceivedOn] = useState(() => localToday())
  const [decidedOn, setDecidedOn] = useState(() => localToday())
  const [agreed, setAgreed] = useState('')
  const decisions = rentIncreaseDecisions(x)
  const previewId = `rent-letter-${x.id}`
  const agreedCents = agreed.trim() === '' ? null : parseEuro(agreed)
  const head = (
    <p className="m-0">
      <strong>{RENT_INCREASE_STATUS_LABELS[x.status]}</strong>
      {' · '}{x.kind === 'index' ? 'Indexmiete' : 'Vergleichsmiete'}: {fmtEuro(x.fromCents)} → {fmtEuro(x.status === 'partial' && x.agreedCents !== null ? x.agreedCents : x.toCents)} ab {monthLabel(x.effectiveFrom)}
      {x.receivedOn && <>{' · '}Zugang am {fmtDate(x.receivedOn)}</>}
    </p>
  )
  // Eine Grundlage aus einer anderen Fassung (Durchsicht K1): nur der Satz, kein Schreiben, keine Antwort; löschen geht.
  const foreign = rentIncreaseBasisProblem(x.basis)
  if (foreign) {
    return (
      <article className="card grid gap-2" aria-label={`Verlangen ab ${monthLabel(x.effectiveFrom)}`}>
        {head}
        <NoticeBox level="warning">{foreign}</NoticeBox>
        {x.status === 'draft' && <div className="flex gap-2"><button type="button" className="btn ghost danger-ghost ml-auto" disabled={busy} onClick={onDelete}>Entwurf löschen …</button></div>}
      </article>
    )
  }
  // Fristen nach dem tatsächlichen Zugang; das Schreiben selbst rechnet mit dem Zugang des Entwurfs (Durchsicht M1).
  const consent = (x.basis.sentPlan ?? x.basis.plan).consent
  const plannedOn = x.basis.plan.receivedOn
  const early = notYetNote(x)
  const otherSender = x.status !== 'withdrawn' ? senderNote(x.basis.sender, landlord) : null
  return (
    <article className="card grid gap-2" aria-label={`${x.kind === 'index' ? 'Indexanpassung' : 'Verlangen'} ab ${monthLabel(x.effectiveFrom)}`}>
      {head}
      {x.status === 'sent' && x.kind === 'comparison' && consent && <p className="m-0">Zustimmungsfrist bis {fmtDate(consent.consentEndOnWorkday)}</p>}
      {x.receivedOn && x.receivedOn !== plannedOn && x.kind === 'comparison' && (
        <p className="m-0 muted">Das Schreiben rechnet mit dem Zugang am {fmtDate(plannedOn)}; Ende der Zustimmungsfrist und Monat der neuen Miete sind beim tatsächlichen Zugang dieselben.</p>
      )}
      {early && <NoticeBox level="warning">{early}</NoticeBox>}
      {otherSender && <NoticeBox level="warning">{otherSender}</NoticeBox>}
      <div className="flex gap-2 flex-wrap">
        <DisclosureButton open={open} onToggle={() => setOpen(!open)} closedLabel="Schreiben ansehen" openLabel="Schreiben schließen" controls={previewId} className="btn secondary" />
        <button type="button" className="btn secondary" disabled={busy} onClick={onPrint}>Drucken</button>
        {x.status === 'draft' && <button type="button" className="btn ghost danger-ghost ml-auto" disabled={busy} onClick={onDelete}>Entwurf löschen …</button>}
      </div>
      {open && <div id={previewId}><RentIncreaseLetterSheet increase={x} /></div>}
      {x.status === 'draft' && (
        <div className="field-grid">
          <Field label="Zugang beim Mieter" hint="Der Tag, an dem das Schreiben angekommen ist.">
            <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <div className="flex items-end"><button type="button" className="btn secondary" disabled={busy} onClick={() => onSend(receivedOn)}>Als versendet speichern …</button></div>
        </div>
      )}
      {decisions.length > 0 && (
        <>
          <div className="field-grid">
            <Field label={x.kind === 'index' ? 'Tag' : 'Tag der Antwort'}>
              <input type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} />
            </Field>
            {decisions.includes('partial') && (
              <Field label="Zugestimmte Miete €" hint="Nur bei teilweiser Zustimmung.">
                <input value={agreed} inputMode="decimal" onChange={(e) => setAgreed(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {decisions.filter((d) => d !== 'withdrawn').map((d) => (
              <button key={d} type="button" className="btn secondary" disabled={busy} onClick={() => onDecide(d, d === 'partial' ? agreedCents : null, decidedOn)}>{DECISION_LABELS[d]}</button>
            ))}
            {decisions.includes('withdrawn') && <button type="button" className="btn ghost danger-ghost ml-auto" disabled={busy} onClick={() => onDecide('withdrawn', null, decidedOn)}>Zurücknehmen …</button>}
          </div>
        </>
      )}
    </article>
  )
}
