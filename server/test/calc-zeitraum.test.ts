// Die Berechnung über den Abrechnungszeitraum (#208, Entwurf 6.1 und 12.3). Dass sich im
// Kalenderjahr nichts ändert, halten der Prüfkatalog, db-objekte.test.ts und der Gleichheitstest
// unten fest; die übrigen Tests rechnen Zeiträume, die keine Kalenderjahre sind.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computePrepaymentCents, computeSettlement, consumptionOverview, ledgerRows, rentLedger, taxReport, type ComputedSettlement } from '../src/calc.ts'
import {
  overridesByPeriod, snapshotFor, snapshotOf, snapshotOfPeriod,
  type SnapshotCostItem, type SnapshotReading, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit,
} from '../src/snapshot.ts'
import {
  CALENDAR_RULES, calendarPeriod, calendarYearPeriod, periodContaining, periodKey, periodOfKey, periodsBetween, previousPeriod,
} from '../../shared/period.ts'
import type { BillingPeriod, PeriodKey, PeriodRules } from '../../shared/types.ts'
import { loadFixtures } from '../testing/fixtures.ts'

const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

const settle = (source: SnapshotSource, rules: PeriodRules, key: string, asOf?: string): ComputedSettlement => {
  const p = of(rules, key)
  return computeSettlement(snapshotOfPeriod(source, p, previousPeriod(rules, p)), asOf ? { asOf } : {})
}

function tenancy(id: string, unitId: string, start: string, end: string | null, monthlyCents = 20000): SnapshotTenancy {
  return {
    id, unitId, tenantName: id, persons: 1, personHistory: [{ from: start, persons: 1 }], start, end,
    prepayments: [{ from: start.slice(0, 7), monthlyCents }], prepaymentOverrides: {}, baseRents: [],
  }
}
const haus = (over: Partial<SnapshotSource> = {}): SnapshotSource => ({
  units: [{ id: 'u1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', name: 'OG', areaM2: 40, participates: true }],
  tenancies: [tenancy('t1', 'u1', '2020-01-01', null), tenancy('t2', 'u2', '2020-01-01', null)],
  costItems: [], meters: [], readings: [], payments: [], closedSettlements: [], ...over,
})
const grundsteuer = (key: string, amountCents = 120000): SnapshotCostItem =>
  ({ id: `g${key}`, period: periodKey(key), category: 'Grundsteuer', description: 'Grundsteuer', amountCents, key: 'area' })

test('Gleichheit: Regeln { startMonth: 1, changes: [] } rechnen jedes Fixture wie das Kalenderjahr (Entwurf 12.1)', () => {
  for (const fx of loadFixtures()) {
    const db = fx.db()
    const scoped = {
      properties: [{ id: 'objekt-1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
      units: db.units.map((u) => ({ ...u, propertyId: 'objekt-1' })),
      tenancies: db.tenancies.map((t) => ({ ...t, prepaymentOverrides: overridesByPeriod(t.prepaymentOverrides ?? {}) })),
      costItems: db.costItems.map((c) => ({ ...c, period: calendarPeriod(c.year), propertyId: 'objekt-1' })),
      meters: db.meters.map((m) => ({ ...m, propertyId: 'objekt-1' })),
      readings: db.readings,
      payments: db.payments,
      closedSettlements: [],
    }
    for (const year of [fx.year - 1, fx.year, fx.year + 1]) {
      const viaRegeln = snapshotFor(scoped, 'objekt-1', of(CALENDAR_RULES, `${year}-01`))
      const viaJahr = { ...snapshotOf(scoped, year), propertyId: 'objekt-1', property: viaRegeln.property }
      const fall = `${fx.name} ${year}`
      assert.deepEqual(computeSettlement(viaRegeln), computeSettlement(viaJahr), `${fall}: Abrechnung`)
      assert.deepEqual(rentLedger(viaRegeln), rentLedger(viaJahr), `${fall}: Mietkonto`)
      assert.deepEqual(taxReport(viaRegeln), taxReport(viaJahr), `${fall}: Steuer`)
      assert.deepEqual(consumptionOverview(viaRegeln), consumptionOverview(viaJahr), `${fall}: Verbrauch`)
    }
  }
})

test('Kalenderjahr: Die Abrechnung trägt Zeitraum und Frist', () => {
  const s = computeSettlement(snapshotOf(haus({ costItems: [grundsteuer('2025-01')] }), 2025))
  assert.deepEqual(s.period, { key: '2025-01', from: '2025-01-01', to: '2025-12-31', short: false, label: '2025' })
  assert.equal(s.deadline, '2026-12-31')
})

test('Mai bis April: Tage, Vorauszahlungsmonate, Bezeichnung und Frist kommen vom Zeitraum', () => {
  const s = settle(haus({ costItems: [grundsteuer('2025-05')] }), MAI, '2025-05')
  assert.equal(s.daysInYear, 365)
  assert.equal(s.year, 2025)
  assert.deepEqual(s.period, { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' })
  assert.equal(s.deadline, '2027-04-30')
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  assert.deepEqual([st.periodStart, st.periodEnd, st.days, st.prepaymentCents], ['2025-05-01', '2026-04-30', 365, 240000])
  assert.equal(st.totalShareCents, 72000, '60 von 100 m² aus 1.200 €')
  assert.ok(st.suggestedMonthlyCents > 0, 'zwölf Monate: der Vorschlag nach § 560 Abs. 4 bleibt')
})

test('Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage, ein Auszug zum 29.02.2028 trägt 305 davon', () => {
  const src = haus({ tenancies: [tenancy('t1', 'u1', '2020-01-01', '2028-02-29'), tenancy('t2', 'u2', '2020-01-01', null)], costItems: [grundsteuer('2027-05', 73200)] })
  const s = settle(src, MAI, '2027-05')
  assert.equal(s.daysInYear, 366)
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  assert.equal(st.days, 305)
  assert.equal(st.totalShareCents, 36600, '73.200 · 60/100 · 305/366')
})

test('Rumpf 01.01.–30.04.2025: 120 Tage, vier Vorauszahlungsmonate, kein Vorschlag, Rückstand nur über den Zeitraum', () => {
  // Review Focus 5.
  const src = haus({
    tenancies: [tenancy('t1', 'u1', '2024-01-01', null), tenancy('t2', 'u2', '2024-01-01', null)],
    costItems: [grundsteuer('2025-01', 40000)],
    payments: [{ tenancyId: 't1', date: '2025-01-03', amountCents: 20000 }, { tenancyId: 't1', date: '2025-02-03', amountCents: 20000 }],
  })
  const s = settle(src, WECHSEL, '2025-01', '2025-06-15')
  assert.equal(s.daysInYear, 120)
  assert.equal(s.period.label, '01.01.–30.04.2025')
  assert.equal(s.deadline, '2026-04-30')
  const st = s.statements.find((x) => x.tenancyId === 't1') ?? assert.fail('t1 fehlt')
  // Im Rumpf gibt es keinen Vorschlag, bis PR 3 ihn nach Gradtagen rechnet; ein falscher wäre schlimmer.
  assert.deepEqual([st.days, st.periodEnd, st.prepaymentCents, st.suggestedMonthlyCents], [120, '2025-04-30', 80000, 0])
  const rueckstand = s.notices.find((n) => n.code === 'prepayment.arrears' && n.subject?.id === 't1') ?? assert.fail('kein Hinweis auf den Rückstand')
  assert.match(rueckstand.text, /^Im Mietkonto 01\.01\.–30\.04\.2025 von t1 \(EG\) sind 400,00 € offen\./)
  // Das Mietkonto selbst bleibt beim Kalenderjahr (Entwurf 3.11).
  const konto = rentLedger(snapshotOf(src, 2025), { asOf: '2025-06-15' }).rows.find((r) => r.tenancyId === 't1') ?? assert.fail('t1 fehlt im Mietkonto')
  assert.deepEqual([konto.months.length, konto.arrearsCents], [12, 60000])
})

test('Steuer: nur im Kalenderjahr; ein Schnappschuss Mai–April wird abgelehnt statt still falsch gerechnet', () => {
  const p = of(MAI, '2025-05')
  assert.throws(() => taxReport(snapshotOfPeriod(haus(), p, previousPeriod(MAI, p))), /Kalenderjahr/)
})

// ---------- Invarianten (Entwurf 12.3) ----------

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r: () => number, n: number): number => Math.floor(r() * n)
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const day2025 = (r: () => number, from = 0): string => addDays('2025-01-01', from + pick(r, 365 - from))

// Ein Bestand im Kalenderjahr 2025: nur kalte Kosten, keine Regel mit Stichtag, kein 29.02. in der
// Nähe (Entwurf 12.3 Nr. 6, G-H). Die Positionen tragen den Schlüssel, der übergeben wird.
function calendarStock(r: () => number, key: PeriodKey): SnapshotSource {
  const units: SnapshotUnit[] = Array.from({ length: 2 + pick(r, 3) }, (_, i) => ({ id: `u${i}`, name: `W${i}`, areaM2: 30 + pick(r, 70), participates: true }))
  const tenancies: SnapshotTenancy[] = []
  for (const u of units) {
    const persons = 1 + pick(r, 4)
    const end = r() < 0.5 ? null : day2025(r, 20)
    tenancies.push({ ...tenancy(`${u.id}-a`, u.id, '2024-06-01', end, 0), persons, personHistory: [{ from: '2024-06-01', persons }] })
    if (end !== null && r() < 0.7) {
      const start = addDays(end, 1 + pick(r, 30))
      const p2 = 1 + pick(r, 4)
      if (start <= '2025-12-31') tenancies.push({ ...tenancy(`${u.id}-b`, u.id, start, null, 0), persons: p2, personHistory: [{ from: start, persons: p2 }, { from: addDays(start, 40), persons: 1 + pick(r, 4) }] })
    }
  }
  const meters = units.map((u) => ({ id: `m${u.id}`, unitId: u.id, type: 'kaltwasser' as const }))
  const readings: SnapshotReading[] = meters.flatMap((m) => {
    const anfang = pick(r, 100)
    const mitte = anfang + pick(r, 50)
    return [
      { meterId: m.id, date: '2024-12-31', value: anfang },
      { meterId: m.id, date: day2025(r, 100), value: mitte },
      { meterId: m.id, date: '2025-12-31', value: mitte + pick(r, 60) },
    ]
  })
  const amount = () => 20000 + pick(r, 200000)
  const costItems: SnapshotCostItem[] = [
    { id: 'gs', period: key, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: amount(), key: 'area' },
    { id: 'mu', period: key, category: 'Müllabfuhr', description: 'Müll', amountCents: amount(), key: 'persons' },
    { id: 'wa', period: key, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: amount(), key: 'meter', meterType: 'kaltwasser' },
    { id: 'hw', period: key, category: 'Hauswart', description: 'Hauswart', amountCents: amount(), key: 'units' },
    { id: 'di', period: key, category: 'Sonstige Betriebskosten', description: 'Direkt', amountCents: amount(), key: 'direct', directUnitId: 'u0' },
    { id: 'cu', period: key, category: 'Gartenpflege', description: 'Garten', amountCents: amount(), key: 'custom', customShares: { u0: 40, u1: 50 } },
  ]
  return { units, tenancies, costItems, meters, readings, payments: [], closedSettlements: [] }
}

// Derselbe Bestand 120 Tage später: der 01.01.2025 wird der 01.05.2025.
function shifted(src: SnapshotSource, key: PeriodKey): SnapshotSource {
  return {
    ...src,
    tenancies: src.tenancies.map((t) => ({
      ...t, start: addDays(t.start, 120), end: t.end === null ? null : addDays(t.end, 120),
      personHistory: t.personHistory.map((e) => ({ ...e, from: addDays(e.from, 120) })),
    })),
    readings: src.readings.map((x) => ({ ...x, date: addDays(x.date, 120) })),
    costItems: src.costItems.map((c) => ({ ...c, period: key })),
  }
}

const shares = (s: ComputedSettlement) => ({
  tenants: Object.fromEntries(s.statements.map((st) => [st.tenancyId, Object.fromEntries(st.rows.map((row) => [row.costItemId, row.shareCents]))])),
  landlord: Object.fromEntries(s.landlord.rows.map((row) => [row.costItemId, row.shareCents])),
})

test('Invariante: verschoben um 120 Tage und im Zeitraum Mai–April gerechnet, centgleiche Anteile (Entwurf 12.3 Nr. 6)', () => {
  const r = rng(6)
  for (let fall = 0; fall < 100; fall++) {
    const kalender = calendarStock(r, calendarPeriod(2025))
    const vorher = computeSettlement(snapshotOfPeriod(kalender, calendarYearPeriod(2025), calendarYearPeriod(2024)))
    const nachher = settle(shifted(kalender, periodKey('2025-05')), MAI, '2025-05')
    assert.deepEqual(shares(nachher), shares(vorher), `Fall ${fall}`)
  }
})

test('Invariante: Geld bleibt erhalten, auch im Rumpf und über den Jahreswechsel (Entwurf 12.3 Nr. 2)', () => {
  const r = rng(2)
  for (let fall = 0; fall < 100; fall++) {
    for (const [rules, key, stock] of [
      [WECHSEL, '2025-01', calendarStock(r, periodKey('2025-01'))],
      [MAI, '2025-05', shifted(calendarStock(r, periodKey('2025-01')), periodKey('2025-05'))],
    ] as const) {
      const s = settle(stock, rules, key)
      const mieter = s.statements.reduce((a, st) => a + st.totalShareCents, 0)
      assert.equal(mieter + s.landlord.totalCents, s.totalCostsCents, `Fall ${fall} ${key}: Summe`)
      for (const st of s.statements) for (const row of st.rows) assert.ok(row.shareCents >= 0, `Fall ${fall} ${key}: negativer Anteil`)
    }
  }
})

test('Invariante: Die Vorauszahlungen aller Zeiträume einer Spanne sind die des Mietkontos über dieselben Monate (Entwurf 12.3 Nr. 11)', () => {
  const r = rng(11)
  const unit: SnapshotUnit = { id: 'u', name: 'U', areaM2: 50, participates: true }
  for (let fall = 0; fall < 200; fall++) {
    const rules: PeriodRules = { startMonth: 1 + pick(r, 12), changes: [] }
    const change = `2025-${String(1 + pick(r, 12)).padStart(2, '0')}`
    // Ein Wechsel auf einen Monat, in dem ohnehin ein Zeitraum beginnt, ist keiner (wie in period.test.ts).
    if (r() < 0.5 && periodContaining(rules, `${change}-01`).from !== `${change}-01`) rules.changes.push(change)
    const periods = periodsBetween(rules, '2024-01-01', '2026-12-31')
    const first = periods[0] ?? assert.fail('keine Zeiträume')
    const last = periods[periods.length - 1] ?? assert.fail('keine Zeiträume')
    const start = addDays('2023-06-01', pick(r, 1200))
    const t: SnapshotTenancy = {
      ...tenancy('t', 'u', start, r() < 0.5 ? null : addDays(start, pick(r, 900)), 10000 + pick(r, 20000)),
      prepayments: [
        { from: start.slice(0, 7), monthlyCents: 10000 + pick(r, 20000) },
        { from: `2025-${String(1 + pick(r, 12)).padStart(2, '0')}`, monthlyCents: pick(r, 30000) },
      ],
    }
    const viaZeitraum = periods.reduce((a, p) => a + computePrepaymentCents(t, p).cents, 0)
    const viaMietkonto = ledgerRows({ units: [unit], tenancies: [t], payments: [] }, { from: first.from, to: last.to })
      .reduce((a, row) => a + row.prepaymentYearCents, 0)
    assert.equal(viaZeitraum, viaMietkonto, `Fall ${fall}: ${JSON.stringify(rules)}`)
  }
})

test('Wache: computeSettlement rechnet nicht mehr mit dem Kalenderjahr (#208)', () => {
  const source = fs.readFileSync(new URL('../src/calc.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export function computeSettlement(')
  const end = source.indexOf('\nexport ', start + 1)
  const body = source.slice(start, end < 0 ? undefined : end)
  for (const pattern of [/-12-31/, /-01-01/, /\byear - 1\b/, /\byear \+ 1\b/, /\bdaysInYear\(/, /\boverlapDays\(/, /\bdueMonthsOf\(/, /\byear\s*(>=|<=|===|!==|>|<)/, /\$\{year\}/]) {
    assert.doesNotMatch(body, pattern, `computeSettlement enthält ${pattern}`)
  }
})
