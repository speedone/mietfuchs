// @vitest-environment jsdom
// Die Karte „Beim Start“ (#735): womit sich Mietfuchs öffnet. Nur, wo Mietfuchs beim Start selbst einen Browser öffnet;
// der Server liefert dann `settings.browsers`. Die Wahl ist ein Entwurf, erst „Speichern“ schickt sie.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const STATUS: UpdateStatus = { enabled: false, current: '0.18.1', mode: 'package', desktopOffer: null, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const FOUND = { found: [{ id: 'firefox' as const, label: 'Firefox' }, { id: 'chromium' as const, label: 'Chromium' }], fromEnv: false, atThisComputer: true }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Call = { url: string, method: string, body: unknown }
function renderPage(settings: Settings, refusePut: Record<string, unknown> | null = null) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (refusePut && init?.method === 'PUT' && url === '/api/settings') {
      const now = refusePut
      refusePut = null
      const stale = { error: 'Die Einstellungen wurden inzwischen geändert. Gespeichert wurde nichts, damit diese Änderung nicht verloren geht.', stale: true, current: now }
      return new Response(JSON.stringify(stale), { status: 409, headers: { 'content-type': 'application/json' } })
    }
    return new Response(url === '/api/settings' ? '{}' : '[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const reload = vi.fn(async () => {})
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={settings} reload={reload} update={{ status: STATUS, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
  return { calls, reload }
}

async function card() {
  const heading = await screen.findByRole('heading', { name: 'Beim Start' }, SLOW)
  const section = heading.closest('section')
  if (!(section instanceof HTMLElement)) throw new Error('Karte „Beim Start“ fehlt')
  return section
}

test('ohne Angabe des Servers (Programmfenster, Docker, npm) keine Karte', async () => {
  renderPage(SETTINGS)
  await screen.findByRole('heading', { name: 'Über Mietfuchs' }, SLOW)
  expect(screen.queryByRole('heading', { name: 'Beim Start' })).toBeNull()
})

test('Standardbrowser als Voreinstellung, gefundene Browser zur Wahl, gilt ab dem nächsten Start', async () => {
  const { calls, reload } = renderPage({ ...SETTINGS, browsers: FOUND })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  expect([...select.options].map((o) => o.textContent)).toEqual(['Standardbrowser', 'Firefox', 'Chromium'])
  expect(select.value).toBe('')
  expect(section.textContent).toMatch(/ab dem nächsten Start/)
  expect(section.textContent).toMatch(/Standardbrowser Ihres Systems bleibt/)
  expect(section.textContent).toMatch(/vor der Umgebungsvariablen BROWSER/)

  // Ein Entwurf: Auswählen speichert nichts
  fireEvent.change(select, { target: { value: 'chromium' } })
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
  fireEvent.click(within(section).getByRole('button', { name: /^Speichern/ }))
  await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/api/settings', method: 'PUT', body: { openWith: 'chromium', ifUnchanged: { openWith: null } } }]))
  await waitFor(() => expect(reload).toHaveBeenCalled())
})

test('zurück zum Standardbrowser schickt null', async () => {
  const { calls } = renderPage({ ...SETTINGS, openWith: 'firefox', browsers: FOUND })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  expect(select.value).toBe('firefox')
  fireEvent.change(select, { target: { value: '' } })
  fireEvent.click(within(section).getByRole('button', { name: /^Speichern/ }))
  await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/api/settings', method: 'PUT', body: { openWith: null, ifUnchanged: { openWith: 'firefox' } } }]))
})

test('gewählter Browser nicht mehr da: sichtbar gewählt, mit Satz zum Rückfall', async () => {
  renderPage({ ...SETTINGS, openWith: 'brave', browsers: FOUND })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  // Der angezeigte Wert ist der gespeicherte, nicht der erste Eintrag
  expect(select.value).toBe('brave')
  expect(select.selectedOptions[0]?.textContent).toBe('Brave (nicht gefunden)')
  expect(section.textContent).toMatch(/Brave findet Mietfuchs auf diesem Rechner nicht mehr\. Beim Start öffnet sich Mietfuchs deshalb im Standardbrowser/)
})

test('mit BROWSER: der Standard heißt nach der Umgebungsvariablen; ohne gefundenen Browser ein Satz dazu', async () => {
  renderPage({ ...SETTINGS, browsers: { found: [], fromEnv: true, atThisComputer: true } })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  expect([...select.options].map((o) => o.textContent)).toEqual(['Wie in der Umgebungsvariablen BROWSER angegeben'])
  expect(section.textContent).toMatch(/keinen weiteren Browser gefunden/)
})

// Durchsicht K7: Von einem anderen Gerät lässt sich die Wahl nicht ändern; die Karte zeigt sie und sagt warum
test('von einem anderen Gerät: Wahl sichtbar, nicht änderbar, mit Satz', async () => {
  renderPage({ ...SETTINGS, openWith: 'firefox', browsers: { ...FOUND, atThisComputer: false } })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  expect(select.value).toBe('firefox')
  expect(select.disabled).toBe(true)
  expect(section.textContent).toMatch(/Ändern können Sie das nur am Rechner, auf dem Mietfuchs läuft/)
})

// #692/#733: Ein zweites Fenster überschreibt die Wahl nicht still. Die Karte schickt, was sie gesehen hat; lehnt der
// Server ab, steht der Satz mit dem Stand von jetzt da, die eigene Wahl bleibt, und erneutes Speichern geht bewusst.
test('zweites Fenster: Ablehnung mit Stand von jetzt, eigene Wahl bleibt, erneutes Speichern mit neuem Stand', async () => {
  const { calls } = renderPage({ ...SETTINGS, browsers: FOUND }, { ...SETTINGS, fixedByEnv: [], openWith: 'firefox', browsers: FOUND })
  const section = await card()
  const select = within(section).getByRole('combobox', { name: 'Mietfuchs öffnen mit' })
  if (!(select instanceof HTMLSelectElement)) throw new Error('kein Auswahlfeld')
  fireEvent.change(select, { target: { value: 'chromium' } })
  fireEvent.click(within(section).getByRole('button', { name: /^Speichern/ }))
  const alert = await within(section).findByRole('alert', {}, SLOW)
  expect(alert.textContent).toMatch(/inzwischen geändert.*Inzwischen geändert: Mietfuchs öffnen mit \(jetzt Firefox\)/)
  expect(select.value).toBe('chromium')
  fireEvent.click(within(section).getByRole('button', { name: /^Speichern/ }))
  await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ openWith: 'chromium', ifUnchanged: { openWith: 'firefox' } }))
})
