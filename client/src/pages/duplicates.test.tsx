// @vitest-environment jsdom
// Zusammenspiel von „Aus dem Vorjahr übernehmen“ und der KI-Erfassung (Befund A): Erst wird eine
// Position aus dem Vorjahr übernommen, mit Schätzbetrag und ohne Beleg; dann kommt die echte
// Rechnung über die Schnellerfassung oder die KI-Auswertung der Kostenseite. Vorher entstand still
// eine zweite Position derselben Kostenart. Jetzt ist die Zeile nicht angehakt, und das
// Verknüpfen aktualisiert Betrag und Beleg der bestehenden Position.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CostItem, Extraction, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Schnellerfassung from './Schnellerfassung'
import Kosten from './Kosten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
// Die Seiten öffnen im Vorjahr des Kalenderjahres (year.tsx).
const YEAR = new Date().getFullYear() - 1

let items: CostItem[]
let extraction: Extraction
let sent: { url: string; method: string; body: Record<string, unknown> }[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/intake') return json({ file: 'bescheid.pdf', kind: 'rechnung', extraction })
    if (url === '/api/extract') return json({ file: 'bescheid.pdf', extraction })
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      // Die Seite lädt danach neu; die Position trägt dann Betrag und Beleg.
      if (method === 'PUT') items = items.map((i) => (url.startsWith(`/api/costItems/${i.id}`) ? { ...i, ...body } : i))
      return json({ ok: true })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': items,
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const estimate = (year: number): CostItem => ({ id: 'gs', propertyId: 'objekt-1', year, category: 'Grundsteuer', description: `Grundsteuer ${year}`, vendor: 'Stadt', amountCents: 61000, key: 'area' })
const bescheid = (year: number): Extraction => ({
  vendor: 'Stadt Musterstadt', invoiceDate: `${year}-02-15`,
  positions: [{ description: 'Abgabenbescheid Grundbesitzabgaben', category: 'Grundsteuer', amountEur: 612.4 }],
})

async function upload(container: HTMLElement) {
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'bescheid.jpg', { type: 'image/jpeg' })] } })
}

const checkboxOf = (description: string) => {
  const row = screen.getByDisplayValue(description).closest('tr')
  if (!row) throw new Error(`Keine Zeile zu „${description}“`)
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement
}

const intake = () => render(
  <YearProvider>
    <PropertyProvider>
      <UIProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} />
      </UIProvider>
    </PropertyProvider>
  </YearProvider>,
)

test('Schnellerfassung: übernommen, dann die Rechnung per KI → nicht angehakt, Verknüpfen setzt Betrag und Beleg, keine zweite Position', async () => {
  items = [estimate(YEAR)]
  extraction = bescheid(YEAR)
  const { container } = intake()
  await upload(container)
  await screen.findByRole('button', { name: /Diese übernehmen/ }, SLOW)
  expect(checkboxOf('Abgabenbescheid Grundbesitzabgaben').checked).toBe(false)
  expect(screen.getAllByText(/schon erfasst/i).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /Mit „Grundsteuer .*“ \(610,00\s€\) verknüpfen und Betrag auf 612,40\s€ setzen/ }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]).toMatchObject({ url: '/api/costItems/gs', method: 'PUT', body: { amountCents: 61240, invoiceFile: 'bescheid.pdf' } })
  // Kein Lohnanteil gelesen: Der der Position bleibt, wie er ist.
  expect(sent[0]?.body).not.toHaveProperty('labor35aCents')
  // Der Beleg hatte nur diese Position, er ist damit erledigt.
  await screen.findByText('✓ übernommen', {}, SLOW)
  expect(sent.filter((s) => s.method === 'POST')).toEqual([])
})

test('Schnellerfassung im Januar: Beleg für das laufende Jahr, gewählt ist noch das Vorjahr → die Übernahme im Jahr des Belegs zählt', async () => {
  items = [estimate(YEAR + 1)]
  extraction = bescheid(YEAR + 1)
  const { container } = intake()
  await upload(container)
  await screen.findByRole('button', { name: /Diese übernehmen/ }, SLOW)
  expect(checkboxOf('Abgabenbescheid Grundbesitzabgaben').checked).toBe(false)
  expect(screen.getByRole('button', { name: /verknüpfen und Betrag auf 612,40/ })).toBeTruthy()
})

test('Schnellerfassung: bewusst als neue Position anlegen fragt nach', async () => {
  items = [estimate(YEAR)]
  extraction = bescheid(YEAR)
  const { container } = intake()
  await upload(container)
  await screen.findByRole('button', { name: /Diese übernehmen/ }, SLOW)
  fireEvent.click(checkboxOf('Abgabenbescheid Grundbesitzabgaben'))
  fireEvent.click(screen.getByRole('button', { name: /Diese übernehmen/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem anlegen' }, SLOW))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]).toMatchObject({ method: 'POST', body: { category: 'Grundsteuer', amountCents: 61240 } })
})

test('Schnellerfassung: ohne Kandidaten bleibt alles wie bisher, angehakt und ohne Rückfrage', async () => {
  items = [estimate(YEAR - 1)]
  extraction = bescheid(YEAR)
  const { container } = intake()
  await upload(container)
  await screen.findByRole('button', { name: /Diese übernehmen/ }, SLOW)
  expect(checkboxOf('Abgabenbescheid Grundbesitzabgaben').checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /Diese übernehmen/ }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]).toMatchObject({ method: 'POST' })
})

test('Kostenseite: dieselbe Abfrage bei der KI-Auswertung, Verknüpfen statt stillem Anlegen', async () => {
  items = [estimate(YEAR)]
  extraction = { ...bescheid(YEAR), positions: [{ description: 'Abgabenbescheid Grundbesitzabgaben', category: 'Grundsteuer', amountEur: 612.4, labor35aEur: 0 }] }
  const { container } = render(
    <YearProvider>
      <PropertyProvider>
        <UIProvider>
          <Kosten units={UNITS} settings={null} />
        </UIProvider>
      </PropertyProvider>
    </YearProvider>,
  )
  await upload(container)
  await screen.findByRole('button', { name: /Ausgewählte Positionen/ }, SLOW)
  expect(checkboxOf('Abgabenbescheid Grundbesitzabgaben').checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /verknüpfen und Betrag auf 612,40/ }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]).toMatchObject({ url: '/api/costItems/gs', method: 'PUT', body: { amountCents: 61240, invoiceFile: 'bescheid.pdf' } })
})

// Durchsicht: Zwei Belege derselben Kostenart in einem Lauf von „Alle grünen übernehmen“. Die Ampel
// rechnete mit dem Stand vor dem Lauf, also wurden beide angelegt. Positionen desselben Belegs
// (Frischwasser und Abwasser) bleiben davon unberührt.
test('Schnellerfassung: „Alle grünen übernehmen“ legt dieselbe Kostenart aus zwei Belegen nicht still zweimal an', async () => {
  items = []
  extraction = bescheid(YEAR)
  const { container } = intake()
  await upload(container)
  await screen.findByRole('button', { name: /Diese übernehmen/ }, SLOW)
  await upload(container)
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Diese übernehmen/ })).toHaveLength(2), SLOW)
  fireEvent.click(screen.getByRole('button', { name: /Alle grünen übernehmen/ }))
  await waitFor(() => expect(screen.getByText(/noch zu prüfen/)).toBeTruthy(), SLOW)
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1)
})
