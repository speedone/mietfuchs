// @vitest-environment jsdom
// Die Karte „Warmwasser“ bei eigener Abrechnung (Heizung PR 11): Die Auswahl zum Erzeuger zeigt den
// gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), der Vorschlag aus den Zählern füllt das Volumen, und
// Speichern schickt Volumen und Temperatur.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HotWaterCard from './HotWaterCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from '../types'
import { noInfoView } from '../testing/heatingView'

const view = (over: Partial<HeatingPeriodView> = {}): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: 'volumeFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: 55 },
  hotWaterBasis: { volumeFromMetersM3: 118.25, volumeMissing: null, running: null, suppliedAreaM2: 200 },
  co2: null, items: [], stock: null,
  ...over,
})
const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', newDevicesInstall: null, source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: 'mixed', heatPumpMajority: null, hcaModel: null,
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

test('Vorschlag aus den Zählern; Speichern schickt Volumen und Temperatur, die Frage nach dem Erzeuger steht an der Anlage (Durchsicht #240, Recht-I2)', async () => {
  render(<HotWaterCard view={view()} plant={plant({ heatGeneration: 'single' })} onSaved={() => {}} />)
  expect(screen.queryByLabelText(/Erzeugt diese Heizung die Wärme allein/)).toBe(null)
  expect((screen.getByLabelText(/Mittlere Temperatur des Warmwassers/) as HTMLInputElement).value).toBe('55')
  fireEvent.click(screen.getByRole('button', { name: /Aus den Warmwasserzählern übernehmen: 118,25 m³/ }))
  expect((screen.getByLabelText(/Warmwasser in der Heizperiode/) as HTMLInputElement).value).toBe('118,25')
  fireEvent.click(screen.getByRole('button', { name: 'Angabe speichern' }))
  await waitFor(() => expect(sent.length).toBe(1), { timeout: 5000 })
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/hot-water')
  expect(sent[0]?.body).toMatchObject({ dhwMethod: 'volumeFormula', dhwVolumeM3: 118.25, dhwTempC: 55 })
})

test('Ohne Antwort zum Erzeuger ein Satz mit dem Weg zur Anlage; ohne Angabe ist bei eigener Abrechnung der Wärmezähler gewählt', () => {
  render(<HotWaterCard view={view()} plant={plant({ heatGeneration: null })} onSaved={() => {}} />)
  expect(screen.getByText(/beantworten Sie in den Stammdaten bei der Heizanlage/)).toBeTruthy()
  // Ohne Bestätigung des Aufwands nennt die Karte die Folge (M6).
  expect(screen.getByText(/um 15 % kürzen darf/)).toBeTruthy()
  cleanup()
  render(<HotWaterCard view={view({ hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null } })} plant={plant()} onSaved={() => {}} />)
  expect((screen.getByLabelText(/Wie wird die Wärme für das Warmwasser bestimmt/) as HTMLSelectElement).value).toBe('heatMeter')
})

test('Durchsicht #240, Geld-I1 und M5: beim Kesseltausch heißt das Volumen das der Laufzeit; fehlt ein Stand, kein Vorschlag, sondern welcher fehlt', () => {
  render(<HotWaterCard view={view({ hotWaterBasis: { volumeFromMetersM3: 17.5, volumeMissing: null, running: { from: '2025-07-01', to: '2025-12-31' }, suppliedAreaM2: 200 } })} plant={plant()} onSaved={() => {}} />)
  expect(screen.getByLabelText(/Warmwasser in der Laufzeit dieser Anlage \(01\.07\.2025–31\.12\.2025/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /übernehmen: 17,5 m³/ })).toBeTruthy()
  cleanup()
  render(<HotWaterCard view={view({ hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: 'Für den Vorschlag aus den Warmwasserzählern fehlt ein Stand: „WW A“ zum 31.12.2025.', running: null, suppliedAreaM2: 200 } })} plant={plant()} onSaved={() => {}} />)
  expect(screen.queryByRole('button', { name: /übernehmen/ })).toBe(null)
  expect(screen.getByText(/„WW A“ zum 31\.12\.2025/)).toBeTruthy()
  cleanup()
  render(<HotWaterCard view={view({ hotWaterBasis: { volumeFromMetersM3: 0, volumeMissing: null, running: null, suppliedAreaM2: 200 } })} plant={plant()} onSaved={() => {}} />)
  expect(screen.queryByRole('button', { name: /übernehmen/ })).toBe(null)
})
