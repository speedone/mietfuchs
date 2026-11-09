// @vitest-environment jsdom
// Karte „Mietfuchs im Heimnetz“ (#528): Formular im lokalen Stand, Stand und Trennen im verbundenen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RemoteCard from './RemoteCard'
import NetworkCard from './NetworkCard'
import { UIProvider } from './feedback'
import { problemField, remoteBridge, type RemoteBridge } from '../desktopRemote'

afterEach(cleanup)

const bridge = (over: Partial<RemoteBridge> = {}): RemoteBridge => ({
  get: vi.fn(async () => ({ connected: false })),
  connect: vi.fn(async () => ({ ok: true as const })),
  disconnect: vi.fn(async () => ({})),
  ...over,
})
const show = (b: RemoteBridge) => render(<UIProvider><RemoteCard bridge={b} /></UIProvider>)

test('lokal: Adresse und Code gehen an die Brücke', async () => {
  const b = bridge()
  show(b)
  fireEvent.change(await screen.findByLabelText(/Adresse/), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'K7QM-4XPA' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
  await waitFor(() => expect(b.connect).toHaveBeenCalledWith({ address: 'nas:3001', code: 'K7QM-4XPA' }))
  expect(screen.getByRole('button', { name: /Verbinde/ })).toHaveProperty('disabled', true)
})

test('ein Satz zur Adresse steht am Feld Adresse', async () => {
  const problem = 'Unter nas:3001 ist Mietfuchs nicht erreichbar. Prüfen Sie die Adresse und ob Mietfuchs dort läuft.'
  show(bridge({ connect: vi.fn(async () => ({ problem })) }))
  fireEvent.change(await screen.findByLabelText(/Adresse/), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'X' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
  await waitFor(() => expect(screen.getAllByText(problem).length).toBeGreaterThan(0))
  expect(screen.getByLabelText(/Adresse/).getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByRole('button', { name: 'Verbinden' })).toHaveProperty('disabled', false)
})

test('ein Satz ohne Feld erscheint als Meldung', async () => {
  const problem = 'Der Server hat während des Koppelns ein anderes Zertifikat gezeigt.'
  show(bridge({ connect: vi.fn(async () => ({ problem })) }))
  fireEvent.change(await screen.findByLabelText(/Adresse/), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'X' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
  await waitFor(() => expect(screen.getAllByText(problem).length).toBeGreaterThan(0))
  expect(screen.getByLabelText(/Adresse/).getAttribute('aria-invalid')).not.toBe('true')
})

test('verbunden: Stand und Trennen mit Rückfrage', async () => {
  const b = bridge({ get: vi.fn(async () => ({ connected: true, origin: 'https://nas:3001', version: '0.17.0' })) })
  show(b)
  expect(await screen.findByText('Verbunden mit nas:3001 (Mietfuchs 0.17.0)')).toBeTruthy()
  expect(screen.queryByLabelText(/Adresse/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Verbindung trennen …' }))
  expect(b.disconnect).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Trennen' }))
  await waitFor(() => expect(b.disconnect).toHaveBeenCalled())
})

test('Zuordnung der Sätze und fehlende Brücke', () => {
  expect(problemField('Geben Sie den Code ein, den Mietfuchs auf dem Server zeigt.')).toBe('code')
  expect(problemField('Diese Adresse lässt sich nicht lesen.')).toBe('address')
  expect(problemField('Das Koppeln ist gescheitert (Antwort 500).')).toBeNull()
  expect(remoteBridge({})).toBeNull()
  expect(remoteBridge({ mietfuchsDesktop: { print: async () => {} } })).toBeNull()
})

test('verbunden blendet die Karte „Zugriff aus dem Heimnetz“ aus', async () => {
  const get = vi.fn(async () => ({ enabled: false, port: 3001, addresses: [], remote: true }))
  const { container } = render(<UIProvider><NetworkCard bridge={{ get, set: vi.fn() }} /></UIProvider>)
  await waitFor(() => expect(get).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 20))
  expect(container.textContent).toBe('')
})
