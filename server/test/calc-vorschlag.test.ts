// Vorschlag nach § 560 Abs. 4 BGB im Rumpfzeitraum (#208, Entwurf 3.7, Testfälle Z-B5/R5/A11,
// C5, D3, D3 fest, R11, B4, A1 aus 12.2). Ein Mieter, eine Wohnung: Sein Anteil ist der ganze
// Betrag, und die Zahlen lassen sich gegen den Entwurf lesen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { annualFactors } from '../src/prepaymentSuggestion.ts'
import { snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource } from '../src/snapshot.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { onlyVersion } from '../../shared/law/register.ts'
import { periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const table = () => onlyVersion(hkvDegreeDays).value
const WINTER: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
const SOMMER: PeriodRules = { startMonth: 5, changes: ['2025-09'] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const haus = (costItems: SnapshotCostItem[], end: string | null = null): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'A', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end, prepayments: [{ from: '2024-01', monthlyCents: 20000 }], prepaymentOverrides: {}, baseRents: [] }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settle = (rules: PeriodRules, key: string, items: SnapshotCostItem[], end: string | null = null) => {
  const p = of(rules, key)
  return computeSettlement(snapshotOfPeriod(haus(items, end), p, previousPeriod(rules, p)))
}
const vorschlag = (rules: PeriodRules, key: string, items: SnapshotCostItem[]) =>
  settle(rules, key, items).statements[0]?.suggestedMonthlyCents ?? assert.fail('kein Mieter')

let n = 0
const kalt = (key: string, amountCents: number, from?: string, to?: string): SnapshotCostItem =>
  ({ id: `k${++n}`, period: periodKey(key), category: 'Müllabfuhr', description: 'Müll', amountCents, key: 'area', ...(from && to ? { serviceFrom: from, serviceTo: to } : {}) })
const heiz = (key: string, description: string, amountCents: number, over: Partial<SnapshotCostItem> = {}): SnapshotCostItem =>
  ({ id: `h${++n}`, period: periodKey(key), category: 'Heizung und Warmwasser', description, amountCents, key: 'amounts', tenancyAmounts: { t1: amountCents }, ...over })
const brennstoff = (key: string, amountCents: number, from?: string, to?: string): SnapshotCostItem =>
  heiz(key, 'Gas', amountCents, { heatingPart: 'fuel', ...(from && to ? { serviceFrom: from, serviceTo: to } : {}) })

test('Winter-Rumpf: kalt nach Tagen, Brennstoff nach Gradtagen, Jahreswartung mit dem Jahresbetrag: 228 € (Z-B5, A11)', () => {
  const items = [
    kalt('2025-01', 40000, '2025-01-01', '2025-04-30'),
    brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'),
    heiz('2025-01', 'Wartung', 20000, { serviceFrom: '2025-01-01', serviceTo: '2025-12-31' }),
  ]
  // 400 · 365/120/12 = 101,39; 700 / 0,530 / 12 = 110,06; 200 / 12 = 16,67 → 228,12 → 228 €
  assert.equal(vorschlag(WINTER, '2025-01', items), 22800)
})

test('Derselbe Rumpf, die Wartung ist nur der Anteil Januar bis April: 262 € (A11)', () => {
  const items = [
    kalt('2025-01', 40000, '2025-01-01', '2025-04-30'),
    brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'),
    heiz('2025-01', 'Wartung', 20000, { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' }),
  ]
  assert.equal(vorschlag(WINTER, '2025-01', items), 26200)
})

test('Sommer-Rumpf 01.05.–31.08.: Brennstoff 80 € bei 80 ‰ und Jahreswartung: 100 € (Z-B5)', () => {
  const items = [
    brennstoff('2025-05', 8000, '2025-05-01', '2025-08-31'),
    heiz('2025-05', 'Wartung', 20000, { serviceFrom: '2025-05-01', serviceTo: '2026-04-30' }),
  ]
  assert.equal(of(SOMMER, '2025-05').short, true)
  assert.equal(vorschlag(SOMMER, '2025-05', items), 10000)
})

test('Gas-Jahresrechnung 01.03.2024–28.02.2025 im Rumpf: Jahresbetrag 2.400 € → 200 € (C5)', () => {
  assert.equal(vorschlag(WINTER, '2025-01', [brennstoff('2025-01', 240000, '2024-03-01', '2025-02-28')]), 20000)
})

test('Zwei Brennstoffrechnungen über die Vereinigung ihrer Leistungszeiträume: 110,06 € statt 223,21 € (D3)', () => {
  const p = of(WINTER, '2025-01')
  const items = [brennstoff('2025-01', 40000, '2025-01-01', '2025-02-28'), brennstoff('2025-01', 30000, '2025-03-01', '2025-04-30')]
  const basis = annualFactors(p, items, null, table)
  assert.ok(basis.ok)
  const monatlich = items.reduce((a, i) => a + i.amountCents * (basis.factors.get(i.id) ?? 0), 0) / 12
  assert.equal((monatlich / 100).toFixed(2), '110.06')
})

test('Feste Positionen derselben Art über die Vereinigung: 30,42 € statt 60,85 € (D3 der achten Fassung)', () => {
  const p = of(WINTER, '2025-01')
  const items = [
    heiz('2025-01', 'Fernwärme Grundpreis', 6000, { serviceFrom: '2025-01-01', serviceTo: '2025-02-28' }),
    heiz('2025-01', 'Fernwärme Grundpreis', 6000, { serviceFrom: '2025-03-01', serviceTo: '2025-04-30' }),
    brennstoff('2025-01', 1000, '2025-01-01', '2025-04-30'),
  ]
  const basis = annualFactors(p, items, null, table)
  assert.ok(basis.ok)
  const grundpreis = items.slice(0, 2).reduce((a, i) => a + i.amountCents * (basis.factors.get(i.id) ?? 0), 0) / 12
  assert.equal((grundpreis / 100).toFixed(2), '30.42')
})

test('Gasrechnung mit Leistungszeitraum neben einer Öllieferung ohne: kein Vorschlag für den ganzen Heizanteil (R11)', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000), brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'), brennstoff('2025-01', 300000)])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  const n = s.notices.find((x) => x.code === 'prepayment.no-suggestion') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /Aus einer Lieferung lässt sich der Jahresverbrauch nicht ableiten; den Vorschlag gibt es nach der nächsten vollen Abrechnung\./)
})

test('Öllieferung ohne Leistungszeitraum und ohne volle Vorperiode: kein Vorschlag (B4)', () => {
  const s = settle(WINTER, '2025-01', [brennstoff('2025-01', 300000)])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  assert.ok(s.notices.some((x) => x.code === 'prepayment.no-suggestion'))
})

test('Öllieferung ohne Leistungszeitraum mit voller Vorperiode: nach der letzten Abrechnung (B4, VIII ZR 294/10)', () => {
  // 2024 ist ein volles Kalenderjahr mit 3.000 € Brennstoff; im Rumpf kamen 1.000 € dazu. Der
  // Jahresbetrag ist der des Vorjahres, also 250 € im Monat.
  const vorjahr = brennstoff('2024-01', 300000)
  const p = of(WINTER, '2025-01')
  const jetzt = brennstoff('2025-01', 100000)
  const s = computeSettlement(snapshotOfPeriod(haus([vorjahr, jetzt]), p, previousPeriod(WINTER, p)))
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 25000)
})

test('Heizpositionen ohne Kennzeichnung als Brennstoff: kein Vorschlag, Hinweis zum Kennzeichnen (D-R5, A1)', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000), heiz('2025-01', 'Gas', 70000, { serviceFrom: '2025-01-01', serviceTo: '2025-04-30' })])
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  const n = s.notices.find((x) => x.code === 'prepayment.no-suggestion') ?? assert.fail('kein Hinweis')
  assert.match(n.text, /Kennzeichnen Sie die Brennstoffrechnung/)
})

test('Nur kalte Kosten im Rumpf: nach Tagen, kein Hinweis', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000, '2025-01-01', '2025-04-30')])
  // 400 · 365/120/12 = 101,39 → 101 €
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 10100)
  assert.equal(s.notices.some((x) => x.code === 'prepayment.no-suggestion'), false)
})

test('Endet das Mietverhältnis im Rumpf, gibt es keinen Vorschlag und keinen Hinweis', () => {
  const s = settle(WINTER, '2025-01', [brennstoff('2025-01', 300000)], '2025-03-31')
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 0)
  assert.equal(s.notices.some((x) => x.code === 'prepayment.no-suggestion'), false)
})

test('Schaltjahr: Jahreswartung 2028 zählt mit dem Jahresbetrag, der 29.02. mit 150/29 (Review Focus 5)', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2028-05'] }
  const p = of(rules, '2028-01')
  const wartung = heiz('2028-01', 'Wartung', 36600, { serviceFrom: '2028-01-01', serviceTo: '2028-12-31' })
  const gas = brennstoff('2028-01', 53000, '2028-01-01', '2028-04-30')
  const basis = annualFactors(p, [wartung, gas], null, table)
  assert.ok(basis.ok)
  assert.equal(basis.factors.get(wartung.id), 1, '366 Tage ab 01.01.2028 sind zwölf Monate')
  assert.ok(Math.abs((basis.factors.get(gas.id) ?? 0) - 1000 / 530) < 1e-9, 'Januar bis April 2028 sind 530 ‰, mit dem 29.02.')
})

test('Ein voller Zeitraum rechnet wie bisher', () => {
  const s = settle({ startMonth: 1, changes: [] }, '2025-01', [kalt('2025-01', 120000)])
  // 1.200 € / 12 = 100 €
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 10000)
})

// Durchsicht von #226 (M3): Kalte Kosten werden mit den Tagen ihres Leistungszeitraums im Rumpf
// hochgerechnet, gleichartige über die Vereinigung (wie D3); ohne Leistungszeitraum gar nicht.
test('Kalt: zwei Müllrechnungen Januar/Februar und März/April zusammen über die Vereinigung, nicht je für sich (M3)', () => {
  // 400 € über 120 Tage: 400 · 365/120 / 12 = 101,39 → 101 €. Je für sich hochgerechnet wären es
  // 200 · 365/59 + 200 · 365/61 im Jahr, also über 200 € im Monat.
  const items = [kalt('2025-01', 20000, '2025-01-01', '2025-02-28'), kalt('2025-01', 20000, '2025-03-01', '2025-04-30')]
  assert.equal(vorschlag(WINTER, '2025-01', items), 10100)
})

test('Kalt: ein Teil einer Jahresrechnung zählt mit den Tagen, die im Rumpf liegen (M3)', () => {
  // Grundsteuer 480 €, davon 157,81 € im Rumpf: 157,81 · 365/120 = 480 € im Jahr, 40 € im Monat.
  assert.equal(vorschlag(WINTER, '2025-01', [kalt('2025-01', 15781, '2025-01-01', '2025-12-31')]), 4000)
})

test('Kalt ohne Leistungszeitraum: als Jahresbetrag, nicht hochgerechnet, mit Hinweis (M3)', () => {
  const s = settle(WINTER, '2025-01', [kalt('2025-01', 40000)])
  // 400 / 12 = 33,33 → 33 €
  assert.equal(s.statements[0]?.suggestedMonthlyCents, 3300)
  const n = s.notices.find((x) => x.code === 'prepayment.annual-assumed') ?? assert.fail('kein Hinweis')
  assert.equal(n.level, 'hint')
  assert.match(n.text, /„Müll“ hat keinen Leistungszeitraum/)
})

test('Kalt: eine Rechnung nur für April wird auf zwölf Monate hochgerechnet, nicht auf die 120 Tage des Rumpfs (M3)', () => {
  // 100 € für 30 Tage: 100 · 365/30 / 12 = 101,39 → 101 €. Nach den Tagen des Rumpfs wären es 25 €.
  assert.equal(vorschlag(WINTER, '2025-01', [kalt('2025-01', 10000, '2025-04-01', '2025-04-30')]), 10100)
})

test('Rumpf mit CO₂-Abzugszeile (Heizung PR 6, Durchsicht M-4): die Abzugszeile wird mit dem Faktor ihrer Heizkosten hochgerechnet', () => {
  const p = of(WINTER, '2025-01')
  const gas = { ...brennstoff('2025-01', 70000, '2025-01-01', '2025-04-30'), heatingPlantId: 'hp' }
  const mit = computeSettlement({
    ...snapshotOfPeriod(haus([gas]), p, previousPeriod(WINTER, p)),
    heatingPlants: [{ id: 'hp', energy: 'gas', method: 'service', source: 'building', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, units: null }],
    co2Statements: [{
      heatingPeriodId: 'h', plantId: 'hp', period: p.key, method: 'serviceShown', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: null,
      serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: 7000, serviceUsersTotalCents: 70000, serviceUsersTotalApprox: false,
      serviceUnitsCount: 1, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
    }],
  })
  const st = mit.statements[0] ?? assert.fail('kein Mieter')
  assert.equal(st.totalShareCents, 63000)
  // Dasselbe wie ohne CO₂ mit 630 € Brennstoff: Der Abzug gehört zu denselben Heizkosten.
  assert.equal(st.suggestedMonthlyCents, vorschlag(WINTER, '2025-01', [brennstoff('2025-01', 63000, '2025-01-01', '2025-04-30')]))
})
