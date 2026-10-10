// @vitest-environment jsdom
// Die Karte „Lieferungen“ (Heizung PR 7). Geprüft wird, was die Logiktests nicht sehen: Die Auswahl
// der Lieferung an einer Position zeigt die gespeicherte Verknüpfung (CLAUDE.md, Kosten.test.tsx), und
// eine Änderung schickt sie an die Position.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FuelCard from './FuelCard'
import { periodKey } from '../../../shared/period.ts'
import type { FuelDelivery, HeatingPeriodView } from '../types'
import { noInfoView } from '../testing/heatingView'

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null }, hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null,
  items: [
    { id: 'gas', description: 'Gas Abschlussrechnung', amountCents: 650000, key: 'area', fuelDeliveryId: 'd' },
    { id: 'wart', description: 'Wartung', amountCents: 20000, key: 'area', fuelDeliveryId: null },
  ],
}
const gas: FuelDelivery = {
  id: 'd', plantId: 'hp', label: 'Gas 2025/2026', invoiceDate: null, deliveredAt: null, invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', unitId: null,
  amountCents: null, quantity: null, quantityUnit: null, energyKwh: null, gasBasis: null, heatingValue: null, fuelGrade: null, emissionsKg: null, co2CostCents: null,
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

test('Durchsicht: Die Karte sagt, dass ohne Verknüpfung nichts abgegrenzt wird; bei einer Wärmepumpe keine CO₂-Felder', () => {
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'heatPump' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  expect(screen.getByText(/Ohne Verknüpfung grenzt Mietfuchs nichts ab/)).toBeTruthy()
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  expect(screen.queryByLabelText('CO₂-Ausstoß laut Rechnung (kg)')).toBeNull()
  expect(screen.queryByLabelText('CO₂-Kosten laut Rechnung')).toBeNull()
})

test('Heizöl (Heizung PR 8): Lieferdatum, Menge und Einheit statt Rechnungszeitraum; die Auswahl zeigt die gespeicherte Einheit', async () => {
  const oel: FuelDelivery = { ...gas, label: '', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', quantity: 2500, quantityUnit: 'l' }
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil' }} view={view} deliveries={[oel]} onSaved={() => {}} />)
  expect(screen.getByText(/geliefert am 10\.10\.2025 · 2\.500 l/)).toBeTruthy()
  expect(screen.getByText(/mit Lieferdatum und Menge/)).toBeTruthy()
  // Durchsicht von #237, M5: Der Betrag kommt aus der verknüpften Position, und die Karte sagt es.
  expect(screen.getByText(/Den Betrag nimmt Mietfuchs aus der verknüpften Kostenposition; ohne Verknüpfung geht die Bestandsrechnung nicht auf\./)).toBeTruthy()
  fireEvent.click(screen.getByText('Ändern'))
  expect(screen.queryByLabelText('Rechnungszeitraum von')).toBeNull()
  // M4: Ein leeres Rechnungsdatum ist das Lieferdatum, und das Feld sagt es.
  expect(screen.getByLabelText('Rechnungsdatum (leer: Lieferdatum)')).toBeTruthy()
  expect(auswahl('Einheit der Menge').value).toBe('l')
  fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '2600' } })
  fireEvent.click(screen.getByText('Lieferung speichern'))
  await waitFor(() => expect(sent.at(-1)?.body).toMatchObject({ deliveredAt: '2025-10-10', quantity: 2600, quantityUnit: 'l' }))
})

test('Heizöl (Durchsicht von #237, M5): Die Zeile nennt den Betrag aus der verknüpften Position', () => {
  const oel: FuelDelivery = { ...gas, id: 'd', label: '', invoiceFrom: null, invoiceTo: null, deliveredAt: '2025-10-10', invoiceDate: '2025-10-12', quantity: 2500, quantityUnit: 'l' }
  render(<FuelCard plant={{ id: 'hp', method: 'manual', energy: 'oil' }} view={view} deliveries={[oel]} onSaved={() => {}} />)
  // Die Position „Gas Abschlussrechnung“ der Ansicht zeigt auf „d“ und hat 6.500,00 €.
  expect(screen.getByText(/Betrag laut Position 6\.500,00 €/)).toBeTruthy()
})

test('Heizung PR 11: beim Vorrat Heizwert laut Rechnung, ohne ihn die Zeile der Tabelle; bei Gas Brennwert oder Heizwert', async () => {
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'pellets' }} view={view} deliveries={[]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  // Pellets haben genau eine Zeile; sie ist vorbelegt.
  expect(auswahl('Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung').value).toBe('woodPellets')
  fireEvent.change(screen.getByLabelText('Lieferdatum'), { target: { value: '2025-10-12' } })
  fireEvent.change(screen.getByLabelText('Menge'), { target: { value: '3000' } })
  fireEvent.change(auswahl('Einheit der Menge'), { target: { value: 'kg' } })
  fireEvent.change(screen.getByLabelText('Heizwert laut Rechnung (kWh je Kilogramm)'), { target: { value: '4,9' } })
  expect(screen.queryByLabelText('Steht kein Heizwert auf der Rechnung: Brennstoff laut Heizkostenverordnung')).toBeNull()
  fireEvent.click(screen.getByText('Lieferung speichern'))
  await waitFor(() => expect(sent.at(-1)).toMatchObject({ url: '/api/heating-plants/hp/deliveries', method: 'POST', body: { heatingValue: 4.9, fuelGrade: null, quantityUnit: 'kg' } }))
  cleanup()
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'gas' }} view={view} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  expect(screen.queryByLabelText(/Heizwert laut Rechnung/)).toBeNull()
  expect(auswahl('Kilowattstunden der Rechnung berechnet nach').value).toBe('')
  // Ohne Formel für das Warmwasser kein Hinweis; die Angabe ist nicht vorbelegt.
  expect(screen.queryByText(/ohne sie rechnet die Formel nicht/)).toBeNull()
})

test('Durchsicht #240, Recht-I3: bei Formel für das Warmwasser sagt die Gasrechnung schon an der Lieferung, dass Brennwert/Heizwert fehlt', () => {
  const formel = { ...view, hotWater: { ...view.hotWater, dhwMethod: 'volumeFormula' as const } }
  render(<FuelCard plant={{ id: 'hp', method: 'self', energy: 'gas' }} view={formel} deliveries={[gas]} onSaved={() => {}} />)
  fireEvent.click(screen.getByText('Lieferung eintragen'))
  expect(screen.getByText(/ohne sie rechnet die Formel nicht/)).toBeTruthy()
  fireEvent.change(auswahl('Kilowattstunden der Rechnung berechnet nach'), { target: { value: 'hs' } })
  expect(screen.queryByText(/ohne sie rechnet die Formel nicht/)).toBeNull()
})
