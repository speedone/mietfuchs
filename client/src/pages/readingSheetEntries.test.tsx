// @vitest-environment jsdom
// Die beiden Einstiege des Ableseformulars (#320): die Seite Zähler (Knopf, Fenster mit Auswahl, Blatt) und der
// Mieterwechsel (Knopf mit der Wohnung, Entwurf bleibt, Fehler am Fenster).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Meter, Reading, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'
import Zaehler from './Zaehler'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const METERS: Meter[] = [
  { id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' },
  { id: 'm2', propertyId: 'objekt-1', name: 'Verteiler Küche', unitId: 'u1', type: 'hkv', unit: '' },
  { id: 'm3', propertyId: 'objekt-1', name: 'Hauswasser', unitId: null, type: 'kaltwasser', unit: 'm³' },
]
const READINGS: Reading[] = [{ id: 'r1', meterId: 'm1', date: '2025-12-31', value: 321 }]

let meters: Meter[]
let readingsStatus: number
let print: ReturnType<typeof vi.fn>

beforeEach(() => {
  meters = METERS
  readingsStatus = 200
  print = vi.fn()
  vi.stubGlobal('print', print)
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(meters)
    if (path === '/api/readings') return readingsStatus === 200 ? json(READINGS) : json({ error: 'Ablesungen nicht lesbar.' }, readingsStatus)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.className = ''
})

const sheetRows = () => [...document.querySelectorAll('.reading-sheet-print tbody tr')].map((r) => r.textContent ?? '')

async function openZaehler() {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Ableseformular drucken' }, SLOW))
  return screen.findByRole('dialog', { name: 'Ableseformular drucken' }, SLOW)
}

test('Zähler: Knopf, Fenster mit Auswahl, dann das Blatt mit dem letzten Stand und Druckauftrag', async () => {
  const box = await openZaehler()
  // Nur Wohnungen mit eigenen Zählern stehen zur Wahl
  expect(within(box).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alle Zähler des Objekts', 'Nur EG'])
  fireEvent.click(within(box).getByLabelText('Heizkostenverteiler aufführen'))
  fireEvent.click(within(box).getByRole('button', { name: 'Drucken' }))
  await waitFor(() => expect(sheetRows()).toHaveLength(2))
  expect(sheetRows().join('|')).toContain('Hauswasser')
  expect(sheetRows().join('|')).toContain('321')
  expect(sheetRows().join('|')).not.toContain('Verteiler Küche')
  expect(document.body.classList.contains('print-reading-sheet')).toBe(true)
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
  window.dispatchEvent(new Event('afterprint'))
  await waitFor(() => expect(document.querySelector('.reading-sheet-print')).toBeNull())
})

test('Zähler: ohne Zähler ist „Drucken“ gesperrt und nennt den Grund', async () => {
  meters = []
  const box = await openZaehler()
  const button = within(box).getByRole('button', { name: 'Drucken' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '')
  expect(reason?.textContent).toContain('keinen Zähler')
})

function renderChange(unitsOf: Unit[] = UNITS, tenancies: Tenancy[] = TENANCIES) {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={unitsOf} tenancies={tenancies} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
}
async function openChange() {
  fireEvent.click(await screen.findByRole('button', { name: /^Mieterwechsel$/i }, SLOW))
  return screen.findByRole('dialog', { name: /^Mieterwechsel: Müller/ }, SLOW)
}

test('Mieterwechsel: Blatt nur mit den Zählern der Wohnung, der Entwurf bleibt stehen', async () => {
  renderChange()
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  const button = await within(box).findByRole('button', { name: 'Ableseformular drucken' }, SLOW)
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), SLOW)
  fireEvent.click(button)
  await waitFor(() => expect(sheetRows()).toHaveLength(2), SLOW)
  expect(sheetRows().join('|')).not.toContain('Hauswasser')
  expect(document.querySelector('.reading-sheet-print')?.textContent).toContain('EG · Zwischenablesung')
  expect((within(box).getByLabelText(/Auszugsdatum/i) as HTMLInputElement).value).toBe('2025-06-30')
})

test('Mieterwechsel: ein Fehler beim Laden der Stände steht am Fenster, kein Blatt', async () => {
  readingsStatus = 500
  renderChange()
  const box = await openChange()
  const button = await within(box).findByRole('button', { name: 'Ableseformular drucken' }, SLOW)
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), SLOW)
  fireEvent.click(button)
  await waitFor(() => expect(within(box).getAllByText(/Ablesungen nicht lesbar/).length).toBeGreaterThan(0), SLOW)
  expect(document.querySelector('.reading-sheet-print')).toBeNull()
})

test('Mieterwechsel: eine Wohnung ohne Zähler sperrt den Knopf und nennt den Grund', async () => {
  meters = [METERS[2]!]
  renderChange()
  const box = await openChange()
  const button = (await within(box).findByRole('button', { name: 'Ableseformular drucken' }, SLOW)) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toContain('kein Zähler')
})
