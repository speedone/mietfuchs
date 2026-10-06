import { HEATING_PART_OPTIONS, type ItemForm } from '../costForm'
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
        <label className="field">
          <span>Teil der Heizkosten (<Term id="fuelStock">Brennstoff</Term> oder anderes)</span>
          <select aria-label="Teil der Heizkosten" value={form.heatingPart} onChange={(e) => onChange({ ...form, heatingPart: HEATING_PART_OPTIONS.find((o) => o.value === e.target.value)?.value ?? '' })}>
            {HEATING_PART_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <small className="muted">
            Brennstoff/Energie ist die Rechnung über Gas, Öl, Pellets, Fernwärme oder den Strom der Wärmepumpe. Wartung, Schornsteinfeger und
            Betriebsstrom sind Betrieb, die Kosten des Messdienstes Ablesung. Mietfuchs braucht die Angabe für den Vorschlag der Vorauszahlung
            und beim Vorrat, um zu erkennen, ob im Vorjahr schon Brennstoff abgerechnet wurde.
          </small>
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
          {/* Laienprobe B15, Review Runde 1: Eine Position hat ein Jahr; Abschläge über zwei Jahre gehören in zwei. */}
          <small className="muted">
            Haben Sie die Rechnung in Abschlägen über zwei Kalenderjahre bezahlt, etwa monatlich für Gas, Wasser oder Müll, gehört jeder Abschlag
            in das Jahr, in dem Sie ihn gezahlt haben, und die Nachzahlung in das Jahr ihrer Zahlung. Ein regelmäßig wiederkehrender Abschlag, der um den
            Jahreswechsel (bis zehn Tage davor oder danach) fällig ist und in dieser Zeit gezahlt wird, zählt zu dem Jahr, zu dem er gehört
            (§ 11 Abs. 2 Satz 2 in Verbindung mit Abs. 1 Satz 2 EStG). Mietfuchs ordnet eine
            Position nur einem Jahr zu: Wählen Sie das Jahr, in dem Sie den größten Teil gezahlt haben, und tragen Sie in Ihrer Steuererklärung den Rest
            aus diesem Jahr heraus und in das andere Jahr ein.
          </small>
        </label>
      )}
    </>
  )
}
