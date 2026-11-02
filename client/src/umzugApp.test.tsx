// @vitest-environment jsdom
// Durchsicht D4 zum Umzug (#517): Solange „Ihre bisherigen Daten übernehmen“ gilt, steht der Bildschirm auf jeder Seite.
// Sonst legte ein Klick in die Seitenleiste eine Wohnung an, der Bestand wäre da, und der Umzug ginge nicht mehr.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  window.mietfuchsDesktop = { print: async () => {} }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0]
    if (path === '/api/relocation') return json({ offered: true })
    if (path === '/api/relocation/candidates') return json({ offered: true, candidates: [], searched: true, complete: true })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
})

// Geänderte Erwartung (Praxistest A): Die Seitenleiste fehlt jetzt ganz, solange der Umzug angeboten ist; ein Klick
// dorthin bewirkte ohnehin nichts. Der Bildschirm bleibt, auch wenn die Seite intern wechselt.
test('Umzug angeboten: keine Navigation, der Bildschirm bleibt', async () => {
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Mietfuchs' }, { timeout: 5000 })
  expect(screen.queryByRole('button', { name: /Stammdaten/ })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Hauptnavigation' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Daten übernehmen' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Ihre bisherigen Daten übernehmen' })).toBeTruthy()
})
