// Befunde der Durchsicht von #237 (Heizung PR 8) mit den Zahlen der Proben T1–T6: zwei Wohnungen
// (60 und 40 m²), eine Ölheizung mit freien Schlüsseln, Objekt im Kalenderjahr. Jede Probe geht über
// die echten Schreibwege und schließt ab wie index.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { createDelivery, removeDelivery, unfreezeFuelCarries, updateDelivery } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, HeatingError, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { calendarYearPeriod, periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withHouse(run: (h: House) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-vorrat-dv-'))
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
      await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
      await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
    })
    await run(house(opened))
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
type House = ReturnType<typeof house>
function house(opened: Opened) {
  let n = 0
  const settle = async (y: number): Promise<ComputedSettlement> => computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', calendarYearPeriod(y)), {})
  return {
    opened,
    settle,
    deliver: async (label: string, date: string, q: number, cents: number, kg: number, co2: number, key: 'area' | 'external' = 'area') => {
      const id = `d${n++}`
      await opened.write((db) => createDelivery(db, id, 'hp', { label, deliveredAt: date, invoiceDate: date, quantity: q, quantityUnit: 'l', emissionsKg: kg, co2CostCents: co2 }))
      await opened.write((db) => createEntity(db, 'costItems', `c${id}`, {
        propertyId: 'objekt-1', period: `${date.slice(0, 4)}-01`, category: HEATING_CATEGORY, description: label, amountCents: cents, key,
        ...(key === 'external' ? { externalBasis: { measure: 'area', total: 100, totalCents: cents } } : {}),
        heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId: id,
      }))
      return { delivery: id, item: `c${id}` }
    },
    stock: (key: string, body: Record<string, unknown>) => opened.write((db) => saveStock(db, 'hp', key, body)),
    close: async (y: number) => {
      const settlement = await settle(y)
      await opened.write((db) => closeSettlement(db, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(`${y}-01`), closedAt: '2027-01-01', sentAt: null, settlement }))
    },
    reopen: (y: number) => opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(`${y}-01`), `h${n++}`, unfreezeFuelCarries)),
  }
}
// Was die Mieter an Heizkosten tragen, ohne die Abzugszeilen der CO₂-Aufteilung.
const heat = (s: ComputedSettlement | unknown): number => {
  const st: unknown = s !== null && typeof s === 'object' ? Reflect.get(s, 'statements') : []
  if (!Array.isArray(st)) return 0
  return st.reduce((a: number, x: { rows: { category: string; kind?: string; shareCents: number }[] }) => a + x.rows.filter((r) => r.category === HEATING_CATEGORY && r.kind !== 'co2Relief').reduce((b, r) => b + r.shareCents, 0), 0)
}
const codes = (s: ComputedSettlement): string[] => s.notices.map((x) => x.code)
const textOf = (s: ComputedSettlement, code: string): string => s.notices.find((x) => x.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${codes(s).join(', ')}`)
const heatingError = (status: number, text: RegExp) => (err: unknown) => err instanceof HeatingError && err.status === status && text.test(err.message)

test('C1 (T1): Erster Vorrat nach einer Abrechnung nach Lieferung: Der Anfangsbestand zählt mit 0 €, die Mieter tragen 3.000 € statt 5.000 €', async () => {
  await withHouse(async (h) => {
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    assert.equal(heat(await h.settle(2024)), 300000)
    await h.close(2024)
    const view = await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 }) ?? assert.fail('keine Anlage')
    assert.equal(view.askAlreadySettled, true, 'die Karte fragt, ob der Anfangsbestand schon umgelegt wurde')
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    // Gekauft 4.000 l für 4.000 €, im Tank 1.000 l für 1.000 €: verbraucht 3.000 €, nicht 5.000 €.
    assert.equal(heat(await h.settle(2024)) + heat(s25), 300000)
    assert.equal(s25.heating?.[0]?.stock?.opening.costCents, 0)
    assert.equal(s25.heating?.[0]?.stock?.consumed.co2Cents, 0, 'die CO₂-Kosten des Anfangsbestands sind 2024 schon aufgeteilt')
    assert.equal(s25.heating?.[0]?.stock?.consumed.emissionsKg, 5352.6, 'seine kg zählen für die Stufe')
    assert.match(textOf(s25, 'fuel.opening-settled'), /Wert laut Eintrag 2\.000,00 €.*mit 0 € und ohne CO₂-Kosten/)
    // Antwortet der Vermieter „nein“, zählt der eingetragene Wert.
    await h.stock('2025-01', { openingAlreadySettled: false })
    assert.equal((await h.settle(2025)).heating?.[0]?.stock?.opening.costCents, 200000)
  })
})

test('I1 (T3): Bestandsrechnung ohne Schlüssel gibt den Endbestand mit 0 € weiter: 3.500 € statt 4.500 €', async () => {
  await withHouse(async (h) => {
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 03/2025', '2025-03-01', 3000, 300000, 8028.9, 52549, 'external')
    const s25 = await h.settle(2025)
    assert.match(textOf(s25, 'fuel.manual-by-delivery'), /mit 0 € in die nächste Heizperiode/)
    assert.equal(s25.heating?.[0]?.stock?.handover?.costCents, 0)
    await h.close(2025)
    await h.stock('2026-01', { stockUnit: 'l', closingQuantity: 0 })
    await h.deliver('Heizöl 03/2026', '2026-03-01', 500, 50000, 1338.15, 8758)
    const s26 = await h.settle(2026)
    assert.equal(heat(s25) + heat(s26), 350000)
  })
})

test('C2 (T4, T5): Folgeperiode abgeschlossen, Vorperiode wieder offen: Menge und Verknüpfung gesperrt, Beträge nicht; zusammen 3.600 €', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    const x = await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 500 })
    await h.deliver('Heizöl 03/2025', '2025-03-01', 1000, 120000, 2676.3, 17516)
    await h.close(2024)
    await h.close(2025)
    await h.reopen(2024)
    const lock = /Heizperiode 2025 hat den Endbestand dieser Heizperiode als Anfangsbestand übernommen/
    await assert.rejects(h.stock('2024-01', { closingQuantity: 800 }), heatingError(409, /2025 ist abgeschlossen/))
    await assert.rejects(h.opened.write((db) => updateDelivery(db, x.delivery, { quantity: 900 })), heatingError(409, lock))
    await assert.rejects(h.opened.write((db) => updateDelivery(db, x.delivery, { deliveredAt: '2024-04-01' })), heatingError(409, lock))
    await assert.rejects(h.opened.write((db) => updateEntity(db, 'costItems', x.item, { fuelDeliveryId: null })), heatingError(409, lock))
    await assert.rejects(h.opened.write((db) => removeDelivery(db, x.delivery)), heatingError(409, /abgeschlossene Heizperiode 2025|Positionen/))
    // Beträge dürfen sich ändern; eine Gutschrift dazu ebenso.
    await h.opened.write((db) => updateEntity(db, 'costItems', x.item, { amountCents: 330000 }))
    await h.opened.write((db) => createEntity(db, 'costItems', 'gut', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'Gutschrift', amountCents: -30000, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId: x.delivery }))
    const s24 = await h.settle(2024)
    const stand25 = (await h.opened.read(readClosedSettlements)).find((c) => c.period === '2025-01')?.settlement
    // Positionen 4.200 € − Endbestand 2025 (600 €) = 3.600 €, nicht 4.600 €.
    assert.equal(heat(s24) + heat(stand25), 360000)
  })
})

test('C2 (a): Geht die Bestandsrechnung der wieder geöffneten Vorperiode nicht auf, bucht sie den übernommenen Endbestand trotzdem als „im Vorrat“ aus', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 500 })
    await h.close(2024)
    await h.close(2025)
    await h.reopen(2024)
    // Eine neue Lieferung ohne Rechnung macht die Bestandsrechnung von 2024 ungültig.
    await h.opened.write((db) => createDelivery(db, 'ohne', 'hp', { label: 'Heizöl 11/2024', deliveredAt: '2024-11-01', quantity: 100, quantityUnit: 'l', emissionsKg: 267.63, co2CostCents: 1752 }))
    const s24 = await h.settle(2024)
    assert.equal(s24.notices.find((x) => x.code === 'fuel.stock-invalid')?.level, 'error')
    assert.equal(heat(s24), 300000 - 100000, 'der von 2025 übernommene Endbestand (1.000 €) ist gutgeschrieben')
  })
})

test('I2: Folgeperiode ohne Vorrat abgeschlossen: Endbestand gesperrt, Warnung mit Betrag', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.close(2025)
    await assert.rejects(h.stock('2024-01', { closingQuantity: 800 }), heatingError(409, /2025 ist abgeschlossen/))
    const s24 = await h.settle(2024)
    assert.match(textOf(s24, 'fuel.stock-not-taken-over'), /Endbestand im Wert von 1\.000,00 € wird von keiner Abrechnung übernommen/)
    assert.equal(s24.notices.find((x) => x.code === 'fuel.stock-not-taken-over')?.level, 'warning')
  })
})

test('I2 (Folgeperiode ungültig): Sie nennt den Endbestand, den sie nicht übernimmt', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.close(2024)
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 5000 })
    const s25 = await h.settle(2025)
    assert.match(textOf(s25, 'fuel.stock-not-taken-over'), /Endbestand der Heizperiode 2024 im Wert von 1\.000,00 € übernimmt diese Heizperiode nicht/)
  })
})

test('I2a (T2): Brennstoffposition ohne Lieferung neben dem Vorrat: Warnung, CO₂-Aufteilung unvollständig statt zu hoch', async () => {
  await withHouse(async (h) => {
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1500 })
    await h.deliver('Heizöl 03/2025', '2025-03-01', 3000, 300000, 8028.9, 52549)
    await h.opened.write((db) => createEntity(db, 'costItems', 'lose', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Heizöl 09/2025', amountCents: 200000, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel' }))
    const s = await h.settle(2025)
    assert.match(textOf(s, 'fuel.stock-unlinked'), /„Heizöl 09\/2025“ ist als Brennstoff gekennzeichnet, aber mit keiner Lieferung verknüpft/)
    assert.match(textOf(s, 'co2.incomplete'), /die Lieferung zu „Heizöl 09\/2025“/)
    assert.equal(s.heating?.[0]?.co2?.booked, false, 'kein CO₂-Abzug aus einer unvollständigen Rechnung (vorher 157,64 € statt 582,42 €)')
  })
})

test('M2 (T6): Wechsel von Öl auf Gas mit Vorrat in einer offenen Heizperiode: 409', async () => {
  await withHouse(async (h) => {
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676.3, openingCo2Cents: 17516, openingInvoicedBefore2023: false, closingQuantity: 400 })
    await assert.rejects(h.opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' })), heatingError(409, /Vorrat eingetragen/))
  })
})
