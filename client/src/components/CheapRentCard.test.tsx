// @vitest-environment jsdom
// Die Karte „Verbilligte Vermietung“ (#257): Anlegen schickt die ganze Staffel der Wohnung, fehlende Angaben stehen am
// Feld und in der Sammelmeldung, die Quote aus der Steuerübersicht steht als Satz da.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CheapRentCard from './CheapRentCard'
import { UIProvider } from './feedback'
import type { CheapRentReport, Tenancy, Unit } from '../types'

const alt = { from: '2023-01', monthlyCents: 80000, source: 'Mietspiegel 2023', sourceDate: '2022-04-01' }
const UNITS: Unit[] = [
  { id: 'a', propertyId: 'p', name: 'DG', areaM2: 60, participates: true, localRents: [alt] },
  { id: 'e', propertyId: 'p', name: 'Eigene', areaM2: 90, participates: false, selfUsed: true },
]
const REPORT: CheapRentReport = {
  law: { split: 50, paid: 66, cite: '§ 21 Abs. 2 Satz 1 und 2 EStG', text: '' },
  units: [{
    unitId: 'a', unitName: 'DG', paidFactor: 2 / 9, gratuitousCents: 46667, unallocated: [], sources: [alt],
    tenancies: [{ tenancyId: 't', tenantName: 'Tochter', days: 365, baseRentCents: 240000, chargesCents: 0, chargesSource: 'settlement', directChargesCents: 0, entgeltCents: 240000, comparisonCents: 1080000, quotePercent: 22.22, verdict: 'split', missingMonths: [] }],
  }],
}
const TENANCIES: Tenancy[] = [{ id: 't', unitId: 'a', tenantName: 'Tochter', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    const data = method === 'GET' ? (url.startsWith('/api/tenancies') ? TENANCIES : UNITS) : url.startsWith('/api/tenancies') ? TENANCIES[0] : UNITS[0]
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = (onSaved = () => {}) => render(<UIProvider><CheapRentCard propertyId="p" year={2025} report={REPORT} onSaved={onSaved} /></UIProvider>)

test('zeigt den Eintrag und die Quote; nur vermietete Wohnungen stehen zur Wahl', async () => {
  card()
  expect(await screen.findByText(/Mietspiegel 2023, Stand 01\.04\.2022/)).toBeTruthy()
  expect(screen.getByText(/22,22 %\. Unter 50 %/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '+ Ortsübliche Miete anlegen' }))
  const drawer = screen.getByRole('dialog', { name: 'Ortsübliche Miete anlegen' })
  const select = within(drawer).getByLabelText(/Wohnung/)
  if (!(select instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([...select.options].map((o) => o.value)).toEqual(['a'])
})

test('Anlegen ohne Angaben: Meldungen am Feld, nichts gesendet; mit Angaben die ganze Staffel per PUT', async () => {
  const onSaved = vi.fn()
  card(onSaved)
  fireEvent.click(await screen.findByRole('button', { name: '+ Ortsübliche Miete anlegen' }))
  const drawer = screen.getByRole('dialog', { name: 'Ortsübliche Miete anlegen' })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Anlegen' }))
  expect(await within(drawer).findByText('Betrag fehlt')).toBeTruthy()
  expect(within(drawer).getByText('Quelle fehlt')).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(within(drawer).getByLabelText(/Ortsübliche Warmmiete/), { target: { value: '900,00' } })
  fireEvent.change(within(drawer).getByLabelText(/^Quelle/), { target: { value: 'Mietspiegel 2025' } })
  fireEvent.change(within(drawer).getByLabelText(/Stand der Quelle/), { target: { value: '2024-04-01' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/units/a'))
  expect(sent.at(-1)).toEqual({ url: '/api/units/a', method: 'PUT', body: { localRents: [alt, { from: '2025-01', monthlyCents: 90000, source: 'Mietspiegel 2025', sourceDate: '2024-04-01' }] } })
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
})

test('direkt an Dritte gezahlte Kosten: im selben Fenster der Karte, gespeichert am Mietverhältnis per PUT', async () => {
  const onSaved = vi.fn()
  card(onSaved)
  fireEvent.click(await screen.findByRole('button', { name: '+ Direkt gezahlte Kosten anlegen' }))
  const drawer = screen.getByRole('dialog', { name: 'Direkt gezahlte Kosten anlegen' })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Anlegen' }))
  expect(await within(drawer).findByText('Betrag fehlt')).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(within(drawer).getByLabelText(/Direkt gezahlt im Monat/), { target: { value: '150,00' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/tenancies/t'))
  expect(sent.at(-1)).toEqual({ url: '/api/tenancies/t', method: 'PUT', body: { directCharges: [{ from: '2025-01', monthlyCents: 15000 }] } })
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
})
