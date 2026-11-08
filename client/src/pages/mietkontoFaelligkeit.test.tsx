// @vitest-environment jsdom
// Fälligkeit im Mietkonto (#334, Durchsicht S8): Plakette, Zeile je Karte mit Einzelheiten und Vorlesetext des
// Monatskästchens, aus den Daten des Servers. Der Stichtag kommt vom Server (`RentLedger.asOf`), nicht aus der Uhr.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { RentLedger, RentLedgerRow, RentMonth, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Mietkonto from './Mietkonto'

const YEAR = new Date().getFullYear()
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'u1', tenantName: 'Becker', persons: 1, personHistory: [], start: `${YEAR}-10-09`, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: `${YEAR}-10`, monthlyCents: 80000 }] }]
const empty = (m: number): RentMonth => ({ month: m, baseRentCents: 0, prepaymentCents: 0, flatRateCents: 0, sollCents: 0, paidCents: 0, status: 'paid', openPrepaymentCents: 0, openRentCents: 0 })
const due = (m: number, dueOn: string, creditExpectedBy: string, arrearsFrom: string): RentMonth => ({
  month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 0, status: 'notDue', openPrepaymentCents: 0, openRentCents: 80000, dueOn, creditExpectedBy, arrearsFrom,
})
const row = (months: RentMonth[]): RentLedgerRow => ({
  tenancyId: 't1', tenantName: 'Becker', unitName: 'EG', months, dueRule: { rule: 'startWorkday', agreed: false },
  sollYearCents: 240000, baseRentYearCents: 240000, prepaymentYearCents: 0, flatRateYearCents: 0,
  paidYearCents: 0, settlementYearCents: 0, balanceCents: -240000, dueSollCents: 0, arrearsCents: 0, openMonths: 0,
  notDemandableCents: 0, notDemandable: [], openingBalanceCents: 0, closingBalanceCents: -240000,
})
const months = (): RentMonth[] => [...Array.from({ length: 9 }, (_, i) => empty(i + 1)), due(10, `${YEAR}-10-13`, `${YEAR}-10-19`, `${YEAR}-10-20`), due(11, `${YEAR}-11-04`, `${YEAR}-11-10`, `${YEAR}-11-11`), due(12, `${YEAR}-12-03`, `${YEAR}-12-09`, `${YEAR}-12-10`)]
let ledger: RentLedger

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, state: 'NW' }],
      '/api/tenancies': TENANCIES,
      '/api/payments': [],
      '/api/units': UNITS,
    }
    const body = path.startsWith('/api/rentledger/') ? ledger : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = () => render(<PeriodProvider><PropertyProvider><UIProvider><Mietkonto /></UIProvider></PropertyProvider></PeriodProvider>)
const ledgerAt = (asOf: string, r: RentLedgerRow): RentLedger => ({
  year: YEAR, asOf, rows: [r], carriedOnly: [], settlementOnly: [],
  totals: { sollYearCents: r.sollYearCents, paidYearCents: 0, settlementYearCents: 0, openCents: r.arrearsCents, notDemandableCents: 0 },
})

test('vor dem Fälligkeitstag: „noch nichts fällig“ und „fällig am“, nicht „bisher bezahlt“', async () => {
  ledger = ledgerAt(`${YEAR}-10-12`, row(months()))
  shell()
  const card = (await screen.findByText(/^Becker/, undefined, { timeout: 5000 })).closest('section') ?? document.body
  expect(within(card).getByText('noch nichts fällig')).toBeTruthy()
  expect(within(card).queryByText('bisher bezahlt')).toBeNull()
  expect(within(card).getByText(/^Miete Oktober fällig am .+, 13\.10\./)).toBeTruthy()
  // Einzelheiten zum Aufklappen, nach der Regel des Mietverhältnisses und dem Land.
  expect(within(card).getByText(/spätestens am dritten Werktag fällig, der Samstag zählt nicht/).textContent).toMatch(/Nordrhein-Westfalen/)
  // Das Kästchen sagt den Fälligkeitstag auch dem Vorleser.
  const october = within(card).getByRole('button', { name: /^Okt/ })
  expect(october.textContent).toMatch(/fällig am 13\.10\./)
  expect(october.getAttribute('title')).toMatch(/zählt noch nicht als Rückstand · fällig am 13\.10\./)
})

test('zwischen Fälligkeit und erwartetem Eingang: neutral „fällig seit“, danach rot „offen seit“', async () => {
  ledger = ledgerAt(`${YEAR}-10-15`, row(months()))
  shell()
  let card = (await screen.findByText(/^Becker/, undefined, { timeout: 5000 })).closest('section') ?? document.body
  expect(within(card).getByText('fällig seit 13.10.')).toBeTruthy()
  expect(within(card).getByText('Miete Oktober fällig seit 13.10., Eingang erwartet bis 19.10.')).toBeTruthy()
  cleanup()
  const overdue = months().map((m) => (m.month === 10 ? { ...m, status: 'open' as const } : m))
  ledger = ledgerAt(`${YEAR}-10-20`, { ...row(overdue), arrearsCents: 80000, openMonths: 1 })
  shell()
  card = (await screen.findByText(/^Becker/, undefined, { timeout: 5000 })).closest('section') ?? document.body
  expect(within(card).getByText('800,00 € offen')).toBeTruthy()
  const line = within(card).getByText(`Miete Oktober offen seit 13.10.${YEAR}`)
  expect(line.closest('details')?.className).toMatch(/text-red/)
})
