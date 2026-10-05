// @vitest-environment jsdom
// Seite „Heizkosten“ bei einer Anlage, die niemand abrechnet (Review der Laienprobe, Runde 2, Punkt 8):
// Der Rat lässt die Heizposition stehen und bucht den CO₂-Anteil als Gutschrift plus „Nicht umlagefähig“.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import Heizkosten from './Heizkosten'

const PLANT = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0]
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'zfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([PLANT])
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Punkt 8: Heizposition unangetastet, Gutschrift „CO₂-Anteil Vermieter“ und „Nicht umlagefähig“; bei Einzelbeträgen der Abzug je Mieter', async () => {
  render(<PeriodProvider><PropertyProvider><Heizkosten units={[]} tenancies={[]} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByText(/Lassen Sie die\s+Heizposition, wie sie ist/, undefined, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByText(/Gutschrift „CO₂-Anteil Vermieter“ in der Kostenart „Heizung und Warmwasser“/)).toBeTruthy()
  expect(screen.getByText(/mit Einzelbeträgen je Mieter,\s+geht eine Gutschrift nicht/)).toBeTruthy()
  // Review Runde 3 (M1): bei Einzelbeträgen der Abzug je Mieter, ohne Position „Nicht umlagefähig“.
  expect(screen.getByText(/den auf ihn entfallenden CO₂-Anteil des Vermieters vom Einzelbetrag ab/)).toBeTruthy()
  expect(screen.getByText(/eine Position „Nicht umlagefähig“ entfällt dann/)).toBeTruthy()
  expect(screen.queryByText(/mindern Sie die Heizposition/)).toBeNull()
})
