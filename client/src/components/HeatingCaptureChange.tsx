import { useState } from 'react'
import type { CaptureMethod, HeatingPlant } from '../types'
import { captureOf } from '../../../shared/heatingPeriod.ts'
import { api, ApiError, errorText } from '../api'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import { useOptionalProperty, withProperty } from '../property'
import { CAPTURE_SELF_OPTIONS, captureHint } from '../heatingSelfForm'

// #690: Die Erfassung der eigenen Heizkostenabrechnung direkt ändern. Geschickt wird nur die Erfassung
// (`captureOnly` an der Route der Einrichtung); Warmwasser, Maßstab, Anteil nach Verbrauch und Teil und Ziel der
// Heizpositionen bleiben am Server, wie sie gespeichert sind. Vorher ging das nur über „Niemand“, und das verwarf sie.
export default function HeatingCaptureChange({ plant, period, periodLabel, onDone, onCancel }: {
  plant: HeatingPlant; period: string; periodLabel: string; onDone: (p: HeatingPlant) => void; onCancel: () => void
}) {
  const saved = captureOf(plant, period)
  const [capture, setCapture] = useState<CaptureMethod>(saved)
  const errors = useFormError<'capture'>()
  const toast = useToast()
  const confirm = useConfirm()
  const propertyId = useOptionalProperty()?.property?.id
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      type Done = { plant: HeatingPlant; estimatesNotice?: string | null }
      const send = (confirmCapture: boolean) =>
        api<Done>(withProperty(`/api/heating-plants/${plant.id}/self`, propertyId), { method: 'PUT', body: JSON.stringify({ period, capture, captureOnly: true, ...(confirmCapture ? { confirmCapture: true } : {}) }) })
      let done: Done
      try {
        done = await send(false)
      } catch (e) {
        // Zählt danach Erfasstes nicht mehr, sagt der Server, was (#690, Durchsicht); gewechselt wird erst bestätigt.
        if (!(e instanceof ApiError && e.status === 409 && e.data.question === 'capture')) throw e
        const ok = await confirm({ title: 'Erfassung trotzdem ändern?', message: e.message, confirmLabel: 'Erfassung ändern', cancelLabel: 'Abbrechen' })
        if (!ok) return
        done = await send(true)
      }
      errors.clear()
      if (done.estimatesNotice) toast(done.estimatesNotice, 'error')
      onDone(done.plant)
    } catch (e) {
      errors.show(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      title="Erfassung ändern"
      onClose={onCancel}
      onSubmit={submit}
      value={capture}
      busy={busy}
      errors={errors}
      actions={<button className="btn" onClick={submit} disabled={busy}>Speichern</button>}
    >
      <p className="muted">
        Die neue Erfassung gilt ab dem Beginn der Heizperiode {periodLabel}; frühere Heizperioden rechnen weiter mit ihren Geräten. Der Anteil nach
        Verbrauch, die Angaben zum Warmwasser und Teil und Ziel der Heizpositionen bleiben, wie sie sind. Zähler, Heizkostenverteiler und
        eingetragene Werte eines Ablesedienstes werden nicht gelöscht; was danach nicht mehr zählt, nennt Mietfuchs vor dem Speichern.
      </p>
      <Field label="Womit wird der Verbrauch erfasst?" hint={captureHint(capture)} {...errors.field('capture')}>
        <select value={capture} onChange={(e) => setCapture(e.target.value as CaptureMethod)}>
          {CAPTURE_SELF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    </Drawer>
  )
}
