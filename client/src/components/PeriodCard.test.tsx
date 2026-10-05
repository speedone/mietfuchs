// @vitest-environment jsdom
// Die Auswahlfelder der Karte „Abrechnungszeitraum“ zeigen den gewählten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PreviewAnswers, RhythmFields } from './PeriodCard'
import { initialAnswers } from '../periodForm'
import { periodKey } from '../../../shared/period.ts'
import type { PeriodChangePreview } from '../types'


afterEach(cleanup)

describe('Karte „Abrechnungszeitraum“ (#208)', () => {
  test('Beginnmonat: der gewählte Monat steht im Feld', () => {
    render(<RhythmFields form={{ mode: 'start', month: 5, from: '' }} onChange={() => {}} />)
    const art = screen.getByRole('combobox', { name: 'Was möchten Sie ändern?' }) as HTMLSelectElement
    expect(art.value).toBe('start')
    const monat = screen.getByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' }) as HTMLSelectElement
    expect([monat.value, monat.selectedOptions[0]?.textContent]).toEqual(['5', 'Mai'])
  })
  test('Wechsel: der Monat des Beginns, kein Beginnmonat', () => {
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2025-05' }} onChange={() => {}} />)
    expect((screen.getByLabelText(/Ab \(Monat und Jahr\)/) as HTMLInputElement).value).toBe('2025-05')
    expect(screen.queryByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' })).toBeNull()
  })
  test('Zuordnung einer Gruppe: der vorgeschlagene Zeitraum steht im Feld', () => {
    const preview: PeriodChangePreview = {
      rules: { startMonth: 1, changes: ['2025-05'] }, periods: [], newShort: [], blocked: [], moves: [], overrides: [], assessments: [],
      groups: [{ from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-05') }],
    }
    render(<PreviewAnswers preview={preview} answers={initialAnswers(preview)} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Zeitraum für „Müll 2025“/ }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['2025-05', '2025/2026'])
  })
})
