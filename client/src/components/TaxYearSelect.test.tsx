// @vitest-environment jsdom
// Das Jahr der Zahlung in der Liste „Aus dem Vorjahr übernehmen“ zeigt den vorbelegten Wert
// (Durchsicht von #226, I2; CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import TaxYearSelect from './TaxYearSelect'

afterEach(cleanup)

describe('Jahr der Zahlung als Auswahl (#208)', () => {
  test('ein vorbelegtes Jahr steht im Feld', () => {
    render(<TaxYearSelect label="Jahr der Zahlung für Müll" value="2026" years={[2025, 2026, 2027]} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Jahr der Zahlung für Müll' }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['2026', '2026'])
  })
  test('ohne Wahl „– bitte wählen –“', () => {
    render(<TaxYearSelect label="Jahr der Zahlung für Müll" value="" years={[2025, 2026, 2027]} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: 'Jahr der Zahlung für Müll' }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['', '– bitte wählen –'])
  })
})
