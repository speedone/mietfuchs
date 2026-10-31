// @vitest-environment jsdom
// Die Karte „Messdienstabrechnung auslesen“ (Heizung PR 20): Der Beleg geht mit Objekt und Jahr an die Route
// der Anlage (Prüfung S4), und die Antwort erscheint als Prüfansicht, ohne dass etwas gespeichert wird.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ServiceImportCard from './ServiceImportCard'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, ServiceExtractResult, Tenancy, Unit } from '../types'
import { noInfoView } from '../testing/heatingView'
import { UIProvider } from './feedback'

const view = (closed = false): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null, items: [],
})
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const UNITS: Unit[] = [{ id: 'a', propertyId: 'objekt-1', name: 'EG links', areaM2: 60, participates: true }]
const result: ServiceExtractResult = {
  file: 'beleg.pdf',
  extraction: {
    vendor: 'Wärmedienst Beispiel GmbH', unitsCount: 1, usersTotalEur: 1180.25, deductionEur: null, fuelGrossEur: null, fuelNetEur: null, co2: null, dhwMethod: null,
    blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 1180.25, lines: [{ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, amountEur: 1180.25, vacancy: false }] }],
  },
}

let posted: { url: string; fields: Record<string, string> }[]
beforeEach(() => {
  posted = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      const fields: Record<string, string> = {}
      init.body.forEach((v, k) => { if (typeof v === 'string' && k !== 'requestId') fields[k] = v })
      posted.push({ url, fields })
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ai: { pageImageEdge: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Der Beleg geht mit Objekt und Jahr an die Anlage; die Prüfansicht zeigt die Zuordnung', async () => {
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} />)
  const input = screen.getByLabelText('Messdienstabrechnung wählen')
  fireEvent.change(input, { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  const zuordnung = await screen.findByLabelText('Zuordnung „Mustermann, Erika“')
  if (!(zuordnung instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(zuordnung.value).toBe('tenancy:t1')
  expect(posted).toEqual([{ url: '/api/heating-plants/hp/service-statement', fields: { propertyId: 'objekt-1', year: '2025' } }])
})

test('Durchsicht S4: steht Kaltwasser mit Einzelbeträgen schon im Abrechnungszeitraum, ist der Block nicht vorgehakt', async () => {
  result.extraction.blocks.push({ title: 'Kaltwasser', category: 'Wasser/Abwasser', totalEur: 100, lines: [{ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, amountEur: 100, vacancy: false }] })
  try {
    render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS}
      items={[{ period: periodKey('2025-01'), key: 'amounts', category: 'Wasser/Abwasser' }, { period: periodKey('2024-01'), key: 'amounts', category: 'Müllabfuhr' }]} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Messdienstabrechnung wählen'), { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
    const kalt = await screen.findByLabelText('Kaltwasser')
    const heiz = screen.getByLabelText('Heizung und Warmwasser')
    if (!(kalt instanceof HTMLInputElement) || !(heiz instanceof HTMLInputElement)) throw new Error('kein Haken')
    expect([heiz.checked, kalt.checked]).toEqual([true, false])
  } finally {
    result.extraction.blocks.pop()
  }
})

test('In einer abgeschlossenen Heizperiode gibt es nichts auszulesen', () => {
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view(true)} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Messdienstabrechnung wählen')).toBeNull()
})

// #346, Schritt 7a: Der Vorschlag der KI zählt als offenes Formular, bis er geschlossen wird; neu holen kostet
// einen weiteren Lauf.
test('7a: der Vorschlag meldet die Karte an, „Schließen“ nimmt die Marke weg', async () => {
  render(<OpenFormScope><ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} /></OpenFormScope>)
  expect(hasOpenForm()).toBe(false)
  fireEvent.change(screen.getByLabelText('Messdienstabrechnung wählen'), { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  await screen.findByLabelText('Zuordnung „Mustermann, Erika“')
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
  expect(hasOpenForm()).toBe(false)
})

// Praxistest, Durchsicht: Nennt die Abrechnung keine Nutzeinheiten, zählt die Karte die Wohnungen an der Heizung
// (`servesUnit`), nicht alle des Objekts; eine Garage ohne Wärmeanschluss zählt nicht mit.
test('ohne Nutzeinheiten in der Abrechnung gehen nur die Wohnungen an der Heizung in die CO₂-Angaben', async () => {
  const sent: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      const extraction = { ...result.extraction, unitsCount: null, deductionEur: 50 }
      return new Response(JSON.stringify({ ...result, extraction }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (init?.method && init.method !== 'GET') sent.push({ url, body: JSON.parse(String(init.body ?? 'null')) })
    return new Response(JSON.stringify({ ai: { pageImageEdge: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const units: Unit[] = [...UNITS, { id: 'g', propertyId: 'objekt-1', name: 'Garage', areaM2: 15, participates: true, noConnection: ['waerme'] }]
  render(<UIProvider><ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={units} onSaved={() => {}} /></UIProvider>)
  fireEvent.change(screen.getByLabelText('Messdienstabrechnung wählen'), { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  const frage = await screen.findByLabelText('Steht in der Kostenaufstellung eine Abzugszeile?')
  fireEvent.change(frage, { target: { value: 'deducted' } })
  fireEvent.click(screen.getByText('CO₂-Angaben übernehmen'))
  // Ohne angelegte Positionen geht die Probe nicht auf; die Rückfrage wird bejaht.
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem speichern' }))
  await waitFor(() => expect(sent.find((x) => x.url.endsWith('/co2'))?.body).toMatchObject({ serviceUnitsCount: 1 }))
})

// Fehler mit Ausweg (#487): Die Karte hat kein Formular zum Ausfüllen von Hand; „Von Hand erfassen“ führt deshalb in den
// Ordner der Seite Belege zum Beleg, und „Erneut versuchen“ nennt nur seinen Namen.
test('Fehler mit Ausweg: Beleg gespeichert, „Erneut versuchen“ ohne neue Datei, „Von Hand erfassen“ auf die Seite Belege', async () => {
  const sent: FormData[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      sent.push(init.body)
      return new Response(JSON.stringify({ error: 'Die Belege gingen an api.example.com …', file: 'srv-abrechnung.jpg', reason: 'consent', kept: true, service: 'api.example.com' }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ai: { pageImageEdge: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const onOpenReceipt = vi.fn()
  const onOpenAiSettings = vi.fn()
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}}
    onOpenReceipt={onOpenReceipt} onOpenAiSettings={onOpenAiSettings} />)
  fireEvent.change(screen.getByLabelText('Messdienstabrechnung wählen'), { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  expect(await screen.findByText('Gespeichert, nicht ausgewertet')).toBeTruthy()
  expect(screen.getByText(/Die Übermittlung an api\.example\.com ist noch nicht bestätigt\./)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Von Hand erfassen' }))
  expect(onOpenReceipt).toHaveBeenCalledWith('srv-abrechnung.jpg')
  fireEvent.click(screen.getByRole('button', { name: 'KI-Einstellungen öffnen' }))
  expect(onOpenAiSettings).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect([sent[1]?.get('file'), sent[1]?.get('existingFile'), sent[1]?.get('propertyId')]).toEqual([null, 'srv-abrechnung.jpg', 'objekt-1'])
})

// Durchsicht #487: Ein abgebrochener neuer Versuch stellt den Ausweg mit dem alten Grund wieder her.
test('Fehler mit Ausweg: „Abbrechen“ beim neuen Versuch kehrt zu „Gespeichert, nicht ausgewertet“ zurück', async () => {
  let call = 0
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      call += 1
      if (call === 1) return Promise.resolve(new Response(JSON.stringify({ error: 'nicht erreichbar', file: 'srv-abrechnung.jpg', reason: 'unreachable', kept: true, provider: 'ollama' }), { status: 502, headers: { 'content-type': 'application/json' } }))
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError'))))
    }
    return Promise.resolve(new Response(JSON.stringify({ ai: { pageImageEdge: null } }), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1', units: null }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} />)
  fireEvent.change(screen.getByLabelText('Messdienstabrechnung wählen'), { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Erneut versuchen' }))
  const cancel = await screen.findByRole('button', { name: 'Abbrechen' })
  // Der Fokus steht auf „Abbrechen“, nicht auf body
  await waitFor(() => expect(document.activeElement).toBe(cancel))
  fireEvent.click(cancel)
  expect(await screen.findByText('Gespeichert, nicht ausgewertet')).toBeTruthy()
  expect(screen.getByText(/Die KI ist gerade nicht erreichbar\. Ist der Rechner mit der KI eingeschaltet, oder läuft Ollama\?/)).toBeTruthy()
})
