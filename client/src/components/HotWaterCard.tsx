// Die Karte „Warmwasser“ einer Heizperiode (Heizung PR 6, #211, Entwurf 7.7): wie der Messdienst die
// Wärme für das Warmwasser ermittelt hat. Bei einer Formel ohne bestätigten Aufwand nennt die
// Abrechnung die Kürzung. Seit Heizung PR 11 auch bei eigener Abrechnung mit verbundenem Warmwasser: wie
// Mietfuchs die Wärme bestimmt, bei der Volumenformel mit Volumen (Vorschlag aus den Warmwasserzählern)
// und Temperatur, und ob die Anlage die Wärme allein erzeugt.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import {
  HEAT_GENERATION_OPTIONS, HOT_WATER_OPTIONS, SELF_HOT_WATER_OPTIONS, formulaFormOf, hotWaterBody, isFormula, numberText, selfFormulaBody, unmeasurableLabel,
  type FormulaForm, type HotWaterChoice,
} from '../heatingForm'
import type { HeatGeneration, HeatingPeriodView, HeatingPlant } from '../types'

export default function HotWaterCard({ view, plant, onSaved }: { view: HeatingPeriodView; plant: Pick<HeatingPlant, 'id' | 'method' | 'heatGeneration'>; onSaved: () => void }) {
  const self = plant.method === 'self'
  const [choice, setChoice] = useState<HotWaterChoice>(view.hotWater.dhwMethod ?? (self ? 'heatMeter' : ''))
  const [unmeasurable, setUnmeasurable] = useState(view.hotWater.dhwUnmeasurable === true)
  const [formula, setFormula] = useState<FormulaForm>(formulaFormOf(view.hotWater))
  const [generation, setGeneration] = useState<HeatGeneration | ''>(plant.heatGeneration ?? '')
  const [error, setError] = useState('')
  const toast = useToast()
  const options = self ? SELF_HOT_WATER_OPTIONS : HOT_WATER_OPTIONS

  async function save() {
    const extra = self ? selfFormulaBody(choice, formula) : { body: {} }
    if ('error' in extra) {
      setError(extra.error)
      return
    }
    try {
      await api(`/api/heating-plants/${view.plantId}/periods/${view.period}/hot-water`, { method: 'PUT', body: JSON.stringify({ ...hotWaterBody(choice, unmeasurable), ...extra.body }) })
      // Die Antwort zum Erzeuger gehört zur Anlage, nicht zur Heizperiode.
      if (self && isFormula(choice) && generation !== (plant.heatGeneration ?? '')) {
        await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ heatGeneration: generation === '' ? null : generation }) })
      }
      setError('')
      toast('Angabe zum Warmwasser gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const fromMeters = view.hotWaterBasis.volumeFromMetersM3
  return (
    <div className="card">
      <h2><Term id="hotWaterShare">Warmwasser</Term></h2>
      <label className="field">
        {self ? 'Wie wird die Wärme für das Warmwasser bestimmt?' : 'Wie hat der Messdienst die Wärme für das Warmwasser ermittelt?'}
        <select value={choice} disabled={view.closed} onChange={(e) => setChoice(options.find((o) => o.value === e.target.value)?.value ?? (self ? 'heatMeter' : ''))}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {isFormula(choice) && (
        <label className="checkline">
          <input type="checkbox" checked={unmeasurable} disabled={view.closed} onChange={(e) => setUnmeasurable(e.target.checked)} />
          {unmeasurableLabel(choice)}
        </label>
      )}
      {self && isFormula(choice) && (
        <>
          <label className="field">
            Erzeugt diese Heizung die Wärme allein?
            <select value={generation} disabled={view.closed} onChange={(e) => setGeneration(HEAT_GENERATION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
              {HEAT_GENERATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {choice === 'volumeFormula' && (
            <>
              <label className="field">
                Warmwasser in der Heizperiode (m³, gemessen)
                <input inputMode="decimal" value={formula.volume} disabled={view.closed} onChange={(e) => setFormula({ ...formula, volume: e.target.value })} />
              </label>
              {fromMeters !== null && !view.closed && (
                <div className="row">
                  <button type="button" className="btn ghost" onClick={() => setFormula({ ...formula, volume: numberText(fromMeters) })}>
                    Aus den Warmwasserzählern übernehmen: {numberText(fromMeters)} m³
                  </button>
                </div>
              )}
              <label className="field">
                Mittlere Temperatur des Warmwassers (°C, gemessen oder geschätzt)
                <input inputMode="decimal" value={formula.temp} disabled={view.closed} onChange={(e) => setFormula({ ...formula, temp: e.target.value })} />
              </label>
            </>
          )}
          {choice === 'areaFormula' && (
            <p className="muted">
              Mietfuchs rechnet mit der Wohnfläche der Wohnungen mit Warmwasser: {numberText(view.hotWaterBasis.suppliedAreaM2)} m². Die Fläche ist nur erlaubt,
              wenn auch das Warmwasser nicht gemessen werden kann (§ 9 Abs. 2 Satz 4 HeizkostenV).
            </p>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && <div className="row"><button className="btn" onClick={() => void save()}>Angabe speichern</button></div>}
    </div>
  )
}
