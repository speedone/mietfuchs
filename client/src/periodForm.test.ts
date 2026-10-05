import { describe, expect, test } from 'vitest'
import { anchorOf, answersOf, initialAnswers, labelOfKey, nextRules, periodSpanText, periodView, rhythmText, withoutChange } from './periodForm'
import { CALENDAR_RULES, periodKey, periodOfKey } from '../../shared/period.ts'
import type { PeriodChangePreview, PeriodRules } from './types'

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

describe('Rhythmus ändern (#208)', () => {
  test('in Worten', () => {
    expect(rhythmText(CALENDAR_RULES)).toBe('Kalenderjahr (Januar bis Dezember)')
    expect(rhythmText(MAI)).toBe('Mai bis April')
    expect(rhythmText(WECHSEL)).toBe('Kalenderjahr (Januar bis Dezember), ab Mai 2025: Mai bis April')
  })
  test('neue Regeln aus dem Formular', () => {
    expect(nextRules(CALENDAR_RULES, { mode: 'start', month: 5, from: '' })).toEqual({ startMonth: 5, changes: [] })
    expect(nextRules(CALENDAR_RULES, { mode: 'change', month: 1, from: '2025-05' })).toEqual({ startMonth: 1, changes: ['2025-05'] })
    expect(nextRules(CALENDAR_RULES, { mode: 'change', month: 1, from: '' })).toEqual({ error: 'Bitte geben Sie an, ab welchem Monat der neue Zeitraum beginnt.' })
    expect(withoutChange(WECHSEL, '2025-05')).toEqual({ startMonth: 1, changes: [] })
  })
  const vorschau: PeriodChangePreview = {
    rules: WECHSEL, periods: [], newShort: [], blocked: [], moves: [], assessments: [],
    groups: [{ from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-01') }],
    overrides: [{ tenancyId: 't-a', tenantName: 'A', from: [{ key: periodKey('2025-01'), label: '2025', cents: 220000 }], ask: [{ period: periodKey('2025-01'), label: '01.01.–30.04.2025', months: '01–04/2025' }, { period: periodKey('2025-05'), label: '2025/2026', months: '05/2025–04/2026' }] }],
  }
  test('Antworten: Zuordnung vorbelegt, jede Korrektur verlangt einen Betrag oder „keine Korrektur“ (N4)', () => {
    const form = initialAnswers(vorschau)
    expect(form.groups).toEqual({ '2025-01': '2025-01' })
    expect(answersOf(vorschau, form)).toEqual({ error: 'Bitte tragen Sie für A ein, was 01–04/2025 tatsächlich gezahlt wurde, oder wählen Sie „keine Korrektur“.' })
    const ausgefuellt = { ...form, overrides: { 't-a': { '2025-01': { amount: '700,00', none: false }, '2025-05': { amount: '', none: true } } } }
    expect(answersOf(vorschau, ausgefuellt)).toEqual({ groups: { '2025-01': '2025-01' }, overrides: { 't-a': { '2025-01': 70000, '2025-05': null } } })
    expect(answersOf(vorschau, { ...ausgefuellt, overrides: { 't-a': { '2025-01': { amount: 'siebenhundert', none: false }, '2025-05': { amount: '', none: true } } } }))
      .toEqual({ error: 'Bitte tragen Sie für A ein, was 01–04/2025 tatsächlich gezahlt wurde, als Euro-Betrag, etwa 700,00.' })
  })
})
