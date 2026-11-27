// @vitest-environment jsdom
// #712: Die Wahl „Was deckt die zweite Vorauszahlung?“ im Abschnitt „Zeitraum der Heizung“: Der angezeigte Wert ist der
// gespeicherte, gespeichert wird erst mit „Speichern“, und bei einer eigenen Heizperiode steht nur der Satz, warum.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingPeriodSection from './HeatingPeriodSection'
import { UIProvider } from './feedback'
import { CALENDAR_RULES } from '../../../shared/period.ts'
import { SECOND_PREPAYMENT_HELP, SECOND_PREPAYMENT_OWN_PERIOD_NOTE, SECOND_PREPAYMENT_QUESTION } from '../heatingPeriodForm'
import type { HeatingPlant } from '../types'

const plant = (over: Partial<HeatingPlant> = {}): HeatingPlant => ({
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'service', separateSettlement: true,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null, nonResidential: false, restriction: 'none', districtEtsNew: false, secondPrepaymentCoversWater: false,
  endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null, hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null,
  heatGeneration: null, heatPumpMajority: null, hcaModel: null, operatingPowerHandling: null, contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null,
  gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null,
  ...over,
})
const SAVE = 'Speichern (zweite Vorauszahlung)'
const section = (p: HeatingPlant, onChanged: () => Promise<void> = async () => {}, notify: (text: string) => void = () => {}) =>
  render(<UIProvider><HeatingPeriodSection plant={p} objectRules={CALENDAR_RULES} hasCalendarData onChanged={onChanged} notify={notify} /></UIProvider>)
const choice = (): HTMLSelectElement => {
  const el = screen.getByRole('combobox', { name: SECOND_PREPAYMENT_QUESTION })
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}

let sent: { url: string; method: string; body: unknown }[]
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

test('#712: Die Auswahl zeigt den gespeicherten Wert, in beiden Stellungen, mit dem Satz, was sich ändert', () => {
  section(plant())
  expect(choice().value).toBe('heating')
  expect([...choice().options].map((o) => [o.value, o.textContent])).toEqual([['heating', 'Heizung und Warmwasser'], ['water', 'Heizung, Warmwasser und Wasser/Abwasser']])
  expect(screen.getByText(SECOND_PREPAYMENT_HELP)).toBeTruthy()
  cleanup()
  section(plant({ secondPrepaymentCoversWater: true }))
  expect(choice().value).toBe('water')
  expect(choice().selectedOptions[0]?.textContent).toBe('Heizung, Warmwasser und Wasser/Abwasser')
})

test('#712: gespeichert wird erst mit „Speichern“, als Angabe an der Heizanlage', async () => {
  const changed = vi.fn(async () => {})
  const notes: string[] = []
  section(plant(), changed, (text) => notes.push(text))
  expect(screen.queryByRole('button', { name: SAVE })).toBeNull()
  fireEvent.change(choice(), { target: { value: 'water' } })
  expect(sent).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: SAVE }))
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(sent).toEqual([{ url: '/api/heating-plants/hp1', method: 'PUT', body: { secondPrepaymentCoversWater: true } }])
  expect(notes).toEqual(['Angabe zur zweiten Vorauszahlung gespeichert.'])
})

test('#712: lehnt der Server ab, steht seine Meldung da und der Entwurf bleibt', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Das geht hier nicht.' }), { status: 400, headers: { 'content-type': 'application/json' } }))
  section(plant())
  fireEvent.change(choice(), { target: { value: 'water' } })
  fireEvent.click(screen.getByRole('button', { name: SAVE }))
  expect(await screen.findByText(/Das geht hier nicht\./)).toBeTruthy()
  expect(choice().value).toBe('water')
})

test('#712: ohne aufgeteilte Vorauszahlung gibt es die Wahl nicht', () => {
  section(plant({ separateSettlement: false }))
  expect(screen.queryByRole('combobox', { name: SECOND_PREPAYMENT_QUESTION })).toBeNull()
  expect(screen.queryByText(SECOND_PREPAYMENT_OWN_PERIOD_NOTE)).toBeNull()
})

test('#712: eigene Heizkostenabrechnung je Heizperiode: keine Wahl, nur der Satz, warum', () => {
  section(plant({ periodStartMonth: 5, separateSpans: [{ from: '2025-05', until: null }] }))
  expect(screen.queryByRole('combobox', { name: SECOND_PREPAYMENT_QUESTION })).toBeNull()
  expect(screen.getByText(SECOND_PREPAYMENT_OWN_PERIOD_NOTE)).toBeTruthy()
})
