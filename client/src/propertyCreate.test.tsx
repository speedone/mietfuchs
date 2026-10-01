// @vitest-environment jsdom
// Weiteres Objekt anlegen (#157). Gemeldet hat es ein Vermieter, der nach dem Anlegen alle Seiten
// leer sah und dachte, seine Daten seien überschrieben. Der Wechsel geschah wortlos, und nichts
// sagte, wo er jetzt ist und dass das bisherige Haus unverändert dasteht. Geprüft wird über die
// ganze App: anlegen über den Dialog, Hinweis mit dem Namen des vorigen Objekts, zurück, und der
// Bestand ist wieder sichtbar.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Unit } from './types'
import App from './App'

const objekt = (id: string, name: string, extra: Partial<Property> = {}): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...extra,
})

let properties: Property[]
let units: Record<string, Unit[]>
let sent: { method: string; url: string; body: Record<string, unknown> }[]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  properties = [objekt('objekt-1', 'Haus A')]
  units = { 'objekt-1': [{ id: 'u-a', propertyId: 'objekt-1', name: 'Dachgeschoss links', areaM2: 60, participates: true }] }
  sent = []
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const [path, query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? properties[0]?.id ?? ''
    if (method !== 'GET') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      sent.push({ method, url, body })
      if (path === '/api/properties' && method === 'POST') {
        const created = objekt(`objekt-${properties.length + 1}`, String(body.name), body as Partial<Property>)
        properties = [...properties, created]
        units[created.id] = []
        return json(created, 201)
      }
      return json({ ok: true })
    }
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(units[property] ?? [])
    if (path === '/api/tenancies') return json([])
    if (path === '/api/meters') return json([])
    if (path?.startsWith('/api/rentledger/')) return json({ year: 2025, rows: [], totals: { sollCents: 0, paidCents: 0, openCents: 0 } })
    // Das Cockpit bekommt keine Antwort, wie in propertySwitch.test.tsx.
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.9.0' })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openCreateDialog() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Weiteres Objekt anlegen/ }))
  return screen.getByRole('dialog')
}

test('der Dialog erklärt, was ein weiteres Objekt ist, und beschriftet seine Felder', async () => {
  const dialog = await openCreateDialog()
  expect(within(dialog).getByText(/bleibt unverändert/)).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Name/)).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Art/)).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Adresse/)).toBeTruthy()
  // Ohne Namen wird nichts angelegt, und der Dialog sagt warum.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Anlegen und wechseln$/ }))
  expect(await within(dialog).findByText(/Bitte geben Sie dem neuen Objekt einen Namen/)).toBeTruthy()
  expect(sent).toEqual([])
})

test('anlegen → Wechsel, Hinweis nennt das vorige Objekt, „Zurück zu …“ zeigt den Bestand wieder', async () => {
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Gartenweg 3' } })
  fireEvent.change(within(dialog).getByLabelText(/^Art/), { target: { value: 'etw' } })
  fireEvent.change(within(dialog).getByLabelText(/^Adresse/), { target: { value: 'Gartenweg 3, 12345 Musterstadt' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen und zu „Gartenweg 3“ wechseln' }))

  // Ein Aufruf mit allem, kein halber Zustand aus Anlegen und nachträglichem Ändern.
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ method: 'POST', url: '/api/properties', body: { name: 'Gartenweg 3', kind: 'etw', address: 'Gartenweg 3, 12345 Musterstadt' } })

  // Gewechselt, ohne Rückfrage: Der eigene Dialog zählt dabei nicht als offenes Formular.
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()

  const notice = await screen.findByRole('region', { name: /Neues Objekt/ })
  expect(notice.textContent).toMatch(/„Gartenweg 3“/)
  expect(notice.textContent).toMatch(/Ihre Daten in „Haus A“ sind unverändert/)

  // Der Hinweis steht auf jeder Seite, nicht nur in den Stammdaten.
  fireEvent.click(screen.getByRole('button', { name: /Mietkonto/ }))
  expect(await screen.findByRole('region', { name: /Neues Objekt/ })).toBeTruthy()

  fireEvent.click(within(screen.getByRole('region', { name: /Neues Objekt/ })).getByRole('button', { name: 'Zurück zu „Haus A“' }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Stammdaten/ }))
  expect((await screen.findAllByText('Dachgeschoss links')).length).toBeGreaterThan(0)
})

test('„Wohnungen anlegen“ führt in die Stammdaten, „Schließen“ nimmt den Hinweis weg', async () => {
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Gartenweg 3' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /Anlegen und zu/ }))
  const notice = await screen.findByRole('region', { name: /Neues Objekt/ })
  fireEvent.click(screen.getByRole('button', { name: /Cockpit/ }))
  fireEvent.click(within(notice).getByRole('button', { name: /Wohnungen anlegen/ }))
  expect(await screen.findByRole('button', { name: /Wohnung hinzufügen/ })).toBeTruthy()
  fireEvent.click(within(screen.getByRole('region', { name: /Neues Objekt/ })).getByRole('button', { name: /Hinweis schließen/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
})

test('der Seitenkopf nennt das Objekt ab zwei Objekten, bei einem nicht', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  await screen.findByRole('heading', { name: 'Stammdaten' })
  expect(screen.queryByTestId('page-property')).toBeNull()
  cleanup()

  properties = [...properties, objekt('objekt-2', 'Gartenweg 3')]
  units['objekt-2'] = []
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietkonto/ }))
  expect((await screen.findByTestId('page-property')).textContent).toMatch(/Haus A/)
})
