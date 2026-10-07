// Karte „Rechtswerte, die noch nicht veröffentlicht sind“ in den Einstellungen (Heizung PR 17, Entwurf
// 4.5). Zugeklappt, denn eintragen muss hier niemand etwas: Mietfuchs braucht die Werte nur für die
// Prüfung der CO₂-Angaben auf Rechnungen, und das nächste Update bringt den amtlichen Wert ohnehin.
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { draftOf, overrideBody, statusText, unitOf, type OverrideDraft } from '../lawOverrideForm'
import { useToast } from './feedback'
import type { LawOverrideSlot } from '../types'

const keyOf = (s: LawOverrideSlot) => `${s.paramId}|${s.year}`

export default function LawOverridesCard() {
  const [slots, setSlots] = useState<LawOverrideSlot[]>([])
  const [drafts, setDrafts] = useState<Record<string, OverrideDraft>>({})
  const [error, setError] = useState('')
  const toast = useToast()
  async function load() {
    const list = await api<LawOverrideSlot[]>('/api/law-overrides')
    setSlots(list)
    setDrafts(Object.fromEntries(list.map((s) => [keyOf(s), draftOf(s)])))
  }
  useEffect(() => { load().catch((e: unknown) => setError(errorText(e))) }, [])
  async function save(s: LawOverrideSlot) {
    const r = overrideBody(drafts[keyOf(s)] ?? { value: '', source: '' })
    if ('error' in r) return setError(r.error)
    try {
      await api(`/api/law-overrides/${encodeURIComponent(s.paramId)}/${s.year}`, { method: 'PUT', body: JSON.stringify(r.body) })
      setError('')
      await load()
      toast('Eingetragen')
    } catch (e) { setError(errorText(e)) }
  }
  async function remove(s: LawOverrideSlot) {
    try {
      await api(`/api/law-overrides/${encodeURIComponent(s.paramId)}/${s.year}`, { method: 'DELETE' })
      setError('')
      await load()
      toast('Eintrag entfernt')
    } catch (e) { setError(errorText(e)) }
  }
  if (slots.length === 0 && !error) return null
  const entered = slots.filter((s) => s.override !== null).length
  return (
    <div className="card">
      <h2>Rechtswerte, die noch nicht veröffentlicht sind</h2>
      <p className="muted">
        Einige Werte veröffentlicht das Umweltbundesamt erst kurz vor oder nach Jahresbeginn, etwa den CO₂-Preis des neuen Jahres.
        Mietfuchs braucht sie nur, um die CO₂-Angaben Ihrer Rechnungen zu prüfen; keine Zahl Ihrer Abrechnung hängt daran.
        Sie müssen hier nichts eintragen. Bringt ein Update den amtlichen Wert, gilt dieser.
      </p>
      <details className="extra-details" open={entered > 0}>
        <summary>{entered > 0 ? `Ihre Einträge (${entered}) und offene Werte` : 'Offene Werte selbst eintragen'}</summary>
        {slots.map((s) => {
          const k = keyOf(s)
          const d = drafts[k] ?? { value: '', source: '' }
          const unit = unitOf(s)
          return (
            <div className="field-group" key={k} role="group" aria-label={`${s.title} ${s.year}`}>
              <p><strong>{s.title}</strong> ({s.norm})</p>
              <p>{statusText(s)}</p>
              {s.status !== 'superseded' && (
                <>
                  <p className="muted">{s.reason} Tragen Sie den Wert erst ein, wenn er veröffentlicht ist, und nennen Sie die Fundstelle.</p>
                  <div className="row">
                    <label className="field">
                      {unit ? `Wert ${s.year} (${unit})` : `Wert ${s.year}`}
                      <input inputMode="decimal" value={d.value} placeholder="z. B. 64,20" onChange={(e) => setDrafts({ ...drafts, [k]: { ...d, value: e.target.value } })} />
                    </label>
                    <label className="field grow">
                      Quelle
                      <input value={d.source} placeholder="UBA, Bekanntmachung vom …" onChange={(e) => setDrafts({ ...drafts, [k]: { ...d, source: e.target.value } })} />
                    </label>
                  </div>
                </>
              )}
              <div className="row">
                {s.status !== 'superseded' && <button className="btn" type="button" onClick={() => void save(s)}>Speichern</button>}
                {s.override && <button className="btn secondary" type="button" onClick={() => void remove(s)}>Eintrag entfernen</button>}
              </div>
            </div>
          )
        })}
      </details>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
