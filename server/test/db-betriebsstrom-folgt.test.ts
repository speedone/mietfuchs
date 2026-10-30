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
import { computeSettlement, taxReportFor } from '../src/calc.ts'
import { storedOutflowYear } from '../src/outflow.ts'
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

// #267 (#255, PR 2): Ein Abzug trägt kein eigenes Jahr der Zahlung; sein Steuerjahr ist das seiner Stromrechnung, abgeleitet
// über `outflowShares` (outflow.ts). Gelesen wird es, wie die Steuerübersicht es liest: aus der Auskunft je Abzug im
// Schnappschuss seines Zeitraums. Dazu: Jeder Abzug steht im Steuerjahr seiner Rechnung.
async function abzugsjahreStimmen(opened: OpenedDatabase): Promise<Record<string, number>> {
  const stock = await opened.read((db) => readStock(db))
  const rules = rulesOf(stock.properties.find((p) => p.id === 'objekt-1'))
  const out: Record<string, number> = {}
  for (const d of stock.costItems.filter((c) => c.operatingPower === 'deduction')) {
    assert.equal(d.taxYear, undefined, `${d.id}: Abzug mit eigenem Jahr der Zahlung`)
    const g = stock.costItems.find((c) => c.id === d.operatingPowerGeneralId) ?? assert.fail(`${d.id}: keine Rechnung`)
    const p = periodOfKey(rules, d.period) ?? assert.fail(`${d.id}: kein Zeitraum`)
    const info = snapshotFor(stock, 'objekt-1', p).operatingPowerDeductions?.find((x) => x.id === d.id) ?? assert.fail(`${d.id}: keine Auskunft`)
    assert.equal(info.taxYear, g.taxYear ?? Number(p.from.slice(0, 4)), `${d.id}: anderes Steuerjahr als die Rechnung ${g.id}`)
    out[d.id] = info.taxYear
  }
  return out
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
    // #455: Der bewegte Anteil (16.712) kommt zum stehenden Teil des Rumpfs (32.877), eine Zeile je Zeitraum.
    assert.deepEqual(strom.filter((c) => c.operatingPower === undefined).map((c) => [c.period, c.amountCents]).sort(), [['2025-01', 49589], ['2025-07', 50411]])
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
// ---------- #267: Das Steuerjahr eines Abzugs ist das seiner Stromrechnung (vorher G-H4: das seiner Betriebsstrom-Position) ----------
test('G-H3/#267: wachsender Zeitraum: Rechnung und Abzug bleiben zusammen, der Abzug wird nicht gefragt und steht im Jahr seiner Stromrechnung', async () => {
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
    // Für den Abzug fragt die Vorschau kein eigenes Jahr; für den Betriebsstrom schon.
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
    // Bis #267 nahm der Abzug das Jahr des Betriebsstroms (2026); bezahlt war die Stromrechnung aber 2025.
    assert.deepEqual(await abzugsjahreStimmen(opened), { [abzug.id]: 2025 })
  })
})

// Geld H1 (Nachprüfung 10ee3c0): Fall des Prüfers. Nach „Mai ab 2025“ (aufgeteilt, Heizung 2025/26) folgt „Juli ab 2024“
// mit Heizung 2025-07. Der Betriebsstrom landet in 01.07.2025–30.06.2026 (möglich 2025 bis 2027), seine Abzugsteile in
// 2024/2025 und 2025/2026. Bis #267 folgten die Abzugsteile dem Betriebsstrom, deshalb bot die Vorschau nur den Schnitt
// der Spannen an (2025 und 2026). Seit #267 folgen sie ihrer Stromrechnung: Der Betriebsstrom hat seine ganze Spanne.
test('Geld H1/#267: das Jahr des Betriebsstroms hat seine ganze Spanne, die Abzugsteile folgen ihrer Stromrechnung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const erster = await wechsel(opened, MAI_AB_2025, 'split', '2025-05')
    if (!erster.r || 'error' in erster.r) return assert.fail(erster.r ? erster.r.error : 'kein Objekt')
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const regeln: PeriodRules = { startMonth: 1, changes: ['2024-07'] }
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', regeln, TODAY))) ?? assert.fail('kein Objekt')
    const eintrag = preview.taxYears.find((t) => t.costItemId === bs.id && t.period === '2025-07') ?? assert.fail('Betriebsstrom nicht gefragt')
    assert.deepEqual(eintrag.options, [2025, 2026, 2027])
    assert.ok(eintrag.options.includes(eintrag.suggested))
    // Mit 2027 (bis #267 abgelehnt) wird gespeichert; kein Teil eines Abzugs trägt ein eigenes Jahr.
    const antworten = Object.fromEntries(preview.taxYears.map((t) => [t.key, t.suggested]))
    const { r } = await wechsel(opened, regeln, '2025-07', '2025-07', { ...antworten, [`${bs.id}|2025-07`]: 2027 })
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.equal(nachher.find((c) => c.id === bs.id)?.taxYear, 2027)
    verweiseStimmen(nachher)
    assert.equal(Object.keys(await abzugsjahreStimmen(opened)).length, 4)
  })
})

// Geld H1, leerer Schnitt (T6c zu #267): Zeitraum 2025/2026 (Mai bis April) mit Hausstrom, Betriebsstrom und Abzug im
// Jahr der Zahlung 2026. Der Wechsel auf „Januar ab 2026“ und „Februar ab 2026“ zerlegt ihn in 05–12/2025 (nur 2025),
// 01/2026 und 02/2026–01/2027 (2026 bis 2028). Bis #267 folgte der Teil des Abzugs im letzten Zeitraum dem Betriebsstrom;
// legte man die Heizkosten nach 05–12/2025, stünde der Betriebsstrom fest in 2025, außerhalb der Spanne, und der Wechsel
// scheiterte mit 409 (Sperre `noYearText`, Befund K4 der Durchsicht von #268). Seit #267 folgt jeder Teil des Abzugs seiner
// Stromrechnung: Der Wechsel geht durch, und jeder Teil steht im Jahr des Teils der Rechnung in seinem Zeitraum.
test('#267 (T6c): ein Ziel, an dem bis #267 kein Jahr passte, geht durch; die Teile des Abzugs folgen ihrer Stromrechnung', async () => {
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
    assert.ok(heizung.taxShifts.every((t) => !/So lässt sich der Wechsel nicht speichern/.test(t.text)), JSON.stringify(heizung.taxShifts))
    const abzug = (await items(opened)).find((c) => c.operatingPower === 'deduction') ?? assert.fail('kein Abzug')
    assert.ok(!preview.taxYears.some((t) => t.costItemId === abzug.id), 'kein Abzug wird gefragt')
    const vorher = await items(opened)
    const groups = Object.fromEntries(preview.groups.map((g) => [g.id, g.heating ? '2025-05' : 'split']))
    const taxYears = Object.fromEntries(preview.taxYears.map((t) => [t.key, t.suggested]))
    const r = await opened.write((db) => applyPeriodChange(db, 'objekt-1', regeln, { understood: true, groups, taxYears, token: preview.token }, ids, TODAY))
    if (!r || 'error' in r) return assert.fail(r ? r.error : 'kein Objekt')
    const nachher = await items(opened)
    assert.equal(sum(nachher), sum(vorher))
    verweiseStimmen(nachher)
    const jahre = await abzugsjahreStimmen(opened)
    assert.equal(Object.keys(jahre).length, 3, JSON.stringify(jahre))
  })
})

// Geld H2, Variante (b) (Nachtrag nach Fixrunde 87a418b): Fall P1 des Prüfers. „Mai ab 2025“, Hausstrom mit
// Leistungszeitraum 2025, Heizung nach 2025/26. Der Teil des Abzugs im Rumpf (−32,88 €) liegt in einem Kalenderjahr,
// sein Jahr ist fest 2025. Bis #268 verschob sich dieser Betrag in der Anlage V, wenn der Vermieter für den
// Betriebsstrom 2026 oder 2027 wählte, und die Vorschau sagte das. Seit #268 gleicht die Steuerübersicht je Steuerjahr
// aus: Es verschiebt sich nichts, die Vorschau sagt nichts, und keine Auswahl wird begrenzt.
test('Geld H2 (#268): bei einem anderen Jahr des Betriebsstroms als dem festen Jahr des Abzugsteils kein Satz zur Verschiebung', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
    const eintrag = preview.taxYears.find((t) => t.costItemId === bs.id && t.period === '2025-05') ?? assert.fail('Betriebsstrom nicht gefragt')
    assert.deepEqual(eintrag.options, [2025, 2026, 2027])
    assert.equal(Object.hasOwn(eintrag, 'notes'), false, JSON.stringify(eintrag))
    assert.ok(preview.groups.every((g) => g.taxShifts.every((t) => !/verschiebt sich/.test(t.text))), JSON.stringify(preview.groups.map((g) => g.taxShifts)))
  })
})

// Geld K1 der zweiten Nachprüfung von #265: Mai-Objekt, Wechsel auf „Januar ab 2026“. Der Zeitraum 2025/26 zerfällt in
// 05–12/2025 (fest 2025) und 2026 (fest 2026); der Abzug folgt dem Hausstrom (Leistungszeitraum 2025/26) nach Tagen,
// −67,12 € und −32,88 €. Bleiben Betriebsstrom und Gas in 05–12/2025, ändert sich ihr Jahr nicht, die Gruppe hat dort
// also noch keinen Satz zur Steuer. Bis #268 verschob sich der Teil des Abzugs in 2026 (32,88 €) trotzdem, und das stand
// am Ziel 2025-05. Seit #268 verschiebt sich nichts mehr (Ausgleich je Steuerjahr); am Ziel 2025-05 steht kein Satz.
test('Geld K1 (#268): an einem Ziel, an dem sonst kein Steuerjahr wechselt, kein Satz zur Verschiebung', async () => {
  await withDatabase(async (opened) => {
    await mieter(opened)
    await opened.write(async (db) => {
      await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
      await createEntity(db, 'costItems', 'gas', { propertyId: 'objekt-1', period: '2025-05', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, key: 'area', heatingPart: 'fuel', heatingPlantId: 'hp', taxYear: 2025 })
      await createEntity(db, 'costItems', 'hs', { propertyId: 'objekt-1', period: '2025-05', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units', serviceFrom: '2025-05-01', serviceTo: '2026-04-30', taxYear: 2025 })
    })
    await opened.write((db) => bookOperatingPower(db, 'hp', { period: '2025-05', generalItemId: 'hs', ownCents: 10000, basis: 'Bruchteil' }, ids))
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', { startMonth: 5, changes: ['2026-01'] }, TODAY))) ?? assert.fail('kein Objekt')
    const heizung = preview.groups.find((g) => g.heating) ?? assert.fail('keine Heizgruppe')
    assert.deepEqual(heizung.taxShifts.map((t) => t.key).sort(), ['2026-01'])
    assert.ok(heizung.taxShifts.every((t) => !/verschiebt sich/.test(t.text)), JSON.stringify(heizung.taxShifts))
  })
})

// Beim Aufteilen (vorher G-H4): Der Teil des Abzugs in 2025/26 (über zwei Kalenderjahre) trägt kein eigenes Jahr, auch
// wenn eine Antwort für den Abzug etwas sagt, und steht im Jahr des Teils seiner Stromrechnung dort.
test('#267: aufgeteilter Abzug: der Teil über zwei Kalenderjahre steht im Jahr seiner Stromrechnung, nicht in dem des Betriebsstroms', async () => {
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
    const rechnung = nachher.find((c) => c.id === teil.operatingPowerGeneralId) ?? assert.fail('keine Rechnung')
    // Der Teil der Stromrechnung (Leistungszeitraum 2025) in 2025/26 hat das vorgeschlagene Jahr 2025.
    assert.equal(rechnung.taxYear, 2025)
    assert.equal((await abzugsjahreStimmen(opened))[teil.id], 2025)
  })
})

// T6b zu #267 (Plan zu #255, PR 2): der Prüffall aus #267 (P1 oben: „Mai ab 2025“, Hausstrom mit Leistungszeitraum 2025,
// Heizung nach 2025/26, Betriebsstrom 2026, Teil des Abzugs im Rumpf −32,88 €). Mit einer selbstgenutzten Wohnung, denn
// nur dann ist ein Teil privat. Je Steuerjahr ist der Strom (Allgemeinstrom samt Ausgleich und Betriebsstrom bei den
// Heizkosten) die in diesem Jahr bezahlte Stromrechnung und die
// Summe der Werbungskosten die Summe der in diesem Jahr bezahlten Positionen; über alle Jahre zählt jede genau einmal.
// Grün seit #268, als Absicherung.
test('#267 (T6b): Prüffall über den Zeitraumwechsel: je Steuerjahr Strom gleich der bezahlten Stromrechnung', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 30, participates: false, selfUsed: true }))
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const bs = (await items(opened)).find((c) => c.operatingPower === 'included') ?? assert.fail('kein Betriebsstrom')
    const preview = (await opened.read((db) => previewPeriodChange(db, 'objekt-1', MAI_AB_2025, TODAY))) ?? assert.fail('kein Objekt')
    const answers = Object.fromEntries(preview.taxYears.map((t) => [t.key, t.suggested]))
    const done = await opened.write(async (db) => applyPeriodChange(db, 'objekt-1', MAI_AB_2025,
      { understood: true, groups: Object.fromEntries(preview.groups.map((g) => [g.id, g.heating ? '2025-05' : 'split'])), taxYears: { ...answers, [`${bs.id}|2025-05`]: 2026 }, token: preview.token }, ids, TODAY))
    if (!done || 'error' in done) return assert.fail(done ? done.error : 'kein Objekt')
    const stock = await opened.read((db) => readStock(db))
    const all = stock.costItems
    assert.ok(all.some((c) => c.operatingPower === 'deduction' && c.amountCents === -3288), JSON.stringify(all.map((c) => [c.id, c.period, c.amountCents])))
    const paid = (year: number, only?: string) => all.filter((c) => c.operatingPower === undefined && (only === undefined || c.category === only) && storedOutflowYear(c, all) === year).reduce((a, c) => a + c.amountCents, 0)
    let total = 0
    for (const year of [2024, 2025, 2026, 2027]) {
      const t = taxReportFor(stock, 'objekt-1', year)
      const strom = t.expenses.groups.flatMap((g) => g.categories).find((c) => c.category === 'Beleuchtung/Allgemeinstrom')?.amountCents ?? 0
      // Der Strom steht teils beim Allgemeinstrom (Rechnung, Abzug, Ausgleich), teils als Betriebsstrom bei den Heizkosten.
      const heizstrom = all.filter((c) => c.operatingPower === 'included' && storedOutflowYear(c, all) === year).reduce((a, c) => a + c.amountCents, 0)
      assert.equal(strom + heizstrom, paid(year, 'Beleuchtung/Allgemeinstrom'), `${year}: Strom`)
      assert.equal(t.expenses.totalCents, paid(year), `${year}: Summe`)
      assert.equal(t.expenses.privateCents + t.expenses.deductibleCents, t.expenses.totalCents, `${year}: privat + abziehbar`)
      total += t.expenses.totalCents
    }
    assert.equal(total, all.filter((c) => c.operatingPower === undefined).reduce((a, c) => a + c.amountCents, 0))
    assert.ok(Object.keys(await abzugsjahreStimmen(opened)).length >= 2)
  })
})

// Durchsicht von PR 2 zu #455, I1: Hin und zurück. Nach „Mai ab 2025“ hat der Hausstrom zwei Teile einer Quelle
// (32.877 / 67.123), jeder mit seinem Abzug. Zurück zum Kalenderjahr kommt der Teil aus 2025/26 zum stehenden Teil des
// Rumpfs und wird gelöscht; sein Abzug zeigte dabei noch auf ihn, und das Löschen scheiterte mit 409 („Zu dieser
// Position gehört der Abzug …“). Danach steht alles wieder wie vorher: eine Stromrechnung, Abzüge zusammen −10.000, je Mieter
// dieselbe Summe wie vor dem ersten Wechsel.
test('I1 (#455): hin und zurück zum Kalenderjahr mit Abzug am geteilten Hausstrom', async () => {
  await withDatabase(async (opened) => {
    await haus(opened, { strom: { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' } })
    const soll = await jeMieter(opened, ['2025-01'])
    const vorher = await items(opened)
    const erster = await wechsel(opened, MAI_AB_2025, 'split', '2025-05')
    if (!erster.r || 'error' in erster.r) return assert.fail(erster.r ? erster.r.error : 'kein Objekt')
    verweiseStimmen(await items(opened))
    const zurueck = await wechsel(opened, { startMonth: 1, changes: [] }, '2025-01', '2025-01')
    assert.deepEqual(zurueck.preview.blocked, [])
    // Die Vorschau kündigt das Zusammenfassen an (Hausstrom und die in der kalten Gruppe geteilte Müllabfuhr).
    const merged = zurueck.preview.moves.flatMap((m) => m.parts.flatMap((p) => p.mergedInto === undefined ? [] : [p.mergedInto]))
    assert.deepEqual(merged.sort(), ['Hausstrom (anteilig 01.01.–30.04.2025)', 'Müll (anteilig 01.01.–30.04.2025)'])
    if (!zurueck.r || 'error' in zurueck.r) return assert.fail(zurueck.r ? zurueck.r.error : 'kein Objekt')
    const nachher = await items(opened)
    verweiseStimmen(nachher)
    assert.equal(sum(nachher), sum(vorher))
    const strom = nachher.filter((c) => c.category === 'Beleuchtung/Allgemeinstrom')
    assert.deepEqual(strom.filter((c) => c.operatingPower === undefined).map((c) => [c.period, c.amountCents, c.sourceId]), [['2025-01', 100000, undefined]])
    assert.equal(sum(strom.filter((c) => c.operatingPower === 'deduction')), -10000)
    assert.ok(strom.every((c) => c.period === '2025-01'))
    // Je Mieter wie vor diesem Umbau (Stand 373c37d2, dort zwei Zeilen Hausstrom 32.877 / 67.123 mit je ihrem Abzug):
    // A 4.530,00, B1 483,30, B2 986,70. Gegenüber vor dem ersten Wechsel wandert ein Cent zwischen B1 und B2, weil die
    // beiden Abzüge (−3.288, −6.712) je für sich gerundet werden; die Summe bleibt.
    const je = await jeMieter(opened, ['2025-01'])
    assert.deepEqual(je, { 'Mieter A': 453000, 'Mieter B1': 48330, 'Mieter B2': 98670 })
    assert.equal(Object.values(je).reduce((a, b) => a + b, 0), Object.values(soll).reduce((a, b) => a + b, 0))
  })
})
