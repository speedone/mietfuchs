// @vitest-environment jsdom
// Die Karte „Daten & Sicherung“ nennt, wo die Daten liegen und was nach außen geht.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const database = (file: string) => ({ open: true, file, migrations: 1, detail: '', changeover: { state: 'none', message: '', notes: [] }, migrated: null })

let fetched: string[] = []
let navigated: string[] = []
function open(health: unknown) {
  fetched = []
  navigated = []
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    const body = url.startsWith('/healthz') ? health : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  render(
    <PropertyProvider>
      <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: null, checking: false, checkNow: async () => {} }} onNavigate={(tab) => navigated.push(tab)} /></UIProvider>
    </PropertyProvider>,
  )
}

// Durchsicht von PR #442, M3: Ein Backup bringt keine Zustimmung mit; die Rückfrage sagt es.
test('die Rückfrage vor dem Wiederherstellen nennt die Zustimmungen', async () => {
  open({ ok: true })
  await screen.findByText(/Sonst verlässt nichts den Rechner/, {}, SLOW)
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('kein Dateifeld')
  fireEvent.change(input, { target: { files: [new File(['x'], 'backup.zip', { type: 'application/zip' })] } })
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  expect(dialog.textContent).toMatch(/Zustimmungen .*bringt das Backup nicht mit/)
})

// #318: Die Karte „Automatische Vorversionen“ ist in die Zeitachse des Verlaufs gezogen; hier bleibt ein Satz mit Link.
test('statt der Vorversionen ein Satz mit Link auf den Verlauf', async () => {
  open({ ok: true })
  const link = await screen.findByRole('link', { name: 'im Verlauf' }, SLOW)
  expect(link.closest('p')?.textContent).toBe('Automatische Sicherungen und frühere Stände finden Sie im Verlauf.')
  fireEvent.click(link)
  expect(navigated).toEqual(['verlauf'])
  expect(screen.queryByText(/Automatische Vorversionen/)).toBeNull()
  expect(fetched.some((u) => u.startsWith('/api/prior-versions'))).toBe(false)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('die Karte nennt den Datenordner aus /healthz und sagt genau, was nach außen geht', async () => {
  open({ ok: true, database: database('/srv/mietfuchs/data/mietfuchs.sqlite') })
  const path = await screen.findByText('/srv/mietfuchs/data', {}, SLOW)
  const text = path.closest('p')?.textContent ?? ''
  expect(text).toContain('Ihre Daten liegen im Datenordner von Mietfuchs: /srv/mietfuchs/data.')
  expect(text).toContain('nur an einen externen KI-Dienst')
  expect(text).toContain('bei GitHub')
  expect(text).not.toContain('bleiben lokal')
})

test('Windows-Pfad: der Ordner ist alles vor dem Dateinamen', async () => {
  open({ ok: true, database: database('C:\\Users\\Anna\\AppData\\Mietfuchs\\mietfuchs.sqlite') })
  expect(await screen.findByText('C:\\Users\\Anna\\AppData\\Mietfuchs', {}, SLOW)).toBeTruthy()
})

test('ohne Pfad entfällt der Satz zum Ort, der Rest bleibt', async () => {
  open({ ok: true })
  const p = (await screen.findByText(/Sonst verlässt nichts den Rechner/, {}, SLOW)).closest('p')
  expect(p?.textContent).not.toContain('Datenordner')
  expect(p?.textContent).toContain('nur an einen externen KI-Dienst')
})
