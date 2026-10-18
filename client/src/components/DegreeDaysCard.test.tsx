// @vitest-environment jsdom
// Karte „Gradtagzahlen Ihres Orts“ (#346, Schritt 7a): Eine ungespeicherte Eingabe zählt als offenes
// Formular, verglichen mit dem gespeicherten Stand; die Seite hängt die Karte nach dem Speichern nicht neu ein.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DegreeDaysCard from './DegreeDaysCard'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Ändern meldet die Karte an, Zurückstellen und Speichern nehmen die Marke weg', async () => {
  const saved = vi.fn()
  render(<OpenFormScope><DegreeDaysCard propertyId="objekt-1" months={['2025-01', '2025-02']} values={[]} onSaved={saved} /></OpenFormScope>)
  expect(hasOpenForm()).toBe(false)
  const jan = screen.getByLabelText('01/2025')
  fireEvent.change(jan, { target: { value: '300' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.change(jan, { target: { value: '' } })
  expect(hasOpenForm()).toBe(false)
  fireEvent.change(jan, { target: { value: '300' } })
  fireEvent.click(screen.getByText('Gradtagzahlen speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(hasOpenForm()).toBe(false)
})
