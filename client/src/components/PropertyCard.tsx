import { useEffect, useState } from 'react'
import type { Property, PropertyKind } from '../types'
import { propertyBody, propertyToForm, type PropertyForm, CABLE_LABELS, type CableAnswer } from '../propertyForm'
import { PROPERTY_KIND_LABELS } from '../types'
import Term from './Term'
import { api } from '../api'
import { useProperty } from '../property'
import { useConfirm, useToast } from './feedback'

// Die Karte „Objekt“ in den Stammdaten (#92): Name, Adresse und Art des gewählten Objekts,
// aufklappbar ein abweichender Vermieter mit Bankverbindung und Zahlungsfrist, dazu ein
// weiteres Objekt anlegen oder ein leeres löschen.
//
// Wer ein Haus vermietet, sieht hier dieselbe Karte wie früher die Karte „Haus“, nur mit der
// Art als drittem Feld. Die Knöpfe für weitere Objekte stehen klein darunter.

export default function PropertyCard() {
  const { properties, property, setPropertyId, reload } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState<PropertyForm | null>(null)
  const [newName, setNewName] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Nur beim Wechsel des Objekts neu füllen (#105): Hinge es am Objekt selbst, verwürfe jedes
  // Neuladen der Liste ungespeicherte Eingaben.
  const propertyId = property?.id
  useEffect(() => {
    setForm(property ? propertyToForm(property) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bewusst nur an der Kennung
  }, [propertyId])

  if (!property || !form) return null

  async function save() {
    if (!property || !form) return
    const body = propertyBody(form)
    if ('error' in body) {
      setError(body.error)
      return
    }
    setError('')
    try {
      await api(`/api/properties/${property.id}`, { method: 'PUT', body: JSON.stringify(body) })
      await reload()
      toast('Objekt gespeichert.')
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  async function create() {
    const name = (newName ?? '').trim()
    if (!name) {
      setError('Bitte einen Namen für das neue Objekt eingeben.')
      return
    }
    setError('')
    try {
      const created = await api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name }) })
      setNewName(null)
      await reload()
      setPropertyId(created.id)
      toast(`Objekt „${name}“ angelegt. Die Seiten zeigen jetzt dieses Objekt; umschalten geht in der Seitenleiste.`)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  async function remove() {
    if (!property) return
    const ok = await confirm({
      title: `Objekt „${property.name || 'ohne Namen'}“ löschen?`,
      message: 'Gelöscht wird nur ein leeres Objekt, ohne Wohnungen, Zähler, Kosten und Abrechnungen.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/properties/${property.id}`, { method: 'DELETE' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setError('')
    await reload()
    toast('Objekt gelöscht.')
  }

  return (
    <div className="card">
      <h2>Objekt</h2>
      <div className="row">
        <label className="field grow">
          Bezeichnung
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Mehrfamilienhaus Musterstraße" />
        </label>
        <label className="field grow">
          Adresse
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
        </label>
        <label className="field">
          Art
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PropertyKind })}>
            {(Object.keys(PROPERTY_KIND_LABELS) as PropertyKind[]).map((k) => <option key={k} value={k}>{PROPERTY_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        {/* #121: Bei einer Anlage ab dem 01.12.2021 war das TV-Signal nie umlagefähig. */}
        <label className="field">
          <span>Kabel- oder <Term id="cableTv">Antennenanlage</Term></span>
          <select value={form.cable} onChange={(e) => setForm({ ...form, cable: e.target.value as CableAnswer })}>
            {(Object.keys(CABLE_LABELS) as CableAnswer[]).map((k) => <option key={k} value={k}>{CABLE_LABELS[k]}</option>)}
          </select>
        </label>
      </div>
      <details open={form.own}>
        <summary>Abweichender Vermieter oder Bankverbindung</summary>
        <p className="muted">
          Etwa beim Haus der Eltern oder einer Erbengemeinschaft. Ohne Haken, und für jedes leere Feld,
          gelten Vermieter, IBAN und Zahlungsfrist aus den Einstellungen.
        </p>
        <label className="field checkline">
          <span>
            <input type="checkbox" checked={form.own} onChange={(e) => setForm({ ...form, own: e.target.checked })} />{' '}
            Für dieses Objekt abweichend
          </span>
        </label>
        {form.own && (
          <div className="row">
            <label className="field grow">
              Vermieter
              <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} />
            </label>
            <label className="field grow">
              IBAN
              <input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
            </label>
            <label className="field">
              Zahlungsfrist (Tage)
              <input inputMode="numeric" value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} />
            </label>
          </div>
        )}
      </details>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn" onClick={save}>Speichern</button>
        {newName === null ? (
          <button className="btn ghost" onClick={() => setNewName('')}>Weiteres Objekt anlegen</button>
        ) : (
          <>
            <input aria-label="Name des neuen Objekts" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="z. B. Eigentumswohnung Gartenweg" />
            <button className="btn" onClick={create}>Anlegen</button>
            <button className="btn ghost" onClick={() => setNewName(null)}>Abbrechen</button>
          </>
        )}
        {properties.length > 1 && <button className="btn ghost" onClick={remove}>Objekt löschen</button>}
      </div>
    </div>
  )
}
