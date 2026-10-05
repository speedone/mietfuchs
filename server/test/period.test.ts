// Abrechnungszeiträume (#208): shared/period.ts ist die eine Stelle, an der Zeiträume entstehen.
// Geprüft wird an den Zahlen des Entwurfs (Abschnitt 3.8, 12.2) und an zufälligen Rhythmen mit
// festem Startwert, wie die Invarianten in calc.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CALENDAR_RULES, calendarContext, calendarPeriod, calendarYearPeriod, contextOf, isCalendarRules, parsePeriodKey, periodContaining,
  periodContext, periodDays, periodKey, periodLabel, periodMonths, periodOfKey, periodsBetween, previousPeriod,
  resolvePeriodParam, rulesOf, settlementDeadline, settlementPeriod, startYearOf,
} from '../../shared/period.ts'
import type { BillingPeriod, PeriodRules } from '../../shared/types.ts'

const of = (rules: PeriodRules, key: string): BillingPeriod => {
  const p = periodOfKey(rules, periodKey(key))
  if (!p) return assert.fail(`kein Zeitraum ${key} bei ${JSON.stringify(rules)}`)
  return p
}
const MAI: PeriodRules = { startMonth: 5, changes: [] }

test('Kalenderjahr: Schlüssel, Grenzen, Bezeichnung und Frist wie bisher', () => {
  const p = of(CALENDAR_RULES, '2025-01')
  assert.deepEqual(p, { key: '2025-01', from: '2025-01-01', to: '2025-12-31', short: false })
  assert.equal(periodLabel(p), '2025')
  assert.equal(settlementDeadline(p), '2026-12-31')
  assert.equal(periodDays(p), 365)
  assert.deepEqual(calendarYearPeriod(2025), p)
  assert.equal(calendarPeriod(2025), '2025-01')
  assert.equal(startYearOf(periodKey('2025-05')), 2025)
  assert.ok(isCalendarRules(CALENDAR_RULES))
  assert.equal(isCalendarRules(MAI), false)
  assert.equal(isCalendarRules({ startMonth: 1, changes: ['2025-05'] }), false)
})

test('Mai bis April: Bezeichnung über zwei Jahre, Frist zwölf Monate nach dem Ende', () => {
  const p = of(MAI, '2025-05')
  assert.deepEqual(p, { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false })
  assert.equal(periodLabel(p), '2025/2026')
  assert.equal(settlementDeadline(p), '2027-04-30')
  assert.equal(periodOfKey(MAI, periodKey('2025-01')), null, 'im Januar beginnt bei Mai–April kein Zeitraum')
})

test('Wechsel Kalenderjahr → Mai ab 2025-05: Rumpf 01.01.–30.04.2025 mit Frist 30.04.2026', () => {
  const rules: PeriodRules = { startMonth: 1, changes: ['2025-05'] }
  const rumpf = of(rules, '2025-01')
  assert.deepEqual(rumpf, { key: '2025-01', from: '2025-01-01', to: '2025-04-30', short: true })
  assert.equal(periodLabel(rumpf), '01.01.–30.04.2025')
  assert.equal(settlementDeadline(rumpf), '2026-04-30')
  assert.equal(periodDays(rumpf), 120)
  assert.deepEqual(of(rules, '2025-05'), { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false })
  assert.deepEqual(of(rules, '2024-01'), calendarYearPeriod(2024))
  assert.equal(periodOfKey(rules, periodKey('2026-01')), null)
  assert.deepEqual(previousPeriod(rules, of(rules, '2025-05')), rumpf)
  assert.deepEqual(previousPeriod(rules, rumpf), calendarYearPeriod(2024))
})

test('Rumpf über den Jahreswechsel und zurück zum Kalenderjahr', () => {
  const november: PeriodRules = { startMonth: 11, changes: ['2026-05'] }
  const rumpf = of(november, '2025-11')
  assert.deepEqual(rumpf, { key: '2025-11', from: '2025-11-01', to: '2026-04-30', short: true })
  assert.equal(periodLabel(rumpf), '01.11.2025–30.04.2026')
  const zurueck: PeriodRules = { startMonth: 5, changes: ['2026-01'] }
  assert.deepEqual(of(zurueck, '2025-05'), { key: '2025-05', from: '2025-05-01', to: '2025-12-31', short: true })
  assert.equal(periodLabel(of(zurueck, '2025-05')), '01.05.–31.12.2025')
  assert.deepEqual(of(zurueck, '2026-01'), calendarYearPeriod(2026))
})

test('Frist im Schaltjahr: 01.03.2023–29.02.2024 endet am 28.02.2025', () => {
  const p = of({ startMonth: 3, changes: [] }, '2023-03')
  assert.equal(p.to, '2024-02-29')
  assert.equal(settlementDeadline(p), '2025-02-28')
})

test('Schaltjahr: 01.05.2027–30.04.2028 hat 366 Tage', () => {
  assert.equal(periodDays(of(MAI, '2027-05')), 366)
})

test('Monate eines Zeitraums', () => {
  assert.deepEqual(periodMonths(of(MAI, '2025-05')), [
    '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  ])
  assert.deepEqual(periodMonths(of({ startMonth: 1, changes: ['2025-05'] }, '2025-01')), ['2025-01', '2025-02', '2025-03', '2025-04'])
})

test('Schlüssel: nur JJJJ-MM mit Monat 01 bis 12 (G-C3)', () => {
  for (const bad of ['2025-00', '2025-13', '2025', '2025-1', '25-01', '2025-01-01', ' 2025-01', '2025-01 ', 2025, null, undefined, {}]) {
    assert.equal(parsePeriodKey(bad), null, String(bad))
  }
  assert.equal(parsePeriodKey('2025-05'), '2025-05')
  assert.throws(() => periodKey('2025-13'), /kein Zeitraumschlüssel/)
})

test('Kontext: Schlüssel, Vorzeitraum und Bezeichnungen', () => {
  assert.deepEqual(calendarContext(2025), { key: '2025-01', previous: '2024-01', label: '2025', previousLabel: '2024', year: 2025, previousYear: 2024 })
  assert.deepEqual(periodContext(MAI, of(MAI, '2025-05')), {
    key: '2025-05', previous: '2024-05', label: '2025/2026', previousLabel: '2024/2025', year: 2025, previousYear: 2024,
  })
  assert.deepEqual(contextOf(of(MAI, '2025-05'), of(MAI, '2023-05')).previous, '2023-05', 'der Vorzeitraum kommt hinein, er wird nicht geraten')
  assert.deepEqual(settlementPeriod(of(MAI, '2025-05')), { key: '2025-05', from: '2025-05-01', to: '2026-04-30', short: false, label: '2025/2026' })
})

test('Regeln eines Objekts: ohne Angabe gilt das Kalenderjahr', () => {
  assert.deepEqual(rulesOf(undefined), CALENDAR_RULES)
  assert.deepEqual(rulesOf({}), CALENDAR_RULES)
  assert.deepEqual(rulesOf({ periodRules: MAI }), MAI)
})

test('Alias: eine nackte Jahreszahl nur beim reinen Kalenderobjekt (G-C6)', () => {
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025'), { period: calendarYearPeriod(2025) })
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025-01'), { period: calendarYearPeriod(2025) })
  assert.deepEqual(resolvePeriodParam(MAI, '2025-05'), { period: of(MAI, '2025-05') })
  assert.deepEqual(resolvePeriodParam(MAI, '2025'),
    { status: 404, error: 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 2025/2026?' })
  assert.deepEqual(resolvePeriodParam({ startMonth: 1, changes: ['2025-05'] }, '2025'),
    { status: 404, error: 'Den Zeitraum 2025 gibt es für dieses Objekt nicht; meinen Sie 01.01.–30.04.2025 oder 2025/2026?' })
  assert.deepEqual(resolvePeriodParam(MAI, '2025-03'),
    { status: 404, error: 'Einen Abrechnungszeitraum, der im März 2025 beginnt, gibt es für dieses Objekt nicht; meinen Sie 2024/2025?' })
  const ungueltig = { status: 400, error: 'Ungültiger Zeitraum: erwartet wird der Monat des Beginns als JJJJ-MM, etwa 2025-05.' }
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, '2025-13'), ungueltig)
  assert.deepEqual(resolvePeriodParam(CALENDAR_RULES, 'abc'), ungueltig)
})

// ---------- Invariante: die Zerlegung der Zeit (Entwurf 12.3 Nr. 3) ----------

// mulberry32: klein, schnell, mit festem Startwert reproduzierbar.
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
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const monthCount = (p: BillingPeriod): number =>
  (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1

// Zufällige Regeln, wie sie die Bedienung aus PR 3 zulässt: Ein Wechsel liegt nie auf einem Monat,
// in dem ohnehin ein Zeitraum beginnt; dort gäbe es keinen Rumpf, und es wäre kein Wechsel.
function randomRules(r: () => number): PeriodRules {
  const rules: PeriodRules = { startMonth: 1 + pick(r, 12), changes: [] }
  let cursor = 2020 * 12 + pick(r, 24)
  for (let n = pick(r, 4); n > 0; n--) {
    cursor += 1 + pick(r, 30)
    const key = `${Math.floor(cursor / 12)}-${String((cursor % 12) + 1).padStart(2, '0')}`
    if (periodContaining(rules, `${key}-01`).from === `${key}-01`) continue
    rules.changes.push(key)
  }
  return rules
}

test('Zerlegung: lückenlos, überschneidungsfrei, höchstens zwölf Monate, Rumpf genau vor jedem Wechsel', () => {
  const r = rng(208)
  for (let fall = 0; fall < 300; fall++) {
    const rules = randomRules(r)
    const all = periodsBetween(rules, '2019-01-01', '2032-12-31')
    const keys = new Set<string>()
    for (const [i, p] of all.entries()) {
      const months = monthCount(p)
      assert.ok(months >= 1 && months <= 12, `${JSON.stringify(rules)} ${p.key}: ${months} Monate`)
      assert.equal(p.short, months < 12, `${JSON.stringify(rules)} ${p.key}`)
      assert.equal(p.from.slice(8), '01')
      assert.ok(!keys.has(p.key), `Schlüssel doppelt: ${p.key}`)
      keys.add(p.key)
      assert.deepEqual(periodOfKey(rules, p.key), p)
      const next = all[i + 1]
      if (next) assert.equal(next.from, nextDay(p.to), `Lücke oder Überschneidung nach ${p.key} bei ${JSON.stringify(rules)}`)
    }
    for (const change of rules.changes) {
      const vorher = all.find((p) => nextDay(p.to) === `${change}-01`)
      assert.ok(vorher?.short, `vor dem Wechsel ${change} steht ein Rumpf (${JSON.stringify(rules)})`)
      assert.ok(all.some((p) => p.key === change), `mit dem Wechsel ${change} beginnt ein Zeitraum`)
    }
    for (let k = 0; k < 20; k++) {
      const day = new Date(Date.UTC(2020, 0, 1) + pick(r, 365 * 12) * 86400000).toISOString().slice(0, 10)
      const p = periodContaining(rules, day)
      assert.ok(p.from <= day && day <= p.to, `${day} liegt nicht in ${p.key}`)
    }
  }
})

// ---------- Wächter: Schlüssel entstehen nur hier ----------

test('Nur shared/period.ts macht aus Text einen Zeitraumschlüssel', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  // Zusammengesetzt, damit diese Datei sich nicht selbst findet.
  const needle = ['as', 'PeriodKey'].join(' ')
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(needle)) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  for (const dir of ['shared', 'server/src', 'server/test', 'server/testing', 'client/src']) walk(path.join(root, dir))
  assert.deepEqual(found, ['shared/period.ts'])
})
