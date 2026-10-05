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

import crypto from 'node:crypto'
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
import { assessments, closedSettlementHistory, periodChanges, prepaymentOverrides, properties } from './schema.ts'

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
  // Positionen eines Zeitraums, der nur wächst und danach über zwei Kalenderjahre reicht (M4).
  regrows: { item: CostItem; target: BillingPeriod }[]
  taxEntries: Map<string, PeriodChangePreview['taxYears'][number]>
  next: PeriodRules
}

// Das Jahr der Zahlung einer Position in einem Zeitraum über zwei Kalenderjahre (Entwurf 3.10,
// Durchsicht von #226, I1): erlaubt ist vom Jahr des Beginns bis ein Jahr nach dem Ende, dieselbe
// Spanne wie in repository.ts. Vorbelegt wird das bisherige Jahr, sonst das Kalenderjahr, in dem
// ihr bisheriger Zeitraum begann, und zwar in die Spanne geklemmt. Ohne Klemme verschwände eine
// Position, deren Jahr außerhalb liegt, aus jeder Steuerübersicht.
const taxKey = (item: Pick<CostItem, 'id'>, p: Pick<BillingPeriod, 'key'>): string => `${item.id}|${p.key}`
function taxEntry(item: CostItem, p: BillingPeriod): PeriodChangePreview['taxYears'][number] {
  const start = Number(p.from.slice(0, 4))
  const end = Number(p.to.slice(0, 4)) + 1
  const was = item.taxYear ?? startYearOf(item.period)
  return {
    key: taxKey(item, p), costItemId: item.id, description: item.description, period: p.key, label: periodLabel(p),
    suggested: Math.min(Math.max(was, start), end), options: Array.from({ length: end - start + 1 }, (_, i) => start + i),
  }
}

// Die Marke einer Vorschau (M2): alles, was der Wechsel schreibt oder fragt. Der Zeitraum der Liste
// hängt am heutigen Tag und gehört nicht dazu.
function tokenOf(p: Omit<PeriodChangePreview, 'token' | 'periods'>): string {
  return crypto.createHash('sha256').update(JSON.stringify([p.rules, p.newShort, p.blocked, p.moves, p.groups, p.overrides, p.assessments, p.taxYears])).digest('hex')
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
  const regrows: Plan['regrows'] = []
  for (const item of items) {
    const a = changed(item.period)
    if (a === null) continue
    // Ein Zeitraum, der nur wächst, behält seine Positionen: Sie gehören weiter hinein. Reicht er
    // danach über zwei Kalenderjahre, braucht jede ihr Jahr der Zahlung (M4).
    if (a.status === 'grows') {
      if (a.now !== null && spansTwoYears(a.now)) regrows.push({ item, target: a.now })
      continue
    }
    if (item.category !== HEATING_CATEGORY && item.serviceFrom !== undefined && item.serviceTo !== undefined) {
      // Geteilt wird der Teil des Leistungszeitraums, der im bisherigen Zeitraum liegt: Ein schon
      // aufgeteilter Teil trägt den ganzen Leistungszeitraum der Rechnung, sein Betrag ist aber nur
      // der Anteil seines Zeitraums. Über den ganzen geteilt, landete ein Teil davon ein zweites Mal
      // dort, wo schon der andere Teil steht. Liegt der Leistungszeitraum ganz außerhalb (erlaubt,
      // die Abrechnung warnt), wird er ganz geteilt.
      const from = item.serviceFrom > a.old.from ? item.serviceFrom : a.old.from
      const to = item.serviceTo < a.old.to ? item.serviceTo : a.old.to
      const own = from <= to ? { serviceFrom: from, serviceTo: to } : { serviceFrom: item.serviceFrom, serviceTo: item.serviceTo }
      const parts = splitByService(next, { ...item, ...own })
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
    taxYears: [],
    token: '',
  }
  const taxEntries: Plan['taxEntries'] = new Map()
  const ask = (item: CostItem, p: BillingPeriod) => { if (spansTwoYears(p)) taxEntries.set(taxKey(item, p), taxEntry(item, p)) }
  for (const { item, parts } of splits) for (const part of parts) ask(item, part.period)
  for (const g of groups.values()) for (const o of g.options) for (const item of g.items) ask(item, o)
  for (const { item, target } of regrows) ask(item, target)
  preview.taxYears = [...taxEntries.values()]
  preview.token = tokenOf(preview)
  return { preview, splits, groups, overrideRekeys, overrideAsks: [...asks.values()], assessmentMoves, regrows, taxEntries, next }
}

// Eine Gruppe ohne betroffenen Zeitraum gibt es nicht; der Aufruf oben fragt nur bekannte.
function noFinding(key: PeriodKey): never {
  throw new Error(`Zeitraum ${key} ohne Befund in der Vorschau`)
}

export async function previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null> {
  return (await planPeriodChange(db, propertyId, rawRules, today))?.preview ?? null
}

type Answers = { groups: Record<string, unknown>; overrides: Record<string, unknown>; taxYears: Record<string, unknown>; token: unknown }
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const readAnswers = (raw: unknown): Answers => {
  const a = objectOr(raw)
  return { groups: objectOr(a.groups), overrides: objectOr(a.overrides), taxYears: objectOr(a.taxYears), token: a.token }
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
  for (const [key, given] of Object.entries(answers.taxYears)) {
    const entry = plan.taxEntries.get(key)
    if (entry && !(typeof given === 'number' && entry.options.includes(given))) {
      missing.push(`„${entry.description}“: Das Jahr der Zahlung für ${entry.label} muss zwischen ${entry.options[0]} und ${entry.options[entry.options.length - 1]} liegen.`)
    }
  }
  return missing
}

export async function applyPeriodChange(
  db: Database, propertyId: string, rawRules: unknown, rawAnswers: unknown, newId: () => string, today: string,
): Promise<{ property: Property } | { error: string; preview: PeriodChangePreview } | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  if (plan === null) return null
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  const answers = readAnswers(rawAnswers)
  if (answers.token !== plan.preview.token) {
    return { error: 'Die Vorschau ist nicht mehr aktuell: Seit sie erstellt wurde, hat sich am Bestand etwas geändert. Bitte prüfen Sie die neue Vorschau; gespeichert wurde nichts.', preview: plan.preview }
  }
  const missing = missingAnswers(plan, answers)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: plan.preview }
  // Das Jahr der Zahlung im neuen Zeitraum: die Antwort, sonst der Vorschlag; in einem Zeitraum in
  // einem Kalenderjahr keines (Entwurf 3.10).
  const taxYearIn = (target: BillingPeriod, item: CostItem): number | null => {
    const entry = plan.taxEntries.get(taxKey(item, target))
    if (entry === undefined) return null
    const given = answers.taxYears[entry.key]
    return typeof given === 'number' && entry.options.includes(given) ? given : entry.suggested
  }
  const { next } = plan
  try {
    await writeChange(db, plan, answers, propertyId, next, newId, taxYearIn)
  } catch (err) {
    // Eine Schreibprüfung, die im Wechsel scheitert, ist ein Konflikt mit dem Bestand und keine
    // falsche Anfrage (I1): 409 mit der Vorschau, die Transaktion hat nichts geschrieben.
    if (err instanceof PeriodError) return { error: `${err.message} Gespeichert wurde nichts.`, preview: plan.preview }
    throw err
  }
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  return property ? { property } : null
}

async function writeChange(
  db: Database, plan: Plan, answers: Answers, propertyId: string, next: PeriodRules, newId: () => string,
  taxYearIn: (target: BillingPeriod, item: CostItem) => number | null,
): Promise<void> {
  // Positionen gehen durch dieselbe Verschmelzung und Schreibprüfung wie beim Speichern
  // (`writeCostItemParts`), auch die verschobenen: ein rohes Update umginge die Prüfung des Jahres
  // der Zahlung (Durchsicht von #226, I1).
  const move = (tx: Parameters<Parameters<Database['transaction']>[0]>[0], item: CostItem, target: BillingPeriod) =>
    writeCostItemParts(tx, item, [{ period: target.key, amountCents: item.amountCents, labor35aCents: item.labor35aCents ?? null, description: item.description, taxYear: taxYearIn(target, item) }], newId, item.id)
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
      for (const item of g.items) await move(tx, item, target)
    }
    for (const { item, target } of plan.regrows) await move(tx, item, target)
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
}
