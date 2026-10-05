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
import type { BillingPeriod, PeriodChangeAnswers, PeriodChangePreview, PeriodKey, PeriodRules } from './types'
import { ApiError, parseEuro } from './api'

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

// ---------- Rhythmus ändern (#208, Entwurf 3.6) ----------

export const MONTH_OPTIONS: { value: number; label: string }[] = MONTH_NAMES.map((label, i) => ({ value: i + 1, label }))

const rhythmOfMonth = (month: number): string =>
  month === 1 ? 'Kalenderjahr (Januar bis Dezember)' : `${MONTH_NAMES[month - 1] ?? ''} bis ${MONTH_NAMES[(month + 10) % 12] ?? ''}`

// Der Rhythmus in Worten: „Kalenderjahr (Januar bis Dezember)“, „Mai bis April“, mit Wechseln
// „…, ab Mai 2025: Mai bis April“.
export function rhythmText(rules: PeriodRules): string {
  const parts = [rhythmOfMonth(rules.startMonth)]
  for (const change of rules.changes) {
    const month = Number(change.slice(5, 7))
    parts.push(`ab ${MONTH_NAMES[month - 1] ?? ''} ${change.slice(0, 4)}: ${rhythmOfMonth(month)}`)
  }
  return parts.join(', ')
}

// Was geändert wird: der Beginnmonat von Anfang an (alle Zeiträume ohne Wechsel bekommen ihn) oder
// ein Wechsel ab einem Monat (ab dort beginnt jeder Zeitraum in diesem Monat, davor ein Rumpf).
export type RhythmForm = { mode: 'start' | 'change'; month: number; from: string }

export function nextRules(current: PeriodRules, form: RhythmForm): PeriodRules | { error: string } {
  if (form.mode === 'start') return { startMonth: form.month, changes: [...current.changes] }
  if (parsePeriodKey(form.from) === null) return { error: 'Bitte geben Sie an, ab welchem Monat der neue Zeitraum beginnt.' }
  return { startMonth: current.startMonth, changes: [...current.changes, form.from].sort() }
}

export function withoutChange(current: PeriodRules, from: string): PeriodRules {
  return { startMonth: current.startMonth, changes: current.changes.filter((c) => c !== from) }
}

// Die Antworten zur Vorschau, wie das Formular sie hält: je Gruppe der gewählte Zeitraum, je
// Mietverhältnis und gefragtem Zeitraum ein Betrag oder „keine Korrektur“.
export type AnswerForm = {
  groups: Record<string, string>
  overrides: Record<string, Record<string, { amount: string; none: boolean }>>
  // Das Jahr der Zahlung je Eintrag der Vorschau (Durchsicht von #226, I1), als Text der Auswahl
  taxYears: Record<string, string>
}

export function initialAnswers(preview: PeriodChangePreview): AnswerForm {
  return {
    groups: Object.fromEntries(preview.groups.map((g) => [g.from, g.suggested])),
    overrides: Object.fromEntries(preview.overrides.map((o) => [o.tenancyId, Object.fromEntries(o.ask.map((a) => [a.period, { amount: '', none: false }]))])),
    taxYears: Object.fromEntries(preview.taxYears.map((t) => [t.key, String(t.suggested)])),
  }
}

// Ohne Antwort wird nicht gespeichert (N4): Jeder gefragte Zeitraum braucht einen Betrag oder
// ausdrücklich „keine Korrektur“; eine tatsächlich gezahlte Summe lässt sich nicht verteilen.
export function answersOf(preview: PeriodChangePreview, form: AnswerForm): PeriodChangeAnswers | { error: string } {
  const overrides: Record<string, Record<string, number | null>> = {}
  for (const o of preview.overrides) {
    const given = form.overrides[o.tenancyId] ?? {}
    const out: Record<string, number | null> = {}
    for (const a of o.ask) {
      const entry = given[a.period] ?? { amount: '', none: false }
      if (entry.none) { out[a.period] = null; continue }
      if (entry.amount.trim() === '') return { error: `Bitte tragen Sie für ${o.tenantName} ein, was ${a.months} tatsächlich gezahlt wurde, oder wählen Sie „keine Korrektur“.` }
      const cents = parseEuro(entry.amount)
      if (cents === null || cents < 0) return { error: `Bitte tragen Sie für ${o.tenantName} ein, was ${a.months} tatsächlich gezahlt wurde, als Euro-Betrag, etwa 700,00.` }
      out[a.period] = cents
    }
    overrides[o.tenancyId] = out
  }
  // Die Marke der Vorschau geht mit (M2): Hat sich der Bestand seitdem geändert, lehnt der Server mit
  // der neuen Vorschau ab, statt eine gewachsene Gruppe ungesehen mitzuziehen.
  const taxYears = Object.fromEntries(preview.taxYears.flatMap((t) => {
    const y = Number(form.taxYears[t.key] ?? t.suggested)
    return Number.isInteger(y) ? [[t.key, y]] : []
  }))
  return { groups: { ...form.groups }, overrides, taxYears, token: preview.token }
}

// Die neue Vorschau aus der 409 eines Wechsels (M2), sonst `null`.
export function conflictPreview(e: unknown): PeriodChangePreview | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const p = e.data.preview
  return p !== null && typeof p === 'object' ? p as PeriodChangePreview : null
}

// Ein Wechsel in Worten: „Mai 2025“ statt '2025-05' (M5).
export const changeLabel = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`
