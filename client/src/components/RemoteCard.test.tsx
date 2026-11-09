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
  let done: (r: { ok: true }) => void = () => {}
  const b = bridge({ connect: vi.fn(() => new Promise<{ ok: true }>((resolve) => { done = resolve })) })
  show(b)
  fireEvent.change(await screen.findByLabelText(/Adresse/), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'K7QM-4XPA' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
  await waitFor(() => expect(b.connect).toHaveBeenCalledWith({ address: 'nas:3001', code: 'K7QM-4XPA' }))
  expect(screen.getByRole('button', { name: /Verbinde/ })).toHaveProperty('disabled', true)
  done({ ok: true })
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

// ---------- Nachbesserung: Feld der Brücke, Stand nach dem Koppeln, Laden, Trennen ----------
const IPC = "Error invoking remote method 'mietfuchs:remote-connect': Error: "
const fill = async () => {
  fireEvent.change(await screen.findByLabelText(/Adresse/), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'X' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
}

test('das Feld der Brücke entscheidet, auch gegen das Stichwort', async () => {
  const problem = 'Unter nas:3001 ist Mietfuchs nicht erreichbar. Prüfen Sie die Adresse und ob Mietfuchs dort läuft.'
  show(bridge({ connect: vi.fn(async () => ({ problem, field: 'code' as const })) }))
  await fill()
  await waitFor(() => expect(screen.getByLabelText(/Code/).getAttribute('aria-invalid')).toBe('true'))
  expect(screen.getByLabelText(/Adresse/).getAttribute('aria-invalid')).not.toBe('true')
})

test('ohne Feld und ohne Stichwort: Meldung der Karte, kein Feld markiert', async () => {
  const problem = 'Das Koppeln ist gescheitert (Antwort 500).'
  show(bridge({ connect: vi.fn(async () => ({ problem })) }))
  await fill()
  await waitFor(() => expect(screen.getAllByText(problem).length).toBeGreaterThan(0))
  expect(screen.getByLabelText(/Code/).getAttribute('aria-invalid')).not.toBe('true')
})

test('nach ok liest die Karte den Stand neu und zeigt Verbunden', async () => {
  const get = vi.fn()
    .mockResolvedValueOnce({ connected: false })
    .mockResolvedValue({ connected: true, origin: 'https://nas:3001', version: '0.17.0' })
  show(bridge({ get }))
  await fill()
  expect(await screen.findByText('Verbunden mit nas:3001 (Mietfuchs 0.17.0)')).toBeTruthy()
  expect(get).toHaveBeenCalledTimes(2)
})

test('bis der Stand bekannt ist, zeigt die Karte nichts', async () => {
  let done: (s: { connected: boolean }) => void = () => {}
  const get = vi.fn(() => new Promise<{ connected: boolean }>((resolve) => { done = resolve }))
  const { container } = show(bridge({ get }))
  expect(container.textContent).toBe('')
  done({ connected: false })
  expect(await screen.findByRole('button', { name: 'Verbinden' })).toBeTruthy()
})

test('get scheitert: Meldung ohne Formular, ohne Elektron-Vorspann', async () => {
  show(bridge({ get: vi.fn(async () => { throw new Error(`${IPC.replace('connect', 'get')}Kein Zugriff.`) }) }))
  expect(await screen.findByText(/Kein Zugriff\./)).toBeTruthy()
  expect(screen.queryByText(/Error invoking/)).toBeNull()
})

test('connect wirft: Satz ohne Vorspann', async () => {
  show(bridge({ connect: vi.fn(async () => { throw new Error(`${IPC}Etwas ging schief.`) }) }))
  await fill()
  await waitFor(() => expect(screen.getAllByText('Etwas ging schief.').length).toBeGreaterThan(0))
  expect(screen.queryByText(/Error invoking/)).toBeNull()
})

const connected = { connected: true, origin: 'https://nas:3001', version: '0.17.0' }
async function askDisconnect() {
  fireEvent.click(await screen.findByRole('button', { name: 'Verbindung trennen …' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trennen' }))
}

test('Trennen: Knopf gesperrt und beschriftet, solange es dauert', async () => {
  let done: (v: unknown) => void = () => {}
  show(bridge({ get: vi.fn(async () => connected), disconnect: vi.fn(() => new Promise((resolve) => { done = resolve })) }))
  await askDisconnect()
  expect(await screen.findByText('Wird getrennt …')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Verbindung trennen …' })).toHaveProperty('disabled', true)
  done({})
})

test('Trennen scheitert: Meldung ohne Vorspann, Knopf wieder frei; ein alter Fehler ist weg', async () => {
  const disconnect = vi.fn()
    .mockRejectedValueOnce(new Error(`${IPC}Erster Fehler.`))
    .mockRejectedValueOnce(new Error(`${IPC}Zweiter Fehler.`))
  show(bridge({ get: vi.fn(async () => connected), disconnect }))
  await askDisconnect()
  expect(await screen.findByText(/Erster Fehler\./)).toBeTruthy()
  expect(screen.queryByText(/Error invoking/)).toBeNull()
  await askDisconnect()
  expect(await screen.findByText(/Zweiter Fehler\./)).toBeTruthy()
  expect(screen.queryByText(/Erster Fehler\./)).toBeNull()
  expect(screen.getByRole('button', { name: 'Verbindung trennen …' })).toHaveProperty('disabled', false)
})

test('Sätze aus pairing.js landen am richtigen Feld', async () => {
  const address = 'Diese Adresse lässt sich nicht lesen. Geben Sie sie so ein, wie Sie Mietfuchs im Browser öffnen, etwa nas:3001 oder 192.168.1.5:3001.'
  show(bridge({ connect: vi.fn(async () => ({ problem: address, field: 'address' as const })) }))
  await fill()
  await waitFor(() => expect(screen.getByLabelText(/Adresse/).getAttribute('aria-invalid')).toBe('true'))
})

test('Brücke fehlt oder ist unvollständig: keine Karte', () => {
  expect(remoteBridge(undefined)).toBeNull()
  expect(remoteBridge({ mietfuchsDesktop: {} })).toBeNull()
  const part = { get: async () => ({ connected: false }), connect: async () => ({ ok: true as const }) }
  expect(remoteBridge({ mietfuchsDesktop: { remote: part as unknown as RemoteBridge } })).toBeNull()
  expect(remoteBridge({ mietfuchsDesktop: { remote: { ...part, disconnect: async () => ({}) } } })).not.toBeNull()
})

test('verbunden, aber der Stand lässt sich danach nicht lesen: Meldung zum Laden, kein Fehler beim Verbinden', async () => {
  const get = vi.fn()
    .mockResolvedValueOnce({ connected: false })
    .mockRejectedValue(new Error(`${IPC.replace('connect', 'get')}Stand nicht lesbar.`))
  show(bridge({ get }))
  await fill()
  expect(await screen.findByText('Das ließ sich nicht erledigen: Stand nicht lesbar.')).toBeTruthy()
  // Gekoppelt ist das Fenster trotzdem: kein Satz am Formular, kein Formular mehr, Trennen bleibt möglich
  expect(screen.queryByLabelText(/Adresse/)).toBeNull()
  expect(screen.getByText('Verbunden mit einem Mietfuchs im Heimnetz')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Verbindung trennen …' })).toBeTruthy()
})
