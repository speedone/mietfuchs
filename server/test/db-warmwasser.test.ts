// Tabellenzeile an der Lieferung und Erzeuger an der Anlage in der Datenbank (Heizung PR 11,
// Abweichungen 4 und 5 des Plans).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, updateDelivery } from '../src/db/fuel.ts'
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
