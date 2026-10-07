import { useState } from 'react'
import type { HeatingPeriodView, HeatingPlant } from '../types'
import { api, errorText } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { CONTRACT_OPTIONS, contractBody, contractToForm, dwdHint, infoBody, infoToForm, type ContractForm, type InfoForm } from '../heatingInfoForm'
import { inheritedText } from '../heatingRulesForm'

// Karte „Angaben zur Abrechnung (§ 6a)“ (Heizung PR 14): was Mietfuchs für die Informationen nach § 6a Abs. 3
// HeizkostenV nicht selbst kennt. Die Vergleiche (Nr. 4, 5) rechnet Mietfuchs nur bei eigener Abrechnung; dort
// fragt die Karte den Vergleichswert und die Klimafaktoren, je mit Quelle.
export default function HeatingInfoCard({ plant, view, onChanged }: { plant: HeatingPlant; view: HeatingPeriodView; onChanged: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<InfoForm>(() => infoToForm(view.info))
  const [contract, setContract] = useState<ContractForm>(() => contractToForm(view.rules.consumerContract))
  const [error, setError] = useState('')
  const self = plant.method === 'self'
  const set = (k: keyof InfoForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  async function save() {
    const r = infoBody(form)
    if ('error' in r) return setError(r.error)
    const c = contractBody(contract)
    if ('error' in c) return setError(c.error)
    try {
      await api(`/api/heating-plants/${plant.id}/periods/${view.period}/info`, { method: 'PUT', body: JSON.stringify(r.body) })
      // Der Verbrauchervertrag gilt wie die Angaben zu § 11 ab dieser Heizperiode; gespeichert wird er nur, wenn er
      // sich gegenüber dem geltenden ändert, damit eine geerbte Antwort nicht still zur eigenen wird.
      if (c.body.consumerContract !== view.rules.consumerContract) {
        await api(`/api/heating-plants/${plant.id}/periods/${view.period}/rules`, { method: 'PUT', body: JSON.stringify(c.body) })
      }
      setError('')
      toast('Angaben gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const fromContract = inheritedText(view.rules.fromPeriod.consumerContract, view.period)
  return (
    <div className="card no-print">
      <h3><Term id="billingInfo">Angaben zur Abrechnung (§ 6a)</Term> · {view.label}</h3>
      <p className="muted">
        Mietfuchs druckt die Informationen nach § 6a HeizkostenV mit der Abrechnung. Energieträger, Entgelte der Erfassung und die Kontaktadressen kennt es
        selbst; was hier fehlt, nennt die Abrechnung mit der Kürzung, die die Mieter dann erklären dürfen.
      </p>
      {error && <div className="error">{error}</div>}
      <label className="field grow">
        <span>Steuern, Abgaben und Zölle laut Rechnung des Versorgers</span>
        <input value={form.taxes} disabled={view.closed} onChange={set('taxes')} placeholder="z. B. Energiesteuer 312,00 €, Umsatzsteuer 19 %" />
      </label>
      <p className="muted">Übernehmen Sie, was die Rechnung des Versorgers dazu ausweist; die Angabe erscheint so auf der Abrechnung.</p>
      {plant.energy === 'districtHeating' && (
        <>
          <div className="row">
            <label className="field">
              <span>Treibhausgasemissionen laut Versorger (g CO₂-Äquivalent je kWh)</span>
              <input inputMode="decimal" value={form.ghg} disabled={view.closed} onChange={set('ghg')} />
            </label>
            <label className="field">
              <span>Primärenergiefaktor des Netzes</span>
              <input inputMode="decimal" value={form.pef} disabled={view.closed} onChange={set('pef')} />
            </label>
          </div>
          <p className="muted">Beide Werte nennt der Fernwärmeversorger. Die jährliche Menge rechnet Mietfuchs aus den Kilowattstunden Ihrer Lieferungen.</p>
        </>
      )}
      {self && (
        <>
          <div className="row">
            <label className="field">
              <span>Vergleichswert eines Durchschnittsnutzers (kWh je m² Wohnfläche)</span>
              <input inputMode="decimal" value={form.reference} disabled={view.closed} onChange={set('reference')} />
            </label>
            <label className="field grow">
              <span>Quelle des Vergleichswerts</span>
              <input value={form.referenceSource} disabled={view.closed} onChange={set('referenceSource')} placeholder="z. B. Vergleichswerte Ihres Ablesedienstes" />
            </label>
          </div>
          <p className="muted">
            Gemeint ist ein Wert für die ganze Heizperiode aus Vergleichsdaten, etwa vom Ablesedienst; Mietfuchs rechnet ihn auf Wohnfläche und Tage jedes Mieters um.
            Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich.
          </p>
          <div className="row">
            <label className="field">
              <span><Term id="climateFactor">Klimafaktor</Term> dieser Heizperiode</span>
              <input inputMode="decimal" value={form.climateFactor} disabled={view.closed} onChange={set('climateFactor')} />
            </label>
            <label className="field">
              <span>Klimafaktor der vorigen Heizperiode</span>
              <input inputMode="decimal" value={form.climateFactorPrev} disabled={view.closed} onChange={set('climateFactorPrev')} />
            </label>
            <label className="field grow">
              <span>Quelle der Klimafaktoren</span>
              <input value={form.climateSource} disabled={view.closed} onChange={set('climateSource')} placeholder="z. B. Deutscher Wetterdienst, Klimafaktoren" />
            </label>
          </div>
          <p className="muted">{dwdHint(view.info.postalCode, view.from, view.to)} Ist der Faktor der vorigen Heizperiode dort schon eingetragen, lassen Sie das Feld leer.</p>
        </>
      )}
      <label className="field grow">
        <span>Vermieten Sie als Unternehmer?</span>
        <select value={contract.contract} disabled={view.closed} onChange={(e) => setContract({ ...contract, contract: e.target.value as ContractForm['contract'] })}>
          {CONTRACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {contract.contract === 'yes' && (
        <label className="field grow">
          <span>Information zur Streitbeilegung nach dem Verbraucherstreitbeilegungsgesetz</span>
          <input value={contract.disputeText} disabled={view.closed} onChange={(e) => setContract({ ...contract, disputeText: e.target.value })} />
        </label>
      )}
      <p className="muted">
        Beim Verbrauchervertrag gehört die Information zur Streitbeilegung dazu (§ 6a Abs. 3 Satz 1 Nr. 3 HeizkostenV); welche Stelle zuständig ist und ob Sie
        teilnehmen, entscheiden Sie (§§ 36, 37 VSBG).{fromContract ? ` ${fromContract}` : ''}
      </p>
      {!view.closed && (
        <div className="row">
          <button className="btn secondary" onClick={() => void save()}>Angaben speichern</button>
        </div>
      )}
    </div>
  )
}
