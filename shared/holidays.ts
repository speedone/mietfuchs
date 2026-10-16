// Gesetzliche Feiertage je Bundesland, gerechnet aus dem Rechtsregister (shared/law/feiertagsgesetze.ts)
// mit Osterformel und ohne Abhängigkeit. Grundlage für Fristen nach Werktagen (shared/deadlines.ts).
// Server und Oberfläche rechnen mit derselben Datei, deshalb liegt sie in shared/.
//
// **Warum keine Bibliothek.** Geprüft wurden feiertagejs 1.5.1 und date-holidays 3.37.0 gegen dieselbe
// Vergleichsliste wie das Register (server/test/fixtures/holidays/). feiertagejs führt den
// Reformationstag in Bremen, Hamburg, Niedersachsen und Schleswig-Holstein schon vor 2018, kennt die
// einmaligen Berliner Feiertage nicht und zählt Mariä Himmelfahrt in ganz Bayern. date-holidays stimmt
// überein, seine Feiertagsdaten stehen aber unter CC BY-SA 3.0 und kämen mit rund 40 MB Abhängigkeiten
// (moment-timezone, astronomia) in die Programmdatei. Im Register hat dagegen jede Fassung ihre
// Fundstelle und ihren Prüfstand.
//
// **Was gilt.** Ein Tag zählt, wenn er im ganzen Land gesetzlicher Feiertag ist. Feiertage, die nur in
// einzelnen Gemeinden gelten (Mariä Himmelfahrt in Teilen Bayerns, das Augsburger Friedensfest,
// Fronleichnam in Teilen Sachsens und Thüringens), werden nicht geraten: Mietfuchs kennt die Gemeinde
// nicht. Sie stehen als Hinweis in `localHolidaysOf` und zählen bei `isHoliday` und `isWorkday` nicht.
// Ohne Bundesland (`null`) zählen nur die Tage, die in allen 16 Ländern Feiertag sind; das ist auch
// der Reformationstag 2017.
//
// **Was bewusst fehlt.** Sonntage als solche (Hessen erklärt alle Sonntage zu Feiertagen, § 1
// Abs. 1 HFeiertagsG; für Werktage ist das ohne Folge, ein Sonntag ist nie Werktag) und kirchliche
// Feiertage ohne Arbeitsruhe. Einmalige Feiertage, die ein Land künftig beschließt, kennt Mietfuchs erst,
// wenn sie als Fassung im Register stehen; die Jahre davor bleiben richtig.
//
// Gefragt wird das Register ohne Protokoll (`versionAt`), denn bisher rechnet keine Abrechnung damit.
// Rechnet calc.ts einmal mit einer Frist, fragt es mit `law(param, { date }, log)`, damit die benutzte
// Fassung im Rechtsstand der Abrechnung steht.
//
// Daten sind ISO-Zeichenketten 'JJJJ-MM-TT' und werden in UTC gerechnet wie im übrigen Projekt; die
// Zeitzone des Rechners spielt keine Rolle.
import type { FederalState } from './types.ts'
import { STATE_CODES } from './states.ts'
import { versionAt } from './law/register.ts'
import { HOLIDAY_PARAMS } from './law/feiertagsgesetze.ts'

export { STATES, STATE_CODES, isFederalState, stateName } from './states.ts'

// Gerechnet wird ab 1995, dem ersten Jahr der Vergleichsliste. Für frühere Jahre sind die Fassungen des
// Registers nicht geprüft, und eine Frist, die mit einer ungeprüften Liste rechnet, wäre eine Behauptung.
export const FIRST_YEAR = 1995

export type Holiday = { date: string; name: string }
// Ein Feiertag, der nur in einzelnen Gemeinden des Landes gilt, mit dem Ort in Worten.
export type LocalHoliday = Holiday & { where: string }

// ---------- Datum ----------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_DAY = 86_400_000

const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const utcOf = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day)

// Wirft bei allem, was kein Kalendertag ist, auch beim 31.02.: Eine Frist aus einem falschen Datum
// wäre ein stiller Fehler.
export function parseIsoDate(date: string): number {
  const m = ISO.exec(date)
  const ms = m ? utcOf(Number(m[1]), Number(m[2]), Number(m[3])) : Number.NaN
  if (!m || Number.isNaN(ms) || isoOf(ms) !== date) throw new RangeError(`„${date}“ ist kein Datum in der Form JJJJ-MM-TT.`)
  return ms
}

export const addDays = (date: string, days: number): string => isoOf(parseIsoDate(date) + days * MS_DAY)

// 0 = Sonntag … 6 = Samstag, in UTC.
export const weekdayOf = (date: string): number => new Date(parseIsoDate(date)).getUTCDay()

// Ostersonntag im gregorianischen Kalender (anonymer gregorianischer Algorithmus nach Meeus,
// Jones und Butcher). Geprüft gegen die Osterdaten der Vergleichsliste 1995 bis 2100.
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return isoOf(utcOf(year, month, day))
}

// Buß- und Bettag: der Mittwoch vor dem 23. November.
function repentanceDay(year: number): string {
  const nov22 = utcOf(year, 11, 22)
  const back = (new Date(nov22).getUTCDay() - 3 + 7) % 7
  return isoOf(nov22 - back * MS_DAY)
}

// Der Tag eines Feiertags im Jahr, nach der Schreibweise des Registers ('MM-TT', 'O±n', 'repentance').
function dateOf(day: string, year: number): string {
  if (day === 'repentance') return repentanceDay(year)
  if (day.startsWith('O')) return addDays(easterSunday(year), Number(day.slice(1)))
  return isoOf(utcOf(year, Number(day.slice(0, 2)), Number(day.slice(3, 5))))
}

// Jeder Feiertag des Jahres mit der Fassung, die an seinem Tag gilt.
function occurrences(year: number): { date: string; name: string; states: readonly FederalState[]; local: { readonly [state: string]: string } }[] {
  return HOLIDAY_PARAMS.flatMap((p) => {
    const first = p.versions[0]
    if (!first) return []
    const date = dateOf(first.value.day, year)
    const v = versionAt(p, date).value
    return [{ date, name: p.title, states: v.states, local: v.local }]
  })
}

function checkYear(year: number): void {
  if (!Number.isInteger(year) || year < FIRST_YEAR) {
    throw new RangeError(`Feiertage kennt Mietfuchs ab ${FIRST_YEAR}, nicht für ${year}.`)
  }
}

const byDate = (a: Holiday, b: Holiday): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Ein Tag, zwei Anlässe (2008 fielen Christi Himmelfahrt und der 1. Mai zusammen): einmal, mit dem
// ersten Namen des Registers.
function unique(list: Holiday[]): Holiday[] {
  const seen = new Set<string>()
  return list.filter((h) => !seen.has(h.date) && seen.add(h.date)).sort(byDate)
}

const cache = new Map<string, Holiday[]>()

function stateHolidays(year: number, state: FederalState): Holiday[] {
  const key = `${year}/${state}`
  let list = cache.get(key)
  if (!list) {
    list = unique(occurrences(year).filter((o) => o.states.includes(state)).map((o) => ({ date: o.date, name: o.name })))
    cache.set(key, list)
  }
  return list
}

// Ohne Land die Tage, die in allen 16 Ländern Feiertag sind.
function listFor(year: number, state: FederalState | null): Holiday[] {
  checkYear(year)
  if (state !== null) return stateHolidays(year, state)
  const key = `${year}/-`
  let list = cache.get(key)
  if (!list) {
    const [first, ...rest] = STATE_CODES.map((s) => stateHolidays(year, s))
    list = (first ?? []).filter((h) => rest.every((l) => l.some((o) => o.date === h.date)))
    cache.set(key, list)
  }
  return list
}

// Die gesetzlichen Feiertage eines Jahres, die im ganzen Land gelten, aufsteigend. Ohne Land die Tage,
// die in allen 16 Ländern Feiertag sind.
export function holidaysOf(year: number, state: FederalState | null): Holiday[] {
  return listFor(year, state).map((h) => ({ ...h }))
}

// Feiertage, die im Land nur in einzelnen Gemeinden gelten. Sie zählen in dieser Datei nirgends mit;
// die Oberfläche kann sie nennen. Ohne Land gibt es keine Hinweise, denn dann ist auch die Gemeinde
// unbekannt.
export function localHolidaysOf(year: number, state: FederalState | null): LocalHoliday[] {
  checkYear(year)
  if (state === null) return []
  return occurrences(year).flatMap((o) => {
    const where = o.local[state]
    return where === undefined ? [] : [{ date: o.date, name: o.name, where }]
  }).sort(byDate)
}

export function isHoliday(date: string, state: FederalState | null): boolean {
  parseIsoDate(date)
  return listFor(Number(date.slice(0, 4)), state).some((h) => h.date === date)
}

// Werktag: kein Sonntag, kein gesetzlicher Feiertag im Land, und der Samstag nur, wenn der Aufrufer es
// sagt. Ob der Samstag mitzählt, hängt an der Frist (bei der Mietzahlung nicht, siehe deadlines.ts);
// deshalb gibt es dafür keine Voreinstellung.
export function isWorkday(date: string, state: FederalState | null, options: { saturday: boolean }): boolean {
  const day = weekdayOf(date)
  if (day === 0) return false
  if (day === 6 && !options.saturday) return false
  return !isHoliday(date, state)
}
