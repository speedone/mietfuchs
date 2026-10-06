// Jede Lieferung genau einmal verbraucht, auch mit Vorrat (Heizung PR 8, Entwurf 8.2, 12.3 Nr. 1 und 5;
// Erweiterung der Invariante aus fuel-invariant.test.ts um Anfangs- und Endbestand).
//
// Der Generator geht über die **echten Schreibwege** (db/fuel.ts, db/fuelStock.ts, repository.ts,
// Abschluss wie in index.ts) und bildet keine Sperre nach: Was die Anwendung mit 400 oder 409 ablehnt,
// wird übersprungen. Vorgänge: Lieferung samt Rechnung, Betrag einer Rechnung ändern (auch nach dem
// Abschluss der Folgeperiode), Endbestand eintragen oder ändern, Peildatum ändern, abschließen, wieder
// öffnen, in wechselnder Reihenfolge, auch die Folgeperiode vor ihrer Vorperiode.
//
// Geprüft wird über alle Heizperioden, abgeschlossene mit ihrem eingefrorenen Stand:
//   (i)   je Abrechnung Σ Mieterzeilen + Σ Vermieterzeilen = Σ Positionen (durch den Aufbau);
//   (ii)  je Abrechnung mit Bestandsrechnung und Übertrag: die Heizkosten aller Zeilen ohne die
//         Gegenzeile sind Positionen + Anfangsbestand − Endbestand, also der Verbrauch;
//   (iii) je Paar aufeinanderfolgender Heizperioden mit Bestandsrechnung, deren zweite den Anfangsbestand
//         übernommen hat: Ihr Anfangsbestand ist der Endbestand der ersten, in Menge, Betrag, kg und
//         CO₂-Kosten. Nur dann ist über die Heizperioden jede Lieferung genau einmal verbraucht:
//         Σ Verbrauch = erster Anfangsbestand + Σ Lieferungen − letzter Endbestand.
// Die Mutationsprobe (06.10.2026): Ohne die Regel, dass der übernommene Anfangsbestand einer
// abgeschlossenen Folgeperiode der Endbestand ist (`nextFrozenOpening` in fuelStock.ts), wird (iii) rot,
// unter den Startwerten 1 bis 40 bei 6, 14 und 30 (Betrag einer Rechnung geändert, nachdem die
// Folgeperiode den Endbestand übernommen hatte). Mit INV_FROM/INV_TO ein Bereich, z. B. INV_TO=60.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeSettlement } from '../src/calc.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { createDelivery, unfreezeFuelCarries } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelDeliveries, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, findClosedSettlement, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { HeatingStockStatement } from '../../shared/types.ts'

function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const rejected = (err: unknown): boolean => {
  const status: unknown = err !== null && typeof err === 'object' ? Reflect.get(err, 'status') : undefined
  return status === 400 || status === 409
}

// Die Heizkosten aller Zeilen einer Abrechnung, auch einer eingefrorenen (JSON), ohne die Gegenzeile
// des Vorrats; dazu die Summe aller Zeilen und die Bestandsrechnung der Anlage.
function readSettlement(s: unknown): { all: number; heating: number; stock: HeatingStockStatement | null; codes: string[] } {
  const list = (o: unknown, key: string): unknown[] => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return Array.isArray(v) ? v : []
  }
  const num = (o: unknown, key: string): number => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return typeof v === 'number' ? v : 0
  }
  const str = (o: unknown, key: string): string => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return typeof v === 'string' ? v : ''
  }
  const tenantRows = list(s, 'statements').flatMap((st) => list(st, 'rows'))
  const landlordRows = list(Reflect.get(Object(s), 'landlord'), 'rows')
  const counter = (r: unknown) => /^stock:[^:]+:[^:]+$/.test(str(r, 'costItemId'))
  const heating = [...tenantRows, ...landlordRows].filter((r) => str(r, 'category') === HEATING_CATEGORY && !counter(r)).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  const all = list(s, 'statements').reduce<number>((a, st) => a + num(st, 'totalShareCents'), 0) + num(Reflect.get(Object(s), 'landlord'), 'totalCents')
  const heatingList = list(s, 'heating')
  const stock: unknown = heatingList.length > 0 ? Reflect.get(Object(heatingList[0]), 'stock') : null
  const codes = list(s, 'notices').map((x) => str(x, 'code'))
  return { all, heating, stock: stock !== null && typeof stock === 'object' ? (stock as HeatingStockStatement) : null, codes }
}

const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 12) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 30]
const STEPS = Number(process.env.INV_STEPS ?? 40)
const YEARS = [2023, 2024, 2025, 2026]

for (const seed of SEEDS) {
  test(`Invariante Vorrat (Startwert ${seed}): jede Lieferung über alle Heizperioden genau einmal verbraucht`, async () => {
    const rnd = zufall(seed * 31 + 5)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-stock-inv-'))
    const opened = await openDatabase({ dataDir })
    try {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
        await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
        await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
        await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
        await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
      })
      const opening = { stockUnit: 'l', openingQuantity: int(0, 3000), openingCostCents: int(0, 300000), openingEmissionsKg: int(0, 8000), openingCo2Cents: 0, openingInvoicedBefore2023: true }
      await opened.write((db) => saveStock(db, 'hp', '2023-01', opening))
      const log: string[] = []
      const attempt = async (what: string, run: () => Promise<unknown>) => {
        try {
          await run()
          log.push(what)
        } catch (err) {
          if (!rejected(err)) throw err
        }
      }
      // Die Positionen je abgeschlossenem Zeitraum beim Abschluss: Eine Position eines abgeschlossenen
      // Zeitraums lässt sich ändern, der eingefrorene Stand nicht.
      const atClose = new Map<string, number>()
      const positionsIn = async (key: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key).reduce((a, c) => a + c.amountCents, 0)
      const periodOf = (key: string) => periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
      let n = 0
      for (let step = 0; step < STEPS; step++) {
        const op = pick(['deliver', 'deliver', 'amount', 'amount', 'closing', 'closing', 'measured', 'close', 'close', 'reopen'] as const)
        const year = pick(YEARS) ?? 2023
        const key = `${year}-01`
        if (op === 'deliver') {
          const id = `d${n++}`
          const q = int(500, 3000)
          const date = `${year}-${String(int(1, 12)).padStart(2, '0')}-15`
          await attempt(`deliver ${id} ${date} ${q}`, async () => {
            await opened.write((db) => createDelivery(db, id, 'hp', { label: id, deliveredAt: date, invoiceDate: date, quantity: q, quantityUnit: 'l', emissionsKg: Math.round(q * 267.6) / 100, co2CostCents: int(1000, 60000) }))
            await opened.write((db) => createEntity(db, 'costItems', `c${id}`, {
              propertyId: 'objekt-1', period: key, category: HEATING_CATEGORY, description: id, amountCents: q * int(80, 130), key: rnd() < 0.5 ? 'area' : 'units',
              heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId: id, taxYear: year,
            }))
          })
        } else if (op === 'amount') {
          const c = pick((await opened.read((db) => readCostItems(db))).filter((x) => x.fuelDeliveryId))
          if (!c) continue
          const amountCents = int(50000, 400000)
          await attempt(`amount ${c.id}=${amountCents}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { amountCents })))
        } else if (op === 'closing' || op === 'measured') {
          const [view] = await opened.read((db) => heatingPeriodViews(db, 'hp', String(year))) ?? []
          const before = view?.stock?.derived?.value.quantity ?? view?.stock?.row.openingQuantity ?? 0
          const delivered = (await opened.read((db) => readFuelDeliveries(db))).filter((d) => d.deliveredAt?.startsWith(String(year))).reduce((a, d) => a + (d.quantity ?? 0), 0)
          const body = op === 'closing'
            ? { stockUnit: 'l', closingQuantity: int(0, Math.floor(before + delivered)) }
            : { closingMeasuredOn: `${year}-12-${String(int(20, 31)).padStart(2, '0')}` }
          await attempt(`${op} ${key} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, 'hp', key, body)))
        } else if (op === 'close') {
          const here = await positionsIn(key)
          await attempt(`close ${key}`, () => opened.write(async (db) => {
            if (await findClosedSettlement(db, 'objekt-1', periodKey(key))) return
            await db.transaction(async (tx) => {
              const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
              await closeSettlement(tx, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(key), closedAt: '2027-01-01', sentAt: null, settlement })
            })
            atClose.set(key, here)
          }))
        } else {
          await attempt(`reopen ${key}`, async () => {
            if (await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(key), `h${n++}`, unfreezeFuelCarries))) atClose.delete(key)
          })
        }
      }
      const fall = `Startwert ${seed}: ${JSON.stringify(opening)} ${log.join(', ')}`
      const stock = await opened.read((db) => readStock(db))
      const closed = await opened.read((db) => readClosedSettlements(db))
      const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
      const read = YEARS.map((y) => {
        const key = `${y}-01`
        const stored = closed.find((c) => c.period === key)
        const s = stored ? stored.settlement : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(key)), {})
        const positions = stored ? (atClose.get(key) ?? assert.fail(`${fall}; ${key} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === key).reduce((a, c) => a + c.amountCents, 0)
        return { key, positions, ...readSettlement(s) }
      })
      for (const r of read) {
        // (i) durch den Aufbau
        assert.equal(r.all, r.positions, `${fall}; (i) ${r.key}`)
        // (ii) Verbrauch = Positionen + Anfangsbestand − Endbestand; ohne Schlüssel für den Übertrag sagt
        // die Abrechnung, dass sie nach Lieferung verteilt (`fuel.manual-by-delivery`).
        if (r.stock && !r.codes.includes('fuel.manual-by-delivery')) assert.equal(r.heating, r.positions + (r.stock.opening.costCents ?? 0) - (r.stock.closing.costCents ?? 0), `${fall}; (ii) ${r.key}`)
      }
      // (iii) Übergabe zwischen aufeinanderfolgenden Heizperioden
      for (let i = 1; i < read.length; i++) {
        const a = read[i - 1]
        const b = read[i]
        if (!a?.stock || !b?.stock || b.stock.openingSource === 'own') continue
        assert.deepEqual(
          [b.stock.opening.quantity, b.stock.opening.costCents, b.stock.opening.emissionsKg, b.stock.opening.co2Cents],
          [a.stock.closing.quantity, a.stock.closing.costCents, a.stock.closing.emissionsKg, a.stock.closing.co2Cents],
          `${fall}; (iii) ${a.key} → ${b.key}`,
        )
      }
    } finally {
      opened.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
}
