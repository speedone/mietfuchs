// Kesseltausch und mehrere Anlagen in der Datenbank: die Befunde der Durchsicht von #238 (Heizung PR 9).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { closeSettlement, createEntity, HeatingError, removeEntity } from '../src/db/repository.ts'
import { createHeatingPlant, heatingPlantViolations, listHeatingPlants, removeHeatingPlant, replaceHeatingPlant, straightenHeatingPlants, updateHeatingPlant } from '../src/db/heating.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-tausch-'))
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const wohnung = (db: Database, id: string) => createEntity(db, 'units', id, { propertyId: 'objekt-1', name: id, areaM2: 50, participates: true })
const refused = (status: 400 | 409, text: RegExp) => (err: unknown): boolean => err instanceof HeatingError && err.status === status && text.test(err.message)
const plantsOf = (opened: OpenedDatabase) => opened.read((db) => listHeatingPlants(db, 'objekt-1'))

for (const ids of [['a1', 'a2', 'a3'], ['z', 'm', 'a'], ['a', 'z', 'm']] as const) {
  test(`C1: zweiter Kesseltausch ${ids.join(' → ')} gelingt in jeder Reihenfolge der Kennungen`, async () => {
    await withDatabase(async (opened) => {
      await opened.write(async (db) => {
        for (const u of ['eg', 'og']) await wohnung(db, u)
        await createHeatingPlant(db, ids[0], 'objekt-1', { energy: 'oil', method: 'manual' })
      })
      await opened.write((db) => replaceHeatingPlant(db, ids[0], ids[1], { date: '2025-07-01', energy: 'gas' }))
      await opened.write((db) => replaceHeatingPlant(db, ids[1], ids[2], { date: '2027-07-01', energy: 'heatPump' }))
      await opened.write((db) => updateHeatingPlant(db, ids[2], { name: 'Wärmepumpe' }))
      assert.deepEqual(await opened.read((db) => heatingPlantViolations(db)), [])
    })
  })
}

test('C2: Die ersetzte Anlage entfernen nimmt der Nachfolgerin den Verweis; ein verwaister Verweis im Archiv wird geradegerückt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
    })
    await opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'districtHeating' }))
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp1'))).removed, true)
    assert.deepEqual((await plantsOf(opened)).map((p) => [p.id, p.replacesPlantId]), [['hp2', null]])
    assert.deepEqual(await opened.read((db) => heatingPlantViolations(db)), [])
    // Ein Archiv aus der Zeit davor kann einen Verweis ins Leere tragen.
    await opened.write((db) => db.update(heatingPlants).set({ replacesPlantId: 'gibt-es-nicht' }).where(eq(heatingPlants.id, 'hp2')))
    assert.deepEqual(await opened.write((db) => straightenHeatingPlants(db)), ['Fernwärme ab 01.07.2025'])
    assert.equal((await plantsOf(opened))[0]?.replacesPlantId, null)
  })
})

test('I1: Die neue Anlage entfernen macht den Tausch rückgängig; eine stillgelegte Anlage bekommt keine Position für die Zeit danach', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
    })
    await opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'districtHeating' }))
    const position = (id: string, period: string) => opened.write((db) => createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area' }))
    assert.equal(Reflect.get(Object(await position('c26', '2026-01')), 'heatingPlantId'), 'hp2')
    await opened.write((db) => removeEntity(db, 'costItems', 'c26'))
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp2'))).removed, true)
    assert.deepEqual((await plantsOf(opened)).map((p) => [p.id, p.endsOn]), [['hp1', null]])
    assert.equal(Reflect.get(Object(await position('c27', '2027-01')), 'heatingPlantId'), 'hp1')
  })
})

test('Recht I1: gleicher Energieträger über einen Zähler braucht keinen Tausch; Öl → Öl geht', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await wohnung(db, 'eg')
      await createHeatingPlant(db, 'gas', 'objekt-1', { energy: 'gas', method: 'manual' })
    })
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'gas', 'gas2', { date: '2025-07-01', energy: 'gas' })), refused(409, /brauchen Sie keinen Tausch/))
    await opened.write((db) => replaceHeatingPlant(db, 'gas', 'oel', { date: '2025-07-01', energy: 'oil' }))
    const { plant } = (await opened.write((db) => replaceHeatingPlant(db, 'oel', 'oel2', { date: '2026-07-01', energy: 'oil' }))) ?? assert.fail('keine Anlage')
    assert.equal(plant.energy, 'oil')
  })
})

test('Recht I3: eine weitere gleichzeitig laufende Anlage fragt nach dem Gebäude, ohne Vorbelegung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'dg']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Zentral', energy: 'gas', units: [{ unitId: 'eg', heatedAreaM2: null }] })
    })
    const zweite = { name: 'Therme DG', energy: 'gas', supply: 'perUnit', method: 'manual', units: [{ unitId: 'dg', heatedAreaM2: null }] }
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', zweite)), refused(400, /im selben Gebäude wie „Zentral“/))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { ...zweite, buildingWith: 'gibt-es-nicht' })), refused(400, /gibt es in diesem Objekt nicht/))
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { ...zweite, buildingWith: 'hp1' }))
    assert.equal(plant.buildingWith, 'hp1')
  })
})

test('Geld M1 und M2: Angaben der alten Anlage nach dem Tausch sperren; ein Tausch zum Ersten nach dem Abschluss des Vorjahres geht', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await wohnung(db, 'eg')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await createEntity(db, 'costItems', 'c26', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'Gas 2026', amountCents: 100000, key: 'area', heatingPlantId: 'hp1' })
    })
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'districtHeating' })), refused(409, /„Gas 2026“ für die Zeit nach dem Tausch/))
    await opened.write((db) => removeEntity(db, 'costItems', 'c26'))
    await opened.write((db) => closeSettlement(db, { id: 's25', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'districtHeating' })), refused(409, /abgeschlossene Heizperiode/))
    const { previous } = (await opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2026-01-01', energy: 'districtHeating' }))) ?? assert.fail('keine Anlage')
    assert.equal(previous.endsOn, '2025-12-31')
  })
})

test('Recht M5: Fernwärme ist keine Etagenheizung', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => wohnung(db, 'eg'))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'districtHeating', supply: 'perUnit', method: 'manual' })), refused(400, /Fernwärme ist keine Etagenheizung/))
  })
})
