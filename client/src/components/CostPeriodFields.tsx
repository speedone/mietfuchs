import { HEATING_PART_OPTIONS, paidOnTenDayHint, showsPaidOn, type ItemForm } from '../costForm'
import Term from './Term'
import { isNotAllocable } from '../types'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { RESERVE_WITHDRAWAL_CATEGORY } from '../../../shared/categories.ts'

// Leistungszeitraum, Jahr der Zahlung und „Brennstoff/Energie“ einer Kostenposition (#208).
// Steht unter „Weitere Angaben“, denn wer im Kalenderjahr abrechnet und Rechnungen für das
// Kalenderjahr hat, braucht nichts davon (Entwurf 11.1).
// `billTaxYear`: beim Abzug für Betriebsstrom das Steuerjahr seiner Stromrechnung (`deductionTaxYear` in costForm.ts);
// dann gibt es kein Feld, der Abzug hat kein eigenes Jahr (#267).
// `paidOnChanges`: was das eingetragene Zahlungsdatum für die Steuer ändert (`paidOnChange` in costForm.ts); das
// Formular zeigt es hier und fragt vor dem Speichern nach (#255 PR 3, R-2).
// `emptyLabel` (#478, E4): der Leerwert der Auswahl; im Kalenderzeitraum „wie Abrechnungsjahr (2025)“, denn dort ist leer
// eine gültige Angabe, sonst „– bitte wählen –“.
// `droppedPaidOn` (#96, A3): bei der Entnahme aus der Erhaltungsrücklage der Satz, dass ein eingetragenes Datum entfällt
// und in welchem Jahr die Position bleibt (`droppedPaidOnText` in costForm.ts).
export default function CostPeriodFields({ form, onChange, showTaxYear, years, emptyLabel = '– bitte wählen –', billTaxYear = null, paidOnChanges = [], droppedPaidOn = null }: {
  form: ItemForm
  onChange: (next: ItemForm) => void
  showTaxYear: boolean
  years: number[]
  emptyLabel?: string
  billTaxYear?: number | null
  paidOnChanges?: string[]
  droppedPaidOn?: string | null
}) {
  const deduction = form.operatingPower === 'deduction'
  // #96 (A1, Durchsicht R-G): Bei der Entnahme zählt das Jahr, in dem die Gemeinschaft bezahlt, nicht die eigene Zahlung.
  const withdrawal = form.category === RESERVE_WITHDRAWAL_CATEGORY
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
      {/* #267: Der Abzug ist ein Ausschnitt der bezahlten Stromrechnung und zählt in deren Jahr. */}
      {showTaxYear && deduction && (
        <p className="muted">
          Jahr der Zahlung (Steuer): wie die Stromrechnung{billTaxYear !== null ? ` (${billTaxYear})` : ''}. Der Abzug teilt die Stromrechnung nur auf und
          wird nicht eigens bezahlt; für die Steuer zählt er deshalb im Jahr, in dem Sie die Stromrechnung bezahlt haben.
        </p>
      )}
      {showTaxYear && !deduction && withdrawal && (
        <label className="field">
          <span>Jahr, in dem die Gemeinschaft bezahlt hat (<Term id="reserveFund">Steuer</Term>)</span>
          <select value={form.taxYear} onChange={(e) => onChange({ ...form, taxYear: e.target.value })}>
            <option value="">{emptyLabel}</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <small className="muted">Steht in der Hausgeldabrechnung dieses Jahres (Entnahmen aus der Erhaltungsrücklage). Ohne Angabe gilt das Jahr der Abrechnung.</small>
          <small className="muted">
            Maßgeblich ist, wann die Gemeinschaft die Maßnahme aus der Rücklage bezahlt, nicht wann Sie Ihr Hausgeld gezahlt haben (BFH,
            Urteil vom 14.01.2025, IX R 19/24); ein Zahlungsdatum gibt es deshalb nicht. Eine Maßnahme, die über die Erhaltung hinausgeht, etwa
            ein neuer Aufzug oder ein Anbau, erfassen Sie bitte nicht als Entnahme: Sie wirkt über die Abschreibung, die Mietfuchs nicht rechnet.
          </small>
          {droppedPaidOn !== null && <small className="muted" role="status">{droppedPaidOn}</small>}
        </label>
      )}
      {showTaxYear && !deduction && !withdrawal && (
        <label className="field">
          Jahr der Zahlung (Steuer)
          <select value={form.taxYear} onChange={(e) => onChange({ ...form, taxYear: e.target.value })}>
            <option value="">{emptyLabel}</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <small className="muted">Maßgeblich ist, wann Sie gezahlt haben (§ 11 Abs. 2 EStG).</small>
          {/* Recht-H-1 und K-4 (Folge-PR zu #252), seit #267 umgedreht: Der Abzug folgt der Stromrechnung. */}
          {form.operatingPower === 'included' && (
            <small className="muted">
              Läuft Strom der Heizung über den Zähler des Hauses, steht sein Abzug beim Allgemeinstrom immer im Jahr der Stromrechnung, denn beide
              teilen die Stromrechnung nur auf. Die Heizposition steht in dem Jahr, das Sie hier wählen; ist es ein anderes, gleicht Mietfuchs das in
              der Steuerübersicht je Jahr aus, und die Stromrechnung zählt einmal, im Jahr ihrer Zahlung.
            </small>
          )}
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
      {/* #255 PR 3: das Zahlungsdatum für die ganze Position (R-2, R-3, R-7, R-8). */}
      {showsPaidOn(form) && (
        <label className="field">
          <span><Term id="paymentDate">Bezahlt am (für die Steuer)</Term></span>
          <input type="date" aria-label="Bezahlt am (für die Steuer)" value={form.paidOn} onChange={(e) => onChange({ ...form, paidOn: e.target.value })} />
          <small className="muted">
            Der Tag, an dem das Geld abgeflossen ist (bei einer Gutschrift: zugeflossen), nicht das Rechnungsdatum. Überweisung: der Tag, an dem
            Ihr Auftrag bei Ihrer Bank einging (Konto gedeckt). Lastschrift: der Tag des Einzugs. Bar: der Tag der Übergabe. Kreditkarte: der Tag der
            Zahlung, nicht der Kartenabrechnung. Für die Steuer zählt die Position dann im Jahr dieses Tages (§ 11 Abs. 2 EStG); ohne Datum gilt
            {showTaxYear && !deduction ? ' die Auswahl darüber' : ' das Jahr der Abrechnung'}.
          </small>
          <small className="muted">
            Das Datum steht für die ganze Position. Haben Sie in Abschlägen gezahlt, etwa monatlich für Gas, Wasser oder Müll, lassen Sie es leer:
            Abschläge zählen in dem Jahr, in dem Sie sie gezahlt haben, eine Nachzahlung oder ein Guthaben der Jahresrechnung in dem Jahr, in dem Sie zahlen bzw. die Gutschrift erhalten. Tragen
            Sie die Aufteilung in Ihrer Steuererklärung um, bis Mietfuchs die Abbuchungen vom Kontoauszug zuordnen kann.
          </small>
          {paidOnTenDayHint(form) && (
            <small className="muted">
              Zahlung um den Jahreswechsel: Eine regelmäßig wiederkehrende Zahlung, etwa ein Abschlag oder, nach herrschender Auslegung, auch ein jährlicher Versicherungsbeitrag, die bis zehn Tage
              vor oder nach dem Jahreswechsel fällig ist und in dieser Zeit gezahlt wurde, zählt zu dem Jahr, zu dem sie gehört (§ 11 Abs. 2 Satz 2 in
              Verbindung mit Abs. 1 Satz 2 EStG). Mietfuchs rechnet das nicht, denn es kennt die Fälligkeit nicht. Trifft es zu, tragen Sie die Zahlung in
              Ihrer Steuererklärung in dem Jahr ein, zu dem sie gehört, nicht im Jahr des Datums.
            </small>
          )}
          {paidOnChanges.length > 0 && <small className="notice" role="status">{paidOnChanges.join(' ')} Vor dem Speichern fragt Mietfuchs nach.</small>}
        </label>
      )}
      {form.key === 'external' && !isNotAllocable(form.category) && form.operatingPower !== 'deduction' && (
        <p className="muted">
          Bezahlt am (für die Steuer): Bei Hausgeld laut Gemeinschaftsabrechnung gibt es kein Datum, denn die Position ist Ihr Anteil laut
          Hausgeldabrechnung und keine einzelne Zahlung. Für die Steuer zählen die Vorschüsse im Jahr ihrer Zahlung, eine Nachzahlung oder ein
          Guthaben aus der Abrechnung in dem Jahr, in dem Sie zahlen bzw. die Gutschrift erhalten; das folgt aus § 11 EStG, ein Urteil des BFH eigens dazu ist nicht bekannt. Die Zuführung zur Erhaltungsrücklage zählt erst, wenn die Gemeinschaft sie
          für Erhaltung ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24). Mietfuchs setzt den Anteil laut Hausgeldabrechnung an; weicht das ab, berichtigen
          Sie es in der Steuererklärung.
        </p>
      )}
    </>
  )
}
