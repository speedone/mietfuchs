// @vitest-environment jsdom
// Eine Wohnung in ein anderes Objekt verschieben (#180): das Feld „Objekt“ in den Stammdaten, die Rückfrage und die
// Ablehnung des Servers. Der angezeigte Wert des Auswahlfelds muss dem gespeicherten entsprechen (client/CLAUDE.md, Tests).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Property, Tenancy, Unit } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Stammdaten from './Stammdaten'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const property = (id: string, name: string): Property => ({ id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null } as Property)
const TWO = [property('objekt-1', 'Rosenstraße 1'), property('objekt-2', 'Gartenweg 3')]
const unit = (id: string, name: string, patch: Partial<Unit> = {}): Unit => ({ id, propertyId: 'objekt-1', name, areaM2: 50, participates: true, ...patch })
const TENANCY: Tenancy = { id: 't1', unitId: 'eg', tenantName: 'Schulz', persons: 1, personHistory: [], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }

let properties: Property[] = TWO
let refusal: string | null = null
let sent: { url: string; method: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  properties = TWO
  refusal = null
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, method: init?.method ?? '', body: JSON.parse(String(init?.body ?? '{}')) })
      return refusal === null ? json({ ok: true }) : json({ error: refusal }, 400)
    }
    if (path === '/api/properties') return json(properties)
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (units: Unit[], tenancies: Tenancy[] = []) =>
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
const objectSelect = (dialog: HTMLElement) => within(dialog).getByLabelText(/^Objekt/) as HTMLSelectElement

test('ein einziges Objekt: kein Feld „Objekt“, und der Rumpf bleibt beim Objekt der Wohnung', async () => {
  properties = [TWO[0] as Property]
  page([unit('eg', 'EG')])
  const dialog = await edit('eg')
  expect(within(dialog).queryByLabelText(/^Objekt/)).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).not.toHaveProperty('propertyId')
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('ohne Wechsel nennt der Rumpf kein Objekt, auch mit zwei Objekten (Durchsicht: veralteter Stand verschöbe zurück)', async () => {
  page([unit('eg', 'EG')])
  const dialog = await edit('eg')
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'EG links' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ name: 'EG links' })
  expect(sent[0]?.body).not.toHaveProperty('propertyId')
})

test('ein anderes Objekt nimmt die Wahl „Liegt als Zimmer in der Wohnung“ zurück, denn sie gehört zum bisherigen', async () => {
  page([unit('eg', 'EG'), unit('wg', 'WG')])
  const dialog = await edit('eg')
  fireEvent.change(within(dialog).getByLabelText(/Liegt als Zimmer in der Wohnung/), { target: { value: 'wg' } })
  fireEvent.change(objectSelect(dialog), { target: { value: 'objekt-2' } })
  expect(within(dialog).queryByLabelText(/Liegt als Zimmer in der Wohnung/)).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', undefined, SLOW)).getByRole('button', { name: 'Verschieben' }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]?.body).toMatchObject({ propertyId: 'objekt-2', parentUnitId: null })
})

test('eine neue Wohnung hat kein Feld „Objekt“', async () => {
  page([unit('eg', 'EG')])
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung anlegen/ }, SLOW))
  const dialog = await screen.findByRole('dialog', undefined, SLOW)
  expect(within(dialog).queryByLabelText(/^Objekt/)).toBeNull()
})

test('zwei Objekte: das Feld zeigt das gespeicherte Objekt; der Wechsel fragt, nennt was mitwandert, und schickt das gewählte', async () => {
  page([unit('eg', 'EG'), unit('og', 'OG')], [TENANCY])
  const dialog = await edit('eg')
  const select = objectSelect(dialog)
  expect(select.value).toBe('objekt-1')
  expect(select.selectedOptions[0]?.textContent).toBe('Rosenstraße 1')
  expect([...select.options].map((o) => o.value)).toEqual(['objekt-1', 'objekt-2'])
  fireEvent.change(select, { target: { value: 'objekt-2' } })
  expect(objectSelect(dialog).selectedOptions[0]?.textContent).toBe('Gartenweg 3')

  // Abbrechen in der Rückfrage: nichts geht hinaus, das Fenster bleibt mit der Wahl offen.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  const ask = await screen.findByRole('alertdialog', undefined, SLOW)
  expect(within(ask).getByText('Wohnung „EG“ nach „Gartenweg 3“ verschieben?')).toBeTruthy()
  expect(within(ask).getByText(/ihr Mietverhältnis samt Zahlungen/)).toBeTruthy()
  fireEvent.click(within(ask).getByRole('button', { name: 'Abbrechen' }))
  await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await vi.waitFor(() => expect((within(dialog).getByRole('button', { name: /^Speichern$/ }) as HTMLButtonElement).disabled).toBe(false))
  expect(sent).toHaveLength(0)
  expect(objectSelect(dialog).value).toBe('objekt-2')

  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', undefined, SLOW)).getByRole('button', { name: 'Verschieben' }))
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ url: '/api/units/eg?property=objekt-1', method: 'PUT', body: { propertyId: 'objekt-2' } })
  expect(await screen.findByText(/steht jetzt im Objekt „Gartenweg 3“/, undefined, SLOW)).toBeTruthy()
})

test('lehnt der Server ab, steht seine Begründung im Fenster, und es bleibt offen', async () => {
  refusal = 'Die Wohnung „EG“ steht in der abgeschlossenen Abrechnung 2024 des bisherigen Objekts und kann deshalb nicht in ein anderes Objekt wechseln.'
  page([unit('eg', 'EG')])
  const dialog = await edit('eg')
  fireEvent.change(objectSelect(dialog), { target: { value: 'objekt-2' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Speichern$/ }))
  fireEvent.click(within(await screen.findByRole('alertdialog', undefined, SLOW)).getByRole('button', { name: 'Verschieben' }))
  expect(await within(dialog).findByText(/abgeschlossenen Abrechnung 2024 des bisherigen Objekts/, undefined, SLOW)).toBeTruthy()
  expect(screen.getByRole('dialog')).toBe(dialog)
})

test('ein Zimmer kann das Objekt nicht wechseln: das Feld ist gesperrt und sagt warum', async () => {
  page([unit('wg', 'WG'), unit('z1', 'Zimmer 1', { parentUnitId: 'wg' })])
  const dialog = await edit('z1')
  const select = objectSelect(dialog)
  expect(select.disabled).toBe(true)
  expect(select.value).toBe('objekt-1')
  expect(within(dialog).getByText(/Ein Zimmer bleibt im Objekt seiner Wohnung/)).toBeTruthy()
})
