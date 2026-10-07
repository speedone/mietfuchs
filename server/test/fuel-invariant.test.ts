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
// Heizung PR 9: Die Variante „Zwei Anlagen“ rechnet dasselbe mit zwei Anlagen in einem Objekt (Haus A mit den
// Wohnungen A und B, Haus B mit C), je mit eigenen Rechnungen. Dazu wird geprüft, dass jede Lieferung nur im
// Ausweis ihrer eigenen Anlage steht und jede Gegenbuchung je Abrechnung genau einmal vorkommt (je Anlage und
// Lieferung genau einmal verteilt), und dass je Anlage die Zeilen ihre Positionen ergeben.
//
// Heizung PR 10: Die Varianten „Eigene Heizkostenabrechnung“ rechnen dasselbe mit einer Anlage, die selbst nach
// der Heizkostenverordnung abrechnet (Wärmezähler je Wohnung, Ablesungen an jeder Grenze, Positionen nach
// Heizkostenverordnung). Dazu je Abrechnung über die Kernrechnung: (s1) die Gewichte der Nutzer verteilen
// jeden Topf ganz (Σ der Topfbeträge im Ausweis = Kosten des Topfs, je Nutzer höchstens 1 ct Rundung), keine
// Position steht wegen der Anlage beim Vermieter, und der Leerstand wird nie negativ; (s2) je Lieferung über
// alle Heizperioden: Σ der Zeilen ihrer Positionen und Überträge (ohne Gegenbuchungen) = Σ ihrer Positionen,
// jede Lieferung also genau einmal verbraucht. Die Mutationsproben stehen im PR.
//
// Heizung PR 11: Zwei Varianten rechnen den Warmwasseranteil nach der Volumen- und nach der Flächenformel
// (§ 9 Abs. 2 Satz 2 und 4 HeizkostenV), mit Gas nach Brennwert (Faktor 1,11) oder nach Heizwert. Dazu (s4):
// Die Wärme für das Warmwasser im Ausweis ist die der Formel, mit Faktor nur bei Brennwert, und α mal der
// Energie der Rechnungen in der Heizperiode ergibt genau sie; (s3) prüft daneben, dass der Topf Warmwasser
// α der Kosten trägt, und (i) und (s2), dass trotzdem jede Rechnung genau einmal verteilt ist.
//
// Feste Startwerte, im Lauf der Tests wenige; mehr mit INV_FROM/INV_TO (siehe SEEDS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { computeSettlement } from '../src/calc.ts'
import { createHeatingPlant, replaceHeatingPlant, updateHeatingPlant } from '../src/db/heating.ts'
import { setUpSelf } from '../src/db/heatingSelf.ts'
import { saveHotWater } from '../src/db/co2.ts'
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

function totals(s: unknown): { tenants: number; landlord: number; carry: number; up: number; down: number; pairs: Map<string, { carry: number; flagged: number; estimate: boolean }> } {
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
  const pairs = new Map<string, { carry: number; flagged: number; estimate: boolean }>()
  for (const r of rows) {
    const key = pairOf(r !== null && typeof r === 'object' ? Reflect.get(r, 'costItemId') : undefined)
    if (!key) continue
    const acc = pairs.get(key) ?? { carry: 0, flagged: 0, estimate: false }
    for (const p of list(r, 'landlordParts')) {
      if (reasonOf(p) === 'fuelEstimateDiff') acc.estimate = true
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

type Variant = { name: string; lazy: boolean; estimate: boolean; two?: boolean; swap?: boolean; self?: boolean; hw?: 'combined' | 'separate'; dhw?: 'volumeFormula' | 'areaFormula' }
const VARIANTS: Variant[] = [
  { name: 'Grundform', lazy: false, estimate: false },
  { name: 'Rechnung kommt später', lazy: true, estimate: false },
  { name: 'Abschluss mit Schätzung', lazy: true, estimate: true },
  { name: 'Zwei Anlagen', lazy: false, estimate: false, two: true },
  // Durchsicht von #238, I3: Gas wird an einem Tag durch Fernwärme ersetzt; die Rechnungen danach kommen
  // erst nach dem Tausch und gehören der neuen Anlage.
  { name: 'Kesseltausch', lazy: true, estimate: false, swap: true },
  // Heizung PR 10: eigene Heizkostenabrechnung, mit und ohne Schätzung beim Abschluss.
  { name: 'Eigene Heizkostenabrechnung', lazy: false, estimate: false, self: true },
  { name: 'Eigene Heizkostenabrechnung mit Schätzung', lazy: true, estimate: true, self: true },
  // Durchsicht von #239: mit Warmwasser, verbunden (Warmwasseranteil aus dem Speicherzähler) und getrennt
  // (Positionen nur für Heizung oder nur für Warmwasser).
  { name: 'Eigene Heizkostenabrechnung, verbundenes Warmwasser', lazy: false, estimate: false, self: true, hw: 'combined' },
  { name: 'Eigene Heizkostenabrechnung, getrenntes Warmwasser', lazy: false, estimate: false, self: true, hw: 'separate' },
  // Heizung PR 11: Warmwasseranteil nach einer Formel (§ 9 Abs. 2 HeizkostenV).
  { name: 'Eigene Heizkostenabrechnung, Warmwasser nach Volumenformel', lazy: false, estimate: false, self: true, hw: 'combined', dhw: 'volumeFormula' },
  { name: 'Eigene Heizkostenabrechnung, Warmwasser nach Flächenformel', lazy: true, estimate: false, self: true, hw: 'combined', dhw: 'areaFormula' },
]

// Wie oft die eigene Heizkostenabrechnung wirklich verteilt hat (Abdeckung, letzter Test).
const SELF = { periods: 0, distributed: 0, alpha: 0, formula: 0 }

// Heizung PR 11, (s4): Bei einer Formel ist die Wärme für das Warmwasser im Ausweis Q = 2,5 · V · (t − 10)
// bzw. 32 · A (die beiden Wohnungen haben zusammen 100 m², jede Heizperiode hat zwölf Monate), bei Gas nach
// Brennwert mal 1,11, nach Heizwert ohne Faktor (§ 9 Abs. 2 Satz 6 Nr. 1), und α mal der Energie der Rechnungen
// in der Heizperiode (Bewertung der Lieferungen) ergibt genau dieses Q.
function dhwChecks(r: ReturnType<typeof computeSettlement>, input: { method: 'volumeFormula' | 'areaFormula'; volumeM3: number; tempC: number; basis: 'hs' | 'hi' }, where: string): void {
  const h = r.heating?.find((x) => x.plantId === 'hp')
  const self = h?.self
  if (!self?.ok || !self.alpha || !self.dhw) return
  SELF.formula++
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${where}: (s4) ${what}: ${a} statt ${b}`)
  const q0 = input.method === 'volumeFormula' ? 2.5 * input.volumeM3 * (input.tempC - 10) : 32 * 100
  const q = input.basis === 'hs' ? q0 * 1.11 : q0
  assert.equal(self.dhw.method, input.method, `${where}: (s4) Verfahren`)
  near(self.dhw.formulaKwh ?? Number.NaN, q0, 'Formelwert')
  near(self.dhw.heatKwh, q, 'Wärme nach dem Faktor')
  assert.equal(self.dhw.factor?.kind ?? null, input.basis === 'hs' ? 'gasCalorific' : null, `${where}: (s4) Faktor`)
  const energy = (h?.fuel?.deliveries ?? []).reduce((a, l) => a + (l.energyKwh ?? 0), 0)
  near((self.alpha.percent / 100) * energy, q, 'α · Energie der Rechnungen')
}

// Heizung PR 9: Wem gehört eine Zeile? Übertrag und Gegenbuchung der Lieferung, CO₂-Zeilen dem Topf, sonst der
// Position.
const plantOfRow = (id: string, itemPlant: ReadonlyMap<string, string>, deliveryPlant: ReadonlyMap<string, string>): string | undefined => {
  const [kind, ref] = id.split(':')
  if (kind === 'fuel') return deliveryPlant.get(ref ?? '')
  if (kind === 'co2' || kind === 'stock') return ref
  return itemPlant.get(id)
}

// Je Abrechnung (auch eingefroren): Jede Lieferung steht nur im Ausweis ihrer Anlage, und keine Gegenbuchung
// kommt zweimal vor.
function onceEach(s: unknown, deliveryPlant: ReadonlyMap<string, string>, where: string): void {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  for (const h of arr(s, 'heating')) {
    for (const line of arr(g(h, 'fuel'), 'deliveries')) {
      const owner = deliveryPlant.get(String(g(line, 'deliveryId')))
      assert.equal(owner, g(h, 'plantId'), `${where}: Lieferung ${String(g(line, 'deliveryId'))} im Ausweis von ${String(g(h, 'plantId'))}`)
    }
  }
  const ids = arr(g(s, 'landlord'), 'rows').map((r) => String(g(r, 'costItemId'))).filter((id) => id.startsWith('fuel:'))
  assert.equal(new Set(ids).size, ids.length, `${where}: Gegenbuchung doppelt: ${ids.join(', ')}`)
}

// Heizung PR 10, (s1): Die Kernrechnung verteilt jeden Topf ganz. Der Ausweis nennt je Nutzer den Topfbetrag
// (Kosten des Topfs × Gewicht, auf den Cent gerundet); zusammen sind sie die Kosten des Topfs, je Nutzer
// höchstens ein halber Cent daneben. Keine Position der Anlage geht ohne Grund an den Vermieter, und der Rest
// beim Vermieter (Leerstand) wird nie negativ.
//
// (s3), Durchsicht von #239: Bei verbundenem Warmwasser (alle Positionen „Heizung und Warmwasser“) trägt der Topf
// Warmwasser den Warmwasseranteil α = gemessene Wärme am Speicher / Energie des Brennstoffs, der Topf Heizung
// den Rest; eine Vertauschung von α und 1 − α fällt hier auf, denn Σ Zeilen = Σ Positionen hielte sie aus.
function selfChecks(r: ReturnType<typeof computeSettlement>, items: readonly { id: string; key: string; amountCents: number; heatingTarget?: string | null }[], where: string): void {
  const self = r.heating?.find((h) => h.plantId === 'hp')?.self
  const mine = items.filter((c) => c.key === 'heatingSystem')
  if (!self || mine.length === 0) return
  SELF.periods++
  if (!self.ok) return
  SELF.distributed++
  for (const pot of self.pots) {
    const users = self.units.flatMap((u) => u.users)
    const sum = users.reduce((a, u) => a + (pot.pot === 'heating' ? u.heatingCents : u.waterCents), 0)
    assert.ok(Math.abs(sum - pot.costCents) <= users.length, `${where}: (s1) Topf ${pot.pot}: Σ Nutzer ${sum}, Kosten ${pot.costCents}`)
  }
  if (self.alpha && mine.every((c) => c.heatingTarget === 'both')) {
    SELF.alpha++
    const a = self.alpha.dhwHeatKwh / self.alpha.referenceKwh
    const cost = (p: string) => self.pots.find((x) => x.pot === p)?.costCents ?? 0
    const total = cost('heating') + cost('water')
    assert.ok(Math.abs(cost('water') - a * total) <= 1, `${where}: (s3) Warmwasser ${cost('water')} statt α ${a.toFixed(4)} × ${total}`)
  }
  for (const row of r.landlord.rows.filter((x) => mine.some((c) => c.id === x.costItemId))) {
    for (const p of row.landlordParts ?? []) {
      assert.ok(p.reason !== 'noBasis', `${where}: (s1) ${row.costItemId} ohne Verteilung beim Vermieter`)
      assert.ok(p.reason !== 'vacancy' || p.cents * Math.sign(row.totalCents || 1) >= -1, `${where}: (s1) negativer Leerstand ${p.cents} bei ${row.costItemId}`)
    }
  }
}

// Heizung PR 10, (s2): Zeilen einer Lieferung in einer Abrechnung (auch eingefroren): Mieter- und Vermieterzeilen
// ihrer Positionen und ihrer Übertragszeilen (`fuel:<Lieferung>:…:<Position>`), ohne die Gegenbuchungen.
function rowsOfDelivery(s: unknown, deliveryId: string, own: ReadonlySet<string>): number {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const belongs = (id: string): boolean => own.has(id) || (id.startsWith(`fuel:${deliveryId}:`) && id.split(':').length > 4)
  const tenants = arr(s, 'statements').flatMap((st) => arr(st, 'rows')).filter((r) => belongs(String(g(r, 'costItemId')))).reduce<number>((a, r) => a + n(g(r, 'shareCents')), 0)
  const landlord = arr(g(s, 'landlord'), 'rows').filter((r) => belongs(String(g(r, 'costItemId')))).reduce<number>((a, r) => a + n(g(r, 'shareCents')), 0)
  return tenants + landlord
}

// Die Beträge der Positionen einer Lieferung, wie die Abrechnung sie verteilt hat (eine eingefrorene mit dem
// Betrag beim Abschluss): je Position einmal ihr `totalCents`.
function totalsOfDelivery(s: unknown, own: ReadonlySet<string>): number {
  const g = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? Reflect.get(o, k) : undefined)
  const arr = (o: unknown, k: string): unknown[] => { const v = g(o, k); return Array.isArray(v) ? v : [] }
  const seen = new Map<string, number>()
  for (const r of [...arr(s, 'statements').flatMap((st) => arr(st, 'rows')), ...arr(g(s, 'landlord'), 'rows')]) {
    const id = String(g(r, 'costItemId'))
    const total = g(r, 'totalCents')
    if (own.has(id) && typeof total === 'number') seen.set(id, total)
  }
  return [...seen.values()].reduce((a, v) => a + v, 0)
}

// Wie oft der Tausch in der Variante „Kesseltausch“ gelang (Abdeckung, letzter Test).
const SWAPS = { runs: 0, done: 0 }

for (const variant of VARIANTS) {
  for (const seed of SEEDS) {
    test(`Invariante, ${variant.name} (Startwert ${seed}): jede Rechnung genau einmal verteilt`, async () => {
      const rnd = zufall(seed * 7 + (variant.lazy ? 1 : 0) + (variant.estimate ? 2 : 0))
      const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
      // Heizung PR 11: Gas nach Brennwert oder nach Heizwert, für alle Rechnungen eines Laufs gleich, je nach
      // Startwert abwechselnd (der erste Wert der Zufallsfolge liegt bei kleinen Startwerten immer unter 0,5).
      const dhwBasis: 'hs' | 'hi' = seed % 2 === 0 ? 'hs' : 'hi'
      const dhwInputs = new Map<string, { volumeM3: number; tempC: number }>()
      const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)]
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fuel-inv-'))
      const opened = await openDatabase({ dataDir })
      try {
        const deliveries: { id: string; from: string; to: string; plantId: string }[] = []
        const all: { id: string; from: string; to: string; plantId: string }[] = []
        const pending: { id: string; plantId: string; body: Record<string, unknown> }[] = []
        await opened.write(async (db) => {
          await db.update(properties).set({ periodStartMonth: 5 }).where(eq(properties.id, 'objekt-1'))
          await createEntity(db, 'units', 'a', { propertyId: 'objekt-1', name: 'A', areaM2: 60, participates: true })
          await createEntity(db, 'units', 'b', { propertyId: 'objekt-1', name: 'B', areaM2: 40, participates: true })
          await createEntity(db, 'tenancies', 'ta', { unitId: 'a', tenantName: 'Mieter A', persons: 1, start: '2020-01-01' })
          await createEntity(db, 'tenancies', 'tb', { unitId: 'b', tenantName: 'Mieter B', persons: 1, start: '2020-01-01' })
          if (variant.two) {
            await createEntity(db, 'units', 'c', { propertyId: 'objekt-1', name: 'C', areaM2: 50, participates: true })
            await createEntity(db, 'tenancies', 'tc', { unitId: 'c', tenantName: 'Mieter C', persons: 1, start: '2020-01-01' })
            await createHeatingPlant(db, 'hp', 'objekt-1', { name: 'Haus A', energy: 'gas', method: 'manual', units: [{ unitId: 'a', heatedAreaM2: null }, { unitId: 'b', heatedAreaM2: null }] })
            await createHeatingPlant(db, 'hp2', 'objekt-1', { buildingWith: 'own', name: 'Haus B', energy: 'gas', method: 'manual', units: [{ unitId: 'c', heatedAreaM2: null }] })
          } else {
            await createHeatingPlant(db, 'hp', 'objekt-1', { energy: 'gas', method: 'manual' })
          }
          // Heizung PR 10: Die Anlage rechnet selbst ab; Wärmezähler je Wohnung, kein zentrales Warmwasser.
          if (variant.self) {
            let m = 0
            const hw = variant.hw ?? 'none'
            await setUpSelf(db, 'hp', { period: '2023-05', heatConsumptionPct: int(50, 70), ...(hw !== 'none' ? { waterConsumptionPct: int(50, 70) } : {}), insulationRule: 'notApplies', hotWater: hw, capture: 'heatMeter', dhwHeatMeter: hw === 'combined' }, '2023-01-01', () => `wz${m++}`)
          }
          for (const plantId of variant.two ? ['hp', 'hp2'] : ['hp']) {
            let start = variant.estimate ? '2024-05-01' : isoOf(Date.UTC(2024, 1, 1) + int(0, 120) * DAY)
            const prefix = plantId === 'hp' ? 'd' : 'e'
            for (let k = 0; k < 3; k++) {
              const to = isoOf(Date.parse(`${start}T00:00:00Z`) + (int(300, 800) - 1) * DAY)
              const body = { label: `Rechnung ${prefix}${k}`, invoiceFrom: start, invoiceTo: to, fixedCents: rnd() < 0.5 ? int(0, 20000) : null, ...(variant.hw === 'combined' ? { energyKwh: int(20000, 60000) } : {}), ...(variant.dhw ? { gasBasis: dhwBasis } : {}) }
              // Kesseltausch: Die Rechnungen ab der zweiten gehören der neuen Anlage.
              const owner = variant.swap && k > 0 ? 'hp2' : plantId
              all.push({ id: `${prefix}${k}`, from: start, to, plantId: owner })
              if (!variant.lazy || k === 0) {
                await createDelivery(db, `${prefix}${k}`, plantId, body)
                deliveries.push({ id: `${prefix}${k}`, from: start, to, plantId })
              } else {
                pending.push({ id: `${prefix}${k}`, plantId: owner, body })
              }
              start = isoOf(Date.parse(`${to}T00:00:00Z`) + DAY)
            }
          }
        })
        const deliveryPlant = new Map(all.map((d) => [d.id, d.plantId]))
        const itemPlant = new Map<string, string>()
        const keys: string[] = []
        const firstFrom = all.reduce((a, d) => (d.from < a ? d.from : a), all[0]?.from ?? '')
        const lastTo = all.reduce((a, d) => (d.to > a ? d.to : a), '')
        for (let p = periodContaining(MAI, firstFrom); p.from <= lastTo; p = periodContaining(MAI, isoOf(Date.parse(`${p.to}T00:00:00Z`) + DAY))) keys.push(p.key)
        const periodOf = (key: string) => periodOfKey(MAI, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
        // Heizung PR 10: Ablesungen an jeder Grenze, je Wohnung ein steigender Stand.
        if (variant.self) {
          // Durchsicht von #239: dazu die Warmwasserzähler und der Wärmezähler am Speicher.
          const meters = (await opened.read((db) => readStock(db))).meters.filter((x) => (x.type === 'waerme' && x.unitId !== null) || (variant.hw && x.type === 'warmwasser') || x.heatingRole === 'dhwHeat')
          await opened.write(async (db) => {
            for (const meter of meters) {
              let value = 0
              const first = periodOf(keys[0] ?? '')
              await createEntity(db, 'readings', `${meter.id}@0`, { meterId: meter.id, date: isoOf(Date.parse(`${first.from}T00:00:00Z`) - DAY), value })
              for (const key of keys) {
                value += meter.type === 'warmwasser' ? int(5, 50) : meter.heatingRole === 'dhwHeat' ? int(1000, 6000) : int(1000, 9000)
                await createEntity(db, 'readings', `${meter.id}@${key}`, { meterId: meter.id, date: periodOf(key).to, value })
              }
            }
          })
        }
        // Heizung PR 11: Warmwasser nach einer Formel, je Heizperiode Volumen und Temperatur; die Anlage erzeugt
        // die Wärme allein.
        if (variant.dhw) {
          const method = variant.dhw
          await opened.write((db) => updateHeatingPlant(db, 'hp', { heatGeneration: 'single' }))
          for (const key of keys) {
            const input = { volumeM3: int(10, 60), tempC: int(45, 60) }
            dhwInputs.set(key, input)
            await opened.write((db) => saveHotWater(db, 'hp', key, { dhwMethod: method, dhwUnmeasurable: true, ...(method === 'volumeFormula' ? { dhwVolumeM3: input.volumeM3, dhwTempC: input.tempC } : {}) }))
          }
        }
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
        const link = async (id: string, d: { id: string; to: string; plantId: string }, amountCents: number, key: 'area' | 'units') => {
          const owner = periodContaining(MAI, d.to)
          // Mit zwei Anlagen verteilt jede Position nur über die Wohnungen ihrer Anlage.
          const participants = variant.two ? { participantUnitIds: d.plantId === 'hp' ? ['a', 'b'] : ['c'] } : {}
          const target = variant.hw === 'combined' ? 'both' : variant.hw === 'separate' ? (rnd() < 0.5 ? 'heating' : 'water') : 'heating'
          const selfKey = variant.self ? { key: 'heatingSystem', heatingPart: 'fuel', heatingTarget: target } : { key }
          const made = await opened.write((db) => createEntity(db, 'costItems', id, {
            propertyId: 'objekt-1', period: owner.key, category: HEATING_CATEGORY, description: id, amountCents,
            heatingPlantId: d.plantId, fuelDeliveryId: d.id, taxYear: Number(owner.to.slice(0, 4)), ...participants, ...selfKey,
          }))
          itemPlant.set(id, d.plantId)
          return made
        }
        // Der Tausch am ersten Tag der zweiten Rechnung; er kann abgelehnt werden (abgeschlossene Heizperiode).
        let swapped = false
        if (variant.swap) SWAPS.runs++
        const swapDate = all[1]?.from ?? ''
        const replace = async (mark: string) => {
          if (!variant.swap || swapped) return
          try {
            await opened.write((db) => replaceHeatingPlant(db, 'hp', 'hp2', { date: swapDate, energy: 'districtHeating', name: 'Fernwärme', previousName: 'Gas' }))
            swapped = true
            SWAPS.done++
            log.push(`${mark} ${swapDate}`)
          } catch (err) {
            if (!rejected(err)) throw err
          }
        }
        const arrive = async (next: { id: string; plantId: string; body: Record<string, unknown> }, mark: string) => {
          if (next.plantId === 'hp2' && variant.swap) {
            await replace('replace')
            if (!swapped) return
          }
          await opened.write((db) => createDelivery(db, next.id, next.plantId, next.body))
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
            const next = pending[0]
            if (next) await arrive(next, 'arrive')
            if (next && deliveries.some((x) => x.id === next.id)) pending.shift()
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
        if (variant.swap) for (const next of [...pending]) {
          await arrive(next, 'arrive*')
          if (deliveries.some((x) => x.id === next.id)) pending.splice(pending.indexOf(next), 1)
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
        // Eine Anlage, die die Kernrechnung nicht verteilt (Warmwasseranteil ohne vollständige Rechnungen),
        // gibt alles an den Vermieter; die Schranken (ii) und (vii) gelten dann nicht (Durchsicht von #239).
        let selfBlocked = false
        let tenants = 0
        let landlord = 0
        const pairs = new Map<string, { carry: number; flagged: number; estimate: boolean }>()
        let up = 0
        let down = 0
        const live = new Map<string, ReturnType<typeof computeSettlement>>()
        for (const key of keys) {
          const stored = closed.find((c) => c.period === key)
          const r = stored ? null : computeSettlement(snapshotFor(stock, 'objekt-1', periodOf(key)), {})
          if (r) live.set(key, r)
          const t = totals(stored ? stored.settlement : r)
          if (variant.two || (variant.swap && swapped)) {
            onceEach(stored ? stored.settlement : r, deliveryPlant, `${fall}; ${key}`)
            // Kesseltausch: Die neue Anlage zeigt keine Lücke vor dem Tausch, und keine Anlage steht in einem
            // Zeitraum, in dem sie nicht heizt.
            if (r && variant.swap) {
              const gaps = r.heating?.find((h) => h.plantId === 'hp2')?.fuel?.gaps ?? []
              assert.ok(gaps.every((g) => g.from >= swapDate), `${fall}; Lücke der neuen Anlage vor dem Tausch in ${key}: ${JSON.stringify(gaps)}`)
              for (const h of r.heating ?? []) {
                const p = periodOf(key)
                const alive = h.plantId === 'hp' ? p.from < swapDate : p.to >= swapDate
                assert.ok(alive || !h.fuel, `${fall}; ${h.plantId} rechnet Lieferungen in ${key}, obwohl sie dort nicht heizt`)
              }
            }
            if (r) {
              // Je Anlage ergeben ihre Zeilen ihre Positionen.
              for (const plantId of ['hp', 'hp2']) {
                const rows: { costItemId: string; shareCents: number }[] = [...r.statements.flatMap((st) => st.rows), ...r.landlord.rows].filter((row) => plantOfRow(row.costItemId, itemPlant, deliveryPlant) === plantId)
                const mine = items.filter((c) => c.period === key && c.heatingPlantId === plantId).reduce((a, c) => a + c.amountCents, 0)
                assert.equal(rows.reduce((a, row) => a + row.shareCents, 0), mine, `${fall}; Zeilen von ${plantId} in ${key}`)
              }
            }
          }
          if (r && variant.self) selfChecks(r, items.filter((c) => c.period === key), `${fall}; ${key}`)
          const dhwInput = dhwInputs.get(key)
          if (r && variant.dhw && dhwInput) dhwChecks(r, { method: variant.dhw, ...dhwInput, basis: dhwBasis }, `${fall}; ${key}`)
          if (r && variant.self && r.heating?.find((h) => h.plantId === 'hp')?.self?.ok === false) selfBlocked = true
          // Heizung PR 11: auch eine abgeschlossene Heizperiode, in der die Anlage nicht verteilt war (etwa eine
          // Lücke in den Rechnungen, die der Warmwasseranteil nach einer Formel nicht überbrückt).
          if (stored && variant.self) {
            const heating: unknown = Reflect.get(Object(stored.settlement), 'heating')
            if (Array.isArray(heating) && heating.some((x: unknown) => Reflect.get(Object(x), 'plantId') === 'hp' && Reflect.get(Object(Reflect.get(Object(x), 'self')), 'ok') === false)) selfBlocked = true
          }
          const here = stored ? (atClose.get(key) ?? assert.fail(`${fall}; ${key} ohne Stand beim Abschluss`)) : items.filter((c) => c.period === key).reduce((a, c) => a + c.amountCents, 0)
          assert.equal(t.tenants + t.landlord, here, `${fall}; Σ Zeilen in ${key}`)
          positions += here
          tenants += t.tenants
          landlord += t.landlord
          for (const [k, v] of t.pairs) {
            const acc = pairs.get(k) ?? { carry: 0, flagged: 0, estimate: false }
            acc.carry += v.carry
            acc.flagged += v.flagged
            acc.estimate ||= v.estimate
            pairs.set(k, acc)
          }
          up += t.up
          down += t.down
        }
        // (i) durch den Aufbau
        assert.equal(tenants + landlord, positions, `${fall}; (i)`)
        // (s2) Heizung PR 10: jede Lieferung genau einmal, über alle Heizperioden (ohne Schätzungen und
        // ohne ausgewiesene Teile, wie (iii); abgeschlossene mit ihrem eingefrorenen Stand).
        if (variant.self) {
          const flaggedAny = [...pairs.values()].some((v) => v.flagged !== 0 || v.estimate)
          const estimatesNow = (await opened.read((db) => readFuelDeliveries(db))).filter((x) => x.estimated)
          if (!flaggedAny && estimatesNow.length === 0) {
            for (const d of deliveries) {
              const own = new Set(items.filter((c) => c.fuelDeliveryId === d.id).map((c) => c.id))
              let rows = 0
              let T = 0
              for (const key of keys) {
                const s = closed.find((c) => c.period === key)?.settlement ?? live.get(key)
                rows += rowsOfDelivery(s, d.id, own)
                T += totalsOfDelivery(s, own)
              }
              assert.equal(rows, T, `${fall}; (s2) Lieferung ${d.id}: Zeilen ${rows}, Positionen ${T}`)
            }
          }
        }
        const deliveriesNow = await opened.read((db) => readFuelDeliveries(db))
        const estimates = deliveriesNow.filter((x) => x.estimated)
        // Eine stornierte Rechnung (Positionen ergeben 0 oder weniger) ersetzt keine Schätzung (Nachprüfung, M2).
        const linkedReal = deliveries.filter((d) => items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0) > 0)
        const coveredDay = (day: string) => linkedReal.some((d) => d.from <= day && day <= d.to)
        const estimatesCovered = estimates.every((e) => coveredDay(e.invoiceFrom ?? '') && coveredDay(e.invoiceTo ?? ''))
        if ((estimates.length === 0 || estimatesCovered) && !selfBlocked) {
          assert.ok(tenants >= positions - up, `${fall}; (vii) Mieter ${tenants} < Positionen ${positions} − ausgewiesen ${up}`)
          assert.ok(tenants <= positions - down, `${fall}; (ii) Mieter ${tenants} > Positionen ${positions} + ausgewiesen ${-down}`)
        }
        // (iii) je Lieferung und Paar von Heizperioden: Die Gegenbuchungen heben sich auf, oder ein
        // ausgewiesener Teil deckt sie genau (Nachprüfung von 47f2373, H1: über alle Lieferungen summiert
        // deckte ein berechtigter Teil einer Lieferung die falsche Gegenbuchung einer anderen). Ausgelassen
        // sind nur die Paare einer Schätzung und die, in denen eine Rechnung eine Schätzung ersetzt
        // (`fuelEstimateDiff`): Dort steht die Gegenbuchung der Schätzung unter deren Kennung, nicht unter der
        // der Rechnung (Nachprüfung von 5bee89f, M-a).
        const estimateIds = new Set(estimates.map((e) => e.id))
        for (const [k, v] of pairs) {
          if (v.estimate || estimateIds.has(k.split('|')[0] ?? '')) continue
          assert.ok(v.carry === 0 || v.carry === -v.flagged, `${fall}; (iii) ${k}: Gegenbuchungen ${v.carry}, ausgewiesen ${v.flagged}`)
        }
        // Zuordnung (I1): eine mit 0 eingefrorene Heizperiode bekommt trotzdem ihren Teil hinausgebucht.
        const frozen = await opened.read((db) => readFuelCarryFrozen(db))
        for (const d of deliveries) {
          const owner = periodContaining(MAI, d.to).key
          const T = items.filter((c) => c.fuelDeliveryId === d.id).reduce((a, c) => a + c.amountCents, 0)
          const r = live.get(owner)
          if (!r || T === 0) continue
          for (const f of frozen.filter((x) => x.deliveryId === d.id && x.cents === 0 && x.period !== owner && closed.some((c) => c.period === x.period))) {
            const carry = r.heating?.find((h) => h.plantId === d.plantId)?.fuel?.carries.find((c) => c.deliveryId === d.id && c.period === f.period)
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

test('Invariante, eigene Heizkostenabrechnung: Abdeckung', () => {
  if (process.env.INV_LOG) console.log('Eigene Abrechnung', JSON.stringify(SELF))
  if (SELF.periods < 10) return
  assert.ok(SELF.alpha > 0, 'kein Lauf mit Warmwasseranteil geprüft (s3)')
  assert.ok(SELF.formula > 0, 'kein Lauf mit Warmwasseranteil nach einer Formel geprüft (s4)')
  assert.ok(SELF.distributed * 2 >= SELF.periods, `nur ${SELF.distributed} von ${SELF.periods} Heizperioden nach der Verordnung verteilt`)
})

test('Invariante, Kesseltausch: Abdeckung', () => {
  if (SWAPS.runs < 10) return
  assert.ok(SWAPS.done * 3 >= SWAPS.runs * 2, `nur ${SWAPS.done} von ${SWAPS.runs} Läufen getauscht`)
})
