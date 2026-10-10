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
import { readCostItems } from '../src/db/read.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { periodKey } from '../../shared/period.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, removeEntity, updateEntity } from '../src/db/repository.ts'

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
  amountCents: -14784, key: 'area', operatingPower: 'deduction', operatingPowerItemId: itemId, ...over,
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
    assert.match(rejects(c, insert('a', 'Heizung und Warmwasser', 1, ', heating_part, operating_power', ", 'fuel', 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('b', 'Grundsteuer', 1, ', operating_power', ", 'included'")) ?? '', /cost_items_operating_power_included_valid/)
    assert.match(rejects(c, insert('d', 'Beleuchtung/Allgemeinstrom', 100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('e', 'Gebäudereinigung', -100, ', operating_power', ", 'deduction'")) ?? '', /cost_items_operating_power_deduction_valid/)
    assert.match(rejects(c, insert('f', 'Beleuchtung/Allgemeinstrom', -100, ', operating_power_item_id', ", 'bs'")) ?? '', /cost_items_operating_power_link_valid/)
    assert.match(rejects(c, insert('g', 'Heizung und Warmwasser', 1, ', operating_power', ", 'sonst'")) ?? '', /cost_items_operating_power_known/)
    // P-W1: Eine Grundlage der Schätzung gibt es nur an einer gekennzeichneten Position.
    assert.match(rejects(c, insert('i', 'Grundsteuer', 1, ', operating_power_basis', ", 'Grundlage'")) ?? '', /cost_items_operating_power_basis_valid/)
    assert.equal(rejects(c, insert('h', 'Beleuchtung/Allgemeinstrom', -14784, ', operating_power, operating_power_item_id, operating_power_basis', ", 'deduction', 'bs', 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh'")), null)
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
    assert.deepEqual(['operatingPower', 'operatingPowerItemId', 'operatingPowerBasis'].filter((k) => Object.hasOwn(Object(ohne), k)), [])
  })
})

test('Review Focus 3: der Abzug bleibt gekennzeichnet, wenn ein alter Tab ihn ohne die Felder speichert', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'bs', heizung()))
    await opened.write((db) => createEntity(db, 'costItems', 'ab', abzug('bs', { operatingPowerBasis: 'Grundlage' })))
    await opened.write((db) => updateEntity(db, 'costItems', 'ab', { description: 'Abzug Betriebsstrom 2025', amountCents: -15000 }))
    const ab = await opened.read((db) => findEntity(db, 'costItems', 'ab'))
    assert.deepEqual([fieldOf(ab, 'operatingPower'), fieldOf(ab, 'operatingPowerItemId'), fieldOf(ab, 'operatingPowerBasis'), fieldOf(ab, 'amountCents')], ['deduction', 'bs', 'Grundlage', -15000])
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
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerBasis: '5 % der Brennstoffkosten 2025 (2.956,80 €)' }))
    const hand = await opened.read((db) => findEntity(db, 'costItems', 'hand'))
    assert.deepEqual([fieldOf(hand, 'operatingPower'), fieldOf(hand, 'operatingPowerItemId')], ['deduction', 'bs'])
    await opened.write((db) => updateEntity(db, 'costItems', 'hand', { operatingPower: null, operatingPowerItemId: null, operatingPowerBasis: null }))
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
    assert.deepEqual([b.deduction.category, b.deduction.amountCents, b.deduction.key, b.deduction.operatingPower, b.deduction.operatingPowerItemId, b.deduction.period],
      ['Beleuchtung/Allgemeinstrom', -14784, 'units', 'deduction', h.id, '2025-01'])
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
        (e: unknown) => e instanceof HeatingError && e.status === 400 && /selbst verbraucht, Brennstoff und kein Betriebsstrom/.test(e.message) && /Umwälzpumpen oder Regelung/.test(e.message))
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
