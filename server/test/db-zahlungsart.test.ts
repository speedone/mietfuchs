// Die Art einer Zahlung (#280) in der Datenbank: Spalte `kind` an `payments` mit Vorgabe „rent“ und
// Bedingung, und das Zusammenführen in repository.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readPayments } from '../src/db/read.ts'
import { createEntity, PaymentError, updateEntity } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zahlungsart-'))

test('Kette: Zahlungen von vor dem Schritt bekommen die Art „rent“, in ihrer Reihenfolge; die Bedingung kennt nur rent und settlement', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_zahlungsart'))
    if (bis < 0) assert.fail('Schritt …_zahlungsart fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents, note) VALUES ('p2', 't', '2025-02-03', 80000, NULL), ('p1', 't', '2025-01-03', -20000, 'Rücklastschrift')`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows('SELECT id, kind, amount_cents, note FROM payments ORDER BY rowid'), [
      ['p2', 'rent', 80000, null],
      ['p1', 'rent', -20000, 'Rücklastschrift'],
    ])
    c.exec("UPDATE payments SET kind = 'settlement' WHERE id = 'p1'")
    assert.throws(() => c.exec("UPDATE payments SET kind = 'deposit' WHERE id = 'p1'"), /payments_kind_known/)
    assert.throws(() => c.exec("UPDATE payments SET kind = NULL WHERE id = 'p1'"), /NOT NULL/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function withTenancy(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01' })
    })
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Repository: ohne Art ist es Miete, die Art wird gespeichert, ein Teilrumpf lässt sie stehen', async () => {
  await withTenancy(async (opened) => {
    await opened.write(async (db) => {
      assert.equal((await createEntity(db, 'payments', 'p1', { tenancyId: 't', date: '2025-01-03', amountCents: 80000 }) as { kind: string }).kind, 'rent')
      await createEntity(db, 'payments', 'p2', { tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'settlement' })
      // Ein Teilrumpf ohne `kind` ändert die Art nicht.
      await updateEntity(db, 'payments', 'p2', { note: 'Guthaben 2024' })
      // Ausdrücklich zurück auf Miete geht.
      await updateEntity(db, 'payments', 'p1', { kind: 'settlement' })
      await updateEntity(db, 'payments', 'p1', { kind: 'rent' })
    })
    const payments = await opened.read((db) => readPayments(db))
    assert.deepEqual(payments.map((p) => [p.id, p.kind, p.note ?? null]), [['p1', 'rent', null], ['p2', 'settlement', 'Guthaben 2024']])
  })
})

test('Repository: eine unbekannte Art wird mit deutscher Meldung abgelehnt, nichts wird gespeichert', async () => {
  await withTenancy(async (opened) => {
    for (const kind of ['deposit', null, 1, '']) {
      await assert.rejects(
        opened.write((db) => createEntity(db, 'payments', 'px', { tenancyId: 't', date: '2025-01-03', amountCents: 100, kind })),
        (e: unknown) => e instanceof PaymentError && e.status === 400 && /Unbekannte Art der Zahlung/.test(e.message),
      )
    }
    await opened.write((db) => createEntity(db, 'payments', 'p', { tenancyId: 't', date: '2025-01-03', amountCents: 100, kind: 'settlement' }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'payments', 'p', { kind: 'kaution' })), PaymentError)
    const payments = await opened.read((db) => readPayments(db))
    assert.deepEqual(payments.map((p) => [p.id, p.kind]), [['p', 'settlement']])
  })
})
