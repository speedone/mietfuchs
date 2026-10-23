// Das Änderungsjournal (#318, Schritte 2 und 3): Trigger, Gruppen, Aufbewahrung, Wächter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { connect } from '../src/db/client.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { changeGroups, changeLog, closedSettlements, meters, payments, properties, readings, tenancies, units } from '../src/db/schema.ts'
import { JOURNAL_KEEP_MONTHS, OMITTED_COLUMNS, TRIGGER_PREFIX, collapse, journalGroup, listJournal, type JournalMeta } from '../src/db/journal.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { calendarPeriod } from '../../shared/period.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-journal-'))

const meta = (description = 'Test', scope: object = {}): JournalMeta => ({
  method: 'POST', route: '/test', description, subjectTable: null, scope,
})

async function withDb<T>(fn: (opened: OpenedDatabase) => Promise<T>): Promise<T> {
  const dir = tmp()
  const opened = await openFreshDatabase(dir)
  try {
    return await fn(opened)
  } finally {
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function stock(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG links', areaM2: 60, participates: true, selfUsed: false })
    await db.insert(tenancies).values({ id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-01-01' })
    await db.insert(meters).values({ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' })
    await db.insert(readings).values({ id: 'r1', meterId: 'm1', date: '2024-01-01', value: 10 })
    await db.insert(payments).values({ id: 'p1', tenancyId: 't1', date: '2024-02-01', amountCents: 50000 })
  })
}

const allLog = (opened: OpenedDatabase) => opened.read((db) => db.select().from(changeLog).orderBy(changeLog.id).all())
const allGroups = (opened: OpenedDatabase) => opened.read((db) => db.select().from(changeGroups).orderBy(changeGroups.id).all())

test('Journal: ohne Angabe zur Gruppe wird nichts erfasst', () => withDb(async (opened) => {
  await stock(opened)
  assert.deepEqual(await allLog(opened), [])
  assert.deepEqual(await allGroups(opened), [])
}))

test('Journal: Einfügen, Ändern und Löschen stehen mit Vorher und Nachher in einer Gruppe', () => withDb(async (opened) => {
  await opened.write(async (db) => {
    await db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true, selfUsed: false })
    await db.update(units).set({ name: 'EG links' }).where(eq(units.id, 'u1'))
    await db.delete(units).where(eq(units.id, 'u1'))
  }, meta('Wohnung'))
  const groups = await allGroups(opened)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].description, 'Wohnung')
  assert.equal(groups[0].propertyId, 'objekt-1')
  assert.ok(groups[0].schemaSteps > 60)
  const log = await allLog(opened)
  assert.deepEqual(log.map((l) => [l.tableName, l.op]), [['units', 'insert'], ['units', 'update'], ['units', 'delete']])
  assert.deepEqual(JSON.parse(log[0].rowKey), { id: 'u1' })
  assert.equal(log[0].before, null)
  assert.equal(JSON.parse(log[0].after ?? '').name, 'EG')
  assert.equal(JSON.parse(log[1].before ?? '').name, 'EG')
  assert.equal(JSON.parse(log[1].after ?? '').name, 'EG links')
  // Der Vorher-Stand ist vollständig: jede Spalte der Tabelle.
  assert.deepEqual(Object.keys(JSON.parse(log[2].before ?? '')).sort(),
    ['area_m2', 'floor', 'id', 'mea', 'name', 'notes', 'participates', 'property_id', 'rooms', 'self_persons', 'self_used'])
  assert.equal(log[2].after, null)
}))

test('Journal: Ein Update ohne Änderung ergibt keine Zeile, eine leere Gruppe fällt weg', () => withDb(async (opened) => {
  await stock(opened)
  await opened.write((db) => db.update(units).set({ name: 'EG links' }).where(eq(units.id, 'u1')), meta())
  assert.deepEqual(await allLog(opened), [])
  assert.deepEqual(await allGroups(opened), [])
}))

test('Journal: Löschen einer Wohnung erfasst die Kaskade (Mietverhältnis, Zähler, Ablesung, Zahlung)', () => withDb(async (opened) => {
  await stock(opened)
  await opened.write((db) => db.delete(units).where(eq(units.id, 'u1')), meta('Wohnung gelöscht'))
  const log = await allLog(opened)
  const deleted = log.filter((l) => l.op === 'delete').map((l) => l.tableName).sort()
  assert.deepEqual(deleted, ['meters', 'payments', 'readings', 'tenancies', 'units'])
  assert.equal(JSON.parse(log.find((l) => l.tableName === 'tenancies')?.before ?? '{}').tenant_name, 'Müller')
  // Das Objekt ergibt sich auch für die mitgelöschten Zeilen, über die eben gelöschte Wohnung.
  const [group] = await allGroups(opened)
  assert.equal(group.propertyId, 'objekt-1')
}))

test('Journal: Eine zurückgerollte Transaktion hinterlässt weder Zeilen noch Gruppe', () => withDb(async (opened) => {
  await stock(opened)
  await assert.rejects(opened.write((db) => db.transaction(async (tx) => {
    await tx.update(units).set({ name: 'X' }).where(eq(units.id, 'u1'))
    throw new Error('Abbruch')
  }), meta()))
  assert.deepEqual(await allLog(opened), [])
  assert.deepEqual(await allGroups(opened), [])
}))

test('Journal: Zwei Schreibvorgänge derselben Anfrage bilden eine Gruppe, eine andere Anfrage eine neue', () => withDb(async (opened) => {
  await stock(opened)
  const request = {}
  await opened.write((db) => db.update(units).set({ name: 'A' }).where(eq(units.id, 'u1')), meta('eins', request))
  await opened.write((db) => db.update(units).set({ name: 'B' }).where(eq(units.id, 'u1')), meta('eins', request))
  await opened.write((db) => db.update(units).set({ name: 'C' }).where(eq(units.id, 'u1')), meta('zwei'))
  const groups = await allGroups(opened)
  assert.deepEqual(groups.map((g) => g.description), ['eins', 'zwei'])
  const log = await allLog(opened)
  assert.deepEqual(log.map((l) => l.groupId), [groups[0].id, groups[0].id, groups[1].id])
}))

test('Journal: Einstellungen sind installationsweit, mehrere Objekte ebenso', () => withDb(async (opened) => {
  await opened.write(async (db) => {
    await db.insert(properties).values({ id: 'objekt-2', name: 'Zweites', kind: 'mfh', address: '' })
  }, meta('Objekt'))
  await opened.write((db) => db.run(sql`INSERT INTO letter_texts (block, text) VALUES ('subject', 'Betreff')`), meta('Texte'))
  await opened.write(async (db) => {
    await db.insert(units).values({ id: 'a', propertyId: 'objekt-1', name: 'A', areaM2: 1, participates: true, selfUsed: false })
    await db.insert(units).values({ id: 'b', propertyId: 'objekt-2', name: 'B', areaM2: 1, participates: true, selfUsed: false })
  }, meta('Beide'))
  const groups = await allGroups(opened)
  assert.deepEqual(groups.map((g) => [g.description, g.propertyId]), [['Objekt', 'objekt-2'], ['Texte', null], ['Beide', null]])
  const listed = await opened.read((db) => listJournal(db, { propertyId: 'objekt-1', before: null, limit: 50 }))
  assert.deepEqual(listed.map((g) => g.description), ['Beide', 'Texte'])
  const page = await opened.read((db) => listJournal(db, { propertyId: null, before: listed[0].id, limit: 1 }))
  assert.deepEqual(page.map((g) => g.description), ['Texte'])
}))

test('Journal: Der eingefrorene Stand einer Abrechnung steht nur als Vermerk', () => withDb(async (opened) => {
  const frozen = { statements: Array.from({ length: 50 }, (_, i) => ({ i, text: 'x'.repeat(100) })) }
  await opened.write((db) => db.insert(closedSettlements).values({
    id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(2024), closedAt: '2025-01-10T00:00:00.000Z', settlement: frozen,
  }), meta())
  const [row] = await allLog(opened)
  const after = JSON.parse(row.after ?? '{}')
  assert.equal(after.settlement.$omitted, 1)
  assert.equal(after.settlement.length, JSON.stringify(frozen).length)
  assert.equal(after.period, '2024-01')
  assert.ok((row.after ?? '').length < 400)
}))

test('Journal: Der Verlauf fasst unverändert neu eingefügte Zeilen zusammen', () => {
  const base = { groupId: 1, tableName: 'person_history', rowKey: '{"tenancy_id":"t1","from":"2024-01-01"}' }
  const same = '{"tenancy_id":"t1","from":"2024-01-01","persons":2}'
  const views = collapse([
    { id: 1, ...base, op: 'delete', before: same, after: null },
    { id: 2, ...base, op: 'insert', before: null, after: same },
    { id: 3, ...base, rowKey: '{"tenancy_id":"t1","from":"2024-07-01"}', op: 'delete', before: '{"persons":3}', after: null },
    { id: 4, ...base, rowKey: '{"tenancy_id":"t1","from":"2024-07-01"}', op: 'insert', before: null, after: '{"persons":4}' },
  ])
  assert.equal(views.length, 1)
  assert.equal(views[0].op, 'update')
  assert.deepEqual(views[0].changed, ['persons'])
})

test('Journal: Einzelheiten einer Gruppe mit Überschrift aus der betroffenen Zeile', () => withDb(async (opened) => {
  await stock(opened)
  await opened.write((db) => db.delete(units).where(eq(units.id, 'u1')), { ...meta('Wohnung gelöscht'), subjectTable: 'units' })
  const [listed] = await opened.read((db) => listJournal(db, { propertyId: 'objekt-1', before: null, limit: 10 }))
  assert.equal(listed.title, 'Wohnung gelöscht: EG links')
  assert.equal(listed.rows, 5)
  const detail = await opened.read((db) => journalGroup(db, listed.id))
  assert.equal(detail?.changes.length, 5)
  assert.equal(await opened.read((db) => journalGroup(db, 999999)), null)
}))

// ---------- Wächter ----------

const rawRows = (opened: OpenedDatabase, query: string) => opened.read((db) => db.all<unknown[]>(sql.raw(query)))

test('Wächter: Jede Tabelle außer dem Journal hat ihre drei Trigger mit allen Spalten', () => withDb(async (opened) => {
  const rows = (query: string) => rawRows(opened, query)
  const names = (await rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => String(r[0]))
  const expected = names.filter((n) => !['change_groups', 'change_log', '__drizzle_migrations'].includes(n))
  assert.ok(expected.length >= 50, `nur ${expected.length} Tabellen`)
  const triggers = await rows(`SELECT name, tbl_name, sql FROM sqlite_temp_master WHERE type = 'trigger' AND name LIKE '${TRIGGER_PREFIX}%'`)
  for (const table of expected) {
    const own = triggers.filter((t) => t[1] === table)
    assert.deepEqual(own.map((t) => String(t[0])).sort(), ['delete', 'insert', 'update'].map((op) => `${TRIGGER_PREFIX}${table}_${op}`), table)
    const columns = (await rows(`PRAGMA table_info("${table}")`)).map((r) => String(r[1]))
    for (const t of own) {
      for (const column of columns) assert.ok(String(t[2]).includes(`'${column}'`), `${t[0]}: Spalte ${column} fehlt`)
    }
  }
  for (const table of Object.keys(OMITTED_COLUMNS)) assert.ok(expected.includes(table), table)
  // Nichts davon steht in der Datei: Die Trigger sind TEMP.
  assert.deepEqual(await rows("SELECT name FROM sqlite_master WHERE type = 'trigger'"), [])
}))

test('Wächter: Nach einem Neubau-Schritt (CREATE __new, kopieren, DROP, RENAME) sind die Trigger beim nächsten Öffnen wieder da', async () => {
  const dir = tmp()
  try {
    ;(await openFreshDatabase(dir)).close()
    // Ein Schritt, wie drizzle-kit ihn bei einer geänderten Bedingung schreibt, mit einer neuen Spalte.
    const c = await connect(databaseFile(dir))
    c.exec('PRAGMA foreign_keys = OFF')
    c.exec('CREATE TABLE "__new_letter_texts" ("block" text PRIMARY KEY NOT NULL, "text" text NOT NULL, "extra" text)')
    c.exec('INSERT INTO "__new_letter_texts" ("block", "text") SELECT "block", "text" FROM "letter_texts"')
    c.exec('DROP TABLE "letter_texts"')
    c.exec('ALTER TABLE "__new_letter_texts" RENAME TO "letter_texts"')
    c.close()
    const opened = await openDatabase({ dataDir: dir })
    try {
      const sqlText = await rawRows(opened, `SELECT sql FROM sqlite_temp_master WHERE name = '${TRIGGER_PREFIX}letter_texts_insert'`)
      assert.equal(sqlText.length, 1)
      assert.ok(String(sqlText[0][0]).includes("'extra'"))
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Journal: Die ganze Kette auf einer leeren Datei ergibt Journal und Trigger, nichts davon ist erfasst', async () => {
  const dir = tmp()
  try {
    const opened = await openDatabase({ dataDir: dir })
    try {
      assert.ok(opened.migrations > 60)
      assert.deepEqual(await allGroups(opened), [])
      assert.deepEqual(await allLog(opened), [])
      const triggers = await rawRows(opened, `SELECT count(*) FROM sqlite_temp_master WHERE type = 'trigger' AND name LIKE '${TRIGGER_PREFIX}%'`)
      assert.ok(Number(triggers[0][0]) > 150)
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Aufbewahrung ----------

test(`Aufbewahrung: Beim Öffnen fallen Gruppen älter als ${JOURNAL_KEEP_MONTHS} Monate samt Zeilen weg`, async () => {
  const dir = tmp()
  try {
    const opened = await openFreshDatabase(dir)
    await opened.write((db) => db.insert(units).values({ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 1, participates: true, selfUsed: false }), meta('neu'))
    await opened.write((db) => db.insert(units).values({ id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 1, participates: true, selfUsed: false }), meta('alt'))
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    await opened.write((db) => db.update(changeGroups).set({ at: old }).where(eq(changeGroups.description, 'alt')))
    opened.close()
    const again = await openDatabase({ dataDir: dir })
    try {
      assert.deepEqual((await allGroups(again)).map((g) => g.description), ['neu'])
      assert.equal((await allLog(again)).length, 1)
    } finally {
      again.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
