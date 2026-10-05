// @vitest-environment jsdom
// Ein Jahr ganz ohne Kosten (#142): Die Berechnung erstattet dann jedem Mieter die volle
// Vorauszahlung. Cockpit und Kostenvergleich kündigten das als „voraussichtliches Guthaben“ an,
// und der Vergleich zeigte bei jeder Kostenart „−100 %“. Beides ist keine Auskunft, sondern die
// Folge davon, dass noch nichts erfasst ist.
import { calendarPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CostItem, Settlement, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'
import Uebersicht from './Uebersicht'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const VORJAHR: CostItem[] = [
  { id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR - 1), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000, key: 'area' },
  { id: 'k2', propertyId: 'objekt-1', period: calendarPeriod(YEAR - 1), category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'units' },
]
const settlementOhneKosten: Settlement = {
  year: YEAR, daysInYear: 365, landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null,
  statements: [{
    tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
    rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 240000, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 240000,
  }],
}

let costItems: CostItem[]

beforeEach(() => {
  costItems = VORJAHR
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/costItems': costItems,
      '/api/uploads': [{ file: '1_gs.pdf' }],
      [`/api/settlement/${YEAR}`]: settlementOhneKosten,
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

test('Cockpit: ohne Kosten im Jahr kein voraussichtliches Guthaben, sondern „Noch keine Kosten erfasst“', async () => {
  wrap(<Cockpit units={UNITS} tenancies={[]} settings={null} reload={async () => {}} onNavigate={() => {}} />)
  await screen.findByText(`Gesamtkosten ${YEAR}`, {}, SLOW)
  expect(screen.getByText(new RegExp(`Noch keine Kosten für ${YEAR} erfasst`))).toBeTruthy()
  expect(screen.queryByText('2.400,00 €', { exact: false })).toBeNull()
  expect(screen.queryByText(/^Guthaben$/)).toBeNull()
})

test('Kostenvergleich: ohne Kosten im Jahr keine −100-%-Abweichungen und kein Guthaben je Mieter', async () => {
  wrap(<Uebersicht onNavigate={() => {}} />)
  // Erst wenn die Daten da sind: Vor dem Laden steht derselbe Satz ohnehin da.
  await screen.findByText(`Gesamtkosten ${YEAR}`, {}, SLOW)
  expect(screen.getByText(new RegExp(`Für ${YEAR} sind noch keine Kosten erfasst`))).toBeTruthy()
  expect(screen.queryByText(/100\s*%/)).toBeNull()
  expect(screen.queryByText(/Auffällige Abweichung/)).toBeNull()
  expect(screen.queryByText(/Meier: Guthaben/)).toBeNull()
})

test('Kostenvergleich mit Kosten im Jahr: der Vergleich steht wie bisher', async () => {
  costItems = [...VORJAHR, { id: 'k3', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' }]
  wrap(<Uebersicht onNavigate={() => {}} />)
  await screen.findByText(/Auffällige Abweichung/, {}, SLOW)
  expect(screen.getAllByText(/\+100\s*%/).length).toBeGreaterThan(0)
})

test('Cockpit: fehlende Belege ergeben „Belege vollständig“ in Gelb, nie in Rot (#170)', async () => {
  costItems = [
    { id: 'k3', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area', invoiceFile: '1_gs.pdf' },
    { id: 'k4', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'units' },
  ]
  wrap(<Cockpit units={UNITS} tenancies={[]} settings={null} reload={async () => {}} onNavigate={() => {}} />)
  const titel = await screen.findByText('Belege vollständig', {}, SLOW)
  const zeile = titel.closest('.check-row')
  expect(zeile?.className).toMatch(/\bgelb\b/)
  expect(zeile?.textContent).toMatch(/1 von 2 Positionen ohne Beleg · 76 % der Kosten belegt/)
})
