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
const STATUS: UpdateStatus = { enabled: false, current: '0.14.1', mode: 'desktop', latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const ADDRESS = 'http://192.168.178.23:17517'

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

function renderPage() {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: STATUS, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
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
  expect(card.textContent).toMatch(/kein Passwort/)
  expect(card.textContent).toMatch(/jeder in Ihrem Heimnetz/)
  expect(card.textContent).not.toContain(ADDRESS)

  expect((box as HTMLInputElement).checked).toBe(false)
  fireEvent.click(box)
  // Nur ein Entwurf: nichts geschaltet, aber angekündigt, was beim Speichern geschieht
  expect(calls).toEqual([])
  expect(card.textContent).toMatch(/startet Mietfuchs neu/)
  expect(card.textContent).toMatch(/Windows-Firewall/)
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  expect(await within(card).findByText(ADDRESS, {}, SLOW)).toBeTruthy()
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
