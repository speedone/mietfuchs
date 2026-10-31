// @vitest-environment jsdom
// Die Wege zur Seite „Belege“ (#490, Regel 3: kein Klick mehr als vorher): Die Seitenleiste öffnet die zuletzt benutzte
// Ansicht (gemerkt je Sitzung), „Erfassen“ in der unteren Leiste am Handy immer den Eingang, ein Sprung mit Ansicht
// (Cockpit, Leerzustand, Anleitung) die genannte. Der Faden einer Anleitung steht auch auf der Seite Belege.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property } from './types'
import App from './App'
import { GUIDES } from '../../shared/guides.ts'
import { MOBILE_QUERY } from './components/MobileNav'
import { splitTarget, type NavTarget } from './nav'

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]

let mobile = false
let properties: Property[] = PROPERTIES
// Für den Sprung aus Kosten: Die KI scheitert, der Beleg ist gespeichert und gehört einem anderen Objekt
let uploads: unknown[] = []
beforeEach(() => {
  mobile = false
  properties = PROPERTIES
  uploads = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/intake') return json({ error: 'Ollama ist nicht erreichbar.', file: '9_fremd.jpg', reason: 'unreachable', kept: true }, 502)
    if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true })
    if (path === '/api/uploads') return json(uploads)
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/ai/status') return json({ ok: true })
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
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.replace(/\s.*$/, '')

test('Ziele: eine Ansicht der Seite Belege steht hinter dem Doppelpunkt', () => {
  expect(splitTarget('belege:eingang')).toEqual({ tab: 'belege', view: 'eingang' })
  expect(splitTarget('belege:ordner')).toEqual({ tab: 'belege', view: 'ordner' })
  expect(splitTarget('kosten')).toEqual({ tab: 'kosten', view: null })
  // Ungültiges (ein Tippfehler im Ziel) fällt auf, statt still die falsche Seite zu öffnen
  expect(() => splitTarget('kosten:eingang' as NavTarget)).toThrow()
  expect(() => splitTarget('belege:posteingang' as NavTarget)).toThrow()
  expect(() => splitTarget('schnellerfassung' as NavTarget)).toThrow()
})

test('Seitenleiste: „Belege“ öffnet zuerst den Eingang, danach die zuletzt benutzte Ansicht', async () => {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Belege$/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Eingang')
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Cockpit/ }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Ordner' })).toBeNull())
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Belege$/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Ordner')
  // Gemerkt je Sitzung: Ein neues Laden der Seite in derselben Sitzung beginnt dort
  expect(sessionStorage.getItem('mietfuchs.belege.view')).toBe('ordner')
})

test('Handy: „Erfassen“ in der unteren Leiste öffnet immer den Eingang, „Belege“ im Menüblatt die zuletzt benutzte Ansicht', async () => {
  mobile = true
  sessionStorage.setItem('mietfuchs.belege.view', 'ordner')
  render(<App />)
  const bar = await screen.findByRole('navigation', { name: 'Schnellzugriff' })
  fireEvent.click(within(bar).getByRole('button', { name: /Erfassen/ }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Eingang')
  // Der Ordner ist einen Tipp entfernt
  fireEvent.click(screen.getByRole('tab', { name: 'Ordner' }))
  expect(selected()).toBe('Ordner')
})

test('Anleitung: „Zu Belege →“ öffnet die Ansicht des Schritts, und der Faden steht auch auf der Seite Belege', async () => {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Hilfe & Begriffe/ }))
  fireEvent.click((await screen.findByText(GUIDES.granny.title)).closest('button') ?? expect.fail('Kachel fehlt'))
  const guide = await waitFor(() => document.getElementById('anleitung-granny') ?? expect.fail('Anleitung fehlt'))
  const step = GUIDES.granny.steps.findIndex((s) => s.page === 'belege')
  expect(GUIDES.granny.steps[step]?.view).toBe('ordner')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Belege →' })[0] ?? expect.fail('Sprung fehlt'))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  expect(selected()).toBe('Ordner')
  const bar = await waitFor(() => screen.queryByRole('region', { name: 'Laufende Anleitung' }) ?? expect.fail('Leiste fehlt'))
  expect(bar.textContent).toContain(`Schritt ${step + 1} von ${GUIDES.granny.steps.length}`)
  // Ein Wechsel der Ansicht beendet den Faden nicht
  fireEvent.click(screen.getByRole('tab', { name: /^Eingang/ }))
  expect(screen.queryByRole('region', { name: 'Laufende Anleitung' })).not.toBeNull()
})

// Durchsicht M1: „Von Hand erfassen“ an einem gespeicherten Beleg auf der Seite Kosten, der einem anderen Objekt gehört,
// wechselt auf der Seite Belege erst dorthin und zeigt ihn dann im Eingang.
test('Sprung aus Kosten zu einem gespeicherten Beleg eines anderen Objekts: Wechsel dorthin, Beleg im Eingang', async () => {
  properties = [...PROPERTIES, { id: 'objekt-2', name: 'Gartenstraße 3', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
  const year = new Date().getFullYear() - 1
  uploads = [{ file: '9_fremd.jpg', size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'fremd.jpg', mimeType: 'image/jpeg', uploadedAt: '2026-01-01T00:00:00.000Z', sha256: 'x', propertyId: 'objekt-2', year, invoiceDate: null, kind: 'receipt' }]
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /\sKosten$/ }))
  const input = await waitFor(() => document.querySelector('main input[type="file"][multiple]') as HTMLInputElement ?? expect.fail('kein Dateifeld'))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'fremd.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Von Hand erfassen' }))
  await screen.findByRole('heading', { level: 1, name: 'Belege' })
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  await waitFor(() => expect(document.activeElement?.closest('li.receipt-card')?.getAttribute('data-file')).toBe('9_fremd.jpg'))
  expect(selected()).toBe('Eingang')
})
