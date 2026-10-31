// Invarianten der Verteilung nach § 82b EStDV (#262 PR 2) über Zufallsbestände mit festem Startwert (`randomTaxStock`:
// Kalenderjahr, Mai bis April, Wechsel des Rhythmus, Heizanlagen, Eigennutzung, Gutschriften, Rücklage), dazu zufällig:
// die Wahl an Positionen, die sie erlauben, ein Ende am Objekt (§ 82b Abs. 2), Positionen direkt einer Wohnung
// zugeordnet und eine ortsübliche Miete je Jahr (verbilligte Vermietung mit wechselnder Quote). Entwurf
// docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md, Abschnitt „Invarianten“.
//
// I-1 Über alle Jahre sind Σ Betrag, Σ privat und Σ (abziehbar + unentgeltlich) gleich wie ohne Verteilung; ohne
//     verbilligte Vermietung auch Σ abziehbar. Σ unentgeltlich allein nicht: gekürzt wird mit der Quote des Jahres der
//     Rate (V1).
// I-2 Je Jahr, Zeile, Kategorie, Gruppe und Summe: Betrag = privat + unentgeltlich + verschoben + abziehbar.
// I-3 Je Position ist Σ über alle Jahre des verschobenen Teils 0.
// I-4 Raten: jede ⌊X/N⌋ oder ⌈X/N⌉ (für D und für den Betrag), nicht steigend, Σ = X, gleich `largestRemainder` mit den
//     Jahren als Schlüssel; mit Ende keine Rate danach, und das Jahr des Endes trägt den Rest. Jede Rate über 0 steht im
//     Jahr ihres Abzugs genau einmal als abgeleitete Zeile.
// I-7 Ein Jahr des Abflusses: Teile, Auswahl fürs Steuer-ZIP, Verschiebungen (`movedOut`) und `outflow` je Position sind
//     mit und ohne Verteilung gleich.
// I-9 Kürzung je Jahr (V1, X9 i): Die Kürzung einer Rate im Jahr Y ist die einer unverteilten Position über den
//     Bruttoanteil mit denselben Einheiten in Y, geklemmt auf die Rate.
// X9 (d) Eine Entnahme aus der Rücklage, auf „Nicht umlagefähig“ umgestellt und verteilt, ergibt über alle Jahre
//     dieselben Summen wie unverteilt (Σ privat, Σ abziehbar + unentgeltlich, Σ Betrag).
//
// Startwerte über INV_FROM/INV_TO, Vorgabe 1 bis 25.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESERVE_WITHDRAWAL_CATEGORY, taxPartsFor, taxReportFor } from '../src/calc.ts'
import { narrowToProperty } from '../src/snapshot.ts'
import { taxArchiveItems } from '../src/taxReceipts.ts'
import { largestRemainder } from '../src/apportion.ts'
import { allowsSpread } from '../../shared/spread.ts'
import type { SpreadYears, TaxReport } from '../../shared/types.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY as P, type TaxSource } from '../testing/taxStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 25)
const YEARS = Array.from({ length: 13 }, (_, i) => 2022 + i)
const N: readonly SpreadYears[] = [2, 3, 4, 5]

type Stock = { plain: TaxSource; spread: TaxSource; cheap: boolean; restYear: number | null }

function stock(seed: number): Stock {
  const rnd = makeRng(seed * 104_729 + 17)
  const { source, periods } = randomTaxStock(makeRng(seed * 7919 + 3))
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rnd() * xs.length))] as T
  const units = source.units.filter((u) => u.propertyId === P)
  const cheap = rnd() < 0.6
  const plainUnits = source.units.map((u) => {
    if (!cheap || u.selfUsed || !u.participates) return u
    // Eine ortsübliche Miete je Jahr: die Quote wechselt von Jahr zu Jahr, unter und über den Grenzen.
    return { ...u, localRents: YEARS.map((y) => ({ from: `${y}-01`, monthlyCents: 40_000 + Math.floor(rnd() * 200_000), source: 'Mietspiegel', sourceDate: '2024-01-01' })) }
  })
  // Dazu je Zeitraum öfter eine größere Maßnahme, im Jahr des Beginns bezahlt (über zwei Kalenderjahre mit Jahr der
  // Zahlung, wie die Datenbank es verlangt).
  const repairs = periods.filter(() => rnd() < 0.6).map((p) => ({
    id: `dach${p.key}`, propertyId: P, period: p.key, category: 'Nicht umlagefähig', description: `Dach ${p.key}`,
    amountCents: 200_000 + Math.floor(rnd() * 3_000_000), key: 'area' as const,
    ...(p.from.slice(0, 4) !== p.to.slice(0, 4) ? { taxYear: Number(p.from.slice(0, 4)) + Math.floor(rnd() * 2) } : {}),
  }))
  const costItems = [...source.costItems, ...repairs].map((c) => {
    if (c.category !== 'Nicht umlagefähig') return c
    // Manche Reparatur direkt einer Wohnung zugeordnet (Bad), manche als Entnahme aus der Rücklage erfasst.
    const r = rnd()
    if (r < 0.25) return { ...c, key: 'direct' as const, directUnitId: pick(units).id, participantUnitIds: undefined }
    if (r < 0.4) return { ...c, category: RESERVE_WITHDRAWAL_CATEGORY }
    return c
  })
  const restYear = rnd() < 0.3 ? 2024 + Math.floor(rnd() * 8) : null
  const plain: TaxSource = { ...source, units: plainUnits, costItems, properties: (source.properties ?? []).map((p) => ({ ...p, ...(restYear !== null ? { spreadRestYear: restYear } : {}) })) }
  const spread: TaxSource = { ...plain, costItems: plain.costItems.map((c) => (allowsSpread(c) && rnd() < 0.7 ? { ...c, spreadYears: pick(N) } : c)) }
  return { plain, spread, cheap, restYear }
}

const reports = (src: TaxSource): Map<number, TaxReport> => new Map(YEARS.map((y) => [y, taxReportFor(src, P, y)]))
const sumOf = (rs: Map<number, TaxReport>, f: (r: TaxReport) => number): number => [...rs.values()].reduce((a, r) => a + f(r), 0)
const parts = (x: { privateCents: number; gratuitousCents?: number; deferredCents?: number; deductibleCents: number }): number =>
  x.privateCents + (x.gratuitousCents ?? 0) + (x.deferredCents ?? 0) + x.deductibleCents

test('I-1 bis I-4: Summen über alle Jahre, Zeilen je Jahr, verschobener Teil je Position, Raten', () => {
  let spreadItems = 0
  let carriedRows = 0
  let withCheapCut = 0
  let withRest = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const s = stock(seed)
    const at = `Startwert ${seed}`
    const plain = reports(s.plain)
    const spread = reports(s.spread)
    // I-1
    assert.equal(sumOf(spread, (r) => r.expenses.totalCents), sumOf(plain, (r) => r.expenses.totalCents), `${at}: Σ Betrag`)
    assert.equal(sumOf(spread, (r) => r.expenses.privateCents), sumOf(plain, (r) => r.expenses.privateCents), `${at}: Σ privat`)
    assert.equal(sumOf(spread, (r) => r.expenses.deductibleCents + (r.expenses.gratuitousCents ?? 0)), sumOf(plain, (r) => r.expenses.deductibleCents + (r.expenses.gratuitousCents ?? 0)), `${at}: Σ abziehbar + unentgeltlich`)
    if (!s.cheap) assert.equal(sumOf(spread, (r) => r.expenses.deductibleCents), sumOf(plain, (r) => r.expenses.deductibleCents), `${at}: Σ abziehbar`)
    const deferredOf = new Map<string, number>()
    for (const [y, r] of spread) {
      // I-2
      for (const i of r.expenses.items) assert.equal(parts(i), i.amountCents, `${at} ${y} ${i.costItemId}`)
      for (const g of r.expenses.groups) {
        assert.equal(parts(g), g.amountCents, `${at} ${y} ${g.group}`)
        for (const c of g.categories) assert.equal(parts(c), c.amountCents, `${at} ${y} ${g.group}/${c.category}`)
      }
      assert.equal(parts(r.expenses), r.expenses.totalCents, `${at} ${y}: Summe`)
      assert.equal(r.surplusPaidCents, r.income.paidCents - r.expenses.deductibleCents, `${at} ${y}: Überschuss`)
      for (const i of r.expenses.items) {
        const id = i.spreadFrom?.costItemId ?? i.costItemId
        if (i.deferredCents !== undefined) deferredOf.set(id, (deferredOf.get(id) ?? 0) + i.deferredCents)
        if (i.spreadFrom) {
          carriedRows++
          if (i.gratuitousCents) withCheapCut++
        }
      }
      // I-4
      for (const i of r.expenses.items) {
        const sp = i.spread
        if (sp === undefined) continue
        spreadItems++
        const of = sp.years
        for (const [x, rates] of [[sp.baseCents, sp.rates.map((q) => q.cents)], [i.amountCents, sp.rates.map((q) => q.grossCents)]] as const) {
          assert.equal(rates.reduce((a, b) => a + b, 0), x, `${at} ${y} ${i.costItemId}: Σ Raten`)
          const rest = sp.rates.findIndex((q) => q.rest)
          const regular = rest < 0 ? rates : rates.slice(0, rest)
          for (const q of regular) assert.ok(q === Math.floor(x / of) || q === Math.ceil(x / of), `${at} ${y} ${i.costItemId}: Rate ${q} von ${x}/${of}`)
          for (let k = 1; k < regular.length; k++) assert.ok((regular[k] ?? 0) <= (regular[k - 1] ?? 0), `${at} ${y} ${i.costItemId}: nicht steigend`)
          if (rest < 0) {
            assert.equal(rates.length, of)
            const keys: string[] = sp.rates.map((q) => String(q.year))
            assert.deepEqual(rates, largestRemainder(x, keys.map(() => x / of), keys), `${at} ${y} ${i.costItemId}: largestRemainder`)
          }
        }
        assert.equal(sp.rates[0]?.year, y)
        const restRate = sp.rates.find((q) => q.rest)
        if (restRate) {
          withRest++
          assert.equal(restRate.year, s.restYear, `${at} ${y} ${i.costItemId}: Rest im Jahr des Endes`)
          assert.equal(sp.rates[sp.rates.length - 1], restRate)
        }
        if (s.restYear !== null) assert.ok(sp.rates.every((q) => q.year <= (s.restYear ?? 0)), `${at} ${y} ${i.costItemId}: Rate nach dem Ende`)
        // Jede weitere Rate über 0 steht im Jahr ihres Abzugs als abgeleitete Zeile, und nur dort.
        for (const q of sp.rates.slice(1)) {
          const later = spread.get(q.year)?.expenses.items.filter((x) => x.costItemId === `spread:${i.costItemId}:${y}`) ?? []
          if (q.cents === 0) assert.equal(later.length, 0, `${at} ${q.year} ${i.costItemId}: Zeile ohne Rate`)
          else {
            assert.equal(later.length, 1, `${at} ${q.year} ${i.costItemId}: Zeile fehlt`)
            assert.equal(-(later[0]?.deferredCents ?? 0), q.cents)
            assert.equal((later[0]?.deductibleCents ?? 0) + (later[0]?.gratuitousCents ?? 0), q.cents)
          }
        }
      }
      // Der Block der Zeilen 57 bis 72 nennt dieselben Raten wie die Zeilen.
      const sp = r.expenses.spread
      if (sp) {
        assert.equal(sp.thisYearCents, r.expenses.items.filter((i) => i.spread || i.spreadFrom).reduce((a, i) => a + (i.deductibleCents + (i.gratuitousCents ?? 0)), 0), `${at} ${y}: Block`)
      }
    }
    // I-3
    for (const [id, d] of deferredOf) assert.equal(d, 0, `${at} ${id}: Σ verschoben`)
  }
  assert.ok(spreadItems > 40, `zu wenige verteilte Positionen (${spreadItems})`)
  assert.ok(carriedRows > 60, `zu wenige Anteile aus Vorjahren (${carriedRows})`)
  assert.ok(withCheapCut > 5, `zu wenige gekürzte Anteile aus Vorjahren (${withCheapCut})`)
  assert.ok(withRest > 2, `zu wenige Verteilungen mit vorzeitigem Ende (${withRest})`)
})

test('I-7: ein Jahr des Abflusses, mit und ohne Verteilung', () => {
  for (let seed = FROM; seed <= TO; seed++) {
    const s = stock(seed)
    for (const y of YEARS) {
      const at = `Startwert ${seed} ${y}`
      const ids = (src: TaxSource) => taxPartsFor(src, P, y).map((p) => p.items.map((c) => c.id))
      assert.deepEqual(ids(s.spread), ids(s.plain), `${at}: Teile`)
      const zip = (src: TaxSource) => taxArchiveItems(narrowToProperty(src, P).costItems, taxPartsFor(src, P, y)).map((c) => c.id)
      assert.deepEqual(zip(s.spread), zip(s.plain), `${at}: Steuer-ZIP`)
      const a = taxReportFor(s.spread, P, y)
      const b = taxReportFor(s.plain, P, y)
      assert.deepEqual(a.movedOut, b.movedOut, `${at}: verschoben`)
      assert.equal(a.expenses.unstatedCount, b.expenses.unstatedCount, `${at}: ohne Angabe`)
      const outflows = (r: TaxReport) => r.expenses.items.filter((i) => !i.spreadFrom).map((i) => [i.costItemId, i.outflow ?? null, i.settlementPeriod ?? null])
      assert.deepEqual(outflows(a), outflows(b), `${at}: Jahr der Zahlung je Position`)
    }
  }
})

test('I-9: die Kürzung einer Rate im Jahr Y ist die einer unverteilten Position über den Bruttoanteil in Y', () => {
  let compared = 0
  let cut = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const s = stock(seed)
    if (!s.cheap) continue
    let perSeed = 0
    for (const y of YEARS) {
      if (perSeed >= 6) break
      for (const row of taxReportFor(s.spread, P, y).expenses.items) {
        // Die erste Rate im Jahr des Abflusses und jede weitere in ihrem Jahr.
        const first = row.spread?.rates[0]
        const id = row.spreadFrom?.costItemId ?? (first ? row.costItemId : undefined)
        const gross = row.spreadFrom?.grossRateCents ?? first?.grossCents
        const rate = row.spreadFrom ? -(row.deferredCents ?? 0) : first?.cents
        if (id === undefined || gross === undefined || rate === undefined || perSeed >= 6) continue
        const orig = s.spread.costItems.find((c) => c.id === id) ?? assert.fail('Position fehlt')
        const twin = { ...orig, id: 'zwilling', spreadYears: undefined, paidOn: undefined, taxYear: y, amountCents: gross }
        const t = taxReportFor({ ...s.spread, costItems: [...s.spread.costItems, twin] }, P, y).expenses.items.find((x) => x.costItemId === 'zwilling') ?? assert.fail('Zwilling fehlt')
        // Nur wo die Klemme den Zwilling nicht trifft, ist sein unentgeltlicher Teil die ungeklemmte Kürzung.
        if (t.deductibleCents <= 0) continue
        assert.equal(row.gratuitousCents ?? 0, Math.min(t.gratuitousCents ?? 0, rate), `Startwert ${seed} ${y} ${row.costItemId}`)
        compared++
        perSeed++
        if (row.gratuitousCents) cut++
      }
    }
  }
  assert.ok(compared > 10, `zu wenige Vergleiche (${compared})`)
  assert.ok(cut > 3, `zu wenige gekürzte Raten (${cut})`)
})

test('X9 (d): Entnahme auf „Nicht umlagefähig“ umgestellt und verteilt ergibt über alle Jahre dieselben Summen wie unverteilt', () => {
  let switched = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const s = stock(seed)
    const rnd = makeRng(seed * 31 + 5)
    const moved: TaxSource = {
      ...s.plain,
      costItems: s.plain.costItems.map((c) => {
        if (c.category !== RESERVE_WITHDRAWAL_CATEGORY) return c
        switched++
        return { ...c, category: 'Nicht umlagefähig', spreadYears: N[Math.floor(rnd() * N.length)] ?? 2 }
      }),
    }
    const a = reports(moved)
    const b = reports(s.plain)
    const at = `Startwert ${seed}`
    assert.equal(sumOf(a, (r) => r.expenses.totalCents), sumOf(b, (r) => r.expenses.totalCents), `${at}: Σ Betrag`)
    assert.equal(sumOf(a, (r) => r.expenses.privateCents), sumOf(b, (r) => r.expenses.privateCents), `${at}: Σ privat`)
    assert.equal(sumOf(a, (r) => r.expenses.deductibleCents + (r.expenses.gratuitousCents ?? 0)), sumOf(b, (r) => r.expenses.deductibleCents + (r.expenses.gratuitousCents ?? 0)), `${at}: Σ abziehbar + unentgeltlich`)
  }
  assert.ok(switched > 5, `zu wenige Entnahmen (${switched})`)
})
