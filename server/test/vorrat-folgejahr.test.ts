// Vorrat: eine Lieferung, deren Rechnung erst im Folgejahr gebucht werden soll (Nachprüfung von #238). Die
// Position einer Lieferung steht in der Heizperiode des Rechnungsendes, beim Vorrat in der des
// Lieferdatums (Entwurf 5.4; `guardFuelLink` in repository.ts, ein geändertes Rechnungsende oder
// Lieferdatum prüft db/fuel.ts); nur so verteilt die Bestandskette ihren Betrag im Jahr des Verbrauchs. Die Invariante (fuel-stock-invariant.test.ts) versucht dasselbe zufällig.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { createEntity, updateEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

const P = (y: number) => periodOfKey(CALENDAR_RULES, periodKey(`${y}-01`)) ?? assert.fail(`kein Zeitraum ${y}`)
const UNITS = ['a', 'b']
const tenants = (r: ComputedSettlement): number => r.statements.reduce((a, st) => a + st.totalShareCents, 0)

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-folgejahr-'))
  const opened = await openDatabase({ dataDir })
  try { await work(opened) } finally { opened.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
}
async function bestand(opened: OpenedDatabase, c2: '2025-01' | null): Promise<void> {
  await opened.write(async (db) => {
    for (const u of UNITS) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 100, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: u, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'oel', 'objekt-1', { energy: 'oil', method: 'manual' })
    await saveStock(db, 'oel', '2025-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 1500 })
    await createDelivery(db, 'd1', 'oel', { label: 'd1', deliveredAt: '2025-02-01', invoiceDate: '2025-02-01', quantity: 2000, quantityUnit: 'l', emissionsKg: 5352, co2CostCents: 30000 })
    await createDelivery(db, 'd2', 'oel', { label: 'd2', deliveredAt: '2025-10-01', invoiceDate: '2025-10-01', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676, co2CostCents: 15000 })
    await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'd1', amountCents: 200000, key: 'area', heatingPlantId: 'oel', heatingPart: 'fuel', fuelDeliveryId: 'd1' })
    await saveStock(db, 'oel', '2026-01', { stockUnit: 'l', closingQuantity: 500 })
    if (c2) await createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: c2, category: HEATING_CATEGORY, description: 'd2', amountCents: 110000, key: 'area', heatingPlantId: 'oel', heatingPart: 'fuel', fuelDeliveryId: 'd2' })
  })
}
const live = (opened: OpenedDatabase, y: number) => opened.read(async (db) => tenants(computeSettlement(snapshotFor(await readStock(db), 'objekt-1', P(y)), {})))

test('Die Rechnung einer Lieferung von 2025 erst 2026 buchen lehnt der Server mit einem Satz ab; gebucht 2025 tragen die Mieter sie im Jahr des Verbrauchs, genau einmal', async () => {
  await withDatabase(async (opened) => {
    await bestand(opened, null)
    // Die Probe der Nachprüfung: Im Folgejahr gebucht hätte die Abrechnung 2025 die Lieferung als Endbestand
    // gutgeschrieben, ohne dass die Mieter 2025 sie trugen, und 2026 hätte sie voll getragen.
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'd2', amountCents: 110000, key: 'area', heatingPlantId: 'oel', heatingPart: 'fuel', fuelDeliveryId: 'd2' })),
      (err: unknown) => err instanceof Error && /gehört deshalb in die Heizperiode 2025/.test(err.message))
    await opened.write((db) => createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'd2', amountCents: 110000, key: 'area', heatingPlantId: 'oel', heatingPart: 'fuel', fuelDeliveryId: 'd2' }))
    // 2025: 1.000 € Anfangsbestand + 2.000 € + 1.100 € − 1.600 € Endbestand = 2.500 €, zuzüglich der
    // Abgrenzung beim Vermieter; 2026: 1.600 € − 550 € = 1.050 €, ebenso.
    assert.deepEqual([await live(opened, 2025), await live(opened, 2026)], [238750, 103500])
    // Auch ein späteres Verschieben der Position oder des Lieferdatums in ein anderes Jahr geht nicht.
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'c2', { period: '2026-01' })), (err: unknown) => err instanceof Error && /Heizperiode 2025/.test(err.message))
  })
})
