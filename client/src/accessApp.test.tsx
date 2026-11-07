// @vitest-environment jsdom
// Die Anmeldung in der App (#528): vor der Schale `GET /api/auth`; ohne Sitzung die Anmeldeseite ohne Seitenleiste,
// mitten in der Arbeit ein Dialog über der Seite, dessen Eingaben stehen bleiben; „Abmelden“ nur mit Sitzung, im
// Übergang „Ohne Passwort im Netz“ mit Sprung zur Karte „Anmeldung“.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { AccessInfo } from './access'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const info = (over: Partial<AccessInfo> = {}): AccessInfo => ({
  mode: 'password', required: true, signedIn: true, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', ...over,
})

let auth: AccessInfo
let settingsAnswer: () => Response
const calls: { path: string; method: string }[] = []

beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  calls.length = 0
  auth = info()
  settingsAnswer = () => json({ ok: true })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? ''
    const method = init?.method ?? 'GET'
    calls.push({ path, method })
    if (path === '/api/auth') return json(auth)
    if (path === '/api/auth/login') {
      auth = info()
      return json({ ok: true, failedAttempts: 2 })
    }
    if (path === '/api/auth/logout') {
      auth = info({ signedIn: false })
      return json({ ok: true })
    }
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/settings' && method === 'PUT') return settingsAnswer()
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('ohne Sitzung die Anmeldeseite ohne Seitenleiste; die Schale fragt vorher nichts', async () => {
  auth = info({ signedIn: false })
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: 'Hauptnavigation' })).toBeNull()
  expect(calls.map((c) => c.path)).toEqual(['/api/auth'])
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'tisch-garten-wolke-ofen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeTruthy()
  // Die Fehlversuche seit der letzten Anmeldung als Mitteilung
  expect(await screen.findByText('2 Fehlversuche seit Ihrer letzten Anmeldung.')).toBeTruthy()
})

test('noch ohne Passwort die Einrichtung', async () => {
  auth = info({ mode: 'setup', signedIn: false })
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Passwort festlegen' })).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: 'Hauptnavigation' })).toBeNull()
})

test('401 mitten im Formular: Dialog über der Seite, Eingaben bleiben, danach Fokus zurück auf den Auslöser', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Einstellungen/ }))
  const name = await screen.findByLabelText('Name des Vermieters')
  fireEvent.change(name, { target: { value: 'Martina Muster' } })
  settingsAnswer = () => json({ error: 'Bitte melden Sie sich an.', login: true }, 401)
  const save = screen.getAllByRole('button', { name: 'Speichern' })[0]
  if (!save) return expect.fail('kein Knopf „Speichern“')
  save.focus()
  fireEvent.click(save)
  const dialog = await screen.findByRole('dialog', { name: 'Bitte melden Sie sich wieder an' })
  const field = within(dialog).getByLabelText('Passwort')
  await waitFor(() => expect(document.activeElement).toBe(field))
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Martina Muster')
  fireEvent.change(field, { target: { value: 'tisch-garten-wolke-ofen' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Anmelden' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bitte melden Sie sich wieder an' })).toBeNull())
  expect(document.activeElement).toBe(save)
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Martina Muster')
})

test('„Abmelden“ mit Sitzung führt zur Anmeldeseite; im Fenster gibt es keinen Knopf', async () => {
  const { unmount } = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Abmelden/ }))
  expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeTruthy()
  expect(calls.some((c) => c.path === '/api/auth/logout' && c.method === 'POST')).toBe(true)
  unmount()
  auth = info({ window: true })
  render(<App />)
  await screen.findByRole('navigation', { name: 'Hauptnavigation' })
  expect(screen.queryByRole('button', { name: /Abmelden/ })).toBeNull()
})

test('im Übergang „Ohne Passwort im Netz“, führt zur Karte „Anmeldung“', async () => {
  auth = info({ mode: 'transition', required: false, signedIn: false })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Ohne Passwort im Netz/ }))
  expect(await screen.findByRole('heading', { name: 'Anmeldung' })).toBeTruthy()
  expect(document.body.textContent).toContain('Ab Version 1.0 verlangt Mietfuchs hier ein Passwort.')
  expect(screen.queryByRole('button', { name: /Abmelden/ })).toBeNull()
})
