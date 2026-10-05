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
import { closeSettlement, createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, removeEntity, removeProperty, updateEntity } from '../src/db/repository.ts'
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
      newDevicesInstall: null,
      periodChanges: [], separateSpans: [],
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
      // Heizung PR 5: den Rhythmus setzt nur der Wechsel mit Vorschau.
      [{ periodStartMonth: 5 }, /Zeitraum der Heizung/],
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

// ---------- Kostenpositionen und Zähler an der Anlage ----------

test('Heizposition: eine neue gehört der einzigen Anlage, auch ohne Feld (alter Tab, Belegbuchung)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    assert.equal(fieldOf(await opened.write((db) => heizposition(db, 'c-neu')), 'heatingPlantId'), 'hp1')
    assert.equal(
      fieldOf(await opened.write((db) => heizposition(db, 'c-ohne', '2025-01', { heatingPlantId: null })), 'heatingPlantId'),
      undefined,
      'ausdrücklich ohne Anlage bleibt ohne',
    )
    assert.equal(
      fieldOf(await opened.write((db) => heizposition(db, 'c-alt', '2024-01')), 'heatingPlantId'),
      undefined,
      'ein abgeschlossener Zeitraum bekommt keine Anlage',
    )
    const kalt = await opened.write((db) => createEntity(db, 'costItems', 'c-kalt', {
      propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area',
    }))
    assert.equal(fieldOf(kalt, 'heatingPlantId'), undefined)
  })
})

test('Heizposition: wechselt die Kostenart, fällt die Anlage weg; wird sie zur Heizposition, bekommt sie die Anlage wie beim Anlegen', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' }))
    await opened.write((db) => heizposition(db, 'c1'))
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { category: 'Müllabfuhr' })), 'heatingPlantId'), undefined)
    // Durchsicht von #230 (M2): nachträglich zur Heizposition gemacht, wie eine neue.
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { category: HEATING_CATEGORY })), 'heatingPlantId'), 'hp1')
    // Eine Heizposition, die ausdrücklich ohne Anlage steht, bleibt beim Ändern ohne.
    await opened.write((db) => updateEntity(db, 'costItems', 'c1', { heatingPlantId: null }))
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c1', { description: 'Gas 2025' })), 'heatingPlantId'), undefined)
    // Kalt angelegt und mit ausdrücklich ohne Anlage zur Heizposition gemacht: bleibt ohne.
    await opened.write((db) => createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'M', amountCents: 1, key: 'area' }))
    assert.equal(fieldOf(await opened.write((db) => updateEntity(db, 'costItems', 'c2', { category: HEATING_CATEGORY, heatingPlantId: null })), 'heatingPlantId'), undefined)
  })
})

test('Heizposition: in einem abgeschlossenen Zeitraum keine neue Zuordnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await heizposition(db, 'c-zu', '2024-01')
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: {} })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    await assert.rejects(() => opened.write((db) => updateEntity(db, 'costItems', 'c-zu', { heatingPlantId: 'hp1' })), refused(409, /abgeschlossen/))
  })
})

test('Zähler und Heizposition: die Anlage eines anderen Objekts wird abgelehnt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' })
      await createHeatingPlant(db, 'hp2', 'objekt-2', { energy: 'oil' })
    })
    const fremd = (err: unknown) => err instanceof CrossPropertyError && /Heizanlage aber zu/.test(err.message)
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { heatingPlantId: 'hp2' })), fremd)
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm1', {
      propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp2', heatingRole: 'supply',
    })), fremd)
  })
})

test('Verbrauchsschlüssel nach Heizkostenverteilern: abgelehnt mit Verweis auf die Einzelbeträge', async () => {
  await withDatabase(async (opened) => {
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { key: 'meter', meterType: 'hkv' })), refused(400, /Einzelbeträge/))
  })
})

test('Zähler der Anlage: mit Rolle und ohne Wohnung; jede Abweichung mit einem Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await wohnung(db, 'u1')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    const speicher = await opened.write((db) => createEntity(db, 'meters', 'm1', {
      propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
      heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
    }))
    assert.deepEqual(
      ['heatingPlantId', 'heatingRole', 'remoteReadable', 'installedOn'].map((k) => fieldOf(speicher, k)),
      ['hp1', 'dhwHeat', false, '2022-03-01'],
    )
    await assert.rejects(() => opened.write((db) => updateEntity(db, 'meters', 'm1', { unitId: 'u1' })), refused(400, /Wohnung gehört nicht zur Heizanlage/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm2', {
      propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp1',
    })), refused(400, /Was misst der Zähler/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm3', {
      propertyId: 'objekt-1', name: 'Gesamt', unitId: null, type: 'kaltwasser', unit: 'm³', heatingPlantId: 'hp1', heatingRole: 'totalHeat',
    })), refused(400, /Sparte „Wärme“/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm4', {
      propertyId: 'objekt-1', name: 'HKV', unitId: null, type: 'hkv', unit: 'Einheiten',
    })), refused(400, /Heizkörper/))
    await assert.rejects(() => opened.write((db) => createEntity(db, 'meters', 'm5', {
      propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten', installedOn: '15.12.2021',
    })), refused(400, /kein Datum/))
    const hkv = await opened.write((db) => createEntity(db, 'meters', 'm6', {
      propertyId: 'objekt-1', name: 'HKV Bad', unitId: 'u1', type: 'hkv', unit: 'Einheiten', remoteReadable: true,
    }))
    assert.equal(fieldOf(hkv, 'remoteReadable'), true)
    assert.equal(fieldOf(hkv, 'heatingPlantId'), undefined)
    const geloest = await opened.write((db) => updateEntity(db, 'meters', 'm1', { heatingPlantId: null }))
    assert.equal(fieldOf(geloest, 'heatingRole'), undefined, 'ohne Anlage keine Rolle')
  })
})

test('Frage nach dem Einbau: einzeln oder als Ganzes neu wird gespeichert und lässt sich leeren (Nachprüfung von #230)', async () => {
  await withDatabase(async (opened) => {
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', newDevicesInstall: 'single' }))
    assert.equal(plant.newDevicesInstall, 'single')
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { newDevicesInstall: 'whole' })))?.newDevicesInstall, 'whole')
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { newDevicesInstall: null })))?.newDevicesInstall, null)
    assert.equal((await opened.write((db) => updateHeatingPlant(db, 'hp1', { newDevicesInstall: 'irgendwie' })))?.newDevicesInstall, null)
  })
})

