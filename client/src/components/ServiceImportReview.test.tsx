// @vitest-environment jsdom
// Die Prüfansicht einer ausgelesenen Messdienstabrechnung (Heizung PR 20). Geprüft wird, was die Logiktests
// nicht sehen: Jede Auswahl zeigt den Wert, mit dem gespeichert wird (CLAUDE.md, Kosten.test.tsx), und
// die Knöpfe schicken genau die Rümpfe aus serviceImport.ts über die bestehenden Routen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ServiceImportReview from './ServiceImportReview'
import type { ImportContext } from '../serviceImport'
import type { HeatingPeriodView, ServiceStatementExtraction } from '../types'
import { periodKey } from '../../../shared/period.ts'
import { noInfoView } from '../testing/heatingView'

const ctx: ImportContext = {
  propertyId: 'objekt-1', plantId: 'hp',
  heating: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' }, object: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' },
  tenancies: [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null }],
  units: [{ id: 'a', name: 'EG links', selfUsed: false }, { id: 'b', name: 'EG rechts', selfUsed: false }],
  existingAmountItems: 0,
}
const mai: ImportContext = { ...ctx, heating: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' }, object: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' } }
const x: ServiceStatementExtraction = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-01-01', periodEnd: '2025-12-31', unitsCount: 2, usersTotalEur: 1882.35, deductionEur: 87.5,
  fuelGrossEur: null, fuelNetEur: null,
  co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 }, dhwMethod: 'volumeFormula',
  blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 1882.35, lines: [
    { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 1180.25, vacancy: false },
    { label: 'Herr Unbekannt', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: false },
  ] }],
}
// Vollständig gebaut wie in Co2Card.test.tsx (Prüfung S6).
const view = (items: HeatingPeriodView['items'] = []): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null, items,
})

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ id: 'neu' }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const select = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

test('Jede Auswahl zeigt den Wert, mit dem gespeichert wird; eine offene Zeile verhindert Übernehmen', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view()} onDone={() => {}} />)
  expect(select('Zuordnung „Mustermann, Erika“').value).toBe('tenancy:t1')
  expect(select('Zuordnung „Herr Unbekannt“').value).toBe('')
  expect(select('Kostenart „Heizung und Warmwasser“').value).toBe('Heizung und Warmwasser')
  expect(select('Steht in der Kostenaufstellung eine Abzugszeile?').value).toBe('')
  expect(screen.getByText(/Abzüglich CO₂-Kosten Vermieter“ mit 87,50/)).toBeTruthy()
  expect(screen.getByText(/Eine Formel ist nur zulässig/)).toBeTruthy()
  fireEvent.click(screen.getByText('Positionen anlegen'))
  expect(await screen.findByText(/Bitte ordnen Sie „Herr Unbekannt“/)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'POST')).toEqual([])
})

test('Nach der Zuordnung legt Übernehmen die Position an: Betrag S + Abzugszeile, Leerstand offen', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view()} onDone={() => {}} />)
  fireEvent.change(select('Zuordnung „Herr Unbekannt“'), { target: { value: 'vacancy' } })
  expect(select('Zuordnung „Herr Unbekannt“').value).toBe('vacancy')
  expect(screen.queryByLabelText('Jahr der Zahlung „Heizung und Warmwasser“ (für die Steuer)')).toBeNull()
  fireEvent.click(screen.getByText('Positionen anlegen'))
  await waitFor(() => expect(sent.find((s) => s.method === 'POST')).toEqual({
    url: '/api/costItems', method: 'POST',
    body: {
      propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Heizung und Warmwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 196985, key: 'amounts', tenancyAmounts: { t1: 118025 }, selfAmounts: {}, invoiceFile: 'beleg.pdf', heatingPlantId: 'hp',
    },
  }))
})

test('Ein zweiter Klick auf „Positionen anlegen“ legt nichts doppelt an', async () => {
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view()} onDone={() => {}} />)
  fireEvent.change(select('Zuordnung „Herr Unbekannt“'), { target: { value: 'vacancy' } })
  fireEvent.click(screen.getByText('Positionen anlegen'))
  fireEvent.click(screen.getByText('Positionen anlegen'))
  await waitFor(() => expect(sent.filter((s) => s.method === 'POST').length).toBe(1))
  fireEvent.click(screen.getByText('Positionen anlegen'))
  expect(await screen.findByText(/kein Block zum Anlegen gewählt/)).toBeTruthy()
  expect(sent.filter((s) => s.method === 'POST').length).toBe(1)
})

test('Heizperiode über zwei Kalenderjahre: Feld „Jahr der Zahlung“ je Block, sein Wert geht in den Rumpf (Prüfung M2)', async () => {
  const zwei = { ...x, periodStart: '2025-05-01', periodEnd: '2026-04-30' }
  render(<ServiceImportReview x={zwei} file="beleg.pdf" ctx={mai} view={{ ...view(), period: periodKey('2025-05'), from: '2025-05-01', to: '2026-04-30' }} onDone={() => {}} />)
  fireEvent.change(select('Zuordnung „Herr Unbekannt“'), { target: { value: 'vacancy' } })
  fireEvent.click(screen.getByText('Positionen anlegen'))
  expect(await screen.findByText(/Bitte geben Sie das Jahr der Zahlung an/)).toBeTruthy()
  const jahr = screen.getByLabelText('Jahr der Zahlung „Heizung und Warmwasser“ (für die Steuer)')
  if (!(jahr instanceof HTMLInputElement)) throw new Error('kein Eingabefeld')
  fireEvent.change(jahr, { target: { value: '2026' } })
  fireEvent.click(screen.getByText('Positionen anlegen'))
  await waitFor(() => expect(sent.find((s) => s.method === 'POST')?.body).toMatchObject({ period: '2025-05', taxYear: 2026 }))
})

test('CO₂-Angaben übernehmen schickt Antwort, Ausstoß, Fläche und die angelegte Heizposition; Warmwasser die Ermittlung', async () => {
  // Die Probe geht auf: Position S + L mit dem Einzelbetrag des Mieters.
  const items = [{ id: 'hz', description: 'Messdienst', amountCents: 196985, key: 'amounts' as const, tenancyAmounts: { t1: 118025 } }]
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={{ ...ctx, existingAmountItems: 1 }} view={view(items)} onDone={() => {}} />)
  fireEvent.change(select('Steht in der Kostenaufstellung eine Abzugszeile?'), { target: { value: 'shown' } })
  expect(screen.getByText(/Die Auswertung hat eine Abzugszeile gefunden/)).toBeTruthy()
  fireEvent.change(select('Steht in der Kostenaufstellung eine Abzugszeile?'), { target: { value: 'deducted' } })
  expect(select('Steht in der Kostenaufstellung eine Abzugszeile?').value).toBe('deducted')
  expect(screen.queryByText(/Die Auswertung hat eine Abzugszeile gefunden/)).toBeNull()
  fireEvent.click(screen.getByText('CO₂-Angaben übernehmen'))
  await waitFor(() => expect(sent.find((s) => s.url.endsWith('/co2'))?.body).toMatchObject({
    method: 'serviceDeducted', serviceUsersTotalCents: 188235, serviceUnitsCount: 2, serviceLandlordCents: 8750, serviceEmissionsKg: 4456.4, serviceAreaM2: 194.6, serviceLandlordPermille: 300,
  }))
  fireEvent.click(screen.getByText('Ermittlung übernehmen'))
  await waitFor(() => expect(sent.find((s) => s.url.endsWith('/hot-water'))).toEqual({ url: '/api/heating-plants/hp/periods/2025-01/hot-water', method: 'PUT', body: { dhwMethod: 'volumeFormula' } }))
})

test('Geht die Probe nicht auf, speichert „CO₂-Angaben übernehmen“ nur nach Rückfrage', async () => {
  // Ohne Heizposition in der Heizperiode geht die Probe nicht auf; ohne Bestätigung bleibt alles, wie es war.
  render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view()} onDone={() => {}} />)
  fireEvent.change(select('Steht in der Kostenaufstellung eine Abzugszeile?'), { target: { value: 'deducted' } })
  fireEvent.click(screen.getByText('CO₂-Angaben übernehmen'))
  await new Promise((r) => setTimeout(r, 20))
  expect(sent.filter((s) => s.url.endsWith('/co2'))).toEqual([])
})

test('Nach „Positionen anlegen“ verknüpft „CO₂-Angaben übernehmen“ die angelegte Heizposition (Prüfung S5)', async () => {
  const { rerender } = render(<ServiceImportReview x={x} file="beleg.pdf" ctx={ctx} view={view()} onDone={() => {}} />)
  fireEvent.change(select('Zuordnung „Herr Unbekannt“'), { target: { value: 'vacancy' } })
  fireEvent.click(screen.getByText('Positionen anlegen'))
  await waitFor(() => expect(sent.some((s) => s.method === 'POST')).toBe(true))
  // Die Seite lädt neu; danach steht die Position in der Heizperiode.
  rerender(<ServiceImportReview x={x} file="beleg.pdf" ctx={{ ...ctx, existingAmountItems: 1 }} view={view([{ id: 'neu', description: 'Heizung', amountCents: 196985, key: 'amounts', tenancyAmounts: { t1: 118025 } }])} onDone={() => {}} />)
  fireEvent.change(select('Steht in der Kostenaufstellung eine Abzugszeile?'), { target: { value: 'deducted' } })
  fireEvent.click(screen.getByText('CO₂-Angaben übernehmen'))
  await waitFor(() => expect(sent.find((s) => s.url.endsWith('/co2'))?.body).toMatchObject({ serviceCostItemId: 'neu' }))
})
