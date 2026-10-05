// Die Karte „Warmwasser“ einer Heizperiode (Heizung PR 6, #211, Entwurf 7.7): wie der Messdienst die
// Wärme für das Warmwasser ermittelt hat. Bei einer Formel ohne bestätigten Aufwand nennt die
// Abrechnung die Kürzung.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { HOT_WATER_OPTIONS, hotWaterBody, isFormula, unmeasurableLabel, type HotWaterChoice } from '../heatingForm'
import type { HeatingPeriodView } from '../types'

export default function HotWaterCard({ view, onSaved }: { view: HeatingPeriodView; onSaved: () => void }) {
  const [choice, setChoice] = useState<HotWaterChoice>(view.hotWater.dhwMethod ?? '')
  const [unmeasurable, setUnmeasurable] = useState(view.hotWater.dhwUnmeasurable === true)
  const [error, setError] = useState('')
  const toast = useToast()

  async function save() {
    try {
      await api(`/api/heating-plants/${view.plantId}/periods/${view.period}/hot-water`, { method: 'PUT', body: JSON.stringify(hotWaterBody(choice, unmeasurable)) })
      setError('')
      toast('Angabe zum Warmwasser gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Warmwasser <Term id="hotWaterShare" /></h2>
      <label className="field">
        Wie hat der Messdienst die Wärme für das Warmwasser ermittelt?
        <select value={choice} disabled={view.closed} onChange={(e) => setChoice(HOT_WATER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {isFormula(choice) && (
        <label className="field">
          <input type="checkbox" checked={unmeasurable} disabled={view.closed} onChange={(e) => setUnmeasurable(e.target.checked)} />
          {unmeasurableLabel(choice)}
        </label>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && <button className="btn" onClick={() => void save()}>Angabe speichern</button>}
    </div>
  )
}
