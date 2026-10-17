// Das Zahlungsdatum einer Kostenposition für die Steuer (#255, PR 3): „Bezahlt am (für die Steuer)“ gilt für die
// ganze Position und geht dem Jahr der Zahlung (`taxYear`) und dem Abrechnungsjahr vor (Entscheidung R-2). Die
// Steuerübersicht und das Steuer-ZIP finden eine Position dann im Jahr ihrer Zahlung, auch über Abrechnungsjahre
// hinweg (R-9, die Fälle des Mitwirkenden). Der private Teil kommt weiter aus der Abrechnung ihres Zeitraums.
// Die Abrechnung selbst liest das Datum nie (Wache W1). Ohne Datum bleibt alles, wie es war; das hält die
// Gleichheitsinvariante in outflow.test.ts samt Prüfsummen fest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, taxPartsFor, taxReportFor } from '../src/calc.ts'
import { outflowShares, storedOutflowYear } from '../src/outflow.ts'
import { narrowToProperty, snapshotFor } from '../src/snapshot.ts'
import { taxArchiveItems } from '../src/taxReceipts.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, type TaxSource } from '../testing/taxStock.ts'
import { CALENDAR_RULES, periodKey, periodOfKey, rulesOf } from '../../shared/period.ts'
import type { PeriodRules } from '../../shared/types.ts'
import { GLOSSARY } from '../../shared/glossary.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
type ItemIn = Omit<TaxSource['costItems'][number], 'propertyId' | 'key' | 'category'> & { category?: string }
const haus = (rules: PeriodRules, costItems: ItemIn[]): TaxSource => ({
  properties: [{ id: TAX_STOCK_PROPERTY, kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [
    { id: 'eg', propertyId: TAX_STOCK_PROPERTY, name: 'EG', areaM2: 50, participates: false, selfUsed: true },
    { id: 'og', propertyId: TAX_STOCK_PROPERTY, name: 'OG', areaM2: 50, participates: true },
  ],
  tenancies: [{ id: 't1', unitId: 'og', tenantName: 'A', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems: costItems.map((c) => ({ category: 'Sach- und Haftpflichtversicherung', ...c, propertyId: TAX_STOCK_PROPERTY, key: 'area' as const })),
  meters: [], readings: [], payments: [], closedSettlements: [],
} as TaxSource)
const inYear = (source: TaxSource, year: number): string[] => taxReportFor(source, TAX_STOCK_PROPERTY, year).expenses.items.map((i) => i.costItemId)
const inZip = (source: TaxSource, year: number): string[] =>
  taxArchiveItems(narrowToProperty(source, TAX_STOCK_PROPERTY).costItems, taxPartsFor(source, TAX_STOCK_PROPERTY, year)).map((c) => c.id)

test('outflowShares: das Zahlungsdatum geht dem Jahr der Zahlung und dem Abrechnungsjahr vor (R-2)', () => {
  assert.deepEqual(outflowShares({ paidOn: '2027-02-10', amountCents: 500 }, { from: '2026-01-01' }), [{ year: 2027, cents: 500, source: 'paid' }])
  assert.deepEqual(outflowShares({ paidOn: '2027-01-05', taxYear: 2026, amountCents: 500 }, { from: '2026-05-01' }), [{ year: 2027, cents: 500, source: 'paid' }])
  // Ein Abzug beim Betriebsstrom folgt der bezahlten Stromrechnung, auch ihrem Datum (#267).
  const bill = { id: 'hs', amountCents: 100000, paidOn: '2027-03-01' }
  const deduction = { id: 'ab', amountCents: -20000, operatingPower: 'deduction' as const, operatingPowerGeneralId: 'hs' }
  assert.deepEqual(outflowShares(deduction, { from: '2026-01-01' }, [bill, deduction]), [{ year: 2027, cents: -20000, source: 'bill' }])
  assert.equal(storedOutflowYear({ id: 'x', amountCents: 1, period: periodKey('2026-01'), paidOn: '2025-12-01' }), 2025)
})

test('R-9, Fall 1: Position der Abrechnung 2026, bezahlt 2027, steht in der Steuer 2027 und nicht in 2026', () => {
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 60000, paidOn: '2027-02-10' }])
  assert.deepEqual(inYear(src, 2026), [])
  assert.deepEqual(inYear(src, 2027), ['vers'])
  assert.deepEqual(inZip(src, 2026), [])
  assert.deepEqual(inZip(src, 2027), ['vers'])
  const item = taxReportFor(src, TAX_STOCK_PROPERTY, 2027).expenses.items[0] ?? assert.fail('keine Position')
  assert.deepEqual([item.amountCents, item.privateCents, item.deductibleCents], [60000, 30000, 30000], 'privat nach der Abrechnung 2026')
})

test('R-9, Fall 2: Position, bezahlt vor Beginn ihres Zeitraums, steht im Jahr der Zahlung', () => {
  // Versicherung 2026, bezahlt am 01.12.2025 (außerhalb der zehn Tage).
  const src = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 60000, paidOn: '2025-12-01' }])
  assert.deepEqual(inYear(src, 2025), ['vers'])
  assert.deepEqual(inYear(src, 2026), [])
  assert.deepEqual(inZip(src, 2025), ['vers'])
  const item = taxReportFor(src, TAX_STOCK_PROPERTY, 2025).expenses.items[0] ?? assert.fail('keine Position')
  assert.equal(item.privateCents, 30000, 'privat nach der Abrechnung 2026, der sie dient')
})

test('R-9, Fall 3: die Steuerübersicht findet Positionen über Abrechnungsjahre hinweg, auch weit nach dem Zeitraum', () => {
  const kalender = haus(CALENDAR_RULES, [{ id: 'gs', period: periodKey('2026-01'), description: 'Grundsteuer 2026', amountCents: 30000, category: 'Grundsteuer', paidOn: '2029-03-01' }])
  assert.deepEqual(inYear(kalender, 2029), ['gs'])
  assert.deepEqual([2025, 2026, 2027, 2028, 2030].map((y) => inYear(kalender, y).length), [0, 0, 0, 0, 0])
  assert.deepEqual(inZip(kalender, 2029), ['gs'])
  const mai = haus(MAI, [
    { id: 'vor', period: periodKey('2026-05'), description: 'Versicherung 2026/2027', amountCents: 60000, taxYear: 2026, paidOn: '2025-12-15' },
    { id: 'nach', period: periodKey('2026-05'), description: 'Wasser 2026/2027', amountCents: 20000, taxYear: 2027, paidOn: '2030-06-30' },
    { id: 'ohne', period: periodKey('2026-05'), description: 'Müll 2026/2027', amountCents: 10000, taxYear: 2027 },
  ])
  assert.deepEqual(inYear(mai, 2025), ['vor'])
  assert.deepEqual(inYear(mai, 2026), [])
  assert.deepEqual(inYear(mai, 2027), ['ohne'])
  assert.deepEqual(inYear(mai, 2030), ['nach'])
})

test('Eigenanteil der Abrechnung ohne die Position, die in einem anderen Jahr bezahlt ist (T3)', () => {
  const src = haus(CALENDAR_RULES, [
    { id: 'a', period: periodKey('2026-01'), description: 'Versicherung 2026', amountCents: 60000 },
    { id: 'b', period: periodKey('2026-01'), description: 'Wasser 2026', amountCents: 40000, category: 'Wasserversorgung', paidOn: '2027-01-20' },
  ])
  assert.equal(taxReportFor(src, TAX_STOCK_PROPERTY, 2026).selfUsedShareCents, 30000)
  assert.equal(taxReportFor(src, TAX_STOCK_PROPERTY, 2027).selfUsedShareCents, 20000)
})

test('Wache W1: die Abrechnung hängt nicht am Zahlungsdatum', () => {
  const ohne = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung', amountCents: 60000 }])
  const mit = haus(CALENDAR_RULES, [{ id: 'vers', period: periodKey('2026-01'), description: 'Versicherung', amountCents: 60000, paidOn: '2028-01-03' }])
  const p = periodOfKey(rulesOf(ohne.properties?.[0]), periodKey('2026-01')) ?? assert.fail('kein Zeitraum')
  assert.deepEqual(computeSettlement(snapshotFor(mit, TAX_STOCK_PROPERTY, p)), computeSettlement(snapshotFor(ohne, TAX_STOCK_PROPERTY, p)))
})

// Invariante I2 mit Datum: Bekommen zufällige Positionen ein zufälliges Zahlungsdatum (in der üblichen Spanne und
// darüber hinaus), steht jede Position genau einmal in einem Steuerjahr, und zwar im Jahr ihres Datums; die Summe über
// alle Jahre ist die Summe der Positionen, und je Position ist privat + abziehbar = Betrag.
const SEEDS = Array.from({ length: Number(process.env.INV_TO ?? 30) - Number(process.env.INV_FROM ?? 1) + 1 }, (_, k) => Number(process.env.INV_FROM ?? 1) + k)
test('Invariante: mit Zahlungsdatum jede Position genau einmal, im Jahr ihres Datums', () => {
  let dated = 0
  for (const seed of SEEDS) {
    const rnd = makeRng(seed * 7919)
    const { source } = randomTaxStock(rnd)
    const items = source.costItems.map((c) => {
      if (c.operatingPower === 'deduction' || c.key === 'external' || rnd() < 0.4) return c
      const start = Number(c.period.slice(0, 4))
      const y = start - 2 + Math.floor(rnd() * 7)
      dated++
      return { ...c, paidOn: `${y}-${rnd() < 0.5 ? '01-05' : '12-28'}` }
    })
    const src: TaxSource = { ...source, costItems: items }
    const years = Array.from({ length: 16 }, (_, i) => 2020 + i)
    const seen = new Map<string, number[]>()
    for (const y of years) {
      const r = taxReportFor(src, TAX_STOCK_PROPERTY, y)
      for (const i of r.expenses.items) {
        if (i.costItemId.startsWith('operating-power-balance')) continue
        seen.set(i.costItemId, [...(seen.get(i.costItemId) ?? []), y])
        assert.equal(i.privateCents + i.deductibleCents, i.amountCents, `Startwert ${seed}, ${i.costItemId}`)
      }
    }
    for (const c of items) {
      if (c.category === 'Zuführung Erhaltungsrücklage') continue
      const found = seen.get(c.id) ?? []
      assert.equal(found.length, 1, `Startwert ${seed}: ${c.id} in ${found.join(', ') || 'keinem Jahr'}`)
      if (c.paidOn !== undefined) assert.equal(found[0], Number(c.paidOn.slice(0, 4)), `Startwert ${seed}: ${c.id}`)
    }
  }
  assert.ok(dated > 50, `Positionen mit Datum: ${dated}`)
})

test('Lexikon „Zahlungsdatum“: das Beispiel ist nachgerechnet', () => {
  const src = haus(CALENDAR_RULES, [{ id: 'gs', period: periodKey('2025-01'), description: 'Grundsteuer 2025', amountCents: 60000, category: 'Grundsteuer', paidOn: '2026-02-20' }])
  assert.deepEqual(inYear(src, 2025), [])
  const r = taxReportFor(src, TAX_STOCK_PROPERTY, 2026)
  assert.deepEqual(r.expenses.items.map((i) => [i.costItemId, i.amountCents]), [['gs', 60000]])
  assert.match(GLOSSARY.paymentDate.example, /600,00 €.*20\.02\.2026.*2026.*2025/s)
})
