// @vitest-environment jsdom
// Der Fuß der Seitenleiste (#142, Punkt 12). Am Handy ist der Fuß ausgeblendet; die Umschaltung
// des Designs bleibt dort als kleiner Knopf „🌗“. Damit sie ohne den Text „Design: …“ bedienbar
// und benannt bleibt, trägt der Knopf seinen Namen selbst, und der Text steht in einem eigenen
// Element, das die Handy-Ansicht ausblenden kann. Ob er am unteren Fensterrand steht, prüft nur
// ein Browser.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('der Design-Knopf ist auch ohne den Text daneben benannt, und der Text lässt sich für sich ausblenden', async () => {
  render(<App />)
  const knopf = await screen.findByRole('button', { name: /^Design wechseln/ }, { timeout: 5000 })
  expect(knopf.getAttribute('aria-label')).toMatch(/^Design wechseln \(jetzt: .+\)$/)
  const text = knopf.querySelector('.theme-label')
  expect(text?.textContent).toMatch(/^Design: /)
})
