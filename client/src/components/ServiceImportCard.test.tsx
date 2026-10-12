// @vitest-environment jsdom
// Die Karte „Messdienstabrechnung auslesen“ (Heizung PR 20): Der Beleg geht mit Objekt und Jahr an die Route
// der Anlage (Prüfung S4), und die Antwort erscheint als Prüfansicht, ohne dass etwas gespeichert wird.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ServiceImportCard from './ServiceImportCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, ServiceExtractResult, Tenancy, Unit } from '../types'
import { noInfoView } from '../testing/heatingView'

const view = (closed = false): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null, items: [],
})
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const UNITS: Unit[] = [{ id: 'a', propertyId: 'objekt-1', name: 'EG links', areaM2: 60, participates: true }]
const result: ServiceExtractResult = {
  file: 'beleg.pdf',
  extraction: {
    vendor: 'Wärmedienst Beispiel GmbH', unitsCount: 1, usersTotalEur: 1180.25, deductionEur: null, fuelGrossEur: null, fuelNetEur: null, co2: null, dhwMethod: null,
    blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 1180.25, lines: [{ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, amountEur: 1180.25, vacancy: false }] }],
  },
}

let posted: { url: string; fields: Record<string, string> }[]
beforeEach(() => {
  posted = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) {
      const fields: Record<string, string> = {}
      init.body.forEach((v, k) => { if (typeof v === 'string' && k !== 'requestId') fields[k] = v })
      posted.push({ url, fields })
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ai: { pageImageEdge: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Der Beleg geht mit Objekt und Jahr an die Anlage; die Prüfansicht zeigt die Zuordnung', async () => {
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1' }} view={view()} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} />)
  const input = screen.getByLabelText('Messdienstabrechnung wählen')
  fireEvent.change(input, { target: { files: [new File(['x'], 'abrechnung.jpg', { type: 'image/jpeg' })] } })
  const zuordnung = await screen.findByLabelText('Zuordnung „Mustermann, Erika“')
  if (!(zuordnung instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(zuordnung.value).toBe('tenancy:t1')
  expect(posted).toEqual([{ url: '/api/heating-plants/hp/service-statement', fields: { propertyId: 'objekt-1', year: '2025' } }])
})

test('In einer abgeschlossenen Heizperiode gibt es nichts auszulesen', () => {
  render(<ServiceImportCard plant={{ id: 'hp', propertyId: 'objekt-1' }} view={view(true)} object={{ key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31' }} tenancies={TENANCIES} units={UNITS} onSaved={() => {}} />)
  expect(screen.queryByLabelText('Messdienstabrechnung wählen')).toBeNull()
})
