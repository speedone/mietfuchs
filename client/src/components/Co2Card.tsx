// Die Karte „CO₂-Kosten“ einer Heizperiode (Heizung PR 6, Entwurf 11.3). Die Logik steht in
// co2Form.ts; hier wird nur gezeigt und gespeichert.
import { useState, type ReactNode } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_NOT_A_SIGN, CO2_QUESTION, co2Body, co2ToForm, probeLine, type Co2Form } from '../co2Form'
import type { HeatingPeriodView, Tenancy } from '../types'

type TextKey = 'usersTotal' | 'vacancyTotal' | 'kgPerM2' | 'emissionsKg' | 'serviceArea' | 'landlordPercent' | 'totalCo2' | 'landlordCo2' | 'selfLandlord' | 'unitsCount' | 'fuelGross' | 'fuelNet'

// `hasSelfUsed` (Laienprobe B22): Nur wenn eine Wohnung des Objekts selbst bewohnt ist, gibt es das
// Feld für ihren CO₂-Anteil; im ganz vermieteten Haus hielt man es sonst für den eigenen Anteil.
export default function Co2Card({ view, tenancies, unitsCount, hasSelfUsed = false, onSaved }: { view: HeatingPeriodView; tenancies: Tenancy[]; unitsCount: number; hasSelfUsed?: boolean; onSaved: () => void }) {
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
    // Laienprobe B20: Geht die Probe nicht auf, wird nicht still gespeichert.
    if (probe && !probe.ok) {
      const ok = await confirm({
        title: 'Die Probe geht nicht auf',
        message: `${probe.text}. Solange die Probe nicht aufgeht, bucht Mietfuchs keine CO₂-Aufteilung, und die Abrechnung meldet einen Fehler. Prüfen Sie den Betrag der Position und Ihre Antwort auf die Frage nach der Abzugszeile. Trotzdem speichern?`,
        confirmLabel: 'Trotzdem speichern',
      })
      if (!ok) return
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
      <p className="muted">{CO2_NOT_A_SIGN}</p>
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
            {form.answer === 'deducted' && (hasSelfUsed || form.selfLandlord.trim() !== '') && text('selfLandlord', 'davon für Ihre selbst bewohnte Wohnung')}
          </div>
          {/* Laienprobe B21: die Berechnungsgrundlagen der Einstufung (§ 7 Abs. 3 CO2KostAufG). */}
          {(form.emissionsKg.trim() === '' || form.serviceArea.trim() === '') && (
            <p className="notice">
              Für den Ausweis in der Abrechnung mindestens nötig: der CO₂-Ausstoß insgesamt (kg) und die Wohnfläche aus der CO₂-Seite der Abrechnung.
              Aus ihnen ist der Wert je m² berechnet; die Abrechnung muss neben der Einstufung auch ihre Berechnungsgrundlagen nennen,
              sonst darf jeder Mieter seinen Anteil an den Heizkosten kürzen (§ 7 Abs. 3 und 4 CO2KostAufG). Ob ein Gericht weitere Angaben
              verlangt, ist nicht entschieden; legen Sie deshalb die Abrechnung des Messdienstes bei.
            </p>
          )}
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
              <div className="field-group-label">vom Vermieter übernommen, je Mieter</div>
              {/* Laienprobe B23: Ohne Angabe druckt Mietfuchs eine Näherung; maßgeblich ist der Messdienst. */}
              <p className="muted">
                Nennt die Einzelabrechnung eines Mieters einen Betrag „vom Vermieter übernommen“, tragen Sie ihn hier ein. Ohne Angabe
                rechnet Mietfuchs ihn näherungsweise nach dem Anteil an den Heizkosten, und der Ausdruck verweist auf die Einzelabrechnung
                des Messdienstes; deren Betrag ist maßgeblich.
              </p>
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
