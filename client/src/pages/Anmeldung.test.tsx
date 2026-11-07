// @vitest-environment jsdom
// Die Anmeldeseite (#528): Ein Fehlversuch zeigt den Satz des Servers als Meldung, der Fokus bleibt im Feld; nach zu
// vielen Versuchen nennt die Seite die Wartezeit.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccessInfo } from '../access'
import Anmeldung from './Anmeldung'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const info: AccessInfo = { mode: 'password', required: true, signedIn: false, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker' }
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function setup(answer: () => Response) {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return answer()
  })
  const onSignedIn = vi.fn()
  const onStale = vi.fn()
  render(<Anmeldung info={info} onSignedIn={onSignedIn} onStale={onStale} />)
  return { calls, onSignedIn, onStale }
}

test('ohne Seitenmenü: Fuchs, „Mietfuchs“, Feld „Passwort“, „Anmelden“ und die Hilfe zum Vergessen', () => {
  setup(() => json(200, {}))
  expect(screen.getByRole('heading', { name: 'Mietfuchs' })).toBeTruthy()
  expect(screen.getByLabelText('Passwort')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Anmelden' })).toBeTruthy()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(document.body.textContent).toContain('Passwort vergessen? Am Rechner, auf dem Mietfuchs läuft, lässt es sich zurücksetzen.')
  // Im Container der Befehl dafür
  expect(document.body.textContent).toContain('docker compose exec mietfuchs touch /app/server/data/passwort-zuruecksetzen')
})

test('ein Fehlversuch zeigt den Satz des Servers in role="alert", der Fokus bleibt im Feld', async () => {
  const { calls, onSignedIn } = setup(() => json(401, { error: 'Das Passwort stimmt nicht.' }))
  const field = screen.getByLabelText('Passwort')
  field.focus()
  fireEvent.change(field, { target: { value: 'falsch-falsch-falsch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Das Passwort stimmt nicht.')
  expect(document.activeElement).toBe(screen.getByLabelText('Passwort'))
  expect(calls).toEqual([{ url: '/api/auth/login', body: { password: 'falsch-falsch-falsch' } }])
  expect(onSignedIn).not.toHaveBeenCalled()
})

test('ohne Eingabe kein Abruf, die Meldung steht am Feld', async () => {
  const { calls } = setup(() => json(200, { ok: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Bitte geben Sie Ihr Passwort ein.')
  expect(calls).toEqual([])
  expect(document.activeElement).toBe(screen.getByLabelText('Passwort'))
})

test('429 zeigt die Wartezeit', async () => {
  setup(() => json(429, { error: 'Zu viele Fehlversuche. Bitte versuchen Sie es in 2 Minuten erneut.', retryAfter: 90 }, { 'Retry-After': '90' }))
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'irgendein-langes-wort' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  expect((await screen.findByRole('alert')).textContent).toContain('in 2 Minuten erneut')
})

test('nach Erfolg mit der Zahl der Fehlversuche seit der letzten Anmeldung', async () => {
  const { onSignedIn } = setup(() => json(200, { ok: true, failedAttempts: 3 }))
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'tisch-garten-wolke-ofen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ failedAttempts: 3 }))
})

test('409 (kein Passwort mehr festgelegt): der Satz geht an die App, die den Zustand neu liest', async () => {
  const { onStale, onSignedIn } = setup(() => json(409, { error: 'Für Mietfuchs ist kein Passwort festgelegt.' }))
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'tisch-garten-wolke-ofen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  await waitFor(() => expect(onStale).toHaveBeenCalledWith('Für Mietfuchs ist kein Passwort festgelegt.'))
  expect(onSignedIn).not.toHaveBeenCalled()
})
