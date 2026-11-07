// Ein unabhängiges Orakel für den Beginn des Rückstands (#334, Entwurf E1 bis E6), für invariant-mietkonto.test.ts und das
// FIFO-Orakel (fifoLedger.ts). Es liest weder shared/rentDue.ts noch shared/holidays.ts noch das Rechtsregister: Die
// Feiertage kommen aus der festen Vergleichsliste (fixtures/holidays/python-holidays.json, je Land mit den Varianten für
// einzelne Gemeinden), Wochentage aus `Date` in UTC, die Zahlen aus dem Entwurf stehen hier als Konstanten. Rechnet
// shared/rentDue.ts anders, wird der Vergleich rot.
//
// Liegt in testing/ und nicht in test/, weil `node --test` jede Datei unter test/ ausführt.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Fixture = { jahre: [number, number]; ostern: string[]; varianten: Record<string, string[]> }
const here = path.dirname(fileURLToPath(import.meta.url))
const fixture: Fixture = JSON.parse(fs.readFileSync(path.join(here, '..', 'test', 'fixtures', 'holidays', 'python-holidays.json'), 'utf8'))

export type OracleTerms = {
  start: string
  end: string | null
  contractDate?: string | null
  rentDue?: 'startWorkday' | 'dayOfMonth' | 'inArrears' | null
  rentDueDay?: number | null
  firstRentAtStart?: boolean | null
}

const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'] as const
type State = (typeof STATES)[number]
const DAY = 86_400_000
const ms = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10)
const plus = (d: string, n: number): string => iso(ms(d) + n * DAY)
const weekday = (d: string): number => new Date(ms(d)).getUTCDay()

const cache = new Map<string, Set<string>>()
// Alle Feiertage eines Landes im Jahr, auch die einzelner Gemeinden (Varianten der Vergleichsliste mit dem Land als Präfix,
// Augsburg gehört zu Bayern).
function holidays(year: number, state: State): Set<string> {
  const key = `${year}/${state}`
  const known = cache.get(key)
  if (known) return known
  const variants = Object.keys(fixture.varianten).filter((v) => v === state || v.startsWith(`${state}:`) || (state === 'BY' && v === 'Augsburg'))
  const easter = fixture.ostern[year - fixture.jahre[0]]
  if (easter === undefined) throw new Error(`Vergleichsliste ohne ${year}`)
  const set = new Set<string>()
  for (const v of variants) {
    for (const token of fixture.varianten[v] ?? []) {
      const [day = '', years] = token.split('@')
      if (years !== undefined && !years.split(',').some((part) => {
        const [a, b] = part.split('-').map(Number)
        return a !== undefined && year >= a && year <= (b ?? a)
      })) continue
      set.add(day.startsWith('O') ? plus(easter, Number(day.slice(1))) : `${year}-${day}`)
    }
  }
  cache.set(key, set)
  return set
}
const isHoliday = (d: string, s: State): boolean => holidays(Number(d.slice(0, 4)), s).has(d)
const workday = (d: string, s: State): boolean => weekday(d) !== 0 && weekday(d) !== 6 && !isHoliday(d, s)
const shift193 = (d: string, s: State): string => (workday(d, s) ? d : shift193(plus(d, 1), s))
const bankDay = (d: string): boolean => weekday(d) !== 0 && weekday(d) !== 6 && !d.endsWith('-12-24') && !d.endsWith('-12-31') && STATES.every((s) => !isHoliday(d, s))

function third(from: string, s: State): string {
  let d = from
  for (let n = 0; ; d = plus(d, 1)) if (workday(d, s) && ++n === 3) return d
}

// Die Regel ohne Angabe: Bestand das Mietverhältnis am 01.09.2001 (früheres von Vertrag und Beginn), nach Ablauf.
export function oracleRule(t: OracleTerms): 'startWorkday' | 'dayOfMonth' | 'inArrears' {
  if (t.rentDue) return t.rentDue
  const since = t.contractDate && /^\d{4}-\d{2}-\d{2}$/.test(t.contractDate) && t.contractDate < t.start ? t.contractDate : t.start
  return since <= '2001-09-01' ? 'inArrears' : 'startWorkday'
}

function dueIn(t: OracleTerms, month: string, s: State): string {
  const first = `${month}-01`
  const moveIn = t.start.startsWith(month) && t.start > first
  const from = moveIn ? t.start : first
  if (t.start.startsWith(month) && t.firstRentAtStart) return shift193(t.start, s)
  const rule = oracleRule(t)
  const last = iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
  if (rule === 'startWorkday') return third(from, s)
  if (rule === 'dayOfMonth') {
    const day = Math.min(t.rentDueDay ?? 0, Number(last.slice(8, 10)))
    const agreed = shift193(`${month}-${String(day).padStart(2, '0')}`, s)
    if (!moveIn) return agreed
    const w = third(from, s)
    return agreed > w ? agreed : w
  }
  const end = t.end !== null && t.end < last ? t.end : last
  return shift193(plus(end, 1), s)
}

// Fälligkeit (ohne Land das Maximum), erwarteter Eingang (vierter Bankgeschäftstag danach) und Beginn des Rückstands; mit
// `checked = false` die sichere Grenze ohne Feiertage. Vor 1995 immer die sichere Grenze.
export function oracleArrearsFrom(t: OracleTerms, month: string, state: State | null, checked: boolean): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const next = (k: number): string => iso(Date.UTC(y, m - 1 + k, 1))
  const moveIn = t.start.startsWith(month) && t.start > `${month}-01`
  const atStart = oracleRule(t) === 'startWorkday' && !moveIn && !(t.start.startsWith(month) && t.firstRentAtStart)
  const safe = atStart ? next(1) : next(2)
  if (!checked || y < 1995) return safe
  const due = (state === null ? [...STATES] : [state]).map((s) => dueIn(t, month, s)).sort().at(-1) ?? ''
  let d = due
  for (let n = 0; n < 4;) { d = plus(d, 1); if (bankDay(d)) n++ }
  return plus(d, 1)
}
