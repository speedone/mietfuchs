// @vitest-environment jsdom
// Die Zeile im Cockpit vor dem Versand (#229): Ist ein Mieter ausgezogen und fehlt die neue Anschrift, nennt das Cockpit
// ihn beim Namen und springt zum Mietverhältnis; mit Anschrift oder nach dem Versand gibt es die Zeile nicht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings, Settlement, Statement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Müller', unitName: 'EG', persons: 1, days: 181, personDays: 181,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-06-30`, rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 0,
  prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0,
}
let settlement: Settlement
const tenancy = (patch: Partial<Tenancy> = {}): Tenancy => ({
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01',
  end: `${YEAR}-06-30`, prepayments: [], prepaymentOverrides: {}, baseRents: [], ...patch,
})

beforeEach(() => {
  settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null, statements: [STATEMENT],
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (tenancies: Tenancy[], onNavigate: (tab: string, focus?: unknown) => void = () => {}) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={UNITS} tenancies={tenancies} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={onNavigate} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('ausgezogen ohne neue Anschrift: eine gelbe Zeile mit Namen, Frist und Sprung zum Mietverhältnis', async () => {
  const navigate = vi.fn()
  page([tenancy()], navigate)
  const title = await screen.findByText('Anschrift für den Versand', {}, SLOW)
  const row = title.closest('.check-row')
  expect(row?.classList.contains('gelb')).toBe(true)
  expect(row?.textContent).toMatch(/Müller ist ausgezogen, ohne dass eine neue Anschrift eingetragen ist.*§ 556 Abs\. 3 BGB/)
  fireEvent.click(row as HTMLElement)
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't1' })
})

test('mit neuer Anschrift oder nach dem Versand keine Zeile', async () => {
  page([tenancy({ correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' })])
  await screen.findByText('Abgeschlossen & versendet', {}, SLOW)
  expect(screen.queryByText('Anschrift für den Versand')).toBeNull()
  cleanup()
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-01-10T10:00:00Z`, sentAt: `${YEAR + 1}-01-11` } }
  page([tenancy()])
  await screen.findByText('Abgeschlossen & versendet', {}, SLOW)
  expect(screen.queryByText('Anschrift für den Versand')).toBeNull()
})
