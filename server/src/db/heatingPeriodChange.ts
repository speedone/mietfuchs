// Wechsel der eigenen Heizperiode einer Anlage mit Vorschau (#217, Heizung PR 5, Entwurf 3.0, 3.6,
// B2): dasselbe Verfahren wie beim Wechsel des Objektzeitraums (periodChange.ts). Gezeigt wird vorher,
// was mit jeder Zeile geschieht; geschrieben wird in einer Transaktion und nur mit den Antworten, die
// die Vorschau verlangt.
//
// - **Heizpositionen** kommen in die Heizperiode, die in ihrem Abrechnungszeitraum endet (3.0, G-A2):
//   Eine Messdienstabrechnung 2025/26, bisher unter 2026, steht danach unter 2025/2026. Endet dort
//   keine oder mehr als eine, ordnet der Vermieter je Gruppe zu. Heizkosten werden nie nach Tagen
//   geteilt (G-C1).
// - **Korrekturen** lassen sich nicht auf Monate verteilen (N4, B2): Ändert sich eine getrennt
//   abgerechnete Heizperiode mit Heizkorrektur, wird je neuer Heizperiode gefragt, und wo ihre Monate
//   danach eine Abrechnung P anrechnet, nach den Vorauszahlungen insgesamt dieser Abrechnung. Ebenso für
//   jede offene Abrechnung P mit Jahreskorrektur, deren Monate der Heizstaffel danach woanders
//   angerechnet würden: Die Jahreskorrektur gilt für alles, was P anrechnet (3.7).
// - **Unantastbar** (409): eine abgeschlossene Heizkostenabrechnung, deren Heizperiode sich ändert;
//   eine Heizperiode mit Heizpositionen, die in einer abgeschlossenen Abrechnung des Objekts endet;
//   jeder Monat einer abgeschlossenen Abrechnung, dessen Heizvorauszahlung danach woanders angerechnet
//   würde; Angaben je Heizperiode (`heating_periods`), die ab PR 6 geschrieben werden und deren
//   Umschlüsselung mit ihnen kommt.
//
// Gelesen wird vor der Transaktion; die Schlange in open.ts lässt dazwischen keine andere Anfrage herein.

import crypto from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { heatingPeriodsEndingIn, plantRules, separateOwner, servesUnit, settledSeparately, type PlantWay } from '../../../shared/heatingPeriod.ts'
import { formatDayRange, parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, settlementDeadline, spansTwoYears, startYearOf } from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, HeatingPeriodChangePreview, HeatingPlant, PeriodEffect, PeriodKey, PeriodRules, Tenancy } from '../../../shared/types.ts'
import type { Database, Transaction } from './client.ts'
import { dryRun, earliestTenancyStart, lostClaims, outcomeOf, shownEffects, type Outcome } from './dryRun.ts'
import { checkRules, monthsText, passedDeadlineText } from './periodChange.ts'
import { readClosedSettlements, readCostItems, readHeatingPlants, readProperties, readStock, readTenancies, readUnits } from './read.ts'
import { patchCostItemIn, PeriodError } from './repository.ts'
import {
  closedHeatingSettlementHistory, closedHeatingSettlements, costItems, heatingPeriodChanges, heatingPeriods, heatingPlants, heatingPrepaymentOverrides, prepaymentOverrides,
} from './schema.ts'

type Status = 'same' | 'grows' | 'shrinks' | 'gone'
type Affected = { key: PeriodKey; old: BillingPeriod; now: BillingPeriod | null; status: Status }

function affectedOf(before: PeriodRules, next: PeriodRules, key: PeriodKey): Affected | null {
  const old = periodOfKey(before, key)
  if (old === null) return null
  const now = periodOfKey(next, key)
  const status: Status = now === null ? 'gone'
    : now.from === old.from && now.to === old.to ? 'same'
      : now.from <= old.from && now.to >= old.to ? 'grows' : 'shrinks'
  return { key, old, now, status }
}

const sameRules = (a: PeriodRules, b: PeriodRules): boolean => a.startMonth === b.startMonth && a.changes.join() === b.changes.join()
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: BillingPeriod): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))
const overlapDays = (a: BillingPeriod, b: BillingPeriod): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}
// Das Jahr der Zahlung in der neuen Heizperiode, dieselbe Regel wie beim Wechsel des Objektzeitraums
// (`taxEntry` in periodChange.ts): das bisherige, in die erlaubte Spanne vom Jahr des Beginns bis ein
// Jahr nach dem Ende geklemmt (Review der Laienprobe, Runde 1). Ohne Klemme lehnte die Schreibprüfung
// ab oder, vorher am Wächter vorbei geschrieben, verschwände die Position aus jeder Steuerübersicht.
export const taxYearIn = (target: Pick<BillingPeriod, 'from' | 'to'>, item: Pick<CostItem, 'taxYear' | 'period'>): number | null => {
  if (!spansTwoYears(target)) return null
  const start = Number(target.from.slice(0, 4))
  const end = Number(target.to.slice(0, 4)) + 1
  return Math.min(Math.max(item.taxYear ?? startYearOf(item.period), start), end)
}

type Ask = { kind: 'heating' | 'total'; period: BillingPeriod; months: string[] }
type OverrideAsk = {
  tenancy: Tenancy
  dropHeating: Set<PeriodKey>
  dropTotals: Set<PeriodKey>
  from: { kind: 'heating' | 'total'; key: PeriodKey; label: string; cents: number }[]
  ask: Map<string, Ask>
}
type Plan = {
  preview: HeatingPeriodChangePreview
  plant: HeatingPlant
  own: PeriodRules | null
  moves: { item: CostItem; to: BillingPeriod; options: BillingPeriod[] }[]
  groups: Map<PeriodKey, { items: CostItem[]; options: BillingPeriod[] }>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
  objectRules: PeriodRules
  before: PeriodRules
  next: PeriodRules
  closedKeys: ReadonlySet<string>
}

async function planHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, today: string): Promise<Plan | null> {
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  if (!plant) return null
  const objectRules = rulesOf((await readProperties(db)).find((p) => p.id === plant.propertyId))
  const own = rawRules === null ? null : checkRules(rawRules)
  const before = plantRules(plant, objectRules)
  const next = own ?? objectRules
  if ((own === null) === (plant.periodStartMonth === null) && sameRules(before, next)) {
    throw new PeriodError('Es ändert sich nichts: Der Zeitraum der Heizung ist schon so eingestellt.')
  }
  const nextPlant: PlantWay = { periodStartMonth: own?.startMonth ?? null, periodChanges: own?.changes ?? [], separateSpans: plant.separateSpans }

  const memo = new Map<PeriodKey, Affected | null>()
  const changed = (key: PeriodKey): Affected | null => {
    if (!memo.has(key)) memo.set(key, affectedOf(before, next, key))
    const a = memo.get(key) ?? null
    return a !== null && a.status !== 'same' ? a : null
  }

  const items = (await readCostItems(db)).filter((c) => c.heatingPlantId === plantId)
  const closedP = (await readClosedSettlements(db)).filter((c) => c.propertyId === plant.propertyId)
  const closedH = await db.select({ period: closedHeatingSettlements.period }).from(closedHeatingSettlements).where(eq(closedHeatingSettlements.plantId, plantId))
  const historyH = await db.select({ period: closedHeatingSettlementHistory.period }).from(closedHeatingSettlementHistory).where(eq(closedHeatingSettlementHistory.plantId, plantId))
  const periodRows = await db.select({ period: heatingPeriods.period }).from(heatingPeriods).where(eq(heatingPeriods.plantId, plantId))
  const served = new Set((await readUnits(db)).filter((u) => u.propertyId === plant.propertyId && servesUnit(plant, u)).map((u) => u.id))
  const tenancies = (await readTenancies(db)).filter((t) => served.has(t.unitId))
  const separateNow = (h: BillingPeriod): boolean => settledSeparately(nextPlant, objectRules, h)

  const blocked = new Set<string>()
  for (const c of closedH) {
    const a = changed(c.period)
    if (a) blocked.add(`Die Heizkostenabrechnung ${periodLabel(a.old)} ist abgeschlossen; nach dem Wechsel hätte sie einen anderen Zeitraum. Öffnen Sie sie wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
  }
  for (const h of historyH) {
    const a = changed(h.period)
    if (a?.status === 'gone') blocked.add(`Für die Heizkostenabrechnung ${periodLabel(a.old)} gibt es frühere Abschlüsse im Verlauf; diese Heizperiode gäbe es nach dem Wechsel nicht mehr. Wählen Sie einen späteren Beginn.`)
  }
  for (const r of periodRows) {
    const a = changed(r.period)
    if (a) blocked.add(`Für die Heizperiode ${periodLabel(a.old)} sind Angaben zur Heizung erfasst (Warmwasser, Verteilung). Den Zeitraum einer solchen Heizperiode zu ändern, kommt mit einer späteren Version.`)
  }
  for (const p of closedP) {
    const closed = periodOfKey(objectRules, p.period)
    if (closed === null) continue
    for (const item of items) {
      const a = changed(item.period)
      if (a && a.old.to >= closed.from && a.old.to <= closed.to) {
        blocked.add(`Die Heizperiode ${periodLabel(a.old)} gehört zur abgeschlossenen Abrechnung ${periodLabel(closed)}; nach dem Wechsel stünde sie anders darin. Öffnen Sie die Abrechnung wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
      }
    }
    // Jeder Monat der Heizstaffel wird genau einmal angerechnet (6.1 Nr. 5): Wo er in einer
    // abgeschlossenen Abrechnung angerechnet ist, muss er es bleiben.
    if (periodMonths(closed).some((m) => separateOwner(plant, objectRules, m)?.key !== separateOwner(nextPlant, objectRules, m)?.key)) {
      blocked.add(`Die Heizvorauszahlungen der abgeschlossenen Abrechnung ${periodLabel(closed)} würden nach dem Wechsel anders angerechnet. Öffnen Sie die Abrechnung wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
    }
  }

  const moves: Plan['moves'] = []
  const groups: Plan['groups'] = new Map()
  for (const item of items) {
    const a = changed(item.period)
    // Eine Heizperiode, die nur wächst, behält ihre Positionen, wie beim Objekt.
    if (a === null || a.status === 'grows') continue
    const candidates = heatingPeriodsEndingIn(next, periodContaining(objectRules, a.old.to))
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only) {
      // Laienprobe B12: Vorbelegt bleibt die Heizperiode, die im bisherigen Zeitraum endet; so steht die
      // Position weiter in derselben Gesamtabrechnung (Weg b). Wählbar ist jede Heizperiode, die den
      // bisherigen Zeitraum berührt, denn eine Versorgerrechnung über ein Kalenderjahr ist nicht die
      // Abrechnung einer Heizperiode, und welche es ist, weiß nur der Vermieter.
      const options = periodsBetween(next, a.old.from, a.old.to)
      if (!options.some((o) => o.key === only.key)) options.push(only)
      if (only.key !== item.period) moves.push({ item, to: only, options })
      continue
    }
    const g = groups.get(a.key) ?? { items: [], options: candidates.length > 0 ? candidates : periodsBetween(next, a.old.from, a.old.to) }
    g.items.push(item)
    groups.set(a.key, g)
  }

  const closedKeys = new Set(closedP.map((c) => String(c.period)))
  const overrideRekeys: Plan['overrideRekeys'] = []
  const asks = new Map<string, OverrideAsk>()
  const entryOf = (t: Tenancy): OverrideAsk => {
    const found = asks.get(t.id)
    if (found) return found
    const neu: OverrideAsk = { tenancy: t, dropHeating: new Set(), dropTotals: new Set(), from: [], ask: new Map() }
    asks.set(t.id, neu)
    return neu
  }
  const askTotal = (t: Tenancy, p: BillingPeriod): void => {
    if (closedKeys.has(p.key)) return
    const e = entryOf(t)
    e.ask.set(`total:${p.key}`, { kind: 'total', period: p, months: activeMonths(t, p) })
    e.dropTotals.add(p.key)
    const cents = t.prepaymentOverrides[p.key]
    if (cents !== undefined && !e.from.some((f) => f.kind === 'total' && f.key === p.key)) e.from.push({ kind: 'total', key: p.key, label: periodLabel(p), cents })
  }
  const ownerChanges = (m: string): boolean => separateOwner(plant, objectRules, m)?.key !== separateOwner(nextPlant, objectRules, m)?.key
  for (const t of tenancies) {
    for (const o of t.heatingPrepaymentOverrides ?? []) {
      if (o.plantId !== plantId) continue
      const a = changed(o.period)
      if (a === null) continue
      const withMonths = periodsBetween(next, a.old.from, a.old.to).map((p) => ({ period: p, months: activeMonths(t, p) })).filter((x) => x.months.length > 0)
      const one = withMonths.length === 1 ? withMonths[0] : undefined
      if (one && separateNow(one.period) && one.months.join() === activeMonths(t, a.old).join()) {
        if (one.period.key !== o.period) overrideRekeys.push({ tenancyId: t.id, from: o.period, to: one.period.key })
        continue
      }
      const e = entryOf(t)
      e.dropHeating.add(o.period)
      e.from.push({ kind: 'heating', key: o.period, label: periodLabel(a.old), cents: o.cents })
      for (const x of withMonths) {
        // Gefragt werden nur die Monate, die die getrennte Heizperiode danach anrechnet, wie beim
        // Einschalten (Durchsicht von #231); ihre Monate vor X rechnet eine Abrechnung P an.
        const owned = separateNow(x.period) ? x.months.filter((m) => separateOwner(nextPlant, objectRules, m)?.key === x.period.key) : []
        if (owned.length > 0) e.ask.set(`heating:${x.period.key}`, { kind: 'heating', period: x.period, months: owned })
        const rest = x.months.filter((m) => !owned.includes(m))
        const firstRest = rest[0]
        const lastRest = rest[rest.length - 1]
        if (firstRest !== undefined && lastRest !== undefined) {
          for (const p of periodsBetween(objectRules, `${firstRest}-01`, `${lastRest}-01`)) askTotal(t, p)
        }
      }
    }
    for (const schluessel of Object.keys(t.prepaymentOverrides)) {
      const key = parsePeriodKey(schluessel)
      const p = key === null ? null : periodOfKey(objectRules, key)
      if (p !== null && activeMonths(t, p).some(ownerChanges)) askTotal(t, p)
    }
  }

  const years = [...[...memo.values()].flatMap((a) => (a ? [a.old.from] : [])), ...next.changes.map((c) => `${c}-01`), ...before.changes.map((c) => `${c}-01`), today].sort()
  const listFrom = `${Number((years[0] ?? today).slice(0, 4)) - 1}-01-01`
  const listTo = `${Number((years[years.length - 1] ?? today).slice(0, 4)) + 1}-12-31`
  const periods = periodsBetween(next, listFrom, listTo)
  const wasShort = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old !== null && old.short && old.from === p.from && old.to === p.to
  }
  const bestFor = (old: BillingPeriod, options: readonly BillingPeriod[]): BillingPeriod => {
    let best = options[0] ?? old
    for (const p of options) if (overlapDays(p, old) > overlapDays(best, old)) best = p
    return best
  }
  const preview: HeatingPeriodChangePreview = {
    token: '',
    rules: own,
    periods: periods.map((p) => ({ key: p.key, label: periodLabel(p), short: p.short, separate: separateNow(p) })),
    newShort: periods.filter((p) => p.short && !wasShort(p)).map((p) => ({ key: p.key, label: periodLabel(p) })),
    blocked: [...blocked],
    moves: moves.map(({ item, to, options }) => {
      const old = changed(item.period)?.old ?? to
      return {
        costItemId: item.id, description: item.description, amountCents: item.amountCents,
        from: item.period, fromLabel: periodLabel(old), to: to.key, toLabel: periodLabel(to),
        fromRange: formatDayRange(old.from, old.to), toRange: formatDayRange(to.from, to.to),
        options: options.map((o) => ({ key: o.key, label: periodLabel(o), range: formatDayRange(o.from, o.to) })),
        check: item.serviceFrom === undefined || item.serviceTo === undefined,
      }
    }),
    groups: [...groups.entries()].map(([from, g]) => {
      const old = changed(from)?.old ?? g.options[0]
      if (old === undefined) throw new Error(`Heizperiode ${from} ohne Befund in der Vorschau`)
      return {
        from, fromLabel: periodLabel(old),
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p), range: formatDayRange(p.from, p.to) })),
        suggested: bestFor(old, g.options).key,
      }
    }),
    overrides: [...asks.values()].map((o) => ({
      tenancyId: o.tenancy.id, tenantName: o.tenancy.tenantName, from: o.from,
      ask: [...o.ask.values()].map((x) => ({ kind: x.kind, period: x.period.key, label: periodLabel(x.period), months: monthsText(x.months) })),
    })),
    endsSeparate: periods
      .filter((p) => !separateNow(p) && periodMonths(p).some((m) => separateOwner(plant, objectRules, m) !== null))
      .map((p) => ({ key: p.key, label: periodLabel(p) })),
    effects: [],
  }
  // Die Marke über alles, was der Wechsel schreibt (wie `tokenOf` in periodChange.ts).
  preview.token = crypto.createHash('sha256')
    .update(JSON.stringify([preview.rules, preview.blocked, preview.moves, preview.groups, preview.overrides, preview.endsSeparate, overrideRekeys]))
    .digest('hex')
  return { preview, plant, own, moves, groups, overrideRekeys, overrideAsks: [...asks.values()], objectRules, before, next, closedKeys }
}

export async function previewHeatingPeriodChange(db: Database, plantId: string, rawRules: unknown, today: string): Promise<HeatingPeriodChangePreview | null> {
  const plan = await planHeatingPeriodChange(db, plantId, rawRules, today)
  return plan === null ? null : withEffects(db, plantId, plan, today)
}

// Review der Laienprobe, Runde 2: Auch der Wechsel der Heizperiode ändert Abrechnungen, die schon
// begonnen haben oder vorbei sind, die des Objekts (Weg b: welche Heizperiode darin steht) und die
// Heizkostenabrechnungen nach Weg d. Die Vorschau nennt Frist und Ergebnis vorher und nachher, im
// Probelauf gerechnet, mit `given` beim Speichern mit den Antworten, sonst mit den Vorgaben.
async function withEffects(db: Database, plantId: string, plan: Plan, today: string, given?: Record<string, unknown>): Promise<HeatingPeriodChangePreview> {
  const { before, next, objectRules } = plan
  const differs = (rulesA: PeriodRules, rulesB: PeriodRules) => (p: BillingPeriod): boolean => {
    const o = periodOfKey(rulesB, p.key)
    return o === null || o.from !== p.from || o.to !== p.to
  }
  const firstOld = periodsBetween(before, '2000-01-01', today).find(differs(before, next))
  const firstNew = periodsBetween(next, '2000-01-01', today).find(differs(next, before))
  const first = [firstOld?.from, firstNew?.from].filter((x): x is string => x !== undefined).sort()[0]
  if (first === undefined || first > today) return plan.preview
  const stockBefore = await readStock(db)
  const moved = await earliestTenancyStart(db, plan.plant.propertyId)
  if (moved === null) return plan.preview
  const from = moved > first ? moved : first
  const objectPeriods = periodsBetween(objectRules, from, today).filter((p) => !plan.closedKeys.has(p.key))
  const heatPeriods = periodsBetween(next, from, today)
  const answers = given ?? {
    groups: Object.fromEntries([...plan.preview.groups].map((g) => [g.from, g.suggested])),
    moves: {}, overrides: {}, totals: {}, token: plan.preview.token,
  }
  const after = await dryRun(db, (tx) => writeHeatingChangeIn(tx, plantId, plan, answers), (stock) => {
    const p = stock.heatingPlants?.find((x) => x.id === plantId)
    return {
      object: objectPeriods.map((q) => outcomeOf(stock, plan.plant.propertyId, q)),
      heating: heatPeriods.map((h) => (p && settledSeparately(p, objectRules, h) ? outcomeOf(stock, plan.plant.propertyId, h, plantId) : null)),
    }
  })
  const effect = (q: BillingPeriod, label: string, beforeOutcome: Outcome | null, afterOutcome: Outcome | null, beforeBarred: boolean): PeriodEffect => {
    const deadline = settlementDeadline(q)
    const passed = deadline < today
    const tenants = (afterOutcome?.tenants ?? []).map((t) => ({
      tenantName: t.tenantName,
      beforeCents: beforeOutcome?.tenants.find((b) => b.tenancyId === t.tenancyId)?.balanceCents ?? null,
      afterCents: t.balanceCents,
    }))
    return { label, deadline, passed, replaces: [], tenants, lostClaimsCents: passed ? lostClaims(tenants, beforeBarred) : 0 }
  }
  const effects: PeriodEffect[] = [
    // Derselbe Abrechnungszeitraum des Objekts vorher und nachher, also dieselbe Frist.
    ...objectPeriods.map((q, i) => effect(q, periodLabel(q), outcomeOf(stockBefore, plan.plant.propertyId, q), after?.object[i] ?? null, true)),
    ...heatPeriods.flatMap((h, i) => {
      const now = after?.heating[i] ?? null
      // Gescheiterter Probelauf: die Frist jeder Heizperiode, die danach getrennt abgerechnet wird.
      const nextWay = { periodStartMonth: plan.own?.startMonth ?? null, periodChanges: plan.own?.changes ?? [], separateSpans: plan.plant.separateSpans }
      if (now === null && (after !== null || !settledSeparately(nextWay, objectRules, h))) return []
      // Verglichen wird wie beim Wechsel des Abrechnungszeitraums (periodChange.ts) mit dem bisherigen
      // Zeitraum gleichen Schlüssels, auch wenn er kürzer oder länger war (Review Runde 3); verloren ist
      // nur das Mehr, wenn dessen Frist selbst schon abgelaufen war.
      const old = periodOfKey(before, h.key)
      const wasSeparate = old !== null && settledSeparately(plan.plant, objectRules, old)
      const barred = old !== null && wasSeparate && settlementDeadline(old) < today
      return [effect(h, `Heizkosten ${periodLabel(h)}`, wasSeparate ? outcomeOf(stockBefore, plan.plant.propertyId, old, plantId) : null, now, barred)]
    }),
  ]
  return { ...plan.preview, effects: shownEffects(effects, after !== null) }
}

const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export async function applyHeatingPeriodChange(
  db: Database, plantId: string, rawRules: unknown, rawAnswers: unknown, today: string,
): Promise<{ plant: HeatingPlant } | { error: string; preview: HeatingPeriodChangePreview } | null> {
  const plan = await planHeatingPeriodChange(db, plantId, rawRules, today)
  if (plan === null) return null
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, plantId, plan, today) }
  const answers = objectOr(rawAnswers)
  if (answers.token !== plan.preview.token) {
    return { error: 'Die Vorschau ist nicht mehr aktuell: Seit sie erstellt wurde, hat sich am Bestand etwas geändert. Bitte prüfen Sie die neue Vorschau; gespeichert wurde nichts.', preview: await withEffects(db, plantId, plan, today) }
  }
  const groupAnswers = objectOr(answers.groups)
  const moveTarget = (m: Plan['moves'][number]): BillingPeriod | undefined => moveTargetOf(m, objectOr(answers.moves))
  const overrideAnswers = objectOr(answers.overrides)
  const totalAnswers = objectOr(answers.totals)
  const missing: string[] = []
  for (const g of plan.groups.values()) {
    const from = g.items[0]?.period
    if (from === undefined || !g.options.some((p) => p.key === groupAnswers[from])) missing.push(`Heizperiode für ${g.items.map((i) => `„${i.description}“`).join(', ')} wählen.`)
  }
  for (const o of plan.overrideAsks) {
    for (const x of o.ask.values()) {
      const given = objectOr((x.kind === 'heating' ? overrideAnswers : totalAnswers)[o.tenancy.id])
      const v = given[x.period.key]
      if (!Object.hasOwn(given, x.period.key) || !(v === null || isCents(v))) {
        missing.push(x.kind === 'heating'
          ? `${o.tenancy.tenantName}: tatsächlich gezahlte Heizvorauszahlung ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`
          : `${o.tenancy.tenantName}: tatsächlich gezahlte Vorauszahlungen insgesamt ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`)
      }
    }
  }
  for (const m of plan.moves) if (moveTarget(m) === undefined) missing.push(`Heizperiode für „${m.item.description}“ wählen.`)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, plantId, plan, today) }
  // Review Runde 2: Bei abgelaufener Frist nur mit Bestätigung, gerechnet mit den Antworten.
  const checked = await withEffects(db, plantId, plan, today, answers)
  const passed = checked.effects.filter((e) => e.passed)
  if (passed.length > 0 && answers.understood !== true) {
    return { error: `${passedDeadlineText(passed.map((e) => e.label), 'den Zeitraum der Heizung selbst umstellen')} Bitte bestätigen Sie das in der Vorschau; gespeichert wurde nichts.`, preview: checked }
  }
  await db.transaction(async (tx) => writeHeatingChangeIn(tx, plantId, plan, answers))
  const plant = (await readHeatingPlants(db)).find((p) => p.id === plantId)
  return plant ? { plant } : null
}

const moveTargetOf = (m: Plan['moves'][number], moveAnswers: Record<string, unknown>): BillingPeriod | undefined => {
  const chosen = moveAnswers[m.item.id]
  return chosen === undefined ? m.to : m.options.find((o) => o.key === chosen)
}

async function writeHeatingChangeIn(tx: Transaction, plantId: string, plan: Plan, answers: Record<string, unknown>): Promise<void> {
  const groupAnswers = objectOr(answers.groups)
  const overrideAnswers = objectOr(answers.overrides)
  const totalAnswers = objectOr(answers.totals)
  const moveTarget = (m: Plan['moves'][number]): BillingPeriod | undefined => moveTargetOf(m, objectOr(answers.moves))
  {
    await tx.update(heatingPlants).set({ periodStartMonth: plan.own?.startMonth ?? null }).where(eq(heatingPlants.id, plantId))
    await tx.delete(heatingPeriodChanges).where(eq(heatingPeriodChanges.plantId, plantId))
    if (plan.own && plan.own.changes.length > 0) await tx.insert(heatingPeriodChanges).values(plan.own.changes.map((fromMonth) => ({ plantId, fromMonth })))
    for (const m of plan.moves) {
      const to = moveTarget(m) ?? m.to
      // Durch dieselbe Verschmelzung und Schreibprüfung wie beim Speichern, nicht am Wächter vorbei.
      await patchCostItemIn(tx, m.item, { period: to.key, taxYear: taxYearIn(to, m.item) })
    }
    for (const g of plan.groups.values()) {
      const from = g.items[0]?.period
      const target = g.options.find((p) => p.key === (from === undefined ? undefined : groupAnswers[from]))
      if (!target) continue
      for (const item of g.items) await patchCostItemIn(tx, item, { period: target.key, taxYear: taxYearIn(target, item) })
    }
    for (const r of plan.overrideRekeys) {
      await tx.update(heatingPrepaymentOverrides).set({ period: r.to })
        .where(and(eq(heatingPrepaymentOverrides.tenancyId, r.tenancyId), eq(heatingPrepaymentOverrides.plantId, plantId), eq(heatingPrepaymentOverrides.period, r.from)))
    }
    for (const o of plan.overrideAsks) {
      if (o.dropHeating.size > 0) {
        await tx.delete(heatingPrepaymentOverrides)
          .where(and(eq(heatingPrepaymentOverrides.tenancyId, o.tenancy.id), eq(heatingPrepaymentOverrides.plantId, plantId), inArray(heatingPrepaymentOverrides.period, [...o.dropHeating])))
      }
      if (o.dropTotals.size > 0) {
        await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, o.tenancy.id), inArray(prepaymentOverrides.period, [...o.dropTotals])))
      }
      const heating = objectOr(overrideAnswers[o.tenancy.id])
      const totals = objectOr(totalAnswers[o.tenancy.id])
      for (const x of o.ask.values()) {
        const cents = (x.kind === 'heating' ? heating : totals)[x.period.key]
        if (!isCents(cents)) continue
        if (x.kind === 'heating') {
          await tx.insert(heatingPrepaymentOverrides).values({ tenancyId: o.tenancy.id, plantId, period: x.period.key, cents, provisional: false, fromMonth: null, toMonth: null })
        } else {
          await tx.insert(prepaymentOverrides).values({ tenancyId: o.tenancy.id, period: x.period.key, amountCents: cents })
        }
      }
    }
  }
}
