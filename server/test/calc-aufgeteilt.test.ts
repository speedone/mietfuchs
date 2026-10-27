// Teile einer aufgeteilten Rechnung in der Berechnung (#454): Was die ganze Rechnung beschreibt (`whole` in
// SPLIT_FIELDS), wird mit dem Tagesanteil des Teils verglichen, und ein Teil meldet nichts, was die ungeteilte
// Rechnung nicht meldet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement, type ComputedSettlement } from '../src/calc.ts'
import { splitByService } from '../src/serviceSplit.ts'
import { snapshotOf, snapshotOfPeriod, type SnapshotCostItem, type SnapshotSource, type SnapshotTenancy, type SnapshotUnit } from '../src/snapshot.ts'
import { calendarPeriod, periodKey, periodOfKey, previousPeriod } from '../../shared/period.ts'
import { partShare, SPLIT_FIELDS } from '../../shared/splitPart.ts'
import type { CostKey, PeriodRules } from '../../shared/types.ts'

const tenancy = (id: string, unitId: string): SnapshotTenancy => ({
  id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const source = (units: SnapshotUnit[], tenancies: SnapshotTenancy[], costItems: SnapshotCostItem[]): SnapshotSource => ({
  units, tenancies, costItems, meters: [], readings: [], payments: [], closedSettlements: [],
})
const settleIn = (rules: PeriodRules, key: string, src: SnapshotSource): ComputedSettlement => {
  const p = periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
  return computeSettlement(snapshotOfPeriod(src, p, previousPeriod(rules, p)))
}

// Der Fall aus #454: Wechsel ab 07/2025 und ab 01/2026, Rumpf 01.07.–31.12.2025; Hausgeldabrechnung ab 01.06.2025,
// 100 € = 2.000 € · 50/1.000 MEA, davon 184 von 214 Tagen im Rumpf: 85,98 €.
const ISSUE: PeriodRules = { startMonth: 1, changes: ['2025-07', '2026-01'] }
const etw = (amountCents: number) => source(
  [{ id: 'w', name: 'ETW', areaM2: 60, participates: true, mea: 50 }],
  [tenancy('t', 'w')],
  [{ id: 'h', period: periodKey('2025-07'), category: 'Hauswart', description: 'Hausmeisterkosten (anteilig 01.07.–31.12.2025)', amountCents, key: 'external',
    externalBasis: { measure: 'mea', total: 1000, totalCents: 200000 }, serviceFrom: '2025-06-01', serviceTo: '2025-12-31' }],
)

test('#454: der Teil einer Rechnung „laut Gemeinschaftsabrechnung“ passt zum gekürzten Anteil, kein Hinweis, kein Vermerk im Druck', () => {
  const s = settleIn(ISSUE, '2025-07', etw(8598))
  assert.deepEqual(s.notices.filter((n) => n.code === 'external.amount-mismatch'), [])
  assert.doesNotMatch(JSON.stringify(s.statements), /angesetzt laut Hausgeldabrechnung/, 'der Mieter sähe sonst eine Abweichung, die es nicht gibt')
})

test('#454: ein Teil mit wirklich falschem Betrag meldet weiter, mit dem gekürzten Anteil und den Tagen', () => {
  const s = settleIn(ISSUE, '2025-07', etw(5000))
  const n = s.notices.find((x) => x.code === 'external.amount-mismatch') ?? assert.fail('kein Hinweis')
  assert.equal(n.text, '„Hausmeisterkosten (anteilig 01.07.–31.12.2025)“: der Betrag 50,00 € passt nicht zum rechnerischen Anteil 85,98 € (50 von 1.000 MEA aus 2.000,00 €, davon 184 von 214 Tagen des Leistungszeitraums) — bitte die Angaben aus der Gemeinschaftsabrechnung prüfen. Verteilt wird der eingetragene Betrag.')
  assert.match(JSON.stringify(s.statements), /angesetzt laut Hausgeldabrechnung/)
})

test('#454: Einzelbeträge in einem Teil von vor 0.13.1 sagen, was zu tun ist', () => {
  const src = source([{ id: 'w', name: 'EG', areaM2: 60, participates: true }], [tenancy('t', 'w')],
    [{ id: 'g', period: calendarPeriod(2025), category: 'Gartenpflege', description: 'Garten (anteilig 01.07.–31.12.2025)', amountCents: 5041, key: 'amounts',
      tenancyAmounts: { t: 10000 }, serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }])
  const n = computeSettlement(snapshotOf(src, 2025)).notices.find((x) => x.code === 'amounts.exceed') ?? assert.fail('kein Fehler')
  assert.match(n.text, /Tragen Sie in jedem Teil die Einzelbeträge ein, die auf diesen Zeitraum entfallen\.$/)
})

test('partShare: Tage im Zeitraum von den Tagen des Leistungszeitraums; ganz drin, ganz draußen, Heizung und ohne: null', () => {
  const p = { from: '2025-07-01', to: '2025-12-31' }
  assert.deepEqual(partShare({ category: 'Hauswart', serviceFrom: '2025-06-01', serviceTo: '2025-12-31' }, p), { days: 184, of: 214 })
  assert.equal(partShare({ category: 'Hauswart', serviceFrom: '2025-07-01', serviceTo: '2025-12-31' }, p), null)
  assert.equal(partShare({ category: 'Hauswart', serviceFrom: '2024-01-01', serviceTo: '2024-12-31' }, p), null)
  assert.equal(partShare({ category: 'Heizung und Warmwasser', serviceFrom: '2025-06-01', serviceTo: '2025-12-31' }, p), null)
  assert.equal(partShare({ category: 'Hauswart' }, p), null)
})

// Invariante (#454): Eine Rechnung über 07/2025–06/2026 wird so geteilt, wie `writeCostItemParts` es schreibt
// (die Felder `part` neu, alle übrigen geerbt). Kein Teil darf einen Hinweis bringen, den dieselbe Rechnung ungeteilt
// in einem Zeitraum nicht hat; ausgenommen die Hinweise zum Zeitraum selbst. Einzelbeträge werden nie geteilt
// (`noSplit`) und fehlen deshalb im Generator.
const makeRng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

test('Invariante (#454): ein Teil meldet nichts, was die ungeteilte Rechnung nicht meldet', () => {
  const rnd = makeRng(454)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] ?? assert.fail('leere Auswahl')
  const calendar: PeriodRules = { startMonth: 1, changes: [] }
  const noSplit = Object.entries(SPLIT_FIELDS).filter(([, r]) => r === 'noSplit').map(([f]) => f)
  assert.deepEqual(noSplit, ['tenancyAmounts', 'selfAmounts'], 'ein neues Feld `noSplit` gehört in den Generator oder in diese Liste')
  for (let i = 0; i < 300; i++) {
    const units: SnapshotUnit[] = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => ({
      id: `u${k}`, name: `W${k}`, areaM2: 20 + Math.floor(rnd() * 80), participates: true, mea: 10 + Math.floor(rnd() * 200),
    }))
    const tenancies = units.filter(() => rnd() < 0.8).map((u, k) => tenancy(`t${k}`, u.id))
    const key = pick<CostKey>(['area', 'units', 'persons', 'external', 'custom', 'direct'])
    const amountCents = 100 + Math.floor(rnd() * 500000)
    const whole: SnapshotCostItem = { id: 'c', period: calendarPeriod(2025), category: 'Hauswart', description: 'Rechnung', amountCents, key }
    if (key === 'external') {
      const own = units.reduce((a, u) => a + (u.mea ?? 0), 0)
      const total = own + Math.floor(rnd() * 5000)
      // Meist stimmig, manchmal mit Tippfehler: Dann meldet die ungeteilte Rechnung auch, und der Teil darf es.
      whole.externalBasis = { measure: 'mea', total, totalCents: rnd() < 0.8 ? Math.round((amountCents * total) / own) : Math.floor(rnd() * 5000000) }
    }
    if (key === 'custom') whole.customShares = Object.fromEntries(units.map((u) => [u.id, Math.floor(100 / units.length)]))
    if (key === 'direct') whole.directUnitId = pick(units).id
    if (rnd() < 0.3) whole.labor35aCents = Math.floor(rnd() * amountCents)
    const codes = (s: ComputedSettlement) => new Set(s.notices.map((n) => n.code).filter((c) => !c.startsWith('period.')))
    const expected = codes(computeSettlement(snapshotOf(source(units, tenancies, [whole]), 2025)))
    const service = { serviceFrom: '2025-07-01', serviceTo: '2026-06-30' }
    const parts = splitByService(calendar, { ...whole, labor35aCents: whole.labor35aCents, ...service })
    assert.equal(parts.length, 2)
    for (const p of parts) {
      const item: SnapshotCostItem = { ...whole, ...service, period: p.period.key, amountCents: p.amountCents, description: p.description,
        ...(p.labor35aCents === null ? {} : { labor35aCents: p.labor35aCents }) }
      const got = codes(computeSettlement(snapshotOf(source(units, tenancies, [item]), Number(p.period.key.slice(0, 4)))))
      const extra = [...got].filter((c) => !expected.has(c))
      assert.deepEqual(extra, [], `Fall ${i}, Teil ${p.period.key}: ${JSON.stringify(whole)}`)
    }
  }
})

// Durchsicht von #454, Befund 2: Nach zwei Wechseln stehen zwei Teile derselben Rechnung im selben Zeitraum (so gewollt,
// db-wechsel.test.ts „Ein schon aufgeteilter Teil …“): 157,81 € für Januar bis April und 80,22 € für Mai und Juni,
// beide mit dem Leistungszeitraum 2025. Gemessen werden sie zusammen, 238,03 € gegen 480,00 € · 181/365 = 238,03 €.
test('#454: zwei Teile derselben Rechnung im selben Zeitraum werden zusammen gemessen', () => {
  const juli: PeriodRules = { startMonth: 1, changes: ['2025-07'] }
  const teil = (id: string, amountCents: number, anteil: string): SnapshotCostItem => ({ id, period: periodKey('2025-01'), category: 'Hauswart',
    description: `Hausmeister (anteilig ${anteil})`, amountCents, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 960000 },
    serviceFrom: '2025-01-01', serviceTo: '2025-12-31' })
  const units: SnapshotUnit[] = [{ id: 'w', name: 'ETW', areaM2: 60, participates: true, mea: 50 }]
  const s = settleIn(juli, '2025-01', source(units, [tenancy('t', 'w')], [teil('a', 15781, '01.01.–30.04.2025'), teil('b', 8022, '01.05.–30.06.2025')]))
  assert.deepEqual(s.notices.filter((n) => n.code === 'external.amount-mismatch'), [])
  assert.doesNotMatch(JSON.stringify(s.statements), /angesetzt laut Hausgeldabrechnung/)
  // Eine andere Rechnung derselben Kostenart (andere Beschreibung) zählt nicht mit.
  const fremd = { ...teil('c', 23803, '01.01.–30.06.2025'), description: 'Winterdienst' }
  const t = settleIn(juli, '2025-01', source(units, [tenancy('t', 'w')], [teil('a', 15781, '01.01.–30.04.2025'), fremd]))
  assert.deepEqual(t.notices.filter((n) => n.code === 'external.amount-mismatch').map((n) => n.text.slice(0, 20)), ['„Hausmeister (anteil'])
})
