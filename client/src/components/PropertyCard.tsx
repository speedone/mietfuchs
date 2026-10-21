import { useState } from 'react'
import type { PropertyKind } from '../types'
import { propertyBody, propertySummary, propertyToForm, type PropertyField, type PropertyForm, CABLE_LABELS, type CableAnswer } from '../propertyForm'
import { PROPERTY_KIND_LABELS } from '../types'
import Term from './Term'
import TightMarketField from './TightMarketField'
import FederalStateField from './FederalStateField'
import { api, errorText } from '../api'
import { useProperty } from '../property'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import Card from './Card'
import IbanInput from './IbanInput'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { useSaving } from '../useSaving'

// Die Karte „Objekt“ in den Stammdaten (#92). Sie zeigt die Angaben des gewählten Objekts nur an; „Bearbeiten“
// oben rechts öffnet ein Seitenfenster mit allen Feldern, wie bei Wohnungen und Mietverhältnissen. Vorher stand
// hier als einzige Karte der Seite ein offenes Formular mit eigenem „Speichern“. Ein weiteres Objekt legt der
// Seitenkopf an (NewPropertyDrawer), weil es die ganze Seite betrifft; im Fuß steht nur „Objekt löschen …“.
export default function PropertyCard() {
  const { properties, property, reload } = useProperty()
  const toast = useToast()
  const confirm = useConfirm()
  // Das Seitenfenster „Objekt bearbeiten“: `null` heißt zu.
  const [form, setForm] = useState<PropertyForm | null>(null)
  const errors = useFormError<PropertyField>()
  const saving = useSaving()

  if (!property) return null

  function open() {
    if (!property) return
    errors.clear()
    setForm(propertyToForm(property))
  }

  const save = () => saving.run(async () => {
    if (!property || !form) return
    const body = propertyBody(form, property.iban)
    if ('error' in body) {
      errors.report(body.problems)
      return
    }
    errors.clear()
    try {
      await api(`/api/properties/${property.id}`, { method: 'PUT', body: JSON.stringify(body) })
      await reload()
      setForm(null)
      toast('Objekt gespeichert.')
    } catch (e) {
      errors.show(errorText(e))
    }
  })

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
      // Eine Aktion ohne Formular meldet ihren Fehler als Mitteilung, nicht oben auf der Seite (H3).
      toast(errorText(err), 'error')
      return
    }
    await reload()
    toast('Objekt gelöscht.')
  }

  return (
    <Card title="Objekt" aside={<button className="btn secondary" onClick={open}>Bearbeiten</button>}>
      <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {propertySummary(property).map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className="m-0">{r.value}</dd>
          </div>
        ))}
      </dl>
      {properties.length > 1 && (
        <div className="row">
          {/* „…“ weil eine Rückfrage folgt (#346 Schritt 7, M19). */}
          <button className="btn ghost danger-ghost ml-auto" onClick={remove}>Objekt löschen …</button>
        </div>
      )}
      {form && (
        <Drawer
          key={property.id}
          open
          title="Objekt bearbeiten"
          width={640}
          onClose={() => setForm(null)}
          onSubmit={() => void save()}
          value={form}
          busy={saving.busy}
          errors={errors}
          actions={<button className="btn" onClick={() => void save()}>Speichern</button>}
        >
          <div className="field-grid">
            <Field label="Bezeichnung" required width="l" {...errors.field('name')}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Mehrfamilienhaus Musterstraße" />
            </Field>
            <Field label="Adresse" width="l">
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
            </Field>
            <Field label="Art">
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PropertyKind })}>
                {(Object.keys(PROPERTY_KIND_LABELS) as PropertyKind[]).map((k) => <option key={k} value={k}>{PROPERTY_KIND_LABELS[k]}</option>)}
              </select>
            </Field>
            {/* Fristen nach Werktagen hängen an den Feiertagen am Ort (shared/deadlines.ts). */}
            <FederalStateField value={form.state} year={new Date().getFullYear()} onChange={(state) => setForm({ ...form, state })} />
            {/* #121: Bei einer Anlage ab dem 01.12.2021 war das TV-Signal nie umlagefähig. */}
            <Field label={<>Kabel- oder <Term id="cableTv">Antennenanlage</Term></>}>
              <select value={form.cable} onChange={(e) => setForm({ ...form, cable: e.target.value as CableAnswer })}>
                {(Object.keys(CABLE_LABELS) as CableAnswer[]).map((k) => <option key={k} value={k}>{CABLE_LABELS[k]}</option>)}
              </select>
            </Field>
            {/* Heizung PR 18: § 5d CO2KostAufG, mit der Geltung der Verordnung. */}
            <TightMarketField value={form.tightMarket} from={form.tightMarketFrom} to={form.tightMarketTo} onChange={(c) => setForm({ ...form, ...c })} />
          </div>
          <details className="extra-details" open={form.own}>
            <summary>Abweichender Vermieter oder Bankverbindung</summary>
            <p className="muted">
              Etwa beim Haus der Eltern oder einer Erbengemeinschaft. Ohne Haken, und für jedes leere Feld,
              gelten Vermieter, IBAN und Zahlungsfrist aus den Einstellungen.
            </p>
            <label className="checkline">
              <input type="checkbox" checked={form.own} onChange={(e) => setForm({ ...form, own: e.target.checked })} />
              Für dieses Objekt abweichend
            </label>
            {form.own && (
              <div className="field-grid">
                <Field label="Vermieter" width="l">
                  <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} />
                </Field>
                <IbanInput label="IBAN" value={form.iban} stored={property.iban} onChange={(iban) => setForm({ ...form, iban })} {...errors.field('iban')} />
                <Field label="Zahlungsfrist (Tage)" width="s" {...errors.field('paymentDeadlineDays')}>
                  <input inputMode="numeric" value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} />
                </Field>
              </div>
            )}
          </details>
        </Drawer>
      )}
    </Card>
  )
}
