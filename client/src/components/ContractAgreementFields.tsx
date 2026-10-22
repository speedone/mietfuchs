// Nicht im Mietvertrag vereinbart (#258, Entwurf Entscheidungen 3 bis 5) im Seitenfenster der Kostenposition. Drei Teile:
// - `WhyQuestion`: die Frage direkt unter einer Wohnung, die in der Teilnehmerliste gerade abgewählt wurde;
// - der Textlink „Ein Mieter trägt das laut Mietvertrag nicht …“ unten im Abschnitt Schlüssel, für alle Fälle ohne
//   Teilnehmerliste und als zweiter Weg;
// - bei „Sonstige Betriebskosten“ statt des Textlinks je Mietverhältnis „Ja“/„Nein“ (im Vertrag ausdrücklich genannt).
// Wer einen üblichen Vertrag hat, sieht nur den eingeklappten Textlink. Speichert nichts selbst: Jede Wahl ändert das
// Formular über `onChange`, gespeichert wird mit „Speichern“ im Fuß des Fensters.
import { useEffect, useState } from 'react'
import type { BillingPeriod, Tenancy, Unit } from '../types'
import type { ItemForm } from '../costForm'
import { allowsContractAnswer, answerWhy, chooseWhy, contractTenancies, openWhy, unitTenancies, withNamed, withNotAgreed } from '../contractAgreement'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { FieldMessage } from './Field'
import Term from './Term'

const OTHER_COSTS = 'Sonstige Betriebskosten'

// Entscheidung 4: Bei Heizung und Warmwasser gibt es die Antwort „steht nicht im Vertrag“ nicht.
export const HEATING_CONTRACT_SENTENCE = 'Die Heizkostenverordnung gilt auch, wenn der Mietvertrag die Heizkosten nicht nennt; der Heizanteil der Miete wird dann als Vorauszahlung angerechnet (BGH VIII ZR 212/05). Stellen Sie dafür beim Mietverhältnis die Heizkosten auf ‚in der Miete enthalten‘.'

type Period = Pick<BillingPeriod, 'from' | 'to'>
type Common = { form: ItemForm; units: Unit[]; tenancies: Tenancy[]; period: Period; onChange: (next: ItemForm) => void }

// Die Frage zu einer abgewählten Wohnung (Entscheidung 3). Jede Antwort nimmt die Wohnung aus `pendingWhy`.
// - „Betrifft die Wohnung nicht“: Die Wohnung bleibt abgewählt, die Frage verschwindet.
// - Ein Mietverhältnis im Zeitraum: „Steht nicht im Mietvertrag von Anna Becker“ hakt die Wohnung wieder an und merkt den
//   Mieter; die Frage verschwindet, der Mieter steht angehakt im Textlink darunter.
// - Mehrere: „Steht nicht im Mietvertrag von:“ hakt die Wohnung wieder an; darunter je Mietverhältnis ein Häkchen, mehrere
//   wählbar. Damit die Frage dann stehen bleibt, merkt sich die Seite die Wahl (`chosen`, `onChoose`); das ist bloße Hilfe
//   der Anzeige, die Daten stehen im Formular. Ohne Häkchen meldet „Speichern“ (`untickedChoices`).
// - Heizung und Warmwasser (Entscheidung 4): keine Frage, nur der Satz zur Heizkostenverordnung; nichts zu beantworten.
// `field`: Kennung und Meldung aus `useFormError().field('participants')`; die Kennung trägt die erste Antwort, damit die
// Sammelmeldung dorthin springt (bei mehreren offenen Fragen nur die erste, `first`). Die Meldung geht erst weg, wenn
// keine Frage mehr offen ist.
type WhyProps = Common & { unit: Unit; field?: { id?: string; error?: string; onFix?: () => void }; first?: boolean; chosen?: boolean; onChoose?: (contract: boolean) => void }
export function WhyQuestion({ form, unit, units, tenancies, period, onChange, field, first = true, chosen = false, onChoose }: WhyProps) {
  if (form.category === HEATING_CATEGORY) return <small className="muted basis-full">{HEATING_CONTRACT_SENTENCE}</small>
  const own = unitTenancies(unit.id, units, tenancies, period)
  const name = `why-${unit.id}`
  const commit = (next: ItemForm) => { if (openWhy(next).length === 0) field?.onFix?.(); onChange(next) }
  const choose = (why: 'notConcerned' | 'contract') => { onChoose?.(why === 'contract'); commit(chooseWhy(form, unit.id, why, units, tenancies, period)) }
  const errorId = field?.error ? `${name}-error` : undefined
  return (
    <fieldset className="basis-full grid gap-2" aria-describedby={errorId}>
      <legend className="font-strong">{`Warum trägt ${unit.name} diese Kosten nicht?`}</legend>
      {field?.error && <FieldMessage id={errorId} error={field.error} />}
      <label className="checkline">
        <input type="radio" name={name} checked={false} id={first ? field?.id : undefined} aria-invalid={field?.error ? true : undefined} onChange={() => choose('notConcerned')} />
        Betrifft die Wohnung nicht, etwa Aufzug für das Erdgeschoss. Die übrigen Wohnungen tragen den Anteil.
      </label>
      {own.length === 1 ? (
        <label className="checkline">
          <input type="radio" name={name} checked={false} onChange={() => commit(answerWhy(form, unit.id, 'contract', [own[0].tenancyId]))} />
          {`Steht nicht im Mietvertrag von ${own[0].tenantName}. Den Anteil trägt der Vermieter.`}
        </label>
      ) : (
        <>
          <label className="checkline">
            <input type="radio" name={name} checked={chosen} onChange={() => choose('contract')} />
            <span id={`${name}-contract`}>Steht nicht im Mietvertrag von:</span>
          </label>
          {chosen && (
            <div role="group" aria-labelledby={`${name}-contract`} className="grid gap-1 pl-6">
              <div className="checks">
                {own.map((t) => (
                  <label key={t.tenancyId} className="checkline">
                    <input type="checkbox" checked={form.notAgreed.includes(t.tenancyId)} onChange={(e) => commit(withNotAgreed(form, t.tenancyId, e.target.checked))} />
                    {t.tenantName}
                  </label>
                ))}
              </div>
              <small className="muted">Den Anteil der angehakten Mieter trägt der Vermieter.</small>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}

// Textlink (Entscheidung 3a) bzw. der Abschnitt bei „Sonstige Betriebskosten“ (Entscheidung 5). Nichts bei Heizung, nicht
// umlagefähigen Kosten und der Rücklage, und nichts ohne Mietverhältnis an der Position.
export default function ContractAgreementFields({ form, units, tenancies, period, onChange }: Common) {
  const rows = allowsContractAnswer(form.category) ? contractTenancies(form, units, tenancies, period) : []
  const any = rows.some((r) => form.notAgreed.includes(r.tenancyId))
  // Offen, wenn schon jemand angehakt ist, auch wenn das erst die Warum-Frage getan hat; zuklappen kann man selbst.
  const [open, setOpen] = useState(any)
  useEffect(() => { if (any) setOpen(true) }, [any])
  if (rows.length === 0) return null
  const label = (r: (typeof rows)[number]) => `${r.tenantName} (${r.unitName})`
  if (form.category === OTHER_COSTS) {
    return (
      <div className="field-group">
        <p className="m-0">Gehört die Position eigentlich zu einer anderen Kostenart, wählen Sie diese oben.</p>
        <div className="field-group-label"><Term id="namedOtherCosts">Im Mietvertrag ausdrücklich genannt?</Term></div>
        <small className="muted">Sonstige Betriebskosten trägt ein Mieter nur, wenn der Vertrag sie beim Namen nennt, etwa „Dachrinnenreinigung“ (BGH VIII ZR 167/03).</small>
        {rows.map((r) => (
          <fieldset key={r.tenancyId}>
            <legend>{label(r)}</legend>
            <div className="checks">
            <label className="checkline">
              <input type="radio" name={`named-${r.tenancyId}`} checked={form.named.includes(r.tenancyId)} onChange={() => onChange(withNamed(form, r.tenancyId, true))} /> Ja
            </label>
            <label className="checkline">
              <input type="radio" name={`named-${r.tenancyId}`} checked={form.notAgreed.includes(r.tenancyId)} onChange={() => onChange(withNamed(form, r.tenancyId, false))} /> Nein
            </label>
            </div>
          </fieldset>
        ))}
      </div>
    )
  }
  return (
    <details className="extra-details" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Ein Mieter trägt das laut Mietvertrag nicht …</summary>
      <div className="muted">
        Steht die Kostenart nicht im Mietvertrag, trägt der Mieter sie nicht (§ 556 Abs. 1 BGB). Seinen Anteil trägt dann
        der Vermieter; die übrigen Mieter zahlen nicht mehr.
      </div>
      <div className="checks">
        {rows.map((r) => (
          <label key={r.tenancyId} className="field checkline">
            <span>
              <input type="checkbox" checked={form.notAgreed.includes(r.tenancyId)} onChange={(e) => onChange(withNotAgreed(form, r.tenancyId, e.target.checked))} />{' '}
              {label(r)}: trägt nicht, steht nicht im Vertrag
            </span>
          </label>
        ))}
      </div>
    </details>
  )
}
