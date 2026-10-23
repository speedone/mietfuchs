import { useState } from 'react'
import { propertyBody, propertySummary, propertyToForm, type PropertyField, type PropertyForm } from '../propertyForm'
import { api, errorText } from '../api'
import { useProperty } from '../property'
import { useConfirm, useToast } from './feedback'
import Drawer from './Drawer'
import Card from './Card'
import PropertyFields from './PropertyFields'
import { useFormError } from './ErrorSummary'
import { useSaving } from '../useSaving'

// Die Karte „Objekt“ in den Stammdaten (#92). Sie zeigt die Angaben des gewählten Objekts nur an; „Bearbeiten“
// oben rechts öffnet ein Seitenfenster mit allen Feldern, wie bei Wohnungen und Mietverhältnissen. Vorher stand
// hier als einzige Karte der Seite ein offenes Formular mit eigenem „Speichern“. Ein weiteres Objekt legt die
// Seitenleiste unter dem Umschalter an (NewPropertyDrawer, mit denselben Feldern aus PropertyFields); im Fuß steht
// nur „Objekt löschen …“.
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
    <Card title="Objekt" aside={<button className="btn secondary" onClick={open}>Bearbeiten{' '}<span className="sr-only">(Objekt)</span></button>}>
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
          <PropertyFields form={form} setForm={setForm} errors={errors} storedIban={property.iban} />
        </Drawer>
      )}
    </Card>
  )
}
