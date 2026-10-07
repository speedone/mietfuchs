// Stichtagswert laut Anzeige eines elektronischen Heizkostenverteilers (Heizung PR 12, Entwurf 3.5, 8.1).
// Das Gerät setzt am Stichtag auf null zurück und zeigt den Wert davor; erfasst wird das wie ein
// Zählerwechsel.
import { useState } from 'react'
import { api, errorText } from '../api'
import { cutoffReadingBody, type CutoffForm } from '../hcaForm'

export default function CutoffReadingForm({ meterId, onSaved }: { meterId: string; onSaved: () => void }) {
  const [form, setForm] = useState<CutoffForm>({ date: '', value: '' })
  const [error, setError] = useState('')
  async function save() {
    const r = cutoffReadingBody(meterId, form)
    if ('error' in r) {
      setError(r.error)
      return
    }
    try {
      await api('/api/readings', { method: 'POST', body: JSON.stringify(r.body) })
      setError('')
      setForm({ date: '', value: '' })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="stack">
      <p className="muted">Elektronische Heizkostenverteiler setzen am Stichtag auf null und zeigen den Wert davor als Stichtagswert. Tragen Sie ihn hier ein; Mietfuchs erfasst das wie einen Zählerwechsel. Passend ist ein Stichtag am Tag vor dem Beginn der Heizperiode, bei einer Heizperiode im Kalenderjahr also der 31.12. Liegt er anders, tragen Sie zu Beginn und Ende die Werte laut Gerätespeicher ein.</p>
      <div className="row">
        <label className="field">
          Stichtag des Geräts
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="field">
          Stichtagswert laut Anzeige
          <input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="input-num" />
        </label>
        <button className="btn secondary" onClick={() => void save()}>Stichtagswert speichern</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
