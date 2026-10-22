// Ein Jahr als Text, Gegenstück zu monthText.ts für reine Jahresfelder (components/YearField.tsx: Eichjahr eines
// Zählers, Jahr der Zahlung). Ohne DOM, damit Feld und Prüfungen der Formulare dieselbe Regel lesen.
//
// Gelesen wird nur ein vierstelliges Jahr von YEAR_MIN bis YEAR_MAX. Ein zweistelliges wird nicht ergänzt: „28“
// kann 1928 oder 2028 sein, und ein Eichjahr oder Steuerjahr zu raten, hieße eine Frist oder ein Steuerjahr zu
// verschieben. Wie beim Monat wird Unlesbares benannt: `short` für die Meldung am Feld, `text` als Satz für die
// Sammelmeldung.
import { YEAR_MAX, YEAR_MIN } from './monthText'

export type YearParse =
  | { kind: 'empty' }
  | { kind: 'year'; year: number }
  | { kind: 'invalid'; short: string; text: string }

const FOUR_DIGITS = 'Geben Sie das Jahr vierstellig ein, etwa „2031“.'

export function parseYearText(text: string): YearParse {
  // Ein Punkt am Ende („2031.“) gehört nicht zur Angabe, wie beim Monat.
  const t = text.trim().replace(/\s*\.$/, '')
  if (t === '') return { kind: 'empty' }
  if (/^\d{4}$/.test(t)) {
    const year = Number(t)
    if (year < YEAR_MIN || year > YEAR_MAX) {
      return { kind: 'invalid', short: `Jahr außerhalb ${YEAR_MIN} bis ${YEAR_MAX}`, text: `Das Jahr ${t} liegt außerhalb von ${YEAR_MIN} bis ${YEAR_MAX}. Bitte prüfen Sie das Jahr.` }
    }
    return { kind: 'year', year }
  }
  if (/^\d{1,3}$/.test(t)) return { kind: 'invalid', short: 'Jahr vierstellig angeben', text: FOUR_DIGITS }
  return { kind: 'invalid', short: 'Kein Jahr', text: `„${t}“ ist kein Jahr. ${FOUR_DIGITS}` }
}
