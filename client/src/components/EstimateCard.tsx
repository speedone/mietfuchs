import { useState } from 'react'
import type { EstimateCause, EstimateMethod, HeatingPeriodView, HeatingPlant, SelfEstimateOption, SelfEstimateView, SelfHeatingStatement } from '../types'
import { api, errorText, fmtDate } from '../api'
import { useToast } from './feedback'
import Term from './Term'
import { CAUSE_OPTIONS, chooseMethod, emptyEstimate, estimateBody, METHOD_OPTIONS, NO_PROPOSAL_TEXT, thresholdLines, WHY_TEXT, type EstimateForm } from '../estimateForm'
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

  const askUnit = (o: SelfEstimateOption) => self.serviceValues !== undefined && o.part === 'heat'
  function start(o: SelfEstimateOption) {
    setOpen(o)
    // Durchsicht Runde 2, N-M3: beim Ablesedienst die Einheit aus seinen Werten, ohne Werte Pflichtauswahl.
    const service = self.serviceValues
    const known = service && service.length > 0 ? (service.every((r) => r.heatUnit === 'kWh') ? 'kWh' : 'Einheiten') : ''
    const existing = existingOf(o)
    const kept = existing && !existing.stale && (existing.valueUnit === 'kWh' || existing.valueUnit === 'Einheiten') ? existing.valueUnit : ''
    setForm({ ...emptyEstimate(o, existing), ...(service && o.part === 'heat' ? { valueUnit: known || kept } : {}) })
    setError('')
  }
  async function save() {
    if (!open || !form) return
    const result = estimateBody(form, open.part, askUnit(open))
    if ('error' in result) return setError(result.error)
    try {
      await api(url(open), { method: 'PUT', body: JSON.stringify(result.body) })
      // Durchsicht von #242, R-M2: ohne Bestätigung nicht still „gespeichert“.
      toast(result.body.confirmed ? 'Schätzung gespeichert.' : 'Gespeichert, aber noch nicht bestätigt; die Abrechnung meldet das.')
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

  // Durchsicht Runde 2, N-I1: eine veraltete Schätzung steht immer sichtbar da, auch neben vollständiger Ablesung.
  const needs = options.filter((o) => o.why !== null || o.estimated || existingOf(o)?.stale === true)
  const others = options.filter((o) => !needs.includes(o))
  const pot = open ? potOf(open) : undefined
  const proposal = open && form ? open.proposals.find((p) => p.method === form.method) : undefined
  // Durchsicht von #242, R-M3: die Einheit des Felds; Heizkostenverteiler in bewerteten Einheiten.
  const unitOf = (o: SelfEstimateOption) => potOf(o)?.consumptionUnit ?? ''
  const fieldUnit = (o: SelfEstimateOption) => {
    // Beim Ablesedienst die gewählte Einheit (Durchsicht Runde 2, N-M3).
    if (askUnit(o)) return form?.valueUnit ? `${form.valueUnit}, wie der Ablesedienst die Heizung nennt` : 'der gewählten Einheit des Ablesedienstes'
    const u = unitOf(o)
    return u === 'Einheiten' ? 'bewerteten Einheiten (Ablesewert × Bewertungsfaktor)' : u
  }
  return (
    <div className="card">
      <h3><Term id="heatingEstimate">Schätzung (§ 9a)</Term></h3>
      {/* Durchsicht von #242: R-I1 (Wortlaut des § 9a Abs. 1), R-M11 (eine Pflicht), G-M6 (die ganze Heizperiode). */}
      <p className="muted no-print">
        Kann der Verbrauch einer Wohnung nicht ordnungsgemäß erfasst werden, weil das Gerät ausgefallen ist, falsch anzeigt oder ein anderer zwingender Grund vorliegt,
        ist er nach § 9a HeizkostenV zu ermitteln; ohne Schätzung verteilt Mietfuchs die Anlage nicht. Liegt eine Ablesung einige Tage neben dem Stichtag, gilt sie, wie sie ist.
        Der geschätzte Verbrauch gilt für die ganze Heizperiode der Wohnung, auch für Zeiten, die abgelesen sind; nur wer bis zu einem Mieterwechsel gültig abgelesen ist, behält seinen Wert.
      </p>
      {error && <div className="error">{error}</div>}
      {needs.length === 0 && <p>Für keine Wohnung fehlt ein Wert.</p>}
      {needs.map((o) => {
        const e = existingOf(o)
        const unit = e?.valueUnit ?? unitOf(o)
        return (
          <div key={`${o.unitId}:${o.part}`} className="row center">
            <span className="grow">
              {o.unitName}, {POT_TEXT[o.part]}: {e?.stale
                ? `Schätzung in ${e.valueUnit} passt nicht mehr zur Erfassung dieser Heizperiode und wird nicht gerechnet; bitte neu eintragen.`
                : e
                  ? `geschätzt ${num(e.value)} ${unit} (${e.confirmed ? 'bestätigt' : 'nicht bestätigt'}; Begründung: „${e.reason}“)${e.replacesMeasured ? '; ersetzt auch abgelesene Zeiten' : ''}`
                  : `${o.why ? WHY_TEXT[o.why] : ''}${o.boundary ? ` zum ${fmtDate(o.boundary)}` : ''}`}
            </span>
            {!view.closed && (e?.stale
              ? <>
                <button className="btn ghost" onClick={() => start(o)}>Schätzung neu eintragen</button>
                <button className="btn ghost" onClick={() => remove(o)} aria-label={`Schätzung von ${o.unitName} entfernen`}>Entfernen</button>
              </>
              : e
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
            <div key={`frei-${o.unitId}:${o.part}`} className="row center">
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
                {open.comparable.map((c) => <option key={c.unitId} value={c.unitId}>{c.unitName} ({num(c.perM2)} {unitOf(open)} je m²)</option>)}
              </select>
            </label>
          )}
          {proposal && proposal.why !== 'ok' && <p className="muted">{NO_PROPOSAL_TEXT[proposal.why]} Tragen Sie den Wert selbst ein.</p>}
          <label className="field">Geschätzter Verbrauch{pot ? ` in ${fieldUnit(open)}` : ''} für die ganze Heizperiode der Wohnung
            <input inputMode="decimal" value={form.value} onChange={(ev) => setForm({ ...form, value: ev.target.value })} />
          </label>
          {askUnit(open) && (
            <label className="field">Einheit der Schätzung
              <select value={form.valueUnit ?? ''} onChange={(ev) => setForm({ ...form, valueUnit: ev.target.value as '' | 'kWh' | 'Einheiten' })}>
                <option value="">— bitte wählen —</option>
                <option value="Einheiten">Einheiten</option>
                <option value="kWh">kWh</option>
              </select>
            </label>
          )}
          {/* Durchsicht von #242, R-I1: der Grund des § 9a Abs. 1 Satz 1 als Auswahl. */}
          <label className="field">Grund nach § 9a Abs. 1
            <select value={form.cause} onChange={(ev) => setForm({ ...form, cause: ev.target.value as EstimateCause })}>
              {CAUSE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">Begründung
            <input value={form.reason} placeholder="z. B. Wärmezähler defekt, Ersatz erst im Januar" onChange={(ev) => setForm({ ...form, reason: ev.target.value })} />
          </label>
          {/* Durchsicht von #242, R-I3: Der Satz steht außerhalb des label, sonst gehörte er zum Namen des Felds. */}
          <small className="muted">Erscheint so auf der Abrechnung des Mieters dieser Wohnung.</small>
          <label className="checkline">
            <input type="checkbox" checked={form.confirmed} onChange={(ev) => setForm({ ...form, confirmed: ev.target.checked })} />
            Der Verbrauch ließ sich nicht ordnungsgemäß erfassen, und der richtige Wert lässt sich nicht mehr ermitteln (§ 9a Abs. 1 HeizkostenV).
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
