// Geschätzte Ablesung (#98), Durchsicht M1: Die Bedingungen an `readings` gelten auch an Repository und API vorbei. Ein
// CHECK, der NULL ergibt, gilt in SQLite als erfüllt; verglichen wird deshalb mit IS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'

test('Bedingungen: geschätzt nur mit Begründung, Begründung nur bei geschätzt, estimated nur 1 oder NULL', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-ablesung-'))
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m1', 'objekt-1', 'Hauptzähler', NULL, 'kaltwasser', 'm³')`)
    let n = 0
    const insert = (estimated: string, reason: string): boolean => {
      n += 1
      try {
        c.exec(`INSERT INTO readings (id, meter_id, date, value, estimated, estimate_reason) VALUES ('r${n}', 'm1', '2025-12-31', 1, ${estimated}, ${reason})`)
        return true
      } catch {
        return false
      }
    }
    assert.equal(insert('NULL', 'NULL'), true, 'abgelesen')
    assert.equal(insert('1', `'Zähler defekt'`), true, 'geschätzt mit Begründung')
    assert.equal(insert('1', 'NULL'), false, 'geschätzt ohne Begründung')
    assert.equal(insert('1', `'   '`), false, 'geschätzt mit leerer Begründung')
    assert.equal(insert('NULL', `'Zähler defekt'`), false, 'Begründung ohne Schätzung')
    assert.equal(insert('0', 'NULL'), false, 'estimated 0')
    assert.equal(insert('0', `'x'`), false, 'estimated 0 mit Begründung')
    assert.equal(insert('2', `'x'`), false, 'estimated 2')
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
