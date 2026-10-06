// Die Karte „Vorrat“ einer Heizperiode (Heizung PR 8, Entwurf 8.2, 11.4). Die Logik steht in
// stockForm.ts; hier wird nur gezeigt und gespeichert.
import { useState } from 'react'
import { api, errorText, fmtEuro } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { BEFORE_2023_OPTIONS, STOCK_UNIT_OPTIONS, stockBody, stockSummary, stockToForm, type StockForm } from '../stockForm'
import { STOCK_UNIT_TEXT } from '../../../shared/fuelStock.ts'
import type { HeatingPeriodView } from '../types'

type TextKey = 'openingQuantity' | 'openingCost' | 'openingKg' | 'openingCo2' | 'closingQuantity'

// `co2Fields`: kg und CO₂-Kosten gibt es nur bei Brennstoffen, deren CO₂-Kosten aufzuteilen sind
// (Heizöl, Flüssiggas, Kohle; § 2 Abs. 1 CO2KostAufG), nicht bei Pellets und Holz.
export default function StockCard({ view, onSaved, co2Fields = true }: { view: HeatingPeriodView; onSaved: () => void; co2Fields?: boolean }) {
  const stock = view.stock
  const [form, setForm] = useState<StockForm | null>(() => (stock ? stockToForm(stock) : null))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  if (!stock || !form) return null
  const set = <K extends keyof StockForm>(key: K, value: StockForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const url = `/api/heating-plants/${view.plantId}/periods/${view.period}/stock`

  async function save() {
    if (!stock || !form) return
    const r = stockBody(form, stock)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setBusy(true)
    try {
      await api(url, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      toast('Vorrat gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await confirm({ title: 'Vorrat entfernen?', message: 'Die Abrechnung rechnet diese Heizperiode dann wieder nach Lieferungen.', confirmLabel: 'Entfernen', danger: true })
    if (!ok) return
    try {
      await api(url, { method: 'DELETE' })
      toast('Vorrat entfernt.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Hat die abgeschlossene Folgeperiode den Endbestand übernommen, bleiben Einheit und Endbestand (G-A4).
  const locked = stock.closingLockedBy
  const text = (key: TextKey, label: string, disabled = view.closed) => (
    <label className="field">
      {label}
      <input aria-label={label} value={form[key]} inputMode="decimal" disabled={disabled} onChange={(e) => set(key, e.target.value)} />
    </label>
  )
  const unitText = form.unit === '' ? '' : ` ${STOCK_UNIT_TEXT[form.unit]}`

  return (
    <div className="card">
      <h2><Term id="fuelStock">Vorrat</Term></h2>
      <p className="muted">
        Tragen Sie den Bestand im Tank oder Lager ein, den Anfangsbestand nur in der ersten Heizperiode; danach übernimmt Mietfuchs den
        Endbestand der Vorperiode. Verbraucht ist Anfangsbestand plus Lieferungen minus Endbestand.
      </p>
      {view.closed && <p className="muted">Diese Heizperiode ist abgeschlossen; der Vorrat lässt sich nicht mehr ändern.</p>}
      {!view.closed && locked && <p className="muted">Die Heizperiode {locked.label} ist abgeschlossen und hat diesen Endbestand als Anfangsbestand übernommen; Einheit und Endbestand bleiben deshalb, wie sie sind.</p>}
      <label className="field">
        Einheit
        <select aria-label="Einheit des Vorrats" value={form.unit} disabled={view.closed || locked !== null} onChange={(e) => set('unit', STOCK_UNIT_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
          {STOCK_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {stock.derived ? (
        <p className="muted">
          Anfangsbestand aus dem Endbestand der Heizperiode {stock.derived.label}{stock.derived.frozen ? ' (abgeschlossen)' : ''}: {stock.derived.value.quantity.toLocaleString('de-DE', { maximumFractionDigits: 2 })}{unitText} · {stock.derived.value.costCents === null ? 'Betrag unbekannt' : fmtEuro(stock.derived.value.costCents)}
        </p>
      ) : (
        <div className="row">
          {text('openingQuantity', 'Anfangsbestand (Menge)')}
          {text('openingCost', 'Wert des Anfangsbestands')}
          {co2Fields && text('openingKg', 'CO₂ des Anfangsbestands (kg)')}
          {co2Fields && text('openingCo2', 'CO₂-Kosten des Anfangsbestands')}
          {co2Fields && (
            <label className="field">
              In Rechnung gestellt
              <select aria-label="Anfangsbestand in Rechnung gestellt" value={form.before2023} disabled={view.closed} onChange={(e) => set('before2023', BEFORE_2023_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '')}>
                {BEFORE_2023_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="row">
        {text('closingQuantity', 'Endbestand (Menge)', view.closed || locked !== null)}
        <label className="field">
          Gepeilt am (leer: am letzten Tag der Heizperiode)
          <input type="date" value={form.measuredOn} disabled={view.closed} onChange={(e) => set('measuredOn', e.target.value)} />
        </label>
      </div>
      {stockSummary(stock).length > 0 && <ul>{stockSummary(stock).map((l) => <li key={l}>{l}</li>)}</ul>}
      {stock.problem && <div className="notice">{stock.problem}</div>}
      {error && <div className="error">{error}</div>}
      {!view.closed && (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void save()}>Vorrat speichern</button>
          {!locked && (stock.row.stockUnit !== null || stock.row.closingQuantity !== null) && <button className="btn secondary" onClick={() => void remove()}>Vorrat entfernen</button>}
        </div>
      )}
    </div>
  )
}
