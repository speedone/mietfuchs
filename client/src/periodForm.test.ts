import { describe, expect, test } from 'vitest'
import { anchorOf, labelOfKey, periodSpanText, periodView } from './periodForm'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodRules } from './types'

const TODAY = '2026-10-05'
const MAI: PeriodRules = { startMonth: 5, changes: [] }
const WECHSEL: PeriodRules = { startMonth: 1, changes: ['2025-05'] }

describe('Zeitraumumschalter (#208)', () => {
  test('Kalenderobjekt: wie bisher, das Vorjahr, Jahreszahlen als Werte, acht Jahre', () => {
    const v = periodView(CALENDAR_RULES, { anchor: null, calendarYear: null }, TODAY)
    expect([v.calendar, v.key, v.label, v.param, v.year, v.calendarYear, v.switcherLabel]).toEqual([true, '2025-01', '2025', '2025', 2025, 2025, 'Abrechnungsjahr'])
    expect(v.options.map((o) => o.value)).toEqual(['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'])
    expect(v.options.map((o) => o.label)).toEqual(['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019'])
    expect(v.at.previousLabel).toBe('2024')
  })

  test('Mai bis April: der zuletzt beendete Zeitraum, Schlüssel als Werte, Kalenderjahr eigens', () => {
    const v = periodView(MAI, { anchor: null, calendarYear: null }, TODAY)
    expect([v.calendar, v.key, v.label, v.param, v.switcherLabel]).toEqual([false, '2025-05', '2025/2026', '2025-05', 'Abrechnungszeitraum'])
    expect(v.options[0]).toEqual({ value: '2026-05', label: '2026/2027' })
    expect(periodView(MAI, { anchor: null, calendarYear: 2024 }, TODAY).calendarYear).toBe(2024)
  })

  test('Ein Rumpf heißt in der Auswahl so', () => {
    const v = periodView(WECHSEL, { anchor: '2025-02-01', calendarYear: null }, TODAY)
    expect([v.key, v.label]).toEqual(['2025-01', '01.01.–30.04.2025'])
    expect(v.options.find((o) => o.value === '2025-01')?.label).toBe('01.01.–30.04.2025 (Rumpf)')
  })

  test('Der gewählte Tag bestimmt den Zeitraum, auch nach dem Wechsel des Objekts', () => {
    const anchor = anchorOf(CALENDAR_RULES, '2025') ?? ''
    expect(anchor).toBe('2025-01-01')
    expect(periodView(MAI, { anchor, calendarYear: null }, TODAY).key).toBe('2024-05')
    expect(anchorOf(MAI, '2025-05')).toBe('2025-05-01')
    expect(anchorOf(MAI, '2025-03')).toBeNull()
  })

  test('Ein älterer gewählter Zeitraum steht in der Auswahl', () => {
    const v = periodView(CALENDAR_RULES, { anchor: '2015-01-01', calendarYear: null }, TODAY)
    expect(v.options.some((o) => o.value === '2015')).toBe(true)
  })

  test('Bezeichnungen', () => {
    expect(labelOfKey(MAI, periodKey('2025-05'))).toBe('2025/2026')
    expect(periodSpanText(periodOfKey(MAI, periodKey('2025-05')) ?? expect.unreachable())).toBe('Mai 2025 bis April 2026')
  })
})
