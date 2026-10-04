// Überschneidende Mietverhältnisse im Bestand (#204): Ein solcher Bestand bleibt ladbar und
// übertragbar. Validator, Umstieg und Backup nehmen ihn an, wie er ist, und rücken nichts gerade;
// welches der beiden Daten falsch ist, weiß nur der Vermieter. Die Abrechnung meldet es.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Db } from '../src/store.ts'
import { validateDb } from '../src/legacy/validate.ts'
import { straightenForDatabase } from '../src/legacy/migrate.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { runChangeover } from '../src/db/changeover.ts'
import { archiveDatabaseProblem, writeDatabaseSnapshot } from '../src/db/backup.ts'
import { connect } from '../src/db/client.ts'
import { openDatabaseWithStock } from '../testing/database.ts'
import { tenancyOverlaps } from '../../shared/tenancyOverlap.ts'

// Wohnung EG: Müller bis 30.09.2025, Schmidt ab 01.09.2025 — 30 Tage zugleich.
const overlappingDb = (): Db => ({
  settings: {
    houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30,
    ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell',
  },
  units: [{ id: 'u1', name: 'EG', areaM2: 50, participates: true }, { id: 'u2', name: 'OG', areaM2: 50, participates: true }],
  tenancies: [
    { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, personHistory: [{ from: '2023-01-01', persons: 2 }], start: '2023-01-01', end: '2025-09-30', prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't2', unitId: 'u1', tenantName: 'Schmidt', persons: 1, personHistory: [{ from: '2025-09-01', persons: 1 }], start: '2025-09-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
    { id: 't3', unitId: 'u2', tenantName: 'Weber', persons: 2, personHistory: [{ from: '2020-01-01', persons: 2 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  ],
  costItems: [{ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 120000, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})
const dates = (list: { id: string, start: string, end: string | null }[]) => list.map((t) => [t.id, t.start, t.end])
const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-ueberschneidung-'))

test('Validator: ein Bestand mit Überschneidung ist kein Befund und wird nicht geradegerückt', () => {
  const result = validateDb(overlappingDb())
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.adjustments, [])
  assert.deepEqual(dates(straightenForDatabase(overlappingDb()).tenancies), dates(overlappingDb().tenancies))
})

test('Umstieg: der Bestand wandert mit beiden Daten unverändert in die Datenbank', async () => {
  const dataDir = tempDir()
  try {
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(overlappingDb()), 'utf8')
    const opened = await openDatabase({ dataDir })
    const result = await runChangeover({ dataDir, opened, reopen: () => openDatabase({ dataDir }) })
    try {
      assert.equal(result.state, 'done', result.message)
      assert.ok(result.database)
      const stock = await readStock(result.database.db)
      assert.deepEqual(dates(stock.tenancies), dates(overlappingDb().tenancies))
      assert.equal(tenancyOverlaps(stock.tenancies).length, 1)
    } finally {
      result.database?.close()
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Backup: der Schnappschuss nimmt die Überschneidung mit und wird beim Wiederherstellen nicht beanstandet', async () => {
  const dataDir = tempDir()
  const opened = await openDatabaseWithStock(dataDir, straightenForDatabase(overlappingDb()))
  try {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    assert.equal(await archiveDatabaseProblem(ziel), null)
    const eigene = await connect(ziel)
    try {
      assert.deepEqual(dates((await readStock(eigene.db)).tenancies), dates(overlappingDb().tenancies))
    } finally {
      eigene.close()
    }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
