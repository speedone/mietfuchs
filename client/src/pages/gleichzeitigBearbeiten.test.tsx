// @vitest-environment jsdom
// Zwei Fenster bearbeiten denselben Datensatz (staleRecord.ts): Wohnung, Zähler und Objekt schicken beim Speichern den
// Stand mit, den ihr Formular beim Öffnen hatte, und zeigen die Ablehnung des Servers im Fuß des Seitenfensters.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Meter, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Zaehler from './Zaehler'
import Stammdaten from './Stammdaten'

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true }]
const METERS: Meter[] = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }]
const PROPERTY = { id: 'objekt-1', name: 'Haus A', kind: 'mfh', address: 'Weg 1', landlordName: null, iban: null, paymentDeadlineDays: null }
const STALE = 'wurde inzwischen an anderer Stelle geändert, etwa in einem zweiten Fenster oder auf einem anderen Gerät. Gespeichert wurde nichts.'

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let current: Record<string, unknown>

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const answer = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return answer({ error: `Der Datensatz ${STALE}`, stale: true, current }, 409)
    }
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = { '/api/properties': [PROPERTY], '/api/meters': METERS }
    return answer(responses[path] ?? [], 200)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const shell = (page: ReactNode) => render(<PeriodProvider><PropertyProvider><UIProvider>{page}</UIProvider></PropertyProvider></PeriodProvider>)
const refused = async (changed: string) => {
  await waitFor(() => expect(sent).toHaveLength(1))
  const alert = await within(screen.getByRole('dialog')).findByRole('alert')
  expect(alert.textContent).toContain(STALE)
  expect(alert.textContent).toContain(`Inzwischen geändert: ${changed}.`)
  expect(alert.textContent).toContain('Ihre Eingabe bleibt stehen')
}

test('Wohnung: der Stand vom Öffnen geht mit, die Ablehnung nennt, was sich geändert hat', async () => {
  current = { ...UNITS[0], areaM2: 85 }
  shell(<Stammdaten units={UNITS} tenancies={[]} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung bearbeiten/i }))
  fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'Erdgeschoss' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  await refused('Wohnfläche')
  expect(sent[0]?.body.ifUnchanged).toEqual(UNITS[0])
  expect((screen.getByLabelText(/^Name/i) as HTMLInputElement).value).toBe('Erdgeschoss')
})

test('Zähler: der Stand vom Öffnen geht mit, die Ablehnung nennt, was sich geändert hat', async () => {
  current = { ...METERS[0], meterNumber: 'A-1' }
  shell(<Zaehler units={UNITS} />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler bearbeiten/i }))
  fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'Kaltwasser EG' } })
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/i }))
  await refused('Zählernummer')
  expect(sent[0]?.body.ifUnchanged).toEqual(METERS[0])
})

test('Objekt: der Stand vom Öffnen geht mit, die Ablehnung nennt, was sich geändert hat', async () => {
  current = { ...PROPERTY, address: 'Hauptstraße 1' }
  shell(<Stammdaten units={UNITS} tenancies={[]} settings={null} reload={async () => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten (Objekt)' }))
  const dialog = await screen.findByRole('dialog', { name: 'Objekt bearbeiten' })
  fireEvent.change(within(dialog).getByLabelText(/^Bezeichnung/i), { target: { value: 'Haus am See' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/i }))
  await refused('Adresse')
  expect(sent[0]?.body.ifUnchanged).toEqual(PROPERTY)
})
