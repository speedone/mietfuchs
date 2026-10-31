// Kopfangaben der Anlage V (#96 PR 2, Entwurf docs/superpowers/specs/2026-10-30-steuer-objekt-ruecklage-design.md, B2)
// in der Datenbank: am Objekt Aktenzeichen und vier Daten, am Mietverhältnis „an Angehörige vermietet“ (Schritte
// 0080/0081), mit Bedingungen wie bei `tight_market_*`, dazu das Zusammenführen und Prüfen in repository.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readProperties, readTenancies } from '../src/db/read.ts'
import { createEntity, createProperty, updateEntity, updateProperty } from '../src/db/repository.ts'
import { databaseProblem } from '../src/db/errors.ts'
import type { Property, Tenancy } from '../../shared/types.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-steuer-kopf-'))

const DATE_COLUMNS = ['purchase_contract_on', 'ownership_transfer_on', 'building_application_on', 'completed_on'] as const

test('Kette: Objekte und Mietverhältnisse von vor dem Schritt bekommen NULL, in ihrer Reihenfolge; die Bedingungen halten Datum, Länge und ja/nein', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_anlage_v_kopf'))
    if (bis < 0) assert.fail('Schritt …_anlage_v_kopf fehlt')
    assert.equal(migrations[bis + 1]?.tag.endsWith('_anlage_v_kopf_bedingungen'), true, 'die Bedingungen folgen unmittelbar')
    // Die Folge des Release-Plans: nach dem Monat laut Verwendungszweck (#281).
    assert.equal(migrations[bis - 1]?.tag.endsWith('_bestimmung_monat_bedingung'), true, 'unmittelbar nach 0078/0079')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO properties (id, name, kind, address) VALUES ('objekt-2', 'Gartenweg', 'etw', 'Gartenweg 3')`)
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'EG', 50, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t2', 'u', 'Zweiter', 1, '2025-01-01'), ('t1', 'u', 'Erster', 2, '2024-01-01')`)
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p', 't1', '2024-01-03', 80000)`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows('SELECT id, ground_tax_file_number, purchase_contract_on, ownership_transfer_on, building_application_on, completed_on FROM properties ORDER BY rowid'), [
      ['objekt-1', null, null, null, null, null],
      ['objekt-2', null, null, null, null, null],
    ])
    assert.deepEqual(c.rows('SELECT id, tenant_name, relative FROM tenancies ORDER BY rowid'), [['t2', 'Zweiter', null], ['t1', 'Erster', null]])
    // Der Neubau nimmt die Zahlungen nicht mit (Fremdschlüssel aus beim Neubau).
    assert.deepEqual(c.rows('SELECT id FROM payments'), [['p']])

    for (const column of DATE_COLUMNS) {
      c.exec(`UPDATE properties SET ${column} = '2024-03-01' WHERE id = 'objekt-1'`)
      for (const bad of ['01.03.2024', '2024-3-1', '2024-03', '']) {
        assert.throws(() => c.exec(`UPDATE properties SET ${column} = '${bad}' WHERE id = 'objekt-1'`), new RegExp(`properties_${column}_valid`), `${column}: ${bad}`)
      }
      c.exec(`UPDATE properties SET ${column} = NULL WHERE id = 'objekt-1'`)
    }
    c.exec(`UPDATE properties SET ground_tax_file_number = '${'1'.repeat(40)}' WHERE id = 'objekt-1'`)
    assert.throws(() => c.exec(`UPDATE properties SET ground_tax_file_number = '${'1'.repeat(41)}' WHERE id = 'objekt-1'`), /properties_ground_tax_file_number_valid/)
    c.exec(`UPDATE tenancies SET relative = 1 WHERE id = 't1'`)
    c.exec(`UPDATE tenancies SET relative = 0 WHERE id = 't1'`)
    assert.throws(() => c.exec(`UPDATE tenancies SET relative = 2 WHERE id = 't1'`), /tenancies_relative_known/)
    // Der Neubau hält die übrigen Bedingungen beider Tabellen.
    assert.throws(() => c.exec(`UPDATE properties SET state = 'XX' WHERE id = 'objekt-1'`), /properties_state_known/)
    assert.throws(() => c.exec(`UPDATE tenancies SET persons = -1 WHERE id = 't1'`), /tenancies_persons_not_negative/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Die Bedingungen haben je einen deutschen Satz (errors.ts)', () => {
  const expected: Record<string, RegExp> = {
    properties_ground_tax_file_number_valid: /Aktenzeichen.*höchstens 40 Zeichen/,
    properties_purchase_contract_on_valid: /Kaufvertrag.*kein Datum/,
    properties_ownership_transfer_on_valid: /Eigentumsübergang.*kein Datum/,
    properties_building_application_on_valid: /Bauantrag.*kein Datum/,
    properties_completed_on_valid: /Fertigstellung.*kein Datum/,
    tenancies_relative_known: /Angehörige.*ja oder nein/,
  }
  for (const [name, text] of Object.entries(expected)) {
    const problem = databaseProblem(new Error('Failed query: update …', { cause: new Error(`CHECK constraint failed: ${name}`) })) ?? assert.fail(`${name}: keine Meldung`)
    assert.equal(problem.status, 400, name)
    assert.match(problem.message, text, name)
  }
})

async function withStock(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Tochter', persons: 1, start: '2025-01-01' })
    })
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const headerOf = (p: Property | undefined): unknown[] =>
  p === undefined ? assert.fail('Objekt fehlt') : [p.groundTaxFileNumber ?? null, p.purchaseContractOn ?? null, p.ownershipTransferOn ?? null, p.buildingApplicationOn ?? null, p.completedOn ?? null]

test('Repository: Kopfangaben setzen, ein Teilrumpf lässt sie stehen, null und leer entfernen sie; ohne Angabe fehlen sie', async () => {
  await withStock(async (opened) => {
    const [vorher] = await opened.read((db) => readProperties(db))
    assert.equal(vorher !== undefined && 'groundTaxFileNumber' in vorher, false, 'ohne Angabe steht das Feld nicht in der Antwort')
    await opened.write(async (db) => {
      await updateProperty(db, 'objekt-1', {
        groundTaxFileNumber: ' 2141/123/45678 ', purchaseContractOn: '2023-05-10', ownershipTransferOn: '2023-07-01',
        buildingApplicationOn: '2019-02-01', completedOn: '2020-11-30',
      })
    })
    assert.deepEqual(headerOf((await opened.read((db) => readProperties(db)))[0]), ['2141/123/45678', '2023-05-10', '2023-07-01', '2019-02-01', '2020-11-30'])
    await opened.write((db) => updateProperty(db, 'objekt-1', { name: 'Haus' }))
    assert.deepEqual(headerOf((await opened.read((db) => readProperties(db)))[0]), ['2141/123/45678', '2023-05-10', '2023-07-01', '2019-02-01', '2020-11-30'])
    await opened.write((db) => updateProperty(db, 'objekt-1', { groundTaxFileNumber: '', purchaseContractOn: null, ownershipTransferOn: '', buildingApplicationOn: null, completedOn: null }))
    assert.deepEqual(headerOf((await opened.read((db) => readProperties(db)))[0]), [null, null, null, null, null])
    const neu = await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites', ownershipTransferOn: '2024-01-15' }))
    assert.deepEqual(headerOf(neu), [null, null, '2024-01-15', null, null])
  })
})

test('Repository: ein Datum in anderer Form, ein zu langes Aktenzeichen und ein Text statt ja/nein werden mit Satz abgelehnt, nichts gespeichert', async () => {
  await withStock(async (opened) => {
    const rejects = async (work: Parameters<OpenedDatabase['write']>[0], pattern: RegExp) => {
      await assert.rejects(opened.write(work), (e: unknown) => e instanceof Error && 'status' in e && e.status === 400 && pattern.test(e.message))
    }
    for (const [field, label] of [['purchaseContractOn', /Kaufvertrag/], ['ownershipTransferOn', /Eigentumsübergang/], ['buildingApplicationOn', /Bauantrag/], ['completedOn', /Fertigstellung/]] as const) {
      for (const bad of ['01.03.2024', '2024-03', 20240301]) await rejects((db) => updateProperty(db, 'objekt-1', { [field]: bad }), label)
    }
    await rejects((db) => updateProperty(db, 'objekt-1', { groundTaxFileNumber: '1'.repeat(41) }), /höchstens 40 Zeichen/)
    await rejects((db) => updateProperty(db, 'objekt-1', { groundTaxFileNumber: 2141 }), /Aktenzeichen/)
    for (const bad of [2, 'ja', 1]) await rejects((db) => updateEntity(db, 'tenancies', 't', { relative: bad }), /Angehörige/)
    assert.deepEqual(headerOf((await opened.read((db) => readProperties(db)))[0]), [null, null, null, null, null])
    const [t] = await opened.read((db) => readTenancies(db))
    assert.equal(t?.relative, undefined)
  })
})

test('Repository: an Angehörige vermietet setzen und zurücknehmen; „nein“ und „leer“ fehlen in der Antwort wie bisher', async () => {
  await withStock(async (opened) => {
    const relativeOf = async (): Promise<Tenancy['relative']> => (await opened.read((db) => readTenancies(db)))[0]?.relative
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { relative: true }))
    assert.equal(await relativeOf(), true)
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { tenantName: 'Tochter B.' }))
    assert.equal(await relativeOf(), true, 'ein Teilrumpf lässt es stehen')
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { relative: false }))
    assert.equal(await relativeOf(), undefined, '„nein“ ist das bisherige Verhalten')
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { relative: true }))
    await opened.write((db) => updateEntity(db, 'tenancies', 't', { relative: null }))
    assert.equal(await relativeOf(), undefined)
  })
})
