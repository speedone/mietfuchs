// @vitest-environment jsdom
// Stammdaten und das Seitenfenster „Mieterhöhung“ zusammen (#191, Nacharbeit): Was das Fenster an der Kaltmiete-Staffel
// ändert (Zustimmung, Versand einer Indexanpassung, Rücknahme), zeigt danach auch das Formular des Mietverhältnisses.
// Vorher lud die Seite nicht neu: Das Formular zeigte die alte Staffel, und jedes Speichern scheiterte an der Marke (409).
// Dazu der Sprung an das Feld „Art der Miete“, wenn sie fehlt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RentIncreaseBasis, RentIncreasePlan, RentIncreaseView, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'
import { tenancyStamp } from '../../../shared/tenancyStamp.ts'

vi.setConfig({ testTimeout: 30000 })
const SLOW = { timeout: 8000 }

const UNITS: Unit[] = [{ id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true }]
const BEFORE: Tenancy = {
  id: 't1', unitId: 'u1', tenantName: 'Erika Mustermann', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 50000 }], rentKind: 'free', rentIncreaseExcluded: false,
}
// Der Stand des Servers nach der Zustimmung: die neue Stufe steht in der Staffel.
const AFTER: Tenancy = { ...BEFORE, baseRents: [...BEFORE.baseRents, { from: '2027-02', monthlyCents: 60000, reason: 'comparison' }] }

const PLAN: RentIncreasePlan = {
  kind: 'comparison', state: 'possible', reasons: [], warnings: [], needs: [], currentCents: 50000, currentSince: '2020-01-01',
  receivedOn: '2026-11-20', today: '2026-11-20', capBaseDay: null, earliestReceivedOn: '2026-11-20', effectiveFrom: '2027-02', earliestEffectiveFrom: '2027-02',
  consent: { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' }, cap: null,
  comparison: { centsPerM2: 1000, areaM2: 60, rentCents: 60000, operatingCostsCents: null, limitCents: 60000 }, index: null, maxCents: 60000, newCents: 60000,
  steps: [], staggered: null, legalValues: [], refusals: [],
}
const BASIS: RentIncreaseBasis = {
  version: 1, letterDate: '2026-11-20', request: { kind: 'comparison' }, plan: PLAN,
  letter: { justification: 'expert', survey: null, expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, database: null, comparables: [], qualifiedSurvey: 'no', qualified: null, recipientName: 'Erika Mustermann', severalLandlords: false, allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '' },
  rentCap: { answer: 'yes', answeredOn: '2026-11-20' },
  sender: { name: 'Max Vermieter', address: '', contact: '', returnLine: 'Max Vermieter', footer: '' },
  recipient: ['Erika Mustermann'], salutation: 'Guten Tag Erika Mustermann,',
  premises: { propertyName: 'A', address: '', unitName: 'EG', areaM2: 60 }, inclusive: false,
  prepayments: { operatingCents: 0, heatingCents: 0, flatRateCents: 0 }, sentPlan: null,
}
const SENT: RentIncreaseView = {
  id: 'r1', tenancyId: 't1', kind: 'comparison', createdOn: '2026-11-20', receivedOn: '2026-11-20', effectiveFrom: '2027-02', fromCents: 50000, toCents: 60000,
  basis: BASIS, status: 'sent', agreedCents: null, decidedOn: null, token: 'marke-r1',
}

let sent: { url: string; method: string; body: Record<string, unknown> }[] = []
let increases: RentIncreaseView[] = []

beforeEach(() => {
  sent = []
  increases = [SENT]
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const method = init?.method ?? 'GET'
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path.endsWith('/rent-increase/plan')) return json({ ...PLAN, token: 'marke-plan' })
    if (method !== 'GET') {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) })
      // Die Zustimmung schreibt die Stufe; die Liste nennt danach den neuen Stand.
      if (path === '/api/rent-increases/r1/status') increases = [{ ...SENT, status: 'agreed', decidedOn: '2026-11-20', token: 'marke-r1b' }]
      return json({ ok: true })
    }
    if (path === '/api/tenancies/t1/rent-increases') return json(increases)
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Die Seite mit dem Bestand der App: `reload` holt den Stand des Servers, wie in App.tsx.
function Page({ first, server, reloaded }: { first: Tenancy; server: () => Tenancy; reloaded: () => void }) {
  const [tenancies, setTenancies] = useState([first])
  return (
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={UNITS} tenancies={tenancies} settings={null} reload={async () => { reloaded(); setTenancies([server()]) }} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>
  )
}

test('Mieterhöhung: nach der Zustimmung zeigt das Mietverhältnis die neue Stufe und speichert mit der Marke des neuen Stands', async () => {
  const reloaded = vi.fn()
  let server = BEFORE
  render(<Page first={BEFORE} server={() => server} reloaded={reloaded} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Mieterhöhung' }, SLOW))
  const drawer = await screen.findByRole('dialog', undefined, SLOW)
  fireEvent.click(await within(drawer).findByRole('button', { name: 'Zugestimmt …' }, SLOW))
  // Der Server trägt mit der Zustimmung die Stufe ein.
  server = AFTER
  fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }, SLOW))
  await vi.waitFor(() => expect(sent.some((x) => x.url === '/api/rent-increases/r1/status')).toBe(true), SLOW)
  await vi.waitFor(() => expect(reloaded).toHaveBeenCalled(), SLOW)
  // Schließen ohne Rückfrage: Im Fenster ist nichts Ungespeichertes.
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Schließen' })[0] ?? drawer)
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mietverhältnis bearbeiten' }))
  const form = await screen.findByRole('dialog', undefined, SLOW)
  expect(within(form).getByDisplayValue('600,00')).toBeTruthy()
  fireEvent.click(within(form).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(sent.some((x) => x.method === 'PUT' && x.url.startsWith('/api/tenancies/t1'))).toBe(true), SLOW)
  expect(sent.find((x) => x.method === 'PUT' && x.url.startsWith('/api/tenancies/t1'))?.body).toMatchObject({ ifUnchanged: tenancyStamp(AFTER) })
})

test('Mieterhöhung: fehlt die Art der Miete, öffnet „Hier beheben“ das Mietverhältnis am Feld „Art der Miete“', async () => {
  increases = []
  const { rentKind: _none, ...noKind } = BEFORE
  render(<Page first={noKind} server={() => noKind} reloaded={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Mieterhöhung' }, SLOW))
  const drawer = await screen.findByRole('dialog', undefined, SLOW)
  fireEvent.click(within(drawer).getByRole('button', { name: 'Hier beheben → Mietverhältnis' }))
  const heading = await screen.findByRole('heading', { name: 'Mietverhältnis bearbeiten' }, SLOW)
  const form = heading.closest('dialog') ?? document.body
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  const field = within(form).getByRole('combobox', { name: 'Art der Miete' })
  expect(document.activeElement).toBe(field)
  // Ein gewöhnliches Öffnen danach beginnt wieder im ersten Feld.
  fireEvent.click(within(form).getByRole('button', { name: 'Abbrechen' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW)
  fireEvent.click(screen.getByRole('button', { name: 'Mietverhältnis bearbeiten' }))
  const again = await screen.findByRole('dialog', undefined, SLOW)
  expect(document.activeElement).not.toBe(within(again).getByRole('combobox', { name: 'Art der Miete' }))
})
