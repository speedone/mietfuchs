// @vitest-environment jsdom
// Fehler mit Ausweg, durch die echten Seiten gespielt: Scheitert die KI an einem Beleg, der schon im Belegordner
// liegt, steht er als „Gespeichert, nicht ausgewertet“ da, mit einem Satz zum Grund, „Von Hand erfassen“, „Erneut
// versuchen“ (ohne neue Kopie) und, wo die Einstellungen helfen, „KI-Einstellungen öffnen“. Der Satz des Servers
// steht unter „Mehr dazu“. Ein Fehler ohne gespeicherten Beleg bleibt rot.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const SERVER_TEXT = 'Ollama ist unter http://127.0.0.1:11434 nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.'

let sent: FormData[]
let answer: () => Record<string, unknown>

beforeEach(() => {
  sent = []
  answer = () => ({ error: SERVER_TEXT, file: 'srv-foto.jpg', reason: 'unreachable', kept: true })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/extract' || url === '/api/intake') {
      if (init?.body instanceof FormData) sent.push(init.body)
      return Promise.resolve(new Response(JSON.stringify(answer()), { status: 502, headers: { 'content-type': 'application/json' } }))
    }
    const data = method === 'GET' ? [] : { ok: true }
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function upload(container: HTMLElement) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })] } })
}

async function expectKept(onOpenReceipt: ReturnType<typeof vi.fn>) {
  expect(await screen.findByText('Gespeichert, nicht ausgewertet')).toBeTruthy()
  expect(screen.getByText(/Die KI ist gerade nicht erreichbar\. Ist der Rechner mit der KI eingeschaltet, oder läuft Ollama\?/)).toBeTruthy()
  expect(screen.getByText(/Ihr Beleg liegt im Belegordner\. Sie können ihn jetzt von Hand erfassen oder es später erneut versuchen\./)).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  // Bei „nicht erreichbar“ helfen die Einstellungen nicht weiter
  expect(screen.queryByRole('button', { name: 'KI-Einstellungen öffnen' })).toBeNull()
  // Der Satz des Servers steht eingeklappt unter „Mehr dazu“
  const text = screen.getByText(SERVER_TEXT)
  expect(text.closest('[hidden]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mehr dazu' }))
  expect(screen.getByText(SERVER_TEXT).closest('[hidden]')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Von Hand erfassen' }))
  expect(onOpenReceipt).toHaveBeenCalledWith('srv-foto.jpg')

  // Erneut versuchen: nur der Name des Belegs geht hin, keine neue Datei
  answer = () => ({ error: 'Der Dienst lehnt den Schlüssel ab.', file: 'srv-foto.jpg', reason: 'key', kept: true })
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect([sent[0]?.get('file') instanceof File, sent[0]?.get('existingFile')]).toEqual([true, null])
  expect([sent[1]?.get('file'), sent[1]?.get('existingFile')]).toEqual([null, 'srv-foto.jpg'])
  expect(await screen.findByText('Der Dienst nimmt den Schlüssel nicht an.', { exact: false })).toBeTruthy()
}

test('Schnellerfassung: ein gespeicherter Beleg ohne Auswertung bietet die Auswege an', async () => {
  const onOpenReceipt = vi.fn()
  const onOpenAiSettings = vi.fn()
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} onOpenReceipt={onOpenReceipt} onOpenAiSettings={onOpenAiSettings} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  await expectKept(onOpenReceipt)
  fireEvent.click(await screen.findByRole('button', { name: 'KI-Einstellungen öffnen' }))
  expect(onOpenAiSettings).toHaveBeenCalled()
})

test('Kosten: ein gespeicherter Beleg ohne Auswertung bietet die Auswege an', async () => {
  const onOpenReceipt = vi.fn()
  const onOpenAiSettings = vi.fn()
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} onOpenReceipt={onOpenReceipt} onOpenAiSettings={onOpenAiSettings} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  await expectKept(onOpenReceipt)
  fireEvent.click(await screen.findByRole('button', { name: 'KI-Einstellungen öffnen' }))
  expect(onOpenAiSettings).toHaveBeenCalled()
})

test('ohne gespeicherten Beleg bleibt es ein roter Fehler', async () => {
  answer = () => ({ error: 'Ein Seitenbild ist größer als 5 MB.' })
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  expect(await screen.findByText('Ein Seitenbild ist größer als 5 MB.')).toBeTruthy()
  expect(screen.getAllByText('Fehler').length).toBeGreaterThan(0)
  expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull()
})
