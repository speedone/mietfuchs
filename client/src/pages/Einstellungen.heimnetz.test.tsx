// @vitest-environment jsdom
// Die Karte „Zugriff aus dem Heimnetz“ (#517): nur im Programmfenster, also nur mit dessen Brücke
// (window.mietfuchsDesktop.network), hier nachgebaut. Das Häkchen ist ein Entwurf; erst „Speichern“ schaltet um.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import type { NetworkBridge, NetworkState } from '../desktopNetwork'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const STATUS: UpdateStatus = { enabled: false, current: '0.14.1', mode: 'desktop', desktopOffer: null, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const ADDRESS = 'http://192.168.178.23:17517'
// Fragt die Windows-Firewall nach dem Einschalten, soll nur das Heimnetz frei werden, nie ein öffentliches WLAN
const PRIVATE_ONLY = 'Wenn Windows fragt, lassen Sie nur „Private Netzwerke“ zu.'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
})

function fakeBridge(start: NetworkState) {
  let state = start
  const calls: boolean[] = []
  const bridge: NetworkBridge = {
    get: async () => state,
    set: async (enabled) => {
      calls.push(enabled)
      state = { ...state, enabled }
      return state
    },
  }
  return { bridge, calls }
}

type Call = { url: string, method: string, body: unknown }
function renderPage(initialAuth: Record<string, unknown> | null = null) {
  let auth = initialAuth
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/auth' && auth) return new Response(JSON.stringify(auth), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/auth/setup' && auth?.setupConflict) {
      auth = { ...auth, mode: 'password' }
      return new Response(JSON.stringify({ error: 'Ein Passwort ist schon festgelegt.' }), { status: 409, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/api/auth/setup') return new Response(JSON.stringify({ ok: true, mode: 'password' }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: STATUS, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
  return calls
}

async function findCard() {
  const heading = await screen.findByRole('heading', { name: 'Zugriff aus dem Heimnetz' }, SLOW)
  const card = heading.closest('section')
  if (!card) throw new Error('Karte „Zugriff aus dem Heimnetz“ fehlt')
  return card
}

test('Heimnetz im Fenster: Warnung, Einschalten erst mit Speichern, danach die Adressen fürs Handy', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { print: async () => {}, network: bridge }
  renderPage()
  const card = await findCard()
  // Vor „Über Mietfuchs“, das die letzte Karte bleibt
  const cards = [...document.querySelectorAll('section.card')]
  const about = screen.getByRole('heading', { name: 'Über Mietfuchs' }).closest('section')
  expect(cards.indexOf(card)).toBe(cards.length - 2)
  expect(cards[cards.length - 1]).toBe(about)
  const box = await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW)
  // Ohne Stand des Zugangs (älterer Server) bleibt die Warnung (#528)
  expect(card.textContent).toMatch(/Ohne Passwort kann jeder in Ihrem Heimnetz/)
  expect(card.textContent).not.toContain(ADDRESS)

  expect((box as HTMLInputElement).checked).toBe(false)
  fireEvent.click(box)
  // Nur ein Entwurf: nichts geschaltet, aber angekündigt, was beim Speichern geschieht
  expect(calls).toEqual([])
  expect(card.textContent).toMatch(/startet Mietfuchs neu/)
  expect(card.textContent).toContain(PRIVATE_ONLY)
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  expect(await within(card).findByText(ADDRESS, {}, SLOW)).toBeTruthy()
  // Die Frage der Firewall kommt erst nach dem Neustart, wenn die Karte die Adressen zeigt: Der Satz steht dann noch da
  expect(card.textContent).toContain(PRIVATE_ONLY)
  expect(calls).toEqual([true])
  expect((within(card).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  expect(within(card).queryByRole('button', { name: /^Speichern/ })).toBeNull()
})

test('Heimnetz an: Adressen, Ausschalten mit Speichern; ohne Netzwerk ein Satz statt einer leeren Liste', async () => {
  const { bridge, calls } = fakeBridge({ enabled: true, port: 17517, addresses: [ADDRESS, 'http://10.0.0.5:17517'] })
  window.mietfuchsDesktop = { network: bridge }
  renderPage()
  const card = await findCard()
  expect(await within(card).findByText(ADDRESS, {}, SLOW)).toBeTruthy()
  expect(within(card).getByText('http://10.0.0.5:17517')).toBeTruthy()
  expect(card.textContent).toContain(PRIVATE_ONLY)
  fireEvent.click(within(card).getByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }))
  expect(card.textContent).not.toMatch(/Windows-Firewall/)
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  await vi.waitFor(() => expect(calls).toEqual([false]), SLOW)
  await vi.waitFor(() => expect(card.textContent).not.toContain(ADDRESS), SLOW)

  cleanup()
  window.mietfuchsDesktop = { network: fakeBridge({ enabled: true, port: 17517, addresses: [] }).bridge }
  renderPage()
  const offline = await findCard()
  expect(await within(offline).findByText(/mit keinem Netzwerk verbunden/, {}, SLOW)).toBeTruthy()
})

test('Heimnetz: Lässt sich der Stand nicht abfragen, sagt die Karte das', async () => {
  window.mietfuchsDesktop = { network: { get: async () => { throw new Error('Nicht erlaubt.') }, set: async () => { throw new Error('nie') } } }
  renderPage()
  const card = await findCard()
  expect(await within(card).findByText(/Nicht erlaubt\./, {}, SLOW)).toBeTruthy()
  expect(within(card).queryByRole('checkbox')).toBeNull()
})

test('Heimnetz im Browser: ohne Brücke des Fensters keine Karte', async () => {
  renderPage()
  await screen.findByRole('heading', { name: 'Über Mietfuchs' }, SLOW)
  expect(screen.queryByRole('heading', { name: 'Zugriff aus dem Heimnetz' })).toBeNull()
})

// Anmeldung (#528): Ohne Passwort fragt die Karte beim Einschalten danach, im selben Entwurf; gespeichert wird erst das
// Passwort (über den Fensterschlüssel, ohne Code), dann der Zugriff
const NONE = { mode: 'none', required: false, signedIn: false, window: true, reachable: 'local', envFixed: false, minLength: 15 }

test('Heimnetz einschalten ohne Passwort: erst Passwort festlegen, dann umschalten', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { network: bridge }
  const requests = renderPage(NONE)
  const card = await findCard()
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW))
  const password = await within(card).findByLabelText('Passwort für andere Geräte', {}, SLOW)
  const repeat = within(card).getByLabelText('Passwort wiederholen')
  fireEvent.change(password, { target: { value: 'Sonne Wolke Regen' } })
  fireEvent.change(repeat, { target: { value: 'Sonne Wolke Regem' } })
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  expect(await within(card).findByText(/Die beiden Passwörter stimmen nicht überein\./, {}, SLOW)).toBeTruthy()
  expect(calls).toEqual([])
  fireEvent.change(repeat, { target: { value: 'Sonne Wolke Regen' } })
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  await vi.waitFor(() => expect(calls).toEqual([true]), SLOW)
  const setup = requests.filter((r) => r.url === '/api/auth/setup')
  expect(setup).toEqual([{ url: '/api/auth/setup', method: 'POST', body: { password: 'Sonne Wolke Regen' } }])
})

test('Heimnetz einschalten ohne Passwort: „Ohne Passwort“ nur nach Rückfrage', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { network: bridge }
  const requests = renderPage(NONE)
  const card = await findCard()
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW))
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Ohne Passwort' }, SLOW))
  expect(card.textContent).toMatch(/jeder in Ihrem Heimnetz/)
  expect(within(card).queryByLabelText('Passwort für andere Geräte')).toBeNull()
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  const question = await screen.findByRole('alertdialog', {}, SLOW)
  fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }))
  await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(calls).toEqual([])
  fireEvent.click(await within(card).findByRole('button', { name: /^Speichern/ }, SLOW))
  fireEvent.click(within(await screen.findByRole('alertdialog', {}, SLOW)).getByRole('button', { name: 'Ohne Passwort erlauben' }))
  await vi.waitFor(() => expect(calls).toEqual([true]), SLOW)
  expect(requests.filter((r) => r.url === '/api/auth/setup').map((r) => r.body)).toEqual([{ withoutPassword: true }])
})

test('Heimnetz einschalten mit festgelegtem Passwort: keine Felder', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { network: bridge }
  const requests = renderPage({ ...NONE, mode: 'password' })
  const card = await findCard()
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW))
  expect(within(card).queryByLabelText('Passwort für andere Geräte')).toBeNull()
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  await vi.waitFor(() => expect(calls).toEqual([true]), SLOW)
  expect(requests.some((r) => r.url === '/api/auth/setup')).toBe(false)
})

test('Heimnetz: inzwischen anderswo ein Passwort festgelegt, dann ohne Einrichtung umschalten', async () => {
  const { bridge, calls } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { network: bridge }
  renderPage({ ...NONE, setupConflict: true })
  const card = await findCard()
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW))
  fireEvent.change(await within(card).findByLabelText('Passwort für andere Geräte', {}, SLOW), { target: { value: 'Sonne Wolke Regen' } })
  fireEvent.change(within(card).getByLabelText('Passwort wiederholen'), { target: { value: 'Sonne Wolke Regen' } })
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  await vi.waitFor(() => expect(calls).toEqual([true]), SLOW)
})

test('Heimnetz: Verwerfen leert die Passwortfelder', async () => {
  const { bridge } = fakeBridge({ enabled: false, port: 17517, addresses: [ADDRESS] })
  window.mietfuchsDesktop = { network: bridge }
  renderPage(NONE)
  const card = await findCard()
  const box = await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }, SLOW)
  fireEvent.click(box)
  fireEvent.change(await within(card).findByLabelText('Passwort für andere Geräte', {}, SLOW), { target: { value: 'Sonne Wolke Regen' } })
  fireEvent.click(box)
  fireEvent.click(box)
  expect((await within(card).findByLabelText('Passwort für andere Geräte', {}, SLOW) as HTMLInputElement).value).toBe('')
})
