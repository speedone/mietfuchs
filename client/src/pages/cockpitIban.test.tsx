// @vitest-environment jsdom
// Der Hinweis im Cockpit auf vermutlich falsch eingetragene IBANs (#279): dezent, ohne Ampel, mit
// Sprung zur Stelle, und nur, wenn es etwas zu sagen gibt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings, Settlement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null,
  statements: [],
}
const tenancy = (id: string, tenantName: string, iban?: string): Tenancy => ({
  id, unitId: 'u1', tenantName, persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...(iban === undefined ? {} : { iban }),
})
const settings = (iban: string) => ({ landlordName: 'Erika', iban, paymentDeadlineDays: 30 }) as Settings

let propertyIban: string | null

beforeEach(() => {
  propertyIban = null
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: propertyIban, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(SETTLEMENT)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (s: Settings, tenancies: Tenancy[], onNavigate: (tab: string, focus?: unknown) => void = () => {}) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={UNITS} tenancies={tenancies} settings={s} updateStatus={null} reload={async () => {}} onNavigate={onNavigate} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('ungültige IBANs: ein Hinweis nennt Ort und Grund und springt zur Stelle', async () => {
  const navigate = vi.fn()
  page(settings('DE00370400440532013000'), [
    tenancy('t1', 'Müller', 'DE89370400440532013000'),
    tenancy('t2', 'Schmidt', 'de00 1'),
    { ...tenancy('t3', 'Längst ausgezogen', 'DE00 2'), end: '2020-12-31' },
  ], navigate)
  expect(await screen.findByText('2 IBANs sind vermutlich falsch eingetragen', undefined, SLOW)).toBeTruthy()
  expect(screen.getByText(/^Einstellungen, Bankverbindung des Vermieters: Die Prüfziffer/)).toBeTruthy()
  expect(screen.getByText(/^Mietverhältnis „Schmidt“:/)).toBeTruthy()
  expect(screen.queryByText(/Mietverhältnis „Müller“/)).toBeNull()
  expect(screen.queryByText(/Längst ausgezogen/)).toBeNull()
  // Keine Zeile der Checkliste: Die IBAN ändert keine Zahl und färbt nichts.
  expect(screen.queryByText('IBAN', { selector: '.check-title' })).toBeNull()
  fireEvent.click(screen.getByText('Hier beheben → Mietverhältnis'))
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't2' })
  fireEvent.click(screen.getByText('Hier beheben → Einstellungen'))
  expect(navigate).toHaveBeenLastCalledWith('einstellungen', undefined)
})

test('hat das Objekt eine eigene IBAN, zählt die der Einstellungen nicht', async () => {
  propertyIban = 'DE00 3333'
  page(settings('DE00370400440532013000'), [])
  expect(await screen.findByText('Eine IBAN ist vermutlich falsch eingetragen', undefined, SLOW)).toBeTruthy()
  expect(screen.getByText(/^Objekt „Lindenweg 12“, abweichende Bankverbindung:/)).toBeTruthy()
  expect(screen.queryByText(/Einstellungen, Bankverbindung/)).toBeNull()
})

test('alles gültig oder leer: kein Hinweis', async () => {
  page(settings(''), [tenancy('t1', 'Müller', 'DE89 3704 0044 0532 0130 00'), tenancy('t2', 'Schmidt')])
  // Ein Jahr ohne Kosten und Mietverhältnisse in der Abrechnung: Das Cockpit zeigt den Einstieg.
  await screen.findByText(new RegExp(`Noch nichts für ${YEAR} erfasst`), {}, SLOW)
  expect(screen.queryByText(/IBAN/)).toBeNull()
})
