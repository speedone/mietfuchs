// @vitest-environment jsdom
// Seitenwechsel mit ungespeicherter Eingabe (#346, Schritt 7a): Seitenleiste, Menüblatt und untere Leiste
// fragen wie der Wechsel von Objekt und Zeitraum nach, wenn ein Formular offen ist. Vorher ging eine
// angefangene Eingabe beim Seitenwechsel still verloren. Dazu fragt der Browser beim Schließen des Tabs.
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Tenancy, Unit } from './types'
import App from './App'
import { MOBILE_QUERY } from './components/MobileNav'
import { PropertyProvider, useHasOpenForm } from './property'
import { UIProvider } from './components/feedback'
import HeatingInfoCard from './components/HeatingInfoCard'
import { noInfoView } from './testing/heatingView'
import { calendarYearPeriod, periodKey, settlementPeriod } from '../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from './types'

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
const UNITS: Unit[] = [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }]
const TENANCIES: Tenancy[] = [{ id: 't-a', unitId: 'u-a', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const ledger = { year: 2025, rows: [{ tenancyId: 't-a', tenantName: 'Müller', unitName: 'DG', months: [], sollYearCents: 0, paidYearCents: 0, balanceCents: 0 }], totals: { sollCents: 0, paidCents: 0, openCents: 0 } }

let mobile = false
let posted: string[] = []
beforeEach(() => {
  mobile = false
  posted = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') posted.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(UNITS)
    if (path === '/api/tenancies') return json(TENANCIES)
    if (path.startsWith('/api/rentledger/')) return json(ledger)
    // Das Cockpit bekommt keine Antwort; hier zählt nur die Navigation.
    if (path.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode: 'npm' })
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const bar = () => screen.getByRole('navigation', { name: 'Schnellzugriff' })
const sheet = () => document.querySelector('dialog.menu-sheet') as HTMLDialogElement
const question = () => screen.queryByText('Ungespeicherte Änderungen verwerfen?')

// Ein angefangenes Formular: eine Zahlung im Mietkonto mit eingetipptem Betrag
async function startPayment(go: (name: RegExp) => void) {
  render(<App />)
  go(/Mietkonto/)
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/ }, { timeout: 5000 })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '11,11' } })
}

test('Seitenleiste: mit offenem Formular fragt der Seitenwechsel; Abbrechen behält die Eingabe, Verwerfen wechselt', async () => {
  await startPayment(async (name) => fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name })))
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Cockpit/ }))
  const dialog = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  expect(dialog.textContent).toMatch(/Beim Wechsel zu „Cockpit“ geht sie verloren/)
  // Verwerfen ist gefährlich: Der Startfokus liegt auf „Abbrechen“.
  expect(document.activeElement?.textContent).toBe('Abbrechen')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(question()).toBeNull())
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
  expect(within(sidebar()).getByRole('button', { name: /Mietkonto/ }).getAttribute('aria-current')).toBe('page')

  fireEvent.click(within(sidebar()).getByRole('button', { name: /Cockpit/ }))
  fireEvent.click(within((await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(within(sidebar()).getByRole('button', { name: /Cockpit/ }).getAttribute('aria-current')).toBe('page'))
  expect(screen.queryByLabelText(/^Betrag/)).toBeNull()
  expect(posted).toEqual([])
})

test('Seitenleiste: ohne offenes Formular wechselt die Seite ohne Rückfrage', async () => {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Mietkonto/ }))
  await waitFor(() => expect(within(sidebar()).getByRole('button', { name: /Mietkonto/ }).getAttribute('aria-current')).toBe('page'))
  expect(question()).toBeNull()
})

test('untere Leiste: mit offenem Formular fragt der Wechsel; Abbrechen behält die Eingabe', async () => {
  mobile = true
  await startPayment(async (name) => {
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Schnellzugriff' })).getByRole('button', { name: 'Mehr' }))
    await waitFor(() => expect(sheet().open).toBe(true))
    fireEvent.click(within(sheet()).getByRole('button', { name }))
  })
  fireEvent.click(within(bar()).getByRole('button', { name: /Cockpit/ }))
  const dialog = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(question()).toBeNull())
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
  fireEvent.click(within(bar()).getByRole('button', { name: /Cockpit/ }))
  fireEvent.click(within((await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(within(bar()).getByRole('button', { name: /Cockpit/ }).getAttribute('aria-current')).toBe('page'))
})

test('Menüblatt: die Rückfrage liegt über dem Blatt; Abbrechen lässt es offen, Verwerfen wechselt und schließt es', async () => {
  mobile = true
  await startPayment(async (name) => {
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Schnellzugriff' })).getByRole('button', { name: 'Mehr' }))
    await waitFor(() => expect(sheet().open).toBe(true))
    fireEvent.click(within(sheet()).getByRole('button', { name }))
  })
  fireEvent.click(within(bar()).getByRole('button', { name: 'Mehr' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  const entry = within(sheet()).getByRole('button', { name: /Stammdaten/ })
  entry.focus()
  fireEvent.click(entry)
  // Die Rückfrage ist selbst ein modaler Dialog im Top-Layer (#346, Schritt 1); das Blatt bleibt darunter offen
  const dialog = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  expect(sheet().open).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(question()).toBeNull())
  expect(sheet().open).toBe(true)
  expect(document.activeElement).toBe(entry)
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
  fireEvent.click(entry)
  fireEvent.click(within((await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(within(bar()).getByRole('button', { name: /Stammdaten/ }).getAttribute('aria-current')).toBe('page'))
  await waitFor(() => expect(sheet().open).toBe(false))
})

test('Tab schließen oder neu laden: mit offenem Formular fragt der Browser, sonst nicht', async () => {
  render(<App />)
  await screen.findByRole('navigation', { name: 'Hauptnavigation' })
  const leave = () => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }
  expect(leave()).toBe(false)
  cleanup()
  await startPayment(async (name) => fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name })))
  expect(leave()).toBe(true)
})

// Eingaben in einer Karte der Seite (ohne Seitenfenster) melden sich ebenso an, etwa die Angaben nach § 6a.
function Offen() {
  const hasOpenForm = useHasOpenForm()
  const [seen, setSeen] = useState<boolean | null>(null)
  return <button type="button" onClick={() => setSeen(hasOpenForm())}>offen? {String(seen)}</button>
}

test('Karte „Angaben zur Abrechnung (§ 6a)“: eine ungespeicherte Eingabe zählt als offenes Formular', async () => {
  const PLANT = { id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self' } as HeatingPlant
  const view: HeatingPeriodView = {
    plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
    hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
    hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, items: [], stock: null,
    ...noInfoView(),
  }
  render(<PropertyProvider><UIProvider><HeatingInfoCard plant={PLANT} view={view} onChanged={() => {}} /><Offen /></UIProvider></PropertyProvider>)
  const frage = () => {
    fireEvent.click(screen.getByRole('button', { name: /^offen\?/ }))
    return screen.getByRole('button', { name: /^offen\?/ }).textContent
  }
  const feld = await screen.findByLabelText(/Klimafaktor dieser Heizperiode/)
  expect(frage()).toBe('offen? false')
  fireEvent.change(feld, { target: { value: '1,1' } })
  expect(frage()).toBe('offen? true')
  fireEvent.change(feld, { target: { value: '' } })
  expect(frage()).toBe('offen? false')
})

// Nachprüfung B4: Auch ein Sprung aus einer Seite („Hier beheben →“) fragt, hier mit einem ungespeicherten
// Druck-Häkchen auf der Abrechnung.
test('„Hier beheben →“ mit ungespeicherter Änderung fragt; Abbrechen bleibt auf der Seite', async () => {
  const year = new Date().getFullYear() - 1
  const settlement = {
    year, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(year)), deadline: `${year + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0,
    totalCostsCents: 0, warnings: ['EG: zugleich.'], closed: null,
    notices: [{ code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'EG: zugleich.', subject: { kind: 'tenancy', id: 't-a' } }],
  }
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? ''
    if (path === `/api/settlement/${year}`) return new Response(JSON.stringify(settlement), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === `/api/settlement/${year}/history`) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    return inner(url, init)
  })
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Abrechnung/ }))
  fireEvent.click(await screen.findByLabelText(/Belegkopien als Anlage/, {}, { timeout: 5000 }))
  fireEvent.click((await screen.findAllByRole('button', { name: /^Hier beheben/ }, { timeout: 5000 }))[0] ?? (() => { throw new Error('kein Knopf') })())
  const dialog = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(question()).toBeNull())
  expect(within(sidebar()).getByRole('button', { name: /Abrechnung/ }).getAttribute('aria-current')).toBe('page')
  expect((screen.getByLabelText(/Belegkopien als Anlage/) as HTMLInputElement).checked).toBe(true)
})
