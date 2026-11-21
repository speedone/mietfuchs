// Der Monat, den ein Verwendungszweck nennt (#693). Rein. Nennt der Mieter bei der Zahlung den Monat, bestimmt er damit
// die Schuld, die getilgt wird (§ 366 Abs. 1 BGB); ob ein Zweck das tut, ist Auslegung, deshalb ist das Ergebnis hier nur
// ein Vorschlag, den der Vermieter bestätigt (match.ts), und die Erkennung ist streng: lieber kein Monat als ein falscher.
//
// Erkannt wird nur
// - ein Zweck mit dem Wort „Miete“ (auch „Kaltmiete“, „Mietzahlung“) und ohne „Kaution“, „Rechnung“/„Abrechnung“,
//   „Nachzahlung“, „Guthaben“,
// - ein Monatsname (auch abgekürzt, ohne Umlaute), allein oder mit vierstelligem Jahr, oder MM/JJJJ, MM.JJJJ, MM-JJJJ,
//   JJJJ-MM. Kein zweistelliges Jahr, keine bloße Zahl, kein Teil eines Datums („03.11.2026“, „3. November“),
// - nicht hinter „seit“, „ab“, „bis“, „vom“, „zum“, „am“ (ein Dauerauftrag „seit Mai“ nennt keinen Monat der Zahlung),
// - genau ein Monat (derselbe zweimal zählt als einer),
// - mit plausiblem Jahr: genannt höchstens 24 Monate vor und 3 Monate nach dem Buchungsmonat; ohne Jahr der Monat
//   zwischen 10 Monaten davor und einem Monat danach (eindeutig, weil das Fenster zwölf Monate breit ist).

const NAMES: Readonly<Record<string, number>> = {
  januar: 1, jan: 1, februar: 2, feb: 2, maerz: 3, marz: 3, mrz: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
}
// Längere Namen zuerst, damit „sept“ nicht als „sep“ mit Rest gelesen wird.
const NAME = new RegExp(`(?<![a-z])(${Object.keys(NAMES).sort((a, b) => b.length - a.length).join('|')})(?![a-z])`, 'g')
const MONTH_YEAR = /(?<![\d./-])(\d{1,2})[/.-](20\d{2})(?!\d|[/.-]\d)/g
const YEAR_MONTH = /(?<![\d./-])(20\d{2})[-/](\d{2})(?!\d|[/.-]\d)/g
const NOT_RENT = /kaution|rechnung|nachzahlung|guthaben/
// Wörter, nach denen ein Monat einen Zeitraum oder ein Datum meint, nicht den Monat der Zahlung.
const SPAN_WORD = /(?:^|[^a-z])(?:seit|ab|bis|vom|zum|am)\s+$/

const BEFORE_WITH_YEAR = 24
const AFTER_WITH_YEAR = 3
const BEFORE_WITHOUT_YEAR = 10

const fold = (text: string): string => text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
const keyOf = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

const LABELS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
// „November 2026“ aus '2026-11'.
export const purposeMonthLabel = (month: string): string => `${LABELS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`

// 'JJJJ-MM' oder null. `bookingDate` ist der Buchungstag ('JJJJ-MM-TT').
export function monthInPurpose(purpose: string, bookingDate: string): string | null {
  const text = fold(purpose)
  if (!text.includes('miet') || NOT_RENT.test(text)) return null
  const booked = Number(bookingDate.slice(0, 4)) * 12 + Number(bookingDate.slice(5, 7)) - 1
  const found = new Set<number>()
  let refused = false
  const withYear = (year: number, month: number, before: string): void => {
    const index = year * 12 + month - 1
    if (month < 1 || month > 12 || SPAN_WORD.test(before) || index < booked - BEFORE_WITH_YEAR || index > booked + AFTER_WITH_YEAR) refused = true
    else found.add(index)
  }
  // Zuerst die Zahlenformen; sie werden danach aus dem Text genommen, damit „November 11/2026“ kein „November 11“ ist.
  let rest = text
  for (const [pattern, yearAt, monthAt] of [[MONTH_YEAR, 2, 1], [YEAR_MONTH, 1, 2]] as const) {
    for (const m of text.matchAll(pattern)) withYear(Number(m[yearAt]), Number(m[monthAt]), text.slice(0, m.index))
    rest = rest.replace(pattern, (hit) => '#'.repeat(hit.length))
  }
  for (const m of rest.matchAll(NAME)) {
    const month = NAMES[m[1] ?? '']
    if (month === undefined) continue
    const before = rest.slice(0, m.index)
    const after = rest.slice(m.index + m[0].length)
    // „3. November“, „03 Nov“: ein Datum.
    if (/\d\.?\s*$/.test(before)) refused = true
    const year = /^\.?[\s/.-]*(20\d{2})(?!\d|[/.-]\d)/.exec(after)
    if (year) withYear(Number(year[1]), month, before)
    // „November 26“: Tag oder zweistelliges Jahr, beides mehrdeutig.
    else if (/^\.?\s*\d/.test(after) || SPAN_WORD.test(before)) refused = true
    else {
      const near = booked - ((((booked % 12) - (month - 1)) % 12) + 12) % 12
      found.add(near < booked - BEFORE_WITHOUT_YEAR ? near + 12 : near)
    }
  }
  if (refused || found.size !== 1) return null
  const [only] = found
  return only === undefined ? null : keyOf(only)
}
