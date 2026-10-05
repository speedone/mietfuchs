// Die eigene Heizperiode in der Berechnung (Heizung PR 5, Entwurf 3.1, 6.1, 12.2): Weg b in der
// Gesamtabrechnung, Abrechnung nur mit Heizkosten, und welche Abrechnung welchen Monat der
// Heizstaffel anrechnet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, rentLedger, type ComputedSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey, periodOfKey } from '../../shared/period.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { BillingPeriod, PeriodRules, SeparateSpan } from '../../shared/types.ts'

type Source = Parameters<typeof snapshotFor>[0]
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)

const anlage = (over: { periodStartMonth?: number | null; periodChanges?: string[]; separateSpans?: SeparateSpan[]; separateSettlement?: boolean | null } = {}) => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', method: 'service' as const, source: 'building' as const,
  devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
  periodStartMonth: 5, periodChanges: [], separateSpans: [], separateSettlement: false, ...over,
})
const mieter = (id: string, start: string, end: string | null, prepayments: { from: string; monthlyCents: number }[], over: Record<string, unknown> = {}) => ({
  id, unitId: 'u1', tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
  prepayments, prepaymentOverrides: {}, baseRents: [], ...over,
})
const position = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) => ({
  id, propertyId: 'objekt-1', period: periodKey(key), category: 'Grundsteuer', description: id, amountCents, key: 'area' as const, ...over,
})
const heizung = (id: string, key: string, amountCents: number, over: Record<string, unknown> = {}) =>
  position(id, key, amountCents, { category: HEATING_CATEGORY, heatingPlantId: 'hp1', ...over })
const haus = (over: Partial<Source> = {}): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }],
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [anlage()],
  ...over,
} as Source)
const settle = (src: Source, key: string, rules: PeriodRules = CALENDAR_RULES): ComputedSettlement =>
  computeSettlement(snapshotFor(src, 'objekt-1', of(rules, key)))
const st = (s: ComputedSettlement, id: string) => s.statements.find((x) => x.tenancyId === id) ?? assert.fail(`${id} fehlt`)

test('Weg b (Entwurf 3.1): Auszug 31.10.2025, die Abrechnung 2026 enthält 2025/2026, M bekommt nur Heizkosten', () => {
  const src = haus({
    tenancies: [mieter('M', '2024-01-01', '2025-10-31', [{ from: '2024-01', monthlyCents: 20000 }]), mieter('N', '2025-11-01', null, [{ from: '2025-11', monthlyCents: 22000 }])],
    costItems: [
      heizung('messdienst', '2025-05', 100000, { key: 'amounts', tenancyAmounts: { M: 41230, N: 58770 }, taxYear: 2026 }),
      position('grundsteuer', '2026-01', 60000),
    ],
  })
  const s = settle(src, '2026-01')
  assert.equal(s.deadline, '2027-12-31')
  assert.deepEqual(s.heatingPeriods?.map((h) => [h.plantId, h.period.key, h.period.label]), [['hp1', '2025-05', '2025/2026']])
  const n = st(s, 'N')
  assert.deepEqual(n.rows.map((r) => [r.costItemId, r.shareCents]), [['grundsteuer', 60000], ['messdienst', 58770]])
  assert.deepEqual([n.totalShareCents, n.prepaymentCents, n.heatingOnly], [118770, 264000, undefined])
  const m = st(s, 'M')
  assert.deepEqual([m.heatingOnly, m.recommendedDeadline, m.totalShareCents, m.prepaymentCents, m.suggestedMonthlyCents, m.balanceCents], [true, '2026-12-31', 41230, 0, 0, -41230])
  const nur = s.notices?.find((x) => x.code === 'period.heating-only-statement') ?? assert.fail('keine Warnung')
  assert.equal(nur.level, 'warning')
  assert.equal(nur.text,
    'Ob eine Abrechnung nur der Heizkosten für ein Jahr, in dem M nicht mehr gewohnt hat, die Frist bis 31.12.2027 hat, ist nicht entschieden. ' +
      'Stellen Sie sie bis 31.12.2026 zu. Fordern Sie dafür die Abrechnung des Messdienstes für 2025/2026 bis spätestens Oktober 2026 an.')
  assert.ok(s.notices?.some((x) => x.code === 'period.heating-differs' && x.level === 'hint' && x.text.includes('Heizperiode 2025/2026')))
  assert.equal(s.totalCostsCents, 160000)
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0) + s.landlord.totalCents, s.totalCostsCents)
})

test('Ohne eigene Heizperiode bleibt jede Zahl und jedes Feld gleich (Entwurf 1.2 Nr. 1, 12.3 Nr. 12)', () => {
  const src = (heatingPlants: Source['heatingPlants']) => haus({
    heatingPlants,
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 25000 }])],
    costItems: [position('gas', '2025-01', 150000, { category: HEATING_CATEGORY, heatingPlantId: 'hp1' }), position('grundsteuer', '2025-01', 50000)],
  })
  assert.deepEqual(settle(src([anlage({ periodStartMonth: null, separateSettlement: false })]), '2025-01'), settle(src([]), '2025-01'))
})

test('Weg d: P lässt die getrennte Heizperiode weg und rechnet die Heizstaffel nur in ihren übrigen Monaten an (6.1 Nr. 5, D1 Fall 1, B3)', () => {
  const src = haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }] })],
    costItems: [heizung('messdienst', '2025-05', 150000, { taxYear: 2026 }), heizung('messdienst-2026', '2026-05', 160000, { taxYear: 2027 })],
  })
  const s2026 = settle(src, '2026-01')
  assert.deepEqual(s2026.separateHeating?.map((h) => [h.period.key, h.deadline]), [['2025-05', '2027-04-30']])
  assert.equal(s2026.heatingPeriods, undefined)
  assert.deepEqual(st(s2026, 'A').rows, [], 'die Heizkosten 2025/2026 stehen in ihrer eigenen Abrechnung')
  // Januar bis April 2026 gehören der getrennten Heizperiode, Mai bis Dezember wieder P (ab W).
  assert.deepEqual([st(s2026, 'A').prepaymentCents, st(s2026, 'A').heatingPrepaymentCents], [12 * 17700 + 8 * 12300, 8 * 12300])
  const s2025 = settle(src, '2025-01')
  assert.deepEqual([st(s2025, 'A').prepaymentCents, st(s2025, 'A').heatingPrepaymentCents], [4 * 30000 + 8 * 17700, 0])
  // 2027 endet die Heizperiode 2026/2027 (nach W, also Weg b): sie steht in der Gesamtabrechnung.
  assert.deepEqual(settle(src, '2027-01').heatingPeriods?.map((h) => h.period.key), ['2026-05'])
})

test('H = P mit getrennter Vorauszahlung (A3): eine Gesamtabrechnung, beide Vorauszahlungen; die Jahreskorrektur gilt für beide', () => {
  const tenancy = (over: Record<string, unknown> = {}) => mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2024-01', monthlyCents: 12300 }], ...over })
  const src = (t: ReturnType<typeof tenancy>) => haus({
    heatingPlants: [anlage({ periodStartMonth: null, separateSettlement: true })],
    tenancies: [t],
    costItems: [heizung('gas', '2025-01', 150000), position('grundsteuer', '2025-01', 50000)],
  })
  const s = settle(src(tenancy()), '2025-01')
  assert.deepEqual([st(s, 'A').prepaymentCents, st(s, 'A').heatingPrepaymentCents, st(s, 'A').prepaymentOverridden], [360000, 147600, false])
  assert.deepEqual(st(s, 'A').rows.map((r) => r.costItemId), ['gas', 'grundsteuer'])
  assert.equal(s.separateHeating, undefined)
  // Die Jahreskorrektur von P ist, was tatsächlich an P gezahlt wurde, übrige und Heizung (3.7); eine
  // Aufteilung kennt sie nicht, deshalb steht dann kein Heizanteil daneben.
  const mitKorrektur = settle(src(tenancy({ prepaymentOverrides: { '2025-01': 352400 } })), '2025-01')
  assert.deepEqual([st(mitKorrektur, 'A').prepaymentCents, st(mitKorrektur, 'A').heatingPrepaymentCents, st(mitKorrektur, 'A').prepaymentOverridden], [352400, undefined, true])
})

test('R13: getrennt abgerechnet, aber die Vorauszahlung nicht aufgeteilt', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ periodStartMonth: null, separateSettlement: true })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('gas', '2025-01', 150000)],
  }), '2025-01')
  const hint = s.notices?.find((n) => n.code === 'prepayment.heating-share-missing') ?? assert.fail('kein Hinweis')
  assert.deepEqual([hint.level, hint.subject], ['hint', { kind: 'heatingPlant', id: 'hp1' }])
})

test('R-h: Die Vorauszahlung steigt, die Heizvorauszahlung nicht (Review Focus 4)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: null }] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }, { from: '2026-03', monthlyCents: 19700 }], {
      heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }],
    })],
  }), '2026-01')
  const hint = s.notices?.find((n) => n.code === 'prepayment.heating-share-unchanged') ?? assert.fail('kein Hinweis')
  assert.match(hint.text, /ab März 2026 auf 197,00 €, die Heizvorauszahlung nicht/)
  assert.deepEqual(hint.subject, { kind: 'tenancy', id: 'A' })
})

test('Mietkonto (3.11): beide Staffeln im Soll, die Summe je Monat bleibt', () => {
  const src = haus({
    tenancies: [
      mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }, { from: '2025-05', monthlyCents: 17700 }], { heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }] }),
      mieter('B', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 20000 }]),
    ],
  })
  const konto = rentLedger(snapshotFor(src, 'objekt-1', calendarYearPeriod(2025)))
  const a = konto.rows.find((r) => r.tenancyId === 'A') ?? assert.fail('A fehlt')
  assert.deepEqual(a.months.map((m) => m.sollCents), Array(12).fill(30000))
  assert.deepEqual([a.months[4]?.heatingPrepaymentCents, a.heatingPrepaymentYearCents, a.prepaymentYearCents], [12300, 8 * 12300, 4 * 30000 + 8 * 17700])
  const b = konto.rows.find((r) => r.tenancyId === 'B') ?? assert.fail('B fehlt')
  assert.equal(Object.hasOwn(b, 'heatingPrepaymentYearCents'), false, 'ohne Heizstaffel bleibt die Zeile, wie sie war')
  assert.equal(Object.hasOwn(b.months[0] ?? {}, 'heatingPrepaymentCents'), false)
})

test('Zwei Heizperioden in einer Abrechnung nach einem Wechsel der Anlage: beide, jede über ihre Tage', () => {
  const src = haus({
    heatingPlants: [anlage({ periodChanges: ['2026-01'] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('h2024', '2024-05', 120000, { taxYear: 2025 }), heizung('rumpf', '2025-05', 80000)],
  })
  const s = settle(src, '2025-01')
  assert.deepEqual(s.heatingPeriods?.map((h) => h.period.label), ['2024/2025', '01.05.–31.12.2025'])
  assert.deepEqual(st(s, 'A').rows.map((r) => [r.costItemId, r.shareCents]), [['h2024', 120000], ['rumpf', 80000]])
})

test('Ein Rumpf der Heizperiode in P: ohne Brennstoffkennzeichen kein Vorschlag (R11)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ periodChanges: ['2026-01'] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('rumpf', '2025-05', 80000), position('grundsteuer', '2025-01', 50000)],
  }), '2025-01')
  assert.equal(st(s, 'A').suggestedMonthlyCents, 0)
  assert.ok(s.notices?.some((n) => n.code === 'prepayment.no-suggestion' && /Brennstoff/.test(n.text)))
})

test('Kein Ende einer Heizperiode in P: Warnung an der Heizanlage', () => {
  const objekt: PeriodRules = { startMonth: 1, changes: ['2025-04'] }
  const s = settle(haus({
    properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: objekt }],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
  }), '2025-01', objekt)
  const w = s.notices?.find((n) => n.code === 'period.no-heating-period') ?? assert.fail('keine Warnung')
  assert.deepEqual([w.level, w.subject], ['warning', { kind: 'heatingPlant', id: 'hp1' }])
})

test('Weg d ohne Heizstaffel: Monate einer getrennten Heizperiode ohne Heizvorauszahlung ergeben den Hinweis (Durchsicht von #231, Important 2)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: null }] })],
    tenancies: [
      mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }], { heatingPrepayments: [{ from: '2025-05', monthlyCents: 12300 }] }),
      // Ein Nachmieter, dessen Heizvorauszahlung nicht erfasst wurde.
      { ...mieter('N', '2026-03-01', null, [{ from: '2026-03', monthlyCents: 30000 }]), unitId: 'u1' },
    ],
  }), '2026-01')
  const hints = (s.notices ?? []).filter((n) => n.code === 'prepayment.heating-share-missing')
  assert.deepEqual(hints.map((h) => h.subject), [{ kind: 'tenancy', id: 'N' }])
  assert.match(hints[0]?.text ?? '', /N \(EG\): Die Heizkosten März bis Dezember 2026 werden getrennt abgerechnet, für diese Monate ist aber keine Heizvorauszahlung erfasst/)
})

test('Hinweise einer Heizperiode im Rumpf nennen die Heizperiode, nicht P (Durchsicht von #231, Important 4)', () => {
  const s = settle(haus({
    heatingPlants: [anlage({ periodChanges: ['2026-01'] })],
    tenancies: [mieter('A', '2024-01-01', null, [{ from: '2024-01', monthlyCents: 30000 }])],
    costItems: [heizung('rumpf', '2025-05', 80000), position('grundsteuer', '2025-01', 50000)],
  }), '2025-01')
  const kurz = s.notices?.find((n) => n.code === 'period.short') ?? assert.fail('kein Hinweis zum Rumpf')
  assert.match(kurz.text, /^Die Heizperiode 01\.05\.–31\.12\.2025 ist ein Rumpfzeitraum wegen der Umstellung der Heizung\./)
  const vorschlag = s.notices?.find((n) => n.code === 'prepayment.no-suggestion') ?? assert.fail('kein Hinweis zum Vorschlag')
  assert.doesNotMatch(vorschlag.text, /Rumpfzeitraum 2025/)
  assert.match(vorschlag.text, /^Für die Abrechnung 2025 schlägt Mietfuchs keine neue Vorauszahlung vor: Die Heizperiode 01\.05\.–31\.12\.2025 ist ein Rumpf, und keine Position der Heizkosten ist als Brennstoff gekennzeichnet\./)
})

test('Weg d ohne Heizstaffel: Einzug mitten im Monat zählt den Monat mit, eine Heizkorrektur genügt (Durchsicht von #231, Minor 2)', () => {
  const src = (over: Record<string, unknown>) => haus({
    heatingPlants: [anlage({ separateSettlement: true, separateSpans: [{ from: '2025-05', until: null }] })],
    tenancies: [{ ...mieter('N', '2026-03-15', null, [{ from: '2026-03', monthlyCents: 30000 }]), ...over }],
  })
  const hints = (s: ReturnType<typeof settle>) => (s.notices ?? []).filter((n) => n.code === 'prepayment.heating-share-missing')
  assert.match(hints(settle(src({}), '2026-01'))[0]?.text ?? '', /Die Heizkosten März bis Dezember 2026 werden getrennt abgerechnet/)
  const korrigiert = src({ heatingPrepaymentOverrides: [
    { plantId: 'hp1', period: periodKey('2025-05'), cents: 20000, provisional: false, fromMonth: null, toMonth: null },
    { plantId: 'hp1', period: periodKey('2026-05'), cents: 80000, provisional: false, fromMonth: null, toMonth: null },
  ] })
  assert.deepEqual(hints(settle(korrigiert, '2026-01')), [], 'Die Heizkorrekturen nennen, was gezahlt wurde')
})
