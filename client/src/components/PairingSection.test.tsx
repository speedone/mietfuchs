// @vitest-environment jsdom
// Abschnitt „Programmfenster koppeln“ in der Karte „Anmeldung“ (#528, Schritt 2)
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AccessInfo } from '../access'
import { UIProvider } from './feedback'
import PairingSection from './PairingSection'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', pairing: { available: true, devices: 1 } }
const devices = [
  { id: 'a1', name: 'Büro-PC', pairedAt: '2026-11-09T09:00:00.000Z', lastSeen: '2026-11-09T09:30:00.000Z', current: false },
  { id: 'b2', name: 'Laptop', pairedAt: '2026-11-08T09:00:00.000Z', lastSeen: null, current: true },
]

function setup(info: AccessInfo = base, list = devices) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
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
