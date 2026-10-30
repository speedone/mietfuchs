// Invarianten der Tilgung nach § 366 BGB (#312 PR 1, rentAllocation.ts) über zufällige Mietverhältnisse mit festem
// Startwert (server/testing/rentStock.ts). Die Beispielfälle stehen in rentAllocation.test.ts; die schiefen
// Konstellationen (Rücklastschrift nach Teilzahlung, Staffel auf 0, Zahlung vor Beginn und nach Auszug, Monat laut
// Verwendungszweck außerhalb) findet nur dieser Test. Mehr Startwerte mit INV_FROM/INV_TO.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ledgerRows } from '../src/calc.ts'
import { calendarYearPeriod } from '../../shared/period.ts'
import { monthSoll, type SollComponent } from '../../shared/monthRate.ts'
import { rentDueDate } from '../../shared/deadlines.ts'
import { STATE_CODES } from '../../shared/holidays.ts'
import { allocateRentPayments, FUTURE_MONTHS, monthCoverage, openingBalance, type AllocationPayment, type AllocationSlice } from '../src/rentAllocation.ts'
import type { SnapshotTenancy } from '../src/snapshot.ts'
import { addMonths, makeRng, monthsBetween, randomRentStock } from '../testing/rentStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 300)
const seeds = (): number[] => Array.from({ length: TO - FROM + 1 }, (_, k) => FROM + k)
const yearsOf = (start: string, end: string | null): number[] => {
  const to = Number((end ?? '2030').slice(0, 4))
  return Array.from({ length: to - Number(start.slice(0, 4)) + 1 }, (_, k) => Number(start.slice(0, 4)) + k)
}

test('monthSoll: je Monat dieselben Bestandteile wie das Mietkonto (ledgerRows)', () => {
  for (const seed of seeds()) {
    const { tenancy } = randomRentStock(makeRng(seed))
    for (const year of yearsOf(tenancy.start, tenancy.end)) {
      const [row] = ledgerRows({ units: [], tenancies: [tenancy], payments: [] }, calendarYearPeriod(year))
      if (!row) assert.fail(`Startwert ${seed}, ${year}: keine Zeile im Mietkonto`)
      for (const [k, m] of monthsBetween(`${year}-01`, `${year}-12`).entries()) {
        const mo = row.months[k]
        if (!mo) assert.fail(`Startwert ${seed}: Monat ${m} fehlt`)
        assert.deepEqual(monthSoll(tenancy, m), {
          prepayment: mo.prepaymentCents,
          heatingPrepayment: mo.heatingPrepaymentCents ?? 0,
          baseRent: mo.baseRentCents,
          flatRate: mo.flatRateCents,
        }, `Startwert ${seed}, ${m}`)
      }
    }
  }
})

const COMPONENTS: readonly SollComponent[] = ['prepayment', 'heatingPrepayment', 'baseRent', 'flatRate']
const sollTotal = (t: SnapshotTenancy, m: string): number => COMPONENTS.reduce((a, c) => a + monthSoll(t, m)[c], 0)
const isRent = (p: AllocationPayment): boolean => (p.kind ?? 'rent') === 'rent'
const lastMonthOf = (t: SnapshotTenancy, payments: readonly AllocationPayment[]): string =>
  [t.end?.slice(0, 7) ?? addMonths(t.start.slice(0, 7), 60), ...payments.map((p) => addMonths(p.date.slice(0, 7), 1))].reduce((a, b) => (a > b ? a : b))

test('Tilgung: Σ Teile je Zahlung = Betrag; negative Teile nur aus einer negativen Zahlung (Rücknahme)', () => {
  for (const seed of seeds()) {
    const { tenancy, payments } = randomRentStock(makeRng(seed))
    const slices = allocateRentPayments(tenancy, payments)
    for (const p of payments) {
      const own = slices.filter((s) => s.paymentId === p.id)
      const expected = isRent(p) ? p.amountCents : 0
      assert.equal(own.reduce((a, s) => a + s.cents, 0), expected, `Startwert ${seed}, Zahlung ${p.id}`)
      for (const s of own) assert.ok(s.cents !== 0 && Math.sign(s.cents) === Math.sign(p.amountCents), `Startwert ${seed}: Teil ${JSON.stringify(s)} gegen Zahlung ${p.amountCents}`)
      for (const s of own) assert.equal(s.paidOn, p.date)
      for (const s of own) assert.equal(s.month === null, s.component === 'unallocated')
    }
    assert.equal(slices.filter((s) => !payments.some((p) => p.id === s.paymentId)).length, 0)
  }
})

test('Tilgung: je Monat und Bestandteil 0 ≤ Σ getilgt ≤ Soll, nach jeder Zahlung; ein Teil ohne Forderung erst, wenn alles gedeckt ist', () => {
  for (const seed of seeds()) {
    const { tenancy, payments } = randomRentStock(makeRng(seed))
    const slices = allocateRentPayments(tenancy, payments)
    const running = new Map<string, number>()
    const byPayment = new Map<string, AllocationSlice[]>()
    for (const s of slices) byPayment.set(s.paymentId, [...(byPayment.get(s.paymentId) ?? []), s])
    // Die Teile stehen in der Reihenfolge der Tilgung; je Zahlung geprüft wird der Stand danach.
    const order = [...new Set(slices.map((s) => s.paymentId))]
    for (const id of order) {
      const own = byPayment.get(id) ?? []
      for (const s of own) {
        if (s.month === null || s.component === 'unallocated') continue
        const key = `${s.month} ${s.component}`
        const next = (running.get(key) ?? 0) + s.cents
        running.set(key, next)
        const soll = Math.max(0, monthSoll(tenancy, s.month)[s.component])
        assert.ok(next >= 0 && next <= soll, `Startwert ${seed}, ${key}: ${next} außerhalb 0…${soll}`)
      }
      const leftover = own.find((s) => s.component === 'unallocated' && s.cents > 0)
      if (!leftover) continue
      const paidMonth = leftover.paidOn.slice(0, 7)
      const upTo = [tenancy.end?.slice(0, 7) ?? addMonths(paidMonth, FUTURE_MONTHS), addMonths(paidMonth, FUTURE_MONTHS)].reduce((a, b) => (a < b ? a : b))
      for (const m of monthsBetween(tenancy.start.slice(0, 7), upTo)) {
        for (const c of COMPONENTS) {
          assert.equal(running.get(`${m} ${c}`) ?? 0, Math.max(0, monthSoll(tenancy, m)[c]), `Startwert ${seed}: ${m} ${c} offen trotz Teil ohne Forderung am ${leftover.paidOn}`)
        }
      }
    }
  }
})

test('Tilgung: die Reihenfolge der Eingabe ist gleich (Permutation der Zahlungen)', () => {
  for (const seed of seeds()) {
    const rnd = makeRng(seed)
    const { tenancy, payments } = randomRentStock(rnd)
    const shuffled = payments.map((p) => ({ p, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.p)
    assert.deepEqual(allocateRentPayments(tenancy, shuffled), allocateRentPayments(tenancy, payments), `Startwert ${seed}`)
  }
})

test('Tilgung: jeder Monat genau bezahlt ergibt je Monat das Soll und denselben Status wie das Mietkonto heute (Zusage aus #281)', () => {
  for (const seed of seeds()) {
    const rnd = makeRng(seed)
    const shape = randomRentStock(makeRng(seed)).tenancy
    const { tenancy, payments } = randomRentStock(rnd, { exact: (m) => sollTotal(shape, m) })
    assert.deepEqual(tenancy, shape, `Startwert ${seed}: derselbe Bestand`)
    const slices = allocateRentPayments(tenancy, payments)
    assert.equal(slices.filter((s) => s.component === 'unallocated').length, 0, `Startwert ${seed}`)
    const ledgerPayments = payments.map((p) => ({ tenancyId: tenancy.id, date: p.date, amountCents: p.amountCents }))
    for (const year of yearsOf(tenancy.start, lastMonthOf(tenancy, payments))) {
      const [row] = ledgerRows({ units: [], tenancies: [tenancy], payments: ledgerPayments }, calendarYearPeriod(year))
      if (!row) continue
      const months = monthsBetween(`${year}-01`, `${year}-12`)
      const coverage = monthCoverage(tenancy, slices, months, `${year}-12-31`)
      for (const [k, c] of coverage.entries()) {
        const mo = row.months[k]
        if (!mo) assert.fail(`Startwert ${seed}: Monat ${c.month} fehlt im Mietkonto`)
        const paid = COMPONENTS.reduce((a, x) => a + c.paid[x], 0)
        assert.equal(c.covered, mo.status === 'paid', `Startwert ${seed}, ${c.month}: gedeckt ${c.covered}, Mietkonto ${mo.status}`)
        assert.equal(paid, mo.paidCents, `Startwert ${seed}, ${c.month}: getilgt`)
        for (const x of COMPONENTS) if (payments.some((p) => p.date.startsWith(c.month))) assert.equal(c.paid[x], c.soll[x], `Startwert ${seed}, ${c.month} ${x}`)
      }
      // Anfangssaldo 0, soweit gezahlt wurde: offen sind nur Monate ohne Zahlung (nach dem letzten erzeugten Monat).
      const unpaid = monthsBetween(tenancy.start.slice(0, 7), `${year - 1}-12`).filter((m) => !payments.some((p) => p.date.startsWith(m)))
      assert.equal(openingBalance(tenancy, payments, `${year}-01-01`), 0 - unpaid.reduce((a, m) => a + sollTotal(tenancy, m), 0), `Startwert ${seed}: Anfangssaldo ${year}`)
    }
  }
})

test('openingBalance: Saldo(01.01.Y+1) = Saldo(01.01.Y) + Mietzahlungen in Y − Soll in Y, und gleich der Summe der Teile', () => {
  for (const seed of seeds()) {
    const { tenancy, payments } = randomRentStock(makeRng(seed))
    const slices = allocateRentPayments(tenancy, payments)
    const first = Number(tenancy.start.slice(0, 4)) - 1
    const last = Number(lastMonthOf(tenancy, payments).slice(0, 4)) + 1
    for (let y = first; y <= last; y++) {
      const on = `${y}-01-01`
      const paidInYear = payments.filter((p) => isRent(p) && p.date.startsWith(`${y}-`)).reduce((a, p) => a + p.amountCents, 0)
      const sollInYear = monthsBetween(`${y}-01`, `${y}-12`).reduce((a, m) => a + sollTotal(tenancy, m), 0)
      assert.equal(openingBalance(tenancy, payments, `${y + 1}-01-01`), openingBalance(tenancy, payments, on) + paidInYear - sollInYear, `Startwert ${seed}, ${y}`)
      // Vorausbezahlt (Monat ab Januar Y) und ohne Forderung, abzüglich des Offenen früherer Monate.
      const before = slices.filter((s) => s.paidOn < on)
      const ahead = before.filter((s) => s.month === null || s.month >= `${y}-01`).reduce((a, s) => a + s.cents, 0)
      const earlier = monthsBetween(tenancy.start.slice(0, 7), addMonths(`${y}-01`, -1))
      const open = earlier.reduce((a, m) => a + sollTotal(tenancy, m), 0) - before.filter((s) => s.month !== null && s.month < `${y}-01`).reduce((a, s) => a + s.cents, 0)
      assert.equal(openingBalance(tenancy, payments, on), ahead - open, `Startwert ${seed}, Saldo am ${on}`)
    }
  }
})

test('monthCoverage: ein später gedeckter Monat ist am Tag von paidLaterOn gedeckt, am Vortag nicht', () => {
  for (const seed of seeds()) {
    const { tenancy, payments } = randomRentStock(makeRng(seed))
    const slices = allocateRentPayments(tenancy, payments)
    const months = monthsBetween(tenancy.start.slice(0, 7), lastMonthOf(tenancy, payments))
    for (const c of monthCoverage(tenancy, slices, months, `${tenancy.start.slice(0, 4)}-12-31`)) {
      if (c.paidLaterOn === null) continue
      const [then] = monthCoverage(tenancy, slices, [c.month], c.paidLaterOn)
      assert.equal(then?.covered, true, `Startwert ${seed}, ${c.month} am ${c.paidLaterOn}`)
      const [everAfter] = monthCoverage(tenancy, slices, [c.month], '9999-12-31')
      assert.equal(everAfter?.covered, true, `Startwert ${seed}, ${c.month} zuletzt`)
    }
  }
})

test('Zehn-Tage-Regel (E8): die Januarmiete ist in jedem Land 1995 bis 2100 spätestens am 10.01. fällig', () => {
  // Die Tilgung fragt kein Bundesland; ein Teil vom 22.12. bis 31.12. für Januar liegt deshalb nur dann sicher in den
  // zehn Tagen des § 11 Abs. 1 Satz 2 EStG, wenn der Fälligkeitstag nie nach dem 10.01. liegt. Der Test darf
  // rentDueDate lesen, die Rechnung nicht.
  for (let year = 1995; year <= 2100; year++) {
    for (const state of [...STATE_CODES, null]) {
      const due = rentDueDate(`${year}-01`, state)
      assert.ok(due <= `${year}-01-10`, `${state ?? 'ohne Land'} ${year}: fällig am ${due}`)
    }
  }
})
