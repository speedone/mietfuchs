// Die Karte „CO₂-Kosten“ einer Heizperiode (Heizung PR 6, Entwurf 11.3). Die Logik steht in
// co2Form.ts; hier wird nur gezeigt und gespeichert.
import { useState, type ReactNode } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { useOpenWhenDiffers } from '../useDraft'
import { CO2_ANSWER_OPTIONS, CO2_EXAMPLE, CO2_NOT_A_SIGN, CO2_QUESTION, co2Body, co2Labels, co2ToForm, probeLine, type Co2Form } from '../co2Form'
import type { HeatingPeriodView, Tenancy } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

type TextKey = 'usersTotal' | 'vacancyTotal' | 'kgPerM2' | 'emissionsKg' | 'serviceArea' | 'landlordPercent' | 'totalCo2' | 'landlordCo2' | 'selfLandlord' | 'unitsCount' | 'fuelGross' | 'fuelNet'

// `hasSelfUsed` (Laienprobe B22): Nur wenn eine Wohnung des Objekts selbst bewohnt ist, gibt es das
// Feld für ihren CO₂-Anteil; im ganz vermieteten Haus hielt man es sonst für den eigenen Anteil.
// `homeowners` (Abdeckung V14): Bei einer Eigentumswohnung rechnet die Gemeinschaft ab; gefragt ist der eigene Anteil.
export default function Co2Card({ view, tenancies, unitsCount, hasSelfUsed = false, homeowners = false, onSaved }: { view: HeatingPeriodView; tenancies: Tenancy[]; unitsCount: number; hasSelfUsed?: boolean; homeowners?: boolean; onSaved: () => void }) {
  const ctx = { items: view.items, unitsCount, homeowners }
  const labels = co2Labels(homeowners)
  const [form, setForm] = useState<Co2Form>(() => co2ToForm(view.co2, ctx))
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const [busy, setBusy] = useState(false)
  // Eine ungespeicherte Eingabe zählt als offenes Formular (#346, 7a), verglichen mit dem gespeicherten Stand.
  const markSaved = useOpenWhenDiffers(form, co2ToForm(view.co2, ctx))
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
      markSaved()
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

  // Sichtprüfung S5/E38: Ein Fachbegriff steht als Wort in der Beschriftung, nicht als zweite Zeile dahinter.
  const text = (key: TextKey, label: ReactNode) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} inputMode="decimal" disabled={view.closed} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2><Term id="co2Split">CO₂-Kosten</Term></h2>
      <ErrorSummary errors={errors} />
      {view.closed && <p className="muted">Diese Heizperiode ist abgeschlossen; die Angaben lassen sich nicht mehr ändern.</p>}
      <label className="field">
        {CO2_QUESTION}
        <select
          aria-label="Abzugszeile"
          value={form.answer}
          disabled={view.closed}
          onChange={(e) => set('answer', CO2_ANSWER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}
        >
          {CO2_ANSWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{homeowners && o.value === 'unsplit' ? 'Die Abrechnung der Gemeinschaft teilt die CO₂-Kosten gar nicht auf' : o.label}</option>)}
        </select>
      </label>
      <p className="muted">{CO2_EXAMPLE} · <Term id="co2Deducted">Was ist die Abzugszeile?</Term></p>
      <p className="muted">{CO2_NOT_A_SIGN}</p>
      {form.answer === 'unsplit' && (
        <p className="notice">Ohne Aufteilung darf jeder Mieter seinen Anteil an den Heizkosten kürzen; die Abrechnung nennt die Beträge. Bitten Sie {homeowners ? 'die Verwaltung der Gemeinschaft' : 'den Messdienst'} um eine Abrechnung mit CO₂-Aufteilung.</p>
      )}
      {service && (
        <>
          {/* Sichtprüfung E38: der Hilfetext unmittelbar unter seinem Feld, das Kästchen neben seiner Beschriftung */}
          <div className="row">
            {form.usersTotalApprox ? text('vacancyTotal', 'Beträge leerer oder nicht eingetragener Einheiten (€)') : text('usersTotal', labels.usersTotal)}
            <label className="field checkline">
              <span>
                <input type="checkbox" checked={form.usersTotalApprox} disabled={view.closed} onChange={(e) => set('usersTotalApprox', e.target.checked)} />
                Ich finde diese Zeile nicht
              </span>
            </label>
          </div>
          {!form.usersTotalApprox && (
            <small className="muted">{labels.usersTotalHelp}</small>
          )}
          <div className="row">
            {text('unitsCount', labels.unitsCount)}
          </div>
          <small className="muted">
            {(homeowners || !view.co2) && labels.unitsHelp}
            <Term id="serviceUnits">Was ist eine Nutzeinheit?</Term>
          </small>
          <div className="row">
            {text('kgPerM2', <>CO₂-Ausstoß je m² und Jahr (kg) für die <Term id="co2Stage">Einstufung</Term></>)}
            {text('emissionsKg', 'CO₂-Ausstoß insgesamt laut Abrechnung (kg)')}
            {text('serviceArea', <><Term id="co2Area">Wohnfläche</Term> laut Abrechnung (m²)</>)}
            {text('landlordPercent', 'Anteil des Vermieters (%)')}
            {text('totalCo2', 'CO₂-Kosten insgesamt (€)')}
            {text('landlordCo2', labels.landlordCo2)}
            {form.answer === 'deducted' && (hasSelfUsed || form.selfLandlord.trim() !== '') && text('selfLandlord', 'davon für Ihre selbst bewohnte Wohnung')}
          </div>
          {/* Laienprobe B21: die Berechnungsgrundlagen der Einstufung (§ 7 Abs. 3 CO2KostAufG). */}
          {(form.emissionsKg.trim() === '' || form.serviceArea.trim() === '') && (
            <p className="notice">
              Für den Ausweis in der Abrechnung mindestens nötig: der CO₂-Ausstoß insgesamt (kg) und die Wohnfläche aus der CO₂-Seite der Abrechnung.
              Aus ihnen ist der Wert je m² berechnet; die Abrechnung muss neben der Einstufung auch ihre Berechnungsgrundlagen nennen,
              sonst darf jeder Mieter seinen Anteil an den Heizkosten kürzen (§ 7 Abs. 3 und 4 CO2KostAufG). Ob ein Gericht weitere Angaben
              verlangt, ist nicht entschieden; legen Sie deshalb {homeowners ? 'die Einzelabrechnung (Heizung) Ihrer Wohnung' : 'die Abrechnung des Messdienstes'} bei.
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
                {homeowners ? ' (Heizung) Ihrer Wohnung' : ' des Messdienstes'}; deren Betrag ist maßgeblich.
              </p>
              {billed.map((t) => (
                <label className="field" key={t.id}>
                  {t.tenantName}
                  <input value={form.reliefs[t.id] ?? ''} inputMode="decimal" disabled={view.closed} onChange={(e) => set('reliefs', { ...form.reliefs, [t.id]: e.target.value })} />
                </label>
              ))}
            </div>
          )}
          <details className="extra-details">
            <summary>Weitere Angaben</summary>
            <div className="row">
              {text('fuelGross', 'Brennstoffkosten laut Abrechnung (vor Abzug)')}
              {text('fuelNet', 'davon verteilt')}
            </div>
          </details>
          {probe && <div className={probe.ok ? 'hint' : 'error'}>Probe: {probe.text}</div>}
        </>
      )}
      {!view.closed && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void save()}>CO₂-Angaben speichern</button>
          {view.co2 && <button className="btn ghost danger-ghost ml-auto" onClick={() => void remove()}>CO₂-Angaben entfernen …</button>}
        </div>
      )}
    </div>
  )
}
