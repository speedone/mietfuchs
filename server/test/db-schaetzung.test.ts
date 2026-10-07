// Schätzungen nach § 9a in der Datenbank (Heizung PR 13): lesen, Schnappschuss, Objektgrenze.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, createProperty, crossPropertyViolations, removeEntity } from '../src/db/repository.ts'
import { removeEstimate, saveEstimate } from '../src/db/heatingEstimates.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { dropIfEmpty, ensureHeatingPeriod } from '../src/db/heatingPeriodContext.ts'
import { heatingEstimates } from '../src/db/schema.ts'
import { databaseProblem } from '../src/db/errors.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-schaetzung-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

async function haus(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}
async function schaetzungDirekt(opened: Opened, unitId: string): Promise<string> {
  return opened.write(async (db) => {
    const heatingPeriodId = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
    await db.insert(heatingEstimates).values({ heatingPeriodId, unitId, part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true })
    return heatingPeriodId
  })
}

test('Schätzungen werden mit Anlage und Heizperiode gelesen und stehen im Schnappschuss des Objekts', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await schaetzungDirekt(opened, 'c')
    const stock = await opened.read(readStock)
    assert.deepEqual(stock.heatingEstimates, [
      { plantId: 'hp', period: '2025-01', unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true },
    ])
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    assert.deepEqual(snapshotFor(stock, 'objekt-1', p).heatingEstimates?.map((e) => e.unitId), ['c'])
  })
})

test('Ohne Schätzung bleibt der Schnappschuss Feld für Feld, wie er war', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    assert.equal('heatingEstimates' in snapshotFor(await opened.read(readStock), 'objekt-1', p), false)
  })
})

test('Die Datenbank lehnt eine Schätzung ohne Begründung mit einem eigenen Satz ab', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    let found: unknown = null
    try {
      await opened.write(async (db) => {
        const heatingPeriodId = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
        await db.insert(heatingEstimates).values({ heatingPeriodId, unitId: 'c', part: 'heat', value: 1, method: 'buildingAverage', reason: '  ', confirmed: false })
      })
    } catch (e) {
      found = e
    }
    const problem = databaseProblem(found) ?? assert.fail(`kein Fehler der Datenbank: ${String(found)}`)
    assert.equal(problem.status, 400)
    assert.match(problem.message, /Zu einer Schätzung nach § 9a HeizkostenV gehört eine Begründung/)
  })
})

test('Eine Heizperiode mit Schätzung bleibt stehen, wenn eine andere Angabe geleert wird', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const id = await schaetzungDirekt(opened, 'c')
    await opened.write((db) => dropIfEmpty(db, id))
    assert.equal((await opened.read(readStock)).heatingEstimates.length, 1)
  })
})

test('Wiederherstellen: eine Schätzung an einer Wohnung eines anderen Objekts wird gefunden', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Nebenhaus' })
      await createEntity(db, 'units', 'n', { propertyId: 'objekt-2', name: 'N', areaM2: 40, participates: true })
    })
    await schaetzungDirekt(opened, 'n')
    const befunde = await opened.read(crossPropertyViolations)
    assert.ok(befunde.some((b) => /Schätzung.*„N“.*anderen Objekts/.test(b)), befunde.join('\n'))
    // Der Schnappschuss des Objekts 1 nimmt sie nicht mit: Die Wohnung gehört nicht dazu.
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    assert.equal(snapshotFor(await opened.read(readStock), 'objekt-1', p).heatingEstimates, undefined)
  })
})

// ---------- Speichern und Entfernen (Task 4) ----------

const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && Reflect.get(e, 'status') === code && text.test(e.message)
let ids = 0
const newId = () => `m-${++ids}`
// Wie `haus`, dazu Mieter und die eigene Abrechnung mit Wärme- und Warmwasserzählern (Einrichtung, PR 10).
async function eigeneAbrechnung(opened: Opened, over: Record<string, unknown> = {}): Promise<void> {
  await haus(opened)
  await opened.write(async (db) => {
    for (const u of ['a', 'b', 'c']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    await setUpSelf(db, 'hp', {
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false, ...over,
    }, '2026-02-01', newId)
  })
}
const GUT = { value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt, Ersatz erst im Januar', confirmed: true }

test('Schätzung speichern, ändern und entfernen; die leere Heizperiode fällt danach weg', async () => {
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    const e = await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, reason: '  Wärmezähler defekt, Ersatz erst im Januar ' }))
    assert.deepEqual(e, { plantId: 'hp', period: '2025-01', unitId: 'c', part: 'heat', value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt, Ersatz erst im Januar', confirmed: true })
    await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', { ...GUT, value: 11500, confirmed: false }))
    await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'water', { ...GUT, value: 30 }))
    assert.deepEqual((await opened.read(readStock)).heatingEstimates.map((x) => [x.part, x.value, x.confirmed]), [['heat', 11500, false], ['water', 30, true]])
    assert.equal(await opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'c', 'heat')), true)
    assert.equal(await opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'c', 'heat')), false)
    assert.equal(await opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'c', 'water')), true)
    assert.equal(await opened.write((db) => saveEstimate(db, 'gibt-es-nicht', '2025-01', 'c', 'heat', GUT)), null)
    assert.equal(await opened.write((db) => removeEstimate(db, 'gibt-es-nicht', '2025-01', 'c', 'heat')), null)
  })
})

test('Review Focus 5: jede ungültige Eingabe mit einem Satz, nichts geschrieben', async () => {
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    const save = (unitId: string, part: string, body: Record<string, unknown>) => opened.write((db) => saveEstimate(db, 'hp', '2025-01', unitId, part, body))
    await assert.rejects(save('c', 'heat', { ...GUT, value: -1 }), status(400, /Zahl ab 0/))
    await assert.rejects(save('c', 'heat', { ...GUT, value: '12000' }), status(400, /Zahl ab 0/))
    await assert.rejects(save('c', 'heat', { ...GUT, value: Number.NaN }), status(400, /Zahl ab 0/))
    await assert.rejects(save('c', 'heat', { ...GUT, reason: '  ' }), status(400, /Begründung/))
    await assert.rejects(save('c', 'heat', { ...GUT, reason: 5 }), status(400, /Begründung/))
    await assert.rejects(save('c', 'heat', { ...GUT, method: 'raten' }), status(400, /drei Wege/))
    await assert.rejects(save('c', 'gas', GUT), status(400, /Heizung oder das Warmwasser/))
    await assert.rejects(save('zz', 'heat', GUT), status(400, /gibt es in diesem Objekt nicht/))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '1999-13', 'c', 'heat', GUT)), status(400, /Heizperiode/))
    assert.deepEqual((await opened.read(readStock)).heatingEstimates, [])
  })
})

test('Schätzung nur bei eigener Abrechnung, nur mit Gerät, nur an angeschlossener Wohnung, nur mit Warmwasser, abgeschlossen gesperrt', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT)), status(400, /eigenen Heizkostenabrechnung/))
  })
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened, { hotWater: 'none', waterConsumptionPct: undefined, dhwHeatMeter: false })
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'water', GUT)), status(400, /kein Warmwasser/))
  })
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened)
    // Ohne Wärmezähler an der Wohnung gibt es nichts, was ausgefallen sein könnte (Abweichung 4 des Plans).
    const zaehler = (await opened.read(readStock)).meters.find((m) => m.unitId === 'c' && m.type === 'waerme') ?? assert.fail('kein Wärmezähler C')
    await opened.write((db) => removeEntity(db, 'meters', zaehler.id))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT)), status(400, /keinen Wärmezähler.*Ausstattungspflicht/s))
    // Eine Wohnung, die nicht an der Anlage hängt.
    await opened.write((db) => createEntity(db, 'units', 'g', { propertyId: 'objekt-1', name: 'Garage', areaM2: 15, participates: true, noConnection: ['waerme'] }))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'g', 'heat', GUT)), status(400, /hängt nicht an dieser Heizanlage/))
    // Gespeichert vor dem Abschluss, danach weder änderbar noch entfernbar (keine rückwirkende Wirkung).
    await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'a', 'heat', GUT))
    await opened.write((db) => closeSettlement(db, { id: 'abschluss', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01T10:00:00.000Z', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'a', 'heat', { ...GUT, value: 1 })), status(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeEstimate(db, 'hp', '2025-01', 'a', 'heat')), status(409, /abgeschlossen/))
    assert.deepEqual((await opened.read(readStock)).heatingEstimates.map((x) => x.value), [12000])
  })
})

test('Werte eines Ablesedienstes: Mietfuchs kennt die Geräte nicht und prüft keins', async () => {
  await withDatabase(async (opened) => {
    await eigeneAbrechnung(opened, { capture: 'serviceValues' })
    const e = await opened.write((db) => saveEstimate(db, 'hp', '2025-01', 'c', 'heat', GUT))
    assert.equal(e?.unitId, 'c')
  })
})
