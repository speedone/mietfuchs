// @vitest-environment jsdom
// Seite „Heizkosten“ bei einer Anlage, die niemand abrechnet (Review der Laienprobe, Runde 2, Punkt 8):
// Der Rat lässt die Heizposition stehen und bucht den CO₂-Anteil als Gutschrift plus „Nicht umlagefähig“.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { noInfoView } from '../testing/heatingView'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView } from '../types'
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

test('Nachprüfung von 47f2373: Bei Fernwärme spricht der Rat von der Fernwärmerechnung, nicht von Gas oder Öl', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0]
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'zfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([{ ...PLANT, energy: 'districtHeating' }])
    return json([])
  })
  render(<PeriodProvider><PropertyProvider><Heizkosten units={[]} tenancies={[]} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByText(/Der CO₂-Ausstoß laut Fernwärmerechnung/, undefined, { timeout: 5000 })).toBeTruthy()
  expect(screen.getByText(/sobald Sie die Fernwärmerechnung unten als Lieferung eintragen/)).toBeTruthy()
  expect(screen.queryByText(/Gas- oder Ölrechnung/)).toBeNull()
})

// #266: Die Karte „Betriebsstrom der Heizung“ steht je Anlage über den Heizperioden, aber nur, wo Mietfuchs danach fragt.
test('Karte „Betriebsstrom der Heizung“: bei der Gasheizung ohne Messdienst, nicht beim Messdienst', async () => {
  render(<PeriodProvider><PropertyProvider><Heizkosten units={[]} tenancies={[]} /></PropertyProvider></PeriodProvider>)
  expect(await screen.findByLabelText('Wie ist der Betriebsstrom dieser Heizung erfasst?', undefined, { timeout: 5000 })).toBeTruthy()
  cleanup()
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? ''
    calls.push(path)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'zfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([{ ...PLANT, method: 'service' }])
    return json([])
  })
  render(<PeriodProvider><PropertyProvider><Heizkosten units={[]} tenancies={[]} /></PropertyProvider></PeriodProvider>)
  // Geladen ist die Seite, wenn die Gradtagzahlen abgefragt sind (der letzte Abruf von `load`).
  await waitFor(() => expect(calls).toContain('/api/properties/objekt-1/degree-days'), { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByLabelText('Wie ist der Betriebsstrom dieser Heizung erfasst?')).toBeNull()
})

// Durchsicht zu #309, SOLLTE 5: Die Karte „Ausnahmen und Vereinbarungen“ hing mit dem Stand ihrer Regeln im
// Schlüssel. Speicherte eine andere Karte und änderten sich dabei die Regeln, war ein Entwurf still weg.
test('ein Entwurf der Ausnahmen übersteht das Speichern einer anderen Karte', async () => {
  let loads = 0
  const periodView = (consumerContract: string | null): HeatingPeriodView => ({
    plantId: 'hp1', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
    ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
    hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null, items: [],
    rules: { ...noInfoView().rules, consumerContract },
  })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') return json({})
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'zfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([PLANT])
    if (path === '/api/heating-plants/hp1/periods') return json([periodView(++loads > 1 ? 'none' : null)])
    return json([])
  })
  render(<PeriodProvider><PropertyProvider><Heizkosten units={[]} tenancies={[]} /></PropertyProvider></PeriodProvider>)
  const monatlich = await screen.findByLabelText(/monatliche Verbrauchsinformation anders/, undefined, { timeout: 5000 }) as HTMLInputElement
  fireEvent.click(monatlich)
  // Eine andere Karte speichert, die Seite lädt neu, die Regeln dieser Heizperiode sind andere.
  fireEvent.change(screen.getByLabelText('Wie ist der Betriebsstrom dieser Heizung erfasst?'), { target: { value: 'deducted' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Betriebsstrom)' }))
  await waitFor(() => expect(loads).toBe(2), { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 50))
  expect((screen.getByLabelText(/monatliche Verbrauchsinformation anders/) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('button', { name: 'Speichern (Ausnahmen 2025)' })).toBeTruthy()
})
