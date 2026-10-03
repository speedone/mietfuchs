// @vitest-environment jsdom
// Doppelungen im Kostenformular (Befund A): Eine neue Position derselben Kostenart fragt nach,
// statt still eine zweite anzulegen. Der Weg über die KI-Auswertung (Schnellerfassung und
// Kostenseite) steht seit der Belegbuchung (#170) in booking.test.tsx.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CostItem, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
// Die Seiten öffnen im Vorjahr des Kalenderjahres (year.tsx).
const YEAR = new Date().getFullYear() - 1

let items: CostItem[]
let sent: { url: string; method: string; body: Record<string, unknown> }[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ url, method, body })
      // Die Seite lädt danach neu; die Position trägt dann Betrag und Beleg.
      if (method === 'PUT') items = items.map((i) => (url.startsWith(`/api/costItems/${i.id}`) ? { ...i, ...body } : i))
      // Wie der Server: Eine angelegte Position steht danach in der Liste und kommt zurück.
      if (method === 'POST' && url.startsWith('/api/costItems')) {
        const created = { ...(body as unknown as CostItem), id: `neu-${sent.length}`, propertyId: 'objekt-1' }
        items = [...items, created]
        return json(created)
      }
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

const kostenPage = () => render(
  <YearProvider>
    <PropertyProvider>
      <UIProvider>
        <Kosten units={UNITS} settings={null} />
      </UIProvider>
    </PropertyProvider>
  </YearProvider>,
)

async function fillNewGrundsteuer() {
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/ }, SLOW))
  fireEvent.change(screen.getByLabelText(/Kostenart/), { target: { value: 'Grundsteuer' } })
  fireEvent.change(screen.getByLabelText(/Beschreibung/), { target: { value: 'Grundsteuerbescheid' } })
  fireEvent.change(screen.getByLabelText(/Betrag/), { target: { value: '612,40' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/ }))
}

test('Kostenformular: eine neue Position derselben Kostenart fragt nach; „Stattdessen bearbeiten“ öffnet die vorhandene', async () => {
  items = [estimate(YEAR)]
  kostenPage()
  await screen.findByText(`Grundsteuer ${YEAR}`, {}, SLOW)
  await fillNewGrundsteuer()
  fireEvent.click(await screen.findByRole('button', { name: `Stattdessen „Grundsteuer ${YEAR}“ bearbeiten` }, SLOW))
  await waitFor(() => expect((screen.getByLabelText(/Beschreibung/) as HTMLInputElement).value).toBe(`Grundsteuer ${YEAR}`), SLOW)
  expect(sent).toEqual([])
})

test('Kostenformular: „Trotzdem anlegen“ legt an; beim Bearbeiten wird nicht gefragt', async () => {
  items = [estimate(YEAR)]
  kostenPage()
  await screen.findByText(`Grundsteuer ${YEAR}`, {}, SLOW)
  await fillNewGrundsteuer()
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem anlegen' }, SLOW))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]).toMatchObject({ method: 'POST', body: { description: 'Grundsteuerbescheid', amountCents: 61240 } })
  // Bearbeiten der vorhandenen: keine Rückfrage
  fireEvent.click((await screen.findAllByRole('button', { name: 'Kostenposition bearbeiten' }, SLOW))[0]!)
  fireEvent.change(screen.getByLabelText(/Betrag/), { target: { value: '615,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^(Übernehmen|Speichern)$/ }))
  await waitFor(() => expect(sent).toHaveLength(2), SLOW)
  expect(sent[1]).toMatchObject({ method: 'PUT', url: '/api/costItems/gs' })
  expect(screen.queryByRole('button', { name: 'Trotzdem anlegen' })).toBeNull()
})
