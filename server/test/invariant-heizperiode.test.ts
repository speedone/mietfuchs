// Invarianten 4 und 11 (Heizung PR 5, Entwurf 12.3) über zufällige Abläufe in der Datenbank: Weg d
// ein- und ausschalten, Abrechnungen P und Heizkostenabrechnungen abschließen, in jeder Reihenfolge,
// die die Routinen zulassen. Fester Startwert, also reproduzierbar.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { closeSettlement, createEntity } from '../src/db/repository.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { applySeparate, previewSeparate } from '../src/db/separateSettlement.ts'
import { closeHeatingSettlement } from '../src/db/heatingSettlements.ts'
import { readStock, type Stock } from '../src/db/read.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { computeSettlement, rentLedger } from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor } from '../src/snapshot.ts'
import { plantRules, settledSeparately } from '../../shared/heatingPeriod.ts'
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
  const opened: OpenedDatabase = await openDatabase({ dataDir })
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
