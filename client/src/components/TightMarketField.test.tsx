// @vitest-environment jsdom
// Die Frage zum angespannten Wohnungsmarkt am Objekt (Heizung PR 18): Die Auswahl zeigt den gespeicherten Wert.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TightMarketField from './TightMarketField'

afterEach(cleanup)

test('Die Auswahl zeigt den gespeicherten Wert; Geltung nur bei „ja“', () => {
  for (const value of ['ja', 'nein', 'unbekannt'] as const) {
    render(<TightMarketField value={value} from="2025-07-01" to="" onChange={() => {}} />)
    const el = screen.getByLabelText('Angespannter Wohnungsmarkt')
    if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
    expect(el.value).toBe(value)
    expect(screen.queryByLabelText('Verordnung gilt seit') !== null).toBe(value === 'ja')
    cleanup()
  }
})

// UI-Durchsicht M2: Der Begriff öffnete die Erklärung „Hälftige Teilung ab 2028“ statt einer eigenen.
test('der Begriff erklärt den angespannten Wohnungsmarkt, nicht die hälftige Teilung', () => {
  render(<TightMarketField value="unbekannt" from="" to="" onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Angespannter Wohnungsmarkt' }))
  const note = screen.getByRole('note')
  expect(note.textContent).toContain('Kündigungssperrfrist (§ 577a Abs. 2 BGB)')
  expect(note.textContent).not.toContain('Hälftige Teilung ab')
})

test('Prüfung S9, K4: gefragt wird nach dem Gebiet, nicht nach der Gemeinde, und nach der Kündigungssperrfrist', () => {
  render(<TightMarketField value="unbekannt" from="" to="" onChange={() => {}} />)
  expect(screen.getByText(/Liegt das Gebäude in einem Gebiet, das eine Verordnung zur Mietpreisbremse \(§ 556d BGB\), zur Kappungsgrenze \(§ 558 Abs\. 3 BGB\) oder zur Kündigungssperrfrist \(§ 577a Abs\. 2 BGB\) bestimmt\? Manche Verordnungen nennen nur Teile einer Gemeinde\./)).toBeTruthy()
  expect(screen.getByText('ja, das Gebäude liegt in einem solchen Gebiet')).toBeTruthy()
})
