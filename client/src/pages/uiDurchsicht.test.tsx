// @vitest-environment jsdom
// Durchsicht von #236: Hinweise der Abrechnung nach Stufe auf- oder zugeklappt, und die Dateiauswahl
// „Beleg hochladen …“ bleibt per Tastatur erreichbar.
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CostItem, Settlement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import Kosten from './Kosten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const COSTS: CostItem[] = [
  { id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer A', amountCents: 50000, key: 'area' },
]
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 50000,
  warnings: ['Text Fehler', 'Text Warnung', 'Text Hinweis'],
  notices: [
    { code: 'a', level: 'error', title: 'Titel Fehler', text: 'Text Fehler' },
    { code: 'b', level: 'warning', title: 'Titel Warnung', text: 'Text Warnung' },
    { code: 'c', level: 'hint', title: 'Titel Hinweis', text: 'Text Hinweis' },
  ],
  closed: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': COSTS,
      '/api/tenancies': TENANCIES,
      [`/api/settlement/${YEAR}`]: SETTLEMENT,
    }
    return new Response(JSON.stringify(responses[path] ?? []), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(
  <PeriodProvider><PropertyProvider><UIProvider>{node}</UIProvider></PropertyProvider></PeriodProvider>,
)

test('Fehler und Warnungen stehen aufgeklappt da, Hinweise zugeklappt', async () => {
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} onNavigate={() => {}} />)
  const details = (title: string) => screen.getByText(title).closest('details')
  await screen.findByText('Titel Fehler', {}, SLOW)
  expect(details('Titel Fehler')?.open).toBe(true)
  expect(details('Titel Warnung')?.open).toBe(true)
  expect(details('Titel Hinweis')?.open).toBe(false)
})

test('„Beleg hochladen …“: das Dateifeld ist nur visuell versteckt und lässt sich fokussieren', async () => {
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/i }, SLOW))
  const label = await screen.findByText(/Beleg hochladen …/, {}, SLOW)
  const input = label.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) return expect.fail('Kein Dateifeld im Knopf „Beleg hochladen …“')
  expect(input.hidden).toBe(false)
  expect(input.style.display).not.toBe('none')
  expect(input.classList.contains('sr-only')).toBe(true)
  input.focus()
  expect(document.activeElement).toBe(input)
})
