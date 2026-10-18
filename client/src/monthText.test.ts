import { expect, test } from 'vitest'
import { MONTH_NAMES, gridMove, monthLabel, monthProblem, parseMonthText } from './monthText'

const key = (text: string) => {
  const r = parseMonthText(text)
  return r.kind === 'month' ? r.key : r.kind
}

test('Monatsfeld liest die Schreibweisen der Spezifikation (#287, #346 Schritt 5)', () => {
  expect(key('3.2025')).toBe('2025-03')
  expect(key('03/25')).toBe('2025-03')
  expect(key('2025-03')).toBe('2025-03')
  expect(key('März 2025')).toBe('2025-03')
  expect(key('Mrz 27')).toBe('2027-03')
  // und die üblichen Abwandlungen
  expect(key('03.2025')).toBe('2025-03')
  expect(key(' 3 / 2025 ')).toBe('2025-03')
  expect(key('3-2025')).toBe('2025-03')
  expect(key('3 2025')).toBe('2025-03')
  expect(key('3.26')).toBe('2026-03')
  expect(key('2025/3')).toBe('2025-03')
  expect(key('maerz 2025')).toBe('2025-03')
  expect(key('MÄRZ 2025')).toBe('2025-03')
  expect(key('Mär. 2025')).toBe('2025-03')
  expect(key('Sept. 2024')).toBe('2024-09')
  expect(key('Jänner 2026')).toBe('2026-01')
  expect(key('Dez 2025')).toBe('2025-12')
  expect(key('Mai2025')).toBe('2025-05')
  expect(key('Oktober 2026')).toBe('2026-10')
})

test('Monatsfeld: ein Tag nur als Erster, wie bisher bei den Staffeln', () => {
  expect(key('01.03.2025')).toBe('2025-03')
  expect(key('1.3.2025')).toBe('2025-03')
  expect(key('2025-03-01')).toBe('2025-03')
  const day = parseMonthText('15.10.2026')
  expect(day.kind).toBe('invalid')
  if (day.kind === 'invalid') expect(day.short).toBe('Nur Monat und Jahr')
  expect(parseMonthText('2026-10-15').kind).toBe('invalid')
})

test('Monatsfeld: zweistellige Jahre wie POSIX (00 bis 68 → 20xx, 69 bis 99 → 19xx)', () => {
  expect(key('3.00')).toBe('2000-03')
  expect(key('3.68')).toBe('2068-03')
  expect(key('3.69')).toBe('1969-03')
  expect(key('12/99')).toBe('1999-12')
})

test('Monatsfeld: Grenzfälle ergeben eine Meldung am Feld, nichts wird geraten', () => {
  const problem = (text: string) => {
    const r = parseMonthText(text)
    if (r.kind !== 'invalid') throw new Error(`${text} ergibt ${r.kind}`)
    return r
  }
  expect(problem('13.2025').short).toBe('Monat 13 gibt es nicht')
  expect(problem('13.2025').text).toMatch(/Monat als Zahl von 1 bis 12/)
  expect(problem('0.2025').short).toBe('Monat 0 gibt es nicht')
  expect(problem('2025-13').short).toBe('Monat 13 gibt es nicht')
  expect(problem('März').short).toBe('Jahr fehlt')
  expect(problem('3').short).toBe('Jahr fehlt')
  expect(problem('03.').short).toBe('Jahr fehlt')
  expect(problem('2025').short).toBe('Monat fehlt')
  expect(problem('.2026').short).toBe('Monat fehlt')
  expect(problem('01.1899').short).toBe('Jahr außerhalb 1900 bis 2100')
  expect(problem('01.1899').text).toMatch(/1899 liegt außerhalb von 1900 bis 2100/)
  expect(problem('2206-01').short).toBe('Jahr außerhalb 1900 bis 2100')
  expect(problem('irgendwann').short).toBe('Monat nicht lesbar')
  expect(problem('irgendwann').text).toMatch(/„irgendwann“/)
  expect(problem('Mrzz 2025').short).toBe('Monat nicht lesbar')
  expect(problem('3.2025.4').short).toBe('Monat nicht lesbar')
  expect(problem('26-01').short).toBe('Monat 26 gibt es nicht')
  expect(key('01.2100')).toBe('2100-01')
  expect(key('01.1900')).toBe('1900-01')
  expect(parseMonthText('').kind).toBe('empty')
  expect(parseMonthText('   ').kind).toBe('empty')
})

test('Monatsfeld: Anzeige als „März 2025“, und die Anzeige liest sich wieder', () => {
  expect(monthLabel('2025-03')).toBe('März 2025')
  expect(monthLabel('2026-12')).toBe('Dezember 2026')
  for (let m = 1; m <= 12; m++) {
    const k = `2025-${String(m).padStart(2, '0')}`
    expect(key(monthLabel(k))).toBe(k)
  }
  expect(MONTH_NAMES).toHaveLength(12)
})

test('Monatsfeld: Meldung mit Ort für die Sammelmeldung', () => {
  expect(monthProblem('13.2025', 'Neuer Zeitraum')).toEqual({ short: 'Monat 13 gibt es nicht', text: 'Neuer Zeitraum: Den Monat 13 gibt es nicht. Geben Sie den Monat als Zahl von 1 bis 12 ein, etwa „3.2025“.' })
  expect(monthProblem('', 'Neuer Zeitraum')).toEqual({ short: 'Monat fehlt', text: 'Neuer Zeitraum: Geben Sie den Monat ein, etwa „3.2025“ oder „März 2025“.' })
  expect(monthProblem('3.2025', 'Neuer Zeitraum')).toBeNull()
})

test('Monatsraster: Pfeile, Pos1/Ende und Bild auf/ab nach dem APG-Grid-Muster', () => {
  // 3 Spalten, 4 Zeilen; der Monat ist 0-basiert
  expect(gridMove({ year: 2025, month: 4 }, 'ArrowRight')).toEqual({ year: 2025, month: 5 })
  expect(gridMove({ year: 2025, month: 4 }, 'ArrowLeft')).toEqual({ year: 2025, month: 3 })
  expect(gridMove({ year: 2025, month: 4 }, 'ArrowDown')).toEqual({ year: 2025, month: 7 })
  expect(gridMove({ year: 2025, month: 4 }, 'ArrowUp')).toEqual({ year: 2025, month: 1 })
  // über das Jahr hinaus geht es ins Nachbarjahr
  expect(gridMove({ year: 2025, month: 11 }, 'ArrowRight')).toEqual({ year: 2026, month: 0 })
  expect(gridMove({ year: 2025, month: 0 }, 'ArrowLeft')).toEqual({ year: 2024, month: 11 })
  expect(gridMove({ year: 2025, month: 10 }, 'ArrowDown')).toEqual({ year: 2026, month: 1 })
  expect(gridMove({ year: 2025, month: 1 }, 'ArrowUp')).toEqual({ year: 2024, month: 10 })
  // Pos1/Ende: Anfang und Ende der Zeile
  expect(gridMove({ year: 2025, month: 4 }, 'Home')).toEqual({ year: 2025, month: 3 })
  expect(gridMove({ year: 2025, month: 4 }, 'End')).toEqual({ year: 2025, month: 5 })
  // Bild auf/ab: Jahr zurück und vor, derselbe Monat
  expect(gridMove({ year: 2025, month: 4 }, 'PageUp')).toEqual({ year: 2024, month: 4 })
  expect(gridMove({ year: 2025, month: 4 }, 'PageDown')).toEqual({ year: 2026, month: 4 })
  // nicht über 1900 bis 2100 hinaus
  expect(gridMove({ year: 1900, month: 0 }, 'ArrowLeft')).toEqual({ year: 1900, month: 0 })
  expect(gridMove({ year: 2100, month: 4 }, 'PageDown')).toEqual({ year: 2100, month: 4 })
  expect(gridMove({ year: 2025, month: 4 }, 'Tab')).toBeNull()
})
