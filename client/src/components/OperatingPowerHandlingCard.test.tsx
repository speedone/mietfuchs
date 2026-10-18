// @vitest-environment jsdom
// Karte „Betriebsstrom der Heizung“ (#266): Der angezeigte Wert ist der gespeicherte, eine Auswahl schickt genau einen
// PUT an die Anlage, und danach wird neu geladen.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HeatingPlant } from '../types'
import OperatingPowerHandlingCard from './OperatingPowerHandlingCard'
import { UIProvider } from './feedback'
import { OPERATING_POWER_HANDLING_LABELS, OPERATING_POWER_HANDLING_QUESTION } from '../../../shared/operatingPower.ts'

const PLANT = { id: 'hp', propertyId: 'objekt-1', name: 'Kessel', energy: 'gas', supply: 'central', method: 'manual', source: 'building', operatingPowerHandling: null } as HeatingPlant
let sent: { url: string; method: string; body: unknown }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? 'null')) })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const wrap = (ui: React.ReactElement) => render(<UIProvider>{ui}</UIProvider>)
const select = () => screen.getByLabelText(OPERATING_POWER_HANDLING_QUESTION) as HTMLSelectElement

test('der angezeigte Wert ist der gespeicherte, für jede Angabe und ohne', () => {
  for (const v of [null, 'ownMeter', 'deducted', 'landlordPays'] as const) {
    wrap(<OperatingPowerHandlingCard plant={{ ...PLANT, operatingPowerHandling: v }} onSaved={() => {}} />)
    expect(select().value).toBe(v ?? '')
    expect(select().selectedOptions[0]?.textContent).toBe(OPERATING_POWER_HANDLING_LABELS[v ?? ''])
    cleanup()
  }
})

test('Überschrift, Frage und Hilfe; der Zwischenzähler ist kein eigener Stromvertrag', () => {
  wrap(<OperatingPowerHandlingCard plant={PLANT} onSaved={() => {}} />)
  expect(screen.getByText(/Betriebsstrom der Heizung/)).toBeTruthy()
  expect(screen.getByText(/Die Angabe ändert keine Zahl der Abrechnung\./)).toBeTruthy()
  expect(screen.getByText(/Ein Zwischenzähler hinter dem Stromzähler des Hauses ist kein eigener Stromvertrag: Sein Strom steckt in der Stromrechnung des Hauses und ist beim Allgemeinstrom abzuziehen; der Zwischenzähler erspart Ihnen nur das Schätzen \(BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Rn\. 32; vgl\. BGH, Urteil vom 03\.06\.2016, V ZR 166\/15, Leitsatz\)\./)).toBeTruthy()
})

// #309: Die Auswahl ist ein Entwurf am Feld; erst „Speichern“ schickt sie.
const speichern = () => screen.getByRole('button', { name: /^Speichern/ })

test('eine Auswahl sendet nichts; „Speichern“ schickt genau einen PUT an die Anlage, leer als null, und lädt danach neu', async () => {
  const onSaved = vi.fn()
  wrap(<OperatingPowerHandlingCard plant={{ ...PLANT, operatingPowerHandling: 'ownMeter' }} onSaved={onSaved} />)
  fireEvent.change(select(), { target: { value: 'deducted' } })
  expect(sent).toEqual([])
  const knopf = speichern()
  fireEvent.click(knopf)
  fireEvent.click(knopf)
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(sent).toEqual([{ url: '/api/heating-plants/hp', method: 'PUT', body: { operatingPowerHandling: 'deducted' } }])
  expect(await screen.findByText('Die Angabe ist gespeichert.')).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull())
  fireEvent.change(select(), { target: { value: '' } })
  fireEvent.click(speichern())
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
  expect(sent[1]).toEqual({ url: '/api/heating-plants/hp', method: 'PUT', body: { operatingPowerHandling: null } })
})

test('ein Fehler des Servers steht in der Karte, neu geladen wird nicht', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Wie der Betriebsstrom dieser Heizung erfasst ist, kennt Mietfuchs so nicht. Bitte wählen Sie aus der Liste.' }), { status: 400, headers: { 'content-type': 'application/json' } }))
  const onSaved = vi.fn()
  wrap(<OperatingPowerHandlingCard plant={PLANT} onSaved={onSaved} />)
  fireEvent.change(select(), { target: { value: 'deducted' } })
  fireEvent.click(speichern())
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*kennt Mietfuchs so nicht/)
  expect(alert.closest('.draft-actions')).not.toBeNull()
  expect(select().value).toBe('deducted')
  expect(onSaved).not.toHaveBeenCalled()
})

test('„Verwerfen“ stellt die gespeicherte Angabe her, ohne zu senden (#309)', () => {
  wrap(<OperatingPowerHandlingCard plant={{ ...PLANT, operatingPowerHandling: 'ownMeter' }} onSaved={() => {}} />)
  fireEvent.change(select(), { target: { value: 'landlordPays' } })
  fireEvent.click(screen.getByRole('button', { name: /^Verwerfen/ }))
  expect(select().value).toBe('ownMeter')
  expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull()
  expect(sent).toEqual([])
})
