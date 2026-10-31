// Gesamtsicht über alle Objekte (#96 PR 3, Entwurf docs/superpowers/specs/2026-10-30-steuer-objekt-ruecklage-design.md,
// Teil C; Release-Plan X9 c, Invariante I4) über Zufallsbestände mit festem Startwert: der Generator der Steuer
// (testing/taxStock.ts) mit zwei oder drei Objekten, Zahlungen jeder schiefen Art samt Zehn-Tage-Regel und Angehörigen
// (`withPaymentVariety`), zufälliger Verteilung nach § 82b EStDV samt Ende am Objekt, dazu ein Objekt nur mit Leerstand
// und Werbungskosten und ein leeres Objekt.
//
// I4 Je Objekt und Jahr sind die Zahlen der Gesamtsicht genau die der Steuerseite des Objekts (`taxReportFor`, wie die
//    Route /api/taxreport): Einnahmen = Zeile 32 (`received.totalCents`), die Zeilen dazu, Werbungskosten nach Raten,
//    privat, unentgeltlich, verschoben, Rücklage, Überschuss `surplusReceivedCents`, Soll. Die Summe ist die Summe der
//    Objekte. Die laufende Nummer zählt nur Objekte mit Vermietung (`hasRental`), lückenlos in der Reihenfolge der Objekte.
//
// Startwerte über INV_FROM/INV_TO, Vorgabe 1 bis 12.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReportFor } from '../src/calc.ts'
import { taxOverview } from '../src/taxOverview.ts'
import { allowsSpread } from '../../shared/spread.ts'
import { incomeLines } from '../../shared/taxIncomeLines.ts'
import type { PropertyKind, SpreadYears, TaxOverviewSums, TaxReport } from '../../shared/types.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, TAX_STOCK_SECOND, TAX_STOCK_YEARS, withExtraProperty, withPaymentVariety, withSecondProperty, type TaxSource } from '../testing/taxStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 12)
const N: readonly SpreadYears[] = [2, 3, 4, 5]
const VACANT = 'objekt-leerstand'
const EMPTY = 'objekt-leer'

type Listed = { id: string; name: string; kind: PropertyKind }
type Stock = { source: TaxSource; properties: Listed[] }

function stock(seed: number): Stock {
  const rnd = makeRng(seed * 65_537 + 11)
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rnd() * xs.length))] as T
  const two = withSecondProperty(randomTaxStock(makeRng(seed)), makeRng(seed * 31 + 3))
  const third = seed % 2 === 0 ? withExtraProperty(two, makeRng(seed * 37 + 5), 'objekt-3', 'c-') : two
  const varied = withPaymentVariety(third.source, seed)
  const restOf = (): { spreadRestYear?: number } => (rnd() < 0.3 ? { spreadRestYear: 2024 + Math.floor(rnd() * 6) } : {})
  // Leerstand mit Vermietungsabsicht: eine Wohnung ohne Mietverhältnis, eine Reparatur, die abziehbar ist (R-C).
  const vacantItems = TAX_STOCK_YEARS.filter(() => rnd() < 0.5).map((y) => ({
    id: `leer-${y}`, propertyId: VACANT, period: `${y}-01`, category: 'Nicht umlagefähig', description: `Malerarbeiten ${y}`,
    amountCents: 50_000 + Math.floor(rnd() * 400_000), key: 'area' as const,
  }))
  const source = {
    ...varied,
    properties: [
      ...(varied.properties ?? []).map((p) => ({ ...p, ...restOf() })),
      { id: VACANT, kind: 'etw', cableBuiltBeforeDec2021: null },
      { id: EMPTY, kind: 'sonstiges', cableBuiltBeforeDec2021: null },
    ],
    units: [...varied.units, { id: 'leer-u', propertyId: VACANT, name: 'ETW', areaM2: 70, participates: true }],
    costItems: [...varied.costItems, ...vacantItems].map((c) => (allowsSpread(c) && rnd() < 0.5 ? { ...c, spreadYears: pick(N) } : c)),
  } as TaxSource
  const ids = [TAX_STOCK_PROPERTY, TAX_STOCK_SECOND, ...(seed % 2 === 0 ? ['objekt-3'] : [])]
  // Die Reihenfolge der Objekte wie in der Datenbank (Anlage); das leere Objekt bewusst in der Mitte, damit die Nummer
  // es überspringt.
  const properties: Listed[] = [
    { id: ids[0] ?? assert.fail('erstes Objekt'), name: 'Haus A', kind: 'mfh' },
    { id: EMPTY, name: 'Garagen', kind: 'sonstiges' },
    ...ids.slice(1).map((id, k) => ({ id, name: `Haus ${String.fromCharCode(66 + k)}`, kind: 'mfh' as const })),
    { id: VACANT, name: 'Wohnung leer', kind: 'etw' },
  ]
  return { source, properties }
}

const sumsOf = (r: TaxReport): TaxOverviewSums => {
  const lines = incomeLines(r) ?? assert.fail('ohne Zeilen')
  return {
    incomeCents: r.income.received?.totalCents ?? assert.fail('ohne received'),
    incomeLines: lines,
    sollCents: r.income.sollCents,
    expensesTotalCents: r.expenses.totalCents,
    privateCents: r.expenses.privateCents,
    gratuitousCents: r.expenses.gratuitousCents ?? 0,
    deferredCents: r.expenses.deferredCents ?? 0,
    deductibleCents: r.expenses.deductibleCents,
    reserveContributionCents: r.reserveContributionCents,
    surplusCents: r.surplusReceivedCents ?? assert.fail('ohne surplusReceivedCents'),
    surplusSollCents: r.surplusSollCents,
  }
}

// Feld für Feld summiert, die Zeilen ebenso.
const addSums = (a: TaxOverviewSums, b: TaxOverviewSums): TaxOverviewSums => {
  const lines = { ...a.incomeLines }
  for (const k of Object.keys(lines) as (keyof typeof lines)[]) lines[k] += b.incomeLines[k]
  const out = { ...a, incomeLines: lines }
  for (const k of Object.keys(out) as (keyof TaxOverviewSums)[]) if (k !== 'incomeLines') out[k] = a[k] + b[k]
  return out
}

test('I4: Gesamtsicht je Objekt = Steuerseite des Objekts, Summe = Σ Objekte, Nummer nur mit Vermietung', () => {
  const seen = { forward: 0, fromPrevious: 0, relatives: 0, deferredOut: 0, deferredIn: 0, vacantNumbered: 0, emptyNeutral: 0, differsByDate: 0 }
  for (let seed = FROM; seed <= TO; seed++) {
    const { source, properties } = stock(seed)
    for (const year of TAX_STOCK_YEARS) {
      const at = `Startwert ${seed}, ${year}`
      const overview = taxOverview(source, properties, year)
      assert.equal(overview.year, year)
      assert.deepEqual(overview.rows.map((r) => r.propertyId), properties.map((p) => p.id), `${at}: Reihenfolge der Objekte`)
      let total: TaxOverviewSums | null = null
      let number = 0
      for (const row of overview.rows) {
        const listed = properties.find((p) => p.id === row.propertyId) ?? assert.fail('Objekt')
        assert.equal(row.name, listed.name)
        assert.equal(row.kind, listed.kind)
        if (!row.ok) assert.fail(`${at} ${row.propertyId}: ${row.error}`)
        const report = taxReportFor(source, row.propertyId, year)
        const expected = sumsOf(report)
        assert.deepEqual(row.sums, expected, `${at} ${row.propertyId}`)
        assert.equal(row.sums.incomeLines.totalCents, row.sums.incomeCents, `${at} ${row.propertyId}: Zeilen = Zeile 32`)
        assert.equal(row.sums.surplusCents, row.sums.incomeCents - row.sums.deductibleCents, `${at} ${row.propertyId}: Überschuss`)
        const hasRental = report.costModels.tenancies > 0 || expected.incomeCents !== 0 || report.income.paidCents !== 0 || expected.deductibleCents !== 0
        assert.equal(row.hasRental, hasRental, `${at} ${row.propertyId}: hasRental`)
        assert.equal(row.number, hasRental ? ++number : null, `${at} ${row.propertyId}: laufende Nummer`)
        total = total === null ? row.sums : addSums(total, row.sums)
        const turn = report.income.received?.turnOfYear
        if (turn && turn.forwardCents !== 0) seen.forward++
        if (turn && turn.fromPreviousCents !== 0) seen.fromPrevious++
        if (row.sums.incomeLines.relatives !== 0) seen.relatives++
        if (row.sums.deferredCents > 0) seen.deferredOut++
        if (row.sums.deferredCents < 0) seen.deferredIn++
        if (row.propertyId === VACANT && row.number !== null) seen.vacantNumbered++
        if (row.propertyId === EMPTY && row.number === null) seen.emptyNeutral++
        if (report.surplusPaidCents !== report.surplusReceivedCents) seen.differsByDate++
      }
      assert.deepEqual(overview.totals, total, `${at}: Summe`)
    }
  }
  // Die schiefen Fälle kommen wirklich vor, sonst prüfte die Invariante nur den geraden Weg.
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `nie gesehen: ${k}`)
})

test('Ein Objekt mit Fehler: Zeile mit Meldung, nicht in der Summe, ohne Nummer; die übrigen rechnen weiter', () => {
  const { source, properties } = stock(3)
  const year = 2025
  const broken = TAX_STOCK_SECOND
  const reportOf: typeof taxReportFor = (src, pid, y, parts, options) => {
    if (pid === broken) throw new Error('Die Position x ist im Jahr 2025 nur mit einem Teilbetrag abgeflossen; das rechnet die Steuerübersicht noch nicht.')
    return taxReportFor(src, pid, y, parts, options)
  }
  const overview = taxOverview(source, properties, year, reportOf)
  const bad = overview.rows.find((r) => r.propertyId === broken) ?? assert.fail('Zeile fehlt')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /Teilbetrag/)
  const good = overview.rows.flatMap((r) => (r.ok ? [r] : []))
  assert.equal(good.length, properties.length - 1)
  const expected = good.map((r) => sumsOf(taxReportFor(source, r.propertyId, year))).reduce(addSums)
  assert.deepEqual(overview.totals, expected)
  assert.deepEqual(good.filter((r) => r.hasRental).map((r) => r.number), good.filter((r) => r.hasRental).map((_, k) => k + 1), 'lückenlos ohne das Objekt mit Fehler')
})

test('Ohne Objekt: leere Liste, Summe 0', () => {
  const overview = taxOverview({ ...stock(1).source }, [], 2025)
  assert.deepEqual(overview.rows, [])
  assert.equal(overview.totals.incomeCents, 0)
  assert.equal(overview.totals.incomeLines.totalCents, 0)
  assert.equal(overview.totals.surplusCents, 0)
})

// Grobe Schranke gegen Rückfälle (Entwurf Teil C): zehn Objekte mit Verteilung, je Objekt ein Bericht samt Rückgriffen
// auf die Jahre des Abflusses (`received: false`).
test('Zehn Objekte mit Verteilung: die Gesamtsicht bleibt unter einer Sekunde', () => {
  let s = randomTaxStock(makeRng(5))
  for (let k = 2; k <= 10; k++) s = withExtraProperty(s, makeRng(5 * 97 + k), `objekt-${k}`, `o${k}-`)
  const source = { ...s.source, costItems: s.source.costItems.map((c) => (allowsSpread(c) ? { ...c, spreadYears: 5 as const } : c)) } as TaxSource
  const properties: Listed[] = Array.from({ length: 10 }, (_, k) => ({ id: `objekt-${k + 1}`, name: `Haus ${k + 1}`, kind: 'mfh' }))
  assert.ok(source.costItems.filter((c) => c.spreadYears !== undefined).length >= 10, 'genug verteilte Positionen')
  taxOverview(source, properties, 2027) // aufwärmen
  const t0 = performance.now()
  const overview = taxOverview(source, properties, 2027)
  const ms = performance.now() - t0
  assert.equal(overview.rows.filter((r) => r.ok).length, 10)
  assert.ok(ms < 1000, `${Math.round(ms)} ms`)
})
