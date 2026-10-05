// Jede Versorgerrechnung genau einmal verteilt (Heizung PR 7, Nachprüfungen der Durchsicht von #233,
// Entwurf 12.3 Nr. 1 und 5), über Abschluss, Wiederöffnen, Verknüpfen und spätere Änderungen in
// wechselnder Reihenfolge.
//
// Der Generator geht über die **echten Schreibwege** (repository.ts, db/fuel.ts, Abschluss wie in
// index.ts samt Schätzung) und bildet keine Sperre nach: Was die Anwendung mit 400 oder 409 ablehnt,
// wird übersprungen, alles andere geschieht. Vorgänge: Position verknüpfen, Gutschrift (klein oder als
// Storno bis zum ganzen Betrag), Betrag ändern (auch auf 0), lösen, löschen, abschließen (in einem Teil
// der Läufe mit Schätzung der Lücken), wieder öffnen, und eine Rechnung, die erst später kommt. Eine
// Gutschrift kommt nur zu einer Lieferung mit Rechnungsposition, und Gutschriften werden zuerst
// gelöst; das ist die Gestalt der Daten, keine Sperre.
//
// Geprüft wird je Lauf über alle Zeiträume (abgeschlossene mit dem eingefrorenen Stand und den
// Positionen beim Abschluss, denn eine Position eines abgeschlossenen Zeitraums lässt sich ändern):
//   (i)   Σ Mieterzeilen + Σ aller Vermieterteile = Σ Positionen. Das gilt **durch den Aufbau** (jede
//         Abrechnung verteilt genau ihre Positionen) und ist nur eine Probe der Buchhaltung.
//   (ii)  Obergrenze: Die Mieter tragen nicht mehr als die Positionen, außer um ausgewiesene negative
//         Teile (eine zu hohe Schätzung, ein Storno nach Abschluss; dann nennt die Abrechnung den Betrag).
//   (vii) Untergrenze: Die Mieter tragen mindestens die Positionen abzüglich der ausgewiesenen Teile beim
//         Vermieter (`fuelClosedPeriod`, `fuelEstimateDiff`).
//   (iii) Ohne Schätzungen, je Lieferung und Paar von Heizperioden: Die Gegenbuchungen `fuelCarry` heben
//         sich auf (was die eine hereinbucht, bucht die andere hinaus), oder ein ausgewiesener Teil desselben
//         Paars deckt sie genau. Das Zweite, wenn eine abgeschlossene Heizperiode einen Teil ausgewiesen hat,
//         den eine später wieder geöffnete und neu abgeschlossene doch hereinbucht (dann tragen die Mieter
//         die Rechnung genau einmal, und der ausgewiesene Teil steht im eingefrorenen Stand).
// Dazu die Zuordnungsprüfung (I1): Hat eine abgeschlossene Heizperiode eine Lieferung mit 0
// eingefroren, bucht die Heizperiode ihrer Positionen deren Teil trotzdem hinaus. Mit Schätzungen
// gelten (ii) und (vii) nur, wenn am Ende jede Schätzung von echten verknüpften Rechnungen abgedeckt ist.
//
// Feste Startwerte, im Lauf der Tests wenige; mehr mit INV_FROM/INV_TO (siehe SEEDS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement } from '../src/calc.ts'
import { createHeatingPlant } from '../src/db/heating.ts'
import { createDelivery, createEstimates, freezeFuelCarries, fuelGapQuestions, unfreezeFuelCarries } from '../src/db/fuel.ts'
import { openDatabase } from '../src/db/open.ts'
import { readClosedSettlements, readCostItems, readFuelCarryFrozen, readFuelDeliveries, readStock } from '../src/db/read.ts'
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
const flaggedReason = (r: unknown): boolean => r === 'fuelClosedPeriod' || r === 'fuelEstimateDiff'

// Je Paar {Lieferung, zwei Heizperioden}: die Gegenzeile trägt die Kennung `fuel:<Lieferung>:<Heizperiode>:<andere>`.
const pairOf = (rowId: unknown): string | null => {
  if (typeof rowId !== 'string' || !rowId.startsWith('fuel:')) return null
  const [, d, p, o] = rowId.split(':')
  return d && p && o ? `${d}|${[p, o].sort().join('|')}` : null
}

function totals(s: unknown): { tenants: number; landlord: number; carry: number; up: number; down: number; pairs: Map<string, { carry: number; flagged: number }> } {
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const list = (o: unknown, key: string): unknown[] => {
    const v: unknown = o !== null && typeof o === 'object' ? Reflect.get(o, key) : undefined
    return Array.isArray(v) ? v : []
  }
  const tenants = list(s, 'statements').reduce<number>((a, st) => a + num(st !== null && typeof st === 'object' ? Reflect.get(st, 'totalShareCents') : 0), 0)
  const landlordObj: unknown = s !== null && typeof s === 'object' ? Reflect.get(s, 'landlord') : undefined
  const rows = list(landlordObj, 'rows')
  const parts = rows.flatMap((r) => list(r, 'landlordParts'))
  const reasonOf = (p: unknown): unknown => (p !== null && typeof p === 'object' ? Reflect.get(p, 'reason') : undefined)
  const centsOf = (p: unknown): number => num(p !== null && typeof p === 'object' ? Reflect.get(p, 'cents') : 0)
  const pairs = new Map<string, { carry: number; flagged: number }>()
  for (const r of rows) {
    const key = pairOf(r !== null && typeof r === 'object' ? Reflect.get(r, 'costItemId') : undefined)
    if (!key) continue
    const acc = pairs.get(key) ?? { carry: 0, flagged: 0 }
    for (const p of list(r, 'landlordParts')) {
      if (reasonOf(p) === 'fuelCarry') acc.carry += centsOf(p)
      else if (flaggedReason(reasonOf(p))) acc.flagged += centsOf(p)
    }
    pairs.set(key, acc)
  }
  return {
    tenants,
    landlord: parts.reduce<number>((a, p) => a + centsOf(p), 0),
    carry: parts.reduce<number>((a, p) => a + (reasonOf(p) === 'fuelCarry' ? centsOf(p) : 0), 0),
    // Ausgewiesene Teile getrennt nach Vorzeichen: Ein positiver trägt der Vermieter statt der Mieter, ein
    // negativer haben die Mieter zu viel getragen.
    up: parts.reduce<number>((a, p) => a + (flaggedReason(reasonOf(p)) ? Math.max(0, centsOf(p)) : 0), 0),
    down: parts.reduce<number>((a, p) => a + (flaggedReason(reasonOf(p)) ? Math.min(0, centsOf(p)) : 0), 0),
    pairs,
  }
}

// Ohne Angabe die Startwerte 1 bis 10 und zwei festgehaltene, an denen die Mutationsprobe der
// Nachprüfungen von #233 je eine Rücknahme findet, die die ersten zehn nicht finden (16: Storno nach
// Abschluss der Heizperiode der Positionen; 81: Schätzfaktor). Ein Storno neben einer Schätzung (M2) und
// die Lücke nach einem Storno (G1) sieht die Invariante nicht, weil am Ende jede Schätzung von einer echten
// Rechnung abgedeckt sein muss; dafür stehen Einzeltests in calc-fuel.test.ts. Mit INV_FROM/INV_TO ein
// Bereich, z. B. INV_TO=60.
const SEEDS: number[] = process.env.INV_FROM !== undefined || process.env.INV_TO !== undefined
  ? Array.from({ length: Math.max(0, Number(process.env.INV_TO ?? 10) - Number(process.env.INV_FROM ?? 1) + 1) }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
  : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 81]
const STEPS = Number(process.env.INV_STEPS ?? 30)

type Variant = { name: string; lazy: boolean; estimate: boolean }
const VARIANTS: Variant[] = [
  { name: 'Grundform', lazy: false, estimate: false },
  { name: 'Rechnung kommt später', lazy: true, estimate: false },
  { name: 'Abschluss mit Schätzung', lazy: true, estimate: true },
]

for (const variant of VARIANTS) {
  for (const seed of SEEDS) {
    test(`Invariante, ${variant.name} (Startwert ${seed}): jede Rechnung genau einmal verteilt`, async () => {
      const rnd = zufall(seed * 7 + (variant.lazy ? 1 : 0) + (variant.estimate ? 2 : 0))
      const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
      const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-inv-'))
      const opened = await openDatabase({ dataDir })
      try {
        const deliveries: { id: string; from: string; to: string }[] = []
        const all: { id: string; from: string; to: string }[] = []
        const pending: { id: string; body: Record<string, unknown> }[] = []
        await opened.write(async (db) => {
          await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
          await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
          await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
          await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
          await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
          await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
          let start = variant.estimate ? '2024-05-01' : isoOf(Date.UTC(2024, 1, 1) + int(0, 120) * DAY)
          for (let k = 0; k < 3; k++) {
            const to = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 800) - 1) * DAY)
            const body = { label: `Rechnung ${k}`, invoiceFrom: start, invoiceTo: to, fixedCents: rnd() < 0.5 ? int(0, 20000) : null }
            all.push({ id: `d${k}`, from: start, to })
            if (!variant.lazy || k === 0) {
              await createDelivery(db, `d${k}`, 'hp', body)
              deliveries.push({ id: `d${k}`, from: start, to })
            } else {
              pending.push({ id: `d${k}`, body })
            }
            start = isoOf(Date.parse(`${to}T00:00:00Z`) + DAY)
          }
        })
        const keys: string[] = []
        for (let p = periodContaining(MAI, all[0]?.from ?? ''); p.from <= (all[2]?.to ?? ''); p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
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
        const unlinkedFrom = new Map<string, string>()
        const positionsIn = async (key: string) => (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY && c.period === key).reduce((a, c) => a + c.amountCents, 0)
        const link = (id: string, d: { id: string; to: string }, amountCents: number, key: 'area' | 'units') => {
          const owner = periodContaining(MAI, d.to)
          return opened.write((db) => createEntity(db, 'costItems', id, {
            propertyId: 'objekt-1', period: owner.key, category: HEATING_CATEGORY, description: id, amountCents, key,
            heatingPlantId: 'hp', fuelDeliveryId: d.id, taxYear: Number(owner.to.slice(0, 4)),
          }))
        }
        const arrive = async (next: { id: string; body: Record<string, unknown> }, mark: string) => {
          await opened.write((db) => createDelivery(db, next.id, 'hp', next.body))
          const a = all.find((x) => x.id === next.id)
          if (a) deliveries.push(a)
          log.push(`${mark} ${next.id}`)
        }
        for (let step = 0; step < STEPS; step++) {
          const op = pick(['link', 'link', 'link', 'credit', 'unlink', 'delete', 'close', 'close', 'reopen', 'amount', 'arrive', 'relink', 'storno'] as const)
          const d = pick(deliveries)
          if (!d) continue
          const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.fuelDeliveryId === d.id)
          if (op === 'arrive') {
            const next = pending.shift()
            if (next) await arrive(next, 'arrive')
          } else if (op === 'amount') {
            const c = pick(items)
            if (!c) continue
            const amountCents = rnd() < 0.15 ? 0 : c.amountCents < 0 ? -int(1000, 40000) : int(100000, 900000)
            await attempt(`amount ${c.id}=${amountCents}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { amountCents })))
          } else if (op === 'link' || op === 'credit') {
            const positive = items.filter((c) => c.amountCents > 0).reduce((a, c) => a + c.amountCents, 0)
            if (op === 'credit' && (positive === 0 || items.filter((c) => c.amountCents < 0).length >= 2)) continue
            const id = `p${n++}`
            // Eine Gutschrift ist meist klein, manchmal ein Storno bis zum ganzen Betrag (W1).
            const amountCents = op === 'credit' ? (rnd() < 0.3 ? -positive : -int(1000, 40000)) : int(100000, 900000)
            await attempt(`${op} ${id}→${d.id}=${amountCents}`, () => link(id, d, amountCents, rnd() < 0.5 ? 'area' : 'units'))
          } else if (op === 'unlink' || op === 'delete') {
            const credits = items.filter((x) => x.amountCents < 0)
            const c = pick(credits.length > 0 ? credits : items)
            if (!c) continue
            await attempt(`${op} ${c.id}`, () => (op === 'delete' ? opened.write((db) => removeEntity(db, 'costItems', c.id)) : opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: null }))))
            if (op === 'unlink') unlinkedFrom.set(c.id, d.id)
          } else if (op === 'storno') {
            // Die Rechnung storniert: eine Gutschrift über die Summe ihrer Positionen, danach ergeben sie 0
            // (W1, auch nach dem Abschluss einer der Heizperioden, auch neben einer Schätzung).
            const T = items.reduce((a, c) => a + c.amountCents, 0)
            if (T <= 0) continue
            const id = `p${n++}`
            await attempt(`storno ${id}→${d.id}=${-T}`, () => link(id, d, -T, rnd() < 0.5 ? 'area' : 'units'))
          } else if (op === 'relink') {
            // Eine gelöste Position wieder mit ihrer Lieferung verknüpfen, auch nach einem Abschluss dazwischen.
            const all = await opened.read((db) => readCostItems(db))
            const c = pick(all.filter((x) => x.fuelDeliveryId == null && unlinkedFrom.has(x.id)))
            const to = c ? unlinkedFrom.get(c.id) : undefined
            if (!c || !to) continue
            await attempt(`relink ${c.id}→${to}`, () => opened.write((db) => updateEntity(db, 'costItems', c.id, { fuelDeliveryId: to })))
          } else if (op === 'close') {
            const key = pick(keys)
            if (!key) continue
            const here = await positionsIn(key)
            await attempt(`close ${key}`, () => opened.write(async (db) => {
              if (await findClosedSettlement(db, 'objekt-1', periodKey(key))) return
              atClose.set(key, here)
              await db.transaction(async (tx) => {
                let settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
                if (variant.estimate && fuelGapQuestions(settlement).length > 0 && rnd() < 0.7) {
                  const made = await createEstimates(tx, settlement, () => `e${n++}`)
                  log.push(`estimate ${made.join('+')}`)
                  settlement = computeSettlement(snapshotFor(await readStock(tx), 'objekt-1', periodOf(key)), {})
                }
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
        if (variant.estimate) {
          // Am Ende kommen alle Rechnungen und werden verknüpft, wo es geht; dann ist jede Schätzung durch
          // eine echte Rechnung ersetzt oder ihr Teil als Abweichung ausgewiesen.
          for (const next of pending.splice(0)) await arrive(next, 'arrive*')
          for (const d of deliveries) {
            const its = (await opened.read((db) => readCostItems(db))).filter((c) => c.fuelDeliveryId === d.id)
            if (its.reduce((a, c) => a + c.amountCents, 0) > 0) continue
            const id = `p${n++}`
            await attempt(`link* ${id}→${d.id}`, () => link(id, d, int(100000, 900000), 'area'))
          }
        }
        const fall = `${variant.name}, Startwert ${seed}: ${JSON.stringify(all.map((d) => [d.from, d.to]))} ${log.join(', ')}`
        const stock = await opened.read((db) => readStock(db))
        const closed = await opened.read((db) => readClosedSettlements(db))
        const items = (await opened.read((db) => readCostItems(db))).filter((c) => c.category === HEATING_CATEGORY)
        let positions = 0
        let tenants = 0
        let landlord = 0
        const pairs = new Map<string, { carry: number; flagged: number }>()
        let up = 0
        let down = 0
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
          for (const [k, v] of t.pairs) {
            const acc = pairs.get(k) ?? { carry: 0, flagged: 0 }
            acc.carry += v.carry
            acc.flagged += v.flagged
            pairs.set(k, acc)
          }
          up += t.up
          down += t.down
        }
        // (i) durch den Aufbau
        assert.equal(tenants + landlord, positions, `${fall}; (i)`)
        const deliveriesNow = await opened.read((db) => readFuelDeliveries(db))
        const estimates = deliveriesNow.filter((x) => x.estimated)
        // Eine stornierte Rechnung (Positionen ergeben 0 oder weniger) ersetzt keine Schätzung (Nachprüfung, M2).
        const linkedReal = deliveries.filter((d) => items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0) > 0)
        const coveredDay = (day: string) => linkedReal.some((d) => d.from <= day && day <= d.to)
        const estimatesCovered = estimates.every((e) => coveredDay(e.invoiceFrom ?? '') && coveredDay(e.invoiceTo ?? ''))
        if (estimates.length === 0 || estimatesCovered) {
          assert.ok(tenants >= positions - up, `${fall}; (vii) Mieter ${tenants} < Positionen ${positions} − ausgewiesen ${up}`)
          assert.ok(tenants <= positions - down, `${fall}; (ii) Mieter ${tenants} > Positionen ${positions} + ausgewiesen ${-down}`)
        }
        // (iii) je Lieferung und Paar von Heizperioden: Die Gegenbuchungen heben sich auf, oder ein
        // ausgewiesener Teil deckt sie genau (Nachprüfung von 47f2373, H1: über alle Lieferungen summiert
        // deckte ein berechtigter Teil einer Lieferung die falsche Gegenbuchung einer anderen).
        if (estimates.length === 0) {
          for (const [k, v] of pairs) assert.ok(v.carry === 0 || v.carry === -v.flagged, `${fall}; (iii) ${k}: Gegenbuchungen ${v.carry}, ausgewiesen ${v.flagged}`)
        }
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
}
