// @vitest-environment jsdom
// Teil 2 von #415: Anschrift und Kontakt des Vermieters in den Einstellungen, als Vorgabe für Rücksendeangabe und
// Fußzeile des Briefs.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Settings } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: 'Max Vermieter', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '', landlordAddress: 'Hauptstr. 1, 10115 Berlin' }
let puts: { url: string, body: unknown }[]
beforeEach(() => {
  puts = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') puts.push({ url: url.split('?')[0] ?? url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Anschrift und Kontakt des Vermieters werden mit den Vermieterdaten gespeichert', async () => {
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: null, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
  const address = await screen.findByLabelText(/Anschrift des Vermieters/, {}, SLOW) as HTMLInputElement
  expect(address.value).toBe('Hauptstr. 1, 10115 Berlin')
  fireEvent.change(screen.getByLabelText(/Kontakt/), { target: { value: 'Tel. 030 123456' } })
  const card = address.closest('section') ?? document.body
  fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({
    url: '/api/settings',
    body: { landlordName: 'Max Vermieter', iban: '', paymentDeadlineDays: 30, landlordAddress: 'Hauptstr. 1, 10115 Berlin', landlordContact: 'Tel. 030 123456' },
  })
})
