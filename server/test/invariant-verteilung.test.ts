// Invarianten der Verteilung nach § 82b EStDV (#262 PR 1) über Zufallsbestände mit festem Startwert (`randomTaxStock`:
// Kalenderjahr, Mai bis April, Wechsel des Rhythmus, Heizanlagen, Eigennutzung, Gutschriften, Rücklage) und über den
// Prüfkatalog der Abrechnung.
//
// V1 Die Abrechnung liest die Wahl nie (Durchsicht K-b, seit PR 2 I-6 des Entwurfs): Mit einer Wahl an jeder Position,
//    auch an solchen, die sie nicht erlauben (Ablage von Hand), und einem Ende am Objekt sind jede Abrechnung, das
//    Mietkonto und die Verbrauchsübersicht gleich wie ohne; der Prüfkatalog bleibt centgenau bei seiner Handrechnung.
//    Die Steuer rechnet die Wahl seit PR 2 (invariant-steuer-verteilung.test.ts).
// V2 Die Rückfrage nennt das Jahr, das die Steuer nimmt (Durchsicht K-c): Das erste Jahr der Verteilung in den Sätzen
//    von `spreadQuestions` ist für jede Position, die verteilt werden kann, das Jahr aus `outflowShares` mit dem
//    wirklichen Zeitraum der Position, auch bei Zeiträumen, die nicht dem Kalenderjahr folgen.
//
// Startwerte über INV_FROM/INV_TO, Vorgabe 1 bis 60.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, consumptionOverview, rentLedger } from '../src/calc.ts'
import { outflowShares } from '../src/outflow.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { allowsSpread, spreadQuestions } from '../../shared/spread.ts'
import type { CostItem, SpreadYears } from '../../shared/types.ts'
import { actualOf, loadFixtures } from '../testing/fixtures.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, TAX_STOCK_YEARS, type TaxSource } from '../testing/taxStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 60)

const YEARS: readonly SpreadYears[] = [2, 3, 4, 5]

const spread = <S extends { costItems: readonly Pick<CostItem, 'category' | 'amountCents' | 'operatingPower'>[] }>(src: S, seed: number, all = false): { src: S; count: number } => {
  let count = 0
  const costItems = src.costItems.map((c, i) => {
    if (!all && !allowsSpread(c)) return c
    count++
    return { ...c, spreadYears: YEARS[(seed + i) % YEARS.length] }
  })
  return { src: { ...src, costItems }, count }
}

test('V1: eine Wahl an jeder Position und ein Ende am Objekt ändern weder Abrechnung noch Mietkonto noch Verbrauch', () => {
  let spreadCount = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const { source, periods } = randomTaxStock(makeRng(seed * 7919))
    const { src, count } = spread<TaxSource>(source, seed, true)
    const after = { ...src, properties: (src.properties ?? []).map((p) => ({ ...p, spreadRestYear: 2025 + (seed % 4) })) }
    spreadCount += count
    for (const p of periods) {
      const a = snapshotFor(after, TAX_STOCK_PROPERTY, p)
      const b = snapshotFor(source, TAX_STOCK_PROPERTY, p)
      assert.deepEqual(computeSettlement(a), computeSettlement(b), `Startwert ${seed}, ${p.key}`)
      assert.deepEqual(rentLedger(a), rentLedger(b), `Startwert ${seed}, ${p.key}: Mietkonto`)
      assert.deepEqual(consumptionOverview(a), consumptionOverview(b), `Startwert ${seed}, ${p.key}: Verbrauch`)
    }
  }
  assert.ok(spreadCount > 20, `zu wenige verteilte Positionen (${spreadCount})`)
})

test('V1: der Prüfkatalog bleibt mit einer Wahl an jeder Position, die sie erlaubt, bei seiner Handrechnung', () => {
  let spreadCount = 0
  for (const fx of loadFixtures()) {
    const { src, count } = spread(fx.db(), 0)
    spreadCount += count
    assert.deepStrictEqual(actualOf(src, fx.year), fx.expected, fx.name)
  }
  assert.ok(spreadCount > 0, 'keine Position im Prüfkatalog lässt sich verteilen')
})

// Das erste Jahr der Verteilung, wie die Rückfrage es nennt: „… statt ganz Y.“ beim Setzen auf 2 Jahre.
const askedStart = (c: { period: string; paidOn?: string | null; taxYear?: number | null }): number => {
  const [sentence] = spreadQuestions({ ...c, spreadYears: null }, { ...c, spreadYears: 2 })
  const m = /Abzug (\d{4}) bis (\d{4}) statt ganz (\d{4})\./.exec(sentence ?? '')
  if (m === null) return assert.fail(`kein Satz mit Jahren: ${sentence}`)
  assert.equal(m[1], m[3])
  return Number(m[1])
}

test('V2: die Rückfrage nennt als Beginn der Verteilung das Jahr, das die Steuer nimmt (outflowShares)', () => {
  let checked = 0
  let offCalendar = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const { source, periods } = randomTaxStock(makeRng(seed * 7919))
    for (const c of source.costItems) {
      if (c.propertyId !== TAX_STOCK_PROPERTY || !allowsSpread(c)) continue
      const period = periods.find((p) => p.key === c.period)
      if (period === undefined) continue
      const share = outflowShares(c, period)[0] ?? assert.fail('kein Anteil')
      assert.equal(askedStart(c), share.year, `Startwert ${seed}, ${c.id} (${c.period}, Jahr ${c.taxYear ?? '–'}, Datum ${c.paidOn ?? '–'})`)
      checked++
      if (period.from.slice(5) !== '01-01' || period.to.slice(5) !== '12-31') offCalendar++
    }
  }
  assert.ok(checked > 20, `zu wenige Positionen geprüft (${checked})`)
  assert.ok(offCalendar > 5, `zu wenige Positionen außerhalb des Kalenderjahres (${offCalendar})`)
})

// Der Fall der Durchsicht: Zeitraum ab Mai, Entnahme aus der Rücklage ohne Datum. Über zwei Kalenderjahre verlangt der
// Server das Jahr der Zahlung (`requireTaxYear`), also nennt die Rückfrage dieses Jahr wie die Steuer; im Rumpfzeitraum
// Januar bis April ohne Angabe das Kalenderjahr, wie die Steuer.
test('V2: Zeitraum ab Mai, Entnahme ohne Datum: Rückfrage und Steuer nehmen dasselbe Jahr', () => {
  const may = { key: '2025-05', from: '2025-05-01', to: '2026-04-30' }
  for (const taxYear of [2025, 2026]) {
    const c = { period: may.key, category: 'Entnahme Erhaltungsrücklage', amountCents: 500_000, taxYear, key: 'external' as const }
    assert.equal(askedStart(c), outflowShares(c, may)[0]?.year)
    assert.equal(askedStart(c), taxYear)
  }
  const rump = { key: '2025-01', from: '2025-01-01', to: '2025-04-30' }
  const c = { period: rump.key, category: 'Entnahme Erhaltungsrücklage', amountCents: 500_000, key: 'external' as const }
  assert.equal(askedStart(c), outflowShares(c, rump)[0]?.year)
  assert.equal(askedStart(c), 2025)
})
