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
let mobile = false
beforeEach(() => {
  mobile = false
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === MOBILE_QUERY ? mobile : false },
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
  // Durchsicht von PR 2, S1: Der Fokus steht auf dem Titel der Zielseite, nicht im Leeren
  await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
  expect(document.activeElement?.textContent).toBe('Kosten')
  // K3: „Nächster Schritt“ ist der Primärknopf, „Zurück zur Anleitung“ der zweite
  expect(within(bar).getByRole('button', { name: 'Nächster Schritt' }).className).not.toMatch(/secondary/)
  expect(within(bar).getByRole('button', { name: 'Zurück zur Anleitung' }).className).toMatch(/secondary/)
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
  // K3: ohne „Nächster Schritt“ ist „Zurück zur Anleitung“ primär
  expect((document.activeElement as HTMLElement).className).not.toMatch(/secondary/)
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

// Durchsicht von PR 2, S2: Die Leiste sagt, was zu tun ist, und sagt den Schritt an, auch auf derselben Seite.
test('die Leiste zeigt den Text des Schritts, voll unter „Was ist zu tun?“, und sagt den Schritt als Status an', async () => {
  const guide = await openGuide('garage')
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Stammdaten →' })[0]!)
  const bar = await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  const status = within(bar).getByRole('status')
  expect(status.textContent).toBe(`${GUIDES.garage.title} · Schritt 1 von 6`)
  expect(bar.textContent).toContain(GUIDES.garage.steps[0]!.text)
  const more = bar.querySelector('details') ?? expect.fail('„Was ist zu tun?“ fehlt')
  expect(more.querySelector('summary')?.textContent).toBe('Was ist zu tun?')
  expect(more.textContent).toContain(GUIDES.garage.steps[0]!.text)
  fireEvent.click(within(bar).getByRole('button', { name: 'Nächster Schritt' }))
  await waitFor(() => expect(within(thread() ?? expect.fail('Leiste fehlt')).getByRole('status').textContent).toBe(`${GUIDES.garage.title} · Schritt 2 von 6`))
  expect(current()).toMatch(/Stammdaten$/)
  expect(thread()?.textContent).toContain(GUIDES.garage.steps[1]!.text)
  expect(thread()?.textContent).not.toContain(GUIDES.garage.steps[0]!.text)
})

// Durchsicht von PR 2, K1: Die Anleitung gilt fürs Vorgehen, nicht für ein Objekt oder Jahr.
test('ein Wechsel des Abrechnungsjahrs behält den Faden', async () => {
  const guide = await openGuide('garage')
  fireEvent.click(within(guide).getByRole('button', { name: 'Zu Kosten →' }))
  await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  const year = within(sidebar()).getByLabelText(/Abrechnungsjahr/) as HTMLSelectElement
  const other = [...year.options].find((o) => o.value !== year.value) ?? expect.fail('kein anderes Jahr')
  fireEvent.change(year, { target: { value: other.value } })
  await waitFor(() => expect((within(sidebar()).getByLabelText(/Abrechnungsjahr/) as HTMLSelectElement).value).toBe(other.value))
  expect(thread()?.textContent).toContain('Schritt 4 von 6')
})

// Durchsicht von PR 2, K2: Sprünge aus dem Seiteninhalt behalten den Faden; nur die Navigation beendet ihn.
test('„Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung behält den Faden, die untere Leiste am Handy beendet ihn', async () => {
  mobile = true
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Menü/ }))
  fireEvent.click(within(document.querySelector('dialog.menu-sheet') as HTMLElement).getByRole('button', { name: /Hilfe & Begriffe/ }))
  fireEvent.click((await screen.findByText(GUIDES.flatRate.title)).closest('button') ?? expect.fail('Kachel fehlt'))
  const guide = await waitFor(() => document.getElementById('anleitung-flatRate') ?? expect.fail('Anleitung fehlt'))
  fireEvent.click(within(guide).getAllByRole('button', { name: 'Zu Stammdaten →' })[0]!)
  await waitFor(() => thread() ?? expect.fail('Leiste fehlt'))
  const term = await waitFor(() => document.querySelector<HTMLElement>('main .term[role="button"]') ?? expect.fail('kein Begriff auf der Seite'))
  fireEvent.click(term)
  fireEvent.click(screen.getByRole('link', { name: 'Mehr in „Hilfe & Begriffe“ →' }))
  await screen.findByRole('heading', { name: /^Alle Begriffe von A bis Z/, level: 2 })
  expect(thread()?.textContent).toContain(`Schritt 1 von ${GUIDES.flatRate.steps.length}`)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Schnellzugriff' })).getByRole('button', { name: /Zähler/ }))
  await waitFor(() => expect(thread()).toBeNull())
})
