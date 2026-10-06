// Tabellenzeile an der Lieferung und Erzeuger an der Anlage in der Datenbank (Heizung PR 11,
// Abweichungen 4 und 5 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, updateDelivery } from '../src/db/fuel.ts'
import { heatingPeriodViews, saveHotWater } from '../src/db/co2.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { openDatabase } from '../src/db/open.ts'
import { readFuelDeliveries, readHeatingPlants } from '../src/db/read.ts'
import { createEntity, HeatingError } from '../src/db/repository.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-warmwasser-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const heatingError = (status: 400 | 409, text: RegExp) => (err: unknown) =>
  err instanceof HeatingError && err.status === status && text.test(err.message)

async function heizung(opened: Opened, energy: 'oil' | 'gas' | 'districtHeating' = 'oil'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
  })
}

test('Erzeuger der Anlage: ohne Angabe null, „allein“ und „mit weiterem Erzeuger“ werden gespeichert, Unbekanntes ergibt null', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened)
    const plant = async () => (await opened.read(readHeatingPlants)).find((p) => p.id === 'hp') ?? assert.fail('keine Anlage')
    assert.equal((await plant()).heatGeneration, null)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
    assert.equal((await plant()).heatGeneration, 'single')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'mixed' }))
    assert.equal((await plant()).heatGeneration, 'mixed')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'bivalent' }))
    assert.equal((await plant()).heatGeneration, null)
    // Ein Teilrumpf ohne das Feld lässt es stehen (repository.ts: zusammengeführt nach Anwesenheit).
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { name: 'Keller' }))
    assert.equal((await plant()).heatGeneration, 'single')
  })
})

test('Tabellenzeile an der Lieferung: nur eine Zeile, die zum Energieträger passt; leer heißt keine', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened)
    const lieferung = { label: 'Öl Oktober', deliveredAt: '2025-10-12', quantity: 3000, quantityUnit: 'l' }
    const d = await opened.write((db) => createDelivery(db, 'o1', 'hp', { ...lieferung, fuelGrade: 'heatingOilEL' })) ?? assert.fail('keine Anlage')
    assert.equal(d.fuelGrade, 'heatingOilEL')
    await assert.rejects(
      opened.write((db) => updateDelivery(db, d.id, { fuelGrade: 'naturalGasH' })),
      heatingError(400, /Erdgas H.*passt nicht zu einer Heizung mit Heizöl.*Leichtes Heizöl extra leichtflüssig oder Schweres Heizöl/),
    )
    await opened.write((db) => updateDelivery(db, d.id, { fuelGrade: '' }))
    assert.equal((await opened.read(readFuelDeliveries)).find((x) => x.id === d.id)?.fuelGrade, null)
  })
})

test('Tabellenzeile an der Lieferung: bei Fernwärme gibt es keine, denn die Tabelle gilt nur für Heizkessel', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened, 'districtHeating')
    await assert.rejects(
      opened.write((db) => createDelivery(db, 'f1', 'hp', { label: 'Fernwärme', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 40000, fuelGrade: 'naturalGasH' })),
      heatingError(400, /nur bei Heizkesseln/),
    )
  })
})

let ids = 0
const newId = () => `m-${++ids}`
// Eine Anlage wird nur über die Einrichtung zur eigenen Abrechnung (PR 10 Abweichung 17): erst „Niemand“,
// dann Schritt 7. Die Einrichtung legt die fehlenden Zähler an; der Warmwasserzähler von A steht schon da.
async function eigeneAnlage(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 60, participates: true, noConnection: ['warmwasser'] })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await createEntity(db, 'meters', 'ww-a', { propertyId: 'objekt-1', unitId: 'a', name: 'WW A', type: 'warmwasser', unit: 'm³' })
    await createEntity(db, 'readings', 'r1', { meterId: 'ww-a', date: '2024-12-31', value: 100 })
    await createEntity(db, 'readings', 'r2', { meterId: 'ww-a', date: '2025-12-31', value: 132.5 })
  })
  await opened.write((db) => setUpSelf(db, 'hp', {
    period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter',
    dhwHeatMeter: false, totalHeatMeter: false,
  }, '2026-02-01', newId))
}

test('Warmwasser bei eigener Abrechnung: Formel mit Volumen und Temperatur; ergänzend gespeichert; Vorschlag aus den Zählern und versorgte Fläche', async () => {
  await withDatabase(async (opened) => {
    await eigeneAnlage(opened)
    const speichern = (body: unknown) => opened.write((db) => saveHotWater(db, 'hp', '2025-01', body))
    const a = await speichern({ dhwMethod: 'volumeFormula', dhwVolumeM3: 32.5, dhwTempC: 55 }) ?? assert.fail('keine Anlage')
    assert.deepEqual([a.dhwMethod, a.dhwVolumeM3, a.dhwTempC, a.dhwUnmeasurable], ['volumeFormula', 32.5, 55, null])
    // Ein Teilrumpf lässt Volumen und Temperatur stehen.
    const b = await speichern({ dhwMethod: 'volumeFormula', dhwUnmeasurable: true }) ?? assert.fail('keine Anlage')
    assert.deepEqual([b.dhwVolumeM3, b.dhwTempC, b.dhwUnmeasurable], [32.5, 55, true])
    await assert.rejects(speichern({ dhwMethod: 'volumeFormula', dhwVolumeM3: -1 }), heatingError(400, /ab 0 m³/))
    await assert.rejects(speichern({ dhwMethod: 'volumeFormula', dhwTempC: 120 }), heatingError(400, /zwischen 0 und 100 °C/))
    await assert.rejects(speichern({ dhwMethod: 'volumeFormula', dhwTempC: 'warm' }), heatingError(400, /keine Zahl/))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    // Zähler der Wohnung A: 132,5 − 100 = 32,5 m³; Fläche nur A (B hat kein Warmwasser).
    assert.deepEqual(view?.hotWaterBasis, { volumeFromMetersM3: 32.5, suppliedAreaM2: 80 })
    assert.equal(view?.hotWater.dhwVolumeM3, 32.5)
  })
})

test('Warmwasser beim Messdienst: Volumen und Temperatur werden nicht gespeichert, die Angabe zum Verfahren wie bisher; bei freien Schlüsseln gar nicht', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'service' })
    })
    const r = await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'areaFormula', dhwVolumeM3: 10, dhwTempC: 55 })) ?? assert.fail('keine Anlage')
    assert.deepEqual([r.dhwMethod, r.dhwVolumeM3, r.dhwTempC], ['areaFormula', null, null])
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' }))
    await assert.rejects(opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'areaFormula' })), heatingError(400, /Messdienst oder die Gemeinschaft.*eigener Heizkostenabrechnung/))
  })
})
