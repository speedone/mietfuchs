// Bezugszähler und Rest (#98) auf der Ebene der Datenbank: das Repository schreibt und liest ohne Verlust, der Befund
// über Objektgrenzen (Wiederherstellen, Rücksprung) findet einen Verweis, den die Routen nie zugelassen hätten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, createProperty, crossPropertyViolations, removeEntity, unitDependents, updateEntity } from '../src/db/repository.ts'
import { costItemMeterRest, costItemMeterRestBehind, costItemMeterRestSubs, costItemMeterRestUnits } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { CostItem, Meter, MeterRest } from '../../shared/types.ts'

type Opened = Awaited<ReturnType<typeof openFreshDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zaehler-rest-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const meter = (id: string, propertyId: string, extra: Partial<Meter> = {}): Meter => ({ id, propertyId, name: `Zähler ${id}`, unitId: null, type: 'kaltwasser', unit: 'm³', ...extra })

test('Der Schnappschuss führt meterRest an der Position und scope am Zähler', async () => {
  await withDatabase(async (opened) => {
    const rest: MeterRest = {
      referenceMeterId: 'main', behindMeterIds: ['m1'], key: 'units', unitIds: ['a'],
      subMeters: [{ meterId: 'wg', target: { key: 'direct', unitIds: ['a'] } }, { meterId: 'garten', target: 'excluded' }],
    }
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'meters', 'main', meter('main', 'objekt-1'))
      await createEntity(db, 'meters', 'm1', meter('m1', 'objekt-1', { unitId: 'a' }))
      await createEntity(db, 'meters', 'wg', meter('wg', 'objekt-1', { scope: 'common' }))
      await createEntity(db, 'meters', 'garten', meter('garten', 'objekt-1', { scope: 'common' }))
      const item: Partial<CostItem> = { propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser', meterRest: rest }
      await createEntity(db, 'costItems', 'c1', item)
    })
    const stock = await opened.read(readStock)
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const snap = snapshotFor(stock, 'objekt-1', p)
    assert.deepEqual(snap.costItems.find((c) => c.id === 'c1')?.meterRest, rest)
    assert.equal(snap.meters.find((m) => m.id === 'wg')?.scope, 'common')
    assert.equal(snap.meters.find((m) => m.id === 'main')?.scope, undefined)
  })
})

test('Wiederherstellen: ein Zähler oder eine Wohnung eines anderen Objekts in der Angabe wird gefunden', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus' })
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'units', 'n', { propertyId: 'objekt-2', name: 'Nachbar', areaM2: 40, participates: true })
      await createEntity(db, 'meters', 'fremd', meter('fremd', 'objekt-2'))
      await createEntity(db, 'meters', 'fremd2', meter('fremd2', 'objekt-2', { unitId: 'n' }))
      await createEntity(db, 'meters', 'fremd3', meter('fremd3', 'objekt-2', { scope: 'common' }))
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser' })
    })
    assert.deepEqual(await opened.read(crossPropertyViolations), [])
    // So, wie ein verfälschtes Archiv sie hätte: an den Routen vorbei.
    await opened.write(async (db) => {
      await db.insert(costItemMeterRest).values({ costItemId: 'c1', referenceMeterId: 'fremd', key: 'area', unitIdsAll: false, behindAll: false })
      await db.insert(costItemMeterRestBehind).values({ costItemId: 'c1', meterId: 'fremd2' })
      await db.insert(costItemMeterRestSubs).values({ costItemId: 'c1', meterId: 'fremd3', targetKind: 'group', targetKey: 'area', targetUnitIds: JSON.stringify(['n']) })
      await db.insert(costItemMeterRestUnits).values({ costItemId: 'c1', unitId: 'n' })
    })
    const befunde = await opened.read(crossPropertyViolations)
    assert.equal(befunde.filter((b) => /„Wasser“.*„Zähler fremd“.*anderen Objekts/.test(b)).length, 1, befunde.join('\n'))
    assert.equal(befunde.filter((b) => /„Zähler fremd2“/.test(b)).length, 1, befunde.join('\n'))
    assert.equal(befunde.filter((b) => /„Zähler fremd3“/.test(b)).length, 1, befunde.join('\n'))
    assert.equal(befunde.filter((b) => /verteilt den Rest auf eine Wohnung eines anderen Objekts/.test(b)).length, 1, befunde.join('\n'))
    assert.equal(befunde.filter((b) => /Zwischenzählers auf eine Wohnung eines anderen Objekts/.test(b)).length, 1, befunde.join('\n'))
  })
})

// Ruling 11: „tragen Sie (wie bisher)“ mit Zwischenzähler wird als eigener Schlüssel 'standard' gespeichert; die
// Bedingung der Tabelle kennt ihn, und ein Bestand vor dem Schritt behält seine Zeilen.
test("Rest-Schlüssel 'standard' wird gespeichert und gelesen", async () => {
  await withDatabase(async (opened) => {
    const rest: MeterRest = { referenceMeterId: null, behindMeterIds: null, key: 'standard', unitIds: null, subMeters: [{ meterId: 'garten', target: 'landlord' }] }
    await opened.write(async (db) => {
      await createEntity(db, 'meters', 'garten', meter('garten', 'objekt-1', { scope: 'common' }))
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser', meterRest: rest })
    })
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.costItems.find((c) => c.id === 'c1')?.meterRest, rest)
  })
})

// Abschlussdurchsicht I3: Eine gelöschte Wohnung, die in der Gruppe eines Zwischenzählers stand, sperrte danach jedes
// Speichern der Position mit einem falschen Satz („anderes Objekt“). Sie fällt jetzt aus der Gruppe; eine leere Gruppe
// geht an den Vermieter, wie die Berechnung einen Teil ohne Basis ohnehin verbucht.
test('Wohnung gelöscht: sie fällt aus der Gruppe des Zwischenzählers, die Position lässt sich weiter speichern', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
      await createEntity(db, 'meters', 'g', meter('g', 'objekt-1', { scope: 'common' }))
      await createEntity(db, 'meters', 'h', meter('h', 'objekt-1', { scope: 'common' }))
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser',
        meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [{ meterId: 'g', target: { key: 'area', unitIds: ['a', 'b'] } }, { meterId: 'h', target: { key: 'direct', unitIds: ['b'] } }] } })
    })
    const deps = await opened.read((db) => unitDependents(db, 'b')) ?? assert.fail('Wohnung fehlt')
    assert.ok(deps.costItemLinks >= 2, `Verweise: ${deps.costItemLinks}`)
    await opened.write((db) => removeEntity(db, 'units', 'b'))
    await opened.write((db) => updateEntity(db, 'costItems', 'c1', { amountCents: 2000 }))
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.costItems.find((c) => c.id === 'c1')?.meterRest?.subMeters, [
      { meterId: 'g', target: { key: 'area', unitIds: ['a'] } },
      { meterId: 'h', target: 'landlord' },
    ])
  })
})

test('Eine unbekannte Wohnung in der Angabe: der Satz sagt, dass es sie nicht mehr gibt', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'meters', 'g', meter('g', 'objekt-1', { scope: 'common' })))
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Wasser', description: 'Wasser', amountCents: 1000, key: 'meter', meterType: 'kaltwasser',
      meterRest: { referenceMeterId: null, behindMeterIds: null, key: 'area', unitIds: null, subMeters: [{ meterId: 'g', target: { key: 'area', unitIds: ['weg'] } }] } })),
    (e: Error) => /gibt es nicht mehr/.test(e.message) && !/anderen Objekt/.test(e.message))
  })
})

// M2: „Zähler für einen Teil des Hauses“ gibt es nur für die Sparten mit verteiltem Rest; die Meldung nennt keinen
// internen Wert.
test('Zähler für einen Teil des Hauses nur bei Wasser, Strom und Sonstigem; Meldung ohne internen Wert', async () => {
  await withDatabase(async (opened) => {
    for (const [type, unit] of [['warmwasser', 'm³'], ['waerme', 'kWh']] as const) {
      await assert.rejects(opened.write((db) => createEntity(db, 'meters', `x-${type}`, meter(`x-${type}`, 'objekt-1', { type, unit, scope: 'common' }))),
        (e: Error) => /Teil des Hauses/.test(e.message) && /Wasser, Strom und „Sonstiges“/.test(e.message), type)
    }
    await opened.write((db) => createEntity(db, 'meters', 'ok', meter('ok', 'objekt-1', { type: 'strom', unit: 'kWh', scope: 'common' })))
    await assert.rejects(opened.write((db) => createEntity(db, 'meters', 'odd', { ...meter('odd', 'objekt-1'), scope: 'teil' })),
      (e: Error) => !/common/.test(e.message) && /Zähler für einen Teil des Hauses/.test(e.message))
  })
})
