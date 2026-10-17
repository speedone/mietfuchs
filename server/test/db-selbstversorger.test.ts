// Mieter heizt selbst (Heizung PR 19, #97): `heatingModel: 'selfSupply'` am Mietverhältnis, die Bedingung in
// einem eigenen erzeugten Schritt (…_heizmodell_bedingungen) und das Speichern über repository.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity, updateEntity } from '../src/db/repository.ts'
import { readStock } from '../src/db/read.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-selbst-'))
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

test('Kette: vor dem Schritt lehnt die Bedingung selfSupply ab, danach nicht; ein Bestand bleibt samt Staffeln erhalten', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_heizmodell_bedingungen'))
    if (bis < 0) assert.fail('Schritt …_heizmodell_bedingungen fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'Oben', 80, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, heating_model) VALUES ('t', 'u', 'A', 1, '2020-01-01', 'flatRate')`)
    c.exec(`INSERT INTO prepayments (tenancy_id, "from", monthly_cents) VALUES ('t', '2020-01', 10000)`)
    assert.match(rejects(c, `UPDATE tenancies SET heating_model = 'selfSupply' WHERE id = 't'`) ?? '', /tenancies_heating_model_known/)
    applyMigrations(c, migrations)
    assert.equal(rejects(c, `UPDATE tenancies SET heating_model = 'selfSupply' WHERE id = 't'`), null)
    assert.match(rejects(c, `UPDATE tenancies SET heating_model = 'selbst' WHERE id = 't'`) ?? '', /tenancies_heating_model_known/)
    // Der Neubau der Tabelle nimmt die Staffeln nicht mit (PRAGMA foreign_keys=OFF im Schritt).
    assert.deepEqual(c.rows(`SELECT tenancy_id, monthly_cents FROM prepayments`), [['t', 10000]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Speichern: selfSupply kommt an, kommt zurück und lässt sich zurücksetzen; für die kalten Kosten gibt es den Wert nicht', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', start: '2024-01-01', heatingModel: 'selfSupply', costModel: 'selfSupply' }))
    const stock = await opened.read((db) => readStock(db))
    const t = stock.tenancies.find((x) => x.id === 't1') ?? assert.fail('kein Mietverhältnis')
    assert.equal(t.heatingModel, 'selfSupply')
    assert.equal(t.costModel, undefined, 'selfSupply gilt nur für die Heizung')
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingModel: null }))
    const zurueck = (await opened.read((db) => readStock(db))).tenancies.find((x) => x.id === 't1')
    assert.equal(zurueck?.heatingModel, undefined)
  })
})

// Durchsicht S-2: die Art der Selbstversorgung (Heizung in der Wohnung oder zentrale Heizung im Haus).
test('Art der Selbstversorgung: gespeichert nur bei selfSupply, Bedingungen an der Tabelle', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', start: '2024-01-01', heatingModel: 'selfSupply', selfSupplyKind: 'central' }))
    const kind = async () => (await opened.read((db) => readStock(db))).tenancies.find((x) => x.id === 't1')?.selfSupplyKind
    assert.equal(await kind(), 'central')
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { selfSupplyKind: 'irgendwas' }))
    assert.equal(await kind(), undefined, 'ein unbekannter Wert wird nicht gespeichert')
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { selfSupplyKind: 'perUnit' }))
    assert.equal(await kind(), 'perUnit')
    await opened.write((db) => updateEntity(db, 'tenancies', 't1', { heatingModel: null }))
    assert.equal(await kind(), undefined, 'ohne selfSupply keine Art')
  })
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'Oben', 80, 1)`)
    assert.match(rejects(c, `INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, heating_model, self_supply_kind) VALUES ('a', 'u', 'A', 1, '2020-01-01', 'selfSupply', 'irgendwo')`) ?? '', /tenancies_self_supply_kind_known/)
    assert.match(rejects(c, `INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, self_supply_kind) VALUES ('b', 'u', 'A', 1, '2020-01-01', 'central')`) ?? '', /tenancies_self_supply_kind_valid/)
    assert.equal(rejects(c, `INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, heating_model, self_supply_kind) VALUES ('c', 'u', 'A', 1, '2020-01-01', 'selfSupply', 'central')`), null)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
