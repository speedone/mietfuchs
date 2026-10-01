// @vitest-environment jsdom
// Stammdaten aus der Browser-Abnahme (#142): Was die Listen zeigen und was die Löschfrage sagt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { PropertyKind, Tenancy, Unit, UnitDependents } from '../types'
import { YearProvider } from '../year'
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

beforeEach(() => {
  kind = 'mfh'
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
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
    <YearProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS} tenancies={tenancies} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </YearProvider>,
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
    <YearProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS.map(({ mea: _mea, ...u }) => u)} tenancies={[]} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </YearProvider>,
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
