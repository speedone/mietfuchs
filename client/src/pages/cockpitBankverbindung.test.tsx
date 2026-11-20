// @vitest-environment jsdom
// Die Zeile im Cockpit vor dem Versand (Systemprüfung): Hat ein Mieter eine Nachzahlung und bittet das Anschreiben um
// Überweisung, ohne ein Konto zu nennen, steht das als offener Punkt da; mit IBAN, bei Guthaben und nach dem Versand nicht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings, Settlement, Statement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { lettersOf } from '../../../shared/letter.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const PROPERTY = { id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh' as const, address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }
const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01',
  end: null, prepayments: [{ from: '2020-01', monthlyCents: 4000 }], prepaymentOverrides: {}, baseRents: [],
}]
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Müller', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`, rows: [], totalShareCents: 60000, total35aCents: 0, prepaymentCents: 48000,
  prepaymentOverridden: false, suggestedMonthlyCents: 5000, balanceCents: -12000,
}
const settings = (iban: string) => ({ landlordName: 'Erika', iban, paymentDeadlineDays: 30 } as Settings)
let settlement: Settlement
function settle(iban: string, over: Partial<Statement> = {}, closed: Settlement['closed'] = null): Settlement {
  const base: Settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed, statements: [{ ...STATEMENT, ...over }],
  }
  return { ...base, letters: lettersOf(base, { settings: settings(iban), property: PROPERTY, tenancies: TENANCIES, installation: {}, propertyTexts: {}, own: {}, asOf: `${YEAR + 1}-10-30` }) }
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([PROPERTY])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (iban: string, onNavigate: (tab: string, focus?: unknown) => void = () => {}) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={UNITS} tenancies={TENANCIES} settings={settings(iban)} updateStatus={null} reload={async () => {}} onNavigate={onNavigate} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('Nachzahlung ohne IBAN im Anschreiben: eine gelbe Zeile mit Namen und Sprung zu „Zu prüfen“', async () => {
  const navigate = vi.fn()
  settlement = settle('')
  page('', navigate)
  const title = await screen.findByText('Bankverbindung für die Nachzahlung', {}, SLOW)
  const row = title.closest('.check-row')
  expect(row?.classList.contains('gelb')).toBe(true)
  expect(row?.textContent).toMatch(/Das Anschreiben an Müller bittet um Überweisung der Nachzahlung, nennt aber kein Konto\..*IBAN/)
  fireEvent.click(row as HTMLElement)
  expect(navigate).toHaveBeenCalledWith('abrechnung', { kind: 'section', section: 'checks' })
})

test('mit IBAN, bei einem Guthaben oder nach dem Versand keine Zeile', async () => {
  settlement = settle('DE02120300000000202051')
  page('DE02120300000000202051')
  await screen.findByText('Abgeschlossen & versendet', {}, SLOW)
  expect(screen.queryByText('Bankverbindung für die Nachzahlung')).toBeNull()
  cleanup()
  settlement = settle('', { prepaymentCents: 72000, balanceCents: 12000 })
  page('')
  await screen.findByText('Abgeschlossen & versendet', {}, SLOW)
  expect(screen.queryByText('Bankverbindung für die Nachzahlung')).toBeNull()
  cleanup()
  settlement = settle('', {}, { closedAt: `${YEAR + 1}-01-10T10:00:00Z`, sentAt: `${YEAR + 1}-01-11` })
  page('')
  await screen.findByText('Abgeschlossen & versendet', {}, SLOW)
  expect(screen.queryByText('Bankverbindung für die Nachzahlung')).toBeNull()
})
