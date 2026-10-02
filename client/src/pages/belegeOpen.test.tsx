// @vitest-environment jsdom
// „Position öffnen“ aus dem Belegordner (#170) bei einer Position eines anderen Objekts: Der
// Belegordner zeigt alle Objekte, die Seite Kosten nur das gewählte. Ohne Umschalten öffnete sich
// dort nichts. Jetzt schaltet die App erst auf das Objekt der Position um, wie beim Auswerten aus
// dem Posteingang, und öffnet dann die Position im Formular.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Property, UploadInfo } from '../types'
import App from '../App'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1

const objekt = (id: string, name: string): Property => ({ id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null })
const PROPERTIES = [objekt('objekt-1', 'Haus A'), objekt('objekt-2', 'Haus B')]
const HG: CostItem = { id: 'hg', propertyId: 'objekt-2', year: YEAR, category: 'Hauswart', description: 'Hauswart laut Hausgeld', amountCents: 48000, key: 'external', externalBasis: { measure: 'mea', total: 1000, totalCents: 4800000 } }
const INBOX: UploadInfo = {
  file: '5_hausgeld.pdf', size: 2048, mtime: '2026-01-02T10:00:00.000Z', originalName: 'hausgeld.pdf', mimeType: 'application/pdf',
  uploadedAt: '2026-01-02T10:00:00.000Z', sha256: 'x', propertyId: 'objekt-2', year: YEAR, invoiceDate: null, kind: 'receipt',
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true })
    const [path, query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? ''
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/uploads') return json([INBOX])
    if (path === '/api/costItems') return json(property === 'objekt-2' ? [HG] : [])
    // Cockpit und Abrechnung bekommen keine Antwort, sie zählen hier nicht.
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0' })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('„Position öffnen“ bei einer Position eines anderen Objekts schaltet erst auf dieses Objekt um', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Belegordner/ }, SLOW))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'), SLOW)
  // Im Belegordner „alle Objekte“, gewählt bleibt Haus A
  const filter = (await screen.findAllByRole('combobox')).find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'all' && o.text === 'alle Objekte'))
  if (!filter) throw new Error('kein Objektfilter im Belegordner')
  fireEvent.change(filter, { target: { value: 'all' } })
  fireEvent.change(await screen.findByLabelText('hausgeld.pdf einer Position zuordnen', {}, SLOW), { target: { value: 'hg' } })
  const check = await screen.findByRole('status', { name: 'Betrag prüfen' }, SLOW)
  fireEvent.click(within(check).getByRole('button', { name: 'Position öffnen' }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'), SLOW)
  await waitFor(() => expect((screen.getByLabelText(/Beschreibung/) as HTMLInputElement).value).toBe('Hauswart laut Hausgeld'), SLOW)
})
