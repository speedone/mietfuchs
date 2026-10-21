import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Property, PropertyKind } from '../types'
import { PROPERTY_KIND_LABELS } from '../types'
import { api, errorText } from '../api'
import { useProperty, useSwitchProperty } from '../property'
import { useToast } from './feedback'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { createButtonLabel, EMPTY_NEW_PROPERTY, newPropertyBody, type NewPropertyForm } from '../propertyView'

// Das Seitenfenster „Weiteres Objekt anlegen“ (#157): sagt, was ein Objekt ist, dass das bisherige unverändert
// bleibt und dass danach gewechselt wird. Geöffnet aus dem Seitenkopf der Stammdaten. Es bleibt eingehängt, auch
// wenn es zu ist: Die Sperre nach „angelegt, aber die Liste fehlt“ muss Schließen und neu Öffnen überstehen.
export default function NewPropertyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { properties, property, reload, setFocusNoticeFor } = useProperty()
  const switchProperty = useSwitchProperty()
  const toast = useToast()
  // `null` heißt zu; beim Öffnen leer.
  const [draft, setDraft] = useState<NewPropertyForm | null>(null)
  const errors = useFormError<'name'>()
  const setError = errors.set
  const [creating, setCreating] = useState(false)
  // Angelegt, aber die Liste fehlt (#157): Ein zweiter Klick legte es doppelt an. Gesperrt bleibt, bis das
  // angelegte Objekt in der Liste steht.
  const [stuckId, setStuckId] = useState<string | null>(null)
  const stuck = stuckId !== null && !properties.some((p) => p.id === stuckId)

  useEffect(() => {
    setDraft(open ? EMPTY_NEW_PROPERTY : null)
    if (open) setError('')
  }, [open, setError])

  async function create() {
    if (!draft || creating || stuck) return
    const body = newPropertyBody(draft)
    if ('error' in body) {
      errors.report([{ field: 'name', short: 'Name fehlt', text: body.error }])
      return
    }
    setError('')
    setCreating(true)
    let created: Property
    try {
      // Name, Art und Adresse in einem Aufruf: Scheitert er, gibt es kein halbes Objekt.
      created = await api<Property>('/api/properties', { method: 'POST', body: JSON.stringify(body) })
    } catch (e) {
      setError(`Das Objekt wurde nicht angelegt. ${errorText(e)}`)
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
      setError(`„${created.name}“ ist angelegt, die Liste der Objekte ließ sich aber nicht laden. Bitte laden Sie die Seite neu; das Objekt steht dann im Umschalter. ${errorText(e)}`)
      return
    }
    // Erst das Fenster schließen, und zwar sofort: Es ist selbst ein offenes Formular, und der Wechsel
    // fragte sonst nach ihm. Andere offene Eingaben fragen weiterhin (#145).
    flushSync(() => {
      setDraft(null)
      setCreating(false)
      onClose()
    })
    if (await switchProperty(created.id, created.name)) {
      setFocusNoticeFor(created.id)
      toast(`Objekt „${created.name}“ angelegt. Sie arbeiten jetzt darin; Ihre übrigen Objekte sind unverändert.`)
    } else {
      toast(`Objekt „${created.name}“ angelegt. Umschalten geht in der Seitenleiste unter „Objekt“.`)
    }
  }

  return (
    <Drawer
      open={open && draft !== null}
      title="Weiteres Objekt anlegen"
      onClose={() => { if (!creating) onClose() }}
      onSubmit={() => void create()}
      value={draft}
      hint="Strg+S legt an · Esc schließt"
      busy={creating}
      errors={errors}
      actions={draft && <button className="btn" onClick={() => void create()} disabled={creating || stuck}>{createButtonLabel(draft.name)}</button>}
    >
      {draft && (
        <>
          <p className="muted">
            Ein Objekt ist ein weiteres Haus oder eine Eigentumswohnung mit eigenen Wohnungen,
            Zählern, Kosten und Abrechnungen. Ihr bisheriges Objekt „{property?.name || 'Ohne Namen'}“
            bleibt unverändert. Nach dem Anlegen arbeiten Sie im neuen Objekt; zurück geht es
            jederzeit über „Objekt“ in der Seitenleiste.
          </p>
          <Field label="Name" required width="l" {...errors.field('name')}>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Eigentumswohnung Gartenweg" />
          </Field>
          <Field label="Art">
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PropertyKind })}>
              {(Object.keys(PROPERTY_KIND_LABELS) as PropertyKind[]).map((k) => <option key={k} value={k}>{PROPERTY_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Adresse" width="l">
            <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
          </Field>
        </>
      )}
    </Drawer>
  )
}
