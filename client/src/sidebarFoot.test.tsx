// @vitest-environment jsdom
// Der Fuß der Seitenleiste (#142, Punkt 12): Der Design-Knopf trägt seinen Namen selbst, und der
// beginnt mit dem sichtbaren Text. Am Handy steht derselbe Fuß im Menüblatt (#346, Schritt 9); den
// früheren kleinen Knopf „🌗“ ohne Text gibt es nicht mehr.
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

test('der Fuß verspricht nichts Pauschales über den Ort der Daten', async () => {
  render(<App />)
  await screen.findByRole('button', { name: /^Design: System/ }, { timeout: 5000 })
  expect(document.body.textContent).not.toMatch(/bleiben lokal/)
})

test('der Design-Knopf ist benannt, und sein Name beginnt mit dem sichtbaren Text', async () => {
  render(<App />)
  // Der zugängliche Name beginnt mit dem sichtbaren Text (WCAG 2.5.3, Beschriftung im Namen):
  // Wer per Sprachsteuerung „Design: System“ sagt, trifft den Knopf.
  const knopf = await screen.findByRole('button', { name: /^Design: System – wechseln/ }, { timeout: 5000 })
  expect(knopf.textContent).toBe('🌗 Design: System')
  expect(knopf.getAttribute('aria-label')?.startsWith('Design: System')).toBe(true)
})
