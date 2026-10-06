// Jede Lieferung genau einmal verbraucht, auch mit Vorrat (Heizung PR 8, Entwurf 8.2, 12.3 Nr. 1 und 5;
// Erweiterung der Invariante aus fuel-invariant.test.ts um Anfangs- und Endbestand, mit den Generatoren
// der Durchsicht von #237 und ihrer Nachprüfung).
//
// Der Generator geht über die **echten Schreibwege** (db/fuel.ts, db/fuelStock.ts, repository.ts,
// Abschluss wie in index.ts) und bildet keine Sperre nach: Was die Anwendung mit 400 oder 409 ablehnt,
// wird übersprungen. Vorgänge: Lieferung samt Rechnung, Lieferung mit Position „laut
// Gemeinschaftsabrechnung“ (ohne Schlüssel), Betrag ändern, Verknüpfung lösen, Menge ändern, Endbestand
// und Peildatum eintragen, die Kette unterbrechen und neu eintragen („schon umgelegt“ zufällig),
// abschließen, wieder öffnen. Vor einem Abschluss und am Ende werden gelöste Positionen meist wieder
// verknüpft und fehlende Bestände nachgetragen, damit die Mehrzahl der Heizperioden gültig ist.
// INV_WAY=b rechnet mit eigener Heizperiode Mai–April (Weg b).
//
// Geprüft wird über alle Heizperioden, abgeschlossene mit ihrem eingefrorenen Stand:
//   (i)   je Abrechnung Σ Mieterzeilen + Σ Vermieterzeilen = Σ Positionen (durch den Aufbau);
//   (ii)  je Abrechnung mit Bestandsrechnung und Übertrag: Heizkosten = Positionen + Anfangs- − Endbestand;
//   (iii) je Paar, dessen zweite Heizperiode den Anfangsbestand übernommen hat: er ist, was die erste
//         weitergibt (`handover`), in Menge, Betrag, kg und CO₂-Kosten;
//   (iv′) Abweichung = Ausgang „im Vorrat“ der ersten − Eingang „aus dem Vorrat“ der zweiten (bei einem
//         eigenen Anfangsbestand der zweiten zählt ihr Eingang nicht, die Kette beginnt dort neu). Sie ist
//         0, oder sie ist positiv und genau dieser Betrag steht im passenden Hinweis
//         `fuel.stock-not-taken-over`: in der zweiten mit Bezug auf die erste, oder in der ersten mit
//         „Folgeperiode ist ohne Vorrat“.
// Ein letzter Test sichert die Abdeckung: gültige Heizperioden und geprüfte Paare nicht unter einer
// Untergrenze. Auf dem Stand vor der Durchsicht war die Invariante bei 1, 15, 19, 21, 28, 30, 31, 33
// rot; die Mutationsproben stehen im PR #237. Bereich mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement } from '../src/calc.ts'
import { heatingPeriodViews } from '../src/db/co2.ts'
import { createDelivery, unfreezeFuelCarries, updateDelivery } from '../src/db/fuel.ts'
import { saveStock } from '../src/db/fuelStock.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelDeliveries, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, findClosedSettlement, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { heatingPlants } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { CALENDAR_RULES, periodKey, periodLabel, periodOfKey } from '../../shared/period.ts'
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
const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
const list = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
const num = (o: unknown, k: string): number => { const v = g(o, k); return typeof v === 'number' ? v : 0 }
const str = (o: unknown, k: string): string => { const v = g(o, k); return typeof v === 'string' ? v : '' }
const euro = (c: number) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function readSettlement(s: unknown, hkey: string) {
  const tenantRows = list(s, 'statements').flatMap((st) => list(st, 'rows'))
  const landlordRows = list(g(s, 'landlord'), 'rows')
  const rows = [...tenantRows, ...landlordRows]
  const counter = (r: unknown) => /^stock:[^:]+:[^:]+$/.test(str(r, 'costItemId'))
  const heating = rows.filter((r) => str(r, 'category') === HEATING_CATEGORY && !counter(r)).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  const all = list(s, 'statements').reduce<number>((a, st) => a + num(st, 'totalShareCents'), 0) + num(g(s, 'landlord'), 'totalCents')
  const h = list(s, 'heating').find((x) => str(x, 'period') === hkey)
  const stock = g(h, 'stock')
  const notices = list(s, 'notices').map((x) => ({ code: str(x, 'code'), text: str(x, 'text') }))
  const carry = (suffix: string) => rows.filter((r) => new RegExp(`^stock:[^:]+:${hkey}:${suffix}$`).test(str(r, 'costItemId'))).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  return { all, heating, carryIn: carry('in'), carryOut: carry('out'), stock: stock !== null && typeof stock === 'object' ? (stock as HeatingStockStatement) : null, notices, codes: notices.map((n) => n.code) }
}

const SEEDS = Array.from({ length: Number(process.env.INV_TO ?? 40) - Number(process.env.INV_FROM ?? 1) + 1 }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
const STEPS = Number(process.env.INV_STEPS ?? 40)
const WAY = process.env.INV_WAY ?? 'a'
const YEARS = [2023, 2024, 2025, 2026]
const STATS = { periods: 0, validStock: 0, iiChecked: 0, iiDerivedValue: 0, iiiChecked: 0, mbd: 0, pairs: 0, nonzero: 0, flagged: 0, settledOpenings: 0, reown: 0, external: 0 }

for (const seed of SEEDS) {
  test(`Invariante Vorrat (Weg ${WAY}, Startwert ${seed}): jede Lieferung über alle Heizperioden genau einmal verbraucht`, async () => {
    const rnd = zufall(seed * 31 + 5)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
    const hkeyOf = (y: number) => (WAY === 'b' ? `${y}-05` : `${y}-01`)
    // Weg b: H y-05..(y+1)-04 gehört in P y+1
    const pkeyOf = (y: number) => (WAY === 'b' ? `${y + 1}-01` : `${y}-01`)
    const dateIn = (y: number) => {
      if (WAY !== 'b') return `${y}-${String(int(1, 12)).padStart(2, '0')}-15`
      const m = int(5, 16)
      return m <= 12 ? `${y}-${String(m).padStart(2, '0')}-15` : `${y + 1}-${String(m - 12).padStart(2, '0')}-15`
    }
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-stock-inv-'))
    const opened = await openDatabase({ dataDir })
    try {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
        await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
        await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
        await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
        await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
        if (WAY === 'b') await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, 'hp'))
      })
      const openingBody = () => {
        const q = int(0, 3000)
        const r0 = rnd()
        const settled = r0 < 0.25 ? true : null
        if (settled) STATS.settledOpenings++
        return { stockUnit: 'l', openingQuantity: q, openingCostCents: int(0, 300000), openingEmissionsKg: Math.round(q * 267.6) / 100, openingCo2Cents: int(0, 20000), openingInvoicedBefore2023: rnd() < 0.3, openingAlreadySettled: settled }
      }
      const opening = openingBody()
      await opened.write((db) => saveStock(db, 'hp', hkeyOf(2023), opening))
      const log: string[] = []
      const attempt = async (what: string, run: () => Promise<unknown>) => {
        try { await run(); log.push(what); return true } catch (err) { if (!rejected(err)) throw err; return false }
      }
      const atClose = new Map<string, number>()
      const positionsIn = async (key: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key).reduce((a, c) => a + c.amountCents, 0)
      const periodOf = (key: string) => periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
      const rulesOfWay = WAY === 'b' ? { startMonth: 5, changes: [] } : CALENDAR_RULES
      const complete = async (y: number) => {
        const hkey = hkeyOf(y)
        for (const c of (await opened.read((db) => readCostItems(db))).filter((x) => x.period === hkey && x.heatingPart === 'fuel' && !x.fuelDeliveryId && /^d[0-9]+$/.test(x.description))) {
          await attempt(`relink ${c.id}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: c.description })))
        }
        const views = await opened.read((db) => heatingPeriodViews(db, 'hp', pkeyOf(y).slice(0, 4))) ?? []
        const view = views.find((v) => v.period === hkey)
        if (!view?.stock || view.closed) return
        if (!view.stock.derived && view.stock.row.openingQuantity === null) {
          const body = openingBody()
          await attempt(`fillopen ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, 'hp', hkey, body)))
        }
        const v2 = (await opened.read((db) => heatingPeriodViews(db, 'hp', pkeyOf(y).slice(0, 4))) ?? []).find((v) => v.period === hkey)
        if (!v2?.stock || v2.stock.row.closingQuantity !== null) return
        const before = v2.stock.derived?.value.quantity ?? v2.stock.row.openingQuantity ?? 0
        const delivered = (await opened.read((db) => readFuelDeliveries(db))).filter((d) => d.deliveredAt !== null && periodOfDate(d.deliveredAt) === y).reduce((a, d) => a + (d.quantity ?? 0), 0)
        const body = { stockUnit: 'l', closingQuantity: int(0, Math.floor(before + delivered)) }
        await attempt(`fill ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, 'hp', hkey, body)))
      }
      let n = 0
      for (let step = 0; step < STEPS; step++) {
        const op = pick(['deliver', 'deliver', 'amount', 'amount', 'closing', 'closing', 'measured', 'close', 'close', 'reopen', 'unlink', 'quantity', 'reown', 'external'] as const)
        const year = pick(YEARS) ?? 2023
        const hkey = hkeyOf(year)
        const pkey = pkeyOf(year)
        if (op === 'deliver' || op === 'external') {
          const id = `d${n++}`
          const q = int(500, 3000)
          const date = dateIn(year)
          const amountCents = q * int(80, 130)
          const ok = await attempt(`${op} ${id} ${date} ${q}`, async () => {
            await opened.write((db) => createDelivery(db, id, 'hp', { label: id, deliveredAt: date, invoiceDate: date, quantity: q, quantityUnit: 'l', emissionsKg: Math.round(q * 267.6) / 100, co2CostCents: int(1000, 60000) }))
            await opened.write((db) => createEntity(db, 'costItems', `c${id}`, {
              propertyId: 'objekt-1', period: hkey, category: HEATING_CATEGORY, description: id, amountCents,
              ...(op === 'external' ? { key: 'external', externalBasis: { measure: 'area', total: 100, totalCents: amountCents } } : { key: rnd() < 0.5 ? 'area' : 'units' }),
              heatingPlantId: 'hp', heatingPart: 'fuel', fuelDeliveryId: id, taxYear: year,
            }))
          })
          if (ok && op === 'external') STATS.external++
        } else if (op === 'amount') {
          const c = pick((await opened.read((db) => readCostItems(db))).filter((x) => x.fuelDeliveryId))
          if (!c) continue
          const amountCents = int(50000, 400000)
          await attempt(`amount ${c.id}=${amountCents}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { amountCents })))
        } else if (op === 'unlink') {
          const c = pick((await opened.read((db) => readCostItems(db))).filter((x) => x.fuelDeliveryId))
          if (!c) continue
          await attempt(`unlink ${c.id}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: null })))
        } else if (op === 'quantity') {
          const d = pick(await opened.read((db) => readFuelDeliveries(db)))
          if (!d) continue
          const quantity = int(100, 3000)
          await attempt(`quantity ${d.id}=${quantity}`, () => opened.write((db) => updateDelivery(db, d.id, { quantity })))
        } else if (op === 'reown') {
          // Kette vor `year` unterbrechen und neu eintragen
          if (year === 2023) continue
          const prevKey = hkeyOf(year - 1)
          const body = openingBody()
          const ok = await attempt(`reown ${hkey} ${JSON.stringify(body)}`, async () => {
            await opened.write((db) => saveStock(db, 'hp', prevKey, { closingQuantity: null }))
            await opened.write((db) => saveStock(db, 'hp', hkey, body))
          })
          if (ok) STATS.reown++
        } else if (op === 'closing' || op === 'measured') {
          const views = await opened.read((db) => heatingPeriodViews(db, 'hp', pkey.slice(0, 4))) ?? []
          const view = views.find((v) => v.period === hkey)
          const before = view?.stock?.derived?.value.quantity ?? view?.stock?.row.openingQuantity ?? 0
          const delivered = (await opened.read((db) => readFuelDeliveries(db))).filter((d) => d.deliveredAt !== null && periodOfDate(d.deliveredAt) === year).reduce((a, d) => a + (d.quantity ?? 0), 0)
          const end = WAY === 'b' ? `${year + 1}-04` : `${year}-12`
          const body = op === 'closing'
            ? { stockUnit: 'l', closingQuantity: int(0, Math.floor(before + delivered)) }
            : { closingMeasuredOn: `${end}-${String(int(20, 30)).padStart(2, '0')}` }
          await attempt(`${op} ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, 'hp', hkey, body)))
        } else if (op === 'close') {
          if (process.env.INV_FILL !== '0' && rnd() < 0.8) await complete(year)
          const here = await positionsIn(hkey)
          await attempt(`close ${pkey}`, () => opened.write(async (db) => {
            if (await findClosedSettlement(db, 'objekt-1', periodKey(pkey))) return
            await db.transaction(async (tx) => {
              const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(pkey)), {})
              await closeSettlement(tx, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(pkey), closedAt: '2027-01-01', sentAt: null, settlement })
            })
            atClose.set(hkey, here)
          }))
        } else {
          await attempt(`reopen ${pkey}`, async () => {
            if (await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(pkey), `h${n++}`, unfreezeFuelCarries))) atClose.delete(hkey)
          })
        }
      }
      if (process.env.INV_FILL !== '0') for (const y of YEARS) await complete(y)
      function periodOfDate(d: string): number {
        const y = Number(d.slice(0, 4))
        if (WAY !== 'b') return y
        return Number(d.slice(5, 7)) >= 5 ? y : y - 1
      }
      const fall = `${WAY} Startwert ${seed}: ${JSON.stringify(opening)} ${log.join(', ')}`
      const stock = await opened.read((db) => readStock(db))
      const closed = await opened.read((db) => readClosedSettlements(db))
      const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
      const read = YEARS.map((y) => {
        const hkey = hkeyOf(y)
        const pkey = pkeyOf(y)
        const stored = closed.find((c) => c.period === pkey)
        const s = stored ? stored.settlement : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(pkey)), {})
        const positions = stored ? (atClose.get(hkey) ?? assert.fail(`${fall}; ${hkey} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === hkey).reduce((a, c) => a + c.amountCents, 0)
        return { key: hkey, positions, ...readSettlement(s, hkey) }
      })
      for (const r of read) {
        if (process.env.INV_DEBUG) console.log('DBG', seed, r.key, JSON.stringify(r.stock && [r.stock.openingSource, r.stock.opening.quantity, r.stock.opening.costCents, r.stock.closing.costCents, r.stock.handover?.costCents, r.stock.openingSettledCents]), r.carryIn, r.carryOut, JSON.stringify(r.notices.filter((x) => x.code.startsWith('fuel')).map((x) => x.code)))
        STATS.periods++; if (r.stock) STATS.validStock++; if (r.codes.includes('fuel.manual-by-delivery')) STATS.mbd++
        if (r.stock && !r.codes.includes('fuel.manual-by-delivery')) { STATS.iiChecked++; if (r.stock.openingSource !== 'own' && (r.stock.opening.costCents ?? 0) > 0) STATS.iiDerivedValue++ }
        assert.equal(r.all, r.positions, `${fall}; (i) ${r.key}`)
        if (r.stock && !r.codes.includes('fuel.manual-by-delivery')) assert.equal(r.heating, r.positions + (r.stock.opening.costCents ?? 0) - (r.stock.closing.costCents ?? 0), `${fall}; (ii) ${r.key}`)
      }
      for (let i = 1; i < read.length; i++) {
        const a = read[i - 1]
        const b = read[i]
        if (!a || !b) continue
        STATS.pairs++
        const own = b.stock?.openingSource === 'own'
        const diff = -a.carryOut - (own ? 0 : b.carryIn)
        if (diff !== 0) STATS.nonzero++
        const aLabel = periodLabel(periodOfKey(rulesOfWay, periodKey(a.key)) ?? assert.fail(`kein Zeitraum ${a.key}`))
        const inB = b.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes(`Heizperiode ${aLabel} im Wert von ${euro(diff)}`))
        const inA = a.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes('Folgeperiode ist ohne Vorrat') && x.text.includes(euro(diff)))
        if (diff !== 0) STATS.flagged++
        assert.ok(diff === 0 || (diff > 0 && (inA || inB)), `${fall}; (iv′) ${a.key} gibt ${-a.carryOut} weiter, ${b.key} übernimmt ${own ? 'nichts (eigener Anfangsbestand)' : b.carryIn}, ohne passenden Hinweis`)
      }
      for (let i = 1; i < read.length; i++) {
        const a = read[i - 1]
        const b = read[i]
        if (!a?.stock || !b?.stock || b.stock.openingSource === 'own') continue
        STATS.iiiChecked++
        const h = a.stock.handover ?? a.stock.closing
        assert.deepEqual([b.stock.opening.quantity, b.stock.opening.costCents, b.stock.opening.emissionsKg, b.stock.opening.co2Cents], [h.quantity, h.costCents, h.emissionsKg, h.co2Cents], `${fall}; (iii) ${a.key} → ${b.key}`)
      }
    } finally {
      opened.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
}

// Abdeckung (Nachprüfung von #237): Ohne gültige Heizperioden prüfte die Invariante nichts. Die Grenzen
// liegen unter dem, was die Startwerte 1–40 heute ergeben (Weg a: 101 von 160 Heizperioden gültig, (ii)
// 57-mal, (iii) 43-mal, 108 von 120 Paaren ohne Abweichung), und gelten nur für einen vollen Lauf.
test('Invariante Vorrat: Abdeckung', () => {
  if (SEEDS.length < 40) return
  if (process.env.INV_LOG) console.log('Abdeckung', WAY, JSON.stringify(STATS))
  assert.ok(STATS.validStock * 2 > STATS.periods, `nur ${STATS.validStock} von ${STATS.periods} Heizperioden mit gültiger Bestandsrechnung`)
  assert.ok(STATS.iiChecked * 10 >= STATS.periods * 3, `(ii) nur ${STATS.iiChecked}-mal geprüft`)
  assert.ok(STATS.iiiChecked * 5 >= STATS.periods, `(iii) nur ${STATS.iiiChecked}-mal geprüft`)
  assert.ok((STATS.pairs - STATS.nonzero) * 5 >= STATS.pairs * 4, `(iv′) nur ${STATS.pairs - STATS.nonzero} Paare ohne Abweichung`)
  assert.ok(STATS.reown > 0 && STATS.external > 0 && STATS.settledOpenings > 0, 'ein Vorgang des Generators kommt nicht vor')
})
