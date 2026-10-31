// Entnahme aus der Erhaltungsrücklage (#96 PR 1, Entwurf 2026-10-30-steuer-objekt-ruecklage-design.md, Teil A).
//
// Die Gemeinschaft bezahlt eine Erhaltungsmaßnahme aus der Rücklage: Erst dann ist der Anteil des Eigentümers
// Werbungskosten, im Jahr der Ausgabe durch die Gemeinschaft (BFH, Urteil vom 14.01.2025, IX R 19/24, Rz. 21, 23). Die
// Anlage V 2025 nennt die Entnahme in den Zeilen 55/56 („einschließlich Entnahmen aus der Erhaltungsrücklage“). In der
// Abrechnung verhält sich die Kostenart wie „Nicht umlagefähig“; in der Steuer steht sie in der eigenen Gruppe
// „Erhaltungsaufwand“, und ihr Jahr folgt allein `outflowShares`: ohne Angabe das Jahr der Abrechnung (das Jahr, dessen
// Hausgeldabrechnung die Entnahme ausweist, R4), sonst das angegebene Jahr der Zahlung. Ein Zahlungsdatum gibt es nicht.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESERVE_CATEGORY, RESERVE_WITHDRAWAL_CATEGORY, taxReportFor } from '../src/calc.ts'
import { TAX_STOCK_PROPERTY, type TaxSource } from '../testing/taxStock.ts'
import { periodKey } from '../../shared/period.ts'
import type { PropertyKind } from '../../shared/types.ts'

type Item = TaxSource['costItems'][number]
const item = (over: Partial<Item> & Pick<Item, 'id'>): Item => ({
  propertyId: TAX_STOCK_PROPERTY, period: periodKey('2025-01'), category: RESERVE_WITHDRAWAL_CATEGORY, description: 'Dachsanierung laut Hausgeldabrechnung',
  amountCents: 124000, key: 'area', ...over,
})
// Eine vermietete Eigentumswohnung; mit `self` dazu eine selbstgenutzte zweite Einheit derselben Fläche.
const etw = (costItems: Item[], self = false, kind: PropertyKind = 'etw'): TaxSource => ({
  properties: [{ id: TAX_STOCK_PROPERTY, kind, cableBuiltBeforeDec2021: null, periodRules: { startMonth: 1, changes: [] } }],
  units: [
    { id: 'w', propertyId: TAX_STOCK_PROPERTY, name: 'Wohnung', areaM2: 60, participates: true },
    ...(self ? [{ id: 'eg', propertyId: TAX_STOCK_PROPERTY, name: 'EG', areaM2: 60, participates: false, selfUsed: true }] : []),
  ],
  tenancies: [{
    id: 't', unitId: 'w', tenantName: 'Mieter', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 70000 }],
  }],
  costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const report = (src: TaxSource, year: number) => taxReportFor(src, TAX_STOCK_PROPERTY, year)

test('Entnahme 1.240 € im Zeitraum 2025: Gruppe „Erhaltungsaufwand“ 2025, zählt in den abziehbaren Werbungskosten', () => {
  const r = report(etw([item({ id: 'e' })]), 2025)
  const group = r.expenses.groups.find((g) => g.group === 'Erhaltungsaufwand') ?? assert.fail('Gruppe fehlt')
  assert.deepEqual(group.categories.map((c) => [c.category, c.amountCents]), [[RESERVE_WITHDRAWAL_CATEGORY, 124000]])
  assert.equal(r.expenses.deductibleCents, 124000)
  assert.equal(r.reserveContributionCents, 0)
  const position = r.expenses.items.find((x) => x.costItemId === 'e') ?? assert.fail('Position fehlt')
  assert.equal(position.group, 'Erhaltungsaufwand')
  assert.deepEqual(position.outflow, { year: 2025, source: 'period' })
  // Ohne Datum ist das richtig (R4) und kein offener Punkt: Ein Datum bietet das Formular nicht an.
  assert.equal(r.expenses.unstatedCount, 0)
  assert.equal(report(etw([item({ id: 'e' })]), 2026).expenses.totalCents, 0)
})

test('Gruppenfolge: „Erhaltungsaufwand“ vor „Verwaltung & Instandhaltung“', () => {
  const r = report(etw([item({ id: 'v', category: 'Nicht umlagefähig', description: 'Verwaltervergütung', amountCents: 36000 }), item({ id: 'e' })]), 2025)
  assert.deepEqual(r.expenses.groups.map((g) => g.group), ['Erhaltungsaufwand', 'Verwaltung & Instandhaltung'])
})

test('die Zuführung bleibt draußen, die Entnahme zählt', () => {
  const r = report(etw([item({ id: 'e' }), item({ id: 'z', category: RESERVE_CATEGORY, description: 'Zuführung Erhaltungsrücklage', amountCents: 90000 })]), 2025)
  assert.equal(r.expenses.totalCents, 124000)
  assert.equal(r.reserveContributionCents, 90000)
})

test('Eigennutzung: nach der Fläche der betroffenen Einheiten, Zuordnung über participantUnitIds', () => {
  const ganz = report(etw([item({ id: 'e' })], true), 2025).expenses.items[0] ?? assert.fail('Position fehlt')
  assert.deepEqual([ganz.privateCents, ganz.deductibleCents], [62000, 62000], 'halbe Fläche privat')
  const nurVermietet = report(etw([item({ id: 'e', participantUnitIds: ['w'] })], true), 2025).expenses.items[0] ?? assert.fail('Position fehlt')
  assert.deepEqual([nurVermietet.privateCents, nurVermietet.deductibleCents], [0, 124000])
  const nurPrivat = report(etw([item({ id: 'e', participantUnitIds: ['eg'] })], true), 2025).expenses.items[0] ?? assert.fail('Position fehlt')
  assert.deepEqual([nurPrivat.privateCents, nurPrivat.deductibleCents], [124000, 0])
})

test('Jahr der Zahlung 2026 im Kalenderzeitraum 2025: die Entnahme steht 2026 (geht erst seit #478)', () => {
  const src = etw([item({ id: 'e', taxYear: 2026 })])
  assert.equal(report(src, 2025).expenses.totalCents, 0)
  assert.deepEqual(report(src, 2025).movedOut.map((m) => m.costItemId), ['e'])
  const r = report(src, 2026)
  assert.deepEqual(r.expenses.items.map((x) => [x.costItemId, x.group, x.outflow?.source]), [['e', 'Erhaltungsaufwand', 'stated']])
})

test('reserveWithdrawalSuspects: „Nicht umlagefähig“, das nach Entnahme aussieht, mit und ohne Zahlungsdatum; fehlt ohne Treffer', () => {
  const r = report(etw([
    item({ id: 'a', category: 'Nicht umlagefähig', description: 'Entnahme aus der Erhaltungsrücklage Dach', amountCents: 50000 }),
    item({ id: 'b', category: 'Nicht umlagefähig', description: 'Fassade, bezahlt aus der Rücklage', amountCents: 30000, paidOn: '2025-03-01' }),
    item({ id: 'c', category: 'Nicht umlagefähig', description: 'Zuführung zur Rücklage', amountCents: 90000 }),
    item({ id: 'd', category: 'Nicht umlagefähig', description: 'Reparatur Dachrinne', amountCents: 20000 }),
    item({ id: 'e', description: 'Entnahme aus der Rücklage, schon richtig erfasst' }),
  ]), 2025)
  assert.deepEqual(r.reserveWithdrawalSuspects, [
    { costItemId: 'a', description: 'Entnahme aus der Erhaltungsrücklage Dach', amountCents: 50000 },
    { costItemId: 'b', description: 'Fassade, bezahlt aus der Rücklage', amountCents: 30000, paidOn: '2025-03-01' },
  ])
  // Die Zuführung meldet weiter der Hinweis aus #143, nicht dieser.
  assert.deepEqual(r.reserveSuspects.map((x) => x.costItemId), ['c'])
  // Gerechnet wird wie erfasst.
  assert.equal(r.expenses.totalCents, 50000 + 30000 + 90000 + 20000 + 124000)
  const ohne = report(etw([item({ id: 'd', category: 'Nicht umlagefähig', description: 'Reparatur Dachrinne', amountCents: 20000 })]), 2025)
  assert.equal('reserveWithdrawalSuspects' in ohne, false)
})

test('specialLevySuspects: Sonderumlage unter „Nicht umlagefähig“ mit Zahlungsdatum oder als Zuführung; fehlt ohne Treffer', () => {
  const r = report(etw([
    item({ id: 'a', category: 'Nicht umlagefähig', description: 'Sonderumlage Dach', amountCents: 300000, paidOn: '2025-04-01' }),
    item({ id: 'b', category: RESERVE_CATEGORY, description: 'Sonderumlage Aufzug', amountCents: 100000 }),
    // Ohne Datum unter „Nicht umlagefähig“: das Jahr der Abrechnung, wie es die Gemeinschaft ausweist; kein Hinweis.
    item({ id: 'c', category: 'Nicht umlagefähig', description: 'Sonderumlage Fenster', amountCents: 50000 }),
    // Als Entnahme erfasst ist sie richtig.
    item({ id: 'd', description: 'Sonderumlage Heizung' }),
  ]), 2025)
  assert.deepEqual(r.specialLevySuspects, [
    { costItemId: 'a', description: 'Sonderumlage Dach', amountCents: 300000, category: 'Nicht umlagefähig' },
    { costItemId: 'b', description: 'Sonderumlage Aufzug', amountCents: 100000, category: RESERVE_CATEGORY },
  ])
  const ohne = report(etw([item({ id: 'c', category: 'Nicht umlagefähig', description: 'Sonderumlage Fenster', amountCents: 50000 })]), 2025)
  assert.equal('specialLevySuspects' in ohne, false)
})
