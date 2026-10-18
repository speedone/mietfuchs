// @vitest-environment jsdom
// Die Navigation am Handy (#346, Schritt 9): Kopf mit ☰ und ⇅, Menüblatt als `<dialog>`, untere
// Leiste. Unter 900 px Breite zeichnet App.tsx sie statt der Seitenleiste; hier sagt das der
// nachgestellte Media Query. Was jsdom nicht rechnet (Top-Layer, inerter Hintergrund, Breite der
// Seite), prüft der Browserlauf.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Tenancy, Unit } from './types'
import App from './App'
import { MOBILE_QUERY } from './components/MobileNav'

const objekt = (id: string, name: string): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null,
})
const PROPERTIES = [objekt('objekt-1', 'Lindenweg 12'), objekt('objekt-2', 'Haus B')]
const UNITS: Record<string, Unit[]> = {
  'objekt-1': [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }],
  'objekt-2': [],
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

let mobile = true
let mode = 'npm'
let posted: string[] = []
// Die Horcher auf den Media Query, damit ein Test die Breite über die Grenze schieben kann
const mediaListeners = new Set<() => void>()
const setMobile = (value: boolean) => act(() => {
  mobile = value
  for (const listener of [...mediaListeners]) listener()
})
beforeEach(() => {
  mobile = true
  mode = 'npm'
  posted = []
  mediaListeners.clear()
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
    addEventListener: (_: string, listener: () => void) => { if (query === MOBILE_QUERY) mediaListeners.add(listener) },
    removeEventListener: (_: string, listener: () => void) => { mediaListeners.delete(listener) },
  }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') posted.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const [path, query = ''] = url.split('?')
    const property = new URLSearchParams(query).get('property') ?? ''
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(UNITS[property] ?? [])
    if (path === '/api/tenancies') return json(TENANCIES[property] ?? [])
    if (path?.startsWith('/api/rentledger/')) return json(ledger(property))
    // Das Cockpit bekommt keine Antwort; für diese Tests zählt nur die Navigation.
    if (path?.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode })
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sheet = () => document.querySelector('dialog.menu-sheet') as HTMLDialogElement
const menuButton = () => screen.getByRole('button', { name: 'Menü' })
const bar = () => screen.getByRole('navigation', { name: 'Schnellzugriff' })

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Menü' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  return sheet()
}

test('der Kopf nennt Seite, Objekt und Zeitraum; die Seitenleiste fehlt', async () => {
  render(<App />)
  const context = await screen.findByTestId('mobile-context')
  expect(context.textContent).toMatch(/^Lindenweg 12 · \d{4}$/)
  expect(document.querySelector('header')?.textContent).toContain('Cockpit')
  // Am Handy steht die Navigation nur im Blatt, und das ist zu
  expect(document.querySelector('nav.sidebar')).toBeNull()
  expect(sheet().open).toBe(false)
  expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  expect(menuButton().getAttribute('aria-controls')).toBe(sheet().id)
})

test('☰ öffnet das Blatt, Esc schließt es, und der Fokus steht wieder auf ☰', async () => {
  render(<App />)
  const dialog = await openMenu()
  expect(menuButton().getAttribute('aria-expanded')).toBe('true')
  // Dieselbe Navigation wie am Rechner, samt Objekt, Zeitraum und Design
  expect(within(dialog).getByRole('button', { name: /Kostenvergleich/ })).toBeTruthy()
  expect(within(dialog).getByLabelText('Objekt wählen')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: /^Design:/ })).toBeTruthy()
  expect(dialog.contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
  await waitFor(() => expect(sheet().open).toBe(false))
  expect(document.activeElement).toBe(menuButton())
  expect(menuButton().getAttribute('aria-expanded')).toBe('false')
})

test('✕ und ein Klick daneben schließen das Blatt, ein Klick hinein nicht', async () => {
  render(<App />)
  let dialog = await openMenu()
  // Ein Klick auf den Inhalt landet nicht am <dialog> selbst
  fireEvent.click(within(dialog).getByText('Sammeln'))
  expect(sheet().open).toBe(true)
  // Der Hintergrund des modalen Blatts gehört zum <dialog>: Ein Klick dorthin trifft ihn selbst
  fireEvent.click(dialog)
  await waitFor(() => expect(sheet().open).toBe(false))
  expect(document.activeElement).toBe(menuButton())
  dialog = await openMenu()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Menü schließen' }))
  await waitFor(() => expect(sheet().open).toBe(false))
  expect(document.activeElement).toBe(menuButton())
})

test('ein Eintrag im Blatt wechselt die Seite und schließt das Blatt', async () => {
  render(<App />)
  const dialog = await openMenu()
  fireEvent.click(within(dialog).getByRole('button', { name: /Mietkonto/ }))
  await waitFor(() => expect(sheet().open).toBe(false))
  expect(await screen.findByRole('heading', { level: 1, name: /Mietkonto/ })).toBeTruthy()
  expect(document.querySelector('header')?.textContent).toContain('Mietkonto')
  // Im Blatt ist der Eintrag danach die aktuelle Seite
  const again = await openMenu()
  expect(within(again).getByRole('button', { name: /Mietkonto/ }).getAttribute('aria-current')).toBe('page')
})

test('die untere Leiste markiert die aktuelle Seite mit aria-current, „Mehr“ öffnet das Blatt', async () => {
  render(<App />)
  await screen.findByTestId('mobile-context')
  const current = () => within(bar()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent)
  expect(within(bar()).getAllByRole('button').map((b) => b.lastElementChild?.textContent)).toEqual(['Cockpit', 'Erfassen', 'Zähler', 'Stammdaten', 'Mehr'])
  expect(current()).toEqual([expect.stringContaining('Cockpit')])
  fireEvent.click(within(bar()).getByRole('button', { name: 'Zähler' }))
  await waitFor(() => expect(current()).toEqual([expect.stringContaining('Zähler')]))
  expect(document.querySelector('header')?.textContent).toContain('Zähler & Stände')
  // Eine Seite, die nicht in der Leiste steht: keiner ist „aktuelle Seite“, auch nicht „Mehr“
  const more = within(bar()).getByRole('button', { name: 'Mehr' })
  fireEvent.click(more)
  await waitFor(() => expect(sheet().open).toBe(true))
  fireEvent.click(within(sheet()).getByRole('button', { name: /Hilfe/ }))
  await waitFor(() => expect(current()).toEqual([]))
  expect(more.getAttribute('aria-current')).toBeNull()
  expect(document.activeElement).toBe(more)
})

test('⇅ öffnet das Blatt auf der Objektwahl; bei offenem Formular fragt der Wechsel nach', async () => {
  render(<App />)
  await screen.findByTestId('mobile-context')
  // Ein offenes Formular im Objekt Lindenweg 12
  fireEvent.click(within(bar()).getByRole('button', { name: 'Mehr' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  fireEvent.click(within(sheet()).getByRole('button', { name: /Einstellungen/ }))
  fireEvent.change(await screen.findByLabelText('Name des Vermieters'), { target: { value: 'Erika Muster' } })

  const swap = screen.getByRole('button', { name: /^Objekt und Zeitraum wechseln/ })
  fireEvent.click(swap)
  await waitFor(() => expect(sheet().open).toBe(true))
  const select = within(sheet()).getByLabelText('Objekt wählen')
  expect(document.activeElement).toBe(select)
  fireEvent.change(select, { target: { value: 'objekt-2' } })
  // Die Rückfrage liegt im Top-Layer über dem Blatt (#346, Schritt 1); das Blatt bleibt offen
  const ask = (await screen.findByRole('button', { name: /Objekt wechseln/ })).closest('.dialog') as HTMLElement
  expect(sheet().open).toBe(true)
  fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull())
  // Nach Abbrechen steht man, wo man war: im Blatt, auf der Objektwahl
  expect(sheet().open).toBe(true)
  expect(document.activeElement).toBe(select)
  expect(screen.getByTestId('mobile-context').textContent).toMatch(/^Lindenweg 12 · /)
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Erika Muster')

  // Zweiter Versuch, diesmal bestätigt
  fireEvent.change(within(sheet()).getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  fireEvent.click(await screen.findByRole('button', { name: /Objekt wechseln/ }))
  await waitFor(() => expect(screen.getByTestId('mobile-context').textContent).toMatch(/^Haus B · \d{4}$/))
})

test('am Rechner bleibt die Seitenleiste, ohne Kopf und Leiste', async () => {
  mobile = false
  render(<App />)
  await screen.findByRole('button', { name: /Kostenvergleich/ })
  expect(document.querySelector('nav.sidebar')).not.toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Schnellzugriff' })).toBeNull()
  expect(document.querySelector('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: /Cockpit/ }).getAttribute('aria-current')).toBe('page')
})

// Durchsicht S-1: Mit den Pfeiltasten sendet ein geschlossenes Auswahlfeld bei jedem Schritt `change`.
// Schlösse das Blatt dabei, wäre nur der nächste Eintrag erreichbar. Ohne offenes Formular bleibt es
// deshalb offen, wie die Seitenleiste am Rechner, und der Fokus bleibt auf der Auswahl.
test('Objektwahl im Blatt ohne offenes Formular: das Blatt bleibt offen, auch über mehrere Schritte', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /^Objekt und Zeitraum wechseln/ }))
  await waitFor(() => expect(sheet().open).toBe(true))
  const select = within(sheet()).getByLabelText('Objekt wählen') as HTMLSelectElement
  // Was ArrowDown im Browser auslöst: der nächste Wert und `change`
  fireEvent.keyDown(select, { key: 'ArrowDown' })
  fireEvent.change(select, { target: { value: 'objekt-2' } })
  await waitFor(() => expect(screen.getByTestId('mobile-context').textContent).toMatch(/^Haus B · /))
  expect(sheet().open).toBe(true)
  const again = within(sheet()).getByLabelText('Objekt wählen') as HTMLSelectElement
  expect(again.value).toBe('objekt-2')
  expect(document.activeElement).toBe(again)
  fireEvent.change(again, { target: { value: 'objekt-1' } })
  await waitFor(() => expect(screen.getByTestId('mobile-context').textContent).toMatch(/^Lindenweg 12 · /))
  expect(sheet().open).toBe(true)
})

// Eine angefangene Eingabe auf einer Karte (Einstellungen). Ein Seitenfenster taugt dafür nicht mehr: Es ist
// seit #346 Schritt 2 modal, Kopf und untere Leiste sind dahinter inert, das Blatt lässt sich also gar nicht öffnen.
async function openPaymentForm() {
  render(<App />)
  await screen.findByTestId('mobile-context')
  fireEvent.click(within(bar()).getByRole('button', { name: 'Mehr' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  fireEvent.click(within(sheet()).getByRole('button', { name: /Einstellungen/ }))
  fireEvent.change(await screen.findByLabelText('Name des Vermieters'), { target: { value: 'Erika Muster' } })
}

test('Zeitraum im Blatt bei offenem Formular: Rückfrage vor dem Wechsel, Abbrechen lässt alles stehen', async () => {
  await openPaymentForm()
  const before = screen.getByTestId('mobile-context').textContent ?? ''
  fireEvent.click(screen.getByRole('button', { name: /^Objekt und Zeitraum wechseln/ }))
  await waitFor(() => expect(sheet().open).toBe(true))
  const period = within(sheet()).getByLabelText('Abrechnungsjahr') as HTMLSelectElement
  const other = [...period.options].map((o) => o.value).find((v) => v !== period.value) ?? ''
  fireEvent.change(period, { target: { value: other } })
  const ask = (await screen.findByRole('button', { name: /Jahr wechseln/ })).closest('.dialog') as HTMLElement
  expect(sheet().open).toBe(true)
  fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Jahr wechseln/ })).toBeNull())
  expect(sheet().open).toBe(true)
  expect(screen.getByTestId('mobile-context').textContent).toBe(before)
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Erika Muster')

  fireEvent.change(within(sheet()).getByLabelText('Abrechnungsjahr'), { target: { value: other } })
  fireEvent.click(await screen.findByRole('button', { name: /Jahr wechseln/ }))
  await waitFor(() => expect(screen.getByTestId('mobile-context').textContent).toBe(`Lindenweg 12 · ${other}`))
})

test('Esc im Blatt schließt nur das Blatt, nicht die Eingabe darunter', async () => {
  await openPaymentForm()
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
  await waitFor(() => expect(sheet().open).toBe(false))
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Erika Muster')
})

test('Beenden im Blatt: die Rückfrage liegt über dem Blatt, Abbrechen beendet nichts', async () => {
  mode = 'binary'
  render(<App />)
  const dialog = await openMenu()
  const quit = await within(dialog).findByRole('button', { name: /Mietfuchs beenden/ })
  quit.focus()
  fireEvent.click(quit)
  const ask = (await screen.findByRole('heading', { name: 'Mietfuchs beenden?' })).closest('.dialog') as HTMLElement
  expect(sheet().open).toBe(true)
  fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Mietfuchs beenden?' })).toBeNull())
  expect(sheet().open).toBe(true)
  expect(document.activeElement).toBe(quit)
  expect(posted).toEqual([])
  expect(screen.queryByText('Mietfuchs ist beendet')).toBeNull()

  fireEvent.click(quit)
  const ask2 = (await screen.findByRole('heading', { name: 'Mietfuchs beenden?' })).closest('.dialog') as HTMLElement
  fireEvent.click(within(ask2).getByRole('button', { name: 'Beenden' }))
  expect(await screen.findByText('Mietfuchs ist beendet')).toBeTruthy()
  expect(posted).toEqual(['/api/quit'])
})

test('über die Grenze von 900 px: Blatt weg, Seitenleiste da, Formular und Fokus bleiben sinnvoll', async () => {
  await openPaymentForm()
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  await waitFor(() => expect(sheet().open).toBe(true))
  // Breiter: Kopf, Blatt und Leiste verschwinden, die Seitenleiste erscheint
  setMobile(false)
  await waitFor(() => expect(document.querySelector('nav.sidebar')).not.toBeNull())
  expect(document.querySelector('dialog')).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Schnellzugriff' })).toBeNull()
  expect((screen.getByLabelText('Name des Vermieters') as HTMLInputElement).value).toBe('Erika Muster')
  // Der Fokus lag im ausgehängten Blatt; er steht jetzt auf der aktuellen Seite in der Seitenleiste
  expect(document.activeElement).toBe(within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Einstellungen/ }))
  // Schmaler: wieder Kopf und Leiste, keine Seitenleiste
  ;(document.activeElement as HTMLElement).blur()
  setMobile(true)
  await waitFor(() => expect(document.querySelector('nav.sidebar')).toBeNull())
  expect(screen.getByRole('navigation', { name: 'Schnellzugriff' })).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menü' }))
})

// Nachprüfung K-A: Eine Rückfrage aus dem Blatt übersteht den Wechsel über die Grenze (sie hängt außerhalb
// der Navigation), ihr Auslöser ⇅ nicht. Nach dem Schließen steht der Fokus auf der aktuellen Seite in der
// Seitenleiste statt auf BODY.
test('Rückfrage aus dem Blatt, dann breiter: nach Abbrechen steht der Fokus in der Seitenleiste', async () => {
  await openPaymentForm()
  fireEvent.click(screen.getByRole('button', { name: /^Objekt und Zeitraum wechseln/ }))
  await waitFor(() => expect(sheet().open).toBe(true))
  fireEvent.change(within(sheet()).getByLabelText('Objekt wählen'), { target: { value: 'objekt-2' } })
  const ask = (await screen.findByRole('button', { name: /Objekt wechseln/ })).closest('.dialog') as HTMLElement
  setMobile(false)
  await waitFor(() => expect(document.querySelector('nav.sidebar')).not.toBeNull())
  fireEvent.click(within(ask).getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Objekt wechseln/ })).toBeNull())
  expect(document.activeElement).toBe(within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Einstellungen/ }))
})
