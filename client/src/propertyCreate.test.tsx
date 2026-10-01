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
// Hält die Antwort auf das Anlegen zurück, bis der Test sie freigibt (Doppelklick, Strg+S)
let postGate: Promise<void> | null
// Lässt die Liste der Objekte scheitern (Anlegen klappt, Neuladen nicht)
let failPropertyList: boolean

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  properties = [objekt('objekt-1', 'Haus A')]
  units = { 'objekt-1': [{ id: 'u-a', propertyId: 'objekt-1', name: 'Dachgeschoss links', areaM2: 60, participates: true }] }
  sent = []
  postGate = null
  failPropertyList = false
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
        await postGate
        const created = objekt(`objekt-${properties.length + 1}`, String(body.name), body as Partial<Property>)
        properties = [...properties, created]
        units[created.id] = []
        return json(created, 201)
      }
      return json({ ok: true })
    }
    if (path === '/api/properties') return failPropertyList ? json({ error: 'Server nicht erreichbar' }, 500) : json(properties)
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

async function createViaDialog(name: string) {
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: name } })
  fireEvent.click(within(dialog).getByRole('button', { name: `Anlegen und zu „${name}“ wechseln` }))
  return dialog
}

const notice = () => screen.findByRole('region', { name: /Neues Objekt/ })

test('der Dialog erklärt, was ein weiteres Objekt ist, und beschriftet seine Felder', async () => {
  const dialog = await openCreateDialog()
  // Der Dialog trägt seinen Titel als Namen (aria-labelledby).
  expect(screen.getByRole('dialog', { name: 'Weiteres Objekt anlegen' })).toBe(dialog)
  expect(within(dialog).getByText(/bleibt unverändert/)).toBeTruthy()
  const name = within(dialog).getByLabelText(/^Name/) as HTMLInputElement
  expect(name.required).toBe(true)
  expect(name.getAttribute('aria-required')).toBe('true')
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

  const region = await notice()
  expect(region.textContent).toMatch(/„Gartenweg 3“, das noch keine Wohnungen hat/)
  expect(region.textContent).toMatch(/Ihre Daten in „Haus A“ sind unverändert/)
  // Der Fokus steht auf der Überschrift des Hinweises, damit ein Screenreader ihn vorliest.
  await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('heading')))

  // Der Hinweis steht auf jeder Seite, nicht nur in den Stammdaten.
  fireEvent.click(screen.getByRole('button', { name: /Mietkonto/ }))
  expect(await notice()).toBeTruthy()

  fireEvent.click(within(await notice()).getByRole('button', { name: 'Zurück zu „Haus A“' }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /Stammdaten/ }))
  expect((await screen.findAllByText('Dachgeschoss links')).length).toBeGreaterThan(0)
})

test('hatte das vorige Objekt keine Wohnungen, verspricht der Hinweis keine Daten', async () => {
  units['objekt-1'] = []
  await createViaDialog('Gartenweg 3')
  const region = await notice()
  expect(region.textContent).toMatch(/„Haus A“ bleibt, wie es ist/)
  expect(region.textContent).not.toMatch(/Ihre Daten/)
})

test('„Wohnungen anlegen“ führt in die Stammdaten und fehlt dort; „Schließen“ gilt auch nach dem Neuladen', async () => {
  await createViaDialog('Gartenweg 3')
  // In den Stammdaten steht „+ Wohnung hinzufügen“ ohnehin vor Augen.
  expect(within(await notice()).queryByRole('button', { name: /Wohnungen anlegen/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Cockpit/ }))
  fireEvent.click(within(await notice()).getByRole('button', { name: /Wohnungen anlegen/ }))
  expect(await screen.findByRole('button', { name: /Wohnung hinzufügen/ })).toBeTruthy()
  fireEvent.click(within(await notice()).getByRole('button', { name: /Hinweis schließen/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull())
  // Neu geladen bleibt er geschlossen.
  cleanup()
  render(<App />)
  await screen.findByLabelText('Objekt wählen')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('region', { name: /Neues Objekt/ })).toBeNull()
})

test('nach dem Neuladen der Seite nennt der Hinweis weiter das richtige vorige Objekt', async () => {
  properties = [...properties, objekt('objekt-2', 'Haus B')]
  units['objekt-2'] = [{ id: 'u-b', propertyId: 'objekt-2', name: 'EG', areaM2: 50, participates: true }]
  localStorage.setItem('mietfuchs.property', 'objekt-2')
  await createViaDialog('Gartenweg 3')
  expect((await notice()).textContent).toMatch(/„Haus B“/)
  cleanup()
  render(<App />)
  const region = await notice()
  expect(region.textContent).toMatch(/„Haus B“/)
  expect(region.textContent).not.toMatch(/„Haus A“/)
})

test('Doppelklick und Strg+S während des Anlegens legen nur ein Objekt an', async () => {
  let release = () => {}
  postGate = new Promise<void>((resolve) => { release = resolve })
  const dialog = await createViaDialog('Gartenweg 3')
  fireEvent.click(within(dialog).getByRole('button', { name: /Anlegen und zu/ }))
  fireEvent.keyDown(document, { key: 's', ctrlKey: true })
  release()
  await notice()
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1)
})

test('Anlegen klappt, Neuladen scheitert: Meldung im Dialog und kein zweites Objekt', async () => {
  failPropertyList = false
  const dialog = await openCreateDialog()
  fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Gartenweg 3' } })
  failPropertyList = true
  fireEvent.click(within(dialog).getByRole('button', { name: /Anlegen und zu/ }))
  expect(await within(dialog).findByText(/ist angelegt, die Liste der Objekte ließ sich aber nicht laden/)).toBeTruthy()
  // Schließen und wieder öffnen hebt die Sperre nicht auf, solange die Liste fehlt.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Abbrechen$/ }))
  fireEvent.click(screen.getByRole('button', { name: /Weiteres Objekt anlegen/ }))
  const again = screen.getByRole('dialog')
  fireEvent.change(within(again).getByLabelText(/^Name/), { target: { value: 'Gartenweg 3' } })
  const button = within(again).getByRole('button', { name: /Anlegen und zu/ }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  fireEvent.keyDown(document, { key: 's', ctrlKey: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(sent.filter((r) => r.method === 'POST')).toHaveLength(1)
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
