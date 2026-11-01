// @vitest-environment jsdom
// Die Karte „Über Mietfuchs“ am Ende der Einstellungen: Version und Updates, keine Rechts- oder Steuerberatung,
// Urheber, Lizenz ohne Gewähr, Quellcode. Ein Abschnitt „Info“ am Ende der Einstellungen ist der übliche Ort dafür
// (Microsoft für Windows-Apps, Browser), keine eigene Seite.
// Wer aus dem Microsoft Store installiert, sieht README und LICENSE nie; die AGPL sieht diese Angaben
// in einer Oberfläche vor („Appropriate Legal Notices“).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const STATUS: UpdateStatus = { enabled: false, current: '0.14.0', mode: 'npm', latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Über Mietfuchs: keine Rechts- oder Steuerberatung, Lizenz ohne Gewähr, Links zu Website, Lizenz und Quellcode', async () => {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: STATUS, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
  const heading = await screen.findByRole('heading', { name: 'Über Mietfuchs' }, SLOW)
  const card = heading.closest('section, .card')
  if (!(card instanceof HTMLElement)) throw new Error('Karte „Über Mietfuchs“ fehlt')
  expect(card.textContent).toMatch(/Installiert ist Version 0\.14\.0/)
  expect(within(card).getByRole('checkbox', { name: /nach neuen Versionen schauen/ })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull()
  const cards = [...document.querySelectorAll('section.card')]
  expect(cards[cards.length - 1]).toBe(card)
  expect(card.textContent).toMatch(/ersetzt aber keine Rechts- oder Steuerberatung/)
  expect(card.textContent).toMatch(/Prüfen Sie die Ergebnisse, bevor Sie eine Abrechnung versenden/)
  expect(card.textContent).toMatch(/© 2026 speedone/)
  expect(card.textContent).toMatch(/GNU Affero General Public License.*ohne Gewähr/)
  const license = within(card).getByRole('link', { name: 'Lizenz' })
  expect(license.getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/blob/main/LICENSE')
  const source = within(card).getByRole('link', { name: 'Quellcode' })
  expect(source.getAttribute('href')).toBe('https://github.com/speedone/mietfuchs')
  const website = within(card).getByRole('link', { name: 'Website' })
  expect(website.getAttribute('href')).toBe('https://mietfuchs-app.de')
  for (const a of [website, license, source]) expect(a.getAttribute('rel')).toMatch(/noreferrer/)
})

// Aus dem Microsoft Store: Updates spielt der Store ein; die Karte nennt nur die Version, ohne Häkchen und Knopf.
test('Über Mietfuchs aus dem Microsoft Store: Version ohne Update-Prüfung, Hinweis und Lizenz bleiben', async () => {
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: { ...STATUS, mode: 'store' }, checking: false, checkNow: async () => {} }} /></UIProvider>
    </PropertyProvider>,
  )
  const heading = await screen.findByRole('heading', { name: 'Über Mietfuchs' }, SLOW)
  const card = heading.closest('section')
  if (!card) throw new Error('Karte „Über Mietfuchs“ fehlt')
  expect(card.textContent).toMatch(/Installiert ist Version 0\.14\.0\. Neue Versionen installiert der Microsoft Store von selbst, sobald Mietfuchs beendet ist/)
  expect(within(card).queryByRole('checkbox')).toBeNull()
  expect(within(card).queryByRole('button', { name: /Jetzt prüfen/ })).toBeNull()
  expect(card.textContent).toMatch(/keine Rechts- oder Steuerberatung/)
})
