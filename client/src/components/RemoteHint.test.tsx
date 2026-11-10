// @vitest-environment jsdom
// Rückmeldung zur Kopplung (#528): Ist das Programmfenster mit einem Mietfuchs im Heimnetz verbunden, sah man das nur in
// den Einstellungen. Jetzt steht es ruhig in der Seitenleiste, mit Sprung zur Karte „Mietfuchs im Heimnetz“.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RemoteBridge, RemoteState } from '../desktopRemote'
import RemoteHint from './RemoteHint'

afterEach(cleanup)

const bridge = (state: RemoteState | Error): RemoteBridge => ({
  get: async () => { if (state instanceof Error) throw state; return state },
  connect: vi.fn(),
  disconnect: vi.fn(),
})

test('verbunden: ruhige Zeile mit dem anderen Rechner und Sprung zu den Einstellungen', async () => {
  const onOpen = vi.fn()
  render(<RemoteHint bridge={bridge({ connected: true, origin: 'https://nas:3001', version: '0.17.0' })} onOpen={onOpen} />)
  const hint = await screen.findByRole('button', { name: /^Verbunden mit nas:3001/ })
  expect(hint.getAttribute('aria-description')).toMatch(/Einstellungen/)
  expect(hint.title).toContain('Mietfuchs 0.17.0')
  expect(hint.className).not.toMatch(/notice|warn|amber|red/)
  fireEvent.click(hint)
  expect(onOpen).toHaveBeenCalledTimes(1)
})

test('verbunden ohne lesbaren Ursprung: allgemein', async () => {
  render(<RemoteHint bridge={bridge({ connected: true })} onOpen={() => {}} />)
  expect(await screen.findByRole('button', { name: /^Verbunden mit einem Mietfuchs im Heimnetz/ })).toBeTruthy()
})

test('lokal oder ohne Antwort der Brücke: keine Zeile', async () => {
  const { container } = render(<RemoteHint bridge={bridge({ connected: false })} onOpen={() => {}} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(container.textContent).toBe('')
  cleanup()
  const failed = render(<RemoteHint bridge={bridge(new Error('nein'))} onOpen={() => {}} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(failed.container.textContent).toBe('')
})
