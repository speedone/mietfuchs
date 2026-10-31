// @vitest-environment jsdom
// #409: Das Cockpit verspricht keine Vollständigkeit, die Mietfuchs nicht kennen kann. Bei einer
// Eigentumswohnung mit nur der Grundsteuer fragt es nach der Hausgeldabrechnung, und eine Kostenart des
// Vorjahres, die im Jahr fehlt, fällt in der Plausibilität auf.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CostItem, PropertyKind, Settings, Settlement, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 28000, warnings: [], notices: [], closed: null,
  statements: [],
}
const item = (id: string, year: number, category: string, patch: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'objekt-1', period: calendarPeriod(year), category, description: category, amountCents: 28000, key: 'area', invoiceFile: `${id}.pdf`, ...patch,
})

function stub(kind: PropertyKind, items: CostItem[]) {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Wohnung Lindenweg', kind, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(SETTLEMENT)
    if (path === '/api/costItems') return json(items)
    if (path === '/api/uploads') return json(items.map((c) => ({ file: c.invoiceFile, costItemIds: [c.id] })))
    return json([])
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = () => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={UNITS} tenancies={[]} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={() => {}} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('Eigentumswohnung mit nur der Grundsteuer: Zeile „Hausgeldabrechnung“, kein „versandfertig“ (#409)', async () => {
  stub('etw', [item('g', YEAR, 'Grundsteuer')])
  page()
  const row = await screen.findByText('Hausgeldabrechnung', { selector: '.check-title' }, SLOW)
  expect(row.closest('.check-row')?.textContent).toMatch(/Erfasst ist nur die Grundsteuer/)
  expect(document.body.textContent).not.toMatch(/versandfertig|ist vollständig/)
  expect(document.body.textContent).toContain(`Abschließen, sobald alle Rechnungen für ${YEAR} vorliegen`)
})

test('Mehrfamilienhaus mit nur der Grundsteuer: keine Zeile „Hausgeldabrechnung“ (#409)', async () => {
  stub('mfh', [item('g', YEAR, 'Grundsteuer')])
  page()
  await screen.findByText('Belege erfasst', { selector: '.check-title' }, SLOW)
  expect(screen.queryByText('Hausgeldabrechnung', { selector: '.check-title' })).toBeNull()
})

test('Kostenart des Vorjahres fehlt im Jahr: Plausibilität fragt nach der Rechnung (#409)', async () => {
  stub('mfh', [item('g0', YEAR - 1, 'Grundsteuer'), item('w0', YEAR - 1, 'Wasser/Abwasser'), item('g', YEAR, 'Grundsteuer')])
  page()
  const row = await screen.findByText('Plausibilität zum Vorjahr', { selector: '.check-title' }, SLOW)
  expect(row.closest('.check-row')?.textContent).toContain(`In ${YEAR - 1} erfasst, jetzt noch nicht: Wasser/Abwasser — fehlt noch eine Rechnung?`)
})

// Durchsicht zu #409, Befund 1: Eine Kostenart fällt auch zu Recht weg (Kabel nach dem Ende des
// Nebenkostenprivilegs, eine Prüfung alle drei Jahre). Die Frage ist deshalb eine Hilfe und kein offener
// Punkt, sonst bliebe die Unterzeile ein Jahr lang bei einem Punkt, den der Vermieter nicht erledigen kann.
test('fehlende Kostenart des Vorjahres zählt nicht als offener Punkt (#409)', async () => {
  stub('mfh', [item('g0', YEAR - 1, 'Grundsteuer'), item('g', YEAR, 'Grundsteuer')])
  page()
  await screen.findByText('Plausibilität zum Vorjahr', { selector: '.check-title' }, SLOW)
  const ohne = screen.getByText(/Punkte? offen\.$/).textContent
  cleanup()
  vi.unstubAllGlobals()
  stub('mfh', [item('g0', YEAR - 1, 'Grundsteuer'), item('w0', YEAR - 1, 'Kabel/Antenne'), item('g', YEAR, 'Grundsteuer')])
  page()
  const row = await screen.findByText(/jetzt noch nicht: Kabel\/Antenne/, {}, SLOW)
  expect(row.textContent).toMatch(/darf sie fehlen/)
  expect(screen.getByText(/Punkte? offen\.$/).textContent).toBe(ohne)
  expect(screen.queryByRole('button', { name: /Nächster Schritt: Kosten erfassen/ })).toBeNull()
})

// Durchsicht S4 (#490): Die Zeilen des Cockpits führen in die richtige Ansicht der Seite Belege.
const pageWith = (onNavigate: (tab: string) => void) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={UNITS} tenancies={[]} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={onNavigate} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)
const rowOf = async (title: string) => (await screen.findByText(title, { selector: '.check-title' }, SLOW)).closest('.check-row') as HTMLElement

test('Cockpit: ein leerer Zeitraum mit Mietverhältnis führt mit „Belege erfassen“ in den Eingang', async () => {
  stub('mfh', [])
  const empty = { ...SETTLEMENT, totalCostsCents: 0 }
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => (url.split('?')[0] === `/api/settlement/${YEAR}`
    ? new Response(JSON.stringify(empty), { status: 200, headers: { 'content-type': 'application/json' } })
    : inner(url, init)))
  const navigate = vi.fn()
  const tenancy = { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Cockpit units={UNITS} tenancies={[tenancy] as never} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={navigate} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Belege erfassen' }, SLOW))
  expect(navigate).toHaveBeenCalledWith('belege:eingang')
})

test('Cockpit: „Belege vollständig“ mit Positionen ohne Beleg führt in den Ordner („Belege nachreichen“)', async () => {
  stub('mfh', [item('g', YEAR, 'Grundsteuer', { invoiceFile: undefined })])
  const navigate = vi.fn()
  pageWith(navigate)
  fireEvent.click(await rowOf('Belege vollständig'))
  expect(navigate).toHaveBeenCalledWith('belege:ordner')
})

test('Cockpit: die Zeile „Hausgeldabrechnung“ führt in den Eingang', async () => {
  stub('etw', [item('g', YEAR, 'Grundsteuer')])
  const navigate = vi.fn()
  pageWith(navigate)
  fireEvent.click(await rowOf('Hausgeldabrechnung'))
  expect(navigate).toHaveBeenCalledWith('belege:eingang')
})
