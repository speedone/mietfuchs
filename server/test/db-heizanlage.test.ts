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
import { closeSettlement, createEntity, createProperty, CrossPropertyError, findEntity, HeatingError, PeriodError, removeEntity, removeProperty, updateEntity } from '../src/db/repository.ts'
import { assignableHeatingItems, createHeatingPlant, heatingPlantViolations, listHeatingPlants, removeHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { previewSeparate } from '../src/db/separateSettlement.ts'
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
      nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, heatPumpMajority: null, selfSpans: [],
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
      // Heizung PR 10: zur eigenen Heizkostenabrechnung nur über die Einrichtung (Abweichung 17).
      [{ method: 'self' }, /Einrichtung/],
      // Heizung PR 5: den Rhythmus setzt nur der Wechsel mit Vorschau.
      [{ periodStartMonth: 5 }, /Zeitraum der Heizung/],
      [{ source: 'homeowners', method: 'manual' }, /Gemeinschaft/],
      [{ captureInstalledOn: '01.06.2025' }, /kein Datum/],
    ]
    for (const [rumpf, satz] of faelle) {
      await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', ...rumpf })), refused(400, satz), JSON.stringify(rumpf))
    }
    assert.deepEqual(await opened.read((db) => listHeatingPlants(db, 'objekt-1')), [])
  })
})

test('Zweite Anlage (Heizung PR 9): mit Namen und Wohnungen; die erste bekommt beides im selben Schritt (Review Focus 1)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas' })
    })
    // Die erste hat weder Namen noch Liste: ohne Anpassung entsteht nichts, und die erste bleibt, wie sie war.
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })),
      refused(400, /braucht jede einen Namen/),
    )
    assert.deepEqual((await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).map((p) => [p.id, p.name, p.units]), [['hp1', '', null]])
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp2', 'objekt-1', {
      buildingWith: 'own', name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }],
      adjust: [{ id: 'hp1', name: 'Zentralheizung', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }],
    }))
    assert.equal(plant.name, 'Gastherme DG')
    const erste = (await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).find((p) => p.id === 'hp1')
    assert.deepEqual([erste?.name, erste?.units?.map((u) => u.unitId)], ['Zentralheizung', ['eg', 'og']])
    // Eine Anpassung an einer Anlage eines anderen Objekts wird abgelehnt.
    await opened.write((db) => createProperty(db, 'objekt-2', { name: 'Zweites Haus', kind: 'mfh', address: '' }))
    await opened.write((db) => createHeatingPlant(db, 'hpx', 'objekt-2', { energy: 'oil' }))
    await assert.rejects(
      () => opened.write((db) => createHeatingPlant(db, 'hp3', 'objekt-1', { buildingWith: 'own', name: 'Keller', energy: 'gas', units: [], adjust: [{ id: 'hpx', name: 'Fremd' }] })),
      refused(409, /gibt es nicht mehr/),
    )
  })
})

test('Zwei Anlagen: Wohnungen schließen sich aus, Namen verschieden, keine ohne Liste und ohne Namen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Zentralheizung', energy: 'gas', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] })
      await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Gastherme DG', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    })
    const aendern = (id: string, body: unknown) => opened.write((db) => updateHeatingPlant(db, id, body))
    await assert.rejects(() => aendern('hp2', { units: [{ unitId: 'dg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] }), refused(400, /Die Wohnung „og“ hängt an „(Zentralheizung|Gastherme DG)“ und an „(Zentralheizung|Gastherme DG)“/))
    await assert.rejects(() => aendern('hp2', { name: 'zentralheizung' }), refused(400, /Zwei Heizanlagen heißen „[Zz]entralheizung“/))
    await assert.rejects(() => aendern('hp1', { units: null }), refused(400, /braucht jede ihre Wohnungen/))
    await assert.rejects(() => aendern('hp1', { name: ' ' }), refused(400, /braucht jede einen Namen/))
    // Nichts davon ist gespeichert.
    assert.deepEqual((await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).map((p) => [p.name, p.units?.map((u) => u.unitId)]), [['Zentralheizung', ['eg', 'og']], ['Gastherme DG', ['dg']]])
    // Ohne die zweite gilt wieder alles wie bei einer Anlage.
    assert.equal((await opened.write((db) => removeHeatingPlant(db, 'hp2'))).removed, true)
    assert.equal((await aendern('hp1', { name: '', units: null }))?.units, null)
  })
})

test('Neue Heizposition ohne Anlage bei zwei Anlagen: die Anlage ihrer Wohnungen, sonst keine (Review Focus 4)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og', 'dg']) await wohnung(db, u)
      await createEntity(db, 'tenancies', 't-dg', { unitId: 'dg', tenantName: 'Mieter DG', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { name: 'Zentralheizung', energy: 'gas', units: [{ unitId: 'eg', heatedAreaM2: null }, { unitId: 'og', heatedAreaM2: null }] })
      await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Haus B', energy: 'gas', units: [{ unitId: 'dg', heatedAreaM2: null }] })
    })
    const anlage = async (id: string, extra: Record<string, unknown>) => fieldOf(await opened.write((db) => heizposition(db, id, '2025-01', extra)), 'heatingPlantId')
    assert.equal(await anlage('direkt', { key: 'direct', directUnitId: 'dg' }), 'hp2')
    assert.equal(await anlage('teilnehmer', { participantUnitIds: ['eg', 'og'] }), 'hp1')
    assert.equal(await anlage('einzel', { key: 'amounts', tenancyAmounts: { 't-dg': 50000 } }), 'hp2')
    assert.equal(await anlage('ganzes-haus', {}), undefined)
    assert.equal(await anlage('ueber-beide', { participantUnitIds: ['og', 'dg'] }), undefined)
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
    await assert.rejects(() => opened.write((db) => updateHeatingPlant(db, 'hp1', { method: 'self' })), refused(400, /Einrichtung/))
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
    assert.deepEqual(await opened.write((db) => removeHeatingPlant(db, 'hp1')), { removed: true, released: 1, notice: null })
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


// ---------- Etagenheizung auf Vermietervertrag (Heizung PR 9) ----------

test('Etagenheizung: nur mit freien Schlüsseln und ohne Vorrat; sonst ein Satz', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => wohnung(db, 'eg'))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'service' })), refused(400, /direkt dieser Wohnung zu/))
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'oil', supply: 'perUnit', method: 'manual' })), refused(400, /eigenem Tank oder Lager/))
    const { plant } = await opened.write((db) => createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'manual' }))
    assert.deepEqual([plant.supply, plant.method], ['perUnit', 'manual'])
  })
})

test('Etagenheizung: jede Heizposition direkt bei einer Wohnung der Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', supply: 'perUnit', method: 'manual', units: [{ unitId: 'eg', heatedAreaM2: null }] })
    })
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c1', '2025-01', { heatingPlantId: 'hp1' })), refused(400, /genau einer Wohnung/))
    await assert.rejects(() => opened.write((db) => heizposition(db, 'c2', '2025-01', { heatingPlantId: 'hp1', key: 'direct', directUnitId: 'og' })), refused(400, /hängt nicht an der Etagenheizung/))
    const ok = await opened.write((db) => heizposition(db, 'c3', '2025-01', { key: 'direct', directUnitId: 'eg' }))
    assert.equal(fieldOf(ok, 'heatingPlantId'), 'hp1')
  })
})

// ---------- Kesseltausch (Heizung PR 9) ----------

test('Kesseltausch: die alte Anlage endet am Vortag, die neue beginnt mit denselben Wohnungen; Lieferungen danach gehören zur neuen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['eg', 'og']) await wohnung(db, u)
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'oil', method: 'manual' })
      await createDelivery(db, 'd1', 'hp1', { label: 'Heizöl', deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l' })
    })
    // Den Energieträger umstellen geht nicht; der Satz verweist auf den Kesseltausch.
    await assert.rejects(() => opened.write((db) => updateHeatingPlant(db, 'hp1', { energy: 'gas' })), refused(400, /„Heizung erneuert \(Kessel getauscht\)“/))
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '01.07.2025', energy: 'gas' })), refused(400, /kein Datum/))
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-03-01', energy: 'gas' })), refused(400, /Lieferung .* nach dem Tausch/))
    const { plant } = (await opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'gas', name: 'Gastherme', previousName: 'Ölkessel' }))) ?? assert.fail('keine Anlage')
    assert.deepEqual([plant.name, plant.energy, plant.method, plant.replacesPlantId, plant.endsOn, plant.units?.map((u) => u.unitId)], ['Gastherme', 'gas', 'manual', 'hp1', null, ['eg', 'og']])
    const alt = (await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).find((p) => p.id === 'hp1')
    assert.deepEqual([alt?.name, alt?.endsOn, alt?.units?.map((u) => u.unitId)], ['Ölkessel', '2025-06-30', ['eg', 'og']])
    // Beim Wiederherstellen kein Befund: Die beiden Anlagen teilen sich die Wohnungen nacheinander.
    assert.deepEqual(await opened.read((db) => heatingPlantViolations(db)), [])
    // Ein zweiter Tausch derselben Anlage geht nicht; eine Lieferung nach dem letzten Betriebstag auch nicht.
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp3', { date: '2026-01-01', energy: 'gas' })), refused(409, /schon außer Betrieb/))
    await assert.rejects(() => opened.write((db) => createDelivery(db, 'd2', 'hp1', { label: 'Heizöl', deliveredAt: '2025-08-01', quantity: 500, quantityUnit: 'l' })), refused(400, /seit dem 01\.07\.2025 außer Betrieb/))
    await assert.rejects(() => opened.write((db) => createDelivery(db, 'g1', 'hp2', { label: 'Gas', invoiceFrom: '2025-06-01', invoiceTo: '2025-12-31' })), refused(400, /erst seit dem 01\.07\.2025/))
    await opened.write((db) => createDelivery(db, 'g2', 'hp2', { label: 'Gas', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31' }))
    // Getrennte Heizkostenabrechnung nach dem Tausch: noch nicht (Weg d hängt an der Zuordnung der Wohnungen).
    await assert.rejects(() => opened.read((db) => previewSeparate(db, 'hp2', { separate: true, month: '2026-01' }, '2026-02-01')), (err: unknown) => err instanceof PeriodError && /Kesseltausch/.test(err.message))
    // Eine neue Heizposition ohne Anlage: die, die zu Beginn ihres Leistungszeitraums heizt (Recht I7 der
    // Durchsicht von #238), ohne Leistungszeitraum zu Beginn ihres Zeitraums.
    assert.equal(fieldOf(await opened.write((db) => heizposition(db, 'c25', '2025-01')), 'heatingPlantId'), 'hp1')
    assert.equal(fieldOf(await opened.write((db) => heizposition(db, 'c25b', '2025-01', { serviceFrom: '2025-08-01', serviceTo: '2025-08-31' })), 'heatingPlantId'), 'hp2')
    // Mit verknüpfter Lieferung deren Anlage.
    assert.equal(fieldOf(await opened.write((db) => heizposition(db, 'c25g', '2025-01', { serviceFrom: '2025-01-01', serviceTo: '2025-01-31', fuelDeliveryId: 'g2', heatingPart: 'fuel' })), 'heatingPlantId'), 'hp2')
    // Die Wohnungen beider Anlagen ändern sich nur gemeinsam; eine dritte Anlage darf sie nicht haben.
    await assert.rejects(() => opened.write((db) => createHeatingPlant(db, 'hp9', 'objekt-1', { buildingWith: 'own', name: 'Kamin', energy: 'other', units: [{ unitId: 'eg', heatedAreaM2: null }] })), refused(400, /Die Wohnung „eg“ hängt an/))
  })
})

test('Kesseltausch: nicht in einer abgeschlossenen Heizperiode, nicht bei einer Etagenheizung', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await wohnung(db, 'eg')
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'manual' })
      await closeSettlement(db, { id: 's25', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} })
    })
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'hp1', 'hp2', { date: '2025-07-01', energy: 'districtHeating' })), refused(409, /abgeschlossen/))
    await opened.write((db) => createHeatingPlant(db, 'etage', 'objekt-1', { buildingWith: 'own', name: 'Thermen', energy: 'gas', supply: 'perUnit', method: 'manual', units: [], adjust: [{ id: 'hp1', name: 'Zentral', units: [{ unitId: 'eg', heatedAreaM2: null }] }] }))
    await assert.rejects(() => opened.write((db) => replaceHeatingPlant(db, 'etage', 'hp3', { date: '2026-03-01', energy: 'gas' })), refused(400, /Etagenheizung/))
  })
})
