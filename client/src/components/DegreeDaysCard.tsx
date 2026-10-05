// Die Karte „Gradtagzahlen Ihres Orts“ (Heizung PR 7, Stufe 4 in 3.2): die Monatswerte des Deutschen
// Wetterdienstes für den Ort des Objekts. Fehlt ein Monat, rechnet Mietfuchs mit der Tabelle der
// Heizkostenverordnung.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { degreeDaysBody, degreeDaysToForm } from '../fuelForm'
import type { DegreeDayValue } from '../types'

export default function DegreeDaysCard({ propertyId, months, values, onSaved }: { propertyId: string; months: string[]; values: DegreeDayValue[]; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => degreeDaysToForm(values, months))
  const [error, setError] = useState('')
  const toast = useToast()

  async function save() {
    const r = degreeDaysBody(form)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api(`/api/properties/${propertyId}/degree-days`, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('Gradtagzahlen gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Gradtagzahlen Ihres Orts <Term id="degreeDays" /></h2>
      <p className="muted">
        Freiwillig. Mit den Monatswerten des Deutschen Wetterdienstes für Ihren Ort teilt Mietfuchs eine Rechnung genauer auf als mit der
        Tabelle der Heizkostenverordnung. Ein Zählerstand zum Stichtag ist noch genauer.
      </p>
      <div className="row wrap">
        {months.map((m) => (
          <label className="field" key={m}>
            {`${m.slice(5, 7)}/${m.slice(0, 4)}`}
            <input value={form[m] ?? ''} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, [m]: e.target.value }))} />
          </label>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn" onClick={() => void save()}>Gradtagzahlen speichern</button>
    </div>
  )
}
