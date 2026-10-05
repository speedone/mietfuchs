// Die Karte „CO₂-Kosten“ einer Heizperiode (Heizung PR 6, Entwurf 11.3). Die Logik steht in
// co2Form.ts; hier wird nur gezeigt und gespeichert.
import { useState, type ReactNode } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_QUESTION, co2Body, co2ToForm, probeLine, type Co2Form } from '../co2Form'
import type { HeatingPeriodView, Tenancy } from '../types'

type TextKey = 'usersTotal' | 'vacancyTotal' | 'kgPerM2' | 'emissionsKg' | 'serviceArea' | 'landlordPercent' | 'totalCo2' | 'landlordCo2' | 'selfLandlord' | 'unitsCount' | 'fuelGross' | 'fuelNet'

export default function Co2Card({ view, tenancies, unitsCount, onSaved }: { view: HeatingPeriodView; tenancies: Tenancy[]; unitsCount: number; onSaved: () => void }) {
  const ctx = { items: view.items, unitsCount }
  const [form, setForm] = useState<Co2Form>(() => co2ToForm(view.co2, ctx))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const set = <K extends keyof Co2Form>(key: K, value: Co2Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const probe = probeLine(form, ctx)
  const serviceItems = view.items.filter((i) => i.key === 'amounts')
  const billed = tenancies.filter((t) => serviceItems.some((i) => (i.tenancyAmounts?.[t.id] ?? 0) > 0))
  const service = form.answer === 'deducted' || form.answer === 'shown'
  const url = `/api/heating-plants/${view.plantId}/periods/${view.period}/co2`

  async function save() {
    const r = co2Body(form, ctx)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setBusy(true)
    try {
      await api(url, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('CO₂-Angaben gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'CO₂-Angaben entfernen?',
      message: 'Die Abrechnung rechnet diese Heizperiode dann wieder ohne CO₂-Aufteilung.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(url, { method: 'DELETE' })
      toast('CO₂-Angaben entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const text = (key: TextKey, label: string, term?: ReactNode) => (
    <label className="field">
      {label}{term}
      <input value={form[key]} inputMode="decimal" disabled={view.closed} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2>CO₂-Kosten <Term id="co2Split" /></h2>
      {view.closed && <p className="muted">Diese Heizperiode ist abgeschlossen; die Angaben lassen sich nicht mehr ändern.</p>}
      <label className="field">
        {CO2_QUESTION}
        <select
          aria-label="Abzugszeile"
          value={form.answer}
          disabled={view.closed}
          onChange={(e) => set('answer', CO2_ANSWER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}
        >
          {CO2_ANSWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <p className="muted">{CO2_EXAMPLE} <Term id="co2Deducted" /></p>
      {form.answer === 'unsplit' && (
        <p className="notice">Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten kürzen; die Abrechnung nennt die Beträge. Bitten Sie den Messdienst um eine Abrechnung mit CO₂-Aufteilung.</p>
      )}
      {service && (
        <>
          <div className="row">
            {form.usersTotalApprox ? text('vacancyTotal', 'Beträge leerer oder nicht eingetragener Einheiten') : text('usersTotal', 'Summe der Kosten aller Nutzer')}
            <label className="field">
              <input type="checkbox" checked={form.usersTotalApprox} disabled={view.closed} onChange={(e) => set('usersTotalApprox', e.target.checked)} />
              Ich finde diese Zeile nicht
            </label>
            {text('unitsCount', 'Nutzeinheiten laut Abrechnung', <> <Term id="serviceUnits" /></>)}
          </div>
          {!form.usersTotalApprox && (
            <p className="muted">
              Die gedruckte Summe für Heizung und Warmwasser aller Nutzer, bei einer Abzugszeile nach dem Abzug. Bei Techem heißt die Zeile
              „Summe der Nutzerkosten Heizungsanlage“; bei anderen Messdiensten steht sie in der Kostenaufstellung unter der Verteilung.
            </p>
          )}
          <div className="row">
            {text('kgPerM2', 'CO₂-Ausstoß je m² und Jahr (kg)', <> <Term id="co2Stage" /></>)}
            {text('emissionsKg', 'CO₂-Ausstoß insgesamt laut Abrechnung (kg)')}
            {text('serviceArea', 'Wohnfläche laut Abrechnung (m²)', <> <Term id="co2Area" /></>)}
            {text('landlordPercent', 'Anteil des Vermieters (%)')}
            {text('totalCo2', 'CO₂-Kosten insgesamt')}
            {text('landlordCo2', 'davon Vermieter')}
            {form.answer === 'deducted' && text('selfLandlord', 'davon für Ihre Wohnung')}
          </div>
          {serviceItems.length > 1 && (
            <label className="field">
              Position mit dem CO₂-Anteil
              <select value={form.costItemId} disabled={view.closed} onChange={(e) => set('costItemId', e.target.value)}>
                <option value="">die größte Position</option>
                {serviceItems.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}
              </select>
            </label>
          )}
          {billed.length > 0 && (
            <div className="field-group">
              <div className="field-group-label">vom Vermieter übernommen, je Mieter (wenn die Abrechnung es nennt)</div>
              {billed.map((t) => (
                <label className="field" key={t.id}>
                  {t.tenantName}
                  <input value={form.reliefs[t.id] ?? ''} inputMode="decimal" disabled={view.closed} onChange={(e) => set('reliefs', { ...form.reliefs, [t.id]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <details>
            <summary>Weitere Angaben</summary>
            <div className="row">
              {text('fuelGross', 'Brennstoffkosten laut Abrechnung (vor Abzug)')}
              {text('fuelNet', 'davon verteilt')}
            </div>
          </details>
          {probe && <div className={probe.ok ? 'hint' : 'error'}>Probe: {probe.text}</div>}
        </>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void save()}>CO₂-Angaben speichern</button>
          {view.co2 && <button className="btn secondary" onClick={() => void remove()}>CO₂-Angaben entfernen</button>}
        </div>
      )}
    </div>
  )
}
