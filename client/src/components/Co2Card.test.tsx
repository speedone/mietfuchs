// @vitest-environment jsdom
// Die Karte „CO₂-Kosten“ (Heizung PR 6). Geprüft wird die Eigenschaft, die die Logiktests nicht sehen:
// Die Auswahl zeigt den gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), eine neue Heizperiode zeigt
// keine Antwort, und Speichern schickt die gewählte Methode.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2Card from './Co2Card'
import { CO2_QUESTION } from '../co2Form'
import { periodKey } from '../../../shared/period.ts'
import type { Co2Statement, HeatingPeriodView, Tenancy } from '../types'

const view = (co2: Co2Statement | null): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2,
  items: [{ id: 'hz', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { t1: 100000 } }],
})
const shown: Co2Statement = {
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceShown', areaM2: null, serviceEmissionsKg: null,
  serviceAreaM2: null, serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: 500,
  serviceUsersTotalCents: 100500, serviceUsersTotalApprox: false, serviceUnitsCount: 1, serviceCostItemId: null, serviceSelfLandlordCents: null,
  serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
}
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'u1', tenantName: 'Mieter Eins', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]

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

// Die Frage steht als Beschriftung über der Auswahl; zum Finden trägt die Auswahl den kurzen Namen.
const frage = (): HTMLSelectElement => {
  const el = screen.getByLabelText('Abzugszeile')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Die Auswahl zeigt die gespeicherte Antwort; eine neue Heizperiode zeigt „Bitte wählen …“', () => {
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.getByText(CO2_QUESTION, { exact: false })).toBeTruthy()
  expect(frage().value).toBe('shown')
  expect(frage().selectedOptions[0]?.textContent).toBe('Nein, die CO₂-Kosten sind nur ausgewiesen')
  cleanup()
  render(<Co2Card view={view(null)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(frage().value).toBe('')
  expect(frage().selectedOptions[0]?.textContent).toBe('Bitte wählen …')
})

test('Speichern schickt die Methode und die Beträge an die Heizperiode', async () => {
  const saved = vi.fn()
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={saved} />)
  expect(screen.getByText(/^Probe:/).textContent).toMatch(/✓$/)
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/co2')
  expect(sent[0]?.body).toMatchObject({ method: 'serviceShown', serviceUsersTotalCents: 100500, serviceLandlordCents: 500, serviceUnitsCount: 1 })
})
