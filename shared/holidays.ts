// Gesetzliche Feiertage je Bundesland, als eigene kleine Tabelle mit Osterformel und ohne Abhängigkeit.
// Grundlage für Fristen nach Werktagen (shared/deadlines.ts). Server und Oberfläche rechnen mit derselben
// Datei, deshalb liegt sie in shared/.
//
// **Warum keine Bibliothek.** Geprüft wurden feiertagejs 1.5.1 und date-holidays 3.37.0 gegen dieselbe
// Vergleichsliste wie diese Tabelle (server/test/fixtures/holidays/). feiertagejs führt den
// Reformationstag in Bremen, Hamburg, Niedersachsen und Schleswig-Holstein schon vor 2018, kennt die
// einmaligen Berliner Feiertage nicht und zählt Mariä Himmelfahrt in ganz Bayern. date-holidays stimmt
// überein, seine Feiertagsdaten stehen aber unter CC BY-SA 3.0 und kämen mit rund 40 MB Abhängigkeiten
// (moment-timezone, astronomia) in die Programmdatei. Die Tabelle hier ist kurz und jede Zeile nennt
// ihre Rechtsgrundlage.
//
// **Was gilt.** Ein Tag zählt, wenn er im ganzen Land gesetzlicher Feiertag ist. Feiertage, die nur in
// einzelnen Gemeinden gelten (Mariä Himmelfahrt in Teilen Bayerns, das Augsburger Friedensfest,
// Fronleichnam in Teilen Sachsens und Thüringens), werden nicht geraten: Mietfuchs kennt die Gemeinde
// nicht. Sie stehen als Hinweis in `localHolidaysOf` und zählen bei `isHoliday` und `isWorkday` nicht.
// Ohne Bundesland (`null`) zählen nur die Tage, die in allen 16 Ländern Feiertag sind; das ist auch
// der Reformationstag 2017.
//
// **Was bewusst fehlt.** Sonntage als solche (Hessen erklärt alle Sonntage zu Feiertagen, § 1
// Abs. 1 HFeiertagsG; für Werktage ist das ohne Folge, ein Sonntag ist nie Werktag) und kirchliche Feiertage
// ohne Arbeitsruhe. Einmalige Feiertage, die ein Land künftig beschließt, kennt die Tabelle erst, wenn
// sie hier eingetragen werden; die Jahre davor bleiben richtig.
//
// Daten sind ISO-Zeichenketten 'JJJJ-MM-TT' und werden in UTC gerechnet wie im übrigen Projekt; die
// Zeitzone des Rechners spielt keine Rolle.
import type { FederalState } from './types.ts'

export const STATES: readonly { readonly code: FederalState; readonly name: string }[] = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' },
]

export const STATE_CODES: readonly FederalState[] = STATES.map((s) => s.code)

export function isFederalState(v: unknown): v is FederalState {
  return typeof v === 'string' && STATE_CODES.some((c) => c === v)
}

export function stateName(state: FederalState): string {
  return STATES.find((s) => s.code === state)?.name ?? state
}

// Die Tabelle beginnt mit 1995, dem ersten Jahr der Vergleichsliste. Für frühere Jahre ist sie nicht
// geprüft, und eine Frist, die mit einer ungeprüften Liste rechnet, wäre eine Behauptung.
export const FIRST_YEAR = 1995

export type Holiday = { date: string; name: string }
// Ein Feiertag, der nur in einzelnen Gemeinden des Landes gilt, mit dem Ort in Worten.
export type LocalHoliday = Holiday & { where: string }

type Rule = { kind: 'fixed'; month: number; day: number } | { kind: 'easter'; offset: number } | { kind: 'repentanceDay' }
type Entry = {
  name: string
  rule: Rule
  states: readonly FederalState[]
  // Geltung in Jahren, je einschließlich; `only` für einmalige Feiertage.
  from?: number
  only?: readonly number[]
  // Gesetzt, wenn der Tag nur in einzelnen Gemeinden gilt: wo, in Worten.
  local?: string
  norm: string
}

const fixed = (month: number, day: number): Rule => ({ kind: 'fixed', month, day })
const easter = (offset: number): Rule => ({ kind: 'easter', offset })
const ALL = STATE_CODES

// Die Tabelle. Die Fundstellen sind die Feiertagsgesetze der Länder; was bundesweit gilt, steht in
// jedem davon.
const ENTRIES: readonly Entry[] = [
  { name: 'Neujahr', rule: fixed(1, 1), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Heilige Drei Könige', rule: fixed(1, 6), states: ['BW', 'BY', 'ST'], norm: '§ 1 FTG BW; Art. 1 Abs. 1 Nr. 1 FTG BY; § 2 Nr. 2 FeiertG LSA' },
  { name: 'Internationaler Frauentag', rule: fixed(3, 8), states: ['BE'], from: 2019, norm: '§ 1 Abs. 1 Nr. 2 FeiertG Berlin (G v. 30.01.2019)' },
  { name: 'Internationaler Frauentag', rule: fixed(3, 8), states: ['MV'], from: 2023, norm: '§ 2 Abs. 1 Nr. 2 FTG M-V (G v. 07.07.2022)' },
  { name: 'Karfreitag', rule: easter(-2), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Ostersonntag', rule: easter(0), states: ['BB'], norm: '§ 2 Abs. 1 Nr. 3 FTG Brandenburg' },
  { name: 'Ostermontag', rule: easter(1), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Tag der Arbeit', rule: fixed(5, 1), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Tag der Befreiung', rule: fixed(5, 8), states: ['BE'], only: [2020, 2025], norm: '§ 1 Abs. 1 Nr. 11 FeiertG Berlin, je einmalig (G v. 30.01.2019 und 10.07.2024)' },
  { name: 'Christi Himmelfahrt', rule: easter(39), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Pfingstsonntag', rule: easter(49), states: ['BB'], norm: '§ 2 Abs. 1 Nr. 7 FTG Brandenburg' },
  { name: 'Pfingstmontag', rule: easter(50), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: 'Fronleichnam', rule: easter(60), states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], norm: 'Feiertagsgesetze dieser Länder' },
  { name: 'Fronleichnam', rule: easter(60), states: ['SN'], local: 'nur in einzelnen Gemeinden und Gemeindeteilen um Bautzen, Hoyerswerda und Kamenz', norm: '§ 1 Abs. 1 SächsSFG mit Fronleichnamsverordnung vom 04.05.1993' },
  { name: 'Fronleichnam', rule: easter(60), states: ['TH'], local: 'nur in Gemeinden, in denen er 1994 gesetzlicher Feiertag war, etwa im Eichsfeld', norm: '§ 10 Abs. 1 ThürFtG' },
  { name: '75. Jahrestag des Volksaufstands vom 17. Juni 1953', rule: fixed(6, 17), states: ['BE'], only: [2028], norm: '§ 1 Abs. 1 Nr. 12 FeiertG Berlin, einmalig (G v. 10.07.2024)' },
  { name: 'Augsburger Friedensfest', rule: fixed(8, 8), states: ['BY'], local: 'nur im Stadtgebiet Augsburg', norm: 'Art. 1 Abs. 2 FTG BY' },
  { name: 'Mariä Himmelfahrt', rule: fixed(8, 15), states: ['SL'], norm: '§ 2 Abs. 1 Nr. 8 SFG Saarland' },
  { name: 'Mariä Himmelfahrt', rule: fixed(8, 15), states: ['BY'], local: 'nur in Gemeinden mit mehr katholischen als evangelischen Einwohnern, wie sie das Landesamt für Statistik feststellt', norm: 'Art. 1 Abs. 1 Nr. 2 und Abs. 3 FTG BY' },
  { name: 'Weltkindertag', rule: fixed(9, 20), states: ['TH'], from: 2019, norm: '§ 2 Abs. 1 ThürFtG' },
  { name: 'Tag der Deutschen Einheit', rule: fixed(10, 3), states: ALL, norm: 'Art. 2 Abs. 2 Einigungsvertrag' },
  { name: 'Reformationstag', rule: fixed(10, 31), states: ['BB', 'MV', 'SN', 'ST', 'TH'], norm: 'Feiertagsgesetze dieser Länder' },
  { name: 'Reformationstag', rule: fixed(10, 31), states: ['HB', 'HH', 'NI', 'SH'], from: 2018, norm: '§ 2 Abs. 1 FeiertG BR; § 1 Nr. 8 FeiertagsG HH; § 2 NFeiertagsG; § 2 Abs. 1 SFTG, je geändert 2018' },
  { name: 'Reformationstag (500. Jahrestag)', rule: fixed(10, 31), states: ALL, only: [2017], norm: 'einmalige Regelung in jedem Land, etwa Art. 1 Abs. 2a FTG BY a. F.' },
  { name: 'Allerheiligen', rule: fixed(11, 1), states: ['BW', 'BY', 'NW', 'RP', 'SL'], norm: 'Feiertagsgesetze dieser Länder' },
  { name: 'Buß- und Bettag', rule: { kind: 'repentanceDay' }, states: ['SN'], norm: '§ 1 Abs. 1 SächsSFG' },
  { name: '1. Weihnachtstag', rule: fixed(12, 25), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
  { name: '2. Weihnachtstag', rule: fixed(12, 26), states: ALL, norm: 'Feiertagsgesetze aller Länder' },
]

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

function dateOf(rule: Rule, year: number): string {
  if (rule.kind === 'fixed') return isoOf(utcOf(year, rule.month, rule.day))
  if (rule.kind === 'easter') return addDays(easterSunday(year), rule.offset)
  return repentanceDay(year)
}

function checkYear(year: number): void {
  if (!Number.isInteger(year) || year < FIRST_YEAR) {
    throw new RangeError(`Feiertage kennt Mietfuchs ab ${FIRST_YEAR}, nicht für ${year}.`)
  }
}

const applies = (e: Entry, year: number, state: FederalState): boolean =>
  e.states.includes(state) && (e.from === undefined || year >= e.from) && (e.only === undefined || e.only.includes(year))

const byDate = (a: Holiday, b: Holiday): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

// Ein Tag, zwei Anlässe (2008 fielen Christi Himmelfahrt und der 1. Mai zusammen): einmal, mit dem
// ersten Namen der Tabelle.
function unique(list: Holiday[]): Holiday[] {
  const seen = new Set<string>()
  return list.filter((h) => !seen.has(h.date) && seen.add(h.date)).sort(byDate)
}

const cache = new Map<string, Holiday[]>()

function stateHolidays(year: number, state: FederalState): Holiday[] {
  const key = `${year}/${state}`
  let list = cache.get(key)
  if (!list) {
    list = unique(ENTRIES.filter((e) => !e.local && applies(e, year, state)).map((e) => ({ date: dateOf(e.rule, year), name: e.name })))
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
  return ENTRIES.filter((e) => e.local !== undefined && applies(e, year, state))
    .map((e) => ({ date: dateOf(e.rule, year), name: e.name, where: e.local ?? '' }))
    .sort(byDate)
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
