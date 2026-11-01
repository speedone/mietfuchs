// @vitest-environment jsdom
// Umzug ins Programmfenster (#517): dauerhaft in den Einstellungen „Daten aus bisherigem Mietfuchs übernehmen …“, nur im
// Fenster (mit dessen Brücke); im Browser und auf dem Handy nicht.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const STATUS: UpdateStatus = { enabled: false, current: '0.14.1', mode: 'desktop', latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.mietfuchsDesktop
})

function renderPage(onOpenRelocation = vi.fn()) {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: STATUS, checking: false, checkNow: async () => {} }} onOpenRelocation={onOpenRelocation} /></UIProvider>
    </PropertyProvider>,
  )
  return onOpenRelocation
}

test('im Fenster: der Weg zum Umzug steht in den Einstellungen', async () => {
  window.mietfuchsDesktop = { print: async () => {} }
  const open = renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten aus bisherigem Mietfuchs übernehmen …' }, { timeout: 5000 }))
  expect(open).toHaveBeenCalled()
})

test('im Browser: kein Umzug', async () => {
  renderPage()
  await screen.findByRole('heading', { name: /Sicherung/ }, { timeout: 5000 })
  expect(screen.queryByRole('button', { name: 'Daten aus bisherigem Mietfuchs übernehmen …' })).toBeNull()
})
