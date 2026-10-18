// Karte „Rechtswerte, die noch nicht veröffentlicht sind“ in den Einstellungen (Heizung PR 17, Entwurf
// 4.5). Zugeklappt, denn eintragen muss hier niemand etwas: Mietfuchs braucht die Werte nur für die
// Prüfung der CO₂-Angaben auf Rechnungen, und das nächste Update bringt den amtlichen Wert ohnehin.
import { useEffect, useState } from 'react'
import { api, errorText } from '../api'
import { draftOf, earlyHint, fieldLabel, overrideBody, statusText, type OverrideDraft } from '../lawOverrideForm'
import { useToast } from './feedback'
import { useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import Card from './Card'
import type { LawOverrideSlot } from '../types'
import { ErrorSummary, useFormError } from './ErrorSummary'

const keyOf = (s: LawOverrideSlot) => `${s.paramId}|${s.year}`

export default function LawOverridesCard() {
  const [slots, setSlots] = useState<LawOverrideSlot[]>([])
  // Fehler als Sammelmeldung oben in der Karte (#346, Schritt 3)
  const errors = useFormError()
  const setError = errors.set
  const toast = useToast()
  // Jeder Wert ist ein Entwurf an seiner Gruppe mit eigenem „Speichern“, das erst bei einer Änderung erscheint, und meldet
  // sich dann als offenes Formular an (#309, #346 Schritt 7 und 7a).
  async function load() {
    setSlots(await api<LawOverrideSlot[]>('/api/law-overrides'))
  }
  useEffect(() => { load().catch((e: unknown) => setError(errorText(e), { focus: false })) }, [setError])
  async function save(s: LawOverrideSlot, d: OverrideDraft) {
    const r = overrideBody(d)
    if ('error' in r) throw new Error(r.error)
    await api(`/api/law-overrides/${encodeURIComponent(s.paramId)}/${s.year}`, { method: 'PUT', body: JSON.stringify(r.body) })
    setError('')
    await load()
    toast('Eingetragen')
  }
  async function remove(s: LawOverrideSlot) {
    try {
      await api(`/api/law-overrides/${encodeURIComponent(s.paramId)}/${s.year}`, { method: 'DELETE' })
      setError('')
      await load()
      toast('Eintrag entfernt')
    } catch (e) { setError(errorText(e)) }
  }
  if (slots.length === 0 && errors.state.problems.length === 0) return null
  const entered = slots.filter((s) => s.override !== null).length
  return (
    <Card title="Rechtswerte, die noch nicht veröffentlicht sind">
      <ErrorSummary errors={errors} />
      <p className="muted">
        Einige Werte veröffentlicht das Umweltbundesamt erst kurz vor oder nach Jahresbeginn, etwa den CO₂-Preis des neuen Jahres.
        Mietfuchs braucht sie nur, um die CO₂-Angaben Ihrer Rechnungen zu prüfen; keine Zahl Ihrer Abrechnung hängt daran.
        Sie müssen hier nichts eintragen. Bringt ein Update den amtlichen Wert, gilt dieser.
      </p>
      <details className="extra-details" open={entered > 0}>
        <summary>{entered > 0 ? `Ihre Einträge (${entered}) und offene Werte` : 'Offene Werte selbst eintragen'}</summary>
        {slots.map((s) => <SlotGroup key={keyOf(s)} slot={s} onSave={(d) => save(s, d)} onRemove={() => void remove(s)} />)}
      </details>
    </Card>
  )
}

// Ein offener Wert: Betrag und Quelle als Entwurf an der Gruppe, „Speichern“ erst bei einer Änderung (#309, #346 Schritt 7).
function SlotGroup({ slot: s, onSave, onRemove }: { slot: LawOverrideSlot; onSave: (d: OverrideDraft) => Promise<void>; onRemove: () => void }) {
  const draft = useDraft(draftOf(s), { scope: keyOf(s) })
  const d = draft.value
  const early = earlyHint(s, new Date().toISOString().slice(0, 10))
  return (
    <div className="field-group" role="group" aria-label={`${s.title} ${s.year}`}>
      <p><strong>{s.title}</strong> ({s.norm})</p>
      <p>{statusText(s)}</p>
      {s.status !== 'superseded' && (
        <>
          <p className="muted">{`${s.reason} Tragen Sie den Wert erst ein, wenn er veröffentlicht ist, und nennen Sie die Fundstelle.`}</p>
          <div className="row">
            <label className="field">
              {fieldLabel(s)}
              <input inputMode="decimal" value={d.value} placeholder="z. B. 64,20" disabled={draft.saving} onChange={(e) => draft.set({ ...d, value: e.target.value })} />
            </label>
            <label className="field">
              Quelle
              <input value={d.source} placeholder="UBA, Bekanntmachung vom …" disabled={draft.saving} onChange={(e) => draft.set({ ...d, source: e.target.value })} />
            </label>
          </div>
          {early && <p className="notice">{early}</p>}
        </>
      )}
      <div className="row">
        {s.status !== 'superseded' && <DraftActions draft={draft} onSave={onSave} what={`${s.title} ${s.year}`} />}
        {s.override && <button className="btn ghost danger-ghost ml-auto" type="button" onClick={onRemove}>Eintrag entfernen</button>}
      </div>
    </div>
  )
}
