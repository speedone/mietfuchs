// #712: Was die zweite Vorauszahlung (Heizstaffel) deckt, an der Heizanlage: nur Heizung und Warmwasser (Voreinstellung)
// oder auch Wasser/Abwasser, was der Messdienst oft mit abrechnet. Steht im Abschnitt „Zeitraum der Heizung“ unter den
// Knöpfen zum Aufteilen, nur bei aufgeteilter Vorauszahlung in einer gemeinsamen Abrechnung; bei einer eigenen Heizperiode
// sagt ein Satz, warum es die Wahl nicht gibt (Logik in heatingPeriodForm.ts). Ein Entwurf wie jedes Auswahlfeld (#309).
import type { HeatingPlant } from '../types'
import { api, errorText } from '../api'
import { keepDraft, useDraft } from '../useDraft'
import DraftActions from './DraftActions'
import Term from './Term'
import { ErrorSummary, useFormError } from './ErrorSummary'
import {
  SECOND_PREPAYMENT_HELP, SECOND_PREPAYMENT_OPTIONS, SECOND_PREPAYMENT_QUESTION, secondPrepaymentBody, secondPrepaymentState, secondPrepaymentValue,
  type SecondPrepaymentChoice,
} from '../heatingPeriodForm'
import { useOptionalProperty, withProperty } from '../property'

export default function SecondPrepaymentField({ plant, onChanged, notify }: { plant: HeatingPlant; onChanged: () => Promise<void>; notify: (text: string) => void }) {
  const propertyId = useOptionalProperty()?.property?.id
  const state = secondPrepaymentState(plant)
  const draft = useDraft<SecondPrepaymentChoice>(secondPrepaymentValue(plant), { scope: plant.id, isValid: (v) => SECOND_PREPAYMENT_OPTIONS.some((o) => o.value === v) })
  const errors = useFormError()

  async function save(value: SecondPrepaymentChoice) {
    try {
      await api(withProperty(`/api/heating-plants/${plant.id}`, propertyId), { method: 'PUT', body: JSON.stringify(secondPrepaymentBody(value)) })
    } catch (e) {
      errors.set(errorText(e))
      return keepDraft
    }
    errors.set('')
    await onChanged()
    notify('Angabe zur zweiten Vorauszahlung gespeichert.')
  }

  if (state === null) return null
  if (state.kind === 'note') return <p className="muted">{state.text}</p>
  return (
    <div className="field-group">
      <ErrorSummary errors={errors} />
      <label className="field">
        <span><Term id="separateHeatingSettlement">{SECOND_PREPAYMENT_QUESTION}</Term></span>
        <select value={draft.value} disabled={draft.saving} onChange={(e) => draft.set(SECOND_PREPAYMENT_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'heating')}>
          {SECOND_PREPAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <DraftActions draft={draft} onSave={save} what="zweite Vorauszahlung" />
      <p className="muted">{SECOND_PREPAYMENT_HELP}</p>
    </div>
  )
}
