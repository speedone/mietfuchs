// Lesen und Schreiben der eigenen Heizkostenabrechnung (Heizung PR 10): Einrichtung in einer
// Transaktion, Anteil nur vor Beginn der Heizperiode änderbar (§ 6 Abs. 4), Schlüssel und Ziel
// passen zur Anlage, Antworten zu fehlenden Zwischenablesungen, Mieterwechsel mit eigenem Ablesedatum.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { changeTenant, closeSettlement, createEntity } from '../src/db/repository.ts'
import { selfClosedEndsOf, snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import { createHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { removeInterimGap, saveDistribution, saveInterimGap, SelfItemsError, setUpSelf } from '../src/db/heatingSelf.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heizkosten-'))
  const opened = await openDatabase({ dataDir })
  try {
    await run(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
const status = (code: number, text: RegExp) => (e: unknown) =>
  e instanceof Error && 'status' in e && (e as { status: unknown }).status === code && text.test(e.message)

let ids = 0
const newId = () => `neu-${++ids}`

// Drei Wohnungen, je ein Mieter, Gasheizung mit freien Schlüsseln und eine Heizposition nach Fläche.
async function haus(opened: Opened, energy = 'gas'): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) {
      await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
      await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u.toUpperCase()}`, persons: 1, start: '2020-01-01' })
    }
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy, method: 'manual' })
    await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas', amountCents: 600000, key: 'area' })
  })
}
const SETUP = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }

test('Review Focus 3: Umstellen auf die eigene Abrechnung nennt erst die offenen Positionen, dann alles in einer Transaktion', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const erst = opened.write((db) => setUpSelf(db, 'hp', SETUP, '2026-02-01', newId))
    await assert.rejects(erst, (e: unknown) => e instanceof SelfItemsError && e.status === 409 && e.items.map((i) => [i.id, i.key]).join() === 'gas,area')
    let stock = await opened.read(readStock)
    assert.equal(stock.heatingPlants.find((p) => p.id === 'hp')?.method, 'manual', 'nichts geschrieben')
    assert.equal(stock.meters.length, 0)
    const done = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    assert.ok(done)
    assert.deepEqual([done.plant.method, done.plant.capture, done.plant.hotWater, done.converted], ['self', 'heatMeter', 'combined', 1])
    stock = await opened.read(readStock)
    const gas = stock.costItems.find((c) => c.id === 'gas')
    assert.deepEqual([gas?.key, gas?.heatingPart, gas?.heatingTarget], ['heatingSystem', 'fuel', 'both'])
    // Je Wohnung ein Wärme- und ein Warmwasserzähler, dazu der Wärmezähler am Speicher.
    assert.deepEqual(stock.meters.map((m) => [m.unitId, m.type, m.heatingRole ?? null]).sort(), [
      ['a', 'waerme', null], ['a', 'warmwasser', null], ['b', 'waerme', null], ['b', 'warmwasser', null], ['c', 'waerme', null], ['c', 'warmwasser', null], [null, 'waerme', 'dhwHeat'],
    ].sort())
    const row = stock.heatingPeriodRows.find((r) => r.plantId === 'hp' && r.period === '2025-01')
    assert.deepEqual([row?.heatConsumptionPct, row?.waterConsumptionPct, row?.insulationRule, row?.dhwMethod], [70, 70, 'notApplies', 'heatMeter'])
  })
})

test('Einrichtung: Anteil 50 bis 70 %, Pflichtanteil bei gedämmten Leitungen, Warmwasseranteil bei Heizöl mit dem Heizwert (Heizung PR 11)', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const items = [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }]
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 75 }, '2026-02-01', newId)), status(400, /§ 10 HeizkostenV.*vereinbart/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 45 }, '2026-02-01', newId)), status(400, /mindestens 50/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, heatConsumptionPct: 60, insulationRule: 'applies' }, '2026-02-01', newId)), status(400, /70 %.*§ 7 Abs\. 1 Satz 2/))
    // § 8 Abs. 1: Der Anteil beim Warmwasser ist eine eigene Wahl, nie still der der Heizung (Abweichung 14).
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, waterConsumptionPct: undefined }, '2026-02-01', newId)), status(400, /Warmwasser.*§ 8 Abs\. 1/))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2026-02-01', newId)), status(400, /§ 9 Abs\. 1/))
  })
  await withDatabase(async (opened) => {
    await haus(opened, 'oil')
    // Heizung PR 11: Warmwasseranteil mit dem Heizwert laut Rechnung (§ 9 Abs. 3 HeizkostenV); die Sperre
    // aus PR 10 (Abweichung 10) fällt.
    const verbunden = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    assert.deepEqual([verbunden?.plant.method, verbunden?.plant.hotWater], ['self', 'combined'])
  })
})

test('Eigene Abrechnung nur über die Einrichtung; zurück auf freie Schlüssel nur mit Bestätigung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'self', capture: 'heatMeter' })), status(400, /Einrichtung/))
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    await assert.rejects(opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' })), (e: unknown) => e instanceof SelfItemsError && e.items.length === 1)
    const back = await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    assert.equal(back?.method, 'manual')
    const gas = (await opened.read(readStock)).costItems.find((c) => c.id === 'gas')
    assert.deepEqual([gas?.key, gas?.heatingTarget ?? null], ['area', null])
  })
})

test('Schlüssel und Ziel: nach Heizkostenverordnung nur bei eigener Abrechnung, dort nur so, und das Ziel passt zum Warmwasser', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const neu = (id: string, body: Record<string, unknown>) => opened.write((db) => createEntity(db, 'costItems', id, {
      propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Wartung', amountCents: 24000, ...body,
    }))
    await assert.rejects(neu('w1', { key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'operating', heatingTarget: 'both' }), status(400, /eigener Heizkostenabrechnung/))
    // „Nur Heizung“ bei freien Schlüsseln (A2, B7) ist erlaubt.
    await neu('w2', { key: 'area', heatingTarget: 'heating' })
    await assert.rejects(
      opened.write((db) => createEntity(db, 'costItems', 'gs', { propertyId: 'objekt-1', period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 48000, key: 'area', heatingTarget: 'heating' })),
      status(400, /Heizung und Warmwasser/),
    )
    await opened.write((db) => setUpSelf(db, 'hp', {
      ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }, { id: 'w2', heatingPart: 'operating', heatingTarget: 'heating' }],
    }, '2026-02-01', newId))
    await assert.rejects(neu('w3', { key: 'area' }), status(400, /nach Heizkostenverordnung/))
    await assert.rejects(neu('w4', { key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: 'water' }), status(400, /§ 9 Abs\. 1/))
    await neu('w5', { key: 'heatingSystem', heatingPart: 'metering', heatingTarget: 'water' })
    const w2 = (await opened.read(readStock)).costItems.find((c) => c.id === 'w2')
    assert.deepEqual([w2?.key, w2?.heatingTarget], ['heatingSystem', 'heating'])
  })
})

test('R-A7: der Anteil einer begonnenen Heizperiode bleibt; ein neuer gilt ab der nächsten und ist ein Wechsel', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, heatConsumptionPct: 50, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2025-03-01', newId))
    // 2025 hat am 01.01. begonnen: Die Einrichtung hat den bisherigen Anteil festgehalten, ändern geht nicht mehr.
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2025-01', { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }, '2025-03-01')), status(400, /§ 6 Abs\. 4/))
    const next = await opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }, '2025-11-15'))
    assert.deepEqual([next?.own.heating, next?.effective?.heating, next?.inherited, next?.begun], [70, 70, false, false])
    const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', '2025', '2025-03-01')) ?? assert.fail('keine Anlage')
    assert.deepEqual([view?.distribution?.effective?.heating, view?.distribution?.begun, view?.distribution?.first], [50, true, false])
  })
})

test('Fehlende Zwischenablesung: Antwort speichern, ändern, entfernen', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const gap = await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'missed', reason: '' }))
    assert.deepEqual(gap, { unitId: 'c', date: '2025-09-30', status: 'missed', reason: '' })
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    assert.deepEqual((await opened.read(readStock)).interimGaps, [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }])
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'vergessen' })), status(400, /nicht möglich/))
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'c', '30.09.2025', { status: 'missed' })), status(400, /Datum/))
    assert.equal(await opened.write((db) => saveInterimGap(db, 'zz', '2025-09-30', { status: 'missed' })), null)
    assert.equal(await opened.write((db) => removeInterimGap(db, 'c', '2025-09-30')), true)
    assert.deepEqual((await opened.read(readStock)).interimGaps, [])
  })
})

test('Mieterwechsel: Ablesung mit eigenem Datum neben dem Auszug, und die Antwort ohne Zwischenablesung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => createEntity(db, 'meters', 'wc', { propertyId: 'objekt-1', name: 'Wärme C', unitId: 'c', type: 'waerme', unit: 'kWh' }))
    await opened.write((db) => createEntity(db, 'meters', 'xc', { propertyId: 'objekt-1', name: 'Warmwasser C', unitId: 'c', type: 'warmwasser', unit: 'm³' }))
    await opened.write((db) => createEntity(db, 'meters', 'wb', { propertyId: 'objekt-1', name: 'Wärme B', unitId: 'b', type: 'waerme', unit: 'kWh' }))
    const r = await opened.write((db) => changeTenant(db, 'objekt-1', 'tc', {
      end: '2025-09-30',
      readings: [{ meterId: 'wc', value: 7800, date: '2025-10-03' }],
      interimGap: null,
      newTenancy: { tenantName: 'Mieter C2', persons: 1, personHistory: [{ from: '2025-10-01', persons: 1 }], start: '2025-10-01', baseRents: [], prepayments: [], prepaymentOverrides: {} },
    }, newId))
    assert.deepEqual(r?.readings.map((x) => [x.meterId, x.date, x.value, x.interimFor]), [['wc', '2025-10-03', 7800, '2025-09-30']])
    await assert.rejects(
      opened.write((db) => changeTenant(db, 'objekt-1', 'tb', { end: '2025-06-30', readings: [{ meterId: 'wb', value: 1, date: '30.06.2025' }], newTenancy: null }, newId)),
      status(400, /Ablesedatum/),
    )
    await opened.write((db) => changeTenant(db, 'objekt-1', 'ta', { end: '2025-06-30', readings: [], interimGap: { status: 'impossible', reason: 'Mieter verreist' }, newTenancy: null }, newId))
    assert.deepEqual((await opened.read(readStock)).interimGaps, [{ unitId: 'a', date: '2025-06-30', status: 'impossible', reason: 'Mieter verreist' }])
  })
})

test('Beheizte Fläche: bei Grundkosten nach beheizter Fläche braucht jede angeschlossene Wohnung eine', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const items = [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }]
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, areaBasisHeat: 'heatedArea' }, '2026-02-01', newId)), status(400, /beheizte Fläche/))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { units: [{ unitId: 'a', heatedAreaM2: 50 }, { unitId: 'b', heatedAreaM2: 70 }, { unitId: 'c', heatedAreaM2: 55 }] }))
    const ok = await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items, areaBasisHeat: 'heatedArea' }, '2026-02-01', newId))
    assert.equal(ok?.plant.areaBasisHeat, 'heatedArea')
  })
})

test('Schnappschuss: Anlage, Heizperiode, Ziel und Antworten zu Zwischenablesungen (Entwurf 5.8)', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...SETUP, items: [{ id: 'gas', heatingPart: 'fuel', heatingTarget: 'both' }] }, '2026-02-01', newId))
    await opened.write((db) => saveInterimGap(db, 'c', '2025-09-30', { status: 'impossible', reason: 'Wohnung nicht zugänglich' }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = snapshotFor(await opened.read(readStock), 'objekt-1', p)
    const plant = s.heatingPlants?.find((x) => x.id === 'hp') ?? assert.fail('keine Anlage')
    assert.deepEqual([plant.method, plant.hotWater, plant.capture, plant.areaBasisHeat, plant.changeSplit], ['self', 'combined', 'heatMeter', 'area', 'degreeDays'])
    const row = s.heatingPeriodRows?.find((r) => r.plantId === 'hp' && r.period === '2025-01') ?? assert.fail('keine Zeile')
    assert.deepEqual([row.heatConsumptionPct, row.waterConsumptionPct, row.insulationRule, row.dhwMethod], [70, 70, 'notApplies', 'heatMeter'])
    assert.equal(s.costItems.find((c) => c.id === 'gas')?.heatingTarget, 'both')
    assert.deepEqual(s.interimGaps, [{ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }])
  })
})

test('Schnappschuss: der eingefrorene Endstand einer abgeschlossenen Heizperiode (Abweichung 9)', async () => {
  await withDatabase(async (opened) => {
    await haus(opened)
    const frozen = { heating: [{ plantId: 'hp', period: '2024-01', to: '2024-12-31', self: { units: [{ readings: [
      { meterId: 'wa', meterName: 'Wärme A', pot: 'heating', boundary: '2024-12-31', date: '2024-12-31', value: 1000 },
      { meterId: 'wa', meterName: 'Wärme A', pot: 'heating', boundary: '2023-12-31', date: '2023-12-31', value: 0 },
      { meterId: 'wb', meterName: 'Wärme B', pot: 'heating', boundary: '2024-12-31', date: null, value: null },
    ] }] } }] }
    await opened.write((db) => closeSettlement(db, { id: 's24', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: frozen }))
    const p = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
    const s = snapshotFor(await opened.read(readStock), 'objekt-1', p)
    assert.deepEqual(s.selfClosedEnds, [{ plantId: 'hp', boundary: '2024-12-31', meterId: 'wa', date: '2024-12-31', value: 1000 }])
    // Ein eingefrorener Stand ohne den Ausweis der eigenen Abrechnung ergibt nichts.
    assert.deepEqual(selfClosedEndsOf({ heating: [{ plantId: 'hp' }] }), [])
    assert.deepEqual(selfClosedEndsOf(null), [])
  })
})
