// Die Entscheidungslogik der Karte „CO₂-Erstattung“ (Heizung PR 19, #97), ohne DOM prüfbar (co2RefundForm.test.ts).
// Erfasst wird die Anzeige eines Mieters, der selbst heizt, nach § 6 Abs. 2 CO2KostAufG; der Server prüft und rechnet
// nach (server/src/db/co2Refunds.ts, server/src/co2Refund.ts).
import { fmtDate, parseEuro } from './api'
import { parseDecimal } from './co2Form'
import type { Co2Refund, Co2Restriction, PeriodKey } from './types'

export type SettleChoice = 'open' | 'here' | 'paid'
export const SETTLE_OPTIONS: { value: SettleChoice; label: string }[] = [
  { value: 'open', label: 'noch offen' },
  { value: 'here', label: 'in dieser Abrechnung verrechnen' },
  { value: 'paid', label: 'ausgezahlt' },
]

export type Co2RefundForm = {
  tenancyId: string
  supplierBilledAt: string
  claimedAt: string
  amount: string
  settle: SettleChoice
  paidOutOn: string
  billedFrom: string
  billedTo: string
  emissionsKg: string
  co2Cost: string
  areaM2: string
  ownAppliances: boolean
  commercialUse: boolean
  commercialMetered: boolean
  nonResidential: boolean
  restriction: Co2Restriction
  halfSplitFrom: string
  gridFee: string
  bioCost: string
}

const centsText = (cents: number | null): string => (cents === null ? '' : (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const numberText = (n: number | null): string => (n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false }))

export function emptyRefundForm(tenancyId: string, areaM2: number | null): Co2RefundForm {
  return {
    tenancyId, supplierBilledAt: '', claimedAt: '', amount: '', settle: 'open', paidOutOn: '', billedFrom: '', billedTo: '', emissionsKg: '', co2Cost: '',
    areaM2: numberText(areaM2), ownAppliances: false, commercialUse: false, commercialMetered: false, nonResidential: false, restriction: 'none',
    halfSplitFrom: '', gridFee: '', bioCost: '',
  }
}

export function refundToForm(r: Co2Refund, period: PeriodKey): Co2RefundForm {
  return {
    tenancyId: r.tenancyId, supplierBilledAt: r.supplierBilledAt, claimedAt: r.claimedAt, amount: centsText(r.amountCents),
    settle: r.paidOutOn !== null ? 'paid' : r.settlePeriod === period ? 'here' : 'open',
    paidOutOn: r.paidOutOn ?? '', billedFrom: r.billedFrom ?? '', billedTo: r.billedTo ?? '', emissionsKg: numberText(r.emissionsKg),
    co2Cost: centsText(r.co2CostCents), areaM2: numberText(r.areaM2), ownAppliances: r.ownAppliances, commercialUse: r.commercialUse,
    commercialMetered: r.commercialMetered, nonResidential: r.nonResidential, restriction: r.restriction, halfSplitFrom: r.halfSplitFrom ?? '',
    gridFee: centsText(r.gridFeeCents), bioCost: centsText(r.bioCostCents),
  }
}

// Der Rumpf für POST und PUT. „noch offen“ lässt eine Erstattung, die in einer anderen Abrechnung verrechnet ist, dort;
// die Karte bietet „Bearbeiten“ nur für offene oder hier verrechnete an.
export function refundBody(f: Co2RefundForm, period: PeriodKey): { body: Record<string, unknown> } | { error: string } {
  if (f.tenancyId === '') return { error: 'Bitte wählen Sie den Mieter.' }
  if (f.supplierBilledAt === '') return { error: 'Bitte geben Sie den Tag an, an dem der Lieferant gegenüber dem Mieter abgerechnet hat.' }
  if (f.claimedAt === '') return { error: 'Bitte geben Sie den Tag an, an dem der Mieter die Erstattung in Textform verlangt hat.' }
  const amount = parseEuro(f.amount)
  if (amount === null || amount < 0) return { error: 'Der Betrag laut Anzeige ist kein Betrag.' }
  if (f.settle === 'paid' && f.paidOutOn === '') return { error: 'Bitte geben Sie den Tag der Auszahlung an.' }
  const euro = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const c = parseEuro(text)
    return c === null || c < 0 ? { error: `${name} ist kein Betrag.` } : c
  }
  const decimal = (text: string, name: string): number | null | { error: string } => {
    if (text.trim() === '') return null
    const n = parseDecimal(text)
    return n === null || n < 0 ? { error: `${name} ist eine Zahl ab 0.` } : n
  }
  // Gasnetzentgelte und Biobrennstoff zählen nur mit dem Tag, ab dem § 5a gilt.
  const withHalf = f.halfSplitFrom !== ''
  const co2 = euro(f.co2Cost, 'Die Angabe der CO₂-Kosten')
  const grid = withHalf ? euro(f.gridFee, 'Die Angabe zu den Gasnetzentgelten') : null
  const bio = withHalf ? euro(f.bioCost, 'Die Angabe zum Biobrennstoff') : null
  const kg = decimal(f.emissionsKg, 'Der CO₂-Ausstoß')
  const area = decimal(f.areaM2, 'Die Wohnfläche')
  for (const v of [co2, grid, bio, kg, area]) if (v !== null && typeof v === 'object') return v
  const num = (v: number | null | { error: string }): number | null => (typeof v === 'number' ? v : null)
  return {
    body: {
      tenancyId: f.tenancyId, supplierBilledAt: f.supplierBilledAt, claimedAt: f.claimedAt, amountCents: amount,
      settlePeriod: f.settle === 'here' ? period : null, paidOutOn: f.settle === 'paid' ? f.paidOutOn : null,
      billedFrom: f.billedFrom === '' ? null : f.billedFrom, billedTo: f.billedTo === '' ? null : f.billedTo,
      emissionsKg: num(kg), co2CostCents: num(co2), areaM2: num(area), ownAppliances: f.ownAppliances, commercialUse: f.commercialUse,
      commercialMetered: f.commercialUse && f.commercialMetered, nonResidential: f.nonResidential, restriction: f.restriction,
      halfSplitFrom: withHalf ? f.halfSplitFrom : null, gridFeeCents: num(grid), bioCostCents: num(bio),
    },
  }
}

export type RefundRow = Co2Refund & { settleLabel: string | null; refundDue: string | null }

// Der Stand einer Erstattung in der Liste.
export function refundStatus(r: RefundRow, period: PeriodKey): string {
  if (r.paidOutOn !== null) return `ausgezahlt am ${fmtDate(r.paidOutOn)}`
  if (r.settlePeriod === period) return 'in dieser Abrechnung verrechnet'
  if (r.settlePeriod !== null) return `verrechnet in der Abrechnung ${r.settleLabel ?? r.settlePeriod}`
  return r.refundDue ? `offen, spätestens am ${fmtDate(r.refundDue)} zu erstatten` : 'offen'
}

type TenancyLike = { id: string; unitId: string; tenantName: string; start: string; end: string | null; heatingModel?: string }

// Prüfung M4: wählbar sind nur Mietverhältnisse, deren Mieter selbst heizt.
export const refundTenancies = <T extends TenancyLike>(tenancies: readonly T[]): T[] => tenancies.filter((t) => t.heatingModel === 'selfSupply')

// Die vorbelegte Wohnfläche (Prüfung S5, § 5 Abs. 3 CO2KostAufG: „der gemieteten Wohnung“): die Wohnung des
// Mietverhältnisses; heizt derselbe Mieter am Tag `today` weitere Wohnungen selbst, deren Summe. Dass gleicher Name
// gleicher Mieter heißt und dass dann alle Räume über seinen Vertrag beheizt werden, ist eine Auslegung; der
// Vermieter prüft das Feld.
export function refundAreaOf(tenancyId: string, tenancies: readonly TenancyLike[], units: readonly { id: string; areaM2: number }[], today: string): number | null {
  const t = tenancies.find((x) => x.id === tenancyId)
  if (!t) return null
  const own = units.find((u) => u.id === t.unitId)?.areaM2 ?? null
  if (t.heatingModel !== 'selfSupply') return own
  const same = tenancies.filter((x) => x.heatingModel === 'selfSupply' && x.tenantName.trim() === t.tenantName.trim() && x.start <= today && (x.end === null || x.end >= today))
  const unitIds = [...new Set([t.unitId, ...same.map((x) => x.unitId)])]
  return unitIds.reduce((a, id) => a + (units.find((u) => u.id === id)?.areaM2 ?? 0), 0)
}
