// @vitest-environment jsdom
// Zimmer einer Wohnung (#573) an Zählern und Kostenpositionen: Sparten an der Wohnung, Auswahl der Verteilung auf die Zimmer.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Meter, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Zaehler from './Zaehler'
import Kosten from './Kosten'

const unit = (id: string, name: string, patch: Partial<Unit> = {}): Unit => ({ id, propertyId: 'objekt-1', name, areaM2: 20, participates: true, ...patch })
const UNITS: Unit[] = [unit('wg', 'WG', { areaM2: 90 }), unit('z1', 'Zimmer 1', { parentUnitId: 'wg' }), unit('z2', 'Zimmer 2', { parentUnitId: 'wg' }), unit('eg', 'EG')]
let meters: Meter[] = []
let costItems: unknown[] = []
let sent: { url: string; method: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  sent = []
  costItems = []
  meters = [{ id: 'm1', propertyId: 'objekt-1', name: 'Wasser WG', unitId: 'wg', type: 'kaltwasser', unit: 'm³' }]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ id: 'x' })
    }
    const path = url.split('?')[0]
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/meters') return json(meters)
    if (path === '/api/costItems') return json(costItems)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SLOW = { timeout: 5000 }
const labelled = (re: RegExp) => screen.getByLabelText(re) as HTMLSelectElement

async function openMeterForm() {
  render(<PeriodProvider><PropertyProvider><Zaehler units={UNITS} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler anlegen/ }, SLOW))
}

test('Zählerformular: an einer Wohnung mit Zimmern nur Kaltwasser, Strom und Sonstiges; die Wohnung steht für Wärme nicht zur Wahl', async () => {
  await openMeterForm()
  const assignment = labelled(/^Zuordnung/)
  const type = labelled(/^Sparte/)
  expect([...type.options].map((o) => o.value)).toHaveLength(6)
  fireEvent.change(assignment, { target: { value: 'wg' } })
  expect([...type.options].map((o) => o.value).sort()).toEqual(['kaltwasser', 'sonstig', 'strom'])
  expect(type.value).toBe('kaltwasser')
  expect(screen.getByText(/An einer Wohnung mit Zimmern hängen nur Zähler/)).toBeTruthy()
  // Gewählt wird Strom: der Wert der Auswahl ist der gespeicherte.
  fireEvent.change(type, { target: { value: 'strom' } })
  expect(type.value).toBe('strom')
})

test('Zählerformular: bei Wärme steht die Wohnung mit Zimmern nicht in der Zuordnung', async () => {
  await openMeterForm()
  fireEvent.change(labelled(/^Sparte/), { target: { value: 'waerme' } })
  expect([...labelled(/^Zuordnung/).options].map((o) => o.value)).toEqual(['', 'z1', 'z2', 'eg'])
})

async function openCostForm() {
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: /Kostenposition anlegen/i })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Kostenposition anlegen/i }))
  fireEvent.change(screen.getByLabelText(/Beschreibung/i), { target: { value: 'Wasser' } })
  fireEvent.change(screen.getByLabelText(/Betrag/i), { target: { value: '100,00' } })
  await waitFor(() => expect([...labelled(/Umlageschlüssel/i).options].some((o) => o.value === 'meter')).toBe(true))
  fireEvent.change(labelled(/Umlageschlüssel/i), { target: { value: 'meter' } })
}

test('Kostenposition: die Auswahl der Verteilung auf die Zimmer zeigt Fläche und speichert, was sie zeigt', async () => {
  await openCostForm()
  const split = await waitFor(() => labelled(/Zähler der Wohnung auf die Zimmer verteilen nach/))
  expect([...split.options].map((o) => o.text)).toEqual(['Fläche', 'Personentagen'])
  expect(split.value).toBe('area')
  fireEvent.change(split, { target: { value: 'persons' } })
  expect(split.value).toBe('persons')
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ key: 'meter', meterType: 'kaltwasser', roomSplit: 'persons' })
})

test('Kostenposition: ohne Wahl wird keine Verteilung gespeichert (Voreinstellung Fläche)', async () => {
  await openCostForm()
  await waitFor(() => labelled(/Zähler der Wohnung auf die Zimmer verteilen nach/))
  fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body.roomSplit ?? null).toBeNull()
})

test('Kostenposition: ohne Zähler an der Wohnung gibt es die Auswahl nicht', async () => {
  meters = [{ id: 'm2', propertyId: 'objekt-1', name: 'Wasser EG', unitId: 'eg', type: 'kaltwasser', unit: 'm³' }]
  await openCostForm()
  await waitFor(() => labelled(/Zählertyp/i))
  expect(screen.queryByLabelText(/Zähler der Wohnung auf die Zimmer verteilen nach/)).toBeNull()
})

test('Kostenposition: die Wohnung mit Zimmern steht nicht in der Direktzuordnung, Teilnehmern und Steuerauswahl', async () => {
  await openCostForm()
  fireEvent.change(labelled(/Umlageschlüssel/i), { target: { value: 'direct' } })
  const direct = await waitFor(() => labelled(/Zugeordnet zu|Wohnung/i))
  expect([...direct.options].map((o) => o.text)).not.toContain('WG')
  expect([...direct.options].map((o) => o.text)).toContain('Zimmer 1')
  fireEvent.change(labelled(/Umlageschlüssel/i), { target: { value: 'area' } })
  expect(screen.queryByRole('checkbox', { name: /WG/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Zimmer 1/ })).toBeTruthy()
})

test('Kostenposition: eine gespeicherte Direktzuordnung an die Wohnung bleibt sichtbar', async () => {
  costItems = [{ id: 'c9', propertyId: 'objekt-1', period: '2025-01', category: 'Wasser/Abwasser', description: 'Alt', amountCents: 100, key: 'direct', directUnitId: 'wg' }]
  render(<PeriodProvider><PropertyProvider><Kosten units={UNITS} settings={null} /></PropertyProvider></PeriodProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Kostenposition bearbeiten' }, SLOW))
  const direct = await waitFor(() => labelled(/Zugeordnet zu|Wohnung/i))
  expect(direct.value).toBe('wg')
  expect([...direct.options].map((o) => o.value)).toContain('wg')
})
