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
// Heizung PR 9: Mit INV_PLANTS=2 (und in einem festen Teil der Startwerte, `TWO_SEEDS`) stehen zwei
// Anlagen im Objekt, Haus A (Wohnungen A, B) und Haus B (Wohnung C), je mit eigenem Vorrat; der Generator
// wählt je Vorgang eine Anlage. Geprüft wird alles je Anlage, dazu: Jede Lieferung steht in der
// Bestandsrechnung genau einer Anlage, nämlich ihrer eigenen (je Anlage und Lieferung genau einmal).
// Kesseltausch (Durchsicht von #238, I3): In den Startwerten 1–8 (mit INV_TAUSCH=alle in allen) ersetzt der
// Vorgang „replace“ die Anlage an einem Zufallstag durch eine neue mit Heizöl (derselbe Brennstoff, der
// Restbestand geht über) oder Flüssiggas (er bleibt beim Vermieter); Lieferungen danach gehen an die neue.
// Geprüft wird je Anlage nur in ihrer Betriebszeit und am Tausch: Was die alte als Restbestand hinausbucht,
// bucht die neue herein, steht als Restbestand beim Vermieter oder ist als nicht übernommen gemeldet.
// Nachprüfung von #238: Mit eigener Zufallsfolge versucht der Generator, die Rechnung einer Lieferung erst im
// Folgejahr zu buchen; (v) verlangt, dass jede Position einer Lieferung in der Heizperiode ihres Lieferdatums
// steht, denn nur dort verteilt die Bestandskette den Betrag im Jahr des Verbrauchs.
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
import { createHeatingPlant, replaceHeatingPlant } from '../src/db/heating.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelDeliveries, readHeatingPlants, readStock } from '../src/db/read.ts'
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

// Die Zeilen einer Anlage (Heizung PR 9): Überträge und CO₂-Zeilen tragen ihre Kennung, die übrigen gehören
// der Position. Mit einer Anlage sind es alle Zeilen.
function readSettlement(s: unknown, hkey: string, plantId = 'hp', itemPlant: ReadonlyMap<string, string> = new Map()) {
  const mine = (r: unknown): boolean => {
    const id = str(r, 'costItemId')
    const [kind, ref] = id.split(':')
    if (kind === 'stock' || kind === 'co2') return ref === plantId
    return (itemPlant.get(id) ?? 'hp') === plantId
  }
  const tenantRows = list(s, 'statements').flatMap((st) => list(st, 'rows')).filter(mine)
  const landlordRows = list(g(s, 'landlord'), 'rows').filter(mine)
  const rows = [...tenantRows, ...landlordRows]
  // Gegenbuchung und Restbestand beim Kesseltausch stehen beim Vermieter neben den Heizkosten.
  const counter = (r: unknown) => /^stock:[^:]+:[^:]+(:remaining)?$/.test(str(r, 'costItemId'))
  const heating = rows.filter((r) => str(r, 'category') === HEATING_CATEGORY && !counter(r)).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  const all = rows.reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  const h = list(s, 'heating').find((x) => str(x, 'period') === hkey && str(x, 'plantId') === plantId)
  const stock = g(h, 'stock')
  const notices = list(s, 'notices').filter((x) => { const subject = g(x, 'subject'); return subject === undefined || subject === null || str(subject, 'id') === plantId || str(subject, 'kind') !== 'heatingCosts' }).map((x) => ({ code: str(x, 'code'), text: str(x, 'text') }))
  const carry = (suffix: string) => rows.filter((r) => new RegExp(`^stock:${plantId}:${hkey}:${suffix}$`).test(str(r, 'costItemId'))).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  const remaining = landlordRows.filter((r) => str(r, 'costItemId') === `stock:${plantId}:${hkey}:remaining`).reduce<number>((a, r) => a + num(r, 'shareCents'), 0)
  return { all, heating, remaining, carryIn: carry('in'), carryOut: carry('out'), stock: stock !== null && typeof stock === 'object' ? (stock as HeatingStockStatement) : null, notices, codes: notices.map((n) => n.code) }
}

const SEEDS = Array.from({ length: Number(process.env.INV_TO ?? 40) - Number(process.env.INV_FROM ?? 1) + 1 }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
const STEPS = Number(process.env.INV_STEPS ?? 40)
const WAY = process.env.INV_WAY ?? 'a'
const YEARS = [2023, 2024, 2025, 2026]
// Zwei Anlagen (Heizung PR 9): mit INV_PLANTS=2 alle Startwerte, sonst die ersten acht zusätzlich.
const TWO_SEEDS = process.env.INV_PLANTS === '2' ? SEEDS : SEEDS.filter((s) => s <= 8)
const STATS = { late: 0, periods: 0, validStock: 0, iiChecked: 0, iiDerivedValue: 0, iiiChecked: 0, mbd: 0, pairs: 0, nonzero: 0, flagged: 0, settledOpenings: 0, reown: 0, external: 0, swaps: 0, carried: 0, remaining: 0, boundary: 0 }

const TWO_STATS = { ...STATS }
const TAUSCH_STATS = { ...STATS }
const TAUSCH_SEEDS = process.env.INV_TAUSCH === 'alle' ? SEEDS : SEEDS.filter((s) => s <= 8)
const RUNS = [
  ...(process.env.INV_PLANTS === '2' ? [] : SEEDS.map((seed) => ({ seed, two: false, tausch: false }))),
  ...TWO_SEEDS.map((seed) => ({ seed, two: true, tausch: false })),
  ...TAUSCH_SEEDS.map((seed) => ({ seed, two: false, tausch: true })),
]
for (const { seed, two, tausch } of RUNS) {
  test(`Invariante Vorrat (Weg ${WAY}, Startwert ${seed}${two ? ', zwei Anlagen' : ''}${tausch ? ', Kesseltausch' : ''}): jede Lieferung über alle Heizperioden genau einmal verbraucht`, async () => {
    const PLANTS = two || tausch ? ['hp', 'hp2'] : ['hp']
    // Kesseltausch: Tag und Brennstoff der neuen Anlage, sobald getauscht ist.
    let swap = null as { date: string; energy: 'oil' | 'lpg' } | null
    const itemPlant = new Map<string, string>()
    const deliveryPlant = new Map<string, string>()
    // Die Läufe mit zwei Anlagen zählen getrennt, damit die Grenzen der Abdeckung bleiben.
    const stats = tausch ? TAUSCH_STATS : two ? TWO_STATS : STATS
    const rnd = zufall(seed * 31 + 5 + (tausch ? 1000 : 0))
    // „Rechnung erst im Folgejahr buchen“ (Nachprüfung von #238) mit eigener Zufallsfolge, damit die übrigen
    // Vorgänge jedes Startwerts dieselben bleiben.
    const lateRnd = zufall(seed * 97 + 11 + (tausch ? 1000 : 0))
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
        if (two) {
          await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
          await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieter C', persons: 1, start: '2020-01-01' })
          await createHeatingPlant(db, 'hp', 'objekt-1', { name: 'Haus A', energy: 'oil', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] })
          await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Haus B', energy: 'oil', method: 'manual', units: [{ unitId: 'c', heatedAreaM2: null }] })
        } else {
          await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'oil', method: 'manual' })
        }
        for (const p of PLANTS) if (WAY === 'b') await db.update(heatingPlants).set({ periodStartMonth: 5 }).where(eq(heatingPlants.id, p))
      })
      const openingBody = () => {
        const q = int(0, 3000)
        const r0 = rnd()
        const settled = r0 < 0.25 ? true : null
        if (settled) stats.settledOpenings++
        return { stockUnit: 'l', openingQuantity: q, openingCostCents: int(0, 300000), openingEmissionsKg: Math.round(q * 267.6) / 100, openingCo2Cents: int(0, 20000), openingInvoicedBefore2023: rnd() < 0.3, openingAlreadySettled: settled }
      }
      const opening = openingBody()
      for (const p of tausch ? ['hp'] : PLANTS) await opened.write((db) => saveStock(db, p, hkeyOf(2023), p === 'hp' ? opening : openingBody()))
      const log: string[] = []
      const attempt = async (what: string, run: () => Promise<unknown>) => {
        try { await run(); log.push(what); return true } catch (err) { if (!rejected(err)) throw err; return false }
      }
      const atClose = new Map<string, number>()
      const positionsIn = async (key: string, plantId: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key && (c.heatingPlantId ?? 'hp') === plantId).reduce((a, c) => a + c.amountCents, 0)
      const periodOf = (key: string) => periodOfKey(CALENDAR_RULES, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
      const rulesOfWay = WAY === 'b' ? { startMonth: 5, changes: [] } : CALENDAR_RULES
      const complete = async (y: number, plant: string) => {
        const hkey = hkeyOf(y)
        for (const c of (await opened.read((db) => readCostItems(db))).filter((x) => x.period === hkey && x.heatingPart === 'fuel' && !x.fuelDeliveryId && /^d[0-9]+$/.test(x.description) && (x.heatingPlantId ?? 'hp') === plant)) {
          await attempt(`relink ${c.id}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: c.description })))
        }
        const views = await opened.read((db) => heatingPeriodViews(db, plant, pkeyOf(y).slice(0, 4))) ?? []
        const view = views.find((v) => v.period === hkey)
        if (!view?.stock || view.closed) return
        if (!view.stock.derived && view.stock.row.openingQuantity === null) {
          const body = openingBody()
          await attempt(`fillopen ${plant} ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, plant, hkey, body)))
        }
        const v2 = (await opened.read((db) => heatingPeriodViews(db, plant, pkeyOf(y).slice(0, 4))) ?? []).find((v) => v.period === hkey)
        if (!v2?.stock || v2.stock.row.closingQuantity !== null) return
        const before = v2.stock.derived?.value.quantity ?? v2.stock.row.openingQuantity ?? 0
        const delivered = (await opened.read((db) => readFuelDeliveries(db))).filter((d) => d.plantId === plant && d.deliveredAt !== null && periodOfDate(d.deliveredAt) === y).reduce((a, d) => a + (d.quantity ?? 0), 0)
        const body = { stockUnit: 'l', closingQuantity: int(0, Math.floor(before + delivered)) }
        await attempt(`fill ${plant} ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, plant, hkey, body)))
      }
      let n = 0
      // Der Tausch an einem Zufallstag (mitten in einem Jahr der Prüfung); er kann abgelehnt werden.
      const replace = async (year: number) => {
        if (swap) return
        const month = WAY === 'b' ? int(5, 16) : int(2, 12)
        const date = month <= 12 ? `${year}-${String(month).padStart(2, '0')}-01` : `${year + 1}-${String(month - 12).padStart(2, '0')}-01`
        const energy = rnd() < 0.6 ? 'oil' as const : 'lpg' as const
        if (await attempt(`replace ${date} ${energy}`, () => opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date, energy, name: 'Neu', previousName: 'Alt' })))) {
          swap = { date, energy }
          stats.swaps++
        }
      }
      // Getauscht wird gleich zu Beginn, an einem Zufallstag 2024 bis 2026: Danach laufen alle Vorgänge über
      // beide Anlagen, und Lieferungen nach dem Tag gehören der neuen.
      if (tausch) await replace(pick([2024, 2025, 2026]) ?? 2025)
      for (let step = 0; step < STEPS; step++) {
        const op = pick(['deliver', 'deliver', 'amount', 'amount', 'closing', 'closing', 'measured', 'close', 'close', 'reopen', 'unlink', 'quantity', 'reown', 'external', ...(tausch ? ['replace' as const] : [])] as const)
        const year = pick(YEARS) ?? 2023
        if (op === 'replace') {
          await replace(year)
          continue
        }
        // Nur beim Tausch vorab gezogen; sonst bliebe die Zufallsfolge der übrigen Läufe nicht dieselbe.
        const swapDay = tausch ? dateIn(year) : ''
        // Beim Tausch gehört eine Lieferung nach dem Tag an die neue Anlage; die übrigen Vorgänge wählen eine.
        const plant = tausch
          ? (swap && (op === 'deliver' || op === 'external') ? (swapDay >= swap.date ? 'hp2' : 'hp') : swap ? (pick(PLANTS) ?? 'hp') : 'hp')
          : two ? (pick(PLANTS) ?? 'hp') : 'hp'
        const hkey = hkeyOf(year)
        const pkey = pkeyOf(year)
        if (op === 'deliver' || op === 'external') {
          const id = `d${n++}`
          const q = int(500, 3000)
          const date = tausch ? swapDay : dateIn(year)
          const amountCents = q * int(80, 130)
          const ok = await attempt(`${op} ${plant} ${id} ${date} ${q}`, async () => {
            await opened.write((db) => createDelivery(db, id, plant, { label: id, deliveredAt: date, invoiceDate: date, quantity: q, quantityUnit: 'l', emissionsKg: Math.round(q * 267.6) / 100, co2CostCents: int(1000, 60000) }))
            deliveryPlant.set(id, plant)
            const fields = {
              category: HEATING_CATEGORY, description: id, amountCents,
              ...(op === 'external' ? { key: 'external', externalBasis: { measure: 'area', total: 100, totalCents: amountCents } } : { key: rnd() < 0.5 ? 'area' : 'units' }),
              heatingPlantId: plant, heatingPart: 'fuel', fuelDeliveryId: id, taxYear: year,
              ...(two ? { participantUnitIds: plant === 'hp' ? ['a', 'b'] : ['c'] } : {}),
            }
            // Die Rechnung erst im Folgejahr buchen: Die Lieferung gehört in die Heizperiode ihres Lieferdatums,
            // nur dort verteilt die Bestandskette sie genau einmal; der Schreibweg lehnt das ab.
            if (YEARS.includes(year + 1) && lateRnd() < 0.3) {
              try {
                await opened.write((db) => createEntity(db, 'costItems', `c${id}`, { propertyId: 'objekt-1', period: hkeyOf(year + 1), ...fields, taxYear: year + 1 }))
                itemPlant.set(`c${id}`, plant)
                return
              } catch (err) {
                if (!rejected(err)) throw err
                stats.late++
              }
            }
            await opened.write((db) => createEntity(db, 'costItems', `c${id}`, { propertyId: 'objekt-1', period: hkey, ...fields }))
            itemPlant.set(`c${id}`, plant)
          })
          if (ok && op === 'external') stats.external++
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
          const ok = await attempt(`reown ${plant} ${hkey} ${JSON.stringify(body)}`, async () => {
            await opened.write((db) => saveStock(db, plant, prevKey, { closingQuantity: null }))
            await opened.write((db) => saveStock(db, plant, hkey, body))
          })
          if (ok) stats.reown++
        } else if (op === 'closing' || op === 'measured') {
          const views = await opened.read((db) => heatingPeriodViews(db, plant, pkey.slice(0, 4))) ?? []
          const view = views.find((v) => v.period === hkey)
          const before = view?.stock?.derived?.value.quantity ?? view?.stock?.row.openingQuantity ?? 0
          const delivered = (await opened.read((db) => readFuelDeliveries(db))).filter((d) => d.plantId === plant && d.deliveredAt !== null && periodOfDate(d.deliveredAt) === year).reduce((a, d) => a + (d.quantity ?? 0), 0)
          const end = WAY === 'b' ? `${year + 1}-04` : `${year}-12`
          const body = op === 'closing'
            ? { stockUnit: 'l', closingQuantity: int(0, Math.floor(before + delivered)) }
            : { closingMeasuredOn: `${end}-${String(int(20, 30)).padStart(2, '0')}` }
          await attempt(`${op} ${plant} ${hkey} ${JSON.stringify(body)}`, () => opened.write((db) => saveStock(db, plant, hkey, body)))
        } else if (op === 'close') {
          if (process.env.INV_FILL !== '0' && rnd() < 0.8) for (const p of PLANTS) await complete(year, p)
          const here = new Map<string, number>()
          for (const p of PLANTS) here.set(p, await positionsIn(hkey, p))
          await attempt(`close ${pkey}`, () => opened.write(async (db) => {
            if (await findClosedSettlement(db, 'objekt-1', periodKey(pkey))) return
            await db.transaction(async (tx) => {
              const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(pkey)), {})
              await closeSettlement(tx, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(pkey), closedAt: '2027-01-01', sentAt: null, settlement })
            })
            for (const [p, v] of here) atClose.set(`${p}|${hkey}`, v)
          }))
        } else {
          await attempt(`reopen ${pkey}`, async () => {
            if (await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(pkey), `h${n++}`, unfreezeFuelCarries))) for (const p of PLANTS) atClose.delete(`${p}|${hkey}`)
          })
        }
      }
      if (tausch && !swap) await replace(2025)
      if (process.env.INV_FILL !== '0') for (const y of YEARS) for (const p of PLANTS) await complete(y, p)
      function periodOfDate(d: string): number {
        const y = Number(d.slice(0, 4))
        if (WAY !== 'b') return y
        return Number(d.slice(5, 7)) >= 5 ? y : y - 1
      }
      const fall = `${WAY} Startwert ${seed}: ${JSON.stringify(opening)} ${log.join(', ')}`
      const stock = await opened.read((db) => readStock(db))
      const closed = await opened.read((db) => readClosedSettlements(db))
      const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
      const span = (key: string) => periodOfKey(rulesOfWay, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
      // (v) Jede Position einer Lieferung steht in der Heizperiode des Lieferdatums (Nachprüfung von #238);
      // sonst trügen die Mieter einer Heizperiode den Brennstoff, den die einer anderen verbraucht haben.
      const deliveredOn = new Map((await opened.read((db) => readFuelDeliveries(db))).map((d) => [d.id, d.deliveredAt]))
      for (const c of items.filter((x) => x.fuelDeliveryId)) {
        const date = deliveredOn.get(c.fuelDeliveryId ?? '') ?? null
        if (date !== null) assert.equal(c.period, hkeyOf(periodOfDate(date)), `${fall}; (v) Position ${c.id} der Lieferung vom ${date} steht in ${c.period}`)
      }
      const reads = new Map<string, ReturnType<typeof readSettlement> extends infer R ? (R & { key: string; positions: number })[] : never>()
      for (const plant of PLANTS) {
      const read = YEARS.map((y) => {
        const hkey = hkeyOf(y)
        const pkey = pkeyOf(y)
        const stored = closed.find((c) => c.period === pkey)
        const s = stored ? stored.settlement : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(pkey)), {})
        const positions = stored ? (atClose.get(`${plant}|${hkey}`) ?? assert.fail(`${fall}; ${hkey} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === hkey && (c.heatingPlantId ?? 'hp') === plant).reduce((a, c) => a + c.amountCents, 0)
        // Heizung PR 9: Jede Lieferung steht in der Bestandsrechnung nur ihrer eigenen Anlage.
        if (two || tausch) {
          for (const h of list(s, 'heating')) {
            for (const layer of list(g(h, 'stock'), 'deliveries')) {
              const owner = deliveryPlant.get(str(layer, 'label'))
              assert.equal(owner, str(h, 'plantId'), `${fall}; Lieferung ${str(layer, 'label')} in der Bestandsrechnung von ${str(h, 'plantId')} (${hkey})`)
            }
          }
        }
        return { key: hkey, positions, ...readSettlement(s, hkey, plant, itemPlant) }
      })
      for (const r of read) {
        if (process.env.INV_DEBUG) console.log('DBG', seed, r.key, JSON.stringify(r.stock && [r.stock.openingSource, r.stock.opening.quantity, r.stock.opening.costCents, r.stock.closing.costCents, r.stock.handover?.costCents, r.stock.openingSettledCents]), r.carryIn, r.carryOut, JSON.stringify(r.notices.filter((x) => x.code.startsWith('fuel')).map((x) => x.code)))
        stats.periods++; if (r.stock) stats.validStock++; if (r.codes.includes('fuel.manual-by-delivery')) stats.mbd++
        if (r.stock && !r.codes.includes('fuel.manual-by-delivery')) { stats.iiChecked++; if (r.stock.openingSource !== 'own' && (r.stock.opening.costCents ?? 0) > 0) stats.iiDerivedValue++ }
        assert.equal(r.all, r.positions, `${fall}; (i) ${plant} ${r.key}`)
        if (r.stock && !r.codes.includes('fuel.manual-by-delivery')) assert.equal(r.heating, r.positions + (r.stock.opening.costCents ?? 0) - (r.stock.closing.costCents ?? 0), `${fall}; (ii) ${plant} ${r.key}`)
      }
      const plantRow = (await opened.read((db) => readHeatingPlants(db))).find((p) => p.id === plant)
      const ends = plantRow?.endsOn ?? null
      const starts = plant === 'hp2' && swap ? swap.date : null
      for (let i = 1; i < read.length; i++) {
        const a = read[i - 1]
        const b = read[i]
        if (!a || !b) continue
        // Kesseltausch: Paare über das Ende der alten oder den Beginn der neuen Anlage prüft der Tausch unten.
        if ((ends !== null && span(b.key).from > ends) || (starts !== null && span(a.key).to < starts)) continue
        stats.pairs++
        const own = b.stock?.openingSource === 'own'
        const diff = -a.carryOut - (own ? 0 : b.carryIn)
        if (diff !== 0) stats.nonzero++
        const aLabel = periodLabel(periodOfKey(rulesOfWay, periodKey(a.key)) ?? assert.fail(`kein Zeitraum ${a.key}`))
        const inB = b.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes(`Heizperiode ${aLabel} im Wert von ${euro(diff)}`))
        const inA = a.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes('Folgeperiode ist ohne Vorrat') && x.text.includes(euro(diff)))
        if (diff !== 0) stats.flagged++
        assert.ok(diff === 0 || (diff > 0 && (inA || inB)), `${fall}; (iv′) ${plant} ${a.key} gibt ${-a.carryOut} weiter, ${b.key} übernimmt ${own ? 'nichts (eigener Anfangsbestand)' : b.carryIn}, ohne passenden Hinweis`)
      }
      for (let i = 1; i < read.length; i++) {
        const a = read[i - 1]
        const b = read[i]
        if (!a?.stock || !b?.stock || b.stock.openingSource === 'own') continue
        stats.iiiChecked++
        const h = a.stock.handover ?? a.stock.closing
        assert.deepEqual([b.stock.opening.quantity, b.stock.opening.costCents, b.stock.opening.emissionsKg, b.stock.opening.co2Cents], [h.quantity, h.costCents, h.emissionsKg, h.co2Cents], `${fall}; (iii) ${plant} ${a.key} → ${b.key}`)
      }
      reads.set(plant, read)
      }
      // Der Tausch (Durchsicht von #238, I3): Was die alte Anlage am letzten Betriebstag im Vorrat hat, bucht die
      // neue mit demselben Brennstoff herein, oder es steht als Restbestand beim Vermieter, oder ein Hinweis nennt
      // den Betrag, den keine Heizperiode übernimmt.
      const alt = (await opened.read((db) => readHeatingPlants(db))).find((p) => p.id === 'hp')
      const getauscht = swap
      if (tausch && getauscht && alt?.endsOn) {
        const year = periodOfDate(alt.endsOn)
        const oa = reads.get('hp')?.find((r) => r.key === hkeyOf(year))
        // Die erste Heizperiode der neuen Anlage: dieselbe oder, bei einem Tausch zum Ersten, die folgende.
        const nb = reads.get('hp2')?.find((r) => r.key === hkeyOf(periodOfDate(getauscht.date)))
        if (oa?.stock && nb) {
          const carried = getauscht.energy === 'oil' && nb.stock?.openingSource !== 'own'
          if (carried) {
            stats.carried++
            const diff = -oa.carryOut - nb.carryIn
            const label = periodLabel(span(oa.key))
            if (nb.key !== oa.key) stats.boundary++
            const flagged = nb.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes(`Heizperiode ${label} im Wert von ${euro(diff)}`)) ||
              oa.notices.some((x) => x.code === 'fuel.stock-not-taken-over' && x.text.includes('Folgeperiode ist ohne Vorrat') && x.text.includes(euro(diff)))
            assert.ok(diff === 0 || (diff > 0 && flagged), `${fall}; Tausch: die alte Anlage gibt ${-oa.carryOut} weiter, die neue übernimmt ${nb.carryIn}`)
            assert.equal(oa.remaining, 0, `${fall}; Tausch mit demselben Brennstoff: kein Restbestand beim Vermieter`)
          } else {
            stats.remaining++
            assert.equal(oa.remaining, -oa.carryOut || 0, `${fall}; Tausch: Restbestand ${oa.remaining} beim Vermieter, hinausgebucht ${-oa.carryOut}`)
            if (oa.remaining !== 0) assert.ok(oa.codes.includes('fuel.stock-remaining'), `${fall}; Tausch: Hinweis auf den Restbestand fehlt`)
          }
        }
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
  // Zwei Anlagen (Heizung PR 9): auch dort gültige Bestandsrechnungen und geprüfte Übernahmen.
  // Kesseltausch: getauscht wurde, und beide Ausgänge kamen vor.
  if (TAUSCH_SEEDS.length >= 8) {
    if (process.env.INV_LOG) console.log('Tausch', JSON.stringify(TAUSCH_STATS))
    assert.ok(TAUSCH_STATS.swaps >= 6 && TAUSCH_STATS.carried > 0 && TAUSCH_STATS.remaining > 0, `Kesseltausch: ${JSON.stringify(TAUSCH_STATS)}`)
  }
  if (TWO_SEEDS.length >= 8) {
    assert.ok(TWO_STATS.validStock * 3 > TWO_STATS.periods, `zwei Anlagen: nur ${TWO_STATS.validStock} von ${TWO_STATS.periods} Heizperioden mit gültiger Bestandsrechnung`)
    assert.ok(TWO_STATS.iiChecked > 0 && TWO_STATS.iiiChecked > 0, `zwei Anlagen: (ii) ${TWO_STATS.iiChecked}-mal, (iii) ${TWO_STATS.iiiChecked}-mal geprüft`)
  }
  if (SEEDS.length < 40 || process.env.INV_PLANTS === '2') return
  if (process.env.INV_LOG) console.log('Abdeckung', WAY, JSON.stringify(STATS))
  assert.ok(STATS.validStock * 2 > STATS.periods, `nur ${STATS.validStock} von ${STATS.periods} Heizperioden mit gültiger Bestandsrechnung`)
  assert.ok(STATS.iiChecked * 10 >= STATS.periods * 3, `(ii) nur ${STATS.iiChecked}-mal geprüft`)
  assert.ok(STATS.iiiChecked * 5 >= STATS.periods, `(iii) nur ${STATS.iiiChecked}-mal geprüft`)
  assert.ok((STATS.pairs - STATS.nonzero) * 5 >= STATS.pairs * 4, `(iv′) nur ${STATS.pairs - STATS.nonzero} Paare ohne Abweichung`)
  assert.ok(STATS.reown > 0 && STATS.external > 0 && STATS.settledOpenings > 0 && STATS.late > 0, 'ein Vorgang des Generators kommt nicht vor')
})
