// Mehrere Objekte (#92): der Umstieg eines vorhandenen Bestands in „Objekt 1“.
//
// Geprüft wird die Migrationskette selbst, auf einer Datenbank, die auf dem Stand von 0000 steht
// und einen gewachsenen Bestand trägt. So sieht die Datei jedes Nutzers von v0.8.0 aus, wenn er
// die neue Version zum ersten Mal startet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { backupBeforeMigrating, databaseFile, openDatabase } from '../src/db/open.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-objekte-'))

// Die Datenbank eines Nutzers von v0.8.0: nur Schritt 0000, dazu ein Bestand.
async function databaseAtBaseline(file: string, options: { settings?: boolean } = {}): Promise<Connection> {
  const connection = await connect(file)
  const [baseline] = await loadMigrations()
  if (!baseline) assert.fail('Schritt 0000 fehlt')
  applyMigrations(connection, [baseline])
  if (options.settings !== false) {
    connection.exec(`INSERT INTO settings (id, house_name, address, landlord_name, iban, payment_deadline_days,
      ollama_url, ollama_model, ai_json_mode, ai_extra_instructions)
      VALUES (1, 'Musterstraße 1', '12345 Musterstadt', 'Erika Muster', 'DE00', 30,
      'http://localhost:11434', 'qwen', 'auto', '')`)
  }
  // Absichtlich nicht in alphabetischer Reihenfolge: Nach dem Neubau der Tabellen muss die
  // Reihenfolge des Anlegens erhalten sein, nicht irgendeine.
  connection.exec(`INSERT INTO units (id, name, area_m2, participates) VALUES ('w-z', 'Dach', 40, 1)`)
  connection.exec(`INSERT INTO units (id, name, area_m2, participates) VALUES ('w-a', 'EG', 60, 1)`)
  connection.exec(`INSERT INTO meters (id, name, unit_id, type, unit) VALUES ('m-haupt', 'Haus', NULL, 'kaltwasser', 'm³')`)
  connection.exec(`INSERT INTO meters (id, name, unit_id, type, unit) VALUES ('m-eg', 'EG', 'w-a', 'kaltwasser', 'm³')`)
  connection.exec(`INSERT INTO cost_items (id, year, category, description, amount_cents, key)
    VALUES ('k-1', 2025, 'Grundsteuer', 'Grundsteuer', 50000, 'area')`)
  connection.exec(`INSERT INTO closed_settlements (id, year, closed_at, settlement)
    VALUES ('a-1', 2024, '2025-03-01T00:00:00Z', '{}')`)
  return connection
}

const column = (connection: Connection, sql: string): unknown[] => connection.rows(sql).map((row) => row[0])

test('Objekt: der vorhandene Bestand landet in Objekt 1, benannt wie bisher das Haus', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())

    assert.deepEqual(connection.rows('SELECT id, name, kind, address, landlord_name, iban, payment_deadline_days FROM properties'), [
      ['objekt-1', 'Musterstraße 1', 'mfh', '12345 Musterstadt', null, null, null],
    ])
    for (const table of ['units', 'meters', 'cost_items', 'closed_settlements']) {
      assert.deepEqual(
        [...new Set(column(connection, `SELECT property_id FROM ${table}`))],
        ['objekt-1'],
        `jede Zeile in ${table} gehört zu Objekt 1`,
      )
    }
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: die Reihenfolge des Anlegens übersteht den Neubau der Tabellen', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    assert.deepEqual(column(connection, 'SELECT id FROM units ORDER BY rowid'), ['w-z', 'w-a'])
    assert.deepEqual(column(connection, 'SELECT id FROM meters ORDER BY rowid'), ['m-haupt', 'm-eg'])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: ohne gespeicherte Einstellungen entsteht Objekt 1 mit leerem Namen', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'), { settings: false })
    applyMigrations(connection, await loadMigrations())
    assert.deepEqual(connection.rows('SELECT id, name, address FROM properties'), [['objekt-1', '', '']])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: eine frische Datenbank hat genau ein Objekt', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    assert.deepEqual(column(connection, 'SELECT id FROM properties'), ['objekt-1'])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: eine Wohnung ohne Objekt gibt es nicht, und ein Objekt mit Wohnung lässt sich nicht löschen', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    assert.throws(() => connection.exec(`INSERT INTO units (id, name, area_m2, participates) VALUES ('w-neu', 'OG', 50, 1)`), /NOT NULL/)
    assert.throws(() => connection.exec(`DELETE FROM properties WHERE id = 'objekt-1'`), /FOREIGN KEY/)
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: dieselbe Jahreszahl darf je Objekt einmal abgeschlossen sein', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'))
    applyMigrations(connection, await loadMigrations())
    connection.exec(`INSERT INTO properties (id, name, kind, address) VALUES ('objekt-2', 'Gartenweg 3', 'mfh', '')`)
    connection.exec(`INSERT INTO closed_settlements (id, property_id, year, closed_at, settlement)
      VALUES ('a-2', 'objekt-2', 2024, '2025-03-01T00:00:00Z', '{}')`)
    assert.throws(() => connection.exec(`INSERT INTO closed_settlements (id, property_id, year, closed_at, settlement)
      VALUES ('a-3', 'objekt-2', 2024, '2025-03-01T00:00:00Z', '{}')`), /UNIQUE/)
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: vor dem Update liegt eine Sicherung des alten Stands daneben, und nur dann', async () => {
  const dir = tempDir()
  try {
    const file = databaseFile(dir)
    ;(await databaseAtBaseline(file)).close()

    const opened = await openDatabase({ dataDir: dir })
    opened.close()
    const sicherungen = fs.readdirSync(dir).filter((name) => name.includes('.vor-'))
    assert.deepEqual(sicherungen, ['mietfuchs.sqlite.vor-0001_objekte'])

    // Die Sicherung ist eine lesbare Datenbank auf dem alten Stand.
    const alt = await connect(path.join(dir, 'mietfuchs.sqlite.vor-0001_objekte'))
    assert.deepEqual(column(alt, 'SELECT count(*) FROM __drizzle_migrations'), [1])
    assert.deepEqual(column(alt, 'SELECT house_name FROM settings'), ['Musterstraße 1'])
    alt.close()

    // Ein zweiter Start hat nichts nachzuholen und legt nichts an.
    ;(await openDatabase({ dataDir: dir })).close()
    assert.equal(fs.readdirSync(dir).filter((name) => name.includes('.vor-')).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: eine frische Datenbank bekommt keine Sicherung', async () => {
  const dir = tempDir()
  try {
    ;(await openDatabase({ dataDir: dir })).close()
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('.vor-')), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Objekt: lässt sich die Sicherung nicht schreiben, meldet die Funktion das, statt still weiterzumachen', async () => {
  const dir = tempDir()
  try {
    const connection = await databaseAtBaseline(path.join(dir, 'db.sqlite'))
    // Ein Ziel in einem Ordner, den es nicht gibt: VACUUM INTO kann dort nicht schreiben.
    const unerreichbar = path.join(dir, 'fehlt', 'db.sqlite')
    const migrations = await loadMigrations()
    assert.throws(() => backupBeforeMigrating(connection, unerreichbar, migrations))
    // Und migriert ist nichts: Die Datenbank steht weiter auf Schritt 0000.
    assert.deepEqual(column(connection, 'SELECT count(*) FROM __drizzle_migrations'), [1])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
