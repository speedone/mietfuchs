// @vitest-environment jsdom
// Gutschriften in der Schnellerfassung (#139). postPosition übersprang jeden Betrag <= 0 still:
// Eine Gutschrift kam nie an, und eine Position mit 0 € verschwand, während der Beleg als
// „übernommen“ galt. Jetzt gilt dieselbe Prüfung wie im Kostenformular (amountProblem).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Extraction, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Schnellerfassung from './Schnellerfassung'
import Kosten from './Kosten'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]

let extraction: Extraction
let posted: Record<string, unknown>[]

beforeEach(() => {
  posted = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = (data: unknown) =>
      Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }))
    if (url === '/api/intake') return answer({ file: 'beleg.jpg', kind: 'rechnung', extraction })
    if (url === '/api/extract') return answer({ file: 'beleg.jpg', extraction })
    if (method === 'POST' && url.startsWith('/api/costItems')) posted.push(JSON.parse(String(init?.body)))
    return answer(method === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function evaluate() {
  const { container } = render(
    <YearProvider>
      <PropertyProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} />
      </PropertyProvider>
    </YearProvider>,
  )
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'beleg.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: /Diese übernehmen/ })
}

const checkboxOf = (description: string) => {
  const row = screen.getByDisplayValue(description).closest('tr')
  if (!row) throw new Error(`Keine Zeile zu „${description}“`)
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement
}

test('eine Gutschrift wird übernommen und ist in der Vorschau als solche zu erkennen', async () => {
  extraction = {
    vendor: 'Versicherung AG', invoiceDate: '2025-03-01',
    positions: [{ description: 'Beitragsrückerstattung', category: 'Sach- und Haftpflichtversicherung', amountEur: -54 }],
  }
  await evaluate()
  expect(screen.getAllByText(/Gutschrift/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /Diese übernehmen/ }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ description: 'Beitragsrückerstattung', amountCents: -5400 })
})

test('eine Position mit 0 € wird nicht still verworfen, sondern als nicht übernehmbar markiert', async () => {
  extraction = {
    vendor: 'Stadtwerke', invoiceDate: '2025-03-01',
    positions: [
      { description: 'Frischwasser', category: 'Wasser/Abwasser', amountEur: 12.5 },
      { description: 'Grundgebühr', category: 'Wasser/Abwasser', amountEur: 0 },
    ],
  }
  await evaluate()
  // Sichtbar markiert und nicht vorab angehakt
  expect(screen.getAllByText(/Nicht übernehmbar: Ein Betrag von 0 €/).length).toBeGreaterThan(0)
  expect(checkboxOf('Grundgebühr').checked).toBe(false)
  // Wer sie trotzdem anhakt, bekommt eine Meldung statt eines stillen Auslassens
  fireEvent.click(checkboxOf('Grundgebühr'))
  fireEvent.click(screen.getByRole('button', { name: /Diese übernehmen/ }))
  await waitFor(() => expect(screen.getByText(/„Grundgebühr“: Ein Betrag von 0 €/)).toBeTruthy())
  expect(posted).toEqual([])
  expect(screen.getByRole('button', { name: /Diese übernehmen/ })).toBeTruthy()
})

test('Kosten: dieselbe Regel beim Übernehmen aus der Auswertung', async () => {
  extraction = {
    vendor: 'Stadtwerke', invoiceDate: '2025-03-01',
    positions: [
      { description: 'Rückerstattung', category: 'Wasser/Abwasser', amountEur: -20 },
      { description: 'Grundgebühr', category: 'Wasser/Abwasser', amountEur: 0 },
    ],
  }
  const { container } = render(
    <YearProvider>
      <PropertyProvider>
        <Kosten units={UNITS} settings={null} />
      </PropertyProvider>
    </YearProvider>,
  )
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'beleg.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: /Ausgewählte Positionen/ })
  expect(checkboxOf('Grundgebühr').checked).toBe(false)
  fireEvent.click(checkboxOf('Grundgebühr'))
  fireEvent.click(screen.getByRole('button', { name: /Ausgewählte Positionen/ }))
  await waitFor(() => expect(screen.getByText(/„Grundgebühr“: Ein Betrag von 0 €/)).toBeTruthy())
  expect(posted).toEqual([])
  fireEvent.click(checkboxOf('Grundgebühr'))
  fireEvent.click(screen.getByRole('button', { name: /Ausgewählte Positionen/ }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ description: 'Rückerstattung', amountCents: -2000 })
})
