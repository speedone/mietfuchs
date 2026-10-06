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
import { changeTenant, closeSettlement, createEntity, createProperty, updateEntity } from '../src/db/repository.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { saveDistribution, saveInterimGap, setUpSelf } from '../src/db/heatingSelf.ts'
import { closeHeatingSettlement } from '../src/db/heatingSettlements.ts'
import { createDelivery } from '../src/db/fuel.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { computeSettlement } from '../src/calc.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
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
    // M9: höchstens zwei Nachkommastellen.
    await assert.rejects(opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 65.125, insulationRule: 'notApplies' }, '2025-06-01')), status(400, /zwei Nachkommastellen/))
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
    // Recht I1: bis PR 14 die Warnung zu § 6a Abs. 3 mit der Kürzung je Mieter (§ 12 Abs. 1 Satz 3).
    const n6a = s.notices.filter((n) => n.code === 'heating.self-6a-missing')
    assert.equal(n6a.length, 1, 'eine je Linie (Nachprüfung, N2)')
    assert.match(n6a[0]?.text ?? '', /vorhergehenden Abrechnungszeitraum/)
    // Der Kesseltausch erbt den Beginn (Nachprüfung, W1/W2).
    assert.deepEqual((await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp2')?.selfSpans, [{ from: '2025-01', until: null }])
    assert.ok(n6a.every((n) => n.level === 'warning' && /um 3 % kürzen \(§ 12 Abs\. 1 Satz 3 HeizkostenV\), hier: Mieter A \(A\) [0-9.,]+ €/.test(n.text)), n6a.map((n) => n.text).join('\n'))
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

test('Durchsicht #239 I3 (Recht): beim Mieterwechsel „nicht möglich“ nur mit Grund', async () => {
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 50, participates: true })
      await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    })
    await assert.rejects(opened.write((db) => changeTenant(db, 'objekt-1', 'ta', { end: '2025-06-30', readings: [], interimGap: { status: 'impossible', reason: '' }, newTenancy: null }, newId)), status(400, /Grund für die Teilung nach § 9b Abs\. 3/))
  })
})

// Nachprüfung von #239 (W1, W2): Der Beginn steht an der Anlage (`self_from`) und wird nicht aus den
// Anteilszeilen abgeleitet.
async function zweiMieter(opened: Opened): Promise<void> {
  await opened.write(async (db) => {
    for (const [u, a] of [['a', 50], ['b', 150]] as const) await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: a, participates: true })
    for (const u of ['a', 'b']) await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: `Mieter ${u}`, persons: 1, start: '2020-01-01' })
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
  })
}

test('Nachprüfung #239 W1: zurück auf freie Schlüssel und erneut ab 2026; 2025 bleibt bei Fläche, auch wenn 2024 abgeschlossen mit Anteil dasteht', async () => {
  await withDatabase(async (opened) => {
    await zweiMieter(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2024-01' }, '2023-12-01', newId))
    const s24 = await settle(opened, '2024-06-01')
    await opened.write((db) => closeSettlement(db, { id: 'c24', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: s24 }))
    await opened.write((db) => saveDistribution(db, 'hp', '2025-01', { heatConsumptionPct: 60, insulationRule: 'notApplies' }, '2024-12-01'))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    let stock = await opened.read(readStock)
    // Runde 3: Der Zeitraum mit der abgeschlossenen Heizperiode 2024 endet vor 2025, statt zu verschwinden.
    assert.deepEqual(stock.heatingPlants.find((p) => p.id === 'hp')?.selfSpans, [{ from: '2024-01', until: '2025-01' }])
    const rows = stock.heatingPeriodRows.filter((r) => r.plantId === 'hp')
    assert.deepEqual(rows.map((r) => [String(r.period), r.heatConsumptionPct]).sort(), [['2024-01', 70], ['2025-01', null]], 'abgeschlossene bleiben, offene werden geleert')
    await opened.write((db) => createEntity(db, 'costItems', 'g25', { propertyId: 'objekt-1', period: '2025-01', category: HEATING_CATEGORY, description: 'Gas 2025', amountCents: 400000, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel' }))
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2026-01' }, '2025-12-01', newId))
    stock = await opened.read(readStock)
    assert.deepEqual(stock.heatingPlants.find((p) => p.id === 'hp')?.selfSpans, [{ from: '2024-01', until: '2025-01' }, { from: '2026-01', until: null }])
    const s = await settle(opened, '2025-06-01')
    const share = (id: string) => s.statements.find((st) => st.tenancyId === id)?.rows.find((r) => r.costItemId === 'g25')?.shareCents
    assert.deepEqual([share('ta'), share('tb')], [100000, 300000])
    assert.deepEqual(s.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
  })
})

test('Nachprüfung #239 W2: die eigene Abrechnung beginnt nicht vor oder in einer abgeschlossenen Heizperiode und nie vor ihrem Beginn', async () => {
  await withDatabase(async (opened) => {
    await zweiMieter(opened)
    await opened.write(async (db) => {
      for (const y of [2023, 2024]) await createEntity(db, 'costItems', `g${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: HEATING_CATEGORY, description: `Gas ${y}`, amountCents: 400000, key: 'area', heatingPlantId: 'hp', heatingPart: 'fuel' })
    })
    const s24 = await settle(opened, '2024-06-01')
    await opened.write((db) => closeSettlement(db, { id: 'c24', propertyId: 'objekt-1', period: periodKey('2024-01'), closedAt: '2025-03-01', sentAt: null, settlement: s24 }))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2023-01', items: [{ id: 'g2023', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2025-06-01', newId)), status(400, /Heizperiode 2024 dieser Anlage ist abgeschlossen/))
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2025-01' }, '2024-12-01', newId))
    await assert.rejects(opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2023-01', items: [{ id: 'g2023', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2025-06-01', newId)), status(400, /beginnt mit der Heizperiode 2025/))
    // Erneut ab einer späteren Heizperiode eingerichtet: Der Beginn bleibt.
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2026-01' }, '2025-06-01', newId))
    assert.deepEqual((await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp')?.selfSpans, [{ from: '2025-01', until: null }])
    const live = await settle(opened, '2024-06-01')
    const share = (s: typeof live, id: string) => s.statements.find((st) => st.tenancyId === id)?.rows.find((r) => r.costItemId === 'g2024')?.shareCents
    assert.deepEqual([share(live, 'ta'), share(live, 'tb')], [share(s24, 'ta'), share(s24, 'tb')])
  })
})

// Nachprüfung von #239, N2: § 6a gilt für Abrechnungszeiträume ab dem 01.12.2021; ohne erfassten Verbrauch
// nur die Angaben nach Abs. 3 Satz 1 Nr. 2 und 3 (Abs. 5).
test('Nachprüfung #239 N2: Warnung zu § 6a erst ab Zeiträumen, die am 01.12.2021 oder später beginnen; ohne Verbrauch nach Abs. 5', async () => {
  await withDatabase(async (opened) => {
    await zweiMieter(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2021-01' }, '2020-12-01', newId))
    const meters = (await opened.read(readStock)).meters
    const m = (u: string) => meters.find((x) => x.unitId === u && x.type === 'waerme')?.id ?? assert.fail('Wärmezähler')
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) {
        await createEntity(db, 'readings', `${u}0`, { meterId: m(u), date: '2020-12-31', value: 0 })
        await createEntity(db, 'readings', `${u}1`, { meterId: m(u), date: '2021-12-31', value: 1000 })
        await createEntity(db, 'readings', `${u}2`, { meterId: m(u), date: '2022-12-31', value: 2000 })
        await createEntity(db, 'readings', `${u}3`, { meterId: m(u), date: '2023-12-31', value: 2000 })
      }
      for (const y of [2021, 2022, 2023]) await createEntity(db, 'costItems', `w${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: HEATING_CATEGORY, description: `Wartung ${y}`, amountCents: 100000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'operating', heatingTarget: 'heating' })
    })
    const codes6a = async (day: string) => (await settle(opened, day)).notices.filter((n) => n.code === 'heating.self-6a-missing').map((n) => n.text)
    assert.deepEqual(await codes6a('2021-06-01'), [])
    const n22 = await codes6a('2022-06-01')
    assert.equal(n22.length, 1)
    assert.match(n22[0] ?? '', /§ 6a Abs\. 3 HeizkostenV/)
    const n23 = await codes6a('2023-06-01')
    assert.match(n23[0] ?? '', /§ 6a Abs\. 5 HeizkostenV/)
    // Und der Satz zum Grund (N3).
    await assert.rejects(opened.write((db) => saveInterimGap(db, 'a', '2022-06-30', { status: 'impossible', reason: '' })), status(400, /Grund für die Teilung nach § 9b Abs\. 3/))
  })
})

// Runde 3 der Nachprüfung von #239: Zurückschalten mit einer abgeschlossenen Heizperiode der eigenen
// Abrechnung. Ihr Zeitraum endet dann, statt zu verschwinden, und die abgeschlossene rechnet weiter nach ihr.
test('Nachprüfung #239 Runde 3: zurück nach abgeschlossener eigener Abrechnung 2025; 2025 rechnet heute wie zugestellt, 2026 nach Fläche', async () => {
  await withDatabase(async (opened) => {
    await zweiMieter(opened)
    await opened.write(async (db) => {
      await setUpSelf(db, 'hp', { ...NONE, period: '2025-01' }, '2024-12-01', newId)
      for (const y of [2025, 2026]) await createEntity(db, 'costItems', `g${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: HEATING_CATEGORY, description: `Gas ${y}`, amountCents: 400000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: 'heating' })
    })
    await opened.write((db) => saveDistribution(db, 'hp', '2026-01', { heatConsumptionPct: 60, insulationRule: 'notApplies' }, '2025-12-01'))
    const meters = (await opened.read(readStock)).meters
    await opened.write(async (db) => {
      for (const u of ['a', 'b']) {
        const m = meters.find((x) => x.unitId === u && x.type === 'waerme')?.id ?? assert.fail('Wärmezähler')
        let v = 0
        for (const d of ['2024-12-31', '2025-12-31', '2026-12-31']) {
          await createEntity(db, 'readings', `r${u}${d}`, { meterId: m, date: d, value: v })
          v += u === 'a' ? 3000 : 1000
        }
      }
    })
    const s25 = await settle(opened, '2025-06-01')
    assert.deepEqual(s25.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    await opened.write((db) => closeSettlement(db, { id: 'c25', propertyId: 'objekt-1', period: periodKey('2025-01'), closedAt: '2026-03-01', sentAt: '2026-03-02', settlement: s25 }))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual', convertItems: 'area' }))
    const stock = await opened.read(readStock)
    const plant = stock.heatingPlants.find((p) => p.id === 'hp')
    assert.deepEqual([plant?.method, plant?.selfSpans], ['manual', [{ from: '2025-01', until: '2026-01' }]])
    assert.deepEqual(['g2025', 'g2026'].map((id) => stock.costItems.find((c) => c.id === id)?.key), ['heatingSystem', 'area'])
    const live25 = await settle(opened, '2025-06-01')
    const rows = (s: typeof live25) => s.statements.map((st) => [st.tenancyId, st.rows.find((r) => r.costItemId === 'g2025')?.shareCents])
    assert.deepEqual(rows(live25), rows(s25))
    assert.deepEqual(compareWithFrozen(s25, live25, '2026-12-31', '2026-06-01').deviations, [])
    const s26 = await settle(opened, '2026-06-01')
    const share26 = (id: string) => s26.statements.find((st) => st.tenancyId === id)?.rows.find((r) => r.costItemId === 'g2026')?.shareCents
    assert.deepEqual([share26('ta'), share26('tb')], [100000, 300000])
    assert.deepEqual(s26.notices.filter((n) => n.level === 'error').map((n) => n.code), [])
    // Erneut einrichten unmittelbar am Ende: Der Zeitraum geht weiter (ein späterer Beginn ergäbe einen zweiten, siehe W1).
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2026-01', items: [{ id: 'g2026', heatingPart: 'fuel', heatingTarget: 'heating' }] }, '2025-12-01', newId))
    const again = (await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp')
    assert.deepEqual([again?.method, again?.selfSpans], ['self', [{ from: '2025-01', until: null }]])
  })
})

test('Nachprüfung #239 Runde 3: ohne abgeschlossene Heizperiode der eigenen Abrechnung verschwindet sie beim Zurückschalten ganz', async () => {
  await withDatabase(async (opened) => {
    await zweiMieter(opened)
    await opened.write((db) => setUpSelf(db, 'hp', { ...NONE, period: '2026-01' }, '2025-12-01', newId))
    await opened.write((db) => updateHeatingPlant(db, 'hp', { method: 'manual' }))
    const plant = (await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp')
    assert.deepEqual(plant?.selfSpans, [])
  })
})
