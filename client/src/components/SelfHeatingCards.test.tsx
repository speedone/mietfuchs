// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SelfHeatingCards from './SelfHeatingCards'
import type { HeatingPeriodView, HeatingPlant, SelfHeatingStatement } from '../types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('fehlende Zwischenablesung: die Antwort geht an den Server, die Seite lädt neu', async () => {
  const calls: [string, string | undefined][] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push([String(url), init?.method])
    return new Response(JSON.stringify({ unitId: 'c', date: '2025-09-30', status: 'impossible', reason: '' }), { status: 200 })
  })
  const self = {
    ok: true, heatPump: null, changeSplit: 'degreeDays', areaBasisHeat: 'area', hotWater: 'none', alpha: null, shares: { heating: 70, water: 70, forced: false, previous: null }, pots: [],
    units: [{ unitId: 'c', unitName: 'C', areaM2: 60, heatAreaM2: 60, readings: [], users: [], boundaries: [{ date: '2025-09-30', kind: 'change', status: 'missing', offDays: 0, far: false, gap: null }] }],
  } as SelfHeatingStatement
  const onChanged = vi.fn()
  render(<SelfHeatingCards plant={{ id: 'hp', method: 'self' } as HeatingPlant} view={{ period: '2025-01', label: '2025', distribution: null } as HeatingPeriodView} self={self} onChanged={onChanged} />)
  expect(screen.getByText(/C, Mieterwechsel zum 30\.09\.2025: keine Ablesung/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(calls).toEqual([['/api/units/c/interim-gaps/2025-09-30', 'PUT']])
})
