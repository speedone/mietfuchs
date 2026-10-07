// @vitest-environment jsdom
// Die Karte „Werte des Ablesedienstes“ (Heizung PR 12): Die Wohnung einer Zeile zeigt den gespeicherten
// Wert (CLAUDE.md), Speichern schickt die ganze Liste.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ServiceValuesCard from './ServiceValuesCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingServiceValue } from '../types'

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const UNITS = [{ id: 'a', name: 'Wohnung A' }, { id: 'b', name: 'Wohnung B' }]
const values: HeatingServiceValue[] = [{ plantId: 'hp', period: periodKey('2025-01'), unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800.25, waterValue: null, heatUnit: 'units' }]

test('Die Wohnung einer Zeile zeigt den gespeicherten Wert, der Wert alle Stellen; Speichern schickt die ganze Liste', async () => {
  render(<ServiceValuesCard plantId="hp" period={periodKey('2025-01')} from="2025-01-01" to="2025-12-31" closed={false} units={UNITS} values={values} onSaved={() => {}} />)
  const [unit] = screen.getAllByLabelText(/^Wohnung/) as HTMLSelectElement[]
  expect(unit?.value).toBe('b')
  expect((screen.getByLabelText(/Einheit der Heizung/) as HTMLSelectElement).value).toBe('units')
  expect(screen.getByText(/bis zum 31\.12\.2026.*3 % kürzen/)).toBeTruthy()
  expect((screen.getByLabelText(/Heizung \(bewertet\)/) as HTMLInputElement).value).toBe('800,25')
  fireEvent.click(screen.getByRole('button', { name: 'Werte speichern' }))
  await waitFor(() => expect(sent.length).toBe(1), { timeout: 5000 })
  expect(sent[0]).toEqual({
    url: '/api/heating-plants/hp/periods/2025-01/service-values', method: 'PUT',
    body: { values: [{ unitId: 'b', from: '2025-01-01', to: '2025-12-31', heatValue: 800.25, waterValue: null, heatUnit: 'units' }] },
  })
})

test('Ohne Werte: je angeschlossene Wohnung eine Zeile über die Heizperiode; abgeschlossen nur lesbar', () => {
  render(<ServiceValuesCard plantId="hp" period={periodKey('2025-01')} from="2025-01-01" to="2025-12-31" closed={false} units={UNITS} values={[]} onSaved={() => {}} />)
  expect((screen.getAllByLabelText(/^Wohnung/) as HTMLSelectElement[]).map((s) => s.value)).toEqual(['a', 'b'])
  cleanup()
  render(<ServiceValuesCard plantId="hp" period={periodKey('2025-01')} from="2025-01-01" to="2025-12-31" closed units={UNITS} values={values} onSaved={() => {}} />)
  expect(screen.queryByRole('button', { name: 'Werte speichern' })).toBeNull()
})
