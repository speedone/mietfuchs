// Abrechnungszeiträume (#208), berechnet aus Beginnmonat und Wechseln, nie gespeichert.
//
// Ein Objekt rechnet im Kalenderjahr ab oder in einem eigenen Rhythmus, etwa Mai bis April wie
// sein Messdienst. Wechselt der Rhythmus, endet der letzte Zeitraum des alten am Tag vor dem
// Wechsel (Rumpfzeitraum). So sind die Zeiträume lückenlos, überschneidungsfrei und nie länger als
// zwölf Monate, und zwar aus der Konstruktion und nicht aus einer Prüfung. Eine Tabelle mit einer
// Zeile je Zeitraum müsste jedes Jahr fortgeschrieben werden, und jede Zeile könnte eine Lücke
// erzeugen.
//
// Server und Oberfläche rechnen mit dieser Datei, deshalb liegt sie in shared/ (ein Laufzeitanteil
// wie heating.ts und glossary.ts). Sie hängt an keiner Uhr und an keiner Locale.

import type { BillingPeriod, PeriodKey, PeriodRules, SettlementPeriod } from './types.ts'

export const CALENDAR_RULES: PeriodRules = { startMonth: 1, changes: [] }

// § 556 Abs. 3 BGB: jährlich abrechnen, also höchstens zwölf Monate (Satz 1, herrschende Meinung),
// und zugehen muss die Abrechnung bis zum Ablauf des zwölften Monats nach dem Ende (Satz 2). Beide
// Zahlen kommen nach dem Merge von PR 1 aus dem Rechtsregister (`bgb.max-period-months`,
// `bgb.deadline-months`, Entwurf 4.3); bis dahin stehen sie hier und nur hier.
const MAX_PERIOD_MONTHS = 12
const DEADLINE_MONTHS = 12

const KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Monate als fortlaufende Zahl (Jahr · 12 + Monat − 1): „zwölf Monate später“ ist dann + 12.
const monthIndex = (year: number, month: number): number => year * 12 + month - 1
const yearOf = (index: number): number => Math.floor(index / 12)
const monthOf = (index: number): number => index - yearOf(index) * 12 + 1
const pad = (n: number, width: number): string => String(n).padStart(width, '0')
const monthText = (index: number): string => `${pad(yearOf(index), 4)}-${pad(monthOf(index), 2)}`
const firstDay = (index: number): string => `${monthText(index)}-01`
const lastDay = (index: number): string =>
  `${monthText(index)}-${pad(new Date(Date.UTC(yearOf(index), monthOf(index), 0)).getUTCDate(), 2)}`
const indexOfDate = (date: string): number => monthIndex(Number(date.slice(0, 4)), Number(date.slice(5, 7)))
const germanDate = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`

// Die beiden einzigen Stellen, an denen aus Text ein Schlüssel wird.
export function parsePeriodKey(value: unknown): PeriodKey | null {
  return typeof value === 'string' && KEY.test(value) ? (value as PeriodKey) : null
}
export function periodKey(text: string): PeriodKey {
  const key = parsePeriodKey(text)
  if (key === null) throw new Error(`„${text}“ ist kein Zeitraumschlüssel (JJJJ-MM).`)
  return key
}

const keyOf = (index: number): PeriodKey => periodKey(monthText(index))

// Der Zeitraum eines Kalenderjahres beginnt im Januar.
export const calendarPeriod = (year: number): PeriodKey => keyOf(monthIndex(year, 1))
// Das Kalenderjahr, in dem ein Zeitraum beginnt.
export const startYearOf = (key: PeriodKey): number => Number(key.slice(0, 4))

export const isCalendarRules = (rules: PeriodRules): boolean => rules.startMonth === 1 && rules.changes.length === 0
// Der Rhythmus eines Objekts. Fehlt die Angabe (ein Objekt aus einem Tab von vor dem Update, ein
// Test), gilt das Kalenderjahr.
export const rulesOf = (property?: { periodRules?: PeriodRules } | null): PeriodRules => property?.periodRules ?? CALENDAR_RULES

// ---------- Der Rhythmus als Folge von Abschnitten ----------

// Bis zum ersten Wechsel gilt der Beginnmonat, ab jedem Wechsel dessen Monat. Ungültige Wechsel
// fallen weg; die Datenbank lässt sie gar nicht erst zu (Prüfbedingung), verlassen wird sich darauf
// nicht.
type Rhythm = { initial: number; changes: number[] }

function rhythmOf(rules: PeriodRules): Rhythm {
  if (!Number.isInteger(rules.startMonth) || rules.startMonth < 1 || rules.startMonth > 12) {
    throw new Error(`Beginnmonat ${rules.startMonth} liegt nicht zwischen 1 und 12.`)
  }
  const changes = new Set<number>()
  for (const change of rules.changes) {
    const key = parsePeriodKey(change)
    if (key !== null) changes.add(indexOfDate(key))
  }
  return { initial: rules.startMonth, changes: [...changes].sort((a, b) => a - b) }
}

// Der Monat, in dem die Zeiträume am Monat `index` beginnen (1..12). Die 12 in `startOf` ist die
// Zahl der Monate eines Jahres, kein Rechtswert: Der Rhythmus wiederholt sich jährlich.
function anchorAt(r: Rhythm, index: number): number {
  let anchor = r.initial
  for (const change of r.changes) if (change <= index) anchor = monthOf(change)
  return anchor
}

// Der Beginn des Zeitraums, der den Monat `index` enthält. Ein Wechsel beginnt in seinem eigenen
// Monat, also im Takt seines Abschnitts; der gesuchte Beginn liegt deshalb nie vor ihm.
function startOf(r: Rhythm, index: number): number {
  const anchor = anchorAt(r, index)
  return index - ((((index - (anchor - 1)) % 12) + 12) % 12)
}

// Der Beginn des nächsten Zeitraums: zwölf Monate später, außer ein Wechsel kommt früher.
function nextStart(r: Rhythm, start: number): number {
  let next = start + MAX_PERIOD_MONTHS
  for (const change of r.changes) if (change > start && change < next) next = change
  return next
}

function periodAt(r: Rhythm, start: number): BillingPeriod {
  const next = nextStart(r, start)
  return { key: keyOf(start), from: firstDay(start), to: lastDay(next - 1), short: next - start < MAX_PERIOD_MONTHS }
}

// ---------- Zeiträume ----------

export function periodContaining(rules: PeriodRules, date: string): BillingPeriod {
  const r = rhythmOf(rules)
  return periodAt(r, startOf(r, indexOfDate(date)))
}

// `null`, wenn in diesem Monat kein Zeitraum beginnt.
export function periodOfKey(rules: PeriodRules, key: PeriodKey): BillingPeriod | null {
  const r = rhythmOf(rules)
  const index = indexOfDate(key)
  return startOf(r, index) === index ? periodAt(r, index) : null
}

// Alle Zeiträume, die die Spanne [from, to] berühren, in ihrer Reihenfolge.
export function periodsBetween(rules: PeriodRules, from: string, to: string): BillingPeriod[] {
  const r = rhythmOf(rules)
  const end = indexOfDate(to)
  const result: BillingPeriod[] = []
  for (let start = startOf(r, indexOfDate(from)); start <= end; start = nextStart(r, start)) result.push(periodAt(r, start))
  return result
}

export function previousPeriod(rules: PeriodRules, period: BillingPeriod): BillingPeriod {
  const r = rhythmOf(rules)
  return periodAt(r, startOf(r, indexOfDate(period.key) - 1))
}

export const calendarYearPeriod = (year: number): BillingPeriod => periodAt(rhythmOf(CALENDAR_RULES), monthIndex(year, 1))

// „2025“ für ein Kalenderjahr, „2025/2026“ für zwölf Monate über den Jahreswechsel, sonst die
// Grenzen des Rumpfs („01.01.–30.04.2025“, über den Jahreswechsel „01.11.2025–30.04.2026“).
export function periodLabel(p: BillingPeriod): string {
  const fromYear = p.from.slice(0, 4)
  const toYear = p.to.slice(0, 4)
  if (!p.short) return p.from.slice(5) === '01-01' ? fromYear : `${fromYear}/${toYear}`
  return fromYear === toYear ? `${p.from.slice(8, 10)}.${p.from.slice(5, 7)}.–${germanDate(p.to)}` : `${germanDate(p.from)}–${germanDate(p.to)}`
}

export const settlementPeriod = (p: BillingPeriod): SettlementPeriod => ({ ...p, label: periodLabel(p) })

// § 556 Abs. 3 S. 2 BGB: Die Abrechnung muss spätestens bis zum Ablauf des zwölften Monats nach
// Ende des Abrechnungszeitraums zugehen. Ein Zeitraum endet immer an einem Monatsende, die Frist
// also am Ende desselben Monats im Folgejahr. `months` reicht die Berechnung aus dem Rechtsregister
// herein, damit der Wert in `legalBasis.values` einfriert (Task 7).
export function settlementDeadline(p: Pick<BillingPeriod, 'to'>, months: number = DEADLINE_MONTHS): string {
  return lastDay(indexOfDate(p.to) + months)
}

export function periodDays(p: Pick<BillingPeriod, 'from' | 'to'>): number {
  return Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86400000) + 1
}

// Die Monate eines Zeitraums als 'JJJJ-MM', aufsteigend.
export function periodMonths(p: Pick<BillingPeriod, 'from' | 'to'>): string[] {
  const months: string[] = []
  for (let i = indexOfDate(p.from); i <= indexOfDate(p.to); i++) months.push(monthText(i))
  return months
}

// ---------- Ein Zeitraum und sein Vorzeitraum ----------

// Was der Vergleich mit dem Vorzeitraum braucht (gemerkter Schlüssel, Doppelungen, #141): beide
// Schlüssel, ihre Bezeichnungen und die Kalenderjahre des Beginns für Beschreibungen wie
// „Grundsteuer 2025“.
export type PeriodContext = { key: PeriodKey; previous: PeriodKey; label: string; previousLabel: string; year: number; previousYear: number }

export function contextOf(p: BillingPeriod, previous: BillingPeriod): PeriodContext {
  return { key: p.key, previous: previous.key, label: periodLabel(p), previousLabel: periodLabel(previous), year: startYearOf(p.key), previousYear: startYearOf(previous.key) }
}

export const periodContext = (rules: PeriodRules, p: BillingPeriod): PeriodContext => contextOf(p, previousPeriod(rules, p))

export const calendarContext = (year: number): PeriodContext => periodContext(CALENDAR_RULES, calendarYearPeriod(year))

// ---------- Der Zeitraum einer Anfrage ----------

export type PeriodResolution = { period: BillingPeriod } | { status: 400 | 404; error: string }

const orList = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} oder ${items[items.length - 1] ?? ''}`

// `JJJJ-MM`, oder die nackte Jahreszahl **nur bei einem reinen Kalenderobjekt** (G-C6). Sonst nennt
// die Ablehnung, was gemeint sein könnte: Ein Tab von vor einem Wechsel bekäme sonst still den
// Rumpf, der zufällig im Januar beginnt.
export function resolvePeriodParam(rules: PeriodRules, text: string): PeriodResolution {
  if (/^\d{4}$/.test(text)) {
    if (isCalendarRules(rules)) return { period: calendarYearPeriod(Number(text)) }
    const starting = periodsBetween(rules, `${text}-01-01`, `${text}-12-31`).filter((p) => p.from.startsWith(`${text}-`)).map(periodLabel)
    return { status: 404, error: `Den Zeitraum ${text} gibt es für dieses Objekt nicht; meinen Sie ${orList(starting)}?` }
  }
  const key = parsePeriodKey(text)
  if (key === null) return { status: 400, error: 'Ungültiger Zeitraum: erwartet wird der Monat des Beginns als JJJJ-MM, etwa 2025-05.' }
  const period = periodOfKey(rules, key)
  if (period) return { period }
  const month = MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)
  return {
    status: 404,
    error: `Einen Abrechnungszeitraum, der im ${month} ${key.slice(0, 4)} beginnt, gibt es für dieses Objekt nicht; meinen Sie ${periodLabel(periodContaining(rules, `${key}-01`))}?`,
  }
}
