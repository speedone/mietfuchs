// Bezugszähler und verteilter Rest (#98, Entwurf 2026-11-04-virtuelle-zaehler-design.md, „Oberfläche“) im Seitenfenster der
// Kostenposition, unter dem Schlüssel „nach Verbrauch“. Wer nichts einstellt, sieht nur die Frage „Verbrauch ohne eigenen
// Zähler“ mit „tragen Sie (wie bisher)“ und, falls es welche gibt, die Zwischenzähler. Erst eine andere Antwort zeigt
// Bezugszähler und Empfänger. Speichert nichts selbst: Jede Wahl ändert das Formular über `onChange`; alle Auswahlfelder
// werden aus den Listen in costForm.ts gespeist, die den gespeicherten Wert immer enthalten (angezeigt gleich gespeichert).
import { useId } from 'react'
import type { Meter, Unit } from '../types'
import {
  meterRestChoiceOf, meterRestChoices, meterRestKeyOptions, restBasisUnits, restUnitChoices, subGroupUnits, subTargetOptions,
  subTargetValue, toggleBehind, toggleRestUnit, toggleSubUnit, withMeterRestKey, withReference, withSubTarget, type ItemForm,
} from '../costForm'
import Field, { FieldMessage } from './Field'
import Term from './Term'

type Props = {
  form: ItemForm
  meters: readonly Meter[]
  units: Unit[]
  onChange: (next: ItemForm) => void
  // Kennung und Meldung aus `useFormError().field('meterRest')`; die Kennung trägt die erste Antwort.
  field?: { id?: string; error?: string; onFix?: () => void }
}

export default function MeterRestFields({ form, meters, units, onChange, field }: Props) {
  const name = useId()
  const rest = form.meterRest
  const choice = meterRestChoiceOf(form)
  const { references, behind, subs } = meterRestChoices(form, meters, units)
  const basisIds = restBasisUnits(form, units).map((u) => u.id)
  const errorId = field?.error ? `${name}-error` : undefined
  const change = (next: ItemForm) => { field?.onFix?.(); onChange(next) }
  // Bezug und Liste dahinter bei einer Antwort außer „tragen Sie“, und immer, wenn ein anderer Bezug gespeichert ist.
  const showsReference = rest !== null && (choice !== 'off' || rest.referenceMeterId !== null || rest.unitIds !== null)
  const recipients = restUnitChoices(form, units, rest?.unitIds ?? null)
  return (
    <fieldset className="basis-full grid gap-2" aria-describedby={errorId}>
      <legend className="font-strong"><Term id="meterRest">Verbrauch ohne eigenen Zähler</Term></legend>
      <small className="muted">
        Was der Hauptzähler mehr misst als die Zähler der Wohnungen (Treppenhaus, Außenhahn, Wohnungen ohne Zähler).
        „tragen Sie (wie bisher)“: Haben alle bewohnten Wohnungen einen Zähler, zählt nur deren Verbrauch.
      </small>
      {field?.error && <FieldMessage id={errorId} error={field.error} />}
      {meterRestKeyOptions(form.meterRest).map((o, i) => (
        <label key={o.value} className="checkline">
          <input type="radio" name={`${name}-key`} value={o.value} checked={choice === o.value}
            id={i === 0 ? field?.id : undefined} aria-invalid={field?.error ? true : undefined}
            onChange={() => change(withMeterRestKey(form, o.value, units))} />
          {o.label}
        </label>
      ))}
      {showsReference && rest !== null && (
        <>
          {(references.length > 1 || rest.referenceMeterId !== null) && (
            <Field label={<Term id="referenceMeter">Bezugszähler</Term>} hint="Meist der Hauptzähler; sonst ein Zähler für einen Teil des Hauses, etwa der Allgemeinstromzähler.">
              <select value={rest.referenceMeterId ?? ''} onChange={(e) => change(withReference(form, e.target.value, meters, units))}>
                {references.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          {rest.referenceMeterId !== null && (
            <fieldset className="grid gap-1">
              <legend>Zähler hinter dem Bezugszähler</legend>
              <small className="muted">Nur die Zähler, deren Verbrauch der Bezugszähler mitmisst. Die Wohnungsstromzähler der Mieter hängen meist nicht am Allgemeinstrom.</small>
              {behind.length === 0 && <small className="muted">Keine Zähler an Wohnungen in dieser Sparte.</small>}
              {behind.map((o) => (
                <label key={o.value} className="checkline">
                  <input type="checkbox" checked={rest.behindMeterIds?.includes(o.value) ?? false}
                    onChange={(e) => change(toggleBehind(form, o.value, e.target.checked))} />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {(choice !== 'off' || rest.unitIds !== null) && (recipients.length > 1 || rest.unitIds !== null) && (
            <details className="extra-details" open={rest.unitIds !== null}>
              <summary>nur auf bestimmte Wohnungen</summary>
              <fieldset className="checks">
                <legend className="sr-only">Empfänger des Allgemeinverbrauchs</legend>
                {recipients.map((u) => (
                  <label key={u.id} className="field checkline">
                    <span>
                      <input type="checkbox" checked={rest.unitIds === null || rest.unitIds.includes(u.id)}
                        onChange={(e) => change(toggleRestUnit(form, u.id, e.target.checked, basisIds))} />{' '}
                      {u.label}
                    </span>
                  </label>
                ))}
              </fieldset>
            </details>
          )}
        </>
      )}
      {subs.length > 0 && (
        <div className="grid gap-1">
          <small className="muted">Zwischenzähler ohne Wohnung, etwa für den Garten: Sein Verbrauch geht vom Allgemeinverbrauch ab und an das gewählte Ziel.</small>
          {subs.map((o) => {
            const group = subGroupUnits(form, o.value)
            return (
              <div key={o.value} className="grid gap-1">
                <Field label={`Zwischenzähler „${o.label}“`}>
                  <select value={subTargetValue(form, o.value)} onChange={(e) => change(withSubTarget(form, o.value, e.target.value, units))}>
                    {subTargetOptions(form, o.value, units).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                {group !== null && (
                  <fieldset className="checks">
                    <legend className="sr-only">{`Wohnungen für „${o.label}“`}</legend>
                    {restUnitChoices(form, units, group).map((u) => (
                      <label key={u.id} className="field checkline">
                        <span>
                          <input type="checkbox" checked={group.includes(u.id)}
                            onChange={(e) => change(toggleSubUnit(form, o.value, u.id, e.target.checked))} />{' '}
                          {u.label}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
