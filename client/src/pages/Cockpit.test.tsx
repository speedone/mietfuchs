// @vitest-environment jsdom
// Die Zeile „Zählerstände“ im Cockpit mit eigener Heizkostenabrechnung (#721, Durchsicht S7). Die Logik prüft
// meterCheck.test.ts (`selfHeatingReadings`); hier steht, was die Seite daraus macht: Farbe, Text, Sprungziel und die
// Reihenfolge gegenüber der gelben Zeile „Heizposition ohne Verbrauch“ (#140). Muster: cockpitSprungziele.test.tsx.
import { afterEach, assert, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CostItem, HeatingStatement, Notice, SelfHeatingStatement, Settings, Settlement, Statement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNIT: Unit = { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }
const TENANCY: Tenancy = {
  id: 't1', unitId: 'u1', tenantName: 'Mieter A', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
}
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Mieter A', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`, rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 0,
  prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0,
}
// Eine Heizposition nach Wohnfläche: Keine Position trägt den Schlüssel „nach Zähler“.
const GAS: CostItem = { id: 'gas', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: HEATING_CATEGORY, description: 'Gas', amountCents: 120000, key: 'area' }
const self = (over: Partial<SelfHeatingStatement> = {}): SelfHeatingStatement => ({
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'combined', alpha: null, shares: null, pots: [], units: [], ...over,
})
const heating = (s: SelfHeatingStatement): HeatingStatement => ({
  plantId: 'hp1', plantName: 'Kessel', energy: 'gas', period: calendarPeriod(YEAR), from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, co2: null, self: s,
})
const notice = (code: string, level: Notice['level'], text: string, subject: Notice['subject']): Notice => ({ code, level, title: code, text, subject })
const NOT_BY_CONSUMPTION = notice('heating.not-by-consumption', 'warning', '„Gas“ wird nicht nach Verbrauch verteilt.', { kind: 'costItem', id: 'gas' })
const INCOMPLETE = notice('heating.self-incomplete', 'error', `Heizanlage „Kessel“, Heizperiode ${YEAR}: Für „WZ EG“ (EG) fehlt ein Stand zum 31.12.${YEAR}. Tragen Sie ihn ein.`, { kind: 'heatingCosts', id: 'hp1' })

function page(settlement: Partial<Settlement>): ReturnType<typeof vi.fn> {
  const full: Settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents: 0, totalCostsCents: 120000, warnings: [], notices: [], closed: null, statements: [STATEMENT], ...settlement,
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}` || path === `/api/settlement/${YEAR - 1}`) return json(full)
    if (path === '/api/costItems') return json([GAS])
    if (path === '/api/upcoming') return json({ today: `${YEAR + 1}-11-20`, until: `${YEAR + 2}-02-18`, items: [] })
    if (path === '/api/bank/open-count') return json({ count: 0 })
    return json([])
  })
  const navigate = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Cockpit units={[UNIT]} tenancies={[TENANCY]} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={navigate} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  return navigate
}

// Die einzige Zeile „Zählerstände“.
async function meterRow(): Promise<HTMLElement> {
  const rows = (await screen.findAllByText('Zählerstände', { selector: '.check-title' }, SLOW)).map((t) => t.closest<HTMLElement>('.check-row'))
  expect(rows).toHaveLength(1)
  return rows[0] ?? assert.fail('Zeile „Zählerstände“ fehlt')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('eigene Heizkostenabrechnung vollständig, keine Position „nach Zähler“: grün mit den Ständen der Heizperiode', async () => {
  page({ heating: [heating(self())] })
  const row = await meterRow()
  expect(row.classList.contains('gruen')).toBe(true)
  expect(row.textContent).toContain(`Eigene Heizkostenabrechnung: Die Stände für die Heizperiode 01.01.${YEAR} bis 31.12.${YEAR} sind vollständig.`)
  expect(row.textContent).not.toMatch(/Ablesungen nicht erforderlich/)
})

test('Durchsicht S7: unvollständige eigene Heizkostenabrechnung geht vor der gelben Zeile „Heizposition ohne Verbrauch“, rot mit Sprungziel', async () => {
  const navigate = page({ heating: [heating(self({ ok: false }))], notices: [NOT_BY_CONSUMPTION, INCOMPLETE] })
  const row = await meterRow()
  expect(row.classList.contains('rot')).toBe(true)
  expect(row.textContent).toMatch(/Für die eigene Heizkostenabrechnung fehlt noch:/)
  expect(row.textContent).toContain(`Für „WZ EG“ (EG) fehlt ein Stand zum 31.12.${YEAR}.`)
  fireEvent.click(row)
  expect(navigate).toHaveBeenCalledWith('zaehler', undefined)
})

test('eigene Heizkostenabrechnung nach Vereinbarung „nach Wohnfläche“: Ablesungen nicht erforderlich', async () => {
  page({ heating: [heating(self({ agreedArea: true }))] })
  const row = await meterRow()
  expect(row.textContent).toMatch(/Keine verbrauchsabhängige Umlage - Ablesungen nicht erforderlich\./)
})
