// @vitest-environment jsdom
// Der angezeigte Wert des Umschalters entspricht dem gewählten Zeitraum (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PeriodSelectView } from './PeriodSelect'
import { periodView } from '../periodForm'
import { CALENDAR_RULES } from '../../../shared/period.ts'


afterEach(cleanup)

describe('Zeitraumumschalter (#208)', () => {
  test('Kalenderobjekt: „Abrechnungsjahr“ mit der Jahreszahl', () => {
    render(<PeriodSelectView view={periodView(CALENDAR_RULES, { anchor: '2024-01-01', calendarYear: null }, '2026-10-05')} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Abrechnungsjahr' }) as HTMLSelectElement
    expect(select.value).toBe('2024')
    expect(select.selectedOptions[0]?.textContent).toBe('2024')
  })
  test('Mai bis April: „Abrechnungszeitraum“ mit dem Schlüssel und der Bezeichnung', () => {
    render(<PeriodSelectView view={periodView({ startMonth: 5, changes: [] }, { anchor: '2024-06-01', calendarYear: null }, '2026-10-05')} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Abrechnungszeitraum' }) as HTMLSelectElement
    expect(select.value).toBe('2024-05')
    expect(select.selectedOptions[0]?.textContent).toBe('2024/2025')
  })
})
