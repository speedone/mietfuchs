// @vitest-environment jsdom
// Der Faden einer Anleitung (#488, PR 2): „Zu {Seite} →“ springt auf die Seite des Schritts und zeigt dort unten eine
// Leiste mit dem Schritt, „Nächster Schritt“ und „Zurück zur Anleitung“. Ein gewöhnlicher Seitenwechsel beendet den
// Faden, ebenso das Schließen der Leiste. Gesprungen wird über `navigate`, die Rückfrage bei offenem Formular bleibt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property, Tenancy, Unit } from './types'
import App from './App'
import { GUIDES } from '../../shared/guides.ts'
import { MOBILE_QUERY } from './components/MobileNav'

const PROPERTIES: Property[] = [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }]
const UNITS: Unit[] = [{ id: 'u-a', propertyId: 'objekt-1', name: 'DG', areaM2: 60, participates: true }]
const TENANCIES: Tenancy[] = [{ id: 't-a', unitId: 'u-a', tenantName: 'Müller', persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const ledger = { year: 2025, rows: [{ tenancyId: 't-a', tenantName: 'Müller', unitName: 'DG', months: [], sollYearCents: 0, paidYearCents: 0, balanceCents: 0 }], totals: { sollCents: 0, paidCents: 0, openCents: 0 } }

let scrollTo = vi.fn()
beforeEach(() => {
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? false : false },
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? ''
    if (path === '/api/properties') return json(PROPERTIES)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/api/units') return json(UNITS)
    if (path === '/api/tenancies') return json(TENANCIES)
    if (path.startsWith('/api/rentledger/')) return json(ledger)
    if (path.startsWith('/api/settlement/')) return new Promise<Response>(() => {})
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.8.0', mode: 'npm' })
    return json([])
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const current = () => within(sidebar()).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent?.trim()
const thread = () => screen.queryByRole('region', { name: 'Laufende Anleitung' })
const question = () => screen.queryByText('Ungespeicherte Änderungen verwerfen?')

async function openGuide(id: keyof typeof GUIDES) {
  render(<App />)
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('button', { name: /Hilfe & Begriffe/ }))
  fireEvent.click((await screen.findByText(GUIDES[id].title)).closest('button') ?? expect.fail('Kachel fehlt'))
  return waitFor(() => document.getElementById(`anleitung-${id}`) ?? expect.fail('Anleitung fehlt'))
}

test('„Zu Kosten →“ springt auf Kosten, an den Anfang, und zeigt dort die Leiste mit dem Schritt', async () => {
  const guide = await openGuide('garage')
  expect(thread()).toBeNull()
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  await waitFor(() => expect(current()).toMatch(/Kosten$/))
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  expect(bar.textContent).toContain(GUIDES.garage.title)
  expect(bar.textContent).toContain(`Schritt 4 von ${GUIDES.garage.steps.length}`)
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
  // Gedruckt wird sie nie
  expect(bar.classList.contains('no-print')).toBe(true)
  expect(within(bar).getByRole('button', { name: 'Nächster Schritt' })).toBeTruthy()
  expect(within(bar).getByRole('button', { name: 'Zurück zur Anleitung' })).toBeTruthy()
})

test('„Nächster Schritt“ springt zur Seite des nächsten Schritts; am letzten fehlt er, der Fokus geht auf „Zurück zur Anleitung“', async () => {
  const guide = await openGuide('garage')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  fireEvent.click(within(bar).getByRole('button', { name: 'Nächster Schritt' }))
  await waitFor(() => expect(current()).toMatch(/Stammdaten$/))
  await waitFor(() => expect(thread()?.textContent).toContain('Schritt 5 von 6'))
  const next = within(thread() ?? expect.fail('Leiste fehlt')).getByRole('button', { name: 'Nächster Schritt' })
  next.focus()
  fireEvent.click(next)
  await waitFor(() => expect(thread()?.textContent).toContain('Schritt 6 von 6'))
  expect(within(thread() ?? expect.fail('Leiste fehlt')).queryByRole('button', { name: 'Nächster Schritt' })).toBeNull()
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Zurück zur Anleitung'))
})

test('„Nächster Schritt“ überspringt Schritte ohne Seite', async () => {
  // In „Mehrere Objekte“ liegt Schritt 2 in der Seitenleiste
  const guide = await openGuide('properties')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Stammdaten →' })[0]!)
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  expect(bar.textContent).toContain(`Schritt 1 von ${GUIDES.properties.steps.length}`)
  fireEvent.click(within(bar).getByRole('button', { name: 'Nächster Schritt' }))
  await waitFor(() => expect(thread()?.textContent).toContain(`Schritt 3 von ${GUIDES.properties.steps.length}`))
})

test('„Zurück zur Anleitung“ öffnet die Anleitung mit dem Fokus auf dem Schritt und beendet den Faden', async () => {
  const guide = await openGuide('garage')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  fireEvent.click(within(bar).getByRole('button', { name: 'Zurück zur Anleitung' }))
  await screen.findByRole('heading', { name: GUIDES.garage.title, level: 1 })
  const steps = screen.getByRole('list', { name: 'So legen Sie es an' })
  await waitFor(() => expect(document.activeElement).toBe(within(steps).getAllByRole('listitem')[3]))
  expect(thread()).toBeNull()
})

test('ein gewöhnlicher Seitenwechsel beendet den Faden, ebenso „Leiste schließen“', async () => {
  const guide = await openGuide('garage')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Zähler/ }))
  await waitFor(() => expect(current()).toMatch(/Zähler/))
  expect(thread()).toBeNull()
  // Wieder in die Anleitung, erneut springen, dann schließen
  fireEvent.click(within(sidebar()).getByRole('button', { name: /Hilfe & Begriffe/ }))
  fireEvent.click((await screen.findByText(GUIDES.garage.title)).closest('button') ?? expect.fail('Kachel fehlt'))
  const again = await waitFor(() => document.getElementById('anleitung-garage') ?? expect.fail('Anleitung fehlt'))
  fireEvent.click(within(again).getByRole('button', { name: 'Zu Kosten →' }))
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  fireEvent.click(within(bar).getByRole('button', { name: 'Leiste schließen' }))
  await waitFor(() => expect(thread()).toBeNull())
  expect(current()).toMatch(/Kosten$/)
  // Der Fokus fällt nicht ins Leere, sondern auf den Titel der Seite
  expect(document.activeElement?.tagName).toBe('H1')
})

test('mit offenem Formular fragt der Sprung aus der Leiste; Abbrechen bleibt, Verwerfen springt', async () => {
  // „Pauschale oder Inklusivmiete“: Schritt 5 liegt im Mietkonto
  const guide = await openGuide('flatRate')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Mietkonto →' }))
  const add = await screen.findByRole('button', { name: /Zahlung anlegen/ }, { timeout: 5000 })
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(add)
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '11,11' } })
  fireEvent.click(within(thread() ?? expect.fail('Leiste fehlt')).getByRole('button', { name: 'Nächster Schritt' }))
  const dialog = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(question()).toBeNull())
  expect(current()).toMatch(/Mietkonto$/)
  expect(thread()?.textContent).toContain('Schritt 5 von 6')
  expect((screen.getByLabelText(/^Betrag/) as HTMLInputElement).value).toBe('11,11')
  fireEvent.click(within(thread() ?? expect.fail('Leiste fehlt')).getByRole('button', { name: 'Zurück zur Anleitung' }))
  const again = (await screen.findByText('Ungespeicherte Änderungen verwerfen?')).closest('.dialog') as HTMLElement
  fireEvent.click(within(again).getByRole('button', { name: 'Verwerfen' }))
  await screen.findByRole('heading', { name: GUIDES.flatRate.title, level: 1 })
  expect(thread()).toBeNull()
})
