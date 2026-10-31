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
  answer = () => ({ error: SERVER_TEXT, file: 'srv-foto.jpg', reason: 'unreachable', kept: true, provider: 'ollama' })
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
  // Der Beleg bleibt im Belegordner: Der Knopf am Eintrag blendet ihn nur aus (Durchsicht #487)
  expect(screen.getByRole('button', { name: 'Aus der Liste nehmen (foto.jpg)' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
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
  // Der Fokus fällt nicht auf body, sondern bleibt beim Eintrag (Durchsicht #487)
  await screen.findByText('Der Dienst nimmt den Schlüssel nicht an.', { exact: false })
  expect(document.activeElement).not.toBe(document.body)
  expect(document.activeElement?.closest('[data-queue-entry]')).not.toBeNull()
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
  await expectTakenOff(onOpenReceipt)
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
  await expectTakenOff(onOpenReceipt)
})

// Rückmeldung des Nutzers (#487): „Ausblenden“ war unklar. „Aus der Liste nehmen“ sagt, dass nur der Eintrag geht; an
// seiner Stelle steht, dass der Beleg weiter im Belegordner liegt, mit dem Weg dorthin.
async function expectTakenOff(onOpenReceipt: ReturnType<typeof vi.fn>) {
  onOpenReceipt.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Aus der Liste nehmen (foto.jpg)' }))
  const status = (await screen.findByText(/liegt weiter im Belegordner/)).closest('[role="status"]')
  expect(status?.textContent).toContain('„foto.jpg“ liegt weiter im Belegordner.')
  expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Im Belegordner zeigen' }))
  expect(onOpenReceipt).toHaveBeenCalledWith('srv-foto.jpg')
}

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

// Durchsicht #487: Scheitert bei einem Zählerfoto das Ablesen, führt „Von Hand erfassen“ zur Seite Zähler.
test('Schnellerfassung: bei einem Zählerfoto führt „Von Hand erfassen“ zur Ablesung von Hand', async () => {
  answer = () => ({ error: 'Ollama antwortet mit 500', file: 'srv-zaehler.jpg', reason: 'other', kept: true, meterPhoto: true })
  const onOpenReceipt = vi.fn()
  const onOpenMeters = vi.fn()
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} onOpenReceipt={onOpenReceipt} onOpenMeters={onOpenMeters} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  fireEvent.click(await screen.findByRole('button', { name: 'Von Hand erfassen' }))
  expect(onOpenMeters).toHaveBeenCalled()
  expect(onOpenReceipt).not.toHaveBeenCalled()
})
