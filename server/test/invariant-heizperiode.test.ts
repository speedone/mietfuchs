// Invarianten 4 und 11 (Heizung PR 5, Entwurf 12.3) über zufällige Abläufe in der Datenbank: Weg d
// ein- und ausschalten, Abrechnungen P und Heizkostenabrechnungen abschließen, in jeder Reihenfolge,
// die die Routinen zulassen. Fester Startwert, also reproduzierbar.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { OpenedDatabase } from '../src/db/open.ts'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { closeSettlement, createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { applySeparate, previewSeparate } from '../src/db/separateSettlement.ts'
import { closeHeatingSettlement } from '../src/db/heatingSettlements.ts'
import { readStock, type Stock } from '../src/db/read.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { computeSettlement, rentLedger } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { captureOf, plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodContaining, periodKey, periodsBetween } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'

const TODAY = '2026-10-05'
const MAI = { startMonth: 5, changes: [] }
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028]

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r: () => number, n: number): number => Math.floor(r() * n)

// Was eine eingefrorene oder gerechnete Abrechnung für t1 anrechnet, und welche Heizperioden sie
// nach Weg b enthält. Gelesen wird das Archivstück, ohne Behauptung über seinen Typ.
const field = (o: unknown, key: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined)
const creditOf = (settlement: unknown): number => {
  const list = field(settlement, 'statements')
  if (!Array.isArray(list)) return 0
  return list.reduce((a: number, s: unknown) => (field(s, 'tenancyId') === 't1' && typeof field(s, 'prepaymentCents') === 'number' ? a + Number(field(s, 'prepaymentCents')) : a), 0)
}
const heatingKeysOf = (settlement: unknown): string[] => {
  const list = field(settlement, 'heatingPeriods')
  return Array.isArray(list) ? list.map((h: unknown) => String(field(field(h, 'period'), 'key'))) : []
}

async function scenario(seed: number): Promise<void> {
  const r = rng(seed)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `mietfuchs-invariante-${seed}-`))
  const opened: OpenedDatabase = await openFreshDatabase(dataDir)
  try {
    const startMonth = `${2023 + pick(r, 2)}-${String(1 + pick(r, 6)).padStart(2, '0')}`
    // Ein offenes Mietverhältnis endet hier mit der letzten Heizperiode, die ganz in YEARS liegt: Sonst
    // rechnete die Heizkostenabrechnung 2028/2029 Monate von 2029 an, die das Mietkonto über YEARS
    // nicht führt, und die Summen wichen um den Rand ab, nicht wegen eines Fehlers.
    const end = ['2028-04-30', '2026-03-31', '2026-10-31', '2027-06-30'][pick(r, 4)] ?? null
    const base = 25000 + pick(r, 40) * 250
    const prepayments = [{ from: startMonth, monthlyCents: base }, ...(r() < 0.6 ? [{ from: ['2025-07', '2026-03'][pick(r, 2)] ?? '2025-07', monthlyCents: base + 2000 }] : [])]
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: `${startMonth}-01`, end, prepayments })
      await createHeatingPlant(db, 'hp1', 'objekt-1', { energy: 'gas', method: 'service' })
      await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp1'))
      for (const y of YEARS) {
        await createEntity(db, 'costItems', `gs${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: 'Grundsteuer', description: `Grundsteuer ${y}`, amountCents: 60000, key: 'area' })
        await createEntity(db, 'costItems', `h${y - 1}`, {
          propertyId: 'objekt-1', period: `${y - 1}-05`, category: HEATING_CATEGORY, description: `Heizung ${y - 1}/${y}`, amountCents: 120000, key: 'area',
          heatingPlantId: 'hp1', taxYear: y,
        })
      }
    })
    const closedP = new Set<string>()
    const closeP = async (key: string): Promise<void> => {
      const stock = await opened.read(readStock)
      const settlement = computeSettlement(snapshotFor(stock, 'objekt-1', periodContaining(CALENDAR_RULES, `${key}-01`)))
      await opened.write((db) => closeSettlement(db, { id: `p${key}`, propertyId: 'objekt-1', period: periodKey(key), closedAt: '2027-01-01', sentAt: null, settlement }))
      closedP.add(key)
    }
    if (r() < 0.5) await closeP('2024-01')
    const earliest = closedP.has('2024-01') ? '2025-01' : '2023-01'
    const choices = ['2024-05', '2025-01', '2025-05', '2025-09', '2026-01'].filter((m) => m >= earliest)
    const x = choices[pick(r, choices.length)] ?? '2026-01'
    const vorschau = await opened.read((db) => previewSeparate(db, 'hp1', { separate: true, month: x }, TODAY)) ?? assert.fail('keine Anlage')
    assert.deepEqual(vorschau.blocked, [], `Fall ${seed}: Einschalten ab ${x}`)
    const steps = Object.fromEntries(vorschau.steps.map((s) => [s.tenancyId, Object.fromEntries(s.rows.map((row) => [row.from, row.heatingCents]))]))
    const ein = await opened.write((db) => applySeparate(db, 'hp1', { separate: true, month: x, answers: { steps, token: vorschau.token, understood: true } }, TODAY))
    assert.ok(ein && 'plant' in ein, `Fall ${seed}: eingeschaltet`)
    if (r() < 0.5 && !closedP.has('2025-01')) await closeP('2025-01')
    if (r() < 0.4) {
      const stock = await opened.read(readStock)
      const h = periodContaining(MAI, `${x}-01`)
      const snap = heatingSnapshotFor(stock, 'objekt-1', 'hp1', h) ?? assert.fail('keine Anlage')
      await opened.write((db) => closeHeatingSettlement(db, { id: `h${h.key}`, plantId: 'hp1', period: h.key, closedAt: '2027-01-01', sentAt: null, settlement: computeSettlement(snap) }))
    }
    if (r() < 0.6) {
      const merge = r() < 0.5
      const ausVorschau = await opened.read((db) => previewSeparate(db, 'hp1', { separate: false }, TODAY)) ?? assert.fail('keine Anlage')
      const aus = await opened.write((db) => applySeparate(db, 'hp1', { separate: false, answers: { merge, token: ausVorschau.token, understood: true } }, TODAY))
      assert.ok(aus && 'plant' in aus, `Fall ${seed}: ausgeschaltet`)
    }
    if (r() < 0.5 && !closedP.has('2026-01')) await closeP('2026-01')

    const stock: Stock = await opened.read(readStock)
    const plant = stock.heatingPlants.find((p) => p.id === 'hp1') ?? assert.fail('keine Anlage')
    const rules = plantRules(plant, CALENDAR_RULES)
    const settlements = new Map(YEARS.map((y) => {
      const frozen = stock.closedSettlements.find((c) => c.period === `${y}-01`)
      return [y, frozen ? field(frozen, 'settlement') : computeSettlement(snapshotFor(stock, 'objekt-1', calendarYearPeriod(y)))]
    }))
    let credited = [...settlements.values()].reduce((a: number, s) => a + creditOf(s), 0)
    for (const h of periodsBetween(rules, '2022-05-01', '2028-12-31')) {
      if (!settledSeparately(plant, CALENDAR_RULES, h)) continue
      const frozen = stock.closedHeatingSettlements.find((c) => c.period === h.key)
      const snap = heatingSnapshotFor(stock, 'objekt-1', 'hp1', h) ?? assert.fail('keine Anlage')
      credited += creditOf(frozen ? field(frozen, 'settlement') : computeSettlement(snap))
    }
    // Invariante 11: Jeder Monat beider Staffeln wird genau einmal angerechnet.
    const ledger = YEARS.reduce((a, y) => a + rentLedger(snapshotFor(stock, 'objekt-1', calendarYearPeriod(y))).rows
      .filter((row) => row.tenancyId === 't1')
      .reduce((b, row) => b + row.prepaymentYearCents + (row.heatingPrepaymentYearCents ?? 0), 0), 0)
    assert.equal(credited, ledger, `Fall ${seed}: X ${x}, abgeschlossen ${[...closedP].join(', ')}, Spannen ${JSON.stringify(plant.separateSpans)}`)
    // Invariante 4: Jede Heizperiode mit Heizkosten steht in genau einer Abrechnung.
    for (const h of periodsBetween(rules, '2022-05-01', '2027-12-31')) {
      const inP = [...settlements.values()].filter((s) => heatingKeysOf(s).includes(h.key)).length
      const getrennt = settledSeparately(plant, CALENDAR_RULES, h) ? 1 : 0
      assert.equal(inP + getrennt, 1, `Fall ${seed}: Heizperiode ${h.key}`)
    }
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('Invarianten 4 und 11: zufällige Abläufe mit Ein- und Ausschalten und Abschlüssen (Entwurf 12.3)', async () => {
  for (let seed = 1; seed <= 16; seed++) await scenario(seed)
})

// #690, Durchsicht S4: „Erfassung ändern“ (`captureOnly`) in zufälligen Abläufen mit Abschlüssen. Nach jedem Schritt
// bleiben Heizperioden vor der gewählten und jede abgeschlossene Abrechnung centgleich; wird gleich danach zurückgewechselt,
// rechnet jedes Jahr wie vor dem Schritt. Eine Ablehnung (abgeschlossen, frühere Spanne) ändert nichts.
const CAPTURES = ['heatMeter', 'hca', 'serviceValues'] as const
const SELF_YEARS = [2024, 2025, 2026, 2027]
const money = (s: ReturnType<typeof computeSettlement>) => JSON.stringify({
  mieter: s.statements.map((st) => [st.tenancyId, st.totalShareCents, st.balanceCents]),
  vermieter: s.landlord.rows.map((row) => [row.costItemId, row.shareCents]),
})
async function captureScenario(seed: number): Promise<{ switched: number; reverted: number; changed: number }> {
  const r = rng(seed * 7919)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `mietfuchs-erfassung-${seed}-`))
  const opened: OpenedDatabase = await openFreshDatabase(dataDir)
  let ids = 0
  const newId = () => `e${seed}-${++ids}`
  try {
    await opened.write(async (db) => {
      for (const [u, area] of [['a', 60], ['b', 80], ['c', 50]] as const) {
        await createEntity(db, 'units', u, { propertyId: 'objekt-1', name: u.toUpperCase(), areaM2: area, participates: true })
        await createEntity(db, 'tenancies', `t${u}`, { unitId: u, tenantName: u, persons: 1, start: '2020-01-01', prepayments: [{ from: '2020-01', monthlyCents: 15000 }] })
      }
      await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
    })
    const first = CAPTURES[pick(r, 3)] ?? 'hca'
    await opened.write((db) => setUpSelf(db, 'hp', { period: '2024-01', heatConsumptionPct: 70, waterConsumptionPct: null, insulationRule: 'notApplies', hotWater: 'none', capture: first, dhwHeatMeter: false, totalHeatMeter: false }, '2027-02-01', newId))
    await opened.write(async (db) => {
      for (const y of SELF_YEARS) {
        await createEntity(db, 'costItems', `gas${y}`, { propertyId: 'objekt-1', period: `${y}-01`, category: HEATING_CATEGORY, description: `Gas ${y}`, amountCents: 300000 + pick(r, 50) * 1000, key: 'heatingSystem', heatingPlantId: 'hp', heatingPart: 'fuel', heatingTarget: 'heating' })
      }
      for (const [u, type] of [['a', 'hkv'], ['b', 'hkv'], ['c', 'hkv'], ['a', 'waerme'], ['b', 'waerme'], ['c', 'waerme']] as const) {
        const id = `${type}-${u}`
        if (type === 'hkv') await createEntity(db, 'meters', id, { propertyId: 'objekt-1', unitId: u, name: id, type, unit: 'Einheiten', hcaScale: 'product' })
        else if (!(await readStock(db)).meters.some((m) => m.unitId === u && m.type === 'waerme')) await createEntity(db, 'meters', id, { propertyId: 'objekt-1', unitId: u, name: id, type, unit: 'kWh' })
        let value = 0
        for (const y of [2023, ...SELF_YEARS]) {
          await createEntity(db, 'readings', `${id}-${y}`, { meterId: (await readStock(db)).meters.find((m) => m.unitId === u && m.type === type)?.id ?? id, date: `${y}-12-31`, value })
          value += 100 + pick(r, 900)
        }
      }
    })
    const closed = new Set<string>()
    const count = { switched: 0, reverted: 0, changed: 0 }
    const settlementOf = async (y: number) => money(computeSettlement(snapshotFor(await opened.read(readStock), 'objekt-1', calendarYearPeriod(y))))
    const all = async () => Object.fromEntries(await Promise.all(SELF_YEARS.map(async (y) => [y, await settlementOf(y)] as const)))
    for (let step = 0; step < 5; step++) {
      if (r() < 0.25) {
        const y = SELF_YEARS.find((x) => !closed.has(`${x}-01`)) ?? 2027
        if (!closed.has(`${y}-01`)) {
          const stock = await opened.read(readStock)
          await opened.write((db) => closeSettlement(db, { id: `p${y}`, propertyId: 'objekt-1', period: periodKey(`${y}-01`), closedAt: '2027-03-01', sentAt: null, settlement: computeSettlement(snapshotFor(stock, 'objekt-1', calendarYearPeriod(y))) }))
          closed.add(`${y}-01`)
        }
        continue
      }
      const y = SELF_YEARS[pick(r, SELF_YEARS.length)] ?? 2026
      const capture = CAPTURES[pick(r, 3)] ?? 'serviceValues'
      const vorher = await all()
      const plantBefore = (await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp') ?? assert.fail('keine Anlage')
      const back = captureOf(plantBefore, `${y}-01`)
      const ok = await opened.write((db) => setUpSelf(db, 'hp', { period: `${y}-01`, capture, captureOnly: true, confirmCapture: true }, '2027-02-01', newId)).then(() => true, () => false)
      const nachher = await all()
      if (ok) count.switched++
      if (SELF_YEARS.some((x) => nachher[x] !== vorher[x])) count.changed++
      for (const x of SELF_YEARS) {
        if (!ok || x < y || closed.has(`${x}-01`)) assert.equal(nachher[x], vorher[x], `Fall ${seed}, Schritt ${step}: ${capture} ab ${y}${ok ? '' : ' (abgelehnt)'}, Jahr ${x}`)
      }
      if (ok && r() < 0.5) {
        await opened.write((db) => setUpSelf(db, 'hp', { period: `${y}-01`, capture: back, captureOnly: true, confirmCapture: true }, '2027-02-01', newId))
        assert.deepEqual(await all(), vorher, `Fall ${seed}, Schritt ${step}: zurück zu ${back} ab ${y}`)
        count.reverted++
        assert.deepEqual((await opened.read(readStock)).heatingPlants.find((p) => p.id === 'hp')?.selfSpans, plantBefore.selfSpans, `Fall ${seed}, Schritt ${step}: Spannen`)
      }
    }
    return count
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('#690: „Erfassung ändern“ in zufälligen Abläufen: frühere und abgeschlossene Heizperioden centgleich, zurück wie vorher', async () => {
  const total = { switched: 0, reverted: 0, changed: 0 }
  for (let seed = 1; seed <= 12; seed++) {
    const c = await captureScenario(seed)
    total.switched += c.switched
    total.reverted += c.reverted
    total.changed += c.changed
  }
  // Die Abläufe wechseln wirklich, wechseln zurück und bewegen Geld; sonst prüften sie nichts.
  assert.ok(total.switched >= 10 && total.reverted >= 5 && total.changed >= 5, JSON.stringify(total))
})
