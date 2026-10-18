// @vitest-environment jsdom
// Karte „Angaben zur Abrechnung (§ 6a)“ (#346, Schritt 7a): Eine ungespeicherte Eingabe zählt als offenes
// Formular; nach dem Speichern nicht mehr, auch wenn der Server die Zahl anders schreibt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HeatingInfoCard from './HeatingInfoCard'
import { OpenFormScope, hasOpenForm } from '../testing/openForm'
import { noInfoView } from '../testing/heatingView'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from '../types'

const PLANT = { id: 'hp', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'self' } as HeatingPlant
const view: HeatingPeriodView = {
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, items: [], stock: null,
  ...noInfoView(),
}
beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Ändern meldet die Karte an, Speichern nimmt die Marke weg', async () => {
  const changed = vi.fn()
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={view} onChanged={changed} /></OpenFormScope>)
  expect(hasOpenForm()).toBe(false)
  fireEvent.change(screen.getByLabelText(/Steuern, Abgaben und Zölle/), { target: { value: 'Energiesteuer 312,00 €' } })
  expect(hasOpenForm()).toBe(true)
  fireEvent.click(screen.getByText('Angaben speichern'))
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(hasOpenForm()).toBe(false)
})
