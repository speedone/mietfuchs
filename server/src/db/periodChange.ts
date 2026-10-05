// Wechsel des Abrechnungszeitraums mit Vorschau (#208, Entwurf 3.6).
//
// Ein Objekt rechnet nach seinen Regeln ab (Beginnmonat und Wechsel, shared/period.ts). Ändern
// sich die Regeln, ändern sich Zeiträume, an denen Daten hängen: Kostenpositionen,
// Jahreskorrekturen, Abschlüsse, gewählte Zeiträume von Belegauswertungen. Diese Datei rechnet,
// was mit jeder dieser Zeilen geschieht, zeigt es vorher (Vorschau) und schreibt es dann in einer
// Transaktion, und zwar nur mit den Antworten, die die Vorschau verlangt.
//
// **Abgeschlossene Zeiträume sind unantastbar.** Hätte eine abgeschlossene Abrechnung nach dem
// Wechsel einen anderen Zeitraum, wird nicht gewechselt (409); wer das will, öffnet sie wieder
// (#56). Ein früherer Abschluss im Verlauf sperrt nur, wenn es seinen Zeitraum gar nicht mehr gäbe.
//
// **Eine tatsächlich gezahlte Summe lässt sich nicht auf Monate verteilen** (N4). Hat ein
// Mietverhältnis eine Jahreskorrektur und nach dem Wechsel Monate in mehr als einem Zeitraum oder
// in einem anders geschnittenen, fragt die Vorschau je neuem Zeitraum „tatsächlich gezahlt …“ und
// rechnet nicht. Liegen seine Monate unverändert in einem Zeitraum, wandert die Korrektur dorthin.
// Ohne Antwort würden sonst im Rumpf 2.400 € statt 800 € angerechnet (Testfall G-A1).
//
// **Kalte Rechnungen mit Leistungszeitraum werden nach Tagen aufgeteilt** (Entwurf 3.4, dieselbe
// Regel wie beim Speichern, serviceSplit.ts). Ohne Leistungszeitraum und bei Heizkosten (die nie
// nach Tagen geteilt werden) ordnet der Vermieter je bisherigem Zeitraum zu.
//
// Gelesen wird vor der Transaktion (die Lesefunktionen aus read.ts nehmen die Verbindung); die
// Schlange in open.ts lässt zwischen Lesen und Schreiben keine andere Anfrage herein.

import { and, eq, inArray } from 'drizzle-orm'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import {
  parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, spansTwoYears, startYearOf,
} from '../../../shared/period.ts'
import type { BillingPeriod, CostItem, PeriodChangePreview, PeriodKey, PeriodRules, Property, Tenancy } from '../../../shared/types.ts'
import { splitByService, type ServicePart } from '../serviceSplit.ts'
import type { Database } from './client.ts'
import { readClosedSettlements, readCostItems, readProperties, readTenancies, readUnits } from './read.ts'
import { PeriodError, writeCostItemParts } from './repository.ts'
import { assessments, closedSettlementHistory, costItems, periodChanges, prepaymentOverrides, properties } from './schema.ts'

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthName = (key: string): string => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`

// Monate in Worten: „01–04/2025“, über den Jahreswechsel „05/2025–04/2026“, ein Monat „03/2025“.
export function monthsText(months: readonly string[]): string {
  const first = months[0]
  const last = months[months.length - 1]
  if (first === undefined || last === undefined) return ''
  const mm = (m: string) => m.slice(5, 7)
  const yy = (m: string) => m.slice(0, 4)
  if (first === last) return `${mm(first)}/${yy(first)}`
  return yy(first) === yy(last) ? `${mm(first)}–${mm(last)}/${yy(first)}` : `${mm(first)}/${yy(first)}–${mm(last)}/${yy(last)}`
}

// Die neuen Regeln aus dem Rumpf, geprüft. Ein Wechsel auf einen Monat, in dem ohnehin ein
// Zeitraum beginnt, ist keiner: Es entstünde kein Rumpf, und die Liste hätte einen toten Eintrag.
export function checkRules(raw: unknown): PeriodRules {
  if (raw === null || typeof raw !== 'object') throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const startMonth: unknown = Reflect.get(raw, 'startMonth')
  const changes: unknown = Reflect.get(raw, 'changes')
  if (typeof startMonth !== 'number' || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new PeriodError('Der Abrechnungszeitraum beginnt in einem Monat von Januar bis Dezember.')
  }
  if (!Array.isArray(changes)) throw new PeriodError('Bitte geben Sie den Rhythmus an: den Monat des Beginns und die Wechsel.')
  const keys: PeriodKey[] = []
  for (const c of changes) {
    const key = parsePeriodKey(c)
    if (key === null) throw new PeriodError(`„${String(c)}“ ist kein Monat (JJJJ-MM).`)
    if (!keys.includes(key)) keys.push(key)
  }
  keys.sort()
  const rules: PeriodRules = { startMonth, changes: [] }
  for (const key of keys) {
    if (periodContaining(rules, `${key}-01`).from === `${key}-01`) {
      throw new PeriodError(`Ab ${monthName(key)} beginnt ohnehin ein Abrechnungszeitraum; ein Wechsel dorthin ändert nichts.`)
    }
    rules.changes.push(key)
  }
  return rules
}

type Status = 'same' | 'grows' | 'shrinks' | 'gone'
type Affected = { key: PeriodKey; old: BillingPeriod; now: BillingPeriod | null; status: Status }

function affectedOf(before: PeriodRules, next: PeriodRules, key: PeriodKey): Affected | null {
  const old = periodOfKey(before, key)
  // Ein Schlüssel ohne Zeitraum ist verwaist; das Wiederherstellen lehnt ihn ab (orphanPeriodKeys).
  if (old === null) return null
  const now = periodOfKey(next, key)
  const status: Status = now === null ? 'gone'
    : now.from === old.from && now.to === old.to ? 'same'
      : now.from <= old.from && now.to >= old.to ? 'grows' : 'shrinks'
  return { key, old, now, status }
}

// Die Monate eines Zeitraums, in denen das Mietverhältnis am Monatsersten besteht: dieselbe Regel
// wie `computePrepaymentCents` in calc.ts.
const activeMonths = (t: Pick<Tenancy, 'start' | 'end'>, p: BillingPeriod): string[] =>
  periodMonths(p).filter((m) => t.start <= `${m}-01` && !(t.end !== null && t.end < `${m}-01`))

const MS_DAY = 86400000
const overlapDays = (a: BillingPeriod, b: BillingPeriod): number => {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from > to ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY) + 1
}

// Der neue Zeitraum für Daten eines bisherigen: derselbe Schlüssel, wenn es ihn noch gibt, sonst
// der mit der größten Überschneidung, bei Gleichstand der frühere.
function bestFor(a: Affected, options: readonly BillingPeriod[]): BillingPeriod {
  if (a.now !== null) return a.now
  let best = options[0] ?? a.old
  for (const p of options) if (overlapDays(p, a.old) > overlapDays(best, a.old)) best = p
  return best
}

type OverrideAsk = { tenancy: Tenancy; drop: Set<PeriodKey>; from: { key: PeriodKey; label: string; cents: number }[]; ask: Map<PeriodKey, { period: BillingPeriod; months: string[] }> }

type Plan = {
  preview: PeriodChangePreview
  splits: { item: CostItem; parts: ServicePart[] }[]
  groups: Map<PeriodKey, { items: CostItem[]; options: BillingPeriod[] }>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
  assessmentMoves: { id: string; to: PeriodKey }[]
  next: PeriodRules
}

async function planPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<Plan | null> {
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  if (!property) return null
  const next = checkRules(rawRules)
  const before = rulesOf(property)
  if (before.startMonth === next.startMonth && before.changes.join() === next.changes.join()) {
    throw new PeriodError('Es ändert sich nichts: Der Abrechnungszeitraum ist schon so eingestellt.')
  }
  const unitIds = new Set((await readUnits(db)).filter((u) => u.propertyId === propertyId).map((u) => u.id))
  const tenancies = (await readTenancies(db)).filter((t) => unitIds.has(t.unitId))
  const items = (await readCostItems(db)).filter((c) => c.propertyId === propertyId)
  const closed = (await readClosedSettlements(db)).filter((c) => c.propertyId === propertyId)
  const history = await db.select({ period: closedSettlementHistory.period }).from(closedSettlementHistory).where(eq(closedSettlementHistory.propertyId, propertyId))
  const assessmentRows = await db.select({ id: assessments.id, file: assessments.file, period: assessments.requestedPeriod }).from(assessments).where(eq(assessments.propertyId, propertyId))

  const memo = new Map<PeriodKey, Affected | null>()
  const changed = (key: PeriodKey): Affected | null => {
    if (!memo.has(key)) memo.set(key, affectedOf(before, next, key))
    const a = memo.get(key) ?? null
    return a !== null && a.status !== 'same' ? a : null
  }
  const optionsFor = (a: Affected): BillingPeriod[] => periodsBetween(next, a.old.from, a.old.to)

  const blocked = new Set<string>()
  for (const c of closed) {
    const a = changed(c.period)
    if (a) blocked.add(`Die Abrechnung ${periodLabel(a.old)} ist abgeschlossen; nach dem Wechsel hätte sie einen anderen Zeitraum. Öffnen Sie sie wieder, wenn Sie den Wechsel so wollen, oder wählen Sie einen späteren Beginn.`)
  }
  for (const h of history) {
    const a = changed(h.period)
    if (a?.status === 'gone') blocked.add(`Für ${periodLabel(a.old)} gibt es frühere Abschlüsse im Verlauf; diesen Zeitraum gäbe es nach dem Wechsel nicht mehr. Wählen Sie einen späteren Beginn.`)
  }

  const splits: Plan['splits'] = []
  const groups: Plan['groups'] = new Map()
  for (const item of items) {
    const a = changed(item.period)
    // Ein Zeitraum, der nur wächst, behält seine Positionen: Sie gehören weiter hinein.
    if (a === null || a.status === 'grows') continue
    if (item.category !== HEATING_CATEGORY && item.serviceFrom !== undefined && item.serviceTo !== undefined) {
      const parts = splitByService(next, { ...item, serviceFrom: item.serviceFrom, serviceTo: item.serviceTo })
      if (parts.length === 1 && parts[0]?.period.key === item.period) continue
      splits.push({ item, parts })
      continue
    }
    const g = groups.get(a.key) ?? { items: [], options: optionsFor(a) }
    g.items.push(item)
    groups.set(a.key, g)
  }

  const overrideRekeys: Plan['overrideRekeys'] = []
  const asks = new Map<string, OverrideAsk>()
  for (const t of tenancies) {
    for (const [schluessel, cents] of Object.entries(t.prepaymentOverrides)) {
      const key = parsePeriodKey(schluessel)
      const a = key === null ? null : changed(key)
      if (key === null || a === null) continue
      const oldMonths = activeMonths(t, a.old)
      const withMonths = optionsFor(a).map((p) => ({ period: p, months: activeMonths(t, p) })).filter((x) => x.months.length > 0)
      const only = withMonths.length === 1 ? withMonths[0] : undefined
      if (only && only.months.join() === oldMonths.join()) {
        if (only.period.key !== key) overrideRekeys.push({ tenancyId: t.id, from: key, to: only.period.key })
        continue
      }
      const entry: OverrideAsk = asks.get(t.id) ?? { tenancy: t, drop: new Set<PeriodKey>(), from: [], ask: new Map() }
      entry.drop.add(key)
      entry.from.push({ key, label: periodLabel(a.old), cents })
      for (const x of withMonths) entry.ask.set(x.period.key, x)
      asks.set(t.id, entry)
    }
  }

  const assessmentMoves: Plan['assessmentMoves'] = []
  const assessmentPreview: PeriodChangePreview['assessments'] = []
  for (const r of assessmentRows) {
    const a = r.period === null ? null : changed(r.period)
    if (a === null || a.status !== 'gone') continue
    const to = bestFor(a, optionsFor(a))
    assessmentMoves.push({ id: r.id, to: to.key })
    assessmentPreview.push({ assessmentId: r.id, file: r.file, from: a.key, to: to.key, toLabel: periodLabel(to) })
  }

  // Die Zeiträume im Umfeld des Wechsels, für die Liste der Vorschau.
  const years = [...[...memo.values()].flatMap((a) => (a ? [a.old.from] : [])), ...next.changes.map((c) => `${c}-01`), ...before.changes.map((c) => `${c}-01`), today].sort()
  const listFrom = `${Number((years[0] ?? today).slice(0, 4)) - 1}-01-01`
  const listTo = `${Number((years[years.length - 1] ?? today).slice(0, 4)) + 1}-12-31`
  const periods = periodsBetween(next, listFrom, listTo)
  const wasShort = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old !== null && old.short && old.from === p.from && old.to === p.to
  }

  const preview: PeriodChangePreview = {
    rules: next,
    periods: periods.map((p) => ({ key: p.key, label: periodLabel(p), short: p.short })),
    newShort: periods.filter((p) => p.short && !wasShort(p)).map((p) => ({ key: p.key, label: periodLabel(p) })),
    blocked: [...blocked],
    moves: splits.map(({ item, parts }) => ({
      costItemId: item.id, description: item.description, amountCents: item.amountCents,
      parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })),
    })),
    groups: [...groups.entries()].map(([from, g]) => {
      const a = changed(from) ?? noFinding(from)
      return {
        from,
        fromLabel: periodLabel(a.old),
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p) })),
        suggested: bestFor(a, g.options).key,
      }
    }),
    overrides: [...asks.values()].map((o) => ({
      tenancyId: o.tenancy.id,
      tenantName: o.tenancy.tenantName,
      from: o.from,
      ask: [...o.ask.values()].map((x) => ({ period: x.period.key, label: periodLabel(x.period), months: monthsText(x.months) })),
    })),
    assessments: assessmentPreview,
  }
  return { preview, splits, groups, overrideRekeys, overrideAsks: [...asks.values()], assessmentMoves, next }
}

// Eine Gruppe ohne betroffenen Zeitraum gibt es nicht; der Aufruf oben fragt nur bekannte.
function noFinding(key: PeriodKey): never {
  throw new Error(`Zeitraum ${key} ohne Befund in der Vorschau`)
}

export async function previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null> {
  return (await planPeriodChange(db, propertyId, rawRules, today))?.preview ?? null
}

type Answers = { groups: Record<string, unknown>; overrides: Record<string, unknown> }
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const readAnswers = (raw: unknown): Answers => {
  const a = objectOr(raw)
  return { groups: objectOr(a.groups), overrides: objectOr(a.overrides) }
}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Was an Antworten fehlt oder nicht passt, als Sätze für die Meldung.
function missingAnswers(plan: Plan, answers: Answers): string[] {
  const missing: string[] = []
  for (const [from, g] of plan.groups) {
    const chosen = answers.groups[from]
    if (!g.options.some((p) => p.key === chosen)) {
      missing.push(`Zeitraum für ${g.items.map((i) => `„${i.description}“`).join(', ')} wählen.`)
    }
  }
  for (const o of plan.overrideAsks) {
    const given = objectOr(answers.overrides[o.tenancy.id])
    for (const x of o.ask.values()) {
      const v = given[x.period.key]
      if (!Object.hasOwn(given, x.period.key) || !(v === null || isCents(v))) {
        missing.push(`${o.tenancy.tenantName}: tatsächlich gezahlt ${monthsText(x.months)} eintragen (oder „keine Korrektur“).`)
      }
    }
  }
  return missing
}

// Das Jahr der Zahlung einer Position im neuen Zeitraum (Entwurf 3.10): Reicht er über zwei
// Kalenderjahre, das bisherige oder das Kalenderjahr, in dem ihr bisheriger Zeitraum begann (dort
// war sie bisher für die Steuer gezählt); sonst keines.
const taxYearIn = (target: BillingPeriod | null, item: CostItem): number | null =>
  target !== null && spansTwoYears(target) ? item.taxYear ?? startYearOf(item.period) : null

export async function applyPeriodChange(
  db: Database, propertyId: string, rawRules: unknown, rawAnswers: unknown, newId: () => string, today: string,
): Promise<{ property: Property } | { error: string; preview: PeriodChangePreview } | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  if (plan === null) return null
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const answers = readAnswers(rawAnswers)
  const missing = missingAnswers(plan, answers)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const { next } = plan
  await db.transaction(async (tx) => {
    await tx.update(properties).set({ periodStartMonth: next.startMonth }).where(eq(properties.id, propertyId))
    await tx.delete(periodChanges).where(eq(periodChanges.propertyId, propertyId))
    if (next.changes.length > 0) await tx.insert(periodChanges).values(next.changes.map((fromMonth) => ({ propertyId, fromMonth })))
    for (const { item, parts } of plan.splits) {
      await writeCostItemParts(tx, item, parts.map((p) => ({
        period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
      })), newId, item.id)
    }
    for (const [from, g] of plan.groups) {
      const target = g.options.find((p) => p.key === answers.groups[from]) ?? null
      if (target === null) continue
      for (const item of g.items) {
        await tx.update(costItems).set({ period: target.key, taxYear: taxYearIn(target, item) }).where(eq(costItems.id, item.id))
      }
    }
    for (const r of plan.overrideRekeys) {
      await tx.update(prepaymentOverrides).set({ period: r.to }).where(and(eq(prepaymentOverrides.tenancyId, r.tenancyId), eq(prepaymentOverrides.period, r.from)))
    }
    for (const o of plan.overrideAsks) {
      await tx.delete(prepaymentOverrides).where(and(eq(prepaymentOverrides.tenancyId, o.tenancy.id), inArray(prepaymentOverrides.period, [...o.drop])))
      const given = objectOr(answers.overrides[o.tenancy.id])
      const rows = [...o.ask.keys()].flatMap((key) => {
        const cents = given[key]
        return isCents(cents) ? [{ tenancyId: o.tenancy.id, period: key, amountCents: cents }] : []
      })
      if (rows.length > 0) await tx.insert(prepaymentOverrides).values(rows)
    }
    for (const m of plan.assessmentMoves) await tx.update(assessments).set({ requestedPeriod: m.to }).where(eq(assessments.id, m.id))
  })
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  return property ? { property } : null
}
