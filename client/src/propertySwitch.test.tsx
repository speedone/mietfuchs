// @vitest-environment jsdom
// Objektwechsel bei offenem Dialog (#145). Ein Dialog hält Verweise in das Objekt, in dem er
// geöffnet wurde (das Mietverhältnis einer Zahlung, die Wohnung eines Mietverhältnisses) oder
// legt im gerade gewählten Objekt an. Wechselte man währenddessen das Objekt, landete der
// Eintrag still im falschen Haus. Jetzt fragt der Wechsel nach und schließt offene Formulare;
// wer ablehnt, bleibt im bisherigen Objekt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Tenancy, Unit } from './types'
import App from './App'

const objekt = (id: string, name: string): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null,
})
const PROPERTIES = [objekt('objekt-1', 'Haus A'), objekt('objekt-2', 'Haus B')]

const UNITS: Record<string, Unit[]> = {
  'objekt-1': [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }],
  'objekt-2': [{ id: 'u-b', propertyId: 'objekt-2', name: 'EG', areaM2: 70, participates: true }],
}
const TENANCIES: Record<string, Tenancy[]> = {
  'objekt-1': [{ id: 't-a', unitId: 'u-a', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  'objekt-2': [],
}
const ledger = (propertyId: string) => ({
  year: 2025,
  rows: (TENANCIES[propertyId] ?? []).map((t) => ({ tenancyId: t.id, tenantName: t.tenantName, unitName: 'DG', months: [], sollYearCents: 0, paidYearCents: 0, balanceCents: 0 })),
  totals: { sollCents: 0, paidCents: 0, openCents: 0 },
})

let sent: { url: string; body: Record<string, unknown> }[]
// Hält die Antwort auf /api/units eines Objekts zurück, bis der Test sie freigibt (Reihenfolge).
let unitsGate: Record<string, Promise<void>> = {}

beforeEach(() => {
  sent = []
  unitsGate = {}
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if ((init?.method ?? 'GET') !== 'GET') {
      sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      if (url === '/api/properties') return json(objekt('objekt-3', 'Haus C'))
      return json({ id: 'neu' })
    }
    const [path, query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? ''
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') {
      await unitsGate[property]
      return json(UNITS[property] ?? [])
    }
    if (path === '/api/tenancies') return json(TENANCIES[property] ?? [])
    if (path?.startsWith('/api/rentledger/')) return json(ledger(property))
    if (path === '/api/meters') return json(property === 'objekt-1' ? [{ id: 'm-a', propertyId: 'objekt-1', name: 'Wasser DG', unitId: 'u-a', type: 'kaltwasser', unit: 'm³' }] : [])
    // Das Cockpit (Startseite) bekommt keine Antwort: Für diese Tests zählt es nicht, und eine
    // halbe Abrechnung brächte es zum Absturz, der die ganze Oberfläche mitnähme.
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0' })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const switchTo = (id: string) => fireEvent.change(screen.getByLabelText('Objekt wählen'), { target: { value: id } })

async function openPaymentInA() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietkonto/ }))
  const add = await screen.findByRole('button', { name: /Zahlung erfassen/ })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '11,11' } })
  expect((screen.getByLabelText(/^Mietverhältnis/) as HTMLSelectElement).value).toBe('t-a')
}

test('Zahlung: nach dem Wechsel ist der Dialog zu, und nichts wird ins vorige Objekt gespeichert', async () => {
  await openPaymentInA()
  switchTo('objekt-2')
  // Rückfrage, weil ein Dialog offen ist
  fireEvent.click(await screen.findByRole('button', { name: /Objekt wechseln/ }))
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  // Der Dialog ist geschlossen: Es gibt kein „Speichern“ mehr, mit dem die Zahlung an Müller in A ginge.
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Speichern$/ })).toBeNull())
  expect(sent).toEqual([])
})

test('Zahlung: wer die Rückfrage ablehnt, bleibt im Objekt des Dialogs', async () => {
  await openPaymentInA()
  switchTo('objekt-2')
  const ask = (await screen.findByRole('button', { name: /Objekt wechseln/ })).closest('.dialog') as HTMLElement
  fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull())
  expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1')
  // Der Dialog steht noch, mit der Eingabe, und speichert in A, wo er geöffnet wurde.
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0].body).toMatchObject({ tenancyId: 't-a', amountCents: 1111 })
})

test('Wohnung: in B angefangen, nach dem Wechsel zu A wird sie nicht in A angelegt', async () => {
  localStorage.setItem('mietfuchs.property', 'objekt-2')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Wohnung hinzufügen/ }))
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Neu' } })
  fireEvent.change(screen.getByLabelText(/^Wohnfläche/), { target: { value: '50' } })
  switchTo('objekt-1')
  fireEvent.click(await screen.findByRole('button', { name: /Objekt wechseln/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Anlegen$/ })).toBeNull())
  expect(sent).toEqual([])
})

test('ohne offenen Dialog wechselt das Objekt ohne Rückfrage', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Mietkonto/ }))
  await screen.findByRole('button', { name: /Zahlung erfassen/ })
  switchTo('objekt-2')
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull()
})

test('Ablesung: ein angefangener Zählerstand zählt als offenes Formular', async () => {
  // Die Ablesung steht nicht in einem Drawer, sondern in der Zeile des Zählers; sie hängt am
  // Zähler in A und meldet sich deshalb selbst an.
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Zähler & Stände/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Ablesungen \(0\)/ }))
  fireEvent.change(screen.getByLabelText(/^Zählerstand/), { target: { value: '123' } })
  switchTo('objekt-2')
  fireEvent.click(await screen.findByRole('button', { name: /Objekt wechseln/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Ablesung speichern/ })).toBeNull())
  expect(sent).toEqual([])
})

test('Esc in der Rückfrage bricht nur den Wechsel ab, der Dialog darunter bleibt mit der Eingabe', async () => {
  await openPaymentInA()
  switchTo('objekt-2')
  await screen.findByRole('button', { name: /Objekt wechseln/ })
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull())
  expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1')
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
})

test('Objektkarte: eine ungespeicherte Änderung zählt als offenes Formular', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByLabelText(/Für dieses Objekt abweichend/))
  fireEvent.change(screen.getByLabelText(/^IBAN/), { target: { value: 'DE02120300000000202051' } })
  switchTo('objekt-2')
  expect(await screen.findByRole('button', { name: /Objekt wechseln/ })).toBeTruthy()
})

test('Objektkarte: ein neues Objekt anlegen geht über dieselbe Rückfrage', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  fireEvent.click(await screen.findByLabelText(/Für dieses Objekt abweichend/))
  fireEvent.change(screen.getByLabelText(/^IBAN/), { target: { value: 'DE02120300000000202051' } })
  fireEvent.click(screen.getByRole('button', { name: /Weiteres Objekt anlegen/ }))
  fireEvent.change(screen.getByLabelText('Name des neuen Objekts'), { target: { value: 'Haus C' } })
  PROPERTIES.push(objekt('objekt-3', 'Haus C'))
  try {
    fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/ }))
    const ask = (await screen.findByRole('button', { name: /Objekt wechseln/ })).closest('.dialog') as HTMLElement
    fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
    // Angelegt ist es, gewechselt wird nicht, und die IBAN steht noch da.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull())
    expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1')
    expect((screen.getByLabelText(/^IBAN/) as HTMLInputElement).value).toBe('DE02120300000000202051')
  } finally {
    PROPERTIES.pop()
  }
})

test('Einstellungen: ungespeicherte Vermieterdaten zählen als offenes Formular', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Einstellungen/ }))
  fireEvent.change(await screen.findByLabelText(/^IBAN/), { target: { value: 'DE02120300000000202051' } })
  switchTo('objekt-2')
  expect(await screen.findByRole('button', { name: /Objekt wechseln/ })).toBeTruthy()
})

test('schnell A → B → A: eine späte Antwort für B überschreibt A nicht', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Stammdaten/ }))
  expect((await screen.findAllByText('DG')).length).toBeGreaterThan(0)
  let release = () => {}
  unitsGate['objekt-2'] = new Promise<void>((resolve) => { release = resolve })
  switchTo('objekt-2')
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  switchTo('objekt-1')
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-1'))
  await screen.findAllByText('DG')
  release()
  // Die Antwort für B kommt zuletzt an und darf nicht mehr gelten.
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByText('EG')).toBeNull()
  expect(screen.getAllByText('DG').length).toBeGreaterThan(0)
})

test('KI-Einstellungen: eine ungespeicherte Änderung zählt als offenes Formular', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Einstellungen/ }))
  fireEvent.change(await screen.findByLabelText(/Zeitlimit je Schritt/), { target: { value: '120' } })
  switchTo('objekt-2')
  expect(await screen.findByRole('button', { name: /Objekt wechseln/ })).toBeTruthy()
})

test('Einstellungen ohne Änderung: kein offenes Formular', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Einstellungen/ }))
  await screen.findByLabelText(/Zeitlimit je Schritt/)
  switchTo('objekt-2')
  await waitFor(() => expect((screen.getByLabelText('Objekt wählen') as HTMLSelectElement).value).toBe('objekt-2'))
  expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull()
})
