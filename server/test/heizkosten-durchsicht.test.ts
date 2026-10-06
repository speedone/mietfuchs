// Befunde der Durchsicht von #239 (Heizung PR 10), je einer mit Test: rückwirkendes Umstellen,
// eingefrorener Endstand bei eigener Heizperiode, Kesseltausch mitten in der Heizperiode, fremde
// Positionen bei der Einrichtung und der Pflichtanteil von 70 % in einer begonnenen Heizperiode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, createProperty, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, replaceHeatingPlant } from '../src/db/heating.ts'
import { saveDistribution, setUpSelf } from '../src/db/heatingSelf.ts'
import { closeHeatingSettlement } from '../src/db/heatingSettlements.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { CALENDAR_RULES, periodContaining, periodKey } from '../../shared/period.ts'

type Opened = Awaited<ReturnType<typeof openDatabase>>
async function withDatabase(run: (opened: Opened) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-durchsicht239-'))
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
const newId = () => `d239-${++ids}`
const settle = async (opened: Opened, day: string) => computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', periodContaining(CALENDAR_RULES, day)))
const NONE = { heatConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'heatMeter' }

test('Durchsicht #239 I1: die Einrichtung ab 2025 lässt die offene Vorperiode 2024 bei ihrem Schlüssel (§ 6 Abs. 4 HeizkostenV)', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const [u, a] of [['a', 50], ['b', 150]] as const) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: a, participates: true })
      for (const u of ['a', 'b']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u}`, persons: 1, start: '2020-01-01' })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'g24', { propertyId: 'objekt-1', period: '2024-01', category: HEATING_CATEGORY, description: 'Gas 2024', amountCents: 600000, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel' })
    })
    // Keine Rückfrage nach der Position von 2024: Sie gehört nicht zur eigenen Abrechnung.
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2025-01' }, '2025-02-01', newId))
    const g24 = (await opened.read(readStock)).costItems.find((c) => c.id === 'g24')
    assert.equal(g24?.key, 'area', 'die Position von 2024 bleibt nach Fläche')
    const s = await settle(opened, '2024-06-01')
    const share = (t: string) => s.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.costItemId === 'g24')?.shareCents
    assert.deepEqual([share('ta'), share('tb')], [150000, 450000])
    assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    // Vor dem Beginn: kein Schlüssel nach Heizkostenverordnung, kein Anteil, keine Karte.
    await assert.rejects(opened.write((db) => updateEntity(db, 'costItems', 'g24', { key: 'heatingSystem', heatingTarget: 'heating' })), status(400, /beginnt mit der Heizperiode 2025/))
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2024-01', { heatConsumptionPct: 70, insulationRule: 'notApplies' }, '2023-12-01')), status(400, /beginnt mit der Heizperiode 2025/))
    const views = await opened.read((db) => heatingPeriodViews(db, 'hp', '2024', '2025-02-01'))
    assert.equal(views?.[0]?.distribution, null)
    // Ab 2025 rechnet die Anlage selbst ab; eine freie Position dort lehnt der Wächter ab.
    await assert.rejects(opened.write((db) => createEntity(db, 'costItems', 'g25', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas 2025', amountCents: 1000, key: 'area', heatingPlantId: 'hp' })), status(400, /selbst nach der Heizkostenverordnung/))
  })
})

test('Durchsicht #239 M1: die Einrichtung ändert nur die genannten Positionen der eigenen Anlage', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createProperty(db, 'objekt-2', { name: 'Zweites' })
      for (const [u, p] of [['a', 'objekt-1'], ['x', 'objekt-2']] as const) await createEntity(db, 'units', u, { propertyId: p, name: u, areaM2: 50, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createHeatingPlant(db, 'hq', 'objekt-2', { energy: 'gas', method: 'manual' })
      await setUpSelf(db, 'hq', { ...NONE, period: '2025-01' }, '2024-12-01', newId)
      await createEntity(db, 'costItems', 'fremd', { propertyId: 'objekt-2', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas Objekt 2', amountCents: 1000, key: 'heatingSystem', heatingPlantId: 'hq', heatingPart: 'operating', heatingTarget: 'heating' })
      const r = await setUpSelf(db, 'hp', { ...NONE, period: '2025-01', items: [{ id: 'fremd', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2024-12-01', newId)
      assert.equal(r?.converted, 0)
    })
    const c = (await opened.read(readStock)).costItems.find((x) => x.id === 'fremd')
    assert.deepEqual([c?.heatingPart, c?.heatingPlantId], ['operating', 'hq'])
  })
})

test('Durchsicht #239 C1: der Pflichtanteil von 70 % lässt sich auch in einer begonnenen Heizperiode nachtragen', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u, areaM2: 50, participates: true })
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
      await setUpSelf(db, 'hp', { ...NONE, heatConsumptionPct: 50, insulationRule: 'unknown', period: '2025-01' }, '2025-03-01', newId)
    })
    // „Weiß ich nicht“ und 50 %: Die Abrechnung warnt.
    let s = await settle(opened, '2025-06-01')
    assert.ok(s.notices.some((n) => n.code === 'heating.share-forced-unsure' && /Mit 70 % liegen Sie in jedem Fall richtig/.test(n.text)), JSON.stringify(s.notices.map((n) => n.code)))
    // Die Heizperiode hat begonnen; eine andere Wahl bleibt gesperrt, der Pflichtwert nicht.
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2025-01', { heatConsumptionPct: 60, insulationRule: 'notApplies' }, '2025-06-01')), status(400, /§ 6 Abs. 4/))
    const d = await opened.write((db) => saveDistribution(db, 'hp', '2025-01', { heatConsumptionPct: 70, insulationRule: 'applies' }, '2025-06-01'))
    assert.deepEqual([d?.effective?.heating, d?.forcedPercent], [70, 70])
    s = await settle(opened, '2025-06-01')
    assert.ok(!s.notices.some((n) => n.code === 'heating.share-forced-unsure'))
  })
})

for (const own of [false, true]) {
  test(`Durchsicht #239 I2: der eingefrorene Endstand gilt als Anfangsstand, ${own ? 'eigene Heizperiode ab Mai (Weg d)' : 'Kalenderjahr'}`, async () => {
    await withDatabase(async (opened) => {
      const rules: PeriodRules = own ? { startMonth: 5, changes: [] } : CALENDAR_RULES
      const p1 = own ? '2024-05' : '2024-01'
      const p2 = own ? '2025-05' : '2025-01'
      const [b0, b1, b2] = own ? ['2024-04-30', '2025-04-30', '2026-04-30'] : ['2023-12-31', '2024-12-31', '2025-12-31']
      await opened.write(async (db) => {
        for (const u of ['a', 'b']) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: 50, participates: true })
        for (const u of ['a', 'b']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u}`, persons: 1, start: '2020-01-01' })
        await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
        if (own) await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp'))
        await setUpSelf(db, 'hp', { ...NONE, period: p1 }, '2024-01-01', newId)
      })
      const meters = (await opened.read(readStock)).meters
      const m = (u: string) => meters.find((x) => x.unitId === u && x.type === 'waerme')?.id ?? assert.fail('Wärmezähler')
      await opened.write(async (db) => {
        for (const u of ['a', 'b']) {
          await createEntity(db, 'readings', `${u}0`, { meterId: m(u), date: b0, value: 0 })
          await createEntity(db, 'readings', `${u}1`, { meterId: m(u), date: b1, value: 10000 })
          await createEntity(db, 'readings', `${u}2`, { meterId: m(u), date: b2, value: 20000 })
        }
        for (const p of [p1, p2]) await createEntity(db, 'costItems', `w${p}`, { propertyId: 'objekt-1', period: p, category: HEATING_CATEGORY, description: `Wartung ${p}`, amountCents: 100000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'operating', heatingTarget: 'heating', ...(own ? { taxYear: Number(p.slice(0, 4)) + 1 } : {}) })
      })
      const compute = async (key: string) => {
        const stock = await opened.read(readStock)
        const h = periodContaining(rules, `${key}-01`)
        return computeSettlement(own ? (heatingSnapshotFor(stock, 'objekt-1', 'hp', h) ?? assert.fail('Schnappschuss')) : snapshotFor(stock, 'objekt-1', h))
      }
      const s1 = await compute(p1)
      if (own) await opened.write((db) => closeHeatingSettlement(db, { id: 'c1', plantId: 'hp', period: periodKey(p1), closedAt: '2026-01-01', sentAt: null, settlement: s1 }))
      else await opened.write((db) => closeSettlement(db, { id: 'c1', propertyId: 'objekt-1', period: periodKey(p1), closedAt: '2026-01-01', sentAt: null, settlement: s1 }))
      // Nach dem Abschluss wird der Endstand von A berichtigt; zugestellt ist 10.000.
      await opened.write((db) => updateEntity(db, 'readings', 'a1', { value: 13000 }))
      const s2 = await compute(p2)
      const share = (t: string) => s2.statements.find((st) => st.tenancyId === t)?.rows.find((r) => r.costItemId === `w${p2}`)?.shareCents
      assert.deepEqual([share('ta'), share('tb')], [50000, 50000])
    })
  })
}

// Kesseltausch am 01.07.2025 (Gas auf Fernwärme), Anlage selbst abgerechnet; Wohnung C wechselt am 30.09.
async function tausch(opened: Opened, hw: 'none' | 'combined', withSwapReading: boolean): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, area] of [['a', 60], ['b', 80], ['c', 60]] as const) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
    await createEntity(db, 'tenancies', 'A', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    await createEntity(db, 'tenancies', 'B', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
    await createEntity(db, 'tenancies', 'C', { unitId: 'c', tenantName: 'Mieter C', persons: 1, start: '2020-01-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await setUpSelf(db, 'hp', { ...NONE, waterConsumptionPct: 70, hotWater: hw, dhwHeatMeter: true, period: '2025-01' }, '2024-12-01', newId)
  })
  const meters = (await opened.read(readStock)).meters
  const m = (u: string, t = 'waerme') => meters.find((x) => x.unitId === u && x.type === t)?.id ?? assert.fail('Zähler')
  const dh = meters.find((x) => x.heatingRole === 'dhwHeat')?.id
  await opened.write(async (db) => {
    const r = (id: string, meterId: string, date: string, value: number) => createEntity(db, 'readings', id, { meterId, date, value })
    for (const [u, v] of [['a', 10000], ['b', 10000], ['c', 10000]] as const) {
      await r(`${u}0`, m(u), '2024-12-31', 0)
      await r(`${u}1`, m(u), '2025-12-31', v)
      if (hw === 'combined') {
        await r(`${u}w0`, m(u, 'warmwasser'), '2024-12-31', 0)
        await r(`${u}w1`, m(u, 'warmwasser'), '2025-12-31', 30)
      }
    }
    if (hw === 'combined' && dh) {
      await r('dh0', dh, '2024-12-31', 0)
      await r('dh1', dh, '2025-12-31', 9000)
    }
    await createDelivery(db, 'd1', 'hp', { label: 'Gas', invoiceDate: '2025-07-10', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30', energyKwh: 20000, fixedCents: 0 })
    await createEntity(db, 'costItems', 'gas1', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas Jan-Jun', amountCents: 300000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: hw === 'combined' ? 'both' : 'heating', fuelDeliveryId: 'd1' })
    await replaceHeatingPlant(db, 'hp', 'hp2', { date: '2025-07-01', energy: 'districtHeating', name: 'Neu', previousName: 'Alt', ...(withSwapReading && dh ? { meterReadings: [{ meterId: dh, value: 4500 }] } : {}) })
    await createDelivery(db, 'd2', 'hp2', { label: 'Fernwärme', invoiceDate: '2026-01-10', invoiceFrom: '2025-07-01', invoiceTo: '2025-12-31', energyKwh: 20000, fixedCents: 0 })
    await createEntity(db, 'costItems', 'gas2', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas Jul-Dez', amountCents: 100000, key: 'heatingSystem', heatingPlantId: 'hp2', heatingPart: 'fuel', heatingTarget: hw === 'combined' ? 'both' : 'heating', fuelDeliveryId: 'd2' })
  })
}
const tenantsOf = (s: ReturnType<typeof computeSettlement>, id: string) =>
  s.statements.reduce((a, st) => a + (st.rows.find((r) => r.costItemId === id)?.shareCents ?? 0), 0)

test('Durchsicht #239 I3a: der Anteil gehört zur Linie; die neue Anlage übernimmt ihn, ein anderer in derselben Heizperiode ist gesperrt', async () => {
  await withDatabase(async (opened) => {
    await tausch(opened, 'none', false)
    const s = await settle(opened, '2025-06-01')
    assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    assert.equal(tenantsOf(s, 'gas2'), 100000, 'die Kosten der neuen Anlage tragen die Mieter')
    assert.equal(tenantsOf(s, 'gas1'), 300000)
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp2', '2025-01', { heatConsumptionPct: 60, insulationRule: 'notApplies' }, '2024-12-01')), status(400, /derselben Heizperiode/))
    const d = await opened.write((db) => saveDistribution(db, 'hp2', '2025-01', { heatConsumptionPct: 70, insulationRule: 'notApplies' }, '2024-12-01'))
    assert.equal(d?.effective?.heating, 70)
  })
})

test('Durchsicht #239 I3b: verbundenes Warmwasser beim Tausch, der Speicherzähler wird an der Laufzeit jeder Anlage abgegrenzt', async () => {
  await withDatabase(async (opened) => {
    await tausch(opened, 'combined', true)
    const tied = (await opened.read(readStock)).readings.filter((r) => r.date === '2025-06-30')
    assert.deepEqual(tied.map((r) => r.value), [4500], 'der Tauschdialog legt die Ablesung am letzten Tag der alten Anlage an')
    const s = await settle(opened, '2025-06-01')
    assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    const alpha = Object.fromEntries((s.heating ?? []).map((h) => [h.plantId, h.self?.alpha?.percent ?? null]))
    assert.deepEqual(alpha, { hp: 22.5, hp2: 22.5 })
    assert.equal(tenantsOf(s, 'gas1') + tenantsOf(s, 'gas2'), 400000)
  })
})

test('Durchsicht #239 I3c: fehlt der Stand des Speicherzählers zum Tausch, verteilt Mietfuchs die Anlagen nicht und sagt warum', async () => {
  await withDatabase(async (opened) => {
    await tausch(opened, 'combined', false)
    const s = await settle(opened, '2025-06-01')
    const texts = s.notices.filter((n) => n.code === 'heating.self-incomplete').map((n) => n.text)
    assert.ok(texts.some((t) => /Kesseltausch/.test(t) && /30\.06\.2025/.test(t)), texts.join('\n'))
    assert.equal(tenantsOf(s, 'gas1'), 0)
  })
})
