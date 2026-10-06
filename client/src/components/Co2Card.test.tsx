// @vitest-environment jsdom
// Die Karte „CO₂-Kosten“ (Heizung PR 6). Geprüft wird die Eigenschaft, die die Logiktests nicht sehen:
// Die Auswahl zeigt den gespeicherten Wert (CLAUDE.md, Kosten.test.tsx), eine neue Heizperiode zeigt
// keine Antwort, und Speichern schickt die gewählte Methode.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2Card from './Co2Card'
import { UIProvider } from './feedback'
import { CO2_QUESTION } from '../co2Form'
import { periodKey } from '../../../shared/period.ts'
import type { Co2Statement, HeatingPeriodView, Tenancy } from '../types'

const view = (co2: Co2Statement | null): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null }, co2, stock: null,
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

test('Felder mit Fundort statt Formelzeichen (Durchsicht M3, I3)', () => {
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.queryByText(/\(S\)/)).toBeNull()
  expect(screen.getByText(/Summe der Nutzerkosten Heizungsanlage/)).toBeTruthy()
  expect(screen.getByLabelText(/CO₂-Ausstoß insgesamt laut Abrechnung \(kg\)/)).toBeTruthy()
  expect(screen.getByLabelText(/Wohnfläche laut Abrechnung \(m²\)/)).toBeTruthy()
})

// Laienprobe B20, B21, B22.
test('B20: Geht die Probe nicht auf, fragt Speichern nach, statt still zu speichern', async () => {
  render(<UIProvider><Co2Card view={view({ ...shown, serviceUsersTotalCents: 90000 })} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} /></UIProvider>)
  expect(screen.getByText(/^Probe:/).textContent).toMatch(/✗/)
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  expect(await screen.findByText('Die Probe geht nicht auf')).toBeTruthy()
  expect(sent).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Trotzdem speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1))
})

test('B21: Ohne Ausstoß insgesamt und Fläche sagt die Karte, dass sie für den Ausweis nötig sind', () => {
  render(<Co2Card view={view(shown)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.getByText(/Für den Ausweis in der Abrechnung mindestens nötig: der CO₂-Ausstoß insgesamt \(kg\) und die Wohnfläche/)).toBeTruthy()
  cleanup()
  render(<Co2Card view={view({ ...shown, serviceEmissionsKg: 3000, serviceAreaM2: 100 })} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.queryByText(/Für den Ausweis in der Abrechnung mindestens nötig/)).toBeNull()
})

test('B22: Das Feld für die eigene Wohnung gibt es nur mit selbst bewohnter Wohnung', () => {
  const deducted = { ...shown, method: 'serviceDeducted' as const }
  render(<Co2Card view={view(deducted)} tenancies={TENANCIES} unitsCount={1} onSaved={() => {}} />)
  expect(screen.queryByLabelText(/davon für Ihre selbst bewohnte Wohnung/)).toBeNull()
  cleanup()
  render(<Co2Card view={view(deducted)} tenancies={TENANCIES} unitsCount={1} hasSelfUsed onSaved={() => {}} />)
  expect(screen.getByLabelText(/davon für Ihre selbst bewohnte Wohnung/)).toBeTruthy()
})
