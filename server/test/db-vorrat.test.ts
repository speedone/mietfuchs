// Der Vorrat je Heizperiode in der Datenbank (Heizung PR 8, Entwurf 5.3, 5.4, 8.2, G-A4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { createDelivery, removeDelivery, updateDelivery } from '../src/db/fuel.ts'
import { removeStock, saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity, HeatingError, reopenSettlement } from '../src/db/repository.ts'
import { periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorrat-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const heatingError = (status: 400 | 409, text: RegExp) => (err: unknown) => err instanceof HeatingError && err.status === status && text.test(err.message)

// Ein Haus mit einer Ölheizung, die Heizkosten nach Fläche verteilt.
async function oelhaus(opened: Opened, energy: 'oil' | 'gas' = 'oil'): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 100, participates: true })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
  })
}
const anfang = { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 190000, openingEmissionsKg: 5352.6, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 1800, closingMeasuredOn: '2025-12-31' }

test('Vorrat: erste Heizperiode mit Anfangsbestand; die Folgeperiode übernimmt den Endbestand und nimmt keinen eigenen', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const erste = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    assert.equal(erste.row.openingQuantity, 2000)
    assert.equal(erste.derived, null)
    assert.equal(erste.statement?.consumed.quantity, 200)
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2026-01', { openingQuantity: 1800 })), heatingError(400, /ergibt sich aus dem Endbestand der Heizperiode 2025/))
    const zweite = await opened.write((db) => saveStock(db, 'hp', '2026-01', { stockUnit: 'l', closingQuantity: 900 })) ?? assert.fail('keine Anlage')
    // Der Endbestand von 2025: 1.800 von 2.000 l Anfangsbestand ohne Lieferung, 1.800 / 2.000 × 1.900 € = 1.710 €.
    assert.deepEqual([zweite.derived?.label, zweite.derived?.frozen, zweite.derived?.value.costCents], ['2025', false, 171000])
    assert.equal(zweite.statement?.openingSource, 'previous')
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.equal(ansicht?.stock?.statement?.consumed.quantity, 900)
  })
})

test('Vorrat: ungültige Angaben, keine Vorratsenergie, je mit Satz', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const speichern = (body: unknown) => opened.write((db) => saveStock(db, 'hp', '2025-01', body))
    await assert.rejects(speichern({ ...anfang, openingQuantity: -1 }), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern({ ...anfang, openingCostCents: 1.5 }), heatingError(400, /ganze Cent/))
    await assert.rejects(speichern({ ...anfang, closingQuantity: 'viel' }), heatingError(400, /Zahl ab 0/))
    await assert.rejects(speichern({ ...anfang, stockUnit: 'm3' }), heatingError(400, /Liter, Kilogramm oder Schüttraummeter/))
    await assert.rejects(speichern({ ...anfang, stockUnit: null }), heatingError(400, /Einheit/))
    await assert.rejects(speichern({ ...anfang, closingMeasuredOn: '31.12.2025' }), heatingError(400, /Peilung.*kein Datum/))
    // Felder, die fehlen, bleiben; ein leeres Feld leert.
    await speichern(anfang)
    const geleert = await speichern({ closingMeasuredOn: '' }) ?? assert.fail('keine Anlage')
    assert.deepEqual([geleert.row.closingMeasuredOn, geleert.row.closingQuantity], [null, 1800])
  })
  await withDatabase(async (opened) => {
    await oelhaus(opened, 'gas')
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)), heatingError(400, /nur bei Heizöl, Flüssiggas, Pellets, Holz und Kohle/))
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.equal(ansicht?.stock, null)
  })
})

test('Abgeschlossen (G-A4): Vorrat gesperrt, die Folgeperiode liest den eingefrorenen Endbestand; wieder geöffnet den lebenden', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const erste = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    const closing = erste.statement?.closing ?? assert.fail('keine Bestandsrechnung')
    // Der abgeschlossene Stand trägt den Endbestand, wie ihn die Abrechnung einfriert.
    await opened.write((db) => closeSettlement(db, {
      id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null,
      settlement: { heating: [{ plantId: 'hp', period: '2025-01', energy: 'oil', stock: { openingSource: 'own', closing: { ...closing, layers: closing.layers.map((l) => ({ ...l, costCents: 175000 })) } } }] },
    }))
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { closingQuantity: 1700 })), heatingError(409, /abgeschlossen/))
    await assert.rejects(opened.write((db) => removeStock(db, 'hp', '2025-01')), heatingError(409, /abgeschlossen/))
    const zweite = await opened.write((db) => saveStock(db, 'hp', '2026-01', { stockUnit: 'l', closingQuantity: 900 })) ?? assert.fail('keine Anlage')
    assert.deepEqual([zweite.derived?.frozen, zweite.derived?.value.costCents], [true, 175000])
    await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey('2025-01'), 'h1'))
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2026')) ?? assert.fail('keine Anlage')
    assert.deepEqual([ansicht?.stock?.derived?.frozen, ansicht?.stock?.derived?.value.costCents], [false, 171000])
  })
})

test('Folgeperiode abgeschlossen (G-A4): Einheit und Endbestand der Vorperiode gesperrt, die Peilung nicht', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const erste = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    const zweite = await opened.write((db) => saveStock(db, 'hp', '2026-01', { stockUnit: 'l', closingQuantity: 900 })) ?? assert.fail('keine Anlage')
    await opened.write((db) => closeSettlement(db, {
      id: 's2', propertyId: 'objekt-1', period: periodKey('2026-01'), closedAt: '2027-02-01', sentAt: null,
      settlement: { heating: [{ plantId: 'hp', period: '2026-01', energy: 'oil', stock: zweite.statement }] },
    }))
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { closingQuantity: 1700 })), heatingError(409, /Heizperiode 2026 ist abgeschlossen; sie rechnet mit diesem Endbestand/))
    await assert.rejects(opened.write((db) => saveStock(db, 'hp', '2025-01', { stockUnit: 'kg' })), heatingError(409, /rechnet mit diesem Endbestand/))
    await assert.rejects(opened.write((db) => removeStock(db, 'hp', '2025-01')), heatingError(409, /rechnet mit diesem Endbestand/))
    const peilung = await opened.write((db) => saveStock(db, 'hp', '2025-01', { closingMeasuredOn: '2025-12-30' })) ?? assert.fail('keine Anlage')
    assert.deepEqual(peilung.closingLockedBy, { period: '2026-01', label: '2026' })
    assert.equal(peilung.statement?.closingFrozen, true)
    // Ohne Brennstoffposition bucht 2025 keinen Übertrag; weitergegeben ist der Bestand mit 0 € (I1 der Durchsicht von #237).
    assert.deepEqual(peilung.statement?.closing, erste.statement?.handover)
  })
})

test('Lieferungen von Heizöl: Lieferdatum und Menge Pflicht, kein Rechnungszeitraum; in einer abgeschlossenen Heizperiode gesperrt', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    const oel = { label: 'Öl März', deliveredAt: '2025-03-15', invoiceDate: '2025-03-16', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 }
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...oel, deliveredAt: null })), heatingError(400, /Lieferdatum/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...oel, quantity: null })), heatingError(400, /Menge/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...oel, quantityUnit: 'm3' })), heatingError(400, /Menge/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...oel, invoiceFrom: '2025-01-01', invoiceTo: '2025-03-15' })), heatingError(400, /keinen Rechnungszeitraum/))
    // Bei freien Schlüsseln steht der Betrag in der Position, wie bei Gas.
    await assert.rejects(opened.write((db) => createDelivery(db, 'x', 'hp', { ...oel, amountCents: 315000 })), heatingError(400, /Kostenposition/))
    await opened.write((db) => createDelivery(db, 'd1', 'hp', oel))
    await opened.write((db) => createEntity(db, 'costItems', 'r1', {
      propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Öl', amountCents: 315000, key: 'area', heatingPlantId: 'hp', fuelDeliveryId: 'd1',
    }))
    const v = await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang)) ?? assert.fail('keine Anlage')
    assert.deepEqual([v.statement?.paidCents, v.statement?.consumed.quantity], [315000, 3200])
    await opened.write((db) => closeSettlement(db, { id: 's1', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-02-01', sentAt: null, settlement: {} }))
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { quantity: 2999 })), heatingError(409, /abgeschlossenen Heizperiode 2025/))
    await assert.rejects(opened.write((db) => updateDelivery(db, 'd1', { deliveredAt: '2026-01-02' })), heatingError(409, /abgeschlossenen/))
    await assert.rejects(opened.write((db) => createDelivery(db, 'd2', 'hp', { ...oel, deliveredAt: '2025-11-02' })), heatingError(409, /abgeschlossenen/))
    await assert.rejects(opened.write((db) => removeDelivery(db, 'd1')), heatingError(409, /abgeschlossenen/))
    // Die Bezeichnung bleibt änderbar; eine Lieferung in der offenen Folgeperiode geht.
    await opened.write((db) => updateDelivery(db, 'd1', { label: 'Heizöl März' }))
    await opened.write((db) => createDelivery(db, 'd3', 'hp', { ...oel, deliveredAt: '2026-02-01' }))
    // Ein Wechsel auf Gas mit Vorrat und Lieferungen wird abgelehnt (der Vorrat sperrt zuerst, Nachprüfung von #237, M2).
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' })), heatingError(409, /Vorrat eingetragen/))
  })
})

test('Vorrat entfernen: die Felder des Vorrats werden leer', async () => {
  await withDatabase(async (opened) => {
    await oelhaus(opened)
    await opened.write((db) => saveStock(db, 'hp', '2025-01', anfang))
    assert.equal(await opened.write((db) => removeStock(db, 'hp', '2025-01')), true)
    const [ansicht] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025')) ?? assert.fail('keine Anlage')
    assert.deepEqual(ansicht?.stock?.row, {
      stockUnit: null, openingQuantity: null, openingCostCents: null, openingEmissionsKg: null, openingCo2Cents: null,
      openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: null, closingMeasuredOn: null,
    })
    assert.equal(await opened.write((db) => removeStock(db, 'hp', '2025-01')), false)
    assert.equal(await opened.write((db) => removeStock(db, 'gibt-es-nicht', '2025-01')), null)
  })
})
