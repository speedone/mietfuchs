import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Property, PropertyKind } from '../types'
import { propertyBody, propertyToForm, type PropertyForm, CABLE_LABELS, type CableAnswer } from '../propertyForm'
import { PROPERTY_KIND_LABELS } from '../types'
import Term from './Term'
import { api, errorText } from '../api'
import { useOpenForm, useProperty, useSwitchProperty } from '../property'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import { createButtonLabel, EMPTY_NEW_PROPERTY, newPropertyBody, type NewPropertyForm } from '../propertyView'

// Die Karte „Objekt“ in den Stammdaten (#92): Name, Adresse und Art des gewählten Objekts,
// aufklappbar ein abweichender Vermieter mit Bankverbindung und Zahlungsfrist, dazu ein
// weiteres Objekt anlegen oder ein leeres löschen. Das Anlegen geht über einen eigenen Dialog
// (#157), der sagt, was ein Objekt ist, dass das bisherige unverändert bleibt und dass danach
// gewechselt wird.
//
// Wer ein Haus vermietet, sieht hier dieselbe Karte wie früher die Karte „Haus“, nur mit der
// Art als drittem Feld. Die Knöpfe für weitere Objekte stehen klein darunter.

export default function PropertyCard() {
  const { properties, property, reload, setFocusNoticeFor } = useProperty()
  const switchProperty = useSwitchProperty()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState<PropertyForm | null>(null)
  // Der Dialog „Weiteres Objekt anlegen“: `null` heißt zu.
  const [draft, setDraft] = useState<NewPropertyForm | null>(null)
  const [draftError, setDraftError] = useState('')
  const [creating, setCreating] = useState(false)
  // Angelegt, aber die Liste fehlt (#157): Ein zweiter Klick legte es doppelt an. Gesperrt bleibt,
  // bis das angelegte Objekt in der Liste steht, auch über Schließen und neu Öffnen hinweg.
  const [stuckId, setStuckId] = useState<string | null>(null)
  const stuck = stuckId !== null && !properties.some((p) => p.id === stuckId)
  const [error, setError] = useState('')

  // Nur beim Wechsel des Objekts neu füllen (#105): Hinge es am Objekt selbst, verwürfe jedes
  // Neuladen der Liste ungespeicherte Eingaben.
  const propertyId = property?.id
  useEffect(() => {
    setForm(property ? propertyToForm(property) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bewusst nur an der Kennung
  }, [propertyId])

  // Ungespeicherte Änderungen an der Karte gehören zu diesem Objekt (#145); ein Wechsel fragt dann.
  const dirty = !!property && !!form && JSON.stringify(form) !== JSON.stringify(propertyToForm(property))
  useOpenForm(dirty)

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

  function openDraft() {
    setDraft(EMPTY_NEW_PROPERTY)
    setDraftError('')
  }

  async function create() {
    if (!draft || creating || stuck) return
    const body = newPropertyBody(draft)
    if ('error' in body) {
      setDraftError(body.error)
      return
    }
    setDraftError('')
    setCreating(true)
    let created: Property
    try {
      // Name, Art und Adresse in einem Aufruf: Scheitert er, gibt es kein halbes Objekt.
      created = await api<Property>('/api/properties', { method: 'POST', body: JSON.stringify(body) })
    } catch (e) {
      setDraftError(`Das Objekt wurde nicht angelegt. ${errorText(e)}`)
      setCreating(false)
      return
    }
    try {
      await reload()
    } catch (e) {
      // Angelegt ist es, nur die Liste fehlt. Ein zweiter Klick legte es doppelt an, deshalb bleibt
      // der Knopf gesperrt, und die Meldung sagt, wie es weitergeht.
      setCreating(false)
      setStuckId(created.id)
      setDraftError(`„${created.name}“ ist angelegt, die Liste der Objekte ließ sich aber nicht laden. Bitte laden Sie die Seite neu; das Objekt steht dann im Umschalter. ${errorText(e)}`)
      return
    }
    // Erst den Dialog schließen, und zwar sofort: Er ist selbst ein offenes Formular, und der
    // Wechsel fragte sonst nach ihm. Andere offene Eingaben, etwa ungespeicherte Änderungen an
    // dieser Karte, fragen weiterhin (#145).
    flushSync(() => {
      setDraft(null)
      setCreating(false)
    })
    if (await switchProperty(created.id, created.name)) {
      setFocusNoticeFor(created.id)
      toast(`Objekt „${created.name}“ angelegt. Sie arbeiten jetzt darin; Ihre übrigen Objekte sind unverändert.`)
    } else {
      toast(`Objekt „${created.name}“ angelegt. Umschalten geht in der Seitenleiste unter „Objekt“.`)
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
        <button className="btn ghost" onClick={openDraft}>Weiteres Objekt anlegen</button>
        {properties.length > 1 && <button className="btn ghost" onClick={remove}>Objekt löschen</button>}
      </div>
      <Drawer
        open={draft !== null}
        title="Weiteres Objekt anlegen"
        onClose={() => { if (!creating) setDraft(null) }}
        onSubmit={() => void create()}
        footer={draft && (
          <>
            <button className="btn ghost" onClick={() => setDraft(null)} disabled={creating}>Abbrechen</button>
            <button className="btn" onClick={() => void create()} disabled={creating || stuck}>{createButtonLabel(draft.name)}</button>
          </>
        )}
      >
        {draft && (
          <>
            <p className="muted">
              Ein Objekt ist ein weiteres Haus oder eine Eigentumswohnung mit eigenen Wohnungen,
              Zählern, Kosten und Abrechnungen. Ihr bisheriges Objekt „{property.name || 'Ohne Namen'}“
              bleibt unverändert. Nach dem Anlegen arbeiten Sie im neuen Objekt; zurück geht es
              jederzeit über „Objekt“ in der Seitenleiste.
            </p>
            <label className="field">
              Name (Pflicht)
              <input required aria-required="true" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Eigentumswohnung Gartenweg" />
            </label>
            <label className="field">
              Art
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PropertyKind })}>
                {(Object.keys(PROPERTY_KIND_LABELS) as PropertyKind[]).map((k) => <option key={k} value={k}>{PROPERTY_KIND_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="field">
              Adresse
              <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
            </label>
            {draftError && <div className="error" role="alert">{draftError}</div>}
          </>
        )}
      </Drawer>
    </div>
  )
}
