// Die Karte „Gradtagzahlen Ihres Orts“ (Heizung PR 7, Stufe 4 in 3.2): die Monatswerte des Deutschen
// Wetterdienstes für den Ort des Objekts. Fehlt ein Monat, rechnet Mietfuchs mit der
// Gradtagszahlentabelle (nach den anerkannten Regeln der Technik, § 9b Abs. 2 HeizkostenV).
import Card from '../components/Card'
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { useOpenWhenDiffers } from '../useDraft'
import { degreeDaysBody, degreeDaysToForm } from '../fuelForm'
import type { DegreeDayValue } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

export default function DegreeDaysCard({ propertyId, months, values, onSaved }: { propertyId: string; months: string[]; values: DegreeDayValue[]; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => degreeDaysToForm(values, months))
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  // Eine ungespeicherte Eingabe zählt als offenes Formular (#346, 7a).
  const markSaved = useOpenWhenDiffers(form, degreeDaysToForm(values, months))
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
      markSaved()
      toast('Gradtagzahlen gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Card title={<><Term id="degreeDays">Gradtagzahlen</Term> Ihres Orts</>}>
      <ErrorSummary errors={errors} />
      <p className="muted">
        Freiwillig. Mit den Monatswerten des Deutschen Wetterdienstes für Ihren Ort teilt Mietfuchs eine Rechnung genauer auf als mit der
        Gradtagszahlentabelle. Ein Zählerstand zum Stichtag ist noch genauer. Gemeint ist die Gradtagzahl G20/15 (Raumtemperatur 20 °C, Heizgrenze 15 °C, VDI 3807), die Monatssumme Ihrer nächsten Wetterstation; der Deutsche Wetterdienst veröffentlicht sie in seinem Open-Data-Angebot (Climate Data Center), viele Versorger nennen sie auch.
      </p>
      <div className="row">
        {months.map((m) => (
          <label className="field" key={m}>
            {`${m.slice(5, 7)}/${m.slice(0, 4)}`}
            <input value={form[m] ?? ''} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, [m]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="row"><button className="btn" onClick={() => void save()}>Gradtagzahlen speichern</button></div>
    </Card>
  )
}
