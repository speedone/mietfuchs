// @vitest-environment jsdom
// Das neue Auswahlfeld „Jahr der Zahlung“ zeigt den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import CostPeriodFields from './CostPeriodFields'
import { EMPTY_ITEM_FORM } from '../costForm'


afterEach(cleanup)

describe('Leistungszeitraum und Jahr der Zahlung (#208)', () => {
  test('ein gewähltes Jahr steht im Feld', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '2026' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('2026')
    expect(select.selectedOptions[0]?.textContent).toBe('2026')
  })
  test('ohne Wahl steht „bitte wählen“ im Feld und nichts anderes', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('– bitte wählen –')
  })
  test('Brennstoff nur bei Heizkosten, Jahr der Zahlung nur auf Wunsch', () => {
    const { rerender } = render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByLabelText(/Brennstoff\/Energie/)).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Jahr der Zahlung/ })).toBeNull()
    rerender(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.getByLabelText(/Brennstoff\/Energie/)).toBeTruthy()
  })
})
