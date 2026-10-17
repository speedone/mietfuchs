// @vitest-environment jsdom
// Die Art einer Zahlung im Mietkonto (#280): Die Auswahl zeigt, was gespeichert wird, ein ausgezogener
// Mieter ist nur für die Abrechnung wählbar, und die gesonderten Beträge stehen auf der Seite.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Payment, RentLedger, RentMonth, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Mietkonto from './Mietkonto'

const YEAR = new Date().getFullYear() - 1
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const tenancy = (id: string, tenantName: string, start: string, end: string | null): Tenancy => ({
  id, unitId: 'u1', tenantName, persons: 1, personHistory: [], start, end, prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: start.slice(0, 7), monthlyCents: 80000 }],
})
const TENANCIES: Tenancy[] = [tenancy('t1', 'Müller', `${YEAR}-01-01`, null), tenancy('t0', 'Schmidt', '2015-01-01', `${YEAR - 1}-12-31`)]
const month = (m: number): RentMonth => ({ month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 80000, status: 'paid' })
const LEDGER: RentLedger = {
  year: YEAR,
  rows: [{
    tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
    sollYearCents: 960000, baseRentYearCents: 960000, prepaymentYearCents: 0, flatRateYearCents: 0,
    paidYearCents: 960000, settlementYearCents: -20000, balanceCents: 0, dueSollCents: 960000, arrearsCents: 0, openMonths: 0,
  }],
  settlementOnly: [{ tenancyId: 't0', tenantName: 'Schmidt', unitName: 'EG', settlementYearCents: 12345 }],
  totals: { sollYearCents: 960000, paidYearCents: 960000, settlementYearCents: -20000 + 12345, openCents: 0 },
}
const PAYMENTS: Payment[] = [
  { id: 'p1', tenancyId: 't1', date: `${YEAR}-06-15`, amountCents: -20000, kind: 'settlement' },
  { id: 'p2', tenancyId: 't0', date: `${YEAR}-04-10`, amountCents: 12345, kind: 'settlement' },
]

let sent: { url: string; method: string; body: unknown }[]
let ledger: RentLedger
let payments: Payment[]

beforeEach(() => {
  sent = []
  ledger = LEDGER
  payments = PAYMENTS
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? 'null')) })
      return new Response(JSON.stringify({ id: 'neu' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/tenancies': TENANCIES,
      '/api/payments': payments,
      '/api/units': UNITS,
    }
    const body = path.startsWith('/api/rentledger/') ? ledger : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = () => render(<PeriodProvider><PropertyProvider><UIProvider><Mietkonto /></UIProvider></PropertyProvider></PeriodProvider>)
const select = (label: RegExp): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) return expect.fail(`kein Auswahlfeld ${label}`)
  return el
}
const shownText = (el: HTMLSelectElement): string => el.options[el.selectedIndex]?.textContent ?? ''

test('Mietkonto: die Art steht auf Miete, „Abrechnung“ bietet den ausgezogenen Mieter an und wird gesendet', async () => {
  shell()
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  const art = select(/^Art$/)
  expect(art.value).toBe('rent')
  expect(shownText(art)).toBe('Miete')
  const mieter = () => [...select(/^Mietverhältnis/).options].map((o) => o.value)
  expect(mieter()).toEqual(['', 't1'])
  fireEvent.change(art, { target: { value: 'settlement' } })
  expect(shownText(select(/^Art$/))).toBe('Nachzahlung oder Guthaben aus der Abrechnung')
  expect(screen.getByText(/ein ausgezahltes Guthaben mit Minus/)).toBeTruthy()
  expect(screen.queryByText(/mit der Miete verrechnet/)).toBeNull()
  expect(mieter()).toEqual(['', 't1', 't0'])
  fireEvent.change(select(/^Mietverhältnis/), { target: { value: 't0' } })
  expect(shownText(select(/^Mietverhältnis/))).toBe('Schmidt · EG')
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '-50,00' } })
  // Ein Guthaben: dazu der Satz zur Verrechnung mit der Miete (Durchsicht M1).
  expect(screen.getByText(/mit der Miete verrechnet, tragen Sie die Miete in voller Höhe als „Miete“ ein/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ tenancyId: 't0', amountCents: -5000, kind: 'settlement' })
})

test('Mietkonto: Abrechnung gesondert in der Zeile, in den Kennzahlen, bei früheren Mietern und in der Liste', async () => {
  shell()
  expect(await screen.findByText('Abrechnung (Nachzahlung/Guthaben), gesondert')).toBeTruthy()
  expect(screen.getByText('aus der Abrechnung (gesondert)')).toBeTruthy()
  expect(screen.getByText('Abrechnung früherer Mietverhältnisse')).toBeTruthy()
  // Die Art steht in der Liste als Auswahl mit dem gespeicherten Wert (Durchsicht M2).
  expect(select(new RegExp(`Art der Zahlung vom 15\\.06\\.${YEAR}`)).value).toBe('settlement')
  // Durchsicht N2: Die Kennzahl nennt, was sie zählt.
  expect(screen.getAllByText('Miete eingegangen').length).toBeGreaterThan(0)
})

test('Mietkonto: die Art einer erfassten Zahlung lässt sich umstellen, erst nach Rückfrage, gesendet wird nur die Art (Durchsicht M2)', async () => {
  payments = [...PAYMENTS, { id: 'p3', tenancyId: 't1', date: `${YEAR}-03-20`, amountCents: 15000, kind: 'rent' }]
  shell()
  const art = () => select(new RegExp(`Art der Zahlung vom 20\\.03\\.${YEAR}`))
  await waitFor(() => art())
  expect(art().value).toBe('rent')
  expect(shownText(art())).toBe('Miete')
  // Die Auswahl allein speichert nichts (Durchsicht der Umstellung auf main): Mit den Pfeiltasten
  // wechselt ein Auswahlfeld seinen Wert schon beim Durchgehen der Tabelle, und jede Umstellung
  // verschiebt Geld zwischen Mietkonto und „gesondert“. Bis zur Bestätigung zeigt die Auswahl das
  // Gespeicherte.
  fireEvent.change(art(), { target: { value: 'settlement' } })
  const frage = (await screen.findByText(/Das Mietkonto verteilt sie dann nicht mehr auf die Monate/)).closest('.dialog')
  if (!(frage instanceof HTMLElement)) return expect.fail('keine Rückfrage')
  expect(sent).toHaveLength(0)
  expect(art().value).toBe('rent')
  fireEvent.click(within(frage).getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByText(/Das Mietkonto verteilt sie dann nicht mehr/)).toBeNull())
  expect(sent).toHaveLength(0)
  expect(art().value).toBe('rent')
  fireEvent.change(art(), { target: { value: 'settlement' } })
  fireEvent.click(await screen.findByRole('button', { name: /^Art umstellen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toEqual({ url: '/api/payments/p3', method: 'PUT', body: { kind: 'settlement' } })
})

test('Mietkonto: +150 € und −150 € aus der Abrechnung heben sich auf und stehen trotzdem da (Durchsicht N1)', async () => {
  const row = LEDGER.rows[0] ?? expect.fail('keine Zeile')
  ledger = { ...LEDGER, rows: [{ ...row, settlementYearCents: 0 }], settlementOnly: [], totals: { ...LEDGER.totals, settlementYearCents: 0 } }
  payments = [
    { id: 'a', tenancyId: 't1', date: `${YEAR}-03-01`, amountCents: 15000, kind: 'settlement' },
    { id: 'b', tenancyId: 't1', date: `${YEAR}-04-01`, amountCents: -15000, kind: 'settlement' },
  ]
  shell()
  expect(await screen.findByText('Abrechnung (Nachzahlung/Guthaben), gesondert')).toBeTruthy()
  expect(screen.getByText('aus der Abrechnung (gesondert)')).toBeTruthy()
})

test('Mietkonto: ohne Mietverhältnis im Jahr beginnt das Formular mit „Abrechnung“ und sagt warum (Durchsicht M2b)', async () => {
  ledger = { ...LEDGER, rows: [], totals: { sollYearCents: 0, paidYearCents: 0, settlementYearCents: 12345, openCents: 0 } }
  shell()
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  expect(select(/^Art$/).value).toBe('settlement')
  expect(screen.getByText(`In ${YEAR} besteht kein Mietverhältnis; hier lassen sich nur Nachzahlungen oder Guthaben aus der Abrechnung erfassen.`)).toBeTruthy()
})

test('Mietkonto: ausgezogener Mieter unter „Abrechnung“ gewählt, zurück auf „Miete“: erst die Rückfrage, Abbrechen speichert nichts (Durchsicht M2b)', async () => {
  shell()
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(select(/^Art$/), { target: { value: 'settlement' } })
  fireEvent.change(select(/^Mietverhältnis/), { target: { value: 't0' } })
  fireEvent.change(select(/^Art$/), { target: { value: 'rent' } })
  // Die Anzeige entspricht weiter dem Gewählten.
  expect(select(/^Mietverhältnis/).value).toBe('t0')
  expect(shownText(select(/^Mietverhältnis/))).toBe('Schmidt · EG')
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '800' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  const frage = (await screen.findByText(/Das Mietverhältnis von Schmidt besteht in \d{4} nicht/)).closest('.dialog')
  if (!(frage instanceof HTMLElement)) return expect.fail('keine Rückfrage')
  fireEvent.click(within(frage).getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByText(/Das Mietverhältnis von Schmidt besteht/)).toBeNull())
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Trotzdem als Miete speichern/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ tenancyId: 't0', kind: 'rent', amountCents: 80000 })
})
