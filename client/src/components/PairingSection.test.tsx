// @vitest-environment jsdom
// Abschnitt „Programmfenster koppeln“ in der Karte „Anmeldung“ (#528, Schritt 2)
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AccessInfo } from '../access'
import { UIProvider } from './feedback'
import PairingSection from './PairingSection'

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, device: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', pairing: { available: true, devices: 1 } }
const devices = [
  { id: 'a1', name: 'Büro-PC', pairedAt: '2026-11-09T09:00:00.000Z', lastSeen: '2026-11-09T09:30:00.000Z', current: false },
  { id: 'b2', name: 'Laptop', pairedAt: '2026-11-08T09:00:00.000Z', lastSeen: null, current: true },
]

type Fail = { status: number; error: string }
function setup(info: AccessInfo = base, list = devices, fail: Partial<Record<string, Fail>> = {}) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    const f = fail[`${method} ${url}`]
    if (f) return new Response(JSON.stringify({ error: f.error }), { status: f.status, headers: { 'content-type': 'application/json' } })
    const body = url === '/api/auth/pairing' && method === 'POST' ? { code: 'K7QM-4XPA', expiresAt: new Date(Date.now() + 600000).toISOString() }
      : url === '/api/auth/devices' ? { devices: list } : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(<UIProvider><PairingSection info={info} /></UIProvider>)
  return { calls }
}

test('ohne Passwort ein Satz und kein Knopf', () => {
  setup({ ...base, mode: 'off' })
  expect(document.body.textContent).toContain('Legen Sie zuerst ein Passwort fest')
  expect(screen.queryByRole('button')).toBeNull()
})

test('nur lokal erreichbar: nichts', () => {
  setup({ ...base, reachable: 'local' })
  expect(document.body.textContent).toBe('')
})

test('ohne HTTPS ein Satz, kein Knopf', () => {
  setup({ ...base, pairing: { available: false, devices: 0 } })
  expect(document.body.textContent).toContain('HTTPS')
  expect(screen.queryByRole('button', { name: 'Code anzeigen' })).toBeNull()
})

test('„Code anzeigen“ zeigt Code und Ablauf', async () => {
  const { calls } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Code anzeigen' }))
  expect(await screen.findByText('K7QM-4XPA')).toBeTruthy()
  expect(document.body.textContent).toMatch(/gültig bis \d\d:\d\d Uhr/)
  expect(document.body.textContent).toContain('Mietfuchs im Heimnetz')
  expect(calls).toContainEqual({ url: '/api/auth/pairing', method: 'POST' })
})

test('Liste markiert das eigene Gerät; „Entfernen“ fragt nach und ruft DELETE', async () => {
  const { calls } = setup()
  const row = await screen.findByText('Büro-PC')
  expect(document.body.textContent).toContain('dieses Gerät')
  fireEvent.click(within(row.closest('li') as HTMLElement).getByRole('button', { name: 'Entfernen …' }))
  const question = await screen.findByRole('alertdialog')
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  fireEvent.click(within(question).getByRole('button', { name: 'Entfernen' }))
  await waitFor(() => expect(calls).toContainEqual({ url: '/api/auth/devices/a1', method: 'DELETE' }))
})

test('Code läuft ab: verschwindet, Satz, „Neuen Code anzeigen“, Liste wird neu geladen', async () => {
  const { calls } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Code anzeigen' }))
  await screen.findByText('K7QM-4XPA')
  expect(screen.getByRole('button', { name: 'Neuen Code anzeigen' })).toBeTruthy()
  const loads = calls.filter((c) => c.url === '/api/auth/devices').length
  await vi.advanceTimersByTimeAsync(601000)
  await waitFor(() => expect(screen.queryByText('K7QM-4XPA')).toBeNull())
  expect(document.body.textContent).toContain('Der Code ist abgelaufen.')
  expect(screen.getByRole('button', { name: 'Neuen Code anzeigen' })).toBeTruthy()
  await waitFor(() => expect(calls.filter((c) => c.url === '/api/auth/devices').length).toBeGreaterThan(loads))
})

test('das eigene Gerät entfernen: eigener Rückfragetext', async () => {
  setup()
  const row = await screen.findByText('Laptop')
  fireEvent.click(within(row.closest('li') as HTMLElement).getByRole('button', { name: 'Entfernen …' }))
  expect((await screen.findByRole('alertdialog')).textContent).toContain('Sie arbeiten gerade in diesem Programmfenster.')
})

test('Liste lädt nicht: ein Satz', async () => {
  setup(base, devices, { 'GET /api/auth/devices': { status: 500, error: 'kaputt' } })
  expect(await screen.findByText('Die Liste der gekoppelten Fenster ließ sich nicht laden.')).toBeTruthy()
})

test('409 beim Code: der Satz des Servers steht da', async () => {
  setup(base, devices, { 'POST /api/auth/pairing': { status: 409, error: 'Legen Sie zuerst ein Passwort fest.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Code anzeigen' }))
  expect(await screen.findByText('Legen Sie zuerst ein Passwort fest.')).toBeTruthy()
  expect(screen.queryByText('K7QM-4XPA')).toBeNull()
})

test('Entfernen scheitert: Meldung des Servers', async () => {
  setup(base, devices, { 'DELETE /api/auth/devices/a1': { status: 404, error: 'Dieses Programmfenster ist nicht (mehr) gekoppelt.' } })
  const row = await screen.findByText('Büro-PC')
  fireEvent.click(within(row.closest('li') as HTMLElement).getByRole('button', { name: 'Entfernen …' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }))
  expect(await screen.findByText('Dieses Programmfenster ist nicht (mehr) gekoppelt.')).toBeTruthy()
})

test('der Bereich für Code und Ablauf steht von Anfang an leer da und wird danach gefüllt', async () => {
  setup()
  // Manche Bildschirmleser sagen nichts an, wenn ein Live-Bereich mit seinem Inhalt erscheint
  const region = screen.getByRole('status', { name: 'Kopplungscode' })
  expect(region.textContent).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Code anzeigen' }))
  await screen.findByText('K7QM-4XPA')
  expect(screen.getByRole('status', { name: 'Kopplungscode' })).toBe(region)
  expect(region.textContent).toContain('K7QM-4XPA')
  await vi.advanceTimersByTimeAsync(601000)
  await waitFor(() => expect(region.textContent).toContain('Der Code ist abgelaufen.'))
  expect(screen.getByRole('status', { name: 'Kopplungscode' })).toBe(region)
})
