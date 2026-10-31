// Invariante des Rücksprungs im Verlauf (#318, Schritt 4), über Zufallsabläufe auf den echten Routen samt Heizung:
// Der Bestand wird nach jedem Eintrag gemerkt. Ein Rücksprung vor einen Eintrag ergibt zeilengleich den Stand davor
// (ohne die Journal-Tabellen, mit rowid), einer nach den Eintrag den Stand danach, und das Zurücknehmen des
// Rücksprungs ergibt wieder den Endstand. Danach ist der Bestand rechenbar, und jede Zeile eines Belegs hat ihre Datei.
// Liegt ein Abschluss oder ein Wiederöffnen im Bereich, wird abgelehnt und nichts geändert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROUTE_SENTENCES } from '../src/journalRoutes.ts'
import type { JournalGroupView } from '../src/db/journal.ts'
import type { RevertMode } from '../src/db/revert.ts'
import { startServerIn, type Server } from '../testing/api.ts'
import { dumpStock, journalOf, newest, previewOf, revert, revertRaw } from '../testing/revert.ts'
import { CLOSING_STEPS, refresh, rngOf, STEPS, UNCOVERED_MAX, UNCOVERED_ROUTES, type Ctx, type Step } from '../testing/revertFlows.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const REVERT_ROUTE = 'POST /api/journal/:id/revert'

// Ein Schritt kann mehrere Anfragen stellen und damit mehrere Einträge ergeben: `firstId` ist der älteste, `id` der jüngste.
// „Stand vor“ zielt auf `firstId`, „Stand nach“ auf `id`.
type Mark = { firstId: number, id: number, step: string, closing: boolean, before: Record<string, string[]>, after: Record<string, string[]> }

async function top(s: Server): Promise<number> {
  const [g] = await journalOf(s, '?limit=1')
  return g?.id ?? 0
}

// Ein Lauf: erst jeder Schritt einmal (Abdeckung), dann zufällige; nach jedem neuen Eintrag der Stand.
async function run(s: Server, seed: number, randomSteps: number, withClosing: boolean): Promise<Mark[]> {
  const rng = rngOf(seed)
  const ctx: Ctx = { s, rng, units: [], tenancies: [], meters: [], readings: [], payments: [], costItems: [], plants: [], deliveries: [], refunds: [], uploads: [], properties: [] }
  const marks: Mark[] = []
  let state = await stateOf(s)
  let last = await top(s)
  const pool: Step[] = [...STEPS, ...(withClosing ? CLOSING_STEPS : [])]
  const order: Step[] = [...STEPS, ...(withClosing ? CLOSING_STEPS : []), ...STEPS]
  for (let i = 0; i < randomSteps; i++) order.push(pool[Math.floor(rng() * pool.length)])
  for (const step of order) {
    await refresh(ctx)
    if (process.env.NKA_TEST_REVERT_DEBUG) console.error(`Schritt: ${step.name}`)
    await step.run(ctx)
    const id = await top(s)
    if (id === last) continue
    const after = await stateOf(s)
    const added = (await journalOf(s, '?limit=50')).filter((g) => g.id > last)
    // Ob der Schritt wirklich abgeschlossen, wieder geöffnet oder das Versanddatum geändert hat: an der Route der Gruppen.
    const closing = added.some((g) => g.route.endsWith('/close'))
    marks.push({ firstId: Math.min(...added.map((g) => g.firstId)), id, step: step.name, closing, before: state, after })
    state = after
    last = id
  }
  return marks
}


async function settlementComputes(s: Server): Promise<void> {
  for (const url of ['/api/settlement/2025?property=objekt-1', '/api/consumption/2025?property=objekt-1']) {
    const res = await fetch(`${s.base}${url}`)
    assert.ok(res.status < 500, `${url}: ${res.status} ${await res.text()}`)
  }
}

// Der Stand samt Dateien (Durchsicht von PR #439, K6): Belegordner und Ordner für Briefpapier gehören zum Stand und werden
// mit verglichen, direkt auf dem Dateisystem. Der Papierkorb wächst (was ein Rücksprung weglegt, bleibt dort), deshalb
// gilt für ihn nur: Was der Stand je hatte, liegt im Belegordner oder im Papierkorb.
const listing = (dir: string) => { try { return fs.readdirSync(dir).sort() } catch { return [] } }
async function stateOf(s: Server): Promise<Record<string, string[]>> {
  return {
    ...await dumpStock(s.dataDir),
    'Datei: uploads': listing(path.join(s.dataDir, 'uploads')),
    'Datei: briefpapier': listing(path.join(s.dataDir, 'briefpapier')),
  }
}
function filesKept(s: Server, state: Record<string, string[]>): void {
  for (const store of ['uploads', 'briefpapier']) {
    const all = new Set([...listing(path.join(s.dataDir, store)), ...listing(path.join(s.dataDir, 'papierkorb', store))])
    assert.deepEqual((state[`Datei: ${store}`] ?? []).filter((f) => !all.has(f)), [], `verloren in ${store}`)
  }
}

async function checkRevert(s: Server, marks: Mark[], k: number, mode: RevertMode): Promise<void> {
  const final = await stateOf(s)
  const mark = marks[k]
  const range = mode === 'including' ? marks.slice(k) : marks.slice(k + 1)
  const blocked = range.some((m) => m.closing)
  // Im Verlauf stehen auch die Rücksprünge der früheren Proben samt ihrer Rücknahme; zusammen ändern sie nichts.
  const nothingAfter = mode === 'after' && (await top(s)) === mark.id
  if (process.env.NKA_TEST_REVERT_DEBUG) console.error(`Rücksprung ${mode} zu ${mark.step}`)
  const target = mode === 'including' ? mark.firstId : mark.id
  const preview = await previewOf(s, target, mode)
  if (blocked || nothingAfter) {
    assert.notDeepEqual(preview.refusals, [], `${mode} ${mark.step}: Ablehnung erwartet`)
    assert.equal((await revertRaw(s, target, mode, preview.token)).status, 409)
    assert.deepEqual(await stateOf(s), final)
    return
  }
  assert.deepEqual(preview.refusals, [], `${mode} ${mark.step}`)
  const debug = (what: string) => { if (process.env.NKA_TEST_REVERT_DEBUG) console.error(`  ${what}`) }
  debug('Vorschau ok')
  await revert(s, target, mode)
  debug('zurückgekehrt')
  assert.deepEqual(await stateOf(s), mode === 'including' ? mark.before : mark.after, `Rücksprung ${mode} ${mark.step}`)
  await settlementComputes(s)
  debug('rechenbar')
  filesKept(s, final)
  // Den Rücksprung zurücknehmen: wieder der Endstand.
  await revert(s, (await newest(s)).id, 'including')
  assert.deepEqual(await stateOf(s), final, `Rückgängig des Rücksprungs ${mode} ${mark.step}`)
}

async function routesInJournal(s: Server): Promise<Set<string>> {
  const out = new Set<string>()
  let before: number | null = null
  for (;;) {
    const page: JournalGroupView[] = await journalOf(s, `?limit=200${before === null ? '' : `&before=${before}`}`)
    for (const g of page) out.add(`${g.method} ${g.route}`)
    if (page.length < 200) break
    before = page[page.length - 1].id
  }
  return out
}

test('Wächter: Jede Route mit Satz kommt im Generator vor oder steht mit Grund auf der Ausnahmeliste', () => {
  const covered = new Set([...STEPS, ...CLOSING_STEPS].flatMap((s) => s.routes))
  const missing = Object.keys(ROUTE_SENTENCES).filter((r) => !covered.has(r) && !UNCOVERED_ROUTES[r] && r !== REVERT_ROUTE)
  assert.deepEqual(missing, [])
  assert.deepEqual(Object.keys(UNCOVERED_ROUTES).filter((r) => covered.has(r) || !ROUTE_SENTENCES[r]), [], 'Ausnahmen, die keine sind')
  assert.ok(Object.keys(UNCOVERED_ROUTES).length <= UNCOVERED_MAX, 'Die Ausnahmeliste darf nur kürzer werden.')
  assert.deepEqual([...covered].filter((r) => !ROUTE_SENTENCES[r]), [], 'Der Generator nennt eine Route ohne Satz')
})

const SEEDS: [number, boolean][] = [[318, false], [4711, true], [2026, false]]
// Die Routen, die in den Läufen eine Gruppe ergeben haben (node:test führt die Tests einer Datei nacheinander aus).
const hitRoutes = new Set<string>()

for (const [seed, withClosing] of SEEDS) {
  test(`Invariante Rücksprung, Startwert ${seed}${withClosing ? ', mit Abschluss' : ''}`, { timeout: 600_000 }, async () => {
    const s = await startServerIn(tmp())
    try {
      const marks = await run(s, seed, 40, withClosing)
      assert.ok(marks.length > 40, `nur ${marks.length} Einträge`)
      const rng = rngOf(seed + 1)
      // Ganz an den Anfang, nach dem letzten Eintrag und zwei aus der Mitte. Mehr kostet viel: Jeder Rücksprung und seine
      // Rücknahme stehen im Verlauf, und der nächste Rücksprung über sie hinweg nimmt beide mit zurück.
      const picks = [0, marks.length - 1, ...Array.from({ length: 2 }, () => Math.floor(rng() * marks.length))]
      for (const [n, k] of picks.entries()) await checkRevert(s, marks, k, n % 2 === 0 ? 'including' : 'after')
      for (const r of await routesInJournal(s)) hitRoutes.add(r)
    } finally {
      s.stop()
    }
  })
}

test('Abdeckung: Jede Route der Schritte hat in den Läufen wirklich eine Gruppe ergeben', () => {
  const routes = [...new Set([...STEPS, ...CLOSING_STEPS].flatMap((st) => st.routes)), REVERT_ROUTE]
  assert.deepEqual(routes.filter((r) => !hitRoutes.has(r)), [], 'Diese Routen hat der Generator nicht erreicht')
})

// Durchsicht von #262, K-a: Der Schritt „Kostenposition ändern“ setzt die Verteilung nur an einer Position, die sie
// erlaubt. Sonst lehnte der Server an einer umlagefähigen ab (400), und mit der Wahl fiel auch die Änderung des Betrags
// weg, die der Schritt eigentlich prüfen soll.
test('Generator: „Kostenposition ändern“ wird an einer umlagefähigen Position nie abgelehnt', async () => {
  const s = await startServerIn(tmp())
  const step = STEPS.find((x) => x.name === 'Kostenposition ändern') ?? assert.fail('Schritt fehlt')
  const statuses: number[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const res = await realFetch(input, init)
    if (init?.method === 'PUT' && String(input).includes('/api/costItems/')) statuses.push(res.status)
    return res
  }
  try {
    await realFetch(`${s.base}/api/units`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }) })
    await realFetch(`${s.base}/api/costItems`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48_000, key: 'area' }) })
    const ctx: Ctx = { s, rng: rngOf(262), units: [], tenancies: [], meters: [], readings: [], payments: [], costItems: [], plants: [], deliveries: [], refunds: [], uploads: [], properties: [] }
    for (let i = 0; i < 12; i++) {
      await refresh(ctx)
      await step.run(ctx)
    }
    assert.equal(statuses.length, 12)
    assert.deepEqual(statuses.filter((x) => x !== 200), [])
  } finally {
    globalThis.fetch = realFetch
    s.stop()
  }
})
