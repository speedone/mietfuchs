// @vitest-environment jsdom
// Leere Felder der Ablesung (#149): Sie wurden als 0 gespeichert. Beim Zählerwechsel entfiel so die
// Warnung „Endstand fehlt“ (#83), und ein falsches Segment verschob Geld zwischen Mietern.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  fireEvent.change(screen.getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
}

test('Zählerwechsel ohne Endstand: gespeichert wird null, nicht 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByLabelText(/Zählerwechsel/))
  fireEvent.change(screen.getByLabelText(/Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ meterId: 'm1', value: 5, replacement: true, oldEndValue: null })
})

test('leerer Zählerstand: Meldung statt einer gespeicherten 0', async () => {
  await openReadings()
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(screen.getByText('Bitte den Zählerstand eintragen.')).toBeTruthy())
  expect(sent).toEqual([])
})

// UI-Durchsicht H3: Die Meldung stand oben auf der Seite, beim Klick 407 px über dem sichtbaren
// Bereich; es wirkte, als passiere nichts. Jetzt steht sie am Feld und in der Sammelmeldung im Fuß des
// Seitenfensters über „Anlegen“ (#346, Schritt 3 und 7), als Alarm und ins Bild gerollt; der Fokus geht auf die
// Sammelmeldung, ihr Link aufs Feld.
test('Ablesung ohne Datum: Meldung am Feld und in der Sammelmeldung über „Anlegen“, die den Fokus bekommt', async () => {
  const scrolled: unknown[] = []
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { scrolled.push([this.textContent, arg]) }
  try {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
    fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
    fireEvent.change(screen.getByLabelText(/Zählerstand/), { target: { value: '5' } })
    const button = screen.getByRole('button', { name: /^Anlegen$/ })
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Bitte prüfen Sie 1 Angabe/)
    expect(alert.textContent).toMatch(/Datum der Ablesung/)
    const summary = alert.parentElement
    expect(summary?.closest('.drawer-foot')).toBe(button.closest('.drawer-foot'))
    expect(scrolled).toEqual([[summary?.textContent, { block: 'nearest' }]])
    expect(document.activeElement).toBe(summary)
    expect(sent).toEqual([])
    // Am Feld: die kurze Fassung, ungültig markiert und über aria-describedby verbunden.
    const date = screen.getByLabelText(/^Datum/)
    expect(date.getAttribute('aria-invalid')).toBe('true')
    const described = (date.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['⚠ Fehler: Datum fehlt'])
    expect(screen.getByLabelText(/Zählerstand/).getAttribute('aria-invalid')).toBeNull()
    // Der Link der Sammelmeldung führt aufs Feld.
    fireEvent.click(within(alert).getByRole('link', { name: /Datum der Ablesung/ }))
    expect(document.activeElement).toBe(date)
    // Mit Datum ist die Meldung an beiden Stellen weg.
    fireEvent.change(date, { target: { value: '2025-06-30' } })
    expect(date.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
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
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Wärme EG' } })
  fireEvent.change(screen.getByLabelText(/^Sparte/), { target: { value: 'waerme' } })
  expect((screen.getByLabelText(/^Einheit/) as HTMLInputElement).value).toBe('kWh')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ type: 'waerme', unit: 'kWh' })
})

test('Zählerformular: der Hinweis zum Hauptzähler verweist auf die Einliegerwohnung (#142)', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
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
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
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
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
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
    // Seit Schritt 10 über den Baustein Notice: Warnung (gelb) mit Wort, kein Fehlerkasten
    const box = (await screen.findByText(notice.text)).closest('.notice-item')
    expect(box?.className).toMatch(/^notice /)
    expect(box?.textContent).toContain('Warnung')
  } finally {
    METERS = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
  }
})

// ---------- #346 Schritt 7: die Ablesung im Seitenfenster, mit derselben Anfrage ----------
// Die Rümpfe sind die, die die Ablesezeile vor dem Seitenfenster schickte.
let calls: { url: string; method: string; body: unknown }[] = []
const stubWithUrls = () => {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ id: 'r1' })
    }
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(METERS)
    if (path === '/api/readings') return json(readings)
    return json([])
  })
}
/** Klappt die Ablesungen des Zählers auf und öffnet das Formular einer neuen Ablesung. */
const openReadingForm = async (): Promise<HTMLElement> => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }, { timeout: 5000 }))
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  return screen.getByRole('dialog', { name: /Neue Ablesung/ })
}
const saveReadingIn = (box: HTMLElement) => fireEvent.click(within(box).getByRole('button', { name: 'Anlegen' }))

test('Ablesung anlegen: POST /api/readings mit dem Rumpf wie bisher, danach ist das Formular zu', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '1.234,5' } })
  fireEvent.change(within(box).getByLabelText(/^Hinweis/), { target: { value: ' Zwischenablesung Auszug ' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-06-30', value: 1234.5, note: 'Zwischenablesung Auszug' } })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('Ablesung mit Zählerwechsel: Endstand alt und Startstand neu wie bisher', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.click(within(box).getByLabelText(/Zählerwechsel/))
  fireEvent.change(within(box).getByLabelText(/^Startstand neuer Zähler/), { target: { value: '5' } })
  fireEvent.change(within(box).getByLabelText(/^Endstand alter Zähler/), { target: { value: '980' } })
  saveReadingIn(box)
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toEqual({ url: '/api/readings', method: 'POST', body: { meterId: 'm1', date: '2025-06-30', value: 5, replacement: true, oldEndValue: 980 } })
})

// Durchsicht S1: Ein Doppelklick auf „Anlegen“ legte die Ablesung zweimal an (zwei gleiche Stände am selben Tag, #69).
test('Ablesung: Doppelklick und Strg+S legen genau eine an', async () => {
  stubWithUrls()
  const box = await openReadingForm()
  fireEvent.change(within(box).getByLabelText(/^Datum/), { target: { value: '2025-06-30' } })
  fireEvent.change(within(box).getByLabelText(/^Zählerstand/), { target: { value: '12' } })
  const knopf = within(box).getByRole('button', { name: 'Anlegen' })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  fireEvent.keyDown(box, { key: 's', ctrlKey: true })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})

test('Zähler: Doppelklick auf „Anlegen“ legt genau einen an', async () => {
  stubWithUrls()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, { timeout: 5000 }))
  const box = screen.getByRole('dialog')
  fireEvent.change(within(box).getByLabelText(/^Name/), { target: { value: 'Kaltwasser Haus' } })
  const knopf = within(box).getByRole('button', { name: /^Anlegen$/ })
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})

// Durchsicht K1: Im Fenster „Neue Ablesung“ steht der letzte Stand als Anhalt, denn die Liste dahinter ist verdeckt.
test('Ablesung: das Fenster nennt den letzten Stand des Zählers', async () => {
  readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 1234.5 },
    { id: 'r0', meterId: 'm1', date: '2023-12-31', value: 1000 },
  ] as Reading[]
  stubWithUrls()
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(2\)/ }, { timeout: 5000 }))
  fireEvent.click(screen.getByRole('button', { name: '+ Ablesung anlegen' }))
  const box = screen.getByRole('dialog', { name: /Neue Ablesung/ })
  expect(within(box).getByText('Letzter Stand: 1.234,5 m³ am 31.12.2024')).toBeTruthy()
})
