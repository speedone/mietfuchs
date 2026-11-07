// Fälligkeit der Miete am Mietverhältnis und ab wann ein Monat Rückstand ist (#334, Entwurf
// docs/superpowers/specs/2026-11-07-faelligkeit-mietkonto-design.md). Reine Funktionen in UTC, ohne Uhr und ohne
// Datenzugriff; die Regeln stehen im Rechtsregister, die Feiertage in shared/holidays.ts. Der Server rechnet damit den
// Rückstand im Mietkonto und den Hinweis `prepayment.arrears`, die Oberfläche zeigt, was er ausrechnet.
//
// **Die Regel** (`effectiveRentDue`, Entwurf E1): eingestellt am Mietverhältnis (`rentDue`), sonst gesetzlich: zu Beginn,
// spätestens am dritten Werktag (§ 556b Abs. 1 BGB), für ein am 01.09.2001 bestehendes Mietverhältnis nach Ablauf des
// Monats (Art. 229 § 3 Abs. 1 Nr. 7 EGBGB mit § 551 BGB a. F.), entschieden über `bgb.rent-due-at-start` mit dem früheren
// von Vertragsdatum und Beginn.
//
// **Der Fälligkeitstag** (`rentDueOn`):
// - `startWorkday`: der dritte Werktag des Abschnitts, der Samstag zählt nicht (VIII ZR 129/09). Im Einzugsmonat beginnt
//   der Abschnitt am Mietbeginn, der Tag selbst zählt mit (Auslegung von Mietfuchs, E2, die spätere der beiden Lesarten).
// - `dayOfMonth`: der vereinbarte Tag, in kürzeren Monaten der letzte, nach § 193 BGB verschoben; im Einzugsmonat der
//   spätere von diesem Tag und dem dritten Werktag ab dem Mietbeginn (E2).
// - `inArrears`: der Tag nach Ablauf des Abschnitts (der Erste des Folgemonats, im Auszugsmonat der Tag nach dem
//   Mietende), nach § 193 BGB verschoben (Auslegung, E8 A: der spätere Tag).
// - `firstRentAtStart`: im ersten Monat der Mietbeginn, nach § 193 BGB verschoben.
// Als Feiertage zählen die des Landes **und** die einzelner Gemeinden (E5): Mietfuchs kennt die Gemeinde nicht, und
// gezählt verschieben sie den Tag nur nach hinten. Ohne Land der späteste Tag aller 16 Länder (E4).
//
// **Der erwartete Eingang** (`creditExpectedBy`, E3): Rechtzeitig ist der Mieter, wenn er den Auftrag bis zum
// Fälligkeitstag erteilt (VIII ZR 222/15); Mietfuchs kennt nur das Datum der Gutschrift. Deshalb der vierte
// Bankgeschäftstag nach dem Fälligkeitstag: bis zu drei bis zum Eingang bei der Bank des Vermieters
// (`bgb.transfer-execution-days`, §§ 675n Abs. 1, 675s Abs. 1 BGB) und einer für die Buchung
// (`practice.credit-booking-days`, Auslegung zu § 675t Abs. 1 BGB). Bankgeschäftstag ist Montag bis Freitag, kein
// Feiertag in irgendeinem Land, auch nicht in einer Gemeinde (die Bank des Mieters kann anderswo sitzen), und nicht
// 24. und 31.12. (`practice.bank-closed-days`). Rückstand ist ein Monat ab dem Tag danach (`arrearsFrom`).
//
// **Auflage aus #290** (E6): Mit Feiertagen rechnet der Rückstand nur, wenn jeder Tag vom Beginn des Abschnitts bis zum
// erwarteten Eingang geprüft ist (`holidaysCheckedOn`: jede am Tag geltende Fassung jedes `holiday.*` ist amtlich
// gelesen). Sonst gilt je Regel eine sichere obere Grenze ohne Feiertage (`safeArrearsFrom`): ein voller Monat, der zu
// Beginn oder an einem festen Tag bis zum 14. fällig ist, ab dem Ersten des Folgemonats (wie #133; der dritte Werktag liegt
// nie nach dem 7., und vier Bankgeschäftstage später ist es noch derselbe Monat, Invariante in rent-due.test.ts), jeder
// andere Monat (späterer fester Tag, nach Ablauf, Einzugsmonat, erste Miete bei Beginn) ab dem Ersten des übernächsten. Fälligkeitstag und
// erwarteter Eingang selbst sind eine Auskunft und werden immer mit Feiertagen genannt; was zählt, ist `arrearsFrom`.
//
// Die Fristregeln fragt jede Funktion mit `law()`; wer ein Protokoll hineinreicht (eine Abrechnung), bekommt die benutzten
// Fassungen dort eingetragen. Die Feiertage selbst werden nicht einzeln protokolliert: Sie zählen nur, wo sie geprüft
// sind, und ihre Fassungen stehen im Register.
//
// Daten sind 'JJJJ-MM-TT', Monate 'JJJJ-MM'.
import type { FederalState } from './types.ts'
import { addDays, FIRST_YEAR, holidaysOf, localHolidaysOf, STATE_CODES, weekdayOf } from './holidays.ts'
import { createLawLog, dayAfter, law, type LawLog } from './law/register.ts'
import { holidaysCheckedOn } from './holidaysChecked.ts'
import { bgbDeadlineOnWorkday, bgbRentDueAtStart, bgbRentDueSaturday, bgbRentDueWorkday, bgbTransferExecutionDays } from './law/bgb-betrkv.ts'
import { practiceBankClosedDays, practiceCreditBookingDays } from './law/practice.ts'
import { monthShare } from './monthRate.ts'

// Fehlend (oder `null` aus der Datenbank) heißt gesetzlich.
export type RentDueRule = 'startWorkday' | 'dayOfMonth' | 'inArrears'
export const RENT_DUE_RULES: readonly RentDueRule[] = ['startWorkday', 'dayOfMonth', 'inArrears']
export const isRentDueRule = (v: unknown): v is RentDueRule => typeof v === 'string' && RENT_DUE_RULES.some((r) => r === v)

// Was die Fälligkeit vom Mietverhältnis liest (Tenancy und SnapshotTenancy erfüllen das).
export type RentDueTerms = {
  start: string
  end: string | null
  contractDate?: string | null
  rentDue?: RentDueRule | null
  rentDueDay?: number | null
  firstRentAtStart?: boolean | null
}

// `holidaysChecked` ersetzt `holidaysCheckedOn` (für Tests beider Fälle); `log` nimmt die benutzten Fristregeln auf.
export type RentDueOptions = { holidaysChecked?: (date: string) => boolean; log?: LawLog }

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function checkMonth(month: string): void {
  if (!MONTH.test(month)) throw new RangeError(`„${month}“ ist kein Monat in der Form JJJJ-MM.`)
}
const lastDayOf = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
const nextMonth = (month: string): string => {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${String(y + 1).padStart(4, '0')}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`
}
const maxText = (a: string, b: string): string => (a >= b ? a : b)

// ---------- Prüfstand der Feiertage ----------

// Ob an einem Tag jede dann geltende Fassung jedes Feiertags amtlich gelesen ist (Auflage aus #290, E6), aus
// shared/holidaysChecked.ts; weitergereicht für Server und Tests.
export { holidaysCheckedOn }

// ---------- Feiertage für den Rückstand ----------

const holidayCache = new Map<string, ReadonlySet<string>>()

// Die Feiertage eines Landes im Jahr, landesweit und in einzelnen Gemeinden (E5).
function arrearsHolidays(year: number, state: FederalState): ReadonlySet<string> {
  const key = `${year}/${state}`
  let set = holidayCache.get(key)
  if (!set) {
    set = new Set([...holidaysOf(year, state), ...localHolidaysOf(year, state)].map((h) => h.date))
    holidayCache.set(key, set)
  }
  return set
}
const isArrearsHoliday = (date: string, state: FederalState): boolean => arrearsHolidays(Number(date.slice(0, 4)), state).has(date)

// Werktag für die Fälligkeit: kein Sonntag, kein Feiertag am Ort (auch einer Gemeinde), der Samstag nach dem Register.
function isDueWorkday(date: string, state: FederalState, saturday: boolean): boolean {
  const wd = weekdayOf(date)
  if (wd === 0 || (wd === 6 && !saturday)) return false
  return !isArrearsHoliday(date, state)
}

// Der n-te Werktag ab einem Tag (der Tag selbst zählt mit), Zahl und Samstag aus dem Register, gefragt an diesem Tag.
function nthWorkdayFrom(from: string, state: FederalState, log: LawLog): string {
  const nth = law(bgbRentDueWorkday, { date: from }, log)
  const saturday = law(bgbRentDueSaturday, { date: from }, log)
  let day = from
  let count = 0
  for (;;) {
    if (isDueWorkday(day, state, saturday) && ++count === nth) return day
    day = addDays(day, 1)
  }
}

// § 193 BGB am Ort, mit den Feiertagen einzelner Gemeinden; welche Tage verschieben, aus dem Register.
function onWorkday(date: string, state: FederalState, log: LawLog): string {
  const shift = law(bgbDeadlineOnWorkday, { date }, log)
  const moves = (d: string): boolean => {
    const wd = weekdayOf(d)
    return (shift.saturday && wd === 6) || (shift.sunday && wd === 0) || (shift.holiday && isArrearsHoliday(d, state))
  }
  let day = date
  while (moves(day)) day = addDays(day, 1)
  return day
}

// ---------- Regel und Fälligkeitstag ----------

// Die Regel, die für das Mietverhältnis gilt: eingestellt oder gesetzlich (E1).
export function effectiveRentDue(t: RentDueTerms, log: LawLog = createLawLog()): RentDueRule {
  if (isRentDueRule(t.rentDue)) return t.rentDue
  const contract = typeof t.contractDate === 'string' && ISO_DATE.test(t.contractDate) ? t.contractDate : null
  const since = contract !== null && contract < t.start ? contract : t.start
  return law(bgbRentDueAtStart, { date: since }, log) ? 'startWorkday' : 'inArrears'
}

// Beginn des Abschnitts im Monat: der Mietbeginn im Einzugsmonat, sonst der Erste.
function sectionStart(t: RentDueTerms, month: string): string {
  const first = `${month}-01`
  return t.start.slice(0, 7) === month && t.start > first ? t.start : first
}
const isFirstMonth = (t: RentDueTerms, month: string): boolean => t.start.slice(0, 7) === month
const isMoveInMonth = (t: RentDueTerms, month: string): boolean => sectionStart(t, month) !== `${month}-01`

// Der feste Tag, geprüft an einer Stelle (Durchsicht K6): auch im ersten Monat mit Miete bei Beginn, wo er nicht zählt.
function agreedDay(t: RentDueTerms): number {
  const day = t.rentDueDay
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError('Für die Fälligkeit an einem festen Tag fehlt der Tag (1 bis 31).')
  }
  return day
}

// Ein Monat ohne Tag im Mietverhältnis hat keine Fälligkeit; ihn zu fragen ist ein Programmfehler (Durchsicht S1), sonst
// zählte ein Rückstand für einen Monat, den es nicht gibt.
function checkTenancyMonth(t: RentDueTerms, month: string): void {
  checkMonth(month)
  if (monthShare(t, month).days === 0) throw new RangeError(`Im Monat ${month} besteht das Mietverhältnis nicht.`)
}

function dueInState(t: RentDueTerms, month: string, state: FederalState, log: LawLog): string {
  const rule = effectiveRentDue(t, log)
  const day = rule === 'dayOfMonth' ? agreedDay(t) : 0
  if (isFirstMonth(t, month) && t.firstRentAtStart === true) return onWorkday(t.start, state, log)
  const from = sectionStart(t, month)
  if (rule === 'startWorkday') return nthWorkdayFrom(from, state, log)
  if (rule === 'dayOfMonth') {
    const agreed = onWorkday(`${month}-${String(Math.min(day, lastDayOf(month))).padStart(2, '0')}`, state, log)
    return from === `${month}-01` ? agreed : maxText(agreed, nthWorkdayFrom(from, state, log))
  }
  const last = `${month}-${String(lastDayOf(month)).padStart(2, '0')}`
  const sectionEnd = t.end !== null && t.end < last ? t.end : last
  return onWorkday(dayAfter(sectionEnd), state, log)
}

// Der Fälligkeitstag der Miete des Monats; ohne Land der späteste aller Länder. Der Monat muss einen Tag im
// Mietverhältnis haben, und gerechnet wird ab 1995 (`FIRST_YEAR` der Feiertage).
export function rentDueOn(t: RentDueTerms, month: string, state: FederalState | null, options: RentDueOptions = {}): string {
  checkTenancyMonth(t, month)
  const log = options.log ?? createLawLog()
  const states = state === null ? STATE_CODES : [state]
  return states.map((s) => dueInState(t, month, s, log)).reduce(maxText)
}

// ---------- erwarteter Eingang ----------

// Bankgeschäftstag (E3, Auslegung, vorsichtig): Montag bis Freitag, kein Feiertag in irgendeinem Land oder einer
// Gemeinde, kein Tag ohne Geschäftsbetrieb (24. und 31.12., gefragt am Tag).
export function isBankBusinessDay(date: string, options: Pick<RentDueOptions, 'log'> = {}): boolean {
  const wd = weekdayOf(date)
  if (wd === 0 || wd === 6) return false
  if (law(practiceBankClosedDays, { date }, options.log ?? createLawLog()).includes(date.slice(5, 10))) return false
  return !STATE_CODES.some((s) => isArrearsHoliday(date, s))
}

// Der späteste Tag, an dem eine bis zum Fälligkeitstag beauftragte Überweisung gebucht ist: der vierte
// Bankgeschäftstag danach (Zahl der Tage aus dem Register, gefragt am Fälligkeitstag).
export function creditExpectedBy(dueOn: string, options: Pick<RentDueOptions, 'log'> = {}): string {
  const log = options.log ?? createLawLog()
  const transfer = law(bgbTransferExecutionDays, { date: dueOn }, log)
  const days = transfer.afterCutoff + transfer.execution + transfer.paper + law(practiceCreditBookingDays, { date: dueOn }, log)
  let day = dueOn
  for (let n = 0; n < days;) {
    day = addDays(day, 1)
    if (isBankBusinessDay(day, { log })) n++
  }
  return day
}

// ---------- ab wann Rückstand ----------

// Die sichere Grenze ohne Feiertage (E6): ein voller Monat, der zu Beginn oder an einem festen Tag bis zum 14. fällig ist,
// ab dem Ersten des Folgemonats, jeder andere ab dem Ersten des übernächsten. Keine Rechtszahl, nur die Grenze, bis zu der
// die Invariante den Monat hält.
export const EARLY_DAY_LIMIT = 14
export function safeArrearsFrom(t: RentDueTerms, month: string, log: LawLog = createLawLog()): string {
  checkTenancyMonth(t, month)
  const rule = effectiveRentDue(t, log)
  // Ein fester Tag bis zum 14. ist nach § 193 BGB und vier Bankgeschäftstagen noch im Monat erledigt (Invariante in
  // rent-due.test.ts über alle Länder 1995 bis 2100), wie der dritte Werktag (Integrationsdurchsicht S2).
  const early = rule === 'startWorkday' || (rule === 'dayOfMonth' && agreedDay(t) <= EARLY_DAY_LIMIT)
  const atStart = early && !isMoveInMonth(t, month) && !(isFirstMonth(t, month) && t.firstRentAtStart === true)
  const next = nextMonth(month)
  return `${atStart ? next : nextMonth(next)}-01`
}

export type MonthDue = { dueOn: string | null; creditExpectedBy: string | null; arrearsFrom: string; arrears: boolean }

// Fälligkeit, erwarteter Eingang und Beginn des Rückstands eines Monats; `arrears` sagt, ob er am Stichtag `asOf`
// Rückstand ist. Vor 1995 kennt Mietfuchs keine Feiertage: dann nur die sichere Grenze, ohne Auskunft.
export function monthDue(t: RentDueTerms, month: string, state: FederalState | null, asOf: string, options: RentDueOptions = {}): MonthDue {
  checkTenancyMonth(t, month)
  const log = options.log ?? createLawLog()
  const safe = safeArrearsFrom(t, month, log)
  if (Number(month.slice(0, 4)) < FIRST_YEAR) return { dueOn: null, creditExpectedBy: null, arrearsFrom: safe, arrears: asOf >= safe }
  const dueOn = rentDueOn(t, month, state, { log })
  const expected = creditExpectedBy(dueOn, { log })
  const checked = options.holidaysChecked ?? holidaysCheckedOn
  let all = true
  for (let d = sectionStart(t, month); all && d <= expected; d = addDays(d, 1)) all = checked(d)
  const from = all ? dayAfter(expected) : safe
  return { dueOn, creditExpectedBy: expected, arrearsFrom: from, arrears: asOf >= from }
}

// Ab diesem Tag zählt die Miete des Monats als Rückstand.
export function arrearsFrom(t: RentDueTerms, month: string, state: FederalState | null, options: RentDueOptions = {}): string {
  return monthDue(t, month, state, `${month}-01`, options).arrearsFrom
}
