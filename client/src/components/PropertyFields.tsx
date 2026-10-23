import type { PropertyKind } from '../types'
import { PROPERTY_KIND_LABELS } from '../types'
import { CABLE_LABELS, type CableAnswer, type PropertyField, type PropertyForm } from '../propertyForm'
import Term from './Term'
import TightMarketField from './TightMarketField'
import FederalStateField from './FederalStateField'
import IbanInput from './IbanInput'
import Field from './Field'
import type { FormErrors } from './ErrorSummary'

// Die Felder eines Objekts, dieselben im Seitenfenster „Neues Objekt“ (NewPropertyDrawer) und „Objekt bearbeiten“
// (PropertyCard), wie bei Wohnungen und Mietverhältnissen ein Formular für beides. Vorher legte ein schmales
// Fenster nur Name, Art und Adresse an, in anderer Reihenfolge und mit „Name“ statt „Bezeichnung“.
export default function PropertyFields({ form, setForm, errors, storedIban }: {
  form: PropertyForm
  setForm: (form: PropertyForm) => void
  errors: FormErrors<PropertyField>
  // Die gespeicherte IBAN des Objekts; ein neues hat keine.
  storedIban: string | null
}) {
  return (
    <>
      <div className="field-grid">
        <Field label="Bezeichnung" required width="l" {...errors.field('name')}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Mehrfamilienhaus Musterstraße" />
        </Field>
        <Field label="Adresse" width="l">
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
        </Field>
        <Field label="Art">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PropertyKind })}>
            {(Object.keys(PROPERTY_KIND_LABELS) as PropertyKind[]).map((k) => <option key={k} value={k}>{PROPERTY_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        {/* Fristen nach Werktagen hängen an den Feiertagen am Ort (shared/deadlines.ts). */}
        <FederalStateField value={form.state} year={new Date().getFullYear()} onChange={(state) => setForm({ ...form, state })} />
        {/* #121: Bei einer Anlage ab dem 01.12.2021 war das TV-Signal nie umlagefähig. */}
        <Field label={<>Kabel- oder <Term id="cableTv">Antennenanlage</Term></>}>
          <select value={form.cable} onChange={(e) => setForm({ ...form, cable: e.target.value as CableAnswer })}>
            {(Object.keys(CABLE_LABELS) as CableAnswer[]).map((k) => <option key={k} value={k}>{CABLE_LABELS[k]}</option>)}
          </select>
        </Field>
        {/* Heizung PR 18: § 5d CO2KostAufG, mit der Geltung der Verordnung. */}
        <TightMarketField value={form.tightMarket} from={form.tightMarketFrom} to={form.tightMarketTo} onChange={(c) => setForm({ ...form, ...c })} />
      </div>
      <details className="extra-details" open={form.own}>
        <summary>Abweichender Vermieter oder Bankverbindung</summary>
        <p className="muted">
          Etwa beim Haus der Eltern oder einer Erbengemeinschaft. Ohne Haken, und für jedes leere Feld,
          gelten Vermieter, IBAN, Zahlungsfrist, Anschrift und Kontakt aus den Einstellungen.
        </p>
        <label className="checkline">
          <input type="checkbox" checked={form.own} onChange={(e) => setForm({ ...form, own: e.target.checked })} />
          Für dieses Objekt abweichend
        </label>
        {form.own && (
          <div className="field-grid">
            <Field label="Vermieter" width="l">
              <input value={form.landlordName} onChange={(e) => setForm({ ...form, landlordName: e.target.value })} />
            </Field>
            <IbanInput label="IBAN" value={form.iban} stored={storedIban} onChange={(iban) => setForm({ ...form, iban })} {...errors.field('iban')} />
            <Field label="Zahlungsfrist (Tage)" width="s" {...errors.field('paymentDeadlineDays')}>
              <input inputMode="numeric" value={form.paymentDeadlineDays} onChange={(e) => setForm({ ...form, paymentDeadlineDays: e.target.value })} />
            </Field>
            {/* Teil 2 von #415: Rücksendeangabe und Fußzeile des Briefs */}
            <Field label="Anschrift des Vermieters" width="l">
              <input value={form.landlordAddress} onChange={(e) => setForm({ ...form, landlordAddress: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
            </Field>
            <Field label="Kontakt" width="l">
              <input value={form.landlordContact} onChange={(e) => setForm({ ...form, landlordContact: e.target.value })} placeholder="Telefon oder E-Mail" />
            </Field>
          </div>
        )}
      </details>
    </>
  )
}
