// Die Heizanlage (Heizung PR 4, Entwurf 5.3, 11.2 und 13): anlegen, ändern, entfernen, mit den
// Sperren der späteren PRs und der Zuordnung offener Heizpositionen. An der Verteilung ändert eine
// Anlage in dieser Version nichts; das prüft calc-heizanlage.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import type { Database } from '../src/db/client.ts'
import { closeSettlement, createEntity, createProperty, findEntity, HeatingError, removeEntity, removeProperty } from '../src/db/repository.ts'
import { assignableHeatingItems, createHeatingPlant, listHeatingPlants, removeHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { meters } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey } from '../../shared/period.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizung-'))

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

const fieldOf = (entity: unknown, key: string): unknown =>
  entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined

const wohnung = (db: Database, id: string, propertyId = 'objekt-1') =>
  createEntity(db, 'units', id, { propertyId, name: id, areaM2: 50, participates: true })
const heizposition = (db: Database, id: string, period = '2025-01', extra: Record<string, unknown> = {}) =>
  createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period, category: HEATING_CATEGORY, description: id, amountCents: 100000, key: 'area', ...extra })

// Eine Ablehnung mit Status und Satz.
const refused = (status: 400 | 409, text: RegExp) => (err: unknown): boolean =>
  err instanceof HeatingError && err.status === status && text.test(err.message)

test('Anlegen: Vorgaben, und so steht sie in der Liste', async () => {
  await withDatabase(async (opened) => {
    const { plant, assigned } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service', assignItemIds: [] }))
    assert.equal(assigned, 0)
    assert.deepEqual(plant, {
      id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
      devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null,
      capturedOnOct2024: null, warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, units: null,
    })
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [plant])
  })
})

test('Anlegen: ohne Energieträger entsteht nichts', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { method: 'manual' })), refused(400, /Womit wird geheizt/))
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [])
  })
})

test('Sperren: was spätere Versionen rechnen, lehnt der Server mit einem Satz ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => wohnung(db, 'u1'))
    const faelle: [Record<string, unknown>, RegExp][] = [
      [{ method: 'self' }, /eigene Heizkostenabrechnung .* kommt mit einer späteren Version/],
      [{ supply: 'perUnit' }, /Etagenheizungen .* kommen mit einer späteren Version/],
      [{ periodStartMonth: 5 }, /eigene Heizperiode .* kommt mit einer späteren Version/],
      [{ separateSettlement: true }, /getrennte Heizkostenabrechnung .* kommt mit einer späteren Version/],
      [{ units: [{ unitId: 'u1', heatedAreaM2: 60 }] }, /beheizte Fläche .* kommt mit einer späteren Version/],
      [{ source: 'homeowners', method: 'manual' }, /Gemeinschaft/],
      [{ captureInstalledOn: '01.06.2025' }, /kein Datum/],
    ]
    for (const [rumpf, satz] of faelle) {
      await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', ...rumpf })), refused(400, satz), JSON.stringify(rumpf))
    }
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [])
  })
})

test('Zweite Anlage: im selben Objekt gesperrt, in einem anderen Objekt erlaubt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { energy: 'oil' })), refused(400, /zweite Heizanlage/))
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp3', 'objekt-2', { energy: 'oil' }))
    assert.equal(plant.propertyId, 'objekt-2')
  })
})

test('Wohnungen: nur aus dem eigenen Objekt; die letzte gelöscht heißt keine, nicht alle', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await wohnung(db, 'u1')
      await wohnung(db, 'fremd', 'objekt-2')
    })
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', units: [{ unitId: 'fremd', heatedAreaM2: null }] })),
      /Objekt/,
    )
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', units: [{ unitId: 'u1', heatedAreaM2: null }] }))
    assert.deepEqual(plant.units, [{ unitId: 'u1', heatedAreaM2: null }])
    await opened.write((db) => removeEntity(db, 'units', 'u1'))
    const [danach] = await opened.read((db) => listHeatingPlants(db, 'objekt-1'))
    assert.deepEqual(danach?.units, [], 'eine leere Liste, nicht null: sonst versorgte die Anlage plötzlich alle Wohnungen')
  })
})

test('Zuordnung: offene Heizpositionen kommen mit dem Anlegen zur Anlage, abgeschlossene nicht', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c-offen')
      await heizposition(db, 'c-zu', '2024-01')
      await createEntity(db, 'costItems', 'c-kalt', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area' })
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
    })
    assert.deepEqual(
      await opened.read((db) => assignableHeatingItems(db, 'objekt-1')),
      [{ id: 'c-offen', period: '2025-01', description: 'c-offen', amountCents: 100000 }],
    )
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c-zu'] })),
      refused(409, /geändert/),
    )
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [], 'nichts halb angelegt')
    const { assigned } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c-offen'] }))
    assert.equal(assigned, 1)
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-offen')), 'heatingPlantId'), 'hp1')
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-zu')), 'heatingPlantId'), undefined)
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c-kalt')), 'heatingPlantId'), undefined)
  })
})

test('Ändern: verschmilzt, und die Sperren gelten auch hier', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' }))
    const geaendert = await opened.write((db) => updateHeatingPlant(db, 'hp1', { devicesRemote: 'partial', devicesInstalledAfter2021: 'some' }))
    assert.equal(geaendert?.devicesRemote, 'partial')
    assert.equal(geaendert?.devicesInstalledAfter2021, 'some')
    assert.equal(geaendert?.method, 'service', 'was nicht im Rumpf steht, bleibt')
    await assert.rejects(() => opened.write((db) => updateHeatingPlant(db, 'hp1', { method: 'self' })), refused(400, /späteren Version/))
    assert.equal(await opened.write((db) => updateHeatingPlant(db, 'gibt-es-nicht', { name: 'X' })), null)
  })
})

test('Entfernen: gibt die Positionen frei; mit Zählern erst, wenn sie gelöst sind', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c1')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', assignItemIds: ['c1'] })
      // Am Repository vorbei, die Merkmale der Zähler kommen erst mit Task 4.
      await db.insert(meters).values({ id: 'gas', propertyId: 'objekt-1', name: 'Gaszähler', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp1', heatingRole: 'supply' })
    })
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'meters', meters: ['Gaszähler'] })
    await opened.write((db) => removeEntity(db, 'meters', 'gas'))
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: true, released: 1 })
    assert.equal(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c1')), 'heatingPlantId'), undefined)
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: false, reason: 'missing' })
  })
})

test('Objekt löschen: eine Heizanlage hält es, wie eine Wohnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp1', 'objekt-2', { energy: 'gas' })
    })
    assert.deepEqual(await opened.write((db) => removeProperty(db, 'objekt-2')), { removed: false, reason: 'inUse', inUse: '1 Heizanlage' })
  })
})
