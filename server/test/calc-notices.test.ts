// Hinweise mit fester Gestalt (#112): Jede Meldung der Berechnung trägt Code, Stufe, Titel und,
// wo es passt, den betroffenen Eintrag und die Regel. Der Wortlaut bleibt: `warnings` sind genau
// die Texte der Hinweise, damit Cockpit, ältere Tabs und eingefrorene Abrechnungen weiter stimmen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, consumptionOverview, NOTICE_KINDS, type ComputedSettlement } from '../src/calc.ts'
import { LAW_AS_OF } from '../../shared/law/register.ts'
import { snapshotOf, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'

const tenancy = (id: string, unitId: string, over: Partial<SnapshotTenancy> = {}): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
})
const unit = (id: string, over: Partial<SnapshotUnit> = {}): SnapshotUnit => ({ id, name: id, areaM2: 50, participates: true, ...over })
const item = (id: string, over: Partial<SnapshotCostItem>): SnapshotCostItem => ({
  id, year: 2025, category: 'Grundsteuer', description: id, amountCents: 100000, key: 'area', ...over,
})
const settle = (s: Partial<SnapshotSource>, year = 2025): ComputedSettlement => computeSettlement(snapshotOf({
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...s,
}, year))

// Ein Bestand, der viele verschiedene Meldungen auf einmal auslöst.
const kaputt = (): ComputedSettlement => settle({
  units: [unit('a'), unit('b', { areaM2: 0 }), unit('c', { participates: false, selfUsed: true, areaM2: 0 })],
  tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', { heatingModel: 'flatRate' })],
  costItems: [
    item('fläche', {}),
    item('prozent', { key: 'custom', customShares: { a: 80, b: 40 } }),
    item('einzeln', { key: 'amounts', tenancyAmounts: { 't-a': 200000 } }),
    item('zähler', { key: 'meter', meterType: 'kaltwasser' }),
    item('kabel', { category: 'Kabel/Antenne', key: 'units' }),
    item('heizung', { category: 'Heizung und Warmwasser' }),
    item('lohn', { labor35aCents: 999999 }),
  ],
})

test('Hinweise: jeder hat einen bekannten Code, dessen Stufe und Titel', () => {
  const s = kaputt()
  assert.ok(s.notices.length >= 8, `nur ${s.notices.length} Hinweise`)
  for (const n of s.notices) {
    const kind = NOTICE_KINDS[n.code]
    assert.ok(kind, `unbekannter Code ${n.code}`)
    assert.equal(n.level, kind.level, n.code)
    assert.equal(n.title, kind.title, n.code)
  }
})

test('Hinweise: warnings sind genau ihre Texte, in derselben Reihenfolge', () => {
  const s = kaputt()
  assert.deepEqual(s.warnings, s.notices.map((n) => n.text))
})

test('Hinweise: die Position, die Wohnung und das Mietverhältnis stehen als Gegenstand dabei', () => {
  const s = kaputt()
  const byCode = (code: string) => s.notices.find((n) => n.code === code)
  assert.deepEqual(byCode('custom.over-100')?.subject, { kind: 'costItem', id: 'prozent' })
  assert.deepEqual(byCode('amounts.exceed')?.subject, { kind: 'costItem', id: 'einzeln' })
  assert.deepEqual(byCode('basis.unit-no-area')?.subject, { kind: 'unit', id: 'b' })
  assert.deepEqual(byCode('heating.flat-rate')?.subject, { kind: 'tenancy', id: 't-b' })
  assert.equal(byCode('heating.flat-rate')?.rule, 'heating-flat-rate')
  assert.equal(byCode('custom.over-100')?.level, 'error')
})

test('Kabel: der Hinweis nennt die Regel und die Position, 2024 und danach mit eigenem Code', () => {
  const k = (year: number) => settle({
    units: [unit('a')], tenancies: [tenancy('t-a', 'a')],
    costItems: [item('kabel', { year, category: 'Kabel/Antenne', key: 'units' })],
  }, year).notices
  assert.deepEqual(k(2023), [])
  assert.deepEqual(k(2024).map((n) => [n.code, n.rule, n.subject?.id]), [['tv-signal.partial-year', 'tv-signal', 'kabel']])
  assert.deepEqual(k(2025).map((n) => [n.code, n.rule, n.subject?.id]), [['tv-signal.ended', 'tv-signal', 'kabel']])
})

test('Rechtsstand: Datum des Registers und die Regeln, die im Jahr gelten', () => {
  const lb = (year: number) => settle({ units: [unit('a')] }, year).legalBasis
  // Seit Heizung PR 1 das Datum des Rechtsregisters, das die Regeln einschließt
  assert.equal(lb(2025).asOf, LAW_AS_OF)
  assert.ok(lb(2023).rules.some((r) => r.code === 'tv-signal'))
  assert.ok(!lb(2025).rules.some((r) => r.code === 'tv-signal'))
  const tv = lb(2024).rules.find((r) => r.code === 'tv-signal')
  assert.deepEqual(tv, { code: 'tv-signal', title: 'Kabelfernsehen über die Nebenkosten', norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV', validTo: '2024-06-30' })
})

test('Zähler: die Meldungen der Zähler-Seite tragen Code und Zähler', () => {
  const snapshot = snapshotOf({
    units: [unit('a')], tenancies: [], costItems: [], payments: [], closedSettlements: [],
    meters: [{ id: 'm1', unitId: 'a', type: 'kaltwasser' }],
    readings: [
      { meterId: 'm1', date: '2025-01-01', value: 100 },
      { meterId: 'm1', date: '2025-06-01', value: 90 },
    ],
  }, 2025)
  const row = consumptionOverview(snapshot)[0]
  assert.deepEqual(row?.notices.map((n) => [n.code, n.subject]), [['meter.negative', { kind: 'meter', id: 'm1' }]])
  assert.deepEqual(row?.warnings, row?.notices.map((n) => n.text))
})

test('Fehlt ein Einzelbetrag, ist das eine Warnung: der Anteil landet still beim Vermieter', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b')],
    costItems: [item('einzeln', { key: 'amounts', tenancyAmounts: { 't-a': 30000 } })],
  })
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['amounts.missing', 'warning']])
})

test('Vorauszahlung ohne Abzurechnendes: eine Warnung, statt still alles zu erstatten', () => {
  // Befund der Integrationsdurchsicht: Wer nach dem Update „Pauschale“ wählt und die alte
  // Vorauszahlung stehen lässt, bekam sie ohne Hinweis als Guthaben ausgewiesen.
  const kalt = settle({
    units: [unit('a')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'flatRate', prepayments: [{ from: '2020-01', monthlyCents: 10000 }] })],
    costItems: [item('g', {})],
  })
  assert.deepEqual(kalt.notices.map((n) => [n.code, n.subject]), [['model.prepayment-unsettled', { kind: 'tenancy', id: 't-a' }]])
  assert.match(kalt.warnings[0] ?? '', /1\.200,00 €/)
  const beides = settle({
    units: [unit('a')],
    tenancies: [tenancy('t-a', 'a', { costModel: 'inclusive', heatingModel: 'inclusive', prepayments: [{ from: '2020-01', monthlyCents: 10000 }] })],
    costItems: [item('g', {})],
  })
  assert.deepEqual(beides.notices.map((n) => n.code), ['model.prepayment-unsettled'])
})

test('Einzelbetrag fehlt bei einem Mieter mit Pauschale: kein Hinweis, denn er trägt die Position ohnehin nicht', () => {
  const s = settle({
    units: [unit('a'), unit('b')],
    tenancies: [tenancy('t-a', 'a'), tenancy('t-b', 'b', { costModel: 'flatRate' })],
    costItems: [item('h', { key: 'amounts', tenancyAmounts: { 't-a': 30000 } })],
  })
  assert.ok(!s.notices.some((n) => n.code === 'amounts.missing'), s.warnings.join(' | '))
})
