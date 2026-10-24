// @vitest-environment jsdom
// Der Mieterwechsel auf der Seite (#150), seit #346 Schritt 7 im Seitenfenster: Er speichert in genau einer Anfrage
// mit demselben Rumpf wie der Assistent davor, eine Ablehnung des Servers bleibt im Fenster stehen, und scheitert nach
// dem Speichern nur das Neuladen der Ansicht, sagt die Seite das, statt den Wechsel noch einmal anzubieten.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
let meters: Meter[] = METERS

beforeEach(() => {
  sent = []
  changeStatus = 400
  plants = []
  meters = METERS
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
      '/api/meters': meters,
      '/api/heating-plants': plants,
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Der Rumpf des Wechsels, wie ihn der Assistent vor #346 Schritt 7 schickte; das Seitenfenster schickt denselben.
const BODY_SCHMIDT = {
  end: '2025-06-30',
  readings: [{ meterId: 'm1', value: 1234 }],
  newTenancy: {
    tenantName: 'Schmidt', persons: 2, personHistory: [{ from: '2025-07-01', persons: 2 }], start: '2025-07-01',
    baseRents: [], prepayments: [{ from: '2025-07', monthlyCents: 15000 }], prepaymentOverrides: {},
  },
}

const runWizard = async (reload: () => Promise<void>) => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={reload} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  fireEvent.change(await within(box).findByLabelText(/Wasser EG/i, {}, SLOW), { target: { value: '1.234' } })
  fireEvent.change(within(box).getByLabelText(/^Mieter$/i), { target: { value: 'Schmidt' } })
  fireEvent.change(within(box).getByLabelText(/Vorauszahlung/i), { target: { value: '150' } })
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
}

/** Öffnet das Seitenfenster des Mieterwechsels. */
async function openChange(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^Mieterwechsel$/i }, SLOW))
  return screen.findByRole('dialog', { name: /^Mieterwechsel: Müller/ }, SLOW)
}

test('Mieterwechsel: eine einzige Anfrage, und die Ablehnung bleibt im Assistenten stehen', async () => {
  await runWizard(async () => {})
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.method).toBe('POST')
  expect(sent[0]?.url).toBe('/api/tenancies/t1/change?property=objekt-1')
  expect(sent[0]?.body).toEqual(BODY_SCHMIDT)
  const box = screen.getByRole('dialog', { name: /^Mieterwechsel: Müller/ })
  await waitFor(() => expect(within(box).getByText(MSG)).toBeTruthy(), SLOW)
  // busy ist zurückgesetzt: Der Knopf lässt sich nach dem Beheben wieder drücken.
  const knopf = within(box).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(false)
  expect(sent).toHaveLength(1)
})

test('Mieterwechsel: gespeichert, aber die Ansicht lädt nicht neu — Hinweis statt Verlust, kein zweiter Wechsel', async () => {
  changeStatus = 200
  await runWizard(async () => { throw new Error('Netzwerk weg') })
  await waitFor(() => expect(screen.getByText(/Der Mieterwechsel ist gespeichert; die Ansicht ließ sich nicht neu laden/)).toBeTruthy(), SLOW)
  // Das Fenster ist zu; ein zweites Speichern gibt es nicht.
  expect(screen.queryByRole('dialog')).toBeNull()
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
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  fireEvent.change(await within(box).findByLabelText(/Wasser EG/i, {}, SLOW), { target: { value: '1.234' } })
  fireEvent.change(within(box).getByLabelText(/^Mieter$/i), { target: { value: 'Schmidt' } })
  fireEvent.change(within(box).getByLabelText(/Übrige Vorauszahlung/i), { target: { value: '177' } })
  fireEvent.change(within(box).getByLabelText(/^Heizvorauszahlung/i), { target: { value: '123' } })
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  // #346 Schritt 7: derselbe Rumpf wie vor dem Seitenfenster, Feld für Feld.
  expect(sent[0]?.body).toEqual({ ...BODY_SCHMIDT, newTenancy: { ...BODY_SCHMIDT.newTenancy, prepayments: [{ from: '2025-07', monthlyCents: 17700 }], heatingPrepayments: [{ from: '2025-07', monthlyCents: 12300 }] } })
})

// Sichtprüfung E18: Der Assistent öffnete am Seitenende; ohne Sprung dorthin sah man nach dem Klick nichts passieren.
// Seit #346 Schritt 7 (N16) ist er ein Seitenfenster, das mit dem Fokus im Auszugsdatum öffnet.
test('E18, N16: der Mieterwechsel öffnet als Seitenfenster mit dem Fokus im Auszugsdatum', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  await waitFor(() => expect(document.activeElement).toBe(within(box).getByLabelText(/Auszugsdatum/i)))
  expect(document.querySelector('.wizard')).toBeNull()
})

test('Heizung PR 10: bei eigener Heizkostenabrechnung Ablesedatum je Wärmezähler und, ohne Stand, der Grund; angezeigt wie gespeichert', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self', separateSettlement: null,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
    nonResidential: false, restriction: 'none', districtEtsNew: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
    hotWater: 'combined', capture: 'heatMeter', areaBasisHeat: 'area', heatPumpInstalledOn: null,
  }]
  meters = [...METERS, { id: 'w1', propertyId: 'objekt-1', name: 'Wärme EG', unitId: 'u1', type: 'waerme', unit: 'kWh' }]
  changeStatus = 200
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  await within(box).findByLabelText(/Ablesedatum Wärme EG/i, {}, SLOW)
  expect(within(box).getByText(/VIII ZR 19\/07/)).toBeTruthy()
  const grund = within(box).getByLabelText(/Warum gibt es keine Zwischenablesung/i) as HTMLSelectElement
  expect(grund.value).toBe('')
  fireEvent.change(grund, { target: { value: 'impossible' } })
  expect((within(box).getByLabelText(/Warum gibt es keine Zwischenablesung/i) as HTMLSelectElement).value).toBe('impossible')
  // Durchsicht von #239, I3: die Folge der Wahl steht da, und ohne Grund wird nicht gespeichert.
  expect(within(box).getByText(/Nicht möglich: Die Kosten der Wohnung werden nach Gradtagen und Tagen/)).toBeTruthy()
  fireEvent.click(within(box).getByLabelText(/Leerstand/i))
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
  expect(await within(box).findByText(/Bitte nennen Sie den Grund für die Teilung nach § 9b Abs\. 3/, {}, SLOW)).toBeTruthy()
  expect(sent).toEqual([])
  fireEvent.change(within(box).getByLabelText(/Grund \(steht in der Abrechnung\)/i), { target: { value: 'nicht zugänglich' } })
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.body).toEqual({ end: '2025-06-30', readings: [], interimGap: { status: 'impossible', reason: 'nicht zugänglich' }, newTenancy: null })
})

// Browserprobe zu #346 Schritt 7: Erst „Speichern“ ohne Angaben, dann das Auszugsdatum: Der Einzug ist damit vorbelegt,
// und die Meldung „Einzug fehlt“ von vorher steht nicht mehr am Feld.
test('Mieterwechsel: das Auszugsdatum belegt den Einzug vor und nimmt dessen Meldung weg', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
  const einzug = within(box).getByLabelText(/^Einzug/) as HTMLInputElement
  await waitFor(() => expect(einzug.getAttribute('aria-invalid')).toBe('true'), SLOW)
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  expect(einzug.value).toBe('2025-07-01')
  expect(einzug.getAttribute('aria-invalid')).toBeNull()
  expect(sent).toEqual([])
})

// Durchsicht der Hinweiskästen: „Beim Speichern passiert: …“ ist eine neutrale Vorschau, kein „⚠ Warnung“.
test('Mieterwechsel: die Vorschau „Beim Speichern passiert“ ist ein Hinweis, keine Warnung', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  const preview = within(box).getByText(/Beim Speichern passiert/).closest('.notice-item')
  expect(preview?.classList.contains('hint')).toBe(true)
})

// #229: Das Fenster fragt nach neuer Anschrift, E-Mail und Telefon des ausziehenden Mieters, alles freiwillig. Bewusst
// geändert gegenüber BODY_SCHMIDT: Mit Angaben kommt `contact` dazu, ohne bleibt der Rumpf, wie er war (Test oben).
test('Mieterwechsel: neue Anschrift und E-Mail des bisherigen Mieters gehen in derselben Anfrage mit', async () => {
  changeStatus = 200
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/Auszugsdatum/i), { target: { value: '2025-06-30' } })
  fireEvent.change(await within(box).findByLabelText(/Wasser EG/i, {}, SLOW), { target: { value: '1.234' } })
  fireEvent.change(within(box).getByLabelText(/^Neue Anschrift/), { target: { value: 'Birkenweg 3, 54321 Anderswo' } })
  fireEvent.change(within(box).getByLabelText(/^E-Mail/), { target: { value: 'mueller@example.org' } })
  expect(within(box).getByLabelText(/^Telefon/)).toBeTruthy()
  fireEvent.change(within(box).getByLabelText(/^Mieter$/i), { target: { value: 'Schmidt' } })
  fireEvent.change(within(box).getByLabelText(/Vorauszahlung/i), { target: { value: '150' } })
  fireEvent.click(within(box).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent).toHaveLength(1), SLOW)
  expect(sent[0]?.body).toEqual({ ...BODY_SCHMIDT, contact: { correspondenceAddress: 'Birkenweg 3, 54321 Anderswo', email: 'mueller@example.org' } })
})

// Durchsicht S1: Passt die neue Anschrift nicht ins Fensterfeld, sagt es der Hinweis am Feld (gespeichert wird trotzdem).
test('Mieterwechsel: eine Anschrift mit mehr als sechs Zeilen bekommt einen Hinweis am Feld', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const box = await openChange()
  fireEvent.change(within(box).getByLabelText(/^Neue Anschrift/), { target: { value: 'c/o Weber, Hinterhaus, 3. OG, Birkenweg 3, Postfach 12, 54321 Anderswo' } })
  expect(within(box).getByText(/Die Anschrift hat 7 Zeilen; im Anschriftfeld passen 6/)).toBeTruthy()
})
