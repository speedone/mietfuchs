// @vitest-environment jsdom
// Stammdaten aus der Browser-Abnahme (#142): Was die Listen zeigen und was die Löschfrage sagt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Meter, PropertyKind, Tenancy, Unit, UnitDependents } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true, mea: 124 },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const tenancy = (id: string, tenantName: string, patch: Partial<Tenancy> = {}): Tenancy => ({
  id, unitId: 'u1', tenantName, persons: 1, personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...patch,
})
const DEPS: UnitDependents = { tenancies: 2, meters: 1, readings: 4, payments: 12, costItemLinks: 0, directCostItems: 0 }

let kind: PropertyKind = 'mfh'
let meters: Meter[] = []
let sent: { url: string; method: string; body: Record<string, unknown> }[] = []
let plants: unknown[] = []

beforeEach(() => {
  kind = 'mfh'
  meters = []
  sent = []
  plants = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, method: init?.method ?? '', body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ ok: true })
    }
    if (path === '/api/meters') return json(meters)
    if (path === '/api/heating-plants') return json(plants)
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/units/u1/dependents') return json(DEPS)
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (tenancies: Tenancy[] = []) =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS} tenancies={tenancies} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest('tr')
  if (!row) throw new Error(`keine Zeile für ${text}`)
  return within(row)
}

test('Mietverhältnisse: Pauschale und Inklusivmiete stehen in der Liste, die Abrechnung nicht', async () => {
  page([
    tenancy('t1', 'Abgerechnet'),
    tenancy('t2', 'Pauschal', { costModel: 'flatRate', heatingModel: 'flatRate' }),
    tenancy('t3', 'Inklusiv', { costModel: 'inclusive', heatingModel: 'inclusive' }),
    tenancy('t4', 'Gemischt', { costModel: 'flatRate' }),
  ])
  await screen.findByText('Pauschal', undefined, SLOW)
  expect(rowOf('Pauschal').getByText('Pauschale')).toBeTruthy()
  expect(rowOf('Inklusiv').getByText('inklusiv')).toBeTruthy()
  expect(rowOf('Gemischt').getByText('kalt pauschal · Heizung abgerechnet')).toBeTruthy()
  expect(rowOf('Abgerechnet').queryByText(/pauschal|inklusiv/i)).toBeNull()
})

test('Wohnungen: die Miteigentumsanteile stehen in der Liste, sobald eine Wohnung welche hat', async () => {
  page()
  await screen.findByText('EG', undefined, SLOW)
  expect(screen.getByRole('columnheader', { name: /MEA/ })).toBeTruthy()
  expect(rowOf('EG').getByText('124')).toBeTruthy()
  expect(rowOf('OG').getByText('—')).toBeTruthy()
})

test('Wohnungen: ohne Miteigentumsanteile und außerhalb einer Eigentumswohnung keine Spalte dafür', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS.map(({ mea: _mea, ...u }) => u)} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('EG', undefined, SLOW)
  expect(screen.queryByRole('columnheader', { name: /MEA/ })).toBeNull()
})

test('Wohnung löschen: die Frage nennt, was mitgelöscht wird, mit Anzahl', async () => {
  page([tenancy('t1', 'Müller')])
  const [first] = await screen.findAllByRole('button', { name: /Wohnung löschen/i }, SLOW)
  if (!first) throw new Error('kein Löschknopf')
  fireEvent.click(first)
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(within(dialog).getByText(/2 Mietverhältnisse, 1 Zähler, 4 Ablesungen und 12 Zahlungen/)).toBeTruthy()
})

// #142 (B12): „Kein Anschluss für“ mit Kästchen las sich verkehrt herum. Jetzt positiv: angehakt
// heißt angeschlossen; gespeichert wird weiter nur die Ausnahme.
const meter = (type: Meter['type'], unitId: string | null = 'u2'): Meter => ({ id: `m-${type}`, propertyId: 'objekt-1', name: type, unitId, type, unit: 'm³' })

const openUnit = async (units: Unit[] = UNITS) => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={units} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  const [first] = await screen.findAllByRole('button', { name: /Wohnung bearbeiten/i }, SLOW)
  if (!first) throw new Error('kein Bearbeiten-Knopf')
  fireEvent.click(first)
  return screen.findByRole('dialog', undefined, SLOW)
}

test('Anschlüsse: ohne Zähler im Objekt und ohne Ausnahme gibt es den Block nicht', async () => {
  const dialog = await openUnit()
  expect(within(dialog).queryByText(/Anschlüsse dieser Einheit/)).toBeNull()
})

test('Anschlüsse: mit einem Kaltwasserzähler nur Kaltwasser, angehakt; Häkchen entfernen speichert die Ausnahme', async () => {
  meters = [meter('kaltwasser')]
  const dialog = await openUnit()
  const box = await within(dialog).findByRole('checkbox', { name: 'Kaltwasser' }, SLOW) as HTMLInputElement
  expect(within(dialog).queryByRole('checkbox', { name: 'Wärme' })).toBeNull()
  expect(within(dialog).queryByRole('checkbox', { name: 'Sonstiges' })).toBeNull()
  expect(box.checked).toBe(true)
  expect(within(dialog).getByText(/Hat eine Einheit keinen Anschluss/)).toBeTruthy()
  fireEvent.click(box)
  expect(box.checked).toBe(false)
  // Die Zusammenfassung des zugeklappten Bereichs macht die Ausnahme sichtbar.
  expect(within(dialog).getByText(/ohne Wasseranschluss/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ noConnection: ['kaltwasser'] })
})

test('Anschlüsse: eine gesetzte Ausnahme ohne Zähler dieser Art bleibt sichtbar und lässt sich zurücknehmen', async () => {
  const dialog = await openUnit([{ ...UNITS[0]!, noConnection: ['waerme'] }, UNITS[1]!])
  const box = within(dialog).getByRole('checkbox', { name: 'Wärme' }) as HTMLInputElement
  expect(box.checked).toBe(false)
  expect(within(dialog).getByText(/ohne Wärmeanschluss/)).toBeTruthy()
  fireEvent.click(box)
  expect(box.checked).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: /^Übernehmen$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ noConnection: [] })
})

test('Wohnungsliste: eine Ausnahme steht als Kennzeichen an der Wohnung', async () => {
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={[UNITS[0]!, { ...UNITS[1]!, noConnection: ['kaltwasser'] }]} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByText('OG', undefined, SLOW)
  expect(rowOf('OG').getByText('ohne Wasseranschluss')).toBeTruthy()
  expect(rowOf('EG').queryByText(/ohne/)).toBeNull()
})

test('Nutzung „Eigennutzung“: der Hilfetext verweist auf den Begriff Einliegerwohnung (#142)', async () => {
  const dialog = await openUnit([{ ...UNITS[0]!, participates: false, selfUsed: true }, UNITS[1]!])
  expect(within(dialog).getByRole('button', { name: 'Einliegerwohnung' })).toBeTruthy()
})

// Breite der Tabelle (#180): Bei 1.280 px war sie 1.234 px breit in einer Karte von 953 px, und
// Mieterwechsel, ✎ und 🗑 lagen nur durch Scrollen im Bild. Die Breite selbst misst jsdom nicht
// (nachgemessen im Browser: 909 von 909 px bei 1.280, 954 von 954 bei 1.440 und 1.920 px). Hier
// steht, was sie ermöglicht: Nichts in der Tabelle verbietet den Umbruch pauschal; zusammen bleibt
// nur, was zusammengehört (die beiden Symbole, ein Betrag, eine Telefonnummer).
test('Mietverhältnisse: die Tabelle darf umbrechen, die Symbole bleiben beisammen', async () => {
  const { container } = page([
    tenancy('t1', 'Staffel', {
      email: 'sehr.lange.adresse@example.org', phone: '0171 1234567', costModel: 'flatRate',
      prepayments: [{ from: '2025-01', monthlyCents: 18000 }, { from: '2025-07', monthlyCents: 21000 }],
    }),
  ])
  await screen.findByText('Staffel', undefined, SLOW)
  const table = container.querySelector('table.tenancy-table')
  if (!table) throw new Error('keine Tabelle der Mietverhältnisse')
  const forced = [...table.querySelectorAll<HTMLElement>('[style]')].filter((e) => e.style.whiteSpace === 'nowrap')
  expect(forced.map((e) => e.outerHTML.slice(0, 80))).toEqual([])
  const icons = rowOf('Staffel').getByLabelText('Mietverhältnis bearbeiten').parentElement
  expect(icons?.classList.contains('nowrap')).toBe(true)
  expect(icons?.contains(rowOf('Staffel').getByLabelText('Mietverhältnis löschen'))).toBe(true)
  expect(rowOf('Staffel').getByText('0171 1234567').classList.contains('nowrap')).toBe(true)
})

test('Mietverhältnis an einer Anlage mit getrennter Heizkostenabrechnung: die Heizvorauszahlung wird abgefragt (Durchsicht von #231)', async () => {
  plants = [{
    id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: true,
    devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
    warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: 5, periodChanges: [], separateSpans: [{ from: '2025-05', until: null }], units: null, newDevicesInstall: null,
  }]
  page()
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis hinzufügen/ }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(await within(dialog).findByText(/Heizvorauszahlung je Monat \(neben der übrigen Vorauszahlung\)/, undefined, SLOW)).toBeTruthy()
})
