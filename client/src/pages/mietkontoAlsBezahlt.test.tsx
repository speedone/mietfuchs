// @vitest-environment jsdom
// Monate als bezahlt erfassen (#608): Ein Klick auf einen Monat öffnet die Zahlung für diesen Monat, vorbelegt mit Rest,
// Fälligkeitstag und Monat; „Monate als bezahlt erfassen …“ öffnet ein Seitenfenster mit Vorschau des Servers und legt
// mit dessen Marke an. Gesperrt ohne Mietverhältnisse im Jahr.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MarkPaidPlan, Payment, RentLedger, RentLedgerRow, RentMonth, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import { fmtEuro } from '../api'
import Mietkonto from './Mietkonto'

// Ein abgelaufenes Jahr: Vorgabe „Bis Monat“ ist Dezember, kein Fälligkeitstag liegt nach heute.
const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }, { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true }]
const tenancy = (id: string, unitId: string, tenantName: string): Tenancy => ({
  id, unitId, tenantName, persons: 1, personHistory: [], start: `${YEAR}-01-01`, end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: `${YEAR}-01`, monthlyCents: 80000 }],
})
const TENANCIES = [tenancy('t1', 'u1', 'Albers'), tenancy('t2', 'u2', 'Brandt')]
const mm = (m: number): string => String(m).padStart(2, '0')
const month = (m: number, paidCents: number): RentMonth => ({
  month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents,
  status: paidCents >= 80000 ? 'paid' : paidCents > 0 ? 'partial' : 'open', openPrepaymentCents: 0, openRentCents: 80000 - paidCents,
  dueOn: `${YEAR}-${mm(m)}-0${m === 3 ? 5 : 3}`,
})
const row = (tenancyId: string, tenantName: string, unitName: string, paid: (m: number) => number): RentLedgerRow => ({
  tenancyId, tenantName, unitName, months: Array.from({ length: 12 }, (_, i) => month(i + 1, paid(i + 1))), dueRule: { rule: 'startWorkday', agreed: false },
  sollYearCents: 960000, baseRentYearCents: 960000, prepaymentYearCents: 0, flatRateYearCents: 0, paidYearCents: 0, settlementYearCents: 0,
  balanceCents: 0, dueSollCents: 960000, arrearsCents: 0, openMonths: 0, notDemandableCents: 0, notDemandable: [], openingBalanceCents: 0, closingBalanceCents: 0,
})
const ledgerOf = (rows: RentLedgerRow[]): RentLedger => ({
  year: YEAR, asOf: `${YEAR + 1}-01-15`, rows, carriedOnly: [], settlementOnly: [],
  totals: { sollYearCents: 0, paidYearCents: 0, settlementYearCents: 0, openCents: 0, notDemandableCents: 0 },
})
// Albers hat bis Februar gezahlt, im März 300 €; Brandt alles.
const LEDGER = ledgerOf([row('t1', 'Albers', 'EG', (m) => (m <= 2 ? 80000 : m === 3 ? 30000 : 0)), row('t2', 'Brandt', 'OG', () => 80000)])
const planFor = (ids: string[], through: string, over: Partial<MarkPaidPlan> = {}): MarkPaidPlan => {
  const payments = ids.includes('t1') ? [
    { tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', month: `${YEAR}-03`, date: `${YEAR}-03-05`, amountCents: 50000 },
    { tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', month: `${YEAR}-04`, date: `${YEAR}-04-03`, amountCents: 80000 },
  ].filter((p) => p.month <= through) : []
  return { payments, totalCents: payments.reduce((a, p) => a + p.amountCents, 0), unresolved: [], othersAffected: [], token: `marke-${ids.join('+')}-${through}`, ...over }
}

let sent: { url: string; method: string; body: unknown }[]
let ledger: RentLedger
let planReply: (body: { tenancyIds: string[], through: string }) => MarkPaidPlan | Promise<MarkPaidPlan>
let createReply: () => Response
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sent = []
  ledger = LEDGER
  planReply = (b) => planFor(b.tenancyIds, b.through)
  createReply = () => json({ ok: true, count: 2, payments: [] })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0] ?? url
    if (method !== 'GET') {
      const body: unknown = JSON.parse(String(init?.body ?? 'null'))
      sent.push({ url: path, method, body })
      if (path === `/api/rentledger/${YEAR}/mark-paid/plan`) return json(await planReply(body as { tenancyIds: string[], through: string }))
      if (path === `/api/rentledger/${YEAR}/mark-paid`) return createReply()
      return json({ id: 'neu' })
    }
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, state: 'NW' }],
      '/api/tenancies': TENANCIES,
      '/api/payments': [] satisfies Payment[],
      '/api/units': UNITS,
    }
    return json(path.startsWith('/api/rentledger/') ? ledger : responses[path] ?? [])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = () => render(<PeriodProvider><PropertyProvider><UIProvider><Mietkonto /></UIProvider></PropertyProvider></PeriodProvider>)
const openButton = async (): Promise<HTMLButtonElement> => {
  const b = await screen.findByRole('button', { name: /^Monate als bezahlt erfassen …/ })
  if (!(b instanceof HTMLButtonElement)) return expect.fail('kein Knopf')
  return b
}
const drawer = async (): Promise<HTMLElement> => screen.findByRole('dialog', { name: 'Offene Monate als bezahlt erfassen' })
const plans = () => sent.filter((s) => s.url.endsWith('/mark-paid/plan'))

test('Klick auf einen Monat: Zahlung für diesen Monat, vorbelegt mit Rest, Fälligkeitstag und Monat', async () => {
  shell()
  const albers = (await screen.findByText(/^Albers/)).closest('section') ?? document.body
  fireEvent.click(within(albers).getByRole('button', { name: /^Mär/ }))
  const form = await screen.findByRole('dialog', { name: 'Zahlung erfassen' })
  expect((within(form).getByLabelText(/^Datum/) as HTMLInputElement).value).toBe(`${YEAR}-03-05`)
  expect((within(form).getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('500,00')
  fireEvent.click(within(form).getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent.some((s) => s.url === '/api/payments')).toBe(true))
  expect(sent.find((s) => s.url === '/api/payments')?.body).toMatchObject({ tenancyId: 't1', date: `${YEAR}-03-05`, amountCents: 50000, kind: 'rent', designatedMonth: `${YEAR}-03` })
})

test('Monate als bezahlt erfassen: Vorschau aller Mietverhältnisse bis Dezember, Anlegen mit der Marke, Mitteilung, neu laden', async () => {
  shell()
  const open = await openButton()
  await waitFor(() => expect(open.disabled).toBe(false))
  fireEvent.click(open)
  const d = await drawer()
  await waitFor(() => expect(plans()).toHaveLength(1))
  expect(plans()[0]?.body).toEqual({ tenancyIds: ['t1', 't2'], through: `${YEAR}-12` })
  const table = await within(d).findByRole('table')
  const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
  expect(cells).toEqual([
    ['Albers · EG', `März ${YEAR}`, `05.03.${YEAR}`, fmtEuro(50000)],
    ['Albers · EG', `April ${YEAR}`, `03.04.${YEAR}`, fmtEuro(80000)],
  ])
  expect(within(d).getByText((_, el) => el?.tagName === 'STRONG' && el.textContent === `Summe: ${fmtEuro(130000)}`)).toBeTruthy()
  expect(within(d).getByText(/Jede gilt dem genannten Monat/)).toBeTruthy()
  const before = sent.length
  fireEvent.click(within(d).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.some((s) => s.url.endsWith('/mark-paid'))).toBe(true))
  expect(sent.slice(before).find((s) => s.url.endsWith('/mark-paid'))?.body).toEqual({ tenancyIds: ['t1', 't2'], through: `${YEAR}-12`, token: `marke-t1+t2-${YEAR}-12` })
  expect(await screen.findByText('2 Zahlungen angelegt.')).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Offene Monate als bezahlt erfassen' })).toBeNull())
})

test('Monate als bezahlt erfassen: jede Änderung lädt die Vorschau neu, eine verspätete Antwort zählt nicht', async () => {
  let release: (p: MarkPaidPlan) => void = () => {}
  planReply = (b) => (b.tenancyIds.length === 2 ? new Promise<MarkPaidPlan>((resolve) => { release = resolve }) : planFor(b.tenancyIds, b.through))
  shell()
  const open = await openButton()
  await waitFor(() => expect(open.disabled).toBe(false))
  fireEvent.click(open)
  const d = await drawer()
  await waitFor(() => expect(plans()).toHaveLength(1))
  const select = within(d).getByLabelText(/^Mietverhältnis/)
  if (!(select instanceof HTMLSelectElement)) return expect.fail('kein Auswahlfeld')
  expect([...select.options].map((o) => o.textContent)).toEqual(['Alle Mietverhältnisse', 'Albers · EG', 'Brandt · OG'])
  fireEvent.change(select, { target: { value: 't2' } })
  await waitFor(() => expect(plans()).toHaveLength(2))
  expect(plans()[1]?.body).toEqual({ tenancyIds: ['t2'], through: `${YEAR}-12` })
  expect(await within(d).findByText(`Bis Dezember ${YEAR} ist nichts offen.`)).toBeTruthy()
  // Die Antwort auf die erste Anfrage kommt zu spät und wird verworfen.
  release(planFor(['t1', 't2'], `${YEAR}-12`))
  await new Promise((r) => setTimeout(r, 20))
  expect(within(d).queryByRole('table')).toBeNull()
  expect((within(d).getByRole('button', { name: /^Anlegen$/ }) as HTMLButtonElement).disabled).toBe(true)
  // Ein Monat nach dem Jahr: Statt der Vorschau steht der Grund, keine Anfrage.
  fireEvent.change(within(d).getByRole('textbox', { name: /^Bis Monat/ }), { target: { value: `3.${YEAR + 1}` } })
  expect(await within(d).findByText(`Bis Monat: Wählen Sie einen Monat im Jahr ${YEAR}.`)).toBeTruthy()
  expect(plans()).toHaveLength(2)
})

test('Monate als bezahlt erfassen: Warnung bei betroffenen Mietverhältnissen, Hinweis bei nicht gedeckten Monaten, 409 zeigt die neue Vorschau', async () => {
  planReply = (b) => planFor(b.tenancyIds, b.through, {
    othersAffected: [{ tenancyId: 't2', tenantName: 'Brandt', unitName: 'OG', beforeCents: 0, afterCents: 160000 }],
    unresolved: [{ tenancyId: 't1', tenantName: 'Albers', unitName: 'EG', month: `${YEAR}-03`, status: 'partial', openCents: 20000 }],
  })
  let calls = 0
  createReply = () => (++calls === 1 ? json({ error: 'Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.', plan: planFor(['t1'], `${YEAR}-04`, { token: 'neu' }) }, 409) : json({ ok: true, count: 1, payments: [] }))
  shell()
  const open = await openButton()
  await waitFor(() => expect(open.disabled).toBe(false))
  fireEvent.click(open)
  const d = await drawer()
  expect(await within(d).findByText(/Brandt \(OG\): Rückstand bisher/)).toBeTruthy()
  expect(within(d).getByText(/Nicht ganz gedeckt bleibt danach: Albers, März/)).toBeTruthy()
  fireEvent.click(within(d).getByRole('button', { name: /^Anlegen$/ }))
  expect(await within(d).findAllByText(/Der Stand hat sich geändert/)).not.toHaveLength(0)
  await waitFor(() => expect(within(d).queryByText(/Brandt \(OG\): Rückstand bisher/)).toBeNull())
  fireEvent.click(within(d).getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent.filter((s) => s.url.endsWith('/mark-paid'))).toHaveLength(2))
  expect(sent.filter((s) => s.url.endsWith('/mark-paid'))[1]?.body).toMatchObject({ token: 'neu' })
  expect(await screen.findByText('Eine Zahlung angelegt.')).toBeTruthy()
})

test('Monate als bezahlt erfassen: gesperrt ohne Mietverhältnisse im Jahr, mit Grund', async () => {
  ledger = ledgerOf([])
  shell()
  const open = await openButton()
  await waitFor(() => expect(document.getElementById(open.getAttribute('aria-describedby') ?? '')?.textContent).toBe(`Für ${YEAR} gibt es keine Mietverhältnisse.`))
  expect(open.disabled).toBe(true)
})
