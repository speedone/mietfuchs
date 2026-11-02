// @vitest-environment jsdom
// Automatische Updates im Programmfenster unter Windows (#517): die Brücke (window.mietfuchsDesktop.updater) ist hier
// nachgebaut. Geprüft wird, was die Knöpfe an das Fenster schicken, dass der Hinweis des Servers dann nicht daneben
// erscheint und dass „Über Mietfuchs“ den Stand des Fensters zeigt statt der Anleitung.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import type { UpdaterBridge, UpdaterState } from '../desktopUpdater'
import { UIProvider } from './feedback'
import { UpdateSettings, useUpdateStatus } from './Update'
import { UpdaterReadyHint, useDesktopUpdater } from './DesktopUpdater'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '', ...patch,
})

const updaterState = (patch: Partial<UpdaterState> = {}): UpdaterState => ({
  phase: 'idle', current: '0.14.1', version: null, percent: null, choice: null, error: null, checkedAt: null, ...patch,
})

// Der Server meldet daneben weiter seinen Stand; mit Zustimmung kennt er die neue Version auch
const serverStatus: UpdateStatus = {
  enabled: true, current: '0.14.1', mode: 'desktop', desktopOffer: null, latest: '0.15.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.15.0', downloadUrl: null,
  checkedAt: '2026-11-02T08:00:00.000Z', error: null,
}

let calls: string[]
let requests: string[]

function fakeBridge(start: UpdaterState) {
  let state = start
  const listeners = new Set<(s: UpdaterState) => void>()
  const bridge: UpdaterBridge & { push: (s: UpdaterState) => void, fail: string | null } = {
    fail: null,
    get: async () => state,
    check: async (options) => { calls.push(`check ${options?.force === true ? 'force' : 'auto'}`); return state },
    later: async () => { calls.push('later'); state = { ...state, choice: 'later' }; listeners.forEach((l) => l(state)); return state },
    restart: async () => {
      calls.push('restart')
      if (bridge.fail) throw new Error(bridge.fail)
      return state
    },
    onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    push: (s) => { state = s; act(() => listeners.forEach((l) => l(s))) },
  }
  window.mietfuchsDesktop = { updater: bridge }
  return bridge
}

beforeEach(() => {
  calls = []
  requests = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    const body = url.startsWith('/api/update') ? serverStatus : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
})

test('Ohne Brücke (Browser, Handy) gilt der Server', () => {
  const { result } = renderHook(() => useDesktopUpdater('on'))
  expect(result.current.owner).toBe('server')
  expect(calls).toEqual([])
})

test('Mac und Store: Das Fenster meldet `off`, dann gilt der Hinweis des Servers', async () => {
  fakeBridge(updaterState({ phase: 'off' }))
  const { result } = renderHook(() => useDesktopUpdater('on'))
  // Bis der Stand gelesen ist, zeigt keiner einen Hinweis
  expect(result.current.owner).toBe('pending')
  await waitFor(() => expect(result.current.owner).toBe('server'))
})

test('Gesetztes Häkchen: Das Fenster prüft, wenn es heute noch nicht geprüft hat; ohne Zustimmung nicht', async () => {
  fakeBridge(updaterState())
  const { result, rerender } = renderHook(({ consent }) => useDesktopUpdater(consent), { initialProps: { consent: undefined as unknown } })
  await waitFor(() => expect(result.current.owner).toBe('window'))
  expect(calls).toEqual([])
  rerender({ consent: 'off' })
  expect(calls).toEqual([])
  rerender({ consent: 'on' })
  await waitFor(() => expect(calls).toEqual(['check auto']))
})

test('Hinweis „bereit“: folgt dem Stand des Fensters, „Beim nächsten Start“ blendet ihn aus', async () => {
  const bridge = fakeBridge(updaterState({ phase: 'downloading', version: '0.15.0', percent: 10 }))
  const { result } = renderHook(() => useDesktopUpdater('on'))
  await waitFor(() => expect(result.current.owner).toBe('window'))
  const view = render(<UIProvider><UpdaterReadyHint updates={result.current} /></UIProvider>)
  expect(screen.queryByText('Version 0.15.0 ist bereit')).toBeNull()
  bridge.push(updaterState({ phase: 'ready', version: '0.15.0', percent: 100 }))
  view.rerender(<UIProvider><UpdaterReadyHint updates={result.current} /></UIProvider>)
  expect(screen.getByText('Version 0.15.0 ist bereit')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Was ist neu?' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v0.15.0')
  fireEvent.click(screen.getByRole('button', { name: 'Beim nächsten Start' }))
  await waitFor(() => expect(calls).toContain('later'))
  view.rerender(<UIProvider><UpdaterReadyHint updates={result.current} /></UIProvider>)
  expect(screen.queryByText('Version 0.15.0 ist bereit')).toBeNull()
})

test('„Jetzt neu starten“ geht ans Fenster; scheitert es, sagt Mietfuchs das', async () => {
  const bridge = fakeBridge(updaterState({ phase: 'ready', version: '0.15.0' }))
  bridge.fail = 'Der Installer der neuen Version ließ sich nicht starten.'
  const { result } = renderHook(() => useDesktopUpdater('on'))
  await waitFor(() => expect(result.current.state?.phase).toBe('ready'))
  render(<UIProvider><UpdaterReadyHint updates={result.current} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt neu starten' }))
  await waitFor(() => expect(screen.getByText(/Neu starten ging nicht: Der Installer/)).toBeTruthy())
  expect(calls).toContain('restart')
})

test('„Über Mietfuchs“ im Fenster: Stand des Fensters, die beiden Knöpfe, keine Anleitung; „Jetzt prüfen“ fragt das Fenster', async () => {
  fakeBridge(updaterState({ phase: 'ready', version: '0.15.0' }))
  const s = settings({ updateCheck: 'on' })
  function Card() {
    const update = useUpdateStatus(s)
    return <UIProvider><UpdateSettings settings={s} update={update} reload={async () => {}} /></UIProvider>
  }
  render(<Card />)
  await waitFor(() => expect(screen.getByText(/Version 0\.15\.0 ist bereit, installiert ist 0\.14\.1/)).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Jetzt neu starten' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Beim nächsten Start' })).toBeTruthy()
  // Der Server kennt die neue Version auch; seine Anleitung („Zur Release-Seite“, Schritte) erscheint im Fenster nicht
  expect(screen.queryByRole('link', { name: 'Zur Release-Seite' })).toBeNull()
  expect(screen.queryByText(/Installieren wie beim ersten Mal/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(calls).toContain('check force'))
  expect(requests).not.toContain('POST /api/update/check')
})

test('„Über Mietfuchs“ im Fenster: beim Fehler der Weg über die Release-Seite', async () => {
  fakeBridge(updaterState({ phase: 'error', error: 'GitHub ist nicht erreichbar.' }))
  const s = settings({ updateCheck: 'on' })
  function Card() {
    const update = useUpdateStatus(s)
    return <UIProvider><UpdateSettings settings={s} update={update} reload={async () => {}} /></UIProvider>
  }
  render(<Card />)
  await waitFor(() => expect(screen.getByText(/Die letzte Prüfung ist fehlgeschlagen: GitHub ist nicht erreichbar\./)).toBeTruthy())
  expect(screen.getByRole('link', { name: 'Release-Seite' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/releases/latest')
  expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull()
})

test('Mac im Fenster (Stand `off`): Anleitung mit dem passenden Abbild statt automatischem Update', async () => {
  fakeBridge(updaterState({ phase: 'off' }))
  const dmg = 'https://github.com/speedone/mietfuchs/releases/download/v0.15.0/Mietfuchs-0.15.0-apple-silicon.dmg'
  serverStatus.downloadUrl = dmg
  try {
    const s = settings({ updateCheck: 'on' })
    function Card() {
      const update = useUpdateStatus(s)
      return <UIProvider><UpdateSettings settings={s} update={update} reload={async () => {}} /></UIProvider>
    }
    render(<Card />)
    const link = await screen.findByRole('link', { name: 'Version 0.15.0 herunterladen' })
    expect(link.getAttribute('href')).toBe(dmg)
    expect(screen.getByText(/in den Ordner „Programme“ ziehen und „Ersetzen“ wählen/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'README' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs#macos')
    expect(screen.queryByRole('button', { name: 'Jetzt neu starten' })).toBeNull()
  } finally {
    serverStatus.downloadUrl = null
  }
})

// Durchsicht K4: Antwortet die Brücke nicht, gilt der Server, statt dass dauerhaft niemand einen Hinweis zeigt
test('Durchsicht K4: Brücke antwortet nicht, dann gilt der Server', async () => {
  const bridge = fakeBridge(updaterState())
  bridge.get = async () => { throw new Error('Nicht erlaubt.') }
  const { result } = renderHook(() => useDesktopUpdater('on'))
  await waitFor(() => expect(result.current.owner).toBe('server'))
})
