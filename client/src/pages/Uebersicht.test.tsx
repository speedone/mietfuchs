// @vitest-environment jsdom
// Sichtprüfung E48: Der Kostenvergleich gruppierte nach dem Schlüssel der Position. Mit eigener
// Heizperiode standen „2023-05“ und „2024-05“ als eigene Jahre da, die Summe wich von der Kennzahl ab,
// und die Heizkosten fehlten im Jahr ihrer Abrechnung.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { CostItem, Settlement } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Uebersicht from './Uebersicht'
import { calendarYearPeriod, periodKey, settlementPeriod } from '../../../shared/period.ts'

const YEAR = new Date().getFullYear() - 1
const SLOW = { timeout: 5000 }
const PLANT = { id: 'hp1', periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: `${YEAR}-05`, until: null }] }
const item = (id: string, period: string, category: string, amountCents: number, heatingPlantId?: string): CostItem =>
  ({ id, propertyId: 'objekt-1', period: periodKey(period), category, description: id, amountCents, key: 'area', ...(heatingPlantId ? { heatingPlantId } : {}) })

let items: CostItem[]
let settlement: Settlement

beforeEach(() => {
  settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`,
    statements: [{ tenancyId: 't1', unitId: 'u1', tenantName: 'Becker', unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
      rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 100000, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 100000 }],
    landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null,
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/costItems') return json(items)
    if (path === '/api/heating-plants') return json([PLANT])
    if (path.startsWith('/api/settlement/')) return json(settlement)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = () => render(<PeriodProvider><PropertyProvider><Uebersicht onNavigate={() => {}} /></PropertyProvider></PeriodProvider>)

test('Heizung im Jahr, in dem ihre Heizperiode endet; Summe gleich Kennzahl; keine Schlüssel als Jahre', async () => {
  items = [
    item('g1', `${YEAR - 1}-01`, 'Grundsteuer', 50000), item('h1', `${YEAR - 2}-05`, 'Heizung und Warmwasser', 400000, 'hp1'),
    item('g2', `${YEAR}-01`, 'Grundsteuer', 60000), item('h2', `${YEAR - 1}-05`, 'Heizung und Warmwasser', 480000, 'hp1'),
  ]
  settlement = { ...settlement, totalCostsCents: 540000 }
  show()
  const verlauf = (await screen.findByText('Gesamtkosten im Verlauf', {}, SLOW)).closest('.card') as HTMLElement
  expect(within(verlauf).queryByText(/-05/)).toBeNull()
  expect(within(verlauf).getByText(String(YEAR - 1))).toBeTruthy()
  expect(screen.getAllByText('5.400,00 €').length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText('Heizung und Warmwasser')).toBeTruthy()
})

test('getrennt abgerechnete Heizkosten: Kennzahl mit ihnen, Satz dazu, keine Salden ohne Betriebskosten', async () => {
  // Gewählt ist YEAR; die Heizperiode ab Mai des Vorjahres endet darin und wird getrennt abgerechnet.
  items = [item('h2', `${YEAR - 1}-05`, 'Heizung und Warmwasser', 300000, 'hp1')]
  PLANT.separateSpans = [{ from: `${YEAR - 1}-05`, until: null }]
  show()
  await screen.findByText(/Darin 3\.000,00 € Heizkosten, die eine eigene Heizkostenabrechnung abrechnet/, {}, SLOW)
  expect(screen.getAllByText('3.000,00 €').length).toBeGreaterThanOrEqual(1)
  expect(screen.queryByText(/Becker: Guthaben/)).toBeNull()
  PLANT.separateSpans = [{ from: `${YEAR}-05`, until: null }]
})
