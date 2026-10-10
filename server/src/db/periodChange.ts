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
import { plantRules, settledSeparately } from '../../../shared/heatingPeriod.ts'
import {
  formatDayRange, parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, settlementDeadline, spansTwoYears, startYearOf,
} from '../../../shared/period.ts'
import { dayAfter } from '../../../shared/law/register.ts'
import type { BillingPeriod, CostItem, PeriodChangePreview, PeriodEffect, PeriodKey, PeriodRules, Property, Tenancy } from '../../../shared/types.ts'
import { baseDescription, splitByService, type ServicePart } from '../serviceSplit.ts'
import type { Database, Transaction } from './client.ts'
import { readClosedSettlements, readCostItems, readHeatingPlants, readProperties, readStock, readTenancies, readUnits } from './read.ts'
import { dryRun, earliestTenancyStart, lostClaims, outcomeOf } from './dryRun.ts'
import { HeatingError, PeriodConflict, PeriodError, rewriteCostItemFamily, settleOperatingPowerLinks, writeCostItemParts } from './repository.ts'
import { assessmentLines, assessments, closedSettlementHistory, periodChanges, prepaymentOverrides, properties } from './schema.ts'
import { euro } from '../../../shared/costItem.ts'

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

type Group = { from: PeriodKey; old: BillingPeriod; heating: boolean; items: CostItem[]; options: BillingPeriod[]; split: Map<string, ServicePart[]> | null }

// Das Jahr der Zahlung, das eine Position heute für die Steuer hat (Entwurf 3.10): das gespeicherte,
// sonst das Kalenderjahr ihres Zeitraums.
const effectiveTaxYear = (item: Pick<CostItem, 'taxYear' | 'period'>): number => item.taxYear ?? startYearOf(item.period)

type OverrideAsk = { tenancy: Tenancy; drop: Set<PeriodKey>; from: { key: PeriodKey; label: string; cents: number }[]; ask: Map<PeriodKey, { period: BillingPeriod; months: string[] }> }

type Plan = {
  preview: PeriodChangePreview
  // `family`: die bisherigen Teile einer aufgeteilten Rechnung, die als Ganzes neu geteilt wird.
  splits: { item: CostItem; parts: ServicePart[]; family?: CostItem[] }[]
  // Je Gruppe (Laienprobe B2): kalte Kosten und Heizkosten eines bisherigen Zeitraums getrennt, die
  // kalten mit den Teilen, in die sie nach Tagen aufgeteilt würden.
  groups: Map<string, Group>
  overrideRekeys: { tenancyId: string; from: PeriodKey; to: PeriodKey }[]
  overrideAsks: OverrideAsk[]
  assessmentMoves: { id: string; to: PeriodKey }[]
  // Positionen eines Zeitraums, der nur wächst und danach über zwei Kalenderjahre reicht (M4).
  regrows: { item: CostItem; target: BillingPeriod }[]
  taxEntries: Map<string, PeriodChangePreview['taxYears'][number]>
  next: PeriodRules
  before: PeriodRules
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
  // Heizung PR 5: Heizpositionen einer Anlage mit eigener Heizperiode tragen deren Schlüssel und
  // bleiben beim Wechsel des Objektzeitraums, wo sie sind; in welcher Abrechnung ihre Heizperiode
  // steht, ergibt sich danach von selbst (Entwurf 3.0).
  const plants = (await readHeatingPlants(db)).filter((p) => p.propertyId === propertyId)
  const ownPlantIds = new Set(plants.filter((p) => p.periodStartMonth !== null).map((p) => p.id))
  const closed = (await readClosedSettlements(db)).filter((c) => c.propertyId === propertyId)
  const history = await db.select({ period: closedSettlementHistory.period }).from(closedSettlementHistory).where(eq(closedSettlementHistory.propertyId, propertyId))
  const assessmentRows = await db.select({ id: assessments.id, file: assessments.file, period: assessments.requestedPeriod }).from(assessments).where(eq(assessments.propertyId, propertyId))
  // Positionen mit gebuchten Belegzeilen (Review der Laienprobe, Runde 1): Ihr Betrag ist die Summe
  // der Zeilen (Summenregel der Belegbuchung); geteilt stünde ein Teil gegen die ganze Summe.
  const bookedIds = new Set((await db.select({ id: assessmentLines.costItemId }).from(assessmentLines)).flatMap((r) => (r.id === null ? [] : [r.id])))

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
  // Heizung PR 5: Ob eine Heizperiode getrennt abgerechnet wird, hängt auch am Objektzeitraum (bei
  // H = P gibt es eine Gesamtabrechnung, Entwurf 3.1). Ein Wechsel, der das für eine Heizperiode
  // umschaltet, ginge an der Vorschau der Heizung vorbei, die die Vorauszahlungen aufteilt.
  for (const plant of plants) {
    const first = plant.separateSpans[0]
    if (plant.periodStartMonth === null || first === undefined) continue
    const rules = plantRules(plant, before)
    for (const h of periodsBetween(rules, `${first.from}-01`, `${Number(today.slice(0, 4)) + 2}-12-31`)) {
      const vorher = settledSeparately(plant, before, h)
      if (vorher === settledSeparately(plant, next, h)) continue
      blocked.add(
        `Die Heizkosten ${periodLabel(h)}${plant.name ? ` der Heizanlage „${plant.name}“` : ''} würden nach dem Wechsel ${vorher ? 'nicht mehr getrennt' : 'getrennt'} abgerechnet. ` +
          'Stellen Sie zuerst unter Stammdaten → Heizung den Zeitraum der Heizung oder die getrennte Heizkostenabrechnung um; dort zeigt eine Vorschau, was mit den Vorauszahlungen geschieht.',
      )
      break
    }
  }

  const splits: Plan['splits'] = []
  const groups: Plan['groups'] = new Map()
  const regrows: Plan['regrows'] = []
  // Die Teile einer aufgeteilten Rechnung (Nachprüfung von #226, 2): gleiche Kostenart, Beschreibung
  // ohne den Zusatz „(anteilig …)“, Leistungszeitraum, Rechnungssteller, Beleg und Schlüssel, je in
  // einem anderen Zeitraum. Sie werden beim Wechsel als Ganzes neu geteilt; jeden Teil einzeln zu
  // teilen, summierte die Rundungen, und nach einigen Wechseln stand ein Cent im falschen Zeitraum.
  const familyKey = (c: CostItem): string =>
    [c.category, baseDescription(c.description), c.serviceFrom, c.serviceTo, c.vendor ?? '', c.invoiceFile ?? '', c.key].join('\u0000')
  const families = new Map<string, CostItem[]>()
  for (const c of items) {
    if (c.category === HEATING_CATEGORY || c.serviceFrom === undefined || c.serviceTo === undefined) continue
    families.set(familyKey(c), [...(families.get(familyKey(c)) ?? []), c])
  }
  const familyOf = (c: CostItem): CostItem[] => {
    const f = families.get(familyKey(c)) ?? [c]
    return new Set(f.map((m) => m.period)).size === f.length ? f : [c]
  }
  // Die Teile, die der Wechsel betrifft, als eine Rechnung über die Tage, die sie im bisherigen Zeitraum
  // abdecken. Bleibt ein Teil in einem Zeitraum, der sich nicht ändert, steht er fest, und nur der
  // Rest wird geteilt. `null`: keine Rechnung aus mehreren Teilen, oder die betroffenen Teile decken
  // keine zusammenhängende Spanne ab; dann gilt die Regel für einen einzelnen Teil darunter.
  const wholeInvoice = (item: CostItem, family: CostItem[]): { family: CostItem[]; parts: ServicePart[] | null } | null => {
    if (family.length < 2 || item.serviceFrom === undefined || item.serviceTo === undefined) return null
    const moving = family.filter((m) => {
      const am = changed(m.period)
      return am !== null && am.status !== 'grows'
    }).sort((x, y) => (x.period < y.period ? -1 : 1))
    const spans: { from: string; to: string }[] = []
    for (const m of moving) {
      const old = changed(m.period)?.old
      if (!old) return null
      const from = (m.serviceFrom ?? '') > old.from ? m.serviceFrom ?? old.from : old.from
      const to = (m.serviceTo ?? '') < old.to ? m.serviceTo ?? old.to : old.to
      if (from > to) return null
      const last = spans[spans.length - 1]
      if (last !== undefined && dayAfter(last.to) !== from) return null
      spans.push({ from, to })
    }
    const first = spans[0]
    const last = spans[spans.length - 1]
    if (first === undefined || last === undefined) return { family: moving, parts: null }
    const lead = moving[0] ?? item
    const fixed = family.length > moving.length
    const total = moving.reduce((sum, c) => sum + c.amountCents, 0)
    const labor = moving.reduce((sum, c) => sum + (c.labor35aCents ?? 0), 0)
    const base = baseDescription(lead.description)
    const parts = splitByService(next, {
      id: [...family].map((c) => c.id).sort()[0] ?? lead.id, description: base, amountCents: total, labor35aCents: labor || undefined,
      serviceFrom: first.from, serviceTo: last.to,
    }).map((p) => (fixed && p.description === base ? { ...p, description: `${base} (anteilig ${formatDayRange(first.from, last.to)})` } : p))
    return { family: moving, parts }
  }
  const done = new Set<string>()
  for (const item of items) {
    if (item.heatingPlantId && ownPlantIds.has(item.heatingPlantId)) continue
    const a = changed(item.period)
    if (a === null) continue
    // Ein Zeitraum, der nur wächst, behält seine Positionen: Sie gehören weiter hinein. Reicht er
    // danach über zwei Kalenderjahre, braucht jede ihr Jahr der Zahlung (M4).
    if (a.status === 'grows') {
      if (a.now !== null && spansTwoYears(a.now)) regrows.push({ item, target: a.now })
      continue
    }
    if (item.category !== HEATING_CATEGORY && item.serviceFrom !== undefined && item.serviceTo !== undefined) {
      if (done.has(item.id)) continue
      const whole = wholeInvoice(item, familyOf(item))
      if (whole !== null) {
        for (const m of whole.family) done.add(m.id)
        if (whole.parts !== null) splits.push({ item: whole.family[0] ?? item, parts: whole.parts, family: whole.family })
        continue
      }
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
    // Laienprobe B2: Kalte Kosten ohne Leistungszeitraum standen im bisherigen Zeitraum und sind nach
    // dem Leistungsprinzip (Entwurf 3.4) dessen Kosten. Ganz in einen Rumpf gelegt, stünde dort die
    // Jahresrechnung gegen wenige Monate Vorauszahlung; deshalb wird das Aufteilen nach Tagen über den
    // bisherigen Zeitraum angeboten und vorbelegt. Heizkosten nie (VIII ZR 156/11, Entwurf 3.4).
    const heating = item.category === HEATING_CATEGORY
    const id = heating ? `${a.key}|heizung` : a.key
    const g = groups.get(id) ?? { from: a.key, old: a.old, heating, items: [], options: optionsFor(a), split: heating ? null : new Map<string, ServicePart[]>() }
    g.items.push(item)
    if (g.split !== null) {
      const parts = splitByService(next, { ...item, serviceFrom: a.old.from, serviceTo: a.old.to })
      if (parts.length > 1) g.split.set(item.id, parts)
      else g.split = null
    }
    groups.set(id, g)
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
    moves: splits.map(({ item, parts, family }) => ({
      costItemId: item.id, description: family ? baseDescription(item.description) : item.description,
      amountCents: (family ?? [item]).reduce((sum, c) => sum + c.amountCents, 0),
      parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })),
    })),
    groups: [...groups.entries()].map(([id, g]) => {
      const a = changed(g.from) ?? noFinding(g.from)
      const yearIn = (item: CostItem, p: BillingPeriod): number => (spansTwoYears(p) ? taxEntry(item, p).suggested : Number(p.from.slice(0, 4)))
      const { notes, taxShift: taxShiftBySplit } = g.split === null ? { notes: [], taxShift: false } : splitNotes(g, bookedIds, yearIn)
      const advisable = g.split !== null && notes.length === 0
      // Ganz verschoben: vorbelegt ist ein Zeitraum, in dem jede Position ihr Jahr der Zahlung behält,
      // sonst der mit der größten Überschneidung (Review der Laienprobe, Runde 1).
      const shiftOf = (p: BillingPeriod): number => g.items.reduce((sum, i) => sum + (yearIn(i, p) !== effectiveTaxYear(i) ? i.amountCents : 0), 0)
      const keeping = g.options.filter((p) => shiftOf(p) === 0)
      // Verschöbe das Teilen das Jahr der Zahlung, gibt es keine Vorgabe: Ganz in einen Zeitraum
      // gelegt, verschöbe sich entweder ebenfalls das Steuerjahr oder die Abrechnung; entscheiden muss
      // der Vermieter, und die Vorschau nennt beides. Bei gebuchten Belegzeilen gilt ein Zeitraum, der
      // das Steuerjahr behält. Ohne Teilen (Heizkosten) wie bisher.
      const whole = g.split === null ? bestFor(a, g.options).key
        : taxShiftBySplit ? ''
          : keeping.length > 0 ? bestFor(a, keeping).key : ''
      return {
        id,
        from: g.from,
        fromLabel: periodLabel(a.old),
        heating: g.heating,
        items: g.items.map((i) => ({ costItemId: i.id, description: i.description, amountCents: i.amountCents })),
        options: g.options.map((p) => ({ key: p.key, label: periodLabel(p) })),
        split: g.split === null ? null : {
          range: formatDayRange(g.old.from, g.old.to),
          items: [...g.split.entries()].map(([costItemId, parts]) => ({ costItemId, parts: parts.map((p) => ({ period: p.period.key, label: periodLabel(p.period), amountCents: p.amountCents })) })),
          notes,
        },
        taxShifts: g.options.flatMap((p) => {
          const cents = shiftOf(p)
          if (cents === 0) return []
          // Je Position mit ihrem eigenen Jahr (Review Runde 2): Positionen einer Gruppe können verschiedene haben.
          const moved = g.items.filter((i) => yearIn(i, p) !== effectiveTaxYear(i))
            .map((i) => `„${i.description}“ ${euro(i.amountCents)} von ${effectiveTaxYear(i)} nach ${yearIn(i, p)}`)
          return [{ key: p.key, text: `Ganz nach ${periodLabel(p)} verschoben, wechselten für die Steuer ${moved.length === 1 ? 'das Jahr der Zahlung' : `zusammen ${euro(cents)} das Jahr der Zahlung`}: ${moved.join('; ')}, obwohl sich an der Zahlung nichts ändert.` }]
        }),
        suggested: advisable ? 'split' : whole,
      }
    }),
    effects: [],
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
  return { preview, splits, groups, overrideRekeys, overrideAsks: [...asks.values()], assessmentMoves, regrows, taxEntries, next, before }
}

// Warum das Aufteilen einer Gruppe nicht vorbelegt wird (Review der Laienprobe, Runde 1): Eine
// Position mit gebuchten Belegzeilen hätte danach Teile, deren Summe die Belegbuchung nicht kennt;
// und ein Teil, der in ein anderes Jahr der Zahlung fiele, verschöbe Werbungskosten zwischen zwei
// Steuererklärungen, ohne dass sich an der Zahlung etwas geändert hat. Wählbar bleibt es; die Sätze
// sagen dann, was es bewirkt, die Verschiebung in Euro.
function splitNotes(g: Group, bookedIds: ReadonlySet<string>, partYear: (item: CostItem, p: BillingPeriod) => number): { notes: string[]; taxShift: boolean } {
  const notes: string[] = []
  const booked = g.items.filter((i) => bookedIds.has(i.id))
  if (booked.length > 0) {
    notes.push(`${booked.map((i) => `„${i.description}“`).join(', ')} ${booked.length === 1 ? 'ist' : 'sind'} aus einem Beleg gebucht. Geteilt ließe sich ein Teil nicht mehr mit einer weiteren Zeile dieses Belegs verknüpfen; vorbelegt ist deshalb, die Rechnung ganz zu verschieben.`)
  }
  const shifts = new Map<string, number>()
  for (const item of g.items) {
    const was = effectiveTaxYear(item)
    for (const part of g.split?.get(item.id) ?? []) {
      const year = partYear(item, part.period)
      if (year !== was) shifts.set(`${was}→${year}`, (shifts.get(`${was}→${year}`) ?? 0) + part.amountCents)
    }
  }
  for (const [move, cents] of shifts) {
    const [from, to] = move.split('→')
    notes.push(`Geteilt kämen für die Steuer ${euro(cents)} aus dem Jahr der Zahlung ${from} nach ${to}, obwohl sich an der Zahlung nichts ändert. Wählen Sie das Teilen nur, wenn das stimmt, und prüfen Sie danach das Jahr der Zahlung der Teile.`)
  }
  return { notes, taxShift: shifts.size > 0 }
}

// Laienprobe B3, Review Runde 1: begründet, nicht absolut. § 556 Abs. 3 S. 3 BGB schließt die
// Nachforderung aus, „es sei denn, der Vermieter hat die verspätete Geltendmachung nicht zu
// vertreten“; wer den Zeitraum selbst rückwirkend umstellt, hat die Verspätung zu vertreten.
export function passedDeadlineText(labels: readonly string[], cause = 'den Zeitraum selbst umstellen'): string {
  return `Die Abrechnungsfrist für ${labels.join(', ')} ist schon abgelaufen. Weil Sie ${cause}, haben Sie die Verspätung zu vertreten; eine Nachzahlung aus diesem Zeitraum können Sie deshalb nicht mehr verlangen (§ 556 Abs. 3 Satz 3 BGB).`
}


// Eine Gruppe ohne betroffenen Zeitraum gibt es nicht; der Aufruf oben fragt nur bekannte.
function noFinding(key: PeriodKey): never {
  throw new Error(`Zeitraum ${key} ohne Befund in der Vorschau`)
}

export async function previewPeriodChange(db: Database, propertyId: string, rawRules: unknown, today: string): Promise<PeriodChangePreview | null> {
  const plan = await planPeriodChange(db, propertyId, rawRules, today)
  return plan === null ? null : withEffects(db, propertyId, plan, today)
}

// Laienprobe B3: Was der Wechsel mit Abrechnungen macht, die schon begonnen haben. Ein Wechsel mit
// Beginn in der Vergangenheit legt einen Rumpf an, dessen Frist (§ 556 Abs. 3 S. 2 BGB) schon
// abgelaufen sein kann; eine Nachforderung daraus ist dann ausgeschlossen (S. 3), auch wenn die
// bisherige Abrechnung über das ganze Jahr noch offen war. Die Vorschau nennt je solchem Zeitraum die
// Frist und, im Probelauf mit den Vorschlägen dieser Vorschau gerechnet, das Ergebnis je Mieter vorher
// und nachher. Ein abgeschlossener Zeitraum kommt hier nicht vor: Ihn ändert der Wechsel nie (blocked).
//
// Mit `given` (beim Speichern) wird mit den Antworten des Vermieters gerechnet, sonst mit den
// Vorschlägen; wo es keinen gibt, mit dem Aufteilen nach Tagen bzw. dem ersten Zeitraum.
async function withEffects(db: Database, propertyId: string, plan: Plan, today: string, given?: Answers): Promise<PeriodChangePreview> {
  const { before, next } = plan
  const touched = (p: BillingPeriod): boolean => {
    const old = periodOfKey(before, p.key)
    return old === null || old.from !== p.from || old.to !== p.to
  }
  const firstOld = periodsBetween(before, '2000-01-01', today).find((p) => {
    const now = periodOfKey(next, p.key)
    return now === null || now.from !== p.from || now.to !== p.to
  })
  if (firstOld === undefined) return plan.preview
  const stockBefore = await readStock(db)
  const moved = await earliestTenancyStart(db, propertyId)
  if (moved === null) return plan.preview
  const targets = periodsBetween(next, moved > firstOld.from ? moved : firstOld.from, today).filter((p) => p.from <= today && touched(p))
  if (targets.length === 0) return plan.preview
  const answers: Answers = given ?? {
    groups: Object.fromEntries(plan.preview.groups.map((g) => [g.id, g.suggested || (g.split !== null ? 'split' : g.options[0]?.key ?? '')])),
    overrides: Object.fromEntries(plan.overrideAsks.map((o) => [o.tenancy.id, Object.fromEntries([...o.ask.keys()].map((k) => [k, null]))])),
    taxYears: {},
    token: plan.preview.token,
  }
  const taxYearIn = (target: BillingPeriod, item: CostItem): number | null => {
    const entry = plan.taxEntries.get(taxKey(item, target))
    if (entry === undefined) return null
    const chosen = answers.taxYears[entry.key]
    return typeof chosen === 'number' && entry.options.includes(chosen) ? chosen : entry.suggested
  }
  const after = await dryRun(db, (tx) => writeChangeIn(tx, plan, answers, propertyId, next, () => crypto.randomUUID(), taxYearIn),
    (stock) => targets.map((p) => outcomeOf(stock, propertyId, p)))
  const effects = targets.map((p, i): PeriodEffect => {
    const deadline = settlementDeadline(p)
    const passed = deadline < today
    const old = periodOfKey(before, p.key)
    const beforeOutcome = old === null ? null : outcomeOf(stockBefore, propertyId, old)
    const now = after?.[i] ?? null
    const tenants = (now?.tenants ?? []).map((t) => ({
      tenantName: t.tenantName,
      beforeCents: beforeOutcome?.tenants.find((b) => b.tenancyId === t.tenancyId)?.balanceCents ?? null,
      afterCents: t.balanceCents,
    }))
    return {
      label: periodLabel(p),
      deadline,
      passed,
      replaces: periodsBetween(before, p.from, p.to).filter((o) => {
        const n = periodOfKey(next, o.key)
        return n === null || n.from !== o.from || n.to !== o.to
      }).map((o) => ({ label: periodLabel(o), deadline: settlementDeadline(o) })),
      tenants,
      lostClaimsCents: passed ? lostClaims(tenants, old !== null && settlementDeadline(old) < today) : 0,
    }
  })
  return { ...plan.preview, effects }
}

type Answers = { groups: Record<string, unknown>; overrides: Record<string, unknown>; taxYears: Record<string, unknown>; token: unknown; understood?: unknown }
const objectOr = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
const readAnswers = (raw: unknown): Answers => {
  const a = objectOr(raw)
  return { groups: objectOr(a.groups), overrides: objectOr(a.overrides), taxYears: objectOr(a.taxYears), token: a.token, understood: a.understood }
}
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Was an Antworten fehlt oder nicht passt, als Sätze für die Meldung. Ein Tab von vor der Laienprobe
// antwortet je bisherigem Zeitraum (`from`); seit kalte und Heizkosten getrennte Gruppen mit gleichem
// `from` haben, fehlt ihm die Antwort der Heizgruppe (`<from>|heizung`), und es gibt die 409 mit
// Satz. Absichtlich: Die Heizkosten still dem Zeitraum der kalten Gruppe zu folgen ließe, wäre die
// Warnung aus B2 umgangen.
function missingAnswers(plan: Plan, answers: Answers): string[] {
  const missing: string[] = []
  for (const [id, g] of plan.groups) {
    const chosen = answers.groups[id]
    if (!(chosen === 'split' && g.split !== null) && !g.options.some((p) => p.key === chosen)) {
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
  // Jede Antwort mit Vorschau trägt deren Fristen und Ergebnisse (Review der Laienprobe, Runde 1):
  // Sonst fehlte nach einer 409 die rote Zeile, und die Bestätigung ließe sich umgehen.
  if (plan.preview.blocked.length > 0) return { error: `${plan.preview.blocked.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, propertyId, plan, today) }
  const answers = readAnswers(rawAnswers)
  if (answers.token !== plan.preview.token) {
    return { error: 'Die Vorschau ist nicht mehr aktuell: Seit sie erstellt wurde, hat sich am Bestand etwas geändert. Bitte prüfen Sie die neue Vorschau; gespeichert wurde nichts.', preview: await withEffects(db, propertyId, plan, today) }
  }
  const missing = missingAnswers(plan, answers)
  if (missing.length > 0) return { error: `Für den Wechsel fehlen Angaben: ${missing.join(' ')} Gespeichert wurde nichts.`, preview: await withEffects(db, propertyId, plan, today) }
  // Laienprobe B3, Review Runde 1: Entsteht oder ändert sich eine Abrechnung mit abgelaufener Frist,
  // speichert der Server nur mit ausdrücklicher Bestätigung (`understood`), gerechnet mit den Antworten.
  const checked = await withEffects(db, propertyId, plan, today, answers)
  const passed = checked.effects.filter((e) => e.passed)
  if (passed.length > 0 && answers.understood !== true) {
    return { error: `${passedDeadlineText(passed.map((e) => e.label))} Bitte bestätigen Sie das in der Vorschau; gespeichert wurde nichts.`, preview: checked }
  }
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
    if (err instanceof PeriodError) return { error: `${err.message} Gespeichert wurde nichts.`, preview: checked }
    if (err instanceof PeriodConflict) return { error: err.message, preview: checked }
    // Nachprüfung von #252, G2-N-W1: auch eine Prüfung des Betriebsstroms ist hier ein Konflikt mit dem
    // Bestand, nie eine nackte 400.
    if (err instanceof HeatingError) return { error: `${err.message} Gespeichert wurde nichts.`, preview: checked }
    throw err
  }
  const property = (await readProperties(db)).find((p) => p.id === propertyId)
  return property ? { property } : null
}

async function writeChange(
  db: Database, plan: Plan, answers: Answers, propertyId: string, next: PeriodRules, newId: () => string,
  taxYearIn: (target: BillingPeriod, item: CostItem) => number | null,
): Promise<void> {
  await db.transaction(async (tx) => writeChangeIn(tx, plan, answers, propertyId, next, newId, taxYearIn))
}

async function writeChangeIn(
  tx: Transaction, plan: Plan, answers: Answers, propertyId: string, next: PeriodRules, newId: () => string,
  taxYearIn: (target: BillingPeriod, item: CostItem) => number | null,
): Promise<void> {
  // Positionen gehen durch dieselbe Verschmelzung und Schreibprüfung wie beim Speichern
  // (`writeCostItemParts`), auch die verschobenen: ein rohes Update umginge die Prüfung des Jahres
  // der Zahlung (Durchsicht von #226, I1).
  // Nachprüfung von #252, G2-N-W1: Stromrechnung und Abzüge wandern nacheinander; geprüft wird der Endstand
  // (`settleOperatingPowerLinks`), und dafür merkt sich der Wechsel die Teile jeder Position.
  const guard = { splitPart: true, periodChange: true }
  const written = new Map<string, { id: string; period: PeriodKey }[]>()
  const remember = (item: CostItem, periods: readonly PeriodKey[], ids: readonly string[]) =>
    written.set(item.id, ids.map((id, i) => ({ id, period: periods[i] ?? item.period })))
  const move = async (item: CostItem, target: BillingPeriod) =>
    remember(item, [target.key], await writeCostItemParts(tx, item, [{ period: target.key, amountCents: item.amountCents, labor35aCents: item.labor35aCents ?? null, description: item.description, taxYear: taxYearIn(target, item) }], newId, item.id, guard))
  {
    await tx.update(properties).set({ periodStartMonth: next.startMonth }).where(eq(properties.id, propertyId))
    await tx.delete(periodChanges).where(eq(periodChanges.propertyId, propertyId))
    if (next.changes.length > 0) await tx.insert(periodChanges).values(next.changes.map((fromMonth) => ({ propertyId, fromMonth })))
    for (const { item, parts, family } of plan.splits) {
      const writes = parts.map((p) => ({
        period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
      }))
      const ids = family ? await rewriteCostItemFamily(tx, family, writes, newId, guard) : await writeCostItemParts(tx, item, writes, newId, item.id, guard)
      remember(item, writes.map((w) => w.period), ids)
    }
    for (const [id, g] of plan.groups) {
      if (answers.groups[id] === 'split' && g.split !== null) {
        for (const item of g.items) {
          const parts = g.split.get(item.id) ?? []
          remember(item, parts.map((p) => p.period.key), await writeCostItemParts(tx, { ...item, serviceFrom: g.old.from, serviceTo: g.old.to }, parts.map((p) => ({
            period: p.period.key, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description, taxYear: taxYearIn(p.period, item),
          })), newId, item.id, guard))
        }
        continue
      }
      const target = g.options.find((p) => p.key === answers.groups[id]) ?? null
      if (target === null) continue
      for (const item of g.items) await move(item, target)
    }
    for (const { item, target } of plan.regrows) await move(item, target)
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
    await settleOperatingPowerLinks(tx, propertyId, written)
  }
}
