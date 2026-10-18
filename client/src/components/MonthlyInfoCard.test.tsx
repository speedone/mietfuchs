// @vitest-environment jsdom
// Die Karte „Monatliche Verbrauchsinformation“ (Heizung PR 22): lädt die Monate, speichert Vergleichswert und
// Mitteilung je Monat und druckt das Blatt nur mit den Zahlen des einen Mieters.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MonthlyInfoCard from './MonthlyInfoCard'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import MonthlyInfoSheet from './MonthlyInfoSheet'
import { UIProvider } from './feedback'
import type { MonthlyInfoMonth, MonthlyInfoUser, MonthlyInfoView } from '../types'
import { periodKey } from '../../../shared/period.ts'

const erika: MonthlyInfoUser = { tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30', remote: true, heatKwh: 700, dhwM3: null, dhwKwh: null, previousMonth: null, previousYear: null, referenceKwh: null, gaps: ['reference'] }
const nov: MonthlyInfoMonth = { month: '2025-11', due: true, complete: false, sent: false, mixed: false, row: null, users: [erika] }
const view = (over: Partial<MonthlyInfoView> = {}): MonthlyInfoView => ({
  plantId: 'hp', period: periodKey('2025-01'), managed: true, elsewhere: false, periodReference: null, dhwTemp: { tempC: null, here: false }, months: [nov], ...over,
})

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let served: MonthlyInfoView
beforeEach(() => {
  sent = []
  served = view()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    const data = (init?.method ?? 'GET') === 'GET' ? served : { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const wrap = (ui: React.ReactElement) => render(<UIProvider>{ui}</UIProvider>)

test('Monat mit Status; Speichern schickt Vergleichswert, Quelle und Tag an die Anlage', async () => {
  wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  expect(await screen.findByText('November 2025')).toBeTruthy()
  expect(sent[0]?.url).toBe('/api/heating-plants/hp/periods/2025-01/monthly-info')
  expect(screen.getByText(/unvollständig: Vergleich mit einem Durchschnittsnutzer fehlt/)).toBeTruthy()
  // Ein Entwurf je Zeile (#346 Schritt 7): „Speichern“ erst bei einer Änderung, und nur an dieser Zeile.
  expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('Vergleichswert November 2025 (kWh je m²)'), { target: { value: '10' } })
  expect(screen.getAllByRole('button', { name: /^Speichern/ }).map((b) => b.textContent)).toEqual(['Speichern (November 2025)'])
  fireEvent.change(screen.getByLabelText('Quelle November 2025'), { target: { value: 'Ablesedienst' } })
  fireEvent.change(screen.getByLabelText('Mitgeteilt am November 2025'), { target: { value: '2025-12-05' } })
  fireEvent.click(screen.getByText('Speichern', { selector: 'button' }))
  await waitFor(() => expect(sent.find((x) => x.method === 'PUT')).toEqual({
    url: '/api/heating-plants/hp/monthly-info/2025-11', method: 'PUT', body: { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' },
  }))
})

test('Ein Vergleichswert ohne Quelle wird nicht geschickt, sondern erklärt', async () => {
  wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  fireEvent.change(await screen.findByLabelText('Vergleichswert November 2025 (kWh je m²)'), { target: { value: '10' } })
  fireEvent.click(screen.getByText('Speichern', { selector: 'button' }))
  expect(await screen.findByText(/Bitte nennen Sie die Quelle des Vergleichswerts/)).toBeTruthy()
  expect(sent.some((x) => x.method === 'PUT')).toBe(false)
})

test('Ohne eigene Information (nicht erstellt oder anders mitgeteilt) keine Karte', async () => {
  served = view({ managed: false, months: [] })
  const { container } = wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  await waitFor(() => expect(sent.length).toBe(1))
  expect(container.textContent).toBe('')
  cleanup()
  served = view({ elsewhere: true })
  const second = wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  await waitFor(() => expect(sent.length).toBe(2))
  expect(second.container.textContent).toBe('')
})

test('Prüfung S13: der Vergleichswert der Heizperiode steht als Hinweis da', async () => {
  served = view({ periodReference: { kwhPerM2: 150, source: 'Ablesedienst 2025' } })
  wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  expect(await screen.findByText(/für die ganze Heizperiode 150 kWh je m² eingetragen/)).toBeTruthy()
  expect((screen.getByLabelText('Vergleichswert November 2025 (kWh je m²)') as HTMLInputElement).value).toBe('')
})

test('Das Blatt eines Mieters nennt keinen anderen Nutzer', () => {
  const zwei: MonthlyInfoMonth = { ...nov, users: [erika, { ...erika, tenancyId: 't2', tenantName: 'Max Beispiel', unitName: 'OG', heatKwh: 300 }] }
  const { container } = render(<MonthlyInfoSheet month={zwei} propertyName="Lindenweg 12" />)
  const pages = [...container.querySelectorAll('.monthly-info-page')]
  expect(pages.length).toBe(2)
  expect(pages[0]?.textContent).toMatch(/Erika Mustermann/)
  expect(pages[0]?.textContent).not.toMatch(/Max Beispiel|OG|300 kWh/)
  expect(pages[1]?.textContent).not.toMatch(/Erika Mustermann|700 kWh/)
})

test('Getrenntes Warmwasser: die Temperatur für die Umrechnung wird hier eingetragen und an die Heizperiode geschickt', async () => {
  served = view({ dhwTemp: { tempC: null, here: true } })
  wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  fireEvent.change(await screen.findByLabelText('Mittlere Warmwassertemperatur (°C)'), { target: { value: '55,5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Warmwassertemperatur)' }))
  await waitFor(() => expect(sent.find((x) => x.method === 'PUT')).toEqual({
    url: '/api/heating-plants/hp/periods/2025-01/dhw-temperature', method: 'PUT', body: { dhwTempC: 55.5 },
  }))
})

test('Verbundenes Warmwasser: kein Feld hier, sondern der Verweis auf die Karte „Warmwasser“', async () => {
  served = view({ months: [{ ...nov, users: [{ ...erika, dhwM3: 2, gaps: ['dhwTemp'] }] }] })
  wrap(<MonthlyInfoCard plantId="hp" period="2025-01" />)
  expect(await screen.findByText(/in der Karte „Warmwasser“ dieser Heizperiode ein/)).toBeTruthy()
  expect(screen.queryByLabelText('Mittlere Warmwassertemperatur (°C)')).toBeNull()
})

// #346, Schritt 7a: verglichen mit dem geladenen Stand; nach dem Speichern lädt die Karte neu.
test('7a: Ändern meldet die Karte an, Zurückstellen und Speichern nehmen die Marke weg', async () => {
  render(<OpenFormScope><UIProvider><MonthlyInfoCard plantId="hp" period="2025-01" /></UIProvider></OpenFormScope>)
  expect(await screen.findByText('November 2025')).toBeTruthy()
  expect(hasOpenForm()).toBe(false)
  const wert = screen.getByLabelText('Vergleichswert November 2025 (kWh je m²)')
  fireEvent.change(wert, { target: { value: '10' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.change(wert, { target: { value: '' } })
  expect(hasOpenForm()).toBe(false)
  fireEvent.change(screen.getByLabelText('Mitgeteilt am November 2025'), { target: { value: '2025-12-05' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(screen.getByText('Speichern', { selector: 'button' }))
  await waitFor(() => expect(sent.some((x) => x.method === 'PUT')).toBe(true))
  await waitFor(() => expect(hasOpenForm()).toBe(false))
})
