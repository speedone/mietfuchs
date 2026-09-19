// @vitest-environment jsdom
// Komponententests des Update-Hinweises. Wann was erscheint, prüft update.test.ts. Hier geht
// es darum, dass die Knöpfe das Richtige an den Server schicken und der Download-Knopf auf
// die passende Datei zeigt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { UpdateConsent, UpdateHint, UpdateSettings, useUpdateStatus } from './Update'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: '', ollamaModel: '', ...patch,
})

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true, current: '0.4.0', mode: 'binary', latest: '0.5.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
  downloadUrl: 'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe',
  checkedAt: '2026-09-19T08:00:00.000Z', error: null, ...patch,
})

let anfragen: { url: string; method: string; body: unknown }[]
let antwort: UpdateStatus

beforeEach(() => {
  anfragen = []
  antwort = status()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    anfragen.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = url.startsWith('/api/update') ? antwort : { ok: true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

test('Hinweis bei der Programmdatei: Download der passenden Datei und „Was ist neu?"', () => {
  render(<UpdateHint status={status()} onDismissed={vi.fn()} onShowGuide={vi.fn()} />)
  expect(screen.getByText('Version 0.5.0 ist da')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Herunterladen' }).getAttribute('href')).toBe(
    'https://github.com/speedone/mietfuchs/releases/download/v0.5.0/mietfuchs-win.exe',
  )
  const neu = screen.getByRole('link', { name: 'Was ist neu?' })
  expect(neu.getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
  expect(neu.getAttribute('target')).toBe('_blank')
})

test('Hinweis bei Docker: kein Download, sondern der Weg zur Anleitung', () => {
  const zurAnleitung = vi.fn()
  render(
    <UpdateHint status={status({ mode: 'docker', downloadUrl: null })} onDismissed={vi.fn()} onShowGuide={zurAnleitung} />,
  )
  expect(screen.queryByRole('link', { name: 'Herunterladen' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'So aktualisierst du' }))
  expect(zurAnleitung).toHaveBeenCalled()
})

test('„Später" merkt sich genau diese Version', async () => {
  const ausgeblendet = vi.fn()
  render(<UpdateHint status={status()} onDismissed={ausgeblendet} onShowGuide={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(ausgeblendet).toHaveBeenCalled())
  expect(anfragen).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateDismissed: '0.5.0' } }])
})

function Karte({ s, reload = vi.fn() }: { s: Settings; reload?: () => Promise<void> }) {
  const update = useUpdateStatus(s)
  return <UpdateSettings settings={s} update={update} reload={reload} />
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

test('Einstellungen: „Jetzt prüfen" fragt neu an und zeigt die Anleitung für Docker', async () => {
  antwort = status({ available: false, latest: '0.4.0', mode: 'docker', downloadUrl: null })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/aktuelle Version/)).toBeTruthy())

  antwort = status({ mode: 'docker', downloadUrl: null })
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(screen.getByText('docker compose pull && docker compose up -d')).toBeTruthy())
  expect(anfragen).toContainEqual({ url: '/api/update/check', method: 'POST', body: undefined })

  const kopiert = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText: kopiert } })
  fireEvent.click(screen.getByRole('button', { name: 'Befehl kopieren' }))
  expect(kopiert).toHaveBeenCalledWith('docker compose pull && docker compose up -d')
})

test('Einstellungen: eine fehlgeschlagene Prüfung wird genannt', async () => {
  antwort = status({ latest: null, available: false, releaseUrl: null, downloadUrl: null, error: 'GitHub ist nicht erreichbar.' })
  render(<Karte s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/GitHub ist nicht erreichbar\./)).toBeTruthy())
})
