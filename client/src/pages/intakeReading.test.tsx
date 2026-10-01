// @vitest-environment jsdom
// Zählerstände in der Schnellerfassung (#149): gelesen wie jede Menge, „1.234“ ist 1234. Und der
// Wert des Modells wird so ins Feld geschrieben, dass er danach wieder derselbe ist: 1,234 m³ darf
// nicht als „1.234“ dastehen und als 1234 gespeichert werden.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, MeterReadingExtraction, Unit } from '../types'
import { YearProvider } from '../year'
import { PropertyProvider } from '../property'
import Schnellerfassung from './Schnellerfassung'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³', meterNumber: '4711' }]

let reading: MeterReadingExtraction
let posted: Record<string, unknown>[]
let metersServed: boolean

beforeEach(() => {
  posted = []
  metersServed = false
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/intake') return json({ file: 'foto.jpg', kind: 'zaehler', reading })
    if (method === 'POST' && url.startsWith('/api/readings')) posted.push(JSON.parse(String(init?.body)))
    const path = url.split('?')[0]
    if (method === 'GET' && path === '/api/meters') {
      metersServed = true
      return json(METERS)
    }
    return json(method === 'GET' ? [] : { ok: true })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function evaluate() {
  const { container } = render(
    <YearProvider>
      <PropertyProvider>
        <Schnellerfassung units={UNITS} settings={null} onNavigate={() => {}} />
      </PropertyProvider>
    </YearProvider>,
  )
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"][multiple]')
    if (!(found instanceof HTMLInputElement)) throw new Error('das Dateifeld ist noch nicht da')
    return found
  })
  // Die Zähler müssen da sein, bevor ausgewertet wird, sonst gibt es keine Zuordnung.
  await waitFor(() => expect(metersServed).toBe(true), { timeout: 5000 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  fireEvent.change(input, { target: { files: [new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: /Ablesung übernehmen/ }, { timeout: 5000 })
}

const valueField = () => screen.getByLabelText(/^Stand/) as HTMLInputElement

test('„1.234“ im Feld wird als 1234 übernommen', async () => {
  reading = { meterNumber: '4711', value: 1000, dateOnImage: '2025-12-31' }
  await evaluate()
  fireEvent.change(valueField(), { target: { value: '1.234' } })
  fireEvent.click(screen.getByRole('button', { name: /Ablesung übernehmen/ }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ meterId: 'm1', value: 1234 })
})

test('der Wert des Modells steht in deutscher Schreibweise da und bleibt derselbe', async () => {
  reading = { meterNumber: '4711', value: 1.234, dateOnImage: '2025-12-31' }
  await evaluate()
  expect(valueField().value).toBe('1,234')
  fireEvent.click(screen.getByRole('button', { name: /Ablesung übernehmen/ }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ value: 1.234 })
})
