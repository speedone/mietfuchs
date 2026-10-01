// @vitest-environment jsdom
// Leere Felder der Ablesung (#149): Sie wurden als 0 gespeichert. Beim Zählerwechsel entfiel so die
// Warnung „Endstand fehlt“ (#83), und ein falsches Segment verschob Geld zwischen Mietern.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Reading, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Zaehler from './Zaehler'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]

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
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openReadings() {
  render(
    <YearProvider>
      <PropertyProvider>
        <Zaehler units={UNITS} />
      </PropertyProvider>
    </YearProvider>,
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

const renderPage = () => render(
  <YearProvider>
    <PropertyProvider>
      <Zaehler units={UNITS} />
    </PropertyProvider>
  </YearProvider>,
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
