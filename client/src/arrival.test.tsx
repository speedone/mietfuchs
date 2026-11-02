// @vitest-environment jsdom
// Praxistest vor 0.15.0 (Umzug ins Programmfenster), was die ganze Oberfläche betrifft:
// - Nach Umzug, Backup oder neuerem Stand stand das Cockpit im aktuellen Jahr bei „0,00 €“ (B-04, E-04, P-05). Jetzt
//   einmal oben „Ihre Daten sind da“ und der Zeitraum mit den jüngsten Kosten; die Frage zu Updates erst danach.
// - Während der Willkommensfrage waren Seitenleiste bzw. Kopf und untere Leiste bedienbar, ohne etwas zu bewirken (A).
// - Ohne Datenbank stand der Grund doppelt, oben und als roter Kasten der Seite (O).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CostItem, Property, Tenancy } from './types'
import App from './App'
import { MOBILE_QUERY } from './components/MobileNav'

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Haus am Weg', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
const tenancy = (id: string): Tenancy => ({ id, unitId: 'u-a', tenantName: id, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] })
const COSTS = [{ id: 'c1', propertyId: 'objekt-1', period: '2024-01', category: 'Müllabfuhr', amountCents: 100 }] as unknown as CostItem[]

let mobile = false
let answers: Record<string, () => Response | Promise<Response>> = {}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  mobile = false
  answers = {}
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? ''
    const own = answers[path]
    if (own) return own()
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/tenancies') return json([tenancy('t1'), tenancy('t2')])
    if (path === '/api/costItems') return json(COSTS)
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.15.0', mode: 'desktop' })
    if (path.startsWith('/api/settlement')) return new Promise<Response>(() => {})
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
  window.history.replaceState(null, '', '/')
})

test('Nach dem Umzug: „Ihre Daten sind da“ im Jahr der jüngsten Kosten, die Frage zu Updates erst danach', async () => {
  window.history.replaceState(null, '', '/?arrived=moved')
  render(<App />)
  const box = (await screen.findByRole('heading', { name: 'Ihre Daten sind da' })).closest('section') as HTMLElement
  expect(box.textContent).toContain('2 Mietverhältnisse in „Haus am Weg“. Mietfuchs zeigt das Abrechnungsjahr 2024, in dem zuletzt Kosten erfasst sind.')
  // Der Anlass ist aus der Adresse verschwunden, ein Neuladen zeigt ihn nicht noch einmal
  expect(window.location.search).toBe('')
  // Das Cockpit steht im Jahr 2024
  expect(await screen.findByText(/Cockpit · Abrechnung 2024/)).toBeTruthy()
  // Erst nach dem Schließen die Frage zu Updates (Punkt 13)
  expect(screen.queryByText('Bei neuen Versionen Bescheid geben?')).toBeNull()
  fireEvent.click(within(box).getByRole('button', { name: 'Verstanden' }))
  expect(await screen.findByText('Bei neuen Versionen Bescheid geben?')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Ihre Daten sind da' })).toBeNull()
})

test('Ohne Anlass keine Bestätigung, die Frage zu Updates wie bisher', async () => {
  render(<App />)
  expect(await screen.findByText('Bei neuen Versionen Bescheid geben?')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Ihre Daten sind da' })).toBeNull()
})

test('Erster Start im Fenster: Seitenleiste ohne Navigation, Kopf „Mietfuchs einrichten“', async () => {
  window.mietfuchsDesktop = { print: async () => {} }
  answers['/api/relocation'] = () => json({ offered: true })
  answers['/api/relocation/candidates'] = () => json({ offered: true, candidates: [], searched: true, complete: true })
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Mietfuchs' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: 'Hauptnavigation' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Cockpit/ })).toBeNull()
  expect(screen.getByText('Mietfuchs einrichten')).toBeTruthy()
})

test('Erster Start im Fenster am Handy: kein Menü, keine untere Leiste, Kopf „Mietfuchs einrichten“', async () => {
  mobile = true
  window.mietfuchsDesktop = { print: async () => {} }
  answers['/api/relocation'] = () => json({ offered: true })
  answers['/api/relocation/candidates'] = () => json({ offered: true, candidates: [], searched: true, complete: true })
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Mietfuchs' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: 'Schnellzugriff' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Menü' })).toBeNull()
  expect(screen.getByText('Mietfuchs einrichten')).toBeTruthy()
  expect(screen.queryByText(/Ohne Namen|Haus am Weg · /)).toBeNull()
})

test('Datenbank nicht geöffnet: der Grund einmal, ohne Fehlerkasten der Seite, mit „Mietfuchs beenden“', async () => {
  const detail = 'Die Datenbank stammt aus einer neueren Mietfuchs-Version. Aktualisieren Sie Mietfuchs im Microsoft Store.'
  answers['/healthz'] = () => json({ status: 'error', database: { open: false, file: 'x', migrations: 0, detail, changeover: { state: 'none', message: '', notes: [] }, migrated: null } }, 503)
  answers['/api/settings'] = () => json({ error: 'Die Anfrage ist fehlgeschlagen: keine Verbindung zur Datenbank' }, 503)
  render(<App />)
  const box = (await screen.findByRole('heading', { name: 'Mietfuchs kann Ihre Daten gerade nicht öffnen' })).closest('section') as HTMLElement
  expect(screen.getAllByText(detail)).toHaveLength(1)
  await waitFor(() => expect(within(box).getByRole('button', { name: /Mietfuchs beenden/ })).toBeTruthy())
  expect(screen.queryByText(/Lade Abrechnungsstand/)).toBeNull()
  expect(screen.queryByText(/Die Anfrage ist fehlgeschlagen/)).toBeNull()
})
