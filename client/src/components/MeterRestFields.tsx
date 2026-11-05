// Bezugszähler und verteilter Rest (#98, Entwurf 2026-11-04-virtuelle-zaehler-design.md, „Oberfläche“) im Seitenfenster der
// Kostenposition, unter dem Schlüssel „nach Verbrauch“. Wer nichts einstellt, sieht nur die Frage „Verbrauch ohne eigenen
// Zähler“ mit „tragen Sie“ (wie bisher, ohne Angabe). Erst eine andere Antwort zeigt Bezugszähler, Empfänger und
// Zwischenzähler. Speichert nichts selbst: Jede Wahl ändert das Formular über `onChange`; alle Auswahlfelder werden aus
// den Listen in costForm.ts gespeist, die den gespeicherten Wert immer enthalten (angezeigt gleich gespeichert).
import { useId } from 'react'
import type { Meter, Unit } from '../types'
import {
  meterRestChoiceOf, meterRestChoices, meterRestKeyOptions, restBasisUnits, subTargetOptions, subTargetValue, toggleBehind,
  toggleRestUnit, withMeterRestKey, withReference, withSubTarget, type ItemForm,
} from '../costForm'
import Field, { FieldMessage } from './Field'
import Term from './Term'

type Props = {
  form: ItemForm
  meters: readonly Meter[]
  units: Unit[]
  onChange: (next: ItemForm) => void
  // Kennung und Meldung aus `useFormError().field('meterRest')`: Die Liste der Zähler hinter dem Bezugszähler fehlt.
  field?: { id?: string; error?: string; onFix?: () => void }
}

export default function MeterRestFields({ form, meters, units, onChange, field }: Props) {
  const name = useId()
  const rest = form.meterRest
  const choice = meterRestChoiceOf(form)
  const { references, behind, subs } = meterRestChoices(form, meters, units)
  const basis = restBasisUnits(form, units)
  const basisIds = basis.map((u) => u.id)
  const grouped = rest !== null && rest.key !== 'landlord' && rest.key !== 'selfUse'
  const errorId = field?.error ? `${name}-error` : undefined
  return (
    <fieldset className="basis-full grid gap-2">
      <legend className="font-strong"><Term id="meterRest">Verbrauch ohne eigenen Zähler</Term></legend>
      <small className="muted">
        Was der Hauptzähler mehr misst als die Zähler der Wohnungen (Treppenhaus, Außenhahn, Wohnungen ohne Zähler).
        „tragen Sie“ rechnet wie bisher: Haben alle bewohnten Wohnungen einen Zähler, zählt nur deren Verbrauch.
      </small>
      {meterRestKeyOptions(rest).map((o) => (
        <label key={o.value} className="checkline">
          <input type="radio" name={`${name}-key`} value={o.value} checked={choice === o.value} onChange={() => onChange(withMeterRestKey(form, o.value))} />
          {o.label}
        </label>
      ))}
      {rest !== null && (
        <>
          {references.length > 1 && (
            <Field label={<Term id="referenceMeter">Bezugszähler</Term>} hint="Meist der Hauptzähler; sonst ein Zähler für einen Teil des Hauses, etwa der Allgemeinstromzähler.">
              <select value={rest.referenceMeterId ?? ''} onChange={(e) => onChange(withReference(form, e.target.value, meters, units))}>
                {references.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          {rest.referenceMeterId !== null && (
            <fieldset className="grid gap-1" aria-describedby={errorId}>
              <legend>Zähler hinter dem Bezugszähler</legend>
              <small className="muted">Nur die Zähler, deren Verbrauch der Bezugszähler mitmisst. Die Wohnungsstromzähler der Mieter hängen meist nicht am Allgemeinstrom.</small>
              {field?.error && <FieldMessage id={errorId} error={field.error} />}
              {behind.length === 0 && <small className="muted">Keine Zähler an Wohnungen in dieser Sparte.</small>}
              {behind.map((o, i) => (
                <label key={o.value} className="checkline">
                  <input type="checkbox" id={i === 0 ? field?.id : undefined} aria-invalid={field?.error ? true : undefined}
                    checked={rest.behindMeterIds?.includes(o.value) ?? false}
                    onChange={(e) => { field?.onFix?.(); onChange(toggleBehind(form, o.value, e.target.checked)) }} />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {grouped && basis.length > 1 && (
            <details className="extra-details" open={rest.unitIds !== null}>
              <summary>nur auf bestimmte Wohnungen</summary>
              <fieldset className="checks">
                <legend className="sr-only">Empfänger des Allgemeinverbrauchs</legend>
                {basis.map((u) => (
                  <label key={u.id} className="field checkline">
                    <span>
                      <input type="checkbox" checked={rest.unitIds === null || rest.unitIds.includes(u.id)}
                        onChange={(e) => onChange(toggleRestUnit(form, u.id, e.target.checked, basisIds))} />{' '}
                      {u.name}
                    </span>
                  </label>
                ))}
              </fieldset>
            </details>
          )}
          {subs.length > 0 && (
            <div className="grid gap-1">
              <small className="muted">Zwischenzähler ohne Wohnung, etwa für den Garten: Sein Verbrauch geht vom Allgemeinverbrauch ab und an das gewählte Ziel.</small>
              <div className="field-grid">
                {subs.map((o) => (
                  <Field key={o.value} label={`Zwischenzähler „${o.label}“`}>
                    <select value={subTargetValue(form, o.value)} onChange={(e) => onChange(withSubTarget(form, o.value, e.target.value))}>
                      {subTargetOptions(form, o.value, units).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
