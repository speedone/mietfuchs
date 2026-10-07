// Tabellenzeile an der Lieferung und Erzeuger an der Anlage in der Datenbank (Heizung PR 11,
// Abweichungen 4 und 5 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { ensureHeatingPeriod } from '../src/db/heatingPeriodContext.ts'
import { fuelCarryFrozen } from '../src/db/schema.ts'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { createDelivery, updateDelivery } from '../src/db/fuel.ts'
import { heatingPeriodViews, saveHotWater } from '../src/db/co2.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { openDatabase } from '../src/db/open.ts'
import { readFuelDeliveries, readHeatingPlants, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, HeatingError, removeEntity } from '../src/db/repository.ts'

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

test('Erzeuger der Anlage: ohne Angabe null, „allein“ und „mit weiterem Erzeuger“ werden gespeichert, leer heißt keine Antwort', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened)
    const plant = async () => (await opened.read(readHeatingPlants)).find((p) => p.id === 'hp') ?? assert.fail('keine Anlage')
    assert.equal((await plant()).heatGeneration, null)
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
    assert.equal((await plant()).heatGeneration, 'single')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'mixed' }))
    assert.equal((await plant()).heatGeneration, 'mixed')
    await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: null }))
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
    assert.deepEqual(view?.hotWaterBasis, { volumeFromMetersM3: 32.5, volumeMissing: null, running: null, suppliedAreaM2: 80 })
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

// ---------- Durchsicht von #240 ----------

test('Durchsicht #240, Geld-M2 und Recht-I1: unbekannte Antworten zum Erzeuger und zur Wärmepumpe sind ein Fehler; „mehr als die Hälfte“ wird gespeichert', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened)
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'bivalent' })), heatingError(400, /allein erzeugt.*aus der Liste/))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { heatPumpMajority: 'vielleicht' })), heatingError(400, /mehr als die Hälfte.*aus der Liste/))
    for (const v of ['yes', 'no', 'unknown', null] as const) {
      await opened.write((db) => updateHeatingPlant(db, 'hp', { heatPumpMajority: v }))
      assert.equal((await opened.read(readHeatingPlants)).find((p) => p.id === 'hp')?.heatPumpMajority, v)
    }
  })
})

test('Durchsicht #240, Geld-I2: Brennwert/Heizwert, Heizwert und Tabellenzeile lassen sich an einer eingefrorenen Lieferung nachtragen, Mengen nicht', async () => {
  await withDatabase(async (opened) => {
    await heizung(opened, 'gas')
    const d = await opened.write((db) => createDelivery(db, 'g1', 'hp', { label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', energyKwh: 40000 })) ?? assert.fail('keine Anlage')
    await opened.write(async (db) => {
      const hid = await ensureHeatingPeriod(db, 'hp', periodKey('2025-01'))
      await db.insert(fuelCarryFrozen).values({ deliveryId: d.id, heatingPeriodId: hid, cents: 0, emissionsKg: 0, co2Cents: 0 })
    })
    const g = await opened.write((db) => updateDelivery(db, d.id, { gasBasis: 'hs' })) ?? assert.fail('keine Lieferung')
    assert.equal(g.gasBasis, 'hs')
    await assert.rejects(opened.write((db) => updateDelivery(db, d.id, { energyKwh: 41000 })), heatingError(409, /eingefroren/))
  })
  await withDatabase(async (opened) => {
    await heizung(opened)
    await opened.write((db) => createDelivery(db, 'o1', 'hp', { label: 'Öl', deliveredAt: '2025-10-12', invoiceDate: '2025-10-12', quantity: 3000, quantityUnit: 'l' }))
    await opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, closingQuantity: 500 }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    await opened.write(async (db) => {
      const settlement = computeSettlement(snapshotFor(await readStock(db), 'objekt-1', p), {})
      await closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement })
    })
    const o = await opened.write((db) => updateDelivery(db, 'o1', { heatingValue: 9.8, fuelGrade: 'heatingOilEL' })) ?? assert.fail('keine Lieferung')
    assert.deepEqual([o.heatingValue, o.fuelGrade], [9.8, 'heatingOilEL'])
    await assert.rejects(opened.write((db) => updateDelivery(db, 'o1', { quantity: 2900 })), heatingError(409, /abgeschlossenen Heizperiode/))
  })
})

test('Durchsicht #240, Geld-I1 und M5: beim Kesseltausch Vorschlag und Verfahren der Laufzeit; ohne vollständige Stände kein Vorschlag, sondern was fehlt', async () => {
  await withDatabase(async (opened) => {
    await eigeneAnlage(opened)
    await opened.write((db) => createEntity(db, 'readings', 'r15', { meterId: 'ww-a', date: '2025-06-30', value: 115 }))
    await opened.write((db) => saveHotWater(db, 'hp', '2025-01', { dhwMethod: 'volumeFormula', dhwVolumeM3: 15, dhwTempC: 55 }))
    await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: '2025-07-01', energy: 'districtHeating', name: 'Neu', previousName: 'Alt' }))
    const [alt] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    const [neu] = await opened.read((db) => heatingPeriodViews(db, 'hp2', '2025')) ?? assert.fail('keine Anlage')
    // 115 − 100 = 15 m³ bis zum Tausch, 132,5 − 115 = 17,5 m³ danach; nicht 32,5 m³ für jede.
    assert.deepEqual(alt?.hotWaterBasis.running, { from: '2025-01-01', to: '2025-06-30' })
    assert.equal(alt?.hotWaterBasis.volumeFromMetersM3, 15)
    assert.deepEqual(neu?.hotWaterBasis.running, { from: '2025-07-01', to: '2025-12-31' })
    assert.equal(neu?.hotWaterBasis.volumeFromMetersM3, 17.5)
    // Das Verfahren gilt für die Linie; Volumen hat die neue Anlage noch keins.
    assert.deepEqual([neu?.hotWater.dhwMethod, neu?.hotWater.dhwTempC, neu?.hotWater.dhwVolumeM3], ['volumeFormula', 55, null])
  })
  await withDatabase(async (opened) => {
    await eigeneAnlage(opened)
    await opened.write((db) => removeEntity(db, 'readings', 'r2'))
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.equal(view?.hotWaterBasis.volumeFromMetersM3, null)
    assert.match(view?.hotWaterBasis.volumeMissing ?? '', /„WW A“.*31\.12\.2025/)
  })
})
