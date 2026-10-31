// Vorauszahlung und Miete im angebrochenen Monat (#311). Beginnt oder endet ein Mietverhältnis im
// Monat, setzt Mietfuchs die Staffelrate nach Kalendertagen an: Rate × Tage im Mietverhältnis /
// Tage des Monats, je Monat auf Cent gerundet. Das ist eine Auslegung (Entscheidung R-1); ein Gesetz
// oder eine BGH-Entscheidung zur Methode gibt es nicht. Vorher zählte ein Monat nur, wenn das
// Mietverhältnis am Monatsersten bestand: Im Einzugsmonat fehlte die ganze Rate, im Auszugsmonat
// stand sie voll da. Dieselbe Regel gilt für die Abrechnung und das Mietkonto (`rateInMonth`).
//
// Daten aus dem Plan: zwei gleiche Wohnungen, Grundsteuer 1.200 € nach Fläche, 150 €
// Vorauszahlung, 500 € Kaltmiete, Abrechnungsjahr 2025.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePrepaymentCents, computeSettlement, ledgerRows, monthShare, rateInMonth, rentLedger, taxReport, type ComputedSettlement,
} from '../src/calc.ts'
import { heatingSnapshotFor, snapshotFor, snapshotOf, type SnapshotPayment, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { compareWithFrozen } from '../src/settlementDiff.ts'
import { CALENDAR_RULES, calendarPeriod, calendarYearPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import type { BillingPeriod, PeriodRules, SeparateSpan } from '../../shared/types.ts'

// Kennungen der Zahlungen (#281: Die Tilgung braucht sie als Nachrang beim Sortieren).
let paymentSeq = 0
const pid = (): string => `p${String(++paymentSeq).padStart(4, '0')}`


const tenancy = (over: Partial<SnapshotTenancy> & Pick<SnapshotTenancy, 'start'>): SnapshotTenancy => ({
  id: 'm', unitId: 'a', tenantName: 'M', persons: 1, personHistory: [], end: null,
  prepayments: [{ from: '2020-01', monthlyCents: 15000 }], prepaymentOverrides: {},
  baseRents: [{ from: '2020-01', monthlyCents: 50000 }], ...over,
})
const nachbar = (): SnapshotTenancy => tenancy({ id: 'n', unitId: 'b', tenantName: 'N', start: '2020-01-01' })

const source = (tenancies: SnapshotTenancy[], over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }, { id: 'b', name: 'OG', areaM2: 50, participates: true }],
  tenancies: [...tenancies, nachbar()],
  costItems: [{ id: 'g', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 120000, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const settle = (tenancies: SnapshotTenancy[], over: Partial<SnapshotSource> = {}): ComputedSettlement =>
  computeSettlement(snapshotOf(source(tenancies, over), 2025))
const st = (s: ComputedSettlement, id = 'm') => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`keine Abrechnung für ${id}`)
const partial = (s: ComputedSettlement) => s.notices.filter((n) => n.code === 'prepayment.partial-month')

const einzug = tenancy({ start: '2025-03-15' })
const auszug = tenancy({ start: '2024-01-01', end: '2025-06-15' })

test('monthShare: Tage des Mietverhältnisses im Kalendermonat, inklusive Grenzen', () => {
  assert.deepEqual(monthShare({ start: '2025-03-15', end: null }, '2025-03'), { days: 17, of: 31 })
  assert.deepEqual(monthShare({ start: '2024-01-01', end: '2025-06-15' }, '2025-06'), { days: 15, of: 30 })
  assert.deepEqual(monthShare({ start: '2025-03-15', end: null }, '2025-02'), { days: 0, of: 28 })
  assert.deepEqual(monthShare({ start: '2025-03-15', end: null }, '2025-04'), { days: 30, of: 30 })
  assert.deepEqual(monthShare({ start: '2024-01-01', end: '2025-06-15' }, '2025-07'), { days: 0, of: 31 })
  assert.deepEqual(monthShare({ start: '2024-02-10', end: '2024-02-20' }, '2024-02'), { days: 11, of: 29 })
})

test('Einzug am 15.03.: März anteilig 17/31, Vorauszahlung 1.432,26 € statt 1.350,00 €, Guthaben +82,26 €', () => {
  const s = settle([einzug])
  const m = st(s)
  assert.equal(m.totalShareCents, 48000) // 600 € × 292/365
  assert.equal(m.prepaymentCents, 143226) // 9 × 150 € + 17/31 × 150 € = 82,258… → 82,26 €
  assert.equal(m.balanceCents, 95226)
})

test('Auszug am 15.06.: Juni anteilig 15/30, Vorauszahlung 825,00 € statt 900,00 €, Guthaben −75,00 €', () => {
  const s = settle([auszug])
  const m = st(s)
  assert.equal(m.totalShareCents, 27288) // 600 € × 166/365 = 272,876…
  assert.equal(m.prepaymentCents, 82500)
  assert.equal(m.balanceCents, 55212)
})

test('Einzug am Monatsersten und Auszug am Monatsletzten: unverändert, ohne Hinweis', () => {
  const ganz = settle([tenancy({ start: '2025-03-01' })])
  assert.equal(st(ganz).prepaymentCents, 150000)
  assert.deepEqual(partial(ganz), [])
  assert.equal(st(ganz).prepaymentNote, undefined)
  const bisJuni = settle([tenancy({ start: '2024-01-01', end: '2025-06-30' })])
  assert.equal(st(bisJuni).prepaymentCents, 90000)
  assert.deepEqual(partial(bisJuni), [])
})

test('Hinweis prepayment.partial-month: angesetzter Betrag, Auslegung, Beispielsummen ausdrücklich als Beispiel', () => {
  const s = settle([einzug])
  const found = partial(s)
  assert.equal(found.length, 1, `Hinweise: ${s.notices.map((n) => n.code).join(', ')}`)
  const [n] = found
  assert.equal(n?.level, 'hint')
  assert.equal(n?.title, 'Vorauszahlung im angebrochenen Monat')
  assert.deepEqual(n?.subject, { kind: 'tenancy', id: 'm' })
  assert.deepEqual(n?.terms, ['prepayment', 'partialMonth'])
  assert.equal(n?.text,
    'M (EG): Einzug am 15.03.2025. Für März 2025 setzt Mietfuchs die Vorauszahlung anteilig nach Kalendertagen an, 17 von 31 Tagen: 82,26 € statt 150,00 €. ' +
      'Das ist eine Auslegung: Ihr Mietvertrag kann anderes vorsehen, und maßgeblich ist, was der Mieter für den Zeitraum tatsächlich gezahlt hat. ' +
      'Weicht das ab, tragen Sie die gezahlte Summe bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein. ' +
      'Zum Beispiel, wenn alle übrigen Monate voll gezahlt sind: mit vollem März 2025 1.500,00 €, ohne März 2025 1.350,00 €.')
  // Für den Mieter steht es auf der Abrechnung, damit er es an seinen Unterlagen prüfen kann.
  assert.equal(st(s).prepaymentNote, 'Für März 2025 ist die Vorauszahlung anteilig angesetzt (17 von 31 Tagen, 82,26 €).')
})

test('Hinweis bei Ein- und Auszug im selben Zeitraum: beide Monate in einem Hinweis', () => {
  const s = settle([tenancy({ start: '2025-03-15', end: '2025-06-15' })])
  assert.equal(st(s).prepaymentCents, 8226 + 2 * 15000 + 7500)
  const [n, ...rest] = partial(s)
  assert.equal(rest.length, 0)
  assert.equal(n?.text,
    'M (EG): Einzug am 15.03.2025, Auszug am 15.06.2025. Für März 2025 und Juni 2025 setzt Mietfuchs die Vorauszahlung anteilig nach Kalendertagen an: ' +
      'März 2025 17 von 31 Tagen, 82,26 € statt 150,00 €; Juni 2025 15 von 30 Tagen, 75,00 € statt 150,00 €. ' +
      'Das ist eine Auslegung: Ihr Mietvertrag kann anderes vorsehen, und maßgeblich ist, was der Mieter für den Zeitraum tatsächlich gezahlt hat. ' +
      'Weicht das ab, tragen Sie die gezahlte Summe bei „abzüglich geleisteter Vorauszahlungen“ mit „✎ anpassen“ ein. ' +
      'Zum Beispiel, wenn alle übrigen Monate voll gezahlt sind: mit vollen Monaten 600,00 €, ohne diese Monate 300,00 €.')
  assert.equal(st(s).prepaymentNote,
    'Für März 2025 und Juni 2025 ist die Vorauszahlung anteilig angesetzt (März 2025: 17 von 31 Tagen, 82,26 €; Juni 2025: 15 von 30 Tagen, 75,00 €).')
})

// Durchsicht #311, K1: Ohne weitere Monate lautete das Beispiel „ohne Mai 2025 0,00 €“. Es nennt dann
// nur den vollen Monat und setzt keine übrigen Monate voraus, die es nicht gibt.
test('Hinweis bei Ein- und Auszug im selben Monat: Beispiel nur mit vollem Monat', () => {
  const s = settle([tenancy({ start: '2025-05-10', end: '2025-05-20' })])
  assert.equal(st(s).prepaymentCents, 5323)
  const [n] = partial(s)
  assert.ok(n?.text.endsWith('mit „✎ anpassen“ ein. Zum Beispiel: mit vollem Mai 2025 150,00 €.'), n?.text)
  assert.doesNotMatch(n?.text ?? '', / 0,00 €|übrigen Monate/)
})

test('Jahreskorrektur gesetzt: sie gilt, kein Hinweis, kein Satz für den Mieter', () => {
  const s = settle([tenancy({ start: '2025-03-15', prepaymentOverrides: { '2025-01': 150000 } })])
  assert.equal(st(s).prepaymentCents, 150000)
  assert.equal(st(s).prepaymentOverridden, true)
  assert.deepEqual(partial(s), [])
  assert.equal(st(s).prepaymentNote, undefined)
})

test('Ohne Vorauszahlung im angebrochenen Monat (Staffel beginnt später): kein Hinweis', () => {
  const s = settle([tenancy({ start: '2025-03-15', prepayments: [{ from: '2025-04', monthlyCents: 15000 }] })])
  assert.equal(st(s).prepaymentCents, 135000)
  assert.deepEqual(partial(s), [])
})

test('Mietkonto: Kaltmiete und Vorauszahlung im Einzugs- und Auszugsmonat anteilig, mit Anteil am Monat', () => {
  const ein = rentLedger(snapshotOf(source([einzug]), 2025)).rows.find((r) => r.tenancyId === 'm') ?? assert.fail('keine Zeile')
  const maerz = ein.months[2] ?? assert.fail('kein März')
  assert.deepEqual([maerz.baseRentCents, maerz.prepaymentCents, maerz.sollCents, maerz.share], [27419, 8226, 35645, { days: 17, of: 31 }])
  assert.equal(ein.months[3]?.share, undefined, 'ein voller Monat trägt keinen Anteil')
  assert.equal(ein.months[1]?.sollCents, 0, 'vor dem Einzug kein Soll')
  assert.equal(ein.prepaymentYearCents, 143226)
  assert.equal(ein.baseRentYearCents, 9 * 50000 + 27419)
  const aus = rentLedger(snapshotOf(source([auszug]), 2025)).rows.find((r) => r.tenancyId === 'm') ?? assert.fail('keine Zeile')
  const juni = aus.months[5] ?? assert.fail('kein Juni')
  assert.deepEqual([juni.baseRentCents, juni.prepaymentCents, juni.sollCents, juni.share], [25000, 7500, 32500, { days: 15, of: 30 }])
  assert.equal(aus.months[6]?.sollCents, 0)
})

test('Mietkonto: die Pauschale folgt derselben Regel', () => {
  const t = tenancy({ start: '2025-03-15', costModel: 'flatRate', prepayments: [], flatRates: [{ from: '2025-03', monthlyCents: 15000 }] })
  const row = ledgerRows(snapshotOf(source([t]), 2025), calendarYearPeriod(2025)).find((r) => r.tenancyId === 'm') ?? assert.fail('keine Zeile')
  assert.equal(row.months[2]?.flatRateCents, 8226)
  assert.equal(row.flatRateYearCents, 143226)
})

test('Auszugsmonat anteilig gezahlt: kein falscher Rückstandshinweis mehr', () => {
  const payments: SnapshotPayment[] = [
    ...['01', '02', '03', '04', '05'].map((m) => ({ id: pid(), tenancyId: 'm', date: `2025-${m}-03`, amountCents: 65000 })),
    { id: pid(), tenancyId: 'm', date: '2025-06-03', amountCents: 32500 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: pid(), tenancyId: 'n', date: `2025-${String(i + 1).padStart(2, '0')}-03`, amountCents: 65000 })),
  ]
  const s = settle([auszug], { payments })
  assert.deepEqual(s.notices.filter((n) => n.code === 'prepayment.arrears'), [])
})

test('Einzugsmonat nicht gezahlt: der Rückstand fällt jetzt im März auf, nicht verdeckt im April', () => {
  const payments: SnapshotPayment[] = Array.from({ length: 9 }, (_, i) => ({ id: pid(), tenancyId: 'm', date: `2025-${String(i + 4).padStart(2, '0')}-03`, amountCents: 65000 }))
  const row = rentLedger(snapshotOf(source([einzug], { payments }), 2025)).rows.find((r) => r.tenancyId === 'm') ?? assert.fail('keine Zeile')
  assert.equal(row.arrearsCents, 35645)
})

test('Mieterwechsel am Folgetag (15.07./16.07.): 72,58 € + 77,42 € = eine volle Rate', () => {
  const a = tenancy({ id: 'a1', start: '2024-01-01', end: '2025-07-15' })
  const b = tenancy({ id: 'b1', tenantName: 'B', start: '2025-07-16' })
  const s = settle([a, b])
  assert.equal(st(s, 'a1').prepaymentCents, 6 * 15000 + 7258)
  assert.equal(st(s, 'b1').prepaymentCents, 7742 + 5 * 15000)
  const rows = rentLedger(snapshotOf(source([a, b]), 2025)).rows
  const juli = rows.filter((r) => r.tenancyId === 'a1' || r.tenancyId === 'b1').map((r) => r.months[6]?.prepaymentCents ?? 0)
  assert.equal(juli.reduce((x, y) => x + y, 0), 15000)
})

test('Nachmieter am selben Tag (15.06./15.06.): beide bekommen den 15.06., der Fehlerhinweis der Überschneidung bleibt', () => {
  const a = tenancy({ id: 'a1', start: '2024-01-01', end: '2025-06-15' })
  const b = tenancy({ id: 'b1', tenantName: 'B', start: '2025-06-15' })
  const s = settle([a, b])
  assert.equal(st(s, 'a1').prepaymentCents, 5 * 15000 + 7500)
  assert.equal(st(s, 'b1').prepaymentCents, 8000 + 6 * 15000)
  assert.ok(s.notices.some((n) => n.code === 'tenancy.overlap' && n.level === 'error'))
})

test('Abrechnungszeitraum Mai bis April: Einzug am 15.04.2025, April 16 von 30 Tagen', () => {
  const MAI: PeriodRules = { startMonth: 5, changes: [] }
  const p = periodOfKey(MAI, periodKey('2024-05')) ?? assert.fail('kein Zeitraum')
  const r = computePrepaymentCents(tenancy({ start: '2025-04-15' }), p)
  assert.equal(r.cents, 8000)
  assert.deepEqual(r.partial, [{ month: '2025-04', days: 16, of: 30, cents: 8000, fullCents: 15000 }])
})

test('Abgeschlossene Abrechnung bleibt eingefroren, deviation zeigt 82,26 € zugunsten des Mieters', () => {
  // Der alte Stand ist nachgestellt: Die Staffel ab April ergab heute wie früher 9 × 150 €.
  const frozen = settle([tenancy({ start: '2025-03-15', prepayments: [{ from: '2025-04', monthlyCents: 15000 }] })])
  assert.equal(st(frozen).prepaymentCents, 135000)
  const current = settle([einzug])
  const cmp = compareWithFrozen(frozen, current, '2026-12-31', '2026-03-01')
  assert.equal(cmp.comparable, true)
  assert.deepEqual(cmp.deviations.map((d) => [d.tenancyId, d.direction, d.differenceCents]), [['m', 'tenant', 8226]])
})

test('Steuer: Soll der Vorauszahlungen im Mietkonto und Ansatz der Abrechnung stimmen überein (Einzug 15.03.)', () => {
  const r = taxReport(snapshotOf(source([einzug]), 2025))
  // Beide Mietverhältnisse: N zahlt das ganze Jahr 1.800 €.
  assert.equal(r.income.prepaymentSollCents, 143226 + 180000)
  assert.equal(r.income.prepaymentSettlementCents, 143226 + 180000)
  assert.equal(r.income.baseRentSollCents, 9 * 50000 + 27419 + 12 * 50000)
})

// Durchsicht #311, K3: Vor #311 abgeschlossen, bleibt der Ansatz eingefroren, das Soll ist heute
// anteilig. Die Steuerübersicht sagt deshalb, dass der Ansatz aus einer abgeschlossenen Abrechnung stammt.
test('Steuer bei abgeschlossener Abrechnung: Ansatz eingefroren, Soll anteilig, und das Kennzeichen dafür', () => {
  const closed = { period: periodKey('2025-01'), selfUsedShareCents: 0, prepaymentCents: 135000 + 180000, prepaymentOverridden: false }
  const r = taxReport(snapshotOf(source([einzug], { closedSettlements: [closed] }), 2025))
  assert.equal(r.income.prepaymentSettlementCents, 135000 + 180000)
  assert.equal(r.income.prepaymentSollCents, 143226 + 180000)
  assert.equal(r.income.prepaymentSettlementClosed, true)
  assert.equal(taxReport(snapshotOf(source([einzug]), 2025)).income.prepaymentSettlementClosed, undefined)
})

// ---------- Getrennte Heizkostenabrechnung (Weg d) und Heizstaffel ----------

type Source = Parameters<typeof snapshotFor>[0]
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const anlage = (separateSpans: SeparateSpan[]) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  energy: 'gas' as const, devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
  periodStartMonth: 5, periodChanges: [], separateSpans, separateSettlement: true,
})
const heizMieter = {
  id: 'm', unitId: 'u1', tenantName: 'M', persons: 1, personHistory: [{ from: '2025-03-15', persons: 1 }], start: '2025-03-15', end: null,
  prepayments: [{ from: '2025-03', monthlyCents: 9000 }], prepaymentOverrides: {}, baseRents: [],
  heatingPrepayments: [{ from: '2025-03', monthlyCents: 6000 }], heatingPrepaymentOverrides: [],
}
const haus = (separateSpans: SeparateSpan[]): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [heizMieter],
  costItems: [
    { id: 'H', propertyId: 'objekt-1', period: periodKey('2024-05'), category: HEATING_CATEGORY, description: 'Heizung', amountCents: 50000, key: 'area', heatingPlantId: 'hp1', taxYear: 2025 },
    { id: 'G', propertyId: 'objekt-1', period: periodKey('2025-01'), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' },
  ],
  meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage(separateSpans)],
} as Source)

test('Weg d: Einzug 15.03., März in der getrennten Heizperiode: je Staffel gerundet, 32,90 € und 49,35 €', () => {
  const src = haus([{ from: '2024-05', until: null }])
  const h = computeSettlement(heatingSnapshotFor(src, 'objekt-1', 'hp1', of(MAI, '2024-05')) ?? assert.fail('keine Anlage'))
  const hm = st(h)
  assert.equal(hm.prepaymentCents, 3290 + 6000) // März 17/31 × 60 € = 32,903… → 32,90 €, April voll
  const hn = h.notices.find((n) => n.code === 'prepayment.partial-month') ?? assert.fail('kein Hinweis in der Heizkostenabrechnung')
  assert.match(hn.text, /setzt Mietfuchs die Heizvorauszahlung anteilig nach Kalendertagen an, 17 von 31 Tagen: 32,90 € statt 60,00 €/)
  const p = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2025-01')))
  const pm = st(p)
  assert.equal(pm.prepaymentCents, 4935 + 9 * 9000) // März 17/31 × 90 € = 49,354… → 49,35 €
  const pn = p.notices.find((n) => n.code === 'prepayment.partial-month') ?? assert.fail('kein Hinweis in der Abrechnung')
  assert.match(pn.text, /17 von 31 Tagen: 49,35 € statt 90,00 €/)
  assert.match(pn.text, /Die anteilige Heizvorauszahlung für März 2025 \(32,90 € statt 60,00 €\) rechnet die Heizkostenabrechnung an\./)
})

test('Gemeinsame Abrechnung mit Heizstaffel: je Staffel gerundet, 82,25 € mit Heizanteil 32,90 €', () => {
  const src = haus([])
  const p = computeSettlement(snapshotFor(src, 'objekt-1', of(CALENDAR_RULES, '2025-01')))
  const pm = st(p)
  assert.equal(pm.heatingPrepaymentCents, 3290 + 9 * 6000)
  assert.equal(pm.prepaymentCents, 4935 + 9 * 9000 + 3290 + 9 * 6000)
  const pn = p.notices.find((n) => n.code === 'prepayment.partial-month') ?? assert.fail('kein Hinweis')
  assert.match(pn.text, /17 von 31 Tagen: 82,25 € statt 150,00 € \(davon Heizvorauszahlung 32,90 €\)/)
})

test('Lexikon „Angebrochener Monat“: Beispiele nachgerechnet, Auslegung und Alternative 1/30 genannt', () => {
  const t = GLOSSARY.partialMonth
  const rate = [{ from: '2025-01', monthlyCents: 15000 }]
  assert.equal(rateInMonth(rate, { start: '2025-03-15', end: null }, '2025-03'), 8226)
  assert.equal(rateInMonth(rate, { start: '2024-01-01', end: '2025-06-15' }, '2025-06'), 7500)
  assert.equal(rateInMonth(rate, { start: '2025-02-15', end: null }, '2025-02'), 7500)
  assert.equal(Math.round(15000 * 17 / 30), 8500)
  assert.equal(Math.round(15000 * 14 / 30), 7000)
  assert.match(t.example, /17 von 31 Tagen.*82,26 €.*15 von 30 Tagen.*75,00 €/s)
  assert.match(t.norm, /Auslegung von Mietfuchs/)
  assert.match(t.norm, /1\/30.*§ 191 BGB/s)
  assert.match(t.norm, /85,00 € statt 82,26 €.*70,00 € statt 75,00 €/s)
  assert.doesNotMatch(t.norm, /§ 556b/, '§ 556b regelt nur die Fälligkeit (R-3)')
  assert.match(GLOSSARY.prepayment.short, /tatsächlich geleistet/)
  assert.match(GLOSSARY.prepayment.norm, /VIII ZR 240\/10/)
})
