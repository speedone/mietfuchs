// @vitest-environment jsdom
// Datensicherung aus Nutzersicht: Die Karte „Daten & Sicherung“ nennt das letzte Backup, das Wiederherstellen bestätigt
// sich über die Ankunft nach dem Neuladen, und das Cockpit erinnert ruhig.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BackupStatus, Settings } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import BackupReminder from '../components/BackupReminder'
import Einstellungen from './Einstellungen'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

let reloaded: string[] = []
function open(status: BackupStatus | null, restoreAnswer: () => Response = () => json({ ok: true })) {
  reloaded = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/backup/status')) return status ? json(status) : json({ error: 'Nicht gefunden' }, 404)
    if (url.startsWith('/api/restore') && init?.method === 'POST') return restoreAnswer()
    return json(url.startsWith('/healthz') ? { ok: true } : [])
  })
  render(
    <PropertyProvider>
      <UIProvider>
        <Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: null, checking: false, checkNow: async () => {} }} reloadPage={(arrival) => reloaded.push(arrival)} />
      </UIProvider>
    </PropertyProvider>,
  )
}

test('die Karte nennt, wann zuletzt ein Backup heruntergeladen wurde, und sagt nicht „gesichert“', async () => {
  open({ lastDownloadAt: '2026-11-17T12:00:00.000Z', ageDays: 3, reminder: null })
  const line = await screen.findByText(/Backup zuletzt heruntergeladen am 17\.11\.2026 \(vor 3 Tagen\)\./, {}, SLOW)
  expect(line.textContent).toMatch(/Ob und wo die Datei gespeichert wurde, sieht Mietfuchs nicht/)
  expect(line.textContent).not.toMatch(/gesichert am/)
})

test('ohne Backup sagt die Karte das; ohne Antwort des Servers steht nichts da', async () => {
  open({ lastDownloadAt: null, ageDays: null, reminder: 'never' })
  await screen.findByText(/Von diesem Rechner wurde bisher kein Backup heruntergeladen\./, {}, SLOW)
  cleanup()
  open(null)
  await screen.findByText(/Sonst verlässt nichts den Rechner/, {}, SLOW)
  expect(screen.queryByText(/kein Backup heruntergeladen|zuletzt heruntergeladen/)).toBeNull()
})

test('scheitert das Backup, steht die Ablehnung des Servers in der Karte: der Link lädt in einen unsichtbaren Rahmen', async () => {
  open({ lastDownloadAt: null, ageDays: null, reminder: 'never' })
  const link = await screen.findByRole('link', { name: /Backup herunterladen \(ZIP\)/ }, SLOW)
  expect(link.getAttribute('href')).toBe('/api/backup')
  // Mit `download` speicherte Chromium die Fehlermeldung als Datei „backup.json“
  expect(link.hasAttribute('download')).toBe(false)
  const frame = document.querySelector('iframe')
  if (!frame) throw new Error('kein Rahmen')
  expect(link.getAttribute('target')).toBe(frame.getAttribute('name'))
  expect(frame.hidden).toBe(true)
  // Der leere Rahmen und ein gelungener Download melden nichts
  fireEvent.load(frame)
  expect(screen.queryByText('Das Backup wurde nicht erstellt')).toBeNull()
  const doc = frame.contentDocument
  if (!doc) throw new Error('kein Dokument im Rahmen')
  doc.body.innerHTML = '<h1>Das Backup wurde nicht erstellt</h1><p id="meldung">Mietfuchs kann gerade kein Backup erstellen.</p><p>Ihre Daten sind unverändert.</p>'
  fireEvent.load(frame)
  await screen.findByText('Mietfuchs kann gerade kein Backup erstellen.', {}, SLOW)
  // Ein neuer Versuch nimmt die Meldung zurück
  link.addEventListener('click', (e) => e.preventDefault())
  fireEvent.click(link)
  expect(screen.queryByText('Mietfuchs kann gerade kein Backup erstellen.')).toBeNull()
  // Eine JSON-Antwort (etwa die abgelaufene Anmeldung) wird ebenso gelesen
  doc.body.innerHTML = '<pre>{"error":"Bitte melden Sie sich an.","login":true}</pre>'
  fireEvent.load(frame)
  await screen.findByText('Bitte melden Sie sich an.', {}, SLOW)
})

async function restoreFile() {
  await screen.findByText(/Sonst verlässt nichts den Rechner/, {}, SLOW)
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('kein Dateifeld')
  fireEvent.change(input, { target: { files: [new File(['x'], 'backup.zip', { type: 'application/zip' })] } })
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Wiederherstellen')
  if (!confirm) throw new Error('kein Knopf „Wiederherstellen“')
  fireEvent.click(confirm)
}

test('nach dem Wiederherstellen lädt die Seite mit dem Anlass neu, damit die Bestätigung erscheint', async () => {
  open({ lastDownloadAt: null, ageDays: null, reminder: 'never' })
  await restoreFile()
  await waitFor(() => expect(reloaded).toEqual(['backup']), SLOW)
})

test('mit Hinweisen des Servers bleibt die Meldung stehen, und ein Fehler lädt nicht neu', async () => {
  open(null, () => json({ ok: true, notes: ['Ein Beleg fehlt im Archiv.'] }))
  await restoreFile()
  await screen.findByText('Backup wiederhergestellt. Ein Beleg fehlt im Archiv.', {}, SLOW)
  expect(reloaded).toEqual([])
  cleanup()
  open(null, () => json({ error: 'Die Datei ist kein gültiges ZIP-Archiv.' }, 400))
  await restoreFile()
  await screen.findByText(/Fehler: Die Datei ist kein gültiges ZIP-Archiv\./, {}, SLOW)
  expect(reloaded).toEqual([])
})

test('Cockpit: die Erinnerung ist ein ruhiger Hinweis mit Sprung, und ohne Anlass fehlt sie', async () => {
  let opened = 0
  vi.stubGlobal('fetch', async () => json({ lastDownloadAt: '2026-10-01T12:00:00.000Z', ageDays: 50, reminder: 'old' } satisfies BackupStatus))
  render(<BackupReminder onOpen={() => { opened++ }} />)
  await screen.findByText('Das letzte Backup wurde vor 50 Tagen heruntergeladen', {}, SLOW)
  expect(document.querySelector('.notice-item')?.textContent).toMatch(/Hinweis/)
  fireEvent.click(screen.getByRole('button', { name: 'Zum Backup → Einstellungen' }))
  expect(opened).toBe(1)
  cleanup()
  let asked = 0
  vi.stubGlobal('fetch', async () => { asked++; return json({ lastDownloadAt: '2026-11-19T12:00:00.000Z', ageDays: 1, reminder: null } satisfies BackupStatus) })
  const { container } = render(<BackupReminder onOpen={() => {}} />)
  await waitFor(() => expect(asked).toBeGreaterThan(0), SLOW)
  expect(container.textContent).toBe('')
})
