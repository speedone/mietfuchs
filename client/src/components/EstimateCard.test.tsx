// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EstimateCard from './EstimateCard'
import type { HeatingPeriodView, HeatingPlant, SelfEstimateOption, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const proposals = (avg: number): SelfEstimateOption['proposals'] => [
  { method: 'buildingAverage', value: avg, perM2: avg / 60, why: 'ok' },
  { method: 'previousPeriod', value: null, perM2: null, why: 'noPrevious' },
  { method: 'comparableUnit', value: null, perM2: null, why: 'ok' },
]
const self = {
  ok: false, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: null,
  pots: [{ pot: 'heating', costCents: 0, consumptionPct: 70, byAreaOnly: false, areaM2: 200, consumption: 28000, consumptionUnit: 'kWh', baseCentsPerM2: 0, consumptionCentsPerUnit: null, overThreshold: false, estimatedAreaM2: 60 }],
  units: [], threshold: 25,
  estimates: [{ plantId: 'hp-alt', unitId: 'a', unitName: 'A', part: 'heat', value: 9000, method: 'comparableUnit', reason: 'Zähler defekt', confirmed: true, users: 1, kept: 0, complete: false }],
  estimateOptions: [
    { unitId: 'a', unitName: 'A', part: 'heat', areaM2: 60, why: null, boundary: null, estimated: true, proposals: proposals(9500), comparable: [{ unitId: 'b', unitName: 'B', perM2: 150, value: 9000 }] },
    { unitId: 'c', unitName: 'C', part: 'heat', areaM2: 60, why: 'noReading', boundary: '2025-12-31', estimated: false, proposals: proposals(12000), comparable: [{ unitId: 'b', unitName: 'B', perM2: 150, value: 9000 }] },
    { unitId: 'd', unitName: 'D', part: 'heat', areaM2: 20, why: null, boundary: null, estimated: false, proposals: proposals(4000), comparable: [] },
  ],
} as SelfHeatingStatement
const plant = { id: 'hp', method: 'self', hotWater: 'none' } as HeatingPlant
const view = { period: '2025-01', label: '2025', from: '2025-01-01', closed: false } as HeatingPeriodView
const mockFetch = () => {
  const calls: [string, string | undefined, string | undefined][] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push([String(url), init?.method, typeof init?.body === 'string' ? init.body : undefined])
    return new Response(JSON.stringify({}), { status: 200 })
  })
  return calls
}

test('die Auswahlfelder zeigen den gespeicherten Weg und die gewählte Wohnung', () => {
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung von A ändern' }))
  const weg = screen.getByLabelText('Weg nach § 9a Abs. 1') as HTMLSelectElement
  expect(weg.value).toBe('comparableUnit')
  const wohnung = screen.getByLabelText('Vergleichbare Wohnung') as HTMLSelectElement
  expect(wohnung.value).toBe('')
  fireEvent.change(wohnung, { target: { value: 'b' } })
  expect((screen.getByLabelText('Vergleichbare Wohnung') as HTMLSelectElement).value).toBe('b')
  expect((screen.getByLabelText(/Geschätzter Verbrauch/) as HTMLInputElement).value).toBe('9000')
  fireEvent.change(weg, { target: { value: 'buildingAverage' } })
  expect((screen.getByLabelText('Weg nach § 9a Abs. 1') as HTMLSelectElement).value).toBe('buildingAverage')
  expect((screen.getByLabelText(/Geschätzter Verbrauch/) as HTMLInputElement).value).toBe('9500')
})

test('fehlender Endstand: Dialog mit Vorschlag und Flächenanteil, Speichern geht an den Server', async () => {
  const calls = mockFetch()
  const onChanged = vi.fn()
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/C, Heizung: Stand fehlt zum 31\.12\.2025/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  expect((screen.getByLabelText(/Geschätzter Verbrauch in kWh/) as HTMLInputElement).value).toBe('12000')
  // A ist schon geschätzt (60 m²), mit C sind es 120 von 200 m².
  expect(screen.getByText(/120 von 200 m², also 60 %/)).toBeTruthy()
  expect(screen.getByText(/überschreitet 25 %/)).toBeTruthy()
  // Die Vorperiode hat keinen Vorschlag: Der Wert bleibt, und die Karte sagt warum.
  fireEvent.change(screen.getByLabelText('Weg nach § 9a Abs. 1'), { target: { value: 'previousPeriod' } })
  expect((screen.getByLabelText(/Geschätzter Verbrauch/) as HTMLInputElement).value).toBe('12000')
  expect(screen.getByText(/keinen vollständig abgelesenen Verbrauch dieser Wohnung.*selbst ein/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Weg nach § 9a Abs. 1'), { target: { value: 'buildingAverage' } })
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  expect(screen.getByText(/Begründung/, { selector: '.error' })).toBeTruthy()
  expect(calls).toEqual([])
  fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Wärmezähler defekt' } })
  fireEvent.click(screen.getByLabelText(/Der Wert ließ sich nicht mehr ablesen/))
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/heating-plants/hp/periods/2025-01/estimates/c/heat', 'PUT', JSON.stringify({ value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true })]])
})

test('Entfernen geht an die Anlage, an der die Schätzung steht (Kesseltausch), und die vollständige Wohnung ist unter „Gerät zeigt falsch an“', async () => {
  const calls = mockFetch()
  const onChanged = vi.fn()
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/A, Heizung: geschätzt 9\.000 kWh \(bestätigt; Zähler defekt\)/)).toBeTruthy()
  expect(screen.getByText('Gerät zeigt falsch an, obwohl alle Stände eingetragen sind')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'D schätzen' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung von A entfernen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/heating-plants/hp-alt/periods/2025-01/estimates/a/heat', 'DELETE', undefined]])
})

test('abgeschlossene Heizperiode: nur anzeigen; ohne Angaben (Abrechnung vor Heizung PR 13) keine Karte', () => {
  render(<EstimateCard plant={plant} view={{ ...view, closed: true }} self={self} onChanged={() => {}} />)
  expect(screen.getByText(/A, Heizung: geschätzt/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /schätzen|ändern|entfernen/i })).toBeNull()
  cleanup()
  const { container } = render(<EstimateCard plant={plant} view={view} self={{ ...self, estimates: undefined, estimateOptions: undefined }} onChanged={() => {}} />)
  expect(container.textContent).toBe('')
})
