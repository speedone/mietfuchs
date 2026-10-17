// Gutschrift ohne Rechnung (#251): die Spalte `credit_note_kind` samt Bedingung, die Antwort „Sie ist eine
// Gutschrift, deren Rechnung nicht in Mietfuchs steht“ und das Zuordnen einer Gutschrift zur Lieferung, die sie
// berichtigt (`reassignCredit`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, reassignCredit, updateDelivery } from '../src/db/fuel.ts'
import { readCostItems, readFuelDeliveries, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, HeatingError } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const periodOf = (key: string) => periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-gutschrift-'))
const refused = (status: number, text: RegExp) => (e: unknown): boolean => e instanceof HeatingError && e.status === status && text.test(e.message)

// Zwei Wohnungen, Gas nach freien Schlüsseln; d0 (01.05.2025–30.04.2026) über 6.176,03 €, d1 (14.07.2025–25.09.2026)
// nur mit der Gutschrift −304,51 €; dazu d9 einer zweiten Anlage.
async function withStock(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openFreshDatabase(dataDir)
  try {
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { name: 'Haus', energy: 'gas', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }] })
      await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Anbau', energy: 'gas', method: 'manual', units: [{ unitId: 'b', heatedAreaM2: null }] })
      await createDelivery(db, 'd0', 'hp', { label: 'Rechnung d0', invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30', quantity: 5000, quantityUnit: 'kWh', emissionsKg: 1000, co2CostCents: 5000 })
      await createDelivery(db, 'd1', 'hp', { label: 'Rechnung d1', invoiceFrom: '2025-07-14', invoiceTo: '2026-09-25' })
      await createDelivery(db, 'd9', 'hp2', { label: 'Anbau', invoiceFrom: '2025-05-01', invoiceTo: '2026-04-30' })
      const fields = { propertyId: 'objekt-1', category: HEATING_CATEGORY, key: 'area', heatingPlantId: 'hp' }
      await createEntity(db, 'costItems', 'p0', { ...fields, period: '2025-05', taxYear: 2026, description: 'Gas', amountCents: 617603, fuelDeliveryId: 'd0' })
      await createEntity(db, 'costItems', 'p16', { ...fields, period: '2026-05', taxYear: 2026, description: 'Gutschrift', amountCents: -30451, fuelDeliveryId: 'd1' })
      await createEntity(db, 'costItems', 'p9', { ...fields, heatingPlantId: 'hp2', period: '2025-05', taxYear: 2026, description: 'Anbau', amountCents: 100000, fuelDeliveryId: 'd9' })
    })
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Kette: Lieferungen von vor dem Schritt haben keine Antwort (NULL); die Bedingung kennt nur „standalone“', async () => {
  const dir = tempDir()
  try {
    const c = await connect(path.join(dir, 'db.sqlite'))
    const migrations = await loadMigrations()
    const bis = migrations.findIndex((m) => m.tag.endsWith('_gutschrift_ohne_rechnung'))
    if (bis < 0) assert.fail('Schritt …_gutschrift_ohne_rechnung fehlt')
    applyMigrations(c, migrations.slice(0, bis))
    c.exec(`INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp', 'objekt-1', 'gas')`)
    c.exec(`INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d', 'hp', '2025-01-01', '2025-12-31')`)
    applyMigrations(c, migrations)
    assert.deepEqual(c.rows("SELECT credit_note_kind FROM fuel_deliveries WHERE id = 'd'"), [[null]])
    c.exec("UPDATE fuel_deliveries SET credit_note_kind = 'standalone' WHERE id = 'd'")
    assert.throws(() => c.exec("UPDATE fuel_deliveries SET credit_note_kind = 'andere' WHERE id = 'd'"), /fuel_deliveries_credit_note_kind_known/)
    c.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Antwort „Gutschrift ohne Rechnung in Mietfuchs“: gespeichert, gelesen, nur die Stufe des Hinweises ändert sich, keine Zahl (M10)', async () => {
  await withStock(async (opened) => {
    const settle = async () => computeSettlement(snapshotFor(await opened.read((db) => readStock(db)), 'objekt-1', periodOf('2026-05')), {})
    const vorher = await settle()
    assert.ok(vorher.notices.some((n) => n.code === 'fuel.credit-only'))
    assert.equal((await opened.read((db) => readFuelDeliveries(db))).find((d) => d.id === 'd1')?.creditNoteKind, null)
    const saved = await opened.write((db) => updateDelivery(db, 'd1', { creditNoteKind: 'standalone' }))
    assert.equal(saved?.creditNoteKind, 'standalone')
    const nachher = await settle()
    const n = nachher.notices.find((x) => x.code === 'fuel.credit-only-confirmed') ?? assert.fail(nachher.notices.map((x) => x.code).join(', '))
    assert.equal(n.level, 'hint')
    assert.match(n.text, /ergeben zusammen -304,51 €\. Sie haben angegeben, dass die Rechnung dazu nicht in Mietfuchs steht\./)
    assert.ok(!nachher.notices.some((x) => x.code === 'fuel.credit-only'))
    const zahlen = (s: typeof vorher) => JSON.stringify([s.statements.map((st) => st.rows.map((r) => [r.costItemId, r.shareCents])), s.landlord.rows.map((r) => [r.costItemId, r.shareCents, r.landlordParts])])
    assert.equal(zahlen(nachher), zahlen(vorher))
    // Ein unbekannter Wert heißt „nicht beantwortet“.
    assert.equal((await opened.write((db) => updateDelivery(db, 'd1', { creditNoteKind: 'irgendwas' })))?.creditNoteKind, null)
  })
})

test('5a: Gutschrift der Lieferung zuordnen, die sie berichtigt: d0 ergibt 5.871,52 €, d1 ist leer, 2025/2026 verteilt sie', async () => {
  await withStock(async (opened) => {
    const result = await opened.write((db) => reassignCredit(db, 'd1', { targetId: 'd0' })) ?? assert.fail('keine Antwort')
    assert.deepEqual([result.target.id, result.sourceEmpty, result.moved], ['d0', true, ['p16']])
    const items = await opened.read((db) => readCostItems(db))
    const p16 = items.find((c) => c.id === 'p16') ?? assert.fail('p16 fehlt')
    assert.deepEqual([p16.fuelDeliveryId, p16.period, p16.amountCents, p16.taxYear], ['d0', '2025-05', -30451, 2026])
    assert.equal(items.filter((c) => c.fuelDeliveryId === 'd0').reduce((a, c) => a + c.amountCents, 0), 587152)
    const h = computeSettlement(snapshotFor(await opened.read((db) => readStock(db)), 'objekt-1', periodOf('2025-05')), {})
    assert.equal(h.statements.reduce((a, st) => a + st.totalShareCents, 0) + h.landlord.totalCents, 587152 + 100000)
    assert.equal(h.heating?.find((x) => x.plantId === 'hp')?.fuel?.coveragePermille, 1000)
    // Ohne Rückgabe des Lieferanten bleiben Menge und kg der Zielrechnung (§ 3 Abs. 3 CO2KostAufG: ein Preisnachlass
    // ändert weder die Emissionen noch den Zertifikatspreis).
    assert.deepEqual([result.target.quantity, result.target.emissionsKg, result.target.co2CostCents], [5000, 1000, 5000])
  })
})

test('5a: Hat der Lieferant Brennstoff zurückgenommen, werden Menge, kg und CO₂-Kosten der Zielrechnung berichtigt', async () => {
  await withStock(async (opened) => {
    const result = await opened.write((db) => reassignCredit(db, 'd1', { targetId: 'd0', quantity: 4800, emissionsKg: 960, co2CostCents: 4800 })) ?? assert.fail('keine Antwort')
    assert.deepEqual([result.target.quantity, result.target.emissionsKg, result.target.co2CostCents], [4800, 960, 4800])
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd1', { targetId: 'd0', emissionsKg: -1 })), refused(400, /Gutschrift/))
  })
})

test('5b: 409, wenn eine der beiden Heizperioden abgeschlossen ist', async () => {
  await withStock(async (opened) => {
    await opened.write(async (db) => db.transaction(async (tx) => {
      const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf('2025-05')), {})
      await closeSettlement(tx, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-05'), closedAt: '2027-01-01', sentAt: null, settlement })
    }))
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd1', { targetId: 'd0' })), refused(409, /Öffnen Sie die Abrechnung 2025\/2026 zuerst wieder/))
    assert.equal((await opened.read((db) => readCostItems(db))).find((c) => c.id === 'p16')?.fuelDeliveryId, 'd1')
  })
})

test('5c: 400 bei einer Lieferung einer anderen Anlage, einer Schätzung, ohne negative Summe oder ohne Ziel', async () => {
  await withStock(async (opened) => {
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd1', { targetId: 'd9' })), refused(400, /derselben Heizanlage/))
    await opened.write(async (db) => {
      await createDelivery(db, 'e', 'hp', { label: 'Schätzung', invoiceFrom: '2026-05-01', invoiceTo: '2026-09-25' })
      const { fuelDeliveries } = await import('../src/db/schema.ts')
      await db.update(fuelDeliveries).set({ estimated: true, amountCents: 1000 }).where(eq(fuelDeliveries.id, 'e'))
    })
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd1', { targetId: 'e' })), refused(400, /Schätzung/))
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd0', { targetId: 'd1' })), refused(400, /weniger als 0 €/))
    await assert.rejects(opened.write((db) => reassignCredit(db, 'd1', {})), refused(400, /Lieferung/))
    assert.equal(await opened.write((db) => reassignCredit(db, 'gibt-es-nicht', { targetId: 'd0' })), null)
  })
})
