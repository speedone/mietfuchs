// Modellempfehlungen (#33): Jede Version bringt eine Liste mit. Mit derselben Zustimmung wie
// beim Update-Hinweis lädt Mietfuchs höchstens einmal am Tag eine neuere aus dem Repo. Was
// dabei ankommt, wird streng geprüft, damit eine kaputte oder fremde Datei nichts anrichtet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILT_IN, createRecommendations, validateRecommendations } from '../src/ai/recommendations.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('Die mitgelieferte Liste und die Datei im Repo sind dieselbe', () => {
  // Die Datei im Repo wird nachgeladen, die Kopie im Code gilt ohne Netz. Sie dürfen nicht
  // auseinanderlaufen.
  const file = JSON.parse(fs.readFileSync(path.join(repoRoot, 'ki-modelle.json'), 'utf8'))
  assert.deepEqual(file, BUILT_IN)
  assert.equal(validateRecommendations(file)?.models.length, BUILT_IN.models.length)
})

test('Die mitgelieferte Liste nennt zu jedem Modell das Nötige', () => {
  for (const m of BUILT_IN.models) {
    assert.match(m.name, /^[\w.:/-]{1,100}$/)
    assert.ok(['ollama', 'openai'].includes(m.provider), m.name)
    assert.ok(typeof m.note === 'string' && m.note.length > 0, m.name)
    if (m.provider === 'ollama') assert.ok(m.sizeGb > 0, m.name)
    assert.ok(typeof m.vision === 'boolean', m.name)
  }
  assert.ok(BUILT_IN.models.some((m) => m.name === 'qwen3.5:4b'), 'das voreingestellte Modell fehlt')
})

test('Prüfung: kaputte Einträge fallen weg, unbekannte Felder stören nicht', () => {
  const checked = validateRecommendations({
    format: 1,
    updated: '2026-10-01',
    models: [
      { name: 'gut:4b', provider: 'ollama', sizeGb: 3.6, vision: true, note: 'passt', neuesFeld: 'egal' },
      { name: 'ohne Anbieter', sizeGb: 1, vision: true, note: 'x' },
      { name: 'böse name!', provider: 'ollama', sizeGb: 1, vision: true, note: 'x' },
      { name: 'zu-groß:1b', provider: 'ollama', sizeGb: 5000, vision: true, note: 'x' },
      { name: 'ohne-note:1b', provider: 'ollama', sizeGb: 1, vision: true },
    ],
  })
  assert.deepEqual(checked.models.map((m) => m.name), ['gut:4b'])
  assert.equal(checked.models[0].neuesFeld, undefined)
  assert.equal(checked.updated, '2026-10-01')
})

test('Prüfung: eine fremde oder unbrauchbare Datei ergibt null', () => {
  for (const raw of [null, {}, { format: 2, models: [] }, { format: 1, models: 'viele' }, { format: 1, models: [] }, '<html>']) {
    assert.equal(validateRecommendations(raw), null, JSON.stringify(raw))
  }
})

// ---------- Nachladen ----------

const later = (start, days) => () => start + days * 24 * 60 * 60 * 1000

test('Nachladen: ohne Zustimmung geht keine Anfrage hinaus', async () => {
  let calls = 0
  const recommendations = createRecommendations({ load: async () => { calls++; return null } })
  const result = await recommendations.get({ consented: false })
  assert.equal(result.source, 'mitgeliefert')
  assert.deepEqual(result.models, BUILT_IN.models)
  assert.equal(calls, 0)
})

test('Nachladen: mit Zustimmung höchstens einmal am Tag', async () => {
  const start = Date.UTC(2026, 9, 1)
  let calls = 0
  const fresh = { format: 1, updated: '2026-10-01', models: [{ name: 'neu:4b', provider: 'ollama', sizeGb: 2, vision: true, note: 'frisch' }] }
  let now = start
  const recommendations = createRecommendations({ load: async () => { calls++; return fresh }, now: () => now })
  const first = await recommendations.get({ consented: true })
  assert.equal(first.source, 'netz')
  assert.deepEqual(first.models.map((m) => m.name), ['neu:4b'])
  await recommendations.get({ consented: true })
  assert.equal(calls, 1, 'zweite Abfrage am selben Tag')
  now = later(start, 2)()
  await recommendations.get({ consented: true })
  assert.equal(calls, 2, 'am nächsten Tag wieder')
})

test('Nachladen: geht es schief, gilt die mitgelieferte Liste, und es wird nicht sofort erneut versucht', async () => {
  let calls = 0
  const start = Date.UTC(2026, 9, 1)
  let now = start
  const recommendations = createRecommendations({
    load: async () => { calls++; throw new Error('kein Netz') },
    now: () => now,
  })
  const result = await recommendations.get({ consented: true })
  assert.equal(result.source, 'mitgeliefert')
  assert.deepEqual(result.models, BUILT_IN.models)
  now = start + 60 * 1000
  await recommendations.get({ consented: true })
  assert.equal(calls, 1, 'nach einem Fehler nicht sofort wieder')
})

test('Nachladen: eine unbrauchbare Antwort ändert nichts', async () => {
  const recommendations = createRecommendations({ load: async () => ({ format: 99, models: [] }) })
  const result = await recommendations.get({ consented: true })
  assert.equal(result.source, 'mitgeliefert')
  assert.deepEqual(result.models, BUILT_IN.models)
})
