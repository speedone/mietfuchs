// Die Karte „Messdienstabrechnung auslesen“ der Seite Heizkosten (Heizung PR 20, #103): Beleg wählen, KI
// lesen lassen, Ergebnis prüfen und übernehmen. Gespeichert wird erst in der Prüfansicht.
import { useRef, useState } from 'react'
import { useOpenForm } from '../property'
import { errorText } from '../api'
import { aiRequest, progressText, type AiProgress } from '../aiRequest'
import { heatingUpload } from '../aiUpload'
import ServiceImportReview from './ServiceImportReview'
import type { ImportContext } from '../serviceImport'
import { startYearOf } from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, HeatingPeriodView, HeatingPlant, ServiceExtractResult, Tenancy, Unit } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

export default function ServiceImportCard({ plant, view, object, tenancies, units, items = [], co2 = true, onSaved }: {
  plant: Pick<HeatingPlant, 'id' | 'propertyId'>
  view: HeatingPeriodView
  // Der Abrechnungszeitraum des Objekts, für die kalten Blöcke einer Komplettabrechnung.
  object: Pick<BillingPeriod, 'key' | 'from' | 'to'>
  tenancies: readonly Tenancy[]
  units: readonly Unit[]
  // Die Positionen des Objekts, um kalte Blöcke zu erkennen, die schon erfasst sind (Durchsicht S4).
  items?: readonly Pick<CostItem, 'period' | 'key' | 'category'>[]
  // Sind für diese Heizperiode CO₂-Kosten aufzuteilen? Sonst fragt die Prüfansicht nicht danach.
  co2?: boolean
  onSaved: () => void
}) {
  const [result, setResult] = useState<ServiceExtractResult | null>(null)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [busy, setBusy] = useState(false)
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  // Das Auslesen und der Vorschlag zählen als offenes Formular (#346, 7a): Gespeichert ist nur der Beleg, ein
  // Seitenwechsel verlöre den Vorschlag, und ihn neu zu holen kostet einen weiteren Lauf der KI. „Schließen“
  // legt ihn weg, wenn alles übernommen ist.
  useOpenForm(busy || result !== null)
  const abort = useRef<AbortController | null>(null)

  async function read(file: File) {
    setBusy(true)
    setError('')
    setResult(null)
    abort.current = new AbortController()
    try {
      const fd = await heatingUpload(file, { propertyId: plant.propertyId, year: startYearOf(object.key) })
      setResult(await aiRequest<ServiceExtractResult>(`/api/heating-plants/${plant.id}/service-statement`, fd, { onProgress: setProgress, signal: abort.current.signal }))
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(errorText(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  if (view.closed) return null
  const ctx: ImportContext = {
    propertyId: plant.propertyId, plantId: plant.id,
    heating: { key: String(view.period), from: view.from, to: view.to },
    object: { key: String(object.key), from: object.from, to: object.to },
    tenancies, units, existingAmountItems: view.items.filter((i) => i.key === 'amounts').length,
    existingAmountCategories: items.filter((i) => i.key === 'amounts' && String(i.period) === String(object.key)).map((i) => i.category),
  }
  return (
    <div className="card">
      <h2>Messdienstabrechnung auslesen</h2>
      <ErrorSummary errors={errors} />
      <p className="muted">
        Laden Sie die Heiz- und Warmwasserkostenabrechnung Ihres Messdienstes hoch. Mietfuchs liest Nutzerbeträge, Summen, CO₂-Angaben und
        die Ermittlung des Warmwassers und schlägt sie vor; gespeichert wird erst, wenn Sie übernehmen. Bei gescannten Abrechnungen liest
        Mietfuchs höchstens die ersten vier Seiten. Der Beleg liegt im Belegordner, bis Sie die Positionen anlegen.
      </p>
      {!busy && (
        <label className="field">
          Abrechnung wählen (PDF oder Foto)
          <input type="file" accept="application/pdf,image/*" aria-label="Messdienstabrechnung wählen" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
        </label>
      )}
      {busy && (
        <p>
          {progressText(progress)} <button className="btn secondary" onClick={() => abort.current?.abort()}>Abbrechen</button>
        </p>
      )}
      {result && <ServiceImportReview key={result.file} x={result.extraction} file={result.file} ctx={ctx} view={view} co2={co2} onDone={onSaved} />}
      {result && (
        <div className="row">
          <button type="button" className="btn secondary" onClick={() => setResult(null)}>Schließen</button>
        </div>
      )}
    </div>
  )
}
