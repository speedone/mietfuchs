// Gradtage (#208, Entwurf 3.5): welcher Anteil eines Jahres an Heizwärme auf eine Zeitspanne
// entfällt. Ein Jahr hat 1.000 Promille; ein Monat seinen Wert aus der Tabelle des Registers
// (`hkv.degree-days`), Juni bis August zusammen den Sommerwert. Innerhalb eines Monats zählt jeder
// Tag gleich (Monatswert ÷ Tage des Monats, im Februar eines Schaltjahres ÷ 29), im Sommer der
// Sommerwert ÷ Tage von Juni bis August. Diese Tageswerte sind eine Festlegung (Entwurf 3.5, 15.3,
// ⟨Norm offen: DIN 94680⟩); ista nennt sie beispielhaft (Oktober 80/31).
//
// Die Tabelle kommt als Argument herein und wird hier nicht gelesen: Die Berechnung holt sie mit
// `law()`, damit der Wert, mit dem gerechnet wurde, mit der Abrechnung einfriert, und diese Datei
// enthält keine Zahl der Tabelle (law-literals.test.ts). Liegt in shared/, weil der Server rechnet
// und das Lexikon dieselbe Tabelle erklärt. Hängt an keiner Uhr und keiner Locale.

import type { DegreeDayTable } from './law/heizkostenv.ts'

export type DayRange = { from: string; to: string }

const MS_DAY = 86400000
const toUTC = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

// Die Spannen, überlappende und aneinandergrenzende zusammengefasst, aufsteigend. Eine Spanne mit
// Ende vor dem Beginn fällt weg.
export function unionOf(ranges: readonly DayRange[]): DayRange[] {
  const sorted = ranges.filter((r) => r.from <= r.to).map((r) => ({ ...r })).sort((a, b) => toUTC(a.from) - toUTC(b.from))
  const result: DayRange[] = []
  for (const r of sorted) {
    const last = result[result.length - 1]
    if (last && toUTC(r.from) <= toUTC(last.to) + MS_DAY) {
      if (r.to > last.to) last.to = r.to
    } else {
      result.push(r)
    }
  }
  return result
}

// Tage der Vereinigung, Grenzen einschließlich.
export function unionDays(ranges: readonly DayRange[]): number {
  return unionOf(ranges).reduce((a, r) => a + Math.round((toUTC(r.to) - toUTC(r.from)) / MS_DAY) + 1, 0)
}

// Tage der zwölf Monate ab einem Beginn: 365, über einen 29. Februar 366. „Genau zwölf Monate
// ergeben den Jahresbetrag“ (Entwurf 3.7, D3) heißt deshalb nicht immer × 365.
export function yearDaysFrom(from: string): number {
  const start = new Date(toUTC(from))
  const end = new Date(toUTC(from))
  end.setUTCFullYear(end.getUTCFullYear() + 1)
  return Math.round((end.getTime() - start.getTime()) / MS_DAY)
}

function dayValue(iso: string, table: DegreeDayTable): number {
  const year = Number(iso.slice(0, 4))
  const month = iso.slice(5, 7)
  if (table.summerMonths.includes(month)) {
    const summerDays = table.summerMonths.reduce((a, m) => a + daysInMonth(year, Number(m)), 0)
    return table.summer / summerDays
  }
  const monthly = table.months[month]
  if (monthly === undefined) throw new Error(`Die Gradtagstabelle hat keinen Wert für den Monat ${month}.`)
  return monthly / daysInMonth(year, Number(month))
}

// Promille der Gradtage über die Vereinigung der Spannen: Was sich überschneidet, zählt einmal.
// Zwölf Monate ergeben 1.000, mehr als zwölf Monate mehr (Entwurf 3.7: „über zwölf Monate liegt
// der Gradtagsanteil über 1.000 ‰ und senkt den Betrag entsprechend“).
export function degreeDayPermille(ranges: readonly DayRange[], table: DegreeDayTable): number {
  let sum = 0
  for (const r of unionOf(ranges)) {
    for (let t = toUTC(r.from); t <= toUTC(r.to); t += MS_DAY) sum += dayValue(isoOf(t), table)
  }
  return sum
}
