// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfHeatingCards from './SelfHeatingCards'
import type { HeatingDistribution, HeatingPeriodView, HeatingPlant, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const unit = (id: string, name: string, value: number) => ({
  unitId: id, unitName: name, areaM2: 60, heatAreaM2: 60, users: [],
  readings: [{ boundary: '2025-12-31', meterId: `w${id}`, meterName: `Wärme ${name}`, pot: 'heating' as const, date: '2025-12-31', value }],
  boundaries: [] as SelfHeatingStatement['units'][number]['boundaries'],
})
const statement = (units: SelfHeatingStatement['units']) => ({
  ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: { heating: 70, water: 70, forced: false, previous: null }, pots: [], units,
} as SelfHeatingStatement)

test('fehlende Zwischenablesung: „nicht möglich“ erst mit Grund; beide Folgen stehen vor der Wahl (Durchsicht von #239, I3)', async () => {
  const sent: { url: string; method?: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: 'Wohnung nicht zugänglich' }), { status: 200 })
  })
  const c = { ...unit('c', 'C', 0), readings: [], boundaries: [{ date: '2025-09-30', kind: 'change' as const, status: 'missing' as const, offDays: 0, far: false, gap: null }] }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([c])} onChanged={onChanged} />)
  expect(screen.getByText(/C, Mieterwechsel zum 30\.09\.2025: keine Ablesung/)).toBeTruthy()
  expect(screen.getByText(/Nicht durchgeführt: .* um 15 % kürzen/)).toBeTruthy()
  expect(screen.getByText(/Nicht möglich: .* Nennen Sie den Grund/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  expect(sent).toEqual([])
  const speichern = screen.getByRole('button', { name: 'Grund speichern' }) as HTMLButtonElement
  expect(speichern.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(/Warum war die Zwischenablesung nicht möglich/), { target: { value: 'Wohnung nicht zugänglich' } })
  fireEvent.click(speichern)
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ url: '/api/units/c/interim-gaps/2025-09-30', method: 'PUT', body: { status: 'impossible', reason: 'Wohnung nicht zugänglich' } }])
})

test('Ableseergebnis: gezeigt und gedruckt wird die gewählte Wohnung, nicht alle (Durchsicht von #239, I2)', () => {
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={statement([unit('a', 'A', 1111), unit('b', 'B', 2222)])} onChanged={() => undefined} />)
  expect(screen.getByText(/Wärme A: 1\.111 kWh/)).toBeTruthy()
  expect(screen.queryByText(/Wärme B: 2\.222 kWh/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Wohnung'), { target: { value: 'b' } })
  expect(screen.queryByText(/Wärme A: 1\.111 kWh/)).toBeNull()
  expect(screen.getByText(/Wärme B: 2\.222 kWh/)).toBeTruthy()
  expect(screen.getByText(/Warmwasserzähler eingebaut ist \(§ 6 Abs\. 1 Satz 4\)/)).toBeTruthy()
})

test('Pflichtanteil in begonnener Heizperiode nachtragen; „Weiß ich nicht“ unter 70 % bekommt den Rat (Durchsicht von #239, C1)', async () => {
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    sent.push(init?.body ? JSON.parse(String(init.body)) : null)
    return new Response('{}', { status: 200 })
  })
  const d: HeatingDistribution = {
    own: { heating: 50, water: null, insulationRule: 'unknown' }, effective: { heating: 50, water: null, insulationRule: 'unknown' },
    inherited: false, begun: true, first: false, forcedPercent: null,
  }
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'oil', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: d } as HeatingPeriodView} self={null} onChanged={onChanged} />)
  expect(screen.getByText(/Mit 70 % liegen Sie in jedem Fall richtig/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Pflichtanteil eintragen' })).toBeNull()
  fireEvent.change(screen.getByLabelText(/Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau/), { target: { value: 'applies' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pflichtanteil eintragen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent).toEqual([{ heatConsumptionPct: 70, waterConsumptionPct: null, insulationRule: 'applies' }])
})

test('Fernwärme: keine Frage zum Wärmeschutz (Durchsicht von #239, M1)', () => {
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self', energy: 'districtHeating', hotWater: 'none' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={null} onChanged={() => undefined} />)
  expect(screen.queryByText(/Wärmeschutzverordnung/)).toBeNull()
})
