// Die Karte „CO₂: Angaben zum Gebäude“ (Heizung PR 7, Entwurf 9.1, 9.2): § 8 (Nichtwohngebäude), § 9
// (Beschränkungen) und § 2 Abs. 4 Satz 2 CO2KostAufG (Wärme aus dem Emissionshandel), gespeichert an der
// Anlage. Bei freien Schlüsseln dazu die Fläche der Einstufung je Heizperiode, wenn sie von der
// Wohnfläche der versorgten Wohnungen abweicht.
import { useState } from 'react'
import { api, errorText } from '../api'
import { parseDecimal } from '../co2Form'
import { useToast } from './feedback'
import Term from './Term'
import { RESTRICTION_OPTIONS } from '../fuelForm'
import { co2DistrictEtsNew } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, onlyVersion } from '../../../shared/law/register.ts'
import type { Co2Restriction, HeatingEnergy, HeatingMethod, HeatingPeriodView } from '../types'

type Facts = { id: string; energy: HeatingEnergy; method: HeatingMethod; nonResidential: boolean; restriction: Co2Restriction; districtEtsNew: boolean }

export default function Co2FactsCard({ plant, view, servedAreaM2, onSaved }: { plant: Facts; view: HeatingPeriodView; servedAreaM2: number; onSaved: () => void }) {
  const [nonResidential, setNonResidential] = useState(plant.nonResidential)
  const [restriction, setRestriction] = useState<Co2Restriction>(plant.restriction)
  const [districtEtsNew, setDistrictEtsNew] = useState(plant.districtEtsNew)
  const [area, setArea] = useState(view.co2?.areaM2 == null ? '' : view.co2.areaM2.toLocaleString('de-DE', { useGrouping: false }))
  const [error, setError] = useState('')
  const toast = useToast()
  const stichtag = germanDate(onlyVersion(co2DistrictEtsNew).value.connectedAfter)

  async function saveFacts() {
    try {
      await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ nonResidential, restriction, districtEtsNew }) })
      setError('')
      toast('Angaben zum Gebäude gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function saveArea() {
    const url = `/api/heating-plants/${plant.id}/periods/${view.period}/co2`
    const value = parseDecimal(area)
    if (area.trim() !== '' && (value === null || value <= 0)) {
      setError('Die Fläche ist eine Zahl über 0.')
      return
    }
    try {
      if (value === null) await api(url, { method: 'DELETE' })
      else await api(url, { method: 'PUT', body: JSON.stringify({ method: 'self', areaM2: value }) })
      setError('')
      toast('Fläche gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>CO₂: Angaben zum Gebäude für die <Term id="co2Stage">Einstufung</Term></h2>
      <p className="muted">Gilt für alle Heizperioden dieser Anlage. Die Angaben wirken auf Heizperioden, die noch nicht abgeschlossen sind; eine abgeschlossene Abrechnung bleibt, wie sie ist.</p>
      <label className="checkline">
        <input type="checkbox" checked={nonResidential} onChange={(e) => setNonResidential(e.target.checked)} />
        Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)
      </label>
      <label className="field">
        Beschränkungen (§ 9 CO2KostAufG)
        <select aria-label="Beschränkungen (§ 9 CO2KostAufG)" value={restriction} onChange={(e) => setRestriction(RESTRICTION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'none')}>
          {RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {restriction !== 'none' && <p className="notice">Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG).</p>}
      {plant.energy === 'districtHeating' && (
        <label className="checkline">
          <input type="checkbox" checked={districtEtsNew} onChange={(e) => setDistrictEtsNew(e.target.checked)} />
          {`Das Gebäude wurde erstmals nach dem ${stichtag} an ein Wärmenetz angeschlossen, dessen Wärme aus dem Emissionshandel stammt (§ 2 Abs. 4 Satz 2 CO2KostAufG)`}
        </label>
      )}
      <div className="row"><button className="btn" onClick={() => void saveFacts()}>Angaben speichern</button></div>
      {plant.method !== 'service' && (
        <div className="field-group">
          <label className="field">
            Fläche der Einstufung (m²)
            <input value={area} inputMode="decimal" disabled={view.closed} onChange={(e) => setArea(e.target.value)} />
          </label>
          <p className="muted">{`Ohne Angabe: ${servedAreaM2.toLocaleString('de-DE')} m², die Wohnfläche der versorgten Wohnungen. Weist die Abrechnung eine andere Fläche aus, tragen Sie diese ein.`}</p>
          {!view.closed && <button className="btn secondary" onClick={() => void saveArea()}>Fläche speichern</button>}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
