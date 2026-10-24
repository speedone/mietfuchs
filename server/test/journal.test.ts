// Das Änderungsjournal (#318, Schritte 2 und 3): Trigger, Gruppen, Aufbewahrung, Wächter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { connect } from '../src/db/client.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { changeGroups, changeLog, closedSettlements, meters, payments, properties, readings, tenancies, units, uploads } from '../src/db/schema.ts'
import { JOURNAL_KEEP_MONTHS, OMITTED_COLUMNS, TRIGGER_PREFIX, collapse, journalGroup, listJournal, pruneJournal, type JournalMeta } from '../src/db/journal.ts'
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

const list = (opened: OpenedDatabase, propertyId: string | null, before: number | null = null, limit = 50) =>
  opened.read((db) => listJournal(db, opened.journalSchema, { propertyId, before, limit }))
const detail = (opened: OpenedDatabase, id: number) => opened.read((db) => journalGroup(db, opened.journalSchema, id))

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
  assert.deepEqual((await list(opened, 'objekt-1')).map((g) => [g.description, g.propertyIds, g.installationWide]), [['Wohnung', ['objekt-1'], false]])
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
  const [group] = await list(opened, null)
  assert.deepEqual(group.propertyIds, ['objekt-1'])
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
  const all = await list(opened, null)
  assert.deepEqual(all.map((g) => [g.description, g.propertyIds, g.installationWide]),
    [['Beide', ['objekt-1', 'objekt-2'], false], ['Texte', [], true], ['Objekt', ['objekt-2'], false]])
  // Eine Gruppe über zwei Objekte steht bei beiden (K6), die Texte bei allen.
  assert.deepEqual((await list(opened, 'objekt-1')).map((g) => g.description), ['Beide', 'Texte'])
  assert.deepEqual((await list(opened, 'objekt-2')).map((g) => g.description), ['Beide', 'Texte', 'Objekt'])
  const page = await list(opened, null, all[0].id, 1)
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
  const [listed] = await list(opened, 'objekt-1', null, 10)
  assert.equal(listed.title, 'Wohnung gelöscht: EG links')
  assert.equal(listed.rows, 5)
  const shown = await detail(opened, listed.id)
  assert.equal(shown?.changes.length, 5)
  // Verweise tragen den Namen der Zeile, auch wenn sie mitgelöscht ist (K4)
  const tenancy = shown?.changes.find((c) => c.table === 'tenancies')
  assert.equal(tenancy?.refs['unit_id=u1'], 'EG links')
  const reading = shown?.changes.find((c) => c.table === 'readings')
  assert.equal(reading?.refs['meter_id=m1'], 'Wasser EG')
  assert.equal(await detail(opened, 999999), null)
}))

// ---------- Befunde der Durchsicht von PR #430 ----------

const sequenceOf = async (opened: OpenedDatabase): Promise<number> =>
  Number((await rawRows(opened, "SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'change_groups'), 0)"))[0][0])

test('Durchsicht S2: Ein Schreibvorgang ohne Änderung legt keine Gruppe an, auch nicht kurz', () => withDb(async (opened) => {
  await stock(opened)
  const before = await sequenceOf(opened)
  await opened.write((db) => db.update(units).set({ name: 'EG links' }).where(eq(units.id, 'u1')), meta())
  await assert.rejects(opened.write((db) => db.transaction(async (tx) => {
    await tx.update(units).set({ name: 'X' }).where(eq(units.id, 'u1'))
    throw new Error('Abbruch')
  }), meta()))
  assert.equal(await sequenceOf(opened), before)
  // Und eine echte Änderung bekommt die nächste Kennung.
  await opened.write((db) => db.update(units).set({ name: 'Y' }).where(eq(units.id, 'u1')), meta('echt'))
  assert.deepEqual((await allGroups(opened)).map((g) => [g.id, g.description]), [[before + 1, 'echt']])
}))

// Gefunden im Smoke-Test nach der Umstellung von S2: Im Rumpf eines Triggers gilt die Konfliktregel des äußeren
// Befehls. Ein Upsert machte aus dem Anlegen der Gruppe ein ABORT, ein REPLACE hätte sie samt Zeilen ersetzt.
test('Durchsicht S2: Upsert und REPLACE in einer Gruppe erfassen alles, die Gruppe bleibt eine', () => withDb(async (opened) => {
  const row = { file: 'a.pdf', originalName: 'a.pdf', mimeType: 'application/pdf', size: 1, sha256: 'x', uploadedAt: '2025-01-01T00:00:00.000Z', propertyId: null, year: null, invoiceDate: null, kind: 'receipt' as const }
  const request = {}
  await opened.write((db) => db.insert(uploads).values(row).onConflictDoUpdate({ target: uploads.file, set: { ...row } }), meta('eins', request))
  await opened.write((db) => db.insert(uploads).values({ ...row, sha256: 'y' }).onConflictDoUpdate({ target: uploads.file, set: { sha256: 'y' } }), meta('eins', request))
  await opened.write((db) => db.run(sql`INSERT OR REPLACE INTO letter_texts (block, text) VALUES ('subject', 'A')`), meta('eins', request))
  await opened.write((db) => db.run(sql`INSERT OR REPLACE INTO letter_texts (block, text) VALUES ('subject', 'B')`), meta('eins', request))
  const groups = await allGroups(opened)
  assert.equal(groups.length, 1)
  assert.deepEqual((await allLog(opened)).map((l) => [l.tableName, l.op]),
    [['uploads', 'insert'], ['uploads', 'update'], ['letter_texts', 'insert'], ['letter_texts', 'delete'], ['letter_texts', 'insert']])
}))

test('Durchsicht S4: Löschen und gleich wieder Einfügen ohne Unterschied ergibt keine Gruppe', () => withDb(async (opened) => {
  await opened.write((db) => db.run(sql`INSERT INTO letter_texts (block, text) VALUES ('subject', 'Betreff')`))
  await opened.write(async (db) => {
    await db.run(sql`DELETE FROM letter_texts`)
    await db.run(sql`INSERT INTO letter_texts (block, text) VALUES ('subject', 'Betreff')`)
  }, meta('Texte'))
  assert.deepEqual(await allGroups(opened), [])
  assert.deepEqual(await allLog(opened), [])
  // Mit Unterschied bleibt sie.
  await opened.write(async (db) => {
    await db.run(sql`DELETE FROM letter_texts`)
    await db.run(sql`INSERT INTO letter_texts (block, text) VALUES ('subject', 'Neu')`)
  }, meta('Texte'))
  assert.deepEqual((await list(opened, null)).map((g) => [g.description, g.rows]), [['Texte', 1]])
}))

test('Durchsicht S5: Ein BLOB bricht die Erfassung nicht ab, er steht hexadezimal da', async () => {
  const dir = tmp()
  try {
    ;(await openFreshDatabase(dir)).close()
    const c = await connect(databaseFile(dir))
    c.exec('CREATE TABLE "blob_probe" ("id" blob PRIMARY KEY NOT NULL, "data" blob)')
    c.close()
    const opened = await openDatabase({ dataDir: dir })
    try {
      await opened.write((db) => db.run(sql`INSERT INTO blob_probe (id, data) VALUES (${Buffer.from([1, 2])}, ${Buffer.from([255, 0])})`), meta())
      const [row] = await allLog(opened)
      assert.deepEqual(JSON.parse(row.rowKey), { id: { $blob: '0102' } })
      assert.deepEqual(JSON.parse(row.after ?? '{}').data, { $blob: 'FF00' })
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Durchsicht S6: Eine Gruppe, die ein Objekt löscht oder deren Objekt fehlt, ist installationsweit', () => withDb(async (opened) => {
  await opened.write((db) => db.insert(properties).values({ id: 'objekt-2', name: 'Zweites', kind: 'mfh', address: '' }), meta('Objekt angelegt'))
  await opened.write((db) => db.insert(units).values({ id: 'b', propertyId: 'objekt-2', name: 'B', areaM2: 1, participates: true, selfUsed: false }), meta('Wohnung angelegt'))
  await opened.write((db) => db.delete(units).where(eq(units.id, 'b')), meta('Wohnung gelöscht'))
  await opened.write((db) => db.delete(properties).where(eq(properties.id, 'objekt-2')), meta('Objekt gelöscht'))
  const shown = await list(opened, 'objekt-1')
  assert.deepEqual(shown.map((g) => [g.description, g.installationWide]),
    [['Objekt gelöscht', true], ['Wohnung gelöscht', true], ['Wohnung angelegt', true], ['Objekt angelegt', true]])
}))

test('Durchsicht K6: Wechselt eine Wohnung das Objekt, steht die Gruppe bei beiden', () => withDb(async (opened) => {
  await opened.write((db) => db.insert(properties).values({ id: 'objekt-2', name: 'Zweites', kind: 'mfh', address: '' }))
  await stock(opened)
  await opened.write((db) => db.update(units).set({ propertyId: 'objekt-2' }).where(eq(units.id, 'u1')), meta('verschoben'))
  for (const property of ['objekt-1', 'objekt-2']) {
    assert.deepEqual((await list(opened, property)).map((g) => g.description), ['verschoben'], property)
  }
}))

test('Durchsicht K5: Ändert sich nur eine Staffel, nennt die Überschrift trotzdem das Mietverhältnis', () => withDb(async (opened) => {
  await stock(opened)
  await opened.write((db) => db.run(sql`INSERT INTO prepayments (tenancy_id, "from", monthly_cents) VALUES ('t1', '2024-01', 15000)`),
    { ...meta('Mietverhältnis geändert'), subjectTable: 'tenancies' })
  assert.deepEqual((await list(opened, 'objekt-1')).map((g) => g.title), ['Mietverhältnis geändert: Müller'])
}))

test('Durchsicht S3: pruneJournal nimmt nur, was älter als die Frist ist', () => withDb(async (opened) => {
  await stock(opened)
  await opened.write((db) => db.update(units).set({ name: 'A' }).where(eq(units.id, 'u1')), meta('alt'))
  await opened.write((db) => db.update(units).set({ name: 'B' }).where(eq(units.id, 'u1')), meta('neu'))
  await opened.write((db) => db.update(changeGroups).set({ at: '2020-01-01T00:00:00.000Z' }).where(eq(changeGroups.description, 'alt')))
  assert.equal(await opened.write((db) => pruneJournal(db, new Date())), 1)
  assert.deepEqual((await allGroups(opened)).map((g) => g.description), ['neu'])
  assert.equal((await allLog(opened)).length, 1)
  assert.equal(await opened.write((db) => pruneJournal(db, new Date())), 0)
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
