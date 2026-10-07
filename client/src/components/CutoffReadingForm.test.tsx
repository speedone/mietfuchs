// @vitest-environment jsdom
// Der Stichtagswert laut Anzeige (Heizung PR 12, Entwurf 8.1) wird als Ablesung mit Wechsel gespeichert.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CutoffReadingForm from './CutoffReadingForm'

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Stichtagswert laut Anzeige wird als Ablesung mit Wechsel gespeichert', async () => {
  const saved = vi.fn()
  render(<CutoffReadingForm meterId="h1" onSaved={saved} />)
  fireEvent.change(screen.getByLabelText(/Stichtag des Geräts/), { target: { value: '2025-12-31' } })
  fireEvent.change(screen.getByLabelText(/Stichtagswert laut Anzeige/), { target: { value: '842' } })
  fireEvent.click(screen.getByRole('button', { name: 'Stichtagswert speichern' }))
  await waitFor(() => expect(saved).toHaveBeenCalled(), { timeout: 5000 })
  expect(sent).toEqual([{ url: '/api/readings', method: 'POST', body: { meterId: 'h1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 842 } }])
})

test('Mehrdeutiger Wert: nachgefragt, nichts gesendet', () => {
  render(<CutoffReadingForm meterId="h1" onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText(/Stichtag des Geräts/), { target: { value: '2025-12-31' } })
  fireEvent.change(screen.getByLabelText(/Stichtagswert laut Anzeige/), { target: { value: '1.250' } })
  fireEvent.click(screen.getByRole('button', { name: 'Stichtagswert speichern' }))
  expect(screen.getByText(/Meinen Sie 1,250 oder 1250\?/)).toBeTruthy()
  expect(sent).toEqual([])
})
