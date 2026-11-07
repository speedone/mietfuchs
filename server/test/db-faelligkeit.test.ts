// Fälligkeit der Miete am Mietverhältnis (#334): die Spalten aus Schritt 0092 und ihre Bedingungen aus 0093. Ein Bestand
// von 0091 kommt mit NULL (gesetzlich) durch die Kette, und die Bedingungen gelten auch an Repository und API vorbei. Ein
// CHECK, der NULL ergibt, gilt in SQLite als erfüllt; verglichen wird deshalb mit IS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-faelligkeit-'))

test('Kette: ein Bestand von vor 0092 kommt mit gesetzlicher Fälligkeit (NULL) durch, die Daten bleiben', async () => {
  const dir = tmp()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const at = migrations.findIndex((m) => m.tag.endsWith('_faelligkeit_miete'))
    if (at < 0) return assert.fail('Schritt …_faelligkeit_miete fehlt')
    assert.equal(migrations[at + 1]?.tag.endsWith('_faelligkeit_miete_bedingungen'), true, 'die Bedingungen folgen im nächsten Schritt')
    applyMigrations(c, migrations.slice(0, at))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, "end", contract_date, relative) VALUES ('t', 'u', 'Mieter', 2, '1998-04-01', NULL, '1998-03-15', 1)`)
    applyMigrations(c, migrations)
    const rows = c.rows(`SELECT id, tenant_name, persons, start, contract_date, relative, rent_due, rent_due_day, first_rent_at_start FROM tenancies`)
    assert.deepEqual(rows, [['t', 'Mieter', 2, '1998-04-01', '1998-03-15', 1, null, null, null]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Bedingungen: Regel nur aus der Liste, Tag genau beim festen Tag und 1 bis 31, erste Miete bei Beginn nur 1 oder NULL', async () => {
  const dir = tmp()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    let n = 0
    const insert = (rule: string, day: string, first: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, rent_due, rent_due_day, first_rent_at_start) VALUES ('t${n}', 'u', 'M', 1, '2025-01-01', ${rule}, ${day}, ${first})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(insert('NULL', 'NULL', 'NULL'), true, 'gesetzlich')
    assert.equal(insert(`'startWorkday'`, 'NULL', 'NULL'), true, 'zu Beginn')
    assert.equal(insert(`'inArrears'`, 'NULL', '1'), true, 'nach Ablauf, erste Miete bei Beginn')
    assert.equal(insert(`'dayOfMonth'`, '15', 'NULL'), true, 'fester Tag')
    assert.equal(insert(`'dayOfMonth'`, '1', 'NULL'), true, 'Tag 1')
    assert.equal(insert(`'dayOfMonth'`, '31', 'NULL'), true, 'Tag 31')
    assert.equal(insert(`'monatlich'`, 'NULL', 'NULL'), false, 'unbekannte Regel')
    assert.equal(insert(`'dayOfMonth'`, 'NULL', 'NULL'), false, 'fester Tag ohne Tag')
    assert.equal(insert('NULL', '15', 'NULL'), false, 'Tag ohne Regel')
    assert.equal(insert(`'startWorkday'`, '15', 'NULL'), false, 'Tag bei anderer Regel')
    assert.equal(insert(`'dayOfMonth'`, '0', 'NULL'), false, 'Tag 0')
    assert.equal(insert(`'dayOfMonth'`, '32', 'NULL'), false, 'Tag 32')
    assert.equal(insert('NULL', 'NULL', '0'), false, 'erste Miete 0')
    assert.equal(insert('NULL', 'NULL', '2'), false, 'erste Miete 2')
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
