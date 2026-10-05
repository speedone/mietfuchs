// @vitest-environment jsdom
// Der Mieterwechsel-Assistent auf der Seite (#150): Er speichert in genau einer Anfrage, eine
// Ablehnung des Servers bleibt im Assistenten stehen, und scheitert nach dem Speichern nur das
// Neuladen der Ansicht, sagt er das, statt den Wechsel noch einmal anzubieten.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const MSG = 'Die Angaben verletzen eine Regel der Datenbank: Ein Betrag darf nicht negativ sein.'

// Die Seite rendert ganz; unter Last auf einem geteilten Rechner braucht das mehr als die
// voreingestellten fünf Sekunden je Test und die eine Sekunde je Suche.
vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

let sent: { url: string; method: string; body: unknown }[]
let changeStatus: number
let plants: unknown[] = []

beforeEach(() => {
  sent = []
  changeStatus = 400
  plants = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return changeStatus === 200 ? json({ ended: TENANCIES[0], newTenancy: null, readings: [] }) : json({ error: MSG }, changeStatus)
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/meters': METERS,
      '/api/heating-plants': plants,
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const runWizard = async (reload: () => Promise<void>) => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={reload} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Mieterwechsel$/i }, SLOW))
  fireEvent.change(screen.getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  fireEvent.click(screen.getByRole('button', { name: /^Weiter$/i }))
  fireEvent.change(await screen.findByLabelText(/Wasser EG/i, {}, SLOW), { target: { value: '1.234' } })
  fireEvent.click(screen.getByRole('button', { name: /^Weiter$/i }))
  fireEvent.change(await screen.findByLabelText(/^Mieter$/i, {}, SLOW), { target: { value: 'Schmidt' } })
  fireEvent.change(screen.getByLabelText(/Vorauszahlung/i), { target: { value: '150' } })
  fireEvent.click(screen.getByRole('button', { name: /Mieterwechsel durchführen/i }))
}

test('Mieterwechsel: eine einzige Anfrage, und die Ablehnung bleibt im Assistenten stehen', async () => {
  await runWizard(async () => {})
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.method).toBe('POST')
  expect(sent[0]?.url).toBe('/api/tenancies/t1/change?property=objekt-1')
  expect(sent[0]?.body).toMatchObject({ end: '2025-06-30', readings: [{ meterId: 'm1', value: 1234 }], newTenancy: { tenantName: 'Schmidt', start: '2025-07-01' } })
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy(), SLOW)
  // busy ist zurückgesetzt: Der Knopf lässt sich nach dem Beheben wieder drücken.
  const knopf = screen.getByRole('button', { name: /Mieterwechsel durchführen/i }) as HTMLButtonElement
  expect(knopf.disabled).toBe(false)
  expect(sent).toHaveLength(1)
})

test('Mieterwechsel: gespeichert, aber die Ansicht lädt nicht neu — Hinweis statt Verlust, kein zweiter Wechsel', async () => {
  changeStatus = 200
  await runWizard(async () => { throw new Error('Netzwerk weg') })
  await waitFor(() => expect(screen.getByText(/Der Mieterwechsel ist gespeichert; die Ansicht ließ sich nicht neu laden/)).toBeTruthy(), SLOW)
  expect(screen.queryByRole('button', { name: /Mieterwechsel durchführen/i })).toBeNull()
  expect(sent).toHaveLength(1)
})

test('Mieterwechsel unter getrennter Heizkostenabrechnung (Durchsicht von #231): die Heizvorauszahlung des Nachmieters geht mit', async () => {
  plants = [{
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: true,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], units: null, newDevicesInstall: null,
}]
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Mieterwechsel$/i }, SLOW))
  fireEvent.change(screen.getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  fireEvent.click(screen.getByRole('button', { name: /^Weiter$/i }))
  fireEvent.change(await screen.findByLabelText(/Wasser EG/i, {}, SLOW), { target: { value: '1.234' } })
  fireEvent.click(screen.getByRole('button', { name: /^Weiter$/i }))
  fireEvent.change(await screen.findByLabelText(/^Mieter$/i, {}, SLOW), { target: { value: 'Schmidt' } })
  fireEvent.change(screen.getByLabelText(/Übrige Vorauszahlung/i), { target: { value: '177' } })
  fireEvent.change(screen.getByLabelText(/^Heizvorauszahlung/i), { target: { value: '123' } })
  fireEvent.click(screen.getByRole('button', { name: /Mieterwechsel durchführen/i }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.body).toMatchObject({ newTenancy: { prepayments: [{ from: '2025-07', monthlyCents: 17700 }], heatingPrepayments: [{ from: '2025-07', monthlyCents: 12300 }] } })
})
