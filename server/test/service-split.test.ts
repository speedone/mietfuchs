// Aufteilen einer kalten Rechnung nach Tagen (#208, Entwurf 3.4). Reine Funktion; das Schreiben
// prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseDescription, splitByService, splitDeductionsAlike, type ServicePart } from '../src/serviceSplit.ts'
import type { PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

test('Grundsteuer 2025 über 480 € bei Mai bis April: 157,81 € und 322,19 € (Entwurf 3.4)', () => {
  const parts = splitByService(MAI, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.days, p.amountCents, p.description]), [
    ['2024-05', 120, 15781, 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'],
    ['2025-05', 245, 32219, 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)'],
  ])
})

test('Nach einem Wechsel heißt derselbe Rumpf 2025-01 (F18)', () => {
  const parts = splitByService(WECHSEL, { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents]), [['2025-01', 15781], ['2025-05', 32219]])
})

test('Summe exakt, §35a im selben Verhältnis, Restcent nach der Kennung', () => {
  const parts = splitByService(MAI, { id: 'h', description: 'Hauswart', amountCents: 100000, labor35aCents: 60000, serviceFrom: '2025-03-01', serviceTo: '2025-06-30' })
  // März und April: 61 Tage, Mai und Juni: 61 Tage, also je die Hälfte.
  assert.deepEqual(parts.map((p) => [p.amountCents, p.labor35aCents]), [[50000, 30000], [50000, 30000]])
  const drei = splitByService(MAI, { id: 'x', description: 'X', amountCents: 100, serviceFrom: '2025-04-30', serviceTo: '2025-05-01' })
  assert.deepEqual(drei.map((p) => p.amountCents), [50, 50])
  assert.equal(drei.reduce((a, p) => a + p.amountCents, 0), 100)
})

test('Eine Gutschrift bleibt in jedem Teil negativ, die Summe stimmt (Review Focus 2)', () => {
  const parts = splitByService(MAI, { id: 'gs', description: 'Gutschrift Versicherung', amountCents: -10001, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  assert.ok(parts.every((p) => p.amountCents < 0), 'jeder Teil negativ')
  assert.equal(parts.reduce((a, p) => a + p.amountCents, 0), -10001)
  assert.ok(parts.every((p) => p.labor35aCents === null), 'kein §35a an einer Gutschrift')
})

test('Ein Leistungszeitraum in einem einzigen Zeitraum ergibt einen Teil ohne Zusatz', () => {
  const parts = splitByService(MAI, { id: 'w', description: 'Wasser', amountCents: 9000, serviceFrom: '2025-05-01', serviceTo: '2026-04-30' })
  assert.deepEqual(parts.map((p) => [p.period.key, p.amountCents, p.description]), [['2025-05', 9000, 'Wasser']])
})

test('Ein zweites Aufteilen hängt keinen zweiten Zusatz an', () => {
  assert.equal(baseDescription('Grundsteuer 2025 (anteilig 01.01.–30.04.2025)'), 'Grundsteuer 2025')
  assert.equal(baseDescription('Grundsteuer 2025'), 'Grundsteuer 2025')
})

// ---------- Abzüge des Betriebsstroms wie ihre Rechnung (Folge-PR zu #252, Geld-H1, F7) ----------

const teile = (beträge: readonly number[], tage: readonly number[] = beträge.map(() => 100)): ServicePart[] =>
  beträge.map((amountCents, i) => ({
    period: { key: `2025-${String(i + 1).padStart(2, '0')}`, from: '2025-01-01', to: '2025-01-31', short: false } as ServicePart['period'],
    days: tage[i] ?? 100, amountCents, labor35aCents: null, description: `Hausstrom (anteilig ${i})`,
  }))

test('Ein Abzug teilt sich nach den Beträgen der Teile: 100 € und 900 € aus 1.000 € wie bisher nach Tagen', () => {
  const r = teile([32877, 67123], [120, 245])
  assert.deepEqual(splitDeductionsAlike([{ id: 'a', description: 'Abzug', amountCents: -10000 }], r)[0]?.map((p) => p.amountCents), [-3288, -6712])
  assert.deepEqual(splitDeductionsAlike([{ id: 'a', description: 'Abzug', amountCents: -90000 }], r)[0]?.map((p) => p.amountCents), [-29589, -60411])
})

test('H1: zwei Abzüge zusammen gleich der Rechnung: je Teil genau die Rechnung, Restcent nach Kennung', () => {
  const r = teile([32877, 67123], [120, 245])
  const [d1, d2] = splitDeductionsAlike([{ id: 'd1', description: 'Abzug 1', amountCents: -50000 }, { id: 'd2', description: 'Abzug 2', amountCents: -50000 }], r)
  assert.deepEqual(d1?.map((p) => p.amountCents), [-16439, -33561])
  assert.deepEqual(d2?.map((p) => p.amountCents), [-16438, -33562])
})

// Eigenschaften über ganze Zahlen (fester Startwert): je Teil höchstens die Rechnung, jeder Abzug genau sein Betrag,
// jeder Teil genau die gemeinsame Quote, kein Vorzeichenwechsel; auch bei drei und vier Teilen und wenn die Abzüge die
// ganze Rechnung ergeben. Nach Tagen geteilt bräche die erste Eigenschaft (Alabama-Paradox, Geldprüfung F7).
test('Eigenschaften: Σ Abzüge je Teil ≤ Teil der Rechnung, Zeilen- und Spaltensummen, Vorzeichen', () => {
  let seed = 20261011
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  for (let fall = 0; fall < 4000; fall++) {
    const anzahl = 1 + rnd(4)
    const tage = Array.from({ length: anzahl }, () => 1 + rnd(200))
    const rechnung = 1 + rnd(200000)
    const summeTage = tage.reduce((a, t) => a + t, 0)
    // Die Teile der Rechnung nach Tagen (wie splitByService), mit Restcent an den größten Rest.
    const roh = tage.map((t) => (rechnung * t) / summeTage)
    const beträge = roh.map(Math.floor)
    let rest = rechnung - beträge.reduce((a, b) => a + b, 0)
    for (const i of roh.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
      if (rest-- <= 0) break
      beträge[i] = (beträge[i] ?? 0) + 1
    }
    const zahl = 1 + rnd(3)
    const gesamt = rnd(3) === 0 ? rechnung : rnd(rechnung + 1)
    const abzüge: number[] = []
    let offen = gesamt
    for (let j = 0; j < zahl; j++) {
      const c = j === zahl - 1 ? offen : rnd(offen + 1)
      abzüge.push(c)
      offen -= c
    }
    const r = teile(beträge, tage)
    const out = splitDeductionsAlike(abzüge.map((c, j) => ({ id: `d${j}`, description: 'Abzug', amountCents: -c || 0 })), r)
    abzüge.forEach((c, j) => {
      const zeile = out[j] ?? assert.fail('Zeile fehlt')
      assert.equal(zeile.reduce((a, p) => a + p.amountCents, 0), -c || 0, `Fall ${fall}: Abzug ${j} ergibt nicht seinen Betrag`)
      assert.ok(zeile.every((p) => p.amountCents <= 0 && Number.isInteger(p.amountCents)), `Fall ${fall}: Vorzeichen`)
    })
    beträge.forEach((b, k) => {
      const spalte = -out.reduce((a, z) => a + (z[k]?.amountCents ?? 0), 0)
      assert.ok(spalte <= b, `Fall ${fall}: aus Teil ${k} (${b}) sind ${spalte} abgezogen`)
    })
    if (gesamt === rechnung) beträge.forEach((b, k) => assert.equal(-out.reduce((a, z) => a + (z[k]?.amountCents ?? 0), 0), b, `Fall ${fall}: Teil ${k} nicht genau`))
  }
})
