// Betriebsstrom am Kostenformular (Heizung PR 15, #212): an Heizkosten die Frage, ob er über den Zähler
// des Hauses läuft; am Allgemeinstrom mit negativem Betrag, zu welchem Betriebsstrom der Abzug gehört
// (P-W2); an beiden die Grundlage der Schätzung (P-W1). Die Norm steht dabei (P-K1). Die Energie der
// Anlage spielt hier keine Rolle (R2-W1): Auch bei einer Wärmepumpe sind Umwälzpumpen und Regelung
// Betriebsstrom.
import { deductionChoiceOf, deductionChoices, generalChoices, OPERATING_POWER_OPTIONS, showsDeductionLink, showsOperatingPower, withDeductionChoice, withGeneralChoice, type ItemForm } from '../costForm'
import Term from './Term'
import type { CostItem } from '../types'

export default function OperatingPowerFields({ form, items, periodKey, onChange }: { form: ItemForm; items: readonly CostItem[]; periodKey: string; onChange: (next: ItemForm) => void }) {
  const heating = showsOperatingPower(form)
  const deduction = showsDeductionLink(form)
  if (!heating && !deduction) return null
  const marked = (heating && form.operatingPower === 'included') || (deduction && form.operatingPower === 'deduction')
  return (
    <>
      {heating && (
        <label className="field">
          <span>Läuft dieser <Term id="operatingPower">Betriebsstrom</Term> über den Stromzähler des Hauses?</span>
          <select value={form.operatingPower === 'included' ? 'included' : ''} onChange={(e) => onChange({ ...form, operatingPower: e.target.value === 'included' ? 'included' : '' })}>
            {OPERATING_POWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <small className="muted">
            Dann gehört er zu den Heiz- und Warmwasserkosten, oder Sie tragen ihn selbst; im Allgemeinstrom darf er nicht stehen (§ 7 Abs. 2, § 8 Abs. 2 HeizkostenV; BGH, Urteil vom 03.06.2016, V ZR 166/15).
            Ziehen Sie ihn dort ab, etwa mit der Karte „Betriebsstrom“ auf der Seite Heizkosten.
          </small>
        </label>
      )}
      {deduction && (
        <label className="field">
          <span>Abzug des <Term id="operatingPower">Betriebsstroms</Term> der Heizung?</span>
          <select value={deductionChoiceOf(form)} onChange={(e) => onChange(withDeductionChoice(form, e.target.value))}>
            {deductionChoices(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {/* Durchsicht von #252, G-K3: Der Abzug nennt die Rechnung, aus der er stammt, und übernimmt ihre Verteilung. */}
      {deduction && form.operatingPower === 'deduction' && (
        <label className="field">
          <span>Stromrechnung, aus der der Abzug stammt</span>
          <select value={form.operatingPowerGeneralId} onChange={(e) => onChange(withGeneralChoice(form, e.target.value, items))}>
            {generalChoices(items, periodKey).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <small className="muted">Der Abzug wird verteilt wie diese Rechnung, damit er jeden Anteil im selben Verhältnis mindert.</small>
        </label>
      )}
      {marked && (
        <label className="field">
          <span>Grundlage der Schätzung</span>
          <textarea rows={4} value={form.operatingPowerBasis} onChange={(e) => onChange({ ...form, operatingPowerBasis: e.target.value })} />
          <small className="muted">
            Bewahren Sie die Angaben auf: Bestreitet ein Mieter den Betrag, müssen Sie die Grundlagen Ihrer Schätzung darlegen
            (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3). Ändern Sie den Betrag, ändern Sie die Grundlage mit.
          </small>
        </label>
      )}
    </>
  )
}
