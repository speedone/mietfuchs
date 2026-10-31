// Tilgung der Mietzahlungen nach § 366 BGB (#312 PR 1, Entwurf 2026-10-30-steuer-zufluss-design.md, E2/E3):
// Beispielfälle. Die Invarianten über Zufallsbestände stehen in invariant-tilgung.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { allocateRentPayments, monthCoverage, openingBalance, type AllocationSlice, type MonthCoverage, type RentComponent } from '../src/rentAllocation.ts'
import { monthSoll } from '../../shared/monthRate.ts'
import { rentPayment, rentTenancy, monthsBetween } from '../testing/rentStock.ts'

// 600 € Kaltmiete und 200 € Vorauszahlung ab Januar 2025, also 800 € im Monat.
const standard = (over: Parameters<typeof rentTenancy>[0] = {}) => rentTenancy({
  start: '2025-01-01',
  baseRents: [{ from: '2025-01', monthlyCents: 60000 }],
  prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
  ...over,
})
// Kurzform eines Teils zum Vergleichen.
const short = (s: AllocationSlice): string => `${s.paymentId} ${s.paidOn} ${s.month ?? '—'} ${s.component} ${s.cents}`
const sumOf = (slices: readonly AllocationSlice[], component: RentComponent, pick: (s: AllocationSlice) => boolean = () => true): number =>
  slices.filter((s) => s.component === component && pick(s)).reduce((a, s) => a + s.cents, 0)
// Die Deckung eines Monats, ausdrücklich gesucht statt mit `?.` behauptet.
const coverageOf = (list: readonly MonthCoverage[], month: string): MonthCoverage => {
  const found = list.find((c) => c.month === month)
  if (!found) assert.fail(`Monat ${month} fehlt in der Deckung (${list.map((c) => c.month).join(', ')})`)
  return found
}
const monthly = (months: readonly string[], cents: number, day = '03') => months.map((m, k) => rentPayment(`p${String(k).padStart(2, '0')}`, `${m}-${day}`, cents))

test('Tilgung: volle Monatsmiete jeden Monat ergibt je Monat genau das Soll je Bestandteil', () => {
  const slices = allocateRentPayments(standard(), monthly(monthsBetween('2025-01', '2025-12'), 80000))
  for (const m of monthsBetween('2025-01', '2025-12')) {
    assert.equal(sumOf(slices, 'prepayment', (s) => s.month === m), 20000, m)
    assert.equal(sumOf(slices, 'baseRent', (s) => s.month === m), 60000, m)
  }
  assert.equal(slices.filter((s) => s.component === 'unallocated').length, 0)
})

test('Tilgung: 300 € auf 600 € Kaltmiete und 200 € Vorauszahlung sind 200 € Vorauszahlung und 100 € Kaltmiete (VIII ZR 84/17 Rn. 57)', () => {
  const slices = allocateRentPayments(standard(), [rentPayment('p', '2025-01-03', 30000)])
  assert.deepEqual(slices.map(short), ['p 2025-01-03 2025-01 prepayment 20000', 'p 2025-01-03 2025-01 baseRent 10000'])
})

test('Tilgung: Beispiel aus dem Issue, Januar bis November je 800 €, Dezember nichts', () => {
  const slices = allocateRentPayments(standard(), monthly(monthsBetween('2025-01', '2025-11'), 80000))
  assert.equal(sumOf(slices, 'baseRent'), 660000)
  assert.equal(sumOf(slices, 'prepayment'), 220000)
})

test('Tilgung: zwei Monate offen, dann 800 €: zuerst beide Vorauszahlungen, dann die Kaltmiete des älteren Monats', () => {
  const slices = allocateRentPayments(standard(), [rentPayment('p', '2025-02-15', 80000)])
  assert.deepEqual(slices.map(short), [
    'p 2025-02-15 2025-01 prepayment 20000',
    'p 2025-02-15 2025-02 prepayment 20000',
    'p 2025-02-15 2025-01 baseRent 40000',
  ])
})

test('Tilgung: Monat laut Verwendungszweck zuerst (A vor B), der Rest an die ältesten Vorauszahlungen (Rn. 56)', () => {
  const slices = allocateRentPayments(standard(), [rentPayment('p', '2025-03-10', 100000, { designatedMonth: '2025-02' })])
  assert.deepEqual(slices.map(short), [
    'p 2025-03-10 2025-02 prepayment 20000',
    'p 2025-03-10 2025-02 baseRent 60000',
    'p 2025-03-10 2025-01 prepayment 20000',
  ])
})

test('Tilgung: ein Monat laut Verwendungszweck außerhalb des Mietverhältnisses wirkt wie keine Bestimmung', () => {
  const payment = (designatedMonth: string | null) => [rentPayment('p', '2025-03-10', 100000, { designatedMonth })]
  const none = allocateRentPayments(standard(), payment(null)).map(short)
  assert.deepEqual(allocateRentPayments(standard(), payment('2024-06')).map(short), none)
  assert.deepEqual(allocateRentPayments(standard({ end: '2025-06-30' }), payment('2025-09')).map(short), allocateRentPayments(standard({ end: '2025-06-30' }), payment(null)).map(short))
  assert.deepEqual(none, [
    'p 2025-03-10 2025-01 prepayment 20000',
    'p 2025-03-10 2025-02 prepayment 20000',
    'p 2025-03-10 2025-03 prepayment 20000',
    'p 2025-03-10 2025-01 baseRent 40000',
  ])
})

test('Tilgung: Kaltmiete und Pauschale im selben Monat verhältnismäßig, der Rest-Cent nach largestRemainder', () => {
  const t = rentTenancy({ baseRents: [{ from: '2025-01', monthlyCents: 60000 }], flatRates: [{ from: '2025-01', monthlyCents: 5000 }] })
  // 100 € auf 600 € und 50 €: 92,3077 € und 7,6923 €; der Rest-Cent geht an den größeren Nachkommaanteil.
  const slices = allocateRentPayments(t, [rentPayment('p', '2025-01-03', 10000)])
  assert.equal(sumOf(slices, 'baseRent'), 9231)
  assert.equal(sumOf(slices, 'flatRate'), 769)
  // Gleichstand: der Schlüssel entscheidet (compareText), „baseRent“ vor „flatRate“.
  const even = rentTenancy({ baseRents: [{ from: '2025-01', monthlyCents: 10000 }], flatRates: [{ from: '2025-01', monthlyCents: 10000 }] })
  const tie = allocateRentPayments(even, [rentPayment('p', '2025-01-03', 101)])
  assert.equal(sumOf(tie, 'baseRent'), 51)
  assert.equal(sumOf(tie, 'flatRate'), 50)
})

test('Tilgung: Heizvorauszahlung und Vorauszahlung sind beide Klasse A und werden verhältnismäßig getilgt', () => {
  const t = standard({ prepayments: [{ from: '2025-01', monthlyCents: 10000 }], heatingPrepayments: [{ from: '2025-01', monthlyCents: 10000 }] })
  const slices = allocateRentPayments(t, [rentPayment('p', '2025-01-03', 101)])
  assert.equal(sumOf(slices, 'heatingPrepayment'), 51)
  assert.equal(sumOf(slices, 'prepayment'), 50)
  assert.equal(sumOf(slices, 'baseRent'), 0)
  // Reicht es für beide, kommt danach die Kaltmiete.
  const full = allocateRentPayments(t, [rentPayment('p', '2025-01-03', 30000)])
  assert.deepEqual([sumOf(full, 'prepayment'), sumOf(full, 'heatingPrepayment'), sumOf(full, 'baseRent')], [10000, 10000, 10000])
})

test('Tilgung: eine Überzahlung geht in den nächsten Monat (A vor B), nach Ende des Mietverhältnisses ist sie ohne Forderung', () => {
  const open = allocateRentPayments(standard(), [rentPayment('p', '2025-01-03', 110000)])
  assert.deepEqual(open.map(short), [
    'p 2025-01-03 2025-01 prepayment 20000',
    'p 2025-01-03 2025-01 baseRent 60000',
    'p 2025-01-03 2025-02 prepayment 20000',
    'p 2025-01-03 2025-02 baseRent 10000',
  ])
  const ended = allocateRentPayments(standard({ end: '2025-01-31' }), [rentPayment('p', '2025-01-03', 110000)])
  assert.deepEqual(ended.map(short).slice(2), ['p 2025-01-03 — unallocated 30000'])
})

test('Tilgung: Dauerauftrag am 28.12. für Januar steht im Januar des Folgejahres, gezahlt im Dezember', () => {
  const t = standard({ start: '2024-12-01', baseRents: [{ from: '2024-12', monthlyCents: 60000 }], prepayments: [{ from: '2024-12', monthlyCents: 20000 }] })
  const slices = allocateRentPayments(t, [rentPayment('a', '2024-12-03', 80000), rentPayment('b', '2024-12-28', 80000)])
  assert.deepEqual(slices.filter((s) => s.paymentId === 'b').map(short), ['b 2024-12-28 2025-01 prepayment 20000', 'b 2024-12-28 2025-01 baseRent 60000'])
  // Vor Beginn des Mietverhältnisses ebenso: die Zahlung gilt dem ersten Monat.
  const before = allocateRentPayments(standard(), [rentPayment('v', '2024-12-28', 80000)])
  assert.deepEqual(before.map(short), ['v 2024-12-28 2025-01 prepayment 20000', 'v 2024-12-28 2025-01 baseRent 60000'])
})

test('Tilgung: Dezembermiete nach Auszug am 05.01. steht im Dezember des Vorjahres', () => {
  const t = standard({ end: '2025-12-31' })
  const payments = [...monthly(monthsBetween('2025-01', '2025-11'), 80000), rentPayment('dez', '2026-01-05', 80000)]
  const slices = allocateRentPayments(t, payments)
  assert.deepEqual(slices.filter((s) => s.paymentId === 'dez').map(short), ['dez 2026-01-05 2025-12 prepayment 20000', 'dez 2026-01-05 2025-12 baseRent 60000'])
})

test('Tilgung: eine Rücklastschrift nimmt die zuletzt vorgenommene Zuordnung zurück, auch über den Jahreswechsel (LIFO)', () => {
  // Beispiel aus E2, Schritt 5: Zurückgebucht wird im Januar die Novemberzahlung; die jüngste Zuordnung ist aber die
  // am 28.12. vorausbezahlte Januarmiete, und die nimmt die Rücklastschrift zurück, im Jahr der Rücklastschrift.
  const t = standard({ start: '2025-11-01', baseRents: [{ from: '2025-11', monthlyCents: 60000 }], prepayments: [{ from: '2025-11', monthlyCents: 20000 }] })
  const payments = [
    rentPayment('nov', '2025-11-03', 80000), rentPayment('dez', '2025-12-03', 80000), rentPayment('jan', '2025-12-28', 80000),
    rentPayment('rl', '2026-01-10', -80000), rentPayment('neu', '2026-01-20', 80000),
  ]
  const slices = allocateRentPayments(t, payments)
  assert.deepEqual(slices.filter((s) => s.paymentId === 'rl').map(short), ['rl 2026-01-10 2026-01 baseRent -60000', 'rl 2026-01-10 2026-01 prepayment -20000'])
  // Die spätere Zahlung deckt den wieder offenen Januar.
  assert.deepEqual(slices.filter((s) => s.paymentId === 'neu').map(short), ['neu 2026-01-20 2026-01 prepayment 20000', 'neu 2026-01-20 2026-01 baseRent 60000'])
  // Eine Teil-Rücklastschrift nimmt nur so viel, wie sie beträgt.
  const part = allocateRentPayments(t, [rentPayment('nov', '2025-11-03', 80000), rentPayment('rl', '2025-11-20', -10000)])
  assert.deepEqual(part.filter((s) => s.paymentId === 'rl').map(short), ['rl 2025-11-20 2025-11 baseRent -10000'])
})

test('Tilgung: die Rückzahlung einer Überzahlung nimmt zuerst den Teil ohne Forderung bzw. den künftigen Monat zurück', () => {
  const ended = allocateRentPayments(standard({ end: '2025-01-31' }), [rentPayment('p', '2025-01-03', 100000), rentPayment('r', '2025-02-10', -20000)])
  assert.deepEqual(ended.filter((s) => s.paymentId === 'r').map(short), ['r 2025-02-10 — unallocated -20000'])
  const open = allocateRentPayments(standard(), [rentPayment('p', '2025-01-03', 110000), rentPayment('r', '2025-01-10', -30000)])
  assert.deepEqual(open.filter((s) => s.paymentId === 'r').map(short), ['r 2025-01-10 2025-02 baseRent -10000', 'r 2025-01-10 2025-02 prepayment -20000'])
  // Ist nichts zurückzunehmen, bleibt ein negativer Teil ohne Forderung.
  const nothing = allocateRentPayments(standard(), [rentPayment('r', '2025-01-10', -5000)])
  assert.deepEqual(nothing.map(short), ['r 2025-01-10 — unallocated -5000'])
})

test('Tilgung: im angebrochenen Monat gilt das Soll nach Tagen (rateInMonth, #311)', () => {
  const t = standard({ start: '2025-01-16' })
  // 16 von 31 Tagen: 600 € × 16/31 = 309,68 €, 200 € × 16/31 = 103,23 €.
  const slices = allocateRentPayments(t, [rentPayment('p', '2025-01-20', 41291 + 100)])
  assert.deepEqual(slices.map(short), [
    'p 2025-01-20 2025-01 prepayment 10323',
    'p 2025-01-20 2025-01 baseRent 30968',
    'p 2025-01-20 2025-02 prepayment 100',
  ])
  const jan = coverageOf(monthCoverage(t, slices, ['2025-01'], '2025-01-31'), '2025-01')
  assert.deepEqual(jan.soll, { prepayment: 10323, heatingPrepayment: 0, baseRent: 30968, flatRate: 0 })
  assert.equal(jan.covered, true)
})

test('Tilgung: Zahlungen aus der Abrechnung gehen nicht durch die Tilgung (#280)', () => {
  const slices = allocateRentPayments(standard(), [rentPayment('s', '2025-03-03', 15000, { kind: 'settlement' }), rentPayment('g', '2025-03-04', -9000, { kind: 'settlement' })])
  assert.deepEqual(slices, [])
  // Fehlt die Art, ist es Miete (wie isRentPayment).
  const { kind: _kind, ...withoutKind } = rentPayment('m', '2025-01-03', 30000)
  assert.equal(allocateRentPayments(standard(), [withoutKind]).length, 2)
})

test('Tilgung: zwei Zahlungen am selben Tag nach Kennung (compareText), unabhängig von der Eingabereihenfolge', () => {
  const a = rentPayment('a', '2025-01-03', 30000)
  const b = rentPayment('b', '2025-01-03', 50000)
  const expected = ['a 2025-01-03 2025-01 prepayment 20000', 'a 2025-01-03 2025-01 baseRent 10000', 'b 2025-01-03 2025-01 baseRent 50000']
  assert.deepEqual(allocateRentPayments(standard(), [b, a]).map(short), expected)
  assert.deepEqual(allocateRentPayments(standard(), [a, b]).map(short), expected)
})

test('Tilgung: endet die Staffel bei 0 im offenen Mietverhältnis, ist der Rest ohne Forderung (Grenze 120 Monate, keine Schleife)', () => {
  const t = rentTenancy({ baseRents: [{ from: '2025-01', monthlyCents: 60000 }, { from: '2025-03', monthlyCents: 0 }] })
  const slices = allocateRentPayments(t, [rentPayment('p', '2025-01-03', 500000)])
  assert.deepEqual(slices.map(short), ['p 2025-01-03 2025-01 baseRent 60000', 'p 2025-01-03 2025-02 baseRent 60000', 'p 2025-01-03 — unallocated 380000'])
  // Ohne Ende reicht eine Vorauszahlung höchstens 120 Monate nach dem Monat der Zahlung.
  const far = allocateRentPayments(standard(), [rentPayment('p', '2025-01-03', 80000 * 130)])
  const lastFar = far.filter((s) => s.month !== null).at(-1)
  if (!lastFar) assert.fail('keine Zuordnung zu einem Monat')
  assert.equal(lastFar.month, '2035-01')
  // Mit bekanntem Ende gilt die Grenze nicht: bis zum Ende des Mietverhältnisses (Durchsicht M3).
  const ended = allocateRentPayments(standard({ end: '2036-12-31' }), [rentPayment('p', '2025-01-03', 80000 * 130)])
  const lastEnded = ended.filter((s) => s.month !== null).at(-1)
  if (!lastEnded) assert.fail('keine Zuordnung zu einem Monat')
  assert.equal(lastEnded.month, '2035-10')
  assert.equal(sumOf(ended, 'unallocated'), 0)
  assert.equal(sumOf(far, 'unallocated'), 80000 * 9)
})

test('Tilgung: am selben Tag zuerst die negative Zahlung, dann nach Kennung (Durchsicht M1)', () => {
  // Eine Rücklastschrift gehört zu einer früheren Zahlung; käme die Zahlung desselben Tages zuerst, nähme die
  // Rücklastschrift deren Zuordnung zurück statt der älteren.
  const payments = [rentPayment('jan', '2025-01-03', 80000), rentPayment('a', '2025-02-03', 80000), rentPayment('b', '2025-02-03', -80000)]
  const slices = allocateRentPayments(standard(), payments)
  assert.deepEqual(slices.filter((s) => s.paymentId !== 'jan').map(short), [
    'b 2025-02-03 2025-01 baseRent -60000',
    'b 2025-02-03 2025-01 prepayment -20000',
    'a 2025-02-03 2025-01 prepayment 20000',
    'a 2025-02-03 2025-02 prepayment 20000',
    'a 2025-02-03 2025-01 baseRent 40000',
  ])
})

test('Tilgung: eine Teil-Rücklastschrift nimmt innerhalb einer Klasse verhältnismäßig zurück (Durchsicht M2)', () => {
  // 500 € auf 600 € Kaltmiete, 50 € Pauschale und 200 € Vorauszahlung: 200 € Vorauszahlung, 300 € auf Kaltmiete und
  // Pauschale im Verhältnis 600 : 50 (276,923 € und 23,077 €, gerundet 276,92 € und 23,08 €). Eine Rücklastschrift über 10 €
  // nimmt aus dieser Klasse im selben Verhältnis zurück, nicht alles aus der Pauschale.
  const t = standard({ flatRates: [{ from: '2025-01', monthlyCents: 5000 }] })
  const slices = allocateRentPayments(t, [rentPayment('p', '2025-01-03', 50000), rentPayment('r', '2025-01-10', -1000)])
  assert.deepEqual(slices.map(short), [
    'p 2025-01-03 2025-01 prepayment 20000',
    'p 2025-01-03 2025-01 baseRent 27692',
    'p 2025-01-03 2025-01 flatRate 2308',
    // 10 € × 276,92/300 = 9,2307 €, 10 € × 23,08/300 = 0,7693 €: der Rest-Cent an den größeren Nachkommaanteil.
    'r 2025-01-10 2025-01 baseRent -923',
    'r 2025-01-10 2025-01 flatRate -77',
  ])
})

test('Negatives Soll: Tilgung, Deckung und Saldo klemmen es gleich auf 0 (Durchsicht M4)', () => {
  // 600 € Kaltmiete und eine Staffel der Vorauszahlung von −50 €: keine Forderung über 550 €, sondern 600 € Kaltmiete;
  // 550 € gezahlt lassen 50 € offen, in der Tilgung wie in Deckung und Saldo.
  const t = standard({ prepayments: [{ from: '2025-01', monthlyCents: -5000 }] })
  const payments = [rentPayment('p', '2025-01-03', 55000)]
  const slices = allocateRentPayments(t, payments)
  assert.deepEqual(slices.map(short), ['p 2025-01-03 2025-01 baseRent 55000'])
  const jan = coverageOf(monthCoverage(t, slices, ['2025-01'], '2025-01-31'), '2025-01')
  assert.deepEqual(jan.soll, { prepayment: 0, heatingPrepayment: 0, baseRent: 60000, flatRate: 0 })
  assert.equal(jan.covered, false)
  assert.equal(openingBalance(t, payments, '2025-02-01'), -5000)
})

test('monthSoll: feste Werte je Bestandteil, mit Teilmonaten, Stufen, Heizstaffel und Pauschale (Durchsicht M5)', () => {
  const t = rentTenancy({
    start: '2025-01-16', end: '2025-06-10',
    baseRents: [{ from: '2025-01', monthlyCents: 60000 }, { from: '2025-04', monthlyCents: 65000 }],
    prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
    heatingPrepayments: [{ from: '2025-03', monthlyCents: 10000 }],
    flatRates: [{ from: '2025-02', monthlyCents: 3000 }],
  })
  const rows = ['2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-06', '2025-07'].map((m) => [m, monthSoll(t, m)])
  assert.deepEqual(rows, [
    ['2024-12', { prepayment: 0, heatingPrepayment: 0, baseRent: 0, flatRate: 0 }],
    // 16 von 31 Tagen: 600 € × 16/31 = 309,68 €, 200 € × 16/31 = 103,23 €.
    ['2025-01', { prepayment: 10323, heatingPrepayment: 0, baseRent: 30968, flatRate: 0 }],
    ['2025-02', { prepayment: 20000, heatingPrepayment: 0, baseRent: 60000, flatRate: 3000 }],
    ['2025-03', { prepayment: 20000, heatingPrepayment: 10000, baseRent: 60000, flatRate: 3000 }],
    ['2025-04', { prepayment: 20000, heatingPrepayment: 10000, baseRent: 65000, flatRate: 3000 }],
    // 10 von 30 Tagen, je Staffel gerundet: 216,67 €, 66,67 €, 33,33 €, 10,00 €.
    ['2025-06', { prepayment: 6667, heatingPrepayment: 3333, baseRent: 21667, flatRate: 1000 }],
    ['2025-07', { prepayment: 0, heatingPrepayment: 0, baseRent: 0, flatRate: 0 }],
  ])
})

test('monthCoverage: bezahlt, teilweise, offen; bezahlt am … für einen später gedeckten Monat; Stichtag schneidet ab', () => {
  const t = standard()
  const slices = allocateRentPayments(t, [rentPayment('jan', '2025-01-03', 80000), rentPayment('feb', '2025-02-03', 30000), rentPayment('apr', '2025-04-10', 130000)])
  // Die Aprilzahlung tilgt erst die Vorauszahlungen März und April, dann die Kaltmiete Februar (500 €) und März (400 €).
  const march = monthCoverage(t, slices, monthsBetween('2025-01', '2025-04'), '2025-03-31')
  assert.deepEqual(march.map((c) => [c.month, c.covered, c.paid.prepayment, c.paid.baseRent, c.paidLaterOn]), [
    ['2025-01', true, 20000, 60000, null],
    ['2025-02', false, 20000, 10000, '2025-04-10'],
    ['2025-03', false, 0, 0, null],
    ['2025-04', false, 0, 0, null],
  ])
  const april = monthCoverage(t, slices, monthsBetween('2025-01', '2025-04'), '2025-04-30')
  assert.deepEqual(april.map((c) => [c.month, c.covered, c.paid.prepayment, c.paid.baseRent]), [
    ['2025-01', true, 20000, 60000],
    ['2025-02', true, 20000, 60000],
    ['2025-03', false, 20000, 40000],
    ['2025-04', false, 20000, 0],
  ])
  assert.deepEqual(coverageOf(april, '2025-01').soll, { prepayment: 20000, heatingPrepayment: 0, baseRent: 60000, flatRate: 0 })
  // Ein Monat ohne Soll ist gedeckt (wie im Mietkonto).
  assert.equal(coverageOf(monthCoverage(t, slices, ['2024-12'], '2025-04-30'), '2024-12').covered, true)
})

test('openingBalance: Rückstand aus dem Dezember und Vorauszahlung vom 28.12., beide gleich der Summe der Teile', () => {
  const t = standard()
  const arrears = monthly(monthsBetween('2025-01', '2025-11'), 80000)
  assert.equal(openingBalance(t, arrears, '2026-01-01'), -80000)
  const prepaid = [...monthly(monthsBetween('2025-01', '2025-12'), 80000), rentPayment('jan', '2025-12-28', 80000)]
  assert.equal(openingBalance(t, prepaid, '2026-01-01'), 80000)
  // Die vorausbezahlten Teile: Monat ab Januar 2026, gezahlt vor dem 01.01.2026.
  const slices = allocateRentPayments(t, prepaid)
  assert.equal(slices.filter((s) => s.paidOn < '2026-01-01' && s.month !== null && s.month >= '2026-01').reduce((a, s) => a + s.cents, 0), 80000)
  // Zahlungen aus der Abrechnung zählen nicht, ein Tag zählt erst ab dem nächsten (Datum < on).
  assert.equal(openingBalance(t, [...arrears, rentPayment('s', '2025-12-20', 5000, { kind: 'settlement' })], '2026-01-01'), -80000)
  assert.equal(openingBalance(t, [rentPayment('a', '2025-01-03', 80000)], '2025-01-03'), 0)
  assert.equal(openingBalance(t, [rentPayment('a', '2025-01-03', 80000)], '2025-01-04'), 80000)
  assert.equal(openingBalance(t, [], '2024-06-01'), 0)
})

test('Wächter: rentAllocation.ts importiert nichts aus calc.ts, auch nicht über Umwege (kein ESM-Zyklus, #312 E3)', () => {
  // calc.ts importiert die Tilgung (#281); ein Import zurück ergäbe einen Zyklus, in dem eine der beiden Dateien beim
  // Laden noch nicht ausgewertet ist. Geprüft wird jeder relative Import ab rentAllocation.ts, nicht nur die Datei.
  const seen = new Set<string>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    for (const m of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const spec = m[1]
      if (spec === undefined) continue
      if (/^\s*import\s+type\b/.test(m[0]) || /^\s*export\s+type\b/.test(m[0])) continue // fällt beim Abstreifen weg
      visit(path.resolve(path.dirname(file), spec))
    }
  }
  const start = path.join(import.meta.dirname, '..', 'src', 'rentAllocation.ts')
  visit(start)
  assert.ok(seen.size > 1, 'der Wächter findet keine Importe; ist das Muster veraltet?')
  assert.equal([...seen].find((f) => path.basename(f) === 'calc.ts'), undefined, `Importkette: ${[...seen].map((f) => path.relative(path.dirname(start), f)).join(', ')}`)
})
