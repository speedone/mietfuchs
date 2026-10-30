// Der Datenschritt zu 0077_quellrechnung (#455): Bestehende Teile einer aufgeteilten Rechnung bekommen ihre Quelle,
// und kein Betrag ändert sich.
//
// **Die Bestände entstehen, wie ein Vermieter sie aus 0.13.1 mitbringt**: die echte Kette bis 0076, dann rohe Zeilen,
// genau so, wie Speichern und Wechsel des Rhythmus in 0.13.1 sie schreiben (nachgestellt mit dem Code von 0.13.1, die
// Werte stehen unten wörtlich), dann der Rest der Kette mit dem echten Datenschritt. Rohe Zeilen und nicht die
// heutigen Routen, weil der Schritt eingefroren ist und seine Eingabe es auch sein muss: Spätere Fassungen des
// Aufteilens legen Teile anders an (Quelle gleich beim Speichern, eine Zeile je Zeitraum), und ein Test über sie
// prüfte dann einen Bestand, den es vor dem Schritt nie gab.
//
// Nur die Regression über einen Zufallsbestand baut über den heutigen Code (die Funktionen hinter den Routen) und
// nimmt danach jede Quelle wieder heraus: Sie fragt nicht nach dem Bestand von damals, sondern danach, ob der
// Schritt eine Zahl bewegt.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { connect, type Connection } from '../src/db/client.ts'
import { assignSources } from '../src/db/dataSteps/0077_quellrechnung.ts'
import { databaseFile } from '../src/db/open.ts'
import { readClosedSettlements, readStock, type Stock } from '../src/db/read.ts'
import { firstDifference, frozenDifference, type FrozenSettlement } from '../src/db/regression.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { closeSettlement, createEntity, createProperty, PeriodConflict, PeriodError, saveCostItemSplit } from '../src/db/repository.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { calendarYearPeriod, periodContaining, periodsBetween, rulesOf, startYearOf } from '../../shared/period.ts'
import type { CostItem, PeriodRules } from '../../shared/types.ts'
import { finishChain, migrateUpTo } from '../testing/migrateUpTo.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { besideServer, restore, startServer } from '../testing/api.ts'

const STEP = '0077_quellrechnung'
const P = 'objekt-1'
const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-quelle-'))

// ---------- Rohe Zeilen auf dem Stand 0076 ----------

// Die Spalten von cost_items zur Zeit von 0076, die die Fälle unten setzen; die übrigen schreibt 0.13.1 als NULL.
type RawCostItem = {
  id: string
  period: string
  category: string
  description: string
  amount_cents: number
  key: string
  property_id?: string
  vendor?: string
  invoice_file?: string
  service_from?: string
  service_to?: string
  tax_year?: number
  participants_limited?: 0 | 1
  operating_power?: 'deduction'
  operating_power_general_id?: string
}

const sqlValue = (v: string | number): string => (typeof v === 'number' ? String(v) : `'${v.split("'").join("''")}'`)

function insertCostItem(c: Connection, row: RawCostItem): void {
  // Wie costItemRow in 0.13.1: ohne Teilnehmer steht 0, nicht NULL.
  const full: RawCostItem = { property_id: P, participants_limited: 0, ...row }
  const entries = Object.entries(full).filter((e): e is [string, string | number] => e[1] !== undefined)
  c.exec(`INSERT INTO cost_items (${entries.map(([k]) => `"${k}"`).join(', ')}) VALUES (${entries.map(([, v]) => sqlValue(v)).join(', ')})`)
}

function insertUnits(c: Connection, propertyId = P, ids: readonly string[] = ['u1', 'u2']): void {
  for (const id of ids) {
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES (${sqlValue(id)}, ${sqlValue(propertyId)}, ${sqlValue(id)}, 50, 1)`)
  }
}

function insertParticipants(c: Connection, costItemId: string, unitIds: readonly string[]): void {
  for (const u of unitIds) c.exec(`INSERT INTO cost_item_participants (cost_item_id, unit_id) VALUES (${sqlValue(costItemId)}, ${sqlValue(u)})`)
}

function insertPeriodChanges(c: Connection, months: readonly string[], propertyId = P): void {
  for (const m of months) c.exec(`INSERT INTO period_changes (property_id, from_month) VALUES (${sqlValue(propertyId)}, ${sqlValue(m)})`)
}

type Outcome = { sources: string[][]; items: string[][]; amounts: string[][] }

// Die Quelle je Position, die Quellen und die Beträge, nach Kennung.
function outcome(c: Connection): Outcome {
  return {
    sources: c.rows('SELECT id, property_id, rule FROM cost_sources ORDER BY id').map((r) => r.map(String)),
    items: c.rows('SELECT id, source_id FROM cost_items ORDER BY id').map((r) => r.map((v) => (v === null ? '–' : String(v)))),
    amounts: c.rows('SELECT id, period, amount_cents, description, tax_year FROM cost_items ORDER BY id').map((r) => r.map(String)),
  }
}

// Baut den Bestand vor dem Schritt, holt den Rest der Kette nach und liefert, was danach dasteht.
async function afterStep(build: (c: Connection) => void): Promise<{ before: Outcome; after: Outcome }> {
  const dir = tempDir()
  try {
    const c = await migrateUpTo(dir, STEP)
    try {
      build(c)
      const before = { sources: [], items: [], amounts: c.rows('SELECT id, period, amount_cents, description, tax_year FROM cost_items ORDER BY id').map((r) => r.map(String)) }
      assert.equal(await finishChain(c), 1, 'nur der Schritt 0077 fehlte')
      return { before, after: outcome(c) }
    } finally {
      c.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Grundsteuer 365,00 € über 2025, wie sie in 0.13.1 nach den Schritten aus #455 dasteht.
const grundsteuer = (id: string, period: string, amount: number, anteilig: string, taxYear?: number): RawCostItem => ({
  id, period, category: 'Grundsteuer', description: `Grundsteuer 2025 (anteilig ${anteilig})`, amount_cents: amount, key: 'area',
  service_from: '2025-01-01', service_to: '2025-12-31', ...(taxYear === undefined ? {} : { tax_year: taxYear }),
})

// ---------- Die Fälle ----------

test('Fall aus #455 nach Schritt 2: zwei Teile im selben Zeitraum, eine Quelle', async () => {
  // Kalenderobjekt; Wechsel 05/2025 teilte 36500 in 12000/24500, das Entfernen des Wechsels legte beide Teile
  // einzeln zurück in 2025-01.
  const { before, after } = await afterStep((c) => {
    insertUnits(c)
    insertCostItem(c, grundsteuer('gs', '2025-01', 12000, '01.01.–30.04.2025'))
    insertCostItem(c, grundsteuer('neu-1', '2025-01', 24500, '01.05.–31.12.2025'))
  })
  assert.deepEqual(after.sources, [['gs', P, 'days']])
  assert.deepEqual(after.items, [['gs', 'gs'], ['neu-1', 'gs']])
  assert.deepEqual(after.amounts, before.amounts, 'kein Betrag, keine Beschreibung, kein Jahr ändert sich')
})

test('Schritt 4: sechs Zeilen in drei Zeiträumen, eine Quelle', async () => {
  // Wechsel 03/2025 und 05/2025; so legt 0.13.1 die Rechnung nach Schritt 4 aus #455 ab (zwei Zeilen je Zeitraum).
  const { before, after } = await afterStep((c) => {
    insertUnits(c)
    insertPeriodChanges(c, ['2025-03', '2025-05'])
    insertCostItem(c, grundsteuer('gs', '2025-01', 1940, '01.01.–28.02.2025'))
    insertCostItem(c, grundsteuer('neu-1', '2025-01', 3960, '01.01.–28.02.2025'))
    insertCostItem(c, grundsteuer('neu-4', '2025-03', 2005, '01.03.–30.04.2025'))
    insertCostItem(c, grundsteuer('neu-5', '2025-03', 4095, '01.03.–30.04.2025'))
    insertCostItem(c, grundsteuer('neu-2', '2025-05', 8055, '01.05.–31.12.2025', 2025))
    insertCostItem(c, grundsteuer('neu-3', '2025-05', 16445, '01.05.–31.12.2025', 2025))
  })
  assert.deepEqual(after.sources, [['gs', P, 'days']])
  assert.deepEqual(after.items.map(([, s]) => s), ['gs', 'gs', 'gs', 'gs', 'gs', 'gs'])
  assert.deepEqual(after.amounts, before.amounts)
})

test('Verschiedene Teilnehmer im selben Zeitraum: keine Quelle', async () => {
  // Gleicher Schlüssel der Familie, aber zwei Rechnungen für verschiedene Häuser einer Abrechnungseinheit: Sie
  // zusammenzulegen könnte zwei verschiedene Rechnungen vereinen; heute behandelt der Wechsel sie einzeln.
  const { after } = await afterStep((c) => {
    insertUnits(c)
    insertCostItem(c, { ...grundsteuer('a', '2025-01', 12000, '01.01.–30.04.2025'), participants_limited: 1 })
    insertParticipants(c, 'a', ['u1'])
    insertCostItem(c, { ...grundsteuer('b', '2025-01', 24500, '01.05.–31.12.2025'), participants_limited: 1 })
    insertParticipants(c, 'b', ['u2'])
  })
  assert.deepEqual(after.sources, [])
  assert.deepEqual(after.items, [['a', '–'], ['b', '–']])
})

test('Gleiche Teilnehmer im selben Zeitraum: eine Quelle', async () => {
  const { after } = await afterStep((c) => {
    insertUnits(c)
    for (const [id, amount, anteilig] of [['b', 12000, '01.01.–30.04.2025'], ['a', 24500, '01.05.–31.12.2025']] as const) {
      insertCostItem(c, { ...grundsteuer(id, '2025-01', amount, anteilig), participants_limited: 1 })
      // Die Reihenfolge der Zeilen spielt keine Rolle.
      insertParticipants(c, id, id === 'a' ? ['u1', 'u2'] : ['u2', 'u1'])
    }
  })
  assert.deepEqual(after.sources, [['a', P, 'days']])
  assert.deepEqual(after.items, [['a', 'a'], ['b', 'a']])
})

test('Im selben Zeitraum verschieden in einer Angabe (Rechnungsdatum): keine Quelle', async () => {
  const { after } = await afterStep((c) => {
    insertUnits(c)
    insertCostItem(c, grundsteuer('a', '2025-01', 12000, '01.01.–30.04.2025'))
    insertCostItem(c, grundsteuer('b', '2025-01', 24500, '01.05.–31.12.2025'))
    c.exec("UPDATE cost_items SET paid_on = '2025-02-15' WHERE id = 'b'")
  })
  assert.deepEqual(after.sources, [])
})

test('Familie in verschiedenen Zeiträumen mit verschiedenen Teilnehmern: eine Quelle wie heute', async () => {
  // Liegen alle Teile in verschiedenen Zeiträumen, teilt der Wechsel sie bis 0.13.1 als Ganzes (`familyOf`), gleich
  // was sonst an ihnen steht. Die Quelle hält genau das fest.
  const { after } = await afterStep((c) => {
    insertUnits(c)
    insertPeriodChanges(c, ['2025-05'])
    insertCostItem(c, { ...grundsteuer('z', '2025-01', 12000, '01.01.–30.04.2025'), participants_limited: 1 })
    insertParticipants(c, 'z', ['u1'])
    insertCostItem(c, { ...grundsteuer('y', '2025-05', 24500, '01.05.–31.12.2025', 2025), participants_limited: 1 })
    insertParticipants(c, 'y', ['u2'])
  })
  assert.deepEqual(after.sources, [['y', P, 'days']])
  assert.deepEqual(after.items, [['y', 'y'], ['z', 'y']])
})

test('Ein Teil allein, Heizung, Einzelbeträge, Abzug: keine Quelle', async () => {
  const { after } = await afterStep((c) => {
    insertUnits(c)
    c.exec(`INSERT INTO properties (id, name, kind, address) VALUES ('objekt-2', 'Zweites', 'mfh', '')`)
    insertUnits(c, 'objekt-2', ['w1'])
    insertPeriodChanges(c, ['2025-05'])
    insertPeriodChanges(c, ['2025-05'], 'objekt-2')
    // Ein Teil allein; sein Gegenstück steht im anderen Objekt (gleiche Familie, anderes Objekt).
    insertCostItem(c, grundsteuer('allein', '2025-01', 12000, '01.01.–30.04.2025'))
    insertCostItem(c, { ...grundsteuer('fremd', '2025-05', 24500, '01.05.–31.12.2025', 2025), property_id: 'objekt-2' })
    // Heizkosten werden nie nach Tagen geteilt (VIII ZR 156/11).
    for (const [id, period, amount] of [['h1', '2025-01', 30000], ['h2', '2025-05', 60000]] as const) {
      insertCostItem(c, { id, period, category: 'Heizung und Warmwasser', description: 'Erdgas 2025', amount_cents: amount, key: 'area', service_from: '2025-01-01', service_to: '2025-12-31' })
    }
    // Einzelbeträge teilt Mietfuchs nicht nach Tagen (#454).
    for (const [id, period, amount] of [['e1', '2025-01', 3000], ['e2', '2025-05', 6000]] as const) {
      insertCostItem(c, { id, period, category: 'Wasser/Abwasser', description: 'Wasser 2025', amount_cents: amount, key: 'amounts', service_from: '2025-01-01', service_to: '2025-12-31' })
    }
    // Ein Abzug beim Betriebsstrom folgt seiner Stromrechnung.
    insertCostItem(c, { id: 'strom', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom 2025', amount_cents: 50000, key: 'area' })
    for (const [id, period, amount] of [['d1', '2025-01', -1000], ['d2', '2025-05', -2000]] as const) {
      insertCostItem(c, {
        id, period, category: 'Beleuchtung/Allgemeinstrom', description: 'Betriebsstrom Heizung', amount_cents: amount, key: 'area',
        service_from: '2025-01-01', service_to: '2025-12-31', operating_power: 'deduction', operating_power_general_id: 'strom',
      })
    }
    // Ohne Leistungszeitraum ist nichts ein Teil.
    insertCostItem(c, { id: 'm1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amount_cents: 1000, key: 'area' })
    insertCostItem(c, { id: 'm2', period: '2025-05', category: 'Müllabfuhr', description: 'Müll 2025', amount_cents: 2000, key: 'area' })
    // Ein Leistungszeitraum in einem einzigen Zeitraum macht keinen Teil.
    for (const id of ['g1', 'g2']) {
      insertCostItem(c, { id, period: '2025-05', category: 'Gartenpflege', description: 'Garten', amount_cents: 5000, key: 'area', service_from: '2025-06-01', service_to: '2025-09-30', tax_year: 2025 })
    }
  })
  assert.deepEqual(after.sources, [])
  assert.ok(after.items.every(([, s]) => s === '–'), JSON.stringify(after.items))
})

test('Zwei gleiche Rechnungen eines Kalenderobjekts ohne Zusatz „(anteilig …)“: keine Quelle', async () => {
  // Ihr Leistungszeitraum liegt in einem Zeitraum, und kein Aufteilen hat sie geschrieben. Wer ein Haus im Kalenderjahr
  // vermietet, merkt vom Schritt nichts, auch nicht am Hinweis auf doppelte Positionen.
  const { after } = await afterStep((c) => {
    insertUnits(c)
    for (const id of ['m1', 'm2']) {
      insertCostItem(c, { id, period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amount_cents: 18250, key: 'area', service_from: '2025-01-01', service_to: '2025-12-31' })
    }
  })
  assert.deepEqual(after.sources, [])
})

test('Ohne Position mit Leistungszeitraum bleibt der Schritt still', async () => {
  const { after } = await afterStep((c) => {
    insertUnits(c)
    insertCostItem(c, { id: 'm1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amount_cents: 1000, key: 'area' })
  })
  assert.deepEqual(after.sources, [])
})

// ---------- Der Schritt ändert keinen Betrag ----------

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TODAY = '2026-10-05'
const COLD = ['Grundsteuer', 'Müllabfuhr', 'Sach- und Haftpflichtversicherung', 'Gartenpflege', 'Hausreinigung'] as const
const SPANS: readonly (readonly [string, string] | null)[] = [
  ['2024-07-01', '2025-06-30'], ['2025-01-01', '2025-12-31'], ['2025-03-01', '2026-02-28'], ['2024-01-01', '2024-12-31'], ['2025-04-01', '2025-09-30'], null,
]
const RHYTHMS: readonly PeriodRules[] = [
  { startMonth: 1, changes: ['2025-05'] }, { startMonth: 1, changes: [] }, { startMonth: 1, changes: ['2025-03', '2025-05'] },
  { startMonth: 1, changes: ['2025-07'] }, { startMonth: 1, changes: ['2025-05', '2026-01'] },
]

// Ein Bestand über den heutigen Code: zwei Objekte, Rechnungen mit Leistungszeitraum über mehrere Wechsel (aufgeteilt
// beim Speichern und beim Wechsel), einige mit Teilnehmern, Heizkosten, ein abgeschlossener Zeitraum 2024.
async function randomStock(dataDir: string, seed: number): Promise<void> {
  const r = rng(seed)
  const pick = <X>(xs: readonly X[]): X => {
    const i = Math.floor(r() * xs.length)
    if (i >= xs.length) assert.fail('leere Auswahl')
    return xs[i] as X
  }
  let n = 0
  const ids = (): string => `id-${String(++n).padStart(4, '0')}`
  const opened = await openFreshDatabase(dataDir)
  try {
    const props = [P, 'objekt-2']
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites', kind: 'mfh' })
      for (const p of props) {
        for (const u of [1, 2, 3]) {
          const unit = `${p}-u${u}`
          await createEntity(db, 'units', unit, { propertyId: p, name: unit, areaM2: 30 + Math.floor(r() * 70), participates: true })
          await createEntity(db, 'tenancies', `${unit}-t`, {
            unitId: unit, tenantName: unit, persons: 1 + Math.floor(r() * 3), start: '2023-01-01',
            prepayments: [{ from: '2023-01', monthlyCents: 5000 + Math.floor(r() * 20000) }],
          })
        }
      }
    })
    const addItems = async (count: number): Promise<void> => {
      for (let k = 0; k < count; k++) {
        const p = pick(props)
        const category = r() < 0.15 ? 'Heizung und Warmwasser' : pick(COLD)
        const span = pick(SPANS)
        const participants = r() < 0.3 ? [`${p}-u1`, `${p}-u${2 + Math.floor(r() * 2)}`] : undefined
        const body = {
          category, description: `${category} ${k % 3}`, amountCents: 1000 + Math.floor(r() * 90000), key: pick(['area', 'units', 'persons'] as const),
          ...(span ? { serviceFrom: span[0], serviceTo: span[1], taxYear: Number(span[1].slice(0, 4)) } : {}),
          ...(participants ? { participantUnitIds: participants } : {}),
          ...(r() < 0.3 ? { vendor: 'Stadt' } : {}),
        }
        await opened.write(async (db) => {
          const rules = rulesOf(await propertyRules(db, p))
          const period = periodContaining(rules, span?.[0] ?? '2025-01-01').key
          try {
            if (category !== 'Heizung und Warmwasser' && span) {
              try {
                await saveCostItemSplit(db, p, body, null, ids)
                return
              } catch (err) {
                // Liegt die Rechnung in einem einzigen Zeitraum, speichert sie sich gewöhnlich.
                if (!(err instanceof PeriodError)) throw err
              }
            }
            await createEntity(db, 'costItems', ids(), { ...body, propertyId: p, period })
          } catch (err) {
            // Ein abgeschlossener Zeitraum oder eine Rückfrage lehnt ab, wie beim Vermieter; dann eben ohne sie.
            if (!(err instanceof PeriodError || err instanceof PeriodConflict)) throw err
          }
        })
      }
    }
    await addItems(14)
    // Ein abgeschlossener Zeitraum mit Teilen darin (die Rechnungen 2024/2025 stehen anteilig in 2024).
    await opened.write(async (db) => {
      const stock = await readStock(db)
      const period = calendarYearPeriod(2024)
      await closeSettlement(db, { id: 'abschluss-2024', propertyId: P, period: period.key, closedAt: '2025-03-01T00:00:00Z', sentAt: null, settlement: computeSettlement(snapshotFor(stock, P, period), { asOf: '2025-03-01' }) })
    })
    for (let round = 0; round < 4; round++) {
      for (const p of props) {
        const rules = pick(RHYTHMS)
        await opened.write(async (db) => {
          const current = rulesOf(await propertyRules(db, p))
          if (JSON.stringify(current) === JSON.stringify(rules)) return
          const v = await previewPeriodChange(db, p, rules, TODAY)
          if (!v || v.blocked.length > 0) return
          const answers = {
            understood: true, token: v.token,
            groups: Object.fromEntries(v.groups.map((g) => [g.id, g.suggested || (g.options[0]?.key ?? '')])),
            taxYears: Object.fromEntries(v.taxYears.map((t) => [t.key, t.suggested])),
          }
          await applyPeriodChange(db, p, rules, answers, ids, TODAY)
        })
      }
      await addItems(4)
    }
  } finally {
    opened.close()
  }
}

async function propertyRules(db: Parameters<typeof readStock>[0], id: string): Promise<{ periodRules?: PeriodRules } | null> {
  return (await readStock(db)).properties.find((p) => p.id === id) ?? null
}

// Alles, was der Vermieter an Zahlen sieht, je Objekt: jede Abrechnung und jeder Verbrauch der Zeiträume 2024 bis
// 2026, Mietkonto und Steuer der Kalenderjahre.
function everything(stock: Stock): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const property of stock.properties) {
    const rules = rulesOf(property)
    for (const period of periodsBetween(rules, '2024-01-01', '2026-12-31')) {
      const snapshot = snapshotFor(stock, property.id, period)
      result[`${property.id} Abrechnung ${period.key}`] = computeSettlement(snapshot, { asOf: TODAY })
      result[`${property.id} Verbrauch ${period.key}`] = consumptionOverview(snapshot)
    }
    for (const year of [2024, 2025, 2026]) {
      result[`${property.id} Mietkonto ${year}`] = rentLedger(snapshotFor(stock, property.id, calendarYearPeriod(year)), { asOf: TODAY })
      result[`${property.id} Steuer ${year}`] = taxReportFor(stock, property.id, year)
    }
  }
  return result
}

const frozenOf = async (c: Connection): Promise<FrozenSettlement[]> =>
  (await readClosedSettlements(c.db)).map((s) => ({ id: s.id, year: startYearOf(s.period), settlement: s.settlement }))
const withoutSource = (items: readonly CostItem[]): CostItem[] => items.map(({ sourceId: _, ...rest }) => rest)

test('Der Schritt ändert keinen Betrag', async () => {
  let sourced = 0
  let samePeriod = 0
  let unsourcedParts = 0
  for (const seed of [455, 4551, 4552]) {
    const dir = tempDir()
    try {
      await randomStock(dir, seed)
      const c = await connect(databaseFile(dir))
      try {
        // Der Bestand wie vor dem Schritt: ohne Quelle (der heutige Code legt noch keine an; später nimmt das hier sie
        // wieder heraus).
        c.exec('UPDATE cost_items SET source_id = NULL')
        c.exec('DELETE FROM cost_sources')
        const before = await readStock(c.db)
        const frozenBefore = await frozenOf(c)
        c.exec('BEGIN')
        assignSources(c)
        c.exec('COMMIT')
        const after = await readStock(c.db)
        const frozenAfter = await frozenOf(c)

        assert.deepEqual(withoutSource(after.costItems), withoutSource(before.costItems), 'nur der Verweis ändert sich')
        assert.equal(frozenDifference(frozenBefore, frozenAfter), null, 'der abgeschlossene Stand bleibt wortgleich')
        assert.ok(frozenBefore.length > 0, 'der Bestand hat einen abgeschlossenen Zeitraum')
        const vorher = everything(before)
        const nachher = everything(after)
        const difference = firstDifference(vorher, nachher)
        assert.equal(difference, null, `Startwert ${seed}: ${JSON.stringify(difference)}`)

        const bySource = new Map<string, CostItem[]>()
        for (const item of after.costItems) if (item.sourceId) bySource.set(item.sourceId, [...(bySource.get(item.sourceId) ?? []), item])
        sourced += bySource.size
        for (const parts of bySource.values()) if (new Set(parts.map((p) => p.period)).size < parts.length) samePeriod++
        unsourcedParts += after.costItems.filter((i) => !i.sourceId && /\(anteilig /.test(i.description)).length
      } finally {
        c.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  // Damit der Vergleich etwas prüft: Der Bestand hat Quellen, solche mit zwei Teilen im selben Zeitraum, und Teile, die
  // ohne Quelle bleiben.
  assert.ok(sourced > 0, 'keine Quelle entstanden')
  assert.ok(samePeriod > 0, 'keine Quelle mit zwei Teilen im selben Zeitraum')
  assert.ok(unsourcedParts > 0, 'kein Teil ohne Quelle')
})

// ---------- Backup aus 0.13.1 ----------

test('Backup aus 0.13.1 einspielen: danach tragen die Teile die Quelle', async () => {
  const dir = tempDir()
  const s = await startServer()
  try {
    // Ein Archiv, wie es /api/backup in 0.13.1 schreibt: der Schnappschuss der Datenbank über VACUUM INTO und die
    // Angabe, woher es stammt.
    const c = await migrateUpTo(dir, STEP)
    const snapshot = path.join(dir, 'schnappschuss.sqlite')
    try {
      insertUnits(c)
      insertCostItem(c, grundsteuer('gs', '2025-01', 12000, '01.01.–30.04.2025'))
      insertCostItem(c, grundsteuer('neu-1', '2025-01', 24500, '01.05.–31.12.2025'))
      c.exec(`VACUUM INTO ${sqlValue(snapshot)}`)
    } finally {
      c.close()
    }
    const zip = new AdmZip()
    zip.addFile('mietfuchs.sqlite', fs.readFileSync(snapshot))
    zip.addFile('mietfuchs-backup.json', Buffer.from(JSON.stringify({ app: 'mietfuchs', version: '0.13.1', createdAt: '2026-10-20T10:00:00.000Z' })))
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))

    const d = await besideServer(s.dataDir)
    try {
      assert.deepEqual(outcome(d).sources, [['gs', P, 'days']])
      assert.deepEqual(outcome(d).items, [['gs', 'gs'], ['neu-1', 'gs']])
    } finally {
      d.close()
    }
    const abrechnung = await s.api<{ totalCostsCents: number }>('/api/settlement/2025')
    assert.equal(abrechnung.totalCostsCents, 36500, 'die Rechnung zählt ganz, wie vorher')
  } finally {
    s.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
