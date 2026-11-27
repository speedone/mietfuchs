// @vitest-environment jsdom
// Navigation und Sprungziele über die ganze App (Systemprüfung): Die Seite „Heizkosten“ erscheint, sobald die Heizung
// eingerichtet ist, ohne Seitenwechsel; „Hier beheben →“ mit Ziel Heizkosten führt zur betroffenen Anlage; und nach
// „Rückgängig“ im Verlauf zeigen die Stammdaten den wiederhergestellten Bestand ohne Neuladen des Browsers.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { HeatingPlant, Property, Settlement, Tenancy, Unit } from './types'
import App from './App'
import { calendarYearPeriod, settlementPeriod } from '../../shared/period.ts'
import type { JournalGroup } from './journalView'
import type { RevertPreview } from './journalRevert'

vi.setConfig({ testTimeout: 30000 })
const SLOW = { timeout: 5000 }
const YEAR = new Date().getFullYear() - 1

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
const EG: Unit = { id: 'eg', propertyId: 'objekt-1', name: 'Erdgeschoss links', areaM2: 80, participates: true }
const OG: Unit = { id: 'og', propertyId: 'objekt-1', name: 'Obergeschoss rechts', areaM2: 70, participates: true }
const TENANCIES: Tenancy[] = [{ id: 't-a', unitId: 'eg', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const plant = (id: string, name: string): HeatingPlant => ({
  id, propertyId: 'objekt-1', name, energy: 'gas', supply: 'central', method: 'service', separateSettlement: null,
  devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', source: 'building', captureInstalledOn: null, capturedOnOct2024: null,
  warmRentAverageCents: null, changeSplit: 'degreeDays', periodStartMonth: null, periodChanges: [], separateSpans: [], units: null, newDevicesInstall: null,
  nonResidential: false, restriction: 'none', districtEtsNew: false, secondPrepaymentCoversWater: false, endsOn: null, replacesPlantId: null, buildingWith: null, takesOverStock: null,
  hotWater: 'combined', capture: null, areaBasisHeat: 'area', heatPumpInstalledOn: null, heatGeneration: null, heatPumpMajority: null, hcaModel: null,
  operatingPowerHandling: null, contracting: false, heatDeliverySince: null, previousSupply: null, switchAnnouncedOn: null, gmodg43InstalledOn: null,
  emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null,
})
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 80000,
  warnings: ['Kessel Hinterhaus: CO₂-Angaben fehlen'],
  notices: [{ code: 'x', level: 'warning', title: 'CO₂-Angaben fehlen', text: 'Kessel Hinterhaus: CO₂-Angaben fehlen', subject: { kind: 'heatingCosts', id: 'hp2' } }],
  closed: null,
}
const GROUP: JournalGroup = {
  id: 9, firstId: 9, at: '2026-10-24T08:15:00.000Z', method: 'DELETE', route: '/api/units/:id', description: 'Wohnung gelöscht: Obergeschoss rechts', title: 'Wohnung gelöscht: Obergeschoss rechts',
  propertyIds: ['objekt-1'], installationWide: false, rows: 1, revertedBy: null, barrier: null, readOnly: false, newest: true,
}
const PREVIEW: RevertPreview = {
  kind: 'journal', mode: 'including', entry: { id: 9, firstId: 9, at: GROUP.at, title: GROUP.title }, startId: 9,
  entries: [{ id: 9, at: GROUP.at, title: GROUP.title, rows: 1, reverted: false }], changes: 1, refusals: [],
  files: { restore: 0, trash: 0 }, notes: [], frozen: [], token: 'marke-1',
}

let units: Unit[]
let plants: HeatingPlant[]
beforeEach(() => {
  units = [EG]
  plants = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    const method = init?.method ?? 'GET'
    if (method === 'POST' && path === '/api/heating-plants') {
      plants = [plant('hp1', '')]
      return json({ plant: plants[0], assigned: 0 }, 201)
    }
    if (method === 'POST' && path === '/api/journal/9/revert') {
      units = [EG, OG]
      return json({ ok: true })
    }
    if (path === '/api/journal/9/revert/preview') return json(PREVIEW)
    if (path === '/api/journal/9') return json({ ...GROUP, changes: [] })
    if (path === '/api/journal') return json([GROUP])
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(units)
    if (path === '/api/tenancies') return json(TENANCIES)
    if (path === '/api/heating-plants') return json(plants)
    if (path === `/api/settlement/${YEAR}`) return json(SETTLEMENT)
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode: 'npm' })
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.findByRole('navigation', { name: 'Hauptnavigation' }, SLOW)
const go = async (name: RegExp) => fireEvent.click(within(await sidebar()).getByRole('button', { name }))

test('Heizung einrichten: „Heizkosten“ steht sofort in der Navigation, und die Mitteilung nennt die Seite', async () => {
  render(<App />)
  await go(/Stammdaten/)
  fireEvent.click(await screen.findByRole('button', { name: 'Heizung einrichten' }, SLOW))
  fireEvent.change(await screen.findByLabelText(/Womit wird geheizt/, undefined, SLOW), { target: { value: 'gas' } })
  fireEvent.change(screen.getByLabelText(/Wer erstellt Ihre Heizkostenabrechnung/), { target: { value: 'service' } })
  expect(within(await sidebar()).queryByRole('button', { name: /Heizkosten/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  // Ohne Seitenwechsel: Die Stammdaten bleiben offen, der Eintrag erscheint.
  await waitFor(async () => expect(within(await sidebar()).getByRole('button', { name: /Heizkosten/ })).toBeTruthy(), SLOW)
  expect(within(await sidebar()).getByRole('button', { name: /Stammdaten/ }).getAttribute('aria-current')).toBe('page')
  expect((await screen.findByText(/Heizung eingerichtet/, undefined, SLOW)).textContent).toMatch(/Seite „Heizkosten“/)
})

test('„Hier beheben → Heizkosten“ führt zur betroffenen Anlage und hebt sie hervor', async () => {
  plants = [plant('hp1', 'Kessel Vorderhaus'), plant('hp2', 'Kessel Hinterhaus')]
  render(<App />)
  await go(/Abrechnung/)
  fireEvent.click(await screen.findByRole('button', { name: /Hier beheben → Heizkosten/ }, SLOW))
  await waitFor(() => expect(document.querySelector('[data-jump="heatingCosts:hp2"]')?.classList.contains('focus-target')).toBe(true), SLOW)
  expect(document.querySelector('[data-jump="heatingCosts:hp1"]')?.classList.contains('focus-target')).toBe(false)
})

test('Verlauf: nach „Rückgängig“ zeigen die Stammdaten die wiederhergestellte Wohnung ohne Neuladen', async () => {
  render(<App />)
  await go(/Verlauf/)
  const details = (await screen.findByText(GROUP.title, undefined, SLOW)).closest('details')
  if (!details) throw new Error('kein Eintrag')
  details.open = true
  fireEvent(details, new Event('toggle'))
  fireEvent.click(await within(details).findByRole('button', { name: 'Rückgängig …' }, SLOW))
  fireEvent.click(within(await screen.findByRole('alertdialog', undefined, SLOW)).getByRole('button', { name: 'Rückgängig machen' }))
  await screen.findByText(/Rückgängig gemacht/, undefined, SLOW)
  await go(/Stammdaten/)
  expect(await screen.findAllByText('Obergeschoss rechts', undefined, SLOW)).not.toHaveLength(0)
})
