// Das Zugeflossene nach Zeilen der Anlage V (#312 PR 2, Entwurf docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md,
// E4 bis E11): `income.received` aus der Tilgung jeder Mietzahlung nach § 366 BGB (rentAllocation.ts, dieselbe wie im
// Mietkonto). Die Summe bleibt `paidCents` (§ 11 Abs. 1 Satz 1 EStG); neu ist nur, wie sie sich auf die Zeilen verteilt.
// Jede erwartete Zahl ist unten von Hand nachgerechnet. Invarianten über Zufallsbestände: invariant-steuer-zufluss.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taxReport, taxReportFor } from '../src/calc.ts'
import { snapshotFor, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarPeriod, calendarYearPeriod } from '../../shared/period.ts'
import type { PeriodRules, TaxReceived, TaxReport } from '../../shared/types.ts'
import type { TaxSource } from '../testing/taxStock.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { estgShortPeriodDays } from '../../shared/law/estg.ts'
import type { LawParam } from '../../shared/law/register.ts'
import { tenDayWindow } from '../../shared/paidOn.ts'
import { derivedTaxLines, incomeCsv, planTaxArchive } from '../src/taxReceipts.ts'

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
// Die drei Teilsummen der Zeilen 19, 22, 23 (seit der Durchsicht von PR 3 trägt `relatives` mehr).
const sums = (r: TaxReceived['relatives'] | undefined) => ({ rentCents: r?.rentCents, allocationsCents: r?.allocationsCents, settlementCents: r?.settlementCents })
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
  assert.deepEqual(sums(x.relatives), { rentCents: 0, allocationsCents: 0, settlementCents: 0 })
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

// Zehn-Tage-Regel (§ 11 Abs. 1 Satz 2 EStG; H 11 EStH: Zahlung **und** Fälligkeit in der kurzen Zeit; BFH, Urteil vom
// 16.02.2022, X R 2/21). Die Vorschrift ist zwingend. Unter § 556b Abs. 1 BGB (Mietverhältnisse ab 01.09.2001) ist die
// Januarmiete spätestens am dritten Werktag fällig, also in den zehn Tagen: Am 22. bis 31.12. für Januar Gezahltes zählt
// im Folgejahr. Für ältere Mietverhältnisse gilt § 551 BGB a. F. (Fälligkeit am Monatsende, Art. 229 § 3 Abs. 1 Nr. 7
// EGBGB): nicht verschoben, nur beziffert.
const alt = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => tenancy(id, unitId, {
  start: '1999-01-01', personHistory: [{ from: '1999-01-01', persons: 1 }], prepayments: [{ from: '1999-01', monthlyCents: 20000 }], baseRents: [{ from: '1999-01', monthlyCents: 60000 }], ...over,
})

test('Zehn-Tage-Regel vorwärts (§ 556b BGB): am 28.12.2025 gezahlte Januarmiete zählt 2026 in Zeile 15/20, nicht 2025', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000), ...monthly('t', '2026-02', '2026-12', 80000)])
  const r25 = taxReportFor(s, 'objekt-1', 2025)
  const y25 = r25.income.received ?? assert.fail('received fehlt')
  assert.deepEqual(y25.turnOfYear, { forwardCents: 80000, forwardAllocationsCents: 20000, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 0, lateDecemberCents: 0 })
  assert.equal(r25.income.paidCents, 13 * 80000, 'der Zufluss nach Datum bleibt')
  assert.equal(y25.rentCents, 12 * 60000, 'die Januarmiete steht im Folgejahr')
  assert.equal(y25.allocationsCents, 12 * 20000)
  assert.equal(y25.byTenancy[0]?.forwardCents, 80000)
  const r26 = taxReportFor(s, 'objekt-1', 2026)
  const y26 = r26.income.received ?? assert.fail('received fehlt')
  assert.equal(y26.turnOfYear.fromPreviousCents, 80000)
  assert.equal(y26.turnOfYear.fromPreviousAllocationsCents, 20000)
  assert.equal(y26.turnOfYear.forwardCents, 0)
  assert.equal(y26.rentCents, 12 * 60000, 'Januar (aus dem Dezember) und Februar bis Dezember')
  assert.equal(y26.allocationsCents, 12 * 20000)
  assert.equal(r26.income.paidCents, 11 * 80000)
  // Der 21.12. liegt elf Tage vor dem Jahreswechsel: keine kurze Zeit mehr, die Zahlung bleibt 2025.
  const früh = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-21', 80000)])
  assert.equal(received(früh, 2025).turnOfYear.forwardCents, 0)
  assert.equal(received(früh, 2025).rentCents, 13 * 60000)
  assert.equal(received(früh, 2026).turnOfYear.fromPreviousCents, 0)
})

test('Zehn-Tage-Regel vorwärts, Mietverhältnis von 1999 (§ 551 BGB a. F.): bleibt 2025, nur beziffert', () => {
  const s = source([alt('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000)])
  const y25 = received(s, 2025)
  assert.deepEqual(y25.turnOfYear, { forwardCents: 0, forwardAllocationsCents: 0, fromPreviousCents: 0, fromPreviousAllocationsCents: 0, forwardOldLeaseCents: 80000, lateDecemberCents: 0 })
  assert.equal(y25.rentCents, 13 * 60000)
  assert.equal(received(s, 2026).turnOfYear.fromPreviousCents, 0)
  // Maßgeblich ist der Bestand am 01.09.2001: ein Vertrag vom August 2001 mit Beginn im Oktober ist alt.
  const august = tenancy('t', 'eg', { start: '2001-10-01', contractDate: '2001-08-15' })
  assert.equal(received(source([august], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000)]), 2025).turnOfYear.forwardOldLeaseCents, 80000)
})

test('Dezembermiete am 05.01.2026 (Beginn 2024): Zeile 25 in 2026, lateDecemberCents 0, denn sie war Anfang Dezember fällig', () => {
  const t = tenancy('t', 'eg', { end: '2025-12-31' })
  const s = source([t], [...monthly('t', '2025-01', '2025-11', 80000), pay('t', '2026-01-05', 80000)])
  const r = taxReportFor(s, 'objekt-1', 2026)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(r.income.paidCents, 80000)
  assert.equal(x.formerYearsCents, 80000)
  assert.equal(x.turnOfYear.lateDecemberCents, 0)
  // Ohne Zeile im Mietkonto 2026 steht das Mietverhältnis trotzdem da (E1).
  assert.deepEqual(x.byTenancy.map((b) => [b.tenancyId, b.start, b.end, b.formerYearsCents]), [['t', '2024-01-01', '2025-12-31', 80000]])
})

test('Dezembermiete am 05.01.2026 (Beginn 1999): Zeile 25 in 2026, beziffert als lateDecemberCents; am 11.01. nicht mehr', () => {
  const t = alt('t', 'eg', { end: '2025-12-31' })
  const s = source([t], [...monthly('t', '2025-01', '2025-11', 80000), pay('t', '2026-01-05', 80000)])
  const x = received(s, 2026)
  assert.equal(x.formerYearsCents, 80000)
  assert.equal(x.turnOfYear.lateDecemberCents, 80000)
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
  assert.deepEqual(sums(x.relatives), { rentCents: 720000, allocationsCents: 240000, settlementCents: -5000 })
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
  const { surplusReceivedCents: __, ...mitRest } = mit
  assert.deepEqual({ ...mitRest, income: rest }, ohne)
  const snap = snapshotFor(s, 'objekt-1', calendarYearPeriod(2025))
  assert.equal('received' in taxReport(snap, undefined, { received: false }).income, false)
})

// Durchsicht S1: Zeilen 19, 22 und 23 fragen wie Kennzahl 62 nach Vermietung an Angehörige zu Wohnzwecken. Eine Garage
// an die Tochter (0 Personen, #135) ist keine; dieselbe Lesart wie `costModels.relativeTenancies` (#489, K3).
test('Angehörige ohne Bewohner (Garage): keine Teilsummen für die Zeilen 19, 22, 23, wie bei Kennzahl 62', () => {
  const garage = tenancy('garage', 'og', { relative: true, persons: 0, personHistory: [{ from: '2024-01-01', persons: 0 }] })
  const s = source([garage, tenancy('fremd', 'eg')], [...monthly('garage', '2025-01', '2025-12', 80000), ...monthly('fremd', '2025-01', '2025-12', 80000)])
  const r = taxReportFor(s, 'objekt-1', 2025)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.deepEqual(sums(x.relatives), { rentCents: 0, allocationsCents: 0, settlementCents: 0 })
  assert.equal(x.byTenancy.find((b) => b.tenancyId === 'garage')?.relative, false)
  assert.equal('relativeTenancies' in r.costModels, false)
})

// Eine Angehörige, die 2024 ausgezogen ist, zahlt 2025 die Nachzahlung: Zeile 23 (ihr Mietverhältnis war eines zu
// Wohnzwecken), auch ohne Tag im Jahr.
test('Angehörige nach Auszug: die Nachzahlung im Folgejahr gehört zu Zeile 23', () => {
  const tochter = tenancy('tochter', 'eg', { relative: true, end: '2024-12-31' })
  const s = source([tochter], [...monthly('tochter', '2024-01', '2024-12', 80000), pay('tochter', '2025-04-10', 9000, { kind: 'settlement' })])
  assert.deepEqual(sums(received(s, 2025).relatives), { rentCents: 0, allocationsCents: 0, settlementCents: 9000 })
})

// Durchsicht S2: Warmmiete inklusiv (Heizung in der Miete, Nebenkosten abgerechnet) mit Heizposition im Jahr: Die
// Kaltmiete schließt Nebenkosten ein und steht eigens da; an Zeile 15 ändert sich nichts.
test('Warmmiete inklusiv: inclusiveRentCents = gezahlte Kaltmiete, rentCents unverändert', () => {
  const heizung = { id: 'heiz', propertyId: 'objekt-1', period: calendarPeriod(2025), category: HEATING_CATEGORY, description: 'Heizöl', amountCents: 200000, key: 'area' as const }
  const warm = { ...source([tenancy('t', 'eg', { heatingModel: 'inclusive' })], monthly('t', '2025-01', '2025-12', 80000)), costItems: [heizung] } as TaxSource
  const kalt = { ...source([tenancy('t', 'eg')], monthly('t', '2025-01', '2025-12', 80000)), costItems: [heizung] } as TaxSource
  const x = received(warm, 2025)
  assert.equal(x.inclusiveRentCents, 720000)
  assert.equal(x.rentCents, received(kalt, 2025).rentCents)
  assert.equal(x.rentCents, 720000)
  assert.equal(received(kalt, 2025).inclusiveRentCents, 0)
})

// Durchsicht K2: Beginn mitten im Monat. Der angebrochene erste Monat ist mit der Kaution oft noch offen; dass die Zahlung
// ihn deckt, ist kein Zeichen einer Nachzahlung.
test('Kaution bei Beginn am 15.02., als Miete am 05.03. erfasst: Hinweis, obwohl sie den anteiligen Februar deckt', () => {
  const t = tenancy('t', 'eg', { start: '2025-02-15', depositCents: 180000, prepayments: [{ from: '2025-02', monthlyCents: 20000 }], baseRents: [{ from: '2025-02', monthlyCents: 60000 }] })
  const nachbarin = tenancy('n', 'og', { start: '2025-01-01' })
  const s = source([t, nachbarin], [pay('n', '2025-01-03', 80000), pay('t', '2025-03-05', 180000)])
  assert.deepEqual(received(s, 2025).possibleDeposits, [{ tenancyId: 't', tenantName: 'Mieter t', paidOn: '2025-03-05', cents: 180000 }])
})

// Durchsicht K5: `estg.short-period-days` hat die Zeitregel `periodStart`. Gefragt wird die Fassung des Kalenderjahres, zu
// dem die Zahlung wirtschaftlich gehört: für den 22. bis 31.12. das Folgejahr, für Anfang Januar das Vorjahr. Geprüft
// mit einer gedachten zweiten Fassung (ab 2026 fünf Tage).
test('Zehn-Tage-Fenster am Zahlungsdatum: die Fassung des Jahres, zu dem die Zahlung gehört (gedachte zweite Fassung)', () => {
  const v0 = estgShortPeriodDays.versions[0] ?? assert.fail('keine Fassung')
  const probe: LawParam<number, 'periodStart'> = { ...estgShortPeriodDays, versions: [{ ...v0, validTo: '2025-12-31' }, { ...v0, validFrom: '2026-01-01', value: 5 }] }
  // Dezember 2025 gehört zu 2026: fünf Tage, ab 27.12.
  assert.equal(tenDayWindow('2025-12-24', 'Müllabfuhr', probe), false)
  assert.equal(tenDayWindow('2025-12-27', 'Müllabfuhr', probe), true)
  // Anfang Januar 2026 gehört zu 2025: zehn Tage, bis 10.01.
  assert.equal(tenDayWindow('2026-01-08', 'Müllabfuhr', probe), true)
  assert.equal(tenDayWindow('2026-01-11', 'Müllabfuhr', probe), false)
  // Januar 2027 gehört zu 2026: fünf Tage.
  assert.equal(tenDayWindow('2027-01-06', 'Müllabfuhr', probe), false)
  assert.equal(tenDayWindow('2027-01-05', 'Müllabfuhr', probe), true)
})

// Nachdurchsicht M1: Verschoben wird nur, wenn der Januar-Abschnitt in der kurzen Zeit fällig ist. Beginnt das
// Mietverhältnis am 15.01., ist die erste Miete frühestens am 15.01. fällig (§ 556b Abs. 1 BGB: zu Beginn des
// Zeitabschnitts, spätestens am dritten Werktag), also nach dem 10.01.: Die Zahlung vom 28.12. bleibt im Jahr der Zahlung.
test('Zehn-Tage-Regel: Beginn am 15.01.2026, Zahlung am 28.12.2025 bleibt 2025; Beginn 01.01. wird verschoben', () => {
  const t = tenancy('t', 'eg', { start: '2026-01-15', personHistory: [{ from: '2026-01-15', persons: 1 }], prepayments: [{ from: '2026-01', monthlyCents: 20000 }], baseRents: [{ from: '2026-01', monthlyCents: 60000 }] })
  const s = source([t], [pay('t', '2025-12-28', 80000)])
  const r25 = taxReportFor(s, 'objekt-1', 2025)
  const y25 = r25.income.received ?? assert.fail('received fehlt')
  assert.equal(y25.turnOfYear.forwardCents, 0)
  assert.equal(y25.rentCents + y25.allocationsCents + y25.formerYearsCents, r25.income.paidCents)
  assert.equal(received(s, 2026).turnOfYear.fromPreviousCents, 0)
  const jan = tenancy('t', 'eg', { start: '2026-01-01', personHistory: [{ from: '2026-01-01', persons: 1 }], prepayments: [{ from: '2026-01', monthlyCents: 20000 }], baseRents: [{ from: '2026-01', monthlyCents: 60000 }] })
  const s1 = source([jan], [pay('t', '2025-12-28', 80000)])
  assert.equal(received(s1, 2025).turnOfYear.forwardCents, 80000)
  assert.equal(received(s1, 2026).turnOfYear.fromPreviousCents, 80000)
  // Bekannte Grenze: Beginn am 05.01. Ob der dritte Werktag ab Beginn bis zum 10.01. reicht, hängt an den Feiertagen des
  // Landes, mit denen der Server noch nicht rechnen darf (#290); im Zweifel bleibt die Zahlung im Jahr ihres Datums.
  const fünf = tenancy('t', 'eg', { start: '2026-01-05', personHistory: [{ from: '2026-01-05', persons: 1 }], prepayments: [{ from: '2026-01', monthlyCents: 20000 }], baseRents: [{ from: '2026-01', monthlyCents: 60000 }] })
  assert.equal(received(source([fünf], [pay('t', '2025-12-28', 80000)]), 2025).turnOfYear.forwardCents, 0)
})

// Nachdurchsicht S1: Eine Rücknahme folgt der zurückgenommenen Zahlung. Sonde F: Dezember bezahlt, 15.12. +800 € für
// Januar (außerhalb der kurzen Zeit, bleibt 2025), 29.12. −800 € nimmt genau diese Zuordnung zurück, 03.01. +800 €.
test('Zehn-Tage-Regel: eine Rücklastschrift in der kurzen Zeit folgt der zurückgenommenen Zahlung (Sonden F, E, L)', () => {
  const base = monthly('t', '2025-01', '2025-12', 80000)
  const lines = (r: TaxReport): number => {
    const x = r.income.received ?? assert.fail('received fehlt')
    return x.rentCents + x.allocationsCents + x.formerYearsCents + settlementSaldo(r)
  }
  const f = source([tenancy('t', 'eg')], [...base, pay('t', '2025-12-15', 80000), pay('t', '2025-12-29', -80000), pay('t', '2026-01-03', 80000)])
  assert.equal(lines(taxReportFor(f, 'objekt-1', 2025)), 960000)
  assert.equal(lines(taxReportFor(f, 'objekt-1', 2026)), 80000)
  // E: 28.12. +800 € (verschoben), Rücklastschrift am 05.01.: beides 2026, netto 0.
  const e = source([tenancy('t', 'eg')], [...base, pay('t', '2025-12-28', 80000), pay('t', '2026-01-05', -80000)])
  assert.equal(lines(taxReportFor(e, 'objekt-1', 2025)), 960000)
  assert.equal(lines(taxReportFor(e, 'objekt-1', 2026)), 0)
  // L: 28.12. +800 €, Rücklastschrift am 30.12.: beide verschoben, netto 0 in beiden Jahren über den Dezember hinaus.
  const l = source([tenancy('t', 'eg')], [...base, pay('t', '2025-12-28', 80000), pay('t', '2025-12-30', -80000)])
  assert.equal(lines(taxReportFor(l, 'objekt-1', 2025)), 960000)
  assert.equal(lines(taxReportFor(l, 'objekt-1', 2026)), 0)
})

// Nachdurchsicht K1, Sonde M: Angehörige, ab 2025 ohne Bewohner (Personen 0). Im Jahr des Mietverhältnisses zählt das
// Jahr: Zeilen 19/22 und Kennzahl 62 passen zusammen.
test('Angehörige, ab 2025 ohne Bewohner: 2025 weder Zeile 19/22 noch Kennzahl 62, 2024 beides', () => {
  const t = tenancy('t', 'eg', { relative: true, personHistory: [{ from: '2024-01-01', persons: 1 }, { from: '2025-01-01', persons: 0 }] })
  const s = source([t], [...monthly('t', '2024-01', '2024-12', 80000), ...monthly('t', '2025-01', '2025-12', 80000)])
  const r25 = taxReportFor(s, 'objekt-1', 2025)
  assert.deepEqual(sums(r25.income.received?.relatives), { rentCents: 0, allocationsCents: 0, settlementCents: 0 })
  assert.equal('relativeTenancies' in r25.costModels, false)
  const r24 = taxReportFor(s, 'objekt-1', 2024)
  assert.equal(r24.income.received?.relatives.rentCents, 720000)
  assert.equal(r24.costModels.relativeTenancies, 1)
})

// Durchsicht von #312 PR 3, S1: eine Quelle für die maßgebliche Summe. `received.totalCents` ist Zeile 32 (Zufluss nach
// Datum, um die Zehn-Tage-Regel berichtigt), `surplusReceivedCents` der Überschuss daraus; beide nur mit `received`.
test('Zeile 32 und Überschuss aus dem Server: totalCents = paidCents − forward + fromPrevious, surplusReceivedCents passend', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000), ...monthly('t', '2026-02', '2026-12', 80000)])
  for (const year of [2025, 2026]) {
    const r = taxReportFor(s, 'objekt-1', year)
    const x = r.income.received ?? assert.fail('received fehlt')
    assert.equal(x.totalCents, r.income.paidCents - x.turnOfYear.forwardCents + x.turnOfYear.fromPreviousCents, String(year))
    assert.equal(r.surplusReceivedCents, r.surplusPaidCents - x.turnOfYear.forwardCents + x.turnOfYear.fromPreviousCents, String(year))
  }
  assert.equal(received(s, 2025).totalCents, 12 * 80000)
  assert.equal(received(s, 2026).totalCents, 12 * 80000)
  // je Mietverhältnis: aus dem Vorjahr hierher
  assert.equal(received(s, 2026).byTenancy[0]?.fromPreviousCents, 80000)
  assert.equal(received(s, 2025).byTenancy[0]?.fromPreviousCents, 0)
  const ohne = taxReportFor(s, 'objekt-1', 2025, undefined, { received: false })
  assert.equal(ohne.surplusReceivedCents, undefined)
})

// S4: die „davon“-Zeilen der Nicht-Angehörigen brauchen Pauschale, Inklusivmiete und Soll der Angehörigen vom Server.
test('Angehörige: Pauschale, Inklusivmiete, Überzahlung und Soll je Teilsumme; Pauschale auch je Mietverhältnis', () => {
  const flat = { costModel: 'flatRate' as const, prepayments: [], flatRates: [{ from: '2024-01', monthlyCents: 10000 }], baseRents: [{ from: '2024-01', monthlyCents: 50000 }] }
  const s = source([tenancy('tochter', 'eg', { relative: true, end: '2025-12-31', ...flat }), tenancy('fremd', 'og')], [
    ...monthly('tochter', '2025-01', '2025-12', 60000), pay('tochter', '2025-12-20', 5000),
    ...monthly('fremd', '2025-01', '2025-12', 80000),
  ])
  const r = taxReportFor(s, 'objekt-1', 2025)
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(x.flatRateCents, 120000)
  assert.deepEqual(x.byTenancy.map((b) => [b.tenancyId, b.flatRateCents]), [['tochter', 120000], ['fremd', 0]])
  // 12 × 500 Kalt und die Überzahlung von 50 € (ohne Forderung, Zeile 19), 12 × 100 Pauschale; Soll ohne Überzahlung.
  assert.deepEqual(x.relatives, {
    rentCents: 605000, allocationsCents: 120000, settlementCents: 0, inclusiveRentCents: 0, unallocatedCents: 5000, flatRateCents: 120000,
    sollRentCents: 600000, sollInclusiveRentCents: 0, sollAllocationsCents: 120000, sollFlatRateCents: 120000,
  })
  assert.equal(r.income.baseRentSollCents, 600000 + 720000)
  assert.equal(r.income.flatRateSollCents, 120000)
})

// S1/S5: Eine Mietzahlung an ein Mietverhältnis, das der Schnappschuss nicht führt, steht gesondert, damit die Zeilen je
// Mietverhältnis plus dieser Betrag die Summe ergeben.
test('Zahlung ohne Mietverhältnis im Schnappschuss: als unassignedCents gesondert', () => {
  const s = source([tenancy('t', 'eg')], monthly('t', '2025-01', '2025-12', 80000))
  const snap = snapshotFor(s, 'objekt-1', calendarYearPeriod(2025))
  const r = taxReport({ ...snap, payments: [...snap.payments, pay('fremd', '2025-04-01', 12345)] })
  const x = r.income.received ?? assert.fail('received fehlt')
  assert.equal(x.unassignedCents, 12345)
  assert.equal(received(s, 2025).unassignedCents, 0)
})

// Umstellung auf #503 (#262 PR 2): Verteilung nach § 82b EStDV ab 2026 und die am 28.12.2025 gezahlte Januarmiete
// zusammen. Der Überschuss aus Zeile 32 zieht die abziehbaren Werbungskosten nach den Raten ab, Einnahmen.csv ergibt Zeile 32,
// und die Übersicht.csv (mit der Spalte „verteilt“) ergibt die abziehbaren Werbungskosten desselben Jahres.
test('Zehn-Tage-Regel und § 82b zusammen: surplusReceivedCents = totalCents − deductibleCents, beide CSV passen', () => {
  const s = source([tenancy('t', 'eg')], [...monthly('t', '2025-01', '2025-12', 80000), pay('t', '2025-12-28', 80000), ...monthly('t', '2026-02', '2026-12', 80000)])
  s.costItems = [{ id: 'dach', propertyId: 'objekt-1', period: calendarPeriod(2026), category: 'Nicht umlagefähig', description: 'Dach', amountCents: 900000, key: 'area', spreadYears: 3 }] as TaxSource['costItems']
  const cents = (v: string | undefined) => Math.round(Number((v ?? '').replace(',', '.')) * 100)
  let spread = 0
  for (const year of [2025, 2026, 2027]) {
    const r = taxReportFor(s, 'objekt-1', year)
    const x = r.income.received ?? assert.fail('received fehlt')
    assert.equal(r.surplusReceivedCents, x.totalCents - r.expenses.deductibleCents, String(year))
    if ((r.expenses.deferredCents ?? 0) !== 0) spread++
    const einnahmen = incomeCsv(r).replace(/^﻿/, '').trim().split('\r\n').at(-1)?.split(';') ?? []
    assert.equal(cents(einnahmen[12]), x.totalCents, `${year}: Einnahmen.csv = Zeile 32`)
    const split = new Map(r.expenses.items.map((i) => [i.costItemId, i]))
    const items = s.costItems.filter((c) => r.expenses.items.some((i) => i.costItemId === c.id))
    const lines = planTaxArchive(items, new Map(), new Map(), split, derivedTaxLines(r)).overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
    const head = (lines[0] ?? '').split(';')
    const col = head.indexOf('abziehbar (EUR)')
    assert.equal(lines.slice(1).reduce((a, z) => a + cents(z.split(';')[col]), 0), r.expenses.deductibleCents, `${year}: Übersicht.csv = abziehbar`)
  }
  assert.equal(received(s, 2026).turnOfYear.fromPreviousCents, 80000)
  assert.ok(spread > 0, 'Verteilung wirkt nicht')
  // 2026: 12 × 800 € Einnahmen (Januar aus dem Dezember), abziehbar nur die erste Rate.
  const r26 = taxReportFor(s, 'objekt-1', 2026)
  assert.equal(r26.income.received?.totalCents, 12 * 80000)
  assert.ok(r26.expenses.deductibleCents < 900000)
})
