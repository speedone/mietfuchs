// Aufteilen einer kalten Rechnung nach Tagen (#208, Entwurf 3.4). Reine Funktion; das Schreiben
// prüft db-aufteilen.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseDescription, deriveSourceParts, splitByService, splitDeductionsAlike, splitPoolsByDays, type ServicePart } from '../src/serviceSplit.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { periodsBetween, formatDayRange } from '../../shared/period.ts'
import { largestRemainder } from '../src/calc.ts'

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
    // Die Hälfte der Fälle mit winzigen Rechnungen: Dort treten Rundungsfälle auf, die große Beträge verbergen.
    const rechnung = rnd(2) === 0 ? 1 + rnd(20) : 1 + rnd(200000)
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

// Gegenbeispiele aus der Mutationsprüfung, je von Hand nachvollziehbar.
test('Nach Tagen läge ein Teil über der Rechnung: 4 Cent über 10/31/30 Tage (0/2/2), Abzug 3 Cent nach Beträgen 0/2/1', () => {
  // Nach Tagen: 3 × 10/71 = 0,42, 3 × 31/71 = 1,31, 3 × 30/71 = 1,27 → 0 + 1 + 1, Restcent an 0,42 → 1/1/1, also 1 Cent
  // aus einem Teil, der 0 Cent beträgt. Nach Beträgen: 0, 1,5, 1,5 → 0/1/1, Restcent nach der Reihenfolge → 0/2/1.
  const out = splitDeductionsAlike([{ id: 'a', description: 'Abzug', amountCents: -3 }], teile([0, 2, 2], [10, 31, 30]))
  assert.deepEqual(out[0]?.map((p) => p.amountCents), [0, -2, -1])
})

test('Teilschritt 2 nach dem Rest, nicht nach dem ursprünglichen Betrag: drei Teile zu 1 Cent, zwei Abzüge zu 1 Cent', () => {
  // Gemeinsam 2 Cent → 1/1/0. Teil 1: Quoten 0,5 / 0,5, Restcent nach Kennung an d0 → d0 1, d1 0. Teil 2: übrig sind
  // d0 0 und d1 1 → d1 1. Nach dem ursprünglichen Betrag bekäme d0 auch in Teil 2 den Cent und im letzten Teil −1.
  const [d0, d1] = splitDeductionsAlike([{ id: 'd0', description: 'Abzug', amountCents: -1 }, { id: 'd1', description: 'Abzug', amountCents: -1 }], teile([1, 1, 1]))
  assert.deepEqual(d0?.map((p) => p.amountCents), [-1, 0, 0])
  assert.deepEqual(d1?.map((p) => p.amountCents), [0, -1, 0])
})

// Eingefrorene Kopie von splitByService vor #455 (nur im Test), gegen die ein Span geprüft wird.
function frozenSplit(rules: PeriodRules, item: { id: string; description: string; amountCents: number; labor35aCents?: number; serviceFrom: string; serviceTo: string }): ServicePart[] {
  const dayCount = (f: string, t: string): number => Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000) + 1
  const periods = periodsBetween(rules, item.serviceFrom, item.serviceTo)
  const spans = periods.map((p) => ({ from: p.from > item.serviceFrom ? p.from : item.serviceFrom, to: p.to < item.serviceTo ? p.to : item.serviceTo }))
  const weights = spans.map((s) => dayCount(s.from, s.to))
  const keys = periods.map((p) => `${item.id}|${p.key}`)
  const split = (total: number): number[] => {
    const sum = weights.reduce((a, w) => a + w, 0)
    const sign = total < 0 ? -1 : 1
    const abs = Math.abs(total)
    return largestRemainder(abs, weights.map((w) => (abs * w) / sum), keys).map((c) => sign * c || 0)
  }
  const amounts = split(item.amountCents)
  const labor = item.labor35aCents && item.amountCents > 0 ? split(item.labor35aCents) : null
  const base = baseDescription(item.description)
  return periods.map((period, i) => ({
    period,
    days: weights[i] ?? 0,
    amountCents: amounts[i] ?? 0,
    labor35aCents: labor ? labor[i] ?? 0 : null,
    description: periods.length > 1 ? `${base} (anteilig ${formatDayRange(spans[i]?.from ?? '', spans[i]?.to ?? '')})` : item.description,
  }))
}

// Die Spanne eines Teils (`span`, Befund 3 zu #455) kannte der eingefrorene Stand nicht; verglichen wird ohne sie.
const bare = (parts: ServicePart[]): ServicePart[] => parts.map(({ span: _span, ...p }) => p)

test('deriveSourceParts: Ein Span ergibt genau splitByService (F18 und 300 Zufallsfälle)', () => {
  const f18 = { id: 'g', description: 'Grundsteuer 2025', amountCents: 48000, serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }
  assert.deepEqual(bare(splitByService(MAI, f18)), frozenSplit(MAI, f18))
  assert.deepEqual(bare(splitByService(WECHSEL, f18)), frozenSplit(WECHSEL, f18))
  let seed = 455455
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const ruleSets: PeriodRules[] = [MAI, WECHSEL, { startMonth: 1, changes: [] }, { startMonth: 7, changes: ['2026-01'] }]
  for (let i = 0; i < 300; i++) {
    const rules = ruleSets[next(ruleSets.length)] ?? MAI
    const from = new Date(Date.UTC(2024, 0, 1) + next(900) * 86400000)
    const to = new Date(from.getTime() + next(900) * 86400000)
    const iso = (d: Date): string => d.toISOString().slice(0, 10)
    const sign = next(4) === 0 ? -1 : 1
    const item = {
      id: `p${next(1000)}`,
      description: next(2) ? 'Grundsteuer' : 'Hauswart (anteilig 01.01.–30.04.2025)',
      amountCents: sign * (1 + next(500000)),
      ...(next(2) ? { labor35aCents: next(100000) } : {}),
      serviceFrom: iso(from),
      serviceTo: iso(to),
    }
    const expected = frozenSplit(rules, item)
    assert.deepEqual(bare(splitByService(rules, item)), expected)
    assert.deepEqual(
      bare(deriveSourceParts(rules, { tieId: item.id, description: item.description, amountCents: item.amountCents, ...('labor35aCents' in item ? { labor35aCents: item.labor35aCents } : {}), spans: [{ from: item.serviceFrom, to: item.serviceTo }], marked: false })),
      expected,
    )
  }
})

test('deriveSourceParts: Spannen mit Lücke, die Lücke bekommt nichts', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2025-05', '2025-09'] }
  const parts = deriveSourceParts(rules, {
    tieId: 'q',
    description: 'Grundsteuer 2025',
    amountCents: 100000,
    spans: [{ from: '2025-01-01', to: '2025-04-30' }, { from: '2025-09-01', to: '2025-12-31' }],
    marked: true,
  })
  assert.deepEqual(parts.map((p) => p.period.key), ['2025-01', '2025-09'])
  assert.deepEqual(parts.map((p) => p.days), [120, 122])
  assert.equal(parts.reduce((a, p) => a + p.amountCents, 0), 100000)
})

test('deriveSourceParts: marked trägt den Zusatz auch an einem einzigen Ergebnis', () => {
  const invoice = { tieId: 'm', description: 'Wasser', amountCents: 9000, spans: [{ from: '2025-05-01', to: '2025-12-31' }] }
  assert.equal(deriveSourceParts(MAI, { ...invoice, marked: false })[0]?.description, 'Wasser')
  assert.equal(deriveSourceParts(MAI, { ...invoice, marked: true })[0]?.description, 'Wasser (anteilig 01.05.–31.12.2025)')
})

test('deriveSourceParts: Gutschrift und Lohnanteil wie splitByService', () => {
  const spans = [{ from: '2025-01-01', to: '2025-12-31' }]
  const credit = deriveSourceParts(MAI, { tieId: 'gs', description: 'Gutschrift', amountCents: -10001, labor35aCents: 5000, spans, marked: false })
  assert.ok(credit.every((p) => p.amountCents < 0 && p.labor35aCents === null))
  assert.equal(credit.reduce((a, p) => a + p.amountCents, 0), -10001)
  const labor = deriveSourceParts(MAI, { tieId: 'h', description: 'Hauswart', amountCents: 100000, labor35aCents: 60000, spans: [{ from: '2025-03-01', to: '2025-06-30' }], marked: false })
  assert.deepEqual(labor.map((p) => [p.amountCents, p.labor35aCents]), [[50000, 30000], [50000, 30000]])
})

// splitPoolsByDays (#478): Teile verschiedener Jahre aus einer Quelle, je Zeitraum nach Tagen als eine Rechnung.
const POOL_RULES: PeriodRules = { startMonth: 1, changes: [] }
const HALF_1 = { from: '2025-01-01', to: '2025-06-30' }
const HALF_2 = { from: '2025-07-01', to: '2025-12-31' }

// Durchsicht #478, Befund 3: Ist die Summe aller Jahre nicht positiv (ein Teil zur Gutschrift berichtigt), trägt die
// Teilung als Ganzes keinen Lohnanteil (§ 35a nur an einer Rechnung). Dann bleibt jedes Jahr bei seiner eigenen
// Teilung; vorher verlor ein Jahr mit Lohnanteil diesen ganz.
test('splitPoolsByDays: Lohnanteil eines Jahres geht nicht verloren, wenn die Summe aller Jahre nicht positiv ist', () => {
  const invoice = (amountCents: number, labor: number, spans: { from: string; to: string }[]) =>
    deriveSourceParts(POOL_RULES, { tieId: 'q', description: 'Hausmeister', amountCents, ...(labor ? { labor35aCents: labor } : {}), spans, marked: true })
  const a = { amountCents: 10000, labor35aCents: 3000, span: HALF_1 }
  const b = { amountCents: -12000, labor35aCents: 0, span: HALF_2 }
  const whole = invoice(-2000, 3000, [HALF_1, HALF_2])
  const pools = [{ members: [a], parts: invoice(10000, 3000, [HALF_1]) }, { members: [b], parts: invoice(-12000, 0, [HALF_2]) }]
  const out = splitPoolsByDays(whole, pools, 'q')
  const labor = (out ?? pools.map((p) => p.parts)).flat().reduce((s, p) => s + (p.labor35aCents ?? 0), 0)
  assert.equal(labor, 3000)
})

// Durchsicht #478, Befund 7: Haben die Teile eines Jahres verschiedene Vorzeichen, gibt es keine Teilung ohne
// Vorzeichenwechsel; `null`, der Wechsel bleibt bei der Teilung je Jahr.
test('splitPoolsByDays: gemischte Vorzeichen in einem Jahr ergeben null', () => {
  const invoice = (amountCents: number, spans: { from: string; to: string }[]) =>
    deriveSourceParts(POOL_RULES, { tieId: 'q', description: 'Wasser', amountCents, spans, marked: true })
  const whole = invoice(5000, [HALF_1, HALF_2])
  const pools = [
    { members: [{ amountCents: 8000, labor35aCents: 0, span: HALF_1 }, { amountCents: -1000, labor35aCents: 0, span: HALF_2 }], parts: invoice(7000, [HALF_1, HALF_2]) },
    { members: [{ amountCents: -2000, labor35aCents: 0, span: HALF_2 }], parts: invoice(-2000, [HALF_2]) },
  ]
  assert.equal(splitPoolsByDays(whole, pools, 'q'), null)
})

test('splitPoolsByDays: je Zeitraum die Teilung nach Tagen, je Jahr die Summe', () => {
  const invoice = (amountCents: number, spans: { from: string; to: string }[]) =>
    deriveSourceParts(POOL_RULES, { tieId: 'q', description: 'Wasser', amountCents, spans, marked: true })
  const span = { from: '2024-11-01', to: '2025-10-31' }
  const whole = invoice(50001, [span])
  const pools = [
    { members: [{ amountCents: 20000, labor35aCents: 0, span }], parts: invoice(20000, [span]) },
    { members: [{ amountCents: 30001, labor35aCents: 0, span }], parts: invoice(30001, [span]) },
  ]
  const out = splitPoolsByDays(whole, pools, 'q') ?? assert.fail('keine Teilung')
  assert.deepEqual(out.map((parts) => parts.reduce((s, p) => s + p.amountCents, 0)), [20000, 30001])
  assert.deepEqual(whole.map((w) => out.reduce((s, parts) => s + (parts.find((p) => p.period.key === w.period.key)?.amountCents ?? 0), 0)), whole.map((w) => w.amountCents))
})

// Durchsicht #478, Befund 6: Verschiedene Sätze je Tag. Jedes Jahr bleibt in den Zeiträumen seiner Tage.
test('splitPoolsByDays: ein Jahr bekommt kein Geld in einem Zeitraum ohne seine Tage', () => {
  const halves: PeriodRules = { startMonth: 1, changes: ['2025-07'] }
  const invoice = (amountCents: number, spans: { from: string; to: string }[]) =>
    deriveSourceParts(halves, { tieId: 'q', description: 'Wasser', amountCents, spans, marked: true })
  const whole = invoice(50000, [HALF_1, HALF_2])
  assert.deepEqual(whole.map((p) => p.period.key), ['2025-01', '2025-07'])
  const pools = [
    { members: [{ amountCents: 20000, labor35aCents: 0, span: HALF_1 }], parts: invoice(20000, [HALF_1]) },
    { members: [{ amountCents: 30000, labor35aCents: 0, span: HALF_2 }], parts: invoice(30000, [HALF_2]) },
  ]
  const out = splitPoolsByDays(whole, pools, 'q') ?? assert.fail('keine Teilung')
  assert.deepEqual(out.map((parts) => parts.filter((p) => p.amountCents !== 0).map((p) => [p.period.key, p.amountCents])), [[['2025-01', 20000]], [['2025-07', 30000]]])
})
