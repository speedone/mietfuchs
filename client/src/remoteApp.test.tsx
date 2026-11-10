// @vitest-environment jsdom
// Rückmeldung zur Kopplung (#528) im ganzen Programm: Verbunden steht „Verbunden mit …“ in der Seitenleiste, beim ersten
// Start bietet die Willkommensfrage den Weg ins Heimnetz an.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'
import type { RemoteState } from './desktopRemote'

function stubServer(offered: boolean) {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0]
    if (path === '/api/relocation') return json({ offered })
    if (path === '/api/relocation/candidates') return json({ offered, candidates: [], searched: true, complete: true })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    return json([])
  })
}
function stubWindow(state: RemoteState) {
  window.mietfuchsDesktop = { print: async () => {}, remote: { get: async () => state, connect: async () => ({ ok: true }), disconnect: async () => ({}) } }
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
})

test('verbunden: „Verbunden mit nas:3001“ in der Seitenleiste', async () => {
  stubServer(false)
  stubWindow({ connected: true, origin: 'https://nas:3001', version: '0.17.0' })
  render(<App />)
  expect(await screen.findByRole('button', { name: /^Verbunden mit nas:3001/ }, { timeout: 5000 })).toBeTruthy()
})

test('erster Start im Fenster: dritter Weg „Mit Mietfuchs im Heimnetz verbinden“', async () => {
  stubServer(true)
  stubWindow({ connected: false })
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Mietfuchs' }, { timeout: 5000 })
  expect(screen.getByRole('button', { name: 'Mit Mietfuchs im Heimnetz verbinden' })).toBeTruthy()
})
