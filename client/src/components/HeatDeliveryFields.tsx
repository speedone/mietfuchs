// Die Angaben zu einer Umstellung auf Wärmelieferung während laufender Mietverhältnisse (Heizung PR 16, #213), in der
// Einrichtung der Heizung und beim Kesseltausch. Aus ihnen nennt die Abrechnung § 556c BGB und die
// Wärmelieferverordnung oder, wenn die Mieter vorher selbst heizten, die Rechtslage nach BGH VIII ZR 46/25.
import { PREVIOUS_SUPPLY_OPTIONS, SWITCH_HINT } from '../heatingForm'
import type { PreviousSupply } from '../types'
import Term from './Term'

export type HeatDeliveryValues = { deliverySince: string; previousSupply: '' | PreviousSupply; announcedOn: string }

export default function HeatDeliveryFields({ values, onChange }: { values: HeatDeliveryValues; onChange: (v: HeatDeliveryValues) => void }) {
  return (
    <fieldset>
      <legend>Umstellung auf <Term id="heatDelivery">Wärmelieferung</Term> während laufender Mietverhältnisse</legend>
      <p className="muted">{SWITCH_HINT}</p>
      <label className="field grow">
        Tag der Umstellung
        <input type="date" value={values.deliverySince} onChange={(e) => onChange({ ...values, deliverySince: e.target.value })} />
      </label>
      <label className="field grow">
        Wer versorgte vorher?
        <select value={values.previousSupply} onChange={(e) => onChange({ ...values, previousSupply: PREVIOUS_SUPPLY_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
          {PREVIOUS_SUPPLY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="field grow">
        Umstellungsankündigung zugegangen am
        <input type="date" value={values.announcedOn} onChange={(e) => onChange({ ...values, announcedOn: e.target.value })} />
      </label>
    </fieldset>
  )
}
