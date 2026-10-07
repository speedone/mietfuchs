// @vitest-environment jsdom
// Die Druckansicht „CO₂-Angaben für den Messdienst“ (Heizung PR 17, Durchsicht von #246): Vermerke stehen an
// der Zeile, der Kasten „Bitte prüfen“ ist für den Vermieter und wird nicht gedruckt (R-W2).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Co2SheetView from './Co2SheetView'
import type { Co2Sheet } from '../types'

const sheet: Co2Sheet = {
  propertyName: 'Haus am Park', address: 'Parkweg 1', landlordName: 'Erika Muster', plantName: 'Kessel', energy: 'oil', createdOn: '2026-10-07', checked: true,
  period: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, areaM2: 300, areaSource: 'served', nonResidential: false, restriction: 'none', districtEtsNew: false,
  stock: null, opening: null,
  deliveries: [{
    id: 'd', label: 'Heizöl', invoiceDate: '2022-11-15', from: null, to: null, deliveredAt: '2022-11-15', quantity: 3000, quantityUnit: 'l', energyKwh: null, gasBasis: null, emissionFactor: null,
    emissionsKg: 8028.9, co2CostCents: 28663, amountCents: 315000, estimated: false, counted: 'kgOnly', factor: 1, note: 'Vor dem 01.01.2023 in Rechnung gestellt …', findings: ['„Heizöl“: Die CO₂-Kosten … passen nicht'],
  }],
  totals: { emissionsKg: 8028.9, co2CostCents: 0 },
}
beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(sheet), { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Vermerk an der Zeile; „Bitte prüfen“ wird nicht gedruckt', async () => {
  render(<Co2SheetView plantId="hp" period="2025-01" onClose={() => {}} />)
  expect(await screen.findByText('Vor dem 01.01.2023 in Rechnung gestellt …')).toBeTruthy()
  const box = screen.getByText('Bitte prüfen').closest('div')
  expect(box?.className).toMatch(/no-print/)
})
