// @vitest-environment jsdom
// Kein doppeltes Anlegen aus einem Seitenfenster (#346 Schritt 7, Durchsicht S1): Ein Doppelklick auf „Anlegen“ oder
// „Speichern“ schickt genau eine Anfrage, je Aufrufer des Drawers. Ablesung und Zähler prüft Zaehler.test.tsx, die
// Lieferung FuelCard.test.tsx, den Mieterwechsel tenantChange.test.tsx.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'
import Mietkonto from './Mietkonto'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const LEDGER = {
  year: 2025,
  rows: [{ tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: [], sollYearCents: 0, paidYearCents: 0, balanceCents: 0 }],
  totals: { sollCents: 0, paidCents: 0, openCents: 0 },
}
let posts: string[]

beforeEach(() => {
  posts = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') {
      posts.push(`${method} ${url.split('?')[0]}`)
      return json({ id: 'neu' })
    }
    const path = url.split('?')[0] ?? url
    if (path.startsWith('/api/rentledger/')) return json(LEDGER)
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/tenancies': TENANCIES,
      '/api/units': UNITS,
    }
    return json(responses[path] ?? [])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = (page: ReactNode) => render(<PeriodProvider><PropertyProvider><UIProvider>{page}</UIProvider></PropertyProvider></PeriodProvider>)
const doubleClick = (name: RegExp) => {
  const knopf = within(screen.getByRole('dialog')).getByRole('button', { name })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
}

test('Wohnung: Doppelklick auf „Anlegen“ legt genau eine an', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung anlegen/ }, SLOW))
  const box = screen.getByRole('dialog')
  fireEvent.change(within(box).getByLabelText(/^Name/), { target: { value: 'OG' } })
  fireEvent.change(within(box).getByLabelText(/^Wohnfläche/), { target: { value: '70' } })
  doubleClick(/^Anlegen$/)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
  expect(posts).toEqual(['POST /api/units'])
})

test('Zahlung: Doppelklick auf „Speichern“ legt genau eine an', async () => {
  shell(<Mietkonto />)
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/ }, SLOW)
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false), SLOW)
  fireEvent.click(add)
  const box = screen.getByRole('dialog')
  fireEvent.change(within(box).getByLabelText(/^Mietverhältnis/), { target: { value: 't1' } })
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-03-03' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '800' } })
  doubleClick(/^Speichern$/)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
  expect(posts).toEqual(['POST /api/payments'])
})

test('Kostenposition: Doppelklick auf „Anlegen“ legt genau eine an', async () => {
  shell(<Kosten units={UNITS} settings={null} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/ }, SLOW))
  const box = screen.getByRole('dialog')
  fireEvent.change(within(box).getByLabelText(/^Beschreibung/), { target: { value: 'Grundsteuer' } })
  fireEvent.change(within(box).getByLabelText(/^Betrag/), { target: { value: '100' } })
  doubleClick(/^Anlegen$/)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
  expect(posts.filter((p) => p === 'POST /api/costItems')).toHaveLength(1)
})
