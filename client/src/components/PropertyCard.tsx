import { useState } from 'react'
import type { CostItem } from '../types'
import { propertyBody, propertySummary, propertyToForm, spreadRestChange, type PropertyField, type PropertyForm } from '../propertyForm'
import { api, ApiError, errorText } from '../api'
import { useProperty, withProperty } from '../property'
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
  // Die Kosten des Objekts, geladen beim Öffnen: Das Feld zum Ende der Verteilung (§ 82b Abs. 2 EStDV, #262 PR 4) steht nur
  // mit einer verteilten Position da, und die Rückfrage nennt deren Jahre. Ohne geladene Kosten fragt der Server (409).
  const [items, setItems] = useState<CostItem[]>([])

  if (!property) return null

  function open() {
    if (!property) return
    errors.clear()
    setForm(propertyToForm(property))
    setItems([])
    api<CostItem[]>(withProperty('/api/costItems', property.id)).then(setItems, () => setItems([]))
  }

  const save = () => saving.run(async () => {
    if (!property || !form) return
    const body = propertyBody(form, property.iban)
    if ('error' in body) {
      errors.report(body.problems)
      return
    }
    errors.clear()
    const title = 'Verteilung für die Steuer ändert sich'
    const questions = spreadRestChange(form.spreadRestSaved, body, items)
    if (questions.length > 0 && !(await confirm({ title, message: questions.join(' '), confirmLabel: 'So speichern', cancelLabel: 'Abbrechen' }))) return
    const send = (confirmed: boolean) => api(`/api/properties/${property.id}`, { method: 'PUT', body: JSON.stringify({ ...body, ...(confirmed ? { confirmSpread: true } : {}) }) })
    try {
      try {
        await send(questions.length > 0)
      } catch (e) {
        // Fragt der Server trotzdem (die Kosten haben sich seit dem Öffnen geändert), wird seine Rückfrage zu der der Seite.
        if (!(e instanceof ApiError && e.status === 409 && e.data.question === 'spread') || questions.length > 0) throw e
        if (!(await confirm({ title, message: e.message, confirmLabel: 'So speichern', cancelLabel: 'Abbrechen' }))) return
        await send(true)
      }
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
          <PropertyFields form={form} setForm={setForm} errors={errors} storedIban={property.iban} spreadItems={items} />
        </Drawer>
      )}
    </Card>
  )
}
