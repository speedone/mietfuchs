// @vitest-environment jsdom
// Sicherungspunkte in der Zeitachse des Verlaufs (#318): eigene Zeilen, Rückkehr mit Vorschau und Rückfrage, nach dem
// Einspielen neu geladen, die Hinweise danach einmal. Die frühere Karte „Automatische Vorversionen“ ist darin aufgegangen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Verlauf from './Verlauf'
import { UIProvider } from '../components/feedback'
import type { JournalDetail, JournalGroup } from '../journalView'
import type { RevertPreview, SnapshotPoint, SnapshotPreview } from '../journalRevert'

const group = (id: number, title: string, extra: Partial<JournalGroup> = {}): JournalGroup => ({
  id, firstId: id, at: '2026-10-24T08:15:00.000Z', method: 'PUT', route: '/api/units/:id', description: title, title, propertyIds: ['objekt-1'],
  installationWide: false, rows: 1, revertedBy: null, barrier: null, readOnly: false, newest: false, ...extra,
})
const point = (over: Partial<SnapshotPoint> = {}): SnapshotPoint => ({
  kind: 'snapshot', name: 'vorversion-2026-10-20-081500.sqlite', type: 'weekly', at: '2026-10-20T08:15:00.000Z', timeFrom: 'name',
  size: 2 * 1024 * 1024, version: null, title: 'Wöchentliche Sicherung', ...over,
})
const snapshotPreview = (over: Partial<SnapshotPreview> = {}): SnapshotPreview => ({
  kind: 'snapshot', snapshot: point(), entry: null, mode: null, reasons: [], later: 3, missing: ['a.pdf'], fromTrash: 1,
  consents: ['Zustimmungen bringt die Sicherung nicht mit; es gelten danach die von jetzt: die Abfrage nach Updates.'],
  notes: [], refusals: [], frozen: [], token: 'marke-s', ...over,
})

type Sent = { url: string, method: string, body: unknown }
let sent: Sent[]
let listed: (JournalGroup | SnapshotPoint)[]
let previewBody: SnapshotPreview | RevertPreview
let restoreAnswer: { status: number, body: unknown }
let reloads: number
beforeEach(() => {
  sent = []
  reloads = 0
  sessionStorage.clear()
  listed = [
    group(9, 'Wohnung geändert: EG', { newest: true }),
    point(),
    point({ name: 'mietfuchs.sqlite.vor-0075_verlauf_ruecksprung', type: 'update', at: '2026-10-01T10:00:00.000Z', timeFrom: 'file', size: 512 * 1024, version: '0.13.0', title: 'Vor dem Update auf Version 0.13.0' }),
    group(5, 'Wohnung angelegt: alt', { readOnly: true }),
  ]
  previewBody = snapshotPreview()
  restoreAnswer = { status: 200, body: { ok: true, notes: ['Ein Beleg, auf den dieser Stand verweist, fehlt unter „Belege“, weil er seither gelöscht wurde: a.pdf.'] } }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ url, method: init?.method ?? 'GET', body })
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/restore/preview') || url.endsWith('/revert/preview')) return reply(previewBody)
    if (url.endsWith('/restore')) return reply(restoreAnswer.body, restoreAnswer.status)
    if (/^\/api\/journal\/\d+$/.test(url)) return reply({ ...group(5, 'Wohnung angelegt: alt'), changes: [] } satisfies JournalDetail)
    return reply(listed)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = () => render(<UIProvider><Verlauf reloadPage={() => { reloads++ }} /></UIProvider>)
const posts = () => sent.filter((s) => s.method === 'POST').map((s) => s.url)

test('Die Zeitachse zeigt Sicherungen als eigene Zeilen mit Titel, Zeitpunkt und Größe, abgefragt mit snapshots=1', async () => {
  page()
  const weekly = (await screen.findByText('Wöchentliche Sicherung')).closest('[data-snapshot]')
  if (!(weekly instanceof HTMLElement)) throw new Error('keine eigene Zeile')
  expect(within(weekly).getByText(/20\.10\.2026/)).toBeTruthy()
  expect(within(weekly).getByText('2,0 MB')).toBeTruthy()
  expect(within(weekly).getByRole('button', { name: 'Zu diesem Stand zurückkehren …' })).toBeTruthy()
  const update = screen.getByText('Vor dem Update auf Version 0.13.0').closest('[data-snapshot]')
  if (!(update instanceof HTMLElement)) throw new Error('keine eigene Zeile')
  // Ein Zeitpunkt nur aus der Dateizeit ist gekennzeichnet.
  expect(within(update).getByText(/laut Datei/)).toBeTruthy()
  expect(within(update).getByText('512 KB')).toBeTruthy()
  expect(sent.find((s) => s.url.startsWith('/api/journal?'))?.url).toMatch(/[?&]snapshots=1(&|$)/)
  // Eine Sicherung ist kein aufklappbarer Eintrag.
  expect(weekly.closest('details')).toBeNull()
})

// Durchsicht von PR #442: Die Einleitung ist kurz, die Einzelheiten stehen eingeklappt unter „Mehr dazu“.
test('Die Einleitung ist kurz, die Einzelheiten stehen unter „Mehr dazu“', async () => {
  page()
  await screen.findByText('Wöchentliche Sicherung')
  expect(screen.getByText(/Einträge verfallen nach zwölf Monaten\./)).toBeTruthy()
  expect(screen.getByText(/Die Sicherungen liegen auf diesem Rechner und ersetzen kein Backup\./)).toBeTruthy()
  const more = screen.getByText('Mehr dazu').closest('details')
  if (!more) throw new Error('kein „Mehr dazu“')
  expect(more.open).toBe(false)
  expect(within(more).getByText(/Wieder öffnen/)).toBeTruthy()
  expect(within(more).getByText(/Papierkorb/)).toBeTruthy()
  expect(within(more).getByText(/die letzten vier/)).toBeTruthy()
})

test('Zurückkehren: Vorschau, Rückfrage mit Gefahr und Startfokus „Abbrechen“, dann Einspielen mit Marke und Neuladen', async () => {
  page()
  const row = (await screen.findByText('Wöchentliche Sicherung')).closest('[data-snapshot]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Zu diesem Stand zurückkehren …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/^Zum Stand „Wöchentliche Sicherung“ vom 20\.10\.2026/)).toBeTruthy()
  expect(within(dialog).getByText(/alles, was danach kam, wird durch diesen Stand ersetzt/i)).toBeTruthy()
  expect(within(dialog).getByText(/3 Einträge/)).toBeTruthy()
  expect(within(dialog).getByText(/mietfuchs\.sqlite\.vor-restore/)).toBeTruthy()
  expect(within(dialog).getByText(/a\.pdf/)).toBeTruthy()
  expect(within(dialog).getByText(/aus dem Papierkorb zurück/)).toBeTruthy()
  expect(within(dialog).getByText(/die Abfrage nach Updates/)).toBeTruthy()
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Abbrechen'))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zurückkehren' }))
  await waitFor(() => expect(reloads).toBe(1))
  expect(posts()).toEqual(['/api/prior-versions/vorversion-2026-10-20-081500.sqlite/restore/preview', '/api/prior-versions/vorversion-2026-10-20-081500.sqlite/restore'])
  expect(sent.find((s) => s.url.endsWith('/restore'))?.body).toEqual({ token: 'marke-s' })
  // Nach dem Neuladen stehen die Hinweise einmal da.
  cleanup()
  page()
  expect(await screen.findByText(/fehlt unter „Belege“/)).toBeTruthy()
  cleanup()
  page()
  await screen.findByText('Wöchentliche Sicherung')
  expect(screen.queryByText(/fehlt unter „Belege“/)).toBeNull()
})

test('Abbrechen schickt nichts außer der Vorschau', async () => {
  page()
  const row = (await screen.findByText('Wöchentliche Sicherung')).closest('[data-snapshot]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Zu diesem Stand zurückkehren …' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(posts()).toEqual(['/api/prior-versions/vorversion-2026-10-20-081500.sqlite/restore/preview'])
  expect(reloads).toBe(0)
})

test('Eine Grenze der Vorschau steht an der Zeile, ohne Rückfrage; eine Ablehnung beim Einspielen als Mitteilung', async () => {
  previewBody = snapshotPreview({ refusals: ['Die Datenbank in dieser Sicherung ist beschädigt.'] })
  page()
  const row = (await screen.findByText('Wöchentliche Sicherung')).closest('[data-snapshot]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Zu diesem Stand zurückkehren …' }))
  expect(await within(row).findByText(/ist beschädigt/)).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()

  previewBody = snapshotPreview()
  restoreAnswer = { status: 409, body: { error: 'Die Sicherung oder der Verlauf hat sich inzwischen geändert.', preview: snapshotPreview() } }
  fireEvent.click(within(row).getByRole('button', { name: 'Zu diesem Stand zurückkehren …' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zurückkehren' }))
  expect(await screen.findByText(/hat sich inzwischen geändert/)).toBeTruthy()
  expect(reloads).toBe(0)
})

test('Ein nur lesbarer Eintrag bietet den Rücksprung an; geht er nur über eine Sicherung, sagt die Rückfrage das', async () => {
  previewBody = snapshotPreview({
    entry: { id: 5, firstId: 5, at: '2026-09-01T10:00:00.000Z', title: 'Wohnung angelegt: alt' }, mode: 'after',
    reasons: ['Im Bereich liegen Änderungen von vor dem letzten Update von Mietfuchs.'],
    snapshot: point({ name: 'mietfuchs.sqlite.vor-0075_verlauf_ruecksprung', type: 'update', title: 'Vor dem Update auf Version 0.13.0' }),
  })
  page()
  const summary = await screen.findByText('Wohnung angelegt: alt')
  const details = summary.closest('details') as HTMLDetailsElement
  details.open = true
  fireEvent(details, new Event('toggle'))
  fireEvent.click(within(details).getByRole('button', { name: 'Nur die späteren Änderungen zurücknehmen …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/^Zum Stand nach „Wohnung angelegt: alt“/)).toBeTruthy()
  expect(within(dialog).getByText(/nur über die Sicherung „Vor dem Update auf Version 0\.13\.0“/)).toBeTruthy()
  expect(within(dialog).getByText(/vor dem letzten Update/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zurückkehren' }))
  await waitFor(() => expect(reloads).toBe(1))
  expect(posts()).toEqual(['/api/journal/5/revert/preview', '/api/prior-versions/mietfuchs.sqlite.vor-0075_verlauf_ruecksprung/restore'])
})
