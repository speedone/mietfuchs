// Kesseltausch: Befunde der Nachprüfung von #238 (Heizung PR 9) über die echten Schreibwege.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement } from '../src/calc.ts'
import { eq } from 'drizzle-orm'
import { createDelivery, freezeFuelCarries, unfreezeFuelCarries } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant, listHeatingPlants, removeHeatingPlant, replaceHeatingPlant, straightenHeatingPlants, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, HeatingError, reopenSettlement } from '../src/db/repository.ts'
import { heatingPlants } from '../src/db/schema.ts'
import type { Database } from '../src/db/client.ts'
import { sameBuilding } from '../../shared/heatingPeriod.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'

const P = (y: number) => periodOfKey(CALENDAR_RULES, periodKey(`${y}-01`)) ?? assert.fail(`kein Zeitraum ${y}`)

async function withDatabase<T>(work: (opened: OpenedDatabase) => Promise<T>): Promise<T> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-oeloel-'))
  const opened = await openDatabase({ dataDir })
  try {
    return await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Ein Ölkessel mit Vorrat 2024, eine Lieferung im Februar 2025, Endbestand 600 l Ende 2025, eine Lieferung
// 2026. Getauscht wird nach `swaps` (Tag des Tauschs, Öl → Öl) und dabei der Endbestand am letzten
// Betriebstag eingetragen. Die neue Anlage hat im Tauschjahr keine eigene Position (K1).
async function tenantsPerYear(swaps: { date: string; closing: number; takesOverStock?: boolean }[]): Promise<number[]> {
  return (await settlementsOf(swaps)).map((r) => r.statements.reduce((a, st) => a + st.totalShareCents, 0))
}
async function settlementsOf(swaps: { date: string; closing: number; takesOverStock?: boolean }[]): Promise<ReturnType<typeof computeSettlement>[]> {
  return withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) {
        await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 50, participates: true })
        await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: u, persons: 1, start: '2020-01-01' })
      }
      await createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual' })
      await saveStock(db, 'k0', '2024-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false })
      await createDelivery(db, 'd1', 'k0', { label: 'd1', deliveredAt: '2024-03-01', invoiceDate: '2024-03-01', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028, co2CostCents: 30000 })
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'd1', amountCents: 300000, key: 'area', heatingPlantId: 'k0', heatingPart: 'fuel', fuelDeliveryId: 'd1' })
      await saveStock(db, 'k0', '2024-01', { closingQuantity: 1500 })
      await createDelivery(db, 'd2', 'k0', { label: 'd2', deliveredAt: '2025-02-01', invoiceDate: '2025-02-01', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676, co2CostCents: 15000 })
      await createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'd2', amountCents: 110000, key: 'area', heatingPlantId: 'k0', heatingPart: 'fuel', fuelDeliveryId: 'd2' })
    })
    let current = 'k0'
    for (const [i, s] of swaps.entries()) {
      const next = `k${i + 1}`
      await opened.write((db) => replaceHeatingPlant(db, current, next, { date: s.date, energy: 'oil', name: `Kessel ${i + 1}`, previousName: `Kessel ${i}`, ...(s.takesOverStock === undefined ? {} : { takesOverStock: s.takesOverStock }) }))
      const ends = new Date(Date.parse(`${s.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
      await opened.write((db) => saveStock(db, current, '2025-01', { stockUnit: 'l', closingQuantity: s.closing, closingMeasuredOn: ends }))
      current = next
    }
    await opened.write(async (db) => {
      await saveStock(db, current, '2025-01', { stockUnit: 'l', closingQuantity: 600, closingMeasuredOn: '2025-12-31' })
      await createDelivery(db, 'd4', current, { label: 'd4', deliveredAt: '2026-03-01', invoiceDate: '2026-03-01', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676, co2CostCents: 17000 })
      await createEntity(db, 'costItems', 'c4', { propertyId: 'objekt-1', period: '2026-01', category: HEATING_CATEGORY, description: 'd4', amountCents: 130000, key: 'area', heatingPlantId: current, heatingPart: 'fuel', fuelDeliveryId: 'd4' })
      await saveStock(db, current, '2026-01', { stockUnit: 'l', closingQuantity: 900, closingMeasuredOn: '2026-12-31' })
    })
    const stock = await opened.read((db) => readStock(db))
    return [2024, 2025, 2026].map((y) => computeSettlement(snapshotFor(stock, 'objekt-1', P(y)), {}))
  })
}

test('K1: Öl → Öl ohne eigene Position der neuen Anlage im Tauschjahr: die Mieter tragen denselben Verbrauch wie ohne Tausch', async () => {
  const ohne = await tenantsPerYear([])
  // Ohne Tausch: 2.357,50 €, 1.772,00 € und 768,60 €; vor der Korrektur trugen die Mieter 2025 und 2026 zusammen 1.034,00 € zu wenig, ohne Hinweis.
  assert.deepEqual(ohne, [235750, 177200, 76860])
  assert.deepEqual(await tenantsPerYear([{ date: '2025-07-01', closing: 1000 }]), ohne)
  // Zwei Täusche im selben Jahr (Öl → Öl → Öl).
  assert.deepEqual(await tenantsPerYear([{ date: '2025-04-01', closing: 1800 }, { date: '2025-10-01', closing: 900 }]), ohne)
})

const refused = (status: 400 | 409, text: RegExp) => (err: unknown): boolean => err instanceof HeatingError && err.status === status && text.test(err.message)

test('Öl → Öl mit „Nein“ auf „Verheizt der neue Kessel den Brennstoff im Tank weiter?“: der Restbestand bleibt beim Vermieter, wie bei anderem Brennstoff', async () => {
  const [, r25] = await settlementsOf([{ date: '2025-07-01', closing: 1000, takesOverStock: false }])
  if (!r25) assert.fail('keine Abrechnung 2025')
  const rest = r25.landlord.rows.find((row) => row.costItemId === `stock:k0:${P(2025).key}:remaining`) ?? assert.fail('kein Restbestand beim Vermieter')
  assert.deepEqual((rest.landlordParts ?? assert.fail('ohne Gründe')).map((x) => x.reason), ['stockRemaining'])
  const n = r25.notices.find((x) => x.code === 'fuel.stock-remaining') ?? assert.fail('kein Hinweis zum Restbestand')
  assert.match(n.text, /Nach Ihrer Angabe verheizt „Kessel 1“ den Brennstoff im Tank nicht weiter/)
  // Die neue Anlage beginnt ohne Übernahme: kein Anfangsbestand aus der alten.
  assert.equal(r25.heating?.find((h) => h.plantId === 'k1')?.stock?.opening.quantity ?? 0, 0)
})

async function swapped(work: (opened: OpenedDatabase) => Promise<void>, takesOverStock?: boolean): Promise<void> {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 50, participates: true })
      await createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual' })
      await saveStock(db, 'k0', '2024-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false, closingQuantity: 800 })
    })
    await opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-07-01', energy: 'oil', name: 'Neuer Kessel', previousName: 'Alter Kessel', ...(takesOverStock === undefined ? {} : { takesOverStock }) }))
    await work(opened)
  })
}
const OWN_OPENING = { stockUnit: 'l', openingQuantity: 500, openingCostCents: 50000, openingEmissionsKg: 1338, openingCo2Cents: 7000, openingInvoicedBefore2023: false, openingAlreadySettled: false }

test('Öl → Öl: Vorbelegung „Ja“; ein eigener Anfangsbestand der neuen Anlage wird dann mit einem Satz über die alte abgelehnt, mit „Nein“ angenommen', async () => {
  await swapped(async (opened) => {
    assert.equal((await opened.read((db) => listHeatingPlants(db, 'objekt-1'))).find((p) => p.id === 'k1')?.takesOverStock, true)
    await opened.write((db) => saveStock(db, 'k0', '2025-01', { stockUnit: 'l', closingQuantity: 600, closingMeasuredOn: '2025-06-30' }))
    await assert.rejects(opened.write((db) => saveStock(db, 'k1', '2025-01', OWN_OPENING)),
      refused(400, /Restbestand der Heizanlage „Alter Kessel“ zum 30\.06\.2025.*„Verheizt der neue Kessel den Brennstoff im Tank weiter\?“ „Nein“/))
    await opened.write((db) => updateHeatingPlant(db, 'k1', { takesOverStock: false }))
    const view = await opened.write((db) => saveStock(db, 'k1', '2025-01', OWN_OPENING))
    assert.equal(view?.row.openingQuantity, 500)
    // Zurück auf „Ja“: der eigene Anfangsbestand entfällt, er stammt dann wieder aus dem Restbestand.
    await opened.write((db) => updateHeatingPlant(db, 'k1', { takesOverStock: true }))
    const stock = await opened.read((db) => readStock(db))
    assert.equal(stock.heatingPeriodRows.find((r) => r.plantId === 'k1' && r.period === P(2025).key)?.openingQuantity ?? null, null)
  })
})

test('Öl → Öl: Die Antwort gibt es nur nach einem Tausch mit demselben Brennstoff, und nach dem Abschluss des Tauschjahres bleibt sie', async () => {
  await swapped(async (opened) => {
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'k0', { takesOverStock: false })), refused(400, /nur nach einem Kesseltausch mit demselben Brennstoff/))
    await opened.write((db) => closeSettlement(db, { id: 's25', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'k1', { takesOverStock: false })), refused(409, /Heizperiode des Tauschs ist abgeschlossen/))
  })
})

const U = (...ids: string[]) => ids.map((unitId) => ({ unitId, heatedAreaM2: null }))
const units = async (db: Database, ids: string[]) => { for (const u of ids) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 100, participates: true }) }
const plants = (opened: OpenedDatabase) => opened.read((db) => listHeatingPlants(db, 'objekt-1'))
const together = async (opened: OpenedDatabase, a: string, b: string): Promise<boolean> => {
  const pl = await plants(opened)
  const x = pl.find((p) => p.id === a)
  const y = pl.find((p) => p.id === b)
  return !!x && !!y && sameBuilding(x, y, pl)
}

test('I-B (Probe D1): Entfernen der ersetzten Anlage, auf die eine andere im selben Gebäude zeigt: der Verweis geht an die Nachfolgerin', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b', 'c'])
      await createHeatingPlant(db, 'A', 'objekt-1', { name: 'Haus AB', energy: 'gas', method: 'manual', units: U('a', 'b') })
      await createHeatingPlant(db, 'B', 'objekt-1', { name: 'Haus C', energy: 'gas', method: 'manual', units: U('c'), buildingWith: 'A' })
    })
    await opened.write((db) => replaceHeatingPlant(db, 'A', 'A2', { date: '2025-07-01', energy: 'districtHeating', name: 'Fernwärme' }))
    assert.ok(await together(opened, 'B', 'A2'))
    await opened.write((db) => removeHeatingPlant(db, 'A'))
    assert.equal((await plants(opened)).find((p) => p.id === 'B')?.buildingWith, 'A2')
    assert.ok(await together(opened, 'B', 'A2'), 'B verliert das gemeinsame Gebäude mit der Nachfolgerin')
  })
})

test('I-B (Probe D2): Entfernen der ersten Anlage, auf die zwei zeigen: die erste verweisende übernimmt, die übrige zeigt auf sie', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b', 'c'])
      await createHeatingPlant(db, 'H1', 'objekt-1', { name: 'H1', energy: 'gas', method: 'manual', units: U('a') })
      await createHeatingPlant(db, 'H2', 'objekt-1', { name: 'H2', energy: 'gas', method: 'manual', units: U('b'), buildingWith: 'H1' })
      await createHeatingPlant(db, 'H3', 'objekt-1', { name: 'H3', energy: 'gas', method: 'manual', units: U('c'), buildingWith: 'H1' })
    })
    await opened.write((db) => removeHeatingPlant(db, 'H1'))
    assert.deepEqual((await plants(opened)).map((p) => [p.id, p.buildingWith]), [['H2', null], ['H3', 'H2']])
    assert.ok(await together(opened, 'H2', 'H3'))
  })
})

test('I-C (Probe B4): Die erste Anlage auf eine andere zu verweisen, die auf sie verweist, lehnt der Server mit einem Satz ab', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b'])
      await createHeatingPlant(db, 'H1', 'objekt-1', { name: 'Haus A', energy: 'gas', method: 'manual', units: U('a') })
      await createHeatingPlant(db, 'H2', 'objekt-1', { name: 'Haus B', energy: 'gas', method: 'manual', units: U('b'), buildingWith: 'H1' })
    })
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'H1', { buildingWith: 'H2' })),
      refused(400, /verweisen im Kreis aufeinander \(„Haus (A|B)“ → „Haus (A|B)“ → „Haus (A|B)“\)\. Diese Heizanlagen stehen damit schon im selben Gebäude/))
    assert.equal((await plants(opened)).find((p) => p.id === 'H1')?.buildingWith, null)
    // Eine beantwortete Frage lässt sich neben einer laufenden Anlage nicht wieder leeren.
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'H2', { buildingWith: null })), refused(400, /Steht diese Heizanlage im selben Gebäude wie „Haus A“\?/))
    await opened.write((db) => updateHeatingPlant(db, 'H2', { buildingWith: 'own' }))
  })
})

test('N12: Entfernen aus der Mitte einer Linie A → A2 → A3: A3 ersetzt A und übernimmt den Zeitraum, mit Hinweis', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b'])
      await createHeatingPlant(db, 'A', 'objekt-1', { name: 'Kessel 1', energy: 'oil', method: 'manual' })
    })
    await opened.write((db) => replaceHeatingPlant(db, 'A', 'A2', { date: '2025-04-01', energy: 'gas', name: 'Gas' }))
    await opened.write((db) => replaceHeatingPlant(db, 'A2', 'A3', { date: '2025-10-01', energy: 'heatPump', name: 'Wärmepumpe' }))
    const result = await opened.write((db) => removeHeatingPlant(db, 'A2'))
    assert.deepEqual(result, { removed: true, released: 0, notice: '„Wärmepumpe“ übernimmt den Zeitraum der entfernten Anlage und heizt jetzt ab dem 01.04.2025, im Anschluss an „Kessel 1“.' })
    assert.deepEqual((await plants(opened)).map((p) => [p.id, p.endsOn, p.replacesPlantId]), [['A', '2025-03-31', null], ['A3', null, 'A']])
  })
})

test('N15: Vorrat einer stillgelegten Anlage für eine Heizperiode nach ihrem Betrieb: 400 mit Satz', async () => {
  await swapped(async (opened) => {
    await assert.rejects(opened.write((db) => saveStock(db, 'k0', '2026-01', { stockUnit: 'l', closingQuantity: 300 })),
      refused(400, /„Alter Kessel“ ist seit dem 01\.07\.2025 außer Betrieb; in der Heizperiode 2026 hat sie keinen Vorrat/))
  })
})

test('N20: Ein Tausch vor einer abgeschlossenen späteren Heizperiode: 409', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b'])
      await createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'gas', method: 'manual' })
      await closeSettlement(db, { id: 's25', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: null, settlement: {} })
    })
    await assert.rejects(opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-01-01', energy: 'districtHeating' })),
      refused(409, /Die Heizperiode 2025 nach dem Tausch ist schon abgeschlossen/))
  })
})

test('N10: Tausch Öl → Öl zum 01.01.: Hat die abgeschlossene erste Heizperiode der neuen Anlage den Restbestand übernommen, bleibt der Endbestand der alten gesperrt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) {
        await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 50, participates: true })
        await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: u, persons: 1, start: '2020-01-01' })
      }
      await createHeatingPlant(db, 'k0', 'objekt-1', { energy: 'oil', method: 'manual' })
      await saveStock(db, 'k0', '2024-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676, openingCo2Cents: 0, openingInvoicedBefore2023: true, openingAlreadySettled: false })
      await createDelivery(db, 'd1', 'k0', { label: 'd1', deliveredAt: '2024-03-01', invoiceDate: '2024-03-01', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028, co2CostCents: 30000 })
      await createEntity(db, 'costItems', 'c1', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'd1', amountCents: 300000, key: 'area', heatingPlantId: 'k0', heatingPart: 'fuel', fuelDeliveryId: 'd1' })
      await saveStock(db, 'k0', '2024-01', { closingQuantity: 1500 })
    })
    const close = (y: number) => opened.write(async (db) => {
      const s = computeSettlement(snapshotFor(await readStock(db), 'objekt-1', P(y)), {})
      await closeSettlement(db, { id: `s${y}`, propertyId: 'objekt-1', period: periodKey(`${y}-01`), closedAt: '2027-01-01', sentAt: null, settlement: s })
      await freezeFuelCarries(db, s)
    })
    await close(2024)
    await opened.write((db) => replaceHeatingPlant(db, 'k0', 'k1', { date: '2025-01-01', energy: 'oil', name: 'Neuer Kessel', previousName: 'Alter Kessel' }))
    await opened.write(async (db) => {
      await createDelivery(db, 'd2', 'k1', { label: 'd2', deliveredAt: '2025-02-01', invoiceDate: '2025-02-01', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676, co2CostCents: 15000 })
      await createEntity(db, 'costItems', 'c2', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'd2', amountCents: 110000, key: 'area', heatingPlantId: 'k1', heatingPart: 'fuel', fuelDeliveryId: 'd2' })
      await saveStock(db, 'k1', '2025-01', { stockUnit: 'l', closingQuantity: 600, closingMeasuredOn: '2025-12-31' })
    })
    await close(2025)
    await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey('2024-01'), 'h24', unfreezeFuelCarries))
    await assert.rejects(opened.write((db) => saveStock(db, 'k0', '2024-01', { closingQuantity: 1400 })), refused(409, /Die Heizperiode 2025 ist abgeschlossen; sie rechnet mit diesem Endbestand/))
    // Die wieder geöffnete Heizperiode 2024 gibt genau den Bestand weiter, den die neue Anlage übernommen hat,
    // und meldet keinen Endbestand, den keine Abrechnung übernähme.
    const r24 = await opened.read(async (db) => computeSettlement(snapshotFor(await readStock(db), 'objekt-1', P(2024)), {}))
    assert.ok(!r24.notices.some((n) => n.code === 'fuel.stock-not-taken-over'), r24.notices.map((n) => n.text).join(' | '))
    assert.equal(r24.heating?.find((h) => h.plantId === 'k0')?.stock?.closingFrozen, true)
  })
})

test('Wiederherstellen: „im selben Gebäude wie“ eine Anlage, die es im Archiv nicht gibt, wird geradegerückt', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await units(db, ['a', 'b'])
      await createHeatingPlant(db, 'H1', 'objekt-1', { name: 'Haus A', energy: 'gas', method: 'manual', units: U('a') })
      await createHeatingPlant(db, 'H2', 'objekt-1', { name: 'Haus B', energy: 'gas', method: 'manual', units: U('b'), buildingWith: 'H1' })
      await db.update(heatingPlants).set({ buildingWith: 'weg' }).where(eq(heatingPlants.id, 'H2'))
    })
    assert.deepEqual(await opened.write((db) => straightenHeatingPlants(db)), ['Haus B'])
    assert.equal((await plants(opened)).find((p) => p.id === 'H2')?.buildingWith, null)
  })
})
