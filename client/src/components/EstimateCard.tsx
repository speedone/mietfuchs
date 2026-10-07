import { useState } from 'react'
import type { EstimateMethod, HeatingPeriodView, HeatingPlant, SelfEstimateOption, SelfEstimateView, SelfHeatingStatement } from '../types'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { chooseMethod, emptyEstimate, estimateBody, METHOD_OPTIONS, NO_PROPOSAL_TEXT, thresholdLines, WHY_TEXT, type EstimateForm } from '../estimateForm'
import { hkvEstimateThreshold } from '../../../shared/law/heizkostenv.ts'
import { valueAt } from '../../../shared/law/register.ts'

const POT_TEXT = { heat: 'Heizung', water: 'Warmwasser' } as const
const POT_OF = { heat: 'heating', water: 'water' } as const
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 })

// Schätzung nach § 9a (Heizung PR 13, Entwurf 8.7, 11.4): je Wohnung und Topf, was fehlt, die gespeicherten
// Schätzungen und der Dialog mit den Vorschlägen der drei Wege und dem Flächenanteil vor dem Speichern (N5).
// Eine abgeschlossene Heizperiode zeigt die Schätzungen nur an.
export default function EstimateCard({ plant, view, self, onChanged }: {
  plant: HeatingPlant; view: HeatingPeriodView; self: SelfHeatingStatement; onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState<SelfEstimateOption | null>(null)
  const [form, setForm] = useState<EstimateForm | null>(null)
  const [error, setError] = useState('')
  const options = self.estimateOptions ?? []
  const estimates = self.estimates ?? []
  if (options.length === 0 && estimates.length === 0) return null
  // Die Grenze im Dialog aus dem Register, zum Beginn der Heizperiode (wie in der Abrechnung).
  const threshold = self.threshold ?? valueAt(hkvEstimateThreshold, view.from)
  const existingOf = (o: Pick<SelfEstimateOption, 'unitId' | 'part'>): SelfEstimateView | undefined => estimates.find((e) => e.unitId === o.unitId && e.part === o.part)
  // Eine Schätzung an der Vorgängerin der Linie (Kesseltausch) wird dort geändert und entfernt.
  const url = (o: Pick<SelfEstimateOption, 'unitId' | 'part'>) => `/api/heating-plants/${existingOf(o)?.plantId ?? plant.id}/periods/${view.period}/estimates/${o.unitId}/${o.part}`
  const potOf = (o: SelfEstimateOption) => self.pots.find((p) => p.pot === POT_OF[o.part])

  function start(o: SelfEstimateOption) {
    setOpen(o)
    setForm(emptyEstimate(o, existingOf(o)))
    setError('')
  }
  async function save() {
    if (!open || !form) return
    const result = estimateBody(form, open.part)
    if ('error' in result) return setError(result.error)
    try {
      await api(url(open), { method: 'PUT', body: JSON.stringify(result.body) })
      toast('Schätzung gespeichert.')
      setOpen(null)
      setError('')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function remove(o: Pick<SelfEstimateOption, 'unitId' | 'part'>) {
    try {
      await api(url(o), { method: 'DELETE' })
      toast('Schätzung entfernt.')
      setError('')
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const needs = options.filter((o) => o.why !== null || o.estimated)
  const others = options.filter((o) => o.why === null && !o.estimated)
  const pot = open ? potOf(open) : undefined
  const proposal = open && form ? open.proposals.find((p) => p.method === form.method) : undefined
  return (
    <div className="card">
      <h3><Term id="heatingEstimate">Schätzung (§ 9a)</Term></h3>
      <p className="muted no-print">
        Geschätzt werden darf nur, wenn sich ein Wert nicht mehr ablesen lässt: Das Gerät ist ausgefallen, oder ein anderer zwingender Grund liegt vor.
        Liegt eine Ablesung einige Tage neben dem Stichtag, gilt sie, wie sie ist. Der geschätzte Verbrauch gilt für die ganze Heizperiode der Wohnung;
        wer bis zu einem Mieterwechsel gültig abgelesen ist, behält seinen Wert.
      </p>
      {error && <div className="error">{error}</div>}
      {needs.length === 0 && <p>Für keine Wohnung fehlt ein Wert.</p>}
      {needs.map((o) => {
        const e = existingOf(o)
        const unit = potOf(o)?.consumptionUnit ?? ''
        return (
          <div key={`${o.unitId}:${o.part}`} className="row">
            <span className="grow">
              {o.unitName}, {POT_TEXT[o.part]}: {e
                ? `geschätzt ${num(e.value)} ${unit} (${e.confirmed ? 'bestätigt' : 'nicht bestätigt'}; ${e.reason})`
                : `${o.why ? WHY_TEXT[o.why] : ''}${o.boundary ? ` zum ${fmtDate(o.boundary)}` : ''}`}
            </span>
            {!view.closed && (e
              ? <>
                <button className="btn ghost" onClick={() => start(o)} aria-label={`Schätzung von ${o.unitName} ändern`}>Ändern</button>
                <button className="btn ghost" onClick={() => remove(o)} aria-label={`Schätzung von ${o.unitName} entfernen`}>Entfernen</button>
              </>
              : <button className="btn ghost" onClick={() => start(o)} aria-label={`${o.unitName} schätzen`}>Schätzen</button>)}
          </div>
        )
      })}
      {!view.closed && others.length > 0 && (
        <details className="no-print">
          <summary>Gerät zeigt falsch an, obwohl alle Stände eingetragen sind</summary>
          <p className="muted">Dann sind die Ablesungen unbrauchbar, und Sie schätzen auch hier. Halten Sie in der Begründung fest, woran Sie das erkannt haben.</p>
          {others.map((o) => (
            <div key={`frei-${o.unitId}:${o.part}`} className="row">
              <span className="grow">{o.unitName}, {POT_TEXT[o.part]}</span>
              <button className="btn ghost" onClick={() => start(o)} aria-label={`${o.unitName} schätzen`}>Schätzen</button>
            </div>
          ))}
        </details>
      )}
      {open && form && (
        <div className="panel no-print">
          <h4>{open.unitName}, {POT_TEXT[open.part]}</h4>
          {pot && thresholdLines(pot, open, threshold).map((l) => <p key={l}>{l}</p>)}
          <label className="field">Weg nach § 9a Abs. 1
            <select value={form.method} onChange={(ev) => setForm(chooseMethod(form, open, ev.target.value as EstimateMethod, form.comparableUnitId))}>
              {METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          {form.method === 'comparableUnit' && open.comparable.length > 0 && (
            <label className="field">Vergleichbare Wohnung
              <select value={form.comparableUnitId} onChange={(ev) => setForm(chooseMethod(form, open, 'comparableUnit', ev.target.value))}>
                <option value="">— bitte wählen —</option>
                {open.comparable.map((c) => <option key={c.unitId} value={c.unitId}>{c.unitName} ({num(c.perM2)} je m²)</option>)}
              </select>
            </label>
          )}
          {proposal && proposal.why !== 'ok' && <p className="muted">{NO_PROPOSAL_TEXT[proposal.why]} Tragen Sie den Wert selbst ein.</p>}
          <label className="field">Geschätzter Verbrauch{pot ? ` in ${pot.consumptionUnit}` : ''}
            <input inputMode="decimal" value={form.value} onChange={(ev) => setForm({ ...form, value: ev.target.value })} />
          </label>
          <label className="field">Begründung
            <input value={form.reason} placeholder="z. B. Wärmezähler defekt, Ersatz erst im Januar" onChange={(ev) => setForm({ ...form, reason: ev.target.value })} />
          </label>
          <label className="checkline">
            <input type="checkbox" checked={form.confirmed} onChange={(ev) => setForm({ ...form, confirmed: ev.target.checked })} />
            Der Wert ließ sich nicht mehr ablesen (Geräteausfall oder anderer zwingender Grund, § 9a Abs. 1 HeizkostenV).
          </label>
          <div className="row">
            <button className="btn" onClick={save}>Schätzung speichern</button>
            <button className="btn ghost" onClick={() => setOpen(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
