// CO₂-Erstattung an Mieter, die selbst heizen, in der Abrechnung (Heizung PR 19, #97; Entwurf 6.4 Nr. 3, 10.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, recurringShareCents, rentLedger, taxReport, type ComputedSettlement } from '../src/calc.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
import { snapshotFor, snapshotOf, type Snapshot, type SnapshotSource, type SnapshotTenancy } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import type { Co2Refund } from '../../shared/types.ts'

const refund = (over: Partial<Co2Refund> = {}): Co2Refund => ({
  id: 'e1', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 5000, settlePeriod: periodKey('2025-01'), paidOutOn: null,
  billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false, commercialUse: false,
  commercialMetered: false, nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null, ...over,
})
const mieter = (over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, heatingModel: 'selfSupply',
  prepayments: [{ from: '2020-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 90000 }], ...over,
})
// Eine Wohnung mit 80 m², Mieter seit 2020 mit 100 € Vorauszahlung, Grundsteuer 600 €; Miete 1.000 € je Monat,
// im Dezember wegen der Verrechnung nur 950 € gezahlt (G-B10).
const source = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [{ id: 'w', name: 'EG', areaM2: 80, participates: true }],
  tenancies: [mieter()],
  costItems: [{ id: 'gs', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area' }],
  meters: [], readings: [],
  payments: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, tenancyId: 't', date: `2025-${String(i + 1).padStart(2, '0')}-01`, amountCents: i === 11 ? 95000 : 100000 })),
  closedSettlements: [],
  ...over,
})
const snap = (refunds: Co2Refund[], sent: { period: string; sentAt: string | null }[] = [], over: Partial<SnapshotSource> = {}): Snapshot => ({
  ...snapshotOf(source(over), 2025),
  ...(refunds.length > 0 ? { co2Refunds: refunds, settlementsSent: sent.map((x) => ({ period: periodKey(x.period), sentAt: x.sentAt })) } : {}),
})
const statementOf = (r: ComputedSettlement) => r.statements.find((s) => s.tenancyId === 't') ?? assert.fail('kein Statement')
const codes = (r: ComputedSettlement) => r.notices.map((n) => n.code)
const textOf = (r: ComputedSettlement, code: string): string => r.notices.find((n) => n.code === code)?.text ?? assert.fail(`kein Hinweis ${code}: ${codes(r).join(', ')}`)
const VERSANDT_2024 = [{ period: '2024-01', sentAt: '2025-02-15' }]

test('Verrechnet: Gutschriftzeile beim Mieter, Gegenzeile beim Vermieter, Σ der Zeilen bleibt Σ der Positionen', () => {
  const r = computeSettlement(snap([refund()], VERSANDT_2024))
  const st = statementOf(r)
  const zeile = st.rows.find((row) => row.kind === 'co2Refund') ?? assert.fail('keine Gutschriftzeile')
  assert.deepEqual([zeile.costItemId, zeile.shareCents, zeile.category, zeile.description], ['co2refund:e1', -5000, 'CO₂-Erstattung', 'CO₂-Erstattung bei eigener Heizung (§ 6 Abs. 2 CO2KostAufG)'])
  assert.equal(st.totalShareCents, 55000)
  assert.equal(st.balanceCents, 120000 - 55000)
  const gegen = r.landlord.rows.find((row) => row.costItemId === 'co2refund:e1') ?? assert.fail('keine Gegenzeile')
  assert.deepEqual(gegen.landlordParts, [{ reason: 'co2Refund', cents: 5000 }])
  const summe = r.statements.reduce((a, s) => a + s.rows.reduce((b, row) => b + row.shareCents, 0), 0) + r.landlord.rows.reduce((a, row) => a + row.shareCents, 0)
  assert.equal(summe, 60000)
  assert.equal(r.totalCostsCents, 60000)
  assert.equal(r.selfUsedShareCents, 0)
  assert.ok(!codes(r).some((c) => c.startsWith('co2.refund')), codes(r).join())
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.self-supply'))
})

test('Review Focus 3: der Vorschlag nach § 560 Abs. 4 BGB bleibt ohne die Erstattung', () => {
  const ohne = statementOf(computeSettlement(snap([])))
  const mit = statementOf(computeSettlement(snap([refund()], VERSANDT_2024)))
  assert.equal(mit.suggestedMonthlyCents, ohne.suggestedMonthlyCents)
  assert.equal(recurringShareCents(mit), 60000)
})

test('Review Focus 1 (G-B10): Die Steuer liest nur die Zahlungen; 950 € statt 1.000 € senkt das Ist um 50 €, nicht um 100 €', () => {
  const mit = taxReport(snap([refund()], VERSANDT_2024))
  const ohne = taxReport(snap([]))
  assert.equal(mit.income.paidCents, 11 * 100000 + 95000)
  assert.equal(mit.income.paidCents, ohne.income.paidCents)
  assert.deepEqual(mit.expenses, ohne.expenses)
  assert.equal(mit.income.prepaymentSettlementCents, ohne.income.prepaymentSettlementCents)
})

test('co2.refund-late: Anzeige mehr als zwölf Monate nach der Abrechnung des Lieferanten', () => {
  const r = computeSettlement(snap([refund({ supplierBilledAt: '2023-11-01', claimedAt: '2025-03-01' })], VERSANDT_2024))
  assert.match(textOf(r, 'co2.refund-late'), /endete am 01\.11\.2024/)
  // Prüfung K2: Ausschlussfrist nach der Begründung.
  assert.match(textOf(r, 'co2.refund-late'), /Ausschlussfrist \(BT-Drs\. 20\/3172, S\. 34, damals noch mit sechs Monaten\)/)
  assert.equal(r.notices.find((n) => n.code === 'co2.refund-late')?.level, 'hint')
})

test('co2.refund-not-next: Die Abrechnung 2024 war bei der Anzeige noch offen; ohne vereinbarte Vorauszahlung kein Verrechnen', () => {
  assert.match(textOf(computeSettlement(snap([refund()])), 'co2.refund-not-next'), /die für 2024/)
  const ohneVZ = computeSettlement(snap([refund()], VERSANDT_2024, { tenancies: [mieter({ prepayments: [] })] }))
  assert.match(textOf(ohneVZ, 'co2.refund-not-next'), /keine Vorauszahlung/)
  assert.ok(!textOf(computeSettlement(snap([refund()])), 'co2.refund-not-next').includes('keine Vorauszahlung'))
})

test('co2.refund-differs: eingetragener Betrag weicht von der Nachrechnung ab', () => {
  // 2.400 kg auf 80 m², 600 € → nachgerechnet 240,00 €; eingetragen 50,00 €.
  const grundlagen = { emissionsKg: 2400, co2CostCents: 60000, areaM2: 80 }
  const r = computeSettlement(snap([refund(grundlagen)], VERSANDT_2024))
  const n = r.notices.find((x) => x.code === 'co2.refund-differs') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /50,00 €.*240,00 €/)
  assert.ok(!codes(computeSettlement(snap([refund({ ...grundlagen, amountCents: 24000 })], VERSANDT_2024))).includes('co2.refund-differs'))
  assert.ok(!codes(computeSettlement(snap([refund()], VERSANDT_2024))).includes('co2.refund-differs'))
  // Der Rechenweg der Zeile nennt die Nachrechnung.
  const zeile = statementOf(r).rows.find((x) => x.kind === 'co2Refund')
  assert.deepEqual(zeile?.steps?.map((s) => s.label), ['CO₂-Ausstoß je m² und Jahr', 'Anteil des Vermieters', 'CO₂-Kosten des Vermieters', 'Nachgerechnet', 'Betrag laut Anzeige'])
})

test('Review Focus 4: co2.refund-due in jeder Abrechnung ab der Fälligkeit, bis verrechnet oder ausgezahlt', () => {
  const offen = refund({ claimedAt: '2024-02-10', supplierBilledAt: '2024-01-15', settlePeriod: null })
  const r = computeSettlement(snap([offen]))
  const n = r.notices.find((x) => x.code === 'co2.refund-due') ?? assert.fail('keine Warnung')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /spätestens am 10\.02\.2025/)
  assert.ok(!codes(computeSettlement(snap([{ ...offen, paidOutOn: '2025-01-15' }]))).includes('co2.refund-due'))
  assert.ok(!codes(computeSettlement(snap([refund({ settlePeriod: null })]))).includes('co2.refund-due'), 'erst am 01.03.2026 fällig')
  // Prüfung S4: im Nichtwohngebäude mit der Begründung des Gesetzes.
  const gewerbe = computeSettlement(snap([{ ...offen, nonResidential: true }]))
  assert.match(textOf(gewerbe, 'co2.refund-due'), /§ 8 Abs\. 2 verweist auf § 6 Abs\. 2 Satz 2 bis 4, und seit dem 29\.07\.2026 steht die Frist in Satz 5\. Nach der Begründung des Gesetzes sollen dieselben Fristen gelten \(BT-Drs\. 20\/3172, S\. 37\); Mietfuchs warnt deshalb\./)
})

test('Prüfung M4: eine Erstattung an einem Mietverhältnis ohne „Mieter heizt selbst“ wird nicht verrechnet, mit Fehler', () => {
  const r = computeSettlement(snap([refund()], VERSANDT_2024, { tenancies: [mieter({ heatingModel: undefined })] }))
  const n = r.notices.find((x) => x.code === 'co2.refund-not-self') ?? assert.fail(codes(r).join(', '))
  assert.equal(n.level, 'error')
  assert.ok(!statementOf(r).rows.some((x) => x.kind === 'co2Refund'))
  assert.equal(statementOf(r).totalShareCents, 60000)
})

test('Wer nichts einstellt, merkt nichts: ohne Erstattung kein Wert co2.self-supply und kein Feld im Schnappschuss', () => {
  const r = computeSettlement(snap([]))
  assert.ok(!(r.legalBasis.values ?? []).some((v) => v.id === 'co2.self-supply'))
  const P = periodOfKey(CALENDAR_RULES, periodKey('2025-01')) ?? assert.fail('kein Zeitraum')
  const scoped = { ...source(), meters: [], units: source().units.map((u) => ({ ...u, propertyId: 'objekt-1' })), costItems: source().costItems.map((c) => ({ ...c, propertyId: 'objekt-1' })), closedSettlements: [] }
  assert.ok(!('co2Refunds' in snapshotFor(scoped, 'objekt-1', P)))
  const mit = snapshotFor({ ...scoped, co2Refunds: [refund(), refund({ id: 'fremd', tenancyId: 'anderes' })] }, 'objekt-1', P)
  assert.deepEqual(mit.co2Refunds?.map((x) => x.id), ['e1'])
})

test('Durchsicht S-1: ausgezahlt heißt Werbungskosten im Jahr der Auszahlung, ohne negative Zahlung und ohne Rückstand im Mietkonto', () => {
  // Alle zwölf Mieten voll gezahlt; die Erstattung von 50 € am 01.06.2025 ausgezahlt, nicht verrechnet.
  const voll = { payments: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, tenancyId: 't', date: `2025-${String(i + 1).padStart(2, '0')}-01`, amountCents: 100000 })) }
  const ausgezahlt = refund({ settlePeriod: null, paidOutOn: '2025-06-01' })
  const mit = taxReport(snap([ausgezahlt], [], voll))
  const ohne = taxReport(snap([], [], voll))
  assert.equal(mit.expenses.deductibleCents - ohne.expenses.deductibleCents, 5000)
  assert.equal(mit.expenses.totalCents - ohne.expenses.totalCents, 5000)
  const zeile = mit.expenses.groups.flatMap((g) => g.categories).find((c) => c.category === 'CO₂-Erstattung an Mieter (§ 6 Abs. 2 CO2KostAufG)') ?? assert.fail('keine Zeile')
  assert.deepEqual([zeile.amountCents, zeile.privateCents, zeile.deductibleCents], [5000, 0, 5000])
  assert.equal(mit.income.paidCents, 12 * 100000, 'die Einnahmen bleiben die Mieten')
  // Mietkonto: kein Rückstand, kein Saldo.
  const konto = rentLedger(snap([ausgezahlt], [], voll))
  const row = konto.rows.find((r) => r.tenancyId === 't') ?? assert.fail('keine Zeile')
  assert.deepEqual([row.arrearsCents, row.balanceCents], [0, 0])
  // Im Folgejahr ausgezahlt: nicht in 2025. Verrechnet: nicht doppelt, sie wirkt über die Abrechnung.
  assert.equal(taxReport(snap([refund({ settlePeriod: null, paidOutOn: '2026-01-10' })], [], voll)).expenses.deductibleCents, ohne.expenses.deductibleCents)
  assert.equal(taxReport(snap([refund()], VERSANDT_2024, voll)).expenses.deductibleCents, ohne.expenses.deductibleCents)
  // Die Texte raten nicht mehr zur negativen Zahlung.
  const due = computeSettlement(snap([refund({ claimedAt: '2024-02-10', supplierBilledAt: '2024-01-15', settlePeriod: null })]))
  assert.ok(!/negative Zahlung/.test(textOf(due, 'co2.refund-due')), textOf(due, 'co2.refund-due'))
  assert.match(textOf(due, 'co2.refund-due'), /tragen Sie den Tag der Auszahlung an der Erstattung ein; die Steuerübersicht führt sie dann im Jahr der Auszahlung als Werbungskosten/)
  assert.ok(!/negative Zahlung/.test(GLOSSARY.co2Refund.needed))
})

// Nachprüfung N-4 zu PR 19: Die ausgezahlte Erstattung ist eine Zeile der Aufstellung je Position (`expenses.items`),
// damit deren Summe die Werbungskosten ergibt, auf der Seite wie in der Übersicht der „Belege für die Steuer“.
test('N-4: ausgezahlte Erstattung als Zeile der Aufstellung, direkt vermietet, ganz abziehbar; Summe der Zeilen = Werbungskosten', () => {
  const r = taxReport(snap([refund({ settlePeriod: null, paidOutOn: '2025-06-01' })]))
  const z = r.expenses.items.find((i) => i.costItemId === 'co2refund-paid:e1') ?? assert.fail(r.expenses.items.map((i) => i.costItemId).join(', '))
  assert.deepEqual([z.category, z.amountCents, z.privateCents, z.deductibleCents, z.allocation, z.co2RefundPaidOut], ['CO₂-Erstattung an Mieter (§ 6 Abs. 2 CO2KostAufG)', 5000, 0, 5000, 'direct-rented', true])
  assert.equal(z.description, 'CO₂-Erstattung an Mieter, ausgezahlt am 01.06.2025')
  assert.equal(r.expenses.items.reduce((a, i) => a + i.amountCents, 0), r.expenses.totalCents)
  assert.equal(r.expenses.items.reduce((a, i) => a + i.deductibleCents, 0), r.expenses.deductibleCents)
  // Verrechnet oder in einem anderen Jahr ausgezahlt: keine Zeile.
  assert.ok(!taxReport(snap([refund()], VERSANDT_2024)).expenses.items.some((i) => i.co2RefundPaidOut))
  assert.ok(!taxReport(snap([refund({ settlePeriod: null, paidOutOn: '2026-01-10' })])).expenses.items.some((i) => i.co2RefundPaidOut))
})

test('Integrationsdurchsicht S1: zum Verrechnen eingetragen, aber ohne Abrechnung des Mieters: Hinweis statt still verschwinden', () => {
  // Inklusivmiete ohne Vorauszahlung, Anzeige 01.11.2025, 120,00 €, „verrechnen 2025“. Fällig wäre sie erst 2026, also
  // kam bisher in keinem Zeitraum ein Hinweis, und verrechnet wurde nichts. Das Speichern lehnt das heute ab; ein
  // vorhandener Eintrag bekommt in dem Zeitraum, in dem er verrechnet werden sollte, einen Hinweis.
  const e = refund({ supplierBilledAt: '2025-10-01', claimedAt: '2025-11-01', amountCents: 12000 })
  for (const over of [{ tenancies: [mieter({ costModel: 'inclusive', prepayments: [] })] }, { units: [{ id: 'w', name: 'EG', areaM2: 80, participates: false }] }]) {
    const r = computeSettlement(snap([e], VERSANDT_2024, over))
    assert.equal(r.statements.find((s) => s.tenancyId === 't'), undefined)
    assert.ok(!r.landlord.rows.some((row) => row.costItemId === 'co2refund:e1'))
    assert.ok(!codes(r).includes('co2.refund-due'), codes(r).join())
    assert.match(textOf(r, 'co2.refund-not-next'), /^Mieter bekommt für 2025 keine Abrechnung; die dort zum Verrechnen eingetragene CO₂-Erstattung von 120,00 € verrechnet Mietfuchs deshalb nicht\. Zahlen Sie sie spätestens am \d\d\.\d\d\.\d{4} aus \(§ 6 Abs\. 2 Satz 5 CO2KostAufG\) und tragen Sie die Auszahlung ein\.$/)
  }
  // Schon im Zeitraum fällig (Anzeige im Juni 2024, fällig im Juni 2025): dieselbe Aussage als Warnung.
  const frueh = computeSettlement(snap([refund({ supplierBilledAt: '2024-05-01', claimedAt: '2024-06-01', amountCents: 12000 })], VERSANDT_2024, { tenancies: [mieter({ costModel: 'inclusive', prepayments: [] })] }))
  assert.match(textOf(frueh, 'co2.refund-due'), /^Mieter bekommt für 2025 keine Abrechnung; .* 120,00 € /)
  assert.ok(!codes(frueh).includes('co2.refund-not-next'), codes(frueh).join())
})
