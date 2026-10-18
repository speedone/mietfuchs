import type { AgreedOtherwise, ExemptionScope, HeatingExemption, HeatingPeriodView, HeatingPeriodData, HeatingPlant } from '../types'
import Card from '../components/Card'
import { api } from '../api'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import DraftActions from './DraftActions'
import { keepDraft, useDraft } from '../useDraft'
import { AGREED_OPTIONS, asksBilling, asksScope, billingText, EXEMPTION_NOT_OFFERED, EXEMPTION_OPTIONS, EXEMPTION_SCOPE_OPTIONS, inheritedText, laterClosedText, MONTHLY_ELSEWHERE_LABEL } from '../heatingRulesForm'

type RulesBody = Partial<Pick<HeatingPeriodData, 'exemption' | 'exemptionScope' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere'>>
// Was die Karte zeigt und als Entwurf hält (#309). Der Umfang ohne Antwort zeigt „nur die Wärme“, wie die
// Berechnung ihn liest.
type Shown = { exemption: HeatingExemption; exemptionScope: ExemptionScope; exemptionBillingAgreed: boolean; agreedOtherwise: AgreedOtherwise; monthlyInfoElsewhere: boolean }

// Der Rumpf: nur, was im Entwurf anders ist als gespeichert. Ein unverändertes Feld schickte sonst eine geerbte
// Angabe als eigene in diese Heizperiode. Ohne Ausnahme im Entwurf gibt es weder Umfang noch vereinbarte
// Abrechnung; der Server lehnte sie dann ab.
export function rulesBody(saved: Shown, draft: Shown): RulesBody {
  const body: RulesBody = {}
  for (const k of Object.keys(draft) as (keyof Shown)[]) {
    if (draft[k] !== saved[k]) Object.assign(body, { [k]: draft[k] })
  }
  if (draft.exemption === 'none') {
    delete body.exemptionScope
    delete body.exemptionBillingAgreed
  }
  return body
}

// Karte „Ausnahmen und Vereinbarungen“ der Seite Heizkosten (Heizung PR 14, Entwurf 8.8, 8.9): Ausnahme nach § 11,
// Vereinbarung nach § 2 und die monatliche Verbrauchsinformation. Jede Antwort gilt ab dieser Heizperiode für die
// folgenden, bis eine spätere etwas anderes sagt; eine frühere ändert sie nicht. Angezeigt wird, was gilt.
// Die Felder sind ein Entwurf mit einem „Speichern“ für die ganze Karte (#309, Karte mit einem Speichern).
export default function HeatingRulesCard({ plant, view, onChanged }: { plant: HeatingPlant; view: HeatingPeriodView; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const saved: Shown = {
    exemption: view.rules.exemption, exemptionScope: view.rules.exemptionScope ?? 'heat', exemptionBillingAgreed: view.rules.exemptionBillingAgreed,
    agreedOtherwise: view.rules.agreedOtherwise, monthlyInfoElsewhere: view.rules.monthlyInfoElsewhere,
  }
  const draft = useDraft(saved, { scope: `${plant.id}|${view.period}` })
  const r = draft.value
  // Wird die Ausnahme wieder „keine“, verschwinden Umfang und vereinbarte Abrechnung; ihr Entwurf geht mit,
  // sonst stünde „Ungespeicherte Änderungen“ da, obwohl alles Sichtbare gespeichert ist (Durchsicht KANN 6).
  const edit = (patch: Partial<Shown>) => {
    const next = { ...r, ...patch }
    draft.set(next.exemption === 'none' ? { ...next, exemptionScope: saved.exemptionScope, exemptionBillingAgreed: saved.exemptionBillingAgreed } : next)
  }
  const url = `/api/heating-plants/${plant.id}/periods/${view.period}/rules`
  async function save(value: Shown) {
    const body = rulesBody(saved, value)
    // Erst nachrechnen: Wirkt die Angabe an abgeschlossenen Heizperioden vorbei auf eine offene, fragt die Karte
    // nach (Durchsicht von #243, G-K1). Wer abbricht, behält seinen Entwurf.
    const probe = await api<{ later?: { closed: string[] } }>(url, { method: 'PUT', body: JSON.stringify({ ...body, dryRun: true }) })
    const question = laterClosedText(probe?.later?.closed ?? [])
    if (question !== null) {
      const ok = await confirm({ title: 'Angabe für spätere Heizperioden übernehmen?', message: question, confirmLabel: 'Speichern', cancelLabel: 'Abbrechen' })
      if (!ok) return keepDraft
    }
    await api(url, { method: 'PUT', body: JSON.stringify(body) })
    toast('Angabe gespeichert.')
    onChanged()
  }
  const from = view.rules.fromPeriod
  const fromExemption = inheritedText(from.exemption, view.period)
  const fromAgreed = inheritedText(from.agreedOtherwise, view.period)
  const fromMonthly = inheritedText(from.monthlyInfoElsewhere, view.period)
  const chosen = EXEMPTION_OPTIONS.find((o) => o.value === r.exemption)
  // Feste Anteile kann die eigene Heizkostenabrechnung nicht abbilden (Durchsicht von #243, G-W3).
  const agreedOptions = AGREED_OPTIONS.filter((o) => o.value !== 'fixedPercent' || plant.method !== 'self' || saved.agreedOtherwise === 'fixedPercent')
  return (
    <Card title={<Term id="heatingCostOrdinance">Ausnahmen und Vereinbarungen</Term>} level={3} className="no-print">
      <p className="muted">Jede Antwort gilt ab dieser Heizperiode, bis Sie bei einer späteren etwas anderes angeben. Frühere Heizperioden bleiben, wie sie sind.</p>
      <label className="field">
        <span>Ausnahme nach § 11 HeizkostenV</span>
        <select value={r.exemption} disabled={view.closed || draft.saving} onChange={(e) => edit({ exemption: e.target.value as HeatingExemption })}>
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
          <label className="field">
            <span>Betrifft die Ausnahme auch das Warmwasser?</span>
            <select value={r.exemptionScope} disabled={view.closed || draft.saving} onChange={(e) => edit({ exemptionScope: e.target.value as ExemptionScope })}>
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
            <input type="checkbox" checked={r.exemptionBillingAgreed} disabled={view.closed || draft.saving} onChange={(e) => edit({ exemptionBillingAgreed: e.target.checked })} />
            Mit den Mietern ist eine Abrechnung der Heiz- und Warmwasserkosten vereinbart
          </label>
          <p className="muted">{billingText(r.exemptionScope)}</p>
        </>
      )}
      {view.agreeable || saved.agreedOtherwise !== 'none' ? (
        <>
          <label className="field">
            <span>Vereinbarung nach § 2 HeizkostenV</span>
            <select value={r.agreedOtherwise} disabled={view.closed || draft.saving} onChange={(e) => edit({ agreedOtherwise: e.target.value as AgreedOtherwise })}>
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
        <input type="checkbox" checked={r.monthlyInfoElsewhere} disabled={view.closed || draft.saving} onChange={(e) => edit({ monthlyInfoElsewhere: e.target.checked })} />
        {MONTHLY_ELSEWHERE_LABEL}
      </label>
      <p className="muted">
        Bei fernablesbaren Geräten stehen den Mietern monatliche Verbrauchsinformationen zu. Ein Portal ohne Nachricht genügt nicht: Mitgeteilt ist die
        Information erst, wenn sie den Mieter erreicht.{fromMonthly ? ` ${fromMonthly}` : ''}
      </p>
      <DraftActions draft={draft} onSave={save} layout="card" what={`Ausnahmen ${view.label}`} />
    </Card>
  )
}
