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
import { removeStock, saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, HeatingError, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { sql } from 'drizzle-orm'
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

// ---------- Nachprüfung von 6ef8f10 (Korrekturrunde 2) ----------

test('N1 (T8): Eine ohne Vorrat abgeschlossene Heizperiode gibt ihren Endbestand mit 0 € weiter; 2026 trägt 0 € statt 600 € doppelt', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    const x = await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 500 })
    await h.deliver('Heizöl 03/2025', '2025-03-01', 1000, 120000, 2676.3, 17516)
    await h.opened.write((db) => updateEntity(db, 'costItems', x.item, { fuelDeliveryId: null }))
    await h.close(2025)
    await h.opened.write((db) => updateEntity(db, 'costItems', x.item, { fuelDeliveryId: x.delivery }))
    await h.stock('2026-01', { stockUnit: 'l', closingQuantity: 0 })
    const s24 = await h.settle(2024)
    const stand25 = (await h.opened.read(readClosedSettlements)).find((c) => c.period === '2025-01')?.settlement
    const s26 = await h.settle(2026)
    // 2026 übernimmt aus 2025 nichts mehr: vorher trugen die Mieter dort 600 € zum zweiten Mal.
    assert.equal(heat(s26), 0)
    // 2024 schreibt 1.000 € gut, die keine Abrechnung übernimmt; das steht mit Betrag da (I2), und
    // zusammen mit diesem Verlust des Vermieters ist der Brennstoff genau einmal verteilt (4.200 €).
    assert.match(textOf(s24, 'fuel.stock-not-taken-over'), /Endbestand im Wert von 1\.000,00 €/)
    assert.equal(heat(s24) + heat(stand25) + heat(s26) + 100000, 420000)
    assert.match(textOf(s26, 'fuel.opening-settled'), /Heizperiode 2025 ist ohne Vorrat abgeschlossen/)
  })
})

test('N2 (T1u): Heizposition der Vorperiode ohne Kennzeichen „Brennstoff“ ist ein Indiz, auch bei offener Vorperiode: 3.000 € statt 5.000 €', async () => {
  await withHouse(async (h) => {
    await h.opened.write((db) => createEntity(db, 'costItems', 'alt', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'Heizöl 2024', amountCents: 300000, key: 'area', heatingPlantId: 'hp' }))
    const view = await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 }) ?? assert.fail('keine Anlage')
    assert.equal(view.askAlreadySettled, true)
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    assert.equal(heat(await h.settle(2024)) + heat(s25), 300000)
    // Nachprüfung von 7ce5958, Befund 1: Die Vorbelegung beruht nur auf einer Position ohne Kennzeichen,
    // deshalb eine Warnung mit Betrag, die die Position nennt, statt des Hinweises.
    const n = s25.notices.find((x) => x.code === 'fuel.opening-settled-assumed') ?? assert.fail(codes(s25).join(', '))
    assert.equal(n.level, 'warning')
    assert.match(n.text, /Anfangsbestand von 2\.000 l \(Wert laut Eintrag 2\.000,00 €\).*Heizperiode 2024.*„Heizöl 2024“ \(3\.000,00 €\).*tragen Sie 2\.000,00 € selbst/)
    assert.ok(!codes(s25).includes('fuel.opening-settled'), 'kein zweiter Hinweis daneben')
  })
})

test('N2 (T1v): Abgeschlossen ohne jede Heizposition ist kein Indiz: keine Frage, der Anfangsbestand zählt mit seinem Wert', async () => {
  await withHouse(async (h) => {
    await h.opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2024-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' }))
    await h.close(2024)
    const view = await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 }) ?? assert.fail('keine Anlage')
    assert.equal(view.askAlreadySettled, false)
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    assert.equal(s25.heating?.[0]?.stock?.opening.costCents, 200000)
    assert.ok(!codes(s25).includes('fuel.opening-settled'))
  })
})

test('N2 (T1x): „Nein“, obwohl die Vorperiode nach Lieferung verteilt hat: Warnung mit Betrag', async () => {
  await withHouse(async (h) => {
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.close(2024)
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, openingAlreadySettled: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    const n = s25.notices.find((x) => x.code === 'fuel.opening-not-settled') ?? assert.fail(codes(s25).join(', '))
    assert.equal(n.level, 'warning')
    assert.match(n.text, /zählt mit 2\.000,00 €.*Heizkosten von 3\.000,00 €.*tragen die Mieter 2\.000,00 € zweimal/)
  })
})

test('N3 (T1): Ohne CO₂-Kosten im Verbrauch keine Meldung, die CO₂-Kosten lägen über den Brennstoffkosten', async () => {
  await withHouse(async (h) => {
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    await h.close(2024)
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    assert.ok(!codes(s25).includes('co2.exceeds-heating'), codes(s25).join(', '))
  })
})

test('M2 (T6b): Wechsel des Energieträgers auch bei Vorrat nur in einer abgeschlossenen Heizperiode: 409', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 1000, openingCostCents: 100000, openingEmissionsKg: 2676.3, openingCo2Cents: 17516, openingInvoicedBefore2023: false, closingQuantity: 400 })
    await h.close(2024)
    await assert.rejects(h.opened.write((db) => updateHeatingPlant(db, 'hp', { energy: 'gas' })), heatingError(409, /Für einen neuen Kessel legen Sie eine neue Heizanlage an/))
  })
})

test('MB (Mutationsprobe der Nachprüfung): Kein Verlust-Hinweis, solange die Folgeperiode offen ist oder den Bestand übernimmt', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    assert.ok(!codes(await h.settle(2024)).includes('fuel.stock-not-taken-over'), 'Folgeperiode offen')
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 500 })
    await h.deliver('Heizöl 03/2025', '2025-03-01', 1000, 120000, 2676.3, 17516)
    await h.close(2025)
    const s24 = await h.settle(2024)
    assert.ok(!codes(s24).includes('fuel.stock-not-taken-over'), 'Folgeperiode hat übernommen')
    assert.equal(heat(s24) + heat((await h.opened.read(readClosedSettlements)).find((c) => c.period === '2025-01')?.settlement), 300000 + 120000 - 60000)
  })
})

// Nachprüfung von 7ce5958, Befund 1 (Proben W1–W3): Eine Wartung ohne Kennzeichen von 250 € erklärt keinen
// Anfangsbestand von 2.000 €. Vorher zählte er mit 0 €, und der Vermieter trug 2.000 € still.
for (const [name, description, withPlant] of [['W1', 'Wartung Brenner 2024', true], ['W2', 'Wartung Brenner 2024', false], ['W3', 'Messdienst Ablesung 2024', true]] as const) {
  test(`Befund 1 (${name}): ${description}${withPlant ? '' : ' ohne Heizanlage'} ohne Kennzeichen: Der Anfangsbestand zählt mit 2.000 €`, async () => {
    await withHouse(async (h) => {
      await h.opened.write((db) => createEntity(db, 'costItems', 'w', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description, amountCents: 25000, key: 'area', ...(withPlant ? { heatingPlantId: 'hp' } : {}) }))
      await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 })
      await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
      const s25 = await h.settle(2025)
      assert.equal(s25.heating?.[0]?.stock?.opening.costCents, 200000)
      assert.equal(heat(s25), 200000)
      assert.ok(!codes(s25).some((c) => c.startsWith('fuel.opening-')), codes(s25).join(', '))
    })
  })
}

test('Befund 1 (W1n): „Nein“ neben einer Wartung ohne Kennzeichen ist kein Widerspruch: keine Warnung', async () => {
  await withHouse(async (h) => {
    await h.opened.write((db) => createEntity(db, 'costItems', 'w', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'Wartung Brenner 2024', amountCents: 25000, key: 'area', heatingPlantId: 'hp' }))
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, openingAlreadySettled: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    assert.ok(!codes(s25).includes('fuel.opening-not-settled'), codes(s25).join(', '))
    assert.equal(heat(s25), 200000)
  })
})

test('Befund 1 (W4): Ausdrücklich „Betrieb“ zählt nie als Brennstoff, auch über dem Wert des Anfangsbestands', async () => {
  await withHouse(async (h) => {
    await h.opened.write((db) => createEntity(db, 'costItems', 'w', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'Wartung und Reparatur', amountCents: 300000, key: 'area', heatingPlantId: 'hp', heatingPart: 'operating' }))
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    const s25 = await h.settle(2025)
    assert.equal(s25.heating?.[0]?.stock?.opening.costCents, 200000)
    assert.ok(!codes(s25).some((c) => c.startsWith('fuel.opening-')), codes(s25).join(', '))
  })
})

// Nachprüfung von 7ce5958, Befund 2 (Probe D1): Ein früher eingetragener eigener Anfangsbestand der
// Folgeperiode lebte wieder auf, sobald der Vorrat der Vorperiode entfernt wurde: 5.000 € statt 3.000 €.
test('Befund 2 (D1): Endbestand der Vorperiode leert den eigenen Anfangsbestand der Folgeperiode; Entfernen setzt die Antwort zurück', async () => {
  await withHouse(async (h) => {
    await h.stock('2025-01', { stockUnit: 'l', openingQuantity: 2000, openingCostCents: 200000, openingEmissionsKg: 5352.6, openingCo2Cents: 35033, openingInvoicedBefore2023: false, openingAlreadySettled: false, closingQuantity: 1000 })
    await h.deliver('Heizöl 10/2025', '2025-10-01', 1000, 100000, 2676.3, 17516)
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 2000 })
    await h.deliver('Heizöl 03/2024', '2024-03-01', 3000, 300000, 8028.9, 52549)
    assert.equal(heat(await h.settle(2024)) + heat(await h.settle(2025)), 300000)
    const row = (await h.opened.read(readStock)).heatingPeriodRows.find((r) => r.period === '2025-01') ?? assert.fail('keine Zeile 2025')
    assert.equal(row.openingQuantity ?? null, null, 'der eigene Anfangsbestand 2025 ist geleert')
    assert.equal(row.openingAlreadySettled ?? null, null)
    await h.close(2024)
    await h.reopen(2024)
    assert.equal(await h.opened.write((db) => removeStock(db, 'hp', '2024-01')), true)
    // Ohne Vorrat 2024 und ohne eigenen Anfangsbestand 2025 rechnen beide nach Lieferung: Jeder gekaufte Liter
    // zählt genau einmal (4.000 €). Vorher lebte der alte Anfangsbestand von 2.000 € wieder auf: 5.000 €.
    const t24 = await h.settle(2024), t25 = await h.settle(2025)
    assert.equal(heat(t24) + heat(t25), 400000)
    assert.equal(t25.heating?.[0]?.stock, undefined, '2025 hat keinen Anfangsbestand mehr')
  })
})

test('Befund 2: Entfernen des Vorrats setzt die Antwort „schon umgelegt?“ der Folgeperiode zurück', async () => {
  await withHouse(async (h) => {
    await h.stock('2024-01', { stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 2000 })
    await h.stock('2025-01', { stockUnit: 'l', closingQuantity: 1000 })
    // Eine Antwort, die in der Folgeperiode stehen geblieben ist, gilt nach dem Entfernen nicht mehr.
    await h.opened.write(async (db) => { await db.run(sql`UPDATE heating_periods SET opening_already_settled = 0 WHERE period = '2025-01'`) })
    assert.equal(await h.opened.write((db) => removeStock(db, 'hp', '2024-01')), true)
    const row = (await h.opened.read(readStock)).heatingPeriodRows.find((r) => r.period === '2025-01') ?? assert.fail('keine Zeile 2025')
    assert.equal(row.openingAlreadySettled ?? null, null)
  })
})
