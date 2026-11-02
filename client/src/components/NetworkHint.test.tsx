// @vitest-environment jsdom
// Durchsicht vor 0.15.0 (K5): Solange „Zugriff aus dem Heimnetz“ an ist, steht in der Seitenleiste ruhig „Im Heimnetz
// erreichbar“, mit Sprung zur Karte in den Einstellungen. Quelle ist die Brücke des Fensters (desktopNetwork.ts), hier
// nachgebaut; nach dem Umschalten in der Karte folgt die Zeile ohne Neuladen.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { NetworkBridge, NetworkState } from '../desktopNetwork'
import { UIProvider } from './feedback'
import NetworkCard from './NetworkCard'
import NetworkHint from './NetworkHint'

vi.setConfig({ testTimeout: 20000 })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fakeBridge(start: NetworkState): NetworkBridge {
  let state = start
  return {
    get: async () => state,
    set: async (enabled) => {
      state = { ...state, enabled }
      return state
    },
  }
}
const ON: NetworkState = { enabled: true, port: 17517, addresses: ['http://192.168.178.23:17517'] }
const HINT = 'Im Heimnetz erreichbar'

test('Heimnetz an: ruhige Zeile mit Sprung zur Karte; aus: keine', async () => {
  const onOpen = vi.fn()
  render(<NetworkHint bridge={fakeBridge(ON)} onOpen={onOpen} />)
  const hint = await screen.findByRole('button', { name: new RegExp(`^${HINT}`) })
  // Sagt, wohin der Sprung geht, und ist kein Hinweis einer Stufe (kein Warnzeichen, keine Farbe der Stufen)
  expect(hint.getAttribute('aria-description') ?? hint.title).toMatch(/Einstellungen/)
  expect(hint.className).not.toMatch(/notice|warn|amber|red/)
  fireEvent.click(hint)
  expect(onOpen).toHaveBeenCalledTimes(1)
  cleanup()

  render(<NetworkHint bridge={fakeBridge({ ...ON, enabled: false })} onOpen={onOpen} />)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('button', { name: new RegExp(`^${HINT}`) })).toBeNull()
})

test('Umschalten in der Karte: die Zeile folgt, der Sprung zeigt die Karte', async () => {
  const scrolled = vi.fn()
  Element.prototype.scrollIntoView = scrolled
  const bridge = fakeBridge(ON)
  render(
    <UIProvider>
      <NetworkHint bridge={bridge} onOpen={() => {}} />
      <NetworkCard bridge={bridge} />
    </UIProvider>,
  )
  const hint = await screen.findByRole('button', { name: new RegExp(`^${HINT}`) })
  fireEvent.click(hint)
  // Die Karte ist schon da (auf der Seite Einstellungen): Sie kommt ins Bild
  expect(scrolled).toHaveBeenCalled()
  expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('heading', { name: 'Zugriff aus dem Heimnetz' }).closest('section'))

  const card = screen.getByRole('heading', { name: 'Zugriff aus dem Heimnetz' }).closest('section') as HTMLElement
  fireEvent.click(await within(card).findByRole('checkbox', { name: 'Zugriff aus dem Heimnetz erlauben' }))
  fireEvent.click(within(card).getByRole('button', { name: /^Speichern/ }))
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${HINT}`) })).toBeNull())
})

test('Sprung von einer anderen Seite: die Karte kommt beim Erscheinen ins Bild', async () => {
  const scrolled = vi.fn()
  Element.prototype.scrollIntoView = scrolled
  const bridge = fakeBridge(ON)
  const { rerender } = render(<UIProvider><NetworkHint bridge={bridge} onOpen={() => {}} /></UIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${HINT}`) }))
  expect(scrolled).not.toHaveBeenCalled()
  rerender(<UIProvider><NetworkHint bridge={bridge} onOpen={() => {}} /><NetworkCard bridge={bridge} /></UIProvider>)
  await vi.waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1))
  // Nur einmal: Ein späteres Öffnen der Einstellungen springt nicht von selbst
  cleanup()
  render(<UIProvider><NetworkCard bridge={bridge} /></UIProvider>)
  await screen.findByRole('heading', { name: 'Zugriff aus dem Heimnetz' })
  expect(scrolled).toHaveBeenCalledTimes(1)
})
