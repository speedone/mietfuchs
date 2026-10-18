// @vitest-environment jsdom
// Objekt und Abrechnungszeitraum nur in der Seitenleiste (#346 Schritt 8, UI-Durchsicht #341 M13): Die Seiten
// zeigen beides im Seitenkopf an („Haus A · Abrechnungsjahr 2025“) und haben keine zweite Auswahl. Ein Wechsel in
// der Seitenleiste stellt die Seite auf den neuen Stand. Mietkonto und Steuer wählen bei einem Zeitraum, der vom
// Kalenderjahr abweicht, das Kalenderjahr (eine andere Größe) auf der Seite; beim Kalenderobjekt nicht.
// Geprüft über die ganze App, wie propertyCreate.test.tsx.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Property } from './types'
import App from './App'
import { pageContextLine } from './propertyView'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const objekt = (id: string, name: string, extra: Partial<Property> = {}): Property => ({
  id, name, kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...extra,
})
let properties: Property[]

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  properties = [objekt('objekt-1', 'Haus A'), objekt('objekt-2', 'Haus B', { periodRules: { startMonth: 5, changes: [] } })]
  try { localStorage.clear() } catch { /* ohne Speicher nichts zu räumen */ }
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true })
    if (path === '/api/properties') return json(properties)
    if (path === '/api/settings') return json({ landlordName: '', iban: '', paymentDeadlineDays: 30 })
    if (path === '/healthz') return json({ ok: true })
    if (path === '/api/update') return json({ current: '0.9.0' })
    // Berechnungen antworten nicht: Geprüft wird der Seitenkopf, nicht der Inhalt.
    if (/^\/api\/(?:settlement|rentledger|taxreport|consumption)\//.test(path)) return new Promise<Response>(() => {})
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = () => screen.getByRole('navigation', { name: 'Hauptnavigation' })
const context = () => screen.getByTestId('page-context').textContent
const go = async (name: RegExp, heading: RegExp) => {
  fireEvent.click(within(sidebar()).getByRole('button', { name }))
  await screen.findByRole('heading', { level: 1, name: heading }, SLOW)
}

const PAGES: [RegExp, RegExp][] = [
  [/Abrechnung$/, /^Abrechnung/],
  [/Kosten$/, /^Kosten$/],
  [/Schnellerfassung/, /^Schnellerfassung/],
  [/Kostenvergleich/, /^Kostenvergleich/],
  [/Zähler/, /^Zähler/],
  [/Belegordner/, /^Belegordner/],
  [/Mietkonto/, /^Mietkonto/],
  [/Steuer/, /^Steuer/],
]

test('jede Seite zeigt Objekt und Abrechnungsjahr an und wählt sie nicht noch einmal', async () => {
  render(<App />)
  await screen.findByLabelText('Objekt wählen', {}, SLOW)
  for (const [nav, heading] of PAGES) {
    await go(nav, heading)
    expect(context(), String(nav)).toBe(`Haus A · Abrechnungsjahr ${YEAR}`)
    // Genau eine Auswahl für das Jahr und eine für das Objekt, beide in der Seitenleiste
    const years = screen.getAllByRole('combobox', { name: /jahr|zeitraum/i })
    expect(years.map((s) => s.getAttribute('aria-label')), String(nav)).toEqual(['Abrechnungsjahr'])
    expect(sidebar().contains(years[0] ?? null)).toBe(true)
    expect(screen.getAllByRole('combobox', { name: /Objekt/ }).filter((s) => !sidebar().contains(s))).toEqual([])
  }
})

// Durchsicht K7: Erkannt am Inhalt, nicht am Namen der Variablen. Kein Auswahlfeld im Inhalt einer Seite bietet
// Jahreszahlen, Zeiträume oder die Objekte an, außer dem Kalenderjahr von Mietkonto und Steuer.
test('kein Auswahlfeld im Inhalt bietet Jahre, Zeiträume oder Objekte an', async () => {
  properties = [...properties, objekt('objekt-3', 'Haus C')]
  render(<App />)
  await screen.findByLabelText('Objekt wählen', {}, SLOW)
  const names = properties.map((p) => p.name)
  for (const [nav, heading] of PAGES) {
    await go(nav, heading)
    const main = screen.getByRole('main')
    const offending = within(main).queryAllByRole('combobox').filter((s) => {
      const texts = [...(s as HTMLSelectElement).options].map((o) => o.text.trim()).filter((t) => t !== '')
      const yearsOrNames = texts.filter((t) => /^\d{4}(?:\/\d{4})?$/.test(t) || names.includes(t))
      return yearsOrNames.length >= 2 && s.getAttribute('aria-label') !== 'Kalenderjahr'
    })
    expect(offending.map((s) => s.getAttribute('aria-label') ?? s.closest('label')?.textContent), String(nav)).toEqual([])
  }
})

// Durchsicht S1: Gedruckt nennt der Seitenkopf weiter, für welches Objekt und welches Jahr die Seite gilt.
test('die Kontextzeile wird mitgedruckt', async () => {
  render(<App />)
  await screen.findByLabelText('Objekt wählen', {}, SLOW)
  await go(/Kostenvergleich/, /^Kostenvergleich/)
  const line = screen.getByTestId('page-context')
  expect(line.closest('.no-print')).toBeNull()
})

test('ein Wechsel in der Seitenleiste stellt die Seite auf Objekt und Jahr um', async () => {
  render(<App />)
  await screen.findByLabelText('Objekt wählen', {}, SLOW)
  await go(/Abrechnung$/, /^Abrechnung/)
  fireEvent.change(within(sidebar()).getByRole('combobox', { name: 'Abrechnungsjahr' }), { target: { value: String(YEAR - 1) } })
  await waitFor(() => expect(context()).toBe(`Haus A · Abrechnungsjahr ${YEAR - 1}`), SLOW)
  fireEvent.change(within(sidebar()).getByRole('combobox', { name: 'Objekt wählen' }), { target: { value: 'objekt-2' } })
  // Haus B rechnet von Mai bis April ab: Der Umschalter heißt dann „Abrechnungszeitraum“.
  await waitFor(() => expect(context()).toMatch(/^Haus B · Abrechnungszeitraum \d{4}\/\d{4}$/), SLOW)
  expect(within(sidebar()).getByRole('combobox', { name: 'Abrechnungszeitraum' })).toBeTruthy()
})

test('Mietkonto und Steuer: das Kalenderjahr nur bei abweichendem Zeitraum, als „Kalenderjahr“', async () => {
  render(<App />)
  await screen.findByLabelText('Objekt wählen', {}, SLOW)
  await go(/Mietkonto/, /^Mietkonto/)
  expect(screen.queryByRole('combobox', { name: 'Kalenderjahr' })).toBeNull()
  fireEvent.change(within(sidebar()).getByRole('combobox', { name: 'Objekt wählen' }), { target: { value: 'objekt-2' } })
  const calendarYear = await screen.findByRole('combobox', { name: 'Kalenderjahr' }, SLOW)
  expect(sidebar().contains(calendarYear)).toBe(false)
  expect(context()).toBe(`Haus B · Kalenderjahr ${(calendarYear as HTMLSelectElement).value}`)
  fireEvent.change(calendarYear, { target: { value: String(YEAR - 2) } })
  await waitFor(() => expect(context()).toBe(`Haus B · Kalenderjahr ${YEAR - 2}`), SLOW)
  await go(/Steuer/, /^Steuer/)
  expect((screen.getByRole('combobox', { name: 'Kalenderjahr' }) as HTMLSelectElement).value).toBe(String(YEAR - 2))
})

test('Kontextzeile ohne DOM: je Art der Seite', () => {
  const calendar = { calendar: true, switcherLabel: 'Abrechnungsjahr', label: '2025', calendarYear: 2025 }
  const may = { calendar: false, switcherLabel: 'Abrechnungszeitraum', label: '2025/2026', calendarYear: 2024 }
  const p = { name: 'Lindenweg 12' }
  expect(pageContextLine('period', p, calendar)).toBe('Lindenweg 12 · Abrechnungsjahr 2025')
  expect(pageContextLine('period', p, may)).toBe('Lindenweg 12 · Abrechnungszeitraum 2025/2026')
  expect(pageContextLine('calendar', p, calendar)).toBe('Lindenweg 12 · Abrechnungsjahr 2025')
  expect(pageContextLine('calendar', p, may)).toBe('Lindenweg 12 · Kalenderjahr 2024')
  expect(pageContextLine('property', p, calendar)).toBe('Lindenweg 12')
  expect(pageContextLine('none', p, calendar)).toBeNull()
  expect(pageContextLine('period', { name: '  ' }, null)).toBe('Ohne Namen')
  expect(pageContextLine('period', null, null)).toBeNull()
})
