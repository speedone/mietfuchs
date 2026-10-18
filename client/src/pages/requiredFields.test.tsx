// @vitest-environment jsdom
// Pflichtfelder (#346, Schritt 3): Ein Feld trägt das Sternchen und `required` genau dann, wenn die Prüfung es
// verlangt. Je umgestelltes Formular: alle Pflichtfelder leeren und absenden; die Felder mit einer Meldung „… fehlt“
// sind genau die Felder mit `required`. Dazu: Kein Pflichtfeld ist beim Öffnen als ungültig markiert, und das
// Absenden zeigt unsere Sammelmeldung (es gibt kein `<form>`, dessen Prüfung des Browsers vorgreifen könnte).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { HeatingPlant, Meter, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import HeatingSelfSetup from '../components/HeatingSelfSetup'
import { INSULATION_QUESTION } from '../heatingSelfView'
import Kosten from './Kosten'
import Zaehler from './Zaehler'
import Mietkonto from './Mietkonto'
import Stammdaten from './Stammdaten'

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
let sent: string[]

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push(`${method} ${url}`)
      return new Response(JSON.stringify({ error: 'nein' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }],
      '/api/meters': METERS,
      '/api/readings': [],
      '/api/tenancies': TENANCIES,
      '/api/payments': [],
      '/api/units': UNITS,
    }
    const body = path.startsWith('/api/rentledger/') ? LEDGER : responses[path] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = (page: ReactNode) => render(<PeriodProvider><PropertyProvider><UIProvider>{page}</UIProvider></PropertyProvider></PeriodProvider>)
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
const describedTexts = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '')
const nameOf = (el: Element) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ?? el.id

/** Leert die Pflichtfelder in `scope`, sendet ab und vergleicht „fehlt“ mit `required`. */
async function requiredMatchesMissing(scope: HTMLElement, submit: () => void, expected: string[]) {
  const required = [...scope.querySelectorAll<Control>('input[required], select[required], textarea[required]')]
  expect(required.map(nameOf).sort()).toEqual([...expected].sort())
  // Beim Öffnen ist kein Pflichtfeld als ungültig markiert, auch leer nicht.
  expect(scope.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
  for (const el of required) fireEvent.change(el, { target: { value: '' } })
  submit()
  await screen.findByRole('alert')
  const missing = [...scope.querySelectorAll<Control>('[aria-invalid="true"]')].filter((el) => describedTexts(el).some((t) => /fehlt$/.test(t)))
  expect(missing.map(nameOf).sort()).toEqual([...expected].sort())
  expect(sent).toEqual([])
}

const dialog = () => screen.getByRole('dialog')

test('Mietverhältnis: Mieter, Wohnung, Einzug', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis anlegen/i }))
  expect(within(dialog()).getByText(/Pflichtangabe/)).toBeTruthy()
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ })), ['Mieter', 'Wohnung', 'Einzug'])
})

test('Wohnung: Name und Wohnfläche', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung anlegen/i }))
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ })), ['Name', 'Wohnfläche (m²)'])
})

test('Objekt (Karte): Bezeichnung, mit Legende in der Karte', async () => {
  shell(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} />)
  const card = (await screen.findByRole('heading', { name: /^Objekt$/ })).closest('.card') as HTMLElement
  expect(card.textContent).toContain('* Pflichtangabe')
  await requiredMatchesMissing(card, () => fireEvent.click(card.querySelector('button.btn') as HTMLButtonElement), ['Bezeichnung'])
})

test('Zahlung: Mietverhältnis, Datum, Betrag', async () => {
  shell(<Mietkonto />)
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/i })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ })), ['Mietverhältnis', 'Datum', 'Betrag €'])
})

test('Kostenposition: Beschreibung und Betrag', async () => {
  shell(<Kosten units={UNITS} settings={null} />)
  fireEvent.click(await screen.findByRole('button', { name: /Kostenposition anlegen/i }))
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ })), ['Beschreibung', 'Betrag €'])
})

test('Zähler: Name und Einheit (Kaltwasser)', async () => {
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/i }))
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ })), ['Name', 'Einheit'])
})

test('Ablesung: Datum und Zählerstand, mit Legende', async () => {
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/i }))
  const panel = document.querySelector('.reading-panel') as HTMLElement
  expect(panel.textContent).toContain('* Pflichtangabe')
  await requiredMatchesMissing(panel, () => fireEvent.click(screen.getByRole('button', { name: /Ablesung speichern/ })), ['Datum', 'Zählerstand'])
})

test('eigene Heizkostenabrechnung: Warmwasser, Wärmeschutz, beide Anteile', async () => {
  const plant = { id: 'hp', energy: 'gas', hotWater: 'combined', capture: null, areaBasisHeat: 'area' } as HeatingPlant
  render(<UIProvider><HeatingSelfSetup plant={plant} period="2025-01" onDone={() => {}} onCancel={() => {}} /></UIProvider>)
  await requiredMatchesMissing(dialog(), () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' })),
    ['Bereitet diese Heizung auch das Warmwasser?', `${INSULATION_QUESTION} (Pflichtanteil)`, 'Heizung in %', 'Warmwasser in %'])
})
