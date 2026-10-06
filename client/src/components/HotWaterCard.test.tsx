// @vitest-environment jsdom
// Die Karte „Warmwasser“ bei eigener Abrechnung (Heizung PR 11): Die Auswahl zum Erzeuger zeigt den
// gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), der Vorschlag aus den Zählern füllt das Volumen, und
// Speichern schickt Volumen und Temperatur.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HotWaterCard from './HotWaterCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from '../types'

const view = (over: Partial<HeatingPeriodView> = {}): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: 'volumeFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: 55 },
  hotWaterBasis: { volumeFromMetersM3: 118.25, suppliedAreaM2: 200 },
  co2: null, items: [], stock: null,
  ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: 'mixed',
  ...over,
})

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

test('Erzeuger zeigt den gespeicherten Wert; Vorschlag aus den Zählern; Speichern schickt Volumen und Temperatur', async () => {
  render(<HotWaterCard view={view()} plant={plant()} onSaved={() => {}} />)
  const generation = screen.getByLabelText(/Erzeugt diese Heizung die Wärme allein/) as HTMLSelectElement
  expect(generation.value).toBe('mixed')
  expect((screen.getByLabelText(/Mittlere Temperatur des Warmwassers/) as HTMLInputElement).value).toBe('55')
  fireEvent.click(screen.getByRole('button', { name: /Aus den Warmwasserzählern übernehmen: 118,25 m³/ }))
  expect((screen.getByLabelText(/Warmwasser in der Heizperiode/) as HTMLInputElement).value).toBe('118,25')
  fireEvent.change(generation, { target: { value: 'single' } })
  fireEvent.click(screen.getByRole('button', { name: 'Angabe speichern' }))
  await waitFor(() => expect(sent.length).toBe(2), { timeout: 5000 })
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/hot-water')
  expect(sent[0]?.body).toMatchObject({ dhwMethod: 'volumeFormula', dhwVolumeM3: 118.25, dhwTempC: 55 })
  expect(sent[1]).toMatchObject({ url: '/api/heating-plants/hp', method: 'PUT', body: { heatGeneration: 'single' } })
})

test('Ohne Antwort zum Erzeuger steht „bitte wählen“; ohne Angabe ist bei eigener Abrechnung der Wärmezähler gewählt', () => {
  render(<HotWaterCard view={view()} plant={plant({ heatGeneration: null })} onSaved={() => {}} />)
  expect((screen.getByLabelText(/Erzeugt diese Heizung die Wärme allein/) as HTMLSelectElement).value).toBe('')
  cleanup()
  render(<HotWaterCard view={view({ hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null } })} plant={plant()} onSaved={() => {}} />)
  expect((screen.getByLabelText(/Wie wird die Wärme für das Warmwasser bestimmt/) as HTMLSelectElement).value).toBe('heatMeter')
  expect(screen.queryByLabelText(/Erzeugt diese Heizung/)).toBe(null)
})
