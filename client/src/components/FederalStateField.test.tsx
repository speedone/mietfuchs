// @vitest-environment jsdom
// Das Bundesland am Objekt: Die Auswahl zeigt den gespeicherten Wert, für jedes Land und für „unbekannt“.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FederalStateField from './FederalStateField'
import { STATE_CODES } from '../../../shared/holidays.ts'
import type { FederalState } from '../types'

afterEach(cleanup)

const select = (): HTMLSelectElement => {
  const el = screen.getByLabelText(/Bundesland \(für Fristen und Feiertage\)/)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl zeigt den gespeicherten Wert', () => {
  for (const value of ['', ...STATE_CODES] as const) {
    render(<FederalStateField value={value} year={2026} onChange={() => {}} />)
    expect(select().value).toBe(value)
    cleanup()
  }
  render(<FederalStateField value="" year={2026} onChange={() => {}} />)
  expect(select().selectedOptions[0]?.textContent).toBe('unbekannt – es gelten nur bundesweite Feiertage')
})

test('Eine Wahl meldet das Kürzel; Bayern nennt die Feiertage einzelner Gemeinden', () => {
  const gewaehlt: (FederalState | '')[] = []
  render(<FederalStateField value="BY" year={2026} onChange={(s) => gewaehlt.push(s)} />)
  expect(screen.getByText(/Augsburger Friedensfest \(nur im Stadtgebiet Augsburg\)/)).toBeTruthy()
  fireEvent.change(select(), { target: { value: 'HB' } })
  fireEvent.change(select(), { target: { value: '' } })
  expect(gewaehlt).toEqual(['HB', ''])
})
