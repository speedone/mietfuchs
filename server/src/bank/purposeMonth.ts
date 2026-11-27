// Der Monat, den ein Verwendungszweck nennt (#693). Rein. Nennt der Mieter bei der Zahlung den Monat, bestimmt er damit
// die Schuld, die getilgt wird (§ 366 Abs. 1 BGB); ob ein Zweck das tut, ist Auslegung, deshalb ist das Ergebnis hier nur
// ein Vorschlag, den der Vermieter bestätigt (match.ts). **Im Zweifel kein Monat**: Ein verpasster kostet nichts (die
// Zeile steht wie ohne diese Erkennung), ein falscher stünde bei jedem Eingang dieses Mieters als gelber Vorschlag da.
// Die Tabelle echter und erfundener Zwecke mit allen Fehlalarmen der Durchsicht steht in bank-purpose-month.test.ts.
//
// Vorbedingung: Der Zweck enthält „miet“ und keines von „Kaution“, „Rechnung“/„Abrechnung“, „Nachzahlung“, „Guthaben“.
//
// Eine **Nennung** ist jeder Monatsname (auch abgekürzt, ohne Umlaute) als eigenes Wort und jede Zahlenform MM/JJJJ,
// MM.JJJJ, MM-JJJJ, JJJJ-MM (kein zweistelliges Jahr, keine bloße Zahl, kein Teil eines Datums). Erkannt wird nur, wenn
// der Zweck **genau eine** Nennung hat und diese **trägt**:
// - ein Monatsname mit vierstelligem Jahr unmittelbar dahinter („Nov 2026“, „Dezember/2026“), gleich wo er steht,
// - ein ausgeschriebener Monatsname, der kein Vor- oder Nachname ist (nicht April, Mai, Juli, August), unmittelbar hinter
//   dem Wort der Miete („Miete“, „Kaltmiete“, „Restmiete“, „Mietzahlung“ …; dazwischen höchstens „für“, „den“, „Monat“),
//   wenn dahinter weder eine Zahl („November 26“, „November 3. OG“) noch ein Bindestrich mit Wort („Oktober-Str.“) steht,
// - eine Zahlenform unmittelbar hinter dem Wort der Miete (also nie hinter „Whg“, „Vertrag“, „Kd-Nr“, einer Straße).
// Jede andere Nennung (Abkürzung oder Name wie „Jan“, „August“, „Mai“ ohne Jahr, ein Monat mitten im Zweck, eine
// Zahlenform an anderer Stelle) trägt nicht und **verhindert** den Vorschlag, ebenso ein Tag vor dem Monatsnamen
// („3. November“) und „seit“, „ab“, „bis“, „vom“, „zum“, „am“ davor. Zwei Monate oder ein Bereich sind zwei Nennungen.
//
// Jahr: genannt höchstens 24 Monate vor und 3 Monate nach dem Buchungsmonat. Ohne Jahr der nächstliegende Monat, wenn er
// höchstens zwei Monate vor und einen Monat nach dem Buchungsmonat liegt („Miete Dezember“ am 04.01., „Miete Januar“ am
// 28.12.), sonst kein Vorschlag: Wer im November „Miete Januar“ schreibt, kann den vergangenen oder den kommenden meinen.

const SAFE_NAMES: Readonly<Record<string, number>> = { januar: 1, februar: 2, maerz: 3, marz: 3, juni: 6, september: 9, oktober: 10, november: 11, dezember: 12 }
// Nur mit Jahr: Abkürzungen und Monatsnamen, die auch Vor- oder Nachnamen sind.
const WEAK_NAMES: Readonly<Record<string, number>> = {
  april: 4, mai: 5, juli: 7, august: 8,
  jan: 1, feb: 2, maer: 3, mrz: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, nov: 11, dez: 12,
}
const NAMES: Readonly<Record<string, number>> = { ...SAFE_NAMES, ...WEAK_NAMES }
// Längere Namen zuerst, damit „sept“ nicht als „sep“ mit Rest gelesen wird.
const NAME = new RegExp(`(?<![a-z])(${Object.keys(NAMES).sort((a, b) => b.length - a.length).join('|')})(?![a-z])`, 'g')
const MONTH_YEAR = /(?<![\d./-])(\d{1,2})[/.-](20\d{2})(?!\d|[/.-]\d)/g
const YEAR_MONTH = /(?<![\d./-])(20\d{2})[-/](\d{2})(?!\d|[/.-]\d)/g
const NOT_RENT = /kaution|rechnung|nachzahlung|guthaben/
// Wörter, nach denen ein Monat einen Zeitraum oder ein Datum meint, nicht den Monat der Zahlung.
const SPAN_WORD = /(?:^|[^a-z])(?:seit|ab|bis|vom|zum|am)\s+$/
// Unmittelbar hinter dem Wort der Miete: „Miete “, „Kaltmiete: “, „Miete für den Monat “.
const AFTER_RENT = /(?:[a-z]*miete|mietzahlung|mietzins)[\s:]*(?:(?:fuer|den|monat)\s+)*$/
const YEAR_AFTER = /^\.?[\s/.-]*(20\d{2})(?!\d|[/.-]\d)/

const BEFORE_WITH_YEAR = 24
const AFTER_WITH_YEAR = 3
const BEFORE_WITHOUT_YEAR = 2
const AFTER_WITHOUT_YEAR = 1

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
  const found: number[] = []
  // Eine Nennung, die nicht trägt, oder ein unplausibles Jahr: kein Vorschlag, was immer sonst im Zweck steht.
  let refused = false
  let mentions = 0
  const withYear = (year: number, month: number): void => {
    const index = year * 12 + month - 1
    if (month < 1 || month > 12 || index < booked - BEFORE_WITH_YEAR || index > booked + AFTER_WITH_YEAR) refused = true
    else found.push(index)
  }
  // Zuerst die Zahlenformen; sie werden danach aus dem Text genommen, damit ihre Ziffern kein „November 11“ ergeben.
  let rest = text
  for (const [pattern, yearAt, monthAt] of [[MONTH_YEAR, 2, 1], [YEAR_MONTH, 1, 2]] as const) {
    for (const m of text.matchAll(pattern)) {
      mentions++
      if (AFTER_RENT.test(text.slice(0, m.index))) withYear(Number(m[yearAt]), Number(m[monthAt]))
      else refused = true
    }
    rest = rest.replace(pattern, (hit) => '#'.repeat(hit.length))
  }
  for (const m of rest.matchAll(NAME)) {
    mentions++
    const name = m[1] ?? ''
    const month = NAMES[name]
    if (month === undefined) continue
    const before = rest.slice(0, m.index)
    const after = rest.slice(m.index + m[0].length)
    // „3. November“, „03 Nov“: ein Datum. „seit Mai“: ein Zeitraum.
    if (/\d\.?\s*$/.test(before) || SPAN_WORD.test(before)) refused = true
    const year = YEAR_AFTER.exec(after)
    if (year) withYear(Number(year[1]), month)
    // Ohne Jahr nur der ausgeschriebene, unverwechselbare Name unmittelbar hinter der Miete, ohne Zahl oder
    // Bindestrich-Wort dahinter („November 26“, „Oktober-Str.“).
    else if (!(name in SAFE_NAMES) || !AFTER_RENT.test(before) || /^\.?\s*\d/.test(after) || /^\s*-\s*[a-z]/.test(after)) refused = true
    else {
      const near = [-12, 0, 12].map((shift) => booked - (((booked % 12) - (month - 1) + 12) % 12) + shift)
        .find((index) => index >= booked - BEFORE_WITHOUT_YEAR && index <= booked + AFTER_WITHOUT_YEAR)
      if (near === undefined) refused = true
      else found.push(near)
    }
  }
  const [only] = found
  return refused || mentions !== 1 || only === undefined ? null : keyOf(only)
}
