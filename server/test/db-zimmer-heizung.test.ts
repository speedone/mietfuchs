// Zimmer einer Wohnung (#573) bei der Einrichtung der eigenen Heizkostenabrechnung: Nutzer sind die Zimmer, nicht die
// Wohnung (Sicht der Rechnung, shared/rooms.ts). Die Wohnung bekommt keinen Wärmezähler (an ihr sind nur Kaltwasser,
// Strom und Sonstiges erlaubt) und braucht keine beheizte Fläche.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

type Opened = Awaited<ReturnType<typeof openFreshDatabase>>
async function withWg(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zimmer-heizung-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'units', 'wg', { propertyId: 'objekt-1', name: 'WG', areaM2: 80, participates: false })
      for (const [z, area] of [['z1', 12], ['z2', 16]] as const) {
        await createEntity(db, 'units', z, { propertyId: 'objekt-1', name: z, areaM2: area, participates: true, parentUnitId: 'wg' })
        await createEntity(db, 'tenancies', `t${z}`, { unitId: z, tenantName: `Mieter ${z}`, persons: 1, start: '2020-01-01' })
      }
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 600000, key: 'area' })
    })
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
let ids = 0
const newId = () => `neu-${++ids}`
const SETUP = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: false, totalHeatMeter: false, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }

test('Einrichtung: Wärme- und Warmwasserzähler an den Zimmern, keiner an der Wohnung', async () => {
  await withWg(async (opened) => {
    await opened.write((db) => setUpSelf(db, 'hp', SETUP, '2026-02-01', newId))
    const meters = (await opened.read(readStock)).meters
    assert.deepEqual(meters.map((m) => [m.unitId, m.type]).sort(), [
      ['a', 'waerme'], ['a', 'warmwasser'], ['z1', 'waerme'], ['z1', 'warmwasser'], ['z2', 'waerme'], ['z2', 'warmwasser'],
    ].sort())
  })
})

test('Beheizte Fläche: verlangt bei den Zimmern, nicht bei der Wohnung', async () => {
  await withWg(async (opened) => {
    // Ohne Liste der Wohnungen an der Anlage: Sie versorgt alle Einheiten des Objekts, die Wohnung eingeschlossen.
    const unitValues = [{ unitId: 'a', heatedAreaM2: 55 }, { unitId: 'z1', heatedAreaM2: 22 }, { unitId: 'z2', heatedAreaM2: 30 }]
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, areaBasisHeat: 'heatedArea', unitValues }, '2026-02-01', newId))
    assert.equal(ok?.plant.areaBasisHeat, 'heatedArea')
    assert.equal((await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp')?.units ?? null, null)
  })
})

test('Beheizte Fläche: die Liste der Anlage nennt die Wohnung, ihr Wert geht auf die Zimmer (keine Sackgasse beim Speichern)', async () => {
  await withWg(async (opened) => {
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a' }, { unitId: 'wg' }] }))
    const unitValues = [{ unitId: 'a', heatedAreaM2: 55 }, { unitId: 'wg', heatedAreaM2: 70 }]
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, areaBasisHeat: 'heatedArea', unitValues }, '2026-02-01', newId))
    assert.equal(ok?.plant.areaBasisHeat, 'heatedArea')
  })
})

test('Beheizte Fläche: fehlt sie bei der Wohnung und bei den Zimmern, nennt die Meldung die Zimmer', async () => {
  await withWg(async (opened) => {
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a' }, { unitId: 'wg' }] }))
    const unitValues = [{ unitId: 'a', heatedAreaM2: 55 }]
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, areaBasisHeat: 'heatedArea', unitValues }, '2026-02-01', newId)), /beheizte Fläche.*z1 in der Wohnung WG/)
  })
})
