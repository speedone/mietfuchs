// Das Bundesland am Objekt, für Fristen nach Werktagen und die Feiertage am Ort (shared/deadlines.ts).
// Die Logik steht in propertyForm.ts; hier wird nur gerendert.
import type { FederalState } from '../types'
import Field from './Field'
import { STATE_OPTIONS, STATE_UNKNOWN_HINT, stateFromSelect, stateNote } from '../propertyForm'

export default function FederalStateField({ value, year, onChange }: { value: FederalState | ''; year: number; onChange: (state: FederalState | '') => void }) {
  const note = stateNote(value, year)
  return (
    <Field label="Bundesland (für Fristen und Feiertage)" hint={value === '' ? STATE_UNKNOWN_HINT : note || undefined}>
      <select value={value} onChange={(e) => onChange(stateFromSelect(e.target.value))}>
        {STATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}
