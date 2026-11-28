// @vitest-environment jsdom
// Aufbau der Seite „Heizkosten“ (#690 Punkt 6): Bei eigener Abrechnung steht je Heizperiode „Was fehlt noch“ oben, das
// Nötige vor dem Seltenen, und der Untertitel passt zur Art der Abrechnung. Beim Messdienst und bei freien Schlüsseln
// bleibt die Seite, wie sie war.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { noInfoView } from '../testing/heatingView'
import { periodKey } from '../../../shared/period.ts'
import type { HeatingPeriodView, HeatingPlant } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Heizkosten from './Heizkosten'

const PLANT = {
  id: 'hp1', propertyId: 'objekt-1', name: '', energy: 'gas', supply: 'central', method: 'manual', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
}
const periodView: HeatingPeriodView = {
  plantId: 'hp1', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null },
  hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2: null, stock: null, items: [],
}

function serve(method: HeatingPlant['method'], supply: HeatingPlant['supply'] = 'central') {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? ''
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([{ ...PLANT, method, supply }])
    if (path === '/api/heating-plants/hp1/periods') return json([method === 'self' ? { ...periodView, capture: 'heatMeter', selfHotWater: 'none', distribution: null } : periodView])
    if (path.startsWith('/api/settlement/')) return json({ heating: [] })
    return json([])
  })
  render(<PeriodProvider><PropertyProvider><UIProvider><Heizkosten units={[]} tenancies={[]} /></UIProvider></PropertyProvider></PeriodProvider>)
}
// Die Überschriften der Seite in der Reihenfolge des Dokuments
const headings = () => [...document.querySelectorAll('h2, h3')].map((h) => h.textContent ?? '')
const at = (list: string[], part: string) => {
  const i = list.findIndex((t) => t.includes(part))
  if (i < 0) throw new Error(`Überschrift „${part}“ fehlt in: ${list.join(' | ')}`)
  return i
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('eigene Abrechnung: Untertitel nennt die eigene Abrechnung, „Was fehlt noch“ steht vor den Karten der Heizperiode', async () => {
  serve('self')
  await screen.findByRole('heading', { name: 'Was fehlt noch' }, { timeout: 5000 })
  expect(screen.getByText(/Ihre eigene Heizkostenabrechnung/)).toBeTruthy()
  expect(screen.queryByText(/Angaben aus der Heizkostenabrechnung/)).toBeNull()
  const list = headings()
  expect(at(list, 'Was fehlt noch')).toBeGreaterThan(at(list, 'Heizperiode 2025'))
  expect(at(list, 'Was fehlt noch')).toBeLessThan(at(list, 'Lieferungen'))
  // Ohne Kosten und ohne Anteil nennt die Liste beides als offen.
  expect(screen.getByText('Kosten der Heizung erfasst')).toBeTruthy()
  expect(screen.getByText(/Noch kein Anteil nach Verbrauch festgelegt/)).toBeTruthy()
})

test('eigene Abrechnung: Nötiges vor Seltenem', async () => {
  serve('self')
  await screen.findByRole('heading', { name: 'Was fehlt noch' }, { timeout: 5000 })
  const list = headings()
  // Die Angaben der Anlage, die selten gebraucht werden, stehen nicht mehr vor allem Nötigen.
  expect(at(list, 'Betriebsstrom der Heizung')).toBeGreaterThan(at(list, 'Anteil nach Verbrauch'))
  expect(at(list, 'Heizung nach § 43 GModG')).toBeGreaterThan(at(list, 'Angaben zur Abrechnung (§ 6a)'))
  // In der Heizperiode: die Pflichtangaben vor den Ausnahmen.
  expect(at(list, 'Angaben zur Abrechnung (§ 6a)')).toBeLessThan(at(list, 'Ausnahmen und Vereinbarungen'))
  // Die seltenen Angaben der Anlage haben eine eigene Überschrift.
  expect(at(list, 'Seltener gebraucht')).toBeLessThan(at(list, 'Betriebsstrom der Heizung'))
})

// Durchsicht: Die Liste folgt den Hinweisen der Abrechnung, ihre Knöpfe springen an die Stelle, und die Karten unter
// „Seltener gebraucht“ stehen eine Ebene unter dieser Überschrift.
test('eigene Abrechnung: Hinweise der Abrechnung färben die Liste, der Knopf springt ins Formular einer neuen Position', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? ''
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/heating-plants') return json([{ ...PLANT, method: 'self' }])
    if (path === '/api/heating-plants/hp1/periods') return json([{ ...periodView, capture: 'heatMeter', selfHotWater: 'none', distribution: null }])
    if (path.startsWith('/api/settlement/')) return json({ heating: [], notices: [
      { code: 'heating.self-incomplete', level: 'error', title: 'Heizkostenabrechnung unvollständig', text: 'Heizanlage, Heizperiode 2025: Es fehlen Stände.', subject: { kind: 'heatingCosts', id: 'hp1' } },
      { code: 'heating.remote-reading-missing', level: 'warning', title: 'Geräte der Heizung nicht fernablesbar', text: 'Heizanlage: nicht fernablesbar.', subject: { kind: 'heatingPlant', id: 'hp1' } },
    ] })
    return json([])
  })
  const navigate = vi.fn()
  render(<PeriodProvider><PropertyProvider><UIProvider><Heizkosten units={[]} tenancies={[]} onNavigate={navigate} /></UIProvider></PropertyProvider></PeriodProvider>)
  await screen.findByRole('heading', { name: 'Was fehlt noch' }, { timeout: 5000 })
  expect(screen.getByText('Ablesungen vollständig')).toBeTruthy()
  expect(screen.getAllByText(/Die Abrechnung meldet/).length).toBeGreaterThan(0)
  expect(screen.getByText(/Dazu meldet die Abrechnung einen weiteren Hinweis zur Heizung/)).toBeTruthy()
  expect(screen.queryByText(/Punkte sind erledigt/)).toBeNull()
  screen.getByRole('button', { name: /Zur Seite Kosten/ }).click()
  expect(navigate).toHaveBeenCalledWith('kosten', { kind: 'new', what: 'costItem' })
  const rare = [...document.querySelectorAll('h2')].find((h) => h.textContent?.includes('Seltener gebraucht'))
  expect(rare).toBeTruthy()
  expect([...document.querySelectorAll('h3')].some((h) => h.textContent?.includes('Betriebsstrom der Heizung'))).toBe(true)
  expect([...document.querySelectorAll('h3')].some((h) => h.textContent?.includes('Heizung nach § 43 GModG'))).toBe(true)
})

test('freie Schlüssel: die Seite bleibt, wie sie war (Angaben der Anlage oben, keine Liste)', async () => {
  serve('manual')
  await screen.findByRole('heading', { name: /Ausnahmen und Vereinbarungen/ }, { timeout: 5000 })
  const list = headings()
  expect(at(list, 'Betriebsstrom der Heizung')).toBeLessThan(at(list, 'Heizperiode 2025'))
  expect(at(list, 'Heizung nach § 43 GModG')).toBeLessThan(at(list, 'Heizperiode 2025'))
  expect(at(list, 'Ausnahmen und Vereinbarungen')).toBeLessThan(at(list, 'Angaben zur Abrechnung (§ 6a)'))
  expect(list.some((t) => t.includes('Was fehlt noch') || t.includes('Seltener gebraucht'))).toBe(false)
  expect(screen.queryByText(/Angaben aus der Heizkostenabrechnung/)).toBeNull()
})

test('Messdienst: Untertitel und Reihenfolge wie bisher, keine Liste', async () => {
  serve('service')
  await screen.findByRole('heading', { name: /Ausnahmen und Vereinbarungen/ }, { timeout: 5000 })
  expect(screen.getByText('Je Heizperiode die Angaben aus der Heizkostenabrechnung: CO₂-Kosten, Warmwasser und Lieferungen.')).toBeTruthy()
  const list = headings()
  expect(at(list, 'Heizung nach § 43 GModG')).toBeLessThan(at(list, 'Heizperiode 2025'))
  expect(list.some((t) => t.includes('Was fehlt noch') || t.includes('Seltener gebraucht'))).toBe(false)
})

test('Etagenheizung: keine Liste, Reihenfolge wie bisher, der Untertitel nennt weder Messdienst noch Angaben nach § 6a', async () => {
  serve('manual', 'perUnit')
  await screen.findByRole('heading', { name: /Heizperiode 2025/ }, { timeout: 5000 })
  expect(screen.getByText('Je Heizperiode die Lieferungen und die CO₂-Angaben der Heizungen in den Wohnungen.')).toBeTruthy()
  const list = headings()
  expect(list.some((t) => t.includes('Was fehlt noch') || t.includes('Seltener gebraucht') || t.includes('Angaben zur Abrechnung (§ 6a)'))).toBe(false)
})

test('Durchsicht S2: der Schritt „Anteil nach Verbrauch“ springt zur Karte derselben Heizperiode', async () => {
  serve('self')
  const button = await screen.findByRole('button', { name: /Zur Karte „Anteil nach Verbrauch“/ }, { timeout: 5000 })
  button.click()
  expect(document.activeElement?.textContent ?? '').toMatch(/^Anteil nach Verbrauch/)
})
