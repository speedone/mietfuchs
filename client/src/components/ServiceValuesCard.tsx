// Die Karte „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 5.6, 8.1): je Wohnung und
// Nutzungszeitraum die bewerteten Einheiten (oder kWh) für die Heizung und, wenn der Dienst sie nennt, das
// Warmwasser in m³. Gespeichert wird immer die ganze Liste der Heizperiode.
import { useState } from 'react'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { emptyServiceRow, SERVICE_UNIT_OPTIONS, serviceRowsOf, serviceUnitOfOption, serviceValuesBody, SERVICE_VALUES_HINTS, type ServiceRowForm } from '../hcaForm'
import type { HeatingServiceValue, PeriodKey } from '../types'

type Props = {
  plantId: string
  period: PeriodKey
  from: string
  to: string
  closed: boolean
  units: readonly { id: string; name: string }[]
  values: readonly HeatingServiceValue[]
  // Ist an der Anlage unbekannt, ob die Geräte aus der Ferne ablesbar sind (Durchsicht von #241, Recht-I6)?
  remoteUnknown?: boolean
  onSaved: () => void
}

export default function ServiceValuesCard({ plantId, period, from, to, closed, units, values, remoteUnknown = false, onSaved }: Props) {
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
      <h2>Werte des <Term id="serviceReading">Ablesedienstes</Term></h2>
      {SERVICE_VALUES_HINTS.map((h) => <p className="muted" key={h}>{h}</p>)}
      {remoteUnknown && <p className="muted">Ob die Geräte aus der Ferne ablesbar sind, tragen Sie in den Stammdaten bei der Heizanlage unter „Ändern“ ein; Mietfuchs kennt die Geräte des Ablesedienstes nicht und braucht die Angabe für die Kürzung nach § 12 Abs. 1 Satz 2 HeizkostenV.</p>}
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
          <label className="field">Heizung (bewertet)<input inputMode="decimal" className="input-num" value={r.heat} disabled={closed} onChange={(e) => set(i, { heat: e.target.value })} /></label>
          <label className="field">
            Einheit der Heizung
            <select value={r.heatUnit} disabled={closed} onChange={(e) => set(i, { heatUnit: serviceUnitOfOption(e.target.value) })}>
              {SERVICE_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">Warmwasser in m³ (falls genannt)<input inputMode="decimal" className="input-num" value={r.water} disabled={closed} onChange={(e) => set(i, { water: e.target.value })} /></label>
          {!closed && <button type="button" className="btn ghost" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Zeile entfernen</button>}
        </div>
      ))}
      {error && <div className="error">{error}</div>}
      {!closed && (
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setRows([...rows, emptyServiceRow(from, to, rows[rows.length - 1]?.heatUnit ?? 'units')])}>+ weitere Zeile</button>
          <button className="btn" onClick={() => void save()}>Werte speichern</button>
        </div>
      )}
    </div>
  )
}
