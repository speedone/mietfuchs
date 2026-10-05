// Getrennte Heizkostenabrechnung ein- und ausschalten, mit Vorschau (#217, Heizung PR 5, Entwurf
// 3.1, B1, C1–C4, D1, D2 der siebten und achten Fassung, R-g).
//
// **Einschalten ab X** (B1, C1–C3). Bisher steht die ganze Vorauszahlung in `prepayments`. Ab dem
// Monat X wird jede Stufe geteilt: `prepayments` Y − Z, `heating_prepayments` Z, je Monat bleibt die
// Summe Y. Vorbelegt ist Z mit dem Anteil der Heizkosten an allen Kosten der letzten Abrechnung vor
// X, auf volle Euro. X liegt nie vor dem Monat nach der letzten abgeschlossenen Abrechnung des
// Objekts (409): Deren Vorauszahlungen sind schon angerechnet. Bei eigener Heizperiode, die kein
// Abrechnungszeitraum ist, entsteht eine Spanne ab X (Weg d): Die Heizperiode, die X enthält, wird
// getrennt abgerechnet, ihre Monate vor X rechnet weiter die Abrechnung des Objekts an
// (`separateOwner`). Bei H = P gibt es keine Spanne, nur den getrennten Ausweis (A3).
//
// **Jahreskorrekturen offener Abrechnungen** mit Monaten ab X werden neu erfasst (C2, D2): „davon
// übrige“ für P, die Heizkorrektur einer beendeten Heizperiode, deren Monate ab X ganz in P liegen,
// und für eine Heizperiode, die über P hinausreicht oder noch läuft, der Restbetrag als vorläufige
// Korrektur mit ihren Monaten. Gibt es mehrere solcher Heizperioden, fragt die Vorschau für alle bis
// auf die letzte nach dem Betrag; die letzte bekommt den Rest.
//
// **Ausschalten ab W** (C4, D1): W ist der Beginn der ersten Heizperiode der Spanne, die weder
// abgeschlossen ist noch Monate in einer abgeschlossenen Abrechnung des Objekts hat. Jede
// Heizperiode davor bleibt getrennt; ein früheres W lehnt der Server ab (409). Ab W bietet die
// Vorschau an, beide Staffeln zusammenzuführen (Vorgabe); ohne das rechnet P beide an. Eine
// Jahreskorrektur einer offenen Abrechnung P, die danach Monate der Heizstaffel anrechnet, und eine
// Heizkorrektur einer Heizperiode ab W werden als Jahreskorrektur „insgesamt“ neu erfasst.
//
// Jeder Monat der Heizstaffel bleibt dabei genau einmal angerechnet (6.1 Nr. 5).

import crypto from 'node:crypto'
import { and, eq, gte } from 'drizzle-orm'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import {
  hasOwnRhythm, heatingPeriodsEndingIn, isObjectPeriod, monthSpanText, plantRules, separateOwner, servesUnit, settledSeparately, type PlantWay,
} from '../../../shared/heatingPeriod.ts'
import { parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod, rulesOf, settlementDeadline } from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, HeatingPlant, PeriodEffect, PeriodKey, PeriodRules, PrepaymentEntry, SeparatePreview, Tenancy } from '../../../shared/types.ts'
import type { Database, Executor, Transaction } from './client.ts'
import { dryRun, lostClaims, outcomeOf, type Outcome } from './dryRun.ts'
import { monthsText, passedDeadlineText } from './periodChange.ts'
import { readClosedSettlements, readCostItems, readHeatingPlants, readProperties, readStock, readTenancies, readUnits } from './read.ts'
import { PeriodError } from './repository.ts'
import { closedHeatingSettlements, heatingPlants, heatingPrepaymentOverrides, heatingPrepayments, heatingSeparateSpans, prepaymentOverrides, prepayments } from './schema.ts'

type Ctx = {
  plant: HeatingPlant
  objectRules: PeriodRules
  rules: PeriodRules
  tenancies: Tenancy[]
  closedP: BillingPeriod[]
  closedH: Set<string>
  items: CostItem[]
  today: string
}

async function contextOf(db: Database, plantId: string, today: string): Promise<Ctx | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  const served = new Set((await readUnits(db)).filter((u) => u.propertyId === plant.propertyId && servesUnit(plant, u)).map((u) => u.id))
  const closedP = (await readClosedSettlements(db)).filter((c) => c.propertyId === plant.propertyId).flatMap((c) => {
    const p = periodOfKey(objectRules, c.period)
    return p ? [p] : []
  })
  const closedH = new Set((await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, plantId))).map((r) => String(r.period)))
  return {
    plant, objectRules, rules: plantRules(plant, objectRules),
    tenancies: (await readTenancies(db)).filter((t) => served.has(t.unitId)),
    closedP, closedH,
    items: (await readCostItems(db)).filter((c) => c.propertyId === plant.propertyId),
    today,
  }
}

const monthOf = (date: string): string => date.slice(0, 7)
const shiftMonth = (month: string, n: number): string => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  const year = Math.floor(index / 12)
  return `${String(year).padStart(4, '0')}-${String(index - year * 12 + 1).padStart(2, '0')}`
}
const rate = (schedule: readonly PrepaymentEntry[], month: string): number => {
  let r = 0
  for (const e of [...schedule].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) if (e.from <= month) r = e.monthlyCents
  return r
}
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: Pick<BillingPeriod, 'from' | 'to'>): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))
const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function readMonth(raw: unknown, what: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const key = parsePeriodKey(raw)
  if (key === null) throw new PeriodError(`${what}: „${String(raw)}“ ist kein Monat (JJJJ-MM).`)
  return key
}

// Die letzte abgeschlossene Abrechnung des Objekts und der erste Monat danach.
function lastClosed(c: Ctx): BillingPeriod | null {
  return c.closedP.reduce<BillingPeriod | null>((a, p) => (a === null || p.to > a.to ? p : a), null)
}
const earliestMonth = (c: Ctx): string | null => {
  const last = lastClosed(c)
  return last === null ? null : shiftMonth(monthOf(last.to), 1)
}

// Der Anteil der Heizkosten an allen Kosten der letzten Abrechnung vor X (B1), in Promille.
function lastShare(c: Ctx, x: string): { permille: number; source: string } | null {
  let p = periodContaining(c.objectRules, `${x}-01`)
  for (let i = 0; i < 3; i++) {
    p = previousPeriod(c.objectRules, p)
    const keys = new Set(hasOwnRhythm(c.plant) ? heatingPeriodsEndingIn(c.rules, p).map((h) => String(h.key)) : [String(p.key)])
    const inP = c.items.filter((it) => (it.heatingPlantId === c.plant.id ? keys.has(String(it.period)) : it.period === p.key))
    const total = inP.reduce((a, it) => a + it.amountCents, 0)
    const heating = inP.filter((it) => it.category === HEATING_CATEGORY).reduce((a, it) => a + it.amountCents, 0)
    if (total > 0 && heating > 0) return { permille: Math.round((heating * 1000) / total), source: `Abrechnung ${periodLabel(p)}: Heizkosten ${euro(heating)} von ${euro(total)}` }
  }
  return null
}

type Ask = { kind: 'total' | 'heating' | 'provisional'; period: BillingPeriod; months: string[] }
type OverrideEntry = { tenancy: Tenancy; period: BillingPeriod; cents: number | null; asks: Ask[]; remainder: { period: BillingPeriod; months: string[] } | null }
type StepEntry = { tenancy: Tenancy; first: string; rows: { from: string; totalCents: number; heatingCents: number }[] }
type MergeEntry = { tenancy: Tenancy; from: string; rows: { from: string; prepaymentCents: number }[] }
type Plan = {
  preview: SeparatePreview
  separate: boolean
  way: 'separate' | 'samePeriod'
  x: string
  steps: StepEntry[]
  overrides: OverrideEntry[]
  span: { from: string; keep: boolean } | null
  until: PeriodKey | null
  merges: MergeEntry[]
}

const outOverrides = (list: readonly OverrideEntry[]): SeparatePreview['overrides'] => list.map((e) => ({
  tenancyId: e.tenancy.id, tenantName: e.tenancy.tenantName, period: e.period.key, label: periodLabel(e.period), cents: e.cents,
  asks: e.asks.map((a) => ({ kind: a.kind, period: a.period.key, label: periodLabel(a.period), months: monthsText(a.months) })),
  remainder: e.remainder ? { period: e.remainder.period.key, label: periodLabel(e.remainder.period), months: monthsText(e.remainder.months) } : null,
}))

// Einschalten ab X.
function planOn(c: Ctx, rawMonth: unknown): Plan {
  if (c.plant.separateSpans.some((s) => s.until === null)) throw new PeriodError('Die getrennte Heizkostenabrechnung ist schon eingeschaltet.')
  const earliest = earliestMonth(c)
  const current = monthOf(periodContaining(c.rules, c.today).from)
  const x = readMonth(rawMonth, 'Beginn') ?? (earliest !== null && earliest > current ? earliest : current)
  const blocked: string[] = []
  const last = lastClosed(c)
  if (earliest !== null && last !== null && x < earliest) {
    blocked.push(`Die Vorauszahlungen bis ${monthSpanText([shiftMonth(earliest, -1)])} sind in der abgeschlossenen Abrechnung ${periodLabel(last)} angerechnet. Öffnen Sie sie wieder, wenn Sie früher beginnen wollen.`)
  }
  const lastUntil = c.plant.separateSpans.flatMap((s) => (s.until === null ? [] : [String(s.until)])).sort().pop()
  if (lastUntil !== undefined && x < lastUntil) {
    blocked.push(`Bis ${monthSpanText([shiftMonth(lastUntil, -1)])} gilt die frühere getrennte Heizkostenabrechnung. Wählen Sie einen Beginn ab ${monthSpanText([lastUntil])}.`)
  }
  const hX = periodContaining(c.rules, `${x}-01`)
  const way = hasOwnRhythm(c.plant) && !isObjectPeriod(c.objectRules, hX) ? 'separate' : 'samePeriod'
  const next: PlantWay = way === 'separate' ? { ...c.plant, separateSpans: [...c.plant.separateSpans, { from: x, until: null }] } : c.plant
  const share = lastShare(c, x)

  const steps: StepEntry[] = c.tenancies.filter((t) => !(t.end !== null && t.end < `${x}-01`)).map((t) => {
    const first = monthOf(t.start) > x ? monthOf(t.start) : x
    const heat = t.heatingPrepayments ?? []
    const bounds = [...new Set([first, ...t.prepayments.map((e) => e.from), ...heat.map((e) => e.from)])].filter((b) => b >= first).sort()
    return {
      tenancy: t, first,
      rows: bounds.map((from) => {
        const total = rate(t.prepayments, from) + rate(heat, from)
        return { from, totalCents: total, heatingCents: share ? Math.round((total * share.permille) / 1000 / 100) * 100 : rate(heat, from) }
      }),
    }
  })

  const overrides: OverrideEntry[] = way !== 'separate' ? [] : c.tenancies.flatMap((t) => Object.entries(t.prepaymentOverrides).flatMap(([schluessel, cents]): OverrideEntry[] => {
    const key = parsePeriodKey(schluessel)
    const p = key === null ? null : periodOfKey(c.objectRules, key)
    if (p === null || c.closedP.some((q) => q.key === p.key)) return []
    const after = activeMonths(t, p).filter((m) => m >= x)
    const first = after[0]
    if (first === undefined) return []
    const asks: Ask[] = [{ kind: 'total', period: p, months: activeMonths(t, p) }]
    const open: { period: BillingPeriod; months: string[] }[] = []
    for (const h of periodsBetween(c.rules, `${first}-01`, p.to)) {
      const months = after.filter((m) => separateOwner(next, c.objectRules, m)?.key === h.key)
      if (months.length === 0) continue
      const inside = periodMonths(h).filter((m) => m >= x).every((m) => m >= monthOf(p.from) && m <= monthOf(p.to))
      if (h.to < c.today && inside) asks.push({ kind: 'heating', period: h, months })
      else open.push({ period: h, months })
    }
    const remainder = open.pop() ?? null
    for (const o of open) asks.push({ kind: 'provisional', ...o })
    return [{ tenancy: t, period: p, cents, asks, remainder }]
  }))

  const reach = c.today > hX.to ? c.today : hX.to
  const deadlines = way !== 'separate' ? [] : periodsBetween(c.rules, hX.from, reach)
    .filter((h) => settledSeparately(next, c.objectRules, h))
    .map((h) => {
      const deadline = settlementDeadline(h)
      return { period: h.key, label: periodLabel(h), deadline, passed: c.today > deadline }
    })

  const preview: SeparatePreview = {
    separate: true, way, month: x, earliestMonth: earliest, until: null, earliestUntil: null, share,
    steps: steps.map((s) => ({ tenancyId: s.tenancy.id, tenantName: s.tenancy.tenantName, rows: s.rows })),
    overrides: outOverrides(overrides), deadlines, effects: [], keep: [], merge: [], blocked, token: '',
  }
  return { preview, separate: true, way, x, steps, overrides, span: null, until: null, merges: [] }
}

// Ausschalten ab W (Weg d) bzw. Ende der getrennten Vorauszahlung (H = P).
function planOff(c: Ctx, rawUntil: unknown, rawMonth: unknown): Plan {
  const span = c.plant.separateSpans.find((s) => s.until === null)
  const blocked: string[] = []
  const mergesFrom = (from: string): MergeEntry[] => c.tenancies.flatMap((t) => {
    const heat = t.heatingPrepayments ?? []
    if (heat.length === 0 || (t.end !== null && t.end < `${from}-01`)) return []
    const bounds = [...new Set([from, ...t.prepayments.map((e) => e.from), ...heat.map((e) => e.from)])].filter((b) => b >= from).sort()
    return [{ tenancy: t, from, rows: bounds.map((b) => ({ from: b, prepaymentCents: rate(t.prepayments, b) + rate(heat, b) })) }]
  })
  const out = (way: 'separate' | 'samePeriod', month: string, until: PeriodKey | null, earliestUntil: PeriodKey | null, keep: SeparatePreview['keep'], overrides: OverrideEntry[], merges: MergeEntry[], spanPlan: Plan['span']): Plan => ({
    preview: {
      separate: false, way, month, earliestMonth: earliestMonth(c), until, earliestUntil, share: null, steps: [],
      overrides: outOverrides(overrides), deadlines: [], effects: [], keep,
      merge: merges.map((m) => ({ tenancyId: m.tenancy.id, tenantName: m.tenancy.tenantName, rows: m.rows })), blocked, token: '',
    },
    separate: false, way, x: month, steps: [], overrides, span: spanPlan, until, merges,
  })

  if (!span) {
    if (c.plant.separateSettlement !== true) throw new PeriodError('Die getrennte Heizkostenabrechnung ist schon ausgeschaltet.')
    // H = P: Angerechnet wird wie bisher in P; es endet nur der getrennte Ausweis.
    const earliest = earliestMonth(c)
    const current = monthOf(periodContaining(c.objectRules, c.today).from)
    const from = readMonth(rawMonth, 'Zusammenführen ab') ?? (earliest !== null && earliest > current ? earliest : current)
    if (earliest !== null && from < earliest) blocked.push(`Bis ${monthSpanText([shiftMonth(earliest, -1)])} sind die Vorauszahlungen abgeschlossen angerechnet; führen Sie die Staffeln ab ${monthSpanText([earliest])} zusammen.`)
    return out('samePeriod', from, null, null, [], [], mergesFrom(from), null)
  }

  const horizon = `${Number(c.today.slice(0, 4)) + 3}-12-31`
  const candidates = periodsBetween(c.rules, `${span.from}-01`, horizon).filter((h) => monthOf(h.to) >= span.from)
  const reason = (h: BillingPeriod): string | null => {
    if (c.closedH.has(h.key)) return `Die Heizkostenabrechnung ${periodLabel(h)} ist abgeschlossen.`
    const p = c.closedP.find((q) => q.from <= h.to && q.to >= h.from)
    return p ? `Die Heizperiode ${periodLabel(h)} hat Monate in der abgeschlossenen Abrechnung ${periodLabel(p)}.` : null
  }
  const w = candidates.find((h) => reason(h) === null) ?? candidates[candidates.length - 1]
  if (w === undefined) throw new Error('Spanne ohne Heizperiode')
  const untilText = readMonth(rawUntil, 'Ende')
  const until = untilText === null ? w : periodOfKey(c.rules, parsePeriodKey(untilText) ?? w.key)
  if (until === null) throw new PeriodError(`Eine Heizperiode, die im ${monthSpanText([untilText ?? ''])} beginnt, gibt es für die Heizanlage nicht.`)
  if (until.key < w.key) {
    blocked.push(...candidates.filter((h) => h.key >= until.key && h.key < w.key).flatMap((h) => {
      const r = reason(h)
      return r === null ? [] : [r]
    }))
    blocked.push('Sie bleiben eigene Heizkostenabrechnungen; öffnen Sie die Abrechnung wieder, wenn das Ausschalten früher wirken soll.')
  }
  const keep = candidates.filter((h) => h.key < until.key && settledSeparately(c.plant, c.objectRules, h))
  const next: PlantWay = { ...c.plant, separateSpans: c.plant.separateSpans.map((s) => (s === span ? { ...s, until: until.key } : s)) }
  const ownerChanges = (m: string): boolean => separateOwner(c.plant, c.objectRules, m)?.key !== separateOwner(next, c.objectRules, m)?.key
  const overrides: OverrideEntry[] = c.tenancies.flatMap((t) => {
    const deleted = (t.heatingPrepaymentOverrides ?? []).filter((o) => o.plantId === c.plant.id && o.period >= until.key)
    return periodsBetween(c.objectRules, until.from, horizon).flatMap((p): OverrideEntry[] => {
      if (c.closedP.some((q) => q.key === p.key)) return []
      const months = activeMonths(t, p)
      if (!months.some(ownerChanges)) return []
      const had = t.prepaymentOverrides[p.key]
      const touched = deleted.some((o) => {
        const h = periodOfKey(c.rules, o.period)
        return h !== null && months.some((m) => periodMonths(h).includes(m))
      })
      if (had === undefined && !touched) return []
      return [{ tenancy: t, period: p, cents: had ?? null, asks: [{ kind: 'total', period: p, months }], remainder: null }]
    })
  })
  return out('separate', until.key, until.key, w.key,
    keep.map((h) => ({ period: h.key, label: periodLabel(h), deadline: settlementDeadline(h) })),
    overrides, mergesFrom(until.key), { from: span.from, keep: keep.length > 0 })
}

async function plan(db: Database, plantId: string, body: unknown, today: string): Promise<Plan | null> {
  const c = await contextOf(db, plantId, today)
  if (c === null) return null
  const b = objectOr(body)
  if (typeof b.separate !== 'boolean') throw new PeriodError('Bitte geben Sie an, ob die Heizkosten getrennt abgerechnet werden (ja oder nein).')
  const result = b.separate ? planOn(c, b.month) : planOff(c, b.until, b.month)
  // Die Marke über die ganze Vorschau (wie `tokenOf` in periodChange.ts): Ändert sich der Bestand
  // zwischen Vorschau und Speichern, gibt es 409 mit der neuen statt einer ungesehenen Aufteilung.
  const { token: _ohne, ...inhalt } = result.preview
  result.preview.token = crypto.createHash('sha256').update(JSON.stringify(inhalt)).digest('hex')
  return result
}

export async function previewSeparate(db: Database, plantId: string, body: unknown, today: string): Promise<SeparatePreview | null> {
  const p = await plan(db, plantId, body, today)
  return p === null ? null : withEffects(db, plantId, p, today)
}

// Laienprobe B3a: Das Aufteilen ab einem Monat X in der Vergangenheit ändert Abrechnungen, die schon
// begonnen haben oder vorbei sind: die des Objekts (sie verliert ab X den Heizanteil der
// Vorauszahlung) und die Heizkostenabrechnungen ab X. Liegt eine davon hinter ihrer Frist, ist eine
// Nachforderung daraus ausgeschlossen (§ 556 Abs. 3 S. 3 BGB). Die Vorschau nennt je solcher
// Abrechnung Frist und Ergebnis vorher und nachher, gerechnet im Probelauf mit den vorbelegten
// Heizanteilen. Mit Jahreskorrekturen, deren Beträge erst der Vermieter einträgt, gibt es nur die Frist.
async function withEffects(db: Database, plantId: string, p: Plan, today: string, chosen?: Given): Promise<SeparatePreview> {
  const c = await contextOf(db, plantId, today)
  if (c === null || p.preview.blocked.length > 0) return p.preview
  const propertyId = c.plant.propertyId
  const from = `${p.x}-01`
  if (from > today) return p.preview
  const closedP = new Set(c.closedP.map((q) => q.key))
  const objectPeriods = periodsBetween(c.objectRules, from, today).filter((q) => !closedP.has(q.key))
  const heatPeriods = periodsBetween(c.rules, from, today).filter((h) => !c.closedH.has(h.key))
  const before = await readStock(db)
  const given: Given = chosen ?? {
    stepAnswers: Object.fromEntries(p.steps.map((s) => [s.tenancy.id, Object.fromEntries(s.rows.map((r) => [r.from, r.heatingCents]))])),
    overrideAnswers: {}, totalAnswers: {}, rests: new Map(), merge: true,
  }
  const computable = chosen !== undefined || p.overrides.length === 0
  const after = computable ? await dryRun(db, (tx) => writeSeparateIn(tx, plantId, p, given), (stock) => {
    const plant = stock.heatingPlants?.find((x) => x.id === plantId)
    return {
      object: objectPeriods.map((q) => outcomeOf(stock, propertyId, q)),
      heating: heatPeriods.map((h) => (plant && settledSeparately(plant, c.objectRules, h) ? outcomeOf(stock, propertyId, h, plantId) : null)),
    }
  }) : null
  const separateBefore = (h: BillingPeriod): boolean => settledSeparately(c.plant, c.objectRules, h)
  const effect = (q: BillingPeriod, beforeOutcome: Outcome | null, afterOutcome: Outcome | null): PeriodEffect => {
    const deadline = settlementDeadline(q)
    const passed = deadline < today
    const tenants = (afterOutcome?.tenants ?? []).map((t) => ({
      tenantName: t.tenantName,
      beforeCents: beforeOutcome?.tenants.find((b) => b.tenancyId === t.tenancyId)?.balanceCents ?? null,
      afterCents: t.balanceCents,
    }))
    return {
      label: periodLabel(q), deadline, passed, replaces: [],
      tenants,
      lostClaimsCents: passed ? lostClaims(tenants) : 0,
    }
  }
  const effects: PeriodEffect[] = [
    ...objectPeriods.map((q, i) => effect(q, outcomeOf(before, propertyId, q), after?.object[i] ?? null)),
    ...heatPeriods.flatMap((h, i) => {
      const now = after?.heating[i] ?? null
      if (now === null && !(computable === false && p.separate)) return []
      return [{ ...effect(h, separateBefore(h) ? outcomeOf(before, propertyId, h, plantId) : null, now), label: `Heizkosten ${periodLabel(h)}` }]
    }),
  ]
  // Nur, was sich wirklich ändert: eine Abrechnung mit gleichem Ergebnis bei jedem Mieter fällt weg.
  return { ...p.preview, effects: effects.filter((e) => e.tenants.length === 0 || e.tenants.some((t) => t.beforeCents !== t.afterCents)) }
}

// Eine Staffel ab einem Monat ersetzen: Einträge davor bleiben, ab dort gelten die neuen.
async function writeSchedule(tx: Executor, table: typeof prepayments | typeof heatingPrepayments, t: Tenancy, keep: readonly PrepaymentEntry[], rows: readonly PrepaymentEntry[]): Promise<void> {
  await tx.delete(table).where(eq(table.tenancyId, t.id))
  const all = [...keep, ...rows]
  if (all.length > 0) await tx.insert(table).values(all.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
}

async function setTotal(tx: Executor, tenancyId: string, period: PeriodKey, cents: number | null): Promise<void> {
  await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, tenancyId), eq(prepaymentOverrides.period, period)))
  if (cents !== null) await tx.insert(prepaymentOverrides).values({ tenancyId, period, amountCents: cents })
}

async function setHeating(tx: Executor, tenancyId: string, plantId: string, period: PeriodKey, cents: number, months: readonly string[] | null): Promise<void> {
  await tx.delete(heatingPrepaymentOverrides)
    .where(and(eq(heatingPrepaymentOverrides.tenancyId, tenancyId), eq(heatingPrepaymentOverrides.plantId, plantId), eq(heatingPrepaymentOverrides.period, period)))
  await tx.insert(heatingPrepaymentOverrides).values({
    tenancyId, plantId, period, cents, provisional: months !== null, fromMonth: months?.[0] ?? null, toMonth: months?.[months.length - 1] ?? null,
  })
}

export async function applySeparate(db: Database, plantId: string, body: unknown, today: string): Promise<{ plant: HeatingPlant } | { error: string; preview: SeparatePreview } | null> {
  const p = await plan(db, plantId, body, today)
  if (p === null) return null
  // Jede Antwort mit Vorschau trägt Fristen und Ergebnisse (Review der Laienprobe, Runde 1).
  if (p.preview.blocked.length > 0) return { error: `${p.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, plantId, p, today) }
  const answers = objectOr(objectOr(body).answers)
  if (answers.token !== p.preview.token) {
    return { error: 'Die Vorschau ist nicht mehr aktuell: Seit sie erstellt wurde, hat sich am Bestand etwas geändert. Bitte prüfen Sie die neue Vorschau; gespeichert wurde nichts.', preview: await withEffects(db, plantId, p, today) }
  }
  const stepAnswers = objectOr(answers.steps)
  const overrideAnswers = objectOr(answers.overrides)
  const totalAnswers = objectOr(answers.totals)
  const missing: string[] = []
  for (const s of p.steps) {
    const given = objectOr(stepAnswers[s.tenancy.id])
    for (const row of s.rows) {
      const v = given[row.from]
      if (!isCents(v) || v > row.totalCents) missing.push(`${s.tenancy.tenantName}: Heizanteil ab ${monthsText([row.from])} eintragen (0 bis ${euro(row.totalCents)}).`)
    }
  }
  const rests = new Map<OverrideEntry, number>()
  for (const e of p.overrides) {
    const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
    const heating = objectOr(overrideAnswers[e.tenancy.id])
    if (p.separate ? !isCents(total) : !(total === null || isCents(total))) {
      missing.push(p.separate
        ? `${e.tenancy.tenantName}: tatsächlich gezahlte übrige Vorauszahlungen ${periodLabel(e.period)} eintragen (ohne Heizvorauszahlung ab ${monthsText([p.x])}).`
        : `${e.tenancy.tenantName}: tatsächlich gezahlte Vorauszahlungen insgesamt ${periodLabel(e.period)} eintragen (oder „keine Korrektur“).`)
      continue
    }
    let used = isCents(total) ? total : 0
    for (const a of e.asks) {
      if (a.kind === 'total') continue
      const v = heating[a.period.key]
      if (!isCents(v)) missing.push(`${e.tenancy.tenantName}: Heizvorauszahlung ${periodLabel(a.period)} (${monthsText(a.months)}) eintragen.`)
      else used += v
    }
    if (e.remainder && e.cents !== null) {
      const rest = e.cents - used
      if (rest < 0) missing.push(`Die Beträge für ${e.tenancy.tenantName} übersteigen die Jahreskorrektur ${periodLabel(e.period)} (${euro(e.cents)}).`)
      else rests.set(e, rest)
    }
  }
  if (missing.length > 0) return { error: `Es fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, plantId, p, today) }
  const given: Given = { stepAnswers, overrideAnswers, totalAnswers, rests, merge: answers.merge !== false }
  // Laienprobe B3a, Review Runde 1: Ändert das Aufteilen eine Abrechnung mit abgelaufener Frist, nur
  // mit ausdrücklicher Bestätigung (`understood`), gerechnet mit den Antworten.
  const checked = await withEffects(db, plantId, p, today, given)
  const passed = checked.effects.filter((e) => e.passed)
  if (passed.length > 0 && answers.understood !== true) {
    return { error: `${passedDeadlineText(passed.map((e) => e.label), 'die Vorauszahlung rückwirkend aufteilen')} Bitte bestätigen Sie das in der Vorschau; gespeichert wurde nichts.`, preview: checked }
  }

  await db.transaction(async (tx) => writeSeparateIn(tx, plantId, p, given))
  const plant = (await readHeatingPlants(db)).find((x) => x.id === plantId)
  return plant ? { plant } : null
}

type Given = {
  stepAnswers: Record<string, unknown>
  overrideAnswers: Record<string, unknown>
  totalAnswers: Record<string, unknown>
  rests: Map<OverrideEntry, number>
  merge: boolean
}

async function writeSeparateIn(tx: Transaction, plantId: string, p: Plan, { stepAnswers, overrideAnswers, totalAnswers, rests, merge }: Given): Promise<void> {
  {
    await tx.update(heatingPlants).set({ separateSettlement: p.separate }).where(eq(heatingPlants.id, plantId))
    if (p.separate) {
      if (p.way === 'separate') await tx.insert(heatingSeparateSpans).values({ plantId, from: p.x, until: null })
      for (const s of p.steps) {
        const given = objectOr(stepAnswers[s.tenancy.id])
        const z = (from: string): number => {
          const v = given[from]
          return isCents(v) ? v : 0
        }
        await writeSchedule(tx, prepayments, s.tenancy, s.tenancy.prepayments.filter((e) => e.from < s.first), s.rows.map((r) => ({ from: r.from, monthlyCents: r.totalCents - z(r.from) })))
        await writeSchedule(tx, heatingPrepayments, s.tenancy, (s.tenancy.heatingPrepayments ?? []).filter((e) => e.from < s.first), s.rows.map((r) => ({ from: r.from, monthlyCents: z(r.from) })))
      }
      for (const e of p.overrides) {
        const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
        await setTotal(tx, e.tenancy.id, e.period.key, isCents(total) ? total : null)
        const heating = objectOr(overrideAnswers[e.tenancy.id])
        for (const a of e.asks) {
          const v = heating[a.period.key]
          if (a.kind !== 'total' && isCents(v)) await setHeating(tx, e.tenancy.id, plantId, a.period.key, v, a.kind === 'provisional' ? a.months : null)
        }
        const rest = rests.get(e)
        if (e.remainder && rest !== undefined) await setHeating(tx, e.tenancy.id, plantId, e.remainder.period.key, rest, e.remainder.months)
      }
    } else {
      if (p.span && p.until) {
        if (p.span.keep) await tx.update(heatingSeparateSpans).set({ until: p.until }).where(and(eq(heatingSeparateSpans.plantId, plantId), eq(heatingSeparateSpans.from, p.span.from)))
        else await tx.delete(heatingSeparateSpans).where(and(eq(heatingSeparateSpans.plantId, plantId), eq(heatingSeparateSpans.from, p.span.from)))
        await tx.delete(heatingPrepaymentOverrides).where(and(eq(heatingPrepaymentOverrides.plantId, plantId), gte(heatingPrepaymentOverrides.period, p.until)))
      }
      for (const e of p.overrides) {
        const total = objectOr(totalAnswers[e.tenancy.id])[e.period.key]
        await setTotal(tx, e.tenancy.id, e.period.key, isCents(total) ? total : null)
      }
      if (merge) {
        for (const m of p.merges) {
          const heat = m.tenancy.heatingPrepayments ?? []
          const before = heat.filter((e) => e.from < m.from)
          await writeSchedule(tx, prepayments, m.tenancy, m.tenancy.prepayments.filter((e) => e.from < m.from), m.rows.map((r) => ({ from: r.from, monthlyCents: r.prepaymentCents })))
          await writeSchedule(tx, heatingPrepayments, m.tenancy, before, before.length > 0 && rate(heat, m.from) > 0 ? [{ from: m.from, monthlyCents: 0 }] : [])
        }
      }
    }
  }
}
