// Betriebsstrom der Heizung (Heizung PR 15, #212): die drei Spalten an cost_items, ihre Bedingungen und
// die Prüfungen beim Schreiben und Löschen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations, connect, loadMigrations, type Connection } from '../src/db/client.ts'
import { eq } from 'drizzle-orm'
import { createHeatingPlant } from '../src/db/heating.ts'
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { readCostItems, readStock } from '../src/db/read.ts'
import { taxReportFor } from '../src/calc.ts'
import { costItems, heatingPlants, properties } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, createProperty, CrossPropertyError, crossPropertyViolations, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-'))

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
  const opened = await openDatabase({ dataDir })
  try {
    // Die Stromrechnung, auf die jeder Abzug zeigt (Durchsicht von #252, G-K3).
    await opened.write((db) => createEntity(db, 'costItems', 'hausstrom', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom 2025', amountCents: 105000, key: 'area' }))
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const fieldOf = (entity: unknown, key: string): unknown => (entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined)
const heizung = (over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung',
  amountCents: 14784, key: 'area', heatingPart: 'operating', operatingPower: 'included', ...over,
})
const abzug = (itemId: string | null, over: Record<string, unknown> = {}) => ({
  propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom Heizung',
  amountCents: -14784, key: 'area', operatingPower: 'deduction', operatingPowerItemId: itemId, operatingPowerGeneralId: 'hausstrom', ...over,
})

test('Kette: die Schritte betriebsstrom und betriebsstrom_bedingungen bringen drei nullbare Spalten, jeder Bestand bleibt NULL', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_betriebsstrom'))
    if (bis < 0) assert.fail('Schritt …_betriebsstrom fehlt')
    assert.ok(migrations.some((m) => m.tag.endsWith('_betriebsstrom_bedingungen')), 'Schritt …_betriebsstrom_bedingungen fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('alt', 'objekt-1', '2025-01', 'Beleuchtung/Allgemeinstrom', 'Strom', 105000, 'area')`)
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT operating_power, operating_power_item_id, operating_power_basis FROM cost_items WHERE id = 'alt'"), [[null, null, null]])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Prüfbedingungen: Betriebsstrom nur an Heizkosten (Teil Betrieb), Abzug nur am Allgemeinstrom und negativ, Verweis nur am Abzug', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    applyMigrations(c, await loadMigrations())
    c.exec('PRAGMA foreign_keys = ON')
    const insert = (id: string, category: string, amount: number, extra: string, values: string) =>
      `INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${extra}) VALUES ('${id}', 'objekt-1', '2025-01', '${category}', 'x', ${amount}, 'area'${values})`
    assert.equal(rejects(c, insert('bs', 'Heizung und Warmwasser', 14784, ', heating_part, operating_power', ", 'operating', 'included'")), null)
    assert.equal(rejects(c, insert('bs2', 'Heizung und Warmwasser', 14784, ', operating_power', ", 'included'")), null)
    assert.match(rejects(c, insert('a', 'Heizung und Warmwasser', 1, ', heating_part, operating_power', ", 'metering', 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('b', 'Grundsteuer', 1, ', operating_power', ", 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('d', 'Beleuchtung/Allgemeinstrom', 100, ', operating_power, operating_power_general_id', ", 'deduction', 'bs'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('e', 'Gebäudereinigung', -100, ', operating_power, operating_power_general_id', ", 'deduction', 'bs'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('f', 'Beleuchtung/Allgemeinstrom', -100, ', operating_power_item_id', ", 'bs'")) ?? '', /cost_items_operating_power_link_valid/)
    assert.match(rejects(c, insert('g', 'Heizung und Warmwasser', 1, ', operating_power', ", 'sonst'")) ?? '', /cost_items_operating_power_known/)
    // P-W1: Eine Grundlage der Schätzung gibt es nur an einer gekennzeichneten Position.
    assert.match(rejects(c, insert('i', 'Grundsteuer', 1, ', operating_power_basis', ", 'Grundlage'")) ?? '', /cost_items_operating_power_basis_valid/)
    // G-K3: Ein Abzug zeigt auf seine Stromrechnung, und nur ein Abzug tut das.
    assert.equal(rejects(c, insert('strom', 'Beleuchtung/Allgemeinstrom', 105000, '', '')), null)
    assert.match(rejects(c, insert('h0', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id', ", 'deduction', 'bs'")) ?? '', /cost_items_operating_power_source_complete/)
    assert.match(rejects(c, insert('h1', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power_general_id', ", 'strom'")) ?? '', /cost_items_operating_power_general_valid/)
    assert.equal(rejects(c, insert('h', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id, operating_power_general_id, operating_power_basis', ", 'deduction', 'bs', 'strom', 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh'")), null)
    assert.match(rejects(c, "DELETE FROM cost_items WHERE id = 'strom'") ?? '', /FOREIGN KEY/)
    // RESTRICT: Der Betriebsstrom lässt sich nicht löschen, solange der Abzug auf ihn zeigt.
    assert.match(rejects(c, "DELETE FROM cost_items WHERE id = 'bs'") ?? '', /FOREIGN KEY/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Schreiben: Betriebsstrom und Abzug werden gelesen, wie sie gespeichert sind', async () => {
  await withDatabase(async (opened) => {
    const bs = await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    assert.equal(fieldOf(bs, 'operatingPower'), 'included')
    const ab = await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs', { operatingPowerBasis: 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh' })))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerBasis')], ['deduction', 'bs', 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh'])
    const ohne = await opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area' }))
    // Ohne Angabe fehlen die Schlüssel ganz (die Rundreise in db-stock.test.ts vergleicht streng).
    assert.deepEqual(['operatingPower', 'operatingPowerItemId', 'operatingPowerGeneralId', 'operatingPowerBasis'].filter((k) => Object.hasOwn(Object(ohne), k)), [])
  })
})

test('Review Focus 3: der Abzug bleibt gekennzeichnet, wenn ein alter Tab ihn ohne die Felder speichert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs', { operatingPowerBasis: 'Grundlage' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'ab', { description: 'Abzug Betriebsstrom 2025', amountCents: -15000 }))
    const ab = await opened.read((db) => findEntity(db, 'costItems', 'ab'))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerGeneralId'), fieldOf(ab, 'operatingPowerBasis'), fieldOf(ab, 'amountCents')], ['deduction', 'bs', 'hausstrom', 'Grundlage', -15000])
  })
})

test('P-W1: die Grundlage der Schätzung lässt sich ändern und leeren; ohne Kennzeichnung lehnt der Server mit Satz ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung({ operatingPowerBasis: 'alt' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPowerBasis: 'neu, mit Typenschild' }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'bs')), 'operatingPowerBasis'), 'neu, mit Typenschild')
    await opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPowerBasis: null }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'bs')), 'operatingPowerBasis'), undefined)
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'G', amountCents: 100, key: 'area', operatingPowerBasis: 'x' })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Grundlage der Schätzung/.test(e.message))
  })
})

test('P-W2: ein von Hand erfasster Abzug lässt sich nachträglich mit dem Betriebsstrom verknüpfen und wieder lösen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'hand', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Heizstrom 5 % der Brennstoffkosten', amountCents: -14784, key: 'area' }))
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'hausstrom', operatingPowerBasis: '5 % der Brennstoffkosten 2025 (2.956,80 €)' }))
    const hand = await opened.read((db) => findEntity(db, 'costItems', 'hand'))
    assert.deepEqual([fieldOf(hand, 'operatingPower'), fieldOf(hand, 'operatingPowerItemId')], ['deduction', 'bs'])
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: null, operatingPowerItemId: null, operatingPowerGeneralId: null, operatingPowerBasis: null }))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'hand')), 'operatingPower'), undefined)
  })
})

// R2-W1: Bei einer Wärmepumpe ist nur ihr eigener Strom Brennstoff; Umwälzpumpen und Regelung über den
// Hauszähler bleiben Betriebsstrom. Kennzeichnen und Verknüpfen im Kostenformular bleiben deshalb offen;
// abgelehnt wird nur die Schätzhilfe (Task 4).
test('R2-W1: an einer Anlage mit Wärmepumpe oder Stromheizung lassen sich Betriebsstrom kennzeichnen und ein Abzug verknüpfen', async () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    await withDatabase(async (opened) => {
      await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' }))
      await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung({ description: 'Umwälzpumpen und Regelung', heatingPlantId: 'hp' })))
      await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
      const ab = await opened.read((db) => findEntity(db, 'costItems', 'ab'))
      assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId')], ['deduction', 'bs'], energy)
    })
  }
})

test('Prüfen: ein Abzug zeigt nur auf Betriebsstrom desselben Objekts, der Betriebsstrom verliert die Kennzeichnung nicht unter einem Abzug', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x1', abzug('gas'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /nicht als Betriebsstrom gekennzeichnet/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x2', abzug('fehlt'))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /gibt es nicht/.test(e.message))
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x3', abzug('bs', { propertyId: 'objekt-2' }))),
      (e: unknown) => e instanceof CrossPropertyError && /gehört zu einem anderen Objekt/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x4', abzug('bs', { amountCents: 100 }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /negativen Betrag/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x5', abzug(null, { category: 'Gebäudereinigung' }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Beleuchtung\/Allgemeinstrom/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x6', heizung({ category: 'Grundsteuer', heatingPart: null }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Heizung und Warmwasser/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x7', { ...abzug('bs'), operatingPower: null })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Nur ein Abzug/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'bs', { operatingPower: null })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Abzug „Abzug Betriebsstrom Heizung“/.test(e.message))
  })
})

test('Review Focus 2: Betriebsstrom mit Abzug lässt sich nicht löschen; mit einem Satz statt eines Datenbankfehlers', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'bs')),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Abzug Betriebsstrom Heizung“/.test(e.message) && /Löschen Sie zuerst den Abzug/.test(e.message))
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'ab')), true)
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'bs')), true)
  })
})

// ---------- Schätzhilfe: Betriebsstrom und Abzug in einer Transaktion (Task 4) ----------

const strom = { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'area' }
const schaetzung = (over: Record<string, unknown> = {}) => ({
  period: '2025-01', generalItemId: 'strom', billKwh: 3000,
  devices: [{ label: 'Brenner', watts: 120, hoursPerDay: 6 }, { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 }, { label: 'Regelung', watts: 5, hoursPerDay: 24 }],
  heatingDays: 220, ...over,
})
let n = 0
const ids = () => `neu-${++n}`
const markierte = async (opened: OpenedDatabase) => (await opened.read((db) => readCostItems(db))).filter((c) => c.operatingPower !== undefined)

test('Schätzhilfe bei freien Schlüsseln: Betriebsstrom nach dem Schlüssel des Brennstoffs, Abzug nach dem des Allgemeinstroms', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, key: 'meter', meterType: 'waerme', heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, key: 'units' }))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    if (!b) return assert.fail('keine Anlage')
    assert.equal(b.method, 'estimate')
    assert.equal(b.share.cents, 14784)
    const h = b.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.category, h.amountCents, h.key, h.meterType, h.heatingPart, h.operatingPower, h.heatingPlantId, h.period],
      ['Heizung und Warmwasser', 14784, 'meter', 'waerme', 'operating', 'included', 'hp', '2025-01'])
    assert.match(h.description, /Betriebsstrom Heizung \(geschätzt\)/)
    assert.deepEqual([b.deduction.category, b.deduction.amountCents, b.deduction.key, b.deduction.operatingPower, b.deduction.operatingPowerItemId, b.deduction.operatingPowerGeneralId, b.deduction.period],
      ['Beleuchtung/Allgemeinstrom', -14784, 'units', 'deduction', h.id, 'strom', '2025-01'])
    // P-W1: Die Grundlage mit allen Eingaben steht an beiden Positionen, gelesen aus der Datenbank.
    const grundlage = [
      'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh',
      'Umwälzpumpe: 45 W × 24 h × 220 Tage = 237,6 kWh',
      'Regelung: 5 W × 24 h × 220 Tage = 26,4 kWh',
      'zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %',
      '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €',
    ].join('\n')
    assert.deepEqual((await markierte(opened)).map((c) => c.operatingPowerBasis), [grundlage, grundlage])
  })
})

// P-W2: der dritte Weg, etwa für einen Bruchteil der Brennstoffkosten (V ZR 166/15 Rn. 14).
test('Schätzhilfe „Betrag selbst geschätzt“: Betrag und Grundlage an beiden Positionen, ohne Prozentsatz', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: 'Bruchteil der Brennstoffkosten 2025' }, ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.equal(b?.method, 'own')
    assert.deepEqual([h.amountCents, b?.deduction.amountCents], [14784, -14784])
    assert.match(h.description, /\(selbst geschätzt\)/)
    assert.equal(h.operatingPowerBasis, 'selbst geschätzt: 147,84 €\nGrundlage der Schätzung: Bruchteil der Brennstoffkosten 2025')
    assert.equal(b?.deduction.operatingPowerBasis, h.operatingPowerBasis)
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom', ownCents: 14784, basis: '' }, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Grundlage der Schätzung/.test(e.message))
  })
})

// P-W5 mit R2-W1: Bei Wärmepumpe und Stromheizung keine Schätzhilfe; der Satz nennt den Weg für Pumpen
// und Regelung über das Kostenformular.
test('Schätzhilfe bei Wärmepumpe und Stromheizung: 400 mit dem Satz zum Brennstoff, nichts angelegt', async () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    await withDatabase(async (opened) => {
      await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'service' }))
      await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
      await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
        (e: unknown) => e instanceof HeatingError && e.status === 400 && /zur Wärmeerzeugung verbraucht, zu den Heiz- und Warmwasserkosten, und zwar nicht als Betriebsstrom/.test(e.message) && /Umwälzpumpen oder Regelung/.test(e.message))
      assert.equal((await markierte(opened)).length, 0, energy)
    })
  }
})

test('Schätzhilfe bei eigener Abrechnung: Schlüssel nach Heizkostenverordnung, Teil Betrieb, Ziel beides', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    // Die eigene Abrechnung richtet PR 10 über die Einrichtung ein; für diesen Test genügen Methode und
    // Erfassung (die Bedingung heating_plants_self_capture_complete verlangt sie).
    await opened.write((db) => db.update(heatingPlants).set({ method: 'self', capture: 'heatMeter' }).where(eq(heatingPlants.id, 'hp')))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: null, heatingDays: null, measuredKwh: 500 }), ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.equal(b?.method, 'measured')
    assert.deepEqual([h.key, h.heatingPart, h.heatingTarget, h.amountCents], ['heatingSystem', 'operating', 'both', 17500])
    assert.match(h.description, /\(gemessen\)/)
  })
})

test('Schätzhilfe beim Messdienst: nur der Abzug, ohne Verweis, beschrieben als an den Messdienst gemeldet (P-K9)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids))
    assert.equal(b?.heatingItem, null)
    assert.deepEqual([b?.deduction.amountCents, b?.deduction.operatingPowerItemId], [-14784, undefined])
    assert.equal(b?.deduction.description, 'Abzug Betriebsstrom Heizung (geschätzt), an Messdienst gemeldet')
    assert.match(b?.deduction.operatingPowerBasis ?? '', /147,84 €/)
  })
})

const gemeinschaftsSatz = (message: string): boolean =>
  /dazu ist die Gemeinschaft verpflichtet \(BGH, Urteil vom 03\.06\.2016, V ZR 166\/15\)/.test(message) &&
  /Prüfen Sie in der Hausgeldabrechnung, ob der Betriebsstrom bei den Heizkosten steht/.test(message) &&
  /wenden Sie sich an die Verwaltung/.test(message) &&
  // R2-K2: Die eigene Abrechnung an die Mieter übernähme denselben Fehler.
  /Für Ihre Abrechnung an die Mieter gilt dasselbe \(§ 7 Abs\. 2 HeizkostenV\)/.test(message) &&
  !/tut das die Gemeinschaft/.test(message)

test('Schätzhilfe lehnt ab: Allgemeinstrom mit Einzelbeträgen oder Gemeinschaftsabrechnung (Review Focus 1, P-W4), ohne Brennstoffposition (P-K2), keine Stromposition, zu viele kWh (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    // P-K2: verteilt wird nach § 7 Abs. 1, Abs. 2 zählt nur die Kosten auf.
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Brennstoffposition/.test(e.message) && /\(§ 7 Abs\. 1 und 2 HeizkostenV\)/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ generalItemId: 'gas' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Beleuchtung\/Allgemeinstrom/.test(e.message))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /über dem Verbrauch der Stromrechnung/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'strom', { key: 'amounts', tenancyAmounts: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /in den Beträgen selbst ab/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'strom', { key: 'external', externalBasis: { measure: 'mea', total: 10000, totalCents: 1000000 } }))
    // P-W4: V ZR 166/15 ist gerade der Fall, in dem die Gemeinschaft es nicht getan hatte.
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Allgemeinstrom ist laut Gemeinschaftsabrechnung verteilt/.test(e.message) && gemeinschaftsSatz(e.message))
    // Nichts angelegt: weder Betriebsstrom noch Abzug.
    assert.equal((await markierte(opened)).length, 0)
  })
})

// R2-K1: Auch die Brennstoffposition kann nach Einzelbeträgen oder laut Gemeinschaftsabrechnung verteilt
// sein; je ein eigener Satz, bei der Gemeinschaft derselbe Verweis auf ihre Pflicht wie beim Allgemeinstrom.
test('Schätzhilfe lehnt ab: Brennstoffposition nach Einzelbeträgen oder laut Gemeinschaftsabrechnung, je mit eigenem Satz (R2-K1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp', key: 'amounts', tenancyAmounts: {} })))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Gas“ ist nach Einzelbeträgen verteilt/.test(e.message) && /Einzelbeträge/.test(e.message) && !/Gemeinschaft/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'gas', { key: 'external', tenancyAmounts: null, externalBasis: { measure: 'mea', total: 10000, totalCents: 1000000 } }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Gas“ ist laut Gemeinschaftsabrechnung verteilt/.test(e.message) && gemeinschaftsSatz(e.message) && !/in den Beträgen selbst/.test(e.message))
    assert.equal((await markierte(opened)).length, 0)
  })
})

test('Schätzhilfe: abgeschlossene Heizperiode → 409, unbekannte Heizperiode → 400, unbekannte Anlage → null', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await opened.write((db) => bookOperatingPower(db, 'fehlt', schaetzung(), ids)), null)
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ period: '2025-13' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400)
    await opened.write((db) => closeSettlement(db, { id: 'a1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T00:00:00Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung(), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409)
    assert.equal((await markierte(opened)).length, 0)
  })
})

// P-W3: Die Heizperiode ist offen, der Allgemeinstrom steht aber in einer abgeschlossenen Abrechnung. Ein
// Abzug dort erreichte die Mieter nicht mehr; der Betriebsstrom würde zweimal gezahlt (V ZR 166/15 Rn. 13).
test('Schätzhilfe: Allgemeinstrom in einer abgeschlossenen Abrechnung → 409 mit Satz, nichts angelegt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom24', { ...strom, period: '2024-01', description: 'Hausstrom 2024' }))
    await opened.write((db) => closeSettlement(db, { id: 'a0', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01T00:00:00Z', sentAt: '2025-03-02', settlement: {} }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', schaetzung({ generalItemId: 'strom24' }), ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409 && /Allgemeinstrom „Hausstrom 2024“ steht in einer abgeschlossenen Abrechnung/.test(e.message))
    assert.equal((await markierte(opened)).length, 0)
  })
})

// ---------- Durchsicht von #252, G-K3: der Abzug kennt seine Stromrechnung ----------

test('G-K3: ein Abzug braucht seine Stromrechnung, und die ist Allgemeinstrom mit positivem Betrag im selben Objekt und Zeitraum', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x1', abzug('bs', { operatingPowerGeneralId: null }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Stromrechnung/.test(e.message))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x2', abzug('bs', { operatingPowerGeneralId: 'fehlt' }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Stromrechnung/.test(e.message) && /gibt es nicht/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100, key: 'area' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x3', abzug('bs', { operatingPowerGeneralId: 'gs' }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Grundsteuer“ ist keine Stromrechnung/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'strom24', { propertyId: 'objekt-1', period: '2024-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Allgemeinstrom 2024', amountCents: 90000, key: 'area' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x4', abzug('bs', { operatingPowerGeneralId: 'strom24' }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /im selben Zeitraum/.test(e.message))
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom2', { propertyId: 'objekt-2', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Strom Haus 2', amountCents: 50000, key: 'area' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'x5', abzug(null, { operatingPowerGeneralId: 'strom2' }))),
      (e: unknown) => e instanceof CrossPropertyError)
    const ab = await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    assert.equal(fieldOf(ab, 'operatingPowerGeneralId'), 'hausstrom')
  })
})

test('G-K3: die Stromrechnung mit Abzug lässt sich nicht löschen und nicht zur Gutschrift oder anderen Kostenart machen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug(null)))
    await assert.rejects(opened.write((db) => removeEntity(db, 'costItems', 'hausstrom')),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Abzug Betriebsstrom Heizung“/.test(e.message) && /Löschen Sie zuerst den Abzug/.test(e.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { category: 'Gebäudereinigung' })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Abzug/.test(e.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { amountCents: -100 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Abzug/.test(e.message))
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'ab')), true)
    assert.equal(await opened.write((db) => removeEntity(db, 'costItems', 'hausstrom')), true)
  })
})

test('G-K3: Schritt …_betriebsstrom_rechnung hängt vorhandene Abzüge an die Stromrechnung ihres Zeitraums; ohne Rechnung verlieren sie nur die Kennzeichnung', async () => {
  const dir = tempDir()
  try {
    const connection = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_betriebsstrom_rechnung'))
    if (bis < 0) assert.fail('Schritt …_betriebsstrom_rechnung fehlt')
    applyMigrations(connection, migrations.slice(0, bis))
    const row = (id: string, period: string, category: string, amount: number, extra: string, values: string) =>
      connection.exec(`INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key${extra}) VALUES ('${id}', 'objekt-1', '${period}', '${category}', '${id}', ${amount}, 'area'${values})`)
    row('bs', '2025-01', 'Heizung und Warmwasser', 14784, ', heating_part, operating_power', ", 'operating', 'included'")
    row('klein', '2025-01', 'Beleuchtung/Allgemeinstrom', 20000, '', '')
    row('gross', '2025-01', 'Beleuchtung/Allgemeinstrom', 105000, '', '')
    row('ab', '2025-01', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id, operating_power_basis', ", 'deduction', 'bs', 'Grundlage'")
    row('ab26', '2026-01', 'Beleuchtung/Allgemeinstrom', -5000, ', operating_power, operating_power_item_id, operating_power_basis', ", 'deduction', 'bs', 'Grundlage'")
    applyMigrations(connection, migrations)
    assert.deepEqual(connection.rows("SELECT id, operating_power, operating_power_item_id, operating_power_general_id, operating_power_basis, amount_cents FROM cost_items WHERE id IN ('ab', 'ab26') ORDER BY id"), [
      ['ab', 'deduction', 'bs', 'gross', 'Grundlage', -14784],
      ['ab26', null, null, null, null, -5000],
    ])
    assert.deepEqual(connection.rows('PRAGMA foreign_key_check'), [])
    connection.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Durchsicht von #252, G-W1: zweite Buchung derselben Schätzung ----------

const zweiMal = async (opened: OpenedDatabase, method: 'manual' | 'service' = 'manual') => {
  await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method }))
  if (method === 'manual') await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
  await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, amountCents: 100000 }))
}

test('G-W1: 2 × 600 € aus 1.000 € Stromrechnung → die zweite Buchung 400 mit beiden Beträgen, nichts angelegt', async () => {
  await withDatabase(async (opened) => {
    await zweiMal(opened)
    const body = { period: '2025-01', generalItemId: 'strom', ownCents: 60000, basis: 'Bruchteil der Brennstoffkosten' }
    await opened.write((db) => bookOperatingPower(db, 'hp', body, ids))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', { ...body, despiteExisting: true }, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /1\.200,00 €/.test(e.message) && /1\.000,00 €/.test(e.message))
    assert.equal((await markierte(opened)).length, 2)
  })
})

test('G-W1: schon gebuchter Betriebsstrom derselben Anlage und Heizperiode → 409 mit Rückfrage; mit Bestätigung angelegt (Kesseltausch)', async () => {
  await withDatabase(async (opened) => {
    await zweiMal(opened)
    const body = { period: '2025-01', generalItemId: 'strom', ownCents: 30000, basis: 'alter Kessel bis Juni' }
    await opened.write((db) => bookOperatingPower(db, 'hp', body, ids))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', { ...body, basis: 'neuer Kessel ab Juli' }, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409 && /schon/.test(e.message) && /Betriebsstrom Heizung \(selbst geschätzt\)/.test(e.message))
    assert.equal((await markierte(opened)).length, 2)
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { ...body, basis: 'neuer Kessel ab Juli', despiteExisting: true }, ids))
    assert.equal(b?.deduction.amountCents, -30000)
    assert.equal((await markierte(opened)).length, 4)
  })
})

test('G-W1: beim Messdienst fragt schon ein vorhandener Abzug aus derselben Stromrechnung zurück', async () => {
  await withDatabase(async (opened) => {
    await zweiMal(opened, 'service')
    const body = { period: '2025-01', generalItemId: 'strom', ownCents: 30000, basis: 'geschätzt' }
    await opened.write((db) => bookOperatingPower(db, 'hp', body, ids))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', body, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 409 && /Abzug Betriebsstrom Heizung \(selbst geschätzt\), an Messdienst gemeldet/.test(e.message))
  })
})

// ---------- Durchsicht von #252, G-W2: kein Verweis über die Objektgrenze ----------

test('G-W2: Betriebsstrom, Stromrechnung oder Abzug wechseln nicht das Objekt, solange der Verweis besteht (auch mit Leeren der Anlage)', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung({ heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    const quer = (e: unknown) => e instanceof CrossPropertyError && /anderen Objekt/.test(e.message)
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'bs', { propertyId: 'objekt-2', heatingPlantId: null, heatingPart: null })), quer)
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { propertyId: 'objekt-2' })), quer)
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'ab', { propertyId: 'objekt-2' })), quer)
    const stand = await opened.read((db) => db.select({ id: costItems.id, propertyId: costItems.propertyId }).from(costItems))
    assert.deepEqual(stand.map((c) => c.propertyId), ['objekt-1', 'objekt-1', 'objekt-1'])
    // Ohne Abzug darf der Betriebsstrom das Objekt wechseln.
    await opened.write((db) => removeEntity(db, 'costItems', 'ab'))
    await opened.write((db) => updateEntity(db, 'costItems', 'bs', { propertyId: 'objekt-2', heatingPlantId: null, heatingPart: null }))
  })
})

test('G-W2: die Prüfung beim Wiederherstellen kennt beide Verweise des Abzugs', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs')))
    assert.deepEqual(await opened.read((db) => crossPropertyViolations(db)), [])
    // So steht es in einem Backup aus einem Stand vor der Prüfung.
    await opened.write((db) => db.update(costItems).set({ propertyId: 'objekt-2' }).where(eq(costItems.id, 'bs')))
    await opened.write((db) => db.update(costItems).set({ propertyId: 'objekt-2' }).where(eq(costItems.id, 'hausstrom')))
    const befunde = await opened.read((db) => crossPropertyViolations(db))
    assert.ok(befunde.some((b) => /„Abzug Betriebsstrom Heizung“ zeigt auf den Betriebsstrom „Betriebsstrom Heizung“ eines anderen Objekts/.test(b)), befunde.join('\n'))
    assert.ok(befunde.some((b) => /„Abzug Betriebsstrom Heizung“ zeigt auf die Stromrechnung „Allgemeinstrom 2025“ eines anderen Objekts/.test(b)), befunde.join('\n'))
  })
})

// ---------- Durchsicht von #252, G-K1, G-K2, N1: Zeitraum und Steuerjahr der Stromrechnung ----------

const maiApril = {
  anlage: async (opened: OpenedDatabase, method: 'manual' | 'service') => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method }))
    await opened.write((db) => db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp')))
  },
  objekt: async (opened: OpenedDatabase, method: 'manual' | 'service') => {
    await opened.write((db) => db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')))
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method }))
  },
}
const eigen = { period: '2025-05', ownCents: 30000, basis: 'Bruchteil der Brennstoffkosten' }

test('G-K1: Anlage Mai–April, eigene Abrechnung: Betriebsstrom bekommt das Steuerjahr der Stromrechnung 2025, der Abzug keins', async () => {
  await withDatabase(async (opened) => {
    await maiApril.anlage(opened, 'manual')
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ period: '2025-05', description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp', taxYear: 2026 })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { ...eigen, generalItemId: 'strom' }, ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.period, h.taxYear, b?.deduction.period, b?.deduction.taxYear], ['2025-05', 2025, '2025-01', undefined])
  })
})

test('G-K1: Objekt Mai–April, eigene Abrechnung: beide Positionen im Steuerjahr der Stromrechnung (2026)', async () => {
  await withDatabase(async (opened) => {
    await maiApril.objekt(opened, 'manual')
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ period: '2025-05', description: 'Gas', heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp', taxYear: 2026 })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, period: '2025-05', taxYear: 2026 }))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { ...eigen, generalItemId: 'strom' }, ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.taxYear, b?.deduction.taxYear], [2026, 2026])
  })
})

test('G-K1: Kalenderobjekt mit Messdienst-Anlage Mai–April: nur der Abzug, im Kalenderjahr der Stromrechnung', async () => {
  await withDatabase(async (opened) => {
    await maiApril.anlage(opened, 'service')
    await opened.write((db) => createEntity(db, 'costItems', 'strom', strom))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { ...eigen, generalItemId: 'strom' }, ids))
    assert.deepEqual([b?.heatingItem, b?.deduction.period, b?.deduction.taxYear], [null, '2025-01', undefined])
  })
})

test('G-K1: Objekt Mai–April mit Messdienst: der Abzug bekommt das Steuerjahr der Stromrechnung', async () => {
  await withDatabase(async (opened) => {
    await maiApril.objekt(opened, 'service')
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, period: '2025-05', taxYear: 2026 }))
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { ...eigen, generalItemId: 'strom' }, ids))
    assert.deepEqual([b?.deduction.period, b?.deduction.taxYear], ['2025-05', 2026])
  })
})

// N1: Die Stromrechnung 2024 enthält den Betriebsstrom 2025 nicht; ein Abzug dort käme bei den Mietern 2024 an.
test('N1: Stromrechnung 2024 zur Heizperiode 2025 → 400, nichts angelegt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' }))
    await opened.write((db) => createEntity(db, 'costItems', 'strom24', { ...strom, period: '2024-01', description: 'Hausstrom 2024' }))
    await assert.rejects(opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom24', ownCents: 10000, basis: 'x' }, ids)),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Hausstrom 2024“/.test(e.message) && /Heizperiode 2025/.test(e.message))
    assert.equal((await markierte(opened)).length, 0)
  })
})

// ---------- Durchsicht von #252, G-K4: Betriebsstrom ist keine Gutschrift ----------

test('G-K4: „included“ nur mit positivem Betrag; Bedingung und Wächter mit Satz, alter Bestand verliert nur die Kennzeichnung', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'g', heizung({ description: 'Gutschrift Betriebsstrom', amountCents: -100 }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /„Gutschrift Betriebsstrom“/.test(e.message) && /positiven Betrag/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'bs', { amountCents: 0 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /positiven Betrag/.test(e.message))
  })
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_betriebsstrom_rechnung'))
    applyMigrations(c, migrations.slice(0, bis))
    c.exec("INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_part, operating_power, operating_power_basis) VALUES ('g', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'g', -100, 'area', 'operating', 'included', 'x')")
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows("SELECT operating_power, operating_power_basis, amount_cents FROM cost_items WHERE id = 'g'"), [[null, null, -100]])
    c.exec('PRAGMA foreign_keys = ON')
    assert.match(rejects(c, "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, operating_power) VALUES ('h', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'h', -1, 'area', 'included')") ?? '', /cost_items_operating_power_included_positive/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- Durchsicht von #252, R-W2: Strom zur Wärmeerzeugung über den Hauszähler ----------

test('R-W2: der Abzug darf auf die Strom-Position (Teil „Brennstoff“) einer Wärmepumpe oder Stromheizung zeigen, mit denselben Prüfungen; bei Gas nicht', async () => {
  for (const energy of ['heatPump', 'electric'] as const) {
    await withDatabase(async (opened) => {
      await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' }))
      await opened.write((db) => createEntity(db, 'costItems', 'wp', heizung({ description: 'Strom der Wärmepumpe', heatingPart: 'fuel', amountCents: 60000, heatingPlantId: 'hp' })))
      const ab = await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('wp', { amountCents: -60000 })))
      assert.deepEqual([fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerGeneralId')], ['wp', 'hausstrom'], energy)
      // Dieselben Prüfungen: kein Objektwechsel, solange der Abzug auf die Position zeigt.
      await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus' }))
      await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'wp', { propertyId: 'objekt-2', heatingPlantId: null, heatingPart: null })), (e: unknown) => e instanceof CrossPropertyError)
    })
  }
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ description: 'Gas', heatingPart: 'fuel', heatingPlantId: 'hp' }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Wärmepumpe oder Stromheizung/.test(e.message))
  })
})

// ---------- Nachprüfung von #252, G2-N-W2: führend ist das Steuerjahr des Betriebsstroms ----------

// Objekt Mai–April, Anlage im Kalenderjahr: Der Betriebsstrom der Heizperiode 2025 zählt zu 2025 und lässt
// sich nicht anders stellen; der Abzug aus der Stromrechnung 2025/2026 bekommt deshalb dasselbe Jahr. Die
// Anlage V beider Jahre bleibt, wie sie ohne Betriebsstrom wäre (Umbuchung, Δ 0).
test('G2-N-W2: Objekt Mai–April mit Anlage im Kalenderjahr: Abzug im Steuerjahr des Betriebsstroms, Anlage V beider Jahre unverändert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1')))
    await opened.write((db) => createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true }))
    await opened.write((db) => createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' }))
    await opened.write((db) => db.update(heatingPlants).set({ periodStartMonth: 1 }).where(eq(heatingPlants.id, 'hp')))
    await opened.write((db) => createEntity(db, 'costItems', 'gas', heizung({ period: '2025-01', description: 'Gas 2025', amountCents: 500000, heatingPart: 'fuel', operatingPower: null, heatingPlantId: 'hp' })))
    await opened.write((db) => createEntity(db, 'costItems', 'strom', { ...strom, period: '2025-05', taxYear: 2026, description: 'Hausstrom 2025/2026', amountCents: 100000 }))
    const steuer = async (jahr: number) => taxReportFor(await opened.read((db) => readStock(db)), 'objekt-1', jahr).expenses.totalCents
    const vorher = [await steuer(2025), await steuer(2026)]
    const b = await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'strom', ownCents: 10000, basis: 'Bruchteil' }, ids))
    const h = b?.heatingItem ?? assert.fail('kein Betriebsstrom')
    assert.deepEqual([h.period, h.taxYear, b?.deduction.period, b?.deduction.taxYear], ['2025-01', undefined, '2025-05', 2025])
    assert.deepEqual([await steuer(2025), await steuer(2026)], vorher)
  })
})

// ---------- Nachprüfung von #252, G2-K1: dieselbe Summenregel im Kostenformular ----------

test('G2-K1: Abzüge über der Stromrechnung lehnt auch das Kostenformular ab, beim Abzug wie beim Verkleinern der Rechnung', async () => {
  await withDatabase(async (opened) => {
    // Hausstrom 1.050,00 €: ein Handabzug von 1.200,00 € ist zu viel.
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'hand', abzug(null, { amountCents: -120000 }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /1\.200,00 €/.test(e.message) && /1\.050,00 €/.test(e.message))
    await opened.write((db) => createEntity(db, 'costItems', 'a1', abzug(null, { amountCents: -30000 })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'a2', abzug(null, { amountCents: -80000 }))),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /mehr als die Rechnung/.test(e.message))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'a1', { amountCents: -110000 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /mehr als die Rechnung/.test(e.message))
    // Nach einer Buchung von 300 € lässt sich die Rechnung nicht auf 100 € verkleinern.
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { amountCents: 10000 })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /300,00 €/.test(e.message))
    await opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { amountCents: 30000 }))
  })
})

// Nachprüfung von #252, G2-K3 (O1): Die Rechnung wechselt nicht still den Zeitraum, der Abzug bliebe im alten.
test('G2-K3: Stromrechnung mit Abzug wechselt im Kostenformular nicht den Zeitraum', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug(null)))
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'hausstrom', { period: '2024-01' })),
      (e: unknown) => e instanceof HeatingError && e.status === 400 && /Zeitraum/.test(e.message) && /„Abzug Betriebsstrom Heizung“/.test(e.message))
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'hausstrom')), 'period'), '2025-01')
  })
})
