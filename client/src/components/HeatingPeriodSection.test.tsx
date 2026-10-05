// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingPeriodSection from './HeatingPeriodSection'
import { CALENDAR_RULES } from '../../../shared/period.ts'
import type { HeatingPlant } from '../types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, ...over,
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
    expect((screen.getByRole('combobox', { name: 'Heizperiode beginnt im' }) as HTMLSelectElement).value).toBe('5')
    expect((screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }) as HTMLSelectElement).value).toBe('no')
  })

  test('Vorschau, dann Übernehmen mit den Antworten', async () => {
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/period/preview')) {
        return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [],
          token: 'w1', moves: [{ costItemId: 'c1', description: 'Messdienst 2025/2026', amountCents: 100000, from: '2025-05', fromLabel: '2025/2026', to: '2026-01', toLabel: '2026',
            fromRange: '01.05.2025–30.04.2026', toRange: '01.01.–31.12.2026', options: [{ key: '2026-01', label: '2026', range: '01.01.–31.12.2026' }], check: false }] })
      }
      return json(plant({ periodStartMonth: null }))
    }))
    const changed = vi.fn(async () => {})
    render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={changed} notify={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    await screen.findByRole('combobox', { name: /Heizperiode für „Messdienst 2025\/2026“ \(1\.000,00.€, bisher 01\.05\.2025–30\.04\.2026\)/ })
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/heating-plants/hp1/period/preview', { rules: null }],
      ['PUT', '/api/heating-plants/hp1/period', { rules: null, answers: { groups: {}, moves: { c1: '2026-01' }, overrides: {}, totals: {}, token: 'w1', understood: false } }],
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

describe('Laienprobe B11, B3a', () => {
  const separatePreview = {
    separate: true, way: 'separate', month: '2025-05', earliestMonth: null, until: null, earliestUntil: null, share: { permille: 861, source: 'Abrechnung 2024' },
    steps: [{ tenancyId: 't1', tenantName: 'Familie Beispiel', rows: [{ from: '2025-05', totalCents: 25000, heatingCents: 21500 }] }],
    overrides: [], deadlines: [], keep: [], merge: [], blocked: [], token: 's1',
    effects: [{ label: '01.01.–30.06.2025', deadline: '2026-06-30', passed: true, replaces: [], tenants: [{ tenantName: 'Familie Beispiel', beforeCents: 17846, afterCents: -25154 }], lostClaimsCents: 25154 }],
  }
  test('„Ja, getrennt“: nach dem Zeitraum öffnet sich gleich die Aufteilung; mit abgelaufener Frist erst nach der Bestätigung übernehmbar', async () => {
    const calls: string[] = []
    const puts: unknown[] = []
    let conflict = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/separate') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)))
        if (conflict) return json({ error: 'veraltet', preview: { ...separatePreview, token: 's2' } }, 409)
      }
      if (url.endsWith('/period/preview')) return json({ rules: { startMonth: 5, changes: [] }, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], effects: [], token: 'w1', moves: [] })
      if (url.endsWith('/separate/preview')) return json(separatePreview)
      return json(plant())
    }))
    const notes: string[] = []
    render(<HeatingPeriodSection plant={plant({ periodStartMonth: null })} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={(t) => notes.push(t)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'own' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Rechnen Sie die Heizkosten getrennt ab, mit eigener Heizkostenvorauszahlung?' }), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }))
    await screen.findByText(/Familie Beispiel: vorher Guthaben 178,46 €, nachher Nachzahlung 251,54 €/)
    expect(calls).toContain('POST /api/heating-plants/hp1/separate/preview')
    expect(notes.at(-1)).toMatch(/Noch nicht eingeschaltet ist die getrennte Heizkostenabrechnung/)
    const uebernehmen = screen.getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement
    expect(uebernehmen.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Ich habe verstanden/ }))
    expect(uebernehmen.disabled).toBe(false)
    // Review Runde 1: Die Bestätigung geht an den Server; nach einer 409 gilt sie nicht mehr.
    conflict = true
    fireEvent.click(uebernehmen)
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ answers: { understood: true } }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement).disabled).toBe(true))
  })
})

test('Review Runde 2: Wechsel der Heizperiode mit abgelaufener Frist erst nach Bestätigung, und sie geht mit', async () => {
  const puts: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/period/preview')) {
      return json({ rules: null, periods: [], newShort: [], blocked: [], groups: [], overrides: [], endsSeparate: [], moves: [], token: 'w1',
        effects: [{ label: '2024', deadline: '2025-12-31', passed: true, replaces: [], tenants: [{ tenantName: 'Müller', beforeCents: 260000, afterCents: 360000 }], lostClaimsCents: 0 }] })
    }
    if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)))
    return json(plant({ periodStartMonth: null }))
  }))
  render(<HeatingPeriodSection plant={plant()} objectRules={CALENDAR_RULES} hasCalendarData onChanged={async () => {}} notify={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Zeitraum der Heizung ändern' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Für welchen Zeitraum rechnet die Heizung ab?' }), { target: { value: 'object' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau' }))
  await screen.findByText(/Müller: vorher Guthaben 2\.600,00.€, nachher Guthaben 3\.600,00.€/)
  // Review Runde 3 (N4): auch hier der früheste Wechsel mit offener Frist.
  expect(screen.getByText(/wechseln Sie frühestens ab/)).toBeTruthy()
  const uebernehmen = screen.getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement
  expect(uebernehmen.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Ich habe verstanden/ }))
  fireEvent.click(uebernehmen)
  await waitFor(() => expect(puts.at(-1)).toMatchObject({ answers: { understood: true } }))
})
