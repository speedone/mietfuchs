// @vitest-environment jsdom
// Das neue Auswahlfeld „Jahr der Zahlung“ zeigt den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.queryByLabelText('Teil der Heizkosten')).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Jahr der Zahlung/ })).toBeNull()
    rerender(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.getByLabelText('Teil der Heizkosten')).toBeTruthy()
  })
  // Nachprüfung von #237: Die Auswahl zeigt jeden gespeicherten Teil der Heizkosten, auch „Betrieb“ und
  // „ohne Angabe“, und eine Wahl schickt genau diesen Wert.
  test('Teil der Heizkosten: angezeigter Wert = gespeicherter Wert', () => {
    for (const [part, label] of [['', 'ohne Angabe'], ['fuel', 'Brennstoff/Energie (Gas, Öl, Fernwärme, Strom der Wärmepumpe)'], ['operating', 'Betrieb, Wartung, Strom der Heizung'], ['metering', 'Messdienst, Ablesung, Geräte']] as const) {
      render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: part }} onChange={() => {}} showTaxYear={false} years={[]} />)
      const select = screen.getByLabelText('Teil der Heizkosten') as HTMLSelectElement
      expect(select.value).toBe(part)
      expect(select.selectedOptions[0]?.textContent).toBe(label)
      cleanup()
    }
    let next = EMPTY_ITEM_FORM
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={(f) => { next = f }} showTaxYear={false} years={[]} />)
    fireEvent.change(screen.getByLabelText('Teil der Heizkosten'), { target: { value: 'operating' } })
    expect(next.heatingPart).toBe('operating')
  })
})
