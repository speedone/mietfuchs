// Quellrechnung (#455, Schritt 2): Eine aufgeteilte Rechnung hat eine Kennung in `cost_sources`, und jeder ihrer Teile
// verweist mit `cost_items.source_id` darauf. Gesetzt wird der Verweis nur von den Schreibwegen der Teile, nie aus
// einem Rumpf; mit dem letzten Teil fällt die Quelle weg, und das Wiederherstellen prüft die Objektgrenze.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity, crossPropertyViolations, insertCostSource, listCollection, removeEntity, updateEntity, writeCostItemParts } from '../src/db/repository.ts'
import { costSources, periodChanges, properties } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem } from '../../shared/types.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-quelle-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

let n = 0
const ids = () => `neu-${++n}`
const costItems = async (opened: OpenedDatabase): Promise<CostItem[]> =>
  (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)
const sources = (opened: OpenedDatabase) => opened.read((db) => db.select().from(costSources))

const grundsteuer: CostItem = {
  id: 'gs', propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer 2025',
  amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31',
}

// Zwei Teile einer Grundsteuer über den Wechsel zum 01.05.2025, beide mit der Quelle `q1`.
async function twoParts(opened: OpenedDatabase): Promise<string[]> {
  await opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: 1 }).where(eq(properties.id, 'objekt-1'))
    await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth: '2025-05' })
  })
  return opened.write((db) => db.transaction(async (tx) => {
    await insertCostSource(tx, 'objekt-1', 'q1')
    return writeCostItemParts(tx, grundsteuer, [
      { period: periodKey('2025-01'), amountCents: 15781, labor35aCents: null, description: 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)', taxYear: null },
      { period: periodKey('2025-05'), amountCents: 32219, labor35aCents: null, description: 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', taxYear: 2025 },
    ], ids, null, { splitPart: true }, 'q1')
  }))
}

test('Eine Position liest und schreibt ihre Quelle', async () => {
  await withDatabase(async (opened) => {
    const written = await twoParts(opened)
    assert.equal(written.length, 2)
    const teile = await costItems(opened)
    assert.deepEqual(teile.map((c) => [c.period, c.amountCents, c.sourceId]), [['2025-01', 15781, 'q1'], ['2025-05', 32219, 'q1']])
    assert.deepEqual(await sources(opened), [{ id: 'q1', propertyId: 'objekt-1', rule: 'days' }])
  })
})

test('Ohne Quelle liest sich eine Position ohne den Schlüssel sourceId', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area', period: '2025-01' }))
    const [c] = await costItems(opened)
    if (!c) assert.fail('die Position fehlt')
    assert.equal('sourceId' in c, false)
  })
})

test('Ein Rumpf setzt keine Quelle', async () => {
  await withDatabase(async (opened) => {
    // Anlegen mit einer fremden Quelle: gespeichert ohne, kein Fehler (sonst schlüge der Fremdschlüssel an).
    await opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area', period: '2025-01', sourceId: 'fremd' }))
    assert.deepEqual((await costItems(opened)).map((c) => [c.id, c.sourceId]), [['c1', undefined]])
    // Ändern eines Teils mit einer fremden oder leeren Quelle: Die bisherige bleibt.
    const [first] = await twoParts(opened)
    if (first === undefined) assert.fail('kein Teil geschrieben')
    await opened.write((db) => updateEntity(db, 'costItems', first, { amountCents: 15000, sourceId: 'fremd' }))
    await opened.write((db) => updateEntity(db, 'costItems', 'c1', { sourceId: 'q1' }))
    await opened.write((db) => updateEntity(db, 'costItems', first, { sourceId: null }))
    const nachher = await costItems(opened)
    assert.deepEqual(nachher.map((c) => [c.id, c.amountCents, c.sourceId]), [['c1', 100, undefined], [first, 15000, 'q1'], [nachher[2]?.id, 32219, 'q1']])
  })
})

test('Mit dem letzten Teil fällt die Quelle weg', async () => {
  await withDatabase(async (opened) => {
    const [first, second] = await twoParts(opened)
    if (first === undefined || second === undefined) assert.fail('zwei Teile erwartet')
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', first)), true)
    assert.deepEqual((await sources(opened)).map((s) => s.id), ['q1'], 'der zweite Teil trägt sie noch')
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', second)), true)
    assert.deepEqual(await sources(opened), [])
  })
})

test('Wiederherstellen lehnt eine Quelle eines anderen Objekts ab', async () => {
  await withDatabase(async (opened) => {
    await twoParts(opened)
    assert.deepEqual(await opened.read((db) => crossPropertyViolations(db)), [])
    await opened.write(async (db) => {
      await db.insert(properties).values({ id: 'objekt-2', name: 'Zweites', kind: 'mfh', address: '' })
      await db.update(costSources).set({ propertyId: 'objekt-2' }).where(eq(costSources.id, 'q1'))
    })
    const befunde = await opened.read((db) => crossPropertyViolations(db))
    assert.deepEqual(befunde, [
      'Die Kostenposition „Grundsteuer 2025 (anteilig 01.01.–30.04.2025)“ gehört zu einer aufgeteilten Rechnung eines anderen Objekts.',
      'Die Kostenposition „Grundsteuer 2025 (anteilig 01.05.–31.12.2025)“ gehört zu einer aufgeteilten Rechnung eines anderen Objekts.',
    ])
  })
})
