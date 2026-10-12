// §§ 5a, 5b, 5d CO2KostAufG (Heizung PR 18, #215): Merkmale an Anlage, Objekt und Mietverhältnis, ihre
// Bedingungen und Prüfungen, Netzentgelte und Biobrennstoff an der Lieferung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, updateDelivery } from '../src/db/fuel.ts'
import { createEntity, HeatingError, updateEntity, updateProperty } from '../src/db/repository.ts'
import { databaseProblem } from '../src/db/errors.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-gmodg-'))
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
const heatingError = (status: number, text: RegExp) => (e: unknown) => e instanceof HeatingError && e.status === status && text.test(e.message)
const gas = { label: 'Gas 2028', invoiceFrom: '2028-01-01', invoiceTo: '2028-12-31', emissionsKg: 20000, co2CostCents: 120000 }

test('Kette: Bestand ohne Merkmale bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_gmodg'))
    if (bis < 0) assert.fail('Schritt …_gmodg fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')`)
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'Oben', 80, 1)`)
    c.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'A', 1, '2020-01-01')`)
    applyMigrations(c, migrations)
    assert.deepEqual(
      c.rows("SELECT gmodg43_installed_on, emergency_install, emergency_prior_duty, new_building_first_use, building_application_before_2026_05_13 FROM heating_plants WHERE id = 'hp'"),
      [[null, null, null, null, null]],
    )
    assert.deepEqual(c.rows("SELECT tight_market, tight_market_from, tight_market_to FROM properties WHERE id = 'objekt-1'"), [[null, null, null]])
    assert.deepEqual(c.rows("SELECT half_split_notice_on, tenant_name FROM tenancies WHERE id = 't'"), [[null, 'A']])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Merkmale nur bei Gas, Öl, Flüssiggas und mit Tag des Einbaus; Contracting erlaubt; Markt und Mitteilung', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const ins = (id: string, cols: string, vals: string) => `INSERT INTO heating_plants (id, property_id, energy${cols}) VALUES ('${id}', 'objekt-1'${vals})`
    assert.equal(rejects(c, ins('a', ', gmodg43_installed_on', ", 'gas', '2027-03-01'")), null)
    assert.match(rejects(c, ins('b', ', gmodg43_installed_on', ", 'heatPump', '2027-03-01'")) ?? '', /heating_plants_gmodg_energy_valid/)
    assert.match(rejects(c, ins('c', ', gmodg43_installed_on', ", 'gas', '01.03.2027'")) ?? '', /heating_plants_gmodg_date_valid/)
    assert.match(rejects(c, ins('d', ', emergency_install', ", 'gas', 1")) ?? '', /heating_plants_gmodg_facts_valid/)
    assert.match(rejects(c, ins('e', ', gmodg43_installed_on, emergency_prior_duty', ", 'gas', '2028-03-01', 0")) ?? '', /heating_plants_prior_duty_valid/)
    assert.match(rejects(c, ins('f', ', gmodg43_installed_on, building_application_before_2026_05_13', ", 'gas', '2027-03-01', 0")) ?? '', /heating_plants_application_valid/)
    // Ohne Angabe zum Notfalleinbau (NULL) ebenso, nicht nur bei „nein“: Ein Vergleich mit NULL bestünde sonst.
    assert.match(rejects(c, ins('e2', ', gmodg43_installed_on, emergency_install, emergency_prior_duty', ", 'gas', '2028-03-01', 0, 1")) ?? '', /heating_plants_prior_duty_valid/)
    // Contracting mit Heizung nach § 43 ist erlaubt (BT-Drs. 21/6278, S. 124; Abweichung 11).
    assert.equal(rejects(c, ins('g', ', gmodg43_installed_on, contracting', ", 'gas', '2027-03-01', 1")), null)
    assert.match(rejects(c, ins('i', ', gmodg43_installed_on, new_building_first_use', ", 'gas', '2027-03-01', '2029/06/01'")) ?? '', /heating_plants_first_use_date_valid/)
    // Angespannter Markt (Abweichung 4): Geltung nur bei „ja“, als Datum, Beginn nicht nach dem Ende.
    assert.equal(rejects(c, "UPDATE properties SET tight_market = 1, tight_market_from = '2025-07-01', tight_market_to = '2029-12-31' WHERE id = 'objekt-1'"), null)
    assert.match(rejects(c, "UPDATE properties SET tight_market = 0, tight_market_from = '2025-07-01', tight_market_to = NULL WHERE id = 'objekt-1'") ?? '', /properties_tight_market_dates_valid/)
    assert.match(rejects(c, "UPDATE properties SET tight_market = NULL, tight_market_from = '2025-07-01', tight_market_to = NULL WHERE id = 'objekt-1'") ?? '', /properties_tight_market_dates_valid/)
    assert.match(rejects(c, "UPDATE properties SET tight_market = 1, tight_market_from = '01.07.2025', tight_market_to = NULL WHERE id = 'objekt-1'") ?? '', /properties_tight_market_from_valid/)
    assert.match(rejects(c, "UPDATE properties SET tight_market = 1, tight_market_from = NULL, tight_market_to = '31.12.2029' WHERE id = 'objekt-1'") ?? '', /properties_tight_market_to_valid/)
    assert.match(rejects(c, "UPDATE properties SET tight_market = 1, tight_market_from = '2030-01-01', tight_market_to = '2029-12-31' WHERE id = 'objekt-1'") ?? '', /properties_tight_market_order_valid/)
    // Mitteilung nach § 5d Abs. 4 am Mietverhältnis (Abweichung 3).
    c.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'Oben', 80, 1)`)
    assert.equal(rejects(c, `INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, half_split_notice_on) VALUES ('t1', 'u', 'A', 1, '2020-01-01', '2028-03-15')`), null)
    assert.match(rejects(c, `INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, half_split_notice_on) VALUES ('t2', 'u', 'B', 1, '2020-01-01', '15.03.2028')`) ?? '', /tenancies_half_split_notice_valid/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: jede neue Bedingung hat ihren eigenen Satz (db-errors.test.ts)', async () => {
  await withDatabase(async (opened) => {
    const messageOf = async (statement: string): Promise<string> => {
      try {
        await opened.write((db) => db.run(sql.raw(statement)))
      } catch (err) {
        return databaseProblem(err)?.message ?? String(err)
      }
      return assert.fail(`angenommen: ${statement}`)
    }
    const ins = (id: string, cols: string, vals: string) => `INSERT INTO heating_plants (id, property_id, energy${cols}) VALUES ('${id}', 'objekt-1'${vals})`
    assert.match(await messageOf(ins('b', ', gmodg43_installed_on', ", 'heatPump', '2027-03-01'")), /Gas-, Öl- oder Flüssiggasheizung/)
    assert.match(await messageOf(ins('c', ', gmodg43_installed_on', ", 'gas', '01.03.2027'")), /Tag des Einbaus/)
    assert.match(await messageOf(ins('d', ', emergency_install', ", 'gas', 1")), /Tag des Einbaus/)
    assert.match(await messageOf(ins('e', ', gmodg43_installed_on, emergency_prior_duty', ", 'gas', '2028-03-01', 0")), /irreparabl/)
    assert.match(await messageOf(ins('f', ', gmodg43_installed_on, building_application_before_2026_05_13', ", 'gas', '2027-03-01', 0")), /Neubau/)
    assert.match(await messageOf(ins('i', ', gmodg43_installed_on, new_building_first_use', ", 'gas', '2027-03-01', '2029/06/01'")), /erstmals genutzt/)
    assert.match(await messageOf("UPDATE properties SET tight_market = 0, tight_market_from = '2025-07-01' WHERE id = 'objekt-1'"), /nur bei „ja“/)
    assert.match(await messageOf("UPDATE properties SET tight_market = 1, tight_market_from = '01.07.2025' WHERE id = 'objekt-1'"), /Beginn der Verordnung/)
    assert.match(await messageOf("UPDATE properties SET tight_market = 1, tight_market_to = '31.12.2029' WHERE id = 'objekt-1'"), /Ende der Verordnung/)
    assert.match(await messageOf("UPDATE properties SET tight_market = 1, tight_market_from = '2030-01-01', tight_market_to = '2029-12-31' WHERE id = 'objekt-1'"), /nach dem Ende/)
    await opened.write((db) => db.run(sql.raw("INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', 'objekt-1', 'Oben', 80, 1)")))
    assert.match(await messageOf("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, half_split_notice_on) VALUES ('t2', 'u', 'B', 1, '2020-01-01', '15.03.2028')"), /Mitteilung/)
  })
})

test('Anlage: Merkmale anlegen und prüfen (Abweichung 11)', async () => {
  await withDatabase(async (opened) => {
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual', gmodg43InstalledOn: '2027-06-15', emergencyInstall: true }))
    assert.deepEqual([plant.gmodg43InstalledOn, plant.emergencyInstall, plant.emergencyPriorDuty], ['2027-06-15', true, null])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '2026-07-29' })), heatingError(400, /nach dem 29\.07\.2026/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'heatPump' })), heatingError(400, /Gas-, Öl- oder Flüssiggasheizung/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '15.06.2027' })), heatingError(400, /Tag des Einbaus/))
    // Contracting ist erlaubt (Abweichung 11).
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: true })))?.contracting, true)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: false }))
    // Neubau (§ 5b): ein früher Einbau ist erlaubt, eine erste Nutzung nach 2029 nicht.
    const neu = await opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '2026-06-01', newBuildingFirstUse: '2027-02-01', buildingApplicationBefore20260513: false }))
    assert.deepEqual([neu?.newBuildingFirstUse, neu?.buildingApplicationBefore20260513], ['2027-02-01', false])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { newBuildingFirstUse: '2030-01-02' })), heatingError(400, /beim Grundsatz, dass die Mieter die Betriebskosten tragen/))
    // Erstmals genutzt am 31.12.2029 ist noch „bis zum Ablauf des 31. Dezember 2029“ (§ 5b Satz 1).
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp', { newBuildingFirstUse: '2029-12-31' })))?.newBuildingFirstUse, '2029-12-31')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { newBuildingFirstUse: '2027-02-01' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { newBuildingFirstUse: '01.02.2027' })), heatingError(400, /Tag der ersten Nutzung/))
    // Die vorherige Pflicht fällt ohne Notfalleinbau, der Bauantrag ohne Neubau.
    const pflicht = await opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '2027-06-15', emergencyInstall: false, emergencyPriorDuty: true, newBuildingFirstUse: null }))
    assert.deepEqual([pflicht?.emergencyPriorDuty, pflicht?.buildingApplicationBefore20260513], [null, null])
    // Ohne Tag des Einbaus fallen die übrigen Merkmale mit.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '2027-06-15', emergencyInstall: true, newBuildingFirstUse: '2027-02-01' }))
    const ohne = await opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: null }))
    assert.deepEqual([ohne?.emergencyInstall, ohne?.newBuildingFirstUse, ohne?.buildingApplicationBefore20260513], [null, null, null])
  })
})

test('Lieferung: Netzentgelte nur bei einer Heizung nach § 43, Biobrennstoff nicht ab 2040 (Abweichung 10)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await assert.rejects(opened.write((db) => createDelivery(db, 'd0', 'hp', { ...gas, gridFeeCents: 30000 })), heatingError(400, /Heizung nach § 43 Abs\. 1 GModG/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { gmodg43InstalledOn: '2027-03-01' }))
    const d = await opened.write((db) => createDelivery(db, 'd1', 'hp', { ...gas, gridFeeCents: 30000, bioCostCents: 0 }))
    assert.deepEqual([d?.gridFeeCents, d?.bioCostCents], [30000, 0])
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { invoiceFrom: '2040-01-01', invoiceTo: '2040-12-31', bioCostCents: 5000 })), heatingError(400, /2040/))
    // Eine Rechnung, die am 01.01.2040 endet, berührt die Zeit ab 2040 schon.
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { invoiceFrom: '2039-01-01', invoiceTo: '2040-01-01', bioCostCents: 5000 })), heatingError(400, /2040/))
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { invoiceFrom: '2039-01-01', invoiceTo: '2039-12-31', bioCostCents: 5000 })))?.bioCostCents, 5000)
    // Eine 0 ist eine Angabe und auch ab 2040 erlaubt (Abweichung 10).
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { invoiceFrom: '2040-01-01', invoiceTo: '2040-12-31', bioCostCents: 0 })))?.bioCostCents, 0)
  })
})

test('Lieferung an eine Ölheizung nach § 43: keine Netzentgelte, kein Biobrennstoff aus dem Tank (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'oel', 'objekt-1', { energy: 'oil', method: 'manual', gmodg43InstalledOn: '2027-03-01' }))
    const heizoel = { label: 'Heizöl', deliveredAt: '2029-02-01', quantity: 3000, quantityUnit: 'l' }
    await assert.rejects(opened.write((db) => createDelivery(db, 'd2', 'oel', { ...heizoel, gridFeeCents: 100 })), heatingError(400, /nur bei der Belieferung mit Gas/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'd3', 'oel', { ...heizoel, bioCostCents: 100 })), heatingError(400, /Vorrat/))
    // Kein Biobrennstoff im Tank (Pflicht anders erfüllt oder noch nicht fällig): die 0 ist eine Angabe (Abweichung 9, 10).
    assert.equal((await opened.write((db) => createDelivery(db, 'd4', 'oel', { ...heizoel, bioCostCents: 0 })))?.bioCostCents, 0)
  })
})

test('Lieferung bei Contracting mit Gas: Netzentgelte nach dem Brennstoff des Lieferanten (Abweichung 11)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual', contracting: true, gmodg43InstalledOn: '2027-03-01' }))
    const d = await opened.write((db) => createDelivery(db, 'w', 'hp', { label: 'Wärme 2028', invoiceFrom: '2028-01-01', invoiceTo: '2028-12-31', gridFeeCents: 30000 }))
    assert.equal(d?.gridFeeCents, 30000)
  })
  await withDatabase(async (opened) => {
    // Contracting mit Heizöl: Den Brennstoff führt der Lieferant, nicht der Vermieter im Tank; der Biobrennstoff
    // steht auf seiner Wärmerechnung und ist ein Betrag (Abweichung 11).
    await opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { energy: 'oil', method: 'manual', contracting: true, gmodg43InstalledOn: '2027-03-01' }))
    const oel = await opened.write((db) => createDelivery(db, 'w2', 'hp2', { label: 'Wärme 2029', invoiceFrom: '2029-01-01', invoiceTo: '2029-12-31', bioCostCents: 5000 }))
    assert.equal(oel?.bioCostCents, 5000)
  })
})

test('Mietverhältnis: Tag der Mitteilung nach § 5d Abs. 4 (Abweichung 3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u', { propertyId: 'objekt-1', name: 'Oben', areaM2: 80, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't', { unitId: 'u', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' }))
    const t = await opened.write((db) => updateEntity(db, 'tenancies', 't', { halfSplitNoticeOn: '2028-03-15' }))
    if (!t || !('tenantName' in t)) return assert.fail('kein Mietverhältnis')
    assert.equal(t.halfSplitNoticeOn, '2028-03-15')
    await assert.rejects(opened.write((db) => updateEntity(db, 'tenancies', 't', { halfSplitNoticeOn: '15.03.2028' })), heatingError(400, /kein Datum/))
    const leer = await opened.write((db) => updateEntity(db, 'tenancies', 't', { halfSplitNoticeOn: null }))
    if (!leer || !('tenantName' in leer)) return assert.fail('kein Mietverhältnis')
    assert.equal(leer.halfSplitNoticeOn, undefined)
  })
})

test('Objekt: angespannter Wohnungsmarkt ja, nein, unbekannt, mit Geltung der Verordnung (Abweichung 4)', async () => {
  await withDatabase(async (opened) => {
    const ja = await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: true, tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' }))
    assert.deepEqual([ja?.tightMarket, ja?.tightMarketFrom, ja?.tightMarketTo], [true, '2025-07-01', '2029-12-31'])
    await assert.rejects(opened.write((db) => updateProperty(db, 'objekt-1', { tightMarketTo: '31.12.2029' })), heatingError(400, /kein Datum/))
    await assert.rejects(opened.write((db) => updateProperty(db, 'objekt-1', { tightMarketFrom: '2030-01-01' })), heatingError(400, /nach dem Ende/))
    // „nein“ und „unbekannt“ nehmen die Geltung mit.
    const nein = await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: false }))
    assert.deepEqual([nein?.tightMarket, nein?.tightMarketFrom, nein?.tightMarketTo], [false, null, null])
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: true })))?.tightMarket, true)
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: false })))?.tightMarket, false)
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: null })))?.tightMarket, null)
    assert.equal((await opened.write((db) => updateProperty(db, 'objekt-1', { tightMarket: 'ja' })))?.tightMarket, null)
  })
})
