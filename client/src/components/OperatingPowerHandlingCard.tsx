import type { HeatingPlant, OperatingPowerHandling } from '../types'
import Card from '../components/Card'
import { api } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import DraftActions from './DraftActions'
import { useDraft } from '../useDraft'
import { handlingBody, handlingOptions, handlingValue } from '../operatingPowerHandling'
import { OPERATING_POWER_HANDLING_QUESTION } from '../../../shared/operatingPower.ts'

// Karte „Betriebsstrom der Heizung“ der Seite Heizkosten (#266): je Anlage, über den Heizperioden. Die Angabe ändert keine
// Zahl, nur den Hinweis „Betriebsstrom fehlt“. Die Auswahl ist ein Entwurf am Feld (#309); erst „Speichern“
// schickt sie, danach lädt die Seite neu.
export default function OperatingPowerHandlingCard({ plant, onSaved }: { plant: HeatingPlant; onSaved: () => void }) {
  const toast = useToast()
  const draft = useDraft<'' | OperatingPowerHandling>(handlingValue(plant), { scope: plant.id })
  async function save(value: '' | OperatingPowerHandling) {
    await api(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify(handlingBody(value)) })
    toast('Die Angabe ist gespeichert.')
    onSaved()
  }
  return (
    <Card title={<><Term id="operatingPower">Betriebsstrom der Heizung</Term>{plant.name ? ` „${plant.name}“` : ''}</>} className="no-print">
      <label className="field">
        <span>{OPERATING_POWER_HANDLING_QUESTION}</span>
        <select value={draft.value} disabled={draft.saving} onChange={(e) => draft.set(e.target.value as '' | OperatingPowerHandling)}>
          {handlingOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <DraftActions draft={draft} onSave={save} what="Betriebsstrom" />
      <p className="muted">
        Brenner, Umwälzpumpen und Regelung verbrauchen Strom. Mit dieser Angabe weist Mietfuchs gezielt darauf hin, wenn der Abzug beim
        Allgemeinstrom oder die Rechnung des eigenen Stromvertrags fehlt. Die Angabe ändert keine Zahl der Abrechnung.
      </p>
      <p className="muted">
        Ein Zwischenzähler hinter dem Stromzähler des Hauses ist kein eigener Stromvertrag: Sein Strom steckt in der Stromrechnung des Hauses und
        ist beim Allgemeinstrom abzuziehen; der Zwischenzähler erspart Ihnen nur das Schätzen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07,
        Rn. 32; vgl. BGH, Urteil vom 03.06.2016, V ZR 166/15, Leitsatz).
      </p>
    </Card>
  )
}
