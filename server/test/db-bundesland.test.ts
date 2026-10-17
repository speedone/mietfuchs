// Das Bundesland am Objekt (Fristen und Feiertage, shared/deadlines.ts): ein Bestand von vorher bleibt
// unbekannt, die Prüfbedingung kennt genau die 16 Kürzel, ihre Meldung ist ein Satz, und das Repository
// ergänzt nach Anwesenheit und lehnt ein fremdes Kürzel ab.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createProperty, HeatingError, updateProperty } from '../src/db/repository.ts'
import { databaseProblem } from '../src/db/errors.ts'
import { FEDERAL_STATES } from '../src/db/schema.ts'
import { STATE_CODES } from '../../shared/holidays.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-bundesland-'))

test('Kette: ein Objekt von vorher hat danach kein Bundesland, und die Bedingung kennt genau die 16', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_bundesland'))
    if (bis < 0) assert.fail('Schritt …_bundesland fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec("UPDATE properties SET name = 'Altbestand' WHERE id = 'objekt-1'")
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows("SELECT name, state FROM properties WHERE id = 'objekt-1'"), [['Altbestand', null]])
    for (const s of STATE_CODES) c.exec(`UPDATE properties SET state = '${s}' WHERE id = 'objekt-1'`)
    for (const falsch of ['XX', 'by', 'Bayern', '']) {
      assert.throws(() => c.exec(`UPDATE properties SET state = '${falsch}' WHERE id = 'objekt-1'`), /properties_state_known/, falsch)
    }
    c.exec("UPDATE properties SET state = NULL WHERE id = 'objekt-1'")
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schema und shared/holidays.ts führen dieselben Kürzel in derselben Reihenfolge', () => {
  assert.deepEqual([...FEDERAL_STATES], [...STATE_CODES])
})

test('Repository: Teilrumpf, leer und null heißen unbekannt, ein fremdes Kürzel wird abgelehnt; die Meldung der Bedingung ist ein Satz', async () => {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { state: 'TH' })))?.state, 'TH')
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { name: 'Haus' })))?.state, 'TH', 'ohne Schlüssel bleibt es')
    await assert.rejects(
      opened.write((db) => updateProperty(db, 'objekt-1', { state: 'XX' })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Bundesland ist unbekannt/.test(e.message),
    )
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { state: '' })))?.state, null)
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { state: 'BE' })))?.state, 'BE')
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { state: null })))?.state, null)
    assert.equal((await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zwei' }))).state, null)
    // Was an der Prüfung vorbei in die Datenbank wollte, bekommt einen deutschen Satz.
    let meldung = ''
    try {
      await opened.write((db) => db.run(sql.raw("UPDATE properties SET state = 'XX' WHERE id = 'objekt-1'")))
    } catch (err) {
      meldung = databaseProblem(err)?.message ?? String(err)
    }
    assert.match(meldung, /Für Bundesland ist ein Wert angekommen, den Mietfuchs nicht kennt/)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
