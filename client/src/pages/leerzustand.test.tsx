// @vitest-environment jsdom
// Leerzustände (#346, Schritt 10; UI-Durchsicht M14, N12, #341): Im leeren Bestand benennen Cockpit,
// Abrechnung und Stammdaten die fehlende Voraussetzung und führen mit einem Knopf dorthin. Kein „Entwurf“,
// keine „Frist in … Tagen“ ohne Daten, und kein gesperrter Knopf ohne sichtbaren Grund.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Settlement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'
import Abrechnung from './Abrechnung'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1
const EMPTY: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
  selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null, statements: [],
}
const UNIT: Unit = { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(EMPTY)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(<PeriodProvider><PropertyProvider><UIProvider>{node}</UIProvider></PropertyProvider></PeriodProvider>)

for (const [lage, units, tenancies, button] of [
  ['ohne Wohnung', [], [], 'Wohnung anlegen'],
  ['mit Wohnung, ohne Mietverhältnis', [UNIT], [], 'Mietverhältnis anlegen'],
] as const) {
  test(`Cockpit ${lage}: der erste Schritt mit Knopf, kein Entwurf und keine Frist`, async () => {
    const navigate = vi.fn()
    wrap(<Cockpit units={[...units]} tenancies={[...tenancies] as Tenancy[]} settings={null} updateStatus={null} reload={async () => {}} onNavigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: button }, SLOW))
    expect(navigate).toHaveBeenCalledWith('stammdaten')
    expect(document.querySelector('[data-empty-state]')).toBeTruthy()
    expect(screen.queryByText('Entwurf')).toBeNull()
    expect(screen.queryByText(/Frist in \d+ Tagen/)).toBeNull()
    // Kein Knopf in die Schnellerfassung, solange die Voraussetzung fehlt (N12).
    expect(screen.queryByRole('button', { name: /Schnellerfassung/ })).toBeNull()
  })

  test(`Abrechnung ${lage}: der erste Schritt mit Knopf statt „bitte Stammdaten prüfen“`, async () => {
    const navigate = vi.fn()
    wrap(<Abrechnung settings={null} units={[...units]} tenancies={[...tenancies] as Tenancy[]} reload={async () => {}} onNavigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: button }, SLOW))
    expect(navigate).toHaveBeenCalledWith('stammdaten')
    expect(screen.queryByText(/bitte Stammdaten prüfen/)).toBeNull()
    expect(screen.queryByText('Entwurf')).toBeNull()
    expect(screen.queryByRole('button', { name: /abschließen/ })).toBeNull()
  })
}

// Durchsicht S2: Abgeschlossen, aber nicht versendet, läuft die Frist weiter; Plakette und Zeile nennen sie.
test('Cockpit abgeschlossen ohne Versand: Frist als Plakette und in der Unterzeile, keine doppelte Zeile', async () => {
  const closed: Settlement = {
    ...EMPTY, totalCostsCents: 50000, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00Z`, sentAt: null },
    statements: [{
      tenancyId: 't1', unitId: 'u1', tenantName: 'A', unitName: 'EG', persons: 1, days: 365, personDays: 365, periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
      rows: [], totalShareCents: 0, prepaymentCents: 0, prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0, total35aCents: 0,
    }],
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(closed)
    return json([])
  })
  wrap(<Cockpit units={[UNIT]} tenancies={[]} settings={null} updateStatus={null} reload={async () => {}} onNavigate={() => {}} />)
  expect(await screen.findByText(/^Abgeschlossen, Versanddatum fehlt \(Frist am 31\.12\./, {}, SLOW)).toBeTruthy()
  expect(screen.getByText(/Frist in \d+ Tagen|Frist abgelaufen/)).toBeTruthy()
  expect(screen.queryByText(/noch offen: .*Abgeschlossen & versendet/)).toBeNull()
  expect(screen.getByText(/Abgeschlossen, aber Versanddatum fehlt .*Frist am 31\.12\./)).toBeTruthy()
})

test('Stammdaten ohne Wohnung: der gesperrte Knopf nennt seinen Grund, die Heizung wartet auf die Wohnungen', async () => {
  wrap(<Stammdaten units={[]} tenancies={[]} settings={null} reload={async () => {}} />)
  const add = await screen.findByRole('button', { name: '+ Mietverhältnis anlegen' }, SLOW)
  expect((add as HTMLButtonElement).disabled).toBe(true)
  const reason = document.getElementById(add.getAttribute('aria-describedby') ?? '')
  expect(reason?.textContent).toBe('Legen Sie zuerst eine Wohnung an.')
  expect(screen.queryByRole('button', { name: 'Heizung einrichten' })).toBeNull()
  expect(screen.getByText(/sobald Sie die Wohnungen angelegt haben/)).toBeTruthy()
})
