// @vitest-environment jsdom
// Eine Warteschlange für die ganze App (#490, PR 1): Die KI-Auswertung läuft weiter, wenn man die Seite, das Objekt
// oder den Zeitraum wechselt, und ihr Ergebnis steht da, wenn man zurückkehrt. Eine laufende Auswertung ist deshalb
// kein Grund mehr für die Rückfrage beim Seitenwechsel; ein erkannter, nicht übernommener Zählerstand bleibt einer.
// Beim Schließen des Tabs fragt der Browser, solange etwas läuft oder wartet.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AssessmentView, Extraction, IntakeResult, Meter, Property, Unit, UploadInfo } from './types'
import App from './App'
import { fakeBooking } from './testing/fakeBooking'
import { PeriodProvider, useSwitchTo } from './period'
import { PropertyProvider, useProperty } from './property'
import { UIProvider } from './components/feedback'

const objekt = (id: string, name: string): Property => ({ id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null })
let properties: Property[]
const UNITS: Unit[] = [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }]
const METERS: Meter[] = [{ id: 'm-a', propertyId: 'objekt-1', name: 'Wasser DG', unitId: 'u-a', type: 'kaltwasser', unit: 'm³', meterNumber: '4711' }]

// Auswertungen, die der Test von Hand beantwortet
type Pending = { form: FormData; resolve: (r: IntakeResult) => void; fail: (body: unknown) => void }
let pending: Pending[]
let calls: string[]
// Die offenen Auswertungen, die der Server nennt (null: keine)
let openViews: AssessmentView[]
let metersFail: boolean
let uploads: UploadInfo[]
let posted: { url: string; body: unknown }[]
const YEAR = new Date().getFullYear() - 1
const EXTRACTION: Extraction = { vendor: 'Stadtwerke', invoiceDate: `${YEAR}-12-31`, positions: [{ description: 'Wasser', category: 'Wasser/Abwasser', amountEur: 98 }] } as Extraction
const invoice = (file: string, year = YEAR): IntakeResult => {
  const assessment = fakeBooking({ items: [], units: UNITS }).evaluate(file, EXTRACTION, { year })
  return { file, kind: 'rechnung', extraction: EXTRACTION, assessment }
}

beforeEach(() => {
  properties = [objekt('objekt-1', 'Lindenweg 12')]
  pending = []
  calls = []
  openViews = []
  metersFail = false
  uploads = []
  posted = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    if (url === '/api/intake' || url === '/api/extract') {
      return new Promise<Response>((resolve, reject) => {
        const form = init?.body instanceof FormData ? init.body : new FormData()
        pending.push({
          form,
          resolve: (r) => resolve(new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })),
          fail: (body) => resolve(new Response(JSON.stringify(body), { status: 502, headers: { 'content-type': 'application/json' } })),
        })
        init?.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError')))
      })
    }
    const [path = '', query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? ''
    if (url.startsWith('/uploads/')) return Promise.resolve(new Response(new Blob(['JPEG'], { type: 'image/jpeg' }), { status: 200 }))
    if (method !== 'GET') {
      posted.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
      return json({ ok: true })
    }
    if (path === '/api/assessments') return json(openViews)
    if (path === '/api/uploads') return json(uploads)
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(property === 'objekt-1' ? UNITS : [])
    if (path === '/api/meters') {
      if (metersFail) return Promise.resolve(new Response('{"error":"kaputt"}', { status: 500, headers: { 'content-type': 'application/json' } }))
      return json(property === 'objekt-1' ? METERS : [])
    }
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

const leave = () => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

// Durchsicht S3: Der Zählerstand steht in der Warteschlange der App und geht beim Seitenwechsel nicht verloren; die
// Rückfrage („wird geschlossen, ohne zu speichern“) stimmte nicht mehr. Beim Schließen des Tabs ginge er verloren.
test('ein erkannter, nicht übernommener Zählerstand: keine Rückfrage beim Seitenwechsel, aber beim Schließen des Tabs', async () => {
  await uploadOn(/Schnellerfassung/)
  pending[0]?.resolve(reading(1234))
  await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })
  go(/Cockpit/)
  await waitFor(() => expect(within(sidebar()).getByRole('button', { name: /Cockpit/ }).getAttribute('aria-current')).toBe('page'))
  expect(question()).toBeNull()
  expect(leave()).toBe(true)
  go(/Schnellerfassung/)
  expect((await screen.findByLabelText(/^Stand/, {}, { timeout: 5000 }) as HTMLInputElement).value).toBe('1234')
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
  expect(leave()).toBe(true)
  pending[0]?.resolve({ file: 'srv.pdf', kind: 'rechnung', extraction: { positions: [] }, assessment: null })
  await screen.findByText(/Auswertung ließ sich nicht speichern/, {}, { timeout: 5000 })
  expect(leave()).toBe(false)
})

const choosePeriod = (value: string) => fireEvent.change(screen.getByLabelText('Abrechnungsjahr'), { target: { value } })
const elsewhere = () => screen.queryByText('In Arbeit an anderer Stelle:')

// Durchsicht S1: Wird eine Auswertung anderswo gebucht (hier: Der Server führt sie nicht mehr als offen), gilt ihr
// Eintrag als übernommen; „In Arbeit an anderer Stelle“ bleibt nicht dauerhaft stehen.
test('eine anderswo gebuchte Auswertung steht nicht mehr als „in Arbeit“', async () => {
  await uploadOn(/Schnellerfassung/, 'rechnung.jpg')
  const answer = invoice('srv-rechnung.jpg')
  pending[0]?.resolve(answer)
  await screen.findByText('Stadtwerke', { exact: false }, { timeout: 5000 })
  // Gebucht, etwa im Belegordner: nicht mehr offen
  openViews = []
  choosePeriod(String(YEAR - 1))
  await waitFor(() => expect((screen.getByLabelText('Abrechnungsjahr') as HTMLSelectElement).value).toBe(String(YEAR - 1)))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(elsewhere()).toBeNull()
})

// Durchsicht K4: Eine offene Auswertung steht in der Schnellerfassung jedes Jahres als Karte; sie zählt dann nicht
// zusätzlich als „in Arbeit an anderer Stelle“.
test('eine offene Auswertung eines anderen Jahres steht als Karte, nicht zugleich in der Zeile', async () => {
  await uploadOn(/Schnellerfassung/, 'rechnung.jpg')
  const answer = invoice('srv-rechnung.jpg')
  pending[0]?.resolve(answer)
  await screen.findByText('Stadtwerke', { exact: false }, { timeout: 5000 })
  openViews = answer.kind === 'rechnung' && answer.assessment ? [answer.assessment] : []
  choosePeriod(String(YEAR - 1))
  await waitFor(() => expect((screen.getByLabelText('Abrechnungsjahr') as HTMLSelectElement).value).toBe(String(YEAR - 1)))
  expect(await screen.findByText(/offen — bitte prüfen/, {}, { timeout: 5000 })).toBeTruthy()
  expect(elsewhere()).toBeNull()
})

// Durchsicht S2: Einträge eines gelöschten Objekts nennt die Zeile nicht, und es gibt keinen Sprung dorthin.
test('Einträge eines Objekts, das es nicht mehr gibt, stehen nicht in der Zeile', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  await uploadOn(/Schnellerfassung/)
  pending[0]?.resolve(reading(5))
  await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })
  // Objekt 1 wird gelöscht; die Liste kommt beim Wechsel neu
  properties = [objekt('objekt-2', 'Gartenstraße 3')]
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  await waitFor(() => expect(screen.queryByLabelText('Objekt wählen')).toBeNull())
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(elsewhere()).toBeNull()
})

function SwitchProbe({ to }: { to: string }) {
  const switchTo = useSwitchTo()
  const { property } = useProperty()
  const [result, setResult] = useState('')
  return <><button onClick={() => void switchTo(to, String(YEAR)).then((ok) => setResult(String(ok)))}>wechseln</button><output>{`${result}|${property?.id ?? ''}`}</output></>
}
test('useSwitchTo: ein unbekanntes Objekt ist kein Ziel, es bleibt beim gewählten', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  render(<PeriodProvider><PropertyProvider><UIProvider><SwitchProbe to="geloescht" /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'wechseln' }))
  await waitFor(() => expect(document.querySelector('output')?.textContent).toBe('false|objekt-1'))
})

// Durchsicht K5: Die Zahl steht in einer Region, die Vorleser ansagen.
test('die Zeile „In Arbeit an anderer Stelle“ steht in einer aria-live-Region', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  await uploadOn(/Schnellerfassung/)
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  const jump = await screen.findByRole('button', { name: /1 Beleg.*Lindenweg 12/ })
  expect(jump.closest('[aria-live="polite"]')).not.toBeNull()
})

// Testlücke: Ein Zählerstand aus A, beantwortet während B offen ist, steht nicht in B; zurück in A wird er für A
// übernommen.
test('Objektwechsel: in B kein Vorschlag aus A; zurück in A geht die Ablesung an den Zähler von A', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  await uploadOn(/Schnellerfassung/)
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  const jump = await screen.findByRole('button', { name: /1 Beleg.*Lindenweg 12/ })
  pending[0]?.resolve(reading(42))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByText('Zählerstand erkannt')).toBeNull()
  expect(screen.queryByRole('button', { name: /Ablesung übernehmen/ })).toBeNull()
  fireEvent.click(jump)
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  const adopt = await screen.findByRole('button', { name: /Ablesung übernehmen/ }, { timeout: 5000 })
  await waitFor(() => expect(screen.getByDisplayValue(/Wasser DG/)).toBeTruthy())
  fireEvent.click(adopt)
  await waitFor(() => expect(posted.filter((p) => p.url === '/api/readings')).toHaveLength(1))
  expect(posted.find((p) => p.url === '/api/readings')?.body).toMatchObject({ meterId: 'm-a', value: 42 })
})

// Testlücke: „Gespeichert, nicht ausgewertet“ überlebt Seiten- und Objektwechsel; „Erneut versuchen“ schickt danach
// das ursprüngliche Objekt und nur den Namen im Belegordner.
test('„gespeichert“ überlebt den Wechsel; „Erneut versuchen“ nennt das Objekt des Hochladens', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  await uploadOn(/Schnellerfassung/)
  pending[0]?.fail({ error: 'Ollama ist nicht erreichbar.', reason: 'unreachable', kept: true, file: 'srv-foto.jpg' })
  await screen.findByText('im Belegordner', {}, { timeout: 5000 })
  go(/Cockpit/)
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: 'objekt-1' } })
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  go(/Schnellerfassung/)
  fireEvent.click(await screen.findByRole('button', { name: /Erneut versuchen/ }, { timeout: 5000 }))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect([pending[1]?.form.get('propertyId'), pending[1]?.form.get('existingFile'), pending[1]?.form.get('file')]).toEqual(['objekt-1', 'srv-foto.jpg', null])
})

// Durchsicht K1: Erledigtes (hier: abgebrochen) steht nach dem Verlassen der Seite nicht mehr da.
test('Erledigtes verschwindet, wenn man die Seite verlässt', async () => {
  await uploadOn(/\sKosten$/)
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByText('abgebrochen')).toBeTruthy()
  go(/Cockpit/)
  await waitFor(() => expect(question()).toBeNull())
  go(/\sKosten$/)
  await screen.findByText(/Beleg per KI auswerten/, {}, { timeout: 5000 })
  expect(document.querySelectorAll('[data-queue-entry]')).toHaveLength(0)
  expect(screen.queryByText('abgebrochen')).toBeNull()
})

// Durchsicht K3: Antworten die Zähler mit einem Fehler, bleibt der Vorschlag offen und bekommt seine Zuordnung,
// sobald sie da sind.
test('ohne Zähler wird der Vorschlag nicht festgehalten; mit ihnen bekommt er die Zuordnung', async () => {
  metersFail = true
  await uploadOn(/Schnellerfassung/)
  pending[0]?.resolve(reading(7))
  await screen.findByText('Zählerstand erkannt', {}, { timeout: 5000 })
  metersFail = false
  go(/Cockpit/)
  await waitFor(() => expect(question()).toBeNull())
  go(/Schnellerfassung/)
  await waitFor(() => expect(screen.getByDisplayValue(/Wasser DG/)).toBeTruthy(), { timeout: 5000 })
})

// Durchsicht S4: Hat das Modell eine Rechnung für ein Zählerfoto gehalten, wertet „Als Rechnung auswerten“ den Beleg
// ohne Frage nach der Belegart neu aus, mit seinem Namen im Belegordner.
test('„Als Rechnung auswerten“ an einem erkannten Zählerfoto', async () => {
  await uploadOn(/Schnellerfassung/)
  pending[0]?.resolve(reading(7))
  fireEvent.click(await screen.findByRole('button', { name: 'Als Rechnung auswerten' }, { timeout: 5000 }))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect([pending[1]?.form.get('docType'), pending[1]?.form.get('existingFile'), pending[1]?.form.get('file'), pending[1]?.form.get('propertyId')])
    .toEqual(['rechnung', 'srv-foto.jpg', null, 'objekt-1'])
  pending[1]?.resolve(invoice('srv-foto.jpg'))
  expect(await screen.findByText(/offen — bitte prüfen/, {}, { timeout: 5000 })).toBeTruthy()
  expect(screen.queryByText('Zählerstand erkannt')).toBeNull()
})

// Testlücke: „Per KI auswerten“ im Belegordner für einen Beleg eines anderen Objekts wechselt dorthin und legt genau
// einen Eintrag an, mit dem Objekt des Belegs.
test('Übergabe aus dem Belegordner mit Objektwechsel: ein Eintrag mit dem richtigen Ziel', async () => {
  properties = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Gartenstraße 3')]
  uploads = [{
    file: '1767225600000_foto.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'foto.jpg', mimeType: 'image/jpeg',
    uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: 'objekt-2', year: YEAR, invoiceDate: null, kind: 'receipt',
  }]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belegordner/ }))
  const all = await screen.findByLabelText(/Belege aller Objekte zeigen/, {}, { timeout: 5000 })
  fireEvent.click(all)
  fireEvent.click(await screen.findByRole('button', { name: /per KI auswerten/ }, { timeout: 5000 }))
  await waitFor(() => expect(pending).toHaveLength(1), { timeout: 5000 })
  expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2')
  expect([pending[0]?.form.get('propertyId'), pending[0]?.form.get('existingFile')]).toEqual(['objekt-2', '1767225600000_foto.jpg'])
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(pending).toHaveLength(1)
  expect(document.querySelectorAll('[data-queue-entry]')).toHaveLength(1)
})
