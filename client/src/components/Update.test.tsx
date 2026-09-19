// @vitest-environment jsdom
// Komponententests des Update-Hinweises. Wann was erscheint, prüft update.test.ts. Hier geht
// es darum, dass die Knöpfe das Richtige an den Server schicken, die Anleitung zum System
// passt und Fehler sichtbar werden.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { UIProvider } from './feedback'
import { UpdateConsent, UpdateHint, UpdateSettings, useUpdateStatus } from './Update'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: '', ollamaModel: '', ...patch,
})

const download = (datei: string) => `https://github.com/speedone/mietfuchs/releases/download/v0.5.0/${datei}`

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true, current: '0.4.0', mode: 'binary', latest: '0.5.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
  downloadUrl: download('mietfuchs-win.exe'),
  checkedAt: '2026-09-19T08:00:00.000Z', error: null, ...patch,
})

let anfragen: { url: string; method: string; body: unknown }[]
let antwort: UpdateStatus
let kaputt: string[] // Adressen, die mit 500 antworten
let bremse: Record<string, Promise<void>> // 'GET /api/update' → Antwort erst, wenn erfüllt

beforeEach(() => {
  anfragen = []
  antwort = status()
  kaputt = []
  bremse = {}
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    anfragen.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = url.startsWith('/api/update') ? antwort : { ok: true } // Stand beim Absenden
    await bremse[`${method} ${url}`]
    if (kaputt.includes(url)) {
      return new Response(JSON.stringify({ error: 'Server nicht erreichbar' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------- Einwilligung ----------

test('Einwilligung: „Ja" speichert die Zustimmung', async () => {
  const beantwortet = vi.fn()
  render(<UpdateConsent onAnswered={beantwortet} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Bescheid geben' }))
  await waitFor(() => expect(beantwortet).toHaveBeenCalled())
  expect(anfragen).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateCheck: 'on' } }])
})

test('Einwilligung: „Nein" speichert die Ablehnung und fragt nichts weiter ab', async () => {
  const beantwortet = vi.fn()
  render(<UpdateConsent onAnswered={beantwortet} />)
  fireEvent.click(screen.getByRole('button', { name: 'Nein, danke' }))
  await waitFor(() => expect(beantwortet).toHaveBeenCalled())
  expect(anfragen).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateCheck: 'off' } }])
})

test('Einwilligung: scheitert das Speichern, sagt Mietfuchs es und fragt weiter', async () => {
  kaputt = ['/api/settings']
  const beantwortet = vi.fn()
  render(<UIProvider><UpdateConsent onAnswered={beantwortet} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Bescheid geben' }))
  await waitFor(() => expect(screen.getByText(/ließ sich nicht speichern/)).toBeTruthy())
  expect(beantwortet).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Ja, Bescheid geben' }) as HTMLButtonElement).disabled).toBe(false)
})

// ---------- Stand vom Server ----------

test('Status wird erst nach dem Laden der Einstellungen geholt und nach einer Antwort neu', async () => {
  const { result, rerender } = renderHook(({ s }) => useUpdateStatus(s), {
    initialProps: { s: null as Settings | null },
  })
  expect(anfragen).toHaveLength(0)

  rerender({ s: settings() })
  await waitFor(() => expect(result.current.status).not.toBeNull())

  // Nach der Zustimmung muss der Hinweis ohne Neuladen der Seite erscheinen können.
  rerender({ s: settings({ updateCheck: 'on' }) })
  await waitFor(() => expect(anfragen.filter((a) => a.url === '/api/update')).toHaveLength(2))
})

test('Eine langsame ältere Antwort überschreibt keine neuere', async () => {
  // Beim Öffnen läuft GET /api/update. Kommt „Jetzt prüfen" früher zurück, gilt dessen Stand.
  let loslassen!: () => void
  bremse['GET /api/update'] = new Promise((r) => { loslassen = r })
  const { result } = renderHook(() => useUpdateStatus(settings({ updateCheck: 'on' })))
  await waitFor(() => expect(anfragen).toHaveLength(1))

  antwort = status({ latest: '0.6.0' })
  await act(() => result.current.checkNow())
  expect(result.current.status?.latest).toBe('0.6.0')

  await act(async () => { loslassen(); await new Promise((r) => setTimeout(r, 20)) })
  expect(result.current.status?.latest).toBe('0.6.0')
})

// ---------- Hinweis in der Seitenleiste ----------

test('Hinweis führt bei jeder Betriebsart zur Anleitung, nicht direkt zum Download', () => {
  // Wer die neue Datei aus dem Download-Ordner startet, sieht einen leeren Datenordner und
  // hält seine Daten für verloren. Deshalb erst die Anleitung.
  for (const mode of ['binary', 'docker', 'npm'] as const) {
    const zurAnleitung = vi.fn()
    render(<UpdateHint status={status({ mode })} onDismissed={vi.fn()} onShowGuide={zurAnleitung} />)
    expect(screen.getByText('Version 0.5.0 ist da')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Herunterladen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'So aktualisierst du' }))
    expect(zurAnleitung).toHaveBeenCalled()
    const neu = screen.getByRole('link', { name: 'Was ist neu?' })
    expect(neu.getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
    expect(neu.getAttribute('target')).toBe('_blank')
    cleanup()
  }
})

test('„Später" merkt sich genau diese Version', async () => {
  const ausgeblendet = vi.fn()
  render(<UpdateHint status={status()} onDismissed={ausgeblendet} onShowGuide={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(ausgeblendet).toHaveBeenCalled())
  expect(anfragen).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateDismissed: '0.5.0' } }])
})

// ---------- Karte in den Einstellungen ----------

function Karte({ s, reload = vi.fn() }: { s: Settings; reload?: () => Promise<void> }) {
  const update = useUpdateStatus(s)
  return <UIProvider><UpdateSettings settings={s} update={update} reload={reload} /></UIProvider>
}

test('Einstellungen: ohne Zustimmung nur die installierte Version, Prüfen ist gesperrt', async () => {
  antwort = status({ enabled: false, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null })
  render(<Karte s={settings({ updateCheck: 'off' })} />)
  await waitFor(() => expect(screen.getByText(/Installiert ist Version 0\.4\.0/)).toBeTruthy())
  expect((screen.getByLabelText(/nach neuen Versionen schauen/i) as HTMLInputElement).checked).toBe(false)
  expect((screen.getByRole('button', { name: 'Jetzt prüfen' }) as HTMLButtonElement).disabled).toBe(true)
})

test('Einstellungen: Häkchen schaltet die Prüfung ein und aus', async () => {
  const reload = vi.fn(async () => {})
  render(<Karte s={settings({ updateCheck: 'on' })} reload={reload} />)
  fireEvent.click(screen.getByLabelText(/nach neuen Versionen schauen/i))
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(anfragen).toContainEqual({ url: '/api/settings', method: 'PUT', body: { updateCheck: 'off' } })
})

test('Einstellungen: Windows-Programmdatei wird im bisherigen Ordner ersetzt', async () => {
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  const link = await waitFor(() => screen.getByRole('link', { name: 'Version 0.5.0 herunterladen' }))
  expect(link.getAttribute('href')).toBe(download('mietfuchs-win.exe'))
  expect(link.getAttribute('target')).toBeNull() // ein Download verlässt die Seite nicht
  expect(screen.getByText(/im selben Ordner wie bisher/)).toBeTruthy() // dort liegt der Ordner data
})

test('Einstellungen: macOS und Linux müssen erst entpacken', async () => {
  antwort = status({ downloadUrl: download('mietfuchs-macos-apple-silicon.zip') })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Zip-Datei/)).toBeTruthy())
  expect(screen.getByText(/blockiert macOS/)).toBeTruthy()
  cleanup()

  antwort = status({ downloadUrl: download('mietfuchs-linux.tar.gz') })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('tar -xzf mietfuchs-linux.tar.gz')).toBeTruthy())
  expect(screen.getByText('./mietfuchs-linux')).toBeTruthy()
})

test('Einstellungen: die Anleitung nennt die Datei für ARM, nicht die für x64 (#22)', async () => {
  antwort = status({ downloadUrl: download('mietfuchs-linux-arm64.tar.gz') })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('tar -xzf mietfuchs-linux-arm64.tar.gz')).toBeTruthy())
  expect(screen.getByText('./mietfuchs-linux-arm64')).toBeTruthy()
  cleanup()

  antwort = status({ downloadUrl: download('mietfuchs-win-arm64.exe') })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('mietfuchs-win-arm64.exe')).toBeTruthy())
})

test('Einstellungen: ohne passende Datei öffnet die Release-Seite in neuem Tab', async () => {
  antwort = status({ downloadUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0' })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  const link = await waitFor(() => screen.getByRole('link', { name: 'Zur Release-Seite' }))
  expect(link.getAttribute('target')).toBe('_blank')
})

test('Einstellungen: „Jetzt prüfen" fragt neu an und zeigt die Befehle für Docker', async () => {
  antwort = status({ available: false, latest: '0.4.0', mode: 'docker', downloadUrl: null })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/aktuelle Version/)).toBeTruthy())

  antwort = status({ mode: 'docker', downloadUrl: null })
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(screen.getByText('docker compose pull')).toBeTruthy())
  expect(screen.getByText('docker compose up -d')).toBeTruthy()
  expect(anfragen).toContainEqual({ url: '/api/update/check', method: 'POST', body: undefined })

  const kopiert = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText: kopiert } })
  fireEvent.click(screen.getByRole('button', { name: 'Befehle kopieren' }))
  expect(kopiert).toHaveBeenCalledWith('docker compose pull\ndocker compose up -d')
})

test('Einstellungen: ist der Mietfuchs-Server nicht erreichbar, erscheint eine Meldung', async () => {
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Version 0\.5\.0 ist erschienen/)).toBeTruthy())
  kaputt = ['/api/update/check']
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(screen.getByText(/Prüfen ging nicht/)).toBeTruthy())
})

test('Einstellungen: eine fehlgeschlagene Prüfung bei GitHub wird genannt', async () => {
  antwort = status({ latest: null, available: false, releaseUrl: null, downloadUrl: null, error: 'GitHub ist nicht erreichbar.' })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/GitHub ist nicht erreichbar\./)).toBeTruthy())
})
