// Die Karte „Messdienstabrechnung auslesen“ der Seite Heizkosten (Heizung PR 20, #103): Beleg wählen, KI
// lesen lassen, Ergebnis prüfen und übernehmen. Gespeichert wird erst in der Prüfansicht.
import Card from '../components/Card'
import { useEffect, useRef, useState } from 'react'
import { useOpenForm } from '../property'
import { errorText } from '../api'
import { aiRequest, progressText, type AiProgress } from '../aiRequest'
import { asStored, heatingUpload } from '../aiUpload'
import { failureOf } from '../aiFailure'
import { KeptReceipt } from './KeptReceipt'
import ServiceImportReview from './ServiceImportReview'
import type { ImportContext } from '../serviceImport'
import { startYearOf } from '../../../shared/period.ts'
import { servesUnit } from '../../../shared/heatingPeriod.ts'
import type { AiFailure, BillingPeriod, CostItem, HeatingPeriodView, HeatingPlant, ServiceExtractResult, Tenancy, Unit } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

export default function ServiceImportCard({ plant, view, object, tenancies, units, items = [], co2 = true, onSaved, onOpenReceipt, onOpenAiSettings }: {
  plant: Pick<HeatingPlant, 'id' | 'propertyId' | 'units'>
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
  // Fehler mit Ausweg (#487): Die Karte hat kein Formular zum Ausfüllen von Hand (die Werte gehören in Positionen mit
  // Einzelbeträgen und in die Karten darunter); „Von Hand erfassen“ führt deshalb in den Belegordner zum Beleg.
  onOpenReceipt?: (file: string) => void
  onOpenAiSettings?: () => void
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
  // Die KI ist gescheitert, der Beleg liegt im Belegordner (#487); die Datei bleibt für einen neuen Versuch.
  const [kept, setKept] = useState<{ failure: AiFailure; file: File } | null>(null)

  // Nach „Erneut versuchen“ geht der Fokus an „Abbrechen“ und danach an den Bereich des Auslesens, nicht auf body
  // (Durchsicht #487).
  // 'pending': geklickt, „Abbrechen“ noch nicht da; 'running': läuft. Erst das Ende eines laufenden Versuchs gibt den
  // Fokus zurück, nicht ein liegengebliebener Effekt des ersten Durchgangs.
  const retrying = useRef<'pending' | 'running' | null>(null)
  // „Abbrechen“ bekommt den Fokus beim Erscheinen, wenn es ein neuer Versuch ist
  const focusCancel = (el: HTMLButtonElement | null) => {
    if (!el || retrying.current !== 'pending') return
    el.focus()
    retrying.current = 'running'
  }
  const aiArea = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (busy || retrying.current !== 'running') return
    retrying.current = null
    if (!document.activeElement || document.activeElement === document.body) aiArea.current?.focus()
  }, [busy])

  // `before`: der Ausweg eines gespeicherten Belegs, dessen neuer Versuch das ist; ein Abbruch stellt ihn wieder her.
  async function read(file: File, stored?: string, before?: { failure: AiFailure; file: File }) {
    setBusy(true)
    setError('')
    setResult(null)
    setKept(null)
    abort.current = new AbortController()
    try {
      const upload = await heatingUpload(file, { propertyId: plant.propertyId, year: startYearOf(object.key) })
      const fd = stored ? asStored(upload, stored) : upload
      setResult(await aiRequest<ServiceExtractResult>(`/api/heating-plants/${plant.id}/service-statement`, fd, { onProgress: setProgress, signal: abort.current.signal }))
    } catch (e) {
      const failure = failureOf(e)
      // Selbst abgebrochen: am Signal erkennbar, auch wenn der Abbruch als DOMException ankommt
      const aborted = abort.current?.signal.aborted === true || (e instanceof Error && e.name === 'AbortError')
      if (failure) setKept({ failure, file })
      else if (aborted && before) setKept(before)
      else if (!aborted) setError(errorText(e))
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
    tenancies, units, servedUnitsCount: units.filter((u) => servesUnit(plant, u)).length, existingAmountItems: view.items.filter((i) => i.key === 'amounts').length,
    existingAmountCategories: items.filter((i) => i.key === 'amounts' && String(i.period) === String(object.key)).map((i) => i.category),
  }
  return (
    <Card title="Messdienstabrechnung auslesen" level={3}>
      <ErrorSummary errors={errors} />
      <p className="muted">
        Laden Sie die Heiz- und Warmwasserkostenabrechnung Ihres Messdienstes hoch. Mietfuchs liest Nutzerbeträge, Summen, CO₂-Angaben und
        die Ermittlung des Warmwassers und schlägt sie vor; gespeichert wird erst, wenn Sie übernehmen. Bei gescannten Abrechnungen liest
        Mietfuchs höchstens die ersten vier Seiten. Der Beleg liegt auf der Seite Belege, bis Sie die Positionen anlegen.
      </p>
      {!busy && (
        <label className="field">
          Abrechnung wählen (PDF oder Foto)
          <input type="file" accept="application/pdf,image/*" aria-label="Messdienstabrechnung wählen" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
        </label>
      )}
      <div ref={aiArea} tabIndex={-1}>
        {busy && (
          <p>
            {progressText(progress)} <button ref={focusCancel} className="btn secondary" onClick={() => abort.current?.abort()}>Abbrechen</button>
          </p>
        )}
        {!busy && kept && (
          <KeptReceipt failure={kept.failure} onManual={onOpenReceipt} onOpenSettings={onOpenAiSettings}
            onRetry={() => { retrying.current = 'pending'; aiArea.current?.focus(); void read(kept.file, kept.failure.file, kept) }} />
        )}
      </div>
      {result && <ServiceImportReview key={result.file} x={result.extraction} file={result.file} ctx={ctx} view={view} co2={co2} onDone={onSaved} />}
      {result && (
        <div className="row">
          <button type="button" className="btn secondary" onClick={() => setResult(null)}>Schließen</button>
        </div>
      )}
    </Card>
  )
}
