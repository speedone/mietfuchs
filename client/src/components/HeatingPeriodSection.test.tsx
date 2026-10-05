// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingPeriodSection from './HeatingPeriodSection'
import { CALENDAR_RULES } from '../../../shared/period.ts'
import type { HeatingPlant } from '../types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, ...over,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Abschnitt „Zeitraum der Heizung“', () => {
  test('Jedes Auswahlfeld zeigt den gespeicherten Wert', () => {
    render(<HeatingPeriodSection plant={plant({ separateSettlement: false })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    expect((screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }) as HTMLSelectElement).value).toBe('own')
    expect((screen.getByRole('combobox', { name: 'Ab Monat' }) as HTMLSelectElement).value).toBe('5')
    expect((screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }) as HTMLSelectElement).value).toBe('no')
  })

  test('Vorschau, dann Übernehmen mit den Antworten', async () => {
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/period/preview')) {
        return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [],
          token: 'w1', moves: [{ costItemId: 'c1', description: 'Messdienst 2025/2026', amountCents: 100000, from: '2025-05', fromLabel: '2025/2026', to: '2026-01', toLabel: '2026' }] })
      }
      return json(plant({ periodStartMonth: null }))
    }))
    const changed = vi.fn(async () => {})
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={changed} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    await screen.findByText(/Messdienst 2025\/2026: von 2025\/2026 nach 2026/)
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/heating-plants/hp1/period/preview', { rules: null }],
      ['PUT', '/api/heating-plants/hp1/period', { rules: null, answers: { groups: {}, overrides: {}, totals: {}, token: 'w1' } }],
    ])
  })

  test('Weicht die Heizung ab, stehen die drei Wege da, Weg 1 als Vorgabe', () => {
    render(<HeatingPeriodSection plant={plant({ periodStartMonth: null })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    expect(screen.queryByText('Kalenderjahr, Heizung in der Heizperiode des Messdienstes')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'own' } })
    expect(screen.getByText('Kalenderjahr, Heizung in der Heizperiode des Messdienstes')).toBeTruthy()
    expect(screen.getByText('Alles auf den Zeitraum des Messdienstes umstellen')).toBeTruthy()
    expect(screen.getByText('Den Messdienst auf den 31.12. umstellen lassen')).toBeTruthy()
    expect(screen.getAllByText('Vorgabe')).toHaveLength(1)
  })
})
