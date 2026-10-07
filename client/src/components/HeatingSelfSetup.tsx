import { useState } from 'react'
import type { AreaBasisHeat, CaptureMethod, HeatingPart, HeatingPlant, HeatingTarget, HotWater, InsulationRule } from '../types'
import { api, ApiError, errorText, fmtEuro } from '../api'
import Drawer from './Drawer'
import { useToast } from './feedback'
import Term from './Term'
import {
  CAPTURE_SELF_OPTIONS, captureHint, HOT_WATER_OPTIONS, PART_OPTIONS, emptySelfSetup, forcedShare, itemsFromConflict, selfSetupBody, shareBounds, targetOptions,
} from '../heatingSelfForm'
import { INSULATION_OPTIONS, INSULATION_QUESTION, insulationAsked, insulationExplained, percentOf, unsureShareHint } from '../heatingSelfView'

// Einrichtung Schritt 7 (Heizung PR 10, Entwurf 11.2): Heizkosten selbst abrechnen. Antwortet der
// Server mit 409, nennt er die Heizpositionen offener Zeiträume, die Teil und Ziel brauchen; sie
// erscheinen unter den Fragen, und der zweite Versuch schickt sie mit. Bricht der Vermieter ab, bleibt
// die Anlage bei „Niemand“.
export default function HeatingSelfSetup({ plant, period, periodLabel, onDone, onCancel }: {
  plant: HeatingPlant; period: string; periodLabel?: string; onDone: (p: HeatingPlant) => void; onCancel: () => void
}) {
  const [form, setForm] = useState(() => emptySelfSetup(plant, period))
  const [error, setError] = useState('')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { min, max } = shareBounds()
  const forced = forcedShare(plant.energy, form.insulation)
  const hint = unsureShareHint(plant.energy, form.insulation, percentOf(form.share))

  async function submit() {
    const result = selfSetupBody(form, plant.energy)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setBusy(true)
    try {
      const done = await api<{ plant: HeatingPlant; created: unknown[]; converted: number; estimatesNotice?: string | null }>(`/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify(result.body) })
      setError('')
      // Durchsicht von #242, G-I1: Schätzungen, die nach dem Wechsel der Erfassung nicht mehr rechnen.
      if (done.estimatesNotice) toast(done.estimatesNotice, 'error')
      onDone(done.plant)
    } catch (e) {
      const items = e instanceof ApiError && e.status === 409 ? itemsFromConflict(e.data) : null
      if (items) setForm({ ...form, items: items.map((x) => form.items.find((y) => y.id === x.id) ?? x) })
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      title="Heizkosten selbst abrechnen"
      onClose={onCancel}
      onSubmit={submit}
      footer={
        <>
          <span className="drawer-hint">Strg+S speichert · Esc schließt</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Später</button>
          <button className="btn" onClick={submit} disabled={busy}>Umstellen</button>
        </>
      }
    >
      {error && <div className="error">{error}</div>}
      <p className="muted">
        Mietfuchs verteilt die Kosten dieser Heizanlage dann nach der <Term id="heatingSystem">Heizkostenverordnung</Term>: einen Teil nach dem
        gemessenen Verbrauch, den Rest nach der Fläche. Fehlende Wärme- und Warmwasserzähler legt Mietfuchs an; die Stände tragen Sie auf der Seite Zähler ein.
      </p>
      <label className="field grow">
        Bereitet diese Heizung auch das Warmwasser?
        <select value={form.hotWater} onChange={(e) => setForm({ ...form, hotWater: e.target.value as HotWater | '', items: form.items.map((x) => ({ ...x, heatingTarget: '' })) })}>
          {form.hotWater === '' && <option value="">— bitte wählen —</option>}
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="field grow">
        Womit wird der Verbrauch erfasst?
        <select value={form.capture} onChange={(e) => setForm({ ...form, capture: e.target.value as CaptureMethod })}>
          {CAPTURE_SELF_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={o.later}>{o.label}</option>)}
        </select>
        <small className="muted">{captureHint(form.capture)}</small>
      </label>
      {insulationAsked(plant.energy) && (
        <>
          <label className="field grow">
            <span>{INSULATION_QUESTION} (<Term id="forcedConsumptionShare">Pflichtanteil</Term>)</span>
            <select value={form.insulation} onChange={(e) => setForm({ ...form, insulation: e.target.value as InsulationRule | '' })}>
              <option value="">— bitte wählen —</option>
              {INSULATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <p className="muted">{insulationExplained()}</p>
        </>
      )}
      <p className="muted">
        <Term id="consumptionCosts">Anteil nach Verbrauch</Term> ({min} bis {max} %), für Heizung und Warmwasser je eine Wahl
        {periodLabel ? `; er gilt ab der Heizperiode ${periodLabel}` : ''}. Rechnen Sie schon so ab, tragen Sie den bisherigen Anteil ein. Steht im
        Mietvertrag ein Anteil, gilt er. Festlegen und ändern dürfen Sie ihn nur mit Wirkung zum Beginn eines Abrechnungszeitraums, ändern nur für
        künftige und durch Erklärung gegenüber den Mietern (§ 6 Abs. 4 HeizkostenV).
      </p>
      <div className="row">
        <label className="field">
          Heizung in %
          <input inputMode="decimal" value={forced !== null && !form.above70Agreed ? String(forced) : form.share} disabled={forced !== null && !form.above70Agreed}
            onChange={(e) => setForm({ ...form, share: e.target.value, waterShare: form.waterShare === '' || form.waterShare === form.share ? e.target.value : form.waterShare })} />
        </label>
        {form.hotWater !== 'none' && (
          <label className="field">
            Warmwasser in %
            <input inputMode="decimal" value={form.waterShare} onChange={(e) => setForm({ ...form, waterShare: e.target.value })} />
          </label>
        )}
      </div>
      {/* § 10 HeizkostenV (Heizung PR 14): Höhere Sätze als 70 % aus einer Vereinbarung bleiben unberührt. */}
      <label className="checkline">
        <input type="checkbox" checked={form.above70Agreed} onChange={(e) => setForm({ ...form, above70Agreed: e.target.checked })} />
        Mehr als {max} % nach Verbrauch sind mit den Mietern vereinbart (§ 10 HeizkostenV)
      </label>
      <p className="muted">Nur ankreuzen, wenn es im Mietvertrag oder einer Vereinbarung mit den Mietern steht; mehr als 100 % gibt es nicht.</p>
      {forced !== null && <p className="muted">Bei einer Öl- oder Gasheizung in diesem Fall sind es bei der Heizung {forced} % (§ 7 Abs. 1 Satz 2 HeizkostenV); mehr nur mit einer Vereinbarung (§ 10 HeizkostenV).</p>}
      {hint && <div className="notice">{hint}</div>}
      <label className="field grow">
        <span><Term id="baseCosts">Grundkosten</Term> der Heizung verteilen nach</span>
        <select value={form.areaBasisHeat} onChange={(e) => setForm({ ...form, areaBasisHeat: e.target.value as AreaBasisHeat })}>
          <option value="area">Wohnfläche</option>
          <option value="heatedArea">beheizter Fläche (je Wohnung in der Heizanlage einzutragen)</option>
        </select>
      </label>
      {form.hotWater === 'combined' && (
        <label className="checkline">
          <input type="checkbox" checked={form.dhwHeatMeter} onChange={(e) => setForm({ ...form, dhwHeatMeter: e.target.checked })} />
          Am Warmwasserspeicher misst ein Wärmezähler die Wärme für das Warmwasser
        </label>
      )}
      <label className="checkline">
        <input type="checkbox" checked={form.totalHeatMeter} onChange={(e) => setForm({ ...form, totalHeatMeter: e.target.checked })} />
        Ein Wärmezähler misst die gesamte Wärme der Anlage (bei Wärmepumpe und Fernwärme üblich)
      </label>
      {form.items.length > 0 && (
        <>
          <p>Diese Heizpositionen offener Zeiträume brauchen Teil und Ziel:</p>
          {form.items.map((row, i) => {
            const set = (patch: Partial<typeof row>) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            const targets = targetOptions(form.hotWater, row.heatingPart)
            return (
              <div className="row" key={row.id}>
                <span className="grow">„{row.description}“ · {fmtEuro(row.amountCents)}</span>
                <label className="field">
                  Teil für „{row.description}“
                  <select value={row.heatingPart} onChange={(e) => set({ heatingPart: e.target.value as HeatingPart | '', heatingTarget: '' })}>
                    <option value="">— bitte wählen —</option>
                    {PART_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  Ziel für „{row.description}“
                  <select value={targets.some((o) => o.value === row.heatingTarget) ? row.heatingTarget : ''} onChange={(e) => set({ heatingTarget: e.target.value as HeatingTarget | '' })}>
                    <option value="">— bitte wählen —</option>
                    {targets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            )
          })}
        </>
      )}
    </Drawer>
  )
}
