// Seitenfenster „Mieterhöhung“ (#191, PR 2), geöffnet aus dem Mietverhältnis in den Stammdaten. Es rechnet nur: Der
// Server sagt zu den Eingaben, ob, wann und um wie viel die Miete steigen darf (server/src/rentIncrease.ts), mit Gründen,
// Herleitung und Warnungen. Gespeichert wird nichts; Schreiben und Übernahme in die Staffel kommen mit PR 3. Die
// Formularlogik steht in rentIncreaseForm.ts, hier wird nur gerendert.
import { useEffect, useRef, useState } from 'react'
import type { Property, RentIncreasePlan, Tenancy, Unit } from '../types'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { monthLabel } from '../monthText'
import { RENT_CAP_HINT, RENT_INCREASE_STATE_LABELS, rentCapOptions, rentIncreaseKindOptions, rentIncreaseRequest, rentIncreaseStart, type RentIncreaseField, type RentIncreaseValue } from '../rentIncreaseForm'
import { CURRENT_INDEX_BASE, RENT_KIND_LABELS } from '../rentKindForm'
import Drawer from './Drawer'
import Field from './Field'
import MonthField from './MonthField'
import Term from './Term'
import { NoticeBox } from './Notice'
import { useFormError } from './ErrorSummary'

// Wartezeit nach der letzten Eingabe, bevor neu gerechnet wird.
const PLAN_DELAY_MS = 250
const STATE_BADGE = { possible: 'green', notYet: 'amber', blocked: 'red' } as const

export default function RentIncreaseDrawer({ tenancy, unit, property, onClose }: {
  tenancy: Tenancy
  unit: Unit | undefined
  property: Property | null | undefined
  onClose: () => void
}) {
  const [value, setValue] = useState<RentIncreaseValue>(() => rentIncreaseStart(tenancy, unit, property))
  const [plan, setPlan] = useState<RentIncreasePlan | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const errors = useFormError<RentIncreaseField>()
  const seq = useRef(0)
  const set = <K extends keyof RentIncreaseValue>(key: K, v: RentIncreaseValue[K]) => setValue((old) => ({ ...old, [key]: v }))

  // Die Rechnung folgt dem Zustand des Fensters; jede Änderung verwirft die alte (Folgenummer gegen späte Antworten).
  useEffect(() => {
    const n = ++seq.current
    setPlan(null)
    errors.clear()
    const built = rentIncreaseRequest(value)
    if ('problems' in built) {
      setNote(built.problems.map((p) => p.text).join(' '))
      return
    }
    setNote(null)
    const timer = setTimeout(() => {
      api<RentIncreasePlan>(`/api/tenancies/${tenancy.id}/rent-increase/plan`, { method: 'POST', body: JSON.stringify(built.body) })
        .then((p) => { if (n === seq.current) setPlan(p) })
        .catch((e: unknown) => { if (n === seq.current) errors.set(errorText(e), { focus: false }) })
    }, PLAN_DELAY_MS)
    return () => clearTimeout(timer)
    // `errors` ändert sich mit jeder Meldung; neu gerechnet wird nur bei geänderten Eingaben.
  }, [value, tenancy.id])

  const current = [...tenancy.baseRents].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).at(-1)
  const comparison = value.kind === 'comparison'
  return (
    <Drawer open title={`Mieterhöhung: ${tenancy.tenantName}`} width={640} cancelLabel="Schließen" hint="Esc schließt"
      onClose={onClose} value={value} errors={errors}>
      <p className="m-0">
        Art der Miete: {tenancy.rentKind ? RENT_KIND_LABELS[tenancy.rentKind] : 'nicht angegeben'}
        {current && <> · bisher {fmtEuro(current.monthlyCents)} ab {monthLabel(current.from)}</>}.
        {' '}Mietfuchs rechnet hier nur; gespeichert wird nichts.
      </p>

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
            <input value={value.rangeLow} inputMode="decimal" onChange={(e) => set('rangeLow', e.target.value)} />
          </Field>
          <Field label="Spanne bis €/m²" {...errors.field('rangeHigh')}>
            <input value={value.rangeHigh} inputMode="decimal" onChange={(e) => set('rangeHigh', e.target.value)} />
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
            <Field label="Miete am Stichtag €" hint="Die Miete, die am Stichtag der Kappungsgrenze vereinbart war (bei jüngerem Mietverhältnis die Miete bei Mietbeginn)." {...errors.field('rentAtCapDate')}>
              <input value={value.rentAtCapDate} inputMode="decimal" onChange={(e) => set('rentAtCapDate', e.target.value)} />
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
            <dd>bis {fmtDate(plan.consent.consentEnd)}; Klage ab {fmtDate(plan.consent.suitFrom)} bis {fmtDate(plan.consent.suitEnd)}</dd>
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
