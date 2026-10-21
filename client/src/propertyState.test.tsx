// @vitest-environment jsdom
// Das Bundesland in der Karte „Objekt“ der Stammdaten: Die Auswahl zeigt, was gespeichert ist, und
// Speichern schickt genau das Gewählte. Über die ganze App wie propertyCreate.test.tsx, damit die Karte
// mit dem echten Objekt aus /api/properties gefüllt wird.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property } from './types'
import App from './App'

vi.setConfig({ testTimeout: 20000 })

let properties: Property[]
let sent: { method: string; url: string; body: Record<string, unknown> }[]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sent = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const [path] = url.split('?')
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ method, url, body })
      if (method === 'PUT' && path === '/api/properties/objekt-1') {
        properties = properties.map((p) => (p.id === 'objekt-1' ? { ...p, ...body } as Property : p))
        return json(properties[0])
      }
      return json({ ok: true })
    }
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path?.startsWith('/api/rentledger/')) return json({ year: 2025, rows: [], totals: { sollCents: 0, paidCents: 0, openCents: 0 } })
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.9.0' })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const objekt = (extra: Partial<Property> = {}): Property => ({
  id: 'objekt-1', name: 'Haus A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...extra,
})

async function stateSelect(): Promise<HTMLSelectElement> {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }))
  const el = await within(screen.getByRole('dialog', { name: 'Objekt bearbeiten' })).findByLabelText(/Bundesland \(für Fristen und Feiertage\)/)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('ein gespeichertes Bundesland steht in der Auswahl, und Speichern schickt das neu gewählte', async () => {
  properties = [objekt({ state: 'SN' })]
  const el = await stateSelect()
  expect(el.value).toBe('SN')
  expect(el.selectedOptions[0]?.textContent).toBe('Sachsen')
  fireEvent.change(el, { target: { value: 'BY' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent.some((r) => r.method === 'PUT')).toBe(true))
  expect(sent.find((r) => r.method === 'PUT')?.body.state).toBe('BY')
  // Gespeichert schließt das Fenster, die Karte zeigt das neue Land.
  expect(await screen.findByText('Bayern')).toBeTruthy()
})

test('ohne Bundesland zeigt die Auswahl „unbekannt“, und Speichern schickt null', async () => {
  properties = [objekt()]
  const el = await stateSelect()
  expect(el.value).toBe('')
  expect(el.selectedOptions[0]?.textContent).toBe('unbekannt')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent.some((r) => r.method === 'PUT')).toBe(true))
  expect(sent.find((r) => r.method === 'PUT')?.body.state).toBeNull()
})
