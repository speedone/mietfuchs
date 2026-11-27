// @vitest-environment jsdom
// Ändern und Löschen nennen das gewählte Objekt (#692). Der Server prüft beim Ändern, Löschen und Versenden, ob der
// Datensatz zum genannten Objekt gehört, und lehnt sonst ab; das wirkt nur, wenn die Oberfläche das Objekt mitschickt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Payment, Property, RentLedger, RentMonth, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Mietkonto from './Mietkonto'

const YEAR = new Date().getFullYear() - 1
const property = (id: string, name: string): Property => ({ id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null })
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-2', name: 'EG', areaM2: 80, participates: true }]
const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [], start: `${YEAR}-01-01`, end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: `${YEAR}-01`, monthlyCents: 80000 }],
}]
const month = (m: number): RentMonth => ({ month: m, baseRentCents: 80000, prepaymentCents: 0, flatRateCents: 0, sollCents: 80000, paidCents: 80000, status: 'paid', openPrepaymentCents: 0, openRentCents: 0 })
const LEDGER: RentLedger = {
  year: YEAR,
  rows: [{
    tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: Array.from({ length: 12 }, (_, i) => month(i + 1)),
    sollYearCents: 960000, baseRentYearCents: 960000, prepaymentYearCents: 0, flatRateYearCents: 0,
    paidYearCents: 960000, settlementYearCents: 0, balanceCents: 0, dueSollCents: 960000, arrearsCents: 0, openMonths: 0,
    notDemandableCents: 0, notDemandable: [], openingBalanceCents: 0, closingBalanceCents: 0,
  }],
  carriedOnly: [],
  settlementOnly: [],
  totals: { sollYearCents: 960000, paidYearCents: 960000, settlementYearCents: 0, openCents: 0, notDemandableCents: 0 },
}
const PAYMENTS: Payment[] = [{ id: 'p1', tenancyId: 't1', date: `${YEAR}-06-15`, amountCents: 80000, kind: 'rent' }]

let sent: { url: string; method: string }[]
beforeEach(() => {
  sent = []
  localStorage.setItem('mietfuchs.property', 'objekt-2')
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [property('objekt-1', 'Lindenstraße 7'), property('objekt-2', 'Gartenweg 3')],
      '/api/tenancies': TENANCIES,
      '/api/payments': PAYMENTS,
      '/api/units': UNITS,
    }
    const body = path.startsWith('/api/rentledger/') ? LEDGER : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('Zahlung löschen nennt das gewählte Objekt, damit der Server einen Datensatz eines anderen Objekts ablehnen kann', async () => {
  render(<PeriodProvider><PropertyProvider><UIProvider><Mietkonto /></UIProvider></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Zahlung löschen' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Zahlung löschen?' })
  const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Löschen')
  if (!confirm) throw new Error('Die Rückfrage hat keinen Knopf „Löschen“.')
  fireEvent.click(confirm)
  await act(async () => {})
  expect(sent).toEqual([{ url: '/api/payments/p1?property=objekt-2', method: 'DELETE' }])
})

// Wächter: Jeder Aufruf, der einen Datensatz der sechs Sammlungen ändert, löscht oder aufteilt, hängt das Objekt mit
// `withProperty` an, ebenso jeder Aufruf an Heizanlage (samt allem darunter), Lieferung, CO₂-Erstattung, Kautionsbuchung,
// Mieterhöhung und an den Unterrouten von Mietverhältnis und Wohnung, die der Server prüft (Mieterwechsel, Mieterhöhung,
// Zwischenablesung). Bei diesen auch die lesenden: Der Wächter sieht die Methode nicht, und dem Lesen schadet die Angabe
// nicht. Ausgenommen ist nur, was über alle Objekte arbeitet und deshalb keines nennen kann.
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../testing/**', '!../**/*.d.ts'], { query: '?raw', import: 'default', eager: true })
const RECORD_ROUTE = new RegExp([
  /`\/api\/(?:units|tenancies|costItems|meters|readings|payments)\/\$\{[^}`]+\}(?:\/split)?`/.source,
  /`\/api\/(?:heating-plants|fuel-deliveries|co2-refunds|deposit-entries|rent-increases)\/(?:from-payment\/)?\$\{/.source,
  /`\/api\/(?:tenancies|units)\/\$\{[^}`]+\}\/(?:change|rent-increases?|interim-gaps)/.source,
].join('|'), 'g')
// Der Ordner der Belege und „Beleg zuordnen“/„Betrag prüfen“ zeigen Positionen aller Objekte, unabhängig vom gewählten.
// fuelCredit.ts ist rein und gibt nur die Adresse zurück; FuelCard hängt das Objekt beim Aufruf an.
const ACROSS_PROPERTIES: Record<string, number> = { './BelegeOrdner.tsx': 1, '../components/ReceiptParts.tsx': 2, '../fuelCredit.ts': 2 }

const bareRoutes = (raw: string): number[] => {
  const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  return [...src.matchAll(RECORD_ROUTE)]
    .filter((m) => !/withProperty\((?:\w+ \? )?$/.test(src.slice(0, m.index)))
    .map((m) => src.slice(0, m.index).split('\n').length)
}

test('kein Aufruf ändert oder löscht einen Datensatz, ohne das gewählte Objekt zu nennen', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(100)
  const found: Record<string, number> = {}
  for (const [file, raw] of Object.entries(sources)) {
    const lines = bareRoutes(raw)
    if (lines.length > 0) found[file] = lines.length
  }
  expect(found).toEqual(ACROSS_PROPERTIES)
  // Probe des Wächters
  expect(bareRoutes("await api(`/api/units/${u.id}`, { method: 'DELETE' })")).toEqual([1])
  expect(bareRoutes("await api(withProperty(`/api/units/${u.id}`, propertyId), { method: 'DELETE' })")).toEqual([])
  expect(bareRoutes("api(withProperty(editing ? `/api/costItems/${form.id}/split` : '/api/costItems/split', propertyId))")).toEqual([])
  expect(bareRoutes('api(`/api/units/${u.id}/dependents`)')).toEqual([])
  expect(bareRoutes("await api(`/api/heating-plants/${plant.id}/periods/${view.period}/co2`, { method: 'PUT' })")).toEqual([1])
  expect(bareRoutes("await api(`/api/tenancies/${t.id}/change`, { method: 'POST' })")).toEqual([1])
  expect(bareRoutes("await api(`/api/deposit-entries/from-payment/${d.paymentId}`, { method: 'POST' })")).toEqual([1])
  expect(bareRoutes("const url = withProperty(`/api/units/${unitId}/interim-gaps/${date}`, propertyId)")).toEqual([])
  expect(bareRoutes("api('/api/heating-plants')")).toEqual([])
})

// Dasselbe für Adressen aus Helfern: die Abrechnung und Heizkostenabrechnung (`settlementPaths`, darunter
// `/api/heating-settlement/…`, das der Server nach der Heizanlage prüft) und die Frage nach dem Abschluss (`closedCheckPath`).
const HELPER_CALL = /\b(?:api|appFetch)(?:<[^>]*>)?\((?!withProperty\()\s*(?:paths\.\w+|closedCheckPath\(|`\/api\/heating-settlement\/|`\$\{paths\.)/g
const bareHelperCalls = (raw: string): number => [...raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').matchAll(HELPER_CALL)].length

test('auch Adressen aus settlementPaths und closedCheckPath gehen nur mit dem Objekt an den Server', () => {
  const found = Object.entries(sources).filter(([, raw]) => bareHelperCalls(raw) > 0).map(([file]) => file)
  expect(found).toEqual([])
  // Probe des Wächters
  expect(bareHelperCalls("await api(paths.close, { method: 'DELETE' })")).toBe(1)
  expect(bareHelperCalls('api<Settlement>(paths.load)')).toBe(1)
  expect(bareHelperCalls('await appFetch(`${paths.load}/export?format=csv`)')).toBe(1)
  expect(bareHelperCalls('api(closedCheckPath(raw, rules, plants))')).toBe(1)
  expect(bareHelperCalls("api(`/api/heating-settlement/${plant}/${period}/close`, { method: 'POST' })")).toBe(1)
  expect(bareHelperCalls("await api(withProperty(paths.close, propertyId), { method: 'DELETE' })")).toBe(0)
  expect(bareHelperCalls('api<Settlement>(withProperty(paths.load, propertyId))')).toBe(0)
})
