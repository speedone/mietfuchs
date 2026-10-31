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
const month = (m: number): RentMonth => ({ month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 80000, status: 'paid', openPrepaymentCents: 0, openRentCents: 0 })
const LEDGER: RentLedger = {
  year: YEAR,
  rows: [{
    tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
    sollYearCents: 960000, baseRentYearCents: 960000, prepaymentYearCents: 0, flatRateYearCents: 0,
    paidYearCents: 960000, settlementYearCents: -20000, balanceCents: 0, dueSollCents: 960000, arrearsCents: 0, openMonths: 0,
    notDemandableCents: 0, notDemandable: [], openingBalanceCents: 0, closingBalanceCents: 0,
  }],
  carriedOnly: [],
  settlementOnly: [{ tenancyId: 't0', tenantName: 'Schmidt', unitName: 'EG', settlementYearCents: 12345 }],
  totals: { sollYearCents: 960000, paidYearCents: 960000, settlementYearCents: -20000 + 12345, openCents: 0, notDemandableCents: 0 },
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
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/i })
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

test('Mietkonto: die Art einer erfassten Zahlung ist ein Entwurf; Speichern fragt nach, gesendet wird nur die Art (Durchsicht M2, #281)', async () => {
  payments = [...PAYMENTS, { id: 'p3', tenancyId: 't1', date: `${YEAR}-03-20`, amountCents: 15000, kind: 'rent' }]
  shell()
  const art = () => select(new RegExp(`Art der Zahlung vom 20\\.03\\.${YEAR}`))
  await waitFor(() => art())
  expect(art().value).toBe('rent')
  expect(shownText(art())).toBe('Miete')
  // Die Auswahl allein speichert nichts (#309): Sie zeigt den Entwurf, daneben „Speichern“ und „Verwerfen“.
  fireEvent.change(art(), { target: { value: 'settlement' } })
  expect(art().value).toBe('settlement')
  expect(sent).toHaveLength(0)
  const speichern = () => screen.getByRole('button', { name: new RegExp(`^Speichern \\(Zahlung vom 20\\.03\\.${YEAR}\\)$`) })
  // Verwerfen stellt das Gespeicherte her.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Verwerfen \\(Zahlung vom 20\\.03\\.${YEAR}\\)$`) }))
  expect(art().value).toBe('rent')
  fireEvent.change(art(), { target: { value: 'settlement' } })
  // Speichern fragt vorher; „Abbrechen“ lässt den Entwurf stehen.
  fireEvent.click(speichern())
  const frage = (await screen.findByText(/Das Mietkonto verteilt sie dann nicht mehr auf die Monate/)).closest('.dialog')
  if (!(frage instanceof HTMLElement)) return expect.fail('keine Rückfrage')
  fireEvent.click(within(frage).getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByText(/Das Mietkonto verteilt sie dann nicht mehr/)).toBeNull())
  expect(sent).toHaveLength(0)
  expect(art().value).toBe('settlement')
  fireEvent.click(speichern())
  fireEvent.click(await screen.findByRole('button', { name: /^Art umstellen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toEqual({ url: '/api/payments/p3', method: 'PUT', body: { kind: 'settlement' } })
})

test('Mietkonto: der Monat laut Verwendungszweck zeigt den gespeicherten Monat und wird als Entwurf gespeichert oder geleert (#281)', async () => {
  payments = [
    ...PAYMENTS,
    { id: 'p3', tenancyId: 't1', date: `${YEAR}-03-20`, amountCents: 80000, kind: 'rent', designatedMonth: `${YEAR}-02` },
    { id: 'p4', tenancyId: 't1', date: `${YEAR}-04-03`, amountCents: 80000, kind: 'rent' },
  ]
  shell()
  // Das Monatsfeld beschriftet Textfeld und Raster-Knopf; gemeint ist das Textfeld.
  const monat = (day: string): HTMLInputElement => {
    const el = screen.getAllByLabelText(new RegExp(`^Für Monat \\(laut Verwendungszweck\\), Zahlung vom ${day}\\.${YEAR}`)).find((x) => x instanceof HTMLInputElement)
    if (!(el instanceof HTMLInputElement)) return expect.fail('kein Eingabefeld')
    return el
  }
  await waitFor(() => monat('20.03'))
  // Der angezeigte Wert entspricht dem gespeicherten.
  expect(monat('20.03').value).toBe(`Februar ${YEAR}`)
  expect(monat('03.04').value).toBe('')
  // An einer Zahlung aus der Abrechnung gibt es kein Monatsfeld.
  expect(screen.queryAllByLabelText(new RegExp(`Für Monat \\(laut Verwendungszweck\\), Zahlung vom 15\\.06\\.${YEAR}`))).toEqual([])
  fireEvent.change(monat('03.04'), { target: { value: `4.${YEAR}` } })
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Speichern \\(Zahlung vom 03\\.04\\.${YEAR}\\)$`) }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toEqual({ url: '/api/payments/p4', method: 'PUT', body: { designatedMonth: `${YEAR}-04` } })
  // Leeren heißt: nach gesetzlicher Reihenfolge.
  fireEvent.change(monat('20.03'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Speichern \\(Zahlung vom 20\\.03\\.${YEAR}\\)$`) }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]).toEqual({ url: '/api/payments/p3', method: 'PUT', body: { designatedMonth: null } })
})

test('Mietkonto: Übertrag, Stand zum 31.12., nicht einforderbare Vorauszahlung und offene Salden Ausgezogener (#281)', async () => {
  const row = LEDGER.rows[0] ?? expect.fail('keine Zeile')
  ledger = {
    ...LEDGER,
    rows: [{ ...row, openingBalanceCents: -80000, closingBalanceCents: -100000, arrearsCents: 80000, notDemandableCents: 20000,
      notDemandable: [{ reason: 'creditedAsPaid', label: String(YEAR - 1), cents: 20000, differenceCents: 20000 }] }],
    carriedOnly: [{ tenancyId: 't0', tenantName: 'Schmidt', unitName: 'EG', end: `${YEAR - 1}-12-31`, openCents: 60000, notDemandableCents: 0, notDemandable: [] }],
    totals: { ...LEDGER.totals, openCents: 140000, notDemandableCents: 20000 },
  }
  shell()
  expect(await screen.findByText(new RegExp(`^Übertrag aus ${YEAR - 1}: Rückstand 800,00\\s€$`))).toBeTruthy()
  expect(screen.getByText(`Stand 31.12.${YEAR}`)).toBeTruthy()
  expect(screen.getByText('davon Rückstand')).toBeTruthy()
  expect(screen.getAllByText('davon nicht mehr einzeln einforderbar').length).toBe(1)
  expect(screen.getByText(new RegExp(`Die Abrechnung ${YEAR - 1} rechnet 200,00\\s€ Vorauszahlung als gezahlt an`))).toBeTruthy()
  expect(screen.getByText('Offene Salden früherer Mietverhältnisse')).toBeTruthy()
  expect(screen.getByText(new RegExp(`Schmidt, ausgezogen am 31\\.12\\.${YEAR - 1}: offen 600,00\\s€`))).toBeTruthy()
  expect(screen.getByText('nicht mehr einzeln einforderbar')).toBeTruthy()
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
  ledger = { ...LEDGER, rows: [], totals: { sollYearCents: 0, paidYearCents: 0, settlementYearCents: 12345, openCents: 0, notDemandableCents: 0 } }
  shell()
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  expect(select(/^Art$/).value).toBe('settlement')
  expect(screen.getByText(`In ${YEAR} besteht kein Mietverhältnis; hier lassen sich nur Nachzahlungen oder Guthaben aus der Abrechnung erfassen.`)).toBeTruthy()
})

test('Mietkonto: ausgezogener Mieter unter „Abrechnung“ gewählt, zurück auf „Miete“: erst die Rückfrage, Abbrechen speichert nichts (Durchsicht M2b)', async () => {
  shell()
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/i })
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

// Praxistest: Ein offener Monat öffnet per Klick die Zahlung mit dem Restbetrag. Er muss auch per
// Tastatur erreichbar sein (WCAG 2.1.1), also ein Knopf mit Namen; ein bezahlter Monat ist keiner.
test('Mietkonto: ein offener Monat ist ein Knopf und öffnet die Zahlung mit dem Restbetrag', async () => {
  ledger = { ...LEDGER, rows: LEDGER.rows.map((r) => ({ ...r, months: r.months.map((m) => m.month === 3 ? { ...m, paidCents: 30000, status: 'partial' as const, openRentCents: 50000 } : m) })) }
  shell()
  // Seit #281 nennt der Name auch, was offen ist (Reihenfolge der Tilgung).
  const march = await screen.findByRole('button', { name: /^Mär\s?800,00\s€: gezahlt 300,00\s€, offen: Vorauszahlung 0,00\s€, Kaltmiete 500,00\s€, Zahlung erfassen$/ })
  // Der Zusatz steht unsichtbar hinter dem sichtbaren Text, nicht als aria-label (client/CLAUDE.md, WCAG 2.5.3).
  expect(march.getAttribute('aria-label')).toBeNull()
  expect(march.textContent).toContain('800,00')
  expect(screen.queryByRole('button', { name: /^Jan / })).toBeNull()
  fireEvent.click(march)
  const dialog = await screen.findByRole('dialog')
  const amount = within(dialog).getByLabelText(/Betrag/)
  if (!(amount instanceof HTMLInputElement)) return expect.fail('kein Betragsfeld')
  expect(amount.value).toBe('500,00')
})


test('Mietkonto: Monate vor der Erfassung heißen „nicht erfasst“ und sind kein Buchungsknopf (#281, Durchsicht)', async () => {
  const row = LEDGER.rows[0] ?? expect.fail('keine Zeile')
  ledger = { ...LEDGER, rows: [{ ...row, ledgerStart: `${YEAR}-10-01`, months: row.months.map((m) => m.month < 10 ? { ...m, status: 'notRecorded' as const, paidCents: 0 } : m) }] }
  shell()
  expect(await screen.findByText(`Mietkonto geführt ab Oktober ${YEAR} (erste erfasste Mietzahlung); frühere Monate sind nicht erfasst.`)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Jan/ })).toBeNull()
  expect(screen.getAllByText('nicht erfasst').length).toBe(9)
})
