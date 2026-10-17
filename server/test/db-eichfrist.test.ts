// Eichfrist der Zähler (Heizung PR 21, #98): die Spalte meters.calibrated_until, ihre Bedingungen und das
// Schreiben über repository.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { createEntity, findEntity, HeatingError, updateEntity } from '../src/db/repository.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-eichfrist-'))

function rejects(connection: Connection, statement: string): string | null {
  try {
    connection.exec(statement)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)
const zaehler = (over: Record<string, unknown> = {}) => ({ propertyId: 'objekt-1', name: 'Kaltwasser Haus', unitId: null, type: 'kaltwasser', unit: 'm³', ...over })

test('Kette: die Schritte eichfrist und eichfrist_bedingungen bringen eine nullbare Spalte, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_eichfrist'))
    if (bis < 0) assert.fail('Schritt …_eichfrist fehlt')
    assert.ok(migrations[bis + 1]?.tag.endsWith('_eichfrist_bedingungen'), 'die Bedingungen folgen unmittelbar')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 50, 1)")
    connection.exec("INSERT INTO meters (id, property_id, name, type, unit) VALUES ('alt', 'objekt-1', 'Alt', 'kaltwasser', 'm³')")
    connection.exec("INSERT INTO meters (id, property_id, name, unit_id, type, unit, hca_scale, rating_factor) VALUES ('hkv', 'objekt-1', 'HKV', 'u1', 'hkv', 'Einheiten', 'unit', 1.25)")
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT id, calibrated_until, rating_factor FROM meters ORDER BY id"), [['alt', null, null], ['hkv', null, 1.25]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: vierstellige ganze Jahreszahl, nie an einem Heizkostenverteiler', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 50, 1)")
    const insert = (id: string, type: string, unitId: string | null, until: string) =>
      `INSERT INTO meters (id, property_id, name, unit_id, type, unit, calibrated_until) VALUES ('${id}', 'objekt-1', '${id}', ${unitId === null ? 'NULL' : `'${unitId}'`}, '${type}', 'x', ${until})`
    assert.equal(rejects(c, insert('kw', 'kaltwasser', null, '2027')), null)
    assert.equal(rejects(c, insert('wz', 'waerme', 'u1', '2030')), null)
    assert.equal(rejects(c, insert('st', 'strom', null, '2031')), null)
    assert.equal(rejects(c, insert('leer', 'kaltwasser', null, 'NULL')), null)
    assert.match(rejects(c, insert('kurz', 'kaltwasser', null, '27')) ?? '', /meters_calibrated_until_valid/)
    assert.match(rejects(c, insert('lang', 'kaltwasser', null, '20270')) ?? '', /meters_calibrated_until_valid/)
    assert.match(rejects(c, insert('bruch', 'kaltwasser', null, '2027.5')) ?? '', /meters_calibrated_until_valid/)
    assert.match(rejects(c, insert('text', 'kaltwasser', null, "'bis 2027'")) ?? '', /meters_calibrated_until_valid/)
    assert.match(rejects(c, insert('hkv', 'hkv', 'u1', '2027')) ?? '', /meters_calibrated_until_hca_valid/)
    assert.equal(rejects(c, insert('hkv2', 'hkv', 'u1', 'NULL')), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: das Eichjahr wird gespeichert, bleibt bei einem Teilrumpf, wird geändert und geleert', async () => {
  await withDatabase(async (opened) => {
    const z = await opened.write((db) => createEntity(db, 'meters', 'm1', zaehler({ calibratedUntil: 2027 })))
    assert.equal(fieldOf(z, 'calibratedUntil'), 2027)
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { name: 'Kaltwasser Keller' }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'meters', 'm1')), 'calibratedUntil'), 2027, 'ein Teilrumpf ohne das Feld behält es')
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: 2033 }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'meters', 'm1')), 'calibratedUntil'), 2033)
    await opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: null }))
    const geleert = await opened.read((db) => findEntity(db, 'meters', 'm1'))
    assert.equal(fieldOf(geleert, 'calibratedUntil'), undefined)
    assert.ok(geleert !== null && !Object.hasOwn(Object(geleert), 'calibratedUntil'), 'ohne Angabe steht der Schlüssel nicht da')
  })
})

test('Schreiben: unbrauchbare Jahreszahl wird mit einem Satz abgelehnt', async () => {
  await withDatabase(async (opened) => {
    for (const bad of [27, 2027.5, '2027', -2027, 10000, Number.NaN, true]) {
      await assert.rejects(
        opened.write((db) => createEntity(db, 'meters', `m-${String(bad)}`, zaehler({ calibratedUntil: bad }))),
        (e: unknown) => e instanceof HeatingError && e.status === 400 && /Eichjahr ist keine Jahreszahl/.test(e.message),
        String(bad),
      )
    }
  })
})

test('Review Focus 4: Heizkostenverteiler ohne Eichjahr; beim Umstellen fällt es weg, ausdrücklich gesendet gibt es 400', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }))
    await opened.write((db) => createEntity(db, 'meters', 'm1', zaehler({ name: 'Wärme EG', unitId: 'u1', type: 'waerme', unit: 'kWh', calibratedUntil: 2027 })))
    const umgestellt = await opened.write((db) => updateEntity(db, 'meters', 'm1', { type: 'hkv', unit: 'Einheiten' }))
    assert.equal(fieldOf(umgestellt, 'calibratedUntil'), undefined)
    await assert.rejects(
      opened.write((db) => updateEntity(db, 'meters', 'm1', { calibratedUntil: 2030 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Heizkostenverteiler sind keine eichpflichtigen Messgeräte/.test(e.message),
    )
    await assert.rejects(
      opened.write((db) => createEntity(db, 'meters', 'm2', zaehler({ name: 'HKV', unitId: 'u1', type: 'hkv', unit: 'Einheiten', calibratedUntil: 2030 }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Heizkostenverteiler sind keine eichpflichtigen Messgeräte/.test(e.message),
    )
    // Ein leeres Feld beim Heizkostenverteiler ist keine Angabe und wird angenommen (alter Tab, Formular).
    const leer = await opened.write((db) => createEntity(db, 'meters', 'm3', zaehler({ name: 'HKV 2', unitId: 'u1', type: 'hkv', unit: 'Einheiten', calibratedUntil: null })))
    assert.equal(fieldOf(leer, 'calibratedUntil'), undefined)
  })
})
