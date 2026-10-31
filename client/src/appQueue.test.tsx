// @vitest-environment jsdom
// Eine Warteschlange für die ganze App (#490, PR 1): Die KI-Auswertung läuft weiter, wenn man die Seite, das Objekt
// oder den Zeitraum wechselt, und ihr Ergebnis steht da, wenn man zurückkehrt. Eine laufende Auswertung ist deshalb
// kein Grund mehr für die Rückfrage beim Seitenwechsel; ein erkannter, nicht übernommener Zählerstand bleibt einer.
// Beim Schließen des Tabs fragt der Browser, solange etwas läuft oder wartet.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { IntakeResult, Meter, Property, Unit } from './types'
import App from './App'

const objekt = (id: string, name: string): Property => ({ id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null })
let properties: Property[]
const UNITS: Unit[] = [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }]
const METERS: Meter[] = [{ id: 'm-a', propertyId: 'objekt-1', name: 'Wasser DG', unitId: 'u-a', type: 'kaltwasser', unit: 'm³', meterNumber: '4711' }]

// Auswertungen, die der Test von Hand beantwortet
type Pending = { form: FormData; resolve: (r: IntakeResult) => void }
let pending: Pending[]
let calls: string[]

beforeEach(() => {
  properties = [objekt('objekt-1', 'Lindenweg 12')]
  pending = []
  calls = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    if (url === '/api/intake' || url === '/api/extract') {
      return new Promise<Response>((resolve, reject) => {
        const form = init?.body instanceof FormData ? init.body : new FormData()
        pending.push({ form, resolve: (r) => resolve(new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })) })
        init?.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError')))
      })
    }
    const [path = '', query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? ''
    if (method !== 'GET') return json({ ok: true })
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(property === 'objekt-1' ? UNITS : [])
    if (path === '/api/meters') return json(property === 'objekt-1' ? METERS : [])
    // Das Cockpit bekommt keine Antwort; hier zählt nur die Warteschlange.
    if (path.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode: 'npm' })
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const go = (name: RegExp) => fireEvent.click(within(sidebar()).getByRole('button', { name }))
const question = () => screen.queryByText('Ungespeicherte Änderungen verwerfen?')
const reading = (value: number): IntakeResult => ({ file: 'srv-foto.jpg', kind: 'zaehler', reading: { meterNumber: '4711', value, dateOnImage: '2025-12-31' } })
const cancelled = () => calls.some((c) => c.startsWith('POST /api/ai/cancel/'))

async function uploadOn(page: RegExp, name = 'foto.jpg') {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: page }))
  const input = await waitFor(() => {
    const found = document.querySelector('main input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], name, { type: 'image/jpeg' })] } })
  await waitFor(() => expect(pending).toHaveLength(1))
}

test('Seitenwechsel: die Auswertung läuft weiter, ohne Rückfrage, und ihr Ergebnis steht bei der Rückkehr da', async () => {
  await uploadOn(/Schnellerfassung/)
  go(/Cockpit/)
  // Keine Rückfrage, denn nichts geht verloren
  await waitFor(() => expect(within(sidebar()).getByRole('button', { name: /Cockpit/ }).getAttribute('aria-current')).toBe('page'))
  expect(question()).toBeNull()
  expect(cancelled()).toBe(false)
  pending[0]?.resolve(reading(1234))
  await new Promise((resolve) => setTimeout(resolve, 20))
  go(/Schnellerfassung/)
  expect(await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })).toBeTruthy()
  expect((screen.getByLabelText(/^Stand/) as HTMLInputElement).value).toBe('1234')
})

test('wer zurückkehrt, während sie noch läuft, sieht sie laufen und kann abbrechen', async () => {
  await uploadOn(/Schnellerfassung/)
  go(/Cockpit/)
  await waitFor(() => expect(question()).toBeNull())
  go(/Schnellerfassung/)
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByText('abgebrochen')).toBeTruthy()
  await waitFor(() => expect(cancelled()).toBe(true))
})

test('ein erkannter, nicht übernommener Zählerstand fragt beim Seitenwechsel weiter nach', async () => {
  await uploadOn(/Schnellerfassung/)
  pending[0]?.resolve(reading(1234))
  await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })
  go(/Cockpit/)
  expect(await screen.findByText('Ungespeicherte Änderungen verwerfen?')).toBeTruthy()
})

test('Objektwechsel: die Auswertung läuft im Objekt weiter, in dem sie begann; die Seite nennt sie mit Sprung dorthin', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  await uploadOn(/Schnellerfassung/)
  expect(pending[0]?.form.get('propertyId')).toBe('objekt-1')
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  // Keine Rückfrage, denn die Auswertung geht nicht verloren
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull()
  expect(cancelled()).toBe(false)
  // Im anderen Objekt steht der Eintrag nicht, aber eine Zeile nennt ihn
  expect(screen.queryByText('foto.jpg')).toBeNull()
  const jump = await screen.findByRole('button', { name: /1 Beleg.*Lindenweg 12/ })
  pending[0]?.resolve(reading(77))
  await new Promise((resolve) => setTimeout(resolve, 20))
  fireEvent.click(jump)
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  expect(await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })).toBeTruthy()
  expect((screen.getByLabelText(/^Stand/) as HTMLInputElement).value).toBe('77')
})

test('eine Auswertung aus der Schnellerfassung erscheint auch auf der Seite Kosten', async () => {
  await uploadOn(/Schnellerfassung/)
  go(/\sKosten$/)
  await waitFor(() => expect(question()).toBeNull())
  expect(await screen.findByText('foto.jpg')).toBeTruthy()
  pending[0]?.resolve(reading(1234))
  expect(await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })).toBeTruthy()
})

test('Schließen des Tabs: solange etwas läuft, fragt der Browser; danach nicht mehr', async () => {
  await uploadOn(/\sKosten$/)
  const leave = () => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }
  expect(leave()).toBe(true)
  pending[0]?.resolve({ file: 'srv.pdf', kind: 'rechnung', extraction: { positions: [] }, assessment: null })
  await screen.findByText(/Auswertung ließ sich nicht speichern/, {}, { timeout: 5000 })
  expect(leave()).toBe(false)
})
