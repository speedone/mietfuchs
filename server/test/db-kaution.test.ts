// Kautionsbuchungen in der Datenbank (#228): Tabelle `deposit_entries` mit ihren Bedingungen, die Form der Sicherheit
// am Mietverhältnis und das Lesen in Einfügereihenfolge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readDepositEntries, readTenancies } from '../src/db/read.ts'
import { createEntity, updateEntity } from '../src/db/repository.ts'
import { depositEntries } from '../src/db/schema.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-kaution-'))

async function withRaw(work: (c: Awaited<ReturnType<typeof connect>>) => void): Promise<void> {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p', 't', '2025-06-01', 30000)`)
    work(c)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const insert = (id: string, rest: string): string =>
  `INSERT INTO deposit_entries (id, tenancy_id, date, kind, amount_cents, purpose, payment_id) VALUES ('${id}', 't', ${rest})`

test('Kautionsbuchungen: Bedingungen der Tabelle', async () => {
  await withRaw((c) => {
    c.exec(insert('d1', `'2025-01-05', 'received', 240000, NULL, NULL`))
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'received', 0, NULL, NULL`)), /deposit_entries_amount_positive/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'received', -100, NULL, NULL`)), /deposit_entries_amount_positive/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'foo', 100, NULL, NULL`)), /deposit_entries_kind_known/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'retained', 100, NULL, NULL`)), /deposit_entries_kind_known/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'received', 100, 'damage', NULL`)), /deposit_entries_purpose_valid/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'applied', 100, NULL, NULL`)), /deposit_entries_purpose_valid/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'applied', 100, 'foo', NULL`)), /deposit_entries_purpose_known/)
    assert.throws(() => c.exec(insert('x', `'2025-01-05', 'applied', 100, 'damage', 'p'`)), /deposit_entries_payment_valid/)
    assert.throws(() => c.exec(insert('x', `'05.01.2025', 'received', 100, NULL, NULL`)), /deposit_entries_date_valid/)
    c.exec(insert('d2', `'2025-06-01', 'applied', 30000, 'rent', 'p'`))
    c.exec(insert('d3', `'2025-07-01', 'applied', 5000, 'damage', NULL`))
    assert.equal(c.rows('SELECT id FROM deposit_entries ORDER BY rowid').length, 3)
  })
})

test('Kautionsbuchungen: mit der verwiesenen Zahlung und mit dem Mietverhältnis fällt die Buchung weg', async () => {
  await withRaw((c) => {
    c.exec(insert('d1', `'2025-01-05', 'received', 240000, NULL, NULL`))
    c.exec(insert('d2', `'2025-06-01', 'applied', 30000, 'rent', 'p'`))
    c.exec(`DELETE FROM payments WHERE id = 'p'`)
    assert.deepEqual(c.rows('SELECT id FROM deposit_entries ORDER BY rowid'), [['d1']])
    c.exec(`DELETE FROM tenancies WHERE id = 't'`)
    assert.deepEqual(c.rows('SELECT id FROM deposit_entries'), [])
  })
})

test('Kautionsbuchungen: gelesen in Einfügereihenfolge, leere Felder fehlen', async () => {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01' })
      await db.insert(depositEntries).values([
        { id: 'b', tenancyId: 't', date: '2025-03-01', kind: 'received', amountCents: 80000, purpose: null, paymentId: null, note: null },
        { id: 'a', tenancyId: 't', date: '2025-02-01', kind: 'applied', amountCents: 5000, purpose: 'damage', paymentId: null, note: 'Tür' },
      ])
      assert.deepEqual(await readDepositEntries(db), [
        { id: 'b', tenancyId: 't', date: '2025-03-01', kind: 'received', amountCents: 80000 },
        { id: 'a', tenancyId: 't', date: '2025-02-01', kind: 'applied', amountCents: 5000, purpose: 'damage', note: 'Tür' },
      ])
    })
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Form der Sicherheit: am Mietverhältnis gespeichert, null leert, Unbekanntes wird verworfen', async () => {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01', depositForm: 'pledged' })
      const form = async () => (await readTenancies(db)).find((x) => x.id === 't')?.depositForm
      assert.equal(await form(), 'pledged')
      // Ein Teilrumpf lässt die Angabe stehen.
      await updateEntity(db, 'tenancies', 't', { tenantName: 'Mieterin' })
      assert.equal(await form(), 'pledged')
      await updateEntity(db, 'tenancies', 't', { depositForm: 'foo' })
      assert.equal(await form(), undefined)
      await updateEntity(db, 'tenancies', 't', { depositForm: 'guarantee' })
      await updateEntity(db, 'tenancies', 't', { depositForm: null })
      assert.equal(await form(), undefined)
    })
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
