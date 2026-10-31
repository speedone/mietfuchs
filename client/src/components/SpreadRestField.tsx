import { useId, useState } from 'react'
import Term from './Term'
import DisclosureButton from './DisclosureButton'
import Field from './Field'
import { SPREAD_REST_LABEL, SPREAD_REST_NONE, spreadRestOptions, type SpreadRestItem } from '../propertyForm'

// Das Jahr des vorzeitigen Endes nach § 82b Abs. 2 EStDV am Objekt (#262 PR 4, Entwurf E-7), in „Objekt bearbeiten“ unter
// „Für die Steuer (Anlage V)“. Knapp am Feld steht, was das Jahr bewirkt; Erbfall, Schenkung (Auslegung) und teilweiser
// Wechsel der Nutzung stehen eingeklappt unter „Mehr dazu“ (S33). Der Knopf steht außerhalb des `<Field>`, sonst nähme er
// dem Auswahlfeld die Beschriftung (wie SpreadField).
export default function SpreadRestField({ value, saved, items, onChange }: { value: string; saved: string; items: readonly SpreadRestItem[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const moreId = useId()
  const years = spreadRestOptions(items, saved, value)
  return (
    <div>
      <Field label={SPREAD_REST_LABEL} hint={<>In diesem Jahr ziehen Sie den Rest des <Term id="spread82b">verteilten Erhaltungsaufwands</Term> auf einmal ab.</>}>
        <select value={value} onChange={(e) => onChange(years.some((y) => String(y) === e.target.value) ? e.target.value : '')}>
          <option value="">{SPREAD_REST_NONE}</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </Field>
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Mehr dazu" openLabel="Weniger" controls={moreId} className="btn ghost small" />
      <div id={moreId} hidden={!open}>
        <p className="muted fine">
          Endet die Verteilung vorzeitig, ist der noch nicht abgezogene Teil im Jahr des Endes abzuziehen: bei Verkauf, wenn das
          Gebäude in ein Betriebsvermögen kommt oder wenn Sie es nicht mehr vermieten, etwa weil Sie selbst einziehen
          (§ 82b Abs. 2 EStDV).
        </p>
        <p className="muted fine">Im Erbfall zieht der Verstorbene den Rest im Todesjahr ab; die Erben führen die Verteilung nicht fort (BFH, Urteil vom 10.11.2020, IX R 31/19).</p>
        <p className="muted fine">
          Bei einer Schenkung ist das eine Auslegung: Wer geschenkt bekommt, führt die Verteilung nicht fort (FG Münster, Urteil vom 15.04.2016, 4 K 422/15 E). R 21.1 Abs. 6 Sätze 2 und 3 EStR 2012, nach denen er fortführen durfte, sind durch das Urteil von 2020 überholt. Fragen Sie im Zweifel Ihren Steuerberater.
        </p>
        <p className="muted fine">Wechselt nur die Nutzung einer Wohnung, rechnet Mietfuchs die Anteile weiter wie gewählt; ob dann für einen Teil das Ende gilt, klären Sie bitte mit Ihrem Steuerberater.</p>
      </div>
    </div>
  )
}
