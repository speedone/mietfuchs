// @vitest-environment jsdom
// Komponententests der Ollama-Einstellungen. Welche Modelle wie beschriftet zur Wahl stehen,
// prüft modelForm.test.ts. Hier geht es um das, was nur die gerenderte Seite zeigt: Das
// Auswahlfeld zeigt den gespeicherten Wert, Speichern schickt das Sichtbare, und die Knöpfe
// für Befehl und gefundene Adresse tun, was sie sagen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiModel, OllamaStatus, Settings } from '../types'
import { ANDERES_MODELL } from '../modelForm'
import { UIProvider } from './feedback'
import { OllamaSettings } from './OllamaSettings'

const MODELLE: AiModel[] = [
  { name: 'bild:4b', sizeBytes: 3_400_000_000, vision: true, remote: false },
  { name: 'text:8b', sizeBytes: 5_000_000_000, vision: false, remote: false },
]

const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'bild:4b', fixedByEnv: [], ...patch,
})

let gesendet: { url: string; method: string; body: Record<string, unknown> }[]
let statusFolge: OllamaStatus[] // eine Antwort je Abfrage, die letzte gilt danach weiter

beforeEach(() => {
  gesendet = []
  statusFolge = [{ ok: true, models: MODELLE }]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    let body: unknown = { ok: true }
    if (url === '/api/ollama/status') body = statusFolge.length > 1 ? statusFolge.shift() : statusFolge[0]
    else gesendet.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const zeige = (s: Settings) => {
  const reload = vi.fn(async () => {})
  render(
    <UIProvider>
      <OllamaSettings settings={s} reload={reload} />
    </UIProvider>,
  )
  return reload
}

const modellAuswahl = () => screen.findByRole('combobox', { name: /Modell/ }) as Promise<HTMLSelectElement>
const angezeigt = (s: HTMLSelectElement) => s.selectedOptions[0]?.textContent

test('Modell: die Auswahl zeigt das gespeicherte Modell', async () => {
  zeige(settings())
  const auswahl = await modellAuswahl()
  expect(auswahl.value).toBe('bild:4b')
  expect(angezeigt(auswahl)).toBe('bild:4b (3,4 GB, versteht Bilder)')
  expect(screen.getByText(/Ollama ist erreichbar, 2 Modelle installiert/)).toBeTruthy()
})

test('Modell: ein nicht installiertes Modell bleibt sichtbar, mit Befehl zum Laden', async () => {
  const kopiert = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText: kopiert } })
  zeige(settings({ ollamaModel: 'fehlt:4b' }))
  const auswahl = await modellAuswahl()
  expect(auswahl.value).toBe('fehlt:4b')
  expect(angezeigt(auswahl)).toBe('fehlt:4b (nicht installiert)')
  expect(screen.getByText('ollama pull fehlt:4b')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Befehl kopieren' }))
  await waitFor(() => expect(kopiert).toHaveBeenCalledWith('ollama pull fehlt:4b'))
})

test('Modell: Speichern schickt das gewählte Modell, der Hinweis passt zur Wahl', async () => {
  const reload = zeige(settings())
  fireEvent.change(await modellAuswahl(), { target: { value: 'text:8b' } })
  expect(screen.getByText(/„text:8b“ versteht keine Bilder/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(gesendet).toEqual([
    { url: '/api/settings', method: 'PUT', body: { ollamaUrl: 'http://localhost:11434', ollamaModel: 'text:8b' } },
  ])
})

test('Modell: „Anderes Modell eintragen“ schaltet auf freie Eingabe', async () => {
  zeige(settings())
  fireEvent.change(await modellAuswahl(), { target: { value: ANDERES_MODELL } })
  const eingabe = screen.getByRole('textbox', { name: /Modell/ }) as HTMLInputElement
  fireEvent.change(eingabe, { target: { value: 'neu:2b' } })
  expect(screen.getByText('ollama pull neu:2b')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(gesendet.at(-1)?.body.ollamaModel).toBe('neu:2b'))
})

test('Nicht erreichbar: freie Eingabe, Meldung und Vorschlag einer gefundenen Adresse', async () => {
  statusFolge = [
    { ok: false, error: 'Ollama ist unter http://localhost:11434 nicht erreichbar.', found: 'http://ollama:11434' },
    { ok: true, models: MODELLE },
  ]
  zeige(settings())
  await screen.findByText(/nicht erreichbar/)
  expect((screen.getByRole('textbox', { name: /Modell/ }) as HTMLInputElement).value).toBe('bild:4b')
  expect(screen.getByText(/Unter http:\/\/ollama:11434 antwortet Ollama/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Diese Adresse verwenden' }))
  await waitFor(() => expect(gesendet.at(-1)?.body.ollamaUrl).toBe('http://ollama:11434'))
  expect((screen.getByRole('textbox', { name: /Server-Adresse/ }) as HTMLInputElement).value).toBe('http://ollama:11434')
  expect((await modellAuswahl()).value).toBe('bild:4b') // neue Abfrage: jetzt mit Auswahl
})

test('Per Umgebung festgelegt: Felder sind gesperrt und nennen die Variable', async () => {
  zeige(settings({ fixedByEnv: ['ollamaUrl', 'ollamaModel'] }))
  await screen.findByText(/Ollama ist erreichbar/)
  expect((screen.getByRole('textbox', { name: /Server-Adresse/ }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('textbox', { name: /Modell/ }) as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText(/NKA_OLLAMA_URL/)).toBeTruthy()
  expect(screen.getByText(/NKA_OLLAMA_MODEL/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
})
