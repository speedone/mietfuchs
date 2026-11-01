// Mietkonto mit Übertrag und Tilgung nach § 366 BGB (#281, Entwurf
// docs/superpowers/specs/2026-10-30-mietkonto-uebertrag-design.md): Das Konto rechnet ab Beginn des Mietverhältnisses,
// zeigt das Jahr mit Anfangs- und Endsaldo und liest Status und Salden aus rentAllocation.ts. Die Abrechnungsreife (E5)
// klassifiziert offene Vorauszahlungen eines abgerechneten Zeitraums nur in der Anzeige.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, type LedgerStatement } from '../src/calc.ts'
import { calendarPeriod } from '../../shared/period.ts'
import { snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import type { RentLedger, RentLedgerRow, RentMonth } from '../../shared/types.ts'
import { monthsBetween } from '../testing/rentStock.ts'

// Ab 01.01.2024, 800 € im Monat: 600 € Kaltmiete und 200 € Vorauszahlung (die Zahlen aus dem Issue).
const tenancy = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'a', tenantName: 'Mieter', persons: 1, personHistory: [], start: '2024-01-01', end: null,
  prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {},
  baseRents: [{ from: '2024-01', monthlyCents: 60000 }], ...over,
})
let seq = 0
const pay = (date: string, amountCents: number, over: Partial<SnapshotPayment> = {}): SnapshotPayment => ({ id: `p${String(++seq).padStart(4, '0')}`, tenancyId: 't', date, amountCents, kind: 'rent', ...over })
// Je Monat von `from` bis `to` 800 € am dritten des Monats.
const monthly = (from: string, to: string, cents = 80000): SnapshotPayment[] => monthsBetween(from, to).map((m) => pay(`${m}-03`, cents))

const source = (s: Partial<SnapshotSource>): SnapshotSource => ({
  units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy()], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
})
const ledger = (s: Partial<SnapshotSource>, year: number, options: Parameters<typeof rentLedger>[1] = {}): RentLedger => rentLedger(snapshotOf(source(s), year), options)
const rowOf = (l: RentLedger, id = 't'): RentLedgerRow => l.rows.find((r) => r.tenancyId === id) ?? assert.fail(`keine Zeile ${id}`)
const monthOf = (r: RentLedgerRow, month: number): RentMonth => r.months[month - 1] ?? assert.fail(`kein Monat ${month}`)

test('Issue #281: Dauerauftrag bucht die Januarmiete am 28.12., der Januar ist gedeckt und das Vorjahr nennt den Übertrag', () => {
  const payments = [...monthly('2024-01', '2024-12'), pay('2024-12-28', 80000), ...monthly('2025-02', '2025-12')]
  const y2024 = rowOf(ledger({ payments }, 2024, { asOf: '2026-01-15' }))
  assert.equal(y2024.openingBalanceCents, 0)
  assert.equal(y2024.closingBalanceCents, 80000, 'vorausbezahlt 800 € zum 31.12.2024')
  assert.equal(y2024.balanceCents, 80000, 'das Jahr allein: wie bisher')
  assert.equal(y2024.arrearsCents, 0)
  const y2025 = rowOf(ledger({ payments }, 2025, { asOf: '2026-01-15' }))
  assert.equal(y2025.openingBalanceCents, 80000)
  assert.equal(monthOf(y2025, 1).status, 'paid', 'die Dezemberzahlung deckt den Januar')
  assert.equal(monthOf(y2025, 1).paidCents, 80000)
  assert.ok(y2025.months.every((m) => m.status === 'paid'))
  assert.equal(y2025.closingBalanceCents, 0)
  assert.equal(y2025.paidYearCents, 880000, 'Zahlungseingänge des Jahres: nach Datum, für den Kontoauszug')
  assert.equal(y2025.arrearsCents, 0)
  assert.equal(y2025.openMonths, 0)
})

test('Issue #281: Ein Dezember-Rückstand steht im Januar noch da (Übertrag), die Zahlungen tilgen zuerst die Vorauszahlungen', () => {
  const payments = [...monthly('2024-01', '2024-11'), ...monthly('2025-01', '2025-12')]
  const l = ledger({ payments }, 2025, { asOf: '2026-02-01' })
  const r = rowOf(l)
  assert.equal(r.openingBalanceCents, -80000)
  assert.equal(r.closingBalanceCents, -80000)
  assert.equal(r.balanceCents, 0, 'das Jahr allein ist ausgeglichen')
  assert.equal(r.arrearsCents, 80000, 'der Rückstand verschwindet nicht')
  assert.equal(l.totals.openCents, 80000)
  // Jede Zahlung tilgt zuerst die Vorauszahlung des Monats, dann die älteste Kaltmiete (VIII ZR 84/17 Rn. 57):
  // Am Jahresende fehlen 200 € Kaltmiete November und 600 € Kaltmiete Dezember.
  assert.equal(monthOf(r, 11).status, 'partial')
  assert.equal(monthOf(r, 11).openRentCents, 20000)
  assert.equal(monthOf(r, 11).openPrepaymentCents, 0)
  assert.equal(monthOf(r, 12).status, 'partial')
  assert.equal(monthOf(r, 12).openRentCents, 60000)
  assert.equal(monthOf(r, 12).openPrepaymentCents, 0)
  assert.equal(r.openMonths, 2)
  // Das Vorjahr: Der Dezember war zum 31.12. offen und ist mit der Zahlung vom 03.02.2025 gedeckt.
  const y2024 = rowOf(ledger({ payments }, 2024, { asOf: '2026-02-01' }))
  assert.equal(monthOf(y2024, 12).status, 'open')
  assert.equal(monthOf(y2024, 12).paidLaterOn, '2025-02-03')
  assert.equal(monthOf(y2024, 11).paidLaterOn, undefined, 'ein gedeckter Monat trägt keinen Zusatz')
  assert.equal(y2024.closingBalanceCents, -80000)
  assert.equal(y2024.arrearsCents, 80000)
})

test('Teilzahlung von 300 € auf 600 € Kaltmiete und 200 € Vorauszahlung: zuerst die Vorauszahlung', () => {
  const payments = [...monthly('2024-01', '2024-12'), pay('2025-01-03', 30000)]
  const r = rowOf(ledger({ payments }, 2025, { asOf: '2025-02-10' }))
  const jan = monthOf(r, 1)
  assert.equal(jan.status, 'partial')
  assert.equal(jan.paidCents, 30000)
  assert.equal(jan.openPrepaymentCents, 0)
  assert.equal(jan.openRentCents, 50000)
  assert.equal(r.arrearsCents, 50000)
  assert.equal(monthOf(r, 2).status, 'notDue')
})

test('Zwei offene Monate, dann 800 €: erst beide Vorauszahlungen, dann die älteste Kaltmiete (Rn. 57)', () => {
  const payments = [...monthly('2024-01', '2024-12'), pay('2025-02-10', 80000)]
  const r = rowOf(ledger({ payments }, 2025, { asOf: '2025-03-01' }))
  assert.deepEqual([monthOf(r, 1).openPrepaymentCents, monthOf(r, 1).openRentCents], [0, 20000])
  assert.deepEqual([monthOf(r, 2).openPrepaymentCents, monthOf(r, 2).openRentCents], [0, 60000])
  assert.equal(monthOf(r, 1).status, 'partial')
  assert.equal(monthOf(r, 2).status, 'partial')
  assert.equal(r.arrearsCents, 80000)
})

test('Monat laut Verwendungszweck: die Zahlung deckt diesen Monat, der ältere bleibt offen (Rn. 56)', () => {
  const payments = [...monthly('2024-01', '2024-12'), pay('2025-02-10', 80000, { designatedMonth: '2025-02' })]
  const r = rowOf(ledger({ payments }, 2025, { asOf: '2025-03-01' }))
  assert.equal(monthOf(r, 2).status, 'paid')
  assert.equal(monthOf(r, 1).status, 'open')
  assert.equal(r.arrearsCents, 80000)
  assert.equal(r.designatedOutside, undefined)
})

test('Monat laut Verwendungszweck außerhalb des Mietverhältnisses: wie keine Bestimmung, das Mietkonto nennt die Zahlung', () => {
  const p = pay('2025-02-10', 80000, { designatedMonth: '2023-05' })
  const r = rowOf(ledger({ payments: [...monthly('2024-01', '2024-12'), p] }, 2025, { asOf: '2025-03-01' }))
  assert.deepEqual(r.designatedOutside, [p.id])
  assert.equal(monthOf(r, 1).openRentCents, 20000, 'verteilt nach gesetzlicher Reihenfolge')
})

test('Auszug mit Rückstand: im Folgejahr keine Zeile, aber der Rückstand steht in carriedOnly und in der Summe', () => {
  const t = tenancy({ end: '2024-06-30' })
  const l = ledger({ tenancies: [t], payments: monthly('2024-01', '2024-05') }, 2025, { asOf: '2025-03-01' })
  assert.equal(l.rows.length, 0)
  assert.deepEqual(l.carriedOnly, [{ tenancyId: 't', tenantName: 'Mieter', unitName: 'EG', end: '2024-06-30', openCents: 80000, notDemandableCents: 0, notDemandable: [] }])
  assert.equal(l.totals.openCents, 80000)
  // Ausgeglichen: kein Eintrag.
  assert.deepEqual(ledger({ tenancies: [t], payments: monthly('2024-01', '2024-06') }, 2025, { asOf: '2025-03-01' }).carriedOnly, [])
})

test('Endsaldo eines Jahres ist der Anfangssaldo des nächsten', () => {
  const payments = [...monthly('2024-01', '2024-09'), pay('2024-10-20', 50000), pay('2024-12-28', 200000), ...monthly('2025-03', '2025-08'), pay('2025-09-01', -80000)]
  for (const year of [2024, 2025, 2026]) {
    const a = rowOf(ledger({ payments }, year, { asOf: '2027-01-10' }))
    const b = rowOf(ledger({ payments }, year + 1, { asOf: '2027-01-10' }))
    assert.equal(a.closingBalanceCents, b.openingBalanceCents, `${year}`)
    assert.equal(a.closingBalanceCents, a.openingBalanceCents + a.paidYearCents - a.sollYearCents, `${year}: Formel`)
  }
})

test('Ohne Mietverhältnis vor dem Jahr ist der Anfangssaldo 0, außer eine Zahlung ging vor Beginn ein', () => {
  const t = tenancy({ start: '2025-01-01', prepayments: [{ from: '2025-01', monthlyCents: 20000 }], baseRents: [{ from: '2025-01', monthlyCents: 60000 }] })
  assert.equal(rowOf(ledger({ tenancies: [t], payments: monthly('2025-01', '2025-12') }, 2025)).openingBalanceCents, 0)
  const r = rowOf(ledger({ tenancies: [t], payments: [pay('2024-12-28', 80000), ...monthly('2025-02', '2025-12')] }, 2025, { asOf: '2026-01-10' }))
  assert.equal(r.openingBalanceCents, 80000)
  assert.equal(monthOf(r, 1).status, 'paid')
})

// ---------- Abrechnungsreife (E5) ----------

// Gezahlt Januar bis November 2024, seitdem nichts: Der Dezember 2024 ist ganz offen, 2025 und Januar/Februar 2026 auch.
const stopped = monthly('2024-01', '2024-11')
const objectStatement = (year: number, over: Partial<LedgerStatement> = {}): LedgerStatement => ({
  label: String(year),
  months: monthsBetween(`${year}-01`, `${year}-12`),
  deadline: `${year + 1}-12-31`,
  closed: false,
  sentAt: null,
  credited: null,
  covers: () => true,
  ...over,
})
const statements2024 = (over: Partial<LedgerStatement> = {}): LedgerStatement[] => [objectStatement(2024, over), objectStatement(2025), objectStatement(2026)]

test('E5: Frist abgelaufen ohne erteilte Abrechnung: die Vorauszahlung Dezember 2024 ist nicht mehr einzeln einforderbar', () => {
  const r = rowOf(ledger({ payments: stopped }, 2026, { asOf: '2026-03-01', statements: statements2024() }))
  assert.equal(r.notDemandableCents, 20000)
  assert.deepEqual(r.notDemandable, [{ reason: 'deadlinePassed', label: '2024', cents: 20000 }])
  // Offen sind Dezember 2024 (800), 2025 (9.600) und Januar/Februar 2026 (1.600); davon 200 € nicht einforderbar.
  assert.equal(r.arrearsCents, 1200000 - 20000)
  // Kaltmiete und die Vorauszahlungen 2025 (Frist läuft bis 31.12.2026) bleiben Rückstand.
})

test('E5: erteilt mit Jahreskorrektur: in der Abrechnung enthalten', () => {
  const credited = new Map([['t', 220000]])
  const r = rowOf(ledger({ payments: stopped }, 2025, { asOf: '2025-06-01', statements: statements2024({ closed: true, sentAt: '2025-03-01', credited }) }))
  assert.deepEqual(r.notDemandable, [{ reason: 'inStatement', label: '2024', cents: 20000 }])
  assert.equal(r.notDemandableCents, 20000)
})

test('E5: erteilt ohne Jahreskorrektur: rechnet die nicht gezahlte Vorauszahlung als gezahlt an (Differenz)', () => {
  const credited = new Map([['t', 240000]])
  const r = rowOf(ledger({ payments: stopped }, 2025, { asOf: '2025-06-01', statements: statements2024({ closed: true, sentAt: '2025-03-01', credited }) }))
  assert.deepEqual(r.notDemandable, [{ reason: 'creditedAsPaid', label: '2024', cents: 20000, differenceCents: 20000 }])
})

test('E5: abgeschlossen ohne Versanddatum, vor Fristablauf: einforderbar; versandt nach dem Stichtag ebenso', () => {
  const credited = new Map([['t', 240000]])
  const a = rowOf(ledger({ payments: stopped }, 2025, { asOf: '2025-06-01', statements: statements2024({ closed: true, sentAt: null, credited }) }))
  assert.equal(a.notDemandableCents, 0)
  assert.equal(a.arrearsCents, 80000 + 5 * 80000)
  // Vergangene Jahresansicht: Stichtag ist der 31.12.2024, der Versand am 01.03.2025 liegt danach.
  const b = rowOf(ledger({ payments: stopped }, 2024, { asOf: '2026-06-01', statements: statements2024({ closed: true, sentAt: '2025-03-01', credited }) }))
  assert.equal(b.notDemandableCents, 0)
  assert.equal(b.arrearsCents, 80000)
})

test('E5: Heizvorauszahlung nach eigener Heizperiode (Weg d) folgt deren Frist, die kalte Vorauszahlung der des Objekts', () => {
  const t = tenancy({ heatingPrepayments: [{ from: '2024-01', monthlyCents: 10000 }] })
  const statements: LedgerStatement[] = [
    objectStatement(2024, { covers: (_t, _m, c) => c === 'prepayment', deadline: '2025-12-31' }),
    // Heizperiode Mai 2024 bis April 2025, Frist bis 30.04.2026.
    { label: '01.05.2024–30.04.2025', months: monthsBetween('2024-05', '2025-04'), deadline: '2026-04-30', closed: false, sentAt: null, credited: null, covers: (_t, _m, c) => c === 'heatingPrepayment' },
    objectStatement(2025, { covers: (_t, _m, c) => c === 'prepayment' }),
  ]
  const payments = monthly('2024-01', '2024-11', 90000)
  const r = rowOf(ledger({ tenancies: [t], payments }, 2026, { asOf: '2026-03-01', statements }))
  // Kalt 2024 abgelaufen (Dezember 200 €), Heizung Dezember 2024 noch einforderbar (Frist bis 30.04.2026).
  assert.deepEqual(r.notDemandable, [{ reason: 'deadlinePassed', label: '2024', cents: 20000 }])
  const later = rowOf(ledger({ tenancies: [t], payments }, 2026, { asOf: '2026-05-10', statements }))
  assert.deepEqual(later.notDemandable, [
    { reason: 'deadlinePassed', label: '2024', cents: 20000 },
    { reason: 'deadlinePassed', label: '01.05.2024–30.04.2025', cents: 50000 },
  ])
})

test('E5: Kaltmiete bleibt immer Rückstand, ohne statements gibt es keine Klassifikation', () => {
  const r = rowOf(ledger({ payments: stopped }, 2026, { asOf: '2026-03-01', statements: statements2024() }))
  const without = rowOf(ledger({ payments: stopped }, 2026, { asOf: '2026-03-01' }))
  assert.equal(without.notDemandableCents, 0)
  assert.deepEqual(without.notDemandable, [])
  assert.equal(r.arrearsCents + r.notDemandableCents, without.arrearsCents)
  // Die Monatszelle nennt den nicht einforderbaren Teil; der Status bleibt, was die Zahlungen sagen.
  const dec = monthOf(rowOf(ledger({ payments: stopped }, 2024, { asOf: '2026-03-01', statements: statements2024() })), 12)
  assert.equal(dec.status, 'open')
  assert.equal(dec.notDemandableCents, undefined, 'Ansicht 2024: Stichtag 31.12.2024, noch nicht reif')
})

test('E5: carriedOnly nennt den nicht einforderbaren Teil getrennt', () => {
  const t = tenancy({ end: '2024-12-31' })
  const l = ledger({ tenancies: [t], payments: stopped }, 2026, { asOf: '2026-03-01', statements: statements2024() })
  assert.deepEqual(l.carriedOnly, [{ tenancyId: 't', tenantName: 'Mieter', unitName: 'EG', end: '2024-12-31', openCents: 60000, notDemandableCents: 20000, notDemandable: [{ reason: 'deadlinePassed', label: '2024', cents: 20000 }] }])
  assert.equal(l.totals.openCents, 60000)
  assert.equal(l.totals.notDemandableCents, 20000)
})

// ---------- Geführt ab der ersten erfassten Mietzahlung des Objekts (#281, Durchsicht) ----------
// Fehlende Erfassung ist keine Nichtzahlung: Das Konto beginnt im Monat der frühesten erfassten Mietzahlung des
// Objekts, frühestens mit dem Mietbeginn. Ein Objekt beginnt die Erfassung einmal, ab dann gilt jeder Monat.

const since2020 = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => tenancy({
  start: '2020-04-01', prepayments: [{ from: '2020-04', monthlyCents: 20000 }], baseRents: [{ from: '2020-04', monthlyCents: 60000 }], ...over,
})

test('Geführt ab: Mietbeginn 2020, Zahlungen erst ab 2025 erfasst: 2025 ohne Übertrag, ab dann fortlaufend', () => {
  const payments = [...monthly('2025-01', '2025-11'), ...monthly('2026-01', '2026-03')]
  const y2025 = rowOf(ledger({ tenancies: [since2020()], payments }, 2025, { asOf: '2026-04-10' }))
  assert.equal(y2025.ledgerStart, '2025-01-01')
  assert.equal(y2025.openingBalanceCents, 0, 'die Jahre 2020 bis 2024 sind nicht erfasst, nicht unbezahlt')
  assert.equal(y2025.arrearsCents, 80000, 'nur der Dezember 2025')
  assert.equal(y2025.closingBalanceCents, -80000)
  const y2026 = rowOf(ledger({ tenancies: [since2020()], payments }, 2026, { asOf: '2026-04-10' }))
  assert.equal(y2026.openingBalanceCents, -80000, 'ab dem ersten erfassten Jahr läuft der Übertrag')
  assert.equal(y2026.ledgerStart, '2025-01-01')
})

test('Geführt ab: ohne jede erfasste Mietzahlung zählt das angezeigte Jahr für sich, wie bisher', () => {
  const r = rowOf(ledger({ tenancies: [since2020()], payments: [] }, 2025, { asOf: '2025-03-10' }))
  assert.equal(r.openingBalanceCents, 0)
  assert.equal(r.arrearsCents, 160000, 'Januar und Februar 2025')
  // Ein Ausgezogener ohne erfasste Zahlung bekommt keinen Übertrag ins Folgejahr.
  assert.deepEqual(ledger({ tenancies: [since2020({ end: '2024-06-30' })], payments: [] }, 2025, { asOf: '2025-03-10' }).carriedOnly, [])
})

test('Geführt ab: beginnt das Mietverhältnis im Jahr der ersten Zahlung, gilt der Mietbeginn, und es gibt keinen Zusatz', () => {
  const r = rowOf(ledger({ payments: monthly('2024-01', '2024-12') }, 2024))
  assert.equal(r.ledgerStart, undefined)
  // Eine Zahlung vor Beginn bleibt ein positiver Anfangssaldo (siehe oben).
})

test('Geführt ab: der Hinweis prepayment.arrears zählt frühere, nicht erfasste Jahre nicht mit', () => {
  // Seit 2020, März bis November 2025 gezahlt: offen ist nur die Vorauszahlung Dezember 2025 (wie bis 0.13).
  const s = computeSettlement(snapshotOf(source({
    tenancies: [since2020()],
    costItems: [{ id: 'g', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 73056, key: 'area' }],
    payments: monthly('2025-01', '2025-11'),
  }), 2025))
  const n = s.notices.filter((x) => x.code === 'prepayment.arrears')
  assert.equal(n.length, 1)
  assert.match(n[0]?.text ?? '', /sind 200,00 € nicht gezahlt\./)
})

// Ein zweites Mietverhältnis im Objekt, das ab Januar 2025 jeden Monat zahlt: Das Objekt erfasst ab Januar 2025.
const other = (): SnapshotTenancy => tenancy({ id: 'o', unitId: 'b', tenantName: 'Andere', start: '2024-01-01' })
const otherPays = (to = '2026-12'): SnapshotPayment[] => monthly('2025-01', to).map((p) => ({ ...p, tenancyId: 'o' }))
const twoUnits = (s: Partial<SnapshotSource>): Partial<SnapshotSource> => ({ units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }, { id: 'b', name: 'OG', areaM2: 50, participates: true }], ...s })

test('Durchsicht (A): Mietnomade ohne jede Zahlung, das Objekt erfasst seit Januar 2025: Rückstand 8.000 €, im Folgejahr in carriedOnly', () => {
  const t = tenancy({ start: '2025-03-01', end: '2025-12-31', prepayments: [{ from: '2025-03', monthlyCents: 20000 }], baseRents: [{ from: '2025-03', monthlyCents: 60000 }] })
  const s = twoUnits({ tenancies: [t, other()], payments: otherPays() })
  const y2025 = rowOf(ledger(s, 2025, { asOf: '2026-10-31' }))
  assert.equal(y2025.arrearsCents, 800000)
  assert.equal(y2025.ledgerStart, undefined, 'der Mietbeginn liegt nach dem Beginn der Erfassung')
  const l = ledger(s, 2026, { asOf: '2026-10-31' })
  assert.deepEqual(l.carriedOnly.map((r) => [r.tenancyId, r.openCents]), [['t', 800000]])
})

test('Durchsicht (B): Nachmieter ab Oktober 2025 zahlt erst ab Januar 2026: Oktober bis Dezember in beiden Ansichten gleich getilgt', () => {
  const t = tenancy({ start: '2025-10-01', prepayments: [{ from: '2025-10', monthlyCents: 20000 }], baseRents: [{ from: '2025-10', monthlyCents: 60000 }] })
  const s = twoUnits({ tenancies: [t, other()], payments: [...otherPays(), ...monthly('2026-01', '2026-10')] })
  const y2025 = rowOf(ledger(s, 2025, { asOf: '2026-10-31' }))
  assert.deepEqual([10, 11, 12].map((m) => monthOf(y2025, m).status), ['open', 'open', 'open'])
  assert.equal(y2025.closingBalanceCents, -240000)
  // Die Zahlungen 2026 tilgen die ältesten Forderungen zuerst: Am 03.01. deckt die erste den Oktober 2025.
  assert.equal(monthOf(y2025, 10).paidLaterOn, '2026-02-03')
  const y2026 = rowOf(ledger(s, 2026, { asOf: '2026-10-31' }))
  assert.equal(y2026.openingBalanceCents, -240000, 'Übertrag = Endsaldo 2025')
  // Fällig sind Oktober 2025 bis September 2026 (9.600 €), gezahlt 8.000 €; die Zahlung vom 03.10. tilgt zuerst die
  // Vorauszahlung Oktober 2026 (200 €, noch nicht fällig), also bleiben 1.800 € Rückstand.
  assert.equal(y2026.arrearsCents, 180000)
})

test('Durchsicht (C): Auszug Juni 2025 ohne Zahlung, Teilzahlung 1.000 € im März 2026: der Rest steht 2026 in carriedOnly', () => {
  const t = tenancy({ start: '2025-01-01', end: '2025-06-30', prepayments: [{ from: '2025-01', monthlyCents: 20000 }], baseRents: [{ from: '2025-01', monthlyCents: 60000 }] })
  const s = twoUnits({ tenancies: [t, other()], payments: [...otherPays(), pay('2026-03-01', 100000)] })
  const l = ledger(s, 2026, { asOf: '2026-10-31' })
  assert.deepEqual(l.carriedOnly.map((r) => [r.tenancyId, r.openCents]), [['t', 480000 - 100000]])
})

test('Durchsicht (D): Mietbeginn 2020, Erfassung ab Oktober 2026, jeder Monat genau bezahlt: geführt ab Oktober 2026, kein Rückstand', () => {
  const payments = monthly('2026-10', '2027-12')
  const y2026 = rowOf(ledger({ tenancies: [since2020()], payments }, 2026, { asOf: '2028-01-15' }))
  assert.equal(y2026.ledgerStart, '2026-10-01')
  assert.deepEqual([10, 11, 12].map((m) => monthOf(y2026, m).status), ['paid', 'paid', 'paid'])
  assert.deepEqual([1, 9].map((m) => monthOf(y2026, m).status), ['notRecorded', 'notRecorded'], 'vor der Erfassung: nicht erfasst, nicht offen')
  assert.equal(y2026.arrearsCents, 0)
  assert.equal(y2026.openMonths, 0)
  assert.equal(y2026.openingBalanceCents, 0)
  assert.equal(y2026.closingBalanceCents, 0)
  assert.equal(y2026.sollYearCents, 12 * 80000, 'das Soll des Jahres bleibt (Steuer)')
  const y2027 = rowOf(ledger({ tenancies: [since2020()], payments }, 2027, { asOf: '2028-01-15' }))
  assert.equal(y2027.openingBalanceCents, 0)
  assert.equal(y2027.arrearsCents, 0)
  // Ein Jahr ganz vor der Erfassung: alle Monate nicht erfasst, kein Rückstand.
  const y2025 = rowOf(ledger({ tenancies: [since2020()], payments }, 2025, { asOf: '2028-01-15' }))
  assert.equal(y2025.arrearsCents, 0)
  assert.ok(y2025.months.every((m) => m.status === 'notRecorded'))
})

test('Durchsicht Befund 3: ein Zeitraum, der vor die Erfassung reicht, gilt dort als so gezahlt, wie die Abrechnung anrechnet', () => {
  // Zeitraum Juli 2024 bis Juni 2025, Erfassung ab Januar 2025, Juni 2025 nicht gezahlt; versandt mit Jahreskorrektur
  // (12 × 200 € − die offenen 200 €): Die Abrechnung enthält die nicht gezahlte Vorauszahlung.
  const st: LedgerStatement = {
    label: '2024/2025', months: monthsBetween('2024-07', '2025-06'), deadline: '2026-06-30', closed: true, sentAt: '2025-08-01',
    credited: new Map([['t', 220000]]), covers: () => true,
  }
  const r = rowOf(ledger({ tenancies: [since2020()], payments: monthly('2025-01', '2025-05') }, 2025, { asOf: '2025-10-01', statements: [st] }))
  assert.equal(r.ledgerStart, '2025-01-01')
  assert.deepEqual(r.notDemandable, [{ reason: 'inStatement', label: '2024/2025', cents: 20000 }])
})

test('Durchsicht Nebenbefund: ein Monat laut Verwendungszweck vor dem Beginn der Erfassung wird genannt', () => {
  // Erfassung ab Januar 2025, die Zahlung nennt Dezember 2024: im Mietverhältnis, aber vor dem Mietkonto.
  const p = pay('2025-02-03', 80000, { designatedMonth: '2024-12' })
  const r = rowOf(ledger({ tenancies: [since2020()], payments: [...monthly('2025-01', '2025-01'), p] }, 2025, { asOf: '2025-03-01' }))
  assert.deepEqual(r.designatedOutside, [p.id])
})

// Integrationsdurchsicht 0.14 (M1): Dauerauftrag zum Monatsende für den Folgemonat, erste erfasste Zahlung am 30.12.2023. Das
// Konto wird ab Januar 2024 geführt; die Zahlung deckt den Januar, und nach dem Auszug Ende Januar 2026 ist nichts offen.
test('Geführt ab: erste Zahlung in den letzten zehn Tagen eines Monats, Mietverhältnis läuft schon: geführt ab dem Folgemonat', () => {
  const t = since2020({ end: '2026-01-31', baseRents: [{ from: '2020-01', monthlyCents: 60000 }, { from: '2026-01', monthlyCents: 65000 }] })
  const payments = [pay('2023-12-30', 80000), ...monthsBetween('2024-01', '2025-12').map((m) => pay(`${m}-${m.endsWith('-02') ? 28 : 30}`, m === '2025-12' ? 85000 : 80000))]
  const y2024 = rowOf(ledger({ tenancies: [t], payments }, 2024, { asOf: '2026-03-01' }))
  assert.equal(y2024.ledgerStart, '2024-01-01')
  assert.equal(y2024.openingBalanceCents, 80000, 'die Zahlung vom 30.12.2023 ist für Januar 2024 vorausbezahlt')
  assert.equal(monthOf(y2024, 1).status, 'paid')
  const y2026 = rowOf(ledger({ tenancies: [t], payments }, 2026, { asOf: '2026-03-01' }))
  assert.equal(monthOf(y2026, 1).status, 'paid', 'der Januar 2026 ist mit der Zahlung vom 30.12.2025 gedeckt')
  assert.equal(y2026.arrearsCents, 0)
  assert.equal(y2026.closingBalanceCents, 0)
  const y2023 = rowOf(ledger({ tenancies: [t], payments }, 2023, { asOf: '2026-03-01' }))
  assert.ok(y2023.months.every((m) => m.status === 'notRecorded'), 'der Dezember 2023 ist nicht erfasst, nicht offen')
  assert.equal(y2024.ledgerStartPaidOn, '2023-12-30')
  // Steht an der ersten Zahlung ihr eigener Monat (Verwendungszweck), gilt sie für Dezember: geführt ab Dezember 2023.
  const own = [pay('2023-12-30', 80000, { designatedMonth: '2023-12' }), ...payments.slice(1)]
  const d2024 = rowOf(ledger({ tenancies: [t], payments: own }, 2024, { asOf: '2026-03-01' }))
  assert.equal(d2024.ledgerStart, '2023-12-01')
  assert.equal(d2024.ledgerStartPaidOn, undefined)
})

// Durchsicht des Zweigs (S1 bis S4): Die Verschiebung des Beginns wird je Mietverhältnis entschieden, nach seiner ersten
// eigenen Zahlung, unabhängig von der Reihenfolge der Zahlungen.
const ultimoA = (): SnapshotTenancy => since2020()
const lateEach = (from: string, to: string, tenancyId = 't'): SnapshotPayment[] => monthsBetween(from, to).map((m) => pay(`${m}-25`, 80000, { tenancyId }))
const onThird = (from: string, to: string, tenancyId: string): SnapshotPayment[] => monthsBetween(from, to).map((m) => pay(`${m}-03`, 80000, { tenancyId }))
const bSince2020 = (): SnapshotTenancy => since2020({ id: 'o', unitId: 'b', tenantName: 'Andere' })

test('S1: das Ergebnis hängt nicht von der Reihenfolge der Zahlungen ab', () => {
  // Am selben Tag zahlt A ohne und B mit Monat laut Verwendungszweck (Dezember); vorher entschied die erste Zahlung im
  // Array über das ganze Objekt.
  const payments = [...lateEach('2023-12', '2024-12'), pay('2023-12-25', 80000, { tenancyId: 'o', designatedMonth: '2023-12' }), ...lateEach('2024-01', '2024-12', 'o')]
  const s = (ps: SnapshotPayment[]) => twoUnits({ tenancies: [ultimoA(), bSince2020()], payments: ps })
  const a = ledger(s(payments), 2024, { asOf: '2025-01-15' })
  const b = ledger(s([...payments].reverse()), 2024, { asOf: '2025-01-15' })
  assert.deepEqual(b.rows, a.rows)
  assert.equal(rowOf(a, 't').ledgerStart, '2024-01-01')
  assert.equal(rowOf(a, 'o').ledgerStart, '2023-12-01')
})

test('S2: B zahlt am 3. für den Monat, A am 25. für den Folgemonat: A ist ab dem Folgemonat geführt und ohne Rückstand', () => {
  const payments = [...onThird('2023-12', '2024-12', 'o'), ...lateEach('2023-12', '2024-12')]
  const l = ledger(twoUnits({ tenancies: [ultimoA(), bSince2020()], payments }), 2024, { asOf: '2025-01-15' })
  const a = rowOf(l, 't')
  assert.equal(a.ledgerStart, '2024-01-01')
  assert.equal(a.arrearsCents, 0)
  assert.equal(monthOf(a, 1).status, 'paid')
  const b = rowOf(l, 'o')
  assert.equal(b.ledgerStart, '2023-12-01')
  assert.equal(b.arrearsCents, 0)
})

test('S3: „erste erfasste Mietzahlung vom …“ steht nur an der Zeile des Mietverhältnisses, das sie hat', () => {
  const payments = [...onThird('2023-12', '2024-12', 'o'), ...lateEach('2023-12', '2024-12')]
  const l = ledger(twoUnits({ tenancies: [ultimoA(), bSince2020()], payments }), 2024, { asOf: '2025-01-15' })
  assert.equal(rowOf(l, 't').ledgerStartPaidOn, '2023-12-25')
  assert.equal(rowOf(l, 'o').ledgerStartPaidOn, undefined)
})

test('S4: verspätete erste Zahlung am 25., danach pünktlich am 3.: keine Verschiebung, Endsaldo 0', () => {
  const payments = [pay('2023-12-25', 80000), ...monthly('2024-01', '2024-12')]
  const r = rowOf(ledger({ tenancies: [ultimoA()], payments }, 2024, { asOf: '2025-01-15' }))
  assert.equal(r.closingBalanceCents, 0)
  assert.equal(r.arrearsCents, 0)
})
