import type { AgreedOtherwise, ExemptionScope, HeatingExemption, HeatingPeriodView, HeatingPeriodData, HeatingPlant } from '../types'
import { useState } from 'react'
import { api, errorText } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { AGREED_OPTIONS, asksBilling, asksScope, billingText, EXEMPTION_NOT_OFFERED, EXEMPTION_OPTIONS, EXEMPTION_SCOPE_OPTIONS, inheritedText, laterClosedText, MONTHLY_ELSEWHERE_LABEL } from '../heatingRulesForm'

type RulesBody = Partial<Pick<HeatingPeriodData, 'exemption' | 'exemptionScope' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere'>>

// Karte „Ausnahmen und Vereinbarungen“ der Seite Heizkosten (Heizung PR 14, Entwurf 8.8, 8.9): Ausnahme nach § 11,
// Vereinbarung nach § 2 und die monatliche Verbrauchsinformation. Jede Antwort gilt ab dieser Heizperiode für die
// folgenden, bis eine spätere etwas anderes sagt; eine frühere ändert sie nicht. Angezeigt wird, was gilt.
export default function HeatingRulesCard({ plant, view, onChanged }: { plant: HeatingPlant; view: HeatingPeriodView; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [error, setError] = useState('')
  const r = view.rules
  const url = `/api/heating-plants/${plant.id}/periods/${view.period}/rules`
  async function save(body: RulesBody) {
    try {
      // Erst nachrechnen: Wirkt die Angabe an abgeschlossenen Heizperioden vorbei auf eine offene, fragt die Karte
      // nach (Durchsicht von #243, G-K1).
      const probe = await api<{ later?: { closed: string[] } }>(url, { method: 'PUT', body: JSON.stringify({ ...body, dryRun: true }) })
      const question = laterClosedText(probe?.later?.closed ?? [])
      if (question !== null) {
        const ok = await confirm({ title: 'Angabe für spätere Heizperioden übernehmen?', message: question, confirmLabel: 'Speichern', cancelLabel: 'Abbrechen' })
        if (!ok) return
      }
      await api(url, { method: 'PUT', body: JSON.stringify(body) })
      setError('')
      toast('Angabe gespeichert.')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const fromExemption = inheritedText(r.fromPeriod.exemption, view.period)
  const fromAgreed = inheritedText(r.fromPeriod.agreedOtherwise, view.period)
  const fromMonthly = inheritedText(r.fromPeriod.monthlyInfoElsewhere, view.period)
  const chosen = EXEMPTION_OPTIONS.find((o) => o.value === r.exemption)
  // Feste Anteile kann die eigene Heizkostenabrechnung nicht abbilden (Durchsicht von #243, G-W3).
  const agreedOptions = AGREED_OPTIONS.filter((o) => o.value !== 'fixedPercent' || plant.method !== 'self' || r.agreedOtherwise === 'fixedPercent')
  return (
    <div className="card no-print">
      <h3><Term id="heatingCostOrdinance">Ausnahmen und Vereinbarungen</Term> · {view.label}</h3>
      <p className="muted">Jede Antwort gilt ab dieser Heizperiode, bis Sie bei einer späteren etwas anderes angeben. Frühere Heizperioden bleiben, wie sie sind.</p>
      {error && <div className="error">{error}</div>}
      <label className="field grow">
        <span>Ausnahme nach § 11 HeizkostenV</span>
        <select value={r.exemption} disabled={view.closed} onChange={(e) => void save({ exemption: e.target.value as HeatingExemption })}>
          {EXEMPTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {chosen && chosen.text && <p className="muted">Wortlaut: {chosen.text}</p>}
      <p className="muted">
        Mietfuchs prüft die Voraussetzungen nicht; wählen Sie eine Ausnahme nur, wenn Sie sie belegen können. Unter einer Ausnahme verteilt Mietfuchs,
        wie Sie die Positionen erfasst haben, und nennt für den ausgenommenen Teil keine Kürzung nach § 12 HeizkostenV. {EXEMPTION_NOT_OFFERED}{fromExemption ? ` ${fromExemption}` : ''}
      </p>
      {asksScope(r, view.centralHotWater) && (
        <>
          <label className="field grow">
            <span>Betrifft die Ausnahme auch das Warmwasser?</span>
            <select value={r.exemptionScope ?? 'heat'} disabled={view.closed} onChange={(e) => void save({ exemptionScope: e.target.value as ExemptionScope })}>
              {EXEMPTION_SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p className="muted">
            Für das Warmwasser gilt die Ausnahme nur „entsprechend“ (§ 11 Abs. 2 HeizkostenV), also mit eigener Prüfung. Ohne Antwort gilt nur die Wärme als ausgenommen;
            das Warmwasser rechnet Mietfuchs dann weiter nach der Verordnung ab.
          </p>
        </>
      )}
      {asksScope(r) && !view.centralHotWater && <p className="muted">Die Anlage bereitet in dieser Heizperiode kein Warmwasser; die Ausnahme betrifft deshalb die ganze Anlage.</p>}
      {asksBilling(r) && (
        <>
          <label className="checkline">
            <input type="checkbox" checked={r.exemptionBillingAgreed} disabled={view.closed} onChange={(e) => void save({ exemptionBillingAgreed: e.target.checked })} />
            Mit den Mietern ist eine Abrechnung der Heiz- und Warmwasserkosten vereinbart
          </label>
          <p className="muted">{billingText(r.exemptionScope)}</p>
        </>
      )}
      {view.agreeable || r.agreedOtherwise !== 'none' ? (
        <>
          <label className="field grow">
            <span>Vereinbarung nach § 2 HeizkostenV</span>
            <select value={r.agreedOtherwise} disabled={view.closed} onChange={(e) => void save({ agreedOtherwise: e.target.value as AgreedOtherwise })}>
              {agreedOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p className="muted">
            Nur im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Eine Vereinbarung ersetzt die Verteilung nach der Verordnung, nicht die
            Pflicht zu fernablesbaren Geräten und nicht die Informationen nach § 6a.{plant.method === 'self' ? ' Bei der eigenen Heizkostenabrechnung verteilt Mietfuchs „nach Wohnfläche“ ganz nach der Fläche; feste Anteile erfassen Sie mit freien Schlüsseln.' : ''}{fromAgreed ? ` ${fromAgreed}` : ''}
          </p>
        </>
      ) : (
        <p className="muted">
          Eine abweichende Vereinbarung nach § 2 HeizkostenV gibt es nur im Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen. Nach den
          Stammdaten trifft das hier nicht zu; ist eine Wohnung Ihre eigene, legen Sie sie dort als selbstgenutzt an.
        </p>
      )}
      <label className="checkline">
        <input type="checkbox" checked={r.monthlyInfoElsewhere} disabled={view.closed} onChange={(e) => void save({ monthlyInfoElsewhere: e.target.checked })} />
        {MONTHLY_ELSEWHERE_LABEL}
      </label>
      <p className="muted">
        Bei fernablesbaren Geräten stehen den Mietern monatliche Verbrauchsinformationen zu. Ein Portal ohne Nachricht genügt nicht: Mitgeteilt ist die
        Information erst, wenn sie den Mieter erreicht.{fromMonthly ? ` ${fromMonthly}` : ''}
      </p>
    </div>
  )
}
