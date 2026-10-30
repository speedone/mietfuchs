// Der Wechsel des Rhythmus nach Quelle (#455, Entwurf „Wechsel des Rhythmus“, Invarianten 2 bis 4): Die Familie sagt
// `sourceId`, stehende Teile bleiben, die bewegten werden als eine Rechnung neu geteilt, und ein Ergebnis kommt zum
// stehenden Teil seines Zeitraums, statt eine zweite Zeile anzulegen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { createEntity, listCollection, removeEntity, saveCostItemSplit, updateEntity } from '../src/db/repository.ts'
import { costItems, costSources } from '../src/db/schema.ts'
import { storedOutflowYear } from '../src/outflow.ts'
import { taxReportFor } from '../src/calc.ts'
import { readStock } from '../src/db/read.ts'
import { FLOW_COUNT, runFlows, type Flow, type FlowStep } from '../testing/periodChangeFlows.ts'
import type { CostItem, PeriodChangePreview, PeriodRules } from '../../shared/types.ts'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'period', 'quellrechnung-vorher.json')
const TODAY = '2026-10-05'
const P = 'objekt-1'
const MAI_AB_2025: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
const KALENDER: PeriodRules = { startMonth: 1, changes: [] }
let n = 0
const ids = () => `neu-${String(++n).padStart(4, '0')}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-wechsel-quelle-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => createEntity(db, 'units', 'u1', { propertyId: P, name: 'EG', areaM2: 60, participates: true }))
    await opened.write(async (db) => createEntity(db, 'units', 'u2', { propertyId: P, name: 'OG', areaM2: 40, participates: true }))
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const items = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const rows = async (opened: OpenedDatabase) => (await items(opened)).map((c) => [c.period, c.amountCents]).sort()
const sourceCount = async (opened: OpenedDatabase): Promise<number> => (await opened.read((db) => db.select().from(costSources))).length
const preview = async (opened: OpenedDatabase, rules: PeriodRules): Promise<PeriodChangePreview> =>
  (await opened.read((db) => previewPeriodChange(db, P, rules, TODAY))) ?? assert.fail('kein Objekt')

// Wechselt mit den Vorschlägen der Vorschau; `taxYears` und `groups` ergänzen oder ersetzen sie.
async function change(opened: OpenedDatabase, rules: PeriodRules, given: { groups?: Record<string, string>; taxYears?: Record<string, number> } = {}): Promise<PeriodChangePreview> {
  const v = await preview(opened, rules)
  const groups = { ...Object.fromEntries(v.groups.map((g) => [g.id, g.suggested || g.options[0]?.key || ''])), ...given.groups }
  const r = await opened.write((db) => applyPeriodChange(db, P, rules, { understood: true, groups, overrides: {}, taxYears: given.taxYears ?? {}, token: v.token }, ids, TODAY))
  if (r === null || 'error' in r) return assert.fail(r === null ? 'kein Objekt' : r.error)
  return v
}

const grundsteuer = { propertyId: P, period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 36500, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }

// Die Datei entstand mit dem Code vor dem Umbau (8ac85ec0, NKA_WRITE_GOLDEN=1) und wird nie neu geschrieben, um grün
// zu werden. Behandelte der Code von früher in jedem Schritt jede Rechnung als Ganzes (`wholeThroughout`), ist je
// Zeitraum centgenau dasselbe zu erwarten, auch je Jahr der Zahlung; nur die Zahl der Zeilen sinkt, wo zusammengefasst
// wird. Sonst teilte er Teile einzeln oder hielt zwei Rechnungen für eine: Dann ergibt jede Rechnung über alle
// Zeiträume dieselbe Summe, und je Zeitraum weicht sie höchstens um so viele Cent ab, wie er dort Zeilen hatte (je
// Zeile eine eigene Rundung).
test('Golden: je Zeitraum dieselben Summen wie vor dem Umbau', { timeout: 600000 }, async () => {
  const checks: string[] = []
  const flows = await runFlows(FLOW_COUNT, (all, at) => {
    const bySource = new Map<string, CostItem[]>()
    for (const c of all) if (c.sourceId !== undefined) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c])
    for (const [sourceId, parts] of bySource) {
      const where = `Ablauf ${at.index}, Wechsel ${at.step}, Quelle ${sourceId}`
      // Invariante 3: Eine Quelle mit einem einzigen Teil gibt es nach einem Wechsel nicht.
      if (parts.length < 2) checks.push(`${where}: nur ein Teil`)
      // Invariante 1: dasselbe Objekt, dieselbe Kostenart, derselbe Leistungszeitraum.
      if (new Set(parts.map((c) => [c.propertyId, c.category, c.serviceFrom, c.serviceTo].join('|'))).size > 1) checks.push(`${where}: Teile verschieden`)
      // Invariante 1: dasselbe Zahlungsdatum (oder keines) in jedem Teil.
      if (new Set(parts.map((c) => c.paidOn ?? '')).size > 1) checks.push(`${where}: verschiedene Zahlungsdaten`)
      // Invariante 2: kein zweiter Teil im selben Zeitraum mit demselben Jahr der Zahlung und Zahlungsdatum.
      const keys = parts.map((c) => `${c.period}|${c.paidOn ?? ''}|${storedOutflowYear(c)}`)
      if (new Set(keys).size < keys.length) checks.push(`${where}: zwei Teile im selben Zeitraum und Jahr`)
    }
  })
  if (process.env.NKA_WRITE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(flows)}\n`)
    return
  }
  assert.deepEqual(checks, [])
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Flow[]
  assert.equal(flows.length, golden.length)
  const totals = (step: FlowStep) => {
    const t: Record<string, { amountCents: number; labor35aCents: number }> = {}
    for (const byBase of Object.values(step.periods)) {
      for (const [base, s] of Object.entries(byBase)) {
        const x = (t[base] ??= { amountCents: 0, labor35aCents: 0 })
        x.amountCents += s.amountCents
        x.labor35aCents += s.labor35aCents
      }
    }
    return t
  }
  let whole = 0
  for (const [i, flow] of flows.entries()) {
    const was = golden[i] ?? assert.fail(`Ablauf ${i} fehlt in der Datei`)
    // `wholeThroughout` gilt aus der Datei: Der Generator fragt es am Bestand, und der hat nach dem Umbau weniger Zeilen.
    assert.equal(flow.steps.length, was.steps.length, `Ablauf ${i}`)
    if (was.wholeThroughout) whole++
    for (const [k, step] of flow.steps.entries()) {
      const before = was.steps[k] ?? assert.fail(`Ablauf ${i}, Wechsel ${k} fehlt`)
      const where = `Ablauf ${i}, Wechsel ${k}`
      assert.deepEqual([step.rules, step.error], [before.rules, before.error], where)
      assert.equal(before.correctedCents, undefined, 'die Datei von vor dem Umbau kennt keine Berichtigung')
      assert.deepEqual(Object.keys(step.periods).sort(), Object.keys(before.periods).sort(), `${where}: dieselben Zeiträume`)
      assert.deepEqual(totals(step), totals(before), `${where}: je Rechnung über alle Zeiträume dieselbe Summe`)
      for (const [period, byBase] of Object.entries(before.periods)) {
        for (const [base, s] of Object.entries(byBase)) {
          const now = step.periods[period]?.[base] ?? assert.fail(`${where}: ${base} fehlt in ${period}`)
          assert.ok(now.rows <= s.rows, `${where}: ${base} in ${period} hat mehr Zeilen als vorher (${now.rows} statt ${s.rows})`)
          // Nach einer Berichtigung legte der Weg je Teil sie in dessen Spanne, das Teilen als Ganzes verteilt sie über
          // alle bewegten Tage (wie `wholeInvoice` vorher bei einer erkannten Familie); je Zeitraum wandert dann
          // höchstens, was bis hierher berichtigt wurde, dazu je Zeile ein Cent Rundung.
          const tolerance = was.wholeThroughout ? 0 : s.rows + (step.correctedCents ?? 0)
          assert.ok(Math.abs(now.amountCents - s.amountCents) <= tolerance, `${where}: ${base} in ${period}: ${now.amountCents} statt ${s.amountCents}`)
          assert.ok(Math.abs(now.labor35aCents - s.labor35aCents) <= tolerance, `${where}: Lohnanteil ${base} in ${period}: ${now.labor35aCents} statt ${s.labor35aCents}`)
        }
      }
      if (was.wholeThroughout) assert.deepEqual(step.taxYears, before.taxYears, `${where}: je Jahr der Zahlung`)
      else {
        // Sonst kann eine Rechnung das Jahr anders auf ihre Teile legen, über alle Jahre bleibt ihre Summe.
        const overYears = (t: FlowStep['taxYears']) => Object.fromEntries(Object.entries(t).map(([base, y]) => [base, Object.values(y).reduce((a, b) => a + b, 0)]))
        assert.deepEqual(overYears(step.taxYears), overYears(before.taxYears), `${where}: je Rechnung über alle Jahre der Zahlung dieselbe Summe`)
      }
    }
  }
  assert.ok(whole >= 80, `genug Abläufe, die vorher als Ganzes geteilt wurden (${whole})`)
})

test('Fall aus #455: hin, zurück, wieder hin und zwei Wechsel ergeben je Zeitraum eine Zeile derselben Quelle', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, MAI_AB_2025)
    assert.deepEqual(await rows(opened), [['2025-01', 12000], ['2025-05', 24500]])
    const erste = new Set((await items(opened)).map((c) => c.sourceId))
    assert.equal(erste.size, 1)
    assert.ok(![...erste].includes(undefined), 'beide Teile tragen eine Quelle')

    // Wechsel entfernt: Der Teil aus 2025/2026 kommt zum stehenden Teil, eine Zeile, und die Quelle entfällt.
    const zurueck = await change(opened, KALENDER)
    assert.deepEqual(zurueck.moves.map((m) => m.parts.map((p) => [p.period, p.amountCents, p.mergedInto])), [[['2025-01', 24500, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)']]])
    assert.deepEqual(await rows(opened), [['2025-01', 36500]])
    const [ganz] = await items(opened)
    assert.equal(ganz?.sourceId, undefined)
    assert.equal(await sourceCount(opened), 0)
    // #471: Die Zeile trägt die ganze Rechnung; der Zusatz „(anteilig …)“ entfällt, und die Vorschau nennt es.
    assert.equal(ganz?.description, 'Grundsteuer 2025')
    assert.deepEqual(zurueck.moves.map((m) => m.renamedTo), ['Grundsteuer 2025'])

    await change(opened, MAI_AB_2025)
    assert.deepEqual(await rows(opened), [['2025-01', 12000], ['2025-05', 24500]])

    await change(opened, { startMonth: 1, changes: ['2025-03', '2025-05'] })
    assert.deepEqual(await rows(opened), [['2025-01', 5900], ['2025-03', 6100], ['2025-05', 24500]])
    const quellen = new Set((await items(opened)).map((c) => c.sourceId))
    assert.equal(quellen.size, 1, 'jede Zeile trägt dieselbe Quelle')
    assert.ok(![...quellen].includes(undefined))
    assert.equal(await sourceCount(opened), 1)
  })
})

test('Bestand mit zwei Teilen im selben Zeitraum (nach dem Datenschritt): Der nächste Wechsel fasst sie zusammen', async () => {
  await withDatabase(async (opened) => {
    // Der Stand nach Schritt 2 des Issues: zwei Zeilen derselben Rechnung im Kalenderjahr, mit Quelle aus Schritt 0077.
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'a', { ...grundsteuer, description: 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)', amountCents: 12000 })
      await createEntity(db, 'costItems', 'b', { ...grundsteuer, description: 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', amountCents: 24500 })
      await db.insert(costSources).values({ id: 'a', propertyId: P, rule: 'days' })
      await db.update(costItems).set({ sourceId: 'a' })
    })
    await change(opened, MAI_AB_2025)
    // Vorher teilte jeder Teil sich einzeln: vier Zeilen, je zwei im Zeitraum.
    assert.deepEqual(await rows(opened), [['2025-01', 12000], ['2025-05', 24500]])
    assert.deepEqual((await items(opened)).map((c) => c.sourceId), ['a', 'a'])
  })
})

// Erst „Mai ab 2025, Januar ab 2026“: 2025-05 ist Mai bis Dezember 2025, 2026-01 das Jahr 2026. Die Rechnung über
// 05/2025–04/2026 steht mit 24.500 (245 Tage) und 12.000 (120 Tage) darin. Dann nur noch „Mai ab 2025“: 2025-05 wächst
// auf 05/2025–04/2026 und bleibt stehen, der Teil aus 2026-01 kommt hinein. Vorbelegt sind die bisherigen Jahre, 2025
// und 2026; verschieden, also zwei Zeilen. Mit 2025 für beide eine.
async function zweiJahre(opened: OpenedDatabase): Promise<{ stehend: CostItem; bewegt: CostItem }> {
  await change(opened, { startMonth: 1, changes: ['2025-05', '2026-01'] })
  const teile = await opened.write((db) => saveCostItemSplit(db, P, { ...grundsteuer, period: '2025-05', serviceFrom: '2025-05-01', serviceTo: '2026-04-30' }, null, ids))
  const stehend = teile.find((c) => c.period === '2025-05') ?? assert.fail('kein Teil 2025-05')
  const bewegt = teile.find((c) => c.period === '2026-01') ?? assert.fail('kein Teil 2026-01')
  assert.deepEqual([stehend.amountCents, bewegt.amountCents], [24500, 12000])
  return { stehend, bewegt }
}

test('Zusammenfassen nur bei gleichem Jahr der Zahlung', async () => {
  await withDatabase(async (opened) => {
    const { stehend, bewegt } = await zweiJahre(opened)
    const v = await change(opened, MAI_AB_2025, { taxYears: { [`${stehend.id}|2025-05`]: 2025, [`${bewegt.id}|2025-05`]: 2026 } })
    assert.deepEqual(v.taxYears.map((t) => [t.costItemId, t.suggested]).sort(), [[bewegt.id, 2026], [stehend.id, 2025]].sort())
    assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => p.mergedInto)), [undefined], 'die Vorschau kündigt kein Zusammenfassen an')
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, storedOutflowYear(c)]).sort(), [['2025-05', 12000, 2026], ['2025-05', 24500, 2025]])
    assert.equal(new Set(nachher.map((c) => c.sourceId)).size, 1, 'beide bleiben Teile derselben Quelle')
  })
  await withDatabase(async (opened) => {
    const { stehend, bewegt } = await zweiJahre(opened)
    await change(opened, MAI_AB_2025, { taxYears: { [`${stehend.id}|2025-05`]: 2025, [`${bewegt.id}|2025-05`]: 2025 } })
    const nachher = await items(opened)
    // #471: Die Zeile trägt die ganze Rechnung, ohne den Zusatz „(anteilig …)“.
    assert.notEqual(stehend.description, 'Grundsteuer 2025', 'Vorbedingung: der stehende Teil trägt den Zusatz')
    assert.deepEqual(nachher.map((c) => [c.id, c.period, c.amountCents, c.taxYear, c.description]), [[stehend.id, '2025-05', 36500, 2025, 'Grundsteuer 2025']])
    assert.equal(nachher[0]?.sourceId, undefined)
    assert.equal(await sourceCount(opened), 0)
  })
})

test('Verschiedene Teilnehmer im selben Zeitraum werden nie zusammengefasst (zwei Quellen)', async () => {
  await withDatabase(async (opened) => {
    // Gleicher `splitFamilyKey`, aber zwei Rechnungen: eine für alle, eine nur für das OG.
    await opened.write(async (db) => {
      await createEntity(db, 'costItems', 'alle', grundsteuer)
      await createEntity(db, 'costItems', 'og', { ...grundsteuer, amountCents: 7300, participantUnitIds: ['u2'] })
    })
    await change(opened, MAI_AB_2025)
    const geteilt = await items(opened)
    assert.deepEqual(geteilt.map((c) => [c.period, c.amountCents]).sort(), [['2025-01', 12000], ['2025-01', 2400], ['2025-05', 24500], ['2025-05', 4900]])
    const quelleVon = (c: CostItem) => `${(c.participantUnitIds ?? []).join()}→${c.sourceId}`
    assert.equal(new Set(geteilt.map((c) => c.sourceId)).size, 2)
    assert.equal(new Set(geteilt.map(quelleVon)).size, 2, 'je Rechnung eine Quelle')
    await change(opened, KALENDER)
    const zurueck = await items(opened)
    assert.deepEqual(zurueck.map((c) => [c.period, c.amountCents, (c.participantUnitIds ?? []).join()]).sort(), [['2025-01', 36500, ''], ['2025-01', 7300, 'u2']])
    assert.equal(await sourceCount(opened), 0)
  })
})

test('Liegt der Leistungszeitraum nach dem Wechsel in einem Zeitraum, entfällt die Quelle', async () => {
  await withDatabase(async (opened) => {
    await change(opened, MAI_AB_2025)
    // Februar bis Juni 2025, 150 Tage: 89 im Rumpf, 61 danach.
    await opened.write((db) => saveCostItemSplit(db, P, { ...grundsteuer, description: 'Wasser', category: 'Wasser/Abwasser', amountCents: 15000, serviceFrom: '2025-02-01', serviceTo: '2025-06-30', taxYear: 2025 }, null, ids))
    assert.equal((await items(opened)).length, 2)
    // Beginn im Februar: beide bisherigen Zeiträume fallen weg, die Rechnung liegt ganz in 02/2025–01/2026.
    await change(opened, { startMonth: 2, changes: [] })
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.description, c.sourceId]), [['2025-02', 15000, 'Wasser', undefined]])
    assert.equal(await sourceCount(opened), 0)
  })
})

test('Laienprobe B2: eine Jahresrechnung ohne Leistungszeitraum, beim Wechsel nach Tagen geteilt, bekommt eine Quelle', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'mu', { propertyId: P, period: '2025-01', category: 'Müllabfuhr', description: 'Müll 2025', amountCents: 36500, key: 'area' }))
    await change(opened, MAI_AB_2025, { groups: { '2025-01': 'split' } })
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.serviceFrom, c.serviceTo]).sort(), [['2025-01', 12000, '2025-01-01', '2025-12-31'], ['2025-05', 24500, '2025-01-01', '2025-12-31']])
    assert.equal(new Set(nachher.map((c) => c.sourceId)).size, 1)
    assert.notEqual(nachher[0]?.sourceId, undefined)
    assert.equal(await sourceCount(opened), 1)
  })
})

test('Teil ohne Quelle: der bisherige Weg, danach eine Quelle', async () => {
  await withDatabase(async (opened) => {
    await change(opened, MAI_AB_2025)
    await opened.write((db) => saveCostItemSplit(db, P, { ...grundsteuer, taxYear: 2025 }, null, ids))
    // Ein alter Bestand, dessen Teile der Datenschritt keiner Quelle zuordnen konnte.
    await opened.write(async (db) => {
      await db.update(costItems).set({ sourceId: null })
      await db.delete(costSources)
    })
    await change(opened, { startMonth: 1, changes: ['2025-03', '2025-05'] })
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents]).sort(), [['2025-01', 5900], ['2025-03', 6100], ['2025-05', 24500]])
    const neu = nachher.filter((c) => c.period !== '2025-05')
    assert.equal(new Set(neu.map((c) => c.sourceId)).size, 1)
    assert.notEqual(neu[0]?.sourceId, undefined, 'die beiden neuen Teile sind eine Rechnung mit Quelle')
    assert.equal(nachher.find((c) => c.period === '2025-05')?.sourceId, undefined, 'der stehende Teil bleibt ohne')
    assert.equal(await sourceCount(opened), 1)
  })
})

test('Ein Teil mit Beleg, der ganz zum stehenden Teil kommt, gibt den Beleg an ihn weiter', async () => {
  await withDatabase(async (opened) => {
    await change(opened, MAI_AB_2025)
    const teile = await opened.write((db) => saveCostItemSplit(db, P, { ...grundsteuer, taxYear: 2025 }, null, ids))
    const zweiter = teile.find((c) => c.period === '2025-05') ?? assert.fail('kein Teil 2025-05')
    const erster = teile.find((c) => c.period === '2025-01') ?? assert.fail('kein Teil 2025-01')
    await opened.write(async (db) => {
      await db.update(costItems).set({ invoiceFile: 'gs.pdf' }).where(eq(costItems.id, zweiter.id))
    })
    await change(opened, KALENDER)
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.id, c.amountCents, c.invoiceFile]), [[erster.id, 36500, 'gs.pdf']])
  })
})

// Durchsicht von PR 2 zu #455, M1: Zusammengefasst wird nur, was danach gleich verteilt würde. Ist der stehende Teil
// einzeln berichtigt (anderer Schlüssel, andere Teilnehmer), verteilte er den hinzukommenden Anteil anders als die
// Rechnung, aus der er stammt; das verschöbe Geld zwischen Mietern, ohne dass jemand es gewählt hat (§ 556a BGB: die
// Verteilung folgt dem vereinbarten Schlüssel). Dann bleibt der Anteil eine eigene Zeile im selben Zeitraum.
for (const [was, korrektur] of [
  ['Schlüssel nach Personen', { key: 'persons' }],
  ['nur das EG beteiligt', { participantUnitIds: ['u1'] }],
] as const) {
  test(`M1: Stehender Teil einzeln berichtigt (${was}): kein Zusammenfassen, der Anteil bleibt nach Fläche`, async () => {
    await withDatabase(async (opened) => {
      await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
      await change(opened, MAI_AB_2025)
      const rumpf = (await items(opened)).find((c) => c.period === '2025-01') ?? assert.fail('kein Teil im Rumpf')
      await opened.write((db) => updateEntity(db, 'costItems', rumpf.id, korrektur))
      const v = await change(opened, KALENDER)
      assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => p.mergedInto)), [undefined], 'die Vorschau kündigt kein Zusammenfassen an')
      const nachher = await items(opened)
      const stehend = nachher.find((c) => c.id === rumpf.id) ?? assert.fail('stehender Teil fehlt')
      assert.equal(stehend.amountCents, 12000)
      const bewegt = nachher.filter((c) => c.id !== rumpf.id)
      assert.deepEqual(bewegt.map((c) => [c.period, c.amountCents, c.key, c.participantUnitIds ?? null]), [['2025-01', 24500, 'area', null]])
      assert.equal(nachher.reduce((a, c) => a + c.amountCents, 0), 36500)
      assert.equal(new Set(nachher.map((c) => c.sourceId)).size, 1, 'beide Zeilen bleiben Teile derselben Quelle')
      assert.notEqual(stehend.sourceId, undefined)
    })
  })
}

test('M1: Ein berichtigter Rechnungssteller verhindert das Zusammenfassen nicht (verteilt wird gleich)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, MAI_AB_2025)
    const rumpf = (await items(opened)).find((c) => c.period === '2025-01') ?? assert.fail('kein Teil im Rumpf')
    await opened.write((db) => updateEntity(db, 'costItems', rumpf.id, { vendor: 'Stadtkasse' }))
    await change(opened, KALENDER)
    assert.deepEqual(await rows(opened), [['2025-01', 36500]])
  })
})

// Integrationsdurchsicht zu #455, I1: Zwei Teile einer Quelle im selben Zeitraum mit verschiedenem Jahr der Zahlung (so
// lässt das Zusammenfassen sie stehen, und so kommen sie aus dem Datenschritt, der das Jahr nicht vergleicht). Zählten
// sie beim nächsten Wechsel zusammen, fragte die Vorschau nur das Jahr des ersten, und 120 € Werbungskosten wechselten
// von 2026 nach 2025, obwohl sich an der Zahlung nichts ändert. Je Jahr eine Rechnung mit eigener Frage.
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const NOVEMBER_AB_2025: PeriodRules = { startMonth: 5, changes: ['2025-11'] }
const anteilig = { ...grundsteuer, period: '2025-05', description: 'Grundsteuer 2025/26 (anteilig 01.05.2025–30.04.2026)', serviceFrom: '2025-05-01', serviceTo: '2026-04-30' }
async function zweiJahreImZeitraum(opened: OpenedDatabase): Promise<void> {
  await change(opened, MAI)
  await opened.write(async (db) => {
    await createEntity(db, 'costItems', 'gA', { ...anteilig, amountCents: 24500, taxYear: 2025 })
    await createEntity(db, 'costItems', 'gB', { ...anteilig, amountCents: 12000, taxYear: 2026 })
    await db.insert(costSources).values({ id: 'gA', propertyId: P, rule: 'days' })
    await db.update(costItems).set({ sourceId: 'gA' })
  })
}
const steuer = async (opened: OpenedDatabase): Promise<number[]> => {
  const stock = await opened.read((db) => readStock(db))
  return [2025, 2026].map((year) => taxReportFor(stock, P, year).expenses.items.filter((i) => i.category === 'Grundsteuer').reduce((a, i) => a + i.amountCents, 0))
}

test('I1: Teile eines Zeitraums mit verschiedenem Jahr der Zahlung werden je Jahr geteilt, je Jahr eine Frage', async () => {
  await withDatabase(async (opened) => {
    await zweiJahreImZeitraum(opened)
    assert.deepEqual(await steuer(opened), [24500, 12000])
    const v = await change(opened, NOVEMBER_AB_2025)
    assert.deepEqual(v.taxYears.map((t) => [t.costItemId, t.period, t.suggested]).sort(), [['gA', '2025-11', 2025], ['gB', '2025-11', 2026]])
    // 05–10/2025 liegt in einem Kalenderjahr (keine Frage, Entwurf 3.10): beide Anteile mit 2025, eine Zeile. 11/2025–
    // 10/2026: je Jahr ein Teil.
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, storedOutflowYear(c)]).sort(), [['2025-05', 18400, 2025], ['2025-11', 12149, 2025], ['2025-11', 5951, 2026]])
    assert.deepEqual(await steuer(opened), [30549, 5951])
    assert.equal(new Set(nachher.map((c) => c.sourceId)).size, 1, 'alle bleiben Teile derselben Quelle')
    assert.notEqual(nachher[0]?.sourceId, undefined)
  })
})

test('I1: Mit demselben Jahr für beide kommen die Anteile in eine Zeile', async () => {
  await withDatabase(async (opened) => {
    await zweiJahreImZeitraum(opened)
    await change(opened, NOVEMBER_AB_2025, { taxYears: { 'gB|2025-11': 2025 } })
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, storedOutflowYear(c)]).sort(), [['2025-05', 18400, 2025], ['2025-11', 18100, 2025]])
    assert.deepEqual(await steuer(opened), [36500, 0])
  })
})

test('M1: Hängt das Zusammenfassen an einer Frage nach dem Jahr der Zahlung, sagt die Vorschau es', async () => {
  await withDatabase(async (opened) => {
    const { stehend, bewegt } = await zweiJahre(opened)
    // Der bewegte Teil mit 2025 (von Hand, wie aus einem früheren Stand): vorbelegt sind dann beide mit 2025.
    await opened.write(async (db) => {
      await db.update(costItems).set({ taxYear: 2025 }).where(eq(costItems.id, bewegt.id))
    })
    const v = await preview(opened, MAI_AB_2025)
    assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => [p.mergedInto, p.mergeDependsOnYear])), [[stehend.description, true]])
  })
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, MAI_AB_2025)
    const v = await preview(opened, KALENDER)
    assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => [p.mergedInto !== undefined, p.mergeDependsOnYear])), [[true, undefined]], 'ohne Frage gilt die Ankündigung ohne Bedingung')
  })
})

// #471: Bleibt einer Quelle ein Teil, der nicht die ganze Rechnung trägt (ein Teil wurde früher gelöscht), behält er den
// Zusatz „(anteilig …)“; sein Betrag ist weiter nur der Anteil.
test('#471: Der Zusatz „(anteilig …)“ entfällt nur, wenn die verbleibende Zeile die ganze Rechnung trägt', async () => {
  await withDatabase(async (opened) => {
    const teile = await opened.write((db) => saveCostItemSplit(db, P, { ...grundsteuer, period: '2024-01', serviceFrom: '2024-07-01', serviceTo: '2025-06-30' }, null, ids))
    const frueh = teile.find((c) => c.period === '2024-01') ?? assert.fail('kein Teil 2024')
    const spaet = teile.find((c) => c.period === '2025-01') ?? assert.fail('kein Teil 2025')
    await opened.write((db) => removeEntity(db, 'costItems', frueh.id))
    const v = await change(opened, { startMonth: 1, changes: ['2025-07'] })
    assert.deepEqual(v.moves.map((m) => m.renamedTo), [undefined])
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => [c.period, c.amountCents, c.description]), [['2025-01', spaet.amountCents, spaet.description]])
  })
})

// #471: Die Vorschau rechnet mit den vorbelegten Jahren. Entsteht ein Zusammenfassen erst mit einem anderen Jahr, sagt
// sie auch das; vorher kündigte sie zwei Zeilen an, und geschrieben wurde eine.
test('#471: Entsteht das Zusammenfassen erst mit einem anderen als dem vorbelegten Jahr, sagt die Vorschau es', async () => {
  await withDatabase(async (opened) => {
    const { stehend } = await zweiJahre(opened)
    const v = await preview(opened, MAI_AB_2025)
    // Durchsicht, M2: Mit dem Jahr trüge die Zeile danach die ganze Rechnung; die Vorschau nennt auch den neuen Namen.
    assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => [p.mergedInto, p.mergeWithYear])), [[undefined, { into: stehend.description, year: 2025, renamedTo: 'Grundsteuer 2025' }]])
  })
  await withDatabase(async (opened) => {
    // Ohne Frage nach dem Jahr gibt es keinen solchen Satz.
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, MAI_AB_2025)
    const v = await preview(opened, KALENDER)
    assert.deepEqual(v.moves.flatMap((m) => m.parts.map((p) => p.mergeWithYear)), [undefined])
  })
})

// Durchsicht zu #471, I1: Ob die verbleibende Zeile die ganze Rechnung trägt, entscheidet die ganze Familie (stehende und
// bewegte Teile), nicht nur ihr Leistungszeitraum. Fehlt ein Teil, bleibt der Zusatz, und die Vorschau kündigt nichts an.
test('I1 zu #471: Fehlt ein Teil, behält die verbleibende Zeile den Zusatz, auch wenn sie danach allein steht', async () => {
  // A: Mai ab 2025, der Teil 2025-01 gelöscht, dann zurück zum Kalenderjahr.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, MAI_AB_2025)
    const frueh = (await items(opened)).find((c) => c.period === '2025-01') ?? assert.fail('kein Teil 2025-01')
    await opened.write((db) => removeEntity(db, 'costItems', frueh.id))
    const v = await change(opened, KALENDER)
    assert.deepEqual(v.moves.map((m) => m.renamedTo), [undefined])
    const nachher = await items(opened)
    assert.deepEqual(nachher.map((c) => c.amountCents), [24500])
    assert.match(nachher[0]?.description ?? '', /\(anteilig /)
  })
  // B: Mai und September ab 2025, der Teil 2025-09 gelöscht, dann zurück zum Kalenderjahr.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'gs', grundsteuer))
    await change(opened, { startMonth: 1, changes: ['2025-05', '2025-09'] })
    const spaet = (await items(opened)).find((c) => c.period === '2025-09') ?? assert.fail('kein Teil 2025-09')
    await opened.write((db) => removeEntity(db, 'costItems', spaet.id))
    const v = await change(opened, KALENDER)
    assert.deepEqual(v.moves.map((m) => m.renamedTo), [undefined])
    const nachher = await items(opened)
    assert.equal(nachher.length, 1)
    assert.match(nachher[0]?.description ?? '', /\(anteilig /)
  })
})
