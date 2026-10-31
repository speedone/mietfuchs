// @vitest-environment jsdom
// Fehler mit Ausweg, durch die echten Seiten gespielt: Scheitert die KI an einem Beleg, der schon gespeichert
// ist, steht er als „Gespeichert, nicht ausgewertet“ da, mit einem Satz zum Grund, „Von Hand erfassen“, „Erneut
// versuchen“ (ohne neue Kopie) und, wo die Einstellungen helfen, „KI-Einstellungen öffnen“. Der Satz des Servers
// steht unter „Mehr dazu“. Ein Fehler ohne gespeicherten Beleg bleibt rot.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Kosten from './Kosten'
import Belege from './Belege'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const SERVER_TEXT = 'Ollama ist unter http://127.0.0.1:11434 nicht erreichbar. Läuft Ollama? Die Adresse steht in den Einstellungen.'

let sent: FormData[]
let answer: () => Record<string, unknown>
// Die Belege der Ablage: Nach einem Scheitern liegt der Beleg dort (GET /api/uploads)
let stored: string[]

beforeEach(() => {
  sent = []
  stored = []
  answer = () => ({ error: SERVER_TEXT, file: 'srv-foto.jpg', reason: 'unreachable', kept: true, provider: 'ollama' })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/extract' || url === '/api/intake') {
      if (init?.body instanceof FormData) sent.push(init.body)
      const a = answer()
      if (typeof a.file === 'string' && !stored.includes(a.file)) stored.push(a.file)
      return Promise.resolve(new Response(JSON.stringify(answer()), { status: 502, headers: { 'content-type': 'application/json' } }))
    }
    const upload = (file: string) => ({ file, size: 4, mtime: '2026-01-01T00:00:00.000Z', originalName: 'foto.jpg', mimeType: 'image/jpeg',
      uploadedAt: '2026-01-01T00:00:00.000Z', sha256: file, propertyId: null, year: null, invoiceDate: null, kind: 'receipt' })
    const data = method !== 'GET' ? { ok: true } : url === '/api/uploads' ? stored.map(upload) : []
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

async function expectKept(onOpenReceipt: ReturnType<typeof vi.fn>, inbox = false) {
  expect(await screen.findByText('Gespeichert, nicht ausgewertet')).toBeTruthy()
  expect(screen.getByText(/Die KI ist gerade nicht erreichbar\. Ist der Rechner mit der KI eingeschaltet, oder läuft Ollama\?/)).toBeTruthy()
  expect(screen.getByText(/Ihr Beleg ist gespeichert und steht auf der Seite Belege\. Sie können ihn jetzt von Hand erfassen oder es später erneut versuchen\./)).toBeTruthy()
  expect(screen.queryByText('Fehler')).toBeNull()
  if (inbox) {
    // Im Eingang steht der Hinweis an der Karte des gespeicherten Belegs unter „Ohne Position“, einmal
    expect(screen.getAllByText('Gespeichert, nicht ausgewertet')).toHaveLength(1)
    expect(screen.getByText('Gespeichert, nicht ausgewertet').closest('li.receipt-card')?.getAttribute('data-file')).toBe('srv-foto.jpg')
  } else {
    // Der Beleg bleibt gespeichert: Der Knopf am Eintrag blendet ihn nur aus (Durchsicht #487)
    expect(screen.getByRole('button', { name: 'Aus der Liste nehmen (foto.jpg)' })).toBeTruthy()
  }
  expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
  // Bei „nicht erreichbar“ helfen die Einstellungen nicht weiter
  expect(screen.queryByRole('button', { name: 'KI-Einstellungen öffnen' })).toBeNull()
  // Der Satz des Servers steht eingeklappt unter „Mehr dazu“
  const text = screen.getByText(SERVER_TEXT)
  expect(text.closest('[hidden]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mehr dazu' }))
  expect(screen.getByText(SERVER_TEXT).closest('[hidden]')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Von Hand erfassen' }))
  if (inbox) {
    // Im Eingang führt es zu Objekt, Jahr und Zuordnen an derselben Karte (ins Kostenformular erst mit #490 PR 3)
    expect(document.activeElement?.closest('.receipt-inbox-controls')).not.toBeNull()
  } else expect(onOpenReceipt).toHaveBeenCalledWith('srv-foto.jpg')

  // Erneut versuchen: nur der Name des Belegs geht hin, keine neue Datei
  answer = () => ({ error: 'Der Dienst lehnt den Schlüssel ab.', file: 'srv-foto.jpg', reason: 'key', kept: true })
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  // Der Fokus fällt nicht auf body, sondern bleibt beim Eintrag (Durchsicht #487)
  await screen.findByText('Der Dienst nimmt den Schlüssel nicht an.', { exact: false })
  expect(document.activeElement).not.toBe(document.body)
  expect(document.activeElement?.closest(inbox ? '[data-queue-entry], li.receipt-card' : '[data-queue-entry]')).not.toBeNull()
  expect([sent[0]?.get('file') instanceof File, sent[0]?.get('existingFile')]).toEqual([true, null])
  expect([sent[1]?.get('file'), sent[1]?.get('existingFile')]).toEqual([null, 'srv-foto.jpg'])
  expect(await screen.findByText('Der Dienst nimmt den Schlüssel nicht an.', { exact: false })).toBeTruthy()
}

test('Eingang: ein gespeicherter Beleg ohne Auswertung bietet die Auswege an seiner Karte an', async () => {
  const onOpenAiSettings = vi.fn()
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} onOpenAiSettings={onOpenAiSettings} renderThumb={() => Promise.resolve('')} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  await expectKept(vi.fn(), true)
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
  await expectTakenOff(onOpenReceipt)
})

// Rückmeldung des Nutzers (#487): „Ausblenden“ war unklar. „Aus der Liste nehmen“ sagt, dass nur der Eintrag geht; an
// seiner Stelle steht, dass der Beleg weiter auf der Seite Belege liegt, mit dem Weg dorthin.
async function expectTakenOff(onOpenReceipt: ReturnType<typeof vi.fn>) {
  onOpenReceipt.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Aus der Liste nehmen (foto.jpg)' }))
  const status = (await screen.findByText(/liegt weiter auf der Seite Belege/)).closest('[role="status"]')
  expect(status?.textContent).toContain('„foto.jpg“ liegt weiter auf der Seite Belege.')
  expect(screen.queryByText('Gespeichert, nicht ausgewertet')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Beleg zeigen' }))
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
test('Eingang: bei einem Zählerfoto führt „Von Hand erfassen“ zur Ablesung von Hand', async () => {
  answer = () => ({ error: 'Ollama antwortet mit 500', file: 'srv-zaehler.jpg', reason: 'other', kept: true, meterPhoto: true })
  const onOpenMeters = vi.fn()
  const { container } = render(
    <PeriodProvider>
      <PropertyProvider>
        <Belege view="eingang" units={UNITS} settings={null} onNavigate={() => {}} onOpenMeters={onOpenMeters} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  await upload(container)
  fireEvent.click(await screen.findByRole('button', { name: 'Von Hand erfassen' }))
  expect(onOpenMeters).toHaveBeenCalled()
})
