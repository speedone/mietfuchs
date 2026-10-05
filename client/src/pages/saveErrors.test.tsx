// @vitest-environment jsdom
// Fehler beim Speichern gehören in die Oberfläche (#146). Lehnt der Server ab, etwa mit 400
// wegen eines Verweises in ein anderes Objekt oder mit 503 bei gesperrter Datenbank, stand der
// Satz des Servers bisher nur in der Konsole: Der Dialog blieb offen, und nichts geschah.
// Jeder Test hier lässt den Server ablehnen und verlangt, dass seine Meldung zu sehen ist und
// der Dialog offen bleibt, damit die Eingaben nicht verloren sind.
import { calendarPeriod } from '../../../shared/period.ts'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Meter, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Kosten from './Kosten'
import Zaehler from './Zaehler'
import Mietkonto from './Mietkonto'
import Stammdaten from './Stammdaten'

const MSG = 'Die Kostenposition gehört zu Objekt A. Bitte wählen Sie eine Wohnung desselben Objekts.'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const LEDGER = {
  year: 2025,
  rows: [{ tenancyId: 't1', tenantName: 'Müller', unitName: 'EG', months: [], sollYearCents: 0, paidYearCents: 0, balanceCents: 0 }],
  totals: { sollCents: 0, paidCents: 0, openCents: 0 },
}

let sent: { url: string; method: string }[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method })
      return new Response(JSON.stringify({ error: MSG }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/meters': METERS,
      '/api/readings': [],
      '/api/tenancies': TENANCIES,
      '/api/payments': [],
    }
    const body = path.startsWith('/api/rentledger/') ? LEDGER : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = (page: ReactNode) =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>{page}</UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )

const expectShownInDialog = async () => {
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy())
  expect(screen.getByText(MSG).closest('[role="dialog"]')).not.toBeNull()
}

test('Kosten: die Ablehnung des Servers steht im Dialog', async () => {
  shell(<Kosten units={UNITS} settings={null} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await expectShownInDialog()
})

test('Zähler: die Ablehnung des Servers steht im Dialog', async () => {
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler hinzufügen/i }))
  fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Hauptwasser' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await expectShownInDialog()
})

test('Zähler: die Ablehnung einer Ablesung ist zu sehen', async () => {
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/i }))
  fireEvent.change(screen.getByLabelText(/^Datum/i), { target: { value: '2025-12-31' } })
  fireEvent.change(screen.getByLabelText(/^Zählerstand/i), { target: { value: '123' } })
  fireEvent.click(screen.getByRole('button', { name: /Ablesung speichern/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy())
})

test('Mietkonto: die Ablehnung einer Zahlung steht im Dialog', async () => {
  shell(<Mietkonto />)
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '11,11' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await expectShownInDialog()
})

test('Stammdaten: die Ablehnung einer Wohnung steht im Dialog', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung hinzufügen/i }))
  fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'DG' } })
  fireEvent.change(screen.getByLabelText(/^Wohnfläche/i), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await expectShownInDialog()
})

test('Stammdaten: die Ablehnung eines Mietverhältnisses steht im Dialog', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis hinzufügen/i }))
  fireEvent.change(screen.getByLabelText('Mieter'), { target: { value: 'Schmidt' } })
  fireEvent.change(screen.getByLabelText(/^Einzug/i), { target: { value: '2025-01-01' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  // Müller wohnt seit 2020 in derselben Wohnung (#204): erst die Rückfrage, dann geht es zum Server.
  fireEvent.click(await screen.findByRole('button', { name: /^Trotzdem speichern$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await expectShownInDialog()
})

test('Stammdaten: überschneidet sich das neue Mietverhältnis, fragt die Seite nach; „Abbrechen“ speichert nichts (#204)', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis hinzufügen/i }))
  fireEvent.change(screen.getByLabelText('Mieter'), { target: { value: 'Schmidt' } })
  fireEvent.change(screen.getByLabelText(/^Einzug/i), { target: { value: '2025-01-01' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  expect(await screen.findByText(/überschneidet sich in derselben Wohnung mit „Müller“ ab dem 01\.01\.2025/)).toBeTruthy()
  const frage = screen.getByRole('heading', { name: 'Mietverhältnisse überschneiden sich' }).closest('.dialog')
  if (!(frage instanceof HTMLElement)) return expect.fail('keine Rückfrage')
  fireEvent.click(within(frage).getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByText(/überschneidet sich/)).toBeNull())
  expect(sent).toHaveLength(0)
})

test('Kosten: die Ablehnung beim Löschen ist zu sehen', async () => {
  const item = { id: 'c1', propertyId: 'objekt-1', period: calendarPeriod(new Date().getFullYear() - 1), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'units' }
  const base = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    (init?.method ?? 'GET') === 'GET' && url.startsWith('/api/costItems')
      ? new Response(JSON.stringify([item]), { status: 200, headers: { 'content-type': 'application/json' } })
      : base(url, init))
  shell(<Kosten units={UNITS} settings={null} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition löschen/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^Löschen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy())
})

// Alte Meldungen (#146): Eine Meldung gehört zu dem Vorgang, der sie ausgelöst hat. Wer danach ein
// Formular öffnet oder schließt, soll sie nicht mehr an der falschen Stelle lesen.
test('Stammdaten: ein Löschfehler oben erscheint nicht im danach geöffneten Formular', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung löschen/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^Löschen$/i }))
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Wohnung bearbeiten/i }))
  await screen.findByRole('button', { name: /^Übernehmen$/i })
  expect(screen.queryByText(MSG)).toBeNull()
})

test('Stammdaten: ein Fehler im Formular steht nach „Abbrechen“ nicht oben auf der Seite', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung hinzufügen/i }))
  fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'DG' } })
  fireEvent.change(screen.getByLabelText(/^Wohnfläche/i), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await expectShownInDialog()
  fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText(MSG)).toBeNull()
})

test('Zähler: ein Löschfehler oben erscheint nicht im danach geöffneten Formular', async () => {
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler löschen/i }))
  fireEvent.click(await screen.findByRole('button', { name: /^Löschen$/i }))
  await waitFor(() => expect(screen.getByText(MSG)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Zähler bearbeiten/i }))
  await screen.findByRole('button', { name: /^Übernehmen$/i })
  expect(screen.queryByText(MSG)).toBeNull()
})

test('Mietkonto: ein Fehler im Formular steht nach „Abbrechen“ nicht oben auf der Seite', async () => {
  shell(<Mietkonto />)
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '11,11' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  await expectShownInDialog()
  fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText(MSG)).toBeNull()
})

test('Kosten: ein Fehler im Formular steht nach „Abbrechen“ nicht oben auf der Seite', async () => {
  shell(<Kosten units={UNITS} settings={null} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition manuell erfassen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/i), { target: { value: '100,00' } })
  fireEvent.click(screen.getByRole('button', { name: /^Hinzufügen$/i }))
  await expectShownInDialog()
  fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/i }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText(MSG)).toBeNull()
})
