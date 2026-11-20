// @vitest-environment jsdom
// Erste Schritte (#447): Ein Prüfer ohne Vorwissen bog im Cockpit an drei Stellen falsch ab. Die Angaben des Vermieters
// gehörten zu keinem Schritt, der erste „Nächste Schritt“ nannte nur das Hochladen, und eine Anleitung für den Anfang
// war vom leeren Cockpit aus nicht zu finden.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Settings, Settlement, Statement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { GUIDES } from '../../../shared/guides.ts'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Müller', unitName: 'EG', persons: 1, days: 365, personDays: 365,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`, rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 0,
  prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0,
}
const TENANCY: Tenancy = {
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
}
const settings = (patch: Partial<Settings> = {}) => ({ landlordName: '', iban: '', paymentDeadlineDays: 30, ...patch }) as Settings

let settlement: Settlement
let propertyLandlord: string | null

beforeEach(() => {
  propertyLandlord = null
  settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents: 0, totalCostsCents: 0, warnings: [], notices: [], closed: null, statements: [STATEMENT],
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: propertyLandlord, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (o: { settings: Settings | null; units?: Unit[]; tenancies?: Tenancy[]; onNavigate?: (tab: string, focus?: unknown) => void; onOpenGuide?: (id: string) => void }) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={o.units ?? UNITS} tenancies={o.tenancies ?? [TENANCY]} settings={o.settings} updateStatus={null} reload={async () => {}} onNavigate={o.onNavigate ?? (() => {})} onOpenGuide={o.onOpenGuide} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)
const row = (title: string) => screen.getByText(title, { selector: '.check-title' }).closest('.check-row') as HTMLElement

test('ohne Namen des Vermieters: die Checkliste nennt „Vermieter und Bankverbindung“ gelb und springt in die Einstellungen', async () => {
  const navigate = vi.fn()
  page({ settings: settings(), onNavigate: navigate })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  const r = row('Vermieter und Bankverbindung')
  expect(r.className).toContain('gelb')
  expect(r.textContent).toContain('Name des Vermieters fehlt')
  fireEvent.click(r)
  expect(navigate).toHaveBeenCalledWith('einstellungen', { kind: 'section', section: 'landlord' })
})

test('führt das Objekt einen eigenen Vermieter, springt die Zeile zu dessen Angaben am Objekt', async () => {
  propertyLandlord = ''
  const navigate = vi.fn()
  page({ settings: settings({ landlordName: 'Erika Muster' }), onNavigate: navigate })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  fireEvent.click(await screen.findByText('Vermieter eintragen →', undefined, SLOW))
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'property', part: 'landlord' })
})

test('mit Name und Anschrift grün, die fehlende IBAN wird nur genannt; ohne Anschrift zählt die Zeile nicht als offener Punkt', async () => {
  const { unmount } = page({ settings: settings({ landlordName: 'Erika Muster', landlordAddress: 'Weg 1, 12345 Ort' }) })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  const green = row('Vermieter und Bankverbindung')
  expect(green.className).toContain('gruen')
  expect(green.textContent).toContain('Keine IBAN eingetragen')
  expect(green.getAttribute('role')).toBeNull()
  const done = screen.getByText(/von \d+ erledigt/).textContent
  unmount()
  page({ settings: settings({ landlordName: 'Erika Muster' }) })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  expect(row('Vermieter und Bankverbindung').className).toContain('gelb')
  // Eine Hilfe, kein offener Punkt: Die Rücksendeangabe nennt ohne Anschrift die des Objekts.
  const [, of] = /(\d+) von (\d+)/.exec(done ?? '')?.slice(1).map(Number) ?? []
  expect(screen.getByText(/von \d+ erledigt/).textContent).toContain(`von ${(of ?? 0) - 1} erledigt`)
})

test('ohne geladene Einstellungen und nach dem Abschluss keine Zeile: abgeschlossen ist der Absender eingefroren', async () => {
  const { unmount } = page({ settings: null })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  expect(screen.queryByText('Vermieter und Bankverbindung')).toBeNull()
  unmount()
  settlement = { ...settlement, closed: { closedAt: `${YEAR + 1}-02-01T10:00:00.000Z`, sentAt: null } as Settlement['closed'] }
  page({ settings: settings() })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  expect(screen.queryByText('Vermieter und Bankverbindung')).toBeNull()
})

test('ohne Kosten nennt die Zeile „Belege erfasst“ beide Wege, Hochladen und von Hand', async () => {
  page({ settings: settings() })
  await screen.findByText('Fertigstellung', undefined, SLOW)
  expect(row('Belege erfasst').textContent).toContain('erfassen Sie die Kosten von Hand auf der Seite Kosten mit „+ Kostenposition anlegen“')
})

test('leeres Cockpit: Verweis auf die Anleitung zur ersten Abrechnung, und neben „Belege erfassen“ der Weg von Hand', async () => {
  settlement = { ...settlement, statements: [] }
  const openGuide = vi.fn()
  const navigate = vi.fn()
  const { unmount } = page({ settings: settings(), units: [], tenancies: [], onOpenGuide: openGuide, onNavigate: navigate })
  fireEvent.click(await screen.findByRole('button', { name: `Anleitung: ${GUIDES.firstSettlement.title}` }, SLOW))
  expect(openGuide).toHaveBeenCalledWith('firstSettlement')
  expect(screen.queryByRole('button', { name: 'Kosten von Hand erfassen' })).toBeNull()
  unmount()
  // Mietverhältnis vorhanden, aber nicht im Zeitraum: der dritte Schritt des Leerzustands
  page({ settings: settings(), tenancies: [{ ...TENANCY, end: '2020-12-31' }], onNavigate: navigate })
  fireEvent.click(await screen.findByRole('button', { name: 'Kosten von Hand erfassen' }, SLOW))
  expect(navigate).toHaveBeenCalledWith('kosten', { kind: 'new', what: 'costItem' })
  // Ohne Weg in die Hilfe (Seitentest ohne App) kein toter Knopf
  expect(screen.queryByRole('button', { name: /^Anleitung:/ })).toBeNull()
})
