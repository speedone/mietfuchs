// Invarianten zur Entnahme aus der Erhaltungsrücklage (#96 PR 1, Entwurf Abschnitt „Invarianten“) über Zufallsbestände
// mit festem Startwert (`randomTaxStock`: Kalenderjahr, Mai bis April, Wechsel des Rhythmus, Heizanlagen, Eigennutzung,
// Einheiten außerhalb, Gutschriften, Rücklage).
//
// I1 Umstellen ändert keine Zahl: Jede Position „Nicht umlagefähig“ ohne Datum wird auf „Entnahme Erhaltungsrücklage“
//    gestellt. Je Objekt und Jahr bleiben Brutto, privat, unentgeltlich, abziehbar, §35a, Überschuss Soll und Ist; nur
//    Gruppe und Kategorie wandern, die Summe der Gruppen bleibt.
// I2 Die Zuführung zählt nie: Über alle Jahre sind die abziehbaren Werbungskosten mit und ohne Zuführungen gleich, und
//    `reserveContributionCents` summiert genau die Zuführungen.
// I3 Abrechnung unberührt: Für I1 sind Mieteranteile und Vermieteranteil jeder Abrechnung gleich.
//
// Startwerte über INV_FROM/INV_TO, Vorgabe 1 bis 120.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, RESERVE_CATEGORY, RESERVE_WITHDRAWAL_CATEGORY, taxReportFor } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, TAX_STOCK_YEARS, type TaxSource } from '../testing/taxStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 120)

// Weiter als TAX_STOCK_YEARS: Ein angegebenes Jahr der Zahlung reicht bis ein Jahr nach dem Ende des letzten Zeitraums.
const ALL_YEARS = Array.from({ length: 13 }, (_, i) => 2020 + i)

const withdrawn = (src: TaxSource): TaxSource => ({
  ...src,
  costItems: src.costItems.map((c) => (c.category === 'Nicht umlagefähig' && c.paidOn == null ? { ...c, category: RESERVE_WITHDRAWAL_CATEGORY } : c)),
})

function numbers(src: TaxSource, year: number) {
  const r = taxReportFor(src, TAX_STOCK_PROPERTY, year)
  const e = r.expenses
  return {
    total: e.totalCents, priv: e.privateCents, gratuitous: e.gratuitousCents ?? 0, deductible: e.deductibleCents, labor: e.labor35aCents,
    soll: r.surplusSollCents, ist: r.surplusPaidCents, groups: e.groups.reduce((a, g) => a + g.amountCents, 0), reserve: r.reserveContributionCents,
  }
}

test('I1/I3: „Nicht umlagefähig“ ohne Datum auf „Entnahme Erhaltungsrücklage“ umgestellt ändert keine Zahl der Steuer und der Abrechnung', () => {
  let switched = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const { source, periods } = randomTaxStock(makeRng(seed * 7919))
    const after = withdrawn(source)
    const n = after.costItems.filter((c) => c.category === RESERVE_WITHDRAWAL_CATEGORY).length
    switched += n
    for (const year of TAX_STOCK_YEARS) {
      assert.deepEqual(numbers(after, year), numbers(source, year), `Startwert ${seed}, ${year}`)
      if (n === 0) continue
      const r = taxReportFor(after, TAX_STOCK_PROPERTY, year)
      for (const x of r.expenses.items.filter((i) => i.category === RESERVE_WITHDRAWAL_CATEGORY)) assert.equal(x.group, 'Erhaltungsaufwand')
    }
    for (const p of periods) {
      const a = computeSettlement(snapshotFor(source, TAX_STOCK_PROPERTY, p))
      const b = computeSettlement(snapshotFor(after, TAX_STOCK_PROPERTY, p))
      assert.deepEqual(b.statements.map((s) => [s.tenancyId, s.totalShareCents]), a.statements.map((s) => [s.tenancyId, s.totalShareCents]), `Startwert ${seed}, ${p.key}: Mieteranteile`)
      assert.equal(b.landlord.totalCents, a.landlord.totalCents, `Startwert ${seed}, ${p.key}: Vermieteranteil`)
    }
  }
  assert.ok(switched > 20, `zu wenige umgestellte Positionen (${switched})`)
})

test('I2: die Zuführung zählt in keinem Jahr zu den Werbungskosten', () => {
  let reserves = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const { source } = randomTaxStock(makeRng(seed * 7919))
    const without: TaxSource = { ...source, costItems: source.costItems.filter((c) => c.category !== RESERVE_CATEGORY) }
    let deductibleWith = 0
    let deductibleWithout = 0
    let reserve = 0
    for (const year of ALL_YEARS) {
      deductibleWith += taxReportFor(source, TAX_STOCK_PROPERTY, year).expenses.deductibleCents
      deductibleWithout += taxReportFor(without, TAX_STOCK_PROPERTY, year).expenses.deductibleCents
      reserve += taxReportFor(source, TAX_STOCK_PROPERTY, year).reserveContributionCents
    }
    const contributions = source.costItems.filter((c) => c.category === RESERVE_CATEGORY)
    reserves += contributions.length
    assert.equal(deductibleWith, deductibleWithout, `Startwert ${seed}`)
    assert.equal(reserve, contributions.reduce((a, c) => a + c.amountCents, 0), `Startwert ${seed}: reserveContributionCents`)
  }
  assert.ok(reserves > 20, `zu wenige Zuführungen (${reserves})`)
})
