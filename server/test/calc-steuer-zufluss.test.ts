// Das Zugeflossene nach Zeilen der Anlage V (#312 PR 2, Entwurf docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md,
// E4 bis E11): `income.received` aus der Tilgung jeder Mietzahlung nach § 366 BGB (rentAllocation.ts, dieselbe wie im
// Mietkonto). Die Summe bleibt `paidCents` (§ 11 Abs. 1 Satz 1 EStG); neu ist nur, wie sie sich auf die Zeilen verteilt.
// Jede erwartete Zahl ist unten von Hand nachgerechnet. Invarianten über Zufallsbestände: invariant-steuer-zufluss.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReport, taxReportFor } from '../src/calc.ts'
import { snapshotFor, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod } from '../../shared/period.ts'
import type { PeriodRules, TaxReceived, TaxReport } from '../../shared/types.ts'
import type { TaxSource } from '../testing/taxStock.ts'

type Pay = TaxSource['payments'][number]
let seq = 0
const pay = (tenancyId: string, date: string, amountCents: number, over: Partial<Pay> = {}): Pay => ({ id: `p${String(++seq).padStart(4, '0')}`, tenancyId, date, amountCents, kind: 'rent', ...over })
// Je Monat eine Zahlung am dritten.
const monthly = (tenancyId: string, from: string, to: string, amountCents: number): Pay[] => {
  const out: Pay[] = []
  for (let k = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1; k <= Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1; k++) {
    out.push(pay(tenancyId, `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-03`, amountCents))
  }
  return out
}

// 600 € Kaltmiete und 200 € Vorauszahlung, ab Januar 2024, offen.
const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
  ...over,
})

const source = (tenancies: SnapshotTenancy[], payments: Pay[], rules: PeriodRules = CALENDAR_RULES): TaxSource => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: rules }],
  units: [
    { id: 'eg', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'og', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: true },
  ],
  tenancies, costItems: [], meters: [], readings: [], payments, closedSettlements: [],
}) as TaxSource

const received = (s: TaxSource, year: number): TaxReceived => taxReportFor(s, 'objekt-1', year).income.received ?? assert.fail('received fehlt')
const settlementSaldo = (r: TaxReport): number => r.income.settlementBackPaymentsCents - r.income.settlementRefundsCents

test('Issue-Beispiel: Januar bis November je 800 €, Dezember nichts, 150 € Nachzahlung', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-11', 80000), pay('t', '2025-06-15', 15000, { kind: 'settlement' })])
  const r = taxReportFor(s, 'objekt-1', 2025)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(x.rentCents, 660000, '11 × 600 €')
  assert.equal(x.allocationsCents, 220000, '11 × 200 €')
  assert.equal(settlementSaldo(r), 15000)
  assert.equal(r.income.paidCents, 895000)
  assert.equal(x.formerYearsCents, 0)
  assert.equal(x.unallocatedCents, 0)
  assert.equal(x.inclusiveRentCents, 0)
  assert.equal(x.flatRateCents, 0)
  assert.deepEqual(x.byTenancy.map((b) => [b.tenancyId, b.unitId, b.unitName, b.rentCents, b.allocationsCents, b.settlementCents, b.relative]), [['t', 'eg', 'EG', 660000, 220000, 15000, false]])
  assert.deepEqual(x.byUnit, [{ unitId: 'eg', unitName: 'EG', areaM2: 60, rentCents: 660000, allocationsCents: 220000, settlementCents: 15000, formerYearsCents: 0 }])
  assert.deepEqual(x.relatives, { rentCents: 0, allocationsCents: 0, settlementCents: 0 })
  assert.deepEqual(x.possibleDeposits, [])
})

test('Inklusivmiete: die ganze Miete in Zeile 15, eigens als Inklusivmiete genannt', () => {
  const s = source([tenancy('t', 'eg', { costModel: 'inclusive', prepayments: [], baseRents: [{ from: '2024-01', monthlyCents: 70000 }] })], monthly('t', '2025-01', '2025-12', 70000))
  const x = received(s, 2025)
  assert.equal(x.rentCents, 840000)
  assert.equal(x.inclusiveRentCents, 840000)
  assert.equal(x.allocationsCents, 0)
  assert.equal(x.byTenancy[0]?.inclusiveRentCents, 840000)
})

test('Pauschale: in Zeile 20, eigens genannt; eine Teilzahlung teilt Kaltmiete und Pauschale verhältnismäßig', () => {
  const t = tenancy('t', 'eg', { costModel: 'flatRate', prepayments: [], baseRents: [{ from: '2024-01', monthlyCents: 50000 }], flatRates: [{ from: '2024-01', monthlyCents: 10000 }] })
  const x = received(source([t], monthly('t', '2025-01', '2025-12', 60000)), 2025)
  assert.equal(x.rentCents, 600000)
  assert.equal(x.allocationsCents, 120000)
  assert.equal(x.flatRateCents, 120000)
  // 300 € auf 500 € Kalt und 100 € Pauschale: gleiche Sicherheit, verhältnismäßig 250 € und 50 € (§ 366 Abs. 2 letzter Halbsatz).
  const y = received(source([t], [pay('t', '2025-01-03', 30000)]), 2025)
  assert.equal(y.rentCents, 25000)
  assert.equal(y.flatRateCents, 5000)
})

test('Rückstand aus dem Vorjahr: zuerst getilgt, brutto in Zeile 25, die Umlagen daneben', () => {
  // 2024 fehlt der Dezember; 2025 zahlt der Mieter jeden Monat 800 €. Jede Zahlung tilgt zuerst die offenen Vorauszahlungen,
  // dann die älteste Kaltmiete (VIII ZR 84/17 Rn. 57). Ende 2025 sind 800 € offen, und zwar Kaltmiete: Dezember 2025 600 €,
  // November 2025 200 €. Getilgt in 2025: Dezember 2024 ganz (800 €, davon 200 € Vorauszahlung), die zwölf Vorauszahlungen
  // 2025 (2.400 €), Kaltmiete 2025 7.200 € − 800 € = 6.400 €. Summe 9.600 € = 12 × 800 €.
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2024-01', '2024-11', 80000), ...monthly('t', '2025-01', '2025-12', 80000)])
  const r = taxReportFor(s, 'objekt-1', 2025)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(x.formerYearsCents, 80000)
  assert.equal(x.formerYearsAllocationsCents, 20000)
  assert.equal(x.allocationsCents, 240000)
  assert.equal(x.rentCents, 640000)
  assert.equal(r.income.paidCents, 960000)
  assert.equal(x.byTenancy[0]?.formerYearsCents, 80000)
  assert.equal(x.byUnit[0]?.formerYearsCents, 80000)
})

test('Überzahlung nach Auszug: ohne Forderung, in Zeile 15 und eigens genannt', () => {
  const s = source([tenancy('t', 'eg', { end: '2025-06-30' })], [...monthly('t', '2025-01', '2025-07', 80000)])
  const x = received(s, 2025)
  assert.equal(x.unallocatedCents, 80000)
  assert.equal(x.rentCents, 6 * 60000 + 80000)
  assert.equal(x.allocationsCents, 6 * 20000)
  assert.equal(x.byTenancy[0]?.unallocatedCents, 80000)
})

test('Zehn-Tage-Regel vorwärts: am 22.12. für Januar gezahlt, im Folgejahr dieselben Cent als „aus dem Vorjahr“', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-22', 80000), ...monthly('t', '2026-02', '2026-12', 80000)])
  const y25 = received(s, 2025)
  assert.deepEqual(y25.turnOfYear, { forwardCents: 80000, forwardAllocationsCents: 20000, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, lateDecemberCents: 0 })
  assert.equal(y25.rentCents, 13 * 60000, 'die vorausgezahlte Januarmiete zählt im Jahr der Zahlung (Zeile 15)')
  assert.equal(y25.allocationsCents, 13 * 20000)
  assert.equal(y25.byTenancy[0]?.forwardCents, 80000)
  const y26 = received(s, 2026)
  assert.equal(y26.turnOfYear.fromPreviousCents, 80000)
  assert.equal(y26.turnOfYear.fromPreviousAllocationsCents, 20000)
  assert.equal(y26.turnOfYear.forwardCents, 0)
  // Der 21.12. liegt elf Tage vor dem Jahreswechsel: keine kurze Zeit mehr.
  const früh = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-21', 80000)])
  assert.equal(received(früh, 2025).turnOfYear.forwardCents, 0)
  assert.equal(received(früh, 2026).turnOfYear.fromPreviousCents, 0)
})

test('Dezembermiete nach Auszug am 10.01.: Zeile 25, als „Anfang Januar für Dezember“ genannt; am 11.01. nicht mehr', () => {
  const t = tenancy('t', 'eg', { end: '2025-12-31' })
  const s = source([t], [...monthly('t', '2025-01', '2025-11', 80000), pay('t', '2026-01-10', 80000)])
  const r = taxReportFor(s, 'objekt-1', 2026)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(r.income.paidCents, 80000)
  assert.equal(x.formerYearsCents, 80000)
  assert.equal(x.turnOfYear.lateDecemberCents, 80000)
  // Ohne Zeile im Mietkonto 2026 steht das Mietverhältnis trotzdem da (E1).
  assert.deepEqual(x.byTenancy.map((b) => [b.tenancyId, b.start, b.end, b.formerYearsCents]), [['t', '2024-01-01', '2025-12-31', 80000]])
  const später = source([t], [...monthly('t', '2025-01', '2025-11', 80000), pay('t', '2026-01-11', 80000)])
  assert.equal(received(später, 2026).turnOfYear.lateDecemberCents, 0)
  assert.equal(received(später, 2026).formerYearsCents, 80000)
})

test('Kaution als Miete erfasst: Hinweis, außer der Betrag ist die Monatsmiete oder die Zahlung tilgt einen Rückstand', () => {
  const t = tenancy('t', 'eg', { start: '2025-03-01', depositCents: 180000, prepayments: [{ from: '2025-03', monthlyCents: 20000 }], baseRents: [{ from: '2025-03', monthlyCents: 60000 }] })
  const s = source([t], [pay('t', '2025-02-20', 180000), ...monthly('t', '2025-03', '2025-12', 80000)])
  assert.deepEqual(received(s, 2025).possibleDeposits, [{ tenancyId: 't', tenantName: 'Mieter t', paidOn: '2025-02-20', cents: 180000 }])
  // 32 Tage vor Beginn: nicht mehr nah genug.
  assert.deepEqual(received(source([t], [pay('t', '2025-01-28', 180000)]), 2025).possibleDeposits, [])
  // Kaution gleich der Monatsmiete: nicht zu unterscheiden, kein Hinweis.
  const gleich = { ...t, depositCents: 80000 }
  assert.deepEqual(received(source([gleich], monthly('t', '2025-03', '2025-12', 80000)), 2025).possibleDeposits, [])
  // Die Zahlung tilgt zwei offene Monate (Januar und Februar), sie ist eine Nachzahlung. Das Objekt erfasst seit Januar
  // (Zahlung der Nachbarin), sonst begänne das Konto erst mit der Zahlung selbst.
  const früh = tenancy('t', 'eg', { start: '2025-01-01', depositCents: 160000 })
  const nachbarin = tenancy('n', 'og', { start: '2025-01-01' })
  assert.deepEqual(received(source([früh, nachbarin], [pay('n', '2025-01-03', 80000), pay('t', '2025-02-01', 160000)]), 2025).possibleDeposits, [])
  // Ohne Kaution am Mietverhältnis nie.
  const ohne = { ...t, depositCents: undefined }
  assert.deepEqual(received(source([ohne], [pay('t', '2025-02-20', 180000)]), 2025).possibleDeposits, [])
})

test('Angehörige: die Teilsummen für die Zeilen 19, 22 und 23; die Summen umfassen alle', () => {
  const s = source([tenancy('tochter', 'eg', { relative: true }), tenancy('fremd', 'og')], [
    ...monthly('tochter', '2025-01', '2025-12', 80000), pay('tochter', '2025-05-10', -5000, { kind: 'settlement' }),
    ...monthly('fremd', '2025-01', '2025-12', 80000), pay('fremd', '2025-05-10', 12000, { kind: 'settlement' }),
  ])
  const x = received(s, 2025)
  assert.deepEqual(x.relatives, { rentCents: 720000, allocationsCents: 240000, settlementCents: -5000 })
  assert.equal(x.rentCents, 1440000)
  assert.equal(x.allocationsCents, 480000)
  assert.deepEqual(x.byTenancy.map((b) => [b.tenancyId, b.relative, b.settlementCents]), [['tochter', true, -5000], ['fremd', false, 12000]])
})

test('Monat laut Verwendungszweck: dieselbe Zahlung tilgt den Januar statt des offenen Dezembers (Zeile 15/20 statt 25)', () => {
  const vorjahr = monthly('t', '2024-01', '2024-11', 80000)
  const ohne = received(source([tenancy('t', 'eg')], [...vorjahr, pay('t', '2025-01-03', 80000)]), 2025)
  assert.deepEqual([ohne.formerYearsCents, ohne.rentCents, ohne.allocationsCents], [60000, 0, 20000], 'A von Dezember und Januar, dann B des Dezembers zu zwei Dritteln')
  const mit = received(source([tenancy('t', 'eg')], [...vorjahr, pay('t', '2025-01-03', 80000, { designatedMonth: '2025-01' })]), 2025)
  assert.deepEqual([mit.formerYearsCents, mit.rentCents, mit.allocationsCents], [0, 60000, 20000])
})

test('Rücklastschrift nach Auszug: negative Zeile 25 im Jahr der Rücklastschrift', () => {
  const s = source([tenancy('t', 'eg', { end: '2024-12-31' })], [...monthly('t', '2024-01', '2024-12', 80000), pay('t', '2025-01-08', -80000)])
  const r = taxReportFor(s, 'objekt-1', 2025)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(r.income.paidCents, -80000)
  assert.equal(x.formerYearsCents, -80000)
  assert.equal(x.formerYearsAllocationsCents, -20000)
  assert.equal(x.rentCents, 0)
})

test('Zwei Objekte: die Zahlungen des anderen Objekts gehen nicht hinein', () => {
  const eins = source([tenancy('t', 'eg')], monthly('t', '2025-01', '2025-12', 80000))
  const zwei: TaxSource = {
    ...eins,
    properties: [...(eins.properties ?? []), { id: 'objekt-2', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [...eins.units, { id: 'b-eg', propertyId: 'objekt-2', name: 'B-EG', areaM2: 50, participates: true }],
    tenancies: [...eins.tenancies, tenancy('b', 'b-eg')],
    payments: [...eins.payments, ...monthly('b', '2024-06', '2025-12', 99900)],
  } as TaxSource
  assert.deepEqual(received(zwei, 2025), received(eins, 2025))
})

test('Abrechnungszeitraum Mai bis April: die Aufteilung kennt nur Monate und Zahlungsdaten', () => {
  const payments = [...monthly('t', '2024-01', '2024-11', 80000), ...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000)]
  for (const year of [2024, 2025, 2026]) {
    assert.deepEqual(received(source([tenancy('t', 'eg')], payments, { startMonth: 5, changes: [] }), year), received(source([tenancy('t', 'eg')], payments), year), String(year))
  }
})

test('Eine Mietzahlung an ein Mietverhältnis, das der Schnappschuss nicht führt, zählt ohne Forderung', () => {
  const s = source([tenancy('t', 'eg')], monthly('t', '2025-01', '2025-12', 80000))
  const snap = snapshotFor(s, 'objekt-1', calendarYearPeriod(2025))
  const r = taxReport({ ...snap, payments: [...snap.payments, pay('fremd', '2025-04-01', 12345)] })
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(x.unallocatedCents, 12345)
  assert.equal(x.rentCents + x.allocationsCents + x.formerYearsCents + settlementSaldo(r), r.income.paidCents)
})

test('Option received: false: keine Tilgung, alle übrigen Felder gleich', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2024-01', '2024-11', 80000), ...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-03-01', 900, { kind: 'settlement' })])
  const mit = taxReportFor(s, 'objekt-1', 2025)
  const ohne = taxReportFor(s, 'objekt-1', 2025, undefined, { received: false })
  assert.equal('received' in ohne.income, false)
  const { received: _, ...rest } = mit.income
  assert.deepEqual({ ...mit, income: rest }, ohne)
  const snap = snapshotFor(s, 'objekt-1', calendarYearPeriod(2025))
  assert.equal('received' in taxReport(snap, undefined, { received: false }).income, false)
})
