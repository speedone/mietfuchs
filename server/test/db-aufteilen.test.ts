// Aufteilen beim Speichern (#208, Entwurf 3.4): Vorschau, Schreiben in einer Transaktion,
// abgeschlossene Zeiträume, Heizkosten, Jahr der Zahlung.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, listCollection, PeriodConflict, PeriodError, previewCostItemSplit, saveCostItemSplit } from '../src/db/repository.ts'
import { periodChanges, properties } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import type { CostItem } from '../../shared/types.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-aufteilen-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const setRules = (opened: OpenedDatabase, startMonth: number, changes: string[]) =>
  opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: startMonth }).where(eq(properties.id, 'objekt-1'))
    for (const fromMonth of changes) await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth })
  })
let n = 0
const ids = () => `neu-${++n}`
const grundsteuer = { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31', invoiceFile: 'gs.pdf', taxYear: 2025 }
const costItems = async (opened: OpenedDatabase): Promise<CostItem[]> => (await opened.read((db) => listCollection(db, 'costItems'))).filter((e): e is CostItem => 'amountCents' in e && 'category' in e)

test('Vorschau und Speichern: zwei Positionen, Beleg an beiden, Jahr der Zahlung nur am Teil über zwei Kalenderjahre', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => [p.period, p.label, p.amountCents, p.needsTaxYear, p.closed]), [
      ['2025-01', '01.01.–30.04.2025', 15781, false, false],
      ['2025-05', '2025/2026', 32219, true, false],
    ])
    const teile = await opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids))
    assert.deepEqual(teile.map((c) => [c.period, c.amountCents, c.description, c.invoiceFile, c.taxYear, c.serviceFrom, c.serviceTo]), [
      ['2025-01', 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)', 'gs.pdf', undefined, '2025-01-01', '2025-12-31'],
      ['2025-05', 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', 'gs.pdf', 2025, '2025-01-01', '2025-12-31'],
    ])
  })
})

test('Ohne Jahr der Zahlung für den Teil über zwei Kalenderjahre wird nichts gespeichert', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    const { taxYear: _ohne, ...ohneJahr } = grundsteuer
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', ohneJahr, null, ids)),
      (err: unknown) => err instanceof PeriodError && /Jahr der Zahlung/.test(err.message))
    assert.equal((await costItems(opened)).length, 0, 'auch der erste Teil steht nicht da')
  })
})

test('Ein abgeschlossener Zeitraum lehnt das Aufteilen ab (409), nichts wird geschrieben', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await opened.write((db) => closeSettlement(db, { id: 'z', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01T00:00:00Z', sentAt: null, settlement: {} }))
    const vorschau = await opened.read((db) => previewCostItemSplit(db, 'objekt-1', grundsteuer, null))
    assert.deepEqual(vorschau.map((p) => p.closed), [true, false])
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', grundsteuer, null, ids)),
      (err: unknown) => err instanceof PeriodConflict && /Die Abrechnung 01\.01\.–30\.04\.2025 ist abgeschlossen/.test(err.message))
    assert.equal((await costItems(opened)).length, 0)
  })
})

test('Heizkosten werden nicht nach Tagen aufgeteilt; eine Rechnung in einem Zeitraum braucht kein Aufteilen', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await assert.rejects(opened.read((db) => previewCostItemSplit(db, 'objekt-1', { ...grundsteuer, category: 'Heizung und Warmwasser' }, null)),
      (err: unknown) => err instanceof PeriodError && /Heizkosten teilt Mietfuchs nicht nach Tagen auf/.test(err.message))
    const eins = { ...grundsteuer, serviceFrom: '2025-01-01', serviceTo: '2025-03-31', taxYear: undefined }
    assert.equal((await opened.read((db) => previewCostItemSplit(db, 'objekt-1', eins, null))).length, 1)
    await assert.rejects(opened.write((db) => saveCostItemSplit(db, 'objekt-1', eins, null, ids)),
      (err: unknown) => err instanceof PeriodError && /liegt in einem einzigen Abrechnungszeitraum/.test(err.message))
  })
})

test('Eine vorhandene Position aufteilen: Sie behält ihre Kennung für den Teil ihres Zeitraums', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'alt', { ...grundsteuer, propertyId: 'objekt-1', serviceFrom: undefined, serviceTo: undefined, taxYear: undefined }))
    await setRules(opened, 1, ['2025-05'])
    const teile = await opened.write((db) => saveCostItemSplit(db, null, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31', taxYear: 2025 }, 'alt', ids))
    assert.deepEqual(teile.map((c) => [c.id === 'alt', c.period, c.amountCents]), [[true, '2025-01', 15781], [false, '2025-05', 32219]])
    assert.equal((await costItems(opened)).length, 2)
  })
})
