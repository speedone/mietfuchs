// Die Karte „Lieferungen“ einer Heizperiode (Heizung PR 7, Entwurf 3.2, 5.4, 11.4): die Rechnungen des
// Versorgers, die in dieser Heizperiode enden, und bei freien Schlüsseln die Verknüpfung der Positionen.
// Mietfuchs teilt jede Rechnung auf die Heizperioden auf; die Abrechnung zeigt, wie.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { CO2_ENERGIES, deliveryLine, deliveryOptions, emptyFuelForm, fuelBody, fuelToForm, type FuelForm } from '../fuelForm'
import type { FuelDelivery, HeatingEnergy, HeatingMethod, HeatingPeriodView } from '../types'

type TextKey = Exclude<keyof FuelForm, 'usedByService'>

export default function FuelCard({ plant, view, deliveries, onSaved }: {
  plant: { id: string; method: HeatingMethod; energy?: HeatingEnergy }
  view: HeatingPeriodView
  deliveries: FuelDelivery[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FuelForm>(emptyFuelForm)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const service = plant.method === 'service'
  const set = <K extends keyof FuelForm>(key: K, value: FuelForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const options = deliveryOptions(deliveries)

  function open(d: FuelDelivery | null) {
    setForm(d ? fuelToForm(d) : emptyFuelForm())
    setEditing(d ? d.id : 'neu')
    setError('')
  }

  async function save() {
    const r = fuelBody(form, plant.method)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      if (editing === 'neu') await api(`/api/heating-plants/${plant.id}/deliveries`, { method: 'POST', body: JSON.stringify(r.body) })
      else await api(`/api/fuel-deliveries/${editing}`, { method: 'PUT', body: JSON.stringify(r.body) })
      setEditing(null)
      setError('')
      toast('Lieferung gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(d: FuelDelivery) {
    const ok = await confirm({
      title: 'Lieferung entfernen?',
      message: d.estimated ? 'Die Schätzung entfällt; die Abrechnung rechnet ohne sie.' : 'Verknüpfte Positionen bleiben stehen und werden dann ohne Abgrenzung verteilt.',
      confirmLabel: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })
      toast('Lieferung entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function link(itemId: string, deliveryId: string) {
    try {
      await api(`/api/costItems/${itemId}`, { method: 'PUT', body: JSON.stringify({ fuelDeliveryId: deliveryId === '' ? null : deliveryId }) })
      setError('')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const text = (key: TextKey, label: string, mode: 'decimal' | 'text' = 'decimal') => (
    <label className="field">
      {label}
      <input value={form[key]} inputMode={mode === 'decimal' ? 'decimal' : undefined} type={key === 'invoiceFrom' || key === 'invoiceTo' ? 'date' : 'text'} onChange={(e) => set(key, e.target.value)} />
    </label>
  )

  return (
    <div className="card">
      <h2><Term id="accrualPrinciple">Lieferungen</Term></h2>
      <p className="muted">
        Tragen Sie jede Rechnung Ihres Versorgers mit ihrem Rechnungszeitraum ein. Reicht sie über die Heizperiode hinaus, teilt Mietfuchs sie
        auf: nach einem Zählerstand zum Stichtag, nach Teilmengen der Rechnung oder nach <Term id="degreeDays">Gradtagen</Term>.
      </p>
      {deliveries.length === 0 && <p className="muted">Noch keine Lieferung, die in dieser Heizperiode endet.</p>}
      <ul className="plain">
        {deliveries.map((d) => (
          <li key={d.id}>
            <strong>{d.label || 'Lieferung'}</strong> {deliveryLine(d)}
            {!view.closed && (
              <span className="row">
                <button className="btn secondary" onClick={() => open(d)}>Ändern</button>
                <button className="btn ghost danger-ghost" onClick={() => void remove(d)}>Entfernen</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {!service && view.items.length > 0 && (
        <div className="field-group">
          <div className="field-group-label">Welche Position gehört zu welcher Rechnung? Abschläge, Schlussrechnung und Gutschrift einer Rechnung gehören zur selben Lieferung. Ohne Verknüpfung grenzt Mietfuchs nichts ab und verteilt die Position ganz in ihrem Zeitraum.</div>
          {view.items.map((i) => (
            <label className="field" key={i.id}>
              {i.description}
              <select aria-label={`Lieferung zu „${i.description}“`} value={i.fuelDeliveryId ?? ''} disabled={view.closed} onChange={(e) => void link(i.id, options.find((o) => o.value === e.target.value)?.value ?? '')}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {editing !== null && (
        <div className="field-group">
          {text('label', 'Bezeichnung', 'text')}
          <div className="row">
            {text('invoiceFrom', 'Rechnungszeitraum von')}
            {text('invoiceTo', 'bis')}
          </div>
          <div className="row">
            {service && text('amount', 'Rechnungsbetrag')}
            {text('fixed', 'davon fester Preisbestandteil (Grund-, Mess-, Verrechnungspreis)')}
            {text('energyKwh', 'Energie (kWh)')}
          </div>
          {/* Bei Strom einer Wärmepumpe gibt es keine CO₂-Kosten aufzuteilen (§ 2 Abs. 1 CO2KostAufG). */}
          {(plant.energy === undefined || CO2_ENERGIES.includes(plant.energy)) && (
            <div className="row">
              {text('emissionsKg', 'CO₂-Ausstoß laut Rechnung (kg)')}
              {text('co2Cost', 'CO₂-Kosten laut Rechnung')}
            </div>
          )}
          <details className="extra-details">
            <summary>Weitere Angaben</summary>
            {text('sharePercent', 'Anteil dieser Heizperiode am Verbrauch (%), wenn bekannt')}
          </details>
          {service && (
            <label className="checkline">
              <input type="checkbox" checked={form.usedByService} onChange={(e) => set('usedByService', e.target.checked)} />
              vom Messdienst angesetzt
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => void save()}>Lieferung speichern</button>
            <button className="btn secondary" onClick={() => setEditing(null)}>Abbrechen</button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && editing === null && <div className="row"><button className="btn" onClick={() => open(null)}>Lieferung eintragen</button></div>}
    </div>
  )
}
