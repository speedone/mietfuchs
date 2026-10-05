// Abrechnungszeitraum (#208): die Migration 0014/0015 auf einer Datenbank von 0.10.1 und die
// Zusicherungen danach. Dass dabei keine Zahl wandert, hält db-objekte.test.ts fest (jedes Fixture
// durch die ganze Kette); hier geht es um die Schlüssel selbst.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { placeAssessment } from '../src/db/assessments.ts'
import { assessments } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zeitraum-'))

// SQLite meldet eine verletzte Zusicherung mit ihrem Namen; `null` heißt angenommen.
function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Die Datenbank eines Nutzers von 0.10.1: alle Schritte bis 0013, dazu ein Bestand über mehrere
// Jahre mit allem, was ein Jahr trägt.
async function databaseAt0013(file: string): Promise<Connection> {
  const connection = await connect(file)
  const migrations = await loadMigrations()
  const bis = migrations.findIndex((m) => m.tag === '0014_zeitraum')
  if (bis < 0) assert.fail('Schritt 0014_zeitraum fehlt')
  applyMigrations(connection, migrations.slice(0, bis))
  connection.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)`)
  connection.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2023-01-01')`)
  connection.exec(`INSERT INTO prepayment_overrides (tenancy_id, year, amount_cents) VALUES ('t1', 2024, 170000), ('t1', 2025, 180000)`)
  connection.exec(`INSERT INTO cost_items (id, property_id, year, category, description, amount_cents, key) VALUES
    ('k-2023', 'objekt-1', 2023, 'Grundsteuer', 'Grundsteuer 2023', 48000, 'area'),
    ('k-2025', 'objekt-1', 2025, 'Grundsteuer', 'Grundsteuer 2025', 50000, 'area')`)
  connection.exec(`INSERT INTO closed_settlements (id, property_id, year, closed_at, settlement)
    VALUES ('a-2024', 'objekt-1', 2024, '2025-03-01T00:00:00Z', '{}')`)
  connection.exec(`INSERT INTO closed_settlement_history (id, property_id, year, closed_at, reopened_at, settlement)
    VALUES ('h-2023', 'objekt-1', 2023, '2024-03-01T00:00:00Z', '2024-04-01T00:00:00Z', '{}')`)
  connection.exec(`INSERT INTO assessments (id, file, property_id, year, requested_year, created_at) VALUES
    ('a-mit', 'mit.pdf', 'objekt-1', 2025, 2024, '2026-01-01T00:00:00Z'),
    ('a-ohne', 'ohne.pdf', NULL, 2025, 2024, '2026-01-01T00:00:00Z'),
    ('a-leer', 'leer.pdf', 'objekt-1', 2025, NULL, '2026-01-01T00:00:00Z')`)
  return connection
}

async function freshConnection(dir: string): Promise<Connection> {
  const connection = await connect(path.join(dir, 'db.sqlite'))
  applyMigrations(connection, await loadMigrations())
  return connection
}

test('Kette: Eine Datenbank von 0.10.1 bekommt Zeiträume, jedes Jahr wird sein Kalenderzeitraum', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAt0013(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    const rows = (sql: string) => connection.rows(sql)
    assert.deepEqual(rows('SELECT id, period FROM cost_items ORDER BY rowid'), [['k-2023', '2023-01'], ['k-2025', '2025-01']])
    assert.deepEqual(rows('SELECT tenancy_id, period, amount_cents FROM prepayment_overrides ORDER BY period'),
      [['t1', '2024-01', 170000], ['t1', '2025-01', 180000]])
    assert.deepEqual(rows('SELECT id, period FROM closed_settlements'), [['a-2024', '2024-01']])
    assert.deepEqual(rows('SELECT id, period FROM closed_settlement_history'), [['h-2023', '2023-01']])
    // Ein gewählter Zeitraum ist nur am Objekt bestimmt (G-B7); ohne Objekt entfällt er.
    assert.deepEqual(rows('SELECT id, requested_period FROM assessments ORDER BY id'), [['a-leer', null], ['a-mit', '2024-01'], ['a-ohne', null]])
    // Die Kalenderjahre des Belegs bleiben.
    assert.deepEqual(rows('SELECT id, year FROM assessments ORDER BY id'), [['a-leer', 2025], ['a-mit', 2025], ['a-ohne', 2025]])
    assert.deepEqual(rows('SELECT id, period_start_month FROM properties'), [['objekt-1', 1]])
    assert.deepEqual(rows('SELECT count(*) FROM period_changes'), [[0]])
    for (const table of ['cost_items', 'prepayment_overrides', 'closed_settlements', 'closed_settlement_history']) {
      const columns = rows(`PRAGMA table_info(${table})`).map((r) => r[1])
      assert.ok(!columns.includes('year'), `${table} hat noch eine Spalte year`)
      assert.ok(columns.includes('period'), `${table} hat keine Spalte period`)
    }
    assert.ok(!rows('PRAGMA table_info(assessments)').map((r) => r[1]).includes('requested_year'))
    assert.deepEqual(rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Monat 00 und 13, eine nackte Jahreszahl und ein gewählter Zeitraum ohne Objekt werden abgewiesen', async () => {
  const dir = tempDir()
  try {
    const c = await freshConnection(dir)
    const position = (id: string, period: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('${id}', 'objekt-1', '${period}', 'Grundsteuer', 'G', 100, 'area')`
    assert.equal(rejects(c, position('ok', '2025-05')), null)
    for (const bad of ['2025-00', '2025-13', '2025', '25-05', '2025-5']) {
      assert.match(rejects(c, position(`k-${bad}`, bad)) ?? '', /cost_items_period_valid/, bad)
    }
    assert.match(rejects(c, "INSERT INTO cost_items (id, property_id, category, description, amount_cents, key) VALUES ('ohne', 'objekt-1', 'G', 'G', 1, 'area')") ?? '', /NOT NULL/)
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)")
    c.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2025-01-01')")
    assert.match(rejects(c, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-13', 1)") ?? '', /prepayment_overrides_period_valid/)
    assert.match(rejects(c, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s', 'objekt-1', '2025-00', 'x', '{}')") ?? '', /closed_settlements_period_valid/)
    assert.match(rejects(c, "INSERT INTO closed_settlement_history (id, property_id, period, closed_at, reopened_at, settlement) VALUES ('h', 'objekt-1', '2025', 'x', 'y', '{}')") ?? '', /closed_settlement_history_period_valid/)
    assert.match(rejects(c, "INSERT INTO assessments (id, file, property_id, year, requested_period, created_at) VALUES ('a', 'a.pdf', NULL, 2025, '2025-01', 'x')") ?? '', /assessments_requested_period_with_property/)
    assert.match(rejects(c, "INSERT INTO assessments (id, file, property_id, year, requested_period, created_at) VALUES ('b', 'b.pdf', 'objekt-1', 2025, '2025-13', 'x')") ?? '', /assessments_requested_period_valid/)
    assert.match(rejects(c, 'UPDATE properties SET period_start_month = 13') ?? '', /properties_period_start_month_valid/)
    assert.match(rejects(c, 'UPDATE properties SET period_start_month = 0') ?? '', /properties_period_start_month_valid/)
    assert.match(rejects(c, "INSERT INTO period_changes (property_id, from_month) VALUES ('objekt-1', '2025-5')") ?? '', /period_changes_from_month_valid/)
    assert.equal(rejects(c, "INSERT INTO period_changes (property_id, from_month) VALUES ('objekt-1', '2025-05')"), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Eindeutig: je Objekt und Zeitraum ein Abschluss, je Mietverhältnis und Zeitraum eine Jahreskorrektur', async () => {
  const dir = tempDir()
  try {
    const c = await freshConnection(dir)
    c.exec("INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s1', 'objekt-1', '2025-01', 'x', '{}')")
    assert.match(rejects(c, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s2', 'objekt-1', '2025-01', 'y', '{}')") ?? '', /UNIQUE/)
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)")
    c.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2025-01-01')")
    c.exec("INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 1)")
    assert.match(rejects(c, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 2)") ?? '', /UNIQUE/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Lesen und Schreiben: Position, Jahreskorrektur und Objekt tragen ihren Zeitraum', async () => {
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', {
      unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2024-01': 1000, '2025': 2000 },
    }))
    const neu = await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area',
    }))
    const alt = await opened.write((db) => createEntity(db, 'costItems', 'c2', {
      propertyId: 'objekt-1', year: 2024, category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area',
    }))
    assert.equal(Reflect.get(neu, 'period'), '2025-01')
    assert.equal(Reflect.get(alt, 'period'), '2024-01', 'ein Tab von vor dem Update schickt year')
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.tenancies[0]?.prepaymentOverrides, { '2024-01': 1000, '2025-01': 2000 })
    assert.deepEqual(stock.properties.map((p) => p.periodRules), [{ startMonth: 1, changes: [] }])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Auswertung: ohne Objekt kein gewählter Zeitraum, mit Objekt der Kalenderzeitraum des gewählten Jahres', async () => {
  // Review Focus 2: Die Prüfbedingung „nur mit Objekt“ ließe das Lösen vom Objekt sonst scheitern.
  const dir = tempDir()
  const opened = await openDatabase({ dataDir: dir })
  try {
    await opened.write(async (db) => {
      await db.insert(assessments).values({ id: 'a1', file: 'a.pdf', propertyId: 'objekt-1', year: 2025, requestedPeriod: periodKey('2024-01'), createdAt: '2026-01-01T00:00:00Z' })
    })
    const stand = async () => {
      const [row] = await opened.read((db) => db.select().from(assessments))
      return [row?.propertyId, row?.year, row?.requestedPeriod]
    }
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { propertyId: null })), 'ok')
    assert.deepEqual(await stand(), [null, 2025, null])
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { year: 2023 })), 'ok')
    assert.deepEqual(await stand(), [null, 2023, null])
    assert.equal(await opened.write((db) => placeAssessment(db, 'a1', { propertyId: 'objekt-1', year: 2024 })), 'ok')
    assert.deepEqual(await stand(), ['objekt-1', 2024, '2024-01'])
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
