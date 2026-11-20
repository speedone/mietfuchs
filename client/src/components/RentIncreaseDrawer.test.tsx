// @vitest-environment jsdom
// Das Seitenfenster „Mieterhöhung“ (#191, PR 2): Auswahlfelder zeigen den vorbelegten Wert, die Rechnung geht mit genau
// diesem Wert an den Server, der Zustand steht als Wort da; gespeichert wird nichts.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RentIncreaseDrawer from './RentIncreaseDrawer'
import { UIProvider } from './feedback'
import type { Property, RentIncreasePlan, Tenancy, Unit } from '../types'

const TENANCY: Tenancy = {
  id: 't1', unitId: 'u1', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 50000 }], rentKind: 'free', rentIncreaseExcluded: false,
}
const UNIT: Unit = { id: 'u1', propertyId: 'p1', name: 'EG', areaM2: 60, participates: true }
const PROPERTY = { id: 'p1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, rentCapReduced: true } satisfies Property
const PLAN: RentIncreasePlan = {
  kind: 'comparison', state: 'notYet', reasons: ['Am 20.11.2026 ist es noch zu früh.'], warnings: [], needs: [], currentCents: 50000, currentSince: '2020-01-01',
  receivedOn: '2026-11-20', earliestReceivedOn: '2026-12-02', effectiveFrom: '2027-03', earliestEffectiveFrom: '2027-03', consent: null, cap: null,
  comparison: null, index: null, maxCents: null, newCents: null, steps: [], staggered: null, legalValues: [],
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(PLAN), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = (tenancy: Tenancy = TENANCY, property: Property | null = PROPERTY) =>
  render(<UIProvider><RentIncreaseDrawer tenancy={tenancy} unit={UNIT} property={property} onClose={() => {}} /></UIProvider>)

test('Mieterhöhung: Auswahlfelder zeigen den vorbelegten Wert, und genau der geht an den Server', async () => {
  open()
  const kind = screen.getByLabelText('Art der Erhöhung') as HTMLSelectElement
  expect(kind.value).toBe('comparison')
  expect(kind.selectedOptions[0]?.textContent).toMatch(/Vergleichsmiete/)
  const cap = screen.getByLabelText(/Verordnung zur/) as HTMLSelectElement
  expect(cap.value).toBe('yes')
  expect(cap.selectedOptions[0]?.textContent).toMatch(/^Ja/)
  await waitFor(() => expect(sent.length).toBe(1))
  expect(sent[0]?.url).toBe('/api/tenancies/t1/rent-increase/plan')
  expect(sent[0]?.method).toBe('POST')
  expect(sent[0]?.body).toMatchObject({ kind: 'comparison', rentCap: 'yes', areaM2: 60 })
  expect(await screen.findByText('Noch nicht möglich')).toBeTruthy()
  expect(screen.getByText('Am 20.11.2026 ist es noch zu früh.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Speichern|Anlegen/ })).toBeNull()
})

test('Mieterhöhung: bei Indexmiete ist die Art vorbelegt, ohne Angabe am Objekt „weiß nicht“; ein Wechsel rechnet neu', async () => {
  open({ ...TENANCY, rentKind: 'index' }, null)
  expect((screen.getByLabelText('Art der Erhöhung') as HTMLSelectElement).value).toBe('index')
  await waitFor(() => expect(sent.length).toBe(1))
  expect(sent[0]?.body).toMatchObject({ kind: 'index' })
  fireEvent.change(screen.getByLabelText('Art der Erhöhung'), { target: { value: 'comparison' } })
  const cap = await screen.findByLabelText(/Verordnung zur/) as HTMLSelectElement
  expect(cap.value).toBe('unknown')
  await waitFor(() => expect(sent.length).toBe(2))
  expect(sent[1]?.body).toMatchObject({ kind: 'comparison', rentCap: 'unknown' })
})
