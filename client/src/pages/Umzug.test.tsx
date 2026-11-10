// @vitest-environment jsdom
// „Ihre bisherigen Daten übernehmen“ (#517): Funde, das noch offene alte Mietfuchs, Backup, Ordnerwahl und Neuanfang.
// Der Server ist nachgebaut; was er prüft, steht in server/test/api-umzug.test.ts.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { UIProvider } from '../components/feedback'
import type { RelocationCandidate, RelocationCandidates } from '../relocation'
import Umzug from './Umzug'
import { MOBILE_QUERY } from '../components/MobileNav'
import { RELEASES_URL } from '../update'

vi.setConfig({ testTimeout: 20000 })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FOUND: RelocationCandidate = {
  id: '3f2c8a50-0000-4000-8000-000000000001',
  dataDir: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', kind: 'database', modifiedAt: '2026-10-12T09:30:00.000Z',
  properties: 1, tenancies: 5, running: false, source: 'search', appVersion: null,
  names: ['Haus am Weg'], problem: null, priorVersions: 0, place: { folder: 'mietfuchs', within: 'Downloads' },
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
  expect(await screen.findByRole('heading', { level: 1, name: 'Wir haben Ihre bisherigen Mietfuchs-Daten gefunden' })).toBeTruthy()
  const card = (await screen.findByRole('heading', { name: 'Gefundene Daten' })).closest('section') as HTMLElement
  expect(within(card).getByText(FOUND.dataDir)).toBeTruthy()
  expect(within(card).getByText('Zuletzt geändert am 12. Oktober 2026')).toBeTruthy()
  expect(within(card).getByText('1 Objekt, 5 Mietverhältnisse')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByText('Übernommen: 1 Objekt, 5 Mietverhältnisse, 12 Kostenpositionen und 3 Belege.')).toBeTruthy()
  // Mit der Kennung des Fundes, nie mit dem Pfad (K11)
  expect(calls.find((c) => c.url === '/api/relocation/adopt')?.body).toEqual({ id: FOUND.id })
  // Durchsicht D11: was mit dem alten Mietfuchs zu tun ist
  expect(screen.getByText(/Öffnen Sie die alte Programmdatei nicht mehr/)).toBeTruthy()
  // Ergänzung 3: Wer vom Handy zugriff, findet den Weg dorthin
  expect(screen.getByText(/Zugriff aus dem Heimnetz/).textContent).toMatch(/Handy.*Einstellungen.*neue Adresse/)
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
  // Praxistest B-04: Der Anlass reist über das Neuladen, danach die Bestätigung im richtigen Jahr
  expect(reloadPage).toHaveBeenCalledWith('moved')
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
  expect(await screen.findByRole('heading', { level: 1, name: 'Willkommen bei Mietfuchs' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Daten übernehmen' }))
  expect(await screen.findByText(/keine Daten Ihres bisherigen Mietfuchs gefunden\. Die Suche hat nicht alle Ordner durchgesehen\./)).toBeTruthy()
  const card = screen.getByRole('heading', { name: 'Mit einem Backup übernehmen' }).closest('section') as HTMLElement
  expect(card.textContent).toContain('Öffnen Sie Ihr bisheriges Mietfuchs noch einmal und klicken Sie in den Einstellungen auf Backup herunterladen (ZIP). Ziehen Sie die Datei dann hierher oder klicken Sie auf Backup einspielen.')
  // Ohne Brücke des Fensters keine Ordnerwahl
  expect(screen.queryByRole('button', { name: 'Ordner der alten Programmdatei wählen …' })).toBeNull()
  const input = within(card).getByLabelText('Backup einspielen') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['zip'], 'mietfuchs-backup.zip', { type: 'application/zip' })] } })
  await vi.waitFor(() => expect(reloadPage).toHaveBeenCalledWith('backup'))
  expect(calls.find((c) => c.url === '/api/restore')?.method).toBe('POST')
})

test('Ordner wählen: über den Dialog des Fensters, dann wie ein Fund', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'POST /api/relocation/inspect': (body) => ({ json: { candidate: { ...FOUND, id: 'gewaehlt-1', dataDir: `${(body as { folder: string }).folder}\\data`, source: 'chosen' } } }),
    'POST /api/relocation/adopt': () => ({ json: { ok: true, notes: [], counts: { properties: 1, tenancies: 5, costItems: 12, receipts: 3 } } }),
  })
  const chooseFolder = vi.fn(async () => 'D:\\Vermietung')
  renderScreen({ chooseFolder })
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, Daten übernehmen' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ordner der alten Programmdatei wählen …' }))
  expect(await screen.findByText('D:\\Vermietung\\data')).toBeTruthy()
  // Der Pfad des Dialogs geht nur an `/inspect`; übernommen wird mit der Kennung, die der Server dafür nennt (K11)
  fireEvent.click(screen.getByRole('button', { name: 'Daten übernehmen' }))
  await vi.waitFor(() => expect(calls.find((c) => c.url === '/api/relocation/adopt')?.body).toEqual({ id: 'gewaehlt-1' }))
})

test('Gefunden: „Nicht übernehmen, neu beginnen“ erst nach Rückfrage', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }),
    'POST /api/relocation/decline': () => ({ json: { ok: true } }),
  })
  const { onFresh } = renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Nicht übernehmen, neu beginnen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Ohne Ihre bisherigen Daten beginnen?')).toBeTruthy()
  expect(calls.some((c) => c.url === '/api/relocation/decline')).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Neu beginnen' }))
  await vi.waitFor(() => expect(onFresh).toHaveBeenCalled())
})

test('Nichts gefunden: Willkommen, „Nein, neu beginnen“ geht sofort los, ohne Rückfrage', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'POST /api/relocation/decline': () => ({ json: { ok: true } }),
  })
  const { onFresh } = renderScreen()
  expect(await screen.findByText('Haben Sie Mietfuchs schon einmal benutzt?')).toBeTruthy()
  // Zwei gleichwertige Knöpfe
  const no = screen.getByRole('button', { name: 'Nein, neu beginnen' })
  const yes = screen.getByRole('button', { name: 'Ja, Daten übernehmen' })
  expect(no.className).toBe(yes.className)
  fireEvent.click(no)
  await vi.waitFor(() => expect(onFresh).toHaveBeenCalled())
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(calls.some((c) => c.url === '/api/relocation/decline')).toBe(true)
})

test('Von Hand mit eigenem Bestand: erst deutlich fragen, dann mit replace übernehmen', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: { ...offer([FOUND]), offered: false, ownStock: true } }),
    'POST /api/relocation/adopt': () => ({ json: { ok: true, notes: [], counts: { properties: 1, tenancies: 5, costItems: 1, receipts: 0 } } }),
  })
  const onClose = vi.fn()
  render(<UIProvider><Umzug manual onClose={onClose} reloadPage={vi.fn()} chooseFolder={null} /></UIProvider>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Daten aus bisherigem Mietfuchs übernehmen' })).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten übernehmen' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/ersetzt sie vollständig.*sichert den Stand von jetzt/)
  expect(calls.some((c) => c.url === '/api/relocation/adopt')).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }))
  await screen.findByText(/Übernommen:/)
  expect(calls.find((c) => c.url === '/api/relocation/adopt')?.body).toEqual({ id: FOUND.id, replace: true })
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
})

test('Gefunden, aber nicht die richtigen: andere Wege und zurück', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }) })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Andere Daten wählen …' }))
  expect(screen.getByRole('heading', { name: 'Mit einem Backup übernehmen' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Zurück zu den gefundenen Daten' }))
  expect(screen.getByRole('heading', { name: 'Gefundene Daten' })).toBeTruthy()
})

// Ergänzung 4: Fortschritt beim Kopieren und Abbrechen
test('Großer Bestand: Fortschritt in Dateien und MB, Abbrechen', async () => {
  let release: (r: Response) => void = () => {}
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/relocation/candidates') return json(offer([FOUND]))
    if (url === '/api/relocation/progress') return json({ phase: 'copy', files: 12, totalFiles: 340, bytes: 120 * 1024 ** 2, totalBytes: 900 * 1024 ** 2 })
    if (url === '/api/relocation/cancel') {
      release(json({ error: 'Die Übernahme wurde abgebrochen. Es wurde nichts übernommen.' }, 400))
      return json({ ok: true })
    }
    if (url === '/api/relocation/adopt') return new Promise<Response>((resolve) => { release = resolve })
    return json({}, 404)
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByText('12 von 340 Dateien kopiert (120 von 900 MB)', {}, { timeout: 5000 })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByText(/abgebrochen/)).toBeTruthy()
  expect(calls).toContain('POST /api/relocation/cancel')
})

// Ergänzung: Wer im Dialog statt eines Ordners ein Backup wählt, bekommt es eingespielt statt abgelehnt
test('Ordner wählen: ein gewähltes Backup wird eingespielt', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'POST /api/relocation/inspect': () => ({ json: { backup: { id: 'b-1', name: 'mietfuchs-backup.zip' } } }),
    'POST /api/relocation/restore-backup': () => ({ json: { ok: true, notes: [] } }),
  })
  const { reloadPage } = renderScreen({ chooseFolder: async () => 'D:\\Sicherung\\mietfuchs-backup.zip' })
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, Daten übernehmen' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ordner der alten Programmdatei wählen …' }))
  await vi.waitFor(() => expect(reloadPage).toHaveBeenCalled())
  expect(calls.find((c) => c.url === '/api/relocation/restore-backup')?.body).toEqual({ id: 'b-1' })
})

// Ergänzung: Die Anleitung nennt den Knopf, wie er in jeder Fassung hieß. Von 0.1.0 bis 0.14.1 stand in den
// Einstellungen „⬇ Backup herunterladen (ZIP)“ (geprüft an den Tags); der Knopf von heute heißt noch genauso.
test('Anleitung: derselbe Knopf wie in den Einstellungen aller Fassungen', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([]) }) })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, Daten übernehmen' }))
  const card = (await screen.findByRole('heading', { name: 'Mit einem Backup übernehmen' })).closest('section') as HTMLElement
  expect(card.textContent).toContain('klicken Sie in den Einstellungen auf Backup herunterladen (ZIP)')
  const settings = (await import('./Einstellungen.tsx?raw')).default
  expect(settings).toContain('⬇ Backup herunterladen (ZIP)')
})

// ---------- Praxistest vor 0.15.0 ----------

const cardOf = async (name: string) => (await screen.findByRole('heading', { name })).closest('section') as HTMLElement

test('Praxistest B-01: Ort in Worten mit Objektnamen, der volle Pfad nur unter „Genauer Ort“', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }) })
  renderScreen()
  const card = await cardOf('Gefundene Daten')
  expect(within(card).getByText('Ordner „mietfuchs“ in Downloads')).toBeTruthy()
  expect(within(card).getByText('Haus am Weg')).toBeTruthy()
  const details = card.querySelector('details') as HTMLDetailsElement
  expect(details.querySelector('summary')?.textContent).toBe('Genauer Ort')
  expect(details.textContent).toContain(FOUND.dataDir)
  expect(screen.getByText('Mietfuchs kopiert sie in das neue Programm; im alten Ordner bleibt alles, wie es ist.')).toBeTruthy()
})

test('Praxistest B-03, Punkt 6: Erfolgsseite „Ihre Daten sind umgezogen“, ohne langen Pfad, laienverständlich', async () => {
  fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }),
    'POST /api/relocation/adopt': () => ({ json: { ok: true, notes: ['Ältere Sicherungen bleiben im alten Ordner. Behalten Sie diesen Ordner deshalb noch eine Weile; löschen können Sie die alte Programmdatei und ihre Verknüpfung.'], counts: { properties: 1, tenancies: 2, costItems: 2, receipts: 2 } } }),
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Ihre Daten sind umgezogen' })).toBeTruthy()
  expect(screen.getByText(/Ältere Sicherungen bleiben im alten Ordner\./)).toBeTruthy()
  expect(screen.getByText(/Öffnen Sie die alte Programmdatei nicht mehr\./)).toBeTruthy()
  expect(screen.getByText(/Schalten Sie dazu in den Einstellungen „Zugriff aus dem Heimnetz“ ein\./)).toBeTruthy()
  expect(document.body.textContent).not.toContain(FOUND.dataDir)
})

test('Praxistest D: mehrere Funde, der neueste oben hervorgehoben, ältere zurückhaltend', async () => {
  const older = { ...FOUND, id: 'alt', dataDir: 'C:\\Users\\Anna\\Desktop\\mietfuchs-0.9.0\\data', modifiedAt: '2025-03-14T10:00:00.000Z', place: { folder: 'mietfuchs-0.9.0', within: 'Schreibtisch' as const } }
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([older, FOUND]) }) })
  renderScreen()
  const newest = await cardOf('Neuester Stand')
  const old = await cardOf('Älterer Stand')
  expect(screen.getByText('Meist ist der neueste Stand der richtige.')).toBeTruthy()
  // Der neueste steht zuerst
  expect(newest.compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(newest).getByText('Zuletzt geändert am 12. Oktober 2026')).toBeTruthy()
  expect(within(newest).getByRole('button', { name: 'Daten übernehmen' }).className).toBe('btn')
  expect(within(old).getByRole('button', { name: 'Diesen älteren Stand übernehmen' }).className).toContain('secondary')
  expect(newest.className).toContain('border-accent')
})

test('Praxistest J: beschädigter Fund, gesperrt, Rat zum Backup statt ins alte Mietfuchs', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([{ ...FOUND, properties: null, tenancies: null, problem: 'damaged', priorVersions: 2 }]) }) })
  renderScreen()
  const card = await cardOf('Gefundene Daten')
  expect(within(card).getByText('Beschädigt, lässt sich nicht lesen')).toBeTruthy()
  expect(card.textContent).toMatch(/An der Datei wurde nichts verändert\./)
  expect(card.textContent).toMatch(/2 automatische Vorversionen/)
  expect(card.textContent).not.toMatch(/Öffnen Sie das alte Mietfuchs/)
  const adopt = within(card).getByRole('button', { name: 'Daten übernehmen' }) as HTMLButtonElement
  expect(adopt.disabled).toBe(true)
  expect(adopt.getAttribute('aria-describedby')).toBeTruthy()
  fireEvent.click(within(card).getByRole('button', { name: 'Backup einspielen …' }))
  expect(await screen.findByRole('heading', { name: 'Mit einem Backup übernehmen' })).toBeTruthy()
})

test('Praxistest I: Fund aus einer neueren Version, vorab gesagt, mit festem Weg zur neuesten Version', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([{ ...FOUND, problem: 'newer' }]) }) })
  renderScreen()
  const card = await cardOf('Gefundene Daten')
  expect(within(card).getByText('Aus einer neueren Mietfuchs-Version')).toBeTruthy()
  expect(card.textContent).not.toMatch(/Aufbau/)
  expect((within(card).getByRole('button', { name: 'Daten übernehmen' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(card).getByRole('link', { name: 'Neueste Version herunterladen' }).getAttribute('href')).toBe(RELEASES_URL)
})

test('Praxistest G: falscher Ordner, die Absage passt zum Knopf, die zweite Absage ist solange weg; erneut suchen sagt, was geschah', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([]) }),
    'GET /api/relocation/candidates?fresh=1': () => ({ json: offer([]) }),
    'POST /api/relocation/inspect': () => ({ status: 404, json: { error: 'In diesem Ordner liegen keine Mietfuchs-Daten. Wählen Sie den Ordner, in dem Ihre alte Mietfuchs-Programmdatei liegt.' } }),
  })
  renderScreen({ chooseFolder: async () => 'C:\\Users\\Anna\\Downloads' })
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, Daten übernehmen' }))
  expect(await screen.findByText(/keine Daten Ihres bisherigen Mietfuchs gefunden/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ordner der alten Programmdatei wählen …' }))
  expect(await screen.findByText(/Wählen Sie den Ordner, in dem Ihre alte Mietfuchs-Programmdatei liegt\./)).toBeTruthy()
  expect(screen.queryByText(/keine Daten Ihres bisherigen Mietfuchs gefunden/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut suchen' }))
  expect(await screen.findByText('Mietfuchs hat eben noch einmal gesucht und wieder keine Daten gefunden.')).toBeTruthy()
  expect(calls.some((c) => c.url === '/api/relocation/candidates?fresh=1')).toBe(true)
})

test('Praxistest K-05: Abbrechen ist kein Fehler; beim Kopieren der Hinweis, Mietfuchs nicht zu schließen', async () => {
  let release: (r: Response) => void = () => {}
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/relocation/candidates') return json(offer([FOUND]))
    if (url === '/api/relocation/progress') return json({ phase: 'copy', files: 1, totalFiles: 3, bytes: 1, totalBytes: 3 })
    if (url === '/api/relocation/cancel') {
      release(json({ error: 'Die Übernahme wurde abgebrochen. Es wurde nichts übernommen.', cancelled: true }, 400))
      return json({ ok: true })
    }
    if (url === '/api/relocation/adopt') return new Promise<Response>((resolve) => { release = resolve })
    return json({}, 404)
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Daten übernehmen' }))
  expect(await screen.findByText(/Bitte schließen Sie Mietfuchs währenddessen nicht\. Ihre Daten im alten Ordner bleiben unberührt\./)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }, { timeout: 5000 }))
  expect(await screen.findByText('Abgebrochen. Es wurde nichts übernommen; im alten Ordner ist alles unverändert.')).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  expect(document.querySelector('.notice-error')).toBeNull()
})

test('Praxistest C: nach „Altes Mietfuchs beenden“ eine kurze Bestätigung', async () => {
  let running = true
  fakeServer({
    'GET /api/relocation/candidates': () => ({ json: offer([{ ...FOUND, running }]) }),
    'POST /api/relocation/quit-old': () => {
      running = false
      return { json: { stopped: true } }
    },
  })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Altes Mietfuchs beenden' }))
  expect(await screen.findByText('Das alte Mietfuchs ist beendet. Sie können die Daten jetzt übernehmen.')).toBeTruthy()
})

test('Praxistest E-02-390: am Handy kein „hierher ziehen“', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === MOBILE_QUERY, addEventListener: () => {}, removeEventListener: () => {} }))
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([]) }) })
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, Daten übernehmen' }))
  const card = await cardOf('Mit einem Backup übernehmen')
  expect(card.textContent).not.toMatch(/ziehen/i)
  expect(within(card).getByLabelText('Backup einspielen')).toBeTruthy()
})

// Durchsicht vor dem PR: Scheitert die Suche beim ersten Start, fehlte jeder Ausweg; die Navigation ist im
// Einrichtungsmodus ausgeblendet, und „Zurück“ führte nirgendwohin. Neu beginnen muss immer gehen.
test('Suche scheitert beim ersten Start: Neu beginnen bleibt möglich', async () => {
  const calls = fakeServer({
    'GET /api/relocation/candidates': () => ({ status: 500, json: { error: 'Die Suche ist fehlgeschlagen.' } }),
    'POST /api/relocation/decline': () => ({ json: { ok: true } }),
  })
  const { onFresh } = renderScreen()
  expect(await screen.findByText('Die Suche ist fehlgeschlagen.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Nein, neu beginnen' }))
  await vi.waitFor(() => expect(onFresh).toHaveBeenCalled())
  expect(calls.some((c) => c.url === '/api/relocation/decline' && c.method === 'POST')).toBe(true)
})

// Rückmeldung zur Kopplung (#528): Beim ersten Start im Programmfenster auf einem zweiten Rechner will man oft weder
// neu beginnen noch Daten übernehmen, sondern den Mietfuchs im Heimnetz öffnen. Ein dritter Weg, nur im Fenster.
test('Erster Start im Fenster: „Mit Mietfuchs im Heimnetz verbinden“ zeigt Adresse und Code', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([]) }) })
  const connect = vi.fn(async () => ({ ok: true as const }))
  const remote = { get: vi.fn(async () => ({ connected: false })), connect, disconnect: vi.fn(async () => ({})) }
  renderScreen({ remote })
  expect(await screen.findByText('Haben Sie Mietfuchs schon einmal benutzt?')).toBeTruthy()
  const pair = screen.getByRole('button', { name: 'Mit Mietfuchs im Heimnetz verbinden' })
  expect(pair.className).toBe(screen.getByRole('button', { name: 'Nein, neu beginnen' }).className)
  fireEvent.click(pair)
  expect(await screen.findByRole('heading', { level: 1, name: 'Mit Mietfuchs im Heimnetz verbinden' })).toBeTruthy()
  fireEvent.change(await screen.findByRole('textbox', { name: /Adresse/ }), { target: { value: 'nas:3001' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Code/ }), { target: { value: 'K7QM-4XPA' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
  await vi.waitFor(() => expect(connect).toHaveBeenCalledWith({ address: 'nas:3001', code: 'K7QM-4XPA' }))
})

test('Erster Start im Fenster: „Zurück“ führt vom Verbinden zur Frage', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([]) }) })
  const remote = { get: vi.fn(async () => ({ connected: false })), connect: vi.fn(), disconnect: vi.fn() }
  renderScreen({ remote })
  fireEvent.click(await screen.findByRole('button', { name: 'Mit Mietfuchs im Heimnetz verbinden' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Zurück' }))
  expect(await screen.findByText('Haben Sie Mietfuchs schon einmal benutzt?')).toBeTruthy()
})

test('Im Browser (ohne Brücke des Fensters) kein dritter Weg, auch nicht bei gefundenen Daten', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([]) }) })
  renderScreen({ remote: null })
  expect(await screen.findByText('Haben Sie Mietfuchs schon einmal benutzt?')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Heimnetz/ })).toBeNull()
})

test('Gefundene Daten im Fenster: klein „Mit Mietfuchs im Heimnetz verbinden …“', async () => {
  fakeServer({ 'GET /api/relocation/candidates': () => ({ json: offer([FOUND]) }) })
  const remote = { get: vi.fn(async () => ({ connected: false })), connect: vi.fn(), disconnect: vi.fn() }
  renderScreen({ remote })
  fireEvent.click(await screen.findByRole('button', { name: 'Mit Mietfuchs im Heimnetz verbinden …' }))
  expect(await screen.findByRole('textbox', { name: /Adresse/ })).toBeTruthy()
})
