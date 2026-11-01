// Der Generator der Zufallsabläufe für den Wechsel des Rhythmus nach Quelle (#455, Invariante 4;
// db-wechsel-quelle.test.ts). Ein Ablauf legt ein bis drei kalte Rechnungen mit Leistungszeitraum an (manche mit
// gleichem `splitFamilyKey` und anderen Teilnehmern, eine ohne Leistungszeitraum), teilt sie beim Speichern auf und
// wechselt dann zwei- bis fünfmal den Rhythmus, mit den Antworten aus der Vorschau; dazwischen wird manchmal der
// Betrag eines Teils berichtigt. Nach jedem Wechsel hält er je Zeitraum und Basisbeschreibung Betrag, Lohnanteil und
// Zahl der Zeilen fest, dazu je Basisbeschreibung die Summe je Jahr der Zahlung.
//
// Gerufen werden dieselben Funktionen, die die Routen rufen (`saveCostItemSplit`, `updateEntity`,
// `previewPeriodChange`, `applyPeriodChange`), in einem Prozess und mit fortlaufenden Kennungen: Über HTTP vergäbe
// der Server zufällige Kennungen, und die Ergebnisse ließen sich nicht mit einer eingefrorenen Datei vergleichen.
//
// **Jede Zufallsentscheidung hängt nur am Startwert und an Angaben, die vor und nach dem Umbau gleich sind**
// (Regeln, Zeiträume, Basisbeschreibung), nie an Kennungen oder der Zahl der Zeilen. Sonst liefen die Abläufe
// auseinander, sobald der Umbau zwei Zeilen zu einer zusammenfasst.
//
// `wholeThroughout`: Der Code vor dem Umbau behandelte in jedem Schritt jede Familie als Ganzes (`familyOf`: alle
// Mitglieder in verschiedenen Zeiträumen; dazu dieselben Teilnehmer, also eine Rechnung, und eine zusammenhängende
// Spanne der bewegten Teile, sonst nahm `wholeInvoice` den Weg je Teil). Nur dann ist je Zeitraum centgenau dasselbe
// zu erwarten; sonst rundet der Umbau anders, aber über alle Zeiträume ergibt jede Rechnung dieselbe Summe.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { applyPeriodChange, checkRules, previewPeriodChange } from '../src/db/periodChange.ts'
import { readCostItems, readProperties, readStock } from '../src/db/read.ts'
import { periodChanges, properties } from '../src/db/schema.ts'
import { taxReportFor } from '../src/calc.ts'
import type { Database } from '../src/db/client.ts'
import { createEntity, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { storedOutflowYear } from '../src/outflow.ts'
import { baseDescription } from '../src/serviceSplit.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodContaining, periodOfKey, periodsBetween, rulesOf } from '../../shared/period.ts'
import type { CostItem, PeriodKey, PeriodRules } from '../../shared/types.ts'
import { openFreshDatabase } from './freshDatabase.ts'
import { rngOf, type Rng } from './revertFlows.ts'

export const FLOW_SEED = 455
export const FLOW_COUNT = 200
const P = 'objekt-1'
const TODAY = '2026-10-05'

export type PeriodSums = Record<string, Record<string, { amountCents: number; labor35aCents: number; rows: number }>>
export type FlowStep = {
  rules: PeriodRules
  // Abgelehnt (Satz) oder gewechselt; abgelehnt bleibt der Bestand, wie er war.
  error: string | null
  periods: PeriodSums
  // je Basisbeschreibung, je Jahr der Zahlung
  taxYears: Record<string, Record<string, number>>
}
// `correctedCents` (nicht in der Datei von vor dem Umbau): Summe der Beträge, um die bis zu diesem Wechsel berichtigt
// wurde. Dann sind die Teile einer Rechnung nicht mehr nach Tagen verteilt, und wer sie einzeln statt als Ganzes neu
// teilt, legt die Berichtigung in andere Zeiträume; je Zeitraum höchstens um diese Summe.
// `correctedByBase` (#478, ebenfalls nicht in der Datei): dieselbe Summe je Basisbeschreibung.
export type Flow = { index: number; wholeThroughout: boolean; steps: (FlowStep & { correctedCents?: number; correctedByBase?: Record<string, number> })[] }

const pick = <T>(rng: Rng, list: readonly T[]): T => {
  const v = list[Math.floor(rng() * list.length)]
  if (v === undefined) throw new Error('leere Auswahl')
  return v
}
const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1))
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
// Ein fester Streuwert aus Text (FNV-1a), für Antworten, die nicht vom Verbrauch des Zufalls abhängen dürfen.
const hashOf = (text: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h
}

type Invoice = {
  category: string
  description: string
  amountCents: number
  labor35aCents?: number
  serviceFrom?: string
  serviceTo?: string
  participantUnitIds?: string[]
  paidOn?: string
  spreadYears?: number
}

const CATEGORIES = [
  { category: 'Grundsteuer', name: 'Grundsteuer' },
  { category: 'Sach- und Haftpflichtversicherung', name: 'Gebäudeversicherung' },
  { category: 'Gartenpflege', name: 'Gartenpflege', labor: true },
  { category: 'Straßenreinigung', name: 'Straßenreinigung' },
  { category: 'Schornsteinfeger', name: 'Schornsteinfeger', labor: true },
]

function invoicesOf(rng: Rng, index: number): Invoice[] {
  const count = int(rng, 1, 3)
  const list: Invoice[] = []
  for (let i = 0; i < count; i++) {
    const twinOf = list[list.length - 1]
    // Gleicher `splitFamilyKey`, andere Teilnehmer: eine zweite Rechnung, die die Heuristik von früher mit der ersten
    // verwechselte (#455).
    if (twinOf !== undefined && twinOf.serviceFrom !== undefined && rng() < 0.3) {
      const { participantUnitIds, labor35aCents, ...rest } = twinOf
      list.push({ ...rest, amountCents: int(rng, 1000, 90000), ...(participantUnitIds === undefined ? { participantUnitIds: ['u1', 'u2'] } : {}) })
      continue
    }
    const c = pick(rng, CATEGORIES)
    // Keine Gutschriften: Eine Gutschrift sperrt heute jeden Wechsel (`settleOperatingPowerLinks` hält sie für eine
    // Stromrechnung, aus der mehr abgezogen wird, als sie beträgt), und der Ablauf prüfte nichts mehr.
    const amountCents = int(rng, 1000, 200000)
    const inv: Invoice = { category: c.category, description: `${c.name} ${index}-${i}`, amountCents }
    if (c.labor && rng() < 0.6) inv.labor35aCents = int(rng, 0, Math.min(amountCents, 50000))
    if (rng() < 0.12) {
      // Ohne Leistungszeitraum (Laienprobe B2): wird beim Wechsel nach Tagen über den bisherigen Zeitraum geteilt.
      list.push(inv)
      continue
    }
    const from = addDays('2024-01-01', int(rng, 0, 900))
    inv.serviceFrom = from
    inv.serviceTo = addDays(from, int(rng, 30, 600))
    if (rng() < 0.15) inv.paidOn = addDays(from, int(rng, 0, 200))
    if (rng() < 0.2) inv.participantUnitIds = ['u2', 'u3']
    list.push(inv)
  }
  return list
}

// Neue Regeln, die gelten: ein anderer Beginn oder bis zu drei Wechsel zwischen 2024 und 2027.
function nextRules(rng: Rng, before: PeriodRules): PeriodRules {
  for (;;) {
    const startMonth = rng() < 0.75 ? before.startMonth : int(rng, 1, 12)
    const changes = new Set<string>()
    if (rng() < 0.5) for (const c of before.changes) changes.add(c)
    const extra = int(rng, 0, 3)
    for (let i = 0; i < extra; i++) changes.add(`${int(rng, 2024, 2027)}-${String(int(rng, 1, 12)).padStart(2, '0')}`)
    if (rng() < 0.3 && changes.size > 0) changes.delete(pick(rng, [...changes]))
    try {
      const rules = checkRules({ startMonth, changes: [...changes] })
      if (rules.startMonth !== before.startMonth || rules.changes.join() !== before.changes.join()) return rules
    } catch {
      // ein Wechsel auf einen Monat, in dem ohnehin ein Zeitraum beginnt: neu würfeln
    }
  }
}

function sumsOf(items: readonly CostItem[]): Pick<FlowStep, 'periods' | 'taxYears'> {
  const periods: PeriodSums = {}
  const taxYears: FlowStep['taxYears'] = {}
  for (const c of items) {
    const base = baseDescription(c.description)
    const p = (periods[c.period] ??= {})
    const s = (p[base] ??= { amountCents: 0, labor35aCents: 0, rows: 0 })
    s.amountCents += c.amountCents
    s.labor35aCents += c.labor35aCents ?? 0
    s.rows += 1
    const y = (taxYears[base] ??= {})
    const year = String(storedOutflowYear(c, items))
    y[year] = (y[year] ?? 0) + c.amountCents
  }
  return { periods, taxYears }
}

// Die Heuristik des Codes vor dem Umbau (`splitFamilyKey`, bis #455 in shared/splitPart.ts), eingefroren, denn sie
// beschreibt, was der Code damals als eine Rechnung sah; in der Anwendung gibt es sie nicht mehr.
const familyKeyBefore = (c: CostItem): string =>
  [c.category, baseDescription(c.description), c.serviceFrom, c.serviceTo, c.vendor ?? '', c.invoiceFile ?? '', c.key].join('\u0000')

// Ob der Code vor dem Umbau jede Familie dieses Wechsels als Ganzes teilte (siehe oben).
function treatedWhole(items: readonly CostItem[], before: PeriodRules, next: PeriodRules): boolean {
  const families = new Map<string, CostItem[]>()
  for (const c of items) {
    if (c.category === HEATING_CATEGORY || c.serviceFrom === undefined || c.serviceTo === undefined) continue
    families.set(familyKeyBefore(c), [...(families.get(familyKeyBefore(c)) ?? []), c])
  }
  const moving = (key: PeriodKey): { from: string; to: string } | null => {
    const old = periodOfKey(before, key)
    if (old === null) return null
    const now = periodOfKey(next, key)
    if (now !== null && now.from <= old.from && now.to >= old.to) return null
    return old
  }
  for (const f of families.values()) {
    if (f.length < 2) continue
    if (new Set(f.map((m) => m.period)).size !== f.length) return false
    if (new Set(f.map((m) => (m.participantUnitIds ?? []).join())).size > 1) return false
    const spans = f.flatMap((m) => {
      const old = moving(m.period)
      if (old === null || m.serviceFrom === undefined || m.serviceTo === undefined) return []
      return [{ from: m.serviceFrom > old.from ? m.serviceFrom : old.from, to: m.serviceTo < old.to ? m.serviceTo : old.to }]
    }).sort((a, b) => (a.from < b.from ? -1 : 1))
    for (let i = 1; i < spans.length; i++) if (addDays(spans[i - 1]?.to ?? '', 1) !== spans[i]?.from) return false
    if (spans.some((s) => s.from > s.to)) return false
  }
  return true
}

// `onStep` sieht nach jedem Wechsel die Positionen des Objekts (Prüfungen, die nicht in der Datei stehen).
// `rules` sind die Regeln danach (bei Ablehnung die bisherigen).
export type StepCheck = (items: readonly CostItem[], step: { index: number; step: number; rules: PeriodRules }) => void

export async function runFlow(index: number, onStep?: StepCheck): Promise<Flow> {
  const rng = rngOf(FLOW_SEED * 1000 + index)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-wechsel-quelle-'))
  const opened = await openFreshDatabase(dataDir)
  let n = 0
  const newId = (): string => `g${String(++n).padStart(5, '0')}`
  try {
    const invoices = invoicesOf(rng, index)
    await opened.write(async (db) => {
      for (const u of ['u1', 'u2', 'u3']) await createEntity(db, 'units', u, { propertyId: P, name: u, areaM2: 40 + u.length * 7, participates: true })
      for (const inv of invoices) {
        const property = (await readProperties(db)).find((p) => p.id === P)
        if (property === undefined) throw new Error('kein Objekt')
        const rules = rulesOf(property)
        const period = periodContaining(rules, inv.serviceFrom ?? '2025-03-01').key
        const body = { propertyId: P, period, key: 'area', ...inv, confirmPaidOn: true }
        if (inv.serviceFrom !== undefined && inv.serviceTo !== undefined && periodsBetween(rules, inv.serviceFrom, inv.serviceTo).length > 1) {
          await saveCostItemSplit(db, P, body, null, newId)
        } else {
          await createEntity(db, 'costItems', newId(), body)
        }
      }
    })
    let whole = true
    let correctedCents = 0
    const correctedByBase: Record<string, number> = {}
    const steps: Flow['steps'] = []
    const changes = int(rng, 2, 5)
    for (let step = 0; step < changes; step++) {
      // Manchmal ein berichtigter Betrag: gewählt nach Zeitraum und Basisbeschreibung, nicht nach Zeile.
      if (rng() < 0.3) {
        const u = rng()
        const delta = int(rng, 1, 5000)
        await opened.write(async (db) => {
          const items = (await readCostItems(db)).filter((c) => c.propertyId === P)
          const pairs = [...new Set(items.map((c) => `${c.period}\u0000${baseDescription(c.description)}`))].sort()
          const chosen = pairs[Math.floor(u * pairs.length)]
          const row = items.filter((c) => `${c.period}\u0000${baseDescription(c.description)}` === chosen).sort((a, b) => (a.id < b.id ? -1 : 1))[0]
          // Lehnt die Schreibprüfung ab (etwa ein Jahr der Zahlung, das ein früherer Wechsel stehen ließ), bleibt der
          // Betrag; der Ablauf geht weiter.
          if (row !== undefined && (await updateEntity(db, 'costItems', row.id, { amountCents: row.amountCents + Math.sign(row.amountCents || 1) * delta }).catch(() => null)) !== null) {
            correctedCents += delta
            const base = baseDescription(row.description)
            correctedByBase[base] = (correctedByBase[base] ?? 0) + delta
          }
        })
      }
      const result = await opened.write(async (db) => {
        const property = (await readProperties(db)).find((p) => p.id === P) ?? null
        if (property === null) throw new Error('kein Objekt')
        const before = rulesOf(property)
        const next = nextRules(rng, before)
        const items = (await readCostItems(db)).filter((c) => c.propertyId === P)
        if (!treatedWhole(items, before, next)) whole = false
        const preview = await previewPeriodChange(db, P, next, TODAY)
        if (preview === null) throw new Error('keine Vorschau')
        const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.suggested || (g.split !== null ? 'split' : g.options[0]?.key ?? '')]))
        const taxYears = Object.fromEntries(preview.taxYears.map((t) => {
          const h = hashOf(`${baseDescription(t.description)}|${t.period}|${step}`)
          return [t.key, h % 2 === 0 ? t.suggested : t.options[(h >>> 1) % t.options.length] ?? t.suggested]
        }))
        const r = await applyPeriodChange(db, P, next, { groups, overrides: {}, taxYears, token: preview.token, understood: true }, newId, TODAY)
        const error = r === null ? 'kein Objekt' : 'error' in r ? r.error : null
        return { next, error, rules: error === null ? next : before, items: (await readCostItems(db)).filter((c) => c.propertyId === P) }
      })
      onStep?.(result.items, { index, step, rules: result.rules })
      steps.push({ rules: result.next, error: result.error, ...sumsOf(result.items), ...(correctedCents > 0 ? { correctedCents, correctedByBase: { ...correctedByBase } } : {}) })
    }
    return { index, wholeThroughout: whole, steps }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

export async function runFlows(count = FLOW_COUNT, onStep?: StepCheck): Promise<Flow[]> {
  const flows: Flow[] = []
  for (let i = 0; i < count; i++) flows.push(await runFlow(i, onStep))
  return flows
}

// Hin und zurück (#478, Invarianten „Hin und zurück“ und „Ein angegebenes Jahr wandert nie“): Ein Bestand im Rhythmus A,
// in dem jede Rechnung ein Zahlungsdatum oder ein Jahr der Zahlung trägt (auch jeder Teil, wie ihn der Vermieter nach
// dem Aufteilen eintragen kann), wechselt nach B und zurück nach A, jedes Mal mit den Vorgaben der Vorschau. Festgehalten
// werden je Basisbeschreibung die Summe je wirksamem Steuerjahr nach jedem Schritt und die Werbungskosten der
// Steuerübersicht je Kalenderjahr vorher und nachher.
export const ROUND_TRIP_SEED = 478
export type RoundTrip = {
  index: number
  rules: [PeriodRules, PeriodRules]
  // Satz, wenn ein Wechsel abgelehnt wurde; dann fehlen die späteren Stände.
  refused: string | null
  years: FlowStep['taxYears'][]
  expenses: { before: Record<string, number>; after: Record<string, number> | null }
  // Mit `spread` (#262 PR 2, X9 e): je Steuerjahr die abziehbaren Werbungskosten, der verschobene Teil und die Zahl der
  // Zeilen mit einer Rate (Teile im Jahr des Abflusses und Anteile aus Vorjahren).
  deductions?: { before: Record<string, [number, number, number]>; after: Record<string, [number, number, number]> | null }
}
const TAX_YEARS = Array.from({ length: 10 }, (_, i) => 2022 + i)

async function expensesByYear(db: Database): Promise<Record<string, number>> {
  const stock = await readStock(db)
  return Object.fromEntries(TAX_YEARS.map((y) => [String(y), taxReportFor(stock, P, y).expenses.totalCents]))
}

async function deductionsByYear(db: Database): Promise<Record<string, [number, number, number]>> {
  const stock = await readStock(db)
  return Object.fromEntries(TAX_YEARS.map((y) => {
    const e = taxReportFor(stock, P, y).expenses
    return [String(y), [e.deductibleCents, e.deferredCents ?? 0, e.items.filter((i) => i.spread || i.spreadFrom).length]]
  }))
}

// Wechselt mit den Vorgaben der Vorschau, wie jemand, der nur „Speichern“ drückt; `null` heißt gewechselt.
async function changeWithDefaults(db: Database, next: PeriodRules, newId: () => string): Promise<string | null> {
  const preview = await previewPeriodChange(db, P, next, TODAY)
  if (preview === null) return 'keine Vorschau'
  const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.suggested || (g.split !== null ? 'split' : g.options[0]?.key ?? '')]))
  const r = await applyPeriodChange(db, P, next, { groups, overrides: {}, taxYears: {}, token: preview.token, understood: true }, newId, TODAY)
  return r === null ? 'kein Objekt' : 'error' in r ? r.error : null
}

// `spread` (#262 PR 2, X9 e): jede Rechnung als „Nicht umlagefähig“ mit einer Verteilung nach § 82b EStDV auf 2 bis 5
// Jahre (aus einem eigenen Zufall, damit der Ablauf sonst derselbe bleibt); verglichen werden dann zusätzlich je
// Steuerjahr die abziehbaren Werbungskosten und der verschobene Teil, also die Raten.
export async function runRoundTrip(index: number, options: { spread?: boolean } = {}): Promise<RoundTrip> {
  const rng = rngOf(ROUND_TRIP_SEED * 1000 + index)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-hin-zurueck-'))
  const opened = await openFreshDatabase(dataDir)
  let n = 0
  const newId = (): string => `r${String(++n).padStart(5, '0')}`
  try {
    const a = nextRules(rng, { startMonth: 1, changes: [] })
    const b = nextRules(rng, a)
    const spreadRng = rngOf(ROUND_TRIP_SEED * 1000 + index + 500_000)
    const invoices = invoicesOf(rng, index).map((inv): Invoice => {
      if (!options.spread) return inv
      const { labor35aCents: _, ...rest } = inv
      return { ...rest, category: 'Nicht umlagefähig', spreadYears: 2 + Math.floor(spreadRng() * 4) }
    })
    // Je Rechnung ein Jahr der Zahlung in der üblichen Spanne ihres Zeitraums, wo sie kein Datum hat.
    const years = invoices.map(() => rng())
    const before = await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: a.startMonth }).where(eq(properties.id, P))
      if (a.changes.length > 0) await db.insert(periodChanges).values(a.changes.map((fromMonth) => ({ propertyId: P, fromMonth })))
      for (const u of ['u1', 'u2', 'u3']) await createEntity(db, 'units', u, { propertyId: P, name: u, areaM2: 40 + u.length * 7, participates: true })
      for (const [i, inv] of invoices.entries()) {
        const period = periodContaining(a, inv.serviceFrom ?? '2025-03-01')
        const from = Number(period.from.slice(0, 4)) - 1
        const to = Number(period.to.slice(0, 4)) + 3
        const taxYear = inv.paidOn === undefined ? from + Math.floor((years[i] ?? 0) * (to - from + 1)) : undefined
        const body = { propertyId: P, period: period.key, key: 'area', ...inv, ...(taxYear === undefined ? {} : { taxYear }), confirmPaidOn: true, confirmTaxYear: true, ...(options.spread ? { confirmSpread: true } : {}) }
        const split = inv.serviceFrom !== undefined && inv.serviceTo !== undefined && periodsBetween(a, inv.serviceFrom, inv.serviceTo).length > 1
        // Eine aufgeteilte Rechnung lässt sich erst verteilen, wenn ihre Teile in einem Jahr abfließen (Integrationsdurchsicht
        // 0.14, S1): ohne Datum also erst nach dem Jahr der Zahlung an jedem Teil, unten.
        const { spreadYears: chosen, ...unspread } = body
        const written = split
          ? (await saveCostItemSplit(db, P, inv.paidOn === undefined ? unspread : body, null, newId)).map((c) => c.id)
          : [(await createEntity(db, 'costItems', newId(), body)).id]
        // Ein Teil in einem Kalenderzeitraum bekommt beim Aufteilen kein Jahr; der Vermieter trägt es nach. Manchmal hat
        // jeder Teil sein eigenes Jahr (zwei Abschläge, in verschiedenen Jahren bezahlt).
        if (taxYear !== undefined) {
          // Mit Verteilung ein gemeinsames Jahr (S1); der Zufall läuft gleich weiter.
          const own = written.length > 1 && rng() < 0.4 && !options.spread
          for (const c of (await readCostItems(db)).filter((x) => written.includes(x.id) && (own || x.taxYear === undefined))) {
            const p = periodOfKey(a, c.period)
            const lo = p === null ? from : Number(p.from.slice(0, 4)) - 1
            const hi = p === null ? to : Number(p.to.slice(0, 4)) + 3
            await updateEntity(db, 'costItems', c.id, { taxYear: own ? lo + Math.floor(rng() * (hi - lo + 1)) : taxYear, confirmTaxYear: true, ...(options.spread ? { confirmSpread: true } : {}) })
          }
        }
        // Die Wahl an einem Teil gilt für alle (E-11, `syncSourceSpread`).
        const [firstPart] = written
        if (split && inv.paidOn === undefined && chosen !== undefined && firstPart !== undefined) {
          await updateEntity(db, 'costItems', firstPart, { spreadYears: chosen, confirmSpread: true })
        }
      }
      return { years: sumsOf((await readCostItems(db)).filter((c) => c.propertyId === P)).taxYears, expenses: await expensesByYear(db), deductions: options.spread ? await deductionsByYear(db) : null }
    })
    const trip: RoundTrip = {
      index, rules: [a, b], refused: null, years: [before.years], expenses: { before: before.expenses, after: null },
      ...(before.deductions ? { deductions: { before: before.deductions, after: null } } : {}),
    }
    for (const next of [b, a]) {
      const step = await opened.write(async (db) => {
        const refused = await changeWithDefaults(db, next, newId)
        return { refused, years: sumsOf((await readCostItems(db)).filter((c) => c.propertyId === P)).taxYears, expenses: await expensesByYear(db), deductions: options.spread ? await deductionsByYear(db) : null }
      })
      if (step.refused !== null) return { ...trip, refused: step.refused }
      trip.years.push(step.years)
      trip.expenses.after = step.expenses
      if (trip.deductions && step.deductions) trip.deductions.after = step.deductions
    }
    return trip
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
