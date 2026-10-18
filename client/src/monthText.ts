// Ein Monat als Text (#287, #346 Schritt 5; Spezifikation Abschnitt 3 „Datum, Monat, Geld“). Ohne DOM, damit
// das Monatsfeld (components/MonthField.tsx) und die Prüfungen der Formulare dieselbe Regel lesen und sie ohne
// Browser getestet werden kann.
//
// Gelesen wird, was Vermieter tippen: „3.2025“, „03/25“, „2025-03“, „März 2025“, „Mrz 27“, dazu „3 2025“,
// „3-2025“, „Sept. 2024“, „Jänner 2026“ und ein Tag, wenn er der Erste ist („01.03.2025“, „2025-03-01“): Eine
// Staffel gilt ab Monatsanfang, und „15.10.2026“ still als Oktober zu lesen, hieße raten. Zweistellige Jahre
// wie POSIX (`%y`): 00 bis 68 sind 20xx, 69 bis 99 sind 19xx. Jahre gelten von 1900 bis 2100; außerhalb ist es
// ein Tippfehler („01.0026“), der als frühester Eintrag einer Staffel still ab Einzug gälte, als späterer nie.
//
// Was sich nicht lesen lässt, wird nicht verworfen, sondern benannt: `short` für die Meldung am Feld („Monat 13
// gibt es nicht“), `text` als Satz, der sagt, was zu tun ist (die Sammelmeldung stellt den Ort davor).

export const YEAR_MIN = 1900
export const YEAR_MAX = 2100

export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] as const
// Im Raster: drei Buchstaben, vorgelesen wird der ganze Name mit Jahr (`aria-label`).
export const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'] as const

export type MonthParse =
  | { kind: 'empty' }
  | { kind: 'month'; key: string }
  | { kind: 'invalid'; short: string; text: string }

const EXAMPLE = 'etwa „3.2025“'

// Monatsnamen klein und ohne Umlaut; dazu die üblichen Kürzel. Ein Punkt hinter dem Kürzel ist erlaubt.
const NAME_TO_MONTH = new Map<string, number>()
const NAMES_PLAIN = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
NAMES_PLAIN.forEach((name, i) => {
  NAME_TO_MONTH.set(name, i + 1)
  NAME_TO_MONTH.set(name.slice(0, 3), i + 1)
})
for (const [alias, month] of [['mrz', 3], ['mar', 3], ['maer', 3], ['marz', 3], ['sept', 9], ['jaenner', 1], ['jaen', 1], ['jan', 1], ['feber', 2]] as const) NAME_TO_MONTH.set(alias, month)

const plain = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')

const fullYear = (y: string): number => {
  const n = Number(y)
  if (y.length === 2) return n <= 68 ? 2000 + n : 1900 + n
  return n
}

function result(month: number, yearText: string): MonthParse {
  if (!(month >= 1 && month <= 12)) {
    return { kind: 'invalid', short: `Monat ${month} gibt es nicht`, text: `Den Monat ${month} gibt es nicht. Geben Sie den Monat als Zahl von 1 bis 12 ein, ${EXAMPLE}.` }
  }
  const year = fullYear(yearText)
  if (year < YEAR_MIN || year > YEAR_MAX) {
    return { kind: 'invalid', short: `Jahr außerhalb ${YEAR_MIN} bis ${YEAR_MAX}`, text: `Das Jahr ${year} liegt außerhalb von ${YEAR_MIN} bis ${YEAR_MAX}. Bitte prüfen Sie das Jahr.` }
  }
  return { kind: 'month', key: `${year}-${String(month).padStart(2, '0')}` }
}

const ONLY_MONTH: MonthParse = { kind: 'invalid', short: 'Nur Monat und Jahr', text: `Hier zählt nur der Monat ab dem Ersten. Geben Sie Monat und Jahr ohne Tag ein, ${EXAMPLE}.` }
const NO_YEAR: MonthParse = { kind: 'invalid', short: 'Jahr fehlt', text: `Geben Sie zum Monat auch das Jahr ein, ${EXAMPLE}.` }
const NO_MONTH: MonthParse = { kind: 'invalid', short: 'Monat fehlt', text: `Geben Sie zum Jahr auch den Monat ein, ${EXAMPLE}.` }

export function parseMonthText(text: string): MonthParse {
  const t = text.trim()
  if (t === '') return { kind: 'empty' }
  const y = '(\\d{4}|\\d{2})'
  // Jahr zuerst, vierstellig: 2025-03, 2025/3, 2025-03-01
  let m = /^(\d{4})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{1,2}))?$/.exec(t)
  if (m) return m[3] !== undefined && Number(m[3]) !== 1 ? ONLY_MONTH : result(Number(m[2]), m[1] ?? '')
  // Tag.Monat.Jahr: nur der Erste
  m = new RegExp(`^(\\d{1,2})\\s*[./]\\s*(\\d{1,2})\\s*[./]\\s*${y}$`).exec(t)
  if (m) return Number(m[1]) !== 1 ? ONLY_MONTH : result(Number(m[2]), m[3] ?? '')
  // Monat und Jahr: 3.2025, 03/25, 3-2025, 3 2025
  m = new RegExp(`^(\\d{1,2})\\s*(?:[./-]|\\s)\\s*${y}$`).exec(t)
  if (m) return result(Number(m[1]), m[2] ?? '')
  // Monatsname und Jahr: März 2025, Mrz 27, Sept. 2024, Mai2025
  m = new RegExp(`^(\\p{L}+)\\.?\\s*${y}$`, 'u').exec(t)
  if (m) {
    const month = NAME_TO_MONTH.get(plain(m[1] ?? ''))
    return month === undefined ? unreadable(t) : result(month, m[2] ?? '')
  }
  // Nur ein Teil: „März“, „3“, „03.“ (Jahr fehlt) oder „2025“, „.2026“ (Monat fehlt)
  if (/^\d{1,2}\s*[./]?$/.test(t)) return NO_YEAR
  m = /^(\p{L}+)\.?$/u.exec(t)
  if (m && NAME_TO_MONTH.has(plain(m[1] ?? ''))) return NO_YEAR
  if (/^[./]?\s*\d{4}$/.test(t)) return NO_MONTH
  return unreadable(t)
}

const unreadable = (t: string): MonthParse => ({
  kind: 'invalid',
  short: 'Monat nicht lesbar',
  text: `„${t}“ lässt sich nicht als Monat lesen. Geben Sie Monat und Jahr ein, ${EXAMPLE} oder „März 2025“.`,
})

/** 'JJJJ-MM' als „März 2025“; ein anderer Text bleibt, wie er ist. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined
  return m && name ? `${name} ${m[1]}` : key
}

/**
 * Die Meldung zu einem Monatsfeld, das einen Monat verlangt, mit dem Ort davor („Neuer Zeitraum: …“); `null`,
 * wenn der Text ein Monat ist. Für Felder ohne „leer heißt …“ (Zeitraumwechsel, Heizperiode).
 */
export function monthProblem(text: string, where: string): { short: string; text: string } | null {
  const r = parseMonthText(text)
  if (r.kind === 'month') return null
  if (r.kind === 'empty') return { short: 'Monat fehlt', text: `${where}: Geben Sie den Monat ein, ${EXAMPLE} oder „März 2025“.` }
  return { short: r.short, text: `${where}: ${r.text}` }
}

// Das Monatsraster (APG-Grid, 3 Spalten, 4 Zeilen): wohin eine Taste den Fokus setzt. `month` ist 0-basiert.
// Pfeile gehen über das Jahr hinaus ins Nachbarjahr, Pos1/Ende an Anfang und Ende der Zeile, Bild auf/ab ein
// Jahr zurück und vor. `null`: Die Taste gehört nicht dem Raster.
export type GridPos = { year: number; month: number }
const COLS = 3
export function gridMove(pos: GridPos, key: string): GridPos | null {
  const at = (index: number): GridPos => {
    const year = pos.year + Math.floor(index / 12)
    const month = ((index % 12) + 12) % 12
    if (year < YEAR_MIN) return { year: YEAR_MIN, month: 0 }
    if (year > YEAR_MAX) return { year: YEAR_MAX, month: 11 }
    return { year, month }
  }
  const clampYear = (year: number): GridPos => ({ year: Math.min(YEAR_MAX, Math.max(YEAR_MIN, year)), month: pos.month })
  switch (key) {
    case 'ArrowRight': return at(pos.month + 1)
    case 'ArrowLeft': return at(pos.month - 1)
    case 'ArrowDown': return at(pos.month + COLS)
    case 'ArrowUp': return at(pos.month - COLS)
    case 'Home': return { year: pos.year, month: pos.month - (pos.month % COLS) }
    case 'End': return { year: pos.year, month: pos.month - (pos.month % COLS) + COLS - 1 }
    case 'PageUp': return clampYear(pos.year - 1)
    case 'PageDown': return clampYear(pos.year + 1)
    default: return null
  }
}
