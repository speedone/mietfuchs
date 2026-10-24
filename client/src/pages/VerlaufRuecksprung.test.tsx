// @vitest-environment jsdom
// Die Seite „Verlauf“ mit Filtern und Rücksprung (#318, Schritt 4).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Verlauf from './Verlauf'
import { UIProvider } from '../components/feedback'
import type { JournalDetail, JournalGroup } from '../journalView'
import type { RevertPreview } from '../journalRevert'

const group = (id: number, title: string, extra: Partial<JournalGroup> = {}): JournalGroup => ({
  id, firstId: id, at: '2026-10-24T08:15:00.000Z', method: 'PUT', route: '/api/units/:id', description: title, title, propertyIds: ['objekt-1'],
  installationWide: false, rows: 1, revertedBy: null, barrier: null, readOnly: false, ...extra,
})
const preview = (over: Partial<RevertPreview> = {}): RevertPreview => ({
  kind: 'journal', mode: 'including', entry: { id: 9, firstId: 9, at: '2026-10-24T08:15:00.000Z', title: 'Wohnung geändert: EG' }, startId: 9,
  entries: [{ id: 9, at: '2026-10-24T08:15:00.000Z', title: 'Wohnung geändert: EG', rows: 1, reverted: false }], changes: 1, refusals: [],
  files: { restore: 0, trash: 0 }, token: 'marke-1', ...over,
})

type Sent = { url: string, method: string, body: unknown }
let sent: Sent[]
let listed: JournalGroup[]
let previewBody: RevertPreview
let revertStatus: number
beforeEach(() => {
  sent = []
  listed = [group(9, 'Wohnung geändert: EG'), group(8, 'Wohnung angelegt: EG')]
  previewBody = preview()
  revertStatus = 200
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ url, method: init?.method ?? 'GET', body })
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/revert/preview')) return reply(previewBody)
    if (url.endsWith('/revert')) return revertStatus === 200 ? reply({ ok: true }) : reply({ error: 'Der Verlauf hat sich inzwischen geändert.', preview: { ...previewBody, refusals: ['Neu: etwas im Weg.'] } }, revertStatus)
    if (/^\/api\/journal\/\d+$/.test(url)) return reply({ ...listed[0], changes: [] } satisfies JournalDetail)
    return reply(listed)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = async (title: string) => {
  const summary = await screen.findByText(title)
  const details = summary.closest('details')
  if (!details) throw new Error('kein details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  return details
}
const lists = () => sent.filter((s) => s.method === 'GET' && s.url.startsWith('/api/journal?'))

test('Rückgängig am obersten Eintrag: Vorschau, Rückfrage, Rücksprung mit der Marke, Mitteilung, neu geladen', async () => {
  render(<UIProvider><Verlauf /></UIProvider>)
  const top = await open('Wohnung geändert: EG')
  // Am obersten Eintrag nur „Rückgängig …“, nicht „Nur die späteren …“.
  expect(within(top).queryByRole('button', { name: /Nur die späteren/ })).toBeNull()
  fireEvent.click(within(top).getByRole('button', { name: 'Rückgängig …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('„Wohnung geändert: EG“ rückgängig machen?')).toBeTruthy()
  expect(within(dialog).getByText(/lässt sich dort genauso zurücknehmen/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rückgängig machen' }))
  await waitFor(() => expect(sent.some((s) => s.url === '/api/journal/9/revert')).toBe(true))
  expect(sent.find((s) => s.url === '/api/journal/9/revert')?.body).toEqual({ mode: 'including', token: 'marke-1' })
  expect(await screen.findByText('Rückgängig gemacht: „Wohnung geändert: EG“.')).toBeTruthy()
  await waitFor(() => expect(lists().length).toBe(2))
})

test('Ältere Einträge: zwei Knöpfe, „Stand nach“ fragt mit der Liste der späteren Einträge', async () => {
  previewBody = preview({
    mode: 'after', entry: { id: 8, firstId: 8, at: '2026-10-24T08:15:00.000Z', title: 'Wohnung angelegt: EG' }, startId: 9,
    entries: Array.from({ length: 10 }, (_, i) => ({ id: 20 - i, at: '2026-10-24T09:00:00.000Z', title: `Eintrag ${i}`, rows: 2, reverted: i === 1 })), changes: 20,
    files: { restore: 1, trash: 0 },
  })
  render(<UIProvider><Verlauf /></UIProvider>)
  const older = await open('Wohnung angelegt: EG')
  expect(within(older).getByRole('button', { name: 'Diese und alle späteren Änderungen zurücknehmen …' })).toBeTruthy()
  fireEvent.click(within(older).getByRole('button', { name: 'Nur die späteren Änderungen zurücknehmen …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/^Zum Stand nach „Wohnung angelegt: EG“/)).toBeTruthy()
  expect(within(dialog).getByText(/10 Einträge mit zusammen 20 Änderungen/)).toBeTruthy()
  expect(within(dialog).getByText(/Eintrag 1 \(zurückgenommen\)/)).toBeTruthy()
  expect(within(dialog).getByText('und 2 weitere')).toBeTruthy()
  expect(within(dialog).getByText('Ein Beleg oder Logo kommt aus dem Papierkorb zurück.')).toBeTruthy()
  // Abbrechen schreibt nichts.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(sent.some((s) => s.url.endsWith('/revert'))).toBe(false)
  expect(sent.find((s) => s.url.endsWith('/revert/preview'))?.body).toEqual({ mode: 'after' })
})

test('Eine Grenze steht am Eintrag, ohne Rückfrage', async () => {
  previewBody = preview({ refusals: ['„Abrechnung abgeschlossen: 2025-01“ vom 24.10.2026, 10:15 schließt eine Abrechnung ab.'] })
  render(<UIProvider><Verlauf /></UIProvider>)
  const top = await open('Wohnung geändert: EG')
  fireEvent.click(within(top).getByRole('button', { name: 'Rückgängig …' }))
  expect(await within(top).findByText(/schließt eine Abrechnung ab/)).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Hat sich der Verlauf inzwischen geändert, sagt es die Mitteilung, und die Liste lädt neu', async () => {
  revertStatus = 409
  render(<UIProvider><Verlauf /></UIProvider>)
  const top = await open('Wohnung geändert: EG')
  fireEvent.click(within(top).getByRole('button', { name: 'Rückgängig …' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rückgängig machen' }))
  expect(await screen.findByText('Der Verlauf hat sich inzwischen geändert.')).toBeTruthy()
  await waitFor(() => expect(lists().length).toBe(2))
})

test('Nur lesbare Einträge und Schranken haben keine Knöpfe, zurückgenommene sind gekennzeichnet', async () => {
  listed = [
    group(12, 'Rückgängig: Wohnung geändert: EG'),
    group(11, 'Wohnung geändert: EG', { revertedBy: 12 }),
    group(10, 'Backup eingespielt', { barrier: 'restore', readOnly: true, rows: 0 }),
    group(5, 'Wohnung angelegt: alt', { readOnly: true }),
  ]
  render(<UIProvider><Verlauf /></UIProvider>)
  expect(await screen.findByText('· zurückgenommen')).toBeTruthy()
  const barrier = await open('Backup eingespielt')
  expect(within(barrier).queryAllByRole('button')).toEqual([])
  expect(within(barrier).getByText(/kein Rücksprung/)).toBeTruthy()
  const old = await open('Wohnung angelegt: alt')
  expect(within(old).queryAllByRole('button')).toEqual([])
  expect(within(old).getByText(/nur lesen/)).toBeTruthy()
})

test('Filter: Bereich, Zeitraum und Suche gehen an den Server; mit Filter gibt es kein „Rückgängig“', async () => {
  render(<UIProvider><Verlauf /></UIProvider>)
  await screen.findByText('Wohnung geändert: EG')
  fireEvent.change(screen.getByLabelText('Bereich'), { target: { value: 'payments' } })
  await waitFor(() => expect(lists().at(-1)?.url).toBe('/api/journal?limit=50&kind=payments'))
  fireEvent.change(screen.getByLabelText('Von'), { target: { value: '2026-10-01' } })
  await waitFor(() => expect(lists().at(-1)?.url).toMatch(/&from=2026-(09-30T2|10-01T0)/))
  fireEvent.change(screen.getByLabelText(/^Suche/), { target: { value: 'Müller' } })
  await waitFor(() => expect(lists().at(-1)?.url).toMatch(/&q=M%C3%BCller$/))
  // Die Bereiche stehen alle zur Wahl, der gewählte ist sichtbar.
  const kind = screen.getByLabelText('Bereich') as HTMLSelectElement
  expect(kind.value).toBe('payments')
  expect([...kind.options].map((o) => o.text)).toContain('Heizung')
  const top = await open('Wohnung geändert: EG')
  expect(within(top).queryByRole('button', { name: 'Rückgängig …' })).toBeNull()
  expect(within(top).getByRole('button', { name: /Diese und alle späteren/ })).toBeTruthy()
})
