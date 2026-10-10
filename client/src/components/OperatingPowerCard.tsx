// Karte „Betriebsstrom“ auf der Seite Heizkosten (Heizung PR 15, #212): Schätzung nach Leistung und
// Heiztagen, gemessen oder selbst geschätzt, Vorschau, und Betriebsstrom samt Abzug mit einem Klick.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { emptyOperatingPowerForm, generalItemOptions, operatingPowerPreview, operatingPowerRequest } from '../operatingPowerForm'
import { operatingPowerRefusal } from '../../../shared/operatingPower.ts'
import { useToast } from './feedback'
import Term from './Term'
import type { CostItem, HeatingPeriodView, HeatingPlant } from '../types'

export default function OperatingPowerCard({ plant, view, items, onBooked }: {
  plant: Pick<HeatingPlant, 'id' | 'method' | 'energy'>; view: Pick<HeatingPeriodView, 'period' | 'label' | 'closed'>; items: readonly CostItem[]; onBooked: () => void
}) {
  const [form, setForm] = useState(emptyOperatingPowerForm)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  // P-W5, R2-W1: Bei Wärmepumpe und Stromheizung ist der Strom des Erzeugers Brennstoff; die Karte sagt
  // das, nennt den Weg für Pumpen und Regelung und rechnet nichts.
  const refusal = operatingPowerRefusal(plant.energy)
  if (refusal) {
    return (
      <section className="card">
        <h2><Term id="operatingPower">Betriebsstrom</Term></h2>
        <p>{refusal}</p>
      </section>
    )
  }
  const preview = operatingPowerPreview(form, items)
  const service = plant.method === 'service'
  const setDevice = (i: number, key: 'label' | 'watts' | 'hours' | 'days', value: string) =>
    setForm({ ...form, devices: form.devices.map((d, k) => (k === i ? { ...d, [key]: value } : d)) })

  async function book() {
    setBusy(true)
    try {
      await api(`/api/heating-plants/${plant.id}/operating-power`, { method: 'POST', body: JSON.stringify(operatingPowerRequest(form, String(view.period))) })
      toast(service
        ? 'Der Abzug beim Allgemeinstrom ist angelegt. Melden Sie denselben Betrag Ihrem Messdienst als Betriebsstrom.'
        : 'Betriebsstrom und Abzug beim Allgemeinstrom sind angelegt.')
      setForm(emptyOperatingPowerForm())
      onBooked()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const what = service ? 'Abzug' : 'Betriebsstrom und Abzug'
  return (
    <section className="card">
      <h2><Term id="operatingPower">Betriebsstrom</Term></h2>
      {/* P-K1: Rechtsaussage mit Norm; P-K5: selbst tragen ist zulässig. */}
      <p>
        Läuft der Strom für Brenner, Umwälzpumpe und Regelung über den Stromzähler des Hauses, gehört er zu den Heiz- und Warmwasserkosten
        oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen und ist dort abzuziehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15).
        {service
          ? ' Mietfuchs rechnet den Anteil an der Stromrechnung und legt den Abzug an; denselben Betrag melden Sie Ihrem Messdienst als Betriebsstrom.'
          : ' Mietfuchs rechnet den Anteil an der Stromrechnung und legt beide Positionen an.'}
      </p>
      {/* P-W1 */}
      <p className="hint">
        Mietfuchs speichert Ihre Angaben als Grundlage der Schätzung an {service ? 'der Position' : 'beiden Positionen'}. Bewahren Sie Typenschilder und Rechnungen auf: Bestreitet ein Mieter
        den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
      </p>
      <label className="field">
        <span>Stromrechnung des Hauses</span>
        <select value={form.generalItemId} disabled={view.closed} onChange={(e) => setForm({ ...form, generalItemId: e.target.value })}>
          {generalItemOptions(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {form.mode !== 'own' && (
        <label className="field"><span>kWh laut Stromrechnung</span><input inputMode="decimal" value={form.billKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, billKwh: e.target.value })} /></label>
      )}
      <fieldset>
        <legend>Wie bestimmen Sie den Betriebsstrom?</legend>
        <label><input type="radio" checked={form.mode === 'estimate'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'estimate' })} /> geschätzt nach Leistung und Heiztagen</label>
        <label><input type="radio" checked={form.mode === 'measured'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'measured' })} /> gemessen mit Zwischenzähler</label>
        {/* P-W2: dritter Weg, ohne vorgegebenen Prozentsatz. */}
        <label><input type="radio" checked={form.mode === 'own'} disabled={view.closed} onChange={() => setForm({ ...form, mode: 'own' })} /> Betrag selbst geschätzt</label>
      </fieldset>
      {form.mode === 'estimate' && (
        <>
          {form.devices.map((d, i) => (
            <div key={i} className="row">
              <label className="field"><span>Gerät</span><input value={d.label} disabled={view.closed} onChange={(e) => setDevice(i, 'label', e.target.value)} /></label>
              <label className="field"><span>Leistung (W)</span><input inputMode="decimal" value={d.watts} disabled={view.closed} onChange={(e) => setDevice(i, 'watts', e.target.value)} /></label>
              <label className="field"><span>Stunden je Tag</span><input inputMode="decimal" value={d.hours} disabled={view.closed} onChange={(e) => setDevice(i, 'hours', e.target.value)} /></label>
              {/* P-K8: eigene Tage je Gerät, leer heißt die Heiztage. */}
              <label className="field"><span>Tage (leer: Heiztage)</span><input inputMode="numeric" value={d.days} disabled={view.closed} onChange={(e) => setDevice(i, 'days', e.target.value)} /></label>
            </div>
          ))}
          <button type="button" className="btn" disabled={view.closed} onClick={() => setForm({ ...form, devices: [...form.devices, { label: '', watts: '', hours: '', days: '' }] })}>+ Gerät</button>
          <label className="field"><span>Heiztage</span><input inputMode="numeric" value={form.heatingDays} disabled={view.closed} onChange={(e) => setForm({ ...form, heatingDays: e.target.value })} /></label>
          <p className="hint">
            Die Leistung steht auf dem Typenschild. Die Umwälzpumpe der Heizung läuft nur in der Heizzeit; eine Pumpe für das Warmwasser läuft auch im Sommer.
            Tragen Sie dann bei diesem Gerät eigene Tage ein. Wurde der Kessel im Jahr getauscht, legen Sie den Betriebsstrom zweimal an, je mit den Tagen des
            alten und des neuen Kessels, oder nehmen Sie den Zwischenzähler.
          </p>
        </>
      )}
      {form.mode === 'measured' && (
        <label className="field"><span>gemessene kWh</span><input inputMode="decimal" value={form.measuredKwh} disabled={view.closed} onChange={(e) => setForm({ ...form, measuredKwh: e.target.value })} /></label>
      )}
      {form.mode === 'own' && (
        <>
          <label className="field"><span>geschätzter Betrag (€)</span><input inputMode="decimal" value={form.ownAmount} disabled={view.closed} onChange={(e) => setForm({ ...form, ownAmount: e.target.value })} /></label>
          <label className="field"><span>Grundlage der Schätzung</span><textarea rows={3} value={form.basis} disabled={view.closed} onChange={(e) => setForm({ ...form, basis: e.target.value })} /></label>
          <p className="hint">
            Der Bundesgerichtshof lässt als Schätzgrundlage auch einen Bruchteil der Brennstoffkosten zu; gemeint sind die Brennstoffkosten, nicht der
            Allgemeinstrom. Mietfuchs gibt keinen Prozentsatz vor; nennen Sie, wie Sie geschätzt haben.
          </p>
        </>
      )}
      {preview.ok ? (
        <ul className="calc-steps">{preview.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        <p className="hint">{preview.text}</p>
      )}
      <button type="button" className="btn" disabled={view.closed || busy || !preview.ok} onClick={book}>
        {preview.ok ? `${fmtEuro(preview.cents)} als ${what} anlegen` : `${what} anlegen`}
      </button>
    </section>
  )
}
