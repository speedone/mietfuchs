// Die Karte „CO₂-Erstattung an Mieter, die selbst heizen“ auf der Seite Kosten (Heizung PR 19, #97). Liste je
// Objekt, Erfassen und Bearbeiten; verrechnet wird im gewählten Zeitraum. Die Seite Heizkosten gibt es nur mit
// Heizanlage, und wer selbst heizt, hat keine; deshalb steht die Karte hier.
import { useCallback, useEffect, useState } from 'react'
import { api, errorText, fmtDate, fmtEuro } from '../api'
import { withProperty } from '../property'
import { useConfirm, useToast } from './feedback'
import Term from './Term'
import { RESTRICTION_OPTIONS } from '../fuelForm'
import { localToday } from '../periodForm'
import { emptyRefundForm, refundAreaOf, refundBody, refundStatus, refundTenancies, refundToForm, SETTLE_OPTIONS, type Co2RefundForm, type RefundRow } from '../co2RefundForm'
import type { PeriodKey } from '../types'

type View = RefundRow & { tenantName: string; unitName: string; claimDeadline: string | null; proposalCents: number | null; proposalExcluded: string | null }
type TenancyInfo = { id: string; unitId: string; tenantName: string; start: string; end: string | null; heatingModel?: string }
type UnitInfo = { id: string; name: string; areaM2: number }

export default function Co2RefundsCard({ propertyId, period, tenancies, units }: {
  propertyId: string | null
  period: { key: PeriodKey; label: string }
  tenancies: readonly TenancyInfo[]
  units: readonly UnitInfo[]
}) {
  const [rows, setRows] = useState<View[]>([])
  const [editing, setEditing] = useState<{ id: string | null; form: Co2RefundForm } | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const choices = refundTenancies(tenancies)
  const areaOf = (tenancyId: string): number | null => refundAreaOf(tenancyId, tenancies, units, localToday())

  const load = useCallback(async () => {
    try {
      setRows(await api<View[]>(withProperty('/api/co2-refunds', propertyId)))
    } catch (e) {
      setError(errorText(e))
    }
  }, [propertyId])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editing) return
    const result = refundBody(editing.form, period.key)
    if ('error' in result) {
      setError(result.error)
      return
    }
    try {
      if (editing.id) await api(`/api/co2-refunds/${editing.id}`, { method: 'PUT', body: JSON.stringify(result.body) })
      else await api('/api/co2-refunds', { method: 'POST', body: JSON.stringify(result.body) })
      setEditing(null)
      setError('')
      toast('Erstattung gespeichert.')
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Erstattung löschen?', message: 'Die Erstattung wird gelöscht; eine Gutschrift in einer offenen Abrechnung entfällt.', confirmLabel: 'Löschen' }))) return
    try {
      await api(`/api/co2-refunds/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const set = (patch: Partial<Co2RefundForm>) => setEditing((x) => (x ? { ...x, form: { ...x.form, ...patch } } : x))
  const f = editing?.form
  const first = choices[0]?.id ?? ''

  return (
    <div className="card no-print">
      <h2><Term id="co2Refund">CO₂-Erstattung</Term> an Mieter, die selbst heizen</h2>
      <p className="muted">
        Bezieht ein Mieter Brennstoff oder Wärme über einen eigenen Vertrag, etwa für eine Gastherme oder eine zentrale Heizung, kann er den Anteil seiner
        CO₂-Kosten, den nach dem Stufenmodell Sie tragen, von Ihnen verlangen. Erfassen Sie hier seine Anzeige; verrechnet wird in der Abrechnung, die Sie
        wählen; sonst zahlen Sie aus und tragen hier den Tag der Auszahlung ein. Die Steuerübersicht führt eine ausgezahlte Erstattung im Jahr der Auszahlung als Werbungskosten; im Mietkonto erfassen Sie sie nicht.
      </p>
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {`${r.tenantName} (${r.unitName}): ${fmtEuro(r.amountCents)}, verlangt am ${fmtDate(r.claimedAt)}, ${refundStatus(r, period.key)}`}
              {r.proposalCents !== null && r.proposalExcluded === null && r.proposalCents !== r.amountCents && <span className="muted">{` · nach den Angaben gerechnet: ${fmtEuro(r.proposalCents)}`}</span>}
              {(r.settlePeriod === null || r.settlePeriod === period.key) && (
                <>
                  {' '}<button className="btn small secondary" onClick={() => { setError(''); setEditing({ id: r.id, form: refundToForm(r, period.key) }) }}>Bearbeiten</button>
                  {' '}<button className="btn small secondary" onClick={() => void remove(r.id)}>Löschen</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editing && choices.length > 0 && (
        <button className="btn secondary" onClick={() => { setError(''); setEditing({ id: null, form: emptyRefundForm(first, areaOf(first)) }) }}>Erstattung erfassen</button>
      )}
      {choices.length === 0 && <p className="muted">Erstattungen gibt es nur für Mieter, die selbst heizen. Stellen Sie das Mietverhältnis in den Stammdaten unter Heizung auf „Mieter heizt selbst“, wenn das zutrifft.</p>}
      {f && (
        <div className="field-group">
          <label className="field">
            Mieter
            <select aria-label="Mieter" value={f.tenancyId} onChange={(e) => set({ tenancyId: e.target.value, areaM2: String(areaOf(e.target.value) ?? '').replace('.', ',') })}>
              {choices.map((t) => <option key={t.id} value={t.id}>{t.tenantName}</option>)}
            </select>
          </label>
          <label className="field">Abrechnung des Lieferanten vom<input type="date" value={f.supplierBilledAt} onChange={(e) => set({ supplierBilledAt: e.target.value })} /></label>
          <label className="field">Verlangt in Textform am<input type="date" value={f.claimedAt} onChange={(e) => set({ claimedAt: e.target.value })} /></label>
          <label className="field">Betrag laut Anzeige (€)<input value={f.amount} inputMode="decimal" onChange={(e) => set({ amount: e.target.value })} /></label>
          <label className="field">
            Verrechnung
            <select aria-label="Verrechnung" value={f.settle} onChange={(e) => set({ settle: SETTLE_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'open' })}>
              {SETTLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === 'here' ? `in der Abrechnung ${period.label} verrechnen` : o.label}</option>)}
            </select>
          </label>
          <small className="muted">Verrechnen dürfen Sie nur, wenn eine Vorauszahlung auf Betriebskosten vereinbart ist, in der nächsten Abrechnung nach der Anzeige; sonst zahlen Sie spätestens zwölf Monate nach der Anzeige aus (§ 6 Abs. 2 Satz 4, 5 CO2KostAufG).</small>
          {f.settle === 'paid' && <label className="field">Ausgezahlt am<input type="date" value={f.paidOutOn} onChange={(e) => set({ paidOutOn: e.target.value })} /></label>}
          <details>
            <summary>Zum Nachrechnen: Angaben aus der Rechnung des Lieferanten</summary>
            <label className="field">Zeitraum der Rechnung von (bei Öl oder Flüssiggas: Zeitraum, für den die Lieferung reicht)<input type="date" value={f.billedFrom} onChange={(e) => set({ billedFrom: e.target.value })} /></label>
            <label className="field">bis<input type="date" value={f.billedTo} onChange={(e) => set({ billedTo: e.target.value })} /></label>
            <label className="field">CO₂-Ausstoß (kg)<input value={f.emissionsKg} inputMode="decimal" onChange={(e) => set({ emissionsKg: e.target.value })} /></label>
            <label className="field">CO₂-Kosten (€)<input value={f.co2Cost} inputMode="decimal" onChange={(e) => set({ co2Cost: e.target.value })} /></label>
            <label className="field">Wohnfläche (m²)<input value={f.areaM2} inputMode="decimal" onChange={(e) => set({ areaM2: e.target.value })} /></label>
            <small className="muted">Wohnfläche aller Räume, die über den Vertrag des Mieters beheizt werden (§ 5 Abs. 3 CO2KostAufG). Vorbelegt ist die Fläche der Wohnungen, die derselbe Mieter selbst heizt; dass das ein Mieter ist, liest Mietfuchs am Namen ab (Auslegung).</small>
            <label className="field checkline"><input type="checkbox" checked={f.ownAppliances} onChange={(e) => set({ ownAppliances: e.target.checked })} />Der Mieter betreibt mit dem Brennstoff auch ein Gerät zu anderen Zwecken, etwa einen Gasherd, das er selbst angeschafft hat und das ihm gehört (§ 6 Abs. 3 Satz 2; ein mitvermieteter Herd zählt nicht)</label>
            <label className="field checkline"><input type="checkbox" checked={f.commercialUse} onChange={(e) => set({ commercialUse: e.target.checked })} />Der Brennstoff wird auch gewerblich genutzt (§ 6 Abs. 3 Satz 1)</label>
            {f.commercialUse && <label className="field checkline"><input type="checkbox" checked={f.commercialMetered} onChange={(e) => set({ commercialMetered: e.target.checked })} />Der Verbrauch für die Erzeugung von Wärme wird mit einer Messeinrichtung getrennt erfasst und ist nachgewiesen (tragen Sie dann nur Ausstoß und CO₂-Kosten für Heizung und Warmwasser ein)</label>}
            <label className="field checkline"><input type="checkbox" checked={f.nonResidential} onChange={(e) => set({ nonResidential: e.target.checked })} />Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 Abs. 2)</label>
            <label className="field">
              Beschränkungen (§ 9 CO2KostAufG)
              <select aria-label="Beschränkungen (§ 9 CO2KostAufG)" value={f.restriction} onChange={(e) => set({ restriction: RESTRICTION_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'none' })}>
                {RESTRICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">Hälftige Teilung nach § 5a gilt ab (nur bei einer Heizung nach § 43 GModG und einem Mietverhältnis über Wohnraum)<input type="date" value={f.halfSplitFrom} onChange={(e) => set({ halfSplitFrom: e.target.value })} /></label>
            <p className="muted">
              Frühestens der 01.01.2028 und frühestens der Tag des Einbaus. Nach einem Notfalleinbau ruht die Teilung zeitweise (§ 5a Abs. 4 CO2KostAufG).
              Im selbst bewohnten Zweifamilienhaus kann sie entfallen (§ 5d Abs. 3), aber nur, wenn beide Wohnungen an derselben Heizung hängen; eine Gastherme je Wohnung ist das nicht.
              Hat der Mieter die Heizung selbst eingebaut, ist ungeklärt, ob § 5a gilt. Leer lassen, wenn § 5a nicht gilt, auch wenn Sie sich auf den Härtefall nach § 5d Abs. 1 CO2KostAufG berufen und den Mieter darüber nach § 5d Abs. 4 in Textform informiert haben.
            </p>
            {f.halfSplitFrom !== '' && (
              <>
                <label className="field">Gasnetzentgelte laut Rechnung (€)<input value={f.gridFee} inputMode="decimal" onChange={(e) => set({ gridFee: e.target.value })} /></label>
                <label className="field">Biobrennstoff, Preisbestandteil laut Rechnung (€)<input value={f.bioCost} inputMode="decimal" onChange={(e) => set({ bioCost: e.target.value })} /></label>
              </>
            )}
          </details>
          <button className="btn" onClick={() => void save()}>Erstattung speichern</button>
          {' '}<button className="btn secondary" onClick={() => setEditing(null)}>Abbrechen</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
