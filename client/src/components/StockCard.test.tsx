// @vitest-environment jsdom
// Die Karte „Vorrat“ (Heizung PR 8): Die Auswahl zeigt den gespeicherten Wert, eine Folgeperiode zeigt
// den Anfangsbestand aus der Vorperiode statt Eingabefeldern, und Speichern schickt die Felder.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import StockCard from './StockCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, StockView } from '../types'
import { noInfoView } from '../testing/heatingView'

const STOCK: StockView = {
  row: { stockUnit: 'kg', openingQuantity: 1000, openingCostCents: 30000, openingEmissionsKg: null, openingCo2Cents: null, openingInvoicedBefore2023: null, openingAlreadySettled: null, closingQuantity: 400, closingMeasuredOn: null },
  derived: null, closingLockedBy: null, askAlreadySettled: false, defaultAlreadySettled: null, statement: null, frozen: null, problem: null,
}
const view = (stock: StockView): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null }, hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, items: [], stock,
})
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(STOCK), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const einheit = (): HTMLSelectElement => {
  const el = screen.getByLabelText('Einheit des Vorrats')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl zeigt die gespeicherte Einheit; Speichern schickt sie an die Heizperiode', async () => {
  const saved = vi.fn()
  render(<StockCard view={view(STOCK)} onSaved={saved} />)
  expect(einheit().value).toBe('kg')
  expect(einheit().selectedOptions[0]?.textContent).toBe('Kilogramm')
  fireEvent.click(screen.getByText('Vorrat speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/stock')
  expect(sent[0]?.body).toMatchObject({ stockUnit: 'kg', openingQuantity: 1000, closingQuantity: 400 })
})

test('Folgeperiode: Anfangsbestand aus der Vorperiode, keine Eingabefelder dafür', () => {
  render(<StockCard view={view({ ...STOCK, derived: { value: { quantity: 400, costCents: 12000, emissionsKg: 0, co2Cents: 0, layers: [] }, period: periodKey('2024-01'), label: '2024', frozen: true } })} onSaved={() => {}} />)
  expect(screen.getByText(/Anfangsbestand aus dem Endbestand der Heizperiode 2024 \(abgeschlossen\)/)).toBeTruthy()
  expect(screen.queryByLabelText('Anfangsbestand (Menge)')).toBeNull()
})

test('Durchsicht von #237, C1: Nach einer Abrechnung nach Lieferung fragt die Karte, vorbelegt mit „ja“, und schickt die Antwort', async () => {
  const saved = vi.fn()
  render(<StockCard view={view({ ...STOCK, askAlreadySettled: true, defaultAlreadySettled: 'default' })} onSaved={saved} energy="oil" />)
  const frage = screen.getByLabelText('Anfangsbestand schon umgelegt')
  if (!(frage instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(frage.value).toBe('yes')
  expect(screen.getByText(/Peilstab/)).toBeTruthy()
  fireEvent.click(screen.getByText('Vorrat speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.body).toMatchObject({ openingAlreadySettled: true })
})

// Nachprüfung von 819398e (W1y): Steht im Vorjahr nur eine Wartung ohne Kennzeichen, belegt die Karte
// nichts vor und schickt nichts; vorher machte das erste Speichern aus der Vorbelegung „Ja“ eine Angabe,
// und der Vermieter trug 2.000 € mit bloßem Hinweis.
for (const def of ['defaultLoose', null] as const) {
  test(`Nachprüfung von 819398e: Vorbelegung ${def ?? 'keine'}: „Bitte wählen …“, und Speichern schickt keine Antwort`, async () => {
    const saved = vi.fn()
    render(<StockCard view={view({ ...STOCK, askAlreadySettled: true, defaultAlreadySettled: def })} onSaved={saved} energy="oil" />)
    const frage = screen.getByLabelText('Anfangsbestand schon umgelegt')
    if (!(frage instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
    expect(frage.value).toBe('')
    expect(frage.selectedOptions[0]?.textContent).toBe('Bitte wählen …')
    fireEvent.click(screen.getByText('Vorrat speichern'))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(sent[0]?.body && 'openingAlreadySettled' in sent[0].body).toBe(false)
  })
}

test('Durchsicht von #237, M1: Eine abgeschlossene Heizperiode zeigt die eingefrorene Bestandsrechnung', () => {
  const frozen = {
    unit: 'kg' as const, openingSource: 'own' as const, closingMeasuredOn: null, paidCents: 0, oldStockKg: 0,
    opening: { quantity: 1000, costCents: 30000, emissionsKg: 0, co2Cents: 0, layers: [] },
    deliveries: [], closing: { quantity: 400, costCents: 12000, emissionsKg: 0, co2Cents: 0, layers: [] },
    consumed: { quantity: 600, costCents: 18000, emissionsKg: 0, co2Cents: 0 },
  }
  render(<StockCard view={{ ...view({ ...STOCK, frozen }), closed: true }} onSaved={() => {}} co2Fields={false} />)
  expect(screen.getByText(/Verbraucht 600 kg/)).toBeTruthy()
  expect(screen.getByText(/wie sie abgerechnet ist/)).toBeTruthy()
})
