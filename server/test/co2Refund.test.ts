// CO₂-Erstattung an Mieter, die selbst heizen (Heizung PR 19, #97): Nachrechnung nach § 5 Abs. 3, § 6 Abs. 2, 3,
// § 8 Abs. 2, § 9 und ab 2028 § 5a CO2KostAufG; Fristen nach § 6 Abs. 2 Satz 3–5; „nächste Abrechnung“ (Satz 4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimDeadline, nextSettlement, prepaymentAgreed, refundDueDate, refundLawAt, refundProposal, refundSteps, type LawAsk, type RefundBasis, type RefundLaw } from '../src/co2Refund.ts'
import { stageRanges, tableFactor } from '../src/co2.ts'
import { co2ApplicableFrom, co2HalfSplit, co2Restriction, co2RoundingDecimals, co2SelfSupply, co2StageTable } from '../../shared/law/co2kostaufg.ts'
import { valueAt, versionsIn } from '../../shared/law/register.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'
import { periodKey } from '../../shared/period.ts'

const TABLE = valueAt(hkvDegreeDays, '2025-01-01')
const lawFor = (from: string, to: string, short = false, over: Partial<RefundLaw> = {}): RefundLaw => ({
  applicable: from >= '2023-01-01',
  ranges: from >= '2023-01-01' ? stageRanges(valueAt(co2StageTable, from), tableFactor({ from, to, short })) : [],
  decimals: 1, nonResidentialPermille: 500, restriction: null, cutPercent: 5,
  pieces: versionsIn(co2HalfSplit, { from, to }),
  weigh: (r) => degreeDayPermille([r], TABLE),
  overYear: false,
  ...over,
})
const basis = (over: Partial<RefundBasis> = {}): RefundBasis => ({
  billedFrom: '2025-01-01', billedTo: '2025-12-31', emissionsKg: 2400, co2CostCents: 60000, areaM2: 80, ownAppliances: false,
  commercialUse: false, commercialMetered: false, nonResidential: false, restriction: 'none', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null, ...over,
})
const cents = (b: RefundBasis, l: RefundLaw = lawFor(b.billedFrom ?? '', b.billedTo ?? '')): number | null => refundProposal(b, l)?.cents ?? null
const plainAsk: LawAsk = {
  applicable: (p) => valueAt(co2ApplicableFrom, p.from),
  stageTable: (p) => valueAt(co2StageTable, p.from),
  decimals: (p) => valueAt(co2RoundingDecimals, p.from),
  restriction: (p) => valueAt(co2Restriction, p.from),
  selfSupply: (d) => valueAt(co2SelfSupply, d),
  pieces: (p) => versionsIn(co2HalfSplit, p),
  degreeDays: (p) => valueAt(hkvDegreeDays, p.from),
}

test('30,0 kg/m² → Stufe 40 %: 600 € → 240,00 €; eigener Gasherd −5 % → 228,00 € (Review Focus 5)', () => {
  const p = refundProposal(basis(), lawFor('2025-01-01', '2025-12-31')) ?? assert.fail('keine Nachrechnung')
  assert.deepEqual([p.value, p.stagePercent, p.permille, p.cents], [30, 40, 400, 24000])
  assert.equal(cents(basis({ ownAppliances: true })), 22800)
})

test('§ 6 Abs. 3 Satz 1: gewerbliche Nutzung ohne getrennte Messung → kein Anspruch; mit Messung wie sonst', () => {
  const ohne = refundProposal(basis({ commercialUse: true }), lawFor('2025-01-01', '2025-12-31'))
  assert.deepEqual([ohne?.cents, ohne?.excluded], [0, 'commercialUnmetered'])
  assert.equal(cents(basis({ commercialUse: true, commercialMetered: true })), 24000)
})

test('§ 8 Abs. 2: im Nichtwohngebäude 50 %; § 9 halbiert, bei beiden Vorgaben nichts', () => {
  assert.equal(cents(basis({ nonResidential: true })), 30000)
  const halb = lawFor('2025-01-01', '2025-12-31', false, { restriction: { factor: 0.5, bothSplit: false } })
  assert.equal(refundProposal(basis({ restriction: 'building' }), halb)?.cents, 12000)
  assert.equal(refundProposal(basis({ restriction: 'both' }), halb)?.cents, 0)
  assert.equal(refundProposal(basis({ nonResidential: true, restriction: 'supply' }), halb)?.cents, 15000)
})

test('Zeitraum des Lieferanten unter einem Jahr: Tabelle gekürzt (§ 5 Abs. 3 Satz 4 i. V. m. Abs. 1 Satz 4)', () => {
  const b = basis({ billedFrom: '2025-01-01', billedTo: '2025-06-30', emissionsKg: 1200, co2CostCents: 30000 })
  // 181 von 365 Tagen: Grenzen × 0,4959; 15,0 kg liegt über 27 × 0,4959 = 13,39 und unter 32 × 0,4959 = 15,87 → 40 %.
  assert.equal(refundProposal(b, lawFor('2025-01-01', '2025-06-30', true))?.cents, 12000)
  assert.equal(refundProposal(b, lawFor('2025-01-01', '2025-06-30', false))?.cents, 3000, 'ungekürzt läge 15,0 in der Stufe 10 %')
  // Über refundLawAt erkannt: kürzer als ein Jahr heißt gekürzt.
  const l = refundLawAt({ ...b, supplierBilledAt: '2025-07-15' }, plainAsk) ?? assert.fail('kein Recht')
  assert.equal(refundProposal(b, l)?.cents, 12000)
})

test('Prüfung S6: über ein Jahr (etwa eine Tankfüllung) rechnet Mietfuchs nicht nach', () => {
  const b = basis({ billedFrom: '2025-01-01', billedTo: '2026-06-30' })
  const l = refundLawAt({ ...b, supplierBilledAt: '2026-07-15' }, plainAsk) ?? assert.fail('kein Recht')
  assert.deepEqual([refundProposal(b, l)?.cents, refundProposal(b, l)?.excluded], [0, 'overYear'])
  const t = { euro: (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`, exact: (c: number) => `${(c / 100).toFixed(3).replace('.', ',')} €`, num: (n: number) => String(n).replace('.', ','), applicableFrom: '01.01.2023', cutPercent: 5 }
  assert.match(refundSteps(refundProposal(b, l), b, 1000, t)[0]?.value ?? '', /^nicht nachgerechnet: Das Gesetz verlangt, den Ausstoß auf den vereinbarten Abrechnungszeitraum umzurechnen \(§ 6 Abs\. 2 Satz 2, § 5 Abs\. 3 Satz 4 i\. V\. m\. § 5 Abs\. 1 Satz 5 CO2KostAufG\); wie das bei einer Lieferung über mehr als ein Jahr geschieht, sagt es nicht, und Mietfuchs rechnet es deshalb nicht nach\.$/)
  // Durchsicht S-6: Das Gesetz regelt die Umrechnung; offen ist nur das Verfahren bei einer Tankfüllung.
})

test('§ 11 Abs. 2: ein Zeitraum des Lieferanten, der vor 2023 beginnt, ergibt keinen Anspruch', () => {
  const b = basis({ billedFrom: '2022-07-01', billedTo: '2023-06-30' })
  const l = refundLawAt({ ...b, supplierBilledAt: '2023-07-15' }, plainAsk) ?? assert.fail('kein Recht')
  const p = refundProposal(b, l)
  assert.deepEqual([p?.cents, p?.excluded], [0, 'notApplicable'])
})

test('§ 6 Abs. 2 Satz 1 n. F. mit § 5a: ab 01.01.2028 hälftig nach Anfall, Netzentgelte hälftig; § 9 kürzt nur den Teil nach Stufen', () => {
  const b = basis({ billedFrom: '2027-07-01', billedTo: '2028-06-30', halfSplitFrom: '2028-01-01', gridFeeCents: 30000 })
  const p = refundProposal(b, lawFor('2027-07-01', '2028-06-30')) ?? assert.fail('keine Nachrechnung')
  const w = degreeDayPermille([{ from: '2028-01-01', to: '2028-06-30' }], TABLE) / degreeDayPermille([{ from: '2027-07-01', to: '2028-06-30' }], TABLE)
  assert.ok(Math.abs((p.permille ?? 0) - (400 * (1 - w) + 500 * w)) < 1e-9)
  assert.ok(Math.abs(p.gridFeeRaw - 30000 * w * 0.5) < 1e-9)
  assert.equal(p.cents, Math.round(60000 * (400 * (1 - w) + 500 * w) / 1000 + 30000 * w * 0.5))
  // § 9 Abs. 1 halbiert nur den Anteil nach Stufen, nicht die Hälfte nach § 5a (Auslegung wie PR 18).
  const halb = refundProposal({ ...b, restriction: 'building' }, lawFor('2027-07-01', '2028-06-30', false, { restriction: { factor: 0.5, bothSplit: false } })) ?? assert.fail('keine Nachrechnung')
  assert.ok(Math.abs((halb.permille ?? 0) - (200 * (1 - w) + 500 * w)) < 1e-9)
  // Ohne Tag des § 5a: nur Stufen, und Netzentgelte zählen nicht.
  const ohne = refundProposal({ ...b, halfSplitFrom: null }, lawFor('2027-07-01', '2028-06-30')) ?? assert.fail('keine Nachrechnung')
  assert.deepEqual([ohne.permille, ohne.gridFeeRaw], [400, 0])
})

test('§ 5a ab 2029: Biobrennstoff hälftig', () => {
  const b = basis({ billedFrom: '2029-01-01', billedTo: '2029-12-31', halfSplitFrom: '2028-01-01', bioCostCents: 10000 })
  const p = refundProposal(b, lawFor('2029-01-01', '2029-12-31')) ?? assert.fail('keine Nachrechnung')
  assert.equal(p.bioRaw, 5000)
  assert.equal(p.permille, 500)
})

test('§ 9 Abs. 2 ohne Fläche: der Teil nach § 5a bleibt, nach Stufen 0', () => {
  const b = basis({ areaM2: null, restriction: 'both', billedFrom: '2027-07-01', billedTo: '2028-06-30', halfSplitFrom: '2028-01-01' })
  const p = refundProposal(b, lawFor('2027-07-01', '2028-06-30', false, { restriction: { factor: 0.5, bothSplit: false } })) ?? assert.fail('keine Nachrechnung')
  assert.ok((p.permille ?? 0) > 0 && (p.permille ?? 0) < 500, String(p.permille))
})

test('Ohne Zeitraum oder CO₂-Kosten keine Nachrechnung; ohne Fläche nur, wenn alles hälftig ist', () => {
  assert.equal(refundProposal(basis({ billedFrom: null, billedTo: null }), lawFor('2025-01-01', '2025-12-31')), null)
  assert.equal(refundProposal(basis({ co2CostCents: null }), lawFor('2025-01-01', '2025-12-31')), null)
  assert.equal(refundProposal(basis({ areaM2: null }), lawFor('2025-01-01', '2025-12-31')), null)
  assert.equal(refundLawAt({ ...basis({ billedFrom: null, billedTo: null }), supplierBilledAt: '2025-01-20' }, plainAsk), null)
})

test('Vorauszahlung vereinbart: nach der Staffel, nicht nach dem Gezahlten; nicht bei Pauschale oder Inklusivmiete', () => {
  const p = { from: '2025-01-01', to: '2025-12-31' }
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2020-01', monthlyCents: 10000 }] }, p), true)
  assert.equal(prepaymentAgreed({ prepayments: [] }, p), false)
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2020-01', monthlyCents: 10000 }, { from: '2024-07', monthlyCents: 0 }] }, p), false)
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2020-01', monthlyCents: 0 }, { from: '2025-07', monthlyCents: 5000 }] }, p), true)
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2026-01', monthlyCents: 5000 }] }, p), false)
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2020-01', monthlyCents: 10000 }], costModel: 'flatRate' }, p), false)
  assert.equal(prepaymentAgreed({ prepayments: [{ from: '2020-01', monthlyCents: 10000 }], costModel: 'inclusive' }, p), false)
  // Eine eigene Heizvorauszahlung ist ebenso eine Vorauszahlung auf Betriebskosten.
  assert.equal(prepaymentAgreed({ prepayments: [], heatingPrepayments: [{ from: '2024-05', monthlyCents: 9000 }] }, p), true)
})

test('Fristen nach §§ 187 Abs. 1, 188 Abs. 2, 3 BGB', () => {
  assert.equal(claimDeadline('2025-01-20', 12), '2026-01-20')
  assert.equal(refundDueDate('2025-03-01', 12), '2026-03-01')
  assert.equal(refundDueDate('2024-02-29', 12), '2025-02-28')
})

test('Nächste Abrechnung nach der Anzeige: die früheste, die am Tag der Anzeige noch erstellt werden darf und nicht versandt war', () => {
  const p = (y: number, sentAt: string | null = null) => ({ key: periodKey(`${y}-01`), from: `${y}-01-01`, deadline: `${y + 1}-12-31`, sentAt })
  assert.equal(nextSettlement('2025-03-01', [p(2023), p(2024), p(2025)]), '2024-01')
  assert.equal(nextSettlement('2025-03-01', [p(2023), p(2024, '2025-02-15'), p(2025)]), '2025-01')
  assert.equal(nextSettlement('2025-03-01', []), null)
})

test('Rechenweg der Zeile', () => {
  const b = basis({ ownAppliances: true })
  const p = refundProposal(b, lawFor('2025-01-01', '2025-12-31'))
  const t = { euro: (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`, exact: (c: number) => `${(c / 100).toFixed(3).replace('.', ',')} €`, num: (n: number) => String(n).replace('.', ','), applicableFrom: '01.01.2023', cutPercent: 5 }
  const steps = refundSteps(p, b, 22800, t)
  assert.deepEqual(steps.map((s) => s.label), ['CO₂-Ausstoß je m² und Jahr', 'Anteil des Vermieters', 'CO₂-Kosten des Vermieters', 'Eigene Geräte zu anderen Zwecken', 'Nachgerechnet', 'Betrag laut Anzeige'])
  assert.equal(steps.at(-2)?.value, '228,00 €')
  assert.equal(refundSteps(null, b, 22800, t).map((s) => s.label).join(), 'Betrag laut Anzeige')
})
