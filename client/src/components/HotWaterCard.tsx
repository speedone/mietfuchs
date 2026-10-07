// Die Karte „Warmwasser“ einer Heizperiode (Heizung PR 6, #211, Entwurf 7.7): wie der Messdienst die
// Wärme für das Warmwasser ermittelt hat. Bei einer Formel ohne bestätigten Aufwand nennt die
// Abrechnung die Kürzung. Seit Heizung PR 11 auch bei eigener Abrechnung mit verbundenem Warmwasser: wie
// Mietfuchs die Wärme bestimmt, bei der Volumenformel mit Volumen (Vorschlag aus den Warmwasserzählern)
// und Temperatur, und ob die Anlage die Wärme allein erzeugt.
import { useState } from 'react'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import {
  HOT_WATER_OPTIONS, SELF_HOT_WATER_OPTIONS, formulaFormOf, hotWaterBody, isFormula, numberText, selfFormulaBody, unconfirmedConsequence, unmeasurableLabel, volumeLabel,
  type FormulaForm, type HotWaterChoice,
} from '../heatingForm'
import type { HeatingPeriodView, HeatingPlant } from '../types'

export default function HotWaterCard({ view, plant, onSaved }: { view: HeatingPeriodView; plant: Pick<HeatingPlant, 'method' | 'heatGeneration'>; onSaved: () => void }) {
  const self = plant.method === 'self'
  const [choice, setChoice] = useState<HotWaterChoice>(view.hotWater.dhwMethod ?? (self ? 'heatMeter' : ''))
  const [unmeasurable, setUnmeasurable] = useState(view.hotWater.dhwUnmeasurable === true)
  const [formula, setFormula] = useState<FormulaForm>(formulaFormOf(view.hotWater))
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
      {isFormula(choice) && !unmeasurable && <small className="muted">{unconfirmedConsequence()}</small>}
      {self && isFormula(choice) && (
        <>
          {plant.heatGeneration !== 'single' && (
            <p className="muted">
              {plant.heatGeneration === 'mixed'
                ? 'Bei der Heizanlage steht, dass sie die Wärme mit einem weiteren Erzeuger erzeugt; dann rechnet keine Formel. Ändern Sie die Angabe in den Stammdaten bei der Heizanlage, wenn sie nicht stimmt.'
                : 'Ob diese Heizung die Wärme allein erzeugt, beantworten Sie in den Stammdaten bei der Heizanlage; ohne die Antwort rechnet die Formel nicht.'}
            </p>
          )}
          {choice === 'volumeFormula' && (
            <>
              <label className="field">
                {volumeLabel(view.hotWaterBasis.running, fmtDate)}
                <input inputMode="decimal" value={formula.volume} disabled={view.closed} onChange={(e) => setFormula({ ...formula, volume: e.target.value })} />
              </label>
              {view.hotWaterBasis.volumeMissing && !view.closed && <small className="muted">{view.hotWaterBasis.volumeMissing}</small>}
              {fromMeters !== null && fromMeters > 0 && !view.closed && (
                <div className="row">
                  <button type="button" className="btn ghost" onClick={() => setFormula({ ...formula, volume: numberText(fromMeters) })}>
                    Aus den Warmwasserzählern übernehmen: {numberText(fromMeters)} m³
                  </button>
                </div>
              )}
              <label className="field">
                Mittlere Temperatur des Warmwassers (°C, gemessen oder geschätzt)
                <input inputMode="decimal" value={formula.temp} disabled={view.closed} onChange={(e) => setFormula({ ...formula, temp: e.target.value })} />
                <small className="muted">Meist die Temperatur, die am Warmwasserspeicher eingestellt ist, etwa 55 bis 60 °C.</small>
              </label>
            </>
          )}
          {choice === 'areaFormula' && (
            <p className="muted">
              Mietfuchs rechnet mit der Wohnfläche der Wohnungen mit Warmwasser: {numberText(view.hotWaterBasis.suppliedAreaM2)} m². Die Fläche ist nur erlaubt,
              wenn auch das Warmwasser nicht gemessen werden kann (§ 9 Abs. 2 Satz 4 HeizkostenV). Wohnungen mit „kein Anschluss: Warmwasser“ zählen nicht mit.
            </p>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
      {!view.closed && <div className="row"><button className="btn" onClick={() => void save()}>Angabe speichern</button></div>}
    </div>
  )
}
