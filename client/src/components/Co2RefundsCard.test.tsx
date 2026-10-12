// @vitest-environment jsdom
// Die Karte „CO₂-Erstattung“ (Heizung PR 19, #97): Auswahlfelder zeigen den gespeicherten Wert, Speichern schickt
// die Erstattung an den Server.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2RefundsCard from './Co2RefundsCard'
import { UIProvider } from './feedback'
import { periodKey } from '../../../shared/period.ts'

const stored = {
  id: 'e', tenancyId: 't', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 24000, settlePeriod: '2025-01', paidOutOn: null,
  billedFrom: null, billedTo: null, emissionsKg: null, co2CostCents: null, areaM2: 80, ownAppliances: false, commercialUse: false, commercialMetered: false,
  nonResidential: false, restriction: 'building', halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
  tenantName: 'Mieter', unitName: 'EG', settleLabel: '2025', claimDeadline: '2026-01-20', refundDue: '2026-03-01', proposalCents: null, proposalExcluded: null,
}
const TENANCIES = [
  { id: 't', unitId: 'w', tenantName: 'Mieter', start: '2020-01-01', end: null, heatingModel: 'selfSupply' as const },
  { id: 'x', unitId: 'v', tenantName: 'Andere', start: '2020-01-01', end: null },
]
const UNITS = [{ id: 'w', name: 'EG', areaM2: 80 }, { id: 'v', name: 'OG', areaM2: 60 }]
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
    const data = url.startsWith('/api/co2-refunds') && method === 'GET' ? [stored] : { ...stored }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = () => render(<UIProvider><Co2RefundsCard propertyId="objekt-1" period={{ key: periodKey('2025-01'), label: '2025' }} tenancies={TENANCIES} units={UNITS} /></UIProvider>)

test('Bearbeiten: Auswahl „Verrechnung“ und § 9 zeigen die gespeicherten Werte; Speichern schickt PUT', async () => {
  card()
  fireEvent.click(await screen.findByText('Bearbeiten'))
  const settle = screen.getByLabelText('Verrechnung')
  const restriction = screen.getByLabelText('Beschränkungen (§ 9 CO2KostAufG)')
  const tenant = screen.getByLabelText('Mieter')
  if (!(settle instanceof HTMLSelectElement) || !(restriction instanceof HTMLSelectElement) || !(tenant instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect([settle.value, restriction.value, tenant.value]).toEqual(['here', 'building', 't'])
  // Prüfung M4: nur Mieter, die selbst heizen.
  expect([...tenant.options].map((o) => o.value)).toEqual(['t'])
  fireEvent.click(screen.getByText('Erstattung speichern'))
  await waitFor(() => expect(sent.at(-1)?.url).toBe('/api/co2-refunds/e'))
  expect(sent.at(-1)?.method).toBe('PUT')
  expect(sent.at(-1)?.body).toMatchObject({ settlePeriod: '2025-01', restriction: 'building', amountCents: 24000 })
})

test('Erfassen: vorbelegt mit dem einzigen Mieter, der selbst heizt, und seiner Wohnfläche; POST', async () => {
  card()
  fireEvent.click(await screen.findByText('Erstattung erfassen'))
  fireEvent.change(screen.getByLabelText('Abrechnung des Lieferanten vom'), { target: { value: '2025-01-20' } })
  fireEvent.change(screen.getByLabelText('Verlangt in Textform am'), { target: { value: '2025-03-01' } })
  fireEvent.change(screen.getByLabelText('Betrag laut Anzeige (€)'), { target: { value: '240,00' } })
  fireEvent.click(screen.getByText('Erstattung speichern'))
  await waitFor(() => expect(sent.at(-1)?.method).toBe('POST'))
  expect(sent.at(-1)?.body).toMatchObject({ tenancyId: 't', amountCents: 24000, areaM2: 80, settlePeriod: null })
})
