// Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal (#208, Entwurf 3.4, 3.10, 5.3): die
// Spalten nach 0016/0017 und die Schreibprüfungen. Das Aufteilen einer Rechnung über zwei
// Zeiträume prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { createEntity, findEntity, PeriodError, updateEntity } from '../src/db/repository.ts'
import { periodChanges, properties } from '../src/db/schema.ts'
import { formatDayRange, spansTwoYears } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-leistung-'))

function rejects(connection: Connection, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Einen Rhythmus setzt in dieser Datei die Datenbank selbst; die Bedienung prüft db-wechsel.test.ts.
const setRules = (opened: OpenedDatabase, startMonth: number, changes: string[]) =>
  opened.write(async (db) => {
    await db.update(properties).set({ periodStartMonth: startMonth }).where(eq(properties.id, 'objekt-1'))
    for (const fromMonth of changes) await db.insert(periodChanges).values({ propertyId: 'objekt-1', fromMonth })
  })

const item = (over: Record<string, unknown>) => ({ propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 48000, key: 'area', ...over })
const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)

test('Kette: 0016 und 0017 bringen vier nullbare Spalten, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag === '0016_leistungszeitraum')
    if (bis < 0) assert.fail('Schritt 0016_leistungszeitraum fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('alt', 'objekt-1', '2024-01', 'Grundsteuer', 'G', 100, 'area')`)
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT service_from, service_to, tax_year, heating_part FROM cost_items WHERE id = 'alt'"), [[null, null, null, null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Leistungszeitraum paarweise, geordnet und als Datum, Jahr 1900 bis 2200, Brennstoff nur bei Heizkosten', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const insert = (id: string, columns: string, values: string, category = 'Grundsteuer') =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${columns}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'G', 1, 'area'${values})`
    assert.equal(rejects(c, insert('ok', ', service_from, service_to, tax_year', ", '2025-01-01', '2025-12-31', 2025")), null)
    assert.match(rejects(c, insert('a', ', service_from', ", '2025-01-01'")) ?? '', /cost_items_service_complete/)
    assert.match(rejects(c, insert('b', ', service_from, service_to', ", '2025-12-31', '2025-01-01'")) ?? '', /cost_items_service_order_valid/)
    assert.match(rejects(c, insert('c', ', service_from, service_to', ", '01.01.2025', '31.12.2025'")) ?? '', /cost_items_service_from_valid/)
    assert.match(rejects(c, insert('d', ', tax_year', ', 1899')) ?? '', /cost_items_tax_year_valid/)
    assert.match(rejects(c, insert('e', ', heating_part', ", 'kohle'", 'Heizung und Warmwasser')) ?? '', /cost_items_heating_part_known/)
    assert.match(rejects(c, insert('f', ', heating_part', ", 'fuel'")) ?? '', /cost_items_heating_part_category_valid/)
    assert.equal(rejects(c, insert('g', ', heating_part', ", 'fuel'", 'Heizung und Warmwasser')), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Kalenderobjekt: ein Leistungszeitraum im eigenen Jahr wird gespeichert, ohne Jahr der Zahlung und ohne Aufteilen (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    const gespeichert = await opened.write((db) => createEntity(db, 'costItems', 'w', item({ category: 'Wasser/Abwasser', description: 'Wasser 2025', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })))
    assert.deepEqual([fieldOf(gespeichert, 'serviceFrom'), fieldOf(gespeichert, 'serviceTo'), fieldOf(gespeichert, 'taxYear')], ['2025-01-01', '2025-12-31', undefined])
    // Ein Jahr der Zahlung, das dem Kalenderjahr gleicht, ist erlaubt; ein anderes nicht (Entwurf 3.10: „ist es dieses“).
    await opened.write((db) => updateEntity(db, 'costItems', 'w', { taxYear: 2025 }))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'w', { taxYear: 2026 })),
      (err: unknown) => err instanceof PeriodError && /liegt im Kalenderjahr 2025/.test(err.message))
    // Ohne Leistungszeitraum ändert sich nichts gegenüber heute.
    const ohne = await opened.write((db) => createEntity(db, 'costItems', 'g', item({})))
    assert.equal(fieldOf(ohne, 'serviceFrom'), undefined)
  })
})

test('Leistungszeitraum: beide oder keines, geordnet, als Datum; geleert wird mit null', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ serviceFrom: '2025-01-01' }))),
      (err: unknown) => err instanceof PeriodError && /fehlt ein Ende des Leistungszeitraums/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'b', item({ serviceFrom: '2025-12-31', serviceTo: '2025-01-01' }))),
      (err: unknown) => err instanceof PeriodError && /endet vor seinem Beginn/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c', item({ serviceFrom: '1.1.2025', serviceTo: '31.12.2025' }))),
      (err: unknown) => err instanceof PeriodError && /kein gültiges Datum/.test(err.message))
    await opened.write((db) => createEntity(db, 'costItems', 'd', item({ serviceFrom: '2025-01-01', serviceTo: '2025-06-30' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'd', { serviceFrom: null, serviceTo: null }))
    const d = await opened.read((db) => findEntity(db, 'costItems', 'd'))
    assert.deepEqual([fieldOf(d, 'serviceFrom'), fieldOf(d, 'serviceTo')], [undefined, undefined])
  })
})

test('Brennstoff/Energie nur bei der Kostenart „Heizung und Warmwasser“', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ heatingPart: 'fuel' }))),
      (err: unknown) => err instanceof PeriodError && /nur bei der Kostenart „Heizung und Warmwasser“/.test(err.message))
    const gas = await opened.write((db) => createEntity(db, 'costItems', 'b', item({ category: 'Heizung und Warmwasser', description: 'Gas', heatingPart: 'fuel' })))
    assert.equal(fieldOf(gas, 'heatingPart'), 'fuel')
    // Ein unbekannter Wert hat keine Spalte und kommt nicht an (#60).
    const fremd = await opened.write((db) => createEntity(db, 'costItems', 'c', item({ category: 'Heizung und Warmwasser', description: 'Gas', heatingPart: 'kohle' })))
    assert.equal(fieldOf(fremd, 'heatingPart'), undefined)
  })
})

test('Mai bis April: Das Jahr der Zahlung ist Pflicht und liegt zwischen Beginn und Ende + 1', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 5, [])
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ period: '2025-05' }))),
      (err: unknown) => err instanceof PeriodError && /reicht über zwei Kalenderjahre/.test(err.message) && /Jahr der Zahlung/.test(err.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'b', item({ period: '2025-05', taxYear: 2028 }))),
      (err: unknown) => err instanceof PeriodError && /zwischen 2025 und 2027/.test(err.message))
    const ok = await opened.write((db) => createEntity(db, 'costItems', 'c', item({ period: '2025-05', taxYear: 2026 })))
    assert.equal(fieldOf(ok, 'taxYear'), 2026)
  })
})

test('Eine kalte Rechnung über zwei Zeiträume wird nicht als eine Position angenommen; eine Heizrechnung schon', async () => {
  await withDatabase(async (opened) => {
    await setRules(opened, 1, ['2025-05'])
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a', item({ serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }))),
      (err: unknown) => err instanceof PeriodError && /betrifft die Abrechnungszeiträume 01\.01\.–30\.04\.2025 und 2025\/2026/.test(err.message) && /„Aufteilen und speichern“/.test(err.message))
    // Heizkosten werden nicht nach Tagen geteilt (G-C1); die Abrechnung warnt (Task 5).
    const heizung = await opened.write((db) => createEntity(db, 'costItems', 'b', item({ category: 'Heizung und Warmwasser', description: 'Wartung', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })))
    assert.equal(fieldOf(heizung, 'serviceTo'), '2025-12-31')
    // Ein Leistungszeitraum ganz in einem anderen Zeitraum ist erlaubt (Abflussprinzip bleibt möglich); die Abrechnung warnt.
    await opened.write((db) => createEntity(db, 'costItems', 'c', item({ serviceFrom: '2024-01-01', serviceTo: '2024-12-31' })))
  })
})

test('shared/period.ts: zwei Kalenderjahre und die Bezeichnung einer Tagesspanne', () => {
  assert.equal(spansTwoYears({ from: '2025-05-01', to: '2026-04-30' }), true)
  assert.equal(spansTwoYears({ from: '2025-01-01', to: '2025-04-30' }), false)
  assert.equal(formatDayRange('2025-01-01', '2025-04-30'), '01.01.–30.04.2025')
  assert.equal(formatDayRange('2025-11-01', '2026-04-30'), '01.11.2025–30.04.2026')
  assert.equal(formatDayRange('2025-03-15', '2025-03-15'), '15.03.2025')
})
