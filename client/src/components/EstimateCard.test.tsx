// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EstimateCard from './EstimateCard'
import { UIProvider } from './feedback'
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
  estimates: [{ plantId: 'hp-alt', unitId: 'a', unitName: 'A', part: 'heat', value: 9000, method: 'comparableUnit', reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh', users: 1, kept: 0, complete: false }],
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
  fireEvent.click(screen.getByLabelText(/Der Verbrauch ließ sich nicht ordnungsgemäß erfassen/))
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/heating-plants/hp/periods/2025-01/estimates/c/heat', 'PUT', JSON.stringify({ value: 12000, method: 'buildingAverage', reason: 'Wärmezähler defekt', confirmed: true, cause: 'deviceFailure' })]])
})

test('Entfernen geht an die Anlage, an der die Schätzung steht (Kesseltausch), und die vollständige Wohnung ist unter „Gerät zeigt falsch an“', async () => {
  const calls = mockFetch()
  const onChanged = vi.fn()
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/A, Heizung: geschätzt 9\.000 kWh \(bestätigt; Begründung: „Zähler defekt“\)/)).toBeTruthy()
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

// ---------- Durchsicht von #242 (Recht: R-I1, R-I3, R-M1, R-M2, R-M3, R-M10; Geld: G-I1) ----------

test('R-I1/R-I3/R-M3: Wortlaut des § 9a, Grund als Auswahl, Hinweis zur Begründung, Feld für die ganze Heizperiode', () => {
  const { container } = render(<EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} />)
  expect(container.textContent).toMatch(/nicht ordnungsgemäß erfasst/)
  expect(container.textContent).not.toMatch(/nicht mehr ablesen|ließ sich nicht mehr ablesen/)
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  const grund = screen.getByLabelText('Grund nach § 9a Abs. 1') as HTMLSelectElement
  expect(grund.value).toBe('deviceFailure')
  expect([...grund.options].map((o) => o.textContent)).toEqual(['Gerät ausgefallen', 'Gerät zeigt falsch an', 'Ablesung nicht möglich', 'anderer zwingender Grund'])
  expect(screen.getByText('Erscheint so auf der Abrechnung des Mieters dieser Wohnung.')).toBeTruthy()
  expect(screen.getByLabelText(/Geschätzter Verbrauch in kWh für die ganze Heizperiode der Wohnung/)).toBeTruthy()
  expect(screen.getByLabelText(/Der Verbrauch ließ sich nicht ordnungsgemäß erfassen/)).toBeTruthy()
  // Die Zeilen stehen auf einer Linie mit ihren Knöpfen (R-M10).
  expect(container.querySelectorAll('.row.center').length).toBeGreaterThan(0)
})

test('R-I1: unter „Gerät zeigt falsch an“ ist dieser Grund vorgewählt; bei Heizkostenverteilern heißt das Feld „bewertete Einheiten“', () => {
  render(<EstimateCard plant={plant} view={view} self={{ ...self, pots: [{ ...self.pots[0]!, consumptionUnit: 'Einheiten' }] }} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'D schätzen' }))
  expect((screen.getByLabelText('Grund nach § 9a Abs. 1') as HTMLSelectElement).value).toBe('wrongReading')
  expect(screen.getByLabelText(/Geschätzter Verbrauch in bewerteten Einheiten \(Ablesewert × Bewertungsfaktor\)/)).toBeTruthy()
})

test('R-M1: die vergleichbare Wohnung nennt die Einheit je m²', () => {
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  fireEvent.change(screen.getByLabelText('Weg nach § 9a Abs. 1'), { target: { value: 'comparableUnit' } })
  expect(screen.getByRole('option', { name: 'B (150 kWh je m²)' })).toBeTruthy()
})

test('R-M2: ohne Bestätigung gespeichert sagt die Meldung das', async () => {
  mockFetch()
  render(<UIProvider><EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} /></UIProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Wärmezähler defekt' } })
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  await waitFor(() => expect(screen.getByText(/Gespeichert, aber noch nicht bestätigt; die Abrechnung meldet das/)).toBeTruthy())
})

test('G-I1: eine Schätzung, die nicht zur Erfassung passt, steht mit „Schätzung neu eintragen“ da und wird mit dem Vorschlag neu eingetragen', () => {
  const stale = { ...self, estimates: [{ plantId: 'hp', unitId: 'c', unitName: 'C', part: 'heat' as const, value: 12000, method: 'buildingAverage' as const, reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure' as const, capture: 'hca' as const, valueUnit: 'Einheiten' as const, users: 0, kept: 0, complete: false, stale: true }] }
  render(<EstimateCard plant={plant} view={view} self={stale} onChanged={() => {}} />)
  expect(screen.getByText(/C, Heizung: Schätzung in Einheiten passt nicht mehr zur Erfassung/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung neu eintragen' }))
  expect((screen.getByLabelText(/Geschätzter Verbrauch/) as HTMLInputElement).value).toBe('12000')
  expect((screen.getByLabelText('Begründung') as HTMLInputElement).value).toBe('Zähler defekt')
  expect((screen.getByLabelText(/Der Verbrauch ließ sich nicht ordnungsgemäß erfassen/) as HTMLInputElement).checked).toBe(false)
})

// ---------- Durchsicht von #242 Runde 2 (N-I1, N-I2, N-M3) ----------

const staleD = { plantId: 'hp', unitId: 'd', unitName: 'D', part: 'heat' as const, value: 4000, method: 'buildingAverage' as const, reason: 'Zähler zeigt falsch an', confirmed: true, cause: 'wrongReading' as const, capture: 'heatMeter' as const, valueUnit: 'kWh' as const, users: 0, kept: 0, complete: false, stale: true }

test('N-I1: eine veraltete Schätzung neben vollständiger Ablesung steht sichtbar da, mit „Entfernen“ und „Schätzung neu eintragen“', async () => {
  const calls = mockFetch()
  const onChanged = vi.fn()
  render(<EstimateCard plant={plant} view={view} self={{ ...self, estimates: [...(self.estimates ?? []), staleD] }} onChanged={onChanged} />)
  const row = screen.getByText(/D, Heizung: Schätzung in kWh passt nicht mehr/)
  expect(row.closest('details')).toBeNull()
  expect(screen.getByRole('button', { name: 'Schätzung neu eintragen' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung von D entfernen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/heating-plants/hp/periods/2025-01/estimates/d/heat', 'DELETE', undefined]])
})

test('N-I2: die Karte sagt nur bei einem ersetzten gemessenen Teilstück, dass abgelesene Zeiten ersetzt werden', () => {
  const mit = { ...self, estimates: [{ ...(self.estimates?.[0] ?? staleD), replacesMeasured: true }] }
  const { container } = render(<EstimateCard plant={plant} view={view} self={mit} onChanged={() => {}} />)
  expect(screen.getByText(/A, Heizung: geschätzt .*ersetzt auch abgelesene Zeiten/)).toBeTruthy()
  cleanup()
  render(<EstimateCard plant={plant} view={view} self={self} onChanged={() => {}} />)
  expect(screen.queryByText(/ersetzt auch abgelesene Zeiten/)).toBeNull()
  expect(container).toBeTruthy()
})

test('N-M3: beim Ablesedienst ohne Werte ist die Einheit eine Pflichtauswahl; mit Werten vorbelegt', async () => {
  const calls = mockFetch()
  const dienst = { ...self, serviceValues: [], pots: [{ ...self.pots[0]!, consumptionUnit: 'Einheiten' as const }] }
  render(<EstimateCard plant={plant} view={view} self={dienst} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  const einheit = screen.getByLabelText('Einheit der Schätzung') as HTMLSelectElement
  expect(einheit.value).toBe('')
  fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Werte fehlen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  expect(screen.getByText(/Einheit/, { selector: '.error' })).toBeTruthy()
  expect(calls).toEqual([])
  fireEvent.change(einheit, { target: { value: 'kWh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Schätzung speichern' }))
  await waitFor(() => expect(calls.length).toBe(1))
  expect(JSON.parse(calls[0]?.[2] ?? '{}').valueUnit).toBe('kWh')
  cleanup()
  const mitWerten = { ...dienst, serviceValues: [{ plantId: 'hp', period: '2025-01', unitId: 'a', from: '2025-01-01', to: '2025-12-31', heatValue: 12000, waterValue: null, heatUnit: 'kWh' as const }] } as unknown as SelfHeatingStatement
  render(<EstimateCard plant={plant} view={view} self={mitWerten} onChanged={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'C schätzen' }))
  expect((screen.getByLabelText('Einheit der Schätzung') as HTMLSelectElement).value).toBe('kWh')
})
