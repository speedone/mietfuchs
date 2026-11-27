// Invariante zum Monat laut Verwendungszweck im Kontoauszug (#693) über zufällige Mietverhältnisse mit festem Startwert
// (server/testing/rentStock.ts): Sagt `designationChangesNothing`, der im Zweck genannte Monat ändere nichts, dann sind
// Mietkonto und Steuer jedes Jahres mit bestätigtem Monat dieselben wie ohne Monat. Nur dann bleibt die Zeile grün ohne
// Monat; die Aussage muss also in jedem Jahr und für jede Kennung der neuen Zahlung halten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rentLedger, taxReport } from '../src/calc.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { monthSoll, type SollComponent } from '../../shared/monthRate.ts'
import { designationChangesNothing } from '../src/bank/monthEffect.ts'
import { addMonths, makeRng, monthsBetween, randomRentStock } from '../testing/rentStock.ts'

const FROM = Number(process.env.INV_FROM ?? 1)
const TO = Number(process.env.INV_TO ?? 60)
const COMPONENTS: readonly SollComponent[] = ['prepayment', 'heatingPrepayment', 'baseRent', 'flatRate']
const sollTotal = (t: SnapshotTenancy, m: string): number => COMPONENTS.reduce((a, c) => a + monthSoll(t, m)[c], 0)
const sourceOf = (tenancy: SnapshotTenancy, payments: SnapshotPayment[]): SnapshotSource => ({
  units: [{ id: tenancy.unitId, name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy], costItems: [], meters: [], readings: [], payments, closedSettlements: [],
})
const pad = (n: number): string => String(n).padStart(2, '0')
// Das Mietkonto ohne den Vermerk `designatedOutside`: Liegt der genannte Monat vor dem Beginn der Erfassung, wirkt er wie
// keine Bestimmung (keine Zahl ändert sich), die Zeile nennt aber die Zahlung, die ihn trägt. Den Vermerk gibt es ohne
// Monat nicht; er ist der einzige erlaubte Unterschied.
const ledgerOf = (snapshot: Parameters<typeof rentLedger>[0], options: Parameters<typeof rentLedger>[1] = {}) => {
  const ledger = rentLedger(snapshot, options)
  return { ...ledger, rows: ledger.rows.map(({ designatedOutside: _outside, ...row }) => row) }
}

test('Ändert der Monat laut Zweck nichts an der Tilgung, sind Mietkonto und Steuer mit und ohne Monat in jedem Jahr gleich', () => {
  let same = 0
  let different = 0
  for (let seed = FROM; seed <= TO; seed++) {
    const stock = randomRentStock(makeRng(seed))
    const { tenancy } = stock
    const payments: SnapshotPayment[] = stock.payments.map((p) => ({ ...p, tenancyId: tenancy.id }))
    const rnd = makeRng(seed * 13 + 5)
    const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
    const first = tenancy.start.slice(0, 7)
    const last = tenancy.end === null ? payments.map((p) => p.date.slice(0, 7)).reduce((a, b) => (a > b ? a : b), addMonths(first, 6)) : tenancy.end.slice(0, 7)
    const months = monthsBetween(first, last)
    for (let k = 0; k < 6; k++) {
      // Ein Eingang über genau das Soll des genannten Monats, gebucht kurz davor, im Monat oder bis zwei Monate danach.
      const month = months[int(0, months.length - 1)] ?? first
      const cents = sollTotal(tenancy, month)
      if (cents <= 0) continue
      const date = `${addMonths(month, int(-1, 2))}-${pad(int(1, 28))}`
      // Manchmal am Tag einer vorhandenen Zahlung: Dann entscheidet die Kennung über die Reihenfolge.
      const incoming = { date: rnd() < 0.2 ? (payments[int(0, payments.length - 1)]?.date ?? date) : date, amountCents: cents }
      if (!designationChangesNothing(tenancy, payments, incoming, month)) { different++; continue }
      same++
      // Die Kennung der Zahlung, die später entsteht, ist beliebig: einmal vor, einmal nach den übrigen des Tages.
      for (const id of ['', 'zz']) {
        const plain: SnapshotPayment = { id, tenancyId: tenancy.id, date: incoming.date, amountCents: cents, kind: 'rent' }
        const named: SnapshotPayment = { ...plain, designatedMonth: month }
        const lastYear = Math.max(Number(last.slice(0, 4)), Number(incoming.date.slice(0, 4))) + 1
        for (let year = Number(first.slice(0, 4)) - 1; year <= lastYear; year++) {
          const at = `Startwert ${seed}, Monat ${month}, gebucht ${incoming.date}, Kennung „${id}“, Jahr ${year}`
          const a = snapshotOf(sourceOf(tenancy, [...payments, plain]), year)
          const b = snapshotOf(sourceOf(tenancy, [...payments, named]), year)
          const asOf = `${year + 1}-02-01`
          assert.deepEqual(ledgerOf(b, { asOf }), ledgerOf(a, { asOf }), `${at}: Mietkonto`)
          assert.deepEqual(taxReport(b), taxReport(a), `${at}: Steuer`)
        }
      }
    }
  }
  // Beide Fälle kommen vor, sonst prüfte der Test nichts.
  assert.ok(same >= 20, `nur ${same} Fälle ohne Wirkung`)
  assert.ok(different >= 20, `nur ${different} Fälle mit Wirkung`)
})

test('Ein Rückstand vor dem Monat, ein offener Monat danach und eine Zahlung im Voraus: der Monat ändert etwas; ein glattes Konto: nichts', () => {
  const tenancy: SnapshotTenancy = {
    id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2026-01-01', end: null,
    prepayments: [{ from: '2026-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2026-01', monthlyCents: 70000 }],
  }
  const paid = (months: readonly number[]): SnapshotPayment[] => months.map((m) => ({ id: `p${pad(m)}`, tenancyId: 't', date: `2026-${pad(m)}-02`, amountCents: 85000, kind: 'rent', designatedMonth: `2026-${pad(m)}` }))
  const november = { date: '2026-11-03', amountCents: 85000 }
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(designationChangesNothing(tenancy, paid(all), november, '2026-11'), true, 'alles bezahlt, Miete November im November')
  assert.equal(designationChangesNothing(tenancy, paid(all.filter((m) => m !== 4)), november, '2026-11'), false, 'April offen')
  assert.equal(designationChangesNothing(tenancy, paid(all), november, '2026-12'), false, 'Dezember genannt, November noch offen')
  assert.equal(designationChangesNothing(tenancy, paid([...all, 11]), { date: '2026-11-28', amountCents: 85000 }, '2026-12'), true, 'Dezember im Voraus, sonst nichts offen')
  assert.equal(designationChangesNothing(tenancy, paid(all.filter((m) => m !== 10)), november, '2026-10'), false, 'Oktober genannt, November auch offen')
  // Das erste, was je erfasst wird: Die Erfassung beginnt mit dieser Zahlung, davor gilt nichts als offen.
  assert.equal(designationChangesNothing(tenancy, [], november, '2026-11'), true, 'erste Zahlung des Objekts')
})
