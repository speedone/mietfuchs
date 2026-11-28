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

// #690 Punkt 7: Wer ohne Ablesedienst selbst abrechnet, hat keine „Vergleichswerte Ihres Ablesedienstes“. Die Hilfe
// nennt, was § 6a Abs. 3 Satz 1 Nr. 4 HeizkostenV verlangt, und einen Weg, den die Verordnung selbst trägt (Nr. 2).
test('Vergleichswert ohne Ablesedienst: die Hilfe nennt den Weg über die Stellen der Nr. 2, nicht den Ablesedienst', () => {
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={{ ...view, capture: 'heatMeter' }} onChanged={() => {}} /></OpenFormScope>)
  expect(screen.queryByText(/etwa vom Ablesedienst/)).toBeNull()
  expect((screen.getByLabelText('Quelle des Vergleichswerts') as HTMLInputElement).placeholder).not.toMatch(/Ablesedienst/)
  expect(screen.getByText(/normiert oder durch Vergleichstests ermittelt/)).toBeTruthy()
  const way = screen.getByText('Woher bekomme ich den Vergleichswert ohne Ablesedienst?').closest('details') as HTMLDetailsElement
  expect(way.open).toBe(false)
  expect(way.textContent).toMatch(/Verbraucherorganisationen, Energieagenturen oder ähnliche Einrichtungen/)
  expect(way.textContent).toMatch(/Energieberatung der Verbraucherzentralen/)
  expect(way.textContent).toMatch(/Auslegung von Mietfuchs/)
  // Der Hausdurchschnitt bleibt ausgeschlossen, offen sichtbar.
  expect(screen.getByText(/Ein Durchschnitt aus Ihrem eigenen Haus ist kein zulässiger Vergleich/)).toBeTruthy()
})

test('Vergleichswert mit Werten eines Ablesedienstes: die Hilfe bleibt beim Ablesedienst', () => {
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={{ ...view, capture: 'serviceValues' }} onChanged={() => {}} /></OpenFormScope>)
  expect(screen.getByText(/etwa vom Ablesedienst/)).toBeTruthy()
  expect((screen.getByLabelText('Quelle des Vergleichswerts') as HTMLInputElement).placeholder).toBe('z. B. Vergleichswerte Ihres Ablesedienstes')
  expect(screen.queryByText('Woher bekomme ich den Vergleichswert ohne Ablesedienst?')).toBeNull()
})

// Durchsicht M2: Mit Heizkostenverteilern und für das Warmwasser allein rechnet Mietfuchs Nr. 4 nicht; ein Weg zum
// Vergleichswert verspräche dort etwas, das die Kürzung nicht abstellt.
test('Heizkostenverteiler: kein Weg zum Vergleichswert, ein Satz zum Fall', () => {
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={{ ...view, capture: 'hca' }} onChanged={() => {}} /></OpenFormScope>)
  expect(screen.queryByText('Woher bekomme ich den Vergleichswert ohne Ablesedienst?')).toBeNull()
  expect(screen.queryByText(/normiert oder durch Vergleichstests ermittelt/)).toBeNull()
  expect(screen.getAllByText(/Heizkostenverteilern oder für das Warmwasser allein rechnet Mietfuchs den Vergleich mit einem Durchschnittsnutzer \(Nr\. 4\) nicht/).length).toBeGreaterThan(0)
})
test('Wärme nach § 11 ausgenommen: ebenso kein Weg', () => {
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={{ ...view, capture: 'heatMeter', rules: { ...view.rules, exemptionScope: 'heat' } }} onChanged={() => {}} /></OpenFormScope>)
  expect(screen.queryByText('Woher bekomme ich den Vergleichswert ohne Ablesedienst?')).toBeNull()
})
// Durchsicht S1: Der Wert erfüllt nur Nr. 4; Nr. 5 bleibt im ersten Jahr meist offen.
test('der Weg sagt, dass der Vergleichswert nur Nr. 4 erfüllt und Nr. 5 im ersten Jahr offen bleibt', () => {
  render(<OpenFormScope><HeatingInfoCard plant={PLANT} view={{ ...view, capture: 'heatMeter' }} onChanged={() => {}} /></OpenFormScope>)
  const way = screen.getByText('Woher bekomme ich den Vergleichswert ohne Ablesedienst?').closest('details') as HTMLDetailsElement
  expect(way.textContent).toMatch(/nur den Vergleich nach Nr\. 4/)
  expect(way.textContent).toMatch(/Nr\. 5/)
  expect(way.textContent).toMatch(/früheren Messdienstes/)
})
