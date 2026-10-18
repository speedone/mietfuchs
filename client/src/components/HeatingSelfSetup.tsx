import { useState } from 'react'
import type { AreaBasisHeat, CaptureMethod, HeatingPart, HeatingPlant, HeatingTarget, HotWater, InsulationRule } from '../types'
import { billingEnergy } from '../../../shared/heatDelivery.ts'
import { api, ApiError, errorText, fmtEuro } from '../api'
import Drawer from './Drawer'
import Field from './Field'
import { useFormError } from './ErrorSummary'
import { useToast } from './feedback'
import Term from './Term'
import {
  CAPTURE_SELF_OPTIONS, captureHint, HOT_WATER_OPTIONS, PART_OPTIONS, emptySelfSetup, forcedShare, itemsFromConflict, selfSetupBody, shareBounds, targetOptions, type SelfSetupField,
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
  const errors = useFormError<SelfSetupField>()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { min, max } = shareBounds()
  // Heizung PR 16: nach der Energie der Abrechnung; bei Contracting gilt der Pflichtanteil nicht (§ 7 Abs. 3).
  const energy = billingEnergy(plant)
  const forced = forcedShare(energy, form.insulation)
  const hint = unsureShareHint(energy, form.insulation, percentOf(form.share))

  async function submit() {
    const result = selfSetupBody(form, energy)
    if ('error' in result) {
      errors.report(result.problems)
      return
    }
    setBusy(true)
    try {
      const done = await api<{ plant: HeatingPlant; created: unknown[]; converted: number; estimatesNotice?: string | null }>(`/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify(result.body) })
      errors.clear()
      // Durchsicht von #242, G-I1: Schätzungen, die nach dem Wechsel der Erfassung nicht mehr rechnen.
      if (done.estimatesNotice) toast(done.estimatesNotice, 'error')
      onDone(done.plant)
    } catch (e) {
      const items = e instanceof ApiError && e.status === 409 ? itemsFromConflict(e.data) : null
      if (items) setForm({ ...form, items: items.map((x) => form.items.find((y) => y.id === x.id) ?? x) })
      errors.show(errorText(e))
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
      value={form}
      cancelLabel="Später"
      busy={busy}
      errors={errors}
      actions={<button className="btn" onClick={submit} disabled={busy}>Umstellen</button>}
    >
      <p className="muted">
        Mietfuchs verteilt die Kosten dieser Heizanlage dann nach der <Term id="heatingSystem">Heizkostenverordnung</Term>: einen Teil nach dem
        gemessenen Verbrauch, den Rest nach der Fläche. Fehlende Wärme- und Warmwasserzähler legt Mietfuchs an; die Stände tragen Sie auf der Seite Zähler ein.
      </p>
      <Field label="Bereitet diese Heizung auch das Warmwasser?" className="grow" {...errors.field('hotWater')}>
        <select value={form.hotWater} onChange={(e) => setForm({ ...form, hotWater: e.target.value as HotWater | '', items: form.items.map((x) => ({ ...x, heatingTarget: '' })) })}>
          {form.hotWater === '' && <option value="">— bitte wählen —</option>}
          {HOT_WATER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Womit wird der Verbrauch erfasst?" className="grow" hint={captureHint(form.capture)} {...errors.field('capture')}>
        <select value={form.capture} onChange={(e) => setForm({ ...form, capture: e.target.value as CaptureMethod })}>
          {CAPTURE_SELF_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={o.later}>{o.label}</option>)}
        </select>
      </Field>
      {insulationAsked(energy) && (
        <>
          <Field label={<>{INSULATION_QUESTION} (<Term id="forcedConsumptionShare">Pflichtanteil</Term>)</>} className="grow" {...errors.field('insulation')}>
            <select value={form.insulation} onChange={(e) => setForm({ ...form, insulation: e.target.value as InsulationRule | '' })}>
              <option value="">— bitte wählen —</option>
              {INSULATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
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
        <Field label="Heizung in %" width="s" {...errors.field('share')}>
          <input inputMode="decimal" value={forced !== null && !form.above70Agreed ? String(forced) : form.share} disabled={forced !== null && !form.above70Agreed}
            onChange={(e) => setForm({ ...form, share: e.target.value, waterShare: form.waterShare === '' || form.waterShare === form.share ? e.target.value : form.waterShare })} />
        </Field>
        {form.hotWater !== 'none' && (
          <Field label="Warmwasser in %" width="s" {...errors.field('waterShare')}>
            <input inputMode="decimal" value={form.waterShare} onChange={(e) => setForm({ ...form, waterShare: e.target.value })} />
          </Field>
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
                <Field label={<>Teil für „{row.description}“</>} {...errors.field(`part:${row.id}`)}>
                  <select value={row.heatingPart} onChange={(e) => set({ heatingPart: e.target.value as HeatingPart | '', heatingTarget: '' })}>
                    <option value="">— bitte wählen —</option>
                    {PART_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label={<>Ziel für „{row.description}“</>} {...errors.field(`target:${row.id}`)}>
                  <select value={targets.some((o) => o.value === row.heatingTarget) ? row.heatingTarget : ''} onChange={(e) => set({ heatingTarget: e.target.value as HeatingTarget | '' })}>
                    <option value="">— bitte wählen —</option>
                    {targets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
            )
          })}
        </>
      )}
    </Drawer>
  )
}
