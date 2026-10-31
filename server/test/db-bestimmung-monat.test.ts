// Der Monat laut Verwendungszweck (#281, § 366 Abs. 1 BGB) in der Datenbank: Spalte `designated_month` an `payments`
// (Schritte 0078/0079) mit Bedingung „JJJJ-MM“, und das Zusammenführen und Prüfen in repository.ts. Entwurf
// docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md, E3 und „Daten“.
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
import type { Payment } from '../../shared/types.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-bestimmung-'))

test('Kette: Zahlungen von vor dem Schritt bekommen keinen Monat (NULL), in ihrer Reihenfolge; die Bedingung lässt nur JJJJ-MM zu', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_bestimmung_monat'))
    if (bis < 0) assert.fail('Schritt …_bestimmung_monat fehlt')
    assert.equal(migrations[bis + 1]?.tag.endsWith('_bestimmung_monat_bedingung'), true, 'die Bedingung folgt unmittelbar')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2025-01-01')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents, note, kind) VALUES ('p2', 't', '2025-02-03', 80000, NULL, 'rent'), ('p1', 't', '2025-01-03', -20000, 'Rücklastschrift', 'settlement')`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows('SELECT id, kind, amount_cents, note, designated_month FROM payments ORDER BY rowid'), [
      ['p2', 'rent', 80000, null, null],
      ['p1', 'settlement', -20000, 'Rücklastschrift', null],
    ])
    c.exec("UPDATE payments SET designated_month = '2025-02' WHERE id = 'p2'")
    for (const bad of ['2025-13', '2025-00', '2025-2', '02.2025', '2025-02-01', '']) {
      assert.throws(() => c.exec(`UPDATE payments SET designated_month = '${bad}' WHERE id = 'p2'`), /payments_designated_month_valid/, bad)
    }
    c.exec("UPDATE payments SET designated_month = NULL WHERE id = 'p2'")
    // Der Neubau hält die übrigen Bedingungen und den Fremdschlüssel.
    assert.throws(() => c.exec("UPDATE payments SET kind = 'deposit' WHERE id = 'p1'"), /payments_kind_known/)
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
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter', persons: 1, start: '2025-01-01', end: '2025-12-31' })
    })
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const monthsOf = (payments: Payment[]): [string, string | null][] => payments.map((p) => [p.id, p.designatedMonth ?? null])

test('Repository: Monat setzen, ein Teilrumpf lässt ihn stehen, null und leer entfernen ihn', async () => {
  await withTenancy(async (opened) => {
    await opened.write(async (db) => {
      const p = await createEntity(db, 'payments', 'p1', { tenancyId: 't', date: '2025-03-03', amountCents: 80000, designatedMonth: '2025-02' }) as Payment
      assert.equal(p.designatedMonth, '2025-02')
      await createEntity(db, 'payments', 'p2', { tenancyId: 't', date: '2025-04-03', amountCents: 80000 })
      await createEntity(db, 'payments', 'p3', { tenancyId: 't', date: '2025-05-03', amountCents: 80000, designatedMonth: '2025-05' })
      await updateEntity(db, 'payments', 'p1', { note: 'Miete Februar' })
      await updateEntity(db, 'payments', 'p2', { designatedMonth: '2025-04' })
      await updateEntity(db, 'payments', 'p2', { designatedMonth: null })
      await updateEntity(db, 'payments', 'p3', { designatedMonth: '' })
    })
    assert.deepEqual(monthsOf(await opened.read((db) => readPayments(db))), [['p1', '2025-02'], ['p2', null], ['p3', null]])
  })
})

test('Repository: an einer Zahlung aus der Abrechnung, außerhalb des Mietverhältnisses oder in falscher Form 400, nichts wird gespeichert', async () => {
  await withTenancy(async (opened) => {
    await opened.write((db) => createEntity(db, 'payments', 'p', { tenancyId: 't', date: '2025-03-03', amountCents: 80000 }))
    await opened.write((db) => createEntity(db, 'payments', 's', { tenancyId: 't', date: '2025-06-15', amountCents: -20000, kind: 'settlement' }))
    const rejects = async (work: Parameters<OpenedDatabase['write']>[0], pattern: RegExp) => {
      await assert.rejects(opened.write(work), (e: unknown) => e instanceof PaymentError && e.status === 400 && pattern.test(e.message))
    }
    const settlement = /Eine Zahlung aus der Abrechnung gilt dem Saldo, nicht einem Monat\./
    await rejects((db) => updateEntity(db, 'payments', 's', { designatedMonth: '2025-06' }), settlement)
    await rejects((db) => createEntity(db, 'payments', 'x', { tenancyId: 't', date: '2025-06-15', amountCents: 100, kind: 'settlement', designatedMonth: '2025-06' }), settlement)
    // Die Art auf „Abrechnung“ umstellen, während ein Monat eingetragen ist: ebenso.
    await opened.write((db) => updateEntity(db, 'payments', 'p', { designatedMonth: '2025-03' }))
    await rejects((db) => updateEntity(db, 'payments', 'p', { kind: 'settlement' }), settlement)
    // Beides zugleich umstellen geht.
    await opened.write((db) => updateEntity(db, 'payments', 'p', { kind: 'settlement', designatedMonth: null }))
    await opened.write((db) => updateEntity(db, 'payments', 'p', { kind: 'rent' }))
    const outside = /Das Mietverhältnis besteht von 01\.01\.2025 bis 31\.12\.2025\./
    await rejects((db) => updateEntity(db, 'payments', 'p', { designatedMonth: '2024-12' }), outside)
    await rejects((db) => updateEntity(db, 'payments', 'p', { designatedMonth: '2026-01' }), outside)
    for (const bad of ['2025-13', '03.2025', 'März', 202503]) {
      await rejects((db) => updateEntity(db, 'payments', 'p', { designatedMonth: bad }), /Monat laut Verwendungszweck/)
    }
    assert.deepEqual(monthsOf(await opened.read((db) => readPayments(db))), [['p', null], ['s', null]])
  })
})

test('Repository: ändert sich später das Ende, bleibt ein herausgefallener Monat stehen (krumm, nicht kaputt)', async () => {
  await withTenancy(async (opened) => {
    await opened.write((db) => createEntity(db, 'payments', 'p', { tenancyId: 't', date: '2025-11-03', amountCents: 80000, designatedMonth: '2025-11' }))
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { end: '2025-10-31' }))
    // Eine andere Angabe an der Zahlung lässt sich weiter ändern.
    await opened.write((db) => updateEntity(db, 'payments', 'p', { note: 'Miete November' }))
    assert.deepEqual(monthsOf(await opened.read((db) => readPayments(db))), [['p', '2025-11']])
  })
})
