// @vitest-environment jsdom
// Erfassen aus der Abnahme (#142): Hinweis auf eine abgeschlossene Abrechnung auf der Kostenseite
// und die Vorbelegungen von Umlageschlüssel, Zahlungsdatum und Wohnung.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Meter, RentLedger, Tenancy, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'
import Mietkonto from './Mietkonto'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [
  { id: 'eigen', propertyId: 'objekt-1', name: 'EG selbst', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
  { id: 'belegt', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
  { id: 'frei', propertyId: 'objekt-1', name: 'DG', areaM2: 40, participates: true },
]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'belegt', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const METERS: Meter[] = [
  { id: 'm1', propertyId: 'objekt-1', name: 'Wasser OG', unitId: 'belegt', type: 'kaltwasser', unit: 'm³' },
  { id: 'm2', propertyId: 'objekt-1', name: 'Wasser DG', unitId: 'frei', type: 'kaltwasser', unit: 'm³' },
]
const month = (m: number) => ({ month: m, baseRentCents: 50000, prepaymentCents: 0, flatRateCents: 0, sollCents: 50000, paidCents: 0, status: 'open' as const })
const LEDGER: RentLedger = {
  year: YEAR,
  rows: [{ tenancyId: 't1', tenantName: 'Meier', unitName: 'OG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)), sollYearCents: 600000, baseRentYearCents: 600000, prepaymentYearCents: 0, flatRateYearCents: 0, paidYearCents: 0, balanceCents: -600000, dueSollCents: 600000, arrearsCents: 600000, openMonths: 12 }],
  totals: { sollYearCents: 600000, paidYearCents: 0, openCents: 600000 },
}

let closed: { closedAt: string, sentAt: string | null } | null
let sent: { url: string, body: Record<string, unknown> }[]

beforeEach(() => {
  closed = null
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ ok: true })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/meters': METERS,
      '/api/tenancies': TENANCIES,
      [`/api/rentledger/${YEAR}`]: LEDGER,
      [`/api/settlement/${YEAR}`]: { year: YEAR, statements: [], closed },
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(
  <YearProvider>
    <PropertyProvider>
      <UIProvider>{node}</UIProvider>
    </PropertyProvider>
  </YearProvider>,
)

test('Kosten: ist die Abrechnung des Jahres abgeschlossen, steht das oben, und Bearbeiten bleibt möglich', async () => {
  closed = { closedAt: `${YEAR + 1}-02-01T10:00:00.000Z`, sentAt: null }
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  await screen.findByText(new RegExp(`Die Abrechnung ${YEAR} ist abgeschlossen`), {}, SLOW)
  expect(screen.getByText(/als Abweichung/)).toBeTruthy()
  expect((screen.getByRole('button', { name: /Kostenposition manuell erfassen/ }) as HTMLButtonElement).disabled).toBe(false)
})

test('Kosten: im Entwurf kein solcher Hinweis', async () => {
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  await screen.findByRole('button', { name: /Kostenposition manuell erfassen/ }, SLOW)
  // Die Abfrage der Abrechnung ist durch, bevor geprüft wird.
  await new Promise((r) => setTimeout(r, 100))
  expect(screen.queryByText(/ist abgeschlossen/)).toBeNull()
})

test('Kosten: Wasser/Abwasser bei Kaltwasserzählern schlägt „nach Verbrauch“ vor, und gespeichert wird, was zu sehen ist', async () => {
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/ }, SLOW))
  // Die Zähler kommen nach der Seite; erst mit ihnen gibt es den Verbrauchsschlüssel.
  await waitFor(() => expect([...(screen.getByLabelText(/Umlageschlüssel/) as HTMLSelectElement).options].some((o) => o.value === 'meter')).toBe(true), SLOW)
  fireEvent.change(screen.getByLabelText(/Kostenart/), { target: { value: 'Wasser/Abwasser' } })
  const key = screen.getByLabelText(/Umlageschlüssel/) as HTMLSelectElement
  expect(key.value).toBe('meter')
  const type = screen.getByLabelText(/Zählertyp/) as HTMLSelectElement
  expect(type.value).toBe('kaltwasser')
  expect(type.selectedOptions[0]?.value).toBe('kaltwasser')
  fireEvent.change(screen.getByLabelText(/Beschreibung/), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/), { target: { value: '100,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.body).toMatchObject({ key: 'meter', meterType: 'kaltwasser' })
})

test('Mietkonto: eine neue Zahlung im früheren Jahr steht nicht auf heute, sondern im gewählten Jahr', async () => {
  wrap(<Mietkonto />)
  const knopf = await screen.findByRole('button', { name: /Zahlung erfassen/ }, SLOW)
  await waitFor(() => expect((knopf as HTMLButtonElement).disabled).toBe(false), SLOW)
  fireEvent.click(knopf)
  const datum = screen.getByLabelText(/Datum/) as HTMLInputElement
  expect(datum.value).toBe(`${YEAR}-12-31`)
})

test('Stammdaten: ein neues Mietverhältnis wählt die erste freie vermietbare Wohnung vor, nicht die selbstgenutzte', async () => {
  wrap(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis hinzufügen/ }, SLOW))
  const wohnung = screen.getByRole('combobox', { name: /^Wohnung/ }) as HTMLSelectElement
  expect(wohnung.value).toBe('frei')
})
