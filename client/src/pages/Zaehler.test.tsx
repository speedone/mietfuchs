// @vitest-environment jsdom
// Leere Felder der Ablesung (#149): Sie wurden als 0 gespeichert. Beim Zählerwechsel entfiel so die
// Warnung „Endstand fehlt“ (#83), und ein falsches Segment verschob Geld zwischen Mietern.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Reading, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Zaehler from './Zaehler'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
let METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
let plants: unknown[] = []

let sent: Record<string, unknown>[]
let readings: Reading[] = []

beforeEach(() => {
  sent = []
  readings = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push(JSON.parse(String(init?.body ?? '{}')))
      return json({ id: 'r1' })
    }
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path === '/api/readings') return json(readings)
    if (path === '/api/heating-plants') return json(plants)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openReadings() {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
}

test('Zählerwechsel ohne Endstand: gespeichert wird null, nicht 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByLabelText(/Zählerwechsel/))
  fireEvent.change(screen.getByLabelText(/Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: /Ablesung speichern/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ meterId: 'm1', value: 5, replacement: true, oldEndValue: null })
})

test('leerer Zählerstand: Meldung statt einer gespeicherten 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByRole('button', { name: /Ablesung speichern/ }))
  await waitFor(() => expect(screen.getByText('Bitte den Zählerstand eintragen.')).toBeTruthy())
  expect(sent).toEqual([])
})

// UI-Durchsicht H3: Die Meldung stand oben auf der Seite, beim Klick 407 px über dem sichtbaren
// Bereich; es wirkte, als passiere nichts. Jetzt steht sie beim Knopf, als Alarm und ins Bild gerollt.
test('Ablesung ohne Datum: die Meldung steht beim Knopf, mit role="alert", und rollt ins Bild', async () => {
  const scrolled: unknown[] = []
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push([this.textContent, arg]) }
  try {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
    fireEvent.change(screen.getByLabelText(/Zählerstand/), { target: { value: '5' } })
    const button = screen.getByRole('button', { name: /Ablesung speichern/ })
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Datum/)
    expect(alert.closest('.reading-panel')).toBe(button.closest('.reading-panel'))
    expect(scrolled).toEqual([[alert.textContent, { block: 'nearest' }]])
    expect(sent).toEqual([])
  } finally {
    Element.prototype.scrollIntoView = original
  }
})

const renderPage = () => render(
  <PeriodProvider>
    <PropertyProvider>
      <Zaehler units={UNITS} />
    </PropertyProvider>
  </PeriodProvider>,
)

test('Zählerwechsel ohne Endstand: die Tabelle sagt „fehlt“ statt eines leeren Werts (#142)', async () => {
  readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 950 },
    { id: 'r2', meterId: 'm1', date: '2025-07-01', value: 3, replacement: true },
  ]
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(2\)/ }, { timeout: 5000 }))
  expect(screen.getByText('Endstand alt: fehlt')).toBeTruthy()
})

test('Neuer Wärmezähler: die Einheit folgt der Sparte und wird so gespeichert (#142)', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler hinzufügen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Wärme EG' } })
  fireEvent.change(screen.getByLabelText(/^Sparte/), { target: { value: 'waerme' } })
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).value).toBe('kWh')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ type: 'waerme', unit: 'kWh' })
})

test('Zählerformular: der Hinweis zum Hauptzähler verweist auf die Einliegerwohnung (#142)', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler hinzufügen/ }, { timeout: 5000 }))
  expect(screen.getByRole('button', { name: 'Einliegerwohnung' })).toBeTruthy()
})

// Durchsicht M1: Das Auswahlfeld zeigt die gespeicherte Rolle, auch wenn die Sparte sie nicht mehr
// anbietet; vorher stand dort „Nein“, und gespeichert wurde beim nächsten Mal etwas anderes.
test('ein Zähler der Anlage zeigt seine gespeicherte Rolle', async () => {
  METERS = [{ id: 'ww', propertyId: 'objekt-1', name: 'WW Speicher', unitId: null, type: 'warmwasser', unit: 'm³', heatingPlantId: 'p1', heatingRole: 'supply' }]
  plants = [{ id: 'p1', propertyId: 'objekt-1', name: '', energy: 'gas', method: 'service', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null }]
  try {
    render(<PeriodProvider><PropertyProvider><Zaehler units={UNITS} /></PropertyProvider></PeriodProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Zähler bearbeiten' }, { timeout: 5000 }))
    const select = (await screen.findByRole('combobox', { name: /Gehört zur Heizanlage/ })) as HTMLSelectElement
    expect(select.value).toBe('supply')
    expect(select.selectedOptions[0]?.textContent).toMatch(/^bisher: Versorgungszähler/)
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
    plants = []
  }
})

// Heizung PR 21 (#98): Eichjahr mit Vorschlag aus der Jahreszahl auf dem Zähler; beim Heizkostenverteiler kein Feld.
test('Eichfrist: Vorschlag übernehmen und speichern; beim Heizkostenverteiler kein Feld', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler hinzufügen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Kaltwasser Haus' } })
  fireEvent.change(screen.getByLabelText(/^Jahreszahl auf dem Zähler/), { target: { value: '2022' } })
  expect(screen.getByText(/Vorschlag: geeicht bis Ende 2028/)).toBeTruthy()
  expect(screen.getByText(/Jahreszahl auf der Eichmarke nennt das Jahr, in dem die Eichfrist beginnt/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
  expect((screen.getByLabelText(/^Geeicht bis Ende/) as HTMLInputElement).value).toBe('2028')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ type: 'kaltwasser', calibratedUntil: 2028 })
  cleanup()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler hinzufügen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Sparte/), { target: { value: 'hkv' } })
  expect(screen.queryByLabelText(/^Geeicht bis Ende/)).toBeNull()
  expect(screen.queryByLabelText(/^Jahreszahl auf dem Zähler/)).toBeNull()
})

test('Eichfrist: das Jahr steht in der Liste, die abgelaufene Frist als Warnung und nicht als Fehler', async () => {
  METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³', calibratedUntil: 2024 }]
  const notice = { code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist abgelaufen', text: 'Zähler „Wasser EG“: abgelaufen', subject: { kind: 'meter', id: 'm1' } }
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path.startsWith('/api/consumption')) return json([{ meterId: 'm1', consumption: 80, readingCount: 2, warnings: [notice.text], notices: [notice] }])
    return json([])
  })
  try {
    renderPage()
    expect(await screen.findByText('geeicht bis Ende 2024', undefined, { timeout: 5000 })).toBeTruthy()
    expect((await screen.findByText(notice.text)).className).toBe('warn')
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
  }
})
