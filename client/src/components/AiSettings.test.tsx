// @vitest-environment jsdom
// Komponententests der KI-Einstellungen (#18). Die Entscheidungslogik prüfen aiForm.test.ts und
// modelForm.test.ts. Hier geht es um das, was nur die gerenderte Karte zeigt: Jedes Auswahlfeld
// zeigt den gespeicherten Wert, Speichern schickt das Sichtbare, Schlüssel und Bestätigung
// gehen über ihre eigenen Routen, und die Knöpfe tun, was sie sagen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AiModel, AiPreset, AiSettings as AiSettingsType, AiSlot, AiStatus, Settings } from '../types'
import { UIProvider } from './feedback'
import { AiSettings } from './AiSettings'

const preset = (p: Partial<AiPreset> & Pick<AiPreset, 'id' | 'provider' | 'label'>): AiPreset => ({
  url: '', key: 'none', tokenField: 'max_tokens', temperature: true, jsonObject: true, keyUrl: null, privacyUrl: null, notice: null, ...p,
})
const PRESETS: AiPreset[] = [
  preset({ id: 'ollama-local', provider: 'ollama', label: 'Ollama auf diesem Rechner', url: 'http://localhost:11434' }),
  preset({ id: 'ollama-remote', provider: 'ollama', label: 'Ollama auf einem anderen Rechner', key: 'optional' }),
  preset({ id: 'openai', provider: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'required', keyUrl: 'https://platform.openai.com/api-keys', privacyUrl: 'https://openai.com/policies/data-processing-addendum/' }),
  preset({ id: 'mistral', provider: 'openai', label: 'Mistral', url: 'https://api.mistral.ai/v1', key: 'required', notice: 'Im kostenlosen Tarif darf Mistral Ein- und Ausgaben zum Training verwenden.' }),
  preset({ id: 'openai-compatible', provider: 'openai', label: 'Eigener OpenAI-kompatibler Dienst', key: 'optional' }),
]
const OLLAMA_MODELS: AiModel[] = [
  { name: 'bild:4b', sizeBytes: 3_400_000_000, vision: true, remote: false },
  { name: 'text:8b', sizeBytes: 5_000_000_000, vision: false, remote: false },
]
const OPENAI_MODELS: AiModel[] = [
  { name: 'gpt-4.1-mini', sizeBytes: null, vision: null, remote: true },
  { name: 'gpt-5.4-nano', sizeBytes: null, vision: null, remote: true },
]

const LOCAL: AiSlot = { provider: 'ollama', preset: 'ollama-local', url: 'http://localhost:11434', model: 'bild:4b', vision: null }
const OPENAI: AiSlot = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: true }
const ai = (patch: Partial<AiSettingsType> = {}): AiSettingsType => ({
  text: LOCAL, images: null, timeoutSeconds: null, numCtx: null, maxOutputTokens: null, pageImageEdge: null,
  jsonMode: 'auto', reasoningEffort: null, extraInstructions: '', consent: {}, ...patch,
})
const NO_KEYS = { text: { set: false, hint: '', fromEnv: null }, images: { set: false, hint: '', fromEnv: null } }
const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'bild:4b', ai: ai(), fixedByEnv: [], aiKeys: NO_KEYS,
  aiExternal: { text: false, images: false }, ...patch,
})

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let statusBySlot: Record<string, AiStatus>
let current: Settings
let pullResponse: Response | null

beforeEach(() => {
  sent = []
  statusBySlot = { text: { ok: true, models: OLLAMA_MODELS }, images: { ok: true, models: OPENAI_MODELS } }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    let body: unknown = { ok: true }
    if (url === '/api/ai/presets') body = PRESETS
    else if (url === '/api/ai/recommendations') body = RECOMMENDATIONS
    else if (url === '/api/ai/pull') { sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) }); return pullResponse ?? new Response('{}', { headers: { 'content-type': 'application/json' } }) }
    else if (url.startsWith('/api/ai/status')) body = statusBySlot[new URL(url, 'http://x').searchParams.get('slot') ?? 'text']
    else {
      const payload = JSON.parse(String(init?.body ?? '{}'))
      sent.push({ url, method, body: payload })
      if (url === '/api/settings' && method === 'PUT') body = { ...current, ai: { ...payload.ai, consent: current.ai?.consent ?? {} } }
      if (url === '/api/ai/key') body = NO_KEYS
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = (s: Settings) => {
  current = s
  const reload = vi.fn(async () => {})
  render(
    <UIProvider>
      <AiSettings settings={s} reload={reload} />
    </UIProvider>,
  )
  return reload
}

const card = (name: RegExp) => screen.findByRole('group', { name }) as Promise<HTMLElement>
const standard = () => card(/Standard-Anbieter/)
const selectIn = async (group: HTMLElement, name: RegExp) => within(group).findByRole('combobox', { name }) as Promise<HTMLSelectElement>
const shownText = (s: HTMLSelectElement) => s.selectedOptions[0]?.textContent
const saved = () => sent.filter((r) => r.url === '/api/settings' && r.method === 'PUT').at(-1)?.body.ai as AiSettingsType | undefined

// ---------- Vorlage und Modell ----------

test('Anbieter: die Auswahl zeigt die gespeicherte Vorlage, das Modell das gespeicherte', async () => {
  statusBySlot.text = { ok: true, models: OPENAI_MODELS }
  show(settings({ ai: ai({ text: OPENAI }), aiKeys: { ...NO_KEYS, text: { set: true, hint: '…abcd', fromEnv: null } } }))
  const group = await standard()
  const anbieter = await selectIn(group, /^Anbieter/)
  expect(anbieter.value).toBe('openai')
  expect(shownText(anbieter)).toBe('OpenAI')
  const modell = await selectIn(group, /^Modell/)
  await waitFor(() => expect(modell.value).toBe('gpt-5.4-nano'))
  expect(shownText(modell)).toBe('gpt-5.4-nano')
  const vision = await selectIn(group, /Versteht das Modell Bilder/)
  expect(vision.value).toBe('yes')
  expect(shownText(vision)).toBe('Ja, versteht Bilder')
})

test('Anbieter: ein Wechsel setzt die Adresse der Vorlage, Speichern schickt das Sichtbare', async () => {
  const reload = show(settings())
  const group = await standard()
  fireEvent.change(await selectIn(group, /^Anbieter/), { target: { value: 'openai' } })
  expect((within(group).getByRole('textbox', { name: /Adresse/ }) as HTMLInputElement).value).toBe('https://api.openai.com/v1')
  fireEvent.change(within(group).getByRole('textbox', { name: /^Modell/ }), { target: { value: 'gpt-5.4-nano' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saved()?.text).toEqual({ provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', vision: null }))
  expect(reload).toHaveBeenCalled()
})

test('Ollama: ein nicht installiertes Modell bleibt sichtbar, mit Befehl zum Laden', async () => {
  const copied = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText: copied } })
  show(settings({ ai: ai({ text: { ...LOCAL, model: 'fehlt:4b' } }) }))
  const modell = await selectIn(await standard(), /^Modell/)
  await waitFor(() => expect(shownText(modell)).toBe('fehlt:4b (nicht installiert)'))
  expect(screen.getByText('ollama pull fehlt:4b')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Befehl kopieren' }))
  await waitFor(() => expect(copied).toHaveBeenCalledWith('ollama pull fehlt:4b'))
})

test('Ollama: eine gefundene Adresse lässt sich übernehmen', async () => {
  statusBySlot.text = { ok: false, error: 'Ollama ist unter http://localhost:11434 nicht erreichbar.', found: 'http://127.0.0.1:11434' }
  show(settings())
  fireEvent.click(await screen.findByRole('button', { name: 'Diese Adresse verwenden' }))
  await waitFor(() => expect(saved()?.text.url).toBe('http://127.0.0.1:11434'))
})

// ---------- Schlüssel ----------

test('Schlüssel: fehlt er, gibt es ein Feld und einen Link, gespeichert wird über die eigene Route', async () => {
  const reload = show(settings({ ai: ai({ text: OPENAI }) }))
  const group = await standard()
  expect(within(group).getByRole('link', { name: /Schlüssel bekommen/ }).getAttribute('href')).toBe('https://platform.openai.com/api-keys')
  const input = within(group).getByLabelText(/API-Schlüssel/) as HTMLInputElement
  expect(input.type).toBe('password')
  fireEvent.change(input, { target: { value: 'sk-test-1234567890abcd' } })
  fireEvent.click(within(group).getByRole('button', { name: 'Schlüssel speichern' }))
  await waitFor(() => expect(sent.find((r) => r.url === '/api/ai/key')?.body).toEqual({ slot: 'text', key: 'sk-test-1234567890abcd' }))
  expect(reload).toHaveBeenCalled()
  // Der Schlüssel geht nie über die Einstellungen
  expect(JSON.stringify(sent.filter((r) => r.url === '/api/settings'))).not.toContain('sk-test')
})

test('Schlüssel: ein gespeicherter zeigt nur den Hinweis und lässt sich löschen', async () => {
  show(settings({ ai: ai({ text: OPENAI }), aiKeys: { ...NO_KEYS, text: { set: true, hint: '…abcd', fromEnv: null } } }))
  const group = await standard()
  expect(within(group).getByText(/Schlüssel gespeichert \(…abcd\)/)).toBeTruthy()
  fireEvent.click(within(group).getByRole('button', { name: 'Schlüssel löschen' }))
  await waitFor(() => expect(sent.find((r) => r.url === '/api/ai/key/text')?.method).toBe('DELETE'))
})

test('Schlüssel: aus der Umgebung nur als Hinweis, ohne Feld', async () => {
  show(settings({ ai: ai({ text: OPENAI }), aiKeys: { ...NO_KEYS, text: { set: true, hint: '…abcd', fromEnv: 'NKA_AI_API_KEY_FILE' } } }))
  const group = await standard()
  expect(within(group).getByText(/NKA_AI_API_KEY_FILE/)).toBeTruthy()
  expect(within(group).queryByLabelText(/API-Schlüssel/)).toBe(null)
})

// ---------- Bestätigung externer Dienste ----------

test('Bestätigung: vor der ersten Auswertung bei einem externen Dienst, mit Link zu den Bedingungen', async () => {
  const reload = show(settings({ ai: ai({ text: OPENAI }), aiExternal: { text: true, images: false } }))
  const group = await standard()
  expect(within(group).getByText(/Belege gehen an api\.openai\.com/)).toBeTruthy()
  expect(within(group).getByRole('link', { name: /Bedingungen des Anbieters/ }).getAttribute('href')).toBe('https://openai.com/policies/data-processing-addendum/')
  fireEvent.click(within(group).getByRole('button', { name: 'Übermittlung bestätigen' }))
  await waitFor(() => expect(sent.find((r) => r.url === '/api/ai/consent')?.body).toEqual({ slot: 'text' }))
  expect(reload).toHaveBeenCalled()
})

test('Bestätigung: eine erteilte steht mit Datum da und lässt sich widerrufen', async () => {
  const consent = { url: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', date: '2026-09-19' }
  show(settings({ ai: ai({ text: OPENAI, consent: { text: consent } }), aiExternal: { text: true, images: false } }))
  const group = await standard()
  expect(within(group).getByText(/Übermittlung an api\.openai\.com bestätigt am 19\.09\.2026/)).toBeTruthy()
  fireEvent.click(within(group).getByRole('button', { name: 'Widerrufen' }))
  await waitFor(() => expect(sent.find((r) => r.url === '/api/ai/consent/text')?.method).toBe('DELETE'))
})

test('Bestätigung: der Hinweis einer Vorlage steht dabei', async () => {
  show(settings({ ai: ai({ text: { ...OPENAI, preset: 'mistral', url: 'https://api.mistral.ai/v1' } }), aiExternal: { text: true, images: false } }))
  expect(within(await standard()).getByText(/zum Training verwenden/)).toBeTruthy()
})

// ---------- Erweitert ----------

// Die JSON-Stufe gilt nur für OpenAI-kompatible Dienste und steht deshalb nur dann zur Wahl
test('Erweitert: Zahlen und Hinweise werden gespeichert, leere Felder heißen Standard', async () => {
  show(settings({ ai: ai({ text: OPENAI }) }))
  fireEvent.change(screen.getByLabelText(/Zeitlimit/), { target: { value: '900' } })
  fireEvent.change(screen.getByLabelText(/Zusätzliche Hinweise/), { target: { value: 'Beträge immer brutto.' } })
  fireEvent.change(screen.getByRole('combobox', { name: /JSON-Stufe/ }), { target: { value: 'object' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saved()).toMatchObject({ timeoutSeconds: 900, numCtx: null, maxOutputTokens: null, jsonMode: 'object', extraInstructions: 'Beträge immer brutto.' }))
})

test('Erweitert: eine ungültige Zahl wird nicht gespeichert', async () => {
  show(settings())
  fireEvent.change(screen.getByLabelText(/Zeitlimit/), { target: { value: 'zehn' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByText(/ganze Zahl/)).toBeTruthy()
  expect(saved()).toBe(undefined)
})

test('Erweitert: ein eigener Anbieter für Fotos und Scans lässt sich einschalten', async () => {
  show(settings())
  fireEvent.click(screen.getByRole('checkbox', { name: /Eigenen Anbieter für Fotos und Scans/ }))
  const images = await card(/Anbieter für Fotos und Scans/)
  fireEvent.change(await selectIn(images, /^Anbieter/), { target: { value: 'openai' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saved()?.images?.preset).toBe('openai'))
  expect(saved()?.text).toEqual(LOCAL)
})

test('Umgebung: festgelegte Felder sind gesperrt und nennen die Variable', async () => {
  show(settings({ fixedByEnv: ['ai.text.url', 'ai.timeoutSeconds'] }))
  const group = await standard()
  expect((within(group).getByRole('textbox', { name: /Adresse/ }) as HTMLInputElement).disabled).toBe(true)
  expect(within(group).getByText(/NKA_AI_URL oder NKA_OLLAMA_URL/)).toBeTruthy()
  expect((screen.getByLabelText(/Zeitlimit/) as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText(/NKA_AI_TIMEOUT/)).toBeTruthy()
})

// ---------- Empfehlungen und Laden (#33) ----------

const RECOMMENDATIONS = {
  updated: '2026-09-19',
  source: 'mitgeliefert' as const,
  models: [
    { name: 'qwen3.5:4b', provider: 'ollama' as const, sizeGb: 3.6, vision: true, note: 'Voreingestellt.', scores: { text: 93 } },
    { name: 'gemma4:12b', provider: 'ollama' as const, sizeGb: 9.2, vision: true, note: 'Besser bei Fotos.' },
  ],
}

test('Empfehlungen: Vorschläge mit Größe und Hinweis, „Übernehmen“ setzt das Modell', async () => {
  show(settings({ ai: ai({ text: { ...LOCAL, model: 'text:8b' } }) }))
  const group = await standard()
  expect(await within(group).findByText(/Besser bei Fotos/)).toBeTruthy()
  expect(within(group).getByText(/9,2 GB/)).toBeTruthy()
  // Schon installiert: qwen3.5:4b steht nicht in der Modellliste des nachgebauten Servers
  fireEvent.click(within(group).getAllByRole('button', { name: 'Übernehmen' })[1])
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saved()?.text.model).toBe('gemma4:12b'))
})

test('Modell laden: fragt nach der Größe, zeigt den Fortschritt und meldet Erfolg', async () => {
  const stream = [
    { type: 'progress', step: 'pull', phase: 'pulling manifest' },
    { type: 'progress', step: 'pull', phase: 'pulling 4b2c', completed: 4_600_000_000, total: 9_200_000_000 },
    { type: 'result', data: { model: 'gemma4:12b' } },
  ]
  pullResponse = new Response(stream.map((l) => JSON.stringify(l)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } })
  show(settings({ ai: ai({ text: { ...LOCAL, model: 'text:8b' } }) }))
  const group = await standard()
  // Die Empfehlungen sind zugeklappt, solange ein Modell gewählt ist
  fireEvent.click(await within(group).findByText(/^Empfehlungen/))
  // Der zweite Vorschlag ist gemma4:12b
  fireEvent.click(within(group).getAllByRole('button', { name: 'Laden …' })[1])
  // Erst die Nachfrage mit der Größe
  expect(await screen.findByText(/rund 9,2 GB groß/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Laden' }))
  await waitFor(() => expect(sent.some((r) => r.url === '/api/ai/pull')).toBe(true))
  expect(sent.find((r) => r.url === '/api/ai/pull')?.body).toMatchObject({ model: 'gemma4:12b', slot: 'text' })
  expect(await screen.findByText(/ist geladen/)).toBeTruthy()
})

test('Modell laden: ohne Bestätigung passiert nichts', async () => {
  show(settings({ ai: ai({ text: { ...LOCAL, model: 'text:8b' } }) }))
  const group = await standard()
  // Die Empfehlungen sind zugeklappt, solange ein Modell gewählt ist
  fireEvent.click(await within(group).findByText(/^Empfehlungen/))
  // Der zweite Vorschlag ist gemma4:12b
  fireEvent.click(within(group).getAllByRole('button', { name: 'Laden …' })[1])
  fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByText(/rund 9,2 GB groß/)).toBe(null))
  expect(sent.some((r) => r.url === '/api/ai/pull')).toBe(false)
})
