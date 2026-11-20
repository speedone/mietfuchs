// Eigene Heizkostenabrechnung und eigener Zeitraum der Heizung (Systemprüfung 20.11.2026): Wer zuerst die eigene
// Abrechnung einrichtet, kann den Zeitraum der Heizung danach nicht ändern, denn die Heizperiode trägt Angaben. Die
// Ablehnung nennt den Weg, und der Weg stimmt: Nach dem Zurückstellen auf „Niemand“ bleibt keine Angabe zurück.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { previewHeatingPeriodChange } from '../src/db/heatingPeriodChange.ts'
import { heatingPeriods } from '../src/db/schema.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizperiode-eigene-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
let ids = 0
const newId = () => `neu-${++ids}`
const TODAY = '2026-02-01'
const OWN = { startMonth: 5, changes: [] }
const SETUP = {
  period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false,
  items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }],
}

async function haus(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 600000, key: 'area' })
  })
}
const preview = async (opened: Opened) => (await opened.read((db) => previewHeatingPeriodChange(db, 'hp', OWN, TODAY))) ?? assert.fail('keine Vorschau')

test('Zeitraum der Heizung nach der eigenen Abrechnung: die Ablehnung nennt den Weg über „Niemand“', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', SETUP, TODAY, newId))
    const blocked = (await preview(opened)).blocked
    assert.equal(blocked.length, 1)
    assert.match(blocked[0], /Für die Heizperiode 2025 sind Angaben zur Heizung erfasst/)
    assert.match(blocked[0], /„Heizung ändern“.*„Niemand“.*„Zeitraum der Heizung ändern“.*richten.*danach neu ein/s)
    assert.doesNotMatch(blocked[0], /späteren Version/)
  })
})

test('Zurück auf „Niemand“: die Angaben der Einrichtung sind weg, der Zeitraum der Heizung lässt sich ändern', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, above70Agreed: true, heatConsumptionPct: 80 }, TODAY, newId))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    assert.deepEqual(await opened.read((db) => db.select().from(heatingPeriods).where(eq(heatingPeriods.plantId, 'hp'))), [])
    assert.deepEqual((await preview(opened)).blocked, [])
  })
})

test('Zurück auf „Niemand“: eine eigene Angabe zum Warmwasser bleibt, und die Sperre mit ihr', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', SETUP, TODAY, newId))
    await opened.write((db) => db.update(heatingPeriods).set({ dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 }).where(eq(heatingPeriods.plantId, 'hp')))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    const [row] = await opened.read((db) => db.select().from(heatingPeriods).where(eq(heatingPeriods.plantId, 'hp')))
    assert.deepEqual([row?.dhwMethod, row?.dhwVolumeM3, row?.heatConsumptionPct], ['volumeFormula', 120, null])
    assert.equal((await preview(opened)).blocked.length, 1)
  })
})
