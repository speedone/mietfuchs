import type { ItemForm } from '../costForm'
import Term from './Term'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'

// Leistungszeitraum, Jahr der Zahlung und „Brennstoff/Energie“ einer Kostenposition (#208).
// Steht unter „Weitere Angaben“, denn wer im Kalenderjahr abrechnet und Rechnungen für das
// Kalenderjahr hat, braucht nichts davon (Entwurf 11.1).
export default function CostPeriodFields({ form, onChange, showTaxYear, years }: {
  form: ItemForm
  onChange: (next: ItemForm) => void
  showTaxYear: boolean
  years: number[]
}) {
  return (
    <>
      <div className="row">
        <label className="field">
          <span><Term id="accrualPrinciple">Leistungszeitraum</Term> von</span>
          <input type="date" value={form.serviceFrom} onChange={(e) => onChange({ ...form, serviceFrom: e.target.value })} />
        </label>
        <label className="field">
          bis
          <input type="date" value={form.serviceTo} onChange={(e) => onChange({ ...form, serviceTo: e.target.value })} />
        </label>
      </div>
      <p className="muted">
        Nur nötig, wenn die Rechnung einen anderen Zeitraum hat als Ihre Abrechnung. Kalte Betriebskosten über zwei
        Abrechnungszeiträume teilt Mietfuchs beim Speichern nach Tagen auf; Heizkosten nicht.
      </p>
      {form.category === HEATING_CATEGORY && (
        <label className="field checkline">
          <input type="checkbox" checked={form.heatingFuel} onChange={(e) => onChange({ ...form, heatingFuel: e.target.checked })} />
          <span>Brennstoff/Energie (Gas, Öl, Fernwärme, Strom der Wärmepumpe)</span>
        </label>
      )}
      {showTaxYear && (
        <label className="field">
          Jahr der Zahlung (Steuer)
          <select value={form.taxYear} onChange={(e) => onChange({ ...form, taxYear: e.target.value })}>
            <option value="">– bitte wählen –</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <small className="muted">Maßgeblich ist, wann Sie gezahlt haben (§ 11 Abs. 2 EStG).</small>
        </label>
      )}
    </>
  )
}
