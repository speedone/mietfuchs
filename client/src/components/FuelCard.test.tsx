// @vitest-environment jsdom
// Die Karte „Lieferungen“ (Heizung PR 7). Geprüft wird, was die Logiktests nicht sehen: Die Auswahl
// der Lieferung an einer Position zeigt die gespeicherte Verknüpfung (CLAUDE.md, Kosten.test.tsx), und
// eine Änderung schickt sie an die Position.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FuelCard from './FuelCard'
import { periodKey } from '../../../shared/period.ts'
import type { FuelDelivery, HeatingPeriodView } from '../types'

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2: null,
  items: [
    { id: 'gas', description: 'Gas Abschlussrechnung', amountCents: 650000, key: 'area', fuelDeliveryId: 'd' },
    { id: 'wart', description: 'Wartung', amountCents: 20000, key: 'area', fuelDeliveryId: null },
  ],
}
const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, emissionsKg: null, co2CostCents: null,
  emissionFactor: null, gridFeeCents: null, bioCostCents: null, sharePermille: null, fixedCents: null, estimated: false, usedByService: true, parts: [],
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const auswahl = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl an jeder Position zeigt die gespeicherte Lieferung', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(auswahl('Lieferung zu „Gas Abschlussrechnung“').value).toBe('d')
  expect(auswahl('Lieferung zu „Wartung“').value).toBe('')
  expect(screen.getByText(/15\.03\.2025–14\.03\.2026/)).toBeTruthy()
})

test('Eine Verknüpfung ändern schickt sie an die Position', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.change(auswahl('Lieferung zu „Wartung“'), { target: { value: 'd' } })
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/costItems/wart', method: 'PUT', body: { fuelDeliveryId: 'd' } }))
  fireEvent.change(auswahl('Lieferung zu „Gas Abschlussrechnung“'), { target: { value: '' } })
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/costItems/gas', method: 'PUT', body: { fuelDeliveryId: null } }))
})

test('Beim Messdienst gibt es keine Verknüpfung, aber den Betrag und „vom Messdienst angesetzt“', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'service' }} view={view} deliveries={[{ ...gas, amountCents: 311747 }]} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Lieferung zu „Wartung“')).toBeNull()
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  expect(screen.getByLabelText('Rechnungsbetrag')).toBeTruthy()
  expect(screen.getByLabelText('vom Messdienst angesetzt')).toBeTruthy()
})
