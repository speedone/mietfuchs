// Die Karte „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 5.6, 8.1): je Wohnung und
// Nutzungszeitraum die Einheiten für Heizung und, wenn der Dienst sie nennt, Warmwasser. Gespeichert wird
// immer die ganze Liste der Heizperiode.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { emptyServiceRow, serviceRowsOf, serviceValuesBody, type ServiceRowForm } from '../hcaForm'
import type { HeatingServiceValue, PeriodKey } from '../types'

type Props = {
  plantId: string
  period: PeriodKey
  from: string
  to: string
  closed: boolean
  units: readonly { id: string; name: string }[]
  values: readonly HeatingServiceValue[]
  onSaved: () => void
}

export default function ServiceValuesCard({ plantId, period, from, to, closed, units, values, onSaved }: Props) {
  const [rows, setRows] = useState<ServiceRowForm[]>(() => (values.length > 0 ? serviceRowsOf(values) : units.map((u) => ({ ...emptyServiceRow(from, to), unitId: u.id }))))
  const [error, setError] = useState('')
  const toast = useToast()
  const set = (i: number, patch: Partial<ServiceRowForm>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  async function save() {
    const b = serviceValuesBody(rows)
    if ('error' in b) {
      setError(b.error)
      return
    }
    try {
      await api(`/api/heating-plants/${plantId}/periods/${period}/service-values`, { method: 'PUT', body: JSON.stringify(b.body) })
      setError('')
      toast('Werte des Ablesedienstes gespeichert.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="card">
      <h2>Werte des <Term id="heatCostAllocator">Ablesedienstes</Term></h2>
      <p className="muted">
        Tragen Sie die Einheiten je Wohnung und Nutzungszeitraum ein, so wie sie in der Ablesung des Dienstes stehen; damit sind auch Verdunster und
        Funk-Heizkostenverteiler abgedeckt. Zieht ein Mieter aus, sind es zwei Zeilen. Lücken bleiben Lücken: Was fehlt, schätzt Mietfuchs nicht.
        Nennt der Dienst Werte für das Warmwasser, tragen Sie sie bei allen Zeilen ein; sonst zählen die Warmwasserzähler.
      </p>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <label className="field">
            Wohnung
            <select value={units.some((u) => u.id === r.unitId) ? r.unitId : ''} disabled={closed} onChange={(e) => set(i, { unitId: units.find((u) => u.id === e.target.value)?.id ?? '' })}>
              <option value="">bitte wählen</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="field">von<input type="date" value={r.from} disabled={closed} onChange={(e) => set(i, { from: e.target.value })} /></label>
          <label className="field">bis<input type="date" value={r.to} disabled={closed} onChange={(e) => set(i, { to: e.target.value })} /></label>
          <label className="field">Heizung (Einheiten)<input inputMode="decimal" className="input-num" value={r.heat} disabled={closed} onChange={(e) => set(i, { heat: e.target.value })} /></label>
          <label className="field">Warmwasser (falls genannt)<input inputMode="decimal" className="input-num" value={r.water} disabled={closed} onChange={(e) => set(i, { water: e.target.value })} /></label>
          {!closed && <button type="button" className="btn ghost" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Zeile entfernen</button>}
        </div>
      ))}
      {error && <div className="error">{error}</div>}
      {!closed && (
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setRows([...rows, emptyServiceRow(from, to)])}>+ weitere Zeile</button>
          <button className="btn" onClick={() => void save()}>Werte speichern</button>
        </div>
      )}
    </div>
  )
}
