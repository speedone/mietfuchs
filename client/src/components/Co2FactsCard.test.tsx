// @vitest-environment jsdom
// Die Karte „CO₂: Angaben zum Gebäude“ (Heizung PR 7): Die Auswahl zu § 9 zeigt den gespeicherten Wert,
// Speichern schickt die Angaben an die Anlage, die Frage zum Emissionshandel nur bei Fernwärme.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Co2FactsCard from './Co2FactsCard'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView } from '../types'
import { noInfoView } from '../testing/heatingView'

const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-05'), label: '2025/2026', from: '2025-05-01', to: '2026-04-30', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null }, hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, items: [], stock: null,
}
const facts = { id: 'hp', energy: 'gas', method: 'manual', nonResidential: false, restriction: 'supply', districtEtsNew: false } as const

let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Die Auswahl zu § 9 zeigt den gespeicherten Wert; Speichern schickt die Angaben an die Anlage', async () => {
  render(<Co2FactsCard plant={facts} view={view} servedAreaM2={600} onSaved={() => {}} />)
  const el = screen.getByLabelText('Beschränkungen (§ 9 CO2KostAufG)')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  expect(el.value).toBe('supply')
  expect(screen.queryByLabelText(/Emissionshandel/)).toBeNull()
  fireEvent.click(screen.getByLabelText('Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)'))
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/heating-plants/hp', method: 'PUT', body: { nonResidential: true, restriction: 'supply', districtEtsNew: false } }))
})

test('Fernwärme: die Frage zum ersten Anschluss nach dem Stichtag aus dem Register', () => {
  render(<Co2FactsCard plant={{ ...facts, energy: 'districtHeating' }} view={view} servedAreaM2={600} onSaved={() => {}} />)
  expect(screen.getByLabelText(/erstmals nach dem 01\.01\.2023 an ein Wärmenetz/)).toBeTruthy()
})

test('Bei freien Schlüsseln die Fläche der Einstufung; leer gilt die Wohnfläche der versorgten Wohnungen', async () => {
  render(<Co2FactsCard plant={facts} view={view} servedAreaM2={600} onSaved={() => {}} />)
  expect(screen.getByText(/Ohne Angabe: 600 m²/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Fläche der Einstufung (m²)'), { target: { value: '612,5' } })
  fireEvent.click(screen.getByText('Fläche speichern'))
  await waitFor(() => expect(sent.at(-1)).toEqual({ url: '/api/heating-plants/hp/periods/2025-05/co2', method: 'PUT', body: { method: 'self', areaM2: 612.5 } }))
})

test('Durchsicht: Die Angaben zum Gebäude gelten für alle Heizperioden und bleiben auch bei einer abgeschlossenen änderbar', () => {
  render(<Co2FactsCard plant={facts} view={{ ...view, closed: true }} servedAreaM2={600} onSaved={() => {}} />)
  const box = screen.getByLabelText('Das Gebäude dient überwiegend nicht dem Wohnen (§ 8 CO2KostAufG)')
  if (!(box instanceof HTMLInputElement)) throw new Error('kein Kästchen')
  expect(box.disabled).toBe(false)
  expect(screen.getByText('Angaben speichern')).toBeTruthy()
  expect(screen.getByText(/wirken auf Heizperioden, die noch nicht abgeschlossen sind/)).toBeTruthy()
})
