// Invariante zu #255 im Endstand (Durchsicht von PR 4, S1): Über alle Steuerjahre zusammen ändert ein Zahlungsdatum
// nichts. Ein Datum verschiebt eine Position nur zwischen den Jahren. Geprüft an Beständen mit angegebenem Jahr der
// Zahlung, Betriebsstrom (Abzüge und Heizpositionen „steckt auch in der Stromrechnung“, Ausgleichszeilen #268) und
// zufälligen Daten zugleich. calc-steuer-zahlungsdatum.test.ts prüft je Position, übergeht aber die Ausgleichszeilen;
// invariant-betriebsstrom-steuer.test.ts summiert über die Jahre, kennt aber kein Datum.
//
// Centgenau gelten: der Gesamtbetrag über alle Jahre (die Ausgleichszeile zählt mit; stünde sie nach einem Datum an der
// Stromrechnung in zwei Jahren oder in keinem, wiche er ab), der private Teil der Positionen (jede bringt ihn aus der
// Abrechnung ihres Zeitraums mit) und je Jahr privat + abziehbar = gesamt.
//
// Und der private Teil der Ausgleichszeilen beim Betriebsstrom (#268), bis auf einen Cent Rundung je Zeile: Sein
// Heizanteil (`plantHeatQuota`) kommt aus den Heizpositionen des Zeitraums, zu dem Betriebsstrom und Heizpositionen
// gehören, und zwar aus denen, die ohne Zahlungsdatum im selben Steuerjahr stünden. Vorher nahm er die Heizpositionen, die
// im Steuerjahr stehen; wanderte eine per Datum in ein anderes Jahr, änderte sich der Heizanteil, über alle Jahre
// zusammen nachgemessen bis 55,78 € (20 von 200 Startwerten; Befund der Durchsicht von #255 PR 4, S1).
//
// Startwerte über INV_FROM/INV_TO, Vorgabe 1 bis 200.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReportFor } from '../src/calc.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, type TaxSource } from '../testing/taxStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 200)
const YEARS = Array.from({ length: 19 }, (_, i) => 2018 + i)

type Sums = { total: number; priv: number; itemPriv: number; balanceLines: number }
function sums(src: TaxSource): Sums {
  const s: Sums = { total: 0, priv: 0, itemPriv: 0, balanceLines: 0 }
  for (const y of YEARS) {
    const e = taxReportFor(src, TAX_STOCK_PROPERTY, y).expenses
    assert.equal(e.privateCents + e.deductibleCents, e.totalCents, `${y}: privat + abziehbar = gesamt`)
    s.total += e.totalCents
    s.priv += e.privateCents
    s.itemPriv += e.items.filter((i) => !i.operatingPowerBalance).reduce((a, i) => a + i.privateCents, 0)
    s.balanceLines += e.items.filter((i) => i.operatingPowerBalance).length
  }
  return s
}

type Case = { seed: number; without: Sums; withDates: Sums }
const cases: Case[] = []
let dated = 0
let datedBills = 0
let withTaxYear = 0
let withBalance = 0
for (let seed = FROM; seed <= TO; seed++) {
  const rnd = makeRng(seed * 104729)
  const { source } = randomTaxStock(rnd)
  const items = source.costItems.map((c) => {
    if (c.operatingPower === 'deduction' || c.key === 'external' || rnd() < 0.4) return c
    const start = Number(c.period.slice(0, 4))
    dated++
    if (source.costItems.some((d) => d.operatingPowerGeneralId === c.id)) datedBills++
    return { ...c, paidOn: `${start - 2 + Math.floor(rnd() * 7)}-${rnd() < 0.5 ? '01-05' : '12-28'}` }
  })
  if (source.costItems.some((c) => c.taxYear !== undefined)) withTaxYear++
  const c = { seed, without: sums(source), withDates: sums({ ...source, costItems: items }) }
  if (c.without.balanceLines + c.withDates.balanceLines > 0) withBalance++
  cases.push(c)
}

test('Invariante: über alle Steuerjahre gleicher Gesamtbetrag und privater Teil der Positionen, mit Zahlungsdatum wie ohne (#255)', () => {
  for (const { seed, without, withDates } of cases) {
    assert.equal(withDates.total, without.total, `Startwert ${seed}: Summe über ${YEARS[0]}–${YEARS.at(-1)}`)
    assert.equal(withDates.itemPriv, without.itemPriv, `Startwert ${seed}: privater Teil der Positionen über alle Jahre`)
  }
  // Der Generator muss die Lagen erzeugen, sonst prüft die Invariante sie nicht.
  if (TO - FROM >= 49) {
    assert.ok(dated > 200, `Positionen mit Datum: ${dated}`)
    assert.ok(datedBills > 10, `Stromrechnungen mit Abzug und Datum: ${datedBills}`)
    assert.ok(withTaxYear > 10, `Bestände mit angegebenem Jahr der Zahlung: ${withTaxYear}`)
    assert.ok(withBalance > 10, `Bestände mit Ausgleichszeile beim Betriebsstrom: ${withBalance}`)
  }
})

test('Invariante: privater Teil der Ausgleichszeilen über alle Steuerjahre, höchstens ein Cent je Zeile Rundung', () => {
  const off = cases.filter(({ without, withDates }) => Math.abs(withDates.priv - without.priv) > Math.max(without.balanceLines, withDates.balanceLines))
  assert.deepEqual(off.map((c) => [c.seed, c.withDates.priv - c.without.priv]), [])
  if (TO - FROM >= 49) assert.ok(cases.some((c) => c.withDates.balanceLines > 0 && c.withDates.priv !== c.withDates.itemPriv), 'kein privater Teil an einer Ausgleichszeile')
})

// Der Fall aus der Durchsicht mit Zahlen: Startwert 123 (Kalenderobjekt, Anlage ohne eigene Heizperiode, Eigennutzung).
// Ohne Datum tragen die Ausgleichszeilen über alle Jahre 34,15 € privat; mit Datum waren es 35,48 €, weil der Heizanteil
// eines Jahres nur aus den dort bezahlten Heizpositionen kam.
test('Startwert 123: der private Teil der Ausgleichszeilen bleibt mit Zahlungsdatum bei 34,15 €', () => {
  const rnd = makeRng(123 * 104729)
  const { source } = randomTaxStock(rnd)
  const items = source.costItems.map((c) => {
    if (c.operatingPower === 'deduction' || c.key === 'external' || rnd() < 0.4) return c
    const start = Number(c.period.slice(0, 4))
    return { ...c, paidOn: `${start - 2 + Math.floor(rnd() * 7)}-${rnd() < 0.5 ? '01-05' : '12-28'}` }
  })
  const balancePrivate = (s: Sums) => s.priv - s.itemPriv
  assert.equal(balancePrivate(sums(source)), 3415)
  assert.equal(balancePrivate(sums({ ...source, costItems: items })), 3415)
})

// Nachprüfung von PR 4, N1: Dieselbe Zahlung, einmal als Jahr der Zahlung und einmal als Datum in diesem Jahr, ergibt
// dieselbe Übersicht. Vorher fiel eine Position eines Zeitraums über zwei Kalenderjahre, die nur ein Datum trägt, für den
// Heizanteil des Ausgleichs auf das Beginnjahr zurück, während dasselbe als `taxYear` sein Jahr behielt.
const asDate = (src: TaxSource): TaxSource => ({
  ...src,
  costItems: src.costItems.map((c) => {
    if (c.taxYear === undefined || c.operatingPower === 'deduction' || c.key === 'external') return c
    const { taxYear, ...rest } = c
    return { ...rest, paidOn: `${taxYear}-06-15` }
  }),
})
const overview = (src: TaxSource, y: number) => {
  const e = taxReportFor(src, TAX_STOCK_PROPERTY, y).expenses
  return [e.totalCents, e.privateCents, e.deductibleCents, e.items.map((i) => [i.costItemId, i.amountCents, i.privateCents])]
}

test('Invariante: Jahr der Zahlung t und Zahlungsdatum im Jahr t ergeben dieselbe Übersicht (N1)', () => {
  let replaced = 0
  let twoYears = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const { source, rules } = randomTaxStock(makeRng(seed * 104729))
    const dated = asDate(source)
    replaced += source.costItems.filter((c, i) => c !== dated.costItems[i]).length
    if (rules.startMonth !== 1) twoYears++
    for (const y of [2023, 2024, 2025, 2026, 2027, 2028, 2029]) {
      assert.deepEqual(overview(dated, y), overview(source, y), `Startwert ${seed}, ${y}`)
    }
  }
  if (TO - FROM >= 49) {
    assert.ok(replaced > 100, `ersetzte Jahre: ${replaced}`)
    assert.ok(twoYears > 10, `Bestände mit Zeitraum über zwei Kalenderjahre: ${twoYears}`)
  }
})

test('Startwert 3 (Mai bis April): 2024 privat 4.825,91 €, als Jahr der Zahlung wie als Datum (N1)', () => {
  const { source } = randomTaxStock(makeRng(3 * 104729))
  assert.equal(taxReportFor(source, TAX_STOCK_PROPERTY, 2024).expenses.privateCents, 482591)
  assert.equal(taxReportFor(asDate(source), TAX_STOCK_PROPERTY, 2024).expenses.privateCents, 482591)
})
