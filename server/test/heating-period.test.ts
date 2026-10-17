// Die eigene Heizperiode (#217, Entwurf 3.0, 3.1): Regeln, Zuordnung zur Abrechnung, Weg d und der
// Eigentümer eines Monats der Heizstaffel. Reine Funktionen aus shared/heatingPeriod.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  heatingPeriodsEndingIn, isObjectPeriod, monthSpanText, plantRules, recommendedDeadline, requestMonth, sameSpan,
  separateOwner, servesUnit, settledSeparately, spanOf, type PlantWay,
} from '../../shared/heatingPeriod.ts'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const MAI: PeriodRules = { startMonth: 5, changes: [] }
const of = (rules: PeriodRules, key: string): BillingPeriod => periodOfKey(rules, periodKey(key)) ?? assert.fail(`kein Zeitraum ${key}`)
const anlage = (over: Partial<PlantWay> = {}): PlantWay => ({ periodStartMonth: 5, periodChanges: [], separateSpans: [], ...over })
const keys = (ps: BillingPeriod[]) => ps.map((p) => p.key)

test('Regeln: ohne eigene Heizperiode die des Objekts, sonst die eigenen', () => {
  assert.deepEqual(plantRules(anlage({ periodStartMonth: null }), CALENDAR_RULES), CALENDAR_RULES)
  assert.deepEqual(plantRules(anlage({ periodStartMonth: null }), MAI), MAI)
  assert.deepEqual(plantRules(anlage({ periodChanges: ['2026-01'] }), CALENDAR_RULES), { startMonth: 5, changes: ['2026-01'] })
})

test('Zuordnung (VIII ZR 240/07): eine Heizperiode gehört in die Abrechnung, in der sie endet', () => {
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of(CALENDAR_RULES, '2026-01'))), ['2025-05'])
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of(CALENDAR_RULES, '2025-01'))), ['2024-05'])
  // Ein Wechsel kann zwei Heizperioden in eine Abrechnung legen, und eine andere bleibt ohne (3.0).
  const wechsel: PeriodRules = { startMonth: 5, changes: ['2026-01'] }
  assert.deepEqual(keys(heatingPeriodsEndingIn(wechsel, of(CALENDAR_RULES, '2025-01'))), ['2024-05', '2025-05'])
  assert.deepEqual(keys(heatingPeriodsEndingIn(wechsel, of(CALENDAR_RULES, '2026-01'))), ['2026-01'])
  // Rumpf des Objekts 01.01.–31.03.2025: Die Heizperiode Mai–April endet erst im April.
  assert.deepEqual(keys(heatingPeriodsEndingIn(MAI, of({ startMonth: 1, changes: ['2025-04'] }, '2025-01'))), [])
})

test('H = P: dieselben Grenzen, nicht derselbe Schlüssel', () => {
  assert.equal(isObjectPeriod(CALENDAR_RULES, of(CALENDAR_RULES, '2025-01')), true)
  assert.equal(isObjectPeriod(CALENDAR_RULES, of(MAI, '2025-05')), false)
  // Gleicher Schlüssel, andere Grenzen: Rumpf 01–04/2025 des Objekts gegen das Kalenderjahr der Anlage.
  assert.equal(isObjectPeriod({ startMonth: 1, changes: ['2025-05'] }, of(CALENDAR_RULES, '2025-01')), false)
  assert.equal(sameSpan(of(MAI, '2025-05'), { from: '2025-05-01', to: '2026-04-30' }), true)
})

test('Weg d nur mit eigener Heizperiode, in der Spanne und bei H ≠ P (A3, D1)', () => {
  const offen = anlage({ separateSpans: [{ from: '2025-05', until: null }] })
  assert.equal(settledSeparately(offen, CALENDAR_RULES, of(MAI, '2025-05')), true)
  assert.equal(settledSeparately(offen, CALENDAR_RULES, of(MAI, '2024-05')), false, 'vor der Spanne')
  const zu = anlage({ separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })
  assert.equal(settledSeparately(zu, CALENDAR_RULES, of(MAI, '2025-05')), true)
  assert.equal(settledSeparately(zu, CALENDAR_RULES, of(MAI, '2026-05')), false, 'ab W nicht mehr')
  assert.equal(settledSeparately(anlage({ periodStartMonth: null, separateSpans: [{ from: periodKey('2025-01'), until: null }] }), CALENDAR_RULES, of(CALENDAR_RULES, '2025-01')), false, 'ohne eigene Heizperiode nie')
  // B2: Die Heizperiode wechselt auf Januar; ab 2026 ist H = P und damit kein Weg d mehr.
  const b2 = anlage({ periodChanges: ['2026-01'], separateSpans: [{ from: '2025-05', until: null }] })
  const rules = plantRules(b2, CALENDAR_RULES)
  assert.equal(settledSeparately(b2, CALENDAR_RULES, of(rules, '2025-05')), true, 'der Rumpf Mai–Dezember 2025')
  assert.equal(settledSeparately(b2, CALENDAR_RULES, of(rules, '2026-01')), false, 'H = P')
  assert.equal(spanOf([{ from: '2025-05', until: null }], of(MAI, '2030-05'))?.from, '2025-05')
})

test('Weg d ab einem Monat mitten in der Heizperiode (C3): die Heizperiode ist getrennt, ihre Monate davor gehören P', () => {
  const ab2026 = anlage({ separateSpans: [{ from: '2026-01', until: null }] })
  assert.equal(settledSeparately(ab2026, CALENDAR_RULES, of(MAI, '2025-05')), true, 'sie reicht in die Spanne')
  assert.equal(settledSeparately(ab2026, CALENDAR_RULES, of(MAI, '2024-05')), false)
  assert.equal(separateOwner(ab2026, CALENDAR_RULES, '2025-12'), null, 'vor X rechnet P an')
  assert.equal(separateOwner(ab2026, CALENDAR_RULES, '2026-01')?.key, '2025-05')
})

test('Eigentümer eines Monats der Heizstaffel: die getrennte Heizperiode, sonst niemand (also P)', () => {
  const d1 = anlage({ separateSpans: [{ from: '2025-05', until: periodKey('2026-05') }] })
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2025-04'), null)
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2025-05')?.key, '2025-05')
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2026-04')?.key, '2025-05')
  assert.equal(separateOwner(d1, CALENDAR_RULES, '2026-05'), null, 'ab W gehört der Monat wieder P (D1)')
  assert.equal(separateOwner(anlage({ periodStartMonth: null }), CALENDAR_RULES, '2025-07'), null)
})

test('Versorgte Wohnungen: ohne Liste alle mit Wärmeanschluss, mit Liste genau diese', () => {
  assert.equal(servesUnit({ units: null }, { id: 'u1' }), true)
  assert.equal(servesUnit({ units: null }, { id: 'g', noConnection: ['waerme'] }), false)
  assert.equal(servesUnit({ units: [{ unitId: 'u2' }] }, { id: 'u1' }), false)
  assert.equal(servesUnit({ units: [] }, { id: 'u1' }), false)
})

test('Empfohlene Frist einer Abrechnung nur mit Heizkosten (R-A4, 15.1 Nr. 2)', () => {
  // Auszug 31.10.2025 im Kalenderjahr: zwölf Monate nach Ende von 2025.
  assert.equal(recommendedDeadline(CALENDAR_RULES, '2025-10-31'), '2026-12-31')
  assert.equal(recommendedDeadline(MAI, '2025-10-31'), '2027-04-30')
  // Die Abrechnung des Messdienstes zwei Monate vorher anfordern (Entwurf 3.1, L3: 31.12.2026 → Oktober 2026).
  assert.equal(requestMonth('2026-12-31'), 'Oktober 2026')
  assert.equal(requestMonth('2027-01-31'), 'November 2026')
})

test('Monate in Worten', () => {
  assert.equal(monthSpanText(['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']), 'Mai bis Dezember 2025')
  assert.equal(monthSpanText(['2025-12', '2026-01']), 'Dezember 2025 bis Januar 2026')
  assert.equal(monthSpanText(['2025-05']), 'Mai 2025')
  assert.equal(monthSpanText([]), '')
})

test('Jahr der Zahlung (Entwurf 3.10, Durchsicht von #231): Rechnungsdatum, sonst Ende der Heizperiode, geklemmt', async () => {
  const { paymentYear } = await import('../../shared/period.ts')
  const h = { from: '2025-05-01', to: '2026-04-30' }
  assert.deepEqual(paymentYear(h, '2025-11-20'), { year: 2025, clamped: false })
  assert.deepEqual(paymentYear(h, null), { year: 2026, clamped: false }, 'ohne Rechnungsdatum das Jahr des Endes')
  assert.deepEqual(paymentYear(h, '2029-01-15'), { year: 2027, clamped: true })
  assert.deepEqual(paymentYear(h, '2023-12-01'), { year: 2025, clamped: true })
  assert.deepEqual(paymentYear(h, null, 2025), { year: 2025, clamped: false }, 'eine andere Vorgabe, etwa das Jahr des Belegs')
})
