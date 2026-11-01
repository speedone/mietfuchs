// @vitest-environment jsdom
// „Ihre bisherigen Daten übernehmen“ (#517): Funde, das noch offene alte Mietfuchs, Backup, Ordnerwahl und Neuanfang.
// Der Server ist nachgebaut; was er prüft, steht in server/test/api-umzug.test.ts.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { UIProvider } from '../components/feedback'
import type { RelocationCandidate, RelocationCandidates } from '../relocation'
import Umzug from './Umzug'

vi.setConfig({ testTimeout: 20000 })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FOUND: RelocationCandidate = {
  dataDir: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', kind: 'database', modifiedAt: '2026-10-12T09:30:00.000Z',
  properties: 1, tenancies: 5, running: false, source: 'search', appVersion: null,
}

type Call = { url: string, method: string, body: unknown }
function fakeServer(answers: Record<string, (body: unknown) => { status?: number, json: unknown }>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null
    calls.push({ url, method, body })
    const answer = answers[`${method} ${url}`]
    if (!answer) return new Response('{"error":"unbekannt"}', { status: 404, headers: { 'content-type': 'application/json' } })
    const { status = 200, json } = answer(body)
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

const offer = (candidates: RelocationCandidate[], complete = true): RelocationCandidates => ({ offered: true, candidates, searched: true, complete })

function renderScreen(props: Partial<Parameters<typeof Umzug>[0]> = {}) {
  const reloadPage = vi.fn()
  const onFresh = vi.fn()
  render(<UIProvider><Umzug onFresh={onFresh} reloadPage={reloadPage} chooseFolder={null} {...props} /></UIProvider>)
  return { reloadPage, onFresh }
}

test('Fund: Ort, zuletzt geändert, Bestand; „Daten übernehmen“ kopiert und sagt, was übernommen ist', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }),
    'POST /api/relocation/adopt': () => ({ json: { ok: true, notes: [], counts: { properties: 1, tenancies: 5, costItems: 12, receipts: 3 } } }),
  })
  const { reloadPage } = renderScreen()
  expect(await screen.findByRole('heading', { level: 1, name: 'Ihre bisherigen Daten übernehmen' })).toBeTruthy()
  const card = (await screen.findByRole('heading', { name: 'Gefundene Daten' })).closest('section') as HTMLElement
  expect(within(card).getByText(FOUND.dataDir)).toBeTruthy()
  expect(within(card).getByText('Zuletzt geändert am 12. Oktober 2026')).toBeTruthy()
  expect(within(card).getByText('1 Objekt, 5 Mietverhältnisse')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByText('Übernommen: 1 Objekt, 5 Mietverhältnisse, 12 Kostenpositionen und 3 Belege.')).toBeTruthy()
  expect(calls.find((c) => c.url === '/api/relocation/adopt')?.body).toEqual({ dataDir: FOUND.dataDir })
  // Durchsicht D11: was mit dem alten Mietfuchs zu tun ist
  expect(screen.getByText(/Starten Sie das alte Mietfuchs nicht mehr/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
  expect(reloadPage).toHaveBeenCalled()
})

test('Altes Mietfuchs noch offen: erst beenden, dann übernehmen', async () => {
  let running = true
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([{ ...FOUND, running }]) }),
    'POST /api/relocation/quit-old': () => {
      running = false
      return { json: { stopped: true } }
    },
  })
  renderScreen()
  expect(await screen.findByText('Das alte Mietfuchs ist noch geöffnet')).toBeTruthy()
  const adopt = screen.getByRole('button', { name: 'Daten übernehmen' }) as HTMLButtonElement
  expect(adopt.disabled).toBe(true)
  // Der gesperrte Knopf nennt seinen Grund
  expect(adopt.getAttribute('aria-describedby')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Altes Mietfuchs beenden' }))
  await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Daten übernehmen' }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByText('Das alte Mietfuchs ist noch geöffnet')).toBeNull()
  expect(calls.filter((c) => c.url === '/api/relocation/quit-old')).toHaveLength(1)
})

test('Altes Mietfuchs lässt sich nicht beenden: Fenster selbst schließen, dann erneut prüfen', async () => {
  fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([{ ...FOUND, running: true }]) }),
    'POST /api/relocation/quit-old': () => ({ json: { stopped: false } }),
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Altes Mietfuchs beenden' }))
  // Durchsicht D9: Die Programmdatei läuft in einem eigenen Fenster (Windows: schwarz, Mac: Terminal), nicht im Browser
  expect(await screen.findByText(/Schließen Sie bitte das Fenster der alten Programmdatei \(unter Windows ein schwarzes Fenster, auf dem Mac das Terminal\)/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toBeTruthy()
})

test('Scheitert die Übernahme, steht der Grund da und der Fund bleibt', async () => {
  fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }),
    'POST /api/relocation/adopt': () => ({ status: 400, json: { error: 'Die Datenbank im alten Ordner lässt sich nicht lesen. Es wurde nichts übernommen.' } }),
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByText(/lässt sich nicht lesen/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Daten übernehmen' })).toBeTruthy()
})

test('Nichts gefunden: genau ein empfohlener Weg, das Backup', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([], false) }),
    'POST /api/restore': () => ({ json: { ok: true, notes: [] } }),
  })
  const { reloadPage } = renderScreen()
  expect(await screen.findByText(/keine Daten Ihres bisherigen Mietfuchs gefunden\. Die Suche hat nicht alle Ordner durchgesehen\./)).toBeTruthy()
  const card = screen.getByRole('heading', { name: 'Mit einem Backup übernehmen' }).closest('section') as HTMLElement
  expect(card.textContent).toContain('Öffnen Sie Ihr bisheriges Mietfuchs noch einmal und klicken Sie in den Einstellungen auf Backup herunterladen. Ziehen Sie die Datei dann hierher oder klicken Sie auf Backup einspielen.')
  // Ohne Brücke des Fensters keine Ordnerwahl
  expect(screen.queryByRole('button', { name: 'Ordner der alten Programmdatei wählen …' })).toBeNull()
  const input = within(card).getByLabelText('Backup einspielen') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['zip'], 'mietfuchs-backup.zip', { type: 'application/zip' })] } })
  await vi.waitFor(() => expect(reloadPage).toHaveBeenCalled())
  expect(calls.find((c) => c.url === '/api/restore')?.method).toBe('POST')
})

test('Ordner wählen: über den Dialog des Fensters, dann wie ein Fund', async () => {
  fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'POST /api/relocation/inspect': (body) => ({ json: { candidate: { ...FOUND, dataDir: `${(body as { folder: string }).folder}\\data`, source: 'chosen' } } }),
  })
  const chooseFolder = vi.fn(async () => 'D:\\Vermietung')
  renderScreen({ chooseFolder })
  fireEvent.click(await screen.findByRole('button', { name: 'Ordner der alten Programmdatei wählen …' }))
  expect(await screen.findByText('D:\\Vermietung\\data')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Daten übernehmen' })).toBeTruthy()
})

test('Neu anfangen: erst nach Rückfrage', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'POST /api/relocation/decline': () => ({ json: { ok: true } }),
  })
  const { onFresh } = renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Neu anfangen …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Ohne Ihre bisherigen Daten anfangen?')).toBeTruthy()
  expect(calls.some((c) => c.url === '/api/relocation/decline')).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Neu anfangen' }))
  await vi.waitFor(() => expect(onFresh).toHaveBeenCalled())
})

test('Gefunden, aber nicht die richtigen: andere Wege und zurück', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }) })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Andere Wege zeigen' }))
  expect(screen.getByRole('heading', { name: 'Mit einem Backup übernehmen' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Zurück zu den gefundenen Daten' }))
  expect(screen.getByRole('heading', { name: 'Gefundene Daten' })).toBeTruthy()
})
