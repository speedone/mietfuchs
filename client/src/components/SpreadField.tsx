import { useId, useState } from 'react'
import Term from './Term'
import DisclosureButton from './DisclosureButton'
import { FieldMessage } from './Field'
import { spreadOptions, spreadPreview, type ItemForm } from '../costForm'
import type { BillingPeriod } from '../types'

// Die Wahl der Verteilung nach § 82b EStDV im Kostenformular (#262 PR 3, Entwurf E-9). Sichtbar bleibt nur, was die Wahl
// bewirkt (die Vorschau der Jahre und Raten); Voraussetzungen und Grenzen stehen eingeklappt unter „Mehr dazu“ (S33) und
// im Begriff. Der Knopf steht außerhalb des `<label>`, sonst nähme er dem Auswahlfeld die Beschriftung.
// `problem`: ein Satz, den der Server beim Speichern ablehnen würde (eine aufgeteilte Rechnung ohne gemeinsames Jahr der
// Zahlung, Integrationsdurchsicht 0.14, S1); er steht unter dem Feld, schon vor dem Speichern.
export default function SpreadField({ form, period, restYear = null, problem = null, onChange }: { form: ItemForm; period: Pick<BillingPeriod, 'from'>; restYear?: number | null; problem?: string | null; onChange: (next: ItemForm) => void }) {
  const [open, setOpen] = useState(false)
  const moreId = useId()
  // Mit dem Ende am Objekt (§ 82b Abs. 2, Durchsicht S3).
  const preview = spreadPreview(form, period, restYear)
  return (
    <div>
      <label className="field">
        <span><Term id="spread82b">Für die Steuer verteilen (§ 82b EStDV)</Term></span>
        <select value={form.spreadYears} onChange={(e) => onChange({ ...form, spreadYears: spreadOptions.find((o) => o.value === e.target.value)?.value ?? '' })}>
          {spreadOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {problem ? <FieldMessage error={problem} announce /> : preview && <small className="muted" role="status">{preview}</small>}
      </label>
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Mehr dazu" openLabel="Weniger" controls={moreId} className="btn ghost small" />
      <div id={moreId} hidden={!open}>
        <p className="muted fine">
          Ohne Verteilung zählt der Betrag ganz im Jahr der Zahlung. Größeren Erhaltungsaufwand dürfen Sie auf zwei bis fünf Jahre
          verteilen, wenn das Gebäude zu Ihrem Privatvermögen gehört und überwiegend Wohnzwecken dient.
        </p>
        {form.category === 'Nicht umlagefähig' && (
          <p className="muted fine">Verteilen Sie nur Erhaltungsaufwand wie Reparaturen; Verwaltungskosten und Zinsen, die ebenfalls unter „Nicht umlagefähig“ stehen, gehören nicht dazu.</p>
        )}
        <p className="muted fine">In den ersten Jahren nach dem Kauf kann eine Reparatur zu den <Term id="acquisitionRelatedCosts">anschaffungsnahen Herstellungskosten</Term> gehören; dann wird sie abgeschrieben und nicht verteilt.</p>
      </div>
    </div>
  )
}
