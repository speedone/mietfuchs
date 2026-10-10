// Die Karte „Betriebsstrom“ der Seite Heizkosten (Heizung PR 15, #212), DOM-frei. Die Rechnung kommt aus
// shared/operatingPower.ts, dieselbe wie auf dem Server.
import { GENERAL_POWER_CATEGORY, operatingPowerShare, ownEstimateShare } from '../../shared/operatingPower.ts'
import { fmtEuro, parseEuro } from './api'
import { parseNumberDe } from './numbers'
import type { CostItem } from './types'

// `days` leer heißt: die Heiztage (P-K8).
export type DeviceRow = { label: string; watts: string; hours: string; days: string }
export type OperatingPowerForm = {
  generalItemId: string
  // P-W2: dritter Weg „Betrag selbst geschätzt“.
  mode: 'estimate' | 'measured' | 'own'
  devices: DeviceRow[]
  heatingDays: string
  measuredKwh: string
  billKwh: string
  ownAmount: string
  basis: string
}

export const emptyOperatingPowerForm = (): OperatingPowerForm => ({
  generalItemId: '', mode: 'estimate', devices: [{ label: 'Umwälzpumpe', watts: '', hours: '', days: '' }], heatingDays: '', measuredKwh: '', billKwh: '', ownAmount: '', basis: '',
})

// „3.000“ und „45,5“ wie im übrigen Formular; leer oder unlesbar ist null.
const num = (text: string): number | null => (text.trim() === '' ? null : parseNumberDe(text))

export function generalItemOptions(items: readonly CostItem[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'Bitte wählen …' },
    ...items
      .filter((c) => c.category === GENERAL_POWER_CATEGORY && c.amountCents > 0 && c.operatingPower === undefined)
      .map((c) => ({ value: c.id, label: `${c.description} · ${fmtEuro(c.amountCents)}` })),
  ]
}

export function operatingPowerPreview(form: OperatingPowerForm, items: readonly CostItem[]): { ok: true; cents: number; lines: string[] } | { ok: false; text: string } {
  const general = items.find((c) => c.id === form.generalItemId)
  if (!general) return { ok: false, text: 'Bitte wählen Sie die Stromrechnung des Hauses.' }
  if (form.mode === 'own') {
    const own = ownEstimateShare({ cents: parseEuro(form.ownAmount), basis: form.basis, billCents: general.amountCents })
    return 'error' in own ? { ok: false, text: own.error } : { ok: true, cents: own.cents, lines: own.steps }
  }
  const measured = form.mode === 'measured'
  const r = operatingPowerShare({
    devices: measured ? null : form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts) ?? 0, hoursPerDay: num(d.hours) ?? 0, days: num(d.days) })),
    heatingDays: measured ? null : num(form.heatingDays),
    measuredKwh: measured ? (num(form.measuredKwh) ?? 0) : null,
    billKwh: num(form.billKwh) ?? 0,
    billCents: general.amountCents,
  })
  return 'error' in r ? { ok: false, text: r.error } : { ok: true, cents: r.cents, lines: r.steps }
}

// Durchsicht von #252, G-W1: was zu Anlage und Heizperiode schon gebucht ist, damit niemand dieselbe
// Schätzung zweimal anlegt. Beim Messdienst gibt es keinen Betriebsstrom, nur Abzüge ohne Verweis.
export function bookedOperatingPower(items: readonly CostItem[], plantId: string, period: string): CostItem[] {
  const own = items.filter((c) => c.operatingPower === 'included' && c.heatingPlantId === plantId && c.period === period)
  const ids = new Set(own.map((c) => c.id))
  const deductions = items.filter((c) => c.operatingPower === 'deduction' &&
    (c.operatingPowerItemId !== undefined ? ids.has(c.operatingPowerItemId) : c.period === period))
  return [...own, ...deductions]
}

export function operatingPowerRequest(form: OperatingPowerForm, period: string): Record<string, unknown> {
  if (form.mode === 'own') return { period, generalItemId: form.generalItemId, ownCents: parseEuro(form.ownAmount), basis: form.basis.trim() }
  const base = { period, generalItemId: form.generalItemId, billKwh: num(form.billKwh) }
  if (form.mode === 'measured') return { ...base, measuredKwh: num(form.measuredKwh) }
  return {
    ...base,
    devices: form.devices.map((d) => ({ label: d.label.trim() || 'Gerät', watts: num(d.watts), hoursPerDay: num(d.hours), days: num(d.days) })),
    heatingDays: num(form.heatingDays),
  }
}
