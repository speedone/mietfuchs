// Das Rechnungsdatum aus der Textschicht einer PDF lesen, ohne KI (#487, Entscheidung 3B). Gelesen wird nur ein Datum,
// nie ein Betrag: Ein falsch gelesener Betrag ginge still in die Abrechnung, ein Datum steht sichtbar als Vorschlag am
// Feld. Ein beschriftetes Datum („Rechnungsdatum“, „Rechnung vom“ vor einem bloßen „Datum“) gewinnt; ohne Beschriftung
// nur, wenn im Text genau ein unbeschriftetes Datum steht. Ein fremd beschriftetes („fällig“, „bis“, „Stand“ …) zählt
// nie. Bleibt eine Wahl offen, gibt es keinen Vorschlag.
import { MONTH_NAMES, MONTH_SHORT, YEAR_MAX, YEAR_MIN } from './monthText'

// Monatsnamen aus monthText.ts (S14): ausgeschrieben, kurz mit oder ohne Punkt, „Maerz“ für Text ohne Umlaute
const EXTRA_WORDS: [string, number][] = [['Maerz', 3], ['Marz', 3], ['Sept', 9]]
const MONTH_WORDS: [string, number][] = [
  ...MONTH_NAMES.map((m, i): [string, number] => [m, i + 1]),
  ...MONTH_SHORT.map((m, i): [string, number] => [m, i + 1]),
  ...EXTRA_WORDS,
].sort((a, b) => b[0].length - a[0].length)
const MONTH_ALT = MONTH_WORDS.map(([w]) => w).join('|')

// Ein Datum: 14.02.2025, 3.1.25, 14. Februar 2025, 7. Okt. 2025, 2025-02-14. Nicht mitten in einer Zahl (1.234,56).
const DATE = new RegExp(
  String.raw`(?<![\d.,])(?:(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})|(\d{1,2})\.?\s*(${MONTH_ALT})\.?\s+(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?![\d]|[.,]\d)`,
  'giu',
)
// Beschriftungen, stark vor schwach. „Datum“ nur als eigenes Wort: „Fälligkeitsdatum“ und „Lieferdatum“ zählen nicht.
const STRONG = /(?:rechnungs-?datum|belegdatum|ausstellungsdatum|datum der rechnung|rechnung vom)[\s:]*$/iu
const WEAK = /(?<![\p{L}-])datum[\s:]*$/iu
// Fremde Beschriftungen (Durchsicht S1): fällig, Fälligkeit, Liefer-, Leistungs-, Zeitraum, Stand, Geburts-, „bis“ (auch
// „Abrechnung bis“, „zahlen bis zum“). Ein so beschriftetes Datum ist nie das Rechnungsdatum, auch nicht das einzige.
const FOREIGN = /(?:f[äa]llig\p{L}*|liefer\p{L}*|leistungs\p{L}*|\p{L}*zeitraum|\p{L}*stand|geburts\p{L}*|(?<!\p{L})bis)(?:\s+(?:am|zum|vom))?[\s:.]*$/iu

function isoOf(m: RegExpExecArray): string | null {
  let day: number, month: number, year: number
  if (m[1] !== undefined) {
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3])
    if ((m[3] ?? '').length === 2) year += 2000
  } else if (m[4] !== undefined) {
    day = Number(m[4])
    const word = (m[5] ?? '').toLowerCase()
    month = MONTH_WORDS.find(([w]) => w.toLowerCase() === word)?.[1] ?? 0
    year = Number(m[6])
  } else {
    year = Number(m[7]); month = Number(m[8]); day = Number(m[9])
  }
  if (year < YEAR_MIN || year > YEAR_MAX || month < 1 || month > 12 || day < 1) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Das eine Datum einer Menge, sonst keins
const only = (dates: Set<string>): string | null => (dates.size === 1 ? [...dates][0] ?? null : null)

export function invoiceDateFromText(text: string): string | null {
  const strong = new Set<string>()
  const weak = new Set<string>()
  const free = new Set<string>()
  for (const m of text.matchAll(DATE)) {
    const iso = isoOf(m)
    if (!iso) continue
    // Die Beschriftung steht unmittelbar davor, höchstens durch Leerraum und Doppelpunkt getrennt
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index)
    if (STRONG.test(before)) strong.add(iso)
    else if (FOREIGN.test(before)) continue
    else if (WEAK.test(before)) weak.add(iso)
    else free.add(iso)
  }
  if (strong.size > 0) return only(strong)
  if (weak.size > 0) return only(weak)
  return only(free)
}
