// Invarianten des Zugeflossenen nach Zeilen (#312 PR 2, Entwurf docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md,
// Umsetzungsplan PR 2 Schritt 4; Release-Plan X9 a, b, f) über zufällige Bestände mit festem Startwert: der Generator der
// Steuer (testing/taxStock.ts) mit Zahlungen jeder schiefen Art (`withPaymentVariety`), je Objekt, Jahr, offen und mit
// abgeschlossenen Zeiträumen. Dazu die Referenz test/fixtures/tax-received-golden.json: je Startwert eine Prüfsumme über
// `received` ohne Namen, geschrieben nur, wenn jede Invariante und das Orakel unten für diesen Startwert stimmen
// (`TAX_RECEIVED_GOLDEN_WRITE=1 node --test test/invariant-steuer-zufluss.test.ts`), und dann im Commit begründet.
// Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computeSettlement, rentLedger, taxReportFor } from '../src/calc.ts'
import { allocateRentPayments, ledgerTenancy, type AllocationSlice } from '../src/rentAllocation.ts'
import { frozenSettlementOf, snapshotFor } from '../src/snapshot.ts'
import { calendarYearPeriod } from '../../shared/period.ts'
import { monthSoll } from '../../shared/monthRate.ts'
import type { TaxReceived, TaxReport } from '../../shared/types.ts'
import { makeRng, randomTaxStock, TAX_STOCK_PROPERTY, TAX_STOCK_SECOND, TAX_STOCK_YEARS, withPaymentVariety, withSecondProperty, type TaxSource } from '../testing/taxStock.ts'
import { sha256 } from '../testing/taxGolden.ts'
import { incomeLines } from '../../shared/taxIncomeLines.ts'
import { incomeCsv } from '../src/taxReceipts.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 24)
const SEEDS = Array.from({ length: Math.max(0, TO - FROM + 1) }, (_, k) => FROM + k)
const GOLDEN_FILE = new URL('./fixtures/tax-received-golden.json', import.meta.url)
const GOLDEN_WRITE = process.env.TAX_RECEIVED_GOLDEN_WRITE === '1'

type Stock = { source: TaxSource; objects: string[] }
function stockOf(seed: number, exact = false): Stock {
  const single = randomTaxStock(makeRng(seed))
  const g = seed % 3 === 0 ? withSecondProperty(single, makeRng(seed * 31 + 3)) : single
  return { source: withPaymentVariety(g.source, seed, { exact }), objects: seed % 3 === 0 ? [TAX_STOCK_PROPERTY, TAX_STOCK_SECOND] : [TAX_STOCK_PROPERTY] }
}

// Zufällige Zeiträume abgeschlossen (wie outflow.test.ts), damit der eingefrorene Stand mitläuft: Er friert nichts von den
// Einnahmen ein (E11), `received` muss gleich bleiben.
function withClosed(source: TaxSource, objects: readonly string[], seed: number): TaxSource | null {
  const rnd = makeRng(seed * 13 + 7)
  const closed = objects.flatMap((pid) => [2024, 2025, 2026].filter(() => rnd() < 0.5).flatMap((y) => {
    try {
      const st: unknown = JSON.parse(JSON.stringify(computeSettlement(snapshotFor(source, pid, calendarYearPeriod(y)))))
      return [{ period: calendarYearPeriod(y).key, propertyId: pid, sentAt: null, ...frozenSettlementOf(st), settlement: st }]
    } catch {
      return []
    }
  }))
  return closed.length > 0 ? { ...source, closedSettlements: closed } as TaxSource : null
}

const isAllocation = (c: AllocationSlice['component']): boolean => c === 'prepayment' || c === 'heatingPrepayment' || c === 'flatRate'
const sum = <T>(list: readonly T[], f: (x: T) => number): number => list.reduce((a, x) => a + f(x), 0)

// Das Orakel: die Zeilen aus den Teilen nach der Tabelle in E4, unabhängig von calc.ts geschrieben, mit derselben Tilgung
// (`allocateRentPayments` auf dem geführten Mietverhältnis, wie das Mietkonto). Zehn-Tage-Regel (E8 nach der
// Durchsicht): 22.12. bis 31.12. für Januar zählt im Folgejahr, wenn das Mietverhältnis am 01.09.2001 nicht bestand
// (§ 556b BGB); sonst nur beziffert, ebenso Anfang Januar (bis 10.01.) für Dezember.
// Wie oft das Orakel die Fälle der Nachdurchsicht sieht (M1: Januar-Abschnitt nicht in der kurzen Zeit fällig; S1:
// Rücknahme in der kurzen Zeit einer Zahlung von davor).
const oracleSeen = { januaryStartKept: 0, reversalKept: 0 }
type Oracle = Pick<TaxReceived, 'rentCents' | 'unallocatedCents' | 'allocationsCents' | 'flatRateCents' | 'formerYearsCents' | 'formerYearsAllocationsCents' | 'turnOfYear'>
function oracle(source: TaxSource, pid: string, year: number): { lines: Oracle; slicesOf: Map<string, AllocationSlice[]> } {
  const snap = snapshotFor(source, pid, calendarYearPeriod(year))
  const lines: Oracle = { rentCents: 0, unallocatedCents: 0, allocationsCents: 0, flatRateCents: 0, formerYearsCents: 0, formerYearsAllocationsCents: 0, turnOfYear: { forwardCents: 0, forwardAllocationsCents: 0, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 0, lateDecemberCents: 0 } }
  const slicesOf = new Map<string, AllocationSlice[]>()
  const y = String(year)
  for (const t of snap.tenancies) {
    const slices = allocateRentPayments(ledgerTenancy(t, snap.payments, year), snap.payments.filter((p) => p.tenancyId === t.id))
    slicesOf.set(t.id, slices)
    const since = t.contractDate !== undefined && t.contractDate < t.start ? t.contractDate : t.start
    const newLaw = since > '2001-09-01' // ein am 01.09.2001 beginnendes Mietverhältnis bestand an diesem Tag
    // Der Januar-Abschnitt sicher in der kurzen Zeit fällig (Nachdurchsicht M1): Mietverhältnis spätestens ab 01.01.; eine
    // Rücknahme nur, wenn die zurückgenommene Zahlung ebenfalls ab dem 22.12. kam (S1).
    const januaryDue = (y: number): boolean => t.start <= `${y}-01-01`
    const forwardOf = (s: AllocationSlice): boolean => {
      const y = Number(s.paidOn.slice(0, 4))
      return s.month === `${y + 1}-01` && s.paidOn.slice(5) >= '12-22' && (s.reversesPaidOn === undefined || s.reversesPaidOn >= `${y}-12-22`)
    }
    const movable = (s: AllocationSlice): boolean => forwardOf(s) && januaryDue(Number(s.paidOn.slice(0, 4)) + 1)
    for (const s of slices) {
      const moved = newLaw && movable(s)
      if (newLaw && s.paidOn.slice(0, 4) === y && forwardOf(s) && !moved) oracleSeen.januaryStartKept++
      if (newLaw && s.paidOn.slice(0, 4) === y && s.reversesPaidOn !== undefined && s.month === `${year + 1}-01` && s.paidOn.slice(5) >= '12-22' && !forwardOf(s)) oracleSeen.reversalKept++
      const counts = moved ? Number(s.paidOn.slice(0, 4)) + 1 === year : s.paidOn.slice(0, 4) === y
      if (moved && s.paidOn.slice(0, 4) === y) {
        lines.turnOfYear.forwardCents += s.cents
        if (isAllocation(s.component)) lines.turnOfYear.forwardAllocationsCents += s.cents
      }
      if (moved && counts) {
        lines.turnOfYear.fromPreviousCents += s.cents
        if (isAllocation(s.component)) lines.turnOfYear.fromPreviousAllocationsCents += s.cents
      }
      if (!newLaw && forwardOf(s) && s.paidOn.slice(0, 4) === y) lines.turnOfYear.forwardOldLeaseCents += s.cents
      if (!counts) continue
      if (s.month === null) { lines.rentCents += s.cents; lines.unallocatedCents += s.cents; continue }
      if (s.month.slice(0, 4) < y) {
        lines.formerYearsCents += s.cents
        if (isAllocation(s.component)) lines.formerYearsAllocationsCents += s.cents
        if (!newLaw && s.month === `${year - 1}-12` && s.paidOn <= `${y}-01-10`) lines.turnOfYear.lateDecemberCents += s.cents
        continue
      }
      if (isAllocation(s.component)) lines.allocationsCents += s.cents
      else lines.rentCents += s.cents
      if (s.component === 'flatRate') lines.flatRateCents += s.cents
    }
  }
  return { lines, slicesOf }
}

// `received` ohne Namen für die Prüfsumme: Ein anderer Wortlaut soll sie nicht ändern, eine andere Zahl schon.
// Die Felder aus der Durchsicht von PR 3 (S1, S4) bleiben draußen, damit die Referenz zeigt, dass sich keine bestehende
// Zahl geändert hat; geprüft werden sie über die Invarianten oben.
const unnamed = (x: TaxReceived): unknown => ({
  ...(({ totalCents: _t, unassignedCents: _u, ...rest }) => rest)(x),
  relatives: { rentCents: x.relatives.rentCents, allocationsCents: x.relatives.allocationsCents, settlementCents: x.relatives.settlementCents },
  byUnit: x.byUnit.map(({ unitName: _, ...rest }) => rest),
  byTenancy: x.byTenancy.map(({ tenantName: _, unitName: __, flatRateCents: _f, fromPreviousCents: _p, ...rest }) => rest),
  possibleDeposits: x.possibleDeposits.map(({ tenantName: _, ...rest }) => rest),
})

const receivedOf = (r: TaxReport): TaxReceived => r.income.received ?? assert.fail('received fehlt')

test('Invariante: Zeilen = Orakel, Summe = paidCents, Teilsummen stimmen, Mietkonto liest dieselben Teile (X9 a, b), Prüfsummen', () => {
  const golden: Record<string, string> = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {}
  const fails: string[] = []
  let compared = 0
  let goldenChecked = 0
  const seen = { formerYears: 0, negativeFormer: 0, unallocated: 0, forward: 0, fromPrevious: 0, forwardOldLease: 0, lateDecember: 0, relatives: 0, relativeWithoutResident: 0, flatRate: 0, inclusive: 0, warmInclusive: 0, possibleDeposits: 0, closed: 0 }
  for (const seed of SEEDS) {
    const { source, objects } = stockOf(seed)
    const closed = withClosed(source, objects, seed)
    const variants: [string, TaxSource][] = [['offen', source], ...(closed ? [['abgeschlossen', closed] as [string, TaxSource]] : [])]
    if (closed) seen.closed++
    const prints: unknown[] = []
    const seedFails = fails.length
    for (const [label, s] of variants) {
      for (const pid of objects) {
        const reports = new Map<number, TaxReport>()
        const reportOf = (year: number): TaxReport => {
          const known = reports.get(year)
          if (known) return known
          const made = taxReportFor(s, pid, year)
          reports.set(year, made)
          return made
        }
        for (const year of TAX_STOCK_YEARS) {
          const at = `Startwert ${seed} (${pid}, ${label}) ${year}`
          const r = reportOf(year)
          const x = receivedOf(r)
          compared++
          prints.push([label, pid, year, unnamed(x)])
          const { lines, slicesOf } = oracle(s, pid, year)
          const fail = (what: string) => fails.push(`${at}: ${what}`)
          try {
            assert.deepEqual({ rentCents: x.rentCents, unallocatedCents: x.unallocatedCents, allocationsCents: x.allocationsCents, flatRateCents: x.flatRateCents, formerYearsCents: x.formerYearsCents, formerYearsAllocationsCents: x.formerYearsAllocationsCents, turnOfYear: x.turnOfYear }, lines)
          } catch (e) { fail(`Orakel: ${(e as Error).message.slice(0, 400)}`) }
          // X9 (b), auf den Feldern: Zeilen 15/18 + 20 + 25 + 21 = paidCents − forward + fromPrevious (Zehn-Tage-Regel).
          const saldo = r.income.settlementBackPaymentsCents - r.income.settlementRefundsCents
          if (x.rentCents + x.allocationsCents + x.formerYearsCents + saldo !== r.income.paidCents - x.turnOfYear.forwardCents + x.turnOfYear.fromPreviousCents) fail('Summe der Zeilen ≠ paidCents − forward + fromPrevious')
          // Σ byTenancy = Felder, Σ byUnit = Felder, Σ byTenancy mit `relative` = relatives.
          for (const k of ['rentCents', 'inclusiveRentCents', 'allocationsCents', 'formerYearsCents', 'unallocatedCents'] as const) {
            if (sum(x.byTenancy, (b) => b[k]) !== x[k]) fail(`Σ byTenancy.${k} ≠ ${k}`)
          }
          if (sum(x.byTenancy, (b) => b.settlementCents) !== saldo) fail('Σ byTenancy.settlementCents ≠ Saldo Zeile 21')
          if (sum(x.byTenancy, (b) => b.forwardCents) !== x.turnOfYear.forwardCents) fail('Σ byTenancy.forwardCents ≠ forwardCents')
          for (const k of ['rentCents', 'allocationsCents', 'settlementCents', 'formerYearsCents'] as const) {
            if (sum(x.byUnit, (b) => b[k]) !== sum(x.byTenancy, (b) => b[k])) fail(`Σ byUnit.${k} ≠ Σ byTenancy`)
          }
          const rel = x.byTenancy.filter((b) => b.relative)
          for (const k of ['rentCents', 'allocationsCents', 'settlementCents', 'inclusiveRentCents', 'unallocatedCents', 'flatRateCents'] as const) {
            if (x.relatives[k] !== sum(rel, (b) => b[k])) fail(`relatives.${k} ≠ Σ byTenancy mit relative`)
          }
          // Durchsicht von PR 3 (S1, S4): Zeile 32 vom Server, die Zeilen aus der gemeinsamen Rechnung (shared/taxIncomeLines.ts)
          // ergeben sie; Pauschale und Zehn-Tage-Regel je Mietverhältnis; Überschuss aus Zeile 32.
          if (x.totalCents !== r.income.paidCents - x.turnOfYear.forwardCents + x.turnOfYear.fromPreviousCents) fail('totalCents ≠ paidCents − forward + fromPrevious')
          const z = incomeLines(r) ?? assert.fail('keine Zeilen')
          if (z.homes + z.relatives + z.allocations + z.relativesAllocations + z.settlement + z.relativesSettlement + z.formerYears !== x.totalCents) fail('Σ Zeilen (incomeLines) ≠ totalCents')
          if (z.totalCents !== x.totalCents) fail('incomeLines.totalCents ≠ totalCents')
          if (z.homes !== x.rentCents - x.relatives.rentCents || z.flatRate !== x.flatRateCents - x.relatives.flatRateCents) fail('incomeLines ≠ Felder ohne Angehörige')
          // Einnahmen.csv: Summe der Einnahmen = Zeile 32, Summe „gezahlt“ = Zufluss nach Datum.
          const total = incomeCsv(r).replace(/^\uFEFF/, '').trim().split('\r\n').at(-1)?.split(';') ?? []
          const cents = (v: string | undefined) => Math.round(Number((v ?? '').replace(',', '.')) * 100)
          if (cents(total[12]) !== x.totalCents || cents(total[15]) !== r.income.paidCents) fail(`Einnahmen.csv: Summe ${total[12]} / gezahlt ${total[15]}`)
          if (sum(x.byTenancy, (b) => b.flatRateCents) !== x.flatRateCents) fail('Σ byTenancy.flatRateCents ≠ flatRateCents')
          if (sum(x.byTenancy, (b) => b.fromPreviousCents) !== x.turnOfYear.fromPreviousCents) fail('Σ byTenancy.fromPreviousCents ≠ fromPreviousCents')
          if (r.surplusReceivedCents !== x.totalCents - r.expenses.deductibleCents) fail('surplusReceivedCents ≠ totalCents − abziehbare Werbungskosten')
          if (x.relatives.sollRentCents > r.income.baseRentSollCents || x.relatives.sollAllocationsCents > r.income.prepaymentSollCents + r.income.flatRateSollCents) fail('Soll der Angehörigen größer als das ganze Soll')
          // fromPrevious(Y) = forward(Y − 1).
          if (year > (TAX_STOCK_YEARS[0] ?? year)) {
            const before = receivedOf(reportOf(year - 1))
            if (before.turnOfYear.forwardCents !== x.turnOfYear.fromPreviousCents || before.turnOfYear.forwardAllocationsCents !== x.turnOfYear.fromPreviousAllocationsCents) fail('fromPrevious ≠ forward des Vorjahres')
          }
          // X9 (a): Je Mietverhältnis, Monat und Bestandteil (A, B) ist das Getilgte im Mietkonto des Jahres gleich der Summe
          // der Teile mit Datum bis zum 31.12. aus derselben Tilgung.
          const snap = snapshotFor(s, pid, calendarYearPeriod(year))
          for (const row of rentLedger(snap).rows) {
            const slices = slicesOf.get(row.tenancyId) ?? []
            const t = snap.tenancies.find((u) => u.id === row.tenancyId) ?? assert.fail(`kein Mietverhältnis ${row.tenancyId}`)
            for (const mo of row.months) {
              if (mo.status === 'notRecorded') continue
              const month = `${year}-${String(mo.month).padStart(2, '0')}`
              const own = slices.filter((sl) => sl.month === month && sl.paidOn <= `${year}-12-31`)
              const paidA = sum(own.filter((sl) => sl.component === 'prepayment' || sl.component === 'heatingPrepayment'), (sl) => sl.cents)
              const paidB = sum(own.filter((sl) => sl.component === 'baseRent' || sl.component === 'flatRate'), (sl) => sl.cents)
              const soll = monthSoll(t, month)
              const claimA = Math.max(0, soll.prepayment) + Math.max(0, soll.heatingPrepayment)
              const claimB = Math.max(0, soll.baseRent) + Math.max(0, soll.flatRate)
              if (mo.paidCents !== paidA + paidB || mo.openPrepaymentCents !== claimA - paidA || mo.openRentCents !== claimB - paidB) {
                fail(`Mietkonto ${row.tenancyId} ${month}: bezahlt ${mo.paidCents} / offen A ${mo.openPrepaymentCents} B ${mo.openRentCents}, Teile ${paidA} + ${paidB}`)
              }
            }
          }
          if (x.formerYearsCents > 0) seen.formerYears++
          if (x.formerYearsCents < 0) seen.negativeFormer++
          if (x.unallocatedCents !== 0) seen.unallocated++
          if (x.turnOfYear.forwardCents !== 0) seen.forward++
          if (x.turnOfYear.fromPreviousCents !== 0) seen.fromPrevious++
          if (x.turnOfYear.lateDecemberCents !== 0) seen.lateDecember++
          if (x.relatives.rentCents !== 0) seen.relatives++
          if (x.flatRateCents !== 0) seen.flatRate++
          if (x.inclusiveRentCents !== 0) seen.inclusive++
          if (x.turnOfYear.forwardOldLeaseCents !== 0) seen.forwardOldLease++
          if (x.possibleDeposits.length > 0) seen.possibleDeposits++
          const tenancyOf = (id: string) => s.tenancies.find((t) => t.id === id)
          if (x.byTenancy.some((b) => b.inclusiveRentCents !== 0 && tenancyOf(b.tenancyId)?.costModel !== 'inclusive')) seen.warmInclusive++
          if (x.byTenancy.some((b) => !b.relative && tenancyOf(b.tenancyId)?.relative === true && tenancyOf(b.tenancyId)?.persons === 0)) seen.relativeWithoutResident++
        }
      }
    }
    // Der eingefrorene Stand friert nichts von den Einnahmen ein (E11).
    if (closed) {
      for (const pid of objects) for (const year of TAX_STOCK_YEARS) {
        if (JSON.stringify(receivedOf(taxReportFor(closed, pid, year))) !== JSON.stringify(receivedOf(taxReportFor(source, pid, year)))) fails.push(`Startwert ${seed} (${pid}) ${year}: Abschluss ändert received`)
      }
    }
    const hash = sha256(prints)
    if (GOLDEN_WRITE) {
      if (fails.length === seedFails) golden[String(seed)] = hash
    } else if (Object.hasOwn(golden, String(seed))) {
      goldenChecked++
      if (golden[String(seed)] !== hash) fails.push(`Startwert ${seed}: Prüfsumme weicht von test/fixtures/tax-received-golden.json ab`)
    }
  }
  assert.deepEqual(fails.slice(0, 20), [], `${fails.length} Befunde`)
  if (GOLDEN_WRITE) fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(golden).sort(([a], [b]) => Number(a) - Number(b))), null, 1)}\n`)
  // Der Generator muss jede Lage erzeugen, sonst prüft die Invariante sie nicht.
  if (SEEDS.length >= 20) {
    for (const [k, v] of Object.entries({ ...seen, ...oracleSeen })) assert.ok(v > 0, `keine Lage ${k}`)
    if (!GOLDEN_WRITE) assert.ok(goldenChecked >= 20, `nur ${goldenChecked} Startwerte gegen tax-received-golden.json geprüft`)
  }
  assert.ok(compared > 0)
})

test('Invariante: wer jeden Monat genau das Soll zahlt, hat Zeile 15/18 + 20 = Soll des Jahres und keine Zeile 25 (X9 f)', () => {
  let compared = 0
  for (const seed of SEEDS) {
    const { source, objects } = stockOf(seed, true)
    for (const pid of objects) for (const year of TAX_STOCK_YEARS) {
      const r = taxReportFor(source, pid, year)
      const x = receivedOf(r)
      const at = `Startwert ${seed} (${pid}) ${year}`
      assert.equal(x.rentCents + x.allocationsCents, r.income.baseRentSollCents + r.income.prepaymentSollCents + r.income.flatRateSollCents, at)
      assert.equal(x.allocationsCents, r.income.prepaymentSollCents + r.income.flatRateSollCents, at)
      assert.equal(x.flatRateCents, r.income.flatRateSollCents, at)
      assert.equal(x.inclusiveRentCents, r.income.inclusiveRentSollCents, at)
      assert.equal(x.formerYearsCents, 0, at)
      assert.equal(x.unallocatedCents, 0, at)
      compared++
    }
  }
  assert.ok(compared > 0)
})

test('Invariante: ohne Angehörige sind die Teilsummen 0; alle übrigen Felder gleich mit und ohne received', () => {
  for (const seed of SEEDS) {
    const { source, objects } = stockOf(seed)
    const strangers = { ...source, tenancies: source.tenancies.map(({ relative: _, ...t }) => t) } as TaxSource
    for (const pid of objects) for (const year of [2024, 2026, 2028]) {
      const at = `Startwert ${seed} (${pid}) ${year}`
      const x = receivedOf(taxReportFor(strangers, pid, year))
      assert.deepEqual([x.relatives.rentCents, x.relatives.allocationsCents, x.relatives.settlementCents, x.relatives.sollRentCents], [0, 0, 0, 0], at)
      assert.ok(x.byTenancy.every((b) => !b.relative), at)
      const mit = taxReportFor(source, pid, year)
      const ohne = taxReportFor(source, pid, year, undefined, { received: false })
      const { received: _, ...income } = mit.income
      const { surplusReceivedCents: __, ...rest } = mit
      assert.deepEqual({ ...rest, income }, ohne, at)
    }
  }
})
