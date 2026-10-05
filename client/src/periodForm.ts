// Der Zeitraumumschalter (#208, Entwurf 11.4), ohne DOM. Die Oberfläche ist immer „in“ einem
// Abrechnungszeitraum des gewählten Objekts und daneben in einem Kalenderjahr (Mietkonto, Steuer).
//
// Gewählt wird ein **Tag**, nicht ein Schlüssel: Der Zeitraum ist der, der ihn enthält. So passt ein
// Wechsel des Objekts den Zeitraum von selbst an (Teilentwurf 10: „auf den zum gleichen Tag
// passenden des neuen Objekts“), und ein Wechsel des Rhythmus lässt keinen gewählten Schlüssel ins
// Leere zeigen. Ohne Wahl gilt der zuletzt beendete Zeitraum: beim Kalenderjahr das Vorjahr, wie
// bisher.
//
// **Ein Kalenderobjekt sieht aus wie bisher**: Der Umschalter heißt „Abrechnungsjahr“, seine Werte
// sind Jahreszahlen, und die Routen bekommen die Jahreszahl (`param`), die sie bei einem
// Kalenderobjekt wie bisher annehmen (PR 2, G-C6). Erst bei einem anderen Rhythmus stehen dort
// Schlüssel wie '2025-05'.

import { contextOf, isCalendarRules, parsePeriodKey, periodContaining, periodLabel, periodOfKey, periodsBetween, previousPeriod, startYearOf, type PeriodContext } from '../../shared/period.ts'
import type { BillingPeriod, PeriodKey, PeriodRules } from './types'

export type PeriodChoice = { anchor: string | null; calendarYear: number | null }
export type PeriodOption = { value: string; label: string }
export type PeriodView = {
  rules: PeriodRules
  calendar: boolean
  period: BillingPeriod
  key: PeriodKey
  label: string
  at: PeriodContext
  // Der Wert für die Routen und die Auswahl: die Jahreszahl beim Kalenderobjekt, sonst der Schlüssel.
  param: string
  // Das Kalenderjahr, in dem der Zeitraum beginnt (Belege, Kabelhinweis im Formular).
  year: number
  options: PeriodOption[]
  // Mietkonto und Steuer (Entwurf 3.10, 3.11). Beim Kalenderobjekt dasselbe Jahr wie der Zeitraum.
  calendarYear: number
  calendarYearOptions: number[]
  switcherLabel: string
}

const OPTION_YEARS = 8
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Der heutige Tag auf dem Rechner des Nutzers, wie bisher `new Date().getFullYear()`.
export function localToday(): string {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function periodView(rules: PeriodRules, choice: PeriodChoice, today: string): PeriodView {
  const calendar = isCalendarRules(rules)
  const period = choice.anchor !== null ? periodContaining(rules, choice.anchor) : previousPeriod(rules, periodContaining(rules, today))
  const thisYear = Number(today.slice(0, 4))
  const listed = periodsBetween(rules, `${thisYear - (OPTION_YEARS - 1)}-01-01`, today)
  if (!listed.some((p) => p.key === period.key)) listed.push(period)
  listed.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  const valueOf = (p: BillingPeriod): string => (calendar ? String(startYearOf(p.key)) : p.key)
  const year = startYearOf(period.key)
  const calendarYear = calendar ? year : choice.calendarYear ?? year
  const calendarYearOptions = Array.from({ length: OPTION_YEARS }, (_, k) => thisYear - k)
  if (!calendarYearOptions.includes(calendarYear)) calendarYearOptions.push(calendarYear)
  calendarYearOptions.sort((a, b) => b - a)
  return {
    rules,
    calendar,
    period,
    key: period.key,
    label: periodLabel(period),
    at: contextOf(period, previousPeriod(rules, period)),
    param: valueOf(period),
    year,
    options: listed.map((p) => ({ value: valueOf(p), label: p.short ? `${periodLabel(p)} (Rumpf)` : periodLabel(p) })),
    calendarYear,
    calendarYearOptions,
    switcherLabel: calendar ? 'Abrechnungsjahr' : 'Abrechnungszeitraum',
  }
}

// Der Tag zu einem Wert der Auswahl: eine Jahreszahl (Kalenderobjekt) ist ihr 1. Januar, ein
// Schlüssel der Beginn seines Zeitraums. `null`, wenn es den Zeitraum nicht gibt.
export function anchorOf(rules: PeriodRules, value: string): string | null {
  if (/^\d{4}$/.test(value)) return `${value}-01-01`
  const key = parsePeriodKey(value)
  const p = key === null ? null : periodOfKey(rules, key)
  return p === null ? null : p.from
}

// Die Bezeichnung eines Schlüssels; einer, den es nicht gibt, bleibt, wie er ist.
export function labelOfKey(rules: PeriodRules, key: PeriodKey): string {
  const p = periodOfKey(rules, key)
  return p === null ? key : periodLabel(p)
}

// „Mai 2025 bis April 2026“, für den Satz im Mietkonto (Entwurf 3.11).
export function periodSpanText(p: Pick<BillingPeriod, 'from' | 'to'>): string {
  const name = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`
  return `${name(p.from)} bis ${name(p.to)}`
}
