// Integrationsdurchsicht zu #415: Der Schlüssel der Anschreiben je Mieter nennt das Objekt. Schritt 0068 schreibt
// vorhandene Zeilen um; der Schlüssel einer getrennten Heizkostenabrechnung bleibt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'

test('Kette: vorhandene Anschreiben je Mieter bekommen das Objekt in den Schlüssel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-anschreiben-schluessel-'))
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_anschreiben_teil2'))
    if (bis < 0) assert.fail('Schritt …_anschreiben_teil2 fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'EG', 60, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Erika', 1, '2024-01-01')`)
    c.exec(`INSERT INTO tenancy_letter_texts (tenancy_id, doc, block, text) VALUES ('t1', '2025-01', 'greeting', 'Bis bald'), ('t1', 'heating:hp:2025-05', 'greeting', 'Warm')`)
    c.exec(`INSERT INTO tenancy_letter_adjustments (tenancy_id, doc, mode, cents) VALUES ('t1', '2025-01', 'custom', 12300)`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows('SELECT doc, text FROM tenancy_letter_texts ORDER BY doc'), [['heating:hp:2025-05', 'Warm'], ['objekt-1:2025-01', 'Bis bald']])
    assert.deepEqual(c.rows('SELECT doc, cents FROM tenancy_letter_adjustments'), [['objekt-1:2025-01', 12300]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
