// Die Karte „CO₂: Angaben zum Gebäude“ (Heizung PR 7, Entwurf 9.1, 9.2): § 8 (Nichtwohngebäude), § 9
// (Beschränkungen) und § 2 Abs. 4 Satz 2 CO2KostAufG (Wärme aus dem Emissionshandel), gespeichert an der
// Anlage. Bei freien Schlüsseln dazu die Fläche der Einstufung je Heizperiode, wenn sie von der
// Wohnfläche der versorgten Wohnungen abweicht.
import { api, errorText } from '../api'
import { parseDecimal } from '../co2Form'
import { useToast } from './feedback'
import Term from './Term'
import { keepDraft, useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import Card from './Card'
import { RESTRICTION_OPTIONS } from '../fuelForm'
import { co2DistrictEtsNew } from '../../../shared/law/co2kostaufg.ts'
import { germanDate, onlyVersion } from '../../../shared/law/register.ts'
import type { Co2Restriction, HeatingEnergy, HeatingMethod, HeatingPeriodView } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'
import { NoticeBox } from './Notice'

type Facts = { id: string; energy: HeatingEnergy; method: HeatingMethod; nonResidential: boolean; restriction: Co2Restriction; districtEtsNew: boolean }

export default function Co2FactsCard({ plant, view, servedAreaM2, onSaved }: { plant: Facts; view: HeatingPeriodView; servedAreaM2: number; onSaved: () => void }) {
  const savedArea = view.co2?.areaM2 == null ? '' : view.co2.areaM2.toLocaleString('de-DE', { useGrouping: false })
  // Eine Karte, ein Speichern (#346 Schritt 7, N8): Angaben zum Gebäude und Fläche der Einstufung sind ein Entwurf;
  // gesendet wird nur, was sich geändert hat, an die Anlage bzw. an die Heizperiode, wie vorher die beiden Knöpfe.
  const saved = { nonResidential: plant.nonResidential, restriction: plant.restriction, districtEtsNew: plant.districtEtsNew, area: savedArea }
  const draft = useDraft(saved, { scope: `${plant.id}|${view.period}` })
  const { nonResidential, restriction, districtEtsNew, area } = draft.value
  const edit = (patch: Partial<typeof saved>) => draft.set({ ...draft.value, ...patch })
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const toast = useToast()
  const stichtag = germanDate(onlyVersion(co2DistrictEtsNew).value.connectedAfter)

  async function save(value: typeof saved) {
    const factsChanged = value.nonResidential !== saved.nonResidential || value.restriction !== saved.restriction || value.districtEtsNew !== saved.districtEtsNew
    const areaChanged = value.area !== saved.area
    const areaValue = parseDecimal(value.area)
    if (areaChanged && value.area.trim() !== '' && (areaValue === null || areaValue <= 0)) {
      setError('Die Fläche ist eine Zahl über 0.')
      return keepDraft
    }
    try {
      if (factsChanged) {
        await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ nonResidential: value.nonResidential, restriction: value.restriction, districtEtsNew: value.districtEtsNew }) })
      }
    } catch (e) {
      setError(errorText(e))
      return keepDraft
    }
    if (areaChanged) {
      const url = `/api/heating-plants/${plant.id}/periods/${view.period}/co2`
      try {
        if (areaValue === null) await api(url, { method: 'DELETE' })
        else await api(url, { method: 'PUT', body: JSON.stringify({ method: 'self', areaM2: areaValue }) })
      } catch (e) {
        // Durchsicht S4: Zwei Ziele, zwei Anfragen. Scheitert nur die Fläche, sind die Angaben zum Gebäude gespeichert;
        // die Karte sagt das, die Seite lädt neu, und der Entwurf behält nur, was noch offen ist. „Verwerfen“ zeigt dann den
        // gespeicherten Stand.
        if (factsChanged) {
          setError(`Die Angaben zum Gebäude sind gespeichert, die Fläche nicht: ${errorText(e)}`)
          onSaved()
        } else setError(errorText(e))
        return keepDraft
      }
    }
    setError('')
    toast('Angaben gespeichert.')
    onSaved()
  }

  return (
    <Card title={<>CO₂: Angaben zum Gebäude für die <Term id="co2Stage">Einstufung</Term></>} level={3}>
      <ErrorSummary errors={errors} />
      <p className="muted">Gilt für alle Heizperioden dieser Anlage. Die Angaben wirken auf Heizperioden, die noch nicht abgeschlossen sind; eine abgeschlossene Abrechnung bleibt, wie sie ist.</p>
      <label className="checkline">
        <input type="checkbox" checked={nonResidential} disabled={draft.saving} onChange={(e) => edit({ nonResidential: e.target.checked })} />
        Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)
      </label>
      <label className="field">
        Beschränkungen (§ 9 CO2KostAufG)
        <select aria-label="Beschränkungen (§ 9 CO2KostAufG)" value={restriction} disabled={draft.saving} onChange={(e) => edit({ restriction: RESTRICTION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'none' })}>
          {RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {restriction !== 'none' && <NoticeBox level="warning" action={<>Darauf können Sie sich nur berufen, wenn Sie den Mietern die Umstände nachweisen (§ 9 Abs. 3 CO2KostAufG).</>} />}
      {plant.energy === 'districtHeating' && (
        <label className="checkline">
          <input type="checkbox" checked={districtEtsNew} disabled={draft.saving} onChange={(e) => edit({ districtEtsNew: e.target.checked })} />
          {`Das Gebäude wurde erstmals nach dem ${stichtag} an ein Wärmenetz angeschlossen, dessen Wärme aus dem Emissionshandel stammt (§ 2 Abs. 4 Satz 2 CO2KostAufG)`}
        </label>
      )}
      {plant.method !== 'service' && (
        <div className="field-group">
          <label className="field">
            Fläche der Einstufung (m²)
            <input value={area} inputMode="decimal" disabled={view.closed || draft.saving} onChange={(e) => edit({ area: e.target.value })} />
          </label>
          <p className="muted">{`Ohne Angabe: ${servedAreaM2.toLocaleString('de-DE')} m², die Wohnfläche der versorgten Wohnungen. Weist die Abrechnung eine andere Fläche aus, tragen Sie diese ein.`}</p>
        </div>
      )}
      <DraftActions draft={draft} onSave={save} layout="card" what="Angaben zum Gebäude" />
    </Card>
  )
}
