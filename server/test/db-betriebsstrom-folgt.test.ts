// Ein Abzug des Betriebsstroms folgt beim Wechsel des Abrechnungszeitraums immer seiner Stromrechnung
// (Folge-PR zu #252, Geld-K1, -H1, -H2; Entscheidungen G-H2 bis G-H4). Mehrere Abzüge derselben Rechnung werden
// gemeinsam geteilt, nach den Beträgen der Teile der Rechnung. Geprüft wird je Mieter gegen von Hand gerechnete
// Sollwerte (Plan pr-betriebsstrom-hinweise-plan.md, C.2), nicht nur gegen „Abzug = Rechnung je Zeitraum“: Diese
// Bedingung hielt in Runde 3 auch ein falsches Ergebnis aus.
//
// Das Haus: Wohnung A (80 m², Mieter A das ganze Jahr), Wohnung B (20 m², B1 bis 30.04.2025, B2 ab 01.05.2025).
// Wechsel „Mai ab 2025“: Rumpf 01.01.–30.04.2025 (120 Tage), 2025/26 ab 01.05.2025 (245 Tage aus dem alten Jahr).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { applyPeriodChange, previewPeriodChange } from '../src/db/periodChange.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { bookOperatingPower } from '../src/db/operatingPower.ts'
import { readCostItems, readStock } from '../src/db/read.ts'
import { createEntity } from '../src/db/repository.ts'
import { eq } from 'drizzle-orm'
import { properties } from '../src/db/schema.ts'
import type { CostItem, PeriodRules } from '../../shared/types.ts'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { periodKey, periodOfKey, rulesOf } from '../../shared/period.ts'

const TODAY = '2026-10-05'
const MAI_AB_2025: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
let n = 0
const ids = () => `f-${++n}`

async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-betriebsstrom-folgt-'))
  const opened = await openFreshDatabase(dataDir)
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

const items = (opened: OpenedDatabase): Promise<CostItem[]> => opened.read((db) => readCostItems(db))
const sum = (list: readonly CostItem[]) => list.reduce((a, c) => a + c.amountCents, 0)

async function mieter(opened: OpenedDatabase): Promise<void> {
  await opened.write(async (db) => {
    await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 80, participates: true })
    await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 20, participates: true })
    await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
    await createEntity(db, 'tenancies', 'tb1', { unitId: 'b', tenantName: 'Mieter B1', persons: 1, start: '2020-01-01', end: '2025-04-30' })
    await createEntity(db, 'tenancies', 'tb2', { unitId: 'b', tenantName: 'Mieter B2', persons: 1, start: '2025-05-01' })
  })
}

// Das Haus der Nachprüfung Runde 4 (zz-rr6): Gas 5.000 € nach Fläche, Hausstrom 1.000 € nach Einheiten, Müll
// 300 € nach Fläche, Betriebsstrom 100 € über die Schätzhilfe (verteilt wie das Gas, Abzug wie der Hausstrom).
async function haus(opened: OpenedDatabase, opts: { strom?: Record<string, unknown>; method?: 'manual' | 'service' } = {}): Promise<void> {
  const method = opts.method ?? 'manual'
  await mieter(opened)
  await opened.write(async (db) => {
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method })
    if (method === 'manual') await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
    await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units', ...(opts.strom ?? {}) })
    await createEntity(db, 'costItems', 'mu', { propertyId: 'objekt-1', period: '2025-01', category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'area' })
  })
  await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-01', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil der Brennstoffkosten' }, ids))
}

// Antworten: je Gruppe kalt oder Heizung; `taxYears` wie die Oberfläche (Vorschlag, wo nichts anderes gesagt).
async function wechsel(opened: OpenedDatabase, rules: PeriodRules, kalt: string, heizung: string, taxYears: Record<string, number> = {}) {
  const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', rules, TODAY))) ?? assert.fail('kein Objekt')
  const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.heating ? heizung : kalt]))
  const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', rules, { understood: true, groups, taxYears, token: preview.token }, ids, TODAY))
  return { preview, r }
}

// Heizung und Allgemeinstrom je Mieter über alle Abrechnungen nach dem Wechsel (ohne Müll).
async function jeMieter(opened: OpenedDatabase, keys: readonly string[]): Promise<Record<string, number>> {
  const stock = await opened.read((db) => readStock(db))
  const rules = rulesOf(stock.properties.find((p) => p.id === 'objekt-1'))
  const out: Record<string, number> = {}
  for (const key of keys) {
    const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
    for (const st of computeSettlement(snapshotFor(stock, 'objekt-1', p)).statements) {
      for (const r of st.rows) {
        if (r.category === 'Müllabfuhr') continue
        out[st.tenantName] = (out[st.tenantName] ?? 0) + r.shareCents
      }
    }
  }
  return out
}

// Jeder Abzug zeigt auf eine Stromrechnung im selben Zeitraum, und aus keinem Teil ist mehr abgezogen als er beträgt.
function verweiseStimmen(nachher: readonly CostItem[]): void {
  const abzuege = nachher.filter((c) => c.operatingPower === 'deduction')
  for (const d of abzuege) {
    const g = nachher.find((c) => c.id === d.operatingPowerGeneralId) ?? assert.fail(`${d.id}: keine Rechnung`)
    assert.equal(g.period, d.period, `${d.id}: Rechnung in anderem Zeitraum`)
    assert.ok(-sum(abzuege.filter((x) => x.operatingPowerGeneralId === g.id)) <= g.amountCents, `${g.id}: mehr Abzug als Rechnung`)
  }
}

// ---------- K1: Leistungszeitraum ganz in einem neuen Zeitraum, Gruppe mit dem Abzug in einem anderen ----------
// Hausstrom 01.01.–30.04.2025: Er bleibt im Rumpf. Bisher wanderte der Abzug mit der kalten Gruppe (Müll) und der
// Wechsel antwortete mit 409. Sollwerte (alle Anteile gehen auf, ohne Rundung): Hausstrom im Rumpf A 500,00,
// B1 500,00; Abzug −50,00 je; Gas 4.000/1.000 und Betriebsstrom 80/20 im Zeitraum der Heizgruppe.
for (const [heizung, soll] of [
  ['2025-01', { 'Mieter A': 453000, 'Mieter B1': 147000 }],
  ['2025-05', { 'Mieter A': 453000, 'Mieter B1': 45000, 'Mieter B2': 102000 }],
] as const) {
  test(`K1: Leistungszeitraum ganz im Rumpf, kalte Gruppe nach 2025/26, Heizung ${heizung}: Abzug folgt der Rechnung, je Mieter wie von Hand gerechnet`, async () => {
    await withDatabase(async (opened) => {
      await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' } })
      const vorher = await items(opened)
      const { r } = await wechsel(opened, MAI_AB_2025, '2025-05', heizung)
      if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
      const nachher = await items(opened)
      assert.equal(sum(nachher), sum(vorher))
      const abzuege = nachher.filter((c) => c.operatingPower === 'deduction')
      assert.deepEqual(abzuege.map((d) => [d.period, d.amountCents, d.operatingPowerGeneralId]), [['2025-01', -10000, 'hs']])
      assert.deepEqual(nachher.filter((c) => c.category === 'Müllabfuhr').map((c) => c.period), ['2025-05'])
      verweiseStimmen(nachher)
      const m = await jeMieter(opened, ['2025-01', '2025-05'])
      assert.deepEqual({ ...m, 'Mieter B2': m['Mieter B2'] ?? 0 }, { 'Mieter B2': 0, ...soll })
    })
  })
}

test('K1-Messdienst: nur der Abzug, Leistungszeitraum ganz im Rumpf, kalte Gruppe nach 2025/26: A 450,00, B1 450,00, B2 0,00', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { method: 'service', strom: { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' } })
    const { r } = await wechsel(opened, MAI_AB_2025, '2025-05', '2025-05')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    verweiseStimmen(nachher)
    const m = await jeMieter(opened, ['2025-01', '2025-05'])
    assert.equal(m['Mieter A'], 45000)
    assert.equal(m['Mieter B1'], 45000)
    assert.equal(m['Mieter B2'] ?? 0, 0)
  })
})

// Spiegelbild (gelang schon vorher, Regressionstest): Hausstrom 01.05.–31.12.2025 liegt ganz in 2025/26, die kalte
// Gruppe bleibt im Rumpf. Rechnung und Abzug je Wohnung 500,00 − 50,00 bei A und B2.
for (const [heizung, soll] of [
  ['2025-01', { 'Mieter A': 453000, 'Mieter B1': 102000, 'Mieter B2': 45000 }],
  ['2025-05', { 'Mieter A': 453000, 'Mieter B1': 0, 'Mieter B2': 147000 }],
] as const) {
  test(`K1-Spiegel: Leistungszeitraum ganz in 2025/26, kalte Gruppe im Rumpf, Heizung ${heizung}: je Mieter wie von Hand gerechnet`, async () => {
    await withDatabase(async (opened) => {
      await haus(opened, { strom: { serviceFrom: '2025-05-01', serviceTo: '2025-12-31' } })
      const { r } = await wechsel(opened, MAI_AB_2025, '2025-01', heizung)
      if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
      verweiseStimmen(await items(opened))
      const m = await jeMieter(opened, ['2025-01', '2025-05'])
      assert.deepEqual({ 'Mieter B1': 0, ...m }, soll)
    })
  })
}

test('K1-split: Leistungszeitraum ganz im Rumpf, kalte Gruppe „nach Tagen aufteilen“: Abzug bleibt ganz bei der Rechnung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' } })
    const { r } = await wechsel(opened, MAI_AB_2025, 'split', '2025-01')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.deepEqual(nachher.filter((c) => c.operatingPower === 'deduction').map((d) => [d.period, d.amountCents]), [['2025-01', -10000]])
    verweiseStimmen(nachher)
    const m = await jeMieter(opened, ['2025-01', '2025-05'])
    assert.equal(m['Mieter A'], 453000)
    assert.equal(m['Mieter B1'], 147000)
    assert.equal(m['Mieter B2'] ?? 0, 0)
  })
})

// ---------- H1: zwei Abzüge ergeben zusammen genau die Rechnung ----------
// Hausstrom 1.000 € nach Fläche, Leistungszeitraum 2025; Betriebsstrom 1.000 € (gekennzeichnet, nach Fläche); zwei
// Abzüge zu je −500 €. Teile der Rechnung 32.877 / 67.123. Einzeln nach Tagen geteilt ergaben die Abzüge in 2025/26
// zusammen 67.124 (> 67.123, 409). Gemeinsam: d1 −16.439 / −33.561, d2 −16.438 / −33.562. Je Mieter (jede Position
// für sich gerundet, #202): Rumpf netto A +1, B1 −1 Cent; 2025/26 netto A −1, B2 +1 Cent (F5: der Cent bleibt).
async function hausH1(opened: OpenedDatabase, strom: Record<string, unknown> = { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }): Promise<void> {
  await mieter(opened)
  await opened.write(async (db) => {
    await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
    await createEntity(db, 'costItems', 'bs', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom', amountCents: 100000, key: 'area', heatingPart: 'operating', heatingPlantId: 'hp', operatingPower: 'included', operatingPowerBasis: 'Zwischenzähler' })
    await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'area', ...strom })
    for (const id of ['d1', 'd2']) {
      await createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${id}`, amountCents: -50000, key: 'area', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'hs', operatingPowerBasis: 'Zwischenzähler' })
    }
  })
}

for (const [heizung, soll] of [
  ['2025-01', { 'Mieter A': 480000, 'Mieter B1': 119999, 'Mieter B2': 1 }],
  ['2025-05', { 'Mieter A': 480000, 'Mieter B1': -1, 'Mieter B2': 120001 }],
] as const) {
  test(`H1: zwei Abzüge zusammen gleich der Rechnung, Heizung ${heizung}: gemeinsam geteilt, kein Teil über der Rechnung, je Mieter wie von Hand gerechnet`, async () => {
    await withDatabase(async (opened) => {
      await hausH1(opened)
      const { r } = await wechsel(opened, MAI_AB_2025, 'split', heizung)
      if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
      const nachher = await items(opened)
      verweiseStimmen(nachher)
      const teil = (id: string, period: string) => nachher.find((c) => c.operatingPower === 'deduction' && c.period === period && c.description.startsWith(`Abzug ${id}`))?.amountCents
      assert.deepEqual([teil('d1', '2025-01'), teil('d1', '2025-05'), teil('d2', '2025-01'), teil('d2', '2025-05')], [-16439, -33561, -16438, -33562])
      assert.deepEqual(await jeMieter(opened, ['2025-01', '2025-05']), soll)
    })
  })
}

// ---------- H2: zweiter Wechsel über eine schon geteilte Rechnung ----------
// Erster Wechsel „Mai ab 2025“ (Hausstrom mit Leistungszeitraum 2025, Heizung in 2025/26): Werte der Nachprüfung W1b,
// A 4.530,01, B1 147,94, B2 1.322,05. Zweiter Wechsel „Juli ab 2025“: Der Rumpf wächst auf 01.01.–30.06.2025, der Teil
// 2025/26 (67.123) teilt sich auf 61 und 184 Tage (16.712 / 50.411), sein Abzug (−6.712) nach den Beträgen der Teile
// (−1.671 / −5.041). Ein Wechsel darf kein Geld zwischen Mietern verschieben: dieselben Werte je Mieter.
test('H2: zweiter Wechsel über eine schon geteilte Rechnung verschiebt je Mieter nichts', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const erster = await wechsel(opened, MAI_AB_2025, 'split', '2025-05')
    if (!erster.r || 'error' in erster.r) return assert.fail(erster.r ? erster.r.error : 'kein Objekt')
    const soll = { 'Mieter A': 453001, 'Mieter B1': 14794, 'Mieter B2': 132205 }
    assert.deepEqual(await jeMieter(opened, ['2025-01', '2025-05']), soll)
    const vorher = await items(opened)
    const zweiter = await wechsel(opened, { startMonth: 1, changes: ['2025-07'] }, '2025-07', '2025-07')
    if (!zweiter.r || 'error' in zweiter.r) return assert.fail(zweiter.r ? zweiter.r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.equal(sum(nachher), sum(vorher))
    verweiseStimmen(nachher)
    const strom = nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom')
    assert.deepEqual(strom.filter((c) => c.operatingPower === undefined).map((c) => [c.period, c.amountCents]).sort(), [['2025-01', 16712], ['2025-01', 32877], ['2025-07', 50411]])
    assert.deepEqual(strom.filter((c) => c.operatingPower === 'deduction').map((c) => [c.period, c.amountCents]).sort(), [['2025-01', -1671], ['2025-01', -3288], ['2025-07', -5041]])
    assert.deepEqual(await jeMieter(opened, ['2025-01', '2025-07']), soll)
  })
})

// H2b: zweiter Wechsel, in dem **beide** Teile der Rechnung wandern („Juli ab 2024“: 01.07.2024–30.06.2025 und
// 01.07.2025–30.06.2026). Die bewegten Teile (32.877 + 67.123) werden als eine Rechnung über 01.01.–31.12.2025 neu
// geteilt: 181 und 184 Tage, 49.589 / 50.411. Beide Abzüge (−3.288, −6.712) teilen sich gemeinsam: Summe 10.000 →
// 4.959 / 5.041; im ersten Teil 4.959 × 3.288/10.000 = 1.630,52 und × 6.712/10.000 = 3.328,48, Restcent an den
// größeren Rest, also −1.631 und −3.328; im zweiten der Rest, −1.657 und −3.384. Heizgruppe nach 2025-07.
// Je Mieter (Einheiten, im ersten Zeitraum A 365, B1 304, B2 61 Tage; jede Position für sich gerundet):
// A 4.529,99, B1 185,86, B2 1.284,15 (zusammen 6.000,00 €). Dass B1 mehr trägt als vor dem Wechsel, folgt aus dem
// neuen Zeitraum (seine Tage darin), nicht aus der Regel für den Abzug.
test('H2b: zweiter Wechsel, beide Teile der Rechnung wandern: Abzüge gemeinsam, je Mieter wie von Hand gerechnet', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const erster = await wechsel(opened, MAI_AB_2025, 'split', '2025-05')
    if (!erster.r || 'error' in erster.r) return assert.fail(erster.r ? erster.r.error : 'kein Objekt')
    const zweiter = await wechsel(opened, { startMonth: 1, changes: ['2024-07'] }, '2025-07', '2025-07')
    if (!zweiter.r || 'error' in zweiter.r) return assert.fail(zweiter.r ? zweiter.r.error : 'kein Objekt')
    const nachher = await items(opened)
    verweiseStimmen(nachher)
    const strom = nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom')
    assert.deepEqual(strom.filter((c) => c.operatingPower === undefined).map((c) => [c.period, c.amountCents]).sort(), [['2024-07', 49589], ['2025-07', 50411]])
    assert.deepEqual(strom.filter((c) => c.operatingPower === 'deduction').map((c) => [c.period, c.amountCents]).sort(), [['2024-07', -1631], ['2024-07', -3328], ['2025-07', -1657], ['2025-07', -3384]])
    assert.deepEqual(await jeMieter(opened, ['2024-07', '2025-07']), { 'Mieter A': 452999, 'Mieter B1': 18586, 'Mieter B2': 128415 })
  })
})

// H1 ohne Leistungszeitraum: Die Rechnung steht mit ihren Abzügen in der kalten Gruppe; „nach Tagen aufteilen“ teilt
// beide Abzüge gemeinsam wie die Rechnung (32.877 / 67.123), nicht jeden für sich nach Tagen (das ergab 409).
test('H1-Gruppe: Rechnung ohne Leistungszeitraum, zwei Abzüge gleich der Rechnung, Gruppe aufgeteilt: gemeinsam, je Mieter wie H1', async () => {
  await withDatabase(async (opened) => {
    await hausH1(opened, {})
    const { r } = await wechsel(opened, MAI_AB_2025, 'split', '2025-01')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    verweiseStimmen(await items(opened))
    assert.deepEqual(await jeMieter(opened, ['2025-01', '2025-05']), { 'Mieter A': 480000, 'Mieter B1': 119999, 'Mieter B2': 1 })
  })
})

// ---------- G-H2: drei Teile, zwei Abzüge ----------
// Wechsel mit zwei Rümpfen („Mai ab 2025“, „September ab 2025“): 2025 zerfällt in 120, 123 und 122 Tage. Hausstrom
// 1.000 € nach Fläche (Leistungszeitraum 2025): 32.877 / 33.698 / 33.425. Betriebsstrom 580,23 € (gekennzeichnet),
// Abzüge d1 −123,45 € und d2 −456,78 €, zusammen 58.023, geteilt nach den Teilen der Rechnung: 19.076 / 19.553 / 19.394,
// davon d1 4.059 / 4.160 / 4.126 und d2 15.017 / 15.393 / 15.268. Heizgruppe nach 2025-09.
// Je Mieter: B1 = 6.575 − 812 − 3.003 = 2.760 (Rumpf); A 4.800,00; B2 1.172,40; zusammen 6.000,00 €.
// Folgte der Abzug der Heizgruppe (alles in 2025-09), stünde B1 bei 65,75 € (Gegenmutation G-H2).
test('G-H2: drei Teile, zwei Abzüge: gemeinsam nach den Teilen der Rechnung, je Mieter wie von Hand gerechnet', async () => {
  await withDatabase(async (opened) => {
    await mieter(opened)
    await opened.write(async (db) => {
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
      await createEntity(db, 'costItems', 'bs', { propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Betriebsstrom', amountCents: 58023, key: 'area', heatingPart: 'operating', heatingPlantId: 'hp', operatingPower: 'included', operatingPowerBasis: 'Zwischenzähler' })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'area', serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
      for (const [id, cents] of [['d1', -12345], ['d2', -45678]] as const) {
        await createEntity(db, 'costItems', id, { propertyId: 'objekt-1', period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: `Abzug ${id}`, amountCents: cents, key: 'area', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: 'hs', operatingPowerBasis: 'Zwischenzähler' })
      }
    })
    const rules: PeriodRules = { startMonth: 1, changes: ['2025-05', '2025-09'] }
    const { r } = await wechsel(opened, rules, 'split', '2025-09')
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    verweiseStimmen(nachher)
    const teile = (id: string) => ['2025-01', '2025-05', '2025-09'].map((p) => nachher.find((c) => c.period === p && c.description.startsWith(`Abzug ${id}`))?.amountCents)
    assert.deepEqual(teile('d1'), [-4059, -4160, -4126])
    assert.deepEqual(teile('d2'), [-15017, -15393, -15268])
    assert.deepEqual(await jeMieter(opened, ['2025-01', '2025-05', '2025-09']), { 'Mieter A': 480000, 'Mieter B1': 2760, 'Mieter B2': 117240 })
  })
})

// ---------- G-H3: Zeitraum wächst nur (plan.regrows) ----------
// Vorher „Mai ab 2025“ und „Januar ab 2026“: 2025-05 ist 01.05.–31.12.2025. Danach nur „Mai ab 2025“: 2025-05 wächst auf
// 01.05.2025–30.04.2026 und reicht über zwei Kalenderjahre. Rechnung und Abzug bleiben zusammen dort.
// ---------- G-H4: Das Jahr der Zahlung eines Abzugs ist das seiner Betriebsstrom-Position ----------
test('G-H3/G-H4: wachsender Zeitraum: Rechnung und Abzug bleiben zusammen, der Abzug nimmt das Jahr des Betriebsstroms und wird nicht gefragt', async () => {
  await withDatabase(async (opened) => {
    await mieter(opened)
    const vorRegeln: PeriodRules = { startMonth: 1, changes: ['2025-05', '2026-01'] }
    const leer = await wechsel(opened, vorRegeln, '2025-01', '2025-01')
    if (!leer.r || 'error' in leer.r) return assert.fail(leer.r ? leer.r.error : 'kein Objekt')
    await opened.write(async (db) => {
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-05', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp' })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-05', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' })
    })
    await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-05', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil' }, ids))
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const abzug = (await items(opened)).find((c) => c.operatingPower === 'deduction') ?? assert.fail('kein Abzug')
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
    // G-H4: Für den Abzug fragt die Vorschau kein eigenes Jahr; für den Betriebsstrom schon.
    assert.ok(preview.taxYears.some((t) => t.costItemId === bs.id), 'Betriebsstrom wird gefragt')
    assert.ok(!preview.taxYears.some((t) => t.costItemId === abzug.id), 'Abzug wird nicht gefragt')
    const taxYears = { [`${bs.id}|2025-05`]: 2026, [`${abzug.id}|2025-05`]: 2025, 'hs|2025-05': 2025, 'gas|2025-05': 2025 }
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.options[0]?.key ?? '']))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025, { understood: true, groups, taxYears, token: preview.token }, ids, TODAY))
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    verweiseStimmen(nachher)
    const nach = (id: string) => nachher.find((c) => c.id === id) ?? assert.fail(`${id} fehlt`)
    assert.equal(nach('hs').period, '2025-05')
    assert.equal(nach(abzug.id).period, '2025-05')
    assert.equal(nach(abzug.id).operatingPowerGeneralId, 'hs')
    assert.equal(nach(bs.id).taxYear, 2026)
    assert.equal(nach(abzug.id).taxYear, 2026)
  })
})

// Geld H1 (Nachprüfung fc20455): Fall des Prüfers. Nach „Mai ab 2025“ (aufgeteilt, Heizung 2025/26) folgt „Juli ab 2024“
// mit Heizung 2025-07. Der Betriebsstrom landet in 01.07.2025–30.06.2026 (möglich 2025 bis 2027), seine Abzugsteile in
// 2024/2025 (2024 bis 2026) und 2025/2026 (2025 bis 2027). Angeboten wird nur der Schnitt, 2025 und 2026; 2027 hätte
// beim Speichern 409 ergeben.
test('Geld H1: das Jahr des Betriebsstroms wird nur im Schnitt mit den Spannen seiner Abzugsteile angeboten', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const erster = await wechsel(opened, MAI_AB_2025, 'split', '2025-05')
    if (!erster.r || 'error' in erster.r) return assert.fail(erster.r ? erster.r.error : 'kein Objekt')
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const regeln: PeriodRules = { startMonth: 1, changes: ['2024-07'] }
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', regeln, TODAY))) ?? assert.fail('kein Objekt')
    const eintrag = preview.taxYears.find((t) => t.costItemId === bs.id && t.period === '2025-07') ?? assert.fail('Betriebsstrom nicht gefragt')
    assert.deepEqual(eintrag.options, [2025, 2026])
    assert.ok(eintrag.options.includes(eintrag.suggested))
    // Mit 2026 wird gespeichert, und alle Teile der Abzüge tragen 2026.
    const { r } = await wechsel(opened, regeln, '2025-07', '2025-07', { [`${bs.id}|2025-07`]: 2026 })
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const teile = (await items(opened)).filter((c) => c.operatingPower === 'deduction')
    assert.deepEqual(teile.map((d) => d.taxYear), [2026, 2026, 2026, 2026])
  })
})

// Geld H1, leerer Schnitt: Zeitraum 2025/2026 (Mai bis April) mit Hausstrom, Betriebsstrom und Abzug im Jahr der Zahlung
// 2026. Der Wechsel auf „Januar ab 2026“ und „Februar ab 2026“ zerlegt ihn in 05–12/2025 (nur 2025), 01/2026 und
// 02/2026–01/2027 (2026 bis 2028). Der Teil des Abzugs im letzten Zeitraum folgt dem Betriebsstrom; legte man die
// Heizkosten nach 05–12/2025, stünde der Betriebsstrom fest in 2025, außerhalb der Spanne. Die Vorschau sagt das an
// diesem Ziel vorher; wer es trotzdem wählt, bekommt 409 und es wird nichts geschrieben.
test('Geld H1: ein Ziel ohne passendes Jahr nennt die Vorschau vorher; gewählt ergibt es 409', async () => {
  await withDatabase(async (opened) => {
    await mieter(opened)
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-05', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp', taxYear: 2026 })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-05', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units', serviceFrom: '2025-05-01', serviceTo: '2026-04-30', taxYear: 2026 })
    })
    await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-05', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil' }, ids))
    const regeln: PeriodRules = { startMonth: 5, changes: ['2026-01', '2026-02'] }
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', regeln, TODAY))) ?? assert.fail('kein Objekt')
    const heizung = preview.groups.find((g) => g.heating) ?? assert.fail('keine Heizgruppe')
    const hinweis = heizung.taxShifts.find((t) => t.key === '2025-05') ?? assert.fail(`kein Hinweis am Ziel 05–12/2025: ${JSON.stringify(heizung.taxShifts)}`)
    assert.match(hinweis.text, /stünde „Betriebsstrom Heizung \(selbst geschätzt\)“ im Jahr der Zahlung 2025; sein Abzug .* folgt ihm, dort ist aber nur 2026 bis 2028 möglich\. So lässt sich der Wechsel nicht speichern/)
    const vorher = await items(opened)
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.heating ? '2025-05' : 'split']))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', regeln, { understood: true, groups, taxYears: {}, token: preview.token }, ids, TODAY))
    if (!r || !('error' in r)) return assert.fail('angenommen')
    assert.match(r.error, /folgt dem Betriebsstrom/)
    assert.deepEqual(await items(opened), vorher)
  })
})

// G-H4 beim Aufteilen: Der Teil des Abzugs in 2025/26 (über zwei Kalenderjahre) nimmt das Jahr, das der Betriebsstrom
// dort bekommt, auch wenn die Antwort für den Abzug etwas anderes sagt.
test('G-H4: aufgeteilter Abzug: der Teil über zwei Kalenderjahre nimmt das Jahr des Betriebsstroms', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const abzug = (await items(opened)).find((c) => c.operatingPower === 'deduction') ?? assert.fail('kein Abzug')
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
    assert.ok(!preview.taxYears.some((t) => t.costItemId === abzug.id), 'Abzug wird nicht gefragt')
    const { r } = await wechsel(opened, MAI_AB_2025, 'split', '2025-05', { [`${bs.id}|2025-05`]: 2026, [`${abzug.id}|2025-05`]: 2025 })
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.equal(nachher.find((c) => c.id === bs.id)?.taxYear, 2026)
    const teil = nachher.find((c) => c.operatingPower === 'deduction' && c.period === '2025-05') ?? assert.fail('kein Teil in 2025/26')
    assert.equal(teil.taxYear, 2026)
  })
})
