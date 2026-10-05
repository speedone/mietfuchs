// Jede Versorgerrechnung genau einmal verteilt (Heizung PR 7, Nachprüfung der Durchsicht von #233,
// Entwurf 12.3 Nr. 1 und 5), über Abschluss, Wiederöffnen und Verknüpfen in wechselnder Reihenfolge.
//
// Der Generator geht über die **echten Schreibwege** (repository.ts, db/fuel.ts, Abschluss wie in
// index.ts) und bildet keine Sperre nach: Was die Anwendung mit 400 oder 409 ablehnt, wird
// übersprungen, alles andere geschieht. Eine Gutschrift kommt nur zu einer Lieferung, die schon eine
// Rechnungsposition hat, und Positionen ohne Gutschrift werden zuletzt gelöst; das ist die Gestalt der
// Daten (eine Gutschrift gehört zu einer Rechnung) und keine Sperre. Am Ende gilt je Lauf:
//   (i)   Σ Mieterzeilen + Σ aller Vermieterteile (auch `fuelCarry`) über alle Zeiträume = Σ Positionen,
//         für abgeschlossene Zeiträume mit dem eingefrorenen Stand und den Positionen beim Abschluss
//         (eine Position eines abgeschlossenen Zeitraums lässt sich ändern, die Abrechnung bleibt);
//   (ii)  Σ Mieterzeilen ≤ Σ Positionen (kein Teil doppelt bei den Mietern);
//   (iii) der Vermieter trägt netto nicht weniger als nichts (kein Teil doppelt bei ihm gutgeschrieben);
// und als Zuordnungsprüfung (I1): Hat eine abgeschlossene Heizperiode eine Lieferung mit 0
// eingefroren, bucht die Heizperiode ihrer Positionen deren Teil trotzdem hinaus.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement } from '../src/calc.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, freezeFuelCarries, unfreezeFuelCarries } from '../src/db/fuel.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelCarryFrozen, readStock } from '../src/db/read.ts'
import { closeSettlement, createEntity, findClosedSettlement, removeEntity, reopenSettlement, updateEntity } from '../src/db/repository.ts'
import { properties } from '../src/db/schema.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { periodContaining, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const DAY = 86400000
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

function zufall(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Was die Anwendung ablehnt, hat einen Status 400 oder 409 (HeatingError, PeriodError, CrossPropertyError).
const rejected = (err: unknown): boolean => {
  const status: unknown = err !== null && typeof err === 'object' ? Reflect.get(err, 'status') : undefined
  return status === 400 || status === 409
}

// Mieterzeilen und Vermieterteile einer Abrechnung, auch einer eingefrorenen (JSON).
function totals(s: unknown): { tenants: number; landlord: number } {
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const list = (o: unknown, key: string): unknown[] => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return Array.isArray(v) ? v : []
  }
  const tenants = list(s, 'statements').reduce<number>((a, st) => a + num(st !== null && typeof st === 'object' ? Reflect.get(st, 'totalShareCents') : 0), 0)
  const landlordObj: unknown = s !== null && typeof s === 'object' ? Reflect.get(s, 'landlord') : undefined
  const landlord = list(landlordObj, 'rows').flatMap((r) => list(r, 'landlordParts')).reduce<number>((a, p) => a + num(p !== null && typeof p === 'object' ? Reflect.get(p, 'cents') : 0), 0)
  return { tenants, landlord }
}

for (let seed = 1; seed <= 30; seed++) {
  test(`Invariante (Startwert ${seed}): Abschluss, Wiederöffnen und Verknüpfen verteilen jede Rechnung genau einmal`, async () => {
    const rnd = zufall(seed)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-inv-'))
    const opened = await openDatabase({ dataDir })
    try {
      const deliveries: { id: string; from: string; to: string }[] = []
      await opened.write(async (db) => {
        await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
        await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
        await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
        await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
        await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
        await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
        let start = isoOf(Date.UTC(2024, 1, 1) + int(0, 120) * DAY)
        for (let k = 0; k < 3; k++) {
          const to = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 800) - 1) * DAY)
          await createDelivery(db, `d${k}`, 'hp', { label: `Rechnung ${k}`, invoiceFrom: start, invoiceTo: to, fixedCents: rnd() < 0.5 ? int(0, 20000) : null })
          deliveries.push({ id: `d${k}`, from: start, to })
          start = isoOf(Date.parse(`${to}T00:00:00Z`) + DAY)
        }
      })
      const keys: string[] = []
      for (let p = periodContaining(MAI, deliveries[0]?.from ?? ''); p.from <= (deliveries[2]?.to ?? ''); p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
      const periodOf = (key: string) => periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
      const log: string[] = []
      const attempt = async (what: string, run: () => Promise<unknown>) => {
        try {
          await run()
          log.push(what)
        } catch (err) {
          if (!rejected(err)) throw err
        }
      }
      let n = 0
      // Die Positionen je abgeschlossenem Zeitraum beim Abschluss.
      const atClose = new Map<string, number>()
      const positionsIn = async (key: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key).reduce((a, c) => a + c.amountCents, 0)
      for (let step = 0; step < 30; step++) {
        const op = pick(['link', 'link', 'link', 'credit', 'unlink', 'delete', 'close', 'close', 'reopen'] as const)
        const d = pick(deliveries)
        if (!d) continue
        const owner = periodContaining(MAI, d.to)
        const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.fuelDeliveryId === d.id)
        if (op === 'link' || op === 'credit') {
          if (op === 'credit' && (!items.some((c) => c.amountCents > 0) || items.filter((c) => c.amountCents < 0).length >= 2)) continue
          const id = `p${n++}`
          const amountCents = op === 'credit' ? -int(1000, 40000) : int(100000, 900000)
          await attempt(`${op} ${id}→${d.id}`, () => opened.write((db) => createEntity(db, 'costItems', id, {
            propertyId: 'objekt-1', period: owner.key, category: HEATING_CATEGORY, description: id, amountCents, key: rnd() < 0.5 ? 'area' : 'units',
            heatingPlantId: 'hp', fuelDeliveryId: d.id, taxYear: Number(owner.to.slice(0, 4)),
          })))
        } else if (op === 'unlink' || op === 'delete') {
          const credits = items.filter((x) => x.amountCents < 0)
          const c = pick(credits.length > 0 ? credits : items)
          if (!c) continue
          await attempt(`${op} ${c.id}`, () => (op === 'delete' ? opened.write((db) => removeEntity(db, 'costItems', c.id)) : opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: null }))))
        } else if (op === 'close') {
          const key = pick(keys)
          if (!key) continue
          const here = await positionsIn(key)
          await attempt(`close ${key}`, () => opened.write(async (db) => {
            if (await findClosedSettlement(db, 'objekt-1', periodKey(key))) return
            atClose.set(key, here)
            await db.transaction(async (tx) => {
              const settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
              await closeSettlement(tx, { id: `s${n++}`, propertyId: 'objekt-1', period: periodKey(key), closedAt: '2027-01-01', sentAt: null, settlement })
              await freezeFuelCarries(tx, settlement)
            })
          }))
        } else {
          const key = pick(keys)
          if (!key) continue
          await attempt(`reopen ${key}`, async () => {
            if (await opened.write((db) => reopenSettlement(db, 'objekt-1', periodKey(key), `h${n++}`, unfreezeFuelCarries))) atClose.delete(key)
          })
        }
      }
      const fall = `Startwert ${seed}: ${JSON.stringify(deliveries.map((d) => [d.from, d.to]))} ${log.join(', ')}`
      const stock = await opened.read((db) => readStock(db))
      const closed = await opened.read((db) => readClosedSettlements(db))
      const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
      let positions = 0
      let tenants = 0
      let landlord = 0
      const live = new Map<string, ReturnType<typeof computeSettlement>>()
      for (const key of keys) {
        const stored = closed.find((c) => c.period === key)
        const r = stored ? null : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(key)), {})
        if (r) live.set(key, r)
        const t = totals(stored ? stored.settlement : r)
        const here = stored ? (atClose.get(key) ?? assert.fail(`${fall}; ${key} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === key).reduce((a, c) => a + c.amountCents, 0)
        assert.equal(t.tenants + t.landlord, here, `${fall}; Σ Zeilen in ${key}`)
        positions += here
        tenants += t.tenants
        landlord += t.landlord
      }
      assert.equal(tenants + landlord, positions, `${fall}; (i)`)
      assert.ok(tenants <= positions, `${fall}; (ii) Mieter ${tenants} > Positionen ${positions}`)
      assert.ok(landlord >= 0, `${fall}; (iii) Vermieter netto ${landlord}`)
      // Zuordnung (I1): eine mit 0 eingefrorene Heizperiode bekommt trotzdem ihren Teil hinausgebucht.
      const frozen = await opened.read((db) => readFuelCarryFrozen(db))
      for (const d of deliveries) {
        const owner = periodContaining(MAI, d.to).key
        const T = items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0)
        const r = live.get(owner)
        if (!r || T === 0) continue
        for (const f of frozen.filter((x) => x.deliveryId === d.id && x.cents === 0 && x.period !== owner && closed.some((c) => c.period === x.period))) {
          const carry = r.heating?.[0]?.fuel?.carries.find((c) => c.deliveryId === d.id && c.period === f.period)
          assert.ok(carry && carry.cents !== 0, `${fall}; ${d.id} bucht den Teil für ${f.period} nicht hinaus`)
        }
      }
    } finally {
      opened.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
}
