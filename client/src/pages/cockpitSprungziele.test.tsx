// @vitest-environment jsdom
// Die Zeilen der Checkliste im Cockpit führen an die Stelle (#554, Durchsicht): Gibt es genau einen betroffenen
// Eintrag, öffnet der Sprung ihn, bei mehreren führt er zur Karte; „Anlegen“ öffnet das Formular. Geprüft auf der
// Seite, damit eine vertauschte Zuordnung (etwa die Karte „Mietverhältnisse“ statt der Wohnung) auffällt.
import { afterEach, assert, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CostItem, DepositEntry, Meter, Notice, Settings, Settlement, Statement, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const unit = (id: string, patch: Partial<Unit> = {}): Unit => ({ id, propertyId: 'objekt-1', name: id.toUpperCase(), areaM2: 80, participates: true, ...patch })
const tenancy = (id: string, unitId: string, patch: Partial<Tenancy> = {}): Tenancy => ({
  id, unitId, tenantName: `Mieter ${id}`, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...patch,
})
const statement = (t: Tenancy, patch: Partial<Statement> = {}): Statement => ({
  tenancyId: t.id, unitId: t.unitId, tenantName: t.tenantName, unitName: t.unitId.toUpperCase(), persons: 1, days: 365, personDays: 365,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`, rows: [], totalShareCents: 0, total35aCents: 0, prepaymentCents: 0,
  prepaymentOverridden: false, suggestedMonthlyCents: 0, balanceCents: 0, ...patch,
})
const item = (id: string, patch: Partial<CostItem> = {}, year = YEAR): CostItem => ({
  id, propertyId: 'objekt-1', period: calendarPeriod(year), category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...patch,
})
const meter = (id: string): Meter => ({ id, propertyId: 'objekt-1', name: `Wasser ${id}`, unitId: 'u1', type: 'kaltwasser', unit: 'm³' })
type Consumption = { meterId: string; consumption: number; readingCount: number; warnings: string[]; notices?: Notice[] }

type Stock = { units: Unit[]; tenancies: Tenancy[]; settlement?: Partial<Settlement>; items?: CostItem[]; meters?: Meter[]; consumption?: Consumption[]; deposits?: DepositEntry[]; bankOpen?: number }

function page(stock: Stock): ReturnType<typeof vi.fn> {
  const settlement: Settlement = {
    year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents: 0, totalCostsCents: 10000, warnings: [], notices: [], closed: null,
    statements: stock.tenancies.map((t) => statement(t)), ...stock.settlement,
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    if (path === '/api/costItems') return json(stock.items ?? [item('k1')])
    if (path === '/api/meters') return json(stock.meters ?? [])
    if (path === `/api/consumption/${YEAR}`) return json(stock.consumption ?? [])
    if (path === '/api/deposit-entries') return json(stock.deposits ?? [])
    if (path === '/api/bank/open-count') return json({ count: stock.bankOpen ?? 0 })
    return json([])
  })
  const navigate = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Cockpit units={stock.units} tenancies={stock.tenancies} settings={{ landlordName: 'Erika', iban: '', paymentDeadlineDays: 30 } as Settings} updateStatus={null} reload={async () => {}} onNavigate={navigate} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  return navigate
}

// Die Zeile mit diesem Titel anklicken; ihr Detail muss `detail` enthalten (es gibt Titel, die mehrfach vorkommen).
async function clickRow(title: string, detail?: RegExp) {
  const rows = (await screen.findAllByText(title, { selector: '.check-title' }, SLOW)).map((t) => t.closest('.check-row'))
  const row = rows.find((r) => !detail || detail.test(r?.textContent ?? '')) ?? assert.fail(`Zeile „${title}“ fehlt`)
  fireEvent.click(row)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Mietverhältnisse & Flächen ohne Mietverhältnis im Zeitraum: zur Karte „Mietverhältnisse“', async () => {
  const navigate = page({ units: [unit('u1')], tenancies: [] })
  await clickRow('Mietverhältnisse & Flächen')
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'section', section: 'tenancies' })
})

test('Fläche fehlt bei einer Wohnung: die Wohnung öffnet sich', async () => {
  const navigate = page({ units: [unit('u1', { areaM2: 0 }), unit('u2')], tenancies: [tenancy('t1', 'u1')] })
  await clickRow('Mietverhältnisse & Flächen', /Wohnfläche fehlt/)
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'unit', id: 'u1' })
})

test('Fläche fehlt bei zwei Wohnungen: zur Karte „Wohnungen“', async () => {
  const navigate = page({ units: [unit('u1', { areaM2: 0 }), unit('u2', { areaM2: 0 })], tenancies: [tenancy('t1', 'u1'), tenancy('t2', 'u2')] })
  await clickRow('Mietverhältnisse & Flächen', /Wohnfläche fehlt/)
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'section', section: 'units' })
})

test('Verteilbasis mit einer ausgenommenen Wohnung: die Wohnung öffnet sich; mit zweien die Karte „Wohnungen“', async () => {
  let navigate = page({ units: [unit('u1'), unit('u2', { participates: false })], tenancies: [tenancy('t1', 'u1')] })
  await clickRow('Verteilbasis')
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'unit', id: 'u2' })
  cleanup()
  navigate = page({ units: [unit('u1'), unit('u2', { participates: false }), unit('u3', { participates: false })], tenancies: [tenancy('t1', 'u1')] })
  await clickRow('Verteilbasis')
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'section', section: 'units' })
})

test('Verteilbasis ohne Miteigentumsanteile bei einer Wohnung: die Wohnung öffnet sich', async () => {
  const navigate = page({
    units: [unit('u1', { mea: 500 }), unit('u2')], tenancies: [tenancy('t1', 'u1')],
    items: [item('k1', { key: 'external', externalBasis: { measure: 'mea', totalCents: 10000, total: 1000, share: 500 } as CostItem['externalBasis'] })],
  })
  await clickRow('Verteilbasis', /Miteigentumsanteile/)
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'unit', id: 'u2' })
})

test('Zählerstände fehlen bei einem Zähler: der Zähler öffnet sich; bei zweien bleibt es bei der Seite', async () => {
  const items = [item('k1', { key: 'meter', meterType: 'kaltwasser', category: 'Wasser/Abwasser' })]
  let navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], items, meters: [meter('m1')] })
  await clickRow('Zählerstände')
  expect(navigate).toHaveBeenCalledWith('zaehler', { kind: 'meter', id: 'm1' })
  cleanup()
  navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], items, meters: [meter('m1'), meter('m2')] })
  await clickRow('Zählerstände')
  expect(navigate).toHaveBeenCalledWith('zaehler', undefined)
})

test('Heizung ohne Verbrauch bei einer Position: die Position öffnet sich in Kosten', async () => {
  const notice: Notice = { code: 'heating.not-by-consumption', level: 'warning', title: 'Heizung', text: 'nicht nach Verbrauch', subject: { kind: 'costItem', id: 'k1' } }
  const navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], items: [item('k1', { category: 'Heizung und Warmwasser' })], settlement: { notices: [notice], warnings: ['nicht nach Verbrauch'] } })
  await clickRow('Zählerstände')
  expect(navigate).toHaveBeenCalledWith('kosten', { kind: 'costItem', id: 'k1' })
})

test('Eichfrist bei einem Zähler: der Zähler öffnet sich', async () => {
  const overdue: Notice = { code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist', text: 'abgelaufen' }
  const navigate = page({
    units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], items: [item('k1')], meters: [meter('m1')],
    consumption: [{ meterId: 'm1', consumption: 10, readingCount: 2, warnings: [], notices: [overdue] }],
  })
  await clickRow('Eichfrist')
  expect(navigate).toHaveBeenCalledWith('zaehler', { kind: 'meter', id: 'm1' })
})

// Browserprüfung 0.16.0 (M1): Eine geschätzte Ablesung (Hinweis des Servers) machte die Zeile rot mit „Stände
// erfassen“, obwohl Anfang und Ende erfasst sind.
test('Geschätzte Ablesung bei vollständigen Ständen: „Zählerstände“ grün, ohne „Stände erfassen“', async () => {
  const estimated: Notice = { code: 'meter.reading-estimated', level: 'hint', title: 'Ablesung geschätzt', text: 'geschätzt', subject: { kind: 'meter', id: 'm1' } }
  page({
    units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], items: [item('k1', { key: 'meter', meterType: 'kaltwasser', category: 'Wasser/Abwasser' })], meters: [meter('m1')],
    consumption: [{ meterId: 'm1', consumption: 10, readingCount: 2, warnings: ['geschätzt'], notices: [estimated] }],
  })
  expect(await screen.findByText(/1 Zähler mit Anfangs- und Endstand erfasst/, {}, SLOW)).toBeTruthy()
  expect(screen.queryByText(/Anfang\/Ende fehlt/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Stände erfassen/ })).toBeNull()
})

test('Plausibilität: eine Kostenart des Vorjahres fehlt, „Kosten erfassen“ öffnet das Formular', async () => {
  const navigate = page({
    units: [unit('u1')], tenancies: [tenancy('t1', 'u1')],
    items: [item('g0', {}, YEAR - 1), item('w0', { category: 'Wasser/Abwasser' }, YEAR - 1), item('g')],
  })
  await clickRow('Plausibilität zum Vorjahr')
  expect(navigate).toHaveBeenCalledWith('kosten', { kind: 'new', what: 'costItem' })
})

test('Anschrift: zwei Ausgezogene ohne neue Anschrift führen zur Karte „Mietverhältnisse“', async () => {
  const gone = { end: `${YEAR}-06-30` }
  const navigate = page({ units: [unit('u1'), unit('u2')], tenancies: [tenancy('t1', 'u1', gone), tenancy('t2', 'u2', gone)] })
  await clickRow('Anschrift für den Versand')
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'section', section: 'tenancies' })
})

test('Abgeschlossen ohne Versanddatum: „Versanddatum eintragen“ führt zum Feld „versendet am“', async () => {
  const navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], settlement: { closed: { closedAt: `${YEAR + 1}-01-10T10:00:00Z`, sentAt: null } } })
  await clickRow('Abgeschlossen & versendet')
  expect(navigate).toHaveBeenCalledWith('abrechnung', { kind: 'section', section: 'sentAt' })
})

// #337: Ein gespeichertes Versanddatum vor dem Ende des Zeitraums (aus der Zeit vor der Prüfung) ist kein Versand.
test('Versanddatum vor dem Ende des Zeitraums: gelb, ohne „gewahrt“, „Versanddatum prüfen“ führt zum Feld', async () => {
  const navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], settlement: { closed: { closedAt: `${YEAR + 1}-01-10T10:00:00Z`, sentAt: `${YEAR}-12-01` } } })
  expect(await screen.findByText(/Als Versanddatum ist der 01\.12\.\d{4} eingetragen\. Das Versanddatum liegt vor dem Ende des Abrechnungszeitraums/, {}, SLOW)).toBeTruthy()
  expect(screen.queryByText(/gewahrt/)).toBeNull()
  // Das Abzeichen im Kopf meldet keinen Erfolg, solange das Datum zu prüfen ist.
  expect(screen.getByText('versendet').className).toBe('badge')
  fireEvent.click(screen.getByRole('button', { name: /Versanddatum prüfen/ }))
  expect(navigate).toHaveBeenCalledWith('abrechnung', { kind: 'section', section: 'sentAt' })
})

// ---------- Kaution nach Auszug (#228, Teil 2) ----------

test('Kaution nach Auszug: eine Zeile je ausgezogenem Mieter mit Stand, der Sprung öffnet sein Seitenfenster', async () => {
  const gone = tenancy('t1', 'u1', { end: '2020-06-30' })
  const navigate = page({ units: [unit('u1')], tenancies: [gone, tenancy('t2', 'u1', { start: '2020-07-01' })], deposits: [
    { id: 'd1', tenancyId: 't1', date: '2020-01-05', kind: 'received', amountCents: 160000 },
    { id: 'd2', tenancyId: 't2', date: '2020-07-05', kind: 'received', amountCents: 160000 },
  ] })
  const line = await screen.findByText(/Bei Ihnen liegen noch 1\.600,00\s€ von Mieter t1 \(ausgezogen am 30\.06\.2020\)\./, undefined, SLOW)
  expect(screen.queryByText(/von Mieter t2/)).toBeNull()
  fireEvent.click(line.closest('li')?.querySelector('button') ?? assert.fail('kein Knopf'))
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'deposit', tenancyId: 't1' })
})

test('Kaution nach Auszug: ohne Buchungen keine Karte', async () => {
  page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1', { end: '2020-06-30', depositCents: 160000 })] })
  await screen.findAllByText('Mietverhältnisse & Flächen', { selector: '.check-title' }, SLOW)
  expect(screen.queryByText('Kaution nach Auszug')).toBeNull()
})

test('Kontoauszug (#188): nicht zugeordnete Umsätze stehen als Zeile mit Sprung auf die Seite, ohne keine', async () => {
  const navigate = page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')], bankOpen: 3 })
  expect(await screen.findByText(/3 Umsätze aus dem Kontoauszug sind noch nicht zugeordnet\./, {}, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Zum Kontoauszug' }))
  expect(navigate).toHaveBeenCalledWith('kontoauszug')
})

test('Kontoauszug (#188): ohne offene Umsätze keine Zeile', async () => {
  page({ units: [unit('u1')], tenancies: [tenancy('t1', 'u1')] })
  await screen.findAllByText('Mietverhältnisse & Flächen', { selector: '.check-title' }, SLOW)
  expect(screen.queryByText(/aus dem Kontoauszug/)).toBeNull()
})
