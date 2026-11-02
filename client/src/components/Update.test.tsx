// @vitest-environment jsdom
// Komponententests des Update-Hinweises. Wann was erscheint, prüft update.test.ts. Hier geht
// es darum, dass die Knöpfe das Richtige an den Server schicken, die Anleitung zum System
// passt und Fehler sichtbar werden.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { UIProvider } from './feedback'
import { DesktopHint, UpdateConsent, UpdateHint, UpdateSettings, useUpdateStatus } from './Update'
import { RELEASES_URL, STORE_URL } from '../update'

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: '', ollamaModel: '', ...patch,
})

const download = (fileName: string) => `https://github.com/speedone/mietfuchs/releases/download/v0.5.0/${fileName}`

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true, current: '0.4.0', mode: 'binary', desktopOffer: null, latest: '0.5.0', available: true,
  releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0',
  downloadUrl: download('mietfuchs-win.exe'),
  checkedAt: '2026-09-19T08:00:00.000Z', error: null, ...patch,
})

let requests: { url: string; method: string; body: unknown }[]
let response: UpdateStatus
let failing: string[] // Adressen, die mit 500 antworten
let gates: Record<string, Promise<void>> // 'GET /api/update' → Antwort erst, wenn erfüllt

beforeEach(() => {
  requests = []
  response = status()
  failing = []
  gates = {}
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = url.startsWith('/api/update') ? response : { ok: true } // Stand beim Absenden
    await gates[`${method} ${url}`]
    if (failing.includes(url)) {
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
  const answered = vi.fn()
  render(<UpdateConsent onAnswered={answered} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Bescheid geben' }))
  await waitFor(() => expect(answered).toHaveBeenCalled())
  expect(requests).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateCheck: 'on' } }])
})

test('Einwilligung: „Nein" speichert die Ablehnung und fragt nichts weiter ab', async () => {
  const answered = vi.fn()
  render(<UpdateConsent onAnswered={answered} />)
  fireEvent.click(screen.getByRole('button', { name: 'Nein, danke' }))
  await waitFor(() => expect(answered).toHaveBeenCalled())
  expect(requests).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateCheck: 'off' } }])
})

test('Einwilligung: scheitert das Speichern, sagt Mietfuchs es und fragt weiter', async () => {
  failing = ['/api/settings']
  const answered = vi.fn()
  render(<UIProvider><UpdateConsent onAnswered={answered} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Ja, Bescheid geben' }))
  await waitFor(() => expect(screen.getByText(/ließ sich nicht speichern/)).toBeTruthy())
  expect(answered).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Ja, Bescheid geben' }) as HTMLButtonElement).disabled).toBe(false)
})

// ---------- Stand vom Server ----------

test('Status wird erst nach dem Laden der Einstellungen geholt und nach einer Antwort neu', async () => {
  const { result, rerender } = renderHook(({ s }) => useUpdateStatus(s), {
    initialProps: { s: null as Settings | null },
  })
  expect(requests).toHaveLength(0)

  rerender({ s: settings() })
  await waitFor(() => expect(result.current.status).not.toBeNull())

  // Nach der Zustimmung muss der Hinweis ohne Neuladen der Seite erscheinen können.
  rerender({ s: settings({ updateCheck: 'on' }) })
  await waitFor(() => expect(requests.filter((a) => a.url === '/api/update')).toHaveLength(2))
})

test('Eine langsame ältere Antwort überschreibt keine neuere', async () => {
  // Beim Öffnen läuft GET /api/update. Kommt „Jetzt prüfen" früher zurück, gilt dessen Stand.
  let release!: () => void
  gates['GET /api/update'] = new Promise((r) => { release = r })
  const { result } = renderHook(() => useUpdateStatus(settings({ updateCheck: 'on' })))
  await waitFor(() => expect(requests).toHaveLength(1))

  response = status({ latest: '0.6.0' })
  await act(() => result.current.checkNow())
  expect(result.current.status?.latest).toBe('0.6.0')

  await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)) })
  expect(result.current.status?.latest).toBe('0.6.0')
})

// ---------- Hinweis in der Seitenleiste ----------

test('Hinweis führt bei jeder Betriebsart zur Anleitung, nicht direkt zum Download', () => {
  // Wer die neue Datei aus dem Download-Ordner startet, sieht einen leeren Datenordner und
  // hält seine Daten für verloren. Deshalb erst die Anleitung.
  for (const mode of ['binary', 'docker', 'npm'] as const) {
    const showGuide = vi.fn()
    render(<UpdateHint status={status({ mode })} onDismissed={vi.fn()} onShowGuide={showGuide} />)
    expect(screen.getByText('Version 0.5.0 ist da')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Herunterladen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'So aktualisieren Sie' }))
    expect(showGuide).toHaveBeenCalled()
    const whatsNew = screen.getByRole('link', { name: 'Was ist neu?' })
    expect(whatsNew.getAttribute('href')).toBe('https://github.com/speedone/mietfuchs/releases/tag/v0.5.0')
    expect(whatsNew.getAttribute('target')).toBe('_blank')
    cleanup()
  }
})

test('„Später" merkt sich genau diese Version', async () => {
  const dismissed = vi.fn()
  render(<UpdateHint status={status()} onDismissed={dismissed} onShowGuide={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(dismissed).toHaveBeenCalled())
  expect(requests).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateDismissed: '0.5.0' } }])
})

// ---------- Umstieg auf das Programmfenster (#517) ----------

// Links, die eine Antwort von GitHub vorschlüge: Der Hinweis darf keinen davon übernehmen.
const foreign = { releaseUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v9.9.9', downloadUrl: download('mietfuchs-win.exe') }

test('Umstieg unter Windows: Store und Installer aus festen Adressen, die Schritte und das Handy', () => {
  render(<DesktopHint status={status({ desktopOffer: 'windows', ...foreign })} onDismissed={vi.fn()} />)
  const card = screen.getByRole('region', { name: 'Mietfuchs gibt es jetzt als eigenes Programm' })
  expect(card.textContent).toMatch(/Ihre Daten übernimmt es beim ersten Start/)
  // Ohne Satz zum Drucken: zu viel für die Karte (Wunsch des Nutzers).
  expect(card.textContent).toMatch(/^Mietfuchs gibt es jetzt als eigenes ProgrammMit eigenem Fenster statt Browser-Tab\. Ihre Daten/)
  expect(card.textContent).not.toMatch(/gedruckt|Briefpapier|Seitenzahl/)
  // Geänderte Erwartung: Installer zuerst, Store als zweite Wahl (bis zur Zertifizierung liefert der Store die alte Fassung)
  const store = screen.getByRole('link', { name: 'Oder aus dem Microsoft Store, mit automatischen Updates' })
  expect(store.getAttribute('href')).toBe(STORE_URL)
  expect(store.className).toBe('btn secondary')
  const installer = screen.getByRole('link', { name: 'Installer herunterladen' })
  expect(installer.getAttribute('href')).toBe(RELEASES_URL)
  expect(installer.className).toBe('btn')
  for (const link of [store, installer]) {
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  }
  const steps = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
  expect(steps).toHaveLength(4)
  expect(steps[0]).toMatch(/^Den Installer Mietfuchs-Setup-/)
  expect(steps[0]).toMatch(/Microsoft Store/)
  expect(steps[1]).toMatch(/„Mietfuchs beenden“/)
  expect(steps[2]).toMatch(/Startmenü/)
  expect(steps[3]).toMatch(/„Daten übernehmen“/)
  // Wie die umgezogene Fassung es selbst sagt (database.ts): nur noch zum Ansehen.
  expect(steps[3]).toMatch(/nur noch zum Ansehen/)
  expect(card.textContent).toMatch(/Zugriff aus dem Heimnetz/)
  expect(card.textContent).toMatch(/Adresse ändert sich/)
  expect(card.textContent).not.toMatch(/\.dmg/)
})

test('Umstieg auf dem Mac: ein Knopf zur Release-Seite, das Abbild für Apple Silicon oder Intel', () => {
  render(<DesktopHint status={status({ desktopOffer: 'macos', ...foreign })} onDismissed={vi.fn()} />)
  expect(screen.getByRole('link', { name: 'Neues Mietfuchs herunterladen' }).getAttribute('href')).toBe(RELEASES_URL)
  expect(screen.queryByRole('link', { name: /Microsoft Store/ })).toBeNull()
  // Der Mac-Abschnitt des README (#macos)
  expect(screen.getByRole('link', { name: 'README' }).getAttribute('href')).toBe('https://github.com/speedone/mietfuchs#macos')
  const steps = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
  expect(steps).toHaveLength(4)
  expect(steps[0]).toMatch(/apple-silicon\.dmg/)
  expect(steps[0]).toMatch(/intel\.dmg/)
  expect(steps[0]).toMatch(/„Programme“/)
  expect(steps[1]).toMatch(/„Mietfuchs beenden“/)
  expect(steps[3]).toMatch(/„Daten übernehmen“/)
  expect(document.body.textContent).not.toMatch(/Microsoft Store|Setup/)
})

test('Umstieg: „Später“ merkt sich die installierte Version', async () => {
  const dismissed = vi.fn()
  render(<UIProvider><DesktopHint status={status({ desktopOffer: 'windows' })} onDismissed={dismissed} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(dismissed).toHaveBeenCalled())
  expect(requests).toEqual([{ url: '/api/settings', method: 'PUT', body: { desktopHintDismissed: '0.4.0' } }])
})

test('Umstieg: scheitert „Später“, sagt Mietfuchs es, und der Hinweis bleibt', async () => {
  failing = ['/api/settings']
  const dismissed = vi.fn()
  render(<UIProvider><DesktopHint status={status({ desktopOffer: 'macos' })} onDismissed={dismissed} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Später' }))
  await waitFor(() => expect(screen.getByText(/Ausblenden ging nicht/)).toBeTruthy())
  expect(dismissed).not.toHaveBeenCalled()
})

test('Update-Anleitung der Programmdatei: Datei ersetzen bleibt, dazu der Weg zum Umstieg', async () => {
  response = status({ desktopOffer: 'windows' })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/im selben Ordner wie bisher/)).toBeTruthy())
  const store = screen.getByRole('link', { name: 'Microsoft Store' })
  expect(store.getAttribute('href')).toBe(STORE_URL)
  expect(screen.getByText(/übernimmt Ihre Daten beim ersten Start/)).toBeTruthy()
  cleanup()

  response = status({ desktopOffer: 'macos', downloadUrl: download('mietfuchs-macos-apple-silicon.zip') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Zip-Datei/)).toBeTruthy())
  expect(screen.getByRole('link', { name: 'neue Mietfuchs für den Mac' }).getAttribute('href')).toBe(RELEASES_URL)
  cleanup()

  // Unter Linux (kein Angebot) bleibt die Anleitung, wie sie war.
  response = status({ downloadUrl: download('mietfuchs-linux.tar.gz') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('tar -xzf mietfuchs-linux.tar.gz')).toBeTruthy())
  expect(screen.queryByText(/übernimmt Ihre Daten beim ersten Start/)).toBeNull()
})

// ---------- Karte in den Einstellungen ----------

function Card({ s, reload = vi.fn() }: { s: Settings; reload?: () => Promise<void> }) {
  const update = useUpdateStatus(s)
  return <UIProvider><UpdateSettings settings={s} update={update} reload={reload} /></UIProvider>
}

test('Einstellungen: ohne Zustimmung nur die installierte Version, Prüfen ist gesperrt', async () => {
  response = status({ enabled: false, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null })
  render(<Card s={settings({ updateCheck: 'off' })} />)
  await waitFor(() => expect(screen.getByText(/Installiert ist Version 0\.4\.0/)).toBeTruthy())
  expect((screen.getByLabelText(/nach neuen Versionen schauen/i) as HTMLInputElement).checked).toBe(false)
  expect((screen.getByRole('button', { name: 'Jetzt prüfen' }) as HTMLButtonElement).disabled).toBe(true)
})

test('Einstellungen: aus dem Microsoft Store nur der Stand, ohne Häkchen und Knopf (#500)', async () => {
  response = status({ mode: 'store', enabled: false, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/installiert der Microsoft Store von selbst/)).toBeTruthy())
  expect(screen.queryByLabelText(/nach neuen Versionen schauen/i)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Jetzt prüfen' })).toBeNull()
})

// #309: Das Häkchen ist ein Entwurf. Erst „Speichern“ schickt es, „Verwerfen“ stellt es her.
const writes = () => requests.filter((r) => r.method !== 'GET')

test('Einstellungen: Häkchen schaltet die Prüfung erst mit „Speichern“ aus, genau einmal', async () => {
  const reload = vi.fn(async () => {})
  render(<Card s={settings({ updateCheck: 'on' })} reload={reload} />)
  fireEvent.click(screen.getByLabelText(/nach neuen Versionen schauen/i))
  expect((screen.getByLabelText(/nach neuen Versionen schauen/i) as HTMLInputElement).checked).toBe(false)
  expect(writes()).toEqual([])
  const speichern = screen.getByRole('button', { name: 'Speichern (Update-Prüfung)' })
  fireEvent.click(speichern)
  fireEvent.click(speichern)
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  expect(writes()).toEqual([{ url: '/api/settings', method: 'PUT', body: { updateCheck: 'off' } }])
  expect(await screen.findByText('Mietfuchs fragt nicht mehr nach neuen Versionen.')).toBeTruthy()
})

test('Einstellungen: „Verwerfen“ stellt das Häkchen her, ohne zu senden; Prüfen bleibt am gespeicherten Stand', async () => {
  render(<Card s={settings({ updateCheck: 'off' })} />)
  const box = screen.getByLabelText(/nach neuen Versionen schauen/i) as HTMLInputElement
  fireEvent.click(box)
  expect(box.checked).toBe(true)
  // Ohne gespeicherte Zustimmung fragt der Server nicht bei GitHub, also bleibt „Jetzt prüfen“ gesperrt.
  expect((screen.getByRole('button', { name: 'Jetzt prüfen' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/Erst das Häkchen oben setzen und speichern/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Update-Prüfung)' }))
  expect(box.checked).toBe(false)
  expect(writes()).toEqual([])
})

test('Einstellungen: scheitert das Speichern, steht der Grund am Knopf und das Häkchen bleibt', async () => {
  failing = ['/api/settings']
  const reload = vi.fn(async () => {})
  render(<Card s={settings({ updateCheck: 'off' })} reload={reload} />)
  fireEvent.click(screen.getByLabelText(/nach neuen Versionen schauen/i))
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Update-Prüfung)' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*Server nicht erreichbar/)
  expect((screen.getByLabelText(/nach neuen Versionen schauen/i) as HTMLInputElement).checked).toBe(true)
  expect(reload).not.toHaveBeenCalled()
})

test('Einstellungen: Windows-Programmdatei wird im bisherigen Ordner ersetzt', async () => {
  render(<Card s={settings({ updateCheck: 'on' })} />)
  const link = await waitFor(() => screen.getByRole('link', { name: 'Version 0.5.0 herunterladen' }))
  expect(link.getAttribute('href')).toBe(download('mietfuchs-win.exe'))
  expect(link.getAttribute('target')).toBeNull() // ein Download verlässt die Seite nicht
  expect(screen.getByText(/im selben Ordner wie bisher/)).toBeTruthy() // dort liegt der Ordner data
})

test('Einstellungen: macOS und Linux müssen erst entpacken', async () => {
  response = status({ downloadUrl: download('mietfuchs-macos-apple-silicon.zip') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Zip-Datei/)).toBeTruthy())
  expect(screen.getByText(/blockiert macOS/)).toBeTruthy()
  cleanup()

  response = status({ downloadUrl: download('mietfuchs-linux.tar.gz') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('tar -xzf mietfuchs-linux.tar.gz')).toBeTruthy())
  expect(screen.getByText('./mietfuchs-linux')).toBeTruthy()
})

test('Einstellungen: die Anleitung nennt die Datei für ARM, nicht die für x64 (#22)', async () => {
  response = status({ downloadUrl: download('mietfuchs-linux-arm64.tar.gz') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('tar -xzf mietfuchs-linux-arm64.tar.gz')).toBeTruthy())
  expect(screen.getByText('./mietfuchs-linux-arm64')).toBeTruthy()
  cleanup()

  response = status({ downloadUrl: download('mietfuchs-win-arm64.exe') })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText('mietfuchs-win-arm64.exe')).toBeTruthy())
})

test('Einstellungen: ohne passende Datei öffnet die Release-Seite in neuem Tab', async () => {
  response = status({ downloadUrl: 'https://github.com/speedone/mietfuchs/releases/tag/v0.5.0' })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  const link = await waitFor(() => screen.getByRole('link', { name: 'Zur Release-Seite' }))
  expect(link.getAttribute('target')).toBe('_blank')
})

test('Einstellungen: ein Release-Kandidat nennt sich Vorabversion (#166)', async () => {
  response = status({ current: '0.9.0-rc.2', latest: '0.8.0', available: false })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Sie nutzen die Vorabversion 0\.9\.0-rc\.2\. Neueste veröffentlichte Version: 0\.8\.0\./)).toBeTruthy())
  expect(screen.queryByText(/aktuelle Version/)).toBeNull()
})

test('Einstellungen: „Jetzt prüfen" fragt neu an und zeigt die Befehle für Docker', async () => {
  response = status({ available: false, latest: '0.4.0', mode: 'docker', downloadUrl: null })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/aktuelle Version/)).toBeTruthy())

  response = status({ mode: 'docker', downloadUrl: null })
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(screen.getByText('docker compose pull')).toBeTruthy())
  expect(screen.getByText('docker compose up -d')).toBeTruthy()
  expect(requests).toContainEqual({ url: '/api/update/check', method: 'POST', body: undefined })

  const copied = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText: copied } })
  fireEvent.click(screen.getByRole('button', { name: 'Befehle kopieren' }))
  expect(copied).toHaveBeenCalledWith('docker compose pull\ndocker compose up -d')
})

test('Einstellungen: ist der Mietfuchs-Server nicht erreichbar, erscheint eine Meldung', async () => {
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/Version 0\.5\.0 ist erschienen/)).toBeTruthy())
  failing = ['/api/update/check']
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt prüfen' }))
  await waitFor(() => expect(screen.getByText(/Prüfen ging nicht/)).toBeTruthy())
})

test('Einstellungen: eine fehlgeschlagene Prüfung bei GitHub wird genannt', async () => {
  response = status({ latest: null, available: false, releaseUrl: null, downloadUrl: null, error: 'GitHub ist nicht erreichbar.' })
  render(<Card s={settings({ updateCheck: 'on' })} />)
  await waitFor(() => expect(screen.getByText(/GitHub ist nicht erreichbar\./)).toBeTruthy())
})
