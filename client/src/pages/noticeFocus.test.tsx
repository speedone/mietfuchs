// @vitest-environment jsdom
// „Hier beheben →“ führt zum Eintrag, nicht nur zur Seite (#142). Die Abrechnung reicht den
// betroffenen Eintrag mit; die Zielseite öffnet ihn, sobald er geladen ist, und meldet das zurück,
// damit ein späterer Besuch der Seite nicht noch einmal etwas aufklappt.
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CostItem, Meter, NoticeSubject, RentLedger, Settlement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import Kosten from './Kosten'
import Stammdaten from './Stammdaten'
import Zaehler from './Zaehler'
import Mietkonto from './Mietkonto'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
  { id: 't2', unitId: 'u2', tenantName: 'Schulz', persons: 2, personHistory: [{ from: '2020-01-01', persons: 2 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const COSTS: CostItem[] = [
  { id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer A', amountCents: 50000, key: 'area' },
  { id: 'k2', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Müllabfuhr', description: 'Müll B', amountCents: 30000, key: 'units' },
]
const METERS: Meter[] = [
  { id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' },
  { id: 'm2', propertyId: 'objekt-1', name: 'Wasser OG', unitId: 'u2', type: 'kaltwasser', unit: 'm³' },
]
const month = (m: number) => ({ month: m, baseRentCents: 50000, prepaymentCents: 0, flatRateCents: 0, sollCents: 50000, paidCents: 0, status: 'open' as const })
const ledgerRow = (id: string, name: string) => ({
  tenancyId: id, tenantName: name, unitName: 'EG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
  sollYearCents: 600000, baseRentYearCents: 600000, prepaymentYearCents: 0, flatRateYearCents: 0, paidYearCents: 0,
  balanceCents: -600000, dueSollCents: 600000, arrearsCents: 600000, openMonths: 12,
})
const LEDGER: RentLedger = { year: YEAR, rows: [ledgerRow('t1', 'Meier'), ledgerRow('t2', 'Schulz')], totals: { sollYearCents: 1200000, paidYearCents: 0, openCents: 1200000 } }
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 80000,
  warnings: ['Müll B: Schlüssel prüfen'], notices: [{ code: 'x', level: 'warning', title: 'Schlüssel prüfen', text: 'Müll B: Schlüssel prüfen', subject: { kind: 'costItem', id: 'k2' } }],
  closed: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': COSTS,
      '/api/meters': METERS,
      '/api/tenancies': TENANCIES,
      [`/api/rentledger/${YEAR}`]: LEDGER,
      [`/api/settlement/${YEAR}`]: SETTLEMENT,
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>{node}</UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('Abrechnung: „Hier beheben →“ reicht Seite und Eintrag weiter', async () => {
  const onNavigate = vi.fn()
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} onNavigate={onNavigate} />)
  fireEvent.click(await screen.findByRole('button', { name: /Hier beheben → Kosten/ }, SLOW))
  expect(onNavigate).toHaveBeenCalledWith('kosten', { kind: 'costItem', id: 'k2' })
})

test('Kosten: die betroffene Position öffnet sich zum Bearbeiten', async () => {
  const done = vi.fn()
  const focus: NoticeSubject = { kind: 'costItem', id: 'k2' }
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} focus={focus} onFocusDone={done} />)
  await screen.findByText('Kostenposition bearbeiten', {}, SLOW)
  expect((screen.getByLabelText(/Beschreibung/) as HTMLInputElement).value).toBe('Müll B')
  expect(done).toHaveBeenCalled()
})

test('Stammdaten: das betroffene Mietverhältnis öffnet sich zum Bearbeiten', async () => {
  const done = vi.fn()
  wrap(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} focus={{ kind: 'tenancy', id: 't2' }} onFocusDone={done} />)
  await screen.findByText('Mietverhältnis bearbeiten', {}, SLOW)
  expect((screen.getByLabelText(/^Mieter$/) as HTMLInputElement).value).toBe('Schulz')
  expect(done).toHaveBeenCalled()
})

test('Stammdaten: die betroffene Wohnung öffnet sich zum Bearbeiten', async () => {
  wrap(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} focus={{ kind: 'unit', id: 'u2' }} onFocusDone={() => {}} />)
  await screen.findByText('Wohnung bearbeiten', {}, SLOW)
  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('OG')
})

test('Zähler: die Ablesungen des betroffenen Zählers klappen auf', async () => {
  const done = vi.fn()
  wrap(<Zaehler units={UNITS} focus={{ kind: 'meter', id: 'm2' }} onFocusDone={done} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /Ablesung speichern/ })).toBeTruthy(), SLOW)
  const row = document.querySelector('.focus-target')
  expect(row?.textContent).toContain('Wasser OG')
  expect(done).toHaveBeenCalled()
})

test('Mietkonto: die Zeile des Mietverhältnisses ist hervorgehoben', async () => {
  const done = vi.fn()
  wrap(<Mietkonto focus={{ kind: 'rentLedger', id: 't2' }} onFocusDone={done} />)
  await waitFor(() => expect(document.querySelector('.focus-target')?.textContent).toContain('Schulz'), SLOW)
  expect(done).toHaveBeenCalled()
})
