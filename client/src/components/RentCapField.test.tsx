// @vitest-environment jsdom
// Die Frage zur Kappungsgrenzen-Verordnung am Objekt (#191): Die Auswahl zeigt den gespeicherten Wert.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RentCapField from './RentCapField'
import { RENT_CAP_QUESTION } from '../propertyForm'

afterEach(cleanup)

test('Die Auswahl zeigt den gespeicherten Wert, mit allen drei Antworten', () => {
  for (const value of ['ja', 'nein', 'unbekannt'] as const) {
    render(<RentCapField value={value} onChange={() => {}} />)
    const el = screen.getByLabelText(RENT_CAP_QUESTION)
    if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
    expect(el.value).toBe(value)
    expect([...el.options].map((o) => o.value)).toEqual(['unbekannt', 'ja', 'nein'])
    cleanup()
  }
})

test('Der Begriff öffnet das Lexikon zur Kappungsgrenze; eine Wahl meldet den Wert', () => {
  let chosen = ''
  render(<RentCapField value="unbekannt" onChange={(v) => { chosen = v }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Kappungsgrenzen-Verordnung' }))
  expect(screen.getByRole('dialog', { name: 'Kappungsgrenze' }).textContent).toContain('Verordnung der Landesregierung')
  cleanup()
  render(<RentCapField value="unbekannt" onChange={(v) => { chosen = v }} />)
  fireEvent.change(screen.getByLabelText(RENT_CAP_QUESTION), { target: { value: 'nein' } })
  expect(chosen).toBe('nein')
})
