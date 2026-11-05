// @vitest-environment jsdom
// Zimmer einer Wohnung (#573) in den Stammdaten: Liste, Feld „Liegt als Zimmer in der Wohnung“ und die Löschfrage.
// Der angezeigte Wert des Auswahlfelds muss dem gespeicherten entsprechen (client/CLAUDE.md, Tests).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Meter, Tenancy, Unit, UnitDependents } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const unit = (id: string, name: string, patch: Partial<Unit> = {}): Unit => ({ id, propertyId: 'objekt-1', name, areaM2: 20, participates: true, ...patch })
const UNITS: Unit[] = [
  unit('wg', 'WG', { areaM2: 90 }),
  unit('eg', 'EG', { areaM2: 80 }),
  unit('z1', 'Zimmer 1', { parentUnitId: 'wg' }),
  unit('z2', 'Zimmer 2', { parentUnitId: 'wg' }),
]
const DEPS: UnitDependents = { tenancies: 0, meters: 0, readings: 0, payments: 0, costItemLinks: 0, directCostItems: 0, fuelDeliveries: 0, rooms: 2 }
let meters: Meter[] = []
let sent: { url: string; method: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  meters = []
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, method: init?.method ?? '', body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ ok: true })
    }
    if (path === '/api/meters') return json(meters)
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === '/api/units/wg/dependents') return json(DEPS)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (units: Unit[] = UNITS, tenancies: Tenancy[] = []) =>
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider>
          <Stammdaten units={units} tenancies={tenancies} settings={null} reload={async () => {}} />
        </UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )

const edit = async (id: string) => {
  const button = await vi.waitFor(() => {
    const el = document.querySelector(`[data-unit-edit="${id}"]`)
    if (!el) throw new Error('kein Bearbeiten-Knopf')
    return el
  }, SLOW)
  fireEvent.click(button)
  return screen.findByRole('dialog', undefined, SLOW)
}

test('Liste: die Zimmer stehen eingerückt unter ihrer Wohnung, die Wohnung nennt „2 Zimmer“ statt „beteiligt“', async () => {
  page()
  await screen.findByText('Zimmer 1', undefined, SLOW)
  const names = [...document.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent ?? '')
  const order = ['WG', 'Zimmer 1', 'Zimmer 2', 'EG'].map((n) => names.findIndex((t) => t.includes(n)))
  // WG vor ihren Zimmern, danach erst die übrigen: die Zimmer folgen unmittelbar der Wohnung.
  expect(order).toEqual([0, 1, 2, 3])
  const flatRow = screen.getAllByText(/^WG/)[0]?.closest('tr')
  expect(flatRow && within(flatRow).getByText('2 Zimmer')).toBeTruthy()
  expect(flatRow && within(flatRow).queryByText('beteiligt')).toBeNull()
  const roomCell = screen.getByText(/Zimmer 1/).closest('td')
  expect(roomCell?.className).toMatch(/pl-6/)
})

test('Zimmer bearbeiten: das Feld zeigt die gespeicherte Wohnung, Optionen nur Wohnungen ohne Verweis und ohne Mietverhältnis', async () => {
  page()
  const dialog = await edit('z1')
  const select = within(dialog).getByLabelText(/Liegt als Zimmer in der Wohnung/) as HTMLSelectElement
  expect(select.value).toBe('wg')
  // EG darf Wohnung sein; z2 liegt selbst in einer Wohnung; z1 ist die Einheit selbst.
  expect([...select.options].map((o) => o.value)).toEqual(['', 'wg', 'eg'])
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ parentUnitId: 'wg' })
})

test('eine Wohnung mit einem Mietverhältnis steht nicht zur Wahl', async () => {
  const tenancy: Tenancy = {
    id: 't1', unitId: 'eg', tenantName: 'M', persons: 1, personHistory: [], start: '2025-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [],
  }
  const dialog = await (async () => { page(UNITS, [tenancy]); return edit('z1') })()
  const select = within(dialog).getByLabelText(/Liegt als Zimmer in der Wohnung/) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['', 'wg'])
})

test('Wohnung mit Zimmern: Nutzung, Personen und Nutzungswechsel entfallen, ein Satz erklärt es, es gibt kein Feld „in der Wohnung“', async () => {
  page()
  const dialog = await edit('wg')
  expect(within(dialog).queryByLabelText(/^Nutzung/)).toBeNull()
  expect(within(dialog).queryByText(/Nutzungswechsel$/)).toBeNull()
  expect(within(dialog).queryByLabelText(/Personen im eigenen Haushalt/)).toBeNull()
  expect(within(dialog).queryByLabelText(/Liegt als Zimmer in der Wohnung/)).toBeNull()
  expect(within(dialog).getByText(/Die Zimmer werden einzeln vermietet/)).toBeTruthy()
})

test('eine Einheit ohne Zimmer und ohne mögliche Wohnung zeigt das Feld nicht; Nutzung bleibt', async () => {
  page([unit('a', 'Allein')])
  const dialog = await edit('a')
  expect(within(dialog).queryByLabelText(/Liegt als Zimmer in der Wohnung/)).toBeNull()
  expect(within(dialog).getByLabelText(/^Nutzung/)).toBeTruthy()
})

test('Wohnung mit Zimmern löschen: die Oberfläche sagt vorher, dass erst die Zimmer gehen, und fragt nicht „nichts hängt dran“', async () => {
  page()
  const row = (await screen.findAllByText(/^WG/, undefined, SLOW))[0]?.closest('tr')
  if (!row) throw new Error('keine Zeile')
  fireEvent.click(within(row).getByRole('button', { name: /Wohnung löschen/ }))
  const text = await screen.findByText(/In der Wohnung liegen 2 Zimmer/, undefined, SLOW)
  expect(text).toBeTruthy()
  expect(screen.queryByText(/An der Wohnung hängt nichts weiter/)).toBeNull()
  expect(sent).toHaveLength(0)
})

test('Mietverhältnis anlegen: die Wohnung mit Zimmern steht nicht zur Wahl', async () => {
  page()
  fireEvent.click(await screen.findByRole('button', { name: /Mietverhältnis anlegen/ }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  const select = within(dialog).getByLabelText(/^Wohnung/) as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['', 'eg', 'z1', 'z2'])
  expect(select.value).not.toBe('wg')
})
