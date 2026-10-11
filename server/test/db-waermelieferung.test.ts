// Wärmelieferung (Heizung PR 16, #213): Merkmale an der Anlage, ihre Bedingungen und Prüfungen, und dass
// eine Umstellung in einem offenen Zeitraum nur über den Kesseltausch geht (Prüfung C-M1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { saveCo2Statement } from '../src/db/co2.ts'
import { createEntity, HeatingError } from '../src/db/repository.ts'
import { saveDistribution } from '../src/db/heatingSelf.ts'
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { eq } from 'drizzle-orm'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-waermelieferung-'))
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
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const refused = (status: number, text: RegExp) => (e: unknown): boolean => e instanceof HeatingError && e.status === status && text.test(e.message)

test('Kette: Bestand ohne Wärmelieferung, Vorgaben false und NULL', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_waermelieferung'))
    if (bis < 0) assert.fail('Schritt …_waermelieferung fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows("SELECT contracting, heat_delivery_since, previous_supply, switch_announced_on FROM heating_plants WHERE id = 'hp'"), [[0, null, null, null]])
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Contracting bei jeder zentralen Anlage außer Fernwärme, auch der Wärmepumpe; Umstellung nur bei Wärmelieferung', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    const ins = (id: string, cols: string, vals: string) => `INSERT INTO heating_plants (id, property_id, energy${cols}) VALUES ('${id}', 'objekt-1'${vals})`
    assert.equal(rejects(c, ins('a', ', contracting', ", 'gas', 1")), null)
    assert.equal(rejects(c, ins('b', ', contracting', ", 'pellets', 1")), null)
    // Prüfung R-M4: Contracting mit Wärmepumpe ist zugelassen; gesperrt sind nur die Formeln.
    assert.equal(rejects(c, ins('b2', ', contracting', ", 'heatPump', 1")), null)
    assert.match(rejects(c, ins('b3', ', contracting', ", 'districtHeating', 1")) ?? '', /heating_plants_contracting_energy_valid/)
    assert.match(rejects(c, ins('c', ', contracting, supply', ", 'gas', 1, 'perUnit'")) ?? '', /heating_plants_contracting_central_valid/)
    assert.equal(rejects(c, ins('d', ', heat_delivery_since, previous_supply', ", 'districtHeating', '2025-10-01', 'landlord'")), null)
    assert.match(rejects(c, ins('e', ', heat_delivery_since', ", 'gas', '2025-10-01'")) ?? '', /heating_plants_delivery_only_valid/)
    assert.match(rejects(c, ins('f', ', contracting, heat_delivery_since', ", 'gas', 1, '01.10.2025'")) ?? '', /heating_plants_delivery_since_valid/)
    assert.match(rejects(c, ins('f2', ', contracting, heat_delivery_since, switch_announced_on', ", 'gas', 1, '2025-10-01', '15.06.2025'")) ?? '', /heating_plants_announced_valid/)
    assert.match(rejects(c, ins('g', ', contracting, previous_supply', ", 'gas', 1, 'mieter'")) ?? '', /heating_plants_previous_supply_known/)
    assert.match(rejects(c, ins('h', ', contracting, switch_announced_on', ", 'gas', 1, '2025-06-01'")) ?? '', /heating_plants_announced_since_valid/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Anlage: Contracting anlegen und ändern; Fernwärme und Etagenheizung lehnen mit einem Satz ab', async () => {
  await withDatabase(async (opened) => {
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' }))
    assert.deepEqual([plant.contracting, plant.heatDeliverySince, plant.previousSupply, plant.switchAnnouncedOn], [true, '2025-10-01', 'landlord', '2025-06-15'])
    const pellets = await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'pellets' }))
    assert.deepEqual([pellets?.energy, pellets?.contracting], ['pellets', true])
    // Prüfung R-M4: Wärmepumpe mit Contracting wird angenommen.
    const pumpe = await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'heatPump' }))
    assert.deepEqual([pumpe?.energy, pumpe?.contracting], ['heatPump', true])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'districtHeating' })), refused(400, /Fernwärme ist ohne Merkmal Wärmelieferung/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: '01.10.2025' })), refused(400, /Tag der Umstellung ist kein Datum/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { switchAnnouncedOn: '15.06.2025' })), refused(400, /Ankündigung zuging, ist kein Datum/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: null })), refused(400, /Ankündigung ohne Tag der Umstellung/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { previousSupply: 'mieter' })), refused(400, /Wer vorher versorgte/))
    const ohne = await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null }))
    assert.deepEqual([ohne?.contracting, ohne?.heatDeliverySince], [false, null])
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatDeliverySince: '2025-10-01' })), refused(400, /nur bei Fernwärme oder Contracting/))
    // Prüfung R-S8: eine Grenze von Mietfuchs, keine Rechtsaussage, ohne Zusage einer späteren Version.
    await assert.rejects(opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { energy: 'gas', supply: 'perUnit', contracting: true, buildingWith: 'own' })),
      (e: unknown) => refused(400, /^Contracting bildet Mietfuchs bisher nur bei einer zentralen Heizung ab\.$/)(e))
    // Fernwärme braucht kein Merkmal: Die Angaben zur Umstellung gibt es dort auch ohne.
    const fw = await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'districtHeating', heatDeliverySince: '2024-01-01', previousSupply: 'tenant' }))
    assert.deepEqual([fw?.contracting, fw?.heatDeliverySince, fw?.previousSupply], [false, '2024-01-01', 'tenant'])
  })
})

// Prüfung C-M1: Ein Umschalten des Merkmals an einer Anlage mit Lieferungen, Vorrat oder CO₂-Angaben rechnete
// auch die Zeit davor als Wärmelieferung. Gesperrt, mit dem Weg über den Kesseltausch.
const SWAP_SENTENCE = /An dieser Anlage stehen Lieferungen, ein Vorrat oder CO₂-Angaben\. Wurde .*auf Wärmelieferung umgestellt, erfassen Sie das mit „Heizung erneuert \(Kessel getauscht\)“; sonst rechnete Mietfuchs auch die Zeit davor als Wärmelieferung\./

test('C-M1: Contracting an einer Anlage mit Lieferungen umzuschalten wird abgelehnt, in beide Richtungen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    // Ohne Lieferungen ist es eine Angabe und geht.
    await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: true }))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: false }))
    await opened.write((db) => createDelivery(db, 'g1', 'hp', { label: 'Gas', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: true })), refused(409, SWAP_SENTENCE))
  })
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual', contracting: true }))
    await opened.write((db) => createDelivery(db, 'w1', 'hp', { label: 'Wärme', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: false })), refused(409, /Endete die Wärmelieferung .*„Heizung erneuert \(Kessel getauscht\)“; sonst rechnete Mietfuchs auch die Zeit davor als eigene Heizung\./))
    // Der Brennstoff des Contractors bleibt änderbar, denn abgerechnet wird weiter Wärme.
    const oel = await opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'oil' }))
    assert.deepEqual([oel?.energy, oel?.contracting], ['oil', true])
  })
})

test('C-M1: Contracting an einer Ölheizung mit Vorrat oder einer Gasheizung mit CO₂-Angaben umzuschalten wird abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' }))
    await opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000 }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: true })), refused(409, SWAP_SENTENCE))
  })
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => saveCo2Statement(db, 'hp', '2025-01', { method: 'selfAfterService' }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { contracting: true })), refused(409, SWAP_SENTENCE))
  })
})

// Review Focus 6 der Prüfung: Umstellung am 01.10. bei laufender Ölheizung mit Vorrat. Der Kesseltausch nimmt das
// Merkmal und die Angaben zur Umstellung an, Öl → Öl mit Contracting ist ein Tausch (anders als Gas → Gas über
// denselben Zähler). Den Tag des Tauschs als Tag der Umstellung schlägt die Oberfläche vor (heatingForm.ts).
test('C-M1: Umstellung am 01.10. bei laufender Ölheizung mit Vorrat über den Kesseltausch', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' }))
    await opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000 }))
    const r = await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2025-10-01', energy: 'oil', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord', switchAnnouncedOn: '2025-06-15' }))
    if (!r) return assert.fail('kein Tausch')
    assert.deepEqual([r.plant.energy, r.plant.contracting, r.plant.heatDeliverySince, r.plant.previousSupply, r.plant.switchAnnouncedOn], ['oil', true, '2025-10-01', 'landlord', '2025-06-15'])
    // Der Lieferant führt den Vorrat; die Frage, ob der neue Kessel den Tank weiter verheizt, gibt es nicht.
    assert.equal(r.plant.takesOverStock, null)
    assert.deepEqual([r.previous.contracting, r.previous.endsOn], [false, '2025-09-30'])
  })
})

test('C-M1: Gas → Gas mit Contracting ist ein Tausch; Gas → Gas ohne Merkmal weiter nicht', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await assert.rejects(opened.write((db) => replaceHeatingPlant(db, 'hp', 'x', { date: '2025-10-01', energy: 'gas' })), refused(409, /brauchen Sie keinen Tausch/))
    const r = await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2025-10-01', energy: 'gas', contracting: true, heatDeliverySince: '2025-11-01' }))
    assert.deepEqual([r?.plant.contracting, r?.plant.heatDeliverySince], [true, '2025-11-01'])
    // Und zurück zur eigenen Heizung: auch das ist ein Tausch, und die Angaben zur Umstellung fallen weg.
    const back = await opened.write((db) => replaceHeatingPlant(db, 'hp2', 'hp3', { date: '2026-10-01', energy: 'gas', contracting: false }))
    assert.deepEqual([back?.plant.contracting, back?.plant.heatDeliverySince, back?.plant.previousSupply], [false, null, null])
  })
})

// Review Focus 1 und 2 an den Schreibwegen (Prüfung C-M4, C-M6): Bei Contracting rechnet die Anlage Wärme.
test('Schreibwege: Contracting mit Öl hat keinen Vorrat, Lieferungen sind Wärmerechnungen ohne Heizwerttabelle', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual', contracting: true }))
    // Den Vorrat führt der Lieferant.
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000 })), refused(400, /Vorrat/))
    // Eine Wärmerechnung mit Rechnungszeitraum, nicht eine Öllieferung mit Lieferdatum.
    await opened.write((db) => createDelivery(db, 'w', 'hp', { label: 'Wärme 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 40000 }))
    // Die Heizwerttabelle gilt nur bei eigenen Kesseln (§ 9 Abs. 3 HeizkostenV).
    await assert.rejects(opened.write((db) => createDelivery(db, 'w2', 'hp', { label: 'Wärme', invoiceFrom: '2026-01-01', invoiceTo: '2026-12-31', quantity: 100, quantityUnit: 'l', fuelGrade: 'heatingOilEL' })), refused(400, /nur bei Heizkesseln/))
  })
})

test('Prüfung C-M4: Contracting mit „Sonstiges“ nimmt Wärmerechnungen an, sonst blieben CO₂-Angaben ohne Ausweg', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'other', method: 'manual', contracting: true }))
    const d = await opened.write((db) => createDelivery(db, 'w', 'hp', { label: 'Wärme 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 9000, co2CostCents: 49500 }))
    assert.equal(d?.co2CostCents, 49500)
  })
  // Ohne Contracting bleibt es bei der Sperre.
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'other', method: 'manual' }))
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { label: 'X', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' })), refused(400, /Energieträger/))
  })
})

test('Review Focus 1: Gas-Contracting in einem ungedämmten Altbau, 60 % nach Verbrauch werden angenommen (§ 7 Abs. 3)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual', contracting: true }))
    await opened.write((db) => db.update(heatingPlants).set({ method: 'self', capture: 'heatMeter' }).where(eq(heatingPlants.id, 'hp')))
    const d = await opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'applies' }, '2025-11-01'))
    assert.deepEqual([d?.own.heating, d?.effective?.heating], [60, 60])
  })
  // Gegenprobe: eigene Gasheizung verlangt 70 %.
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => db.update(heatingPlants).set({ method: 'self', capture: 'heatMeter' }).where(eq(heatingPlants.id, 'hp')))
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'applies' }, '2025-11-01')), refused(400, /§ 7 Abs\. 1 Satz 2/))
  })
})

// Prüfung C-M3: Contracting wie Fernwärme. Den Strom zur Wärmeerzeugung bezahlt der Lieferant; der Strom von Pumpen
// und Regelung der Hausanlage lässt sich als Betriebsstrom erfassen, auch bei einer Wärmepumpe des Lieferanten.
test('Betriebsstrom bei Contracting mit Wärmepumpe: Schätzhilfe statt der Sperre zum Strom der Wärmeerzeugung', async () => {
  await withDatabase(async (opened) => {
    let n = 0
    const ids = () => `id${++n}`
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'heatPump', method: 'manual', contracting: true })
      await createEntity(db, 'costItems', 'w', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wärme', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' })
    })
    const r = await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 5000, basis: 'Pumpen der Hausanlage' }, ids))
    assert.ok(r, 'gebucht')
    // „Steckt auch im Allgemeinstrom“ beim Teil Brennstoff/Energie gibt es nur für Strom der eigenen Wärmeerzeugung.
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'f', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Strom', amountCents: 10000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp', operatingPower: 'included' })),
      (e: unknown) => e instanceof Error && /nicht mit Strom heizt/.test(e.message))
  })
})
