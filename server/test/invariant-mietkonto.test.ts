// Invarianten des Mietkontos mit Übertrag (#281, Entwurf docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md)
// über zufällige Mietverhältnisse mit festem Startwert (server/testing/rentStock.ts). Mehr Startwerte mit INV_FROM/INV_TO.
//
// - Wer jeden Monat genau das Soll im Monat zahlt, sieht dieselben Zahlen wie vor #281 (Orakel: das alte FIFO je Jahr,
//   server/testing/fifoLedger.ts), Anfangssaldo 0 (X9 f).
// - Endsaldo(Y) = Anfangssaldo(Y+1).
// - Getilgt im Mietkonto = Σ Teile aus `allocateRentPayments` (X9 a, je Monat bis zum 31.12. des Jahres).
// - Endsaldo + Rückstand = vorausbezahlte Teile und Teile ohne Forderung (die Überzahlung).
// - `arrearsCents + notDemandableCents` = offene Teile fälliger Monate; Kaltmiete und Pauschale nie nicht
//   einforderbar; ohne `statements` keine Klassifikation (X9 h).
// - Hinweis `prepayment.arrears` (E6): genau dann, wenn Vorauszahlungen fälliger Monate des Zeitraums offen sind, und
//   mit deren Summe; kein Hinweis, wenn nur Kaltmiete oder Pauschale offen ist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, taxReport, type LedgerStatement } from '../src/calc.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { calendarYearPeriod, calendarPeriod } from '../../shared/period.ts'
import { monthSoll, type SollComponent } from '../../shared/monthRate.ts'
import { allocateRentPayments, ledgerTenancy, monthCoverage } from '../src/rentAllocation.ts'
import { fifoLedgerRows } from '../testing/fifoLedger.ts'
import { addMonths, makeRng, monthsBetween, randomRentStock, type RentStock } from '../testing/rentStock.ts'
import type { RentLedgerRow, RentMonth } from '../../shared/types.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 200)
const seeds = (): number[] => Array.from({ length: TO - FROM + 1 }, (_, k) => FROM + k)
const COMPONENTS: readonly SollComponent[] = ['prepayment', 'heatingPrepayment', 'baseRent', 'flatRate']
const sollTotal = (t: SnapshotTenancy, m: string): number => COMPONENTS.reduce((a, c) => a + monthSoll(t, m)[c], 0)

const sourceOf = (tenancy: SnapshotTenancy, payments: SnapshotPayment[]): SnapshotSource => ({
  units: [{ id: tenancy.unitId, name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy], costItems: [], meters: [], readings: [], payments, closedSettlements: [],
})
const snapshotPayments = ({ tenancy, payments }: RentStock): SnapshotPayment[] => payments.map((p) => ({ ...p, tenancyId: tenancy.id }))
const rowIn = (tenancy: SnapshotTenancy, payments: SnapshotPayment[], year: number, options: Parameters<typeof rentLedger>[1]): RentLedgerRow | undefined =>
  rentLedger(snapshotOf(sourceOf(tenancy, payments), year), options).rows.find((r) => r.tenancyId === tenancy.id)
const yearsBetween = (from: string, to: string): number[] => {
  const a = Number(from.slice(0, 4))
  return Array.from({ length: Number(to.slice(0, 4)) - a + 1 }, (_, k) => a + k)
}
const lastPaidMonth = (stock: RentStock): string => stock.payments.map((p) => p.date.slice(0, 7)).reduce((a, b) => (a > b ? a : b), stock.tenancy.start.slice(0, 7))

test('Jeder Monat genau bezahlt: Status, getilgt, Rückstand, offene Monate und Saldo wie vor #281, Anfangssaldo 0', () => {
  for (const seed of seeds()) {
    const shape = randomRentStock(makeRng(seed)).tenancy
    const stock = randomRentStock(makeRng(seed), { exact: (m) => sollTotal(shape, m) })
    const payments = snapshotPayments(stock)
    const { tenancy } = stock
    const rnd = makeRng(seed * 7 + 1)
    for (const year of yearsBetween(tenancy.start, lastPaidMonth(stock))) {
      // Ohne Stichtag, mitten im Jahr und danach.
      for (const asOf of [undefined, `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15`, `${year + 1}-02-01`]) {
        const options = asOf === undefined ? {} : { asOf }
        const [old] = fifoLedgerRows(sourceOf(tenancy, payments), calendarYearPeriod(year), options)
        const row = rowIn(tenancy, payments, year, options)
        if (!old || !row) { assert.equal(row, old, `Startwert ${seed}, ${year}: Zeile`); continue }
        const at = `Startwert ${seed}, ${year}, Stichtag ${asOf ?? '–'}`
        // Nur bis zum letzten erzeugten Monat ist jeder Monat bezahlt; danach ist der Bestand nicht „genau bezahlt“.
        const lastMonth = lastPaidMonth(stock)
        if (`${year}-12` > lastMonth) continue
        assert.equal(row.openingBalanceCents, 0, `${at}: Anfangssaldo`)
        assert.deepEqual(row.months.map((m) => [m.status, m.paidCents]), old.months.map((m) => [m.status, m.paidCents]), `${at}: Monate`)
        assert.equal(row.arrearsCents, old.arrearsCents, `${at}: Rückstand`)
        assert.equal(row.openMonths, old.openMonths, `${at}: offene Monate`)
        assert.equal(row.balanceCents, old.balanceCents, `${at}: Saldo`)
        assert.equal(row.paidYearCents, old.paidYearCents, `${at}: Eingänge`)
        assert.equal(row.sollYearCents, old.sollYearCents, `${at}: Soll`)
      }
    }
  }
})

test('Übertrag: Endsaldo eines Jahres = Anfangssaldo des nächsten; getilgt je Monat = Σ Teile bis zum 31.12.', () => {
  for (const seed of seeds()) {
    const stock = randomRentStock(makeRng(seed))
    const payments = snapshotPayments(stock)
    const { tenancy } = stock
    // Geführt ab der ersten erfassten Mietzahlung (`ledgerStart`); davor zählt jedes Jahr für sich.
    const tracked = ledgerTenancy(tenancy, stock.payments, 9999)
    const slices = allocateRentPayments(tracked, stock.payments)
    const last = addMonths(lastPaidMonth(stock), 12)
    for (const year of yearsBetween(tracked.start, last)) {
      const a = rowIn(tenancy, payments, year, { asOf: `${year + 1}-01-15` })
      if (!a) continue
      const b = rowIn(tenancy, payments, year + 1, { asOf: `${year + 2}-01-15` })
      if (b) assert.equal(a.closingBalanceCents, b.openingBalanceCents, `Startwert ${seed}, ${year}`)
      const until = `${year}-12-31`
      for (const [k, m] of monthsBetween(`${year}-01`, `${year}-12`).entries()) {
        const mo: RentMonth = a.months[k] ?? assert.fail(`Startwert ${seed}: Monat ${m} fehlt`)
        const own = slices.filter((s) => s.month === m && s.paidOn <= until)
        assert.equal(mo.paidCents, own.reduce((x, s) => x + s.cents, 0), `Startwert ${seed}, ${m}: getilgt`)
        const prepaid = own.filter((s) => s.component === 'prepayment' || s.component === 'heatingPrepayment').reduce((x, s) => x + s.cents, 0)
        const soll = monthSoll(tracked, m)
        assert.equal(mo.openPrepaymentCents, Math.max(0, soll.prepayment) + Math.max(0, soll.heatingPrepayment) - prepaid, `Startwert ${seed}, ${m}: offen A`)
      }
      // Endsaldo + Rückstand = Überzahlung: Teile für Monate nach dem Jahr und ohne Forderung, gezahlt bis zum 31.12.
      const over = slices.filter((s) => s.paidOn <= until && (s.month === null || s.month > `${year}-12`)).reduce((x, s) => x + s.cents, 0)
      assert.equal(a.closingBalanceCents + a.arrearsCents, over, `Startwert ${seed}, ${year}: Überzahlung`)
    }
  }
})

test('Abrechnungsreife: Rückstand + nicht einforderbar = offene Teile fälliger Monate; Kaltmiete nie nicht einforderbar', () => {
  for (const seed of seeds()) {
    const stock = randomRentStock(makeRng(seed))
    const payments = snapshotPayments(stock)
    const { tenancy } = stock
    const rnd = makeRng(seed * 13 + 5)
    const statements: LedgerStatement[] = yearsBetween(tenancy.start, '2031-01').map((y) => {
      const closed = rnd() < 0.5
      return {
        label: String(y), months: monthsBetween(`${y}-01`, `${y}-12`), deadline: `${y + 1}-12-31`, closed,
        sentAt: closed && rnd() < 0.7 ? `${y + 1}-0${1 + Math.floor(rnd() * 9)}-10` : null,
        credited: closed ? new Map([[tenancy.id, Math.floor(rnd() * 300000)]]) : null,
        covers: () => true,
      }
    })
    for (const year of yearsBetween(tenancy.start, addMonths(lastPaidMonth(stock), 24))) {
      const asOf = `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-20`
      const plain = rowIn(tenancy, payments, year, { asOf })
      const classified = rowIn(tenancy, payments, year, { asOf, statements })
      if (!plain || !classified) continue
      const at = `Startwert ${seed}, ${year}`
      assert.equal(plain.notDemandableCents, 0, `${at}: ohne statements`)
      assert.equal(classified.arrearsCents + classified.notDemandableCents, plain.arrearsCents, at)
      assert.equal(classified.notDemandable.reduce((a, n) => a + n.cents, 0), classified.notDemandableCents, `${at}: Gründe`)
      // Nur A-Teile: höchstens die offenen Vorauszahlungen aller Monate bis zum Jahr.
      const tracked = ledgerTenancy(tenancy, stock.payments, year)
      const slices = allocateRentPayments(tracked, stock.payments)
      const until = `${year}-12-31`
      let openA = 0
      for (const m of monthsBetween(tracked.start.slice(0, 7), `${year}-12`)) {
        const soll = monthSoll(tenancy, m)
        const paidA = slices.filter((s) => s.month === m && s.paidOn <= until && (s.component === 'prepayment' || s.component === 'heatingPrepayment')).reduce((a, s) => a + s.cents, 0)
        openA += Math.max(0, soll.prepayment) + Math.max(0, soll.heatingPrepayment) - paidA
      }
      assert.ok(classified.notDemandableCents <= openA, `${at}: ${classified.notDemandableCents} > offene Vorauszahlungen ${openA}`)
      assert.ok(classified.notDemandableCents >= 0, at)
    }
  }
})

test('Monat laut Verwendungszweck ändert Abrechnung und Steuer nicht (X9 g)', () => {
  for (const seed of seeds().slice(0, 80)) {
    const stock = randomRentStock(makeRng(seed))
    const year = Number(stock.tenancy.start.slice(0, 4)) + 1
    const withMonth = snapshotPayments(stock)
    const without = withMonth.map(({ designatedMonth: _, ...p }) => p)
    const items = [{ id: 'g', period: calendarPeriod(year), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' as const }]
    const a = snapshotOf({ ...sourceOf(stock.tenancy, withMonth), costItems: items }, year)
    const b = snapshotOf({ ...sourceOf(stock.tenancy, without), costItems: items }, year)
    const strip = (s: ReturnType<typeof computeSettlement>) => ({ ...s, notices: [], warnings: [] })
    assert.deepEqual(strip(computeSettlement(a)), strip(computeSettlement(b)), `Startwert ${seed}: Abrechnung`)
    // Die Steuer bis auf die Aufteilung des Zugeflossenen (#312 PR 2): Der Monat laut Verwendungszweck verschiebt Teile
    // zwischen den Zeilen 15/18, 20 und 25 (§ 366 Abs. 1 BGB), die Summe bleibt.
    const ta = taxReport(a)
    const tb = taxReport(b)
    const { received: ra, ...ia } = ta.income
    const { received: rb, ...ib } = tb.income
    assert.deepEqual({ ...ta, income: ia }, { ...tb, income: ib }, `Startwert ${seed}: Steuer`)
    // Zehn-Tage-Regel (#312 E8): Was nach § 11 Abs. 1 Satz 2 EStG ins Nachbarjahr wandert, zählt hier wieder dazu.
    const lines = (r: typeof ra): number => (r ? r.rentCents + r.allocationsCents + r.formerYearsCents + r.turnOfYear.forwardCents - r.turnOfYear.fromPreviousCents : assert.fail('received fehlt'))
    assert.equal(lines(ra), lines(rb), `Startwert ${seed}: Summe der Zeilen`)
  }
})

test('Hinweis prepayment.arrears: genau bei offenen Vorauszahlungen fälliger Monate, mit ihrer Summe (E6)', () => {
  const euro = (cents: number): string => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  let seen = 0
  for (const seed of seeds().slice(0, 120)) for (const after of [0, 1, 2]) {
    const stock = randomRentStock(makeRng(seed))
    const payments = snapshotPayments(stock)
    const { tenancy } = stock
    const year = Number(tenancy.start.slice(0, 4)) + after
    const asOf = `${year}-${String(1 + (seed % 12)).padStart(2, '0')}-20`
    const items = [{ id: 'g', period: calendarPeriod(year), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' as const }]
    const snapshot = snapshotOf({ ...sourceOf(tenancy, payments), costItems: items }, year)
    const s = computeSettlement(snapshot, { asOf })
    const notices = s.notices.filter((n) => n.code === 'prepayment.arrears')
    const st = s.statements.find((x) => x.tenancyId === tenancy.id)
    const ledgerInUse = payments.some((p) => (p.kind ?? 'rent') === 'rent' && p.date.startsWith(`${year}-`))
    const due = monthsBetween(`${year}-01`, `${year}-12`).filter((m) => m < asOf.slice(0, 7))
    const tracked = ledgerTenancy(tenancy, stock.payments, year)
    const coverage = monthCoverage(tracked, allocateRentPayments(tracked, stock.payments), due, asOf)
    const openA = coverage.reduce((a, c) => a + c.soll.prepayment - c.paid.prepayment + c.soll.heatingPrepayment - c.paid.heatingPrepayment, 0)
    const at = `Startwert ${seed}, ${year}`
    if (!st || st.prepaymentOverridden || st.prepaymentCents <= 0 || !ledgerInUse || openA <= 0) {
      assert.equal(notices.length, 0, `${at}: kein Hinweis erwartet (offen ${openA})`)
      continue
    }
    seen++
    assert.equal(notices.length, 1, `${at}: Hinweis erwartet (offen ${openA})`)
    assert.ok(notices[0]?.text.includes(`sind ${euro(openA)} nicht gezahlt`), `${at}: ${notices[0]?.text}`)
  }
  assert.ok(seen > 10, `nur ${seen} Fälle mit Hinweis`)
})

test('Erfassung beginnt in einem späteren Monat: ab dort dieselben Zahlen wie vor #281, davor nicht erfasst, Anfangssaldo 0 (geführt ab)', () => {
  let compared = 0
  for (const seed of seeds()) {
    const shape = randomRentStock(makeRng(seed)).tenancy
    const exact = randomRentStock(makeRng(seed), { exact: (m) => sollTotal(shape, m) })
    const { tenancy } = exact
    // Erfasst erst ab dem zweiten oder dritten Kalenderjahr nach Beginn; die Monate davor sind nicht erfasst.
    const year = Number(tenancy.start.slice(0, 4)) + 1 + (seed % 2)
    const payments = snapshotPayments(exact).filter((p) => Number(p.date.slice(0, 4)) >= year)
    const first = payments.map((p) => p.date.slice(0, 7)).reduce<string | null>((a, b) => (a === null || b < a ? b : a), null)
    if (first === null || !first.startsWith(`${year}-`) || `${year}-12` > lastPaidMonth(exact)) continue
    const clip = `${first}-01` > tenancy.start ? `${first}-01` : tenancy.start
    // Das Orakel rechnet das Jahr ab dem Beginn der Erfassung (FIFO je Jahr, wie bis 0.13).
    const oracle: SnapshotTenancy = { ...tenancy, start: clip }
    for (const asOf of [undefined, `${year}-07-15`, `${year + 1}-02-01`]) {
      const options = asOf === undefined ? {} : { asOf }
      const [old] = fifoLedgerRows(sourceOf(oracle, payments), calendarYearPeriod(year), options)
      const row = rowIn(tenancy, payments, year, options)
      if (!old || !row) { assert.equal(row, old, `Startwert ${seed}: Zeile`); continue }
      const at = `Startwert ${seed}, ${year}, Stichtag ${asOf ?? '–'}`
      assert.equal(row.openingBalanceCents, 0, `${at}: Anfangssaldo`)
      assert.equal(row.ledgerStart, clip === tenancy.start ? undefined : clip, `${at}: geführt ab`)
      for (const [k, mo] of row.months.entries()) {
        const m = `${year}-${String(k + 1).padStart(2, '0')}`
        const o = old.months[k] ?? assert.fail(`${at}: Monat ${m}`)
        if (m < clip.slice(0, 7)) {
          if (mo.sollCents > 0) assert.equal(mo.status, 'notRecorded', `${at}: ${m} nicht erfasst`)
          continue
        }
        assert.deepEqual([mo.status, mo.paidCents], [o.status, o.paidCents], `${at}: ${m}`)
      }
      assert.equal(row.arrearsCents, old.arrearsCents, `${at}: Rückstand`)
      assert.equal(row.openMonths, old.openMonths, `${at}: offene Monate`)
      compared++
    }
  }
  assert.ok(compared > 50, `nur ${compared} Vergleiche`)
})
