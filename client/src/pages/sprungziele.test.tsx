// @vitest-environment jsdom
// Sprungziele (#554): Ein Knopf in Leerzustand, Checkliste oder Hinweis führt an die Stelle, nicht nur auf die Seite.
// „Anlegen“ öffnet auf der Zielseite dasselbe Formular wie ihr eigener Knopf, mit dem Fokus im ersten Feld; „Prüfen“
// und „Beheben“ holen die betroffene Karte ins Bild, heben sie hervor (`.focus-target`) und setzen den Fokus auf ihre
// Überschrift oder das Feld. Danach meldet die Seite das Ziel als erledigt, damit ein späterer Besuch nichts aufklappt.
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CostItem, Meter, Property, Settings, Settlement, Tenancy, Unit, UpdateStatus } from '../types'
import type { JumpTarget } from '../focus'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import Cockpit from './Cockpit'
import Einstellungen from './Einstellungen'
import Kosten from './Kosten'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const PROPERTY: Property = { id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }
const UNITS: Unit[] = [
  { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 80, participates: true },
  { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 60, participates: true },
]
const TENANCIES: Tenancy[] = [
  { id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] },
]
const COSTS: CostItem[] = [
  { id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer A', amountCents: 50000, key: 'area' },
]
const METERS: Meter[] = []
const SETTLEMENT: Settlement = {
  year: YEAR, daysInYear: 365, period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0, totalCostsCents: 50000,
  warnings: ['Grundsteuer A: Schlüssel prüfen'], notices: [{ code: 'x', level: 'warning', title: 'Schlüssel prüfen', text: 'Grundsteuer A: Schlüssel prüfen', subject: { kind: 'costItem', id: 'k1' } }],
  closed: null,
}
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const STATUS: UpdateStatus = { enabled: false, current: '0.15.0', mode: 'npm', desktopOffer: null, latest: null, available: false, releaseUrl: null, downloadUrl: null, checkedAt: null, error: null }

let settlement: Settlement = SETTLEMENT
beforeEach(() => {
  settlement = SETTLEMENT
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    const responses: Record<string, unknown> = {
      '/api/properties': [PROPERTY],
      '/api/costItems': COSTS,
      '/api/meters': METERS,
      '/api/tenancies': TENANCIES,
      [`/api/settlement/${YEAR}`]: settlement,
    }
    return json(responses[path] ?? [])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (node: ReactNode) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>{node}</UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

const stammdaten = (focus: JumpTarget, done: () => void = () => {}) =>
  wrap(<Stammdaten units={UNITS} tenancies={TENANCIES} settings={null} reload={async () => {}} focus={focus} onFocusDone={done} />)

// Die Karte mit dieser Überschrift; sie ist hervorgehoben, und ihre Überschrift hat den Fokus.
async function expectSectionFocused(heading: string) {
  const h = await screen.findByRole('heading', { name: heading }, SLOW)
  const card = h.closest('.card')
  await waitFor(() => expect(card?.classList.contains('focus-target')).toBe(true))
  await waitFor(() => expect(document.activeElement).toBe(h))
}

// Das Seitenfenster mit diesem Titel ist offen, und der Fokus steht in seinem ersten Feld.
async function expectFormFocused(title: string) {
  const dialog = (await screen.findByText(title, {}, SLOW)).closest('dialog') ?? assert.fail(`Fenster „${title}“ fehlt`)
  const first = dialog.querySelector('input, select, textarea') ?? assert.fail('Feld fehlt')
  await waitFor(() => expect(document.activeElement).toBe(first))
}

// ---------- Stammdaten ----------

test('Stammdaten: „Wohnung anlegen“ öffnet das Formular „Neue Wohnung“ mit dem Fokus im ersten Feld', async () => {
  const done = vi.fn()
  stammdaten({ kind: 'new', what: 'unit' }, done)
  await expectFormFocused('Neue Wohnung')
  expect(done).toHaveBeenCalled()
})

test('Stammdaten: „Mietverhältnis anlegen“ öffnet das Formular „Neues Mietverhältnis“ mit dem Fokus im ersten Feld', async () => {
  const done = vi.fn()
  stammdaten({ kind: 'new', what: 'tenancy' }, done)
  await expectFormFocused('Neues Mietverhältnis')
  expect(done).toHaveBeenCalled()
})

test('Stammdaten: der Sprung zur Karte „Wohnungen“ hebt sie hervor und setzt den Fokus auf ihre Überschrift', async () => {
  const done = vi.fn()
  stammdaten({ kind: 'section', section: 'units' }, done)
  await expectSectionFocused('Wohnungen')
  expect(done).toHaveBeenCalled()
  // Nur die eine Karte
  expect(document.querySelectorAll('.focus-target').length).toBe(1)
})

test('Stammdaten: der Sprung zur Karte „Mietverhältnisse“ hebt sie hervor und setzt den Fokus auf ihre Überschrift', async () => {
  stammdaten({ kind: 'section', section: 'tenancies' })
  await expectSectionFocused('Mietverhältnisse')
})

test('Stammdaten: „Hier eintragen“ der Steuer öffnet das Objekt mit „Für die Steuer“ und dem Fokus im Aktenzeichen', async () => {
  const done = vi.fn()
  stammdaten({ kind: 'property', part: 'tax' }, done)
  const dialog = (await screen.findByText('Objekt bearbeiten', {}, SLOW)).closest('dialog') ?? assert.fail('Fenster fehlt')
  const details = [...dialog.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Für die Steuer (Anlage V)')
  expect(details?.open).toBe(true)
  const field = within(dialog).getByLabelText(/Aktenzeichen/)
  await waitFor(() => expect(document.activeElement).toBe(field))
  expect(done).toHaveBeenCalled()
})

test('Stammdaten: „Hier beheben“ am Vermieter öffnet das Objekt mit „Abweichender Vermieter“ und dem Fokus darin', async () => {
  stammdaten({ kind: 'property', part: 'landlord' })
  const dialog = (await screen.findByText('Objekt bearbeiten', {}, SLOW)).closest('dialog') ?? assert.fail('Fenster fehlt')
  const details = [...dialog.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent === 'Abweichender Vermieter oder Bankverbindung')
  expect(details?.open).toBe(true)
  // Ohne eigenen Vermieter steht der Fokus auf dem Haken, der die Felder zeigt
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('checkbox', { name: 'Für dieses Objekt abweichend' })))
})

// ---------- Einstellungen ----------

for (const [section, heading] of [['landlord', 'Vermieter & Zahlung'], ['ai', 'KI-Belegauswertung'], ['about', 'Über Mietfuchs']] as const) {
  test(`Einstellungen: der Sprung zu „${heading}“ hebt die Karte hervor und setzt den Fokus auf ihre Überschrift`, async () => {
    const done = vi.fn()
    render(
      <PropertyProvider>
        <UIProvider><Einstellungen settings={SETTINGS} reload={async () => {}} update={{ status: STATUS, checking: false, checkNow: async () => {} }} focus={{ kind: 'section', section }} onFocusDone={done} /></UIProvider>
      </PropertyProvider>,
    )
    await expectSectionFocused(heading)
    expect(done).toHaveBeenCalled()
  })
}

// ---------- Abrechnung ----------

test('Abrechnung: der Sprung zu „Zu prüfen“ hebt die Karte hervor und setzt den Fokus auf ihre Überschrift', async () => {
  const done = vi.fn()
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} focus={{ kind: 'section', section: 'checks' }} onFocusDone={done} />)
  await expectSectionFocused('Zu prüfen')
  expect(done).toHaveBeenCalled()
})

test('Abrechnung: „Versanddatum eintragen“ setzt den Fokus in das Feld „versendet am“', async () => {
  settlement = { ...SETTLEMENT, closed: { closedAt: `${YEAR + 1}-01-15T10:00:00Z`, sentAt: null } }
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={TENANCIES} reload={async () => {}} focus={{ kind: 'section', section: 'sentAt' }} onFocusDone={() => {}} />)
  const field = await screen.findByLabelText(/versendet am/, {}, SLOW)
  await waitFor(() => expect(document.activeElement).toBe(field))
  expect(field.closest('.card')?.classList.contains('focus-target')).toBe(true)
})

test('Abrechnung: „Mietverhältnis anlegen“ bei Kosten ohne Mietverhältnis öffnet in den Stammdaten das Formular', async () => {
  settlement = { ...SETTLEMENT, notices: [], warnings: [] }
  const navigate = vi.fn()
  wrap(<Abrechnung settings={null} units={UNITS} tenancies={[]} reload={async () => {}} onNavigate={navigate} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Mietverhältnis anlegen' }, SLOW))
  expect(navigate).toHaveBeenCalledWith('stammdaten', { kind: 'new', what: 'tenancy' })
})

// ---------- Kosten ----------

test('Kosten: „Kosten erfassen“ öffnet das Formular „Neue Kostenposition“ mit dem Fokus im ersten Feld', async () => {
  const done = vi.fn()
  wrap(<Kosten units={UNITS} settings={null} tenancies={TENANCIES} focus={{ kind: 'new', what: 'costItem' }} onFocusDone={done} />)
  await expectFormFocused('Neue Kostenposition')
  expect(done).toHaveBeenCalled()
})

// ---------- Cockpit ----------

test('Cockpit: „Hinweise der Berechnung“ führt zu „Zu prüfen“ in der Abrechnung', async () => {
  const navigate = vi.fn()
  wrap(<Cockpit units={UNITS} tenancies={TENANCIES} settings={null} updateStatus={null} reload={async () => {}} onNavigate={navigate} />)
  const row = (await screen.findByText('Hinweise der Berechnung', {}, SLOW)).closest('.check-row') ?? assert.fail('Zeile fehlt')
  fireEvent.click(row)
  expect(navigate).toHaveBeenCalledWith('abrechnung', { kind: 'section', section: 'checks' })
})
